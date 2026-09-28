/**
 * 节点「输入 / 输出端口」契约 —— 前端镜像（Phase E / Req5）
 *
 * 🔴 与后端 `framework.agent.core.engine.io.NodeIoContract` 逐字同构：同一份「端口目录」两处各存一份。
 *    前端这份用于首屏免请求地画类型化端口 / 渲染引用选择器；后端那份是权威，`GET /agent/workflow-def/node-io-contract`
 *    可拉来校准（见 io-contract e2e）。改端口必须两侧同步，否则画布端口与后端校验口径漂移。
 *
 * 🔴 与 editorModel / nodeConfigSchema / nodeSummary 同款纪律：纯数据 + 纯函数、不依赖 Vue 运行时，便于 vitest 单测。
 * 🔴 契约只描述「某类节点该往哪个 config 键填什么、跑完往哪个变量名写什么、类型是什么」，<b>绝不参与运行时</b>。
 *    端口最终都被落成既有的 `{{$.var}}` 引用与 `config.outputVar`，故对存量已发布流程 100% 向后兼容。
 *
 * 🔴 输入端口的 `key` 逐字对齐 `nodeConfigSchema.ts` 的 config 键；`dataType`/`mode` 仅用于 UI 着色与「可否引用上游」
 *    的提示，<b>非</b>运行期强类型约束（后端仍是弱类型扁平状态）。
 */

import type { EditorDslNode } from '../editorModel'

/** 端口可承载的数据类型（仅用于 UI 展示与提示，不做运行期强校验） */
export type IoDataType = 'string' | 'number' | 'boolean' | 'object' | 'array'

/** 输入端口的填写模式：literal=只填字面量，reference=只引用上游变量，both=两者皆可 */
export type IoMode = 'literal' | 'reference' | 'both'

/** 一个输入端口：对应节点 config 里的一个键 */
export interface InPort {
  /** config 键名（逐字对齐后端读取的键 / nodeConfigSchema 的 key） */
  key: string
  /** 面向业务人员的中文名 */
  label: string
  dataType: IoDataType
  mode: IoMode
  required: boolean
  /** 分组名（如「基础」「模型」），供 UI 折叠分组 */
  group: string
  /** 一句话说明（非技术用户看得懂） */
  hint: string
}

/** 一个输出端口：节点跑完把结果写进哪个变量名 */
export interface OutPort {
  /** 存放「变量名」的 config 键（如 outputVar / approveVar）；null = 无配置键、恒用默认名 */
  configKey: string | null
  /** 未配置时的默认变量名（null = 必须由用户命名） */
  defaultName: string | null
  dataType: IoDataType
  label: string
}

/** 某节点类型的完整 I/O 契约 */
export interface Contract {
  type: string
  label: string
  group: string
  inputs: InPort[]
  outputs: OutPort[]
}

const T_STRING: IoDataType = 'string'
const T_NUMBER: IoDataType = 'number'
const T_BOOLEAN: IoDataType = 'boolean'
const T_OBJECT: IoDataType = 'object'
const T_ARRAY: IoDataType = 'array'

const LITERAL: IoMode = 'literal'
const REFERENCE: IoMode = 'reference'
const BOTH: IoMode = 'both'

const inp = (
  key: string,
  label: string,
  dataType: IoDataType,
  mode: IoMode,
  required: boolean,
  group: string,
  hint: string
): InPort => ({ key, label, dataType, mode, required, group, hint })

const outp = (
  configKey: string | null,
  defaultName: string | null,
  dataType: IoDataType,
  label: string
): OutPort => ({ configKey, defaultName, dataType, label })

/**
 * 13 种合法节点类型的 I/O 契约（与后端 NodeIoContract 声明顺序、键名、类型逐字一致）。
 * 🔴 控制流节点（condition.rule / parallel / iteration / wait / sub_workflow）无数据输出端口 → outputs 为空，
 *    故画布上不给它们画「输出端口」，也不参与上游产出收集（对齐后端「只有登记了输出端口的变量才算节点产出」）。
 */
