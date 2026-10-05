/**
 * 可视化编辑器的纯逻辑模型（增量14d / P4 可视化编辑器首刀）
 *
 * 🔴 与 layout.ts 同款纪律：纯函数、不依赖 Vue 运行时，便于 vitest 单测（见 editorModel.spec.ts）。
 * 本模块只操作「已 JSON.parse 的 DSL 对象」的 nodes/edges 两个数组，<b>就地增删</b>——
 * 其余字段（id/name/trigger/variables/settings…）原样保留，故画布编辑绝不会丢 DSL 的非图形部分。
 *
 * 🔴 往返保真是本编辑器的命门：DSL 是事实源，Vue Flow 图只是它的视图。增删节点/边都直接改 DSL 数组，
 * 而不是「从图重建 DSL」（后者极易丢条件边的 cases、丢未知字段）。删除节点时会连带清理指向它的边
 * （含条件边的对应 case），避免留下悬空引用让后端编译期报「边指向不存在的节点」。
 */

import { WAIT_TYPE } from './nodeConfigSchema'
import { NODE_TYPE_META, nodeTypeMeta, type SummaryTagType } from './nodeSummary'

/** DSL 节点（编辑器关心 id/type/name/config，其余字段原样保留） */
export interface EditorDslNode {
  id: string
  type?: string
  name?: string
  config?: Record<string, any>
  /** 前端专属的持久化画布坐标（后端 NodeDTO @JsonIgnoreProperties 忽略未知字段，读写安全） */
  position?: { x: number; y: number }
  [k: string]: any
}

/** DSL 边：普通边 from→to；条件边用 cases（路由键→目标）+ default */
export interface EditorDslEdge {
  from: string
  to?: string
  type?: string
  cases?: Record<string, string>
  default?: string
  [k: string]: any
}

/** 一份 DSL（编辑器只保证 nodes/edges 存在，其余透传） */
export interface EditorDsl {
  nodes?: EditorDslNode[]
  edges?: EditorDslEdge[]
  [k: string]: any
}

export type EditorTagType = SummaryTagType

export interface NodeTypeOption {
  value: string
  label: string
  tagType: EditorTagType
}

/**
 * 可拖入的节点类型目录。
 * 🔴 权威来源是 nodeSummary 的 {@link NODE_TYPE_META}（13 种 = 10 个 NodeExecutor + 3 个编译器合成子图类型），
 * 这里派生成编辑器要的 {value,label,tagType} 形状，保证聊天卡片/画布/编辑器三处叫法与颜色一致。
 * 目录里放一个后端没有执行器/编译器的 type，作者拖出来发布了也会在编译期报错——增删类型请改 NODE_TYPE_META。
 */
export const NODE_TYPE_OPTIONS: NodeTypeOption[] = Object.entries(NODE_TYPE_META).map(
  ([value, meta]) => ({ value, label: meta.label, tagType: meta.tagType })
)

/** 条件边「默认分支」在渲染边 data.route 里的哨兵值（与 case 的路由键区分开） */
export const DEFAULT_ROUTE = '__default__'

export const nodeTypeLabel = (type?: string): string => nodeTypeMeta(type).label

export const nodeTypeTag = (type?: string): EditorTagType => nodeTypeMeta(type).tagType

/** 把 type 里的非字母数字（如 condition.llm 的点）换成下划线，作为 id 前缀 */
const idPrefix = (type: string): string => type.replace(/[^a-z0-9]/gi, '_').toLowerCase()

/** 生成一个在 existing 内唯一的节点 id：{类型前缀}_{序号}，如 tool_1 / condition_llm_2 */
export const genNodeId = (type: string, existing: string[]): string => {
  const base = idPrefix(type) || 'node'
  const set = new Set(existing)
  let i = 1
  let id = `${base}_${i}`
  while (set.has(id)) {
    i += 1
    id = `${base}_${i}`
  }
  return id
}

