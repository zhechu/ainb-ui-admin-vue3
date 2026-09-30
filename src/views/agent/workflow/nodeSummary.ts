/**
 * 节点摘要纯函数模块 —— 把 DSL 节点的 config 提炼成「业务人员看得懂的一句人话」
 *
 * 🔴 与 editorModel.ts / layout.ts 同款纪律：纯函数、不依赖 Vue 运行时，便于 vitest 单测（见 nodeSummary.spec.ts）。
 *
 * 诞生背景（AI助手 UX 修复）：DSL 原文其实早已到达前端（planner 草稿卡片、编辑器、只读画布三处），
 * 但三处都只渲染「类型徽标 + 节点名」，config 里的 prompt / 工具与参数 / 条件分支 / 知识库等
 * 「这个节点到底要做什么」的信息全被丢弃 —— 用户看到的流程等于只有目录没有正文。
 * 本模块是三处共用的唯一摘要来源：
 *   - {@link NODE_TYPE_META}：13 种合法节点类型的权威目录（中文名/徽标色/用途说明/目录分组）；
 *   - {@link summarizeNode}：单节点一句话摘要（卡片第二行、画布节点灰字）；
 *   - {@link nodeDetailLines}：展开态的「中文标签 → 值」详情行（卡片展开区）；
 *   - {@link flowStepsText}：edges → 流程走向文本行（卡片「流程走向」小节）；
 *   - {@link nodeHasRequiredGap}：必填配置缺失检测（画布节点红点警示）。
 *
 * 🔴 名称中文化（重构 S1 / L1）：`summarizeNode` / `nodeDetailLines` / `buildSummaryNodes` 都收一个
 *    **可选**的 {@link NodeNameResolver} 第二参，由 `nameCatalog.ts` 注入。不传时行为与注入前逐字一致，
 *    所以本模块仍是纯函数、仍可被 vitest 直接跑（见 nodeSummary.spec.ts 的「不注入」用例）。
 *
 * 🔴 类型目录逐字对齐后端：10 种 = NodeExecutorRegistry 已注册执行器（getType()），
 *    3 种（agent_loop/iteration/sub_workflow）= WorkflowDslValidator.GRAPH_BUILDER_TYPES 编译器合成子图。
 *    用途说明文案提炼自 WorkflowDslPlannerPrompt.NODE_CATALOG（那是给模型看的，这里翻成给业务人员看的）。
 * 🔴 绝不抛异常：卡片场景的 DSL 可能残缺（planner 产物、历史脏数据），任何字段缺失都优雅兜底。
 */

import { fieldsFor } from './nodeConfigSchema'

export type SummaryTagType = 'primary' | 'success' | 'warning' | 'danger' | 'info'

export interface NodeTypeMeta {
  /** 中文显示名（徽标/目录/下拉统一用它，不再向用户暴露 condition.rule 这类原始 type） */
  label: string
  tagType: SummaryTagType
  /** 面向业务人员的一句用途说明（目录 hover tooltip / 空面板提示） */
  description: string
  /** 编辑器左侧目录的分组名 */
  group: string
}

/**
 * 13 种合法节点类型的权威目录。
 * editorModel 的 NODE_TYPE_OPTIONS/nodeTypeLabel/nodeTypeTag、layout 的 nodeTagType 均由此派生，
 * 保证「聊天卡片 / 编辑器 / 只读画布」三处颜色与叫法一致。
 */
