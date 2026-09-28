import { test, expect, type Page } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * Agent 定义管理页 + 整页设计器 端到端验证
 *
 * 🔴 为什么非要走浏览器
 * 后端 curl 已证 7 端点 + 状态机全通，但「菜单点开是空白页」「弹窗改整页后导航/回填是否正常」
 * 这类缺陷只在真实 DOM 里暴露。AI助手 UX 修复（问题3）把新建/编辑/查看从 760px 弹窗改成了
 * 隐藏路由整页设计器 /agent-def/editor，故本 spec 从「驱动 dialog」整体改为「驱动整页设计器」：
 *   列表点「新增 Agent」→ 跳整页设计器 → 填必填 → 保存草稿（URL 补 id）→ 返回列表 → 行状态机。
 *
 * 🔴 尤其要守住的平台头号反模式：「配置保存成功但不生效」——工具多选（toolKeys CSV⇄数组适配器）
 *   往返若丢了，表现为「选了工具保存成功、重新打开却空了」，curl/单测全绿，只有浏览器走一遍才暴露。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。
 * 本 spec 全程通过 UI 自建数据（不预播种），用时间戳保证 code 唯一，跑完自清理（删草稿）。
 */

const CODE = `e2e_def_${Date.now().toString().slice(-8)}`

/** 列表页「新增 Agent」→ 整页设计器 → 填三个必填 → 保存草稿 → 断言落库 → 返回列表 */
async function createDraftViaUi(page: Page, code: string, name: string, persona: string) {
  await page.getByRole('button', { name: /新增 Agent/ }).first().click()
  await page.waitForURL(/\/agent-def\/editor/)

  await page.getByPlaceholder('请输入名称，如「订单客服」').fill(name)
  await page
    .getByPlaceholder('小写字母开头，仅含小写字母/数字/下划线，如 order_assistant')
    .fill(code)
  await page.locator('[data-testid="agent-persona"]').fill(persona)

  await page.getByRole('button', { name: /保存草稿/ }).click()
  await expect(page.locator('.el-message').filter({ hasText: '新建成功' }).first()).toBeVisible({
    timeout: 15000
  })
  // 新建成功后 URL 补上 id（防刷新重复新建）
  await expect(page).toHaveURL(/\/agent-def\/editor\?id=\d+/)

  await page.locator('button[title="返回列表"]').click()
  await page.waitForURL(/\/agent\/def$/)
}

