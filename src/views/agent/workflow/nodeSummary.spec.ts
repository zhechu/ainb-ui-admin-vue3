import { describe, expect, it } from 'vitest'
import {
  NODE_TYPE_GROUPS,
  NODE_TYPE_META,
  buildSummaryNodes,
  flowStepsText,
  nodeDetailLines,
  nodeHasRequiredGap,
  nodeTypeMeta,
  summarizeNode
} from './nodeSummary'

/**
 * nodeSummary 纯逻辑单测（AI助手 UX 修复 / 第 0 刀）
 *
 * 钉住三件事：① 13 种类型每种都能产出一句非空人话摘要，缺字段如实说「未配置」而不抛；
 * ② 详情行标签走 nodeConfigSchema 的中文化，值为空跳过；③ 走向文本正确展开条件边、跳过悬空端点。
 */
describe('nodeSummary', () => {
  it('NODE_TYPE_META：13 种类型齐、分组名都在 GROUPS 里、label 非空', () => {
    const types = Object.keys(NODE_TYPE_META)
    expect(types).toHaveLength(13)
    for (const t of [
      'tool',
      'llm',
      'knowledge_retrieval',
      'script',
      'condition.rule',
      'condition.llm',
      'parallel',
      'iteration',
      'hitl.confirm',
      'hitl.bpm_approval',
      'wait',
      'agent_loop',
      'sub_workflow'
    ]) {
      expect(types).toContain(t)
      expect(NODE_TYPE_META[t].label).toBeTruthy()
      expect(NODE_TYPE_META[t].description).toBeTruthy()
      expect(NODE_TYPE_GROUPS).toContain(NODE_TYPE_META[t].group)
    }
  })

  it('nodeTypeMeta：未知类型兜底不抛，label 回落原始 type', () => {
    expect(nodeTypeMeta('whatever').label).toBe('whatever')
    expect(nodeTypeMeta(undefined).label).toBe('节点')
    expect(nodeTypeMeta('whatever').tagType).toBe('info')
  })

  it('summarizeNode：13 种类型各产出一句含关键信息的人话（不甩变量名/入参键名）', () => {
    expect(summarizeNode({ type: 'tool', config: { toolId: 'form_data_create', args: { a: 1, b: 2 }, outputVar: 'r' } })).toBe(
      '调用工具「form_data_create」'
    )
    expect(summarizeNode({ type: 'llm', config: { prompt: '总结以下客服记录', outputVar: 'sum' } })).toBe(
      '让大模型：「总结以下客服记录」'
    )
    expect(
      summarizeNode({
        type: 'condition.rule',
        config: { branches: [{ target: 'big' }, { target: 'small' }], default: 'small' }
      })
    ).toBe('按变量值分 2 路：big、small；都不命中走「small」')
    expect(summarizeNode({ type: 'condition.llm', config: { prompt: '判断情绪', choices: ['正面', '负面'] } })).toBe(
      '让模型在 2 个选项中选路：正面、负面'
    )
    expect(
      summarizeNode({ type: 'knowledge_retrieval', config: { knowledgeBaseId: 7, query: '退货政策', topK: 3, outputVar: 'docs' } })
    ).toBe('从知识库检索「退货政策」，取前 3 条')
    expect(summarizeNode({ type: 'hitl.confirm', config: {} })).toBe('暂停流程，等用户点「同意 / 拒绝」后再继续')
    expect(summarizeNode({ type: 'hitl.bpm_approval', config: { bpmProcessDefKey: 'oa_leave' } })).toBe(
      '发起 BPM 审批「oa_leave」，等审批有结果后继续'
    )
    expect(summarizeNode({ type: 'parallel', config: { branches: [['a'], ['b']] } })).toBe('2 条分支同时执行，全部完成后汇聚')
    expect(summarizeNode({ type: 'wait', config: { waitType: 'duration', duration: 30 } })).toBe('等待 30 秒后继续')
    expect(summarizeNode({ type: 'wait', config: { waitType: 'event', eventKey: 'order_paid' } })).toBe(
      '挂起等待外部事件「order_paid」'
    )
    expect(summarizeNode({ type: 'script', config: { code: 'return 1', outputVar: 'x' } })).toBe('执行一段 JavaScript 计算')
    expect(summarizeNode({ type: 'agent_loop', config: { goal: '查清库存', tools: ['a', 'b'], maxSteps: 5 } })).toBe(
      '让模型自主完成：「查清库存」，可用工具 2 个，最多 5 步'
    )
    expect(summarizeNode({ type: 'iteration', config: { itemsVar: 'orders', itemVar: 'o', body: ['n1', 'n2'] } })).toBe(
      '逐项处理一个列表里的每一项，循环体 2 个节点'
    )
    expect(summarizeNode({ type: 'sub_workflow', config: { workflowId: 'wf_sub', version: 3 } })).toBe(
      '调用另一条已发布流程「wf_sub」 v3'
    )
  })

  it('summarizeNode：缺字段如实说未配置，不抛', () => {
    expect(summarizeNode({ type: 'tool', config: {} })).toBe('调用工具（未选择工具）')
    expect(summarizeNode({ type: 'llm', config: {} })).toBe('调用大模型生成文本（未填写提示词）')
    expect(summarizeNode({ type: 'condition.rule', config: {} })).toBe('按规则走分支（未配置分支）')
    expect(summarizeNode({ type: 'sub_workflow' })).toBe('调用子流程（未选择流程）')
    expect(summarizeNode(null)).toBe('')
    expect(summarizeNode(undefined)).toBe('')
  })

  it('summarizeNode：超长 prompt 截断加省略号', () => {
    const s = summarizeNode({ type: 'llm', config: { prompt: 'x'.repeat(100) } })
    expect(s.length).toBeLessThan(60)
    expect(s).toContain('…')
  })

  it('summarizeNode：未知类型兜底列 config 键名', () => {
    expect(summarizeNode({ type: 'future_type', config: { foo: 1, bar: 2 } })).toBe('future_type节点（foo、bar）')
    expect(summarizeNode({ type: 'future_type', config: {} })).toBe('')
  })

  it('nodeHasRequiredGap：必填缺失/空值判缺，配齐判无缺，未知类型不判', () => {
    expect(nodeHasRequiredGap({ type: 'tool', config: {} })).toBe(true)
    expect(nodeHasRequiredGap({ type: 'tool', config: { toolId: ' ' } })).toBe(false)
    expect(nodeHasRequiredGap({ type: 'tool', config: { toolId: 't1' } })).toBe(false)
    expect(nodeHasRequiredGap({ type: 'condition.rule', config: { branches: [] } })).toBe(true)
    expect(nodeHasRequiredGap({ type: 'hitl.confirm', config: {} })).toBe(false)
    expect(nodeHasRequiredGap({ type: 'unknown_x', config: {} })).toBe(false)
    expect(nodeHasRequiredGap(null)).toBe(false)
  })

  it('nodeDetailLines：schema 键用中文标签、空值跳过、schema 外键回落原始键名、顶层字段也列出', () => {
    const lines = nodeDetailLines({
      type: 'llm',
      config: { prompt: '总结记录', systemPrompt: '', customKey: { a: 1 } },
      timeoutSeconds: 60
    })
    const labels = lines.map((l) => l.label)
    expect(labels).toContain('提示词')
    expect(labels).toContain('customKey')
    expect(labels).toContain('超时（秒）')
    expect(labels).not.toContain('系统提示词') // 空值跳过
    expect(lines.find((l) => l.label === '超时（秒）')?.value).toBe('60')
    // 对象值渲染成「键=值」而非原样 JSON
    expect(lines.find((l) => l.label === 'customKey')?.value).toBe('a=1')
  })

  it('buildSummaryNodes：残缺元素跳过，正常元素带 summary/details', () => {
    const list = buildSummaryNodes([{ id: 'a', type: 'tool', name: '查数据', config: { toolId: 't' } }, null, { type: 'llm' }])
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('查数据')
    expect(list[0].summary).toContain('调用工具')
    expect(list[0].details.length).toBeGreaterThan(0)
    expect(buildSummaryNodes(undefined)).toEqual([])
  })

  it('flowStepsText：普通边/条件边 case/default/START/END 翻译', () => {
    const nodes = [
      { id: 'check', name: '规则判断' },
      { id: 'ok', name: '通过处理' }
    ]
    const lines = flowStepsText(nodes, [
      { from: 'START', to: 'check' },
      { from: 'check', type: 'conditional', cases: { yes: 'ok' }, default: 'END' },
      { from: 'ok', to: 'END' }
    ])
    expect(lines).toEqual(['开始 → 规则判断', '规则判断 →（yes） 通过处理', '规则判断 →（默认） 结束', '通过处理 → 结束'])
  })

  it('flowStepsText：悬空端点的边跳过，无名节点回退「步骤 N」，不崩不谎报', () => {
    const lines = flowStepsText([{ id: 'a' }], [
      { from: 'a', to: 'ghost' },
      { from: 'ghost', to: 'a' },
      { from: 'a', to: 'END' }
    ])
    expect(lines).toEqual(['步骤 1 → 结束'])
  })

  it('flowStepsText：nodes/edges 缺失或非法返回空数组', () => {
    expect(flowStepsText(undefined, undefined)).toEqual([])
    expect(flowStepsText(null, null)).toEqual([])
  })
})

