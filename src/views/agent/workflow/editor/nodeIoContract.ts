/**
 * 节点「输入 / 输出端口」契约 —— 前端镜像（Phase E / Req5）
 *
 * 🔴 与后端 `framework.agent.core.engine.io.NodeIoContract` 逐字同构：同一份「端口目录」两处各存一份。
 *    前端这份用于首屏免请求地画类型化端口 / 渲染引用选择器；后端那份是权威。改端口必须两侧同步，
 *    否则画布端口与后端校验口径漂移。
 *
 * ⚠️ 同步目前只靠人 + nodeIoContract.spec.ts 钉值：**没有**任何测试真去拉
 *    `GET /agent/workflow-def/node-io-contract` 跟这份镜像做 diff（agent-workflow-io-contract.spec.ts
 *    只验交互行为，不比对两份目录）。所以改完一侧务必手改另一侧，别指望测试会拦住漏改。
 *    实测更彻底：`src/` 下**没有任何一处**调用那个后端端点（`AgentWorkflowDefController` 的
 *    `GET /node-io-contract`，零前端调用者。这里刻意**不**写行号 —— 原先钉的那个行号已实测漂了 60 行），
 *    UI 用的就是这份镜像 ⟹ 两份漂了连运行期信号都没有。
 *    🔴 台账 #104：照 `tests/e2e/form-widget-contract-sync.spec.ts` 的先例（打**运行中后端**的 HTTP 端点、
 *    与本地副本 diff ⟹ 不需要 CI 同时检出两个仓）把 `_evidence/p97-mirror-diff.py` 的结构比对升成一条 e2e。
 *    ⚠️ 那条 e2e 在**台账 #70**（`agent:workflow:query` 授权给 0 个角色）清账之前只能用超管账号跑。
 *
 * ⚠️ 本文件的 `InPort.hint` 在前端**没有消费者**（WorkflowPropertyPanel.vue 渲染的是 nodeConfigSchema.ts
 *    的 `f.hint`）。它存在的意义只是与后端那份保持同构，别以为改了这里用户就看得见；
 *    面向用户的提示语要改 nodeConfigSchema.ts，那份的强制点在 nodeConfigSchema.spec.ts。
 *
 * 🔴 输出端口的 defaultName 必须等于后端执行器的常量值（tool_result / llm_output / script_result /
 *    retrieved）。后端那侧写的是「引用执行器常量」，前端这侧只能抄字面量 —— 抄就会漂，故 spec 逐个钉死。
 *    tool/llm 这两个值曾双双写着 null（= 必须用户命名），而运行期一直在兜底，
 *    于是后端建 producers 表时看不见这两个键，合法的 {{$.tool_result}} 被误报成悬空引用。
 *
 * 🔴 与 editorModel / nodeConfigSchema / nodeSummary 同款纪律：纯数据 + 纯函数、不依赖 Vue 运行时，便于 vitest 单测。
 * 🔴 契约只描述「某类节点该往哪个 config 键填什么、跑完往哪个变量名写什么、类型是什么」，<b>绝不参与运行时</b>。
 *    端口最终都被落成既有的 `{{$.var}}` 引用与 `config.outputVar`，故对存量已发布流程 100% 向后兼容。
 *
 * 🔴 输入端口的 `key` 逐字对齐 `nodeConfigSchema.ts` 的 config 键；`dataType`/`mode` 仅用于 UI 着色与「可否引用上游」
 *    的提示，<b>非</b>运行期强类型约束（后端仍是弱类型扁平状态）。
 */

