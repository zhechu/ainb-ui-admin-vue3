/**
 * 公式解析器（全系统唯一一份）
 *
 * 把用户在设计器里写的表达式编译成与语言无关的 AST JSON，存进表单规则。
 * 两端都只求值不解析 —— 少一套 parser 就少一半漂移面。
 *
 * ## 这里没有任何脚本执行
 *
 * 手写词法+语法分析，只识别白名单函数、字段引用与固定运算符。
 * 不用 `eval`、不用 `new Function`、不用任何表达式库 ——
 * 公式来自用户输入，且会随表单流转到别的环境，任何形式的动态求值都是注入面。
 *
 * ## 语法
 *
 * ```
 * 表达式    := 逻辑或
 * 逻辑或    := 逻辑与 ( "OR" 逻辑与 )*
 * 逻辑与    := 比较 ( "AND" 比较 )*
 * 比较      := 加减 ( ("="|"!="|"<>"|">"|">="|"<"|"<=") 加减 )?
 * 加减      := 乘除 ( ("+"|"-") 乘除 )*
 * 乘除      := 一元 ( ("*"|"/"|"%") 一元 )*
 * 一元      := ("-"|"NOT") 一元 | 原子
 * 原子      := 数字 | 字符串 | "{" 字段路径 "}" | 函数调用 | "(" 表达式 ")"
 * 字段路径  := 标识符 ( "." 标识符 )?      // 带点的是子表字段，仅聚合函数可用
 * ```
 */

/** AST 节点 */
export interface FormulaNode {
  type: 'num' | 'str' | 'bool' | 'field' | 'subfield' | 'unary' | 'binary' | 'call'
  value?: any
  name?: string
  /** 子表控件字段 */
  sub?: string
  /** 子表内部字段 */
  field?: string
  op?: string
  operand?: FormulaNode
  left?: FormulaNode
  right?: FormulaNode
  args?: FormulaNode[]
}

/** 解析结果 */
export interface ParseResult {
  ok: boolean
  ast?: FormulaNode
  /** 出错信息，含位置 */
  error?: string
  /** 出错位置（字符下标），便于编辑器高亮 */
  position?: number
  /** 表达式引用到的普通字段 */
  fields: string[]
  /** 表达式引用到的子表字段，形如 items.price */
  subFields: string[]
}

/**
 * 函数白名单
 *
 * 值是允许的参数个数；null 表示不定参数。
 * 不在这份清单里的函数一律解析失败 —— 这是「只有受控的树」这条保证的入口。
 */
const FUNCTIONS: Record<string, number[] | null> = {
  // 数学
  ROUND: [1, 2],
  CEIL: [1],
  FLOOR: [1],
  ABS: [1],
  MAX: null,
  MIN: null,
  // 聚合（参数必须是子表字段）
  SUM: [1],
  AVG: [1],
  COUNT: [1],
  // 文本
  CONCAT: null,
  LEN: [1],
  TRIM: [1],
  SUBSTR: [3],
  // 逻辑
  IF: [3],
  IFNULL: [2],
  // 日期
  TODAY: [0],
  DATEDIFF: [2],
  YEAR: [1],
  MONTH: [1],
  DAY: [1]
}

/** 只有这几个函数接受子表字段作为参数 */
const AGGREGATE_FUNCTIONS = new Set(['SUM', 'AVG', 'COUNT', 'MAX', 'MIN'])

type TokenType = 'num' | 'str' | 'field' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof'

interface Token {
  type: TokenType
  value: string
  pos: number
}

class ParseError extends Error {
  constructor(
    message: string,
    readonly position: number
  ) {
    super(message)
  }
}

