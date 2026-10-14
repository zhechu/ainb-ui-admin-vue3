import type { Edge, Node } from '@vue-flow/core'
import type { AgentNodeExecutionVO } from '@/api/agent/workflow'
import { layoutDsl, type DslGraph, type TagType } from './layout'
import type { NodeNameResolver } from './nodeSummary'

/**
 * 节点级执行回放的纯逻辑模型（增量15 / P4 可视化编辑器后续刀：节点级回放）
 *
 * 🔴 与 layout.ts / editorModel.ts 同款纪律：纯函数、不依赖 Vue 运行时，便于 vitest 单测（见 replayModel.spec.ts）。
 *
 * <h3>回放 = trace 叠加到布局图</h3>
 * 把「一次执行的节点级 trace」（{@code agent_node_execution}，每节点每次尝试一行）叠加到「该执行绑定版本的 DSL
 * 布局图」上：图由 {@link layoutDsl} 算（DSL 无坐标），trace 按 {@code nodeId} 映射到图节点——layoutDsl 的
 * {@code node.id} 即 DSL 节点 id，与 {@code trace.nodeId} 逐字对应；合成的 {@code __start__}/{@code __end__} 端点
 * 与没走到的分支节点没有 trace。叠加后每个节点带 {@code execStatus}（着色用）与 {@code attempts}（详情面板用）。
 *
 * <h3>🔴 零后端改动</h3>
 * 三个数据端点（{@code getExecution} 取 workflowDefId、{@code getDef} 取该版本 DSL、{@code getNodeTrace} 取节点 trace）
 * 都已存在且只读（{@code agent:workflow:query}）。本模块只做纯前端的数据合并，不新增任何接口。
 */

/**
 * 节点级执行状态（{@code AgentNodeExecutionDO.status}：RUNNING/SUCCESS/FAILURE/SKIPPED）。
 * 🔴 与「执行实例级」的 SUCCEEDED/FAILED（{@code WorkflowExecutionStatusEnum}）不同名，别混——
 * 一个是单次节点尝试的结局，一个是整条执行的结局。
 */
export type NodeExecStatus = 'SUCCESS' | 'FAILURE' | 'RUNNING' | 'SKIPPED'

export interface NodeStatusMeta {
  label: string
  tagType: TagType
  /** 画布节点边框/光晕色（内联样式用）。取 Element Plus 语义色 CSS 变量，随明暗主题自适应 */
  color: string
}

/** 节点状态 → 展示元信息（标签文案 / el-tag 色 / 画布边框色） */
export const NODE_STATUS_META: Record<NodeExecStatus, NodeStatusMeta> = {
  SUCCESS: { label: '成功', tagType: 'success', color: 'var(--el-color-success)' },
  FAILURE: { label: '失败', tagType: 'danger', color: 'var(--el-color-danger)' },
  RUNNING: { label: '执行中', tagType: 'primary', color: 'var(--el-color-primary)' },
  SKIPPED: { label: '跳过', tagType: 'info', color: 'var(--el-color-info)' }
}

/** 无 trace（合成端点 / 未走到的分支节点）的中性展示：边框用浅灰、不抢眼 */
export const NOT_EXECUTED_META: NodeStatusMeta = {
  label: '未执行',
  tagType: 'info',
  color: 'var(--el-border-color)'
}

/** 状态字符串 → 元信息；null/空/未知值一律回落 {@link NOT_EXECUTED_META}（fail-soft，不因脏状态崩画布） */
export const nodeStatusMeta = (status?: string | null): NodeStatusMeta =>
  (status ? NODE_STATUS_META[status as NodeExecStatus] : undefined) ?? NOT_EXECUTED_META

/** 一个节点的回放聚合：全部尝试（按 attempt 升序）+ 最终态（取最大 attempt 那行的 status） */
export interface NodeTrace {
  attempts: AgentNodeExecutionVO[]
  finalStatus: string
}

