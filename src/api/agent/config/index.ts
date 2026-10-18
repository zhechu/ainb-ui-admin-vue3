import request from '@/config/axios'

/** AI 助手的租户级配置 */
export interface AgentConfigVO {
  enabled: boolean
  remark: string
  /** 是否配置过。false 表示库里还没有这一行 */
  configured: boolean
  updateTime?: string
  updater?: string
}

/** 工具目录快照（只读）：内置注册表 ∪ 当前租户登记的自定义工具，靠 source 区分 */
export interface AgentToolVO {
  name: string
  /**
   * 中文展示名。后端早已下发（{@code AgentConfigController.toolList}），只是这里此前没声明，
   * 于是 TypeScript 眼里它不存在、页面就只能显示 name —— 一屏下划线英文。
   */
  displayName?: string
  /** 分组名（中文），空串表示不分组 */
  groupName?: string
  description: string
  /** 需要的权限串，全部满足才放行 */
  permissions: string[]
  risk: 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH' | 'IRREVERSIBLE'
  riskDescription: string
  enabled: boolean
  /**
   * 生效值口径的「是否必须进 Plan 等用户确认」。
   * 🔴 本页（AI 配置管理）是「生效值快照」，照它显示没错；但**别拿它过滤工具** ——
   *    `def/editor/index.vue` 曾经这么干，见 declaredRequireConfirm。
   */
  requireConfirm: boolean
  /**
   * 代码声明的风险等级 —— 后端 `AgentDefServiceImpl` 与发布期校验 V3/V11 读的都是它。
   * 🔴 降险这个在线维护动作只改生效值，改不动这里。所以「哪些工具算只读、能绑进 agent_loop」
   *    必须按 declaredRequireConfirm 过滤：按生效值过滤会把降过险的工具放进下拉，
   *    用户编排完点发布才被拒 —— 界面主动指了反方向。
   */
  declaredRisk?: 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH' | 'IRREVERSIBLE'
  declaredRiskDescription?: string
  declaredRequireConfirm?: boolean
  /** 生效风险 ≠ 声明风险，即风险标注被在线维护改过 */
  riskOverridden?: boolean
  /** 当前租户是否在线维护过这个工具（管理页据此打「已维护」标记） */
  overridden?: boolean
  /**
   * 工具来源：`BUILTIN`（代码里 `@AgentTool` 声明的内置工具）或 `agent_tool_def.source`
   * 的取值（`DATA_INTERFACE` / `FORM` / `SCRIPT`）。与名称目录 `AgentNameCatalogRespVO.ToolItem#source`
   * 同一个取值域，界面上用它区分「平台自带」与「我在工具管理页登记的」。
   */
  source?: string
  /**
   * 这个工具当前是否真的能被执行。
   * 🔴 `false` 的行（`source=FORM`/`SCRIPT` 这两个预留位）**照样下发、不能从列表里藏掉**：
   *    存量 Agent 可能已经绑了它，一藏起来绑定就退化成一串没人看得懂的裸机器键。
   *    正确做法是在可选下拉里置灰并说明原因 —— 让用户看得见「为什么选不了」，
   *    而不是让已绑的东西凭空消失。
   */
  executable?: boolean
}

/**
 * 工具来源的中文标签，取值域与后端 `AgentToolCatalog.SOURCE_BUILTIN` / `ToolSourceEnum` 一致。
 *
 * 🔴 认不出的来源**原样显示英文枚举值**，不回落成「内置」：后端哪天加一档预留位，
 *    回落会把「还没实现的用户登记项」画成「平台自带的工具」—— 而区分这两件事
 *    正是这张表下发 source 的全部目的。
 * 🔴 `FORM`/`SCRIPT` 标着「预留」是因为它们登记得下、执行不了（`executable=false`），
 *    后端 buildFunction 遇到就抛 AGENT_TOOL_SOURCE_UNSUPPORTED。
 */
export const TOOL_SOURCE_LABEL: Record<string, string> = {
  BUILTIN: '内置',
  DATA_INTERFACE: '数据接口',
  FORM: '表单（预留）',
  SCRIPT: '脚本（预留）'
}

export const toolSourceLabel = (source?: string): string =>
  source ? (TOOL_SOURCE_LABEL[source] ?? source) : '—'

/** 配额 */
export interface AgentQuotaVO {
  id?: number
  /** null 表示不限定用户（租户级 / Agent 级 / 工作流级都为 null） */
  userId?: number
  /**
   * 配额维度：TENANT 整个租户 / USER 指定用户 / AGENT 指定 Agent / WORKFLOW 指定工作流。
   * 🔴 判别归属的权威列；AGENT/WORKFLOW 的目标见 targetKey。
   */
  dimension?: 'TENANT' | 'USER' | 'AGENT' | 'WORKFLOW'
  /**
   * 维度目标键，仅 AGENT/WORKFLOW 用：存对应定义的 code（非 numeric id，跨版本稳定）。
   * 🔴 WORKFLOW 维度只支持 token 上限（节点 trace 无金额、不改计费语义），金额上限对它无效。
   */
  targetKey?: string
  period: 'DAY' | 'MONTH'
  tokenLimit?: number
  costLimit?: number
  warnRatio: number
  /** 0 开启、1 关闭 */
  status: number
  warnedPeriod?: string
}

export const getAgentConfig = () => request.get<AgentConfigVO>({ url: '/agent/config/get' })
export const updateAgentConfig = (data: { enabled: boolean; remark?: string }) =>
  request.put({ url: '/agent/config/update', data })

export const getToolList = () => request.get<AgentToolVO[]>({ url: '/agent/config/tool-list' })

export const getQuotaList = () => request.get<AgentQuotaVO[]>({ url: '/agent/config/quota/list' })

export const saveQuota = (data: AgentQuotaVO) =>
  request.post({ url: '/agent/config/quota/save', data })

export const deleteQuota = (id: number) =>
  request.delete({ url: '/agent/config/quota/delete', params: { id } })
