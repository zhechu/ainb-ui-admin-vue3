import request from '@/config/axios'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { getAccessToken, getTenantId } from '@/utils/auth'
import { config } from '@/config/axios/config'

/** 会话 */
export interface AgentConversationVO {
  id: number
  /**
   * 本会话绑定的 Agent 定义编号；空=默认平台助手。
   * 🔴 创建时定、之后以会话为准：会话一旦绑定，聊天入口的 Agent 选择器锁定为该 Agent，
   * 刷新/从列表重进都据此恢复人设（后端 AgentConversationRespVO.agentDefId 回传）。
   */
  agentDefId?: number | null
  title: string
  scene: string
  pinned: boolean
  messageCount: number
  lastActiveTime: Date
  createTime: Date
}

/** 手册引用片段 */
export interface AgentReferenceVO {
  id: number
  documentId: number
  documentName?: string
  content: string
  score: number
}

/** 对话后建议 */
export interface AgentSuggestionVO {
  /** 展示文本，点击后直接发送 */
  text: string
  /** 该建议涉及的工具；纯追问类为 null。后端已按当前用户的授权预筛过 */
  tool?: string | null
}

/** 消息 */
export interface AgentMessageVO {
  id: number
  conversationId: number
  role: 'user' | 'assistant'
  content: string
  reasoningContent?: string
  references?: AgentReferenceVO[]
  suggestions?: AgentSuggestionVO[]
  status: string
  errorMsg?: string
  /**
   * 关联的 Workflow 定义编号。有值说明这条助手消息是一张 plan-as-workflow 草稿卡片，
   * 需要另调 /agent/planner/workflow-draft 把 DSL 取回来重建节点预览 —— SSE 里只带
   * defId/code/name/摘要，刷新页面之后这条路径是唯一能把卡片找回来的办法。
   */
  workflowDefId?: number
  /**
   * 关联的 Workflow 执行实例编号（增量13）。有值说明这条助手消息是一张「人工确认卡片」——
   * 工作流驱动的 Agent 绑定的 chatflow 在 hitl.confirm 节点挂起时落的。刷新页面后凭它调
   * /agent/workflow/execution/get 查执行状态重建卡片：仍 INTERRUPTED→「待确认」（按钮可点，
   * 走 resume-workflow-stream 续跑）；已结束→只读「已处理」。与 workflowDefId 同为「卡片重建钥匙」。
   */
  executionId?: number
  createTime: Date
}

/**
 * SSE 事件
 *
 * ⚠️ 后端用「类型 + 数据」走<b>一个</b>通道，而不是给每种事件单开一个 SSE event name。
 * 理由是 fetchEventSource 按 event name 分发时，前端漏注册一种就会静默丢弃那类事件 ——
 * 漏掉哪种取决于后端什么时候新增，前端不会有任何报错。
 * 所以消费时 switch 一定要留 default 分支。
 */
export interface AgentChatEventVO {
  /**
   * 🔴 与后端 {@code AgentAssistantService.EventType} 必须一一对应。
   * PLANNING / WORKFLOW_DRAFT 曾经漏在这里（运行时的 switch 反倒处理了），
   * 类型看着「合法」，实际少两种 —— 这个联合类型的意义正在于让人看出漏了什么。
   */
  type:
    | 'META'
    | 'MESSAGE'
    | 'REASONING'
    | 'SUGGESTIONS'
    | 'PLANNING'
    | 'WORKFLOW_DRAFT'
    | 'WORKFLOW_CONFIRM'
    | 'DONE'
    | 'ERROR'
  content?: string
  conversationId?: number
  messageId?: number
  references?: AgentReferenceVO[]
  suggestions?: AgentSuggestionVO[]
  /** WORKFLOW_DRAFT 事件：Workflow 定义编号，DSL 正文要另调 /agent/planner/workflow-draft 取 */
  workflowDefId?: number
  /** WORKFLOW_DRAFT 事件：定义 code，确认时用它发布 + 运行 */
  workflowCode?: string
  /** WORKFLOW_DRAFT 事件：定义名 */
  workflowName?: string
  /** WORKFLOW_DRAFT 事件：草稿摘要 */
  summary?: string
  /** WORKFLOW_DRAFT 事件：需要用户留意的提示（如校验器的静默改写警告） */
  warnings?: string[]
  /**
   * WORKFLOW_DRAFT 事件：生成这份草稿用掉了几轮「生成-校验-自修正」，最小为 1。
   *
   * 🔴 可为 null，且**不落库**：刷新页面后卡片凭 workflowDefId 重建，那时它就是 null。
   *    消费端必须「null 不显示」而不是「null 当 0」——0 会被读成「一轮都没跑」。
   *    同理这里不能写 `data.rounds || 0`，那会把两种情况压成同一个值。
   */
  rounds?: number | null
  /** WORKFLOW_CONFIRM 事件：挂起的执行实例编号，点确认/拒绝时回传 resume-workflow-stream（增量13） */
  executionId?: number
  /** WORKFLOW_CONFIRM 事件：挂起所在的节点 id，供卡片显示「卡在哪个闸口」 */
  nodeId?: string
  errorMsg?: string
}

