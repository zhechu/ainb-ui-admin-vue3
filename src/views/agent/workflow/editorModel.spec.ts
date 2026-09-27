import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROUTE,
  addEdge,
  addNode,
  defaultConfig,
  ensureCompensation,
  genNodeId,
  getNodeRecovery,
  isNonCompensableType,
  nodeTypeLabel,
  removeEdge,
  removeNode,
  setNodeRecovery,
  type EditorDsl,
  type EditorDslNode
} from './editorModel'

/**
 * editorModel 纯逻辑单测（增量14d / P4 可视化编辑器首刀）
 *
 * 钉住编辑器的命门——<b>往返保真</b>：① 加节点生成唯一 id；② 删节点连带清理指向它的边（含条件边 case），
 * 不留悬空引用；③ 连边去重；④ 删边能反查普通边/条件 default/条件 case 三种；⑤ 全程只动 nodes/edges，
 * DSL 的 trigger/variables/settings 等非图形字段一字不丢。不碰 Vue 运行时（全是纯函数）。
 */
describe('editorModel', () => {
  it('genNodeId：按类型前缀生成，撞号自动递增，点号转下划线', () => {
    expect(genNodeId('tool', [])).toBe('tool_1')
    expect(genNodeId('tool', ['tool_1'])).toBe('tool_2')
    expect(genNodeId('tool', ['tool_1', 'tool_2'])).toBe('tool_3')
    expect(genNodeId('condition.llm', [])).toBe('condition_llm_1')
  })

  it('addNode：push 一个带默认 config 的节点并返回唯一 id', () => {
    const dsl: EditorDsl = { nodes: [{ id: 'tool_1', type: 'tool' }] }
    const id = addNode(dsl, 'llm')
    expect(id).toBe('llm_1')
    expect(dsl.nodes).toHaveLength(2)
    const added = dsl.nodes![1]
    expect(added.type).toBe('llm')
    expect(added.name).toBe(nodeTypeLabel('llm'))
    expect(added.config).toEqual(defaultConfig('llm'))
  })

  it('addNode：nodes 缺失时自动建数组', () => {
    const dsl: EditorDsl = {}
    addNode(dsl, 'tool')
    expect(dsl.nodes).toHaveLength(1)
  })

  it('addEdge：连普通边；重复的同一条不再加', () => {
    const dsl: EditorDsl = { nodes: [], edges: [] }
    addEdge(dsl, 'START', 'a')
    addEdge(dsl, 'START', 'a')
    expect(dsl.edges).toHaveLength(1)
    addEdge(dsl, 'a', 'END')
    expect(dsl.edges).toHaveLength(2)
  })

  it('removeNode：删节点并清掉 from/to 命中的整条边', () => {
    const dsl: EditorDsl = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'END' }
      ]
    }
    removeNode(dsl, 'a')
    expect(dsl.nodes!.map((n) => n.id)).toEqual(['b'])
    // START→a 和 a→b 都被清（a 是端点），只剩 b→END
    expect(dsl.edges).toEqual([{ from: 'b', to: 'END' }])
  })

  it('removeNode：条件边只删指向被删节点的 case，保留其它分支', () => {
    const dsl: EditorDsl = {
      nodes: [{ id: 'c' }, { id: 'yes' }, { id: 'no' }],
      edges: [{ from: 'c', type: 'conditional', cases: { y: 'yes', n: 'no' } }]
    }
    removeNode(dsl, 'yes')
    expect(dsl.edges).toHaveLength(1)
    expect(dsl.edges![0].cases).toEqual({ n: 'no' })
  })

  it('removeEdge：普通边——按 from/to 反查删除', () => {
    const dsl: EditorDsl = {
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'END' }
      ]
    }
    removeEdge(dsl, 'START', 'a')
    expect(dsl.edges).toEqual([{ from: 'a', to: 'END' }])
  })

  it('removeEdge：条件 case——只删该路由键，边仍在', () => {
    const dsl: EditorDsl = {
      edges: [{ from: 'c', type: 'conditional', cases: { y: 'yes', n: 'no' } }]
    }
    removeEdge(dsl, 'c', 'yes', 'y')
    expect(dsl.edges).toHaveLength(1)
    expect(dsl.edges![0].cases).toEqual({ n: 'no' })
  })

  it('removeEdge：条件 default 分支——删 default，case 仍在则边保留', () => {
    const dsl: EditorDsl = {
      edges: [{ from: 'c', type: 'conditional', cases: { y: 'yes' }, default: 'fb' }]
    }
    removeEdge(dsl, 'c', 'fb', DEFAULT_ROUTE)
    expect(dsl.edges).toHaveLength(1)
    expect(dsl.edges![0].default).toBeUndefined()
    expect(dsl.edges![0].cases).toEqual({ y: 'yes' })
  })

  it('removeEdge：条件边删到既无 case 又无 default → 整条边移除', () => {
    const dsl: EditorDsl = {
      edges: [{ from: 'c', type: 'conditional', cases: { y: 'yes' } }]
    }
    removeEdge(dsl, 'c', 'yes', 'y')
    expect(dsl.edges).toHaveLength(0)
  })

  it('往返保真：增删只动 nodes/edges，trigger/variables/settings 原样保留', () => {
    const dsl: EditorDsl = {
      id: 'wf_x',
      trigger: { type: 'trigger.webhook', config: { path: 'hook', authType: 'hmac', secret: 's' } },
      variables: [{ key: 'input', type: 'string' }],
      settings: { recovery: 'forward' },
      nodes: [{ id: 'a', type: 'tool' }],
      edges: [{ from: 'START', to: 'a' }]
    }
    addNode(dsl, 'llm')
    addEdge(dsl, 'a', 'llm_1')
    removeNode(dsl, 'a')

    expect(dsl.id).toBe('wf_x')
    expect(dsl.trigger).toEqual({ type: 'trigger.webhook', config: { path: 'hook', authType: 'hmac', secret: 's' } })
    expect(dsl.variables).toEqual([{ key: 'input', type: 'string' }])
    expect(dsl.settings).toEqual({ recovery: 'forward' })
    // a 被删，指向它的边也清了，只剩新加的 llm_1（无边）
    expect(dsl.nodes!.map((n) => n.id)).toEqual(['llm_1'])
    expect(dsl.edges).toEqual([])
  })
})

