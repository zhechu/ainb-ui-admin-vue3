/**
 * 公式求值器（前端）
 *
 * 与后端 `FormulaEvaluator.java` 是同一套语义的两份实现，一致性由
 * formula-cases.json 保证：前端 Vitest 与后端 JUnit 读同一份用例各跑一遍。
 *
 * ## 分工
 *
 * 前端这份负责录入时的即时反馈 —— 改一个数字，合计立刻跟着变。
 * 后端那份是权威：提交时用同一份 AST 重算并覆盖前端提交的值。
 *
 * 只有前端算的话，构造一个请求就能写入任意金额。
 * 两边算得不一样则更糟：用户看到的合计与入库的合计不同，且没有任何报错。
 *
 * ## 为什么用 decimal.js 而不是原生 number
 *
 * 0.1 + 0.2 在浮点下是 0.30000000000000004，1.1 * 3 是 3.3000000000000003。
 * 金额字段上这是硬伤，而且前端算出 0.30000000000000004、后端 BigDecimal 算出 0.3，
 * 两边就直接不一致了。
 */
import Decimal from 'decimal.js'
import type { FormulaNode } from './parser'

// 与后端 SCALE 对齐：除法必须给定精度，否则 10/3 这类无限小数无法表示
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP })

/** 中间运算保留的小数位，与后端 FormulaEvaluator.SCALE 一致 */
const SCALE = 10

/** 舍入方式 */
export type RoundingMode = 'HALF_UP' | 'CEIL' | 'FLOOR'

const roundingOf = (mode?: string | null): Decimal.Rounding => {
  switch ((mode ?? 'HALF_UP').toUpperCase()) {
    case 'CEIL':
      return Decimal.ROUND_CEIL
    case 'FLOOR':
      return Decimal.ROUND_FLOOR
    default:
      // HALF_UP 而非银行家舍入：后者会把 1.005 舍成 1.00，与用户对四舍五入的直觉不符
      return Decimal.ROUND_HALF_UP
  }
}

const AGGREGATES = new Set(['SUM', 'AVG', 'COUNT', 'MAX', 'MIN'])

// ==================== 类型转换原语（须与后端逐条对齐）====================

/** 转 Decimal；转不动返回 null */
const toDecimal = (value: any): Decimal | null => {
  if (value === null || value === undefined) return null
  if (value instanceof Decimal) return value
  if (typeof value === 'boolean') return new Decimal(value ? 1 : 0)
  if (typeof value === 'number') return Number.isNaN(value) ? null : new Decimal(value)
  const s = String(value).trim()
  if (s === '') return null
  try {
    const d = new Decimal(s)
    return d.isNaN() ? null : d
  } catch {
    return null
  }
}

/** 转 Decimal，转不动按 0 —— 空值参与算术按 0 处理 */
const toDecimalOrZero = (value: any): Decimal => toDecimal(value) ?? new Decimal(0)

const isNullish = (value: any): boolean =>
  value === null || value === undefined || value === ''

const asString = (value: any): string => {
  if (value === null || value === undefined) return ''
  if (value instanceof Decimal) return value.toFixed()
  return String(value)
}

const toBoolean = (value: any): boolean => {
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean') return value
  const d = toDecimal(value)
  if (d !== null) return !d.isZero()
  return String(value).trim() !== ''
}

const looseEquals = (left: any, right: any): boolean => {
  const ln = left === null || left === undefined
  const rn = right === null || right === undefined
  if (ln || rn) return ln && rn
  const ld = toDecimal(left)
  const rd = toDecimal(right)
  if (ld !== null && rd !== null) return ld.eq(rd)
  return asString(left) === asString(right)
}

/** 数值比较，用于 > 与 >=。任一侧不是数字时返回 -1，使条件判为不满足 */
const compareNumbers = (left: any, right: any): number => {
  const ld = toDecimal(left)
  const rd = toDecimal(right)
  if (ld === null || rd === null) return -1
  return ld.comparedTo(rd)
}

/**
 * 数值比较，用于 < 与 <=
 *
 * 与 compareNumbers 的区别只在「无法比较时返回什么」：若也返回 -1，
 * `<` 就会变成「不是数字反而判为满足」，方向正好错了。
 */
const compareNumbersReverse = (left: any, right: any): number => {
  const ld = toDecimal(left)
  const rd = toDecimal(right)
  if (ld === null || rd === null) return 1
  return ld.comparedTo(rd)
}

