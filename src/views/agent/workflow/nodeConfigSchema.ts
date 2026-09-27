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
 *   eventKey)、parallel→validateParallelNode(join/branches)。
 *
 * 🔴 刻意只做「标量/简单键」的结构化编辑；复杂嵌套结构（tool.args 对象、condition.rule.branches 的条件组、
 *   condition.llm.choices 列表、parallel.branches 的 List<List<String>>）留给底部 DSL JSON 兜底编辑，
 *   并用 {@link NODE_CONFIG_JSON_HINT} 明示作者——硬造一套嵌套结构可视化编辑器成本高且易与后端校验脱节。
 */

/** 结构化字段的编辑器类型 */
export type FieldKind = 'text' | 'textarea' | 'number' | 'select' | 'switch'

/** select 的动态选项来源：运行期由组件注入（工具目录 / 模型列表 / 知识库列表） */
export type OptionsSource = 'tool' | 'model' | 'kb'

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
 * 每种节点类型的结构化字段。键 = NODE_TYPE_OPTIONS 的 8 种 type。
 * 顺序即渲染顺序（常用/必填在前）。
 */
export const NODE_CONFIG_SCHEMA: Record<string, ConfigField[]> = {
  tool: [
    {
      key: 'toolId',
      label: '工具（toolId）',
      kind: 'select',
      optionsFrom: 'tool',
      placeholder: '选择或输入工具键'
    },
    { key: 'outputVar', label: '输出变量（outputVar）', kind: 'text', placeholder: '结果写入的 state 变量名' }
  ],
  llm: [
    { key: 'prompt', label: '提示词（prompt）', kind: 'textarea', placeholder: '支持 {{$.var}} 状态模板' },
    { key: 'systemPrompt', label: '系统提示词（systemPrompt）', kind: 'textarea', placeholder: '可空' },
    { key: 'modelId', label: '模型（modelId）', kind: 'select', optionsFrom: 'model', placeholder: '留空=动态默认' },
    { key: 'temperature', label: '温度（temperature）', kind: 'number', min: 0, max: 2, step: 0.1 },
    { key: 'maxTokens', label: '最大 tokens（maxTokens）', kind: 'number', min: 1, step: 1 },
    { key: 'outputVar', label: '输出变量（outputVar）', kind: 'text' }
  ],
  knowledge_retrieval: [
    { key: 'knowledgeBaseId', label: '知识库（knowledgeBaseId）', kind: 'select', optionsFrom: 'kb', placeholder: '必选' },
    {
      key: 'queryVar',
      label: '查询变量（queryVar）',
      kind: 'text',
      placeholder: '取某 state 变量当查询，与 query 二选一',
      hint: 'queryVar 优先于 query；两者都空则查询为空串。'
    },
    { key: 'query', label: '查询模板（query）', kind: 'textarea', placeholder: '支持 {{$.a.b}} 嵌套路径' },
    { key: 'topK', label: '召回条数（topK）', kind: 'number', min: 1, step: 1 },
    { key: 'similarityThreshold', label: '相似度阈值（similarityThreshold）', kind: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'outputVar', label: '输出变量（outputVar）', kind: 'text', placeholder: '默认 retrieved' },
    {
      key: 'citationsVar',
      label: '引用出处变量（citationsVar）',
      kind: 'text',
      placeholder: '选填，填 citations 可在聊天里展示参考资料',
      hint: '配上后额外写一份带文档名/相关度的命中段落。填「citations」时，工作流驱动的 Agent 会在聊天回复下渲染「参考资料」出处；填别的名字则仅供下游节点自用。'
    }
  ],
  'condition.rule': [
    {
      key: 'default',
      label: '默认路由（default）',
      kind: 'text',
      placeholder: '所有分支都不命中时走的路由键'
    }
  ],
  'condition.llm': [
    { key: 'prompt', label: '判定提示词（prompt）', kind: 'textarea', placeholder: '支持 {{$.var}} 状态模板' },
    { key: 'modelId', label: '模型（modelId）', kind: 'select', optionsFrom: 'model', placeholder: '留空=动态默认' },
    { key: 'temperature', label: '温度（temperature）', kind: 'number', min: 0, max: 2, step: 0.1 },
    { key: 'maxTokens', label: '最大 tokens（maxTokens）', kind: 'number', min: 1, step: 1 },
    { key: 'default', label: '默认路由（default）', kind: 'text' },
    { key: 'outputVar', label: '输出变量（outputVar）', kind: 'text' }
  ],
  'hitl.confirm': [
    {
      key: 'approveVar',
      label: '批准变量（approveVar）',
      kind: 'text',
      placeholder: '默认 hitl_approved',
      hint: '用户是否批准的布尔 state 变量名；下游 condition.rule 可用 is_true/is_false 判定。'
    }
  ],
  wait: [
    {
      key: 'waitType',
      label: '等待类型（waitType）',
      kind: 'select',
      options: [
        { label: '定时（duration）', value: 'duration' },
        { label: '外部事件（event）', value: 'event' }
      ]
    },
    {
      key: 'duration',
      label: '时长（duration）',
      kind: 'text',
      placeholder: '数字秒或 ISO-8601，如 PT30S',
      hint: '必填，>0 秒且 ≤7 天。',
      showIf: { key: 'waitType', equals: 'duration' }
    },
    {
      key: 'eventKey',
      label: '事件键（eventKey）',
      kind: 'text',
      placeholder: '等待的外部事件键',
      hint: '必填，长度 ≤128；由「发布外部事件」端点唤醒。',
      showIf: { key: 'waitType', equals: 'event' }
    }
  ],
  parallel: [
    {
      key: 'join',
      label: '汇聚策略（join）',
      kind: 'select',
      options: [{ label: '全部完成（all）', value: 'all' }],
      hint: '当前仅支持 all（各分支全部完成才激活 join 目标）。'
    }
  ]
}

/**
 * 每种类型「哪些复杂键请走底部 JSON」的提示（结构化面板不覆盖的部分，明示作者，避免以为漏配）。
 */
export const NODE_CONFIG_JSON_HINT: Record<string, string> = {
  tool: 'args（工具入参，对象）请用下方 DSL JSON 编辑。',
  'condition.rule': 'branches（条件组 conditionGroups / 扁平 conditions）结构复杂，请用下方 DSL JSON 编辑。',
  'condition.llm': 'choices（候选路由列表）请用下方 DSL JSON 编辑。',
  parallel: 'branches（List<List<String>>，每个元素一条节点 id 链）请用下方 DSL JSON 编辑。'
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