export const NODE_IO_CONTRACTS: Record<string, Contract> = {
  tool: {
    type: 'tool',
    label: '工具',
    group: '基础',
    inputs: [
      inp('toolId', '工具', T_STRING, LITERAL, true, '基础', '选择要调用的工具（键名）'),
      inp('args', '工具入参', T_OBJECT, BOTH, false, '基础', '参数名 → 值；值可用 {{$.变量}} 引用上游结果')
    ],
    outputs: [outp('outputVar', null, T_OBJECT, '工具返回结果')]
  },
  llm: {
    type: 'llm',
    label: '大模型',
    group: '基础',
    inputs: [
      inp('prompt', '提示词', T_STRING, BOTH, true, '提示', '可用 {{$.变量}} 把上游结果拼进提示词'),
      inp('systemPrompt', '系统提示词', T_STRING, BOTH, false, '提示', '可空；设定模型角色'),
      inp('modelId', '模型', T_NUMBER, LITERAL, false, '模型', '留空=用默认模型'),
      inp('temperature', '温度', T_NUMBER, LITERAL, false, '模型', '越高越有创造力（0~2）'),
      inp('maxTokens', '最大 tokens', T_NUMBER, LITERAL, false, '模型', '限制单次输出长度')
    ],
    outputs: [outp('outputVar', null, T_STRING, '模型生成的文本')]
  },
  knowledge_retrieval: {
    type: 'knowledge_retrieval',
    label: '知识检索',
    group: '基础',
    inputs: [
      inp('knowledgeBaseId', '知识库', T_NUMBER, LITERAL, true, '基础', '选择要检索的知识库'),
      inp('query', '查询内容', T_STRING, BOTH, false, '查询', '检索问题；可用 {{$.变量}}。与「查询变量」二选一'),
      inp('queryVar', '查询变量', T_STRING, REFERENCE, false, '查询', '直接取某个变量的值当查询（优先于查询内容）'),
      inp('topK', '召回条数', T_NUMBER, LITERAL, false, '高级', '取最相关的 N 段'),
      inp('similarityThreshold', '相似度阈值', T_NUMBER, LITERAL, false, '高级', '0~1，越高越严')
    ],
    outputs: [
      outp('outputVar', 'retrieved', T_ARRAY, '检索到的资料段落'),
      outp('citationsVar', null, T_ARRAY, '引用出处（可选，填后聊天可展示来源）')
    ]
  },
  script: {
    type: 'script',
    label: '脚本',
    group: '基础',
    inputs: [
      inp('code', '脚本内容', T_STRING, LITERAL, true, '基础', 'JS 代码，用 state.变量名 读上游结果，return 出结果'),
      inp('language', '语言', T_STRING, LITERAL, false, '高级', '目前仅支持 javascript'),
      inp('timeoutMs', '超时（毫秒）', T_NUMBER, LITERAL, false, '高级', '缺省 2000')
    ],
    outputs: [outp('outputVar', 'script_result', T_OBJECT, '脚本返回值')]
  },
  'condition.rule': {
    type: 'condition.rule',
    label: '规则条件',
    group: '分支与并行',
    inputs: [
      inp('branches', '分支规则', T_ARRAY, LITERAL, true, '分支', '按变量值分组；命中哪组就走哪条线（条件值可用 {{$.变量}}）'),
      inp('default', '默认分支', T_STRING, LITERAL, false, '分支', '都不命中时走哪条')
    ],
    outputs: []
  },
  'condition.llm': {
    type: 'condition.llm',
    label: 'LLM 条件',
    group: '分支与并行',
    inputs: [
      inp('prompt', '判定提示词', T_STRING, BOTH, true, '基础', '可用 {{$.变量}}；让模型据此判断走哪个分支'),
      inp('choices', '候选分支', T_ARRAY, LITERAL, true, '基础', '模型只能从这些候选里选一个'),
      inp('default', '默认分支', T_STRING, LITERAL, false, '基础', '都没命中时的兜底'),
      inp('modelId', '模型', T_NUMBER, LITERAL, false, '模型', '留空=用默认模型')
    ],
    outputs: [outp('outputVar', null, T_STRING, '模型选中的分支')]
  },
  parallel: {
    type: 'parallel',
    label: '并行',
    group: '分支与并行',
    inputs: [inp('join', '汇聚方式', T_STRING, LITERAL, false, '基础', '当前仅支持「全部完成后汇聚」')],
    outputs: []
  },
  iteration: {
    type: 'iteration',
    label: '循环遍历',
    group: '分支与并行',
    inputs: [
      inp('itemsVar', '要遍历的列表', T_STRING, REFERENCE, true, '基础', '一个数组变量名'),
      inp('itemVar', '每项存到', T_STRING, LITERAL, false, '基础', '循环体内用 {{$.itemVar}} 取当前项'),
      inp('body', '循环体节点', T_ARRAY, LITERAL, true, '高级', '参与循环的节点 id；不要把它们连进主 edges')
    ],
    outputs: []
  },
  'hitl.confirm': {
    type: 'hitl.confirm',
    label: '人工确认',
    group: '人工介入',
    inputs: [],
    outputs: [outp('approveVar', 'hitl_approved', T_BOOLEAN, '用户是否同意')]
  },
  'hitl.bpm_approval': {
    type: 'hitl.bpm_approval',
    label: 'BPM 审批',
    group: '人工介入',
    inputs: [
      inp('bpmProcessDefKey', 'BPM 流程标识', T_STRING, LITERAL, true, '基础', '指向已部署的审批流程'),
      inp('formVars', '审批表单参数', T_OBJECT, BOTH, false, '表单', '发起审批时传的变量；值可用 {{$.变量}}')
    ],
    outputs: [
      outp('approveVar', 'bpm_approved', T_BOOLEAN, '审批是否通过'),
      outp('statusVar', 'bpm_status', T_NUMBER, '审批状态码（2 通过/3 驳回/4 取消）')
    ]
  },
  wait: {
    type: 'wait',
    label: '等待',
    group: '人工介入',
    inputs: [
      inp('waitType', '等待方式', T_STRING, LITERAL, true, '基础', '定时等待或等外部事件'),
      inp('duration', '等待时长', T_STRING, LITERAL, false, '基础', '定时方式的时长（秒或 ISO-8601）'),
      inp('eventKey', '等待的事件', T_STRING, LITERAL, false, '基础', '等外部事件时的键')
    ],
    outputs: []
  },
  agent_loop: {
    type: 'agent_loop',
    label: '自主循环',
    group: '高级',
    inputs: [
      inp('goal', '目标', T_STRING, BOTH, true, '基础', '模型要自主完成什么；可用 {{$.变量}}'),
      inp('tools', '可用只读工具', T_ARRAY, LITERAL, false, '基础', '只能放只读（查询类）工具'),
      inp('maxSteps', '最大步数', T_NUMBER, LITERAL, false, '高级', '防止无限循环，缺省 5')
    ],
    outputs: [outp('outputVar', null, T_STRING, '最终答案')]
  },
  sub_workflow: {
    type: 'sub_workflow',
    label: '子流程',
    group: '高级',
    inputs: [
      inp('workflowId', '子流程', T_STRING, LITERAL, true, '基础', '选择一条已发布的流程'),
      inp('version', '指定版本', T_NUMBER, LITERAL, false, '高级', '留空=用主版本')
    ],
    outputs: []
  }
}