/**
 * 新节点的默认 config。每种类型给一个「键齐全、值为空/安全默认」的骨架——
 * 🔴 键逐字对齐后端各 NodeExecutor / GraphBuilder 实际读取的 config 键（见 nodeConfigSchema.ts 头注释），
 * 不臆造额外键；具体值由作者在配置面板补全（缺必填时画布节点会打红点，见 nodeSummary.nodeHasRequiredGap）。
 */
export const defaultConfig = (type: string): Record<string, any> => {
  if (type === 'tool') return { toolId: '', args: {}, outputVar: '' }
  if (type === 'llm') return { prompt: '', outputVar: '' }
  if (type === 'hitl.bpm_approval')
    return {
      bpmProcessDefKey: '',
      approveVar: 'bpm_approved',
      statusVar: 'bpm_status',
      formVars: {},
      injectManifest: true
    }
  if (type === 'script') return { code: '', language: 'javascript', timeoutMs: 2000, outputVar: '' }
  if (type === 'condition.rule') return { branches: [], default: '' }
  if (type === 'condition.llm') return { prompt: '', choices: [], default: '' }
  if (type === 'knowledge_retrieval') return { knowledgeBaseId: undefined, query: '', topK: 5, outputVar: '' }
  if (type === 'hitl.confirm') return { approveVar: 'hitl_approved' }
  if (type === 'parallel') return { branches: [], join: 'all' }
  // 缺省给 duration 而不是 event：只有 duration 那一档平台自己唤得醒（调度器扫 resume_at），
  // 缺省成 event 会让新建的节点一挂起就等一个还不存在的外部调用方
  if (type === 'wait') return { waitType: WAIT_TYPE.DURATION, duration: 30 }
  if (type === 'agent_loop') return { goal: '', tools: [], maxSteps: 5, outputVar: '' }
  if (type === 'iteration') return { itemsVar: '', itemVar: 'item', body: [] }
  if (type === 'sub_workflow') return { workflowId: '' }
  return { outputVar: '' }
}

/** 往 DSL 加一个新节点，返回其 id。name 默认取类型中文名，作者在面板里改 */
export const addNode = (dsl: EditorDsl, type: string): string => {
  if (!Array.isArray(dsl.nodes)) dsl.nodes = []
  const id = genNodeId(type, dsl.nodes.map((n) => n.id))
  dsl.nodes.push({ id, type, name: nodeTypeLabel(type), config: defaultConfig(type) })
  return id
}

/**
 * 删除节点，并清理所有「指向它」的边引用：
 * from/to/default 命中 → 整条边删；cases 命中 → 只删那个 case（条件边可能还有别的分支）。
 * 删完若一条条件边既无 case 又无 default/to，则它已空 → 整条删，避免留空壳边。
 */
export const removeNode = (dsl: EditorDsl, id: string): void => {
  dsl.nodes = (dsl.nodes ?? []).filter((n) => n.id !== id)
  const kept: EditorDslEdge[] = []
  for (const e of dsl.edges ?? []) {
    if (e.from === id || e.to === id || e.default === id) continue
    if (e.cases) {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(e.cases)) {
        if (v !== id) next[k] = v
      }
      e.cases = next
      if (Object.keys(next).length === 0 && !e.default && !e.to) continue
    }
    kept.push(e)
  }
  dsl.edges = kept
}

/** 连一条普通边 from→to（去重：已存在同样的普通边则不加）。START/END 由调用方传保留字 */
export const addEdge = (dsl: EditorDsl, from: string, to: string): void => {
  if (!Array.isArray(dsl.edges)) dsl.edges = []
  const dup = dsl.edges.some((e) => !e.cases && e.from === from && e.to === to)
  if (!dup) dsl.edges.push({ from, to })
}

const isConditional = (e: EditorDslEdge): boolean =>
  (e.type ?? '').toLowerCase() === 'conditional' || (!!e.cases && Object.keys(e.cases).length > 0)

/**
 * Saga 补偿（设计方案「一之三」/ DSL §6.3）：recovery 与 compensation 是节点<b>顶层</b>字段
 * （与 config 平级，对齐后端 NodeDTO），故不走 nodeConfigSchema（那套只写 config），单独建模。
 */

