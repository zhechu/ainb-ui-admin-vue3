import { test, expect } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 「机器键 → 中文名」端到端验证（重构 S1 / L1 名称目录层）
 *
 * 🔴 为什么非要走浏览器：`nodeSummary.spec.ts` 证的是「**给了** resolver 就拼得出『中文名（机器键）』」，
 *   那是纯函数两态。它证不了这条链路上真正会断的四件事：
 *     ① `/agent/workflow-def/name-catalog` 真被前端拉到了（权限、路由注册、租户头，任一错都是空目录）；
 *     ② resolver 真被塞进了**三条不同的装配路径**——只读画布走 `layoutDsl(dsl, resolver)`、
 *        设计器下拉走 `groupedToolOptions()`、聊天草稿卡走 `buildSummaryNodes(nodes, resolver)`，
 *        三处各漏一个都不会有任何报错，界面只是安静地显示 `form_list`；
 *     ③ `el-option-group` 真渲染出分组标题（模板写错成 `el-option` 平铺，DOM 照样有选项，只是没了组）；
 *     ④ `filterable` 输**英文键**真能搜到——这一条最阴：label 只显示中文的话搜索会静默失效，
 *        而运维排障时手上拿到的恰恰只有英文键。
 *   本模块的头号缺陷是「配了但不生效且无提示」，而 L1 的失败形态正是它的翻版：
 *   「翻译代码写了，但用户看到的还是机器键，且没有任何提示」。只有真实 DOM 能区分这两者。
 *
 * 🔴 0 LLM token：草稿卡那一条用 `page.route` 把 `send-stream` 换成一段**合成 SSE**。
 *   只有「模型产出草稿」这一步是假的；WORKFLOW_DRAFT 之后的 `workflow-draft` GET、DSL 解析、
 *   `buildSummaryNodes`、卡片渲染全是真的——而 L1 要验的正是这后半段。
 *   真跑 BUILD 意图要 8 分钟且烧 token（见 `agent-plan-stream.spec.ts`），换不来更多覆盖。
 *
 * 🔴 断言里**不写死中文展示名**：`form_list` 的展示名从目录接口现读。
 *   写死的话，将来有人把「查询表单列表」改成「表单字段清单」，这条用例会红——
 *   而 L1 一点没坏。要红的是「展示名等于机器键」（三级回落失效），那才是本刀要守的。
 *
 * 前置：后端 48080 + 前端 dev server 同时在跑；库里至少有一条已发布流程（sub_workflow 那一格要用）。
 * 数据自净：beforeAll 建的草稿在 afterAll 删除（DRAFT 可删）。
 */

const TS = Date.now().toString().slice(-8)
const WF_CODE = `e2e_dn_flow_${TS}`
const WF_NAME = `E2E名称中文化${TS}`
/** webhook 触发器的 path：全库唯一，撞了会触发 triggerKey 冲突 */
const WEBHOOK_PATH = `e2e_dn_${TS}`

/** 内置工具键。选它是因为它由 `AgentToolRegistry` 在代码里注册，不受租户数据增删影响 */
const TOOL_KEY = 'form_list'
/** DSL 里 tool 节点的显示名，用它定位画布上的那个节点 */
const TOOL_NODE_NAME = '查表单清单'
/** DSL 里 sub_workflow 节点的显示名 */
const SUB_NODE_NAME = '调子流程'
/**
 * 拿来验「写操作工具挂风险色点」的工具键。选 `datamodel_create` 是因为它的声明风险是 **IRREVERSIBLE**
 * ——本模块风险等级里最高的一档，也正是色点存在的全部理由（一眼看出「这一步撤销不了」）。
 * 🔴 它的 `risk` / `requireConfirm` 在 beforeAll 里**从目录现读并断言**，不写死在这儿：
 *    万一后端把它的等级调了，这里会直接说清「前置不成立」，而不是让色点断言莫名其妙地红。
 */
const RISKY_TOOL_KEY = 'datamodel_create'

let token: string
let defId: number
/** form_list 的中文展示名，从目录现读（见文件头「不写死」的理由） */
let toolLabel: string
let toolGroup: string
/** 拿库里现成的一条已发布流程当 sub_workflow 的目标，省掉「再建一条并发布」的前置与清理 */
let subCode: string
let subName: string
/** RISKY_TOOL_KEY 的展示名与风险描述（色点的 title 就是拿 riskDescription 拼的） */
let riskyLabel: string
let riskyDesc: string

