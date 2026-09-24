import { expect, type APIRequestContext } from '@playwright/test'
import { API_BASE_URL, apiHeaders } from './auth'

/**
 * AI 助手子系统的接口侧铺数据工具
 *
 * 会话与消息全量落在后端，所以「有一条历史会话」这种前置条件用接口造最省事 ——
 * 走界面点一轮问答要十几二十秒（还依赖聊天模型可用），而接口建一条是毫秒级。
 * 断言始终只在界面上做，这一层只负责把台子搭好、跑完拆掉。
 */

const BASE = `${API_BASE_URL}/agent/assistant`

/** 建一个会话（空消息），返回会话编号 */
export async function createConversation(
  request: APIRequestContext,
  token: string,
  title: string
): Promise<number> {
  const response = await request.post(`${BASE}/conversation/create`, {
    headers: apiHeaders(token),
    params: { title }
  })
  const body = await response.json()
  expect(body.code, `建会话接口失败：${body.msg}`).toBe(0)
  return body.data as number
}

/**
 * 清掉标题以 E2E 开头的会话
 *
 * 后端库是共用的，问答用例每跑一次就落一条会话。不清的话列表越堆越长，
 * 而且「最近一条」会被上一轮的残留占着 —— 那会让恢复类用例看着过了、
 * 其实测的是旧数据。
 */
export async function sweepTestConversations(request: APIRequestContext, token: string) {
  const response = await request.get(`${BASE}/conversation/page`, {
    headers: apiHeaders(token),
    params: { pageNo: 1, pageSize: 100 }
  })
  const body = await response.json()
  for (const item of body?.data?.list ?? []) {
    if (typeof item.title === 'string' && item.title.startsWith('E2E')) {
      await request.delete(`${BASE}/conversation/delete`, {
        headers: apiHeaders(token),
        params: { id: item.id }
      })
    }
  }
}
