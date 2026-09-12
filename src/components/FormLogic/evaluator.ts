/**
 * 联动规则求值器（前端）
 *
 * 与后端 `LogicRuleEvaluator.java` 是同一套语义的两份实现，一致性由
 * logic-cases.json 保证：前端 Vitest 与后端 JUnit 读同一份用例各跑一遍。
 *
 * ## 为什么要两份实现
 *
 * 前端这份负责录入时的即时反馈 —— 改一个值，相关字段立刻显隐、必填状态立刻变化。
 * 后端那份是权威：提交时重算一遍，据此丢弃只读字段的提交值、拒绝必填字段的空值。
 * 只有前端的话，构造一个请求就能绕过全部联动约束。
 *
 * 两边不一致会表现为「界面上填完了但提交被拒」或反过来「该拦的没拦住」，
 * 都是很难查的问题，所以每一条比较原语都有共享用例钉住。
 */
import type {
  ConditionGroup,
  ConditionNode,
  EvaluationResult,
  FieldState,
  LogicAction,
  LogicRule,
  LogicTrigger
} from './types'

/**
 * 不动点迭代的最大轮数
 *
 * ⚠️ 必须与后端 LogicRuleEvaluator.MAX_PASSES 一致（用例集里的 maxPasses 会校验）。
 * 两边轮数不同会让「刚好在第 N 轮收敛」的规则集在一侧算出结果、另一侧算不出。
 */
export const MAX_PASSES = 10

const KNOWN_OPERATORS = new Set([
  'EQ',
  'NE',
  'GT',
  'GE',
  'LT',
  'LE',
  'IN',
  'NOT_IN',
  'CONTAINS',
  'NOT_CONTAINS',
  'STARTS_WITH',
  'ENDS_WITH',
  'EMPTY',
  'NOT_EMPTY',
  'BETWEEN'
])

const KNOWN_ACTIONS = new Set([
  'SHOW',
  'HIDE',
  'ENABLE',
  'DISABLE',
  'READONLY',
  'EDITABLE',
  'REQUIRE',
  'OPTIONAL',
  'SET_VALUE',
  'CLEAR_VALUE'
])

const defaultState = (): FieldState => ({ visible: true, editable: true, required: false })

// ==================== 比较原语 ====================
//
// 这些原语的行为必须与后端逐条对齐。特别是「表单值几乎总是字符串」这一点：
// 数字输入框的值可能是 "3" 而不是 3，严格相等会让所有数值条件失效，所以 EQ 走宽松比较。

const asString = (value: any): string => (value === null || value === undefined ? '' : String(value))

/** 转数字；转不动返回 undefined */
const toNumber = (value: any): number | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : value
  if (typeof value === 'boolean') return undefined
  const s = String(value).trim()
  if (s === '') return undefined
  const n = Number(s)
  return Number.isNaN(n) ? undefined : n
}

const toArray = (value: any): any[] | undefined => (Array.isArray(value) ? value : undefined)

/** 是否为空。空串、空数组、null/undefined 都算空；数字 0 与 false 【不】算空 */
export const isEmptyValue = (value: any): boolean => {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.length === 0
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

/**
 * 宽松相等
 *
 * 两边都能转成数字时按数值比，否则按字符串比。这样 "3" 与 3 相等。
 */
export const looseEquals = (left: any, right: any): boolean => {
  const leftNil = left === null || left === undefined
  const rightNil = right === null || right === undefined
  if (leftNil || rightNil) return leftNil && rightNil
  const ln = toNumber(left)
  const rn = toNumber(right)
  if (ln !== undefined && rn !== undefined) return ln === rn
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return asString(left).toLowerCase() === asString(right).toLowerCase()
  }
  return asString(left) === asString(right)
}

/**
 * 按字典序比较文本；不适用返回 undefined
 *
 * 为什么需要它：「结束日期 ≥ 开始日期」是最常见的跨字段约束，而日期控件的值是
 * 字符串（'2026-09-10'），两边都转不成数字。只按数值比较的话，这条约束在任何
 * 一对日期上都判为不满足 —— 表现为「配了区间校验，正常填的日期也被拦下」。
 *
 * 为什么字典序对日期是对的：日期/时间控件产出 ISO 格式（yyyy-MM-dd），定宽、
 * 高位在前，字典序与时间先后一致。**前提是 ISO 格式** —— 换成 '2026/9/1'
 * 这类不定宽格式，字典序会给出错误结果（'2026/9/1' > '2026/10/1'）。
 *
 * 为什么限定两边都是字符串：一侧数字一侧文本仍判为不可比较（混合比较没有正确答案，
 * 共享用例里「非数值参与数值比较判为不满足」钉的正是这种情况）；布尔值排除在外，
 * `true > false` 不是任何人想表达的意思。
 *
 * ⚠️ 必须与后端 LogicRuleEvaluator#compareAsText 保持一致。
 * Java 的 String.compareTo 与 JS 的 `<` 都按 UTF-16 码元顺序比较，两端结果一致。
 */