export const NODE_TYPE_META: Record<string, NodeTypeMeta> = {
  tool: {
    label: '工具',
    tagType: 'primary',
    description: '调用一个已注册的工具（如查询数据、写入表单），结果存进变量供后续节点使用。',
    group: '基础'
  },
  llm: {
    label: '大模型',
    tagType: 'success',
    description: '把提示词（可引用前序结果）交给大模型，生成一段文本存进变量。',
    group: '基础'
  },
  knowledge_retrieval: {
    label: '知识检索',
    tagType: 'info',
    description: '从指定知识库里检索与问题最相关的资料段落，供后续节点引用。',
    group: '基础'
  },
  script: {
    label: '脚本',
    tagType: 'primary',
    description: '执行一小段 JavaScript 做数据加工（如拼接、换算），结果存进变量。',
    group: '基础'
  },
  'condition.rule': {
    label: '规则条件',
    tagType: 'warning',
    description: '按变量值走不同分支（如「金额>1000 走审批，否则直接通过」），无需调用模型。',
    group: '分支与并行'
  },
  'condition.llm': {
    label: 'LLM 条件',
    tagType: 'warning',
    description: '让大模型在若干候选路由里选一个（适合规则难以枚举的语义判断）。',
    group: '分支与并行'
  },
  parallel: {
    label: '并行',
    tagType: 'info',
    description: '多条分支同时执行，全部完成后汇聚继续（如同时查库存和查物流）。',
    group: '分支与并行'
  },
  iteration: {
    label: '循环遍历',
    tagType: 'info',
    description: '逐项处理一个列表变量（如逐条回访客户），每项依次跑一遍循环体节点。',
    group: '分支与并行'
  },
  'hitl.confirm': {
    label: '人工确认',
    tagType: 'danger',
    description: '流程暂停，等用户在聊天里点「同意 / 拒绝」后再继续（人工闸口）。',
    group: '人工介入'
  },
  'hitl.bpm_approval': {
    label: 'BPM 审批',
    tagType: 'danger',
    description: '发起一条正式的 BPM 审批单，审批人在 BPM 里通过/驳回后自动唤醒流程。',
    group: '人工介入'
  },
  wait: {
    label: '等待',
    tagType: 'info',
    description: '定时等待若干秒，或挂起等待外部系统回调事件后继续。',
    group: '人工介入'
  },
  agent_loop: {
    label: '自主循环',
    tagType: 'success',
    description: '给模型一个目标和一组只读工具，由它自主决定查什么、查几轮，直到得出答案。',
    group: '高级'
  },
  sub_workflow: {
    label: '子流程',
    tagType: 'info',
    description: '内嵌调用另一条已发布的流程（复用既有编排，避免重复搭建）。',
    group: '高级'
  }
}

/** 编辑器左侧目录的分组顺序（组内按 NODE_TYPE_META 声明顺序） */
export const NODE_TYPE_GROUPS: string[] = ['基础', '分支与并行', '人工介入', '高级']

/** 取类型元数据；未知类型给中性兜底（label 回落原始 type，绝不抛） */
export const nodeTypeMeta = (type?: string | null): NodeTypeMeta =>
  NODE_TYPE_META[type ?? ''] ?? {
    label: type || '节点',
    tagType: 'info',
    description: '',
    group: '高级'
  }

/**
 * 名称解析器注入点（重构 S1 / L1）—— 把 DSL 里的机器键翻成中文名。
 *
 * 🔴 **每个方法都可选**、且整个参数可选：不传就是今天的行为（原样打印机器键）。
 * 现有 3 个 spec 文件都不传，故行为逐字不变；生产路径由 `nameCatalog.ts` 的 `nameResolver` 注入。
 *
 * 🔴 本文件**绝不** import `nameCatalog.ts`：那边 import 这边（`nodeTypeLabel` 复用 `nodeTypeMeta`），
 * 反向依赖会成环，且会把 Vue 的 `ref` 拖进这个刻意保持 Vue-free 的纯函数模块。
 *
 * 🔴 解析器**查不到必须回落原键**（由实现方保证），本模块只判「有没有变化」：
 * 变了才把原键挪进括号，没变就保持原样 —— 否则会出现「调用工具「」（datamodel_create）」这种更坏的输出。
 */
export interface NodeNameResolver {
  toolLabel?: (key?: string | null) => string
  workflowLabel?: (code?: string | null) => string
  widgetLabel?: (type?: string | null) => string
  operatorLabel?: (op?: string | null) => string
}

/**
 * 「机器键 + 中文名」并排展示：解析成功 → `前缀「中文名」（机器键）`；失败或未传解析器 → `前缀「机器键」`。
 *
 * 🔴 中文名后仍带原键是刻意的（方案 §3-L1）：运维排查看 key、业务用户看中文，两者都要。
 * 而回落分支保留 `前缀` 原文（如「工具」二字），是为了让「目录没加载」与「目录加载了」两种输出
 * 在结构上一致 —— 用户不会因为一次网络抖动就看到句子少了个成分。
 */
const named = (
  prefix: string,
  key: string,
  resolve?: (k: string) => string | undefined
): string => {
  const label = resolve?.(key)
  return label && label !== key ? `${prefix}「${label}」（${key}）` : `${prefix}「${key}」`
}

