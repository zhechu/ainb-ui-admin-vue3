import { describe, expect, it } from 'vitest'
import type { WorkflowEventVO } from '@/api/agent/workflow'
import type { EditorDsl } from '../editorModel'
import {
  buildSandboxInputFields,
  buildSandboxOverlay,
  coerceInputValue,
  collectSandboxInput,
  createSandboxRun,
  diffState,
  isMockValue,
  parseSandboxInputText,
  reduceSandboxEvent,
  sandboxFieldJsonError
} from './sandboxModel'

/**
 * sandboxModel 纯逻辑单测（Req4b / Phase D）
 *
 * 沙箱把后端事件流折叠成「每节点一行」的时间线，是面板与画布高亮的唯一事实源，最适合纯函数单测：
 * 覆盖 建run、META/NODE/INTERRUPTED/DONE/ERROR 五类事件折叠、写操作 mock 标注、输出差异、
 * 耗时估算（注入时钟）、终态 skip 收敛，以及测试输入的 建表单/类型转换/收集/JSON 解析。
 */

/** 线性 START→step_1→step_2→END 的 DSL，工具节点声明 outputVar */
const linearDsl = (): EditorDsl => ({
  nodes: [
    { id: 'step_1', type: 'tool', name: '查数据', config: { toolId: 'data_interface_list', outputVar: 'listOut' } },
    { id: 'step_2', type: 'llm', name: '生成文本', config: { prompt: 'hi', outputVar: 'output' } }
  ],
  edges: [
    { from: 'START', to: 'step_1' },
    { from: 'step_1', to: 'step_2' },
    { from: 'step_2', to: 'END' }
  ],
  variables: [
    { key: 'input', type: 'string', required: false },
    { key: 'listOut', type: 'object' },
    { key: 'output', type: 'string' }
  ]
})

const ev = (e: Partial<WorkflowEventVO>): WorkflowEventVO => e as WorkflowEventVO

describe('createSandboxRun', () => {
  it('按 DSL 节点顺序建行，全部 wait，completedCount=0', () => {
    const run = createSandboxRun(linearDsl(), { input: '你好' })
    expect(run.status).toBe('idle')
    expect(run.rows.map((r) => r.nodeId)).toEqual(['step_1', 'step_2'])
    expect(run.rows.every((r) => r.status === 'wait')).toBe(true)
    expect(run.completedCount).toBe(0)
    expect(run.initialInput).toEqual({ input: '你好' })
  })

  it('无名节点回落「步骤 N」，类型中文名来自权威目录', () => {
    const run = createSandboxRun({ nodes: [{ id: 'a', type: 'llm' }], edges: [] })
    expect(run.rows[0].name).toBe('步骤 1')
    expect(run.rows[0].typeLabel).toBe('大模型')
  })
})

describe('reduceSandboxEvent — META/NODE 线性推进', () => {
  it('META 置 running，并把唯一入口节点标 running', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META', executionId: -1, threadName: 'sandbox:x' }), 1000)
    expect(run.status).toBe('running')
    expect(run.threadName).toBe('sandbox:x')
    expect(run.rows[0].status).toBe('running')
    expect(run.activeNodeId).toBe('step_1')
  })

  it('NODE 标 success、算输出差异、记输入快照、推进 completedCount 与 seq', () => {
    const run = createSandboxRun(linearDsl(), { input: 'hi' })
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    reduceSandboxEvent(
      run,
      ev({ type: 'NODE', nodeId: 'step_1', state: { input: 'hi', listOut: { rows: [1, 2] } } }),
      1500
    )
    const r1 = run.rows[0]
    expect(r1.status).toBe('success')
    expect(r1.seq).toBe(1)
    expect(r1.output).toEqual({ listOut: { rows: [1, 2] } }) // 只差异键，input 未变故不含
    expect(r1.input).toEqual({ input: 'hi' }) // 跑之前看到的世界
    expect(r1.durationMs).toBe(500) // 1500-1000
    expect(run.completedCount).toBe(1)
  })

  it('完成一个节点后，唯一线性后继被标 running（画布高亮前移）', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    reduceSandboxEvent(run, ev({ type: 'NODE', nodeId: 'step_1', state: { listOut: 1 } }), 1200)
    expect(run.rows[1].status).toBe('running')
    expect(run.activeNodeId).toBe('step_2')
  })

  it('声明了 outputVar 但差异未含时，兜底把该变量补进输出', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    // prevState 已含 listOut=同值 → 差异为空；仍应兜底补出 outputVar
    run.prevState = { listOut: 'X' }
    reduceSandboxEvent(run, ev({ type: 'NODE', nodeId: 'step_1', state: { listOut: 'X' } }), 1100)
    expect(run.rows[0].output).toEqual({ listOut: 'X' })
  })

  it('忽略合成端点 id（__START__/END），不建行', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    reduceSandboxEvent(run, ev({ type: 'NODE', nodeId: '__START__', state: {} }), 1001)
    reduceSandboxEvent(run, ev({ type: 'NODE', nodeId: 'END', state: {} }), 1002)
    expect(run.rows.map((r) => r.nodeId)).toEqual(['step_1', 'step_2'])
    expect(run.completedCount).toBe(0)
  })

  it('运行中出现 DSL 未声明的节点 id → 追加一行（不丢进度）', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    reduceSandboxEvent(run, ev({ type: 'NODE', nodeId: 'sub_inner_1', state: { x: 1 } }), 1100)
    expect(run.rows.map((r) => r.nodeId)).toContain('sub_inner_1')
  })
})