/**
 * 不可补偿节点类型 —— 逐字对齐后端 {@code WorkflowDslValidator.NON_COMPENSABLE_TYPES}。
 * 模型 token 已耗、检索无副作用，声明补偿不会生效（后端校验会给 warning），设计器里直接打标锁定。
 */
export const NON_COMPENSABLE_NODE_TYPES = ['llm', 'knowledge_retrieval']

export const isNonCompensableType = (type?: string): boolean =>
  !!type && NON_COMPENSABLE_NODE_TYPES.includes(type)

/** 节点级 recovery：'' = 未声明（跟随全局 settings.recovery，默认 forward） */
export const getNodeRecovery = (node: EditorDslNode): '' | 'forward' | 'compensate' =>
  node.recovery === 'compensate' ? 'compensate' : node.recovery === 'forward' ? 'forward' : ''

/**
 * 写节点级 recovery 并维护 compensation 的生命周期：
 * 切到 compensate → 确保 compensation 对象存在（面板字段要有真实引用可写）；
 * 切走 → 整个删掉 compensation（留着会被后端校验 warn「声明不会生效」，也是脏数据）。
 */
export const setNodeRecovery = (node: EditorDslNode, value: '' | 'forward' | 'compensate'): void => {
  if (value) node.recovery = value
  else delete node.recovery
  if (value === 'compensate') {
    if (!node.compensation || typeof node.compensation !== 'object') node.compensation = {}
  } else {
    delete node.compensation
  }
}

/** 取节点的 compensation 对象引用；recovery=compensate 时保证已挂在节点上（面板 v-model 直接写它） */
export const ensureCompensation = (node: EditorDslNode): Record<string, any> => {
  if (!node.compensation || typeof node.compensation !== 'object' || Array.isArray(node.compensation)) {
    node.compensation = {}
  }
  return node.compensation
}

/**
 * 删除一条「渲染边」对应的 DSL 边。route 语义：
 * undefined=普通边（from→to）；{@link DEFAULT_ROUTE}=条件边的 default 分支；其余字符串=条件边的某个 case 路由键。
 * 反向匹配（而非靠下标），因为渲染边是条件边展开后的多条，下标对不上原始 DSL 边。
 */
export const removeEdge = (dsl: EditorDsl, from: string, to: string, route?: string): void => {
  const edges = dsl.edges ?? []
  if (route === DEFAULT_ROUTE) {
    const e = edges.find((x) => x.from === from && x.default === to)
    if (e) {
      delete e.default
      if (isConditional(e) && Object.keys(e.cases ?? {}).length === 0 && !e.default && !e.to) {
        dsl.edges = edges.filter((x) => x !== e)
      }
    }
    return
  }
  if (route) {
    const e = edges.find((x) => x.from === from && x.cases && x.cases[route] === to)
    if (e && e.cases) {
      delete e.cases[route]
      if (Object.keys(e.cases).length === 0 && !e.default && !e.to) {
        dsl.edges = edges.filter((x) => x !== e)
      }
    }
    return
  }
  const idx = edges.findIndex((e) => !isConditional(e) && e.from === from && e.to === to)
  if (idx >= 0) dsl.edges = edges.filter((_, i) => i !== idx)
}

/**
 * 画布坐标持久化（AI助手 UX 修复）：坐标存在节点<b>顶层</b> position 字段上（与 config 平级）。
 * 🔴 后端 NodeDTO/WorkflowDefDTO 均 @JsonIgnoreProperties(ignoreUnknown=true)、dsl 原样落库，
 *    故 position 是前端专属字段：写进去后端不解析也不报错、读取时原样回来。零后端改动。
 *    layout.ts 的 layoutDsl 会优先用节点存过的 position（无则自动分层），故重开编辑器布局与上次一致。
 */

/** 把编辑会话内的 positions（视觉 id → 坐标）写回 DSL 各节点的 position（START/END 合成端点不在 nodes 里，天然排除） */
export const applyPositionsToDsl = (
  dsl: EditorDsl,
  positions: Record<string, { x: number; y: number }>
): void => {
  for (const n of dsl.nodes ?? []) {
    const p = positions[n.id]
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) n.position = { x: p.x, y: p.y }
  }
}

