import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, apiHeaders, apiLogin, gotoWithAuth, login } from './helpers/auth'

/**
 * S4b 发布闸门的**前端预检**端到端验证
 *
 * <h3>🔴 后端已经有闸门了，为什么还要在浏览器里再验一遍</h3>
 * 因为后端闸门拒回来的那段文字**到不了用户眼前**：axios 拦截器把业务错误 reject 成字面量
 * {@code 'error'}（台账 #91），调用方拿不到 msg，只能弹一条「发布失败：未知错误」。
 * 所以前端在发布前自己打一次 {@code /get?id} → {@code /validate}，把逐条修正清单放进一个
 * **不会自动消失的对话框**里。这条链路上任何一环断了，症状都是「点了发布、什么都没发生」——
 * 正是这个模块最常见的缺陷形态，而它接口全通、单测全绿。
 *
 * <h3>🔴 三个断言各自防的是哪一种「静默失效」</h3>
 * <ol>
 *   <li>{@code publishCalls.length === 0}：防「对话框弹了但请求也照发」。
 *       那样界面上看着像拦住了，后端其实已经翻了状态（预检与闸门判据一旦分岔就会出现）。</li>
 *   <li>错误项**逐条**渲染、且带着出问题的那个工具编码：防「折叠成条数」。
 *       后端特意用「；」把每条拼进 msg，前端再拆开列，任一处改成 {@code errors.length} 就等于没说。</li>
 *   <li>对话框里**没有**任何「仍然发布 / 强制 / 跳过」按钮：防闸门被降格成建议
 *       （S4b 用户决定 1：error 一律拒，不给二次确认强推的口子）。</li>
 * </ol>
 *
 * <h3>数据自净</h3>
 * 全程只碰自己造的那一行 DRAFT 与自己建的那一个会话。code / 标题在 beforeAll **之前**就定好，
 * afterAll 按 code 反查再删 —— 不认「创建成功后才知道的 id」。
 * 🔴 「正对照」那一步的 publish 请求被 {@code page.route} 拦下并**假应答**，
 *    所以那一行自始至终是 DRAFT；afterAll 里还专门断言了一次 status，
 *    真被发布过就会红着报出来，而不是悄悄往存量里留一行删不掉的 PUBLISHED（台账 #87）。
 * 🔴 清理写在 afterAll 而不是用例体末尾：用例断言失败时体末尾的代码根本不执行（#87 的教训）。
 *
 * 前置：后端 48080 + 前端 dev server 同时在跑；0 LLM token。
 */

const BAD_TOOL = 'form_list_S4B_NOT_EXIST'
const GOOD_TOOL = 'form_list'

/**
 * 抄 id=90（test_case_a，实测 passed=true / 0 warning）的结构，只改 code 与 tool 节点的 toolId。
 *
 * 🔴 刻意让「不通过」的原因只有 V1（工具不存在）一条：混进别的问题（模型不存在、节点不可达）
 *    会让「错误项恰好 1 条」这个断言变成对一堆无关规则的隐式依赖，改一处规则就得改这条用例。
 */
const dslOf = (code: string, toolId: string) =>
  JSON.stringify(
    {
      dslVersion: '1.0',
      id: code,
      name: 'S4b 发布闸门 e2e 夹具',
      description: 'S4b e2e 临时夹具，跑完即删；勿执行',
      variables: [
        { key: 'input', type: 'string', merge: 'replace', required: false },
        { key: 'forms', type: 'object', merge: 'replace' },
        { key: 'output', type: 'string', merge: 'replace' }
      ],
      nodes: [
        {
          id: 'lookup_forms',
          type: 'tool',
          name: '按问题查表单',
          config: { toolId, args: { keyword: '{{$.input}}' }, outputVar: 'forms' }
        },
        {
          id: 'answer',
          type: 'llm',
          name: '组织中文回答',
          config: {
            prompt: '问题：{{$.input}}\n表单：{{$.forms}}\n请用中文回答。',
            outputVar: 'output'
          },
          position: { x: 448, y: -52 }
        }
      ],
      edges: [
        { from: 'START', to: 'lookup_forms' },
        { from: 'lookup_forms', to: 'answer' },
        { from: 'answer', to: 'END' }
      ],
      settings: { recovery: 'forward', executionTimeoutSeconds: 120 },
      trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: 'smart_service' } }
    },
    null,
    2
  )