/** 摘要节点：卡片 props / 画布 data 共用的形状 */
export interface SummaryNode {
  id: string
  type?: string
  name?: string
  /** 一句话摘要（可能为空串 = 该类型无可摘要信息） */
  summary: string
  /** 展开态详情行 */
  details: { label: string; value: string }[]
}

/** 截断长文本：摘要 40 字、详情值 120 字，超长加省略号 */
const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s)

const str = (v: any): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * 把任意 config 值转成可读单行文本。
 * 🔴 人话化（问题3a）：对象渲染成「键=值、键=值」而非原样吐 JSON；数组用「、」连接；标量直接转字符串。
 * 递归有深度上限，防脏数据自引用爆栈。
 */
const readable = (v: any, depth = 0): string => {
  if (v === null || v === undefined) return ''
  if (depth > 3) return truncate(str(v).replace(/\s+/g, ' ').trim(), 120)
  if (Array.isArray(v)) return truncate(v.map((x) => readable(x, depth + 1)).filter(Boolean).join('、'), 120)
  if (typeof v === 'object') {
    const parts = Object.entries(v)
      .map(([k, val]) => `${k}=${readable(val, depth + 1)}`)
      .filter((s) => !s.endsWith('='))
    return truncate(parts.join('、'), 120)
  }
  return truncate(str(v).replace(/\s+/g, ' ').trim(), 120)
}

const asArray = (v: any): any[] => (Array.isArray(v) ? v : [])
const asObject = (v: any): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : {}

/** condition.rule 的分支数：兼容 conditionGroups（新写法）与 conditions（扁平写法）两种形态 */
const ruleBranchCount = (config: Record<string, any>): number => asArray(config.branches).length

/**
 * 单节点一句话摘要 —— 把 config 提炼成业务人员看得懂的「这个节点要做什么」。
 * 每种类型一个模板；缺字段时如实说「未配置 xx」（这本身就是有用的信息），未知类型兜底列 config 键名。
 * 🔴 人话化（问题3a）：不再把 outputVar / 变量名 / 工具入参键名这些技术标识甩给用户；
 *    分支目标本就是要给用户看的路由名（condition.rule 的 target / condition.llm 的 choices），保留原样。
 * 🔴 第二参 `resolver` 可选（重构 S1 / L1）：传了就把工具键、子流程 code 翻成中文名并排展示，
 *    不传则与今天逐字一致。见 {@link NodeNameResolver}。
 */
export const summarizeNode = (
  node?: { type?: string; config?: Record<string, any> } | null,
  resolver?: NodeNameResolver | null
): string => {
  if (!node) return ''
  const config = asObject(node.config)
  switch (node.type) {
    case 'tool': {
      if (!config.toolId) return '调用工具（未选择工具）'
      return named('调用工具', str(config.toolId), resolver?.toolLabel)
    }
    case 'llm': {
      if (!config.prompt) return '调用大模型生成文本（未填写提示词）'
      return `让大模型：「${truncate(str(config.prompt).replace(/\s+/g, ' '), 40)}」`
    }
    case 'condition.rule': {
      const n = ruleBranchCount(config)
      if (!n) return '按规则走分支（未配置分支）'
      const targets = asArray(config.branches)
        .map((b: any) => asObject(b).target)
        .filter(Boolean)
        .slice(0, 3)
      const def = config.default ? `；都不命中走「${config.default}」` : ''
      return `按变量值分 ${n} 路：${targets.join('、')}${def}`
    }
    case 'condition.llm': {
      const choices = asArray(config.choices)
      if (!choices.length) return `让模型选路（未配置候选项）${config.default ? `；都不命中走「${config.default}」` : ''}`
      return `让模型在 ${choices.length} 个选项中选路：${truncate(choices.map(str).join('、'), 40)}`
    }
    case 'knowledge_retrieval': {
      const q = config.queryVar
        ? '按上游结果检索'
        : config.query
          ? `检索「${truncate(str(config.query), 30)}」`
          : '检索相关资料'
      const topK = config.topK ? `，取前 ${config.topK} 条` : ''
      return `从知识库${q}${topK}`
    }
    case 'hitl.confirm':
      return '暂停流程，等用户点「同意 / 拒绝」后再继续'
    case 'hitl.bpm_approval':
      return config.bpmProcessDefKey
        ? `发起 BPM 审批「${config.bpmProcessDefKey}」，等审批有结果后继续`
        : '发起 BPM 审批（未配置流程标识）'
    case 'parallel': {
      const n = asArray(config.branches).length
      return n ? `${n} 条分支同时执行，全部完成后汇聚` : '并行分发（未配置分支）'
    }
    case 'wait': {
      if (config.waitType === 'event') return `挂起等待外部事件「${config.eventKey || '未配置事件'}」`
      if (config.waitType === 'duration' || config.duration) return `等待 ${config.duration ?? '?'} 秒后继续`
      return '等待（未配置等待方式）'
    }
    case 'script':
      return config.code ? '执行一段 JavaScript 计算' : '执行脚本（未填写脚本内容）'
    case 'agent_loop': {
      const goal = config.goal ? `：「${truncate(str(config.goal), 40)}」` : '（未描述目标）'
      const tools = asArray(config.tools).length ? `，可用工具 ${asArray(config.tools).length} 个` : ''
      const steps = config.maxSteps ? `，最多 ${config.maxSteps} 步` : ''
      return `让模型自主完成${goal}${tools}${steps}`
    }
    case 'iteration': {
      const body = asArray(config.body).length ? `，循环体 ${asArray(config.body).length} 个节点` : ''
      return `逐项处理一个列表里的每一项${body}`
    }
    case 'sub_workflow': {
      if (!config.workflowId) return '调用子流程（未选择流程）'
      // 🔴 workflowId 存的是流程 **code**（不是数据库 id），所以今天画布上显示的是 `wf_asset_check` 这类机器码
      const ver = config.version ? ` v${config.version}` : ''
      return named('调用另一条已发布流程', str(config.workflowId), resolver?.workflowLabel) + ver
    }
    default: {
      const keys = Object.keys(config)
      return keys.length ? `${node.type || '未知类型'}节点（${truncate(keys.join('、'), 40)}）` : ''
    }
  }
}