/**
 * 把节点级 trace 按 {@code nodeId} 聚合。
 *
 * <p>重试会产生多行（attempt 1、2…），同一节点归到一处：{@code attempts} 按 attempt 升序（缺 attempt 视为 0 排前），
 * {@code finalStatus} = 最后一次尝试的状态——重试成功则节点整体成功（第 1 次 FAILURE、第 2 次 SUCCESS → SUCCESS）。
 * 「第几次、每次烧了多少 token」由 attempts 逐行还原（见 {@code AgentNodeExecutionDO} 的「重试用新增行不覆盖」纪律）。
 */
export const aggregateTracesByNode = (
  traces: AgentNodeExecutionVO[] | null | undefined
): Map<string, NodeTrace> => {
  const map = new Map<string, NodeTrace>()
  for (const t of traces ?? []) {
    if (!t?.nodeId) continue
    const entry = map.get(t.nodeId) ?? { attempts: [], finalStatus: '' }
    entry.attempts.push(t)
    map.set(t.nodeId, entry)
  }
  for (const entry of map.values()) {
    entry.attempts.sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0))
    entry.finalStatus = entry.attempts[entry.attempts.length - 1]?.status ?? ''
  }
  return map
}

/** 回放图里每个节点的 data：在 layoutDsl 的 label/nodeType/tagType 之上叠加执行态 */
export interface ReplayNodeData {
  label: string
  nodeType: string
  /** 类型色（layout 的 nodeTagType），用于节点里的小类型徽标 */
  tagType: TagType
  /** 执行态（SUCCESS/FAILURE/RUNNING/SKIPPED）；null=无 trace（合成端点或未走到） */
  execStatus: string | null
  /** 执行态的展示元信息（边框色 + 标签），null 态回落 NOT_EXECUTED_META */
  execMeta: NodeStatusMeta
  /** 尝试次数（= 该节点的 trace 行数），详情面板/徽标用 */
  attemptCount: number
  hasTrace: boolean
}

export interface ReplayGraph {
  nodes: Node[]
  edges: Edge[]
  /** nodeId → 聚合 trace，供点节点时右侧详情面板取用 */
  traceByNode: Map<string, NodeTrace>
  /**
   * nodeId → 该节点的回放 data（执行态/标签/尝试次数）。
   * 🔴 单独给一份纯 Map，让组件选中节点时直接查它，而不是从 VueFlow 的 {@link Node}.data 上回读——
   * 后者是深层泛型，vue-tsc 在 computed 里推断会 TS2589「类型实例化过深」。这里在构造时顺手留一份扁平副本。
   */
  dataByNode: Map<string, ReplayNodeData>
}

/**
 * DSL + trace → 回放图。跑 {@link layoutDsl} 得到基础图，再给每个节点的 data 叠加执行态。
 *
 * 🔴 纯叠加、不改布局：节点位置/边完全由 layoutDsl 决定（与只读画布/编辑器同一张图），只多染一层执行状态，
 * 保证「回放看到的图」与「预览/编辑看到的图」结构一致，作者不会因回放而认不出自己的流程。
 *
 * 🔴 第三参 `resolver` 可选（重构 S1 / L1）：传了则节点摘要里的工具键、子流程 code 翻成中文名，
 * 不传与今天逐字一致（replayModel.spec.ts 就是不传的那一态）。
 */
export const buildReplayGraph = (
  dsl: DslGraph,
  traces: AgentNodeExecutionVO[] | null | undefined,
  resolver?: NodeNameResolver | null
): ReplayGraph => {
  const { nodes, edges } = layoutDsl(dsl, resolver)
  const traceByNode = aggregateTracesByNode(traces)
  const dataByNode = new Map<string, ReplayNodeData>()
  const replayNodes: Node[] = nodes.map((n) => {
    const trace = traceByNode.get(n.id)
    const base = (n.data ?? {}) as Record<string, any>
    const execStatus = trace ? trace.finalStatus : null
    const data: ReplayNodeData = {
      label: base.label ?? n.id,
      nodeType: base.nodeType ?? '',
      tagType: base.tagType ?? 'info',
      execStatus,
      execMeta: nodeStatusMeta(execStatus),
      attemptCount: trace ? trace.attempts.length : 0,
      hasTrace: !!trace
    }
    dataByNode.set(n.id, data)
    return { ...n, data }
  })
  return { nodes: replayNodes, edges, traceByNode, dataByNode }
}