/** 取某类型的契约；未知类型返回 undefined（画布/面板优雅兜底，绝不抛） */
export const contractOf = (type?: string | null): Contract | undefined =>
  NODE_IO_CONTRACTS[type ?? ''] ?? undefined

/** 全部契约（保持声明顺序，与后端 all() 一致） */
export const allContracts = (): Contract[] => Object.values(NODE_IO_CONTRACTS)

/** 已登记的全部类型（13 种，与 NODE_TYPE_META 一致） */
export const ioContractTypes = (): string[] => Object.keys(NODE_IO_CONTRACTS)

/** 数据类型的中文名（端口 tooltip / 面板展示） */
export const dataTypeLabel = (t: IoDataType): string =>
  ({ string: '文本', number: '数字', boolean: '布尔', object: '对象', array: '数组' })[t] ?? '值'

/**
 * 数据类型的端口配色（coze 式：一眼看出「这个口吃什么、吐什么」）。
 * 用固定色值而非 el 变量：端口圆点很小，需要高对比、跨主题稳定的辨识色。
 */
export const dataTypeColor = (t: IoDataType): string =>
  ({
    string: '#52c41a',
    number: '#1677ff',
    boolean: '#fa8c16',
    object: '#722ed1',
    array: '#13c2c2'
  })[t] ?? '#909399'

/** 该输入端口是否允许引用上游变量（reference / both 才给引用选择器；literal 只填字面量） */
export const canReference = (port: InPort): boolean => port.mode === 'reference' || port.mode === 'both'

/**
 * 该输入端口「引用上游变量」时写进 config 的形式 —— 🔴 两种 mode 落地形态不同，别搞混：
 *  - `reference`（如 queryVar / itemsVar）：后端按 <b>裸状态键</b>直取（`ctx.getString(queryVar)` /
 *    `state.value(itemsVar)`），故写<b>裸变量名</b>（如 `out`），不能包 `{{$.}}`，否则取不到值。
 *  - `both`（如 prompt / query / goal / args 值 / formVars 值）：后端走 StateTemplateResolver 解析
 *    <b>`{{$.var}}` 模板</b>，故写模板串（如 `{{$.out}}`）。
 *  - `literal`：只填字面量，不提供引用。
 */
export type RefForm = 'none' | 'bare' | 'template'
export const referenceForm = (port: InPort | undefined): RefForm =>
  port?.mode === 'reference' ? 'bare' : port?.mode === 'both' ? 'template' : 'none'

/**
 * 解析某输出端口在具体节点上的「实际变量名」：优先取 config[configKey]，空则回落 defaultName，仍空则 ''（= 未命名）。
 * 🔴 与后端 `StrUtil.blankToDefault(n.configStr(op.configKey()), op.defaultName())` 同口径，
 *    保证「画布端口显示的变量名」「可达性判定的产出变量名」「后端校验的产出变量名」三处一致。
 */
export const resolveOutVarName = (node: EditorDslNode | null | undefined, port: OutPort): string => {
  const configured = port.configKey ? String(node?.config?.[port.configKey] ?? '').trim() : ''
  return configured || (port.defaultName ?? '')
}

/** 某节点实际产出的输出端口（已解析出变量名、过滤掉未命名的），供画布端口 / 上游收集用 */
export interface ResolvedOutput {
  varName: string
  dataType: IoDataType
  label: string
  configKey: string | null
}

export const resolvedOutputsOf = (node: EditorDslNode | null | undefined): ResolvedOutput[] => {
  const c = contractOf(node?.type)
  if (!c) return []
  const out: ResolvedOutput[] = []
  for (const p of c.outputs) {
    const varName = resolveOutVarName(node, p)
    if (varName) out.push({ varName, dataType: p.dataType, label: p.label, configKey: p.configKey })
  }
  return out
}
