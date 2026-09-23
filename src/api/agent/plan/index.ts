import request from '@/config/axios'

/** Plan 步骤 */
export interface AgentPlanStepVO {
  id: number
  seq: number
  toolName: string
  title: string
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'IRREVERSIBLE'
  irreversible: boolean
  params?: any
  preview?: any
  selected: boolean
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED'
  result?: any
  errorMsg?: string
  beginTime?: Date
  endTime?: Date
}

/** 变更计划 */
export interface AgentPlanVO {
  id: number
  conversationId: number
  summary: string
  status:
    | 'DRAFT'
    | 'PENDING_CONFIRM'
    | 'EXECUTING'
    | 'DONE'
    | 'CANCELLED'
    | 'PARTIAL_FAILED'
    | 'EXPIRED'
  confirmedBy?: number
  confirmedTime?: Date
  expireTime: Date
  errorMsg?: string
  createTime: Date
  steps: AgentPlanStepVO[]
}

/** 执行结果 */
export interface AgentPlanExecuteResultVO {
  planId: number
  status: string
  successCount: number
  failedCount: number
  skippedCount: number
  errorMsg?: string
  steps: AgentPlanStepVO[]
}

export const AgentPlanApi = {
  getPlan: (id: number): Promise<AgentPlanVO> =>
    request.get({ url: '/agent/plan/get', params: { id } }),

  updateSelected: (id: number, stepIds: number[]) =>
    request.put({ url: '/agent/plan/update-selected', params: { id, stepIds } }),

  execute: (id: number): Promise<AgentPlanExecuteResultVO> =>
    request.post({ url: '/agent/plan/execute', params: { id } }),

  cancel: (id: number) => request.post({ url: '/agent/plan/cancel', params: { id } })
}
