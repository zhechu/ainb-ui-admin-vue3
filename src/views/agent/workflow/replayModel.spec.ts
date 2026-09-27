import { describe, expect, it } from 'vitest'
import type { AgentNodeExecutionVO } from '@/api/agent/workflow'
import {
  NODE_STATUS_META,
  NOT_EXECUTED_META,
  aggregateTracesByNode,
  buildReplayGraph,
  nodeStatusMeta,
  type ReplayNodeData
} from './replayModel'

/**
 * replayModel 纯逻辑单测（增量15 / P4 后续刀：节点级执行回放）
 *
 * 钉住回放的命门——<b>trace 按 nodeId 精确叠加到布局图，且重试多行正确聚合</b>：
 * ① nodeId 映射到对应画布节点、合成端点/未走到节点回落「未执行」；② 同节点多 attempt 按序聚合、
 * finalStatus 取最后一次（重试成功→整体成功）；③ 状态色/标签映射，脏状态 fail-soft 回落；
 * ④ 条件边的各分支目标节点都入图并可各自染色；⑤ 布局/边完全复用 layoutDsl（回放图与预览图同构）。
 * 不碰 Vue 运行时（全是纯函数）。
 */

/** 造一条节点 trace（只填回放用得到的字段，其余可选） */
const t = (
  nodeId: string,
  status: string,
  attempt = 1,
  extra: Partial<AgentNodeExecutionVO> = {}
): AgentNodeExecutionVO =>
  ({ id: attempt, executionId: 1024, nodeId, nodeType: 'tool', status, attempt, ...extra }) as AgentNodeExecutionVO

/** START → tool_1 → END 的最小 DSL */
const linearDsl = () => ({
  nodes: [{ id: 'tool_1', type: 'tool', name: '查接口' }],
  edges: [
    { from: 'START', to: 'tool_1' },
    { from: 'tool_1', to: 'END' }
  ]
})

const dataOf = (nodes: any[], id: string): ReplayNodeData =>
  nodes.find((n) => n.id === id)!.data as ReplayNodeData