test.describe('Agent 定义管理页', () => {
  test.setTimeout(180_000)

  test('菜单非空白 + 新建 → 发布 → 停用 全生命周期', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/def')

    // 页面非空白：搜索表单在
    await expect(page.getByText('Agent 编码').first()).toBeVisible({ timeout: 20000 })

    await createDraftViaUi(page, CODE, 'E2E 测试助手', '你是一个用于端到端测试的助手，请友好地回答。')

    // 列表出现新行，状态=草稿
    const row = page.locator('.el-table__body tr').filter({ hasText: CODE }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row.getByText('草稿')).toBeVisible({ timeout: 15000 })

    // 发布
    await row.getByRole('button', { name: '发布' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /发布成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(
      page.locator('.el-table__body tr').filter({ hasText: CODE }).first().getByText('已发布')
    ).toBeVisible({ timeout: 15000 })

    // 停用
    await page
      .locator('.el-table__body tr')
      .filter({ hasText: CODE })
      .first()
      .getByRole('button', { name: '停用' })
      .first()
      .click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /停用成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(
      page.locator('.el-table__body tr').filter({ hasText: CODE }).first().getByText('已停用')
    ).toBeVisible({ timeout: 15000 })

    // 查看（已停用行）→ 整页只读：字段禁用 + 只读提示 + 不可保存
    await page
      .locator('.el-table__body tr')
      .filter({ hasText: CODE })
      .first()
      .getByRole('button', { name: '查看' })
      .first()
      .click()
    await page.waitForURL(/\/agent-def\/editor\?id=\d+/)
    await expect(page).toHaveURL(/mode=view/)
    await expect(page.getByPlaceholder('请输入名称，如「订单客服」')).toBeDisabled()
    await expect(page.locator('.el-alert--warning').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /保存草稿/ })).toBeDisabled()
    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(/\/agent\/def$/)
  })

  test('草稿可删除（清理本 spec 造的数据）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/def')

    const CODE2 = `e2e_del_${Date.now().toString().slice(-8)}`
    await createDraftViaUi(page, CODE2, '待删助手', '临时人设，用于验证删除。')

    const row = page.locator('.el-table__body tr').filter({ hasText: CODE2 }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: '删除' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /删除成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: CODE2 })).toHaveCount(0, {
      timeout: 15000
    })
  })

  /**
   * 工具多选的「表单 ↔ VO」往返（0 LLM token）
   *
   * 🔴 为什么非走浏览器不可：curl 差分已证后端 create/get 对 tool_keys 的持久化+规范化+发布期只读校验，
   * 但「多选控件绑逗号串」这条前端适配（selectedTools computed get/set + loadDef 回填 toolKeys）只在真实 DOM 里暴露。
   * 判据：新建时选一个只读工具 → 保存草稿 → 重新编辑 → 该工具仍选中 → 删草稿清理。
   */
  test('工具多选绑定 → 保存 → 重新编辑仍选中（toolKeys 往返，0 token）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/def')
    await expect(page.getByText('Agent 编码').first()).toBeVisible({ timeout: 20000 })

    const CODE3 = `e2e_tool_${Date.now().toString().slice(-8)}`
    await page.getByRole('button', { name: /新增 Agent/ }).first().click()
    await page.waitForURL(/\/agent-def\/editor/)

    await page.getByPlaceholder('请输入名称，如「订单客服」').fill('E2E 工具助手')
    await page
      .getByPlaceholder('小写字母开头，仅含小写字母/数字/下划线，如 order_assistant')
      .fill(CODE3)
    await page.locator('[data-testid="agent-persona"]').fill('你是工具往返测试助手。')

    // 绑定一个只读工具：下拉只列 requireConfirm===false 的工具，故 data_interface_list 必在列
    // 🔴 这版 Element Plus 的多选把 .el-select__placeholder 盖在 input 上，直接点 input 会被「拦截指针事件」；
    //    改点 .el-select 容器开菜单，再对 filter input 用 fill 触发过滤
    const toolCard = page.locator('.el-card').filter({ hasText: '工具（只读）' }).first()
    await toolCard.locator('.el-select').first().click()
    await toolCard.locator('input').first().fill('data_interface_list')
    const option = page
      .locator('.el-select-dropdown__item:visible')
      .filter({ hasText: 'data_interface_list' })
      .first()
    await expect(option).toBeVisible({ timeout: 10000 })
    await option.click()
    // 选中后控件内出现该工具的 tag（证明 set 把数组写进了 formData.toolKeys）
    await expect(
      toolCard.locator('.el-tag').filter({ hasText: 'data_interface_list' }).first()
    ).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: /保存草稿/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: '新建成功' }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page).toHaveURL(/\/agent-def\/editor\?id=\d+/)

    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(/\/agent\/def$/)

    // 重新打开编辑：工具应仍选中（证明 loadDef 回填了 toolKeys，往返无丢失）
    const row = page.locator('.el-table__body tr').filter({ hasText: CODE3 }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: '编辑' }).first().click()
    await page.waitForURL(/\/agent-def\/editor\?id=\d+/)
    const editToolCard = page.locator('.el-card').filter({ hasText: '工具（只读）' }).first()
    await expect(
      editToolCard.locator('.el-tag').filter({ hasText: 'data_interface_list' }).first()
    ).toBeVisible({ timeout: 15000 })

    // 清理：返回列表 + 删除草稿
    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(/\/agent\/def$/)
    await row.getByRole('button', { name: '删除' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /删除成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: CODE3 })).toHaveCount(0, {
      timeout: 15000
    })
  })
})
