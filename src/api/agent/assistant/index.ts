import request from '@/config/axios'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { getAccessToken, getTenantId } from '@/utils/auth'
import { config } from '@/config/axios/config'

/** 会话 */
export interface AgentConversationVO {
  id: number
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
  type: 'META' | 'MESSAGE' | 'REASONING' | 'SUGGESTIONS' | 'DONE' | 'ERROR'
  content?: string
  conversationId?: number
  messageId?: number
  references?: AgentReferenceVO[]
  suggestions?: AgentSuggestionVO[]
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
      body: JSON.stringify({ conversationId, content }),
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