/** 每种类型的必填 config 键（缺失 = 画布节点打红点警示；校验的权威判定仍在后端，这里只做即时提示） */
const REQUIRED_KEYS: Record<string, string[]> = {
  tool: ['toolId'],
  llm: ['prompt'],
  'condition.rule': ['branches'],
  'condition.llm': ['prompt', 'choices'],
  knowledge_retrieval: ['knowledgeBaseId'],
  'hitl.bpm_approval': ['bpmProcessDefKey'],
  parallel: ['branches'],
  wait: ['waitType'],
  script: ['code'],
  agent_loop: ['goal'],
  iteration: ['itemsVar', 'body'],
  sub_workflow: ['workflowId']
  // hitl.confirm 无必填（approveVar 有默认值）
}

/** 节点必填配置是否有缺口（空串/空数组/空对象都算缺）。未知类型不判缺，避免误报红点 */
export const nodeHasRequiredGap = (node?: { type?: string; config?: Record<string, any> } | null): boolean => {
  if (!node) return false
  const required = REQUIRED_KEYS[node.type ?? '']
  if (!required) return false
  const config = asObject(node.config)
  return required.some((k) => {
    const v = config[k]
    if (v === null || v === undefined || v === '') return true
    if (Array.isArray(v)) return v.length === 0
    if (typeof v === 'object') return Object.keys(v).length === 0
    return false
  })
}

/** 顶层字段（与 config 平级）的中文标签 */
const TOP_LEVEL_LABELS: Record<string, string> = {
  recovery: '失败恢复',
  compensation: '补偿动作',
  retry: '重试策略',
  timeoutSeconds: '超时（秒）'
}

/**
 * 详情行里「存的是机器键」的 config 键 → 该用哪个解析方法。
 * 其余键的值本就是给人看的文本（提示词、事件名、变量名），不翻译。
 */
const KEY_RESOLVER: Record<string, keyof NodeNameResolver> = {
  toolId: 'toolLabel',
  /** agent_loop 的可用工具清单，值是工具键数组 */
  tools: 'toolLabel',
  workflowId: 'workflowLabel'
}

/**
 * 翻译一个详情值。🔴 数组逐个翻译后**仍交回 `readable`** 拼「、」，输出形态与今天一致；
 * 非字符串原样返回（脏数据不该在这里被改形状）。
 */
const resolveDetailValue = (key: string, raw: any, resolver?: NodeNameResolver | null): any => {
  const fn = resolver?.[KEY_RESOLVER[key] ?? '']
  if (!fn) return raw
  if (Array.isArray(raw)) return raw.map((x) => (typeof x === 'string' ? fn(x) : x))
  return typeof raw === 'string' ? fn(raw) : raw
}

