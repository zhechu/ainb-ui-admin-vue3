import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiHeaders, apiLogin, gotoWithAuth, login, API_BASE_URL } from './helpers/auth'

/**
 * 聊天里连接中断时，页面必须**留着执行编号**并指向执行历史（迭代七 B3-8）
 *
 * 🔴 为什么非要走浏览器
 * 提示文案那半（`resumeRoute.ts`）已由 10 条单测钉住：菜单路径逐字、拿不到编号返回空串、
 * 编号不截断不加千分位。但本条在方案 §8 里是**③行为层**：「真造一次 chat 报错 → 页面**留着
 * executionId** 且提示**指向执行历史**」。只有真断一次连才能暴露这几件单测看不到的事：
 *   · `AssistantChat.vue` 三处 onerror 里，**报错文案与渲染位置是两件事**：
 *     卡片那条消息的 `el-alert` 被 `v-if="!item.cardStatus && !item.hitl"` 圈着 ——
 *     `hitl` 一有值它压根不渲染。只把编号写进 `errorMsg` 的话，在最常见的形态
 *     （撞了人工闸口之后断连）下用户**一个字都看不见**。所以编号另有一条常驻出路：
 *     `HitlConfirmCard` 自己把编号印在卡片上。这一半只有真实 DOM 能验。
 *   · 报错里那个编号必须**等于**库里那条真挂起执行的编号。写死一个 `#0`、
 *     或者取了别的字段（比如 defId、messageId），单测全是绿的，浏览器里一眼就假。
 *
 * 🔴 0 LLM token、0 写操作：seed 的 chatflow = hitl.confirm 闸口 + 一个只读 tool 节点
 * （data_interface_list）；chat() 命中工作流后跳过意图分类（DD4），全链路不调模型。
 * 断连是用 `page.route(...).abort()` 在**浏览器侧**造的 —— 请求压根到不了后端，
 * 所以库里那条执行仍停在 INTERRUPTED（下面有断言），afterAll 取消它。
 *
 * ⚠️ 刻意**不**验 site 1（提问阶段断连却已有编号）的正例：那要求 send-stream 先推回
 * WORKFLOW_CONFIRM、再在流**没关**的时候断掉。后端是「WORKFLOW_CONFIRM 之后紧跟 DONE 就关流」，
 * 浏览器里没有确定性的时机下手（`route.fulfill` 只会走 onclose、`route.abort` 又发不出前面的事件），
 * 硬凑只能靠 sleep 抢时间窗 = 抖。故 site 1 这里只留**反向对照**（见第二条用例）。
 *
 * 前置：后端 48080 + 前端 dev :80 同时在跑；库里已有 test_demo_* 数据接口。
 * 自 seed 自净：afterAll 取消挂起执行、删掉本 Agent 名下的会话、把 chatflow 与 Agent 置 DISABLED
 * （PUBLISHED 不可删；DISABLED 即从反查/选择器消失）。
 */

const TS = Date.now().toString(36)
const AGENT_CODE = `e2e_b38_agent_${TS}`
const AGENT_NAME = `E2E执行编号${TS}`
const WF_CODE = `e2e_b38_flow_${TS}`
const WF_NAME = `E2E执行编号流程${TS}`