/** 解析日期。只认 ISO 格式，不做模糊猜测 —— 猜错格式比算不出来更危险 */
const toDate = (value: any): Date | null => {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  const s = String(value).trim()
  if (s === '') return null
  const iso = s.length > 10 ? s.slice(0, 10) : s
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

// ==================== 求值 ====================

const evalNode = (node: FormulaNode | null | undefined, data: Record<string, any>): any => {
  if (!node || !node.type) return null

  switch (node.type) {
    case 'num':
      return toDecimal(node.value)
    case 'str':
      return node.value === null || node.value === undefined ? '' : String(node.value)
    case 'bool':
      return node.value === true || String(node.value).toLowerCase() === 'true'
    case 'field':
      return data ? data[node.name as string] : null
    // subfield 只在聚合函数的参数位置有意义
    case 'subfield':
      return null
    case 'unary':
      return evalUnary(node, data)
    case 'binary':
      return evalBinary(node, data)
    case 'call':
      return evalCall(node, data)
    default:
      // 未知节点类型返回 null：AST 可能是新版本前端写的
      return null
  }
}

const evalUnary = (node: FormulaNode, data: Record<string, any>): any => {
  const operand = evalNode(node.operand, data)
  if (node.op === '-') return toDecimalOrZero(operand).negated()
  if (node.op?.toUpperCase() === 'NOT') return !toBoolean(operand)
  return null
}

const evalBinary = (node: FormulaNode, data: Record<string, any>): any => {
  const op = node.op
  if (!op) return null

  // 逻辑运算短路求值
  if (op.toUpperCase() === 'AND') {
    return toBoolean(evalNode(node.left, data)) && toBoolean(evalNode(node.right, data))
  }
  if (op.toUpperCase() === 'OR') {
    return toBoolean(evalNode(node.left, data)) || toBoolean(evalNode(node.right, data))
  }

  const left = evalNode(node.left, data)
  const right = evalNode(node.right, data)

  switch (op) {
    case '+':
      return toDecimalOrZero(left).plus(toDecimalOrZero(right))
    case '-':
      return toDecimalOrZero(left).minus(toDecimalOrZero(right))
    case '*':
      return toDecimalOrZero(left).times(toDecimalOrZero(right))
    case '/': {
      const r = toDecimalOrZero(right)
      // 除数为 0 返回 null，不抛异常
      if (r.isZero()) return null
      return toDecimalOrZero(left).div(r).toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP)
    }
    case '%': {
      const r = toDecimalOrZero(right)
      return r.isZero() ? null : toDecimalOrZero(left).mod(r)
    }
    case '=':
    case '==':
      return looseEquals(left, right)
    case '!=':
    case '<>':
      return !looseEquals(left, right)
    case '>':
      return compareNumbers(left, right) > 0
    case '>=':
      return compareNumbers(left, right) >= 0
    case '<':
      return compareNumbersReverse(left, right) < 0
    case '<=':
      return compareNumbersReverse(left, right) <= 0
    default:
      return null
  }
}

/**
 * 子表聚合
 *
 * 三条不同的空值规则，都有用例钉住：
 * SUM 忽略空值；COUNT 数所有行；AVG 按有值的行数平均。
 */
const aggregate = (name: string, subfield: FormulaNode, data: Record<string, any>): any => {
  const values: Decimal[] = []
  let rowCount = 0

  const rows = data ? data[subfield.sub as string] : null
  if (Array.isArray(rows)) {
    for (const row of rows) {
      rowCount++
      if (row && typeof row === 'object') {
        const d = toDecimal(row[subfield.field as string])
        if (d !== null) values.push(d)
      }
    }
  }

  switch (name) {
    case 'SUM':
      // 子表为空时得 0 而不是 null：合计栏显示 0 更符合直觉，
      // 也避免下游运算被 null 传染
      return values.reduce((acc, d) => acc.plus(d), new Decimal(0))
    case 'COUNT':
      return new Decimal(rowCount)
    case 'AVG':
      // 无有值行时返回 null —— 返回 0 会被误读成「平均值是 0」
      return values.length === 0
        ? null
        : values
            .reduce((acc, d) => acc.plus(d), new Decimal(0))
            .div(values.length)
            .toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP)
    case 'MAX':
      return values.length === 0 ? null : values.reduce((a, b) => (a.gt(b) ? a : b))
    case 'MIN':
      return values.length === 0 ? null : values.reduce((a, b) => (a.lt(b) ? a : b))
    default:
      return null
  }
}

