import { test, expect } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 聊天入口「按 Agent 路由」端到端验证（增量10 / P5 第二刀：Agent Builder 接线）
 *
 * 🔴 为什么非要走浏览器
 * 后端单测已证 chat() 把 persona/modelId 接进了 LLM 请求（AgentAssistantServiceImplAgentRouteTest），
 * 但「选择器渲染不出来」「选了 Agent 但 send-stream 没带上 agentDefId」这类缺陷只在真实 DOM + 真实
 * 网络请求里暴露。本 spec 钉死前端这一半：已发布目录进选择器 → 选中 → 发送载荷带 agentDefId。
 *
 * 🔴 0 LLM token 的两处关键设计：
 *   1. 造数据走接口（apiLogin + /agent/def/create|publish），不点界面、不跑规划；
 *   2. send-stream 用 page.route 拦截后<b>直接 abort</b>——请求体已被 waitForRequest 抓到，
 *      但绝不真打到后端，因此不触发任何模型调用。断言只看载荷，不等回答。
 *
 * 前置：后端 48080 + 前端 dev server 同时在跑。跑完把造的 def 置 DISABLED（PUBLISHED 不可删）。
 */

const TS = Date.now().toString().slice(-8)
const CODE = `e2e_route_${TS}`
const NAME = `E2E路由助手${TS}`

test.describe('聊天入口按 Agent 路由', () => {
  test.setTimeout(180_000)

  let token: string
  let defId: number

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)
    // 建一个已发布 Agent 作选择器数据源（接口造，0 UI、0 token）
    const createResp = await request.post(`${API_BASE_URL}/agent/def/create`, {
      headers: apiHeaders(token),
      data: { code: CODE, name: NAME, persona: '你是端到端路由测试助手，请友好作答。' }
    })
    const created = (await createResp.json()) as { code: number; data?: number }
    expect(created.code, `建 def 失败：${JSON.stringify(created)}`).toBe(0)
    defId = created.data!
    const pubResp = await request.post(`${API_BASE_URL}/agent/def/publish?id=${defId}`, {
      headers: apiHeaders(token)
    })
    const published = (await pubResp.json()) as { code: number }
    expect(published.code, `发布 def 失败：${JSON.stringify(published)}`).toBe(0)
  })

  test.afterAll(async ({ request }) => {
    // PUBLISHED 不可删（可能被引用），置 DISABLED 即从选择器消失，等价清理
    if (defId) {
      await request.post(`${API_BASE_URL}/agent/def/disable?id=${defId}`, {
        headers: apiHeaders(token)
      })
    }
  })

  test('选择器列出已发布 Agent + 默认助手；选中后 send-stream 载荷带 agentDefId', async ({
    page
  }) => {
    // 🔴 先挂拦截：send-stream 一律 abort，绝不打到后端（0 LLM token）。
    //    请求体仍能被 waitForRequest 抓到——abort 只挡网络，不挡「请求已发出」这个事件。
    await page.route('**/agent/assistant/send-stream', (route) => route.abort())

    await login(page)
    await gotoWithAuth(page, '/agent/assistant')

    // 选择器出现
    const picker = page.getByTestId('agent-picker')
    await expect(picker).toBeVisible({ timeout: 20000 })

    // 展开下拉：既有「默认平台助手」，也有刚发布的 Agent
    await picker.click()
    const dropdown = page.locator('.el-select-dropdown__item')
    await expect(dropdown.filter({ hasText: '默认平台助手' }).first()).toBeVisible({
      timeout: 10000
    })
    await expect(dropdown.filter({ hasText: NAME }).first()).toBeVisible({ timeout: 10000 })

    // 选中该 Agent
    await dropdown.filter({ hasText: NAME }).first().click()
    await expect(picker).toContainText(NAME, { timeout: 10000 })

    // 发一句：不等回答，只抓 send-stream 的请求体
    await page.locator('textarea[placeholder*="问点什么吧"]').first().fill('你好，请自我介绍')
    const reqPromise = page.waitForRequest(
      (r) => r.url().includes('/agent/assistant/send-stream') && r.method() === 'POST',
      { timeout: 15000 }
    )
    await page.getByRole('button', { name: /发送/ }).first().click()
    const req = await reqPromise

    const body = req.postDataJSON() as { conversationId?: number; content?: string; agentDefId?: number }
    expect(body.agentDefId, `send-stream 未带上所选 Agent：${JSON.stringify(body)}`).toBe(defId)
    expect(body.content).toBe('你好，请自我介绍')
    // 新会话：conversationId 此刻应为空（后端在 META 里才回传新 id）
    expect(body.conversationId ?? null).toBeNull()
  })

  test('默认助手选项值为空（不选 Agent 时 send-stream 不带 agentDefId）', async ({ page }) => {
    await page.route('**/agent/assistant/send-stream', (route) => route.abort())
    await login(page)
    await gotoWithAuth(page, '/agent/assistant')

    const picker = page.getByTestId('agent-picker')
    await expect(picker).toBeVisible({ timeout: 20000 })
    // 不动选择器（保持「默认平台助手」），直接发一句
    await page.locator('textarea[placeholder*="问点什么吧"]').first().fill('随便问问')
    const reqPromise = page.waitForRequest(
      (r) => r.url().includes('/agent/assistant/send-stream') && r.method() === 'POST',
      { timeout: 15000 }
    )
    await page.getByRole('button', { name: /发送/ }).first().click()
    const req = await reqPromise

    const body = req.postDataJSON() as { agentDefId?: number | null }
    // 默认助手：agentDefId 为空（null 或字段缺省），后端据此走 BASE_PROMPT + 手册检索
    expect(body.agentDefId ?? null, `默认助手不该带 agentDefId：${JSON.stringify(body)}`).toBeNull()
  })

  test('Agent 定义表单有「模型」与「知识库」下拉（E3：模型/知识库绑定入口）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/def')
    await expect(page.getByText('Agent 编码').first()).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: /新增 Agent/ }).first().click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新建 Agent 定义' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })
    // 「模型」字段在（可空，占位「默认（动态选择）」）——只验结构，不依赖是否有启用的模型数据
    const modelItem = dialog.locator('.el-form-item:has-text("模型")').first()
    await expect(modelItem).toBeVisible({ timeout: 10000 })
    await expect(modelItem.locator('.el-select').first()).toBeVisible()
    // 增量11（slice-3a）：「知识库」字段在（可空，占位「不绑定（无知识库检索）」）——同弹窗内、只验结构，不依赖 KB 数据
    const knowledgeItem = dialog.locator('.el-form-item:has-text("知识库")').first()
    await expect(knowledgeItem).toBeVisible({ timeout: 10000 })
    await expect(knowledgeItem.locator('.el-select').first()).toBeVisible()
    await dialog.getByRole('button', { name: /取消/ }).first().click()
  })
})
