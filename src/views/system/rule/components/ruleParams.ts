/**
 * 权限规则「模板参数」的纯逻辑核心：向导状态 ⇄ params JSON 的序列化/解析、校验、白话预览、列表摘要。
 *
 * 不依赖 Vue，可被 vitest 直接测（见 ruleParams.spec.ts）。
 *
 * ⚠️ 这里的 params 契约必须与后端 DataRowFilterResolver.expandBuiltInTemplate 逐字对齐：
 *   STATUS_IN→{allowedStatuses:[]} DEPT_IN→{deptIds:[]} FIELD_EQUALS→{field,value}
 *   CUSTOM_TREE→{conditionTree:ConditionNode}；其余模板无参数。
 */
import type { RuleTemplateMetaVO } from '@/api/system/grant'

// ===== 模板代码（与后端 RuleTemplateEnum 一致）=====
export const TPL = {
  OWNER_ONLY: 'BUILT_IN_OWNER_ONLY',
  DEPT_ONLY: 'BUILT_IN_DEPT_ONLY',
  DEPT_AND_CHILDREN: 'BUILT_IN_DEPT_AND_CHILDREN',
  STATUS_IN: 'BUILT_IN_STATUS_IN',
  OWNER_OR_DEPT: 'BUILT_IN_OWNER_OR_DEPT',
  BPM_PARTICIPANT: 'BUILT_IN_BPM_PARTICIPANT',
  RECORD_SHARED: 'BUILT_IN_RECORD_SHARED',
  FIELD_EQUALS: 'BUILT_IN_FIELD_EQUALS',
  DEPT_IN: 'BUILT_IN_DEPT_IN',
  CUSTOM_TREE: 'BUILT_IN_CUSTOM_TREE'
} as const

// ===== params 的 key（与后端 RuleTemplateMetaRegistry.PARAM_* 一致）=====
export const PARAM_KEY = {
  allowedStatuses: 'allowedStatuses',
  deptIds: 'deptIds',
  field: 'field',
  value: 'value',
  conditionTree: 'conditionTree'
} as const

/** 条件树最大深度，防止无节制嵌套（后端求值器无深度保护） */
export const MAX_TREE_DEPTH = 5

// ===== 条件树模型（镜像后端 ConditionNode）=====
export interface ConditionGroupModel {
  type: 'GROUP'
  logic: 'AND' | 'OR'
  children: ConditionNodeModel[]
}
export interface ConditionLeafModel {
  type: 'CONDITION'
  slot: string
  operator: string
  /** 字面量原文，或以 : 开头的变量引用；一元操作符时省略 */
  value?: string
}
export type ConditionNodeModel = ConditionGroupModel | ConditionLeafModel

// ===== 向导内部状态 =====
/**
 * 用「单接口 + 可选字段」而非判别联合：判别联合里 `{ template: string }` 兜底项
 * 与每个字面量 template 都重叠，switch(template) 无法收窄，访问 allowedStatuses 等会报错。
 * 各序列化/校验函数按 template 分支时，用 `?? 默认值` 取对应字段即可。
 */
export interface WizardState {
  template: string
  allowedStatuses?: string[]
  deptIds?: number[]
  field?: string
  value?: string
  conditionTree?: ConditionNodeModel
}

export type ParseResult = { ok: true; state: WizardState } | { ok: false; error: string }

/** 需要参数的 4 个模板 */
const PARAM_TEMPLATES = new Set<string>([
  TPL.STATUS_IN,
  TPL.DEPT_IN,
  TPL.FIELD_EQUALS,
  TPL.CUSTOM_TREE
])
/** 全部 10 个内置模板（用于识别「自定义代码」→ 强制 JSON 模式） */
const KNOWN_TEMPLATES = new Set<string>(Object.values(TPL))

export const isKnownTemplate = (code: string) => KNOWN_TEMPLATES.has(code)
export const isParamTemplate = (code: string) => PARAM_TEMPLATES.has(code)