const compareAsText = (left: any, right: any): number | undefined => {
  if (typeof left !== 'string' || typeof right !== 'string') return undefined
  // 空串不参与大小比较：空的结束日期不该被判成「早于任何开始日期」，
  // 那会让一个还没填完的表单被区间校验拦下。空值的语义由 EMPTY / 必填管
  if (left === '' || right === '') return undefined
  return left === right ? 0 : left > right ? 1 : -1
}

/**
 * 比较，用于 GT / GE
 *
 * 两边都是数字时按数值比；两边都是文本时按字典序比。
 * 其余情况返回 -1（即「不大于」），使 GT/GE 判为不满足。
 */
const compare = (left: any, right: any): number => {
  const ln = toNumber(left)
  const rn = toNumber(right)
  if (ln !== undefined && rn !== undefined) return ln === rn ? 0 : ln > rn ? 1 : -1
  const byText = compareAsText(left, right)
  return byText !== undefined ? byText : -1
}

/**
 * 比较，用于 LT / LE
 *
 * 与 compare 的区别只在「无法比较时返回什么」：LT/LE 若也返回 -1 就会变成
 * 「不是数字反而判为满足」，方向正好错了。所以返回 1（即「不小于」）。
 * 这个细节两端必须一致，共享用例里有钉住。
 */
const compareStrict = (left: any, right: any): number => {
  const ln = toNumber(left)
  const rn = toNumber(right)
  if (ln !== undefined && rn !== undefined) return ln === rn ? 0 : ln > rn ? 1 : -1
  const byText = compareAsText(left, right)
  return byText !== undefined ? byText : 1
}

const containsValue = (collection: any[] | undefined, target: any): boolean => {
  if (!collection) return false
  return collection.some((item) => looseEquals(item, target))
}

/** left 是否包含 right。left 是数组时判成员，是字符串时判子串 */
const containsOp = (left: any, right: any): boolean => {
  if (left === null || left === undefined) return false
  const arr = toArray(left)
  if (arr) return containsValue(arr, right)
  return asString(left).includes(asString(right))
}

/** BETWEEN，闭区间。右值必须是长度 >= 2 的数组 */
const betweenOp = (left: any, right: any): boolean => {
  const range = toArray(right)
  if (!range || range.length < 2) return false
  return compare(left, range[0]) >= 0 && compareStrict(left, range[1]) <= 0
}

// ==================== 条件求值 ====================

const resolveValueType = (raw?: string): 'CONST' | 'FIELD' => {
  if (!raw) return 'CONST'
  const upper = raw.toUpperCase()
  // 写错了按常量处理，而不是让整条规则报错
  return upper === 'FIELD' ? 'FIELD' : 'CONST'
}

const isGroupNode = (node: ConditionNode): boolean =>
  node.logic !== undefined || node.items !== undefined

const matchesCondition = (node: ConditionNode, data: Record<string, any>): boolean => {
  const operator = node.operator ? node.operator.toUpperCase() : ''
  if (!KNOWN_OPERATORS.has(operator)) {
    // 操作符识别不出来按不满足处理。不抛异常：规则可能是旧版本写的，
    // 让整个表单打不开的代价远大于少生效一条规则
    return false
  }
  const left = data ? data[node.field as string] : undefined
  const right =
    resolveValueType(node.valueType) === 'FIELD'
      ? data
        ? data[asString(node.value)]
        : undefined
      : node.value

  switch (operator) {
    case 'EMPTY':
      return isEmptyValue(left)
    case 'NOT_EMPTY':
      return !isEmptyValue(left)
    case 'EQ':
      return looseEquals(left, right)
    case 'NE':
      return !looseEquals(left, right)
    case 'GT':
      return compare(left, right) > 0
    case 'GE':
      return compare(left, right) >= 0
    case 'LT':
      return compareStrict(left, right) < 0
    case 'LE':
      return compareStrict(left, right) <= 0
    case 'IN':
      return containsValue(toArray(right), left)
    case 'NOT_IN':
      return !containsValue(toArray(right), left)
    case 'CONTAINS':
      return containsOp(left, right)
    case 'NOT_CONTAINS':
      return !containsOp(left, right)
    case 'STARTS_WITH':
      return asString(left).startsWith(asString(right))
    case 'ENDS_WITH':
      return asString(left).endsWith(asString(right))
    case 'BETWEEN':
      return betweenOp(left, right)
    default:
      return false
  }
}

/** 条件组是否满足。为空视为恒真 */
export const matchesGroup = (
  group: ConditionGroup | null | undefined,
  data: Record<string, any>
): boolean => {
  const items = group?.items
  if (!group || !items || items.length === 0) return true
  const and = (group.logic ?? 'AND') === 'AND'
  for (const node of items) {
    if (!node) continue
    const hit = isGroupNode(node)
      ? matchesGroup({ logic: node.logic, items: node.items }, data)
      : matchesCondition(node, data)
    if (and && !hit) return false
    if (!and && hit) return true
  }
  // AND 走到这里说明全都满足；OR 走到这里说明没有一项满足
  return and
}

