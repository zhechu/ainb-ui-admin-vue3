/**
 * 画布图编辑的纯逻辑（AI助手 流程编排优化 / Req 7：节点右侧「+」快捷加节点）
 *
 * 🔴 与 editorModel 同款纪律：纯函数、就地改传入的 DSL 对象、不依赖 Vue 运行时，便于 vitest 单测。
 *    editorModel 管「一个节点/一条边怎么增删」，本模块管「插在哪、怎么接线」这类图语义——
 *    分开放是因为「插入到两个节点中间」要同时动 3 条边，混进 editorModel 会把它的单一职责撑破。
 *
 * 🔴 为什么「+」不是简单地在 source 后面挂一条边：source 往往已经连着 next。只挂 source→new
 *    会让 source 有两条普通出边，而本流程模型是「普通节点单出边、多出边只能靠条件分支」，
 *    两条普通出边在编译期就是歧义。所以默认语义是**插进连线中间**：source→new→next。
 */

import { addEdge, removeEdge, setEdgeCase, type EditorDsl, type EditorDslEdge, type EditorDslNode } from '../editorModel'

/** 条件边判定（与 editorModel / layout 同口径：显式 type=conditional，或有非空 cases） */
export const isConditionalEdge = (e: EditorDslEdge): boolean =>
  (e.type ?? '').toLowerCase() === 'conditional' || (!!e.cases && Object.keys(e.cases).length > 0)

/** 是否条件类节点（condition.rule / condition.llm）——它们的出边挂在路由键上，不是普通 to */
export const isConditionNode = (node?: EditorDslNode | null): boolean =>
  !!node && (node.type ?? '').startsWith('condition.')

/**
 * 条件节点的候选路由键：condition.llm 取 choices（+default），condition.rule 取 branches[].target（+default）。
 * 🔴 后端 RuleConditionNodeExecutor 是「branches 首个命中 → branch.target」，target 是**路由键**而非节点 id；
 *    节点 id 写在条件边的 cases[路由键] 上。所以「+」在条件节点上必须先问清走哪个分支。
 */
export const routeKeyCandidates = (node?: EditorDslNode | null): string[] => {
  const config = node?.config ?? {}
  if (node?.type === 'condition.llm') {
    const keys = Array.isArray(config.choices) ? config.choices.map((c: any) => String(c)).filter(Boolean) : []
    return config.default ? [...keys, String(config.default)] : keys
  }
  if (node?.type === 'condition.rule') {
    const keys = Array.isArray(config.branches)
      ? config.branches
          .map((b: any) => (b && typeof b === 'object' ? String(b.target ?? '') : ''))
          .filter(Boolean)
      : []
    return config.default ? [...keys, String(config.default)] : keys
  }
  return []
}

/** 从 sourceRef 出发的普通（非条件）出边目标列表。sourceRef 可以是节点 id 或 'START'/'END' 保留字 */
export const plainOutTargets = (dsl: EditorDsl, sourceRef: string): string[] =>
  (dsl.edges ?? [])
    .filter((e) => e && e.from === sourceRef && !isConditionalEdge(e) && e.to)
    .map((e) => e.to as string)

export interface InsertAfterOptions {
  /** 起点：节点 id 或 'START' / 'END' 保留字 */
  sourceRef: string
  /** 已加进 dsl.nodes 的新节点 id（本函数不负责建节点，只负责接线） */
  newId: string
  /** 条件节点的分支路由键；给了就挂到 cases[routeKey]，不做「插中间」 */
  routeKey?: string
}

/**
 * 把 newId 接到 sourceRef 之后。
 *
 * · 给了 routeKey（起点是条件节点）→ 写 cases[routeKey] = newId，其余分支原样不动；
 * · 起点只有**一条**普通出边 next → 拆成 source→new→next（插进连线中间）；
 * · 起点没有普通出边，或有多条（多分支/已是歧义图）→ 只加 source→new，不去猜该断哪条。
 *
 * @returns 是否真的改了图（sourceRef/newId 为空时返回 false，调用方据此决定是否标脏）
 */
export const insertAfter = (dsl: EditorDsl, options: InsertAfterOptions): boolean => {
  const { sourceRef, newId, routeKey } = options
  if (!dsl || !sourceRef || !newId) return false

  if (routeKey) {
    setEdgeCase(dsl, sourceRef, routeKey, newId)
    return true
  }

  const outs = plainOutTargets(dsl, sourceRef)
  if (outs.length === 1) {
    const next = outs[0]
    if (next !== newId) {
      removeEdge(dsl, sourceRef, next)
      addEdge(dsl, sourceRef, newId)
      addEdge(dsl, newId, next)
      return true
    }
  }
  addEdge(dsl, sourceRef, newId)
  return true
}