/** 词法分析 */
const tokenize = (input: string): Token[] => {
  const tokens: Token[] = []
  let i = 0
  const n = input.length

  while (i < n) {
    const ch = input[i]

    if (/\s/.test(ch)) {
      i++
      continue
    }

    // 数字
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let j = i
      while (j < n && /[0-9.]/.test(input[j])) j++
      const text = input.slice(i, j)
      if ((text.match(/\./g) ?? []).length > 1) {
        throw new ParseError(`数字格式不对：${text}`, i)
      }
      tokens.push({ type: 'num', value: text, pos: i })
      i = j
      continue
    }

    // 字符串。单双引号都接受
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      let text = ''
      while (j < n && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < n) {
          j++
        }
        text += input[j]
        j++
      }
      if (j >= n) {
        throw new ParseError('字符串没有闭合的引号', i)
      }
      tokens.push({ type: 'str', value: text, pos: i })
      i = j + 1
      continue
    }

    // 字段引用 {字段} 或 {子表.字段}
    if (ch === '{') {
      const end = input.indexOf('}', i)
      if (end < 0) {
        throw new ParseError('字段引用缺少右花括号', i)
      }
      const path = input.slice(i + 1, end).trim()
      if (!path) {
        throw new ParseError('字段引用是空的', i)
      }
      if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?$/.test(path)) {
        throw new ParseError(`字段名不合法：${path}`, i)
      }
      tokens.push({ type: 'field', value: path, pos: i })
      i = end + 1
      continue
    }

    // 标识符（函数名、AND/OR/NOT）
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < n && /[\w]/.test(input[j])) j++
      tokens.push({ type: 'ident', value: input.slice(i, j), pos: i })
      i = j
      continue
    }

    // 双字符运算符要先试，否则 ">=" 会被切成 ">" 和 "="
    const two = input.slice(i, i + 2)
    if (['>=', '<=', '!=', '<>', '=='].includes(two)) {
      tokens.push({ type: 'op', value: two, pos: i })
      i += 2
      continue
    }

    if ('+-*/%><='.includes(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i })
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch, pos: i })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch, pos: i })
      i++
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch, pos: i })
      i++
      continue
    }

    throw new ParseError(`无法识别的字符：${ch}`, i)
  }

  tokens.push({ type: 'eof', value: '', pos: n })
  return tokens
}

/**
 * 解析表达式
 *
 * @param input 用户写的表达式
 */
