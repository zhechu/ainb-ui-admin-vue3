import { test, expect } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 「工作流驱动的 Agent」端到端验证（增量12 / P5 第四刀 slice-3c：接线 DSL 预留的 trigger.chat）
 *
 * 🔴 为什么非要走浏览器
 * 后端单测已证 chat() 在意图分类前反查已发布 chatflow、命中则跑 workflowRunStream 并把
 * WorkflowEvent 桥成 AgentChatEvent（AgentAssistantServiceImplWorkflowRouteTest），curl 差分也证了
 * SSE 出 PLANNING+MESSAGE(tool 输出)+DONE、agent_workflow_execution 落库、agent_usage_log 无 CHAT 记录。
 * 但「选择器选不中绑定 Agent」「桥接出的 MESSAGE 没渲染进气泡」这类缺陷只在真实 DOM 里暴露。
 * 本 spec 钉死前端这一半：选中绑定 chatflow 的 Agent 发消息 → 聊天区出现工作流回复（tool 输出）。
 *
 * 🔴 0 LLM token 的关键设计：绑定的 chatflow 只含一个<b>只读 tool 节点</b>（data_interface_list），
 *    全链路不调模型；且 chat() 命中工作流后<b>跳过意图分类</b>（DD4），也不走直连 LLM 的 stream()。
 *    因此这里<b>不拦截</b> send-stream —— 正是要真跑工作流。断言只看渲染出的 tool 输出文本。
 *    直连 LLM 绝不会对「列出数据接口」产出这段结构化 JSON，出现即证明走的是桥接路径。
 *
 * 前置：后端 48080 + 前端 dev server 同时在跑；库里已有 test_demo_* 数据接口（tool 节点的数据源）。
 * 跑完把造的 chatflow 与 Agent 置 DISABLED（PUBLISHED 不可删；DISABLED 即从反查/选择器消失）。
 */

const TS = Date.now().toString().slice(-8)
const AGENT_CODE = `e2e_wfd_agent_${TS}`
const AGENT_NAME = `E2E工作流驱动${TS}`
const WF_CODE = `e2e_wfd_flow_${TS}`
const WF_NAME = `E2E工作流驱动流程${TS}`

/** tool 节点只读输出的稳定标记：demo 数据接口（直连 LLM 不会产出） */
const REPLY_MARK = /test_demo_product_price|示例-商品单价|"total"\s*:\s*\d/

/** 构造 chatflow DSL：trigger.chat.config.agentId = Agent 的 code（DD2），单 tool 节点写入 output（DD3/DD6） */
function buildDsl(): string {
  return JSON.stringify({
    dslVersion: '1.0',
    id: WF_CODE,
    name: WF_NAME,
    description: 'slice-3c e2e：单 tool 节点只读，全链路 0 LLM token',
    trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: AGENT_CODE } },
    variables: [
      { key: 'input', type: 'string', merge: 'replace', required: false },
      { key: 'output', type: 'object', merge: 'replace' }
    ],
    nodes: [
      {
        id: 'step_1',
        type: 'tool',
        name: '列数据接口',
        config: { toolId: 'data_interface_list', args: { keyword: 'demo', limit: 5 }, outputVar: 'output' }
      }
    ],
    edges: [
      { from: 'START', to: 'step_1' },
      { from: 'step_1', to: 'END' }
    ],
    settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
  })
}

test.describe('工作流驱动的 Agent（对话触发跑指定 workflow）', () => {
  test.setTimeout(180_000)

  let token: string
  let agentId: number
  let wfId: number

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)

    // 建一个已发布 Agent 作选择器数据源（接口造，0 UI、0 token）
    const agentResp = await request.post(`${API_BASE_URL}/agent/def/create`, {
      headers: apiHeaders(token),
      data: { code: AGENT_CODE, name: AGENT_NAME, persona: '你是端到端工作流驱动测试助手，请友好作答。' }
    })
    const agent = (await agentResp.json()) as { code: number; data?: number; msg?: string }
    expect(agent.code, `建 Agent 失败：${JSON.stringify(agent)}`).toBe(0)
    agentId = agent.data!
    const agentPub = await request.post(`${API_BASE_URL}/agent/def/publish?id=${agentId}`, {
      headers: apiHeaders(token)
    })
    expect(((await agentPub.json()) as { code: number }).code, '发布 Agent 失败').toBe(0)

    // 建一条已发布 chatflow 绑定该 Agent：trigger.chat.config.agentId = AGENT_CODE，单 tool 节点（只读，0 token）
    const wfResp = await request.post(`${API_BASE_URL}/agent/workflow-def/create`, {
      headers: apiHeaders(token),
      data: { code: WF_CODE, name: WF_NAME, dsl: buildDsl() }
    })
    const wf = (await wfResp.json()) as { code: number; data?: number; msg?: string }
    expect(wf.code, `建 chatflow 失败：${JSON.stringify(wf)}`).toBe(0)
    wfId = wf.data!
    const wfPub = await request.post(`${API_BASE_URL}/agent/workflow-def/publish?id=${wfId}`, {
      headers: apiHeaders(token)
    })
    const wfPubBody = (await wfPub.json()) as { code: number; msg?: string }
    expect(wfPubBody.code, `发布 chatflow 失败：${JSON.stringify(wfPubBody)}`).toBe(0)
  })

  test.afterAll(async ({ request }) => {
    // PUBLISHED 不可删（可能被引用），置 DISABLED 即从反查/选择器消失，等价清理
    if (wfId) {
      await request.post(`${API_BASE_URL}/agent/workflow-def/disable?id=${wfId}`, {
        headers: apiHeaders(token)
      })
    }
    if (agentId) {
      await request.post(`${API_BASE_URL}/agent/def/disable?id=${agentId}`, {
        headers: apiHeaders(token)
      })
    }
  })

  test('选中绑定 chatflow 的 Agent 发消息 → 聊天区渲染工作流回复（tool 输出，0 LLM token）', async ({
    page
  }) => {
    // 🔴 不拦截 send-stream：本用例正是要真跑工作流（tool 节点只读，全链路 0 LLM token）。
    await login(page)
    await gotoWithAuth(page, '/agent/assistant')

    // 选择器出现，选中绑定 chatflow 的 Agent
    const picker = page.getByTestId('agent-picker')
    await expect(picker).toBeVisible({ timeout: 20000 })
    await picker.click()
    const dropdown = page.locator('.el-select-dropdown__item')
    await expect(dropdown.filter({ hasText: AGENT_NAME }).first()).toBeVisible({ timeout: 10000 })
    await dropdown.filter({ hasText: AGENT_NAME }).first().click()
    await expect(picker).toContainText(AGENT_NAME, { timeout: 10000 })

    // 发一句：命中已发布 chatflow → 跳过意图分类、跑工作流（DD4），tool 输出桥成 MESSAGE 渲染进气泡
    await page.locator('textarea[placeholder*="问点什么吧"]').first().fill('列出数据接口')
    await page.getByRole('button', { name: /发送/ }).first().click()

    // 工作流回复气泡（assistant-answer 渲染 MESSAGE.content）：tool 节点 data_interface_list(keyword=demo)
    // 的输出被 JSONUtil 序列化进 MESSAGE，直连 LLM 绝不会产出这段结构化 JSON —— 出现即证明走了桥接路径。
    const answer = page.getByTestId('assistant-answer').filter({ hasText: REPLY_MARK }).first()
    await expect(answer).toBeVisible({ timeout: 60000 })
  })
})