const evalCall = (node: FormulaNode, data: Record<string, any>): any => {
  const name = (node.name ?? '').toUpperCase()
  const args = node.args ?? []

  // 聚合形态：参数是 subfield。MAX/MIN 两种形态都支持，靠参数类型区分
  if (AGGREGATES.has(name) && args.length === 1 && args[0]?.type === 'subfield') {
    return aggregate(name, args[0], data)
  }

  const one = (fn: (d: Decimal) => Decimal): any => {
    if (args.length !== 1) return null
    const d = toDecimal(evalNode(args[0], data))
    return d === null ? null : fn(d)
  }

  switch (name) {
    case 'ROUND': {
      if (args.length < 1 || args.length > 2) return null
      const d = toDecimal(evalNode(args[0], data))
      if (d === null) return null
      const scale = args.length === 2 ? toDecimalOrZero(evalNode(args[1], data)).toNumber() : 0
      return d.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP)
    }
    case 'CEIL':
      return one((d) => d.toDecimalPlaces(0, Decimal.ROUND_CEIL))
    case 'FLOOR':
      return one((d) => d.toDecimalPlaces(0, Decimal.ROUND_FLOOR))
    case 'ABS':
      return one((d) => d.abs())
    case 'MAX':
    case 'MIN': {
      if (args.length === 0) return null
      let result: Decimal | null = null
      for (const arg of args) {
        const d = toDecimal(evalNode(arg, data))
        if (d === null) continue
        if (result === null) result = d
        else result = name === 'MAX' ? Decimal.max(result, d) : Decimal.min(result, d)
      }
      return result
    }
    // 到这里说明参数不是 subfield，这三个函数没有标量形态
    case 'SUM':
    case 'AVG':
    case 'COUNT':
      return null
    case 'CONCAT':
      // 空值当空串，不输出 null 字样
      return args.map((a) => asString(evalNode(a, data))).join('')
    case 'LEN':
      return args.length === 1 ? new Decimal(asString(evalNode(args[0], data)).length) : null
    case 'TRIM':
      return args.length === 1 ? asString(evalNode(args[0], data)).trim() : null
    case 'SUBSTR': {
      if (args.length !== 3) return null
      const s = asString(evalNode(args[0], data))
      // 起始位从 1 开始计，与用户直觉一致
      const start = toDecimalOrZero(evalNode(args[1], data)).toNumber() - 1
      const len = toDecimalOrZero(evalNode(args[2], data)).toNumber()
      if (start < 0 || start >= s.length || len <= 0) return ''
      return s.slice(start, start + len)
    }
    case 'IF':
      return args.length === 3
        ? toBoolean(evalNode(args[0], data))
          ? evalNode(args[1], data)
          : evalNode(args[2], data)
        : null
    case 'IFNULL': {
      if (args.length !== 2) return null
      const first = evalNode(args[0], data)
      return isNullish(first) ? evalNode(args[1], data) : first
    }
    case 'TODAY':
      return new Date().toISOString().slice(0, 10)
    case 'DATEDIFF': {
      if (args.length !== 2) return null
      const a = toDate(evalNode(args[0], data))
      const b = toDate(evalNode(args[1], data))
      if (!a || !b) return null
      return new Decimal(Math.round((a.getTime() - b.getTime()) / 86400000))
    }
    case 'YEAR':
    case 'MONTH':
    case 'DAY': {
      if (args.length !== 1) return null
      const d = toDate(evalNode(args[0], data))
      if (!d) return null
      if (name === 'YEAR') return new Decimal(d.getUTCFullYear())
      if (name === 'MONTH') return new Decimal(d.getUTCMonth() + 1)
      return new Decimal(d.getUTCDate())
    }
    default:
      // 未知函数返回 null，不抛异常
      return null
  }
}

/**
 * 求值
 *
 * @param ast       公式 AST
 * @param data      表单数据。子表数据是对象数组。【不会】被修改
 * @param precision 结果保留小数位，可选
 * @param rounding  舍入方式，可选
 * @returns 结果。Decimal 会转成 number 返回，便于直接写进表单值
 */
export const evaluateFormula = (
  ast: FormulaNode | null | undefined,
  data: Record<string, any>,
  precision?: number | null,
  rounding?: RoundingMode | null
): any => {
  if (!ast) return null
  let result: any
  try {
    result = evalNode(ast, data ?? {})
  } catch (e) {
    // 任何求值错误都返回 null：一个配歪的公式不该让整张表单卡住
    console.debug('[FormFormula] 公式求值失败，返回 null', e)
    return null
  }
  if (result instanceof Decimal) {
    const shaped =
      precision === null || precision === undefined
        ? result
        : result.toDecimalPlaces(precision, roundingOf(rounding))
    return shaped.toNumber()
  }
  return result
}