/** code / 会话标题在创建之前就定好：afterAll 只认它们，不认「创建成功后才知道的 id」 */
const CODE = `wf_s4b_e2e_${Date.now()}`
const CONV_TITLE = `S4b闸门e2e_${Date.now()}`

test.describe.serial('S4b 发布闸门（前端预检）', () => {
  // /validate 含最多 15 秒的 infra/bpm 只读干跑，加上每条用例一次登录跳转，默认 90 秒不够
  test.setTimeout(180_000)

  let api: APIRequestContext
  let token: string
  let defId = 0
  let conversationId = 0

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext()
    token = await apiLogin(api)
    const created = await api.post(`${API_BASE_URL}/agent/workflow-def/create`, {
      headers: apiHeaders(token),
      data: {
        code: CODE,
        name: 'S4b 发布闸门 e2e 夹具',
        dsl: dslOf(CODE, BAD_TOOL),
        description: 'e2e 夹具'
      }
    })
    const body = await created.json()
    expect(body.code, `建夹具失败：${JSON.stringify(body)}`).toBe(0)
    defId = body.data
    // 建完先自己体一遍：后面几条用例都断言「错误项恰好 1 条」，前提是这个前提成立
    const v = await api.post(`${API_BASE_URL}/agent/workflow-def/validate`, {
      headers: apiHeaders(token),
      data: { dsl: dslOf(CODE, BAD_TOOL) }
    })
    const vb = await v.json()
    expect(vb.data.passed, '夹具本该体检不通过').toBe(false)
    expect(
      vb.data.errors,
      `夹具本该只有 1 条 error，实际：${(vb.data.errors ?? []).join(' | ')}`
    ).toHaveLength(1)
    expect(vb.data.errors[0]).toContain(BAD_TOOL)
  })

  test.afterAll(async () => {
    if (!api) return
    try {
      // 🔴 按 code 反查而不是用记住的 defId：万一 beforeAll 建了行却在赋值前挂掉，
      //    defId 还是 0，按 id 删就删不掉，行会留在存量里（#87 那三行就是这么漏出来的）。
      const page = await api.get(
        `${API_BASE_URL}/agent/workflow-def/page?pageNo=1&pageSize=10&code=${CODE}`,
        { headers: apiHeaders(token) }
      )
      const rows = ((await page.json()).data?.list ?? []) as { id: number; status: string }[]
      for (const row of rows) {
        expect(
          row.status,
          `夹具 ${CODE} 竟然是 ${row.status} —— 说明某一步真的把它发布了，publish 拦截失效`
        ).toBe('DRAFT')
        await api.delete(`${API_BASE_URL}/agent/workflow-def/delete?id=${row.id}`, {
          headers: apiHeaders(token)
        })
      }
      if (conversationId) {
        await api.delete(`${API_BASE_URL}/agent/assistant/conversation/delete?id=${conversationId}`, {
          headers: apiHeaders(token)
        })
      }
    } finally {
      await api.dispose()
    }
  })

  /**
   * 把 publish 请求拦下来记账 + 假应答
   *
   * 🔴 拦而不是放行：这几条用例要证的是「有没有发请求」，不是「后端会不会拒」。
   *    放行会真的翻状态，夹具就删不掉了；而「后端会拒」由
   *    AgentWorkflowDefServicePublishGateTest（9 条）+ 3 处变异探针覆盖，不必在这里再证一次。
   * 🔴 假应答而不是 abort：abort 会让前端走进 catch 弹一条错误通知，
   *    正对照那一步就断不出「发布成功」这条 toast 了。
   */
  const spyPublish = async (page: Page, urlPart: string) => {
    const calls: string[] = []
    await page.route(`**${urlPart}**`, async (route) => {
      calls.push(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: defId, msg: '' })
      })
    })
    return calls
  }

  /** 在列表页按 code 搜出夹具那一行 */
  const findRow = async (page: Page) => {
    await gotoWithAuth(page, '/ai/agent/workflow')
    await page.locator('input[placeholder="请输入流程编码"]').fill(CODE)
    await page.getByRole('button', { name: /搜\s*索/ }).click()
    const row = page.locator('.el-table__body tr').filter({ hasText: CODE }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    return row
  }

  const gateDialog = (page: Page) => page.locator('[data-testid="publish-gate-dialog"]')

  test('列表页：体检不通过的草稿点「发布」→ 逐条列出错误、一个 publish 请求都不发', async ({
    page
  }) => {
    const publishCalls = await spyPublish(page, '/agent/workflow-def/publish')
    await login(page)
    const row = await findRow(page)

    await row.getByRole('button', { name: /发\s*布/ }).click()
    // 先过二次确认（ElMessageBox）。预检刻意排在确认之后：干跑最多 15 秒，
    // 不该让点了取消的人也白等一趟
    await page.locator('.el-message-box').getByRole('button', { name: /确\s*定/ }).click()

    const dialog = gateDialog(page)
    await expect(dialog).toBeVisible({ timeout: 60_000 })
    const errors = dialog.locator('[data-testid="publish-gate-error"]')
    // 🔴 逐条而不是条数：这条与下面那条 toContainText 一起，防的就是「折叠成 1 处错误」
    await expect(errors).toHaveCount(1)
    await expect(errors.first()).toContainText(BAD_TOOL)
    // 文案必须带「去哪儿改」，只说「不合法」等于让人自己猜
    await expect(errors.first()).toContainText('工具管理')

    // 🔴 核心判据①：请求一个都没发。对话框弹了但请求照发 = 界面骗人
    expect(publishCalls, `预检拦下了却仍发出 publish 请求：${publishCalls.join(' , ')}`).toHaveLength(0)

    // 🔴 核心判据③：没有任何绕过口子
    await expect(dialog.getByRole('button', { name: /仍然发布|强制发布|跳过|忽略/ })).toHaveCount(0)
    // 「为什么没有强推按钮」要写在界面上，否则用户会当成 bug
    await expect(dialog.locator('.pgd__why')).toContainText('这是有意的')

    // 「去设计器修改」跳到整页设计器（带 id）—— 列完清单必须给下一步的出口
    await dialog.locator('[data-testid="publish-gate-go-design"]').click()
    await page.waitForURL(/\/agent-workflow\/editor/, { timeout: 20_000 })
    expect(page.url()).toContain(`id=${defId}`)
  })

  /**
   * 聊天里的「确认并运行」被同一个闸门拦下
   *
   * 🔴 为什么非走浏览器不可：这一路的失败是**静默**的。{@code gateRef.value?.open(...)} 带可选链，
   *   模板上 ref 名字写错、或组件没挂上，都不会报错 —— 用户点一下，界面上什么都不发生。
   *   而这恰恰是这条路径原本就有的毛病（原来那句 catch 恒等于「发布失败：未知错误」，#91）。
   * 🔴 不造聊天历史：草稿卡是 {@code GET /message/list} 的响应里带 workflowDefId 才渲染的，
   *   这里用 page.route 注入一条合成消息，其余（取草稿 DSL、体检、弹窗）全是真接口真组件。
   *   往 agent_message 里插真行会污染别人的会话，而清不掉的聊天记录比清不掉的草稿更麻烦。
   */
  test('助手聊天：草稿卡「确认并运行」→ 同一个闸门对话框，且不发 publish-workflow', async ({
    page
  }) => {
    const publishCalls = await spyPublish(page, '/agent/planner/publish-workflow')
    const conv = await api.post(
      `${API_BASE_URL}/agent/assistant/conversation/create?title=${encodeURIComponent(CONV_TITLE)}`,
      { headers: apiHeaders(token) }
    )
    conversationId = (await conv.json()).data
    expect(conversationId, '建会话失败').toBeTruthy()

    // 注入一条「助手消息 + workflowDefId」，让刷新重建路径把草稿卡找回来
    await page.route('**/agent/assistant/message/list**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '',
          data: [
            {
              id: 999001,
              conversationId,
              role: 'assistant',
              content: '',
              status: 'SUCCESS',
              workflowDefId: defId,
              createTime: new Date().toISOString()
            }
          ]
        })
      })
    })

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    await page.locator(`[data-conversation-id="${conversationId}"]`).first().click()

    const card = page.locator('[data-testid="workflow-draft-card"]')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.getByRole('button', { name: /确认并运行/ }).click()

    const dialog = gateDialog(page)
    await expect(dialog).toBeVisible({ timeout: 60_000 })
    const errors = dialog.locator('[data-testid="publish-gate-error"]')
    await expect(errors).toHaveCount(1)
    await expect(errors.first()).toContainText(BAD_TOOL)
    expect(publishCalls, '聊天路径拦下了却仍发出 publish-workflow').toHaveLength(0)
  })

  /**
   * 正对照：体检**通过**的草稿，预检必须放行
   *
   * 🔴 没有这一条，上面两条全绿也可能只是「预检把一切都拦了」—— 那比没有闸门更坏，
   *   因为它会连合法的发布一起堵死，而且堵得很有道理（界面上列着错误清单）。
   * 🔴 顺序敏感：本用例会把夹具的 DSL 改成能过的那份，故必须排在两条「拦下」用例之后
   *   （describe.serial + workers:1 保证文件内顺序）。
   */
  test('正对照：体检通过的草稿点「发布」→ 不弹闸门、publish 请求照发', async ({ page }) => {
    const good = dslOf(CODE, GOOD_TOOL)
    const v = await api.post(`${API_BASE_URL}/agent/workflow-def/validate`, {
      headers: apiHeaders(token),
      data: { dsl: good }
    })
    const vb = await v.json()
    expect(
      vb.data.passed,
      `换成 ${GOOD_TOOL} 后本该体检通过，实际：${(vb.data.errors ?? []).join(' | ')}`
    ).toBe(true)
    const upd = await api.put(`${API_BASE_URL}/agent/workflow-def/update`, {
      headers: apiHeaders(token),
      data: {
        id: defId,
        code: CODE,
        name: 'S4b 发布闸门 e2e 夹具',
        dsl: good,
        description: 'e2e 夹具'
      }
    })
    expect((await upd.json()).code).toBe(0)

    const publishCalls = await spyPublish(page, '/agent/workflow-def/publish')
    await login(page)
    const row = await findRow(page)
    await row.getByRole('button', { name: /发\s*布/ }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确\s*定/ }).click()

    // 放行：publish 请求发出、闸门对话框不出现、成功 toast 照常
    await expect
      .poll(() => publishCalls.length, {
        timeout: 60_000,
        message: '体检通过却没有发出 publish 请求 —— 预检产生了假阴性拦截'
      })
      .toBe(1)
    expect(publishCalls[0]).toContain(`id=${defId}`)
    await expect(gateDialog(page)).toHaveCount(0)
    await expect(page.locator('.el-message').filter({ hasText: '发布成功' }).first()).toBeVisible({
      timeout: 15_000
    })
  })

  /**
   * 助手页整页渲染
   *
   * 🔴 这条看着像凑数，其实防的是 S4b 最容易犯的一个错：AssistantChat.vue 里原本**没有** router，
   *   为了「去设计器修改」新加了 {@code const { push } = useRouter()}。这个项目的 useRouter 靠
   *   auto-import，一旦没被自动导入，整个组件在 setup 阶段就抛错 —— 表现为助手页一片空白，
   *   而发布闸门那几条用例都在别的页面上，一条都不会红。
   * 🔴 排在最后：前面那条聊天用例给 message/list 挂了路由拦截，同一 worker 内互不影响，
   *   但把「页面能不能打开」这条最基础的断言放最后，前面任何一步炸了都还有它兜底说明范围。
   */
  test('助手页仍能渲染（防 useRouter 未被 auto-import 把整个组件打挂）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    await expect(page.locator('[data-testid="assistant-scroll"]').first()).toBeVisible({
      timeout: 30_000
    })
    expect(page.url()).not.toContain('/login')
  })
})
