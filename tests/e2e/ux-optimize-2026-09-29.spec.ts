import { expect, test, type Page } from '@playwright/test'
import { gotoWithAuth, login, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'
import { createWorkflowDraft } from './helpers/workflow'

/**
 * 2026-09-29 十项体验优化的真实页面走查
 *
 * <h3>🔴 为什么非要走浏览器</h3>
 * 这批改动大半是「排版 / 默认态」类的：表单居中、提示语挪位、侧栏默认收起、按钮改名。
 * 它们的失败方式不是抛异常而是<b>看起来不对</b>——单测、类型检查、eslint 会一律全绿，
 * 只有渲染出来的 DOM 能证明「提示语真的不在列表上方了」「右栏真的默认收起了」。
 * 尤其「居中」这类：写了 {@code mx-auto} 不等于居中（父容器若是 inline-block/flex 就不生效），
 * 所以断言量的是<b>左右留白相等</b>，不是 class 里有没有那个工具类。
 *
 * <p>另两项是真功能（菜单批量删除、智能体重新发布 + 批量删除）。判据放在服务层的后端单测里已经钉死
 * （{@code MenuServiceImplTest} / {@code AgentDefServiceTest}），这里验的是另一半：
 * 按钮在不在、不该勾的行勾不勾得上、点下去列表真的少了几行。
 *
 * <p>造数据一律走接口（{@code apiLogin}），点界面只用来验界面。数据自净：afterAll 兜底清理。
 *
 * 前置：后端 48080 + 前端 dev server 同时在跑。
 */

const SHOTS = 'test-results/ux-2026-09-29'
const TS = Date.now().toString().slice(-8)

/** 菜单子树：目录 → 菜单 → 按钮。三层是为了顺带验「展开/折叠」把孙子层也展开了 */
const MENU_ROOT = `E2E批删根${TS}`
const MENU_CHILD = `${MENU_ROOT}子`
const MENU_LEAF = `${MENU_ROOT}孙`

const AGENT_CODE = `ux_e2e_${TS}`
const AGENT_NAME = `UX走查智能体${TS}`

test.describe('2026-09-29 十项体验优化走查', () => {
  test.setTimeout(240_000)

  let token: string
  let menuIds: number[] = []
  let agentId = 0

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)
    const headers = apiHeaders(token)

    // 菜单子树。🔴 必须三层且父子一起删：旧实现逐个 id 查「有没有子菜单」，
    //    父菜单永远因为「有子菜单」被拒——而「框选一整棵子树」恰恰是批量删除最常见的用法。
    menuIds = []
    const createMenu = async (body: Record<string, unknown>) => {
      const resp = await request.post(`${API_BASE_URL}/system/menu/create`, { headers, data: body })
      const json = (await resp.json()) as { code: number; data?: number; msg?: string }
      expect(json.code, `建菜单失败：${JSON.stringify(json)}`).toBe(0)
      menuIds.push(json.data!)
      return json.data!
    }
    const rootId = await createMenu({
      name: MENU_ROOT,
      type: 1,
      sort: 9999,
      parentId: 0,
      status: 0,
      path: `/ux_root_${TS}`,
      icon: 'ep:menu'
    })
    const childId = await createMenu({
      name: MENU_CHILD,
      type: 2,
      sort: 9999,
      parentId: rootId,
      status: 0,
      path: `ux_child_${TS}`,
      component: 'system/menu/index',
      componentName: `UxE2e${TS}`
    })
    await createMenu({
      name: MENU_LEAF,
      type: 3,
      sort: 9999,
      parentId: childId,
      status: 0,
      permission: `ux:e2e:${TS}`
    })

    // 智能体：落一个草稿，剩下的状态翻转全在 UI 上点（那正是 Req8/Req9 要验的东西）
    const createResp = await request.post(`${API_BASE_URL}/agent/def/create`, {
      headers,
      data: { code: AGENT_CODE, name: AGENT_NAME, persona: `你是${AGENT_NAME}，用于端到端走查。` }
    })
    const created = (await createResp.json()) as { code: number; data?: number; msg?: string }
    expect(created.code, `建 Agent 失败：${JSON.stringify(created)}`).toBe(0)
    agentId = created.data!
  })

  test.afterAll(async ({ request }) => {
    // 走查中途失败时兜底清理，别把垃圾数据留在库里
    const headers = apiHeaders(token)
    if (menuIds.length) {
      await request.delete(`${API_BASE_URL}/system/menu/delete-list`, {
        headers,
        params: { ids: [...menuIds].reverse().join(',') }
      })
    }
    if (agentId) {
      await request.post(`${API_BASE_URL}/agent/def/disable?id=${agentId}`, { headers })
      await request.delete(`${API_BASE_URL}/agent/def/delete`, { headers, params: { id: agentId } })
    }
  })

  test('菜单管理：勾选整棵子树 → 一次批量删除（Req1）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/system/menu')

    const batchBtn = page.getByRole('button', { name: /批量删除/ })
    await expect(batchBtn).toBeVisible({ timeout: 20000 })
    // 没勾任何东西时必须禁用：一个随时可点的「批量删除」等于把误触即删变成常态
    await expect(batchBtn).toBeDisabled()

    // 按名字过滤出这棵子树（LIKE 命中三层），省掉在两百行虚拟列表里翻找
    await page.locator('input[placeholder="请输入菜单名称"]').fill(MENU_ROOT)
    await page.getByRole('button', { name: '搜索' }).click()
    await page.waitForLoadState('networkidle')

    // 只有根在 DOM 里（子/孙折叠着），必须先展开——顺带验「展开/折叠」真的把孙子层也展开了
    await expect(menuRow(page, MENU_CHILD)).toHaveCount(0)
    await page.getByRole('button', { name: '展开/折叠' }).click()
    await expect(menuRow(page, MENU_CHILD)).toBeVisible({ timeout: 10000 })
    await expect(menuRow(page, MENU_LEAF)).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: `${SHOTS}/menu-01-tree.png` })

    // 三层全勾上
    await menuRow(page, MENU_ROOT).locator('.el-checkbox').click()
    await menuRow(page, MENU_CHILD).locator('.el-checkbox').click()
    await menuRow(page, MENU_LEAF).locator('.el-checkbox').click()
    await expect(batchBtn).toBeEnabled()
    await expect(batchBtn).toContainText('（3）')
    await page.screenshot({ path: `${SHOTS}/menu-02-checked.png` })

    await batchBtn.click()
    const box = page.locator('.el-message-box').filter({ hasText: '确定删除选中的 3 个菜单吗' })
    await expect(box).toBeVisible({ timeout: 10000 })
    await box.getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message--success').first()).toBeVisible({ timeout: 15000 })

    // 三行都真的没了（不能只信那句「删除成功」）
    await expect(menuRow(page, MENU_ROOT)).toHaveCount(0, { timeout: 15000 })
    await page.screenshot({ path: `${SHOTS}/menu-03-deleted.png` })
    menuIds = [] // UI 已经删干净，afterAll 不必再动
  })

  test('智能体：已停用可重新发布 + 草稿/已停用可勾选批量删除（Req8/Req9/二轮Req2）', async ({
    page
  }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/def')
    await expect(page.getByRole('columnheader', { name: '状态' }).first()).toBeVisible({
      timeout: 20000
    })

    await page.locator('input[placeholder="请输入编码"]').fill(AGENT_CODE)
    await page.getByRole('button', { name: '搜索' }).click()
    await page.waitForLoadState('networkidle')

    const row = page.locator('.el-table__row').filter({ hasText: AGENT_CODE }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    const batchBtn = page.getByRole('button', { name: /批量删除/ })
    await expect(batchBtn).toBeDisabled()

    // 二轮 Req2：草稿行勾得上（上一轮只有已停用勾得上）；已发布的灰掉在下面断言
    const rowCheckbox = row.locator('.el-checkbox').first()
    await expect(rowCheckbox.locator('input')).toBeEnabled()

    // Req8：草稿 → 发布 → 停用 → 「重新发布」按钮必须出现（改之前这一行只有 编辑/复制/删除）
    await row.getByRole('button', { name: '发布', exact: true }).click()
    await confirmBox(page, /确认发布/)
    await expect(row.locator('.el-tag').filter({ hasText: '已发布' })).toBeVisible({ timeout: 15000 })
    // 已发布行勾不上：后端 validateDeletable 只认草稿/已停用，勾上了只会整批被拒
    await expect(rowCheckbox.locator('input')).toBeDisabled()

    await row.getByRole('button', { name: '停用', exact: true }).click()
    await confirmBox(page, /确认停用/)
    await expect(row.locator('.el-tag').filter({ hasText: '已停用' })).toBeVisible({ timeout: 15000 })

    const republish = row.getByRole('button', { name: '重新发布' })
    await expect(republish).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/agent-01-disabled.png` })

    // Req9：已停用行勾得上，按钮计数跟上
    await expect(rowCheckbox.locator('input')).toBeEnabled()
    await rowCheckbox.click()
    await expect(batchBtn).toBeEnabled()
    await expect(batchBtn).toContainText('（1）')
    await page.screenshot({ path: `${SHOTS}/agent-02-checked.png` })
    await rowCheckbox.click() // 取消勾选，免得下一步的确认框被批量删除的计数干扰

    // Req8：重新发布真的把它放回线上（不必先派生一个内容完全相同的新版本）
    await republish.click()
    await confirmBox(page, /确认重新发布/)
    await expect(row.locator('.el-tag').filter({ hasText: '已发布' })).toBeVisible({ timeout: 15000 })
    await expect(row.getByRole('button', { name: '重新发布' })).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/agent-03-republished.png` })

    // 收尾：停用 → 勾选 → 批量删除。既把 Req9 的删除链路走通，也顺手清掉测试数据
    await row.getByRole('button', { name: '停用', exact: true }).click()
    await confirmBox(page, /确认停用/)
    await expect(row.locator('.el-tag').filter({ hasText: '已停用' })).toBeVisible({ timeout: 15000 })
    await rowCheckbox.click()
    await batchBtn.click()
    const box = page.locator('.el-message-box').filter({ hasText: '确认删除选中的 Agent' })
    await expect(box).toBeVisible({ timeout: 10000 })
    // 确认框里点名了要删谁（只有个数量不足以让人发现「勾错了」）
    await expect(box).toContainText(AGENT_NAME)
    await box.getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-message--success').first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.el-table__row').filter({ hasText: AGENT_CODE })).toHaveCount(0, {
      timeout: 15000
    })
    await page.screenshot({ path: `${SHOTS}/agent-04-batch-deleted.png` })
    agentId = 0
  })

  test('排版：表单居中 / 提示语位置 / 按钮改名（Req2/3/4/6/7）', async ({ page }) => {
    await login(page)

    // Req4：数据接口列表——按钮叫「新增」（不再是「新建接口」），列表上方的黄色警告已删除
    await gotoWithAuth(page, '/infra/data-manage/data-interface')
    await expect(page.getByRole('button', { name: '新增', exact: true })).toBeVisible({
      timeout: 20000
    })
    await expect(page.getByRole('button', { name: /新建接口/ })).toHaveCount(0)
    await expect(page.locator('.el-alert--warning')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/data-interface-01-list.png` })

    // Req4：调用日志面板上方的提示语也删掉了
    await page.getByRole('button', { name: '调用日志' }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: '调用日志' })).toHaveCount(0, { timeout: 15000 })
    await expect(page.locator('.el-alert--info')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/data-interface-02-log.png` })

    // Req6：提示词模板列表上方无提示语
    await gotoWithAuth(page, '/ai/agent/prompt-template')
    await expect(page.getByRole('button', { name: '新增', exact: true })).toBeVisible({
      timeout: 20000
    })
    await expect(page.locator('.el-alert')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/prompt-01-list.png` })

    // Req7：新增面板的提示语挪到了最下面——判据是「它后面再没有表单项」
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const hint = page.locator('.el-alert').filter({ hasText: '提问起手式' })
    await expect(hint).toBeVisible({ timeout: 15000 })
    await expect(hint).toContainText('占位符')
    const afterHint = await hint.evaluate((el) => {
      let n = el.nextElementSibling
      while (n) {
        if (n.querySelector('.el-form-item')) return true
        n = n.nextElementSibling
      }
      // 也看父级后面的兄弟：提示语可能不是最后一个直接子元素
      let p = el.parentElement
      while (p) {
        let sib = p.nextElementSibling
        while (sib) {
          if (sib.querySelector('.el-form-item')) return true
          sib = sib.nextElementSibling
        }
        p = p.parentElement
      }
      return false
    })
    expect(afterHint, '提示语后面还有表单项，说明它没被挪到最下面').toBe(false)
    // 表单项确实存在（否则上面那个断言会因为「压根没有表单」而假通过）
    await expect(page.locator('.el-form-item').first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/prompt-02-form.png`, fullPage: true })

    // Req2：流程编排「新增」的表单内容居中
    await gotoWithAuth(page, '/ai/agent/workflow')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    await expect(page.getByText('新增流程').first()).toBeVisible({ timeout: 15000 })
    await expectCenteredForm(page)
    await page.screenshot({ path: `${SHOTS}/workflow-01-form-centered.png` })

    // Req3：工具管理「新增」的表单内容居中（顶部那条说明也跟着居中，否则比表单还宽）
    // 🔴 「新增」只在「自定义工具」页签里：默认页签是只读的内置工具注册表，没有新增按钮
    await gotoWithAuth(page, '/ai/agent/tooldef')
    await page.getByRole('tab', { name: '自定义工具' }).click()
    await page.getByRole('button', { name: '新增', exact: true }).click()
    await expect(page.locator('.el-form').first()).toBeVisible({ timeout: 15000 })
    await expectCenteredForm(page)
    await page.screenshot({ path: `${SHOTS}/tooldef-01-form-centered.png` })
  })

  test('流程设计器：侧栏默认收缩、点竖条展开、选中节点自动展开右栏（Req5）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    const code = `wf_ux_${TS}`
    await createWorkflowDraft(page, { code, name: `UX走查流程${TS}` })
    await page.waitForURL(/\/agent-workflow\/editor/, { timeout: 20000 })
    await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20000 })

    // 默认态：两条竖杆在，左右两栏都不在 —— 画布吃满宽度
    const railLeft = page.locator('[data-testid="rail-left"]')
    const railRight = page.locator('[data-testid="rail-right"]')
    await expect(railLeft).toBeVisible()
    await expect(railRight).toBeVisible()
    await expect(page.locator('.wf-palette')).toHaveCount(0)
    await expect(page.locator('.wf-panel')).toHaveCount(0)
    const collapsedWidth = (await page.locator('.vue-flow').first().boundingBox())?.width ?? 0
    await page.screenshot({ path: `${SHOTS}/designer-01-collapsed.png` })

    // 点左杆展开节点目录，画布相应变窄（证明省出来的宽度真的给了画布，而不是凭空多了一块空白）
    await railLeft.click()
    await expect(page.locator('.wf-palette__item').first()).toBeVisible({ timeout: 10000 })
    const expandedWidth = (await page.locator('.vue-flow').first().boundingBox())?.width ?? 0
    expect(expandedWidth).toBeLessThan(collapsedWidth - 100)
    await page.screenshot({ path: `${SHOTS}/designer-02-left-expanded.png` })

    // 🔴 选中节点 → 右栏自动展开。这是「默认收起」能成立的前提：属性面板是配置节点的唯一入口，
    //    收起着点节点却什么都没弹出来，用户的合理结论是「设计器坏了」。
    // 🔴 选中真实 DSL 节点，而不是 DOM 里排在前面的合成端点（__start__/__end__ 的 dslId 为 null，
    //    点它们按设计就不该弹属性面板）。用模板里工具节点的标签定位，语义稳定。
    await page.locator('.vue-flow__node').filter({ hasText: '按问题查表单' }).first().click()
    await expect(page.locator('.wf-panel')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('节点配置').first()).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: `${SHOTS}/designer-03-node-selected.png` })

    // 手动收起右栏之后，点画布空白处（取消选中）不该替用户把它再弹出来：只自动展开、绝不自动收起
    await railRight.click()
    await expect(page.locator('.wf-panel')).toHaveCount(0)
    await page.locator('.vue-flow__pane').first().click({ position: { x: 8, y: 8 } })
    await page.waitForTimeout(500)
    await expect(page.locator('.wf-panel')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/designer-04-right-collapsed.png` })

    // 收尾：回列表删掉这条草稿
    await gotoWithAuth(page, '/ai/agent/workflow')
    await page.locator('input[placeholder="请输入流程编码"]').fill(code)
    await page.getByRole('button', { name: '搜索' }).click()
    await page.waitForLoadState('networkidle')
    const row = page.locator('.el-table__row').filter({ hasText: code }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.getByRole('button', { name: '删除' }).click()
    const box = page.locator('.el-message-box').filter({ hasText: '删除' }).first()
    await box.getByRole('button', { name: '确定' }).click()
    await expect(page.locator('.el-table__row').filter({ hasText: code })).toHaveCount(0, {
      timeout: 15000
    })
  })
})

// ==================== 本文件内的小工具 ====================

/**
 * 断言「表单内容居中」：量左右留白，不读 class。
 *
 * 🔴 读 class 里有没有 {@code mx-auto} 只能证明「我写了这个类」，证明不了「它真的居中了」——
 *    父容器若是 flex/inline-block，mx-auto 根本不生效，而这正是这类改动最容易翻车的地方。
 */
async function expectCenteredForm(page: Page) {
  const form = page.locator('.el-form').first()
  await expect(form).toBeVisible({ timeout: 15000 })
  const box = await form.boundingBox()
  const parentBox = await form.evaluateHandle((el) => el.parentElement!).then((h) =>
    h.asElement()!.boundingBox()
  )
  expect(box, '表单没有盒子，量不出居中').toBeTruthy()
  expect(parentBox, '表单父容器没有盒子').toBeTruthy()
  const leftGap = box!.x - parentBox!.x
  const rightGap = parentBox!.x + parentBox!.width - (box!.x + box!.width)
  // 表单必须明显比容器窄，否则「居中」无从谈起；两侧留白相差在 4px 内即视为居中
  expect(box!.width, '表单没有比容器窄，看不出居中效果').toBeLessThan(parentBox!.width - 20)
  expect(Math.abs(leftGap - rightGap), `左留白 ${leftGap} vs 右留白 ${rightGap}`).toBeLessThanOrEqual(4)
}

async function confirmBox(page: Page, titleRe: RegExp) {
  const box = page.locator('.el-message-box').filter({ hasText: titleRe }).first()
  await expect(box).toBeVisible({ timeout: 10000 })
  await box.getByRole('button', { name: '确定' }).click()
  await expect(page.locator('.el-message--success').first()).toBeVisible({ timeout: 15000 })
}

/**
 * 菜单列表的一行。
 *
 * 🔴 必须限定在 {@code .el-table-v2__left} 里找：菜单列表是 el-table-v2 虚拟表，勾选列与菜单名列
 *    都是 fixed=LEFT，它们<b>只</b>渲染在左侧固定层里（主表格不重复渲染固定列），
 *    所以按名字过滤行必须在这一层做——在整表范围里找会同时命中左/主/右三份容器。
 *
 * 🔴 用勾选框的 aria-label 精确匹配而不是 hasText：测试菜单名是前缀嵌套的（根/根子/根孙），
 *    子串过滤会一次命中三行，严格模式直接报 violation。
 */
function menuRow(page: Page, name: string) {
  return page
    .locator('.el-table-v2__left .el-table-v2__row')
    .filter({ has: page.locator(`.el-checkbox[aria-label="选择菜单 ${name}"]`) })
}