/** chatflow DSL：trigger.chat.config.agentId=Agent code；START→hitl 闸口→只读 tool→END */
function buildDsl(): string {
  return JSON.stringify({
    dslVersion: '1.0',
    id: WF_CODE,
    name: WF_NAME,
    description: 'B3-8 e2e: hitl gate + read-only tool, 0 LLM token',
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

/** 报错气泡：宿主模板里 `item.status==='ERROR'` 那条 el-alert 的标题 */
const errorAlert = (page: Page) =>
  page.locator('.el-alert--error .el-alert__title').filter({ hasText: '连接中断，请重试' }).first()

test.describe('聊天断连后页面留着执行编号（B3-8）', () => {
  test.setTimeout(240_000)

  let req: APIRequestContext
  let token = ''
  let agentId = 0
  let wfId = 0

  const api = async (path: string, method = 'GET', body?: any) =>
    req.fetch(API_BASE_URL + path, {
      method,
      data: body,
      timeout: 60_000,
      headers: { 'Content-Type': 'application/json', ...apiHeaders(token) }
    })

  /** 本 chatflow 名下所有仍挂起的执行行（落库与流关闭之间有窗口，故调用方自己轮询） */
  const interruptedExecutions = async (): Promise<any[]> => {
    const page = await (
      await api('/agent/workflow/execution/page?pageNo=1&pageSize=20&workflowDefId=' + wfId)
    ).json()
    return (page?.data?.list ?? []).filter((r: any) => r.status === 'INTERRUPTED')
  }

  const traceNodeIds = async (executionId: number): Promise<string[]> => {
    const r = await (await api('/agent/workflow/node-trace/list?executionId=' + executionId)).json()
    return ((r?.data ?? []) as any[]).map((t) => t.nodeId)
  }

  /** 选中绑定 chatflow 的 Agent 并发一句话 */
  const pickAgentAndSend = async (page: Page, text: string) => {
    const picker = page.getByTestId('agent-picker')
    await expect(picker).toBeVisible({ timeout: 20000 })
    await picker.click()
    const dropdown = page.locator('.el-select-dropdown__item')
    await expect(dropdown.filter({ hasText: AGENT_NAME }).first()).toBeVisible({ timeout: 10000 })
    await dropdown.filter({ hasText: AGENT_NAME }).first().click()
    await expect(picker).toContainText(AGENT_NAME, { timeout: 10000 })

    await page.locator('textarea[placeholder*="问点什么吧"]').first().fill(text)
    await page.getByRole('button', { name: /发送/ }).first().click()
  }

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext()
    token = await apiLogin(req)

    const agent = await (
      await api('/agent/def/create', 'POST', {
        code: AGENT_CODE,
        name: AGENT_NAME,
        persona: '你是端到端执行编号测试助手，请友好作答。'
      })
    ).json()
    if (agent.code !== 0) throw new Error('create agent failed: ' + JSON.stringify(agent))
    agentId = agent.data
    const agentPub = await (await api('/agent/def/publish?id=' + agentId, 'POST')).json()
    if (agentPub.code !== 0) throw new Error('publish agent failed: ' + JSON.stringify(agentPub))

    const wf = await (
      await api('/agent/workflow-def/create', 'POST', { code: WF_CODE, name: WF_NAME, dsl: buildDsl() })
    ).json()
    if (wf.code !== 0) throw new Error('create chatflow failed: ' + JSON.stringify(wf))
    wfId = wf.data
    const wfPub = await (await api('/agent/workflow-def/publish?id=' + wfId, 'POST')).json()
    if (wfPub.code !== 0) throw new Error('publish chatflow failed: ' + JSON.stringify(wfPub))
  })

  test.afterAll(async () => {
    // 🔴 清理必须在这里、不能在用例体末尾：用例一红，末尾那句就被跳过。
    //    挂起执行不取消 = 留下一行永远恢复不了的 INTERRUPTED（定义随后被停用）。
    try {
      for (const row of await interruptedExecutions()) {
        await api('/agent/workflow/cancel?executionId=' + row.id, 'POST').catch(() => {})
      }
      // 聊天里真发消息会建会话+消息；只删**本 seed Agent 名下**的，不碰别人的数据
      const conv = await (
        await api('/agent/assistant/conversation/page?pageNo=1&pageSize=50')
      ).json()
      for (const c of (conv?.data?.list ?? []).filter((r: any) => r.agentDefId === agentId)) {
        await api('/agent/assistant/conversation/delete?id=' + c.id, 'DELETE').catch(() => {})
      }
    } finally {
      if (wfId) await api('/agent/workflow-def/disable?id=' + wfId, 'POST').catch(() => {})
      if (agentId) await api('/agent/def/disable?id=' + agentId, 'POST').catch(() => {})
      await req?.dispose()
    }
  })

  test('点「同意并继续」时断连 → 报错文案里留着**同一个**执行编号且指向执行历史', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    await pickAgentAndSend(page, '列出数据接口')

    const card = page.getByTestId('hitl-confirm-card').first()
    await expect(card).toBeVisible({ timeout: 60000 })
    await expect(card).toContainText('待确认')
    await expect(page.getByTestId('hitl-approve')).toBeVisible()

    // 🔴 判据 1：卡片上那行**常驻**的执行编号 —— B3-8 的另一半。
    //    它不是报错时才出现的：撞了闸口之后无论连接断不断，用户都得能抄下这个编号。
    const idRow = page.getByTestId('hitl-execution-id').first()
    await expect(idRow).toBeVisible()
    const cardExecId = Number((await idRow.locator('code').first().textContent())?.trim())
    expect(
      Number.isInteger(cardExecId) && cardExecId > 0,
      `卡片上的编号不像个真编号：${cardExecId}`
    ).toBe(true)
    // 出路必须在：只给一个裸编号，用户还是不知道拿它去哪儿
    await expect(idRow).toContainText('流程编排')
    await expect(idRow).toContainText('执行历史')

    // 🔴 判据 2：卡片上那个编号 == 库里那条**真挂起**的执行。
    //    这一条把「渲染了个数字」和「渲染的是那条执行的数字」分开：
    //    取错字段（defId / messageId）或写死常量，判据 1 全绿、这里立刻红。
    let rows = await interruptedExecutions()
    for (let i = 0; i < 20 && rows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      rows = await interruptedExecutions()
    }
    expect(rows.length, '库里应恰好一条挂起执行：' + JSON.stringify(rows.map((r) => r.id))).toBe(1)
    expect(cardExecId, '卡片显示的编号必须是后端那条真执行的编号，不能是自己编的').toBe(rows[0].id)

    // 造一次真断连：只 abort 那条 POST，放行 CORS 预检 —— 与「请求发出去了、连接断了」同形
    await page.route('**/agent/assistant/resume-workflow-stream', (route) =>
      route.request().method() === 'OPTIONS' ? route.continue() : route.abort()
    )
    await page.getByTestId('hitl-approve').click()

    // 🔴 判据 3（本条的要害）：新气泡里的报错**带着同一个编号**，并指向执行历史。
    //    只断言「有个错误提示」是不够的 —— 那连改回「连接中断，请重试」也能过。
    const alert = errorAlert(page)
    await expect(alert).toBeVisible({ timeout: 30000 })
    const alertText = (await alert.textContent()) ?? ''
    const matched = alertText.match(/连接中断，请重试（本次已产生执行 #(\d+)：/)
    expect(matched, `报错文案没按预期带上编号：${alertText}`).not.toBeNull()
    expect(Number(matched![1]), '报错里的编号必须与卡片上、库里那条一致').toBe(cardExecId)
    await expect(alert).toContainText('流程编排')
    await expect(alert).toContainText('执行历史')
    // 「若仍停在等待确认可在那里恢复」这半句要在：前端无从判断后端到底收到没有，
    // 只能把人指向「去看它现在什么状态」，而不是打包票说点一下就能恢复
    await expect(alert).toContainText('等待确认')

    // 🔴 判据 4：报错之后卡片那行编号**仍在**。
    //    续跑失败会把 hitl.running 清掉、卡片转「已同意」，但编号不能跟着消失 ——
    //    恰恰是这一刻用户最需要它（他要去执行历史查那条执行现在到底怎么了）。
    await expect(page.getByTestId('hitl-execution-id').first()).toBeVisible()
    await expect(page.getByTestId('hitl-execution-id').first()).toContainText(String(cardExecId))

    // 🔴 判据 5：abort 只发生在浏览器侧 —— 库里那条执行仍是 INTERRUPTED、闸口后的节点没跑。
    //    这条既是「0 写操作」的自证，也说明判据 3 那句提示没说错：它确实还停在等待确认。
    const after = await interruptedExecutions()
    expect(after.map((r) => r.id), '断连后库里应仍是同一条挂起执行').toEqual([cardExecId])
    const trace = await traceNodeIds(cardExecId)
    expect(trace, 'abort 掉续跑后不该跑过闸口：' + JSON.stringify(trace)).not.toContain('step_tool')
  })

  test('提问阶段就断连（还没有执行编号）→ 报错里**不编造**编号', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')

    // 这条是**反向对照**：没有 WORKFLOW_CONFIRM 就没有编号，此时提示必须退回那句短话。
    // 🔴 宁可什么都不说，也不要凭空造一个编号把人支去查一条不存在的执行 —— 那比不提示更糟。
    await page.route('**/agent/assistant/send-stream', (route) =>
      route.request().method() === 'OPTIONS' ? route.continue() : route.abort()
    )
    await pickAgentAndSend(page, '列出数据接口')

    const alert = errorAlert(page)
    await expect(alert).toBeVisible({ timeout: 30000 })
    const text = ((await alert.textContent()) ?? '').trim()
    expect(text, `断连提示应仍是那句短话，不带任何编号尾巴：${text}`).toBe('连接中断，请重试')
    expect(text).not.toContain('执行编号')
    expect(text).not.toContain('执行历史')
    expect(text).not.toMatch(/#\d/)

    // 卡片与编号行都不该出现：WORKFLOW_CONFIRM 压根没回来
    await expect(page.getByTestId('hitl-confirm-card')).toHaveCount(0)
    await expect(page.getByTestId('hitl-execution-id')).toHaveCount(0)
  })
})
