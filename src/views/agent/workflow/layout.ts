import type { Edge, Node } from '@vue-flow/core'
import {
  NODE_TYPE_META,
  nodeHasRequiredGap,
  nodeTypeMeta,
  summarizeNode,
  type NodeNameResolver
} from './nodeSummary'

/**
 * DSL → Vue Flow 只读图的自动布局（增量8 / P4 第一刀）
 *
 * 🔴 DSL 是「逻辑图」而非「视觉图」——后端 {@code WorkflowDefDTO} 的 nodes/edges 完全不带坐标。
 * 所以画布必须前端自动布局。这里用最朴素的「BFS 最长路分层」：以 START 为源，layer(n)=max(layer(前驱))+1，
 * x=层号*间距、y=层内序号*间距。第一刀只保证小图（planner 产的 1~5 节点）清晰可读；分支多时层内堆叠可接受
 * （只读预览，非编辑器）。环 / 不可达节点兜底排到末层之后，不崩。复杂布局美化（dagre/elkjs）留后续刀。
 *
 * 纯函数、不依赖 Vue 运行时，便于 vitest 单测（见 layout.spec.ts）。
 */

/** DSL 节点（透传 config：画布节点卡片要渲染「这个节点做什么」的一句话摘要，见 nodeSummary.ts） */
export interface DslNode {
  id: string
  type?: string
  name?: string
  config?: Record<string, any>
  [k: string]: any
}

/** DSL 边。conditional 边用 cases（路由键→目标）+ default 展开成多条；普通边用 from→to */
export interface DslEdge {
  from: string
  /** 普通边的线性目标；条件边（走 cases/default 路由）没有线性 to，故可空——与 editorModel 的 EditorDslEdge 对齐 */
  to?: string
  type?: string
  /** 条件边的分支：路由键 → 目标节点 id（或 START/END 保留字） */
  cases?: Record<string, string>
  /** 条件边的兜底目标（DSL JSON 里键名是 "default"） */
  default?: string
}

export interface DslGraph {
  nodes?: DslNode[]
  edges?: DslEdge[]
}

/** 合成端点的内部 id（不会与用户节点 code 撞，DSL 节点 id 是 [a-z0-9_] 风格） */
const START_ID = '__start__'
const END_ID = '__end__'
/** START/END 在 DSL 边里的保留字写法 */
const START_KEYWORD = 'START'
const END_KEYWORD = 'END'

/**
 * 层间水平间距。**下界不是审美问题，是「悬停＋按钮还能不能点」的硬约束**：
 * `.wf-node` 的 `max-width: 240px` + `.wf-node__plus` 的 `right: -34px`（都在
 * `editor/components/WorkflowDesigner.vue`）⇒ 必须 X_GAP ≥ 240 + 34 + 余量，
 * 否则节点一旦长到 max-width，它右侧那个悬停才浮出的「＋」就整颗压在下一个节点的卡片底下，
 * 用户看得见却点不着（Playwright 的 hit-test 会报 `subtree intercepts pointer events`）。
 *
 * 🔴 原值 240 恰好等于 max-width，即「节点最长时两个卡片边贴边、＋完全被盖住」——这是个**旧账**，
 * 只是重构 S1 之前工具节点的摘要都是 `调用工具「form_list」` 这种短英文键，节点停在 160px 的
 * min-width 上，永远碰不到 max-width；S1 把摘要变成 `调用工具「查询表单列表」（form_list）`
 * 之后，**每个** tool 节点都顶到 240px，旧账立刻变成必现故障。
 * layout.spec.ts 有一条用例直接读那个 .vue 的 CSS 数字来守这条不等式，改 max-width 会红。
 */
export const X_GAP = 300
export const Y_GAP = 120

/** 节点类型 → el-tag 颜色。权威来源是 nodeSummary 的 NODE_TYPE_META（与聊天卡片/编辑器同色）；
    目录外的未知类型按前缀兜底（condition→warning、hitl→danger），认不出的默认 info，不硬猜 */
export type TagType = 'primary' | 'success' | 'warning' | 'danger' | 'info'

export const nodeTagType = (type?: string): TagType => {
  if (!type) return 'info'
  const meta = NODE_TYPE_META[type]
  if (meta) return meta.tagType
  if (type.startsWith('condition')) return 'warning'
  if (type.startsWith('hitl')) return 'danger'
  return 'info'
}

/** 把 DSL 边端点（可能是 START/END 保留字）映射成画布内部 id */
const mapEndpoint = (ref: string): string => {
  if (ref === START_KEYWORD) return START_ID
  if (ref === END_KEYWORD) return END_ID
  return ref
}

const isConditional = (e: DslEdge): boolean =>
  (e.type ?? '').toLowerCase() === 'conditional' || (!!e.cases && Object.keys(e.cases).length > 0)

/**
 * 把一份 DSL 布局成 Vue Flow 的 nodes/edges。
 *
 * @param dsl 已 JSON.parse 的 DSL（容错：nodes/edges 缺失时按空数组处理）
 * @param resolver 可选的名称解析器（重构 S1 / L1）：传了则节点摘要里的工具键、子流程 code 显示中文名；
 *                 不传与今天逐字一致（layout.spec.ts 就是不传的那一态）。
 *                 🔴 本模块**不**直接 import `nameCatalog.ts`：那边会把 Vue 的 ref 和 axios 拖进这个
 *                 刻意保持纯函数的文件，layout.spec.ts 就跑不起来了。
 */
