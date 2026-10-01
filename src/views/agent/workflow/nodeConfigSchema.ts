/**
 * 可视化编辑器「结构化节点配置面板」的纯 schema（增量16A / P4 编辑器第二子刀）
 *
 * 🔴 与 editorModel.ts / layout.ts / replayModel.ts 同款纪律：纯数据 + 纯函数、不依赖 Vue 运行时，
 * 便于 vitest 单测（见 nodeConfigSchema.spec.ts）。本模块只声明「每种节点类型该渲染哪些结构化字段」，
 * 组件据此 v-for 渲染表单，把值 v-model 到节点的 config 上——替代首刀里「除 tool 外只能改裸 JSON」的现状。
 *
 * 🔴 字段键逐字对齐后端各 NodeExecutor / DslToStateGraphCompiler 实际读取的 config 键，绝不臆造：
 *   tool→ToolNodeExecutor(toolId/args/outputVar)、llm→LlmNodeExecutor(prompt/systemPrompt/modelId/
 *   temperature/maxTokens/outputVar)、knowledge_retrieval→KnowledgeRetrievalNodeExecutor(knowledgeBaseId/
 *   queryVar/query/topK/similarityThreshold/outputVar)、condition.rule→RuleConditionNodeExecutor(branches/
 *   default)、condition.llm→LlmConditionNodeExecutor(prompt/choices/modelId/temperature/maxTokens/default/
 *   outputVar)、hitl.confirm→HitlConfirmNodeExecutor(approveVar)、wait→validateWaitConfig(waitType/duration/
 *   eventKey)、parallel→validateParallelNode(join/branches)、hitl.bpm_approval→HitlBpmApprovalNodeExecutor/
 *   AgentBpmApprovalService(bpmProcessDefKey/approveVar/statusVar/formVars)、script→ScriptNodeExecutor(code/
 *   language/timeoutMs/outputVar)。
 *
 * 🔴 刻意只做「标量/简单键」的结构化编辑；复杂嵌套结构（tool.args 对象、condition.rule.branches 的条件组、
 *   condition.llm.choices 列表、parallel.branches 的 List<List<String>>）留给底部 DSL JSON 兜底编辑，
 *   并用 {@link NODE_CONFIG_JSON_HINT} 明示作者——硬造一套嵌套结构可视化编辑器成本高且易与后端校验脱节。
 */

/** 结构化字段的编辑器类型。tags=字符串数组的标签输入；kv=对象键值对编辑器（KeyValueEditor.vue） */
export type FieldKind = 'text' | 'textarea' | 'number' | 'select' | 'switch' | 'tags' | 'kv'

/** select 的动态选项来源：运行期由组件注入（工具目录 / 模型列表 / 知识库列表 / 已发布流程列表） */
export type OptionsSource = 'tool' | 'model' | 'kb' | 'workflow'

export interface ConfigFieldOption {
  label: string
  value: string | number | boolean
}

export interface ConfigField {
  /** config 里的键名（逐字对齐后端执行器读取的键） */
  key: string
  /** 表单标签 */
  label: string
  kind: FieldKind
  placeholder?: string
  /** 字段下方的灰色说明 */
  hint?: string
  /** 动态 select 的选项来源（与 options 二选一） */
  optionsFrom?: OptionsSource
  /** 静态 select 的选项（与 optionsFrom 二选一） */
  options?: ConfigFieldOption[]
  /** number 的范围/步进 */
  min?: number
  max?: number
  step?: number
  /** 仅当另一字段等于某值时才显示（如 wait 的 duration 仅 waitType=duration 时出现） */
  showIf?: { key: string; equals: string | number | boolean }
}

/**
 * 每种节点类型的结构化字段。键 = NODE_TYPE_OPTIONS 的 10 种 type。
 * 顺序即渲染顺序（常用/必填在前）。
 */