/** 摘要文案的形状必须逐字对齐 `nodeSummary.ts` 的 `named()`：`前缀「中文名」（机器键）` */
const toolSummary = () => `调用工具「${toolLabel}」（${TOOL_KEY}）`
const subSummary = () => `调用另一条已发布流程「${subName}」（${subCode}）`

function buildDsl(): string {
  return JSON.stringify({
    dslVersion: '1.0',
    id: WF_CODE,
    name: WF_NAME,
    description: 'S1 e2e：一个 tool 节点 + 一个 sub_workflow 节点，验名称中文化，全链路 0 LLM token',
    // 🔴 只能用 webhook：后端 `WorkflowTriggerExtractor` 认 chat/form_event/schedule/webhook 四种，
    //    写 trigger.input 会被 create 直接拒（「不支持的触发器类型」）。本例要验 triggerLabel 的中文化，
    //    换成别的触发方式就会连带改掉期望文案，故沿用 webhook。
    // 🔴 #72 起 authType 只能是 hmac/token 且 secret 必填（落库前就拒）。这里给一个字面量 secret：
    //    它与 path 一样只是 DSL 里的一个字符串，不需要任何前置数据；本例也从不真的 POST 那个入站地址。
    //    ⚠️ 原来这里写的是 authType:'none'，注释声称「四种里唯一不需要额外造前置数据」——
    //    那句前提是假的：secret 同样是字面量，而 schedule 也只靠一个 cron 字符串。
    trigger: {
      type: 'trigger.webhook',
      config: { path: WEBHOOK_PATH, authType: 'hmac', secret: 'e2e-only-not-a-real-secret' }
    },
    variables: [
      { key: 'input', type: 'string', merge: 'replace', required: false },
      { key: 'output', type: 'object', merge: 'replace' }
    ],
    nodes: [
      {
        id: 'n_tool',
        type: 'tool',
        name: TOOL_NODE_NAME,
        config: { toolId: TOOL_KEY, args: {}, outputVar: 'output' }
      },
      {
        id: 'n_sub',
        type: 'sub_workflow',
        name: SUB_NODE_NAME,
        config: { workflowId: subCode, version: 1, outputVar: 'output' }
      }
    ],
    edges: [
      { from: 'START', to: 'n_tool' },
      { from: 'n_tool', to: 'n_sub' },
      { from: 'n_sub', to: 'END' }
    ],
    settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
  })
}

/** 合成 SSE：只发 WORKFLOW_DRAFT + DONE，不发 META（不发就不会去认一个不存在的会话 id） */
function sseBody(): string {
  const events = [
    {
      type: 'WORKFLOW_DRAFT',
      workflowDefId: defId,
      workflowCode: WF_CODE,
      workflowName: WF_NAME,
      summary: `${WF_NAME}（合成草稿）`,
      warnings: []
    },
    { type: 'DONE' }
  ]
  // fetchEventSource 按空行分帧；外层是 CommonResult 信封，`code !== 0` 会被当成整条流失败
  return events.map((data) => `data: ${JSON.stringify({ code: 0, data })}\n\n`).join('')
}