import type { EditorDslNode } from '../editorModel'
import type { ConfigField, FieldKind } from '../nodeConfigSchema'

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
      inp(
        'args',
        '工具入参',
        T_OBJECT,
        BOTH,
        false,
        '基础',
        '参数名 → 值；顶层的字符串值可用 {{$.变量}} 引用上游结果（⚠️ 嵌在对象/数组里的不替换）'
      )
    ],
    outputs: [outp('outputVar', 'tool_result', T_OBJECT, '工具返回结果')]
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
    outputs: [outp('outputVar', 'llm_output', T_STRING, '模型生成的文本')]
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
      inp(
        'branches',
        '分支规则',
        T_ARRAY,
        LITERAL,
        true,
        '分支',
        '按变量值分组；命中哪组就走哪条线（⚠️ 比较值按字面量处理，{{$.变量}} 不替换；变量名只认顶层键）'
      ),
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
      inp('modelId', '模型', T_NUMBER, LITERAL, false, '模型', '留空=用默认模型'),
      // 🔴 这两个曾漏登记（台账 #97）：运行期真的把它们塞进请求，而 schema 早就有这两个格子
      //    ⟹ 用户在面板上改了、生效了，契约却看不见，fieldDataType 只能给兜底类型。
      inp('temperature', '温度', T_NUMBER, LITERAL, false, '模型', '越高越有创造力（0~2）'),
      inp(
        'maxTokens',
        '最大 tokens',
        T_NUMBER,
        LITERAL,
        false,
        '模型',
        '限制单次输出长度；⚠️ 缺省 32 —— 判定只需吐一个分支名，故比 llm 节点（缺省不限）小得多'
      )
    ],
    outputs: [outp('outputVar', null, T_STRING, '模型选中的分支')]
  },
  parallel: {
    type: 'parallel',
    label: '并行',
    group: '分支与并行',
    inputs: [
      inp(
        'join',
        '汇聚方式',
        T_STRING,
        LITERAL,
        false,
        '基础',
        '当前仅支持「全部完成后汇聚」（填别的值编译期就拒，不静默降级）'
      ),
      // 🔴 与 condition.* 的 branches **同名不同义**：那边是「分支判定规则」的对象数组
      //    （{target, conditions[]}），这边是「节点 id 链」的数组的数组。故 hint 分开写、不共用一句（台账 #97 裁定②）。
      //    ⚠️ 不改键名：两处运行期读者读的都是 branches 这个字面量，改名要么破坏存量已发布 DSL、
      //    要么得再加一层双读兼容（就是 agent_loop 的 goal/prompt 现在这副样子）。
      //    ℹ️ schema 刻意**没有**这个字段：List<List<String>> 留给底部 DSL JSON 兜底编辑（见 nodeConfigSchema.ts 头注）。
      inp(
        'branches',
        '并行分支',
        T_ARRAY,
        LITERAL,
        true,
        '基础',
        '每个元素是一条「节点 id 链」，即数组的数组（如 [["a","b"],["c"]]）；' +
          '⚠️ 与条件节点的「分支规则」同名不同义 —— 这里填节点 id，不是判定规则。' +
          '分支节点的连边由引擎生成，不要手写进 edges[]'
      )
    ],
    outputs: []
  },
  iteration: {
    type: 'iteration',
    label: '循环遍历',
    group: '分支与并行',
    inputs: [
      inp('itemsVar', '要遍历的列表', T_STRING, REFERENCE, true, '基础', '一个数组变量名'),
      // 🔴 required 原是 false，而运行期 IterationGraphBuilder 缺它**直接编译失败**（与 itemsVar 同款 fail-fast）。
      //    ⚠️ 后端 src/main 零个 "item" 兜底字面量，但**前端有一个**：editorModel.defaultConfig 把 itemVar 预填成 'item'
      //    ⟹ schema 那句 placeholder「缺省 item」不是凭空捏造，说的是这个前端预填；已改成「拖出来时已预填 item」，
      //    因为 AI 生成的 / 手写的 DSL 不走 defaultConfig、拿不到预填。
      //    旧 hint 教作者引用一个字面名叫 itemVar 的键，而当前项其实写在作者自己填的那个名字下 —— 照它写必取空值且不报错。
      //    ⚠️ mode 仍是 LITERAL 而不是 REFERENCE：这一格是给新变量**起名**（写入目标），不是「取哪个上游变量」，
      //    挂引用选择器只会让用户挑一个不相干的上游名。
      //    ⚠️ 改成 true 会让面板上「每项存到」多出红星（useWorkflowEditor.isRequiredField 反查的就是这个 required），这是**对的**。
      //    🔴 本文件的 InPort.hint 在前端没有消费者，故「四份副本都清干净了吗」的强制点落在 nodeConfigSchema.spec.ts。
      inp(
        'itemVar',
        '每项存到',
        T_STRING,
        LITERAL,
        true,
        '基础',
        '给每轮取出的那一项起个变量名（必填，没有缺省值）；循环体节点用 {{$.你填的这个名}} 取当前项'
      ),
      inp('body', '循环体节点', T_ARRAY, LITERAL, true, '高级', '参与循环的节点 id；不要把它们连进主 edges'),
      inp(
        'concurrency',
        '并发度',
        T_NUMBER,
        LITERAL,
        false,
        '高级',
        '⚠️ 暂只支持 1（串行遍历）；填 >1 编译期明确拒绝、不静默降成串行' +
          '（并发 foreach 需运行时按列表长度动态 fan-out，而引擎的并行分支是编译期静态的）'
      )
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
      // 🔴 LITERAL 而不是 BOTH：这些值压根不过 StateTemplateResolver。
      //    后端 AgentBpmApprovalService.resolveConfig 用 node.configMap("formVars") 原样取，
      //    createApproval 再原样 setVariables 交给 Flowable，于是 {{$.变量}} 会以字面串进审批表单。
      //    真要让它可引用，得在挂起点从 checkpoint 取出状态再解析 —— 那是后端运行期改动，改这份契约没用。
      //
      // ℹ️ 这里曾写着「标成 BOTH 会让选择器把 formVars 对象换成一个串」——那半句现在由
      //    showsWholeValueRefPicker 的**形态**白名单结构性挡住（kv 一律不挂选择器），不再依赖 mode。
      //    两道闸各管一件事，别混：mode 管「值到底解不解析模板」（formVars=不解析，故 LITERAL 是事实），
      //    形态管「能不能被整体赋值一个字符串」（kv/tags 都不能）。tool.args 正是靠这个区分才两全 ——
      //    它 mode 必须是 BOTH（值真解析），但形态是 kv 所以照样不挂选择器。见缺陷 #47。
      inp(
        'formVars',
        '审批表单参数',
        T_OBJECT,
        LITERAL,
        false,
        '表单',
        '发起审批时传的变量；⚠️ 值按字面量原样传给审批流程，{{$.变量}} 不会被替换'
      ),
      inp(
        'injectManifest',
        '注入变更清单',
        T_BOOLEAN,
        LITERAL,
        false,
        '审批',
        '挂起发起审批时，把这份流程「将要改什么」的变更清单冻结进流程变量 agent_change_manifest，审批人在 BPM 详情页能看到。默认开启'
      )
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
      inp('eventKey', '等待的事件', T_STRING, LITERAL, false, '基础', '等外部事件时的键'),
      inp(
        'externalWakeup',
        '外部唤醒方声明',
        T_OBJECT,
        LITERAL,
        false,
        '基础',
        '等外部事件时声明谁会来唤醒：{ owner, endpoint, note }。无头流程体检（V14）读它判断这个等待节点唤不唤得醒'
      )
    ],
    outputs: []
  },
  agent_loop: {
    type: 'agent_loop',
    label: '自主循环',
    group: '高级',
    inputs: [
      inp(
        'goal',
        '目标',
        T_STRING,
        BOTH,
        true,
        '基础',
        '模型要自主完成什么；可用 {{$.变量}}。⚠️ 与「初始目标变量」二选一：两个都不填编译期就拒'
      ),
      // 🔴 prompt 是 goal 的**兼容别名**，运行期两个都读（goal 优先、prompt 兜底存量 DSL）。
      //    登记它不是因为界面上有这个格子（schema 只有 goal），而是「运行期读了就得登记」（台账 #97）。
      inp(
        'prompt',
        '目标（旧写法）',
        T_STRING,
        BOTH,
        false,
        '高级',
        'goal 的兼容别名，两者都填时以 goal 为准；新流程请填「目标」，不要再写这个键'
      ),
      // 🔴 label 逐字是「循环目标」：后端 UntrustedInputTracer 把它当汇的标签用，且测试钉着这四个字。
      inp(
        'inputVar',
        '循环目标',
        T_STRING,
        REFERENCE,
        false,
        '基础',
        '「目标」留空时，直接取这个变量的值当初始调查目标（原样进对话历史的第一条 user 消息）'
      ),
      inp('tools', '可用只读工具', T_ARRAY, LITERAL, false, '基础', '只能放只读（查询类）工具'),
      inp('maxSteps', '最大步数', T_NUMBER, LITERAL, false, '高级', '防止无限循环，缺省 5'),
      inp('modelId', '模型', T_NUMBER, LITERAL, false, '模型', '留空=用默认模型'),
      inp('temperature', '温度', T_NUMBER, LITERAL, false, '模型', '越高越有创造力（0~2）'),
      inp('maxTokens', '最大 tokens', T_NUMBER, LITERAL, false, '模型', '限制单步输出长度'),
      // 🔴 LITERAL 而不是 BOTH，理由与 llm.systemPrompt **相反**：同名不同义。
      //    LlmNodeExecutor 对 systemPrompt 走 StateTemplateResolver，而 AgentLoopGraphBuilder
      //    把它原样拼在通用 ReAct 协议后面 —— 中间没有任何解析。
      inp(
        'systemPrompt',
        '补充说明',
        T_STRING,
        LITERAL,
        false,
        '提示',
        '追加在通用循环协议之后的任务说明；⚠️ 不过模板解析，{{$.变量}} 不会被替换' +
          '（与「大模型」节点的系统提示词同名不同义，那个会替换）'
      )
    ],
    outputs: [
      outp('outputVar', null, T_STRING, '最终答案'),
      // 🔴 登记成**输出**端口会连带接进后端两个从 outputs 派生的读者：V19「写而未声明」与污点传播的写集（台账 #99 的域）。
      //    前端这侧的效应是 resolvedOutputsOf 会把它算成一个产出 ⟹ 配了名字的轨迹变量出现在下游的引用选择器里，
      //    这是对的（运行期真会写这个键）。
      outp('trajectoryVar', null, T_ARRAY, '调查轨迹（可选，不配就不输出）')
    ]
  },
  sub_workflow: {
    type: 'sub_workflow',
    label: '子流程',
    group: '高级',
    inputs: [
      inp('workflowId', '子流程', T_STRING, LITERAL, true, '基础', '选择一条已发布的流程'),
      inp('version', '指定版本', T_NUMBER, LITERAL, false, '高级', '留空=用主版本'),
      // 🔴 label 逐字是「子流程入参」：后端 UntrustedInputTracer 用它当汇标签，且测试钉着这四个字。
      inp(
        'inputMap',
        '子流程入参',
        T_OBJECT,
        BOTH,
        false,
        '高级',
        '{子流程里的变量名: 父流程取值表达式}；值可用 {{$.父流程变量}}，' +
          '整个值就是一个占位符时保原始类型（数组/对象/数字不被转成字符串）'
      ),
      // 🔴 LITERAL 是**刻意的**，且与 inputMap 相反：outputMap 的值同样是模板、同样过解析，
      //    但解析的是**子流程跑完之后的 state**，写 {{$.父流程变量}} 取不到值。
      //    三值词汇表表达不了「可解析但换作用域」（后端 MODE_LITERAL 的 javadoc 记着这个建模缺口），
      //    而两个消费者对 LITERAL 的处置恰好都对：前端不挂选择器（挂了必然填错），污点溯源不把它当父流程的汇。
      inp(
        'outputMap',
        '子流程出参',
        T_OBJECT,
        LITERAL,
        false,
        '高级',
        '{父流程变量名: 子流程结果表达式}；⚠️ 这里的 {{$.x}} 指的是**子流程里**的 x，' +
          '不能用来引用父流程的上游结果'
      )
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
 *  - `both`（如 prompt / query / goal / args 值）：后端走 StateTemplateResolver 解析
 *    <b>`{{$.var}}` 模板</b>，故写模板串（如 `{{$.out}}`）。
 *  - `literal`：只填字面量，不提供引用。
 */
export type RefForm = 'none' | 'bare' | 'template'
export const referenceForm = (port: InPort | undefined): RefForm =>
  port?.mode === 'reference' ? 'bare' : port?.mode === 'both' ? 'template' : 'none'

/**
 * 允许被「整体替换式」引用选择器写值的编辑器形态 —— 只有自由文本两种。
 *
 * 🔴 选择器 emit 的是**一个字符串**，宿主 `onPickRef` 直接 `config[key] = 值` 整体赋值。
 *    对 text/textarea 这是对的；对 kv（对象）就把整个对象换成一个串 ⟹ 后端
 *    `configMap("args")` 拿到 null ⟹ 工具变成**无参调用**，且全程零报错（这正是 P1 缺陷 #47）。
 *    tags（数组）同理；select/number/switch 的值必须落在选项/数值/布尔域里，塞模板串就是脏值。
 *
 * 🔴 白名单刻意**不随 FieldKind 自动扩张**：新增一种形态时默认不挂选择器。
 *    漏挂 = 用户少一个点选入口，是看得见的小遗憾；漏判 = 静默毁掉配置，是看不见的大坑。
 *    强制点在 nodeIoContract.spec.ts 的「全字段扫描」那条。
 */
const WHOLE_VALUE_REF_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['text', 'textarea'])

/**
 * 该字段是否应挂「整体替换式」引用选择器 = 端口允许引用（mode≠literal）**且** 形态是自由文本。
 *
 * 🔴 与 `canReference` 分工：后者只看契约、决定**展示**（类型色点 + 类型名，`tool.args` 该显示「对象」），
 *    本函数额外看编辑器形态、决定**能不能写**。#47 的根因就是这两件事被 `canRefField` 一个谓词包办了 ——
 *    契约侧 `args` 是 `both` 完全正确（值里的 `{{$.变量}}` 后端确实解析），错在面板把「可引用」
 *    直接当成「可整体替换」，而 `args` 的可引用粒度是**每个值**，不是整个对象。
 */
export const showsWholeValueRefPicker = (
  type: string | null | undefined,
  field: Pick<ConfigField, 'key' | 'kind'>
): boolean => {
  const port = contractOf(type)?.inputs.find((i) => i.key === field.key)
  return referenceForm(port) !== 'none' && WHOLE_VALUE_REF_KINDS.has(field.kind)
}

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
