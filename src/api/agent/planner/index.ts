import request from '@/config/axios'
// 🔴 类型-only 的循环引用（workflow/index.ts 反过来 import 本文件的 WorkflowEventVO）。
//    `import type` 会被完全擦除，不产生运行时环 —— 别把它改成值导入。
import type { ChangeManifestVO } from '@/api/agent/workflow'

/**
 * plan-as-workflow 草稿（增量7b）
 *
 * 聊天 BUILD 意图产出的不再是一份线性计划，而是一整份 Workflow DSL 草稿。
 * 后端只把 defId/code/name/摘要随 SSE 事件下发，<b>DSL 正文一律另调 workflow-draft 取</b>——
 * 直播与刷新页面共用这一条装配路径，避免「流里塞一份、刷新查一份」两条逻辑漂移。
 */
export interface AgentWorkflowDraftVO {
  defId: number
  code: string
  name: string
  /** DSL JSON 原文；前端 JSON.parse 取 nodes[] 渲染只读节点预览 */
  dsl: string
  /** DRAFT 待确认 / PUBLISHED 已发布可运行 / DISABLED 已停用 */
  status: 'DRAFT' | 'PUBLISHED' | 'DISABLED'
  version: number
  /**
   * 变更清单（S2-f 出口 3）：草稿卡直接渲染「这份草稿将会改什么」。走**附带版**，
   * 生成不出来时是 null（附加面板的 bug 不能把用户卡死在一张打不开的确认卡上）。
   * 🔴 null 要渲染成「清单不可用」，**不是**「本次不产生任何写操作」。
   */
  manifest?: ChangeManifestVO | null
}

/** 发布结果（确认 = 发布：DRAFT → PUBLISHED，无状态幂等） */
export interface AgentWorkflowPublishVO {
  code: string
  defId: number
  status: string
}

/**
 * run-stream 的一个事件，与后端 {@code AgentWorkflowExecutionService.WorkflowEvent} 一一对应。
 * 同样是「类型 + 数据」单通道，消费时 switch 要留 default。
 */
export interface WorkflowEventVO {
  type: 'META' | 'NODE' | 'INTERRUPTED' | 'DONE' | 'ERROR'
  executionId?: number
  threadName?: string
  nodeId?: string
  /** 节点完成时的 state 投影 / DONE 时的最终输出 */
  state?: Record<string, any>
  errorMsg?: string
}

/** DSL 节点预览（从 dsl.nodes[] 抠出卡片用得到的几项） */
export interface WorkflowNodePreview {
  id: string
  type: string
  name?: string
}

export const AgentPlannerApi = {
  /**
   * 取草稿（含 DSL 原文）。直播收到 WORKFLOW_DRAFT 事件后、以及刷新页面重建卡片时，都走这里。
   */
  getWorkflowDraft: (defId: number): Promise<AgentWorkflowDraftVO> =>
    request.get({ url: '/agent/planner/workflow-draft', params: { defId } }),

  /**
   * 确认 = 发布：把最新草稿 DRAFT → PUBLISHED（幂等，重复发布不报错、不新增版本）。
   * 后端 @RequestParam code，故走 params（query），与 assistant api 的 POST 约定一致。
   */
  publishWorkflow: (code: string): Promise<AgentWorkflowPublishVO> =>
    request.post({ url: '/agent/planner/publish-workflow', params: { code } })
}