/** 某模板的默认空状态 */
export function emptyState(template: string): WizardState {
  switch (template) {
    case TPL.STATUS_IN:
      return { template, allowedStatuses: [] }
    case TPL.DEPT_IN:
      return { template, deptIds: [] }
    case TPL.FIELD_EQUALS:
      return { template, field: '', value: '' }
    case TPL.CUSTOM_TREE:
      return { template, conditionTree: { type: 'GROUP', logic: 'AND', children: [] } }
    default:
      return { template }
  }
}

const isBlankJson = (params?: string | null) => {
  if (params == null) return true
  const t = params.trim()
  return t === '' || t === '{}'
}

/** 数字串转 number，其余原样字符串；空串丢弃 */
function coerceStatus(raw: string): string | number | null {
  const t = String(raw).trim()
  if (t === '') return null
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t
}

/**
 * 向导状态 → params JSON 字符串。无参数（或尚未填写）返回 ''。
 */
export function serializeParams(state: WizardState): string {
  switch (state.template) {
    case TPL.STATUS_IN: {
      const arr = (state.allowedStatuses ?? [])
        .map(coerceStatus)
        .filter((x): x is string | number => x !== null)
      return arr.length ? JSON.stringify({ [PARAM_KEY.allowedStatuses]: arr }) : ''
    }
    case TPL.DEPT_IN: {
      const arr = (state.deptIds ?? []).filter((x) => typeof x === 'number' && !Number.isNaN(x))
      return arr.length ? JSON.stringify({ [PARAM_KEY.deptIds]: arr }) : ''
    }
    case TPL.FIELD_EQUALS: {
      const field = state.field ?? ''
      const value = state.value ?? ''
      if (!field && !value) return ''
      return JSON.stringify({ [PARAM_KEY.field]: field, [PARAM_KEY.value]: value })
    }
    case TPL.CUSTOM_TREE:
      return JSON.stringify({ [PARAM_KEY.conditionTree]: state.conditionTree })
    default:
      return ''
  }
}

/** 递归校验条件树结构；返回错误文案或 null */
function validateNodeStructure(node: any, depth: number): string | null {
  if (depth > MAX_TREE_DEPTH) return `条件树嵌套不能超过 ${MAX_TREE_DEPTH} 层`
  if (!node || typeof node !== 'object') return '条件节点格式不正确'
  if (node.type === 'GROUP') {
    if (node.logic !== 'AND' && node.logic !== 'OR') return '条件组的逻辑只能是 AND / OR'
    if (!Array.isArray(node.children)) return '条件组缺少 children'
    for (const c of node.children) {
      const err = validateNodeStructure(c, depth + 1)
      if (err) return err
    }
    return null
  }
  if (node.type === 'CONDITION') {
    if (!node.slot) return '存在未选择字段的条件'
    if (!node.operator) return '存在未选择操作符的条件'
    return null
  }
  return '未知的条件节点类型'
}

/**
 * params JSON 字符串 → 向导状态。解析失败返回 {ok:false}，调用方应保留在 JSON 模式。
 */
