import { describe, expect, it } from 'vitest'
import type { EditorDsl } from '../editorModel'
import {
  buildReference,
  parseReference,
  collectRoots,
  producersOf,
  ancestorsOf,
  computeUpstreamOutputs,
  validateReferences,
  howDownstreamReferences
} from './ioReference'

/**
 * ioReference 纯逻辑单测（Phase E / Req5：类型化端口的引用构造 / 解析 / 上游可达性）
 *
 * 🔴 钉四件事：① 引用串构造/解析与既有 `{{$.var}}` 运行时同口径；② 上游产出收集沿反向边可达；
 *    ③ 可达性只出「警告」且与后端同口径——引用下游产出才警告，引用上游/并行汇合/声明变量都不误报；
 *    ④ 契约里没登记默认名的产出键会整个掉出可达性判定（正反各钉一条，见文件末尾那个 describe）。
 * 全是纯函数，不碰 Vue。
 */
describe('ioReference · 引用串构造/解析', () => {
  it('buildReference 造出既有运行时认识的模板串', () => {
    expect(buildReference('out')).toBe('{{$.out}}')
    expect(buildReference('out', 'id')).toBe('{{$.out.id}}')
    expect(buildReference('out', 'a.b')).toBe('{{$.out.a.b}}')
    // 容错：清掉路径前导的 $ . 空格
    expect(buildReference('out', '.id')).toBe('{{$.out.id}}')
    expect(buildReference('out', '$.id')).toBe('{{$.out.id}}')
    // 空变量名 → 空串（不造非法模板）
    expect(buildReference('')).toBe('')
    expect(buildReference('   ')).toBe('')
  })

  it('parseReference 只认「整段就是一个引用」', () => {
    expect(parseReference('{{$.out}}')).toEqual({ root: 'out', path: '' })
    expect(parseReference('{{$.out.id}}')).toEqual({ root: 'out', path: 'id' })
    expect(parseReference(' {{ $.out.a.b }} ')).toEqual({ root: 'out', path: 'a.b' })
    // 混排 / 多段 / 非引用 → null
    expect(parseReference('前缀{{$.out}}')).toBeNull()
    expect(parseReference('{{$.a}}{{$.b}}')).toBeNull()
    expect(parseReference('普通文本')).toBeNull()
    expect(parseReference(123)).toBeNull()
    expect(parseReference(null)).toBeNull()
  })

  it('collectRoots 递归下钻字符串/对象/数组，收齐根变量名', () => {
    const roots = collectRoots({
      a: '{{$.x}}',
      b: ['{{$.y}}', { c: 'literal {{$.z.d}}' }],
      d: 'no ref here'
    })
    expect([...roots].sort()).toEqual(['x', 'y', 'z'])
    // 空 / 非引用
    expect(collectRoots({}).size).toBe(0)
    expect(collectRoots('plain').size).toBe(0)
    expect(collectRoots(null).size).toBe(0)
  })
})

/** 造一份「START → a(tool,产出 out) → b(llm) → END」的最小 DSL */
const linearDsl = (): EditorDsl => ({
  nodes: [
    { id: 'a', type: 'tool', name: '查数据', config: { toolId: 'data_interface_list', outputVar: 'out' } },
    { id: 'b', type: 'llm', name: '总结', config: { prompt: '总结 {{$.out}}', outputVar: 'summary' } }
  ],
  edges: [
    { from: 'START', to: 'a' },
    { from: 'a', to: 'b' },
    { from: 'b', to: 'END' }
  ]
})