export const parseFormula = (input: string | null | undefined): ParseResult => {
  const fields = new Set<string>()
  const subFields = new Set<string>()

  if (!input || !input.trim()) {
    return { ok: true, ast: undefined, fields: [], subFields: [] }
  }

  let tokens: Token[]
  try {
    tokens = tokenize(input)
  } catch (e) {
    const err = e as ParseError
    return { ok: false, error: err.message, position: err.position, fields: [], subFields: [] }
  }

  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expect = (type: TokenType, hint: string) => {
    const token = peek()
    if (token.type !== type) {
      throw new ParseError(`${hint}，实际是「${token.value || '表达式结束'}」`, token.pos)
    }
    return next()
  }

  const parseExpression = (): FormulaNode => parseOr()

  const parseOr = (): FormulaNode => {
    let node = parseAnd()
    while (peek().type === 'ident' && peek().value.toUpperCase() === 'OR') {
      next()
      node = { type: 'binary', op: 'OR', left: node, right: parseAnd() }
    }
    return node
  }

  const parseAnd = (): FormulaNode => {
    let node = parseComparison()
    while (peek().type === 'ident' && peek().value.toUpperCase() === 'AND') {
      next()
      node = { type: 'binary', op: 'AND', left: node, right: parseComparison() }
    }
    return node
  }

  const parseComparison = (): FormulaNode => {
    const left = parseAdditive()
    const token = peek()
    if (token.type === 'op' && ['=', '==', '!=', '<>', '>', '>=', '<', '<='].includes(token.value)) {
      next()
      return { type: 'binary', op: token.value, left, right: parseAdditive() }
    }
    return left
  }

  const parseAdditive = (): FormulaNode => {
    let node = parseMultiplicative()
    while (peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value
      node = { type: 'binary', op, left: node, right: parseMultiplicative() }
    }
    return node
  }

  const parseMultiplicative = (): FormulaNode => {
    let node = parseUnary()
    while (peek().type === 'op' && ['*', '/', '%'].includes(peek().value)) {
      const op = next().value
      node = { type: 'binary', op, left: node, right: parseUnary() }
    }
    return node
  }

  const parseUnary = (): FormulaNode => {
    const token = peek()
    if (token.type === 'op' && token.value === '-') {
      next()
      return { type: 'unary', op: '-', operand: parseUnary() }
    }
    if (token.type === 'ident' && token.value.toUpperCase() === 'NOT') {
      next()
      return { type: 'unary', op: 'NOT', operand: parseUnary() }
    }
    return parseAtom()
  }

  const parseAtom = (): FormulaNode => {
    const token = next()

    if (token.type === 'num') {
      return { type: 'num', value: Number(token.value) }
    }
    if (token.type === 'str') {
      return { type: 'str', value: token.value }
    }
    if (token.type === 'field') {
      if (token.value.includes('.')) {
        const [sub, field] = token.value.split('.')
        subFields.add(token.value)
        return { type: 'subfield', sub, field }
      }
      fields.add(token.value)
      return { type: 'field', name: token.value }
    }
    if (token.type === 'lparen') {
      const node = parseExpression()
      expect('rparen', '缺少右括号')
      return node
    }
    if (token.type === 'ident') {
      const upper = token.value.toUpperCase()
      if (upper === 'TRUE' || upper === 'FALSE') {
        return { type: 'bool', value: upper === 'TRUE' }
      }
      if (!(upper in FUNCTIONS)) {
        throw new ParseError(
          `不支持的函数「${token.value}」。可用函数：${Object.keys(FUNCTIONS).join('、')}`,
          token.pos
        )
      }
      expect('lparen', `函数 ${upper} 后面要跟左括号`)
      const args: FormulaNode[] = []
      if (peek().type !== 'rparen') {
        args.push(parseExpression())
        while (peek().type === 'comma') {
          next()
          args.push(parseExpression())
        }
      }
      expect('rparen', `函数 ${upper} 缺少右括号`)

      // 参数个数校验放在解析期，而不是等求值时静默返回 null
      const allowed = FUNCTIONS[upper]
      if (allowed && !allowed.includes(args.length)) {
        throw new ParseError(
          `函数 ${upper} 需要 ${allowed.join(' 或 ')} 个参数，实际给了 ${args.length} 个`,
          token.pos
        )
      }
      // 子表字段只能出现在聚合函数的参数位置：其它地方拿到的是一整个数组，
      // 参与算术没有意义，放过去只会算出 null 让用户困惑
      for (const arg of args) {
        if (arg.type === 'subfield' && !AGGREGATE_FUNCTIONS.has(upper)) {
          throw new ParseError(
            `子表字段「${arg.sub}.${arg.field}」只能用在聚合函数里（${[...AGGREGATE_FUNCTIONS].join('、')}）`,
            token.pos
          )
        }
      }
      if (AGGREGATE_FUNCTIONS.has(upper) && args.length === 1 && args[0].type === 'subfield') {
        return { type: 'call', name: upper, args }
      }
      if (['SUM', 'AVG', 'COUNT'].includes(upper)) {
        throw new ParseError(`${upper} 的参数必须是子表字段，写法如 ${upper}({明细.金额})`, token.pos)
      }
      return { type: 'call', name: upper, args }
    }

    throw new ParseError(`这里应该是一个值或函数，实际是「${token.value || '表达式结束'}」`, token.pos)
  }

  try {
    const ast = parseExpression()
    const trailing = peek()
    if (trailing.type !== 'eof') {
      throw new ParseError(`表达式末尾有多余内容「${trailing.value}」`, trailing.pos)
    }
    // 解析完再走一遍树检查子表字段的位置。
    // 不能只在函数参数位置检查 —— 裸写 {明细.金额} + 1 根本不经过那里，
    // 会被放过去然后在求值时静默算成 null，用户只看到结果不对却没有任何提示
    assertSubfieldsOnlyInAggregates(ast)
    return { ok: true, ast, fields: [...fields], subFields: [...subFields] }
  } catch (e) {
    const err = e as ParseError
    return {
      ok: false,
      error: err.message,
      position: err.position,
      fields: [...fields],
      subFields: [...subFields]
    }
  }
}

/**
 * 校验子表字段只出现在聚合函数的直接参数位置
 *
 * 其它位置拿到的是一整个数组，参与算术没有意义。放过去只会算出 null，
 * 而用户看到的是「公式保存成功但结果是空的」，很难反推到写法上。
 */
const assertSubfieldsOnlyInAggregates = (node: FormulaNode | undefined) => {
  const walk = (current: FormulaNode | undefined, insideAggregate: boolean) => {
    if (!current) return
    if (current.type === 'subfield') {
      if (!insideAggregate) {
        throw new ParseError(
          `子表字段「${current.sub}.${current.field}」只能用在聚合函数里（${[...AGGREGATE_FUNCTIONS].join('、')}）`,
          0
        )
      }
      return
    }
    if (current.type === 'call') {
      const isAgg = AGGREGATE_FUNCTIONS.has((current.name ?? '').toUpperCase())
      // 只有【直接】参数算在聚合上下文里：SUM(ROUND({明细.金额})) 中的子表字段
      // 其实是 ROUND 的参数，那里同样拿不到数组，所以不放过
      for (const arg of current.args ?? []) {
        walk(arg, isAgg && arg.type === 'subfield')
      }
      return
    }
    walk(current.operand, false)
    walk(current.left, false)
    walk(current.right, false)
  }
  walk(node, false)
}

/** 可用函数清单，供编辑器展示提示 */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS)