export function parseParams(code: string, params?: string | null): ParseResult {
  if (!isKnownTemplate(code)) {
    return { ok: false, error: '该模板不支持向导编辑，请使用 JSON 模式' }
  }
  if (!isParamTemplate(code)) {
    // 无参数模板：忽略任何已存 params（后端本就不读）
    return { ok: true, state: emptyState(code) }
  }
  if (isBlankJson(params)) {
    return { ok: true, state: emptyState(code) }
  }

  let obj: any
  try {
    obj = JSON.parse(params as string)
  } catch {
    return { ok: false, error: '参数不是合法的 JSON' }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: '参数应为 JSON 对象' }
  }

  switch (code) {
    case TPL.STATUS_IN: {
      const raw = obj[PARAM_KEY.allowedStatuses]
      if (!Array.isArray(raw)) return { ok: false, error: '缺少 allowedStatuses 数组' }
      return { ok: true, state: { template: TPL.STATUS_IN, allowedStatuses: raw.map((x) => String(x)) } }
    }
    case TPL.DEPT_IN: {
      const raw = obj[PARAM_KEY.deptIds]
      if (!Array.isArray(raw)) return { ok: false, error: '缺少 deptIds 数组' }
      const ids = raw.map((x) => Number(x))
      if (ids.some((x) => Number.isNaN(x))) return { ok: false, error: 'deptIds 含非数字' }
      return { ok: true, state: { template: TPL.DEPT_IN, deptIds: ids } }
    }
    case TPL.FIELD_EQUALS: {
      const field = obj[PARAM_KEY.field]
      if (typeof field !== 'string') return { ok: false, error: '缺少 field 字符串' }
      const value = obj[PARAM_KEY.value]
      return {
        ok: true,
        state: {
          template: TPL.FIELD_EQUALS,
          field,
          value: value == null ? '' : String(value)
        }
      }
    }
    case TPL.CUSTOM_TREE: {
      const tree = obj[PARAM_KEY.conditionTree]
      if (!tree) return { ok: false, error: '缺少 conditionTree' }
      const err = validateNodeStructure(tree, 1)
      if (err) return { ok: false, error: err }
      return { ok: true, state: { template: TPL.CUSTOM_TREE, conditionTree: tree as ConditionNodeModel } }
    }
    default:
      return { ok: true, state: emptyState(code) }
  }
}

/** 统计条件树里的叶子条件数 */
export function countConditions(node?: ConditionNodeModel): number {
  if (!node) return 0
  if (node.type === 'CONDITION') return 1
  return node.children.reduce((sum, c) => sum + countConditions(c), 0)
}

/**
 * 校验向导状态；返回错误文案或 null（通过）。
 * 空参数会让后端跳过该规则 → 行过滤反而变宽（TODO #28），所以必填项为空一律拦截。
 */
export function validateState(state: WizardState, meta: RuleTemplateMetaVO): string | null {
  switch (state.template) {
    case TPL.STATUS_IN: {
      const arr = (state.allowedStatuses ?? []).map((x) => x.trim()).filter((x) => x !== '')
      if (arr.length === 0) return '请至少填写一个状态值'
      return null
    }
    case TPL.DEPT_IN:
      if ((state.deptIds ?? []).length === 0) return '请至少选择一个部门'
      return null
    case TPL.FIELD_EQUALS: {
      if (!state.field) return '请选择字段（槽位）'
      if (String(state.value ?? '').trim() === '') return '请填写字段值'
      return null
    }
    case TPL.CUSTOM_TREE: {
      const tree = state.conditionTree
      if (!tree || countConditions(tree) === 0) return '条件树至少要有一个条件'
      const err = validateTreeValues(tree, meta)
      if (err) return err
      return validateNodeStructure(tree, 1)
    }
    default:
      return null
  }
}

/** 校验条件树里每个 CONDITION 的值是否符合操作符要求 */
function validateTreeValues(node: ConditionNodeModel, meta: RuleTemplateMetaVO): string | null {
  if (node.type === 'GROUP') {
    for (const c of node.children) {
      const err = validateTreeValues(c, meta)
      if (err) return err
    }
    return null
  }
  const op = meta.operators.find((o) => o.code === node.operator)
  if (op?.unary) return null // 无需值
  const value = node.value
  if (value == null || String(value).trim() === '') {
    return `字段「${node.slot}」的条件缺少值`
  }
  if (op?.multiValue) {
    // IN / NOT_IN 的值必须是集合变量（字面量会被求值器当成单元素字符串）
    const varName = value.startsWith(':') ? value.slice(1) : null
    const variable = varName ? meta.variables.find((v) => v.name === varName) : null
    if (!variable?.collection) {
      return `「属于/不属于」的值必须是集合变量（如 当前部门及下级），字段「${node.slot}」不满足`
    }
  }
  return null
}

