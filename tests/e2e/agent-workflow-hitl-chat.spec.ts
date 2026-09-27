import { test, expect } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 「聊天内 HITL 确认/恢复」端到端验证（增量13，闭合 slice-3c 遗留的 RK5）
 *
 * 🔴 为什么非要走浏览器（后端 curl 差分已证 SSE 出 WORKFLOW_CONFIRM、resume 出 MESSAGE(tool 输出)+DONE、
 *    execution INTERRUPTED→SUCCEEDED、agent_message 两条、无 CHAT 计量）。但有两类缺陷只在真实 DOM 暴露：
 *    ① 工作流路径先发 PLANNING（NODE 进度）→ 设 cardStatus='planning' 渲染 WorkflowDraftCard；中断这一轮
 *       <b>不会再有 MESSAGE</b> 来清 cardStatus，若 WORKFLOW_CONFIRM 处理器忘了先清 cardStatus，
 *       模板会一直渲染草稿卡把确认卡挡在 v-else-if 之后 —— 表现「点了没反应、卡在进度条」，单测看不出。
 *    ② 点「同意并继续」后 resume 的答案要落进<b>新气泡</b>（直播==刷新：后端也 settle 两条消息）。
 *    本 spec 钉死前端这一半：确认卡出现 → 点同意 → 答案气泡渲染 tool 输出 → 卡片转「已同意」。
 *
 * 🔴 0 LLM token：绑定的 chatflow = hitl.confirm 闸口 + 一个只读 tool 节点（data_interface_list）；
 *    chat() 命中工作流后跳过意图分类（DD4），resume 续跑只跑 hitl+tool，全链路不调模型。
 *    不拦截 send-stream / resume-workflow-stream —— 正是要真跑。断言只看渲染出的 tool 输出文本。
 *
 * 前置：后端 48080 + 前端 dev :80 同时在跑；库里已有 test_demo_* 数据接口。
 * 跑完把造的 chatflow 与 Agent 置 DISABLED（PUBLISHED 不可删；DISABLED 即从反查/选择器消失）。
 */

const TS = Date.now().toString().slice(-8)
const AGENT_CODE = `e2e_hitlc_agent_${TS}`
const AGENT_NAME = `E2E聊天确认${TS}`
const WF_CODE = `e2e_hitlc_flow_${TS}`
const WF_NAME = `E2E聊天确认流程${TS}`

/** tool 节点只读输出的稳定标记：demo 数据接口（直连 LLM 不会产出这段结构化 JSON） */
const REPLY_MARK = /test_demo_product_price|示例-商品单价|"total"\s*:\s*\d/

/** chatflow DSL：trigger.chat.config.agentId=Agent code；START→hitl 闸口→只读 tool 写 output→END */
function buildDsl(): string {
  return JSON.stringify({
    dslVersion: '1.0',
    id: WF_CODE,
    name: WF_NAME,
    description: 'inc13 e2e: hitl gate + read-only tool, 0 LLM token',
    trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: AGENT_CODE } },
    variables: [
      { key: 'input', type: 'string', merge: 'replace', required: false },
      { key: 'output', type: 'object', merge: 'replace' },
      // 🔴 resume 的反馈键必须在此声明，SAA updateState 才保留它（hitl 节点读它判同意/拒绝）
      { key: 'hitl_approved', type: 'boolean', merge: 'replace' }
    ],
    nodes: [
      { id: 'hitl_1', type: 'hitl.confirm', name: '人工确认闸口', config: { approveVar: 'hitl_approved' } },
      {
        id: 'step_tool',
        type: 'tool',
        name: '列数据接口',
        config: { toolId: 'data_interface_list', args: { keyword: 'demo', limit: 5 }, outputVar: 'output' }
      }
    ],
    edges: [
      { from: 'START', to: 'hitl_1' },
      { from: 'hitl_1', to: 'step_tool' },
      { from: 'step_tool', to: 'END' }
    ],
    settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
  })
}