// 🔴 label 面向业务人员：刻意不带后端 config 键名（如 outputVar/toolId）。
//    键名对配流程的人是噪音，字段含义靠 label + hint 说清即可；键逐字对齐后端的约束在 key 上，不在 label 上。
export const NODE_CONFIG_SCHEMA: Record<string, ConfigField[]> = {
  tool: [
    {
      key: 'toolId',
      label: '工具',
      kind: 'select',
      optionsFrom: 'tool',
      placeholder: '选择或输入工具键'
    },
    {
      key: 'args',
      label: '工具入参',
      kind: 'kv',
      hint:
        '参数名 → 值；顶层的字符串值可用 {{$.变量}} 或 {{$.变量.字段}} 引用前序节点写入的结果。' +
        '⚠️ 嵌在对象/数组里的不替换（后端只解析顶层字符串值）。'
    },
    { key: 'outputVar', label: '结果存到', kind: 'text', placeholder: '给这一步的结果起个名字，供后面引用' }
  ],
  llm: [
    { key: 'prompt', label: '提示词', kind: 'textarea', placeholder: '支持 {{$.var}} 状态模板' },
    { key: 'systemPrompt', label: '系统提示词', kind: 'textarea', placeholder: '可空' },
    { key: 'modelId', label: '模型', kind: 'select', optionsFrom: 'model', placeholder: '留空=动态默认' },
    { key: 'temperature', label: '温度', kind: 'number', min: 0, max: 2, step: 0.1 },
    { key: 'maxTokens', label: '最大 tokens', kind: 'number', min: 1, step: 1 },
    { key: 'outputVar', label: '结果存到', kind: 'text' }
  ],
  knowledge_retrieval: [
    { key: 'knowledgeBaseId', label: '知识库', kind: 'select', optionsFrom: 'kb', placeholder: '必选' },
    {
      key: 'queryVar',
      label: '查询变量',
      kind: 'text',
      placeholder: '取某 state 变量当查询，与「查询内容」二选一',
      hint: '填了查询变量就优先用它；两者都空则查询为空串。'
    },
    { key: 'query', label: '查询内容', kind: 'textarea', placeholder: '支持 {{$.a.b}} 嵌套路径' },
    { key: 'topK', label: '召回条数', kind: 'number', min: 1, step: 1 },
    { key: 'similarityThreshold', label: '相似度阈值', kind: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'outputVar', label: '结果存到', kind: 'text', placeholder: '默认 retrieved' },
    {
      key: 'citationsVar',
      label: '引用出处存到',
      kind: 'text',
      placeholder: '选填，填 citations 可在聊天里展示参考资料',
      hint: '配上后额外写一份带文档名/相关度的命中段落。填「citations」时，工作流驱动的 Agent 会在聊天回复下渲染「参考资料」出处；填别的名字则仅供下游节点自用。'
    }
  ],
  'condition.rule': [
    {
      key: 'default',
      label: '默认分支',
      kind: 'text',
      placeholder: '所有分支都不命中时走哪条'
    }
  ],
  'condition.llm': [
    { key: 'prompt', label: '判定提示词', kind: 'textarea', placeholder: '支持 {{$.var}} 状态模板' },
    {
      key: 'choices',
      label: '候选分支',
      kind: 'tags',
      placeholder: '输入一个候选按回车添加',
      hint: '模型只能从这些候选里选一个作为分支；需与连线上设置的分支一一对应。'
    },
    { key: 'modelId', label: '模型', kind: 'select', optionsFrom: 'model', placeholder: '留空=动态默认' },
    { key: 'temperature', label: '温度', kind: 'number', min: 0, max: 2, step: 0.1 },
    { key: 'maxTokens', label: '最大 tokens', kind: 'number', min: 1, step: 1 },
    { key: 'default', label: '默认分支', kind: 'text' },
    { key: 'outputVar', label: '结果存到', kind: 'text' }
  ],
  'hitl.confirm': [
    {
      key: 'approveVar',
      label: '批准结果存到',
      kind: 'text',
      placeholder: '默认 hitl_approved',
      hint: '用户是否批准的布尔 state 变量名；下游「规则条件」可用「为真/为假」判定。'
    }
  ],
  'hitl.bpm_approval': [
    {
      key: 'bpmProcessDefKey',
      label: 'BPM 流程标识',
      kind: 'text',
      placeholder: '如 oa_leave_approval',
      hint: '必填。指向一个已部署的 BPM 流程定义 key；节点挂起时以执行所有者身份发起该审批，审批人在 BPM 里通过/驳回后自动唤醒工作流。'
    },
    {
      key: 'approveVar',
      label: '批准结果存到',
      kind: 'text',
      placeholder: '默认 bpm_approved',
      hint: '审批是否通过的布尔 state 变量名；下游「规则条件」可用「为真/为假」判定。'
    },
    {
      key: 'statusVar',
      label: '状态码存到',
      kind: 'text',
      placeholder: '默认 bpm_status',
      hint: 'BPM 原始状态码（2 通过 / 3 驳回 / 4 取消）写入的 state 变量名，供审计或更细的分支判定。'
    },
    {
      key: 'formVars',
      label: '审批表单参数',
      kind: 'kv',
      // 🔴 值按字面量原样传给审批流程：后端 resolveConfig 用 configMap("formVars") 原样取，
      //    createApproval 再原样 setVariables 交给 Flowable，压根不过 StateTemplateResolver。
      //    旧提示承诺「值支持 {{$.变量}}」是假的，且假得有害——用户按提示写占位符，
      //    审批表单里收到的就是字面串 {{$.xxx}}，全程无报错。
      hint: '发起审批时传给 BPM 流程的变量（参数名 → 值）；⚠️ 值按字面量原样传入，{{$.变量}} 不会被替换。'
    }
  ],
  wait: [
    {
      key: 'waitType',
      label: '等待方式',
      kind: 'select',
      options: [
        { label: '定时等待', value: 'duration' },
        { label: '等外部事件', value: 'event' }
      ]
    },
    {
      key: 'duration',
      label: '等待时长',
      kind: 'text',
      placeholder: '数字秒或 ISO-8601，如 PT30S',
      hint: '必填，>0 秒且 ≤7 天。',
      showIf: { key: 'waitType', equals: 'duration' }
    },
    {
      key: 'eventKey',
      label: '等待的事件',
      kind: 'text',
      placeholder: '等待的外部事件键',
      hint: '必填，长度 ≤128；由「发布外部事件」端点唤醒。',
      showIf: { key: 'waitType', equals: 'event' }
    }
  ],
  parallel: [
    {
      key: 'join',
      label: '汇聚方式',
      kind: 'select',
      options: [{ label: '全部完成后汇聚', value: 'all' }],
      hint: '当前仅支持「全部完成」（各分支全部完成才继续往下走）。'
    }
  ],
  script: [
    {
      key: 'code',
      label: '脚本内容',
      kind: 'textarea',
      placeholder: "JS，可直接写 return；用 state 读工作流状态，如 return state.a + state.b;",
      hint: '在 GraalJS 沙箱内执行：禁 IO / 线程 / 进程 / 访问 Java 类；return 的值写入「结果存到」。脚本上限 1 万字符。'
    },
    {
      key: 'language',
      label: '语言',
      kind: 'select',
      options: [{ label: 'JavaScript', value: 'javascript' }],
      hint: '目前仅支持 javascript。'
    },
    {
      key: 'timeoutMs',
      label: '超时（毫秒）',
      kind: 'number',
      min: 1,
      max: 10000,
      step: 100,
      hint: '缺省 2000，上限 10000；死循环到点被强制中断。'
    },
    { key: 'outputVar', label: '结果存到', kind: 'text', placeholder: '默认 script_result' }
  ],
  // 🔴 以下 3 种是编译器合成子图类型（WorkflowDslValidator.GRAPH_BUILDER_TYPES），非独立执行器。
  //   字段键逐字对齐 DslToStateGraphCompiler 与各 GraphBuilder 读取的 config 键。
  agent_loop: [
    {
      key: 'goal',
      label: '目标',
      kind: 'textarea',
      placeholder: '要让模型自主完成什么，如「查清某客户最近 3 单的物流状态并汇总」',
      hint: '模型会围绕这个目标自主决定调用哪些只读工具、调几轮，直到给出答案。'
    },
    {
      key: 'tools',
      label: '可用只读工具',
      kind: 'tags',
      placeholder: '输入工具键按回车添加',
      hint: '🔴 只能放只读工具（查询类）；放写入类工具不会被执行且可能被后端校验拒绝。'
    },
    { key: 'maxSteps', label: '最大步数', kind: 'number', min: 1, max: 20, step: 1, hint: '防止模型无限循环，缺省 5。' },
    { key: 'outputVar', label: '结果存到', kind: 'text', placeholder: '最终答案写入的变量名' }
  ],
  iteration: [
    { key: 'itemsVar', label: '要遍历的列表', kind: 'text', placeholder: '要遍历的数组变量名，如 orders' },
    { key: 'itemVar', label: '每项存到', kind: 'text', placeholder: '每项写入的变量名，缺省 item', hint: '循环体节点用 {{$.itemVar}} 取当前项。' },
    {
      key: 'body',
      label: '循环体节点',
      kind: 'tags',
      placeholder: '输入循环体内的节点 id 按回车添加',
      hint: '🔴 body 里的节点仍写在顶层 nodes[]，但<b>不要</b>把它们连进 edges[]（编译器自动接线）。'
    }
  ],
  sub_workflow: [
    {
      key: 'workflowId',
      label: '子流程',
      kind: 'select',
      optionsFrom: 'workflow',
      placeholder: '选择一条已发布的流程',
      hint: '只能内嵌「已发布」的流程；用其流程编码 code 调用。'
    },
    { key: 'version', label: '指定版本', kind: 'number', min: 1, step: 1, hint: '留空=用该流程的主版本。' }
  ]
}