/**
 * 名称解析器注入（重构 S1 / L1）——「注入 / 不注入」两态
 *
 * 🔴 钉住的关键不是「注入了能出中文」（那是新功能，本来就会写对），
 * 而是**不注入时必须与注入前逐字一致**：nodeSummary 是三处共用的摘要来源，
 * 现有 3 个 spec 与 replayModel/layout 的默认调用都不传解析器，
 * 一旦回落态漂移，画布、聊天卡片、回放会在没人察觉的情况下同时改口。
 */
describe('nodeSummary：名称解析器两态', () => {
  const resolver = {
    toolLabel: (k?: string | null) =>
      ({ datamodel_create: '创建数据表', form_data_create: '新增表单数据' })[k ?? ''] ?? (k || ''),
    workflowLabel: (c?: string | null) => (c === 'wf_asset_check' ? '资产盘点' : c || '')
  }

  const toolNode = { type: 'tool', config: { toolId: 'datamodel_create', outputVar: 'r' } }
  const subNode = { type: 'sub_workflow', config: { workflowId: 'wf_asset_check', version: 2 } }

  it('不注入 / 注入 null / 注入空对象：三者输出逐字相同，且等于今天的字面量', () => {
    const today = ['调用工具「datamodel_create」', '调用另一条已发布流程「wf_asset_check」 v2']
    for (const r of [undefined, null, {}]) {
      expect(summarizeNode(toolNode, r)).toBe(today[0])
      expect(summarizeNode(subNode, r)).toBe(today[1])
    }
    // 与「完全不传第二参」也必须一致 —— 这是可选参的语义底线
    expect(summarizeNode(toolNode)).toBe(today[0])
    expect(summarizeNode(subNode)).toBe(today[1])
  })

  it('注入后：中文名与原键并排（运维要 key、业务要中文，两者都不能少）', () => {
    expect(summarizeNode(toolNode, resolver)).toBe('调用工具「创建数据表」（datamodel_create）')
    expect(summarizeNode(subNode, resolver)).toBe(
      '调用另一条已发布流程「资产盘点」（wf_asset_check） v2'
    )
  })

  it('解析不出中文名时回落原键，绝不产出空「」', () => {
    const unknown = { type: 'tool', config: { toolId: 'some_new_tool' } }
    expect(summarizeNode(unknown, resolver)).toBe('调用工具「some_new_tool」')
    // 🔴 这条是「约束无强制点」那一类缺陷的防线：回落分支若少了 prefix，
    // 用户会看到「调用工具「」（some_new_tool）」这种比原样更坏的输出
    expect(summarizeNode(unknown, resolver)).not.toContain('「」')
    expect(summarizeNode({ type: 'sub_workflow', config: { workflowId: 'wf_x' } }, resolver)).toBe(
      '调用另一条已发布流程「wf_x」'
    )
  })

  it('缺字段的兜底文案不受解析器影响', () => {
    expect(summarizeNode({ type: 'tool', config: {} }, resolver)).toBe('调用工具（未选择工具）')
    expect(summarizeNode({ type: 'sub_workflow' }, resolver)).toBe('调用子流程（未选择流程）')
  })

  it('解析器只给一部分方法也不崩（各方法皆可选）', () => {
    expect(summarizeNode(toolNode, { workflowLabel: resolver.workflowLabel })).toBe(
      '调用工具「datamodel_create」'
    )
    expect(summarizeNode(subNode, { toolLabel: resolver.toolLabel })).toBe(
      '调用另一条已发布流程「wf_asset_check」 v2'
    )
  })

  it('nodeDetailLines：toolId 翻中文、agent_loop.tools 逐个翻、非字符串原样', () => {
    const lines = nodeDetailLines({ type: 'tool', config: { toolId: 'datamodel_create' } }, resolver)
    expect(lines.find((l) => l.label === '工具')?.value).toBe('创建数据表')

    const loop = nodeDetailLines(
      { type: 'agent_loop', config: { goal: '盘点', tools: ['datamodel_create', 'unknown_x'] } },
      resolver
    )
    // 数组仍由 readable 拼「、」，形态与不注入时一致，只是每项换了名
    expect(loop.find((l) => l.label === '可用只读工具')?.value).toBe('创建数据表、unknown_x')

    // 不注入 → 原键
    expect(
      nodeDetailLines({ type: 'tool', config: { toolId: 'datamodel_create' } }).find(
        (l) => l.label === '工具'
      )?.value
    ).toBe('datamodel_create')
  })

  it('buildSummaryNodes：解析器同时透传给 summary 与 details', () => {
    const [node] = buildSummaryNodes(
      [{ id: 'n1', type: 'tool', name: '建表', config: { toolId: 'form_data_create' } }],
      resolver
    )
    expect(node.summary).toBe('调用工具「新增表单数据」（form_data_create）')
    expect(node.details.find((l) => l.label === '工具')?.value).toBe('新增表单数据')
  })
})