/** 从 DSL 各节点读回已持久化的 position（无坐标的节点不进 map，交给自动布局） */
export const readPositionsFromDsl = (dsl: EditorDsl): Record<string, { x: number; y: number }> => {
  const out: Record<string, { x: number; y: number }> = {}
  for (const n of dsl.nodes ?? []) {
    const p = n.position
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[n.id] = { x: p.x, y: p.y }
  }
  return out
}

/**
 * 条件边可视化编辑（问题4-②）：一个 condition 节点的多个分支路由 cases 挂在<b>同一条</b> conditional 边上。
 * setEdgeCase/setEdgeDefault 找到（或新建）该 from 的 conditional 边后就地增改，与 removeEdge 的删除对称。
 */

const ensureConditionalEdge = (dsl: EditorDsl, from: string): EditorDslEdge => {
  if (!Array.isArray(dsl.edges)) dsl.edges = []
  let e = dsl.edges.find((x) => x.from === from && isConditional(x))
  if (!e) {
    e = { from, type: 'conditional', cases: {} }
    dsl.edges.push(e)
  }
  if (!e.cases || typeof e.cases !== 'object') e.cases = {}
  return e
}

/** 设置/删除条件边某个路由键的目标（to 为空则删该 case） */
export const setEdgeCase = (dsl: EditorDsl, from: string, routeKey: string, to: string): void => {
  if (!from || !routeKey) return
  const e = ensureConditionalEdge(dsl, from)
  if (to) e.cases![routeKey] = to
  else delete e.cases![routeKey]
}

/** 设置/删除条件边的 default 兜底目标（to 为空则删 default） */
export const setEdgeDefault = (dsl: EditorDsl, from: string, to: string): void => {
  if (!from) return
  const e = ensureConditionalEdge(dsl, from)
  if (to) e.default = to
  else delete e.default
}

/**
 * condition.rule 的分支可视化编辑（问题4-③）。branches 形状对齐后端 RuleConditionNodeExecutor 的<b>扁平</b>写法：
 * `[{ target, conditions: [{var, op, value}] }]`（组内 AND）。🔴 若某分支用了新的 conditionGroups 嵌套写法，
 * 这些函数只增删 conditions、不碰 conditionGroups；组件检测到 conditionGroups 时改提示走底部 JSON（避免破坏结构）。
 */

/** 规则条件的算子目录（逐字对齐后端 RuleConditionNodeExecutor.evaluateOne 的 switch 分支） */
export const RULE_OPS = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'contains', 'exists', 'is_true', 'is_false'] as const

const ensureBranches = (config: Record<string, any>): any[] => {
  if (!config || typeof config !== 'object') return []
  if (!Array.isArray(config.branches)) config.branches = []
  return config.branches
}

/** 新增一个分支：空 target + 一条空条件（op 默认 eq） */
export const addRuleBranch = (config: Record<string, any>): void => {
  ensureBranches(config).push({ target: '', conditions: [{ var: '', op: 'eq', value: '' }] })
}

export const removeRuleBranch = (config: Record<string, any>, index: number): void => {
  ensureBranches(config).splice(index, 1)
}

/** 给某分支再加一条 AND 条件 */
export const addRuleCondition = (config: Record<string, any>, branchIndex: number): void => {
  const b = ensureBranches(config)[branchIndex]
  if (!b) return
  if (!Array.isArray(b.conditions)) b.conditions = []
  b.conditions.push({ var: '', op: 'eq', value: '' })
}

export const removeRuleCondition = (config: Record<string, any>, branchIndex: number, condIndex: number): void => {
  const b = ensureBranches(config)[branchIndex]
  if (!b || !Array.isArray(b.conditions)) return
  b.conditions.splice(condIndex, 1)
}

/** 某分支是否用了 conditionGroups 嵌套写法（组件据此决定「可视化编辑」还是「提示走 JSON」） */
export const branchUsesGroups = (branch: any): boolean =>
  !!branch && typeof branch === 'object' && branch.conditionGroups !== undefined