/**
 * 每种类型「哪些复杂键请走底部 JSON」的提示（结构化面板不覆盖的部分，明示作者，避免以为漏配）。
 * 🔴 AI助手 UX 修复后大幅收窄：tool.args / condition.llm.choices / hitl.bpm_approval.formVars 已有结构化
 *   编辑器（kv/tags），condition.rule.branches 的扁平条件与 parallel.branches 已有可视化面板，
 *   故这些不再提示走 JSON。仅 condition.rule 的<b>嵌套 AND/OR（conditionGroups）</b>仍建议走 JSON。
 */
export const NODE_CONFIG_JSON_HINT: Record<string, string> = {
  'condition.rule':
    '上方「分支」编辑的是单层「并且」条件；若某分支需要嵌套「并且/或者」的复杂条件，请打开右上角「开发者模式」在 JSON 里编辑。'
}

/** 取某节点类型的结构化字段（认不出的类型返回空数组 → 面板只剩裸 JSON 兜底） */
export const fieldsFor = (type?: string | null): ConfigField[] => NODE_CONFIG_SCHEMA[type ?? ''] ?? []

/** 取某节点类型的「复杂键走 JSON」提示（无则空串） */
export const jsonHintFor = (type?: string | null): string => NODE_CONFIG_JSON_HINT[type ?? ''] ?? ''

/**
 * 字段当前是否可见：无 showIf 恒可见；有 showIf 则看 config 里对应键是否等于目标值。
 * 🔴 用于 wait 这类「按 waitType 分支显示不同字段」的类型，避免把 duration/eventKey 同时摆出来误导。
 */
export const isFieldVisible = (field: ConfigField, config: Record<string, any> | null | undefined): boolean => {
  if (!field.showIf) return true
  const c = config ?? {}
  return c[field.showIf.key] === field.showIf.equals
}