test.describe('聊天内 HITL 确认/恢复（工作流驱动的 Agent）', () => {
  test.setTimeout(180_000)

  let token: string
  let agentId: number
  let wfId: number

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)

    const agentResp = await request.post(`${API_BASE_URL}/agent/def/create`, {
      headers: apiHeaders(token),
      data: { code: AGENT_CODE, name: AGENT_NAME, persona: '你是端到端聊天确认测试助手，请友好作答。' }
    })
    const agent = (await agentResp.json()) as { code: number; data?: number; msg?: string }
    expect(agent.code, `建 Agent 失败：${JSON.stringify(agent)}`).toBe(0)
    agentId = agent.data!
    expect(
      ((await (await request.post(`${API_BASE_URL}/agent/def/publish?id=${agentId}`, { headers: apiHeaders(token) })).json()) as { code: number }).code,
      '发布 Agent 失败'
    ).toBe(0)

    const wfResp = await request.post(`${API_BASE_URL}/agent/workflow-def/create`, {
      headers: apiHeaders(token),
      data: { code: WF_CODE, name: WF_NAME, dsl: buildDsl() }
    })
    const wf = (await wfResp.json()) as { code: number; data?: number; msg?: string }
    expect(wf.code, `建 chatflow 失败：${JSON.stringify(wf)}`).toBe(0)
    wfId = wf.data!
    const wfPubBody = (await (await request.post(`${API_BASE_URL}/agent/workflow-def/publish?id=${wfId}`, { headers: apiHeaders(token) })).json()) as { code: number; msg?: string }
    expect(wfPubBody.code, `发布 chatflow 失败：${JSON.stringify(wfPubBody)}`).toBe(0)
  })

  test.afterAll(async ({ request }) => {
    if (wfId) {
      await request.post(`${API_BASE_URL}/agent/workflow-def/disable?id=${wfId}`, { headers: apiHeaders(token) })
    }
    if (agentId) {
      await request.post(`${API_BASE_URL}/agent/def/disable?id=${agentId}`, { headers: apiHeaders(token) })
    }
  })

  test('选中绑定含 hitl 闸口的 chatflow 的 Agent 发消息 → 确认卡出现 → 点同意 → 答案气泡渲染 tool 输出', async ({
    page
  }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/assistant')

    // 选中绑定 chatflow 的 Agent
    const picker = page.getByTestId('agent-picker')
    await expect(picker).toBeVisible({ timeout: 20000 })
    await picker.click()
    const dropdown = page.locator('.el-select-dropdown__item')
    await expect(dropdown.filter({ hasText: AGENT_NAME }).first()).toBeVisible({ timeout: 10000 })
    await dropdown.filter({ hasText: AGENT_NAME }).first().click()
    await expect(picker).toContainText(AGENT_NAME, { timeout: 10000 })

    // 发一句：命中 chatflow → 跑到 hitl 闸口挂起 → WORKFLOW_CONFIRM
    await page.locator('textarea[placeholder*="问点什么吧"]').first().fill('列出数据接口')
    await page.getByRole('button', { name: /发送/ }).first().click()

    // 🔴 核心判据①：确认卡片出现（不是被 WorkflowDraftCard 挡住）。
    //    PLANNING 事件先设了 cardStatus='planning'，WORKFLOW_CONFIRM 处理器必须先清 cardStatus，
    //    否则下面这张卡永远不可见 —— 这正是单测抓不到、只有真实 DOM 才暴露的缺陷。
    const card = page.getByTestId('hitl-confirm-card').first()
    await expect(card).toBeVisible({ timeout: 60000 })
    await expect(card).toContainText('待确认')
    await expect(page.getByTestId('hitl-approve')).toBeVisible()
    await expect(page.getByTestId('hitl-reject')).toBeVisible()

    // 点「同意并继续」→ resume-workflow-stream → hitl 放行 → tool 节点写 output → MESSAGE
    await page.getByTestId('hitl-approve').click()

    // 🔴 核心判据②：答案落进新气泡（assistant-answer 渲染 MESSAGE.content = tool JSON）。
    //    直连 LLM 绝不会产出这段结构化 JSON，出现即证明 resume 真跑了工作流并桥回了 output。
    const answer = page.getByTestId('assistant-answer').filter({ hasText: REPLY_MARK }).first()
    await expect(answer).toBeVisible({ timeout: 60000 })

    // 卡片转「已同意」（decided 态，按钮消失换只读标签）
    await expect(card).toContainText('已同意', { timeout: 10000 })
    await expect(page.getByTestId('hitl-approve')).toHaveCount(0)
  })
})