describe('ioReference · 上游产出与可达性', () => {
  it('producersOf：变量名 → 产出节点 id（仅契约登记的输出端口）', () => {
    const p = producersOf(linearDsl())
    expect([...(p.get('out') ?? [])]).toEqual(['a'])
    expect([...(p.get('summary') ?? [])]).toEqual(['b'])
    // hitl.confirm 无 config 也产出默认 hitl_approved
    const h = producersOf({
      nodes: [{ id: 'h', type: 'hitl.confirm', config: {} }],
      edges: []
    })
    expect([...(h.get('hitl_approved') ?? [])]).toEqual(['h'])
  })

  it('ancestorsOf：反向 BFS 求祖先（含/不含自身）', () => {
    const dsl = linearDsl()
    const withSelf = ancestorsOf(dsl, 'b')
    expect(withSelf.has('a')).toBe(true)
    expect(withSelf.has('b')).toBe(true)
    expect(withSelf.has('START')).toBe(true)
    const withoutSelf = ancestorsOf(dsl, 'b', { includeSelf: false })
    expect(withoutSelf.has('a')).toBe(true)
    expect(withoutSelf.has('b')).toBe(false)
  })

  it('computeUpstreamOutputs：b 的上游只有 a，产出 out', () => {
    const ups = computeUpstreamOutputs(linearDsl(), 'b')
    expect(ups).toHaveLength(1)
    expect(ups[0]).toMatchObject({ varName: 'out', dataType: 'object', nodeId: 'a', nodeName: '查数据' })
    expect(ups[0].dataTypeLabel).toBe('对象')
    // a 的上游是 START（伪根，无产出）→ 空
    expect(computeUpstreamOutputs(linearDsl(), 'a')).toHaveLength(0)
    // 不存在节点 → 空
    expect(computeUpstreamOutputs(linearDsl(), 'ghost')).toHaveLength(0)
  })

  it('computeUpstreamOutputs：并行汇合节点能同时看到两分支产出', () => {
    const dsl: EditorDsl = {
      nodes: [
        { id: 'p', type: 'parallel', config: { branches: [['a'], ['b']], join: 'all' } },
        { id: 'a', type: 'tool', name: '查库存', config: { toolId: 'x', outputVar: 'stock' } },
        { id: 'b', type: 'tool', name: '查物流', config: { toolId: 'y', outputVar: 'logi' } },
        { id: 'j', type: 'llm', name: '汇总', config: { prompt: '{{$.stock}} {{$.logi}}', outputVar: 'ans' } }
      ],
      edges: [
        { from: 'START', to: 'p' },
        { from: 'p', to: 'a' },
        { from: 'p', to: 'b' },
        { from: 'a', to: 'j' },
        { from: 'b', to: 'j' },
        { from: 'j', to: 'END' }
      ]
    }
    const ups = computeUpstreamOutputs(dsl, 'j')
    const names = ups.map((u) => u.varName).sort()
    expect(names).toEqual(['logi', 'stock'])
    // 两分支都是 j 的祖先 → 引用它们不应产生可达性警告
    expect(validateReferences(dsl)).toHaveLength(0)
  })

  it('validateReferences：引用「下游产出」的变量 → 警告（不阻断）', () => {
    // first 引用 out，但 out 由下游 second 产出 → first 跑到时 out 还没值
    const dsl: EditorDsl = {
      nodes: [
        { id: 'first', type: 'llm', name: '先用', config: { prompt: '用 {{$.out}}', outputVar: 'x' } },
        { id: 'second', type: 'tool', name: '后产', config: { toolId: 't', outputVar: 'out' } }
      ],
      edges: [
        { from: 'START', to: 'first' },
        { from: 'first', to: 'second' },
        { from: 'second', to: 'END' }
      ]
    }
    const warns = validateReferences(dsl)
    expect(warns).toHaveLength(1)
    expect(warns[0].kind).toBe('unreachable')
    expect(warns[0].nodeId).toBe('first')
    expect(warns[0].varName).toBe('out')
    expect(warns[0].message).toContain('不在它的上游')
    expect(warns[0].message).toContain('out')
  })

  it('validateReferences：引用「上游产出」→ 无警告', () => {
    expect(validateReferences(linearDsl())).toHaveLength(0)
  })

  it('validateReferences：引用声明变量 / input / 未登记变量 → 不警告（避免对老流程误报）', () => {
    const dsl: EditorDsl = {
      variables: [{ key: 'input', type: 'object' }, { key: 'cfg', type: 'string' }],
      trigger: { type: 'trigger.chat', config: { inputVar: 'input' } },
      nodes: [
        {
          id: 'it',
          type: 'iteration',
          name: '循环',
          config: { itemsVar: 'list', itemVar: 'item', body: ['body1'] }
        },
        { id: 'body1', type: 'llm', config: { prompt: '{{$.item}} {{$.cfg}} {{$.input}}', outputVar: 'o' } }
      ],
      edges: [
        { from: 'START', to: 'it' },
        { from: 'it', to: 'END' }
      ]
    }
    // item（循环体 itemVar，未登记为输出）、cfg/input（声明变量）都不是「节点产出」→ 不参与可达性判定
    expect(validateReferences(dsl)).toHaveLength(0)
  })

  it('validateReferences：无任何产出端口 → 直接返回空（短路）', () => {
    const dsl: EditorDsl = {
      nodes: [{ id: 'c', type: 'condition.rule', config: { branches: [], default: 'x' } }],
      edges: [{ from: 'START', to: 'c' }]
    }
    expect(validateReferences(dsl)).toHaveLength(0)
  })

  it('howDownstreamReferences：给出本节点输出的人话 + 下游引用示例', () => {
    const docs = howDownstreamReferences({
      id: 'a',
      type: 'tool',
      name: '查数据',
      config: { outputVar: 'out' }
    })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ varName: 'out', dataType: 'object', example: '{{$.out}}' })
    expect(docs[0].dataTypeLabel).toBe('对象')
    // 未配 outputVar 的 tool → 仍报出兜底名 tool_result（执行器真的会写这个键，瞒着用户才是误导）
    const defaulted = howDownstreamReferences({ id: 'a', type: 'tool', config: {} })
    expect(defaulted).toHaveLength(1)
    expect(defaulted[0].varName).toBe('tool_result')
    expect(defaulted[0].example).toBe('{{$.tool_result}}')
    // hitl.confirm 无 config → 默认 hitl_approved
    const hc = howDownstreamReferences({ id: 'h', type: 'hitl.confirm', config: {} })
    expect(hc).toHaveLength(1)
    expect(hc[0].varName).toBe('hitl_approved')
    expect(hc[0].example).toBe('{{$.hitl_approved}}')
    // 控制流 / 未知类型 → 空
    expect(howDownstreamReferences({ id: 'p', type: 'parallel', config: {} })).toHaveLength(0)
    expect(howDownstreamReferences(null)).toHaveLength(0)
  })
})

