import request from '@/config/axios'

/** 用量汇总的一行 */
export interface AgentUsageGroupVO {
  /** 分组键：用户编号 / 场景名 / 模型名 / 日期 */
  groupKey: string
  /** 可读名称。用户维度是昵称，取不到时与 groupKey 相同 */
  groupLabel: string
  callCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalCost: number
}

/** 配额使用情况 */
export interface AgentQuotaUsageVO {
  /** TENANT 租户级 / USER 用户级 */
  level: 'TENANT' | 'USER'
  /** DAY / MONTH */
  period: 'DAY' | 'MONTH'
  usedTokens: number
  tokenLimit?: number
  usedCost: number
  costLimit?: number
  exceeded: boolean
}

/** 调用明细（含输入原文，需要 agent:usage:detail 权限） */
export interface AgentUsageRecordVO {
  id: number
  userId: number
  scene: string
  modelName: string
  totalTokens: number
  /** PROVIDER 厂商回传 / ESTIMATED 本地估算 */
  tokenSource: string
  cost: number
  status: string
  durationMs: number
  beginTime: string
  inputText?: string
}

/** 可下钻的维度 */
export type AgentUsageDimension = 'SCENE' | 'USER' | 'MODEL' | 'DAY'

/** 用量汇总 */
export const getUsageSummary = (params: {
  dimension: AgentUsageDimension
  beginTime?: string
  endTime?: string
  userId?: number
}) => request.get<AgentUsageGroupVO[]>({ url: '/agent/usage/summary', params })

/** 我的配额使用情况（自查，只要助手权限） */
export const getMyQuota = () => request.get<AgentQuotaUsageVO[]>({ url: '/agent/usage/my-quota' })

/** 最近的调用明细 */
export const getRecentUsage = (limit: number) =>
  request.get<AgentUsageRecordVO[]>({ url: '/agent/usage/recent', params: { limit } })