export const layoutDsl = (
  dsl: DslGraph,
  resolver?: NodeNameResolver | null
): { nodes: Node[]; edges: Edge[] } => {
  const dslNodes = dsl?.nodes ?? []
  const dslEdges = dsl?.edges ?? []

  // 1) 视觉节点集合：合成 START/END 两个端点 + 每个 DSL 节点
  const nodeMeta = new Map<
    string,
    { label: string; nodeType: string; config?: Record<string, any>; position?: { x: number; y: number } }
  >()
  nodeMeta.set(START_ID, { label: '开始', nodeType: 'start' })
  nodeMeta.set(END_ID, { label: '结束', nodeType: 'end' })
  for (const n of dslNodes) {
    if (!n?.id) continue
    // 节点顶层的 position 是前端专属的持久化坐标（后端 @JsonIgnoreProperties 忽略，见 editorModel.applyPositionsToDsl）；
    // 存过就直接用（用户上次拖的布局），没存过才走自动分层
    const p = n.position
    nodeMeta.set(n.id, {
      label: n.name || n.id,
      nodeType: n.type ?? '',
      config: n.config,
      position:
        p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)
          ? { x: p.x, y: p.y }
          : undefined
    })
  }

  // 2) 视觉边集合：条件边按 cases + default 展开成多条带 label 的边
  const edges: Edge[] = []
  let edgeSeq = 0
  const pushEdge = (source: string, target: string, label?: string) => {
    // 端点指向不存在的节点时跳过（DSL 结构非法，画布不该因此崩；结构校验是后端编译期的事）
    if (!nodeMeta.has(source) || !nodeMeta.has(target)) return
    edges.push({
      id: `e-${edgeSeq++}`,
      source,
      target,
      label: label || undefined,
      // 条件分支用虚线 + 箭头，主干用实线，肉眼能区分「路由」与「顺序」
      type: 'default',
      animated: false,
      style: label ? { strokeDasharray: '4 3' } : undefined
    })
  }

  for (const e of dslEdges) {
    if (!e) continue
    const source = mapEndpoint(e.from)
    if (isConditional(e)) {
      const cases = e.cases ?? {}
      for (const [routeKey, tgt] of Object.entries(cases)) {
        if (tgt) pushEdge(source, mapEndpoint(tgt), routeKey)
      }
      if (e.default) pushEdge(source, mapEndpoint(e.default), 'default')
    } else if (e.to) {
      pushEdge(source, mapEndpoint(e.to))
    }
  }

  // 3) 分层：以 START 为源做最长路松弛（layer(t) = max(layer(t), layer(s)+1)）。
  //    迭代上界 = 节点数，环最多再抬高一轮即收敛，不会死循环。
  const ids = [...nodeMeta.keys()]
  const layer = new Map<string, number>()
  ids.forEach((id) => layer.set(id, id === START_ID ? 0 : 0))
  for (let i = 0; i < ids.length; i++) {
    let changed = false
    for (const e of edges) {
      const ls = layer.get(e.source) ?? 0
      if ((layer.get(e.target) ?? 0) < ls + 1) {
        layer.set(e.target, ls + 1)
        changed = true
      }
    }
    if (!changed) break
  }

  // 不可达 / 孤立源点（除 START 外没有入边）排到末层之后，避免和主干挤在第 0 列
  const hasIncoming = new Set<string>(edges.map((e) => e.target))
  let maxLayer = 0
  layer.forEach((v) => (maxLayer = Math.max(maxLayer, v)))
  for (const id of ids) {
    if (id !== START_ID && !hasIncoming.has(id)) {
      layer.set(id, maxLayer + 1)
    }
  }

  // 4) 定位：同层按出现顺序均分 y
  const layerBuckets = new Map<number, string[]>()
  for (const id of ids) {
    const l = layer.get(id) ?? 0
    if (!layerBuckets.has(l)) layerBuckets.set(l, [])
    layerBuckets.get(l)!.push(id)
  }

  const nodes: Node[] = []
  for (const [l, bucket] of layerBuckets) {
    bucket.forEach((id, idx) => {
      const meta = nodeMeta.get(id)!
      const isEndpoint = meta.nodeType === 'start' || meta.nodeType === 'end'
      nodes.push({
        id,
        type: 'dsl',
        // 存过持久化坐标就用它，否则用自动分层坐标
        position: meta.position ?? { x: l * X_GAP, y: idx * Y_GAP },
        data: {
          label: meta.label,
          nodeType: meta.nodeType,
          tagType: nodeTagType(meta.nodeType),
          // 中文类型名 + 一句话摘要 + 必填缺口红点（合成端点 START/END 不需要）
          typeLabel: isEndpoint ? '' : nodeTypeMeta(meta.nodeType).label,
          summary: isEndpoint ? '' : summarizeNode({ type: meta.nodeType, config: meta.config }, resolver),
          hasGap: isEndpoint ? false : nodeHasRequiredGap({ type: meta.nodeType, config: meta.config })
        }
      })
    })
  }

  return { nodes, edges }
}