/**
 * 🔴 契约默认名漂了会怎样：这两条钉的是「修好之后的收益」，不是「值对不对」。
 *
 * tool.outputVar 的 defaultName 曾写着 null，于是 producersOf 收不到 tool_result，
 * validateReferences 对「没有登记产出的变量」是直接跳过的 —— 结果 {{$.tool_result}} 既不报警也不校验，
 * 用户写对了没人确认、写错了（比如拼成 tool_results）也没人拦。补上默认名后它才真正进入可达性判定。
 *
 * 🔴 为什么必须正反各钉一条：`validateReferences → 0 条警告` 这个结果本身是二义的，
 *    「查过了，确实可达」与「压根没查（变量未登记）」长得一模一样。实测把 defaultName 改回 null 后，
 *    下面反向那份 DSL（tool 在 llm 下游，本该报警）同样返回 0 条 —— 二义性不是假设，是真会同时变绿。
 *    反向那条把这个二义性拆开：它必须报出 1 条 unreachable，才证明正向那条的 0 是「查过且通过」。
 *    （正向那条自己也有一道独立的闸：producersOf 必须登记到 'a'，实测同一变异下它先红。）
 */
describe('ioReference · 契约默认名让 {{$.tool_result}} 真正进入可达性判定', () => {
  /** a(tool，未配 outputVar ⟹ 兜底写 tool_result) 在 b 的上游 */
  const reachableDsl = (): EditorDsl => ({
    nodes: [
      { id: 'a', type: 'tool', name: '查数据', config: { toolId: 'data_interface_list' } },
      { id: 'b', type: 'llm', name: '总结', config: { prompt: '总结 {{$.tool_result}}', outputVar: 'summary' } }
    ],
    edges: [
      { from: 'START', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'END' }
    ]
  })

  it('正向：未配 outputVar 的 tool 也登记为 tool_result 的产出者，下游引用它不报警', () => {
    const dsl = reachableDsl()
    expect([...(producersOf(dsl).get('tool_result') ?? [])]).toEqual(['a'])
    expect(computeUpstreamOutputs(dsl, 'b').map((u) => u.varName)).toContain('tool_result')
    expect(validateReferences(dsl)).toHaveLength(0)
  })

  it('反向：把顺序调过来，同一个引用立刻被判为不可达（证明上面那条真的查过）', () => {
    const dsl: EditorDsl = {
      nodes: [
        { id: 'b', type: 'llm', name: '总结', config: { prompt: '总结 {{$.tool_result}}', outputVar: 'summary' } },
        { id: 'a', type: 'tool', name: '查数据', config: { toolId: 'data_interface_list' } }
      ],
      edges: [
        { from: 'START', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'a', to: 'END' }
      ]
    }
    const warns = validateReferences(dsl)
    expect(warns).toHaveLength(1)
    expect(warns[0]).toMatchObject({ kind: 'unreachable', nodeId: 'b', varName: 'tool_result' })
  })
})