describe('reduceSandboxEvent — 写操作 mock 标注', () => {
  it('输出含 __sandboxMock 占位 → 节点标 mock、anyMocked=true', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    reduceSandboxEvent(
      run,
      ev({
        type: 'NODE',
        nodeId: 'step_1',
        state: { listOut: { __sandboxMock: true, tool: 'form_create', message: '已跳过' } }
      }),
      1100
    )
    expect(run.rows[0].status).toBe('mock')
    expect(run.rows[0].mocked).toBe(true)
    expect(run.anyMocked).toBe(true)
  })

  it('mock 占位被包进数组/对象也能识别（递归一层以上）', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    reduceSandboxEvent(
      run,
      ev({ type: 'NODE', nodeId: 'step_1', state: { listOut: { results: [{ __sandboxMock: true }] } } }),
      1100
    )
    expect(run.rows[0].mocked).toBe(true)
  })

  it('isMockValue 只认顶层标记', () => {
    expect(isMockValue({ __sandboxMock: true })).toBe(true)
    expect(isMockValue({ a: 1 })).toBe(false)
    expect(isMockValue(null)).toBe(false)
  })
})

describe('reduceSandboxEvent — 终态', () => {
  it('DONE 置 done、存 finalState、未走到的行收敛为 skip、清 activeNodeId', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    reduceSandboxEvent(run, ev({ type: 'NODE', nodeId: 'step_1', state: { listOut: 1 } }), 1100)
    reduceSandboxEvent(run, ev({ type: 'DONE', state: { output: '完成' } }), 2000)
    expect(run.status).toBe('done')
    expect(run.finalState).toEqual({ output: '完成' })
    expect(run.rows[0].status).toBe('success')
    expect(run.rows[1].status).toBe('skip') // step_2 没跑到
    expect(run.activeNodeId).toBeUndefined()
    expect(run.durationMs).toBe(1000)
  })

  it('INTERRUPTED 置 interrupted、该节点标 interrupted、记 banner id', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    reduceSandboxEvent(run, ev({ type: 'INTERRUPTED', nodeId: 'step_1' }), 1500)
    expect(run.status).toBe('interrupted')
    expect(run.rows[0].status).toBe('interrupted')
    expect(run.interruptNodeId).toBe('step_1')
    expect(run.rows[1].status).toBe('skip')
  })

  it('ERROR 置 failed、把正在跑的节点标 fail 并带错误信息', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    // step_1 完成后 step_2 被标 running
    reduceSandboxEvent(run, ev({ type: 'NODE', nodeId: 'step_1', state: { listOut: 1 } }), 1100)
    expect(run.rows[1].status).toBe('running')
    reduceSandboxEvent(run, ev({ type: 'ERROR', errorMsg: '模型超时' }), 1600)
    expect(run.status).toBe('failed')
    expect(run.error).toBe('模型超时')
    expect(run.rows[1].status).toBe('fail')
    expect(run.rows[1].errorMsg).toBe('模型超时')
  })

  it('未知事件类型不改变 run（default 分支）', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'WEIRD' as any }), 1000)
    expect(run.status).toBe('idle')
  })
})