describe('replayModel', () => {
  it('nodeStatusMeta：已知状态映射，null/空/未知一律回落未执行', () => {
    expect(nodeStatusMeta('SUCCESS')).toBe(NODE_STATUS_META.SUCCESS)
    expect(nodeStatusMeta('FAILURE').tagType).toBe('danger')
    expect(nodeStatusMeta('RUNNING').label).toBe('执行中')
    expect(nodeStatusMeta('SKIPPED')).toBe(NODE_STATUS_META.SKIPPED)
    expect(nodeStatusMeta(null)).toBe(NOT_EXECUTED_META)
    expect(nodeStatusMeta(undefined)).toBe(NOT_EXECUTED_META)
    expect(nodeStatusMeta('')).toBe(NOT_EXECUTED_META)
    // 脏状态（后端将来加值/写错）不崩，回落未执行
    expect(nodeStatusMeta('WEIRD')).toBe(NOT_EXECUTED_META)
  })

  it('aggregateTracesByNode：同节点多 attempt 按序聚合，finalStatus 取最后一次', () => {
    // 乱序传入，验证按 attempt 升序排；第 1 次失败、第 2 次成功 → 整体成功（重试成功）
    const map = aggregateTracesByNode([
      t('llm_1', 'SUCCESS', 2),
      t('llm_1', 'FAILURE', 1),
      t('tool_1', 'SUCCESS', 1)
    ])
    expect(map.size).toBe(2)
    const llm = map.get('llm_1')!
    expect(llm.attempts.map((a) => a.attempt)).toEqual([1, 2])
    expect(llm.finalStatus).toBe('SUCCESS')
    expect(map.get('tool_1')!.finalStatus).toBe('SUCCESS')
  })

  it('aggregateTracesByNode：只失败一次 → finalStatus FAILURE；空/脏入参不崩', () => {
    expect(aggregateTracesByNode([t('x', 'FAILURE', 1)]).get('x')!.finalStatus).toBe('FAILURE')
    expect(aggregateTracesByNode([]).size).toBe(0)
    expect(aggregateTracesByNode(null).size).toBe(0)
    expect(aggregateTracesByNode(undefined).size).toBe(0)
    // 无 nodeId 的脏行被丢弃
    expect(aggregateTracesByNode([t('', 'SUCCESS', 1)]).size).toBe(0)
  })

  it('buildReplayGraph：trace 按 nodeId 叠加到画布节点，合成端点/未走到节点为未执行', () => {
    const dsl = {
      nodes: [
        { id: 'tool_1', type: 'tool', name: '查接口' },
        { id: 'llm_1', type: 'llm', name: '总结' }
      ],
      edges: [
        { from: 'START', to: 'tool_1' },
        { from: 'tool_1', to: 'llm_1' },
        { from: 'llm_1', to: 'END' }
      ]
    }
    // 只跑了 tool_1（成功），llm_1 没走到（无 trace）
    const { nodes, edges, traceByNode, dataByNode } = buildReplayGraph(dsl, [t('tool_1', 'SUCCESS', 1)])

    // 合成 START/END + 两个真实节点 = 4
    expect(nodes).toHaveLength(4)
    expect(edges.length).toBeGreaterThan(0)

    const tool = dataOf(nodes, 'tool_1')
    expect(tool.execStatus).toBe('SUCCESS')
    expect(tool.hasTrace).toBe(true)
    expect(tool.attemptCount).toBe(1)
    expect(tool.execMeta).toBe(NODE_STATUS_META.SUCCESS)
    // 类型色仍由 layout 保留（tool → primary），与执行态色分开
    expect(tool.tagType).toBe('primary')
    expect(tool.label).toBe('查接口')

    // 未走到的 llm_1：无 trace → 未执行、中性色
    const llm = dataOf(nodes, 'llm_1')
    expect(llm.execStatus).toBeNull()
    expect(llm.hasTrace).toBe(false)
    expect(llm.attemptCount).toBe(0)
    expect(llm.execMeta).toBe(NOT_EXECUTED_META)

    // 合成端点无 trace
    expect(dataOf(nodes, '__start__').execStatus).toBeNull()
    expect(dataOf(nodes, '__end__').execStatus).toBeNull()

    expect(traceByNode.get('tool_1')!.attempts).toHaveLength(1)

    // dataByNode：扁平副本，覆盖每个画布节点，且与 Node.data 同源（组件靠它避开 VueFlow 深层泛型）
    expect(dataByNode.size).toBe(nodes.length)
    expect(dataByNode.get('tool_1')).toBe(dataOf(nodes, 'tool_1'))
    expect(dataByNode.get('llm_1')?.execStatus).toBeNull()
  })

  it('buildReplayGraph：重试节点 attemptCount=行数、finalStatus=最后一次', () => {
    const { nodes } = buildReplayGraph(linearDsl(), [
      t('tool_1', 'FAILURE', 1),
      t('tool_1', 'SUCCESS', 2)
    ])
    const tool = dataOf(nodes, 'tool_1')
    expect(tool.attemptCount).toBe(2)
    expect(tool.execStatus).toBe('SUCCESS')
  })

  it('buildReplayGraph：FAILURE / SKIPPED / RUNNING 各染对应色', () => {
    const dsl = {
      nodes: [
        { id: 'a', type: 'tool' },
        { id: 'b', type: 'tool' },
        { id: 'c', type: 'tool' }
      ],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' }
      ]
    }
    const { nodes } = buildReplayGraph(dsl, [
      t('a', 'RUNNING', 1),
      t('b', 'FAILURE', 1),
      t('c', 'SKIPPED', 1)
    ])
    expect(dataOf(nodes, 'a').execMeta).toBe(NODE_STATUS_META.RUNNING)
    expect(dataOf(nodes, 'b').execMeta).toBe(NODE_STATUS_META.FAILURE)
    expect(dataOf(nodes, 'c').execMeta).toBe(NODE_STATUS_META.SKIPPED)
  })

  it('buildReplayGraph：条件边各分支目标都入图，可分别染色（走到的染色、没走到的未执行）', () => {
    const dsl = {
      nodes: [
        { id: 'cond', type: 'condition.rule', name: '分流' },
        { id: 'yes', type: 'tool', name: '是分支' },
        { id: 'no', type: 'tool', name: '否分支' }
      ],
      edges: [
        { from: 'START', to: 'cond' },
        { from: 'cond', type: 'conditional', cases: { yes: 'yes', no: 'no' } },
        { from: 'yes', to: 'END' },
        { from: 'no', to: 'END' }
      ]
    }
    // 只走了 yes 分支
    const { nodes } = buildReplayGraph(dsl, [
      t('cond', 'SUCCESS', 1),
      t('yes', 'SUCCESS', 1)
    ])
    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['cond', 'yes', 'no']))
    expect(dataOf(nodes, 'yes').execStatus).toBe('SUCCESS')
    // no 分支没走到 → 未执行
    expect(dataOf(nodes, 'no').execStatus).toBeNull()
  })

  it('buildReplayGraph：空 DSL + 空 trace 不崩（返回合成端点图）', () => {
    const { nodes, traceByNode } = buildReplayGraph({ nodes: [], edges: [] }, [])
    expect(traceByNode.size).toBe(0)
    // 至少不抛；合成端点是否存在取决于 layoutDsl（空图时可能只剩 START/END 或为空），只验不崩
    expect(Array.isArray(nodes)).toBe(true)
  })
})