describe('editorModel：Saga 补偿打标（缺口收口，设计方案「一之三」/ DSL §6.3）', () => {
  it('isNonCompensableType：逐字对齐后端 NON_COMPENSABLE_TYPES（llm/knowledge_retrieval）', () => {
    expect(isNonCompensableType('llm')).toBe(true)
    expect(isNonCompensableType('knowledge_retrieval')).toBe(true)
    expect(isNonCompensableType('tool')).toBe(false)
    expect(isNonCompensableType('script')).toBe(false)
    expect(isNonCompensableType(undefined)).toBe(false)
  })

  it('getNodeRecovery：只认 forward/compensate，其余（含未声明）归空串', () => {
    expect(getNodeRecovery({ id: 'a' })).toBe('')
    expect(getNodeRecovery({ id: 'a', recovery: 'forward' })).toBe('forward')
    expect(getNodeRecovery({ id: 'a', recovery: 'compensate' })).toBe('compensate')
    expect(getNodeRecovery({ id: 'a', recovery: 'whatever' })).toBe('')
  })

  it('setNodeRecovery：切 compensate 时补建 compensation 对象（面板字段有真实引用可写）', () => {
    const node: EditorDslNode = { id: 'a', type: 'tool' }
    setNodeRecovery(node, 'compensate')
    expect(node.recovery).toBe('compensate')
    expect(node.compensation).toEqual({})
    // 已有的 compensation 不被覆盖
    node.compensation = { compensate_ref: 'form_data_delete' }
    setNodeRecovery(node, 'compensate')
    expect(node.compensation).toEqual({ compensate_ref: 'form_data_delete' })
  })

  it('setNodeRecovery：切走 compensate 时整个删掉 compensation（防后端 warn 的脏声明）', () => {
    const node: EditorDslNode = {
      id: 'a',
      type: 'tool',
      recovery: 'compensate',
      compensation: { compensate_ref: 'x' }
    }
    setNodeRecovery(node, 'forward')
    expect(node.recovery).toBe('forward')
    expect(node.compensation).toBeUndefined()
    expect('compensation' in node).toBe(false)
    setNodeRecovery(node, '')
    expect(node.recovery).toBeUndefined()
    expect('recovery' in node).toBe(false)
  })

  it('ensureCompensation：缺失/非对象时重建并挂到节点上，返回的是节点身上的引用', () => {
    const node: EditorDslNode = { id: 'a', type: 'tool' }
    const comp = ensureCompensation(node)
    expect(node.compensation).toBe(comp)
    comp.compensate_ref = 'form_data_delete'
    expect(node.compensation).toEqual({ compensate_ref: 'form_data_delete' })
    node.compensation = 'bad'
    expect(ensureCompensation(node)).toEqual({})
    node.compensation = [1]
    expect(ensureCompensation(node)).toEqual({})
  })

  it('往返保真：compensation/recovery 顶层字段经画布增删后原样保留', () => {
    const dsl: EditorDsl = {
      id: 'wf_x',
      nodes: [
        {
          id: 'a',
          type: 'tool',
          recovery: 'compensate',
          compensation: {
            compensate_ref: 'form_data_delete',
            before_image: { recordId: '{{$.a_out.id}}' },
            idempotency_key: '{{$.execution.id}}:a'
          },
          config: { toolId: 'form_data_create' }
        }
      ],
      edges: [{ from: 'START', to: 'a' }]
    }
    addNode(dsl, 'llm')
    addEdge(dsl, 'a', 'llm_1')
    removeNode(dsl, 'llm_1')
    const kept = dsl.nodes!.find((n) => n.id === 'a')!
    expect(kept.recovery).toBe('compensate')
    expect(kept.compensation).toEqual({
      compensate_ref: 'form_data_delete',
      before_image: { recordId: '{{$.a_out.id}}' },
      idempotency_key: '{{$.execution.id}}:a'
    })
  })
})
