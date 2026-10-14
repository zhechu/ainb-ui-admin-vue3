import { describe, expect, it } from 'vitest'
import type { EditorDsl } from '../editorModel'
import { insertAfter, isConditionNode, plainOutTargets, routeKeyCandidates } from './graphEdit'

/**
 * graphEdit 纯逻辑单测（AI助手 流程编排优化 / Req 7：节点右侧「+」快捷加节点）
 *
 * 钉死三件事：① 默认语义是**插进连线中间**（source→new→next），不是简单挂一条边——
 * 后者会让普通节点出现两条出边，编译期就是歧义；② 条件节点必须先给路由键，写进 cases
 * 而不是 to，且其余分支不受影响；③ 起点没有/有多条普通出边时只加一条边，绝不乱拆别人的线。
 */
// EditorDsl.edges 是可选的（真实 DSL 允许缺省），但本文件的断言全在 edges 上，
// 故用交叉类型把「本用例里 edges 必有」写进签名，免得每处断言都加 !
type DslWithEdges = EditorDsl & { edges: any[] }
const dsl = (edges: any[], nodes: any[] = []): DslWithEdges => ({ nodes, edges })

describe('routeKeyCandidates', () => {
  it('condition.rule：取 branches[].target，末尾补 default', () => {
    expect(
      routeKeyCandidates({
        id: 'c',
        type: 'condition.rule',
        config: { branches: [{ target: 'big' }, { target: 'small' }], default: 'small' }
      })
    ).toEqual(['big', 'small', 'small'])
  })

  it('condition.llm：取 choices，末尾补 default', () => {
    expect(
      routeKeyCandidates({ id: 'c', type: 'condition.llm', config: { choices: ['yes', 'no'], default: 'no' } })
    ).toEqual(['yes', 'no', 'no'])
  })

  it('没配分支 → 空数组（调用方据此提示先去面板加分支，而不是弹一个空弹窗）', () => {
    expect(routeKeyCandidates({ id: 'c', type: 'condition.rule', config: { branches: [] } })).toEqual([])
    expect(routeKeyCandidates({ id: 't', type: 'tool', config: {} })).toEqual([])
    expect(routeKeyCandidates(undefined)).toEqual([])
  })

  it('isConditionNode：只认 condition.* 前缀', () => {
    expect(isConditionNode({ id: 'a', type: 'condition.rule' })).toBe(true)
    expect(isConditionNode({ id: 'a', type: 'condition.llm' })).toBe(true)
    expect(isConditionNode({ id: 'a', type: 'tool' })).toBe(false)
    expect(isConditionNode(undefined)).toBe(false)
  })
})

describe('plainOutTargets', () => {
  it('只收普通出边的 to，条件边（cases/default）不算', () => {
    const d = dsl([
      { from: 'a', to: 'b' },
      { from: 'a', type: 'conditional', cases: { ok: 'c' }, default: 'd' }
    ])
    expect(plainOutTargets(d, 'a')).toEqual(['b'])
  })

  it('START 保留字同样能查（「+」也挂在开始节点上）', () => {
    expect(plainOutTargets(dsl([{ from: 'START', to: 'n1' }]), 'START')).toEqual(['n1'])
  })
})

describe('insertAfter', () => {
  it('线性链：插进中间，source→new→next，原边被拆掉', () => {
    const d = dsl([
      { from: 'START', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'END' }
    ])
    expect(insertAfter(d, { sourceRef: 'a', newId: 'x' })).toBe(true)
    expect(d.edges).toEqual([
      { from: 'START', to: 'a' },
      { from: 'b', to: 'END' },
      { from: 'a', to: 'x' },
      { from: 'x', to: 'b' }
    ])
  })

  it('起点无出边：只加一条 source→new，不凭空造 END 边', () => {
    const d = dsl([{ from: 'START', to: 'a' }])
    insertAfter(d, { sourceRef: 'a', newId: 'x' })
    expect(d.edges).toEqual([
      { from: 'START', to: 'a' },
      { from: 'a', to: 'x' }
    ])
  })

  it('起点有多条普通出边（歧义图）：不去猜该断哪条，只加自己的边', () => {
    const d = dsl([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' }
    ])
    insertAfter(d, { sourceRef: 'a', newId: 'x' })
    expect(d.edges).toHaveLength(3)
    expect(d.edges.some((e) => e.from === 'a' && e.to === 'x')).toBe(true)
    expect(d.edges.some((e) => e.from === 'a' && e.to === 'b')).toBe(true)
    expect(d.edges.some((e) => e.from === 'a' && e.to === 'c')).toBe(true)
  })

  it('给了 routeKey：写进条件边 cases，其余分支与 default 原样保留', () => {
    const d = dsl([
      { from: 'START', to: 'c' },
      { from: 'c', type: 'conditional', cases: { big: 'n_big' }, default: 'n_small' }
    ])
    insertAfter(d, { sourceRef: 'c', newId: 'x', routeKey: 'small2' })
    const cond = d.edges.find((e) => e.type === 'conditional')!
    expect(cond.cases).toEqual({ big: 'n_big', small2: 'x' })
    expect(cond.default).toBe('n_small')
  })

  it('routeKey 覆盖同一分支的旧目标：改指向而不是留两条', () => {
    const d = dsl([{ from: 'c', type: 'conditional', cases: { big: 'old' } }])
    insertAfter(d, { sourceRef: 'c', newId: 'x', routeKey: 'big' })
    expect(d.edges.find((e) => e.type === 'conditional')!.cases).toEqual({ big: 'x' })
  })

  it('起点是 START：插到第一个节点之前', () => {
    const d = dsl([
      { from: 'START', to: 'a' },
      { from: 'a', to: 'END' }
    ])
    insertAfter(d, { sourceRef: 'START', newId: 'x' })
    expect(d.edges).toEqual([
      { from: 'a', to: 'END' },
      { from: 'START', to: 'x' },
      { from: 'x', to: 'a' }
    ])
  })

  it('参数缺失：不改图、返回 false（调用方据此不标脏、不入撤销栈）', () => {
    const d = dsl([{ from: 'START', to: 'a' }])
    expect(insertAfter(d, { sourceRef: '', newId: 'x' })).toBe(false)
    expect(insertAfter(d, { sourceRef: 'START', newId: '' })).toBe(false)
    expect(d.edges).toHaveLength(1)
  })

  it('非图形字段（trigger/variables/settings）原样保留——插入接线绝不丢 DSL 其它部分', () => {
    const d: EditorDsl = {
      id: 'wf',
      trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: 'a' } },
      variables: [{ key: 'input', type: 'string' }],
      nodes: [{ id: 'a', type: 'tool' }],
      edges: [{ from: 'START', to: 'a' }],
      settings: { recovery: 'forward' }
    }
    insertAfter(d, { sourceRef: 'a', newId: 'x' })
    expect(d.trigger).toEqual({ type: 'trigger.chat', config: { inputVar: 'input', agentId: 'a' } })
    expect(d.variables).toHaveLength(1)
    expect(d.settings).toEqual({ recovery: 'forward' })
  })
})