describe('diffState', () => {
  it('只回新增/变更的键，值相等的键不回', () => {
    const d = diffState({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })
    expect(d).toEqual({ b: 3, c: 4 })
  })
  it('prev 为空时 next 全量算新增', () => {
    expect(diffState(undefined, { x: 1 })).toEqual({ x: 1 })
  })
  it('对象值用稳定 JSON 比较，内容相同不算变更', () => {
    expect(diffState({ o: { k: 1 } }, { o: { k: 1 } })).toEqual({})
  })
})

describe('buildSandboxInputFields', () => {
  it('没有节点产出它、也不是 required 的变量都算入参（不看类型）', () => {
    const dsl: EditorDsl = {
      nodes: [],
      edges: [],
      variables: [
        { key: 'input', type: 'string' },
        { key: 'listOut', type: 'object' }, // 没有节点产出它 → 仍算入参（旧实现按类型把它藏了）
        { key: 'amount', type: 'number', required: true },
        { key: 'payload', type: 'object', required: true }
      ]
    }
    const fields = buildSandboxInputFields(dsl)
    expect(fields.map((f) => f.key)).toEqual(['input', 'listOut', 'amount', 'payload'])
    expect(fields.find((f) => f.key === 'amount')!.required).toBe(true)
    expect(fields.find((f) => f.key === 'input')!.hint).toBe('文本')
    expect(fields.find((f) => f.key === 'listOut')!.hint).toContain('JSON 对象')
  })

  it('节点自己产出的变量不当测试输入（哪怕它是标量）', () => {
    // 🔴 回归：经典案例的 variables 里 report/formList 都是节点 outputVar 产出的，
    //    旧实现按「标量就收」把 report 摆给作者填——填了也会被节点覆写，纯属误导。
    const dsl: EditorDsl = {
      nodes: [
        { id: 'n1', type: 'tool', config: { toolId: 'form_list', outputVar: 'formList' } },
        { id: 'n2', type: 'llm', config: { prompt: 'p', outputVar: 'report' } }
      ],
      edges: [],
      variables: [
        { key: 'input', type: 'string' },
        { key: 'formList', type: 'object' },
        { key: 'report', type: 'string' }
      ]
    }
    expect(buildSandboxInputFields(dsl).map((f) => f.key)).toEqual(['input'])
  })

  it('required 优先于「被产出」判定：作者显式要外部给值就照收', () => {
    const dsl: EditorDsl = {
      nodes: [{ id: 'n1', type: 'llm', config: { outputVar: 'report' } }],
      edges: [],
      variables: [{ key: 'report', type: 'string', required: true }]
    }
    expect(buildSandboxInputFields(dsl).map((f) => f.key)).toEqual(['report'])
  })

  it('outputVar 前后带空格也能认出是同一个变量', () => {
    const dsl: EditorDsl = {
      nodes: [{ id: 'n1', type: 'llm', config: { outputVar: '  report  ' } }],
      edges: [],
      variables: [{ key: 'report', type: 'string' }]
    }
    expect(buildSandboxInputFields(dsl)).toEqual([])
  })
})

