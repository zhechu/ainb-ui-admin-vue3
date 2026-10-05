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

/** 已注册的工具（只读） */
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
}

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
