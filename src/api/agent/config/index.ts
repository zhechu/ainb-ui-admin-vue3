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
  description: string
  /** 需要的权限串，全部满足才放行 */
  permissions: string[]
  risk: 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH' | 'IRREVERSIBLE'
  riskDescription: string
  enabled: boolean
  /** 是否必须进 Plan 等用户确认 */
  requireConfirm: boolean
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