// ==================== 动作执行 ====================

const applyAction = (
  action: LogicAction,
  state: Record<string, FieldState>,
  data: Record<string, any>
) => {
  if (!action) return
  const type = action.type ? action.type.toUpperCase() : ''
  if (!KNOWN_ACTIONS.has(type) || !action.target) {
    // 类型识别不出来或没有目标字段，忽略这一条，其余动作照常执行。
    // 整条规则作废会让用户更难发现是哪个动作配错了
    return
  }
  const target = action.target
  if (!state[target]) state[target] = defaultState()
  const fieldState = state[target]

  switch (type) {
    case 'SHOW':
      fieldState.visible = true
      break
    case 'HIDE':
      fieldState.visible = false
      // 隐藏的同时收掉可编辑性。只置 visible=false 的话，服务端复校验时该字段
      // 仍被视为可写，构造请求就能给隐藏字段塞值 —— 那正是「前端隐藏不等于服务端放行」要防的事
      fieldState.editable = false
      break
    case 'ENABLE':
    case 'EDITABLE':
      fieldState.editable = true
      break
    case 'DISABLE':
    case 'READONLY':
      fieldState.editable = false
      break
    case 'REQUIRE':
      fieldState.required = true
      break
    case 'OPTIONAL':
      fieldState.required = false
      break
    case 'SET_VALUE':
      data[target] = action.payload ? action.payload.value : undefined
      break
    case 'CLEAR_VALUE':
      data[target] = null
      break
  }
}

// ==================== 主流程 ====================

const cloneBaseState = (baseState?: Record<string, FieldState>): Record<string, FieldState> => {
  const result: Record<string, FieldState> = {}
  if (baseState) {
    for (const [field, s] of Object.entries(baseState)) {
      result[field] = s ? { ...s } : defaultState()
    }
  }
  return result
}

const stateEquals = (a: Record<string, FieldState>, b: Record<string, FieldState>): boolean => {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every((k) => {
    const x = a[k]
    const y = b[k]
    return !!y && x.visible === y.visible && x.editable === y.editable && x.required === y.required
  })
}

/**
 * 数据是否相等
 *
 * 用 JSON 序列化比较：规则赋的值是普通标量或数组，没有函数与循环引用。
 * 键序会影响结果，但工作数据是同一个对象逐轮修改而来，键的插入顺序稳定。
 */
const dataEquals = (a: Record<string, any>, b: Record<string, any>): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * 求值
 *
 * @param rules     规则列表
 * @param trigger   本次的触发时机
 * @param data      表单数据。【不会】被修改，赋值结果在返回值里
 * @param baseState 字段基础状态（visible/editable 默认 true，required 取自控件的 $required）
 */
export const evaluateLogicRules = (
  rules: LogicRule[] | null | undefined,
  trigger: LogicTrigger,
  data: Record<string, any>,
  baseState?: Record<string, FieldState>
): EvaluationResult => {
  const workingData: Record<string, any> = data ? { ...data } : {}
  let workingState = cloneBaseState(baseState)

  const applicable = (rules ?? []).filter(
    (rule) =>
      !!rule && rule.enabled !== false && (!trigger || !rule.trigger || rule.trigger === trigger)
  )
  if (applicable.length === 0) {
    return { state: workingState, data: workingData, stable: true, passes: 0 }
  }

  let stable = false
  let passes = 0
  for (let i = 0; i < MAX_PASSES; i++) {
    passes = i + 1
    const dataBefore = { ...workingData }
    const stateBefore = cloneBaseState(workingState)

    // 每一轮都从基础状态重算，而不是在上一轮结果上累加。否则「条件从满足变回不满足」时，
    // 上一轮设的状态会残留下来 —— 那正是 otherwise 分支要解决的问题，
    // 不能在迭代实现上又把它引回来
    workingState = cloneBaseState(baseState)
    for (const rule of applicable) {
      const matched = matchesGroup(rule.when, workingData)
      const actions = matched ? (rule.then ?? []) : (rule.otherwise ?? [])
      for (const action of actions) {
        applyAction(action, workingState, workingData)
      }
    }

    if (dataEquals(dataBefore, workingData) && stateEquals(stateBefore, workingState)) {
      stable = true
      break
    }
  }

  if (!stable) {
    // 不抛异常：一条配歪的规则不该让整个录入流程卡死
    console.warn(
      `[FormLogic] 联动规则在 ${MAX_PASSES} 轮内没有收敛，可能存在环形赋值。trigger=${trigger}`
    )
  }
  return { state: workingState, data: workingData, stable, passes }
}

/** 取某字段的状态，没有记录时返回默认状态 */
export const stateOf = (result: EvaluationResult, field: string): FieldState =>
  result.state[field] ?? defaultState()