describe('sandboxFieldJsonError', () => {
  it('空值不报错（是否必填由必填校验负责，格式校验只管填了的）', () => {
    expect(sandboxFieldJsonError('', 'object')).toBe('')
    expect(sandboxFieldJsonError(undefined, 'array')).toBe('')
    expect(sandboxFieldJsonError('   ', 'number')).toBe('')
  })
  it('number 填了非数字 → 报错', () => {
    expect(sandboxFieldJsonError('100', 'number')).toBe('')
    expect(sandboxFieldJsonError('abc', 'number')).toContain('数字')
  })
  it('object 填了数组 / 标量 / 非法 JSON → 报错', () => {
    expect(sandboxFieldJsonError('{"a":1}', 'object')).toBe('')
    expect(sandboxFieldJsonError('[1,2]', 'object')).toContain('JSON 对象')
    expect(sandboxFieldJsonError('123', 'object')).toContain('JSON 对象')
    expect(sandboxFieldJsonError('{a:1}', 'object')).toContain('JSON 格式错误')
  })
  it('array 填了对象 / 非法 JSON → 报错', () => {
    expect(sandboxFieldJsonError('[1,2]', 'array')).toBe('')
    expect(sandboxFieldJsonError('{"a":1}', 'array')).toContain('JSON 数组')
    expect(sandboxFieldJsonError('[1,2', 'array')).toContain('JSON 格式错误')
  })
  it('any：看着像 JSON 才校验，普通文本放行', () => {
    expect(sandboxFieldJsonError('你好', 'any')).toBe('')
    expect(sandboxFieldJsonError('{"a":1}', 'any')).toBe('')
    expect(sandboxFieldJsonError('{a:1}', 'any')).toContain('JSON 格式错误')
  })
  it('string / boolean 不做 JSON 校验', () => {
    expect(sandboxFieldJsonError('{a:1}', 'string')).toBe('')
    expect(sandboxFieldJsonError('{a:1}', 'boolean')).toBe('')
  })
})

describe('coerceInputValue / collectSandboxInput', () => {
  it('按类型转换：number/boolean/object/array/string', () => {
    expect(coerceInputValue('42', 'number')).toBe(42)
    expect(coerceInputValue('abc', 'number')).toBe('abc') // 非数字回落原文
    expect(coerceInputValue('true', 'boolean')).toBe(true)
    expect(coerceInputValue('是', 'boolean')).toBe(true)
    expect(coerceInputValue('no', 'boolean')).toBe(false)
    expect(coerceInputValue('{"a":1}', 'object')).toEqual({ a: 1 })
    expect(coerceInputValue('[1,2]', 'array')).toEqual([1, 2])
    expect(coerceInputValue('  hi ', 'string')).toBe('hi')
    expect(coerceInputValue('', 'string')).toBeUndefined()
  })
  it('any 类型：像 JSON 就解析，否则当字符串', () => {
    expect(coerceInputValue('{"a":1}', 'any')).toEqual({ a: 1 })
    expect(coerceInputValue('plain', 'any')).toBe('plain')
  })
  it('collectSandboxInput 跳过空值，不塞 undefined 键', () => {
    const out = collectSandboxInput([
      { key: 'input', type: 'string', value: '你好' },
      { key: 'amount', type: 'number', value: '' },
      { key: 'flag', type: 'boolean', value: 'true' }
    ])
    expect(out).toEqual({ input: '你好', flag: true })
  })
})

describe('parseSandboxInputText', () => {
  it('合法 JSON 对象 → ok', () => {
    expect(parseSandboxInputText('{"input":"hi"}')).toEqual({ ok: true, value: { input: 'hi' } })
  })
  it('空文本 → ok 空对象', () => {
    expect(parseSandboxInputText('   ')).toEqual({ ok: true, value: {} })
  })
  it('非对象 JSON（数组/标量）→ 报错', () => {
    expect(parseSandboxInputText('[1,2]').ok).toBe(false)
    expect(parseSandboxInputText('123').ok).toBe(false)
  })
  it('非法 JSON → ok:false 且带错误信息', () => {
    const r = parseSandboxInputText('{bad json}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('JSON')
  })
})

describe('buildSandboxOverlay', () => {
  it('投影已完成节点的状态色，wait 态不进覆盖层', () => {
    const run = createSandboxRun(linearDsl())
    reduceSandboxEvent(run, ev({ type: 'META' }), 1000)
    reduceSandboxEvent(run, ev({ type: 'NODE', nodeId: 'step_1', state: { listOut: 1 } }), 1100)
    const overlay = buildSandboxOverlay(run)
    expect(overlay.step_1).toMatchObject({ status: 'success' })
    expect(overlay.step_1.color).toBeTruthy()
    expect(overlay.step_2).toMatchObject({ status: 'running' }) // 线性后继被标 running
    // 未涉及的节点不在覆盖层里
    expect(Object.keys(overlay)).toEqual(expect.arrayContaining(['step_1', 'step_2']))
  })

  it('全新 run（全 wait）→ 空覆盖层（不染画布）', () => {
    const run = createSandboxRun(linearDsl())
    expect(buildSandboxOverlay(run)).toEqual({})
  })
})