export const AgentAssistantApi = {
  /**
   * 发送消息（流式）
   *
   * 🔴 用 fetchEventSource 而不是原生 EventSource：后者<b>只能发 GET、不能带 Authorization 头</b>，
   * 而这个接口要登录态。把 token 放 query 上倒是能绕过去，但那会让它进到
   * 网关日志与浏览器历史里 —— 不值得。
   */
  sendStream: (
    conversationId: number | undefined,
    content: string,
    agentDefId: number | undefined,
    ctrl: AbortController,
    onMessage: (event: any) => void,
    onError: (err: any) => void,
    onClose: () => void
  ) => {
    return fetchEventSource(`${config.base_url}/agent/assistant/send-stream`, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAccessToken()}`,
        'tenant-id': `${getTenantId()}`
      },
      // 切到后台标签页时不要断开：一次问答要十几二十秒，
      // 用户很可能切走去干别的，回来发现对话断了会以为系统不稳定
      openWhenHidden: true,
      // agentDefId 仅在<b>新建会话</b>（conversationId 为空）时被后端采纳并落库绑定；
      // 既有会话以会话自己的 agent_def_id 为准，这里带不带都被忽略（防中途换人设）
      body: JSON.stringify({ conversationId, content, agentDefId }),
      onmessage: onMessage,
      onerror: onError,
      onclose: onClose,
      signal: ctrl.signal
    })
  },

  /**
   * 聊天内恢复挂起的工作流（流式，增量13）
   *
   * 工作流驱动的 Agent 绑定的 chatflow 在 hitl.confirm 节点挂起后，用户在确认卡片点「同意/拒绝」即发这个请求，
   * 从断点续跑，回推的仍是聊天事件（PLANNING/MESSAGE/WORKFLOW_CONFIRM/DONE/ERROR），与 sendStream 同款消费。
   *
   * 🔴 与 sendStream 完全同构：同样用 fetchEventSource（要登录态、要 POST）、同样 openWhenHidden、
   *    同样把 AbortController 的 signal 传进去（用户切走/组件卸载时可中断，避免续跑在后台白跑）。
   * @param executionId 挂起的执行实例编号（从 WORKFLOW_CONFIRM 事件 / 刷新重建时取得）
   * @param approved    true=同意续跑，false=拒绝（服务端写进 hitl_approved 变量）
   */
  resumeWorkflowStream: (
    executionId: number,
    approved: boolean,
    conversationId: number,
    ctrl: AbortController,
    onMessage: (event: any) => void,
    onError: (err: any) => void,
    onClose: () => void
  ) => {
    return fetchEventSource(`${config.base_url}/agent/assistant/resume-workflow-stream`, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAccessToken()}`,
        'tenant-id': `${getTenantId()}`
      },
      openWhenHidden: true,
      body: JSON.stringify({ executionId, approved, conversationId }),
      onmessage: onMessage,
      onerror: onError,
      onclose: onClose,
      signal: ctrl.signal
    })
  },

  getConversationPage: (params: any) =>
    request.get({ url: '/agent/assistant/conversation/page', params }),

  createConversation: (title?: string) =>
    request.post({ url: '/agent/assistant/conversation/create', params: { title } }),

  updateConversationTitle: (id: number, title: string) =>
    request.put({ url: '/agent/assistant/conversation/update-title', params: { id, title } }),

  updateConversationPinned: (id: number, pinned: boolean) =>
    request.put({ url: '/agent/assistant/conversation/update-pinned', params: { id, pinned } }),

  deleteConversation: (id: number) =>
    request.delete({ url: '/agent/assistant/conversation/delete', params: { id } }),

  getMessageList: (conversationId: number) =>
    request.get({ url: '/agent/assistant/message/list', params: { conversationId } })
}
