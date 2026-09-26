import { describe, expect, it } from 'vitest'
import { layoutDsl, nodeTagType } from './layout'

/**
 * layoutDsl 纯逻辑单测（增量8 / P4 第一刀，可选但有价值）
 *
 * 只测「逻辑图 → 视觉图」的三件核心事：① 链式分层正确；② 条件边展开成多条带 label 的边；
 * ③ 孤立/不可达节点不丢。不碰 Vue Flow 运行时（layoutDsl 是纯函数）。
 */
describe('layoutDsl', () => {
  it('链式 START→a→b→END 分层正确、合成端点存在', () => {
    const { nodes, edges } = layoutDsl({
      nodes: [
        { id: 'a', type: 'tool', name: '查数据' },
        { id: 'b', type: 'llm', name: '生成' }
      ],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'END' }
      ]
    })

    // 4 个视觉节点：合成 START/END + a + b
    expect(nodes).toHaveLength(4)
    expect(edges).toHaveLength(3)

    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
    expect(byId['__start__']).toBeTruthy()
    expect(byId['__end__']).toBeTruthy()
    // x 随层递增（X_GAP=240）：start=0、a=1、b=2、end=3
    expect(byId['__start__'].position.x).toBe(0)
    expect(byId['a'].position.x).toBe(240)
    expect(byId['b'].position.x).toBe(480)
    expect(byId['__end__'].position.x).toBe(720)
    // 节点 data 带上 label + 着色用的 tagType
    expect(byId['a'].data.label).toBe('查数据')
    expect(byId['a'].data.tagType).toBe('primary') // tool → primary
  })

  it('条件边按 cases + default 展开成多条带 label 的边', () => {
    const { edges } = layoutDsl({
      nodes: [{ id: 'a', type: 'condition.llm' }, { id: 'b' }, { id: 'c' }],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'END', type: 'conditional', cases: { pass: 'b', fail: 'c' }, default: 'END' }
      ]
    })

    // START→a 一条 + 条件展开三条（pass→b、fail→c、default→END）= 4
    expect(edges).toHaveLength(4)
    const labels = edges.map((e) => e.label).filter(Boolean).sort()
    expect(labels).toEqual(['default', 'fail', 'pass'])
    // 主干边（START→a）无 label
    const trunk = edges.find((e) => e.source === '__start__')
    expect(trunk?.label).toBeFalsy()
  })

  it('孤立节点不丢，排到末层之后', () => {
    const { nodes } = layoutDsl({
      nodes: [{ id: 'a' }, { id: 'orphan' }],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'END' }
      ]
    })

    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
    expect(byId['orphan']).toBeTruthy()
    // 主干末层是 END（layer 2）；孤立源点排到 maxLayer+1 = 3
    expect(byId['orphan'].position.x).toBeGreaterThan(byId['__end__'].position.x)
  })

  it('空 DSL 容错：只有合成端点、不崩', () => {
    const { nodes, edges } = layoutDsl({})
    expect(nodes.map((n) => n.id).sort()).toEqual(['__end__', '__start__'])
    expect(edges).toHaveLength(0)
  })

  it('边指向不存在的节点时跳过，不崩', () => {
    const { edges } = layoutDsl({
      nodes: [{ id: 'a' }],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'ghost' } // ghost 不存在 → 跳过
      ]
    })
    expect(edges).toHaveLength(1)
  })
})

describe('nodeTagType', () => {
  it('按类型着色，未知默认 info', () => {
    expect(nodeTagType('tool')).toBe('primary')
    expect(nodeTagType('llm')).toBe('success')
    expect(nodeTagType('condition.llm')).toBe('warning')
    expect(nodeTagType('hitl.confirm')).toBe('danger')
    expect(nodeTagType('whatever')).toBe('info')
    expect(nodeTagType(undefined)).toBe('info')
  })
})