test.describe('名称目录层（L1）：画布摘要 / 工具下拉 / 聊天草稿卡三处都出中文', () => {
  test.setTimeout(180_000)

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)

    const catResp = await request.get(`${API_BASE_URL}/agent/workflow-def/name-catalog`, {
      headers: apiHeaders(token)
    })
    const cat = (await catResp.json()) as {
      code: number
      msg?: string
      data?: {
        tools: {
          name: string
          displayName: string
          groupName?: string
          risk?: string
          riskDescription?: string
          requireConfirm?: boolean
        }[]
        workflows: { code: string; name: string }[]
      }
    }
    // 🔴 这一条断言本身就是 L1 的后端半边：接口存在、权限放行、返回非空
    expect(cat.code, `名称目录接口失败：${catResp.status()} ${cat.msg ?? ''}`).toBe(0)

    const tool = cat.data?.tools?.find((t) => t.name === TOOL_KEY)
    expect(tool, `目录里没有内置工具 ${TOOL_KEY}——AgentToolRegistry 没注册，或合流逻辑把内置的漏了`).toBeTruthy()
    toolLabel = tool!.displayName
    expect(toolLabel, `${TOOL_KEY} 的展示名是空的：三级回落（自定义 displayName → 内置 displayName → 键本身）失效了`).toBeTruthy()
    // 🔴 展示名等于键 = 没有中文名。这种情况下后面三条用例全会「假通过」（拼出来还是裸键），
    //    所以必须在这里先钉死：目录得真给出一个跟键不一样的名字
    expect(toolLabel, `${TOOL_KEY} 的展示名就是它自己的键，等于没翻译`).not.toBe(TOOL_KEY)
    toolGroup = tool!.groupName || '未分组'
    // 🔴 只读是「不画色点」那一半断言的前提：它若不是只读，「没有点」就从「刻意的」变成「漏画的」，
    //    而这两种情况在 DOM 上长得一模一样——只有先钉住 risk 才能区分
    expect(tool!.risk, `${TOOL_KEY} 的声明风险不是 READ_ONLY 了，「只读工具不画点」这条用例的前提不成立`).toBe(
      'READ_ONLY'
    )

    const risky = cat.data?.tools?.find((t) => t.name === RISKY_TOOL_KEY)
    expect(risky, `目录里没有 ${RISKY_TOOL_KEY}，风险色点没法验`).toBeTruthy()
    riskyLabel = risky!.displayName
    riskyDesc = risky!.riskDescription || String(risky!.risk)
    expect(risky!.risk, `${RISKY_TOOL_KEY} 的声明风险不是 IRREVERSIBLE 了，换最高档的工具再验色点`).toBe(
      'IRREVERSIBLE'
    )
    expect(risky!.requireConfirm, `${RISKY_TOOL_KEY} 不再 requireConfirm，色点 title 的后半句前提不成立`).toBe(true)

    const wf0 = cat.data?.workflows?.[0]
    expect(wf0, '库里一条已发布流程都没有，sub_workflow 那一格没法验（先发布任意一条流程再跑）').toBeTruthy()
    subCode = wf0!.code
    subName = wf0!.name || subCode

    const created = (await (
      await request.post(`${API_BASE_URL}/agent/workflow-def/create`, {
        headers: apiHeaders(token),
        data: { code: WF_CODE, name: WF_NAME, dsl: buildDsl() }
      })
    ).json()) as { code: number; data?: number; msg?: string }
    expect(created.code, `建草稿失败：${created.msg ?? JSON.stringify(created)}`).toBe(0)
    defId = created.data!
  })

  test.afterAll(async ({ request }) => {
    // DRAFT 可删（PUBLISHED 不行）；本 spec 从不发布，所以这里一定删得掉
    if (defId) {
      await request.delete(`${API_BASE_URL}/agent/workflow-def/delete?id=${defId}`, {
        headers: apiHeaders(token)
      })
    }
  })

  test('只读画布：节点摘要出「中文名（机器键）」，工具与子流程两格都翻译到', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    const row = page.locator('.el-table__body tr').filter({ hasText: WF_CODE }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: '查看画布' }).click()

    const dialog = page.locator('.el-dialog').filter({ hasText: '流程画布（只读）' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })

    // 🔴 摘要写在 .summary-clamp 上（layout.ts 把 summary 塞进 node.data）。
    //    断言挂在「按节点显示名 filter 出的那个 vue-flow 节点」上，而不是整个弹窗 ——
    //    弹窗里还有一份 DSL 描述区，整块 contains 会让「翻译漏了一格」被另一格的文案盖过去。
    const toolNode = dialog.locator('.vue-flow__node').filter({ hasText: TOOL_NODE_NAME }).first()
    await expect(toolNode).toBeVisible({ timeout: 20000 })
    await expect(toolNode).toContainText(toolSummary())

    const subNode = dialog.locator('.vue-flow__node').filter({ hasText: SUB_NODE_NAME }).first()
    await expect(subNode).toBeVisible({ timeout: 10000 })
    await expect(subNode).toContainText(subSummary())
  })

  test('设计器：画布摘要出中文，工具下拉按 groupName 分组、label 是「中文名（机器键）」、中英文都搜得到、只有非只读工具挂风险色点', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, `/agent-workflow/editor?id=${defId}`)

    // 选中画布上的 tool 节点 → 右栏自动展开（收起态下点节点没反应会被当成「坏了」，故有这条自动展开）
    const node = page.locator('.vue-flow__node').filter({ hasText: TOOL_NODE_NAME }).first()
    await expect(node).toBeVisible({ timeout: 20000 })
    // 设计器画布上的摘要与只读画布走的是同一个 layoutDsl(dsl, resolver)，这里顺手钉一道
    await expect(node).toContainText(toolSummary())
    await node.click()

    const panel = page.locator('.wf-panel').first()
    await expect(panel).toBeVisible({ timeout: 15000 })

    // 🔴 定位靠 combobox 的**可访问名**（= 表单项 label「工具 *」），不能靠 input 的 placeholder：
    //    el-select 一旦有选中值，placeholder 就不落到 <input> 上了（它改渲染成
    //    .el-select__placeholder 里的一段文本），按 placeholder 找必然找不到——第一版就是这么红的。
    // 🔴 用 /^工具/ 锚定开头而不是 hasText '工具'：同一面板里还有「工具入参」「工具返回结果」两个字段，
    //    松匹配会撞上；agent_loop 节点的「可用只读工具」同理。
    const toolSelect = panel
      .locator('.el-select')
      .filter({ has: page.getByRole('combobox', { name: /^工具/ }) })
      .first()
    await expect(toolSelect).toBeVisible({ timeout: 10000 })
    const toolInput = toolSelect.getByRole('combobox').first()

    // ① 已选中的值就地显示中文（不只是下拉里有）——这一格才是用户 90% 时间看到的那个
    await expect(toolSelect).toContainText(`${toolLabel}（${TOOL_KEY}）`)

    // ② 展开下拉：分组标题在，且目标工具挂在「中文名（机器键）」这个 label 下
    // 🔴 点 .el-select 根而不是里面那个 combobox <input>：有选中值时 input 被
    //    .el-select__placeholder 那个 span 盖住，点 input 会被 Playwright 判成
    //    「被别的元素拦截了指针事件」而一直重试到超时。点根元素落在那个 span 上，
    //    冒泡到 wrapper 的 click 处理器照样开下拉——这也正是真人点的位置。
    await toolSelect.click()
    const dropdown = page.locator('.el-select-dropdown:visible').last()
    await expect(dropdown).toBeVisible({ timeout: 10000 })
    // 🔴 这条专治「模板把 el-option-group 写成了 el-option」：那样选项还在、DOM 里就是没有组标题
    await expect(dropdown.getByText(toolGroup, { exact: true }).first()).toBeVisible({ timeout: 10000 })
    await expect(
      dropdown.locator('.el-select-dropdown__item').filter({ hasText: `${toolLabel}（${TOOL_KEY}）` }).first()
    ).toBeVisible()

    // 🔴 ⑤⑥ 风险色点（方案 §3-L1「写操作工具在 label 后挂风险色点」）。
    //    这两条必须成对出现：只断言「不可逆的有点」证明不了什么——万一实现写成「所有工具都画点」，
    //    那条照样绿，而一排点等于没有点（30 个里 19 个是只读）。所以「只读的不画」是同一件事的另一半。
    //    色点只有 7px、靠颜色区分等级，故断言落在 title 上：颜色说不清的，title 必须说清。
    const plainOption = dropdown
      .locator('.el-select-dropdown__item')
      .filter({ hasText: `${toolLabel}（${TOOL_KEY}）` })
      .first()
    await expect(plainOption.locator('.wf-risk-dot')).toHaveCount(0)

    const riskyOption = dropdown
      .locator('.el-select-dropdown__item')
      .filter({ hasText: `${riskyLabel}（${RISKY_TOOL_KEY}）` })
      .first()
    await expect(riskyOption).toBeVisible()
    const riskDot = riskyOption.locator('.wf-risk-dot')
    await expect(riskDot).toHaveCount(1)
    await expect(riskDot).toBeVisible()
    await expect(riskDot).toHaveAttribute('title', `${riskyDesc}，运行前需人工确认`)

    // ③ filterable 按 label 过滤，所以英文键必须搜得到——运维手上只有键
    await toolInput.fill(TOOL_KEY)
    await expect(
      dropdown.locator('.el-select-dropdown__item').filter({ hasText: TOOL_KEY }).first()
    ).toBeVisible({ timeout: 10000 })
    // ④ 中文同样搜得到（业务用户只会打中文）
    await toolInput.fill(toolLabel)
    await expect(
      dropdown.locator('.el-select-dropdown__item').filter({ hasText: toolLabel }).first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('聊天草稿卡：节点预览出「中文名（机器键）」（send-stream 用合成 SSE，0 LLM token）', async ({
    page
  }) => {
    // 🔴 必须在 login/goto 之前挂：fetchEventSource 走的是 fetch，拦截晚一步请求就真发出去了
    await page.route('**/agent/assistant/send-stream', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseBody() })
    )

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')

    await page.locator('textarea[placeholder*="问点什么吧"]').first().fill('帮我建一条查表单的流程')
    await page.getByRole('button', { name: /发送/ }).first().click()

    // WORKFLOW_DRAFT 事件只带 defId，DSL 正文由 loadWorkflowDraft 另发一次 workflow-draft GET 取——
    // 那一次是打真后端的，所以「卡片上的中文」确实来自真目录，不是合成流里塞的
    const card = page.getByTestId('workflow-draft-card').first()
    await expect(card).toBeVisible({ timeout: 30000 })

    const toolRow = card.locator('[data-testid="workflow-node"]').filter({ hasText: TOOL_NODE_NAME }).first()
    await expect(toolRow).toBeVisible({ timeout: 15000 })
    await expect(toolRow).toContainText(toolSummary())

    const subRow = card.locator('[data-testid="workflow-node"]').filter({ hasText: SUB_NODE_NAME }).first()
    await expect(subRow).toBeVisible({ timeout: 10000 })
    await expect(subRow).toContainText(subSummary())
  })

  test('G7：目录拉不到时失败要可见——顶栏告警 + 空下拉给出手打工具键的出路 + 摘要回落机器键', async ({
    page
  }) => {
    // 🔴 用「HTTP 200 + 业务码 403」而不是 route.abort()：这才是 G7 的真实形态——
    //    用户有编排权、但没有目录那个接口的权限，后端回 code!=0，而修复前 loadCatalogs 里的
    //    .catch(() => []) 把它吞成一个「空的且零提示」的下拉。abort() 只覆盖网络异常，证不了这一条。
    // 🔴 别用 401：service.ts:152 对 401 会走刷新令牌/登出，页面会被踢回登录页，测的就不是 G7 了。
    await page.route('**/agent/workflow-def/name-catalog', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 403, msg: '没有该操作权限', data: null })
      })
    )

    await login(page)
    await gotoWithAuth(page, `/agent-workflow/editor?id=${defId}`)

    // ① 顶栏告警：说清坏了什么、影响面（只是显示，流程本身没事），并给一个重试入口
    const alert = page.getByTestId('catalog-error-alert')
    await expect(alert).toBeVisible({ timeout: 25000 })
    await expect(alert).toContainText('重试')

    // ② 摘要回落成机器键，而不是空白、也不是抛错整个画布白屏。
    //    「显示 form_list 至少能让人去搜、去问；显示空白等于把信息删了」——这条回落是 L1 的底线。
    const node = page.locator('.vue-flow__node').filter({ hasText: TOOL_NODE_NAME }).first()
    await expect(node).toBeVisible({ timeout: 20000 })
    await expect(node).toContainText(`调用工具「${TOOL_KEY}」`)

    // ③ 空下拉必须交代「为什么空」和「空了还能怎么办」，而不是留一个空列表让人以为没有工具
    await node.click()
    const panel = page.locator('.wf-panel').first()
    await expect(panel).toBeVisible({ timeout: 15000 })
    const toolSelect = panel
      .locator('.el-select')
      .filter({ has: page.getByRole('combobox', { name: /^工具/ }) })
      .first()
    await toolSelect.click()
    const hint = page.getByTestId('catalog-empty-hint')
    await expect(hint).toBeVisible({ timeout: 10000 })
    await expect(hint).toContainText('可直接输入工具键后回车')
  })
})
