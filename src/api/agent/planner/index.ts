import request from '@/config/axios'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { getAccessToken, getTenantId } from '@/utils/auth'
import { config } from '@/config/axios/config'

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
    request.post({ url: '/agent/planner/publish-workflow', params: { code } }),

  /**
   * 运行已发布的流程（流式），复用既有 {@code /agent/workflow/run-stream}。
   *
   * 🔴 用 fetchEventSource 而不是原生 EventSource：后者只能发 GET、不能带 Authorization 头，
   * 而这个接口要登录态（增量14a 起权限为 {@code agent:workflow:run}——副作用面，与只读的
   * {@code agent:workflow:query} 分开；持有「流程编排」菜单的角色已被迁移非破坏性授予 run）。
   * 理由与 assistant.sendStream 完全一致。
   */
  runWorkflowStream: (
    code: string,
    input: Record<string, any>,
    ctrl: AbortController,
    onMessage: (event: any) => void,
    onError: (err: any) => void,
    onClose: () => void
  ) => {
    return fetchEventSource(`${config.base_url}/agent/workflow/run-stream`, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAccessToken()}`,
        'tenant-id': `${getTenantId()}`
      },
      // 运行可能十几秒，用户切走再回来不该发现连接断了
      openWhenHidden: true,
      body: JSON.stringify({ code, input }),
      onmessage: onMessage,
      onerror: onError,
      onclose: onClose,
      signal: ctrl.signal
    })
  }
}