const slotLabel = (slot: string, meta: RuleTemplateMetaVO) => {
  const s = meta.slots.find((x) => x.slot === slot)
  return s ? `${slot}（${s.description}）` : slot
}
const opLabel = (code: string, meta: RuleTemplateMetaVO) =>
  meta.operators.find((o) => o.code === code)?.label ?? code
const varLabel = (name: string, meta: RuleTemplateMetaVO) =>
  meta.variables.find((v) => v.name === name)?.label ?? name

/** 递归生成条件树的白话描述 */
export function describeNode(node: ConditionNodeModel, meta: RuleTemplateMetaVO): string {
  if (node.type === 'CONDITION') {
    const op = meta.operators.find((o) => o.code === node.operator)
    const left = slotLabel(node.slot, meta)
    if (op?.unary) return `${left} ${opLabel(node.operator, meta)}`
    let right = node.value ?? ''
    if (right.startsWith(':')) right = varLabel(right.slice(1), meta)
    else right = `"${right}"`
    return `${left} ${opLabel(node.operator, meta)} ${right}`
  }
  if (node.children.length === 0) return '（空条件组）'
  const joiner = node.logic === 'AND' ? ' 并且 ' : ' 或者 '
  const parts = node.children.map((c) => describeNode(c, meta))
  return node.children.length > 1 ? `（${parts.join(joiner)}）` : parts[0]
}

/** 生成整条规则的白话预览 */
export function describeState(state: WizardState, meta: RuleTemplateMetaVO): string {
  const tpl = meta.templates.find((t) => t.code === state.template)
  const name = tpl?.displayName ?? state.template
  switch (state.template) {
    case TPL.STATUS_IN: {
      const arr = (state.allowedStatuses ?? []).map((x) => x.trim()).filter((x) => x !== '')
      if (!arr.length) return `「${name}」：请填写允许的状态值`
      return `状态属于 [${arr.join(', ')}] 的记录可见`
    }
    case TPL.DEPT_IN: {
      const ids = state.deptIds ?? []
      if (!ids.length) return `「${name}」：请选择部门`
      return `指定 ${ids.length} 个部门的记录可见（并自动包含本人所在部门）`
    }
    case TPL.FIELD_EQUALS:
      if (!state.field) return `「${name}」：请选择字段`
      return `字段 ${slotLabel(state.field, meta)} 等于 "${state.value ?? ''}" 的记录可见`
    case TPL.CUSTOM_TREE: {
      const tree = state.conditionTree
      if (!tree || countConditions(tree) === 0) return `「${name}」：请添加条件`
      return `满足以下条件的记录可见：${describeNode(tree, meta)}`
    }
    default:
      return `「${name}」：无需参数`
  }
}

/**
 * 列表页「参数」列的摘要。解析失败时回退为原始字符串（截断由 UI 的 tooltip 承担）。
 */
export function summarizeParams(code: string, params: string | undefined, _meta: RuleTemplateMetaVO): string {
  if (!isParamTemplate(code)) return '无参数'
  if (isBlankJson(params)) return '未配置'
  const parsed = parseParams(code, params)
  if (!parsed.ok) return params as string
  const state = parsed.state
  switch (state.template) {
    case TPL.STATUS_IN:
      return `允许状态：${(state.allowedStatuses ?? []).join(', ')}`
    case TPL.DEPT_IN:
      return `指定部门 ×${(state.deptIds ?? []).length}`
    case TPL.FIELD_EQUALS:
      return `${state.field ?? ''} = ${state.value ?? ''}`
    case TPL.CUSTOM_TREE:
      return `条件树：${countConditions(state.conditionTree)} 个条件`
    default:
      return params as string
  }
}