/**
 * 展开态详情行：先按 schema 顺序列 config（跳过空值），再列 schema 外的键，最后列顶层 recovery 等字段。
 * 标签用中文（来自 nodeConfigSchema 的字段声明），值转可读单行。
 * 🔴 第二参 `resolver` 可选（重构 S1 / L1）：传了则工具键、子流程 code 翻成中文名，不传与今天逐字一致。
 */
export const nodeDetailLines = (
  node?: {
    type?: string
    config?: Record<string, any>
    [k: string]: any
  } | null,
  resolver?: NodeNameResolver | null
): { label: string; value: string }[] => {
  if (!node) return []
  const config = asObject(node.config)
  const lines: { label: string; value: string }[] = []
  const seen = new Set<string>()
  for (const f of fieldsFor(node.type)) {
    if (!(f.key in config)) continue
    seen.add(f.key)
    const text = readable(resolveDetailValue(f.key, config[f.key], resolver))
    if (text) lines.push({ label: f.label, value: text })
  }
  for (const [k, v] of Object.entries(config)) {
    if (seen.has(k)) continue
    const text = readable(resolveDetailValue(k, v, resolver))
    if (text) lines.push({ label: k, value: text })
  }
  for (const [k, label] of Object.entries(TOP_LEVEL_LABELS)) {
    if (node[k] !== undefined && node[k] !== null && node[k] !== '') {
      lines.push({ label, value: readable(node[k]) })
    }
  }
  return lines
}

/**
 * 把 nodes[] 组装成卡片用的 SummaryNode[]（容错：非数组/元素残缺都跳过）。
 * 🔴 人话化（问题3a）：无名节点回退成「步骤 N」（按在列表里的次序），不再把裸节点 id 甩给用户。
 */
export const buildSummaryNodes = (nodes: any, resolver?: NodeNameResolver | null): SummaryNode[] =>
  asArray(nodes)
    .filter((n) => n && n.id)
    .map((n, i) => ({
      id: str(n.id),
      type: n.type,
      name: n.name ? str(n.name) : `步骤 ${i + 1}`,
      summary: summarizeNode(n, resolver),
      details: nodeDetailLines(n, resolver)
    }))

/** DSL 边（flowStepsText 只读这几个键） */
export interface SummaryEdge {
  from?: string
  to?: string
  type?: string
  cases?: Record<string, string>
  default?: string
}

const isConditionalEdge = (e: SummaryEdge): boolean =>
  (e.type ?? '').toLowerCase() === 'conditional' || (!!e.cases && Object.keys(e.cases).length > 0)

/**
 * edges → 流程走向文本行（卡片「执行顺序」小节）。
 * 普通边 `A → B`；条件边每个 case 一行 `A →（分支名） B`、default 一行 `A →（默认） B`。
 * START/END 译作「开始/结束」；无名节点回退「步骤 N」；端点指向不存在节点的边跳过（结构合法性是后端校验的事，展示层不崩不谎报）。
 */
export const flowStepsText = (
  nodes: { id?: string; name?: string }[] | undefined | null,
  edges: SummaryEdge[] | undefined | null
): string[] => {
  const nameOf = new Map<string, string>()
  asArray(nodes).forEach((n, i) => {
    if (n && n.id) nameOf.set(str(n.id), n.name ? str(n.name) : `步骤 ${i + 1}`)
  })
  const label = (ref: string): string | null => {
    if (ref === 'START') return '开始'
    if (ref === 'END') return '结束'
    return nameOf.get(ref) ?? null
  }
  const lines: string[] = []
  for (const e of asArray(edges)) {
    if (!e || !e.from) continue
    const from = label(str(e.from))
    if (!from) continue
    if (isConditionalEdge(e)) {
      for (const [route, tgt] of Object.entries(asObject(e.cases))) {
        const to = tgt ? label(str(tgt)) : null
        if (to) lines.push(`${from} →（${route}） ${to}`)
      }
      if (e.default) {
        const to = label(str(e.default))
        if (to) lines.push(`${from} →（默认） ${to}`)
      }
    } else if (e.to) {
      const to = label(str(e.to))
      if (to) lines.push(`${from} → ${to}`)
    }
  }
  return lines
}
