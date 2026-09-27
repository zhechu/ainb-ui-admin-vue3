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

/** DSL 节点（编辑器关心 id/type/name/config，其余字段原样保留） */
export interface EditorDslNode {
  id: string
  type?: string
  name?: string
  config?: Record<string, any>
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

export type EditorTagType = 'primary' | 'success' | 'warning' | 'danger' | 'info'

export interface NodeTypeOption {
  value: string
  label: string
  tagType: EditorTagType
}

/**
 * 可拖入的节点类型目录。
 * 🔴 逐字对齐后端 {@code NodeExecutorRegistry} 已注册的 10 种执行器 type（getType()）——
 * 目录里放一个后端没有执行器的 type，作者拖出来发布了也会在编译期报「找不到节点类型的执行器」。
 * 标签色沿用 layout.ts 的 nodeTagType 映射，保证画布预览与编辑器同色。
 */
export const NODE_TYPE_OPTIONS: NodeTypeOption[] = [
  { value: 'tool', label: '工具', tagType: 'primary' },
  { value: 'llm', label: '大模型', tagType: 'success' },
  { value: 'condition.rule', label: '规则条件', tagType: 'warning' },
  { value: 'condition.llm', label: 'LLM 条件', tagType: 'warning' },
  { value: 'hitl.confirm', label: '人工确认', tagType: 'danger' },
  { value: 'hitl.bpm_approval', label: 'BPM 审批', tagType: 'danger' },
  { value: 'knowledge_retrieval', label: '知识检索', tagType: 'info' },
  { value: 'parallel', label: '并行', tagType: 'info' },
  { value: 'wait', label: '等待', tagType: 'info' },
  { value: 'script', label: '脚本', tagType: 'primary' }
]

/** 条件边「默认分支」在渲染边 data.route 里的哨兵值（与 case 的路由键区分开） */
export const DEFAULT_ROUTE = '__default__'

export const nodeTypeLabel = (type?: string): string =>
  NODE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? (type || '节点')

export const nodeTypeTag = (type?: string): EditorTagType =>
  NODE_TYPE_OPTIONS.find((o) => o.value === type)?.tagType ?? 'info'

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
 * 新节点的默认 config。只给最常用的 tool/llm 一个骨架，其余留 outputVar 占位——
 * 🔴 刻意不臆造各类型的完整 config schema（猜错反而误导），作者可在配置面板/JSON 里补全。
 */
export const defaultConfig = (type: string): Record<string, any> => {
  if (type === 'tool') return { toolId: '', args: {}, outputVar: '' }
  if (type === 'llm') return { prompt: '', outputVar: '' }
  if (type === 'hitl.bpm_approval')
    return { bpmProcessDefKey: '', approveVar: 'bpm_approved', statusVar: 'bpm_status', formVars: {} }
  if (type === 'script') return { code: '', language: 'javascript', timeoutMs: 2000, outputVar: '' }
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
