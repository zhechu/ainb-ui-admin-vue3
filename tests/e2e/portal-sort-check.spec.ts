import { expect, test, type Page } from '@playwright/test'

/**
 * 一次性走查脚本：门户排序列（列表排序 + 表单排序输入 + 运行时门户切换顺序）
 * 截图输出到 tests/e2e/.verify-shots/portal-sort-*.png
 */

const SHOTS = 'tests/e2e/.verify-shots'
const ts = Date.now()
const PORTAL_A = { name: `排序走查A${ts}`, code: `sort_a_${ts}`, sort: '1' }
const PORTAL_B = { name: `排序走查B${ts}`, code: `sort_b_${ts}`, sort: '5' }

async function login(page: Page): Promise<void> {
  await page.goto('/login')
  const form = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
  await form.waitFor({ state: 'visible' })
  const tenant = form.getByPlaceholder('请输入租户名称')
  if (await tenant.count()) await tenant.fill('xpy')
  await form.getByPlaceholder('请输入用户名').fill('admin')
  await form.getByPlaceholder('请输入密码').fill('admin123')
  const p = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.getByRole('button', { name: /登\s*录/ }).first().click()
  expect((await p).ok()).toBeTruthy()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
}

async function confirmBox(page: Page): Promise<void> {
  const box = page.locator('.el-message-box:visible')
  await box.waitFor({ state: 'visible' })
  await box.locator('.el-button--primary').click()
  await box.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
}

async function gotoPortalList(page: Page): Promise<void> {
  await page.goto('/infra/online/portal')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /新\s*增/ }).first()).toBeVisible({
    timeout: 15_000
  })
}

/** 创建一个「自定义-页面」链接门户并设置排序 */
async function createLinkPortal(
  page: Page,
  portal: { name: string; code: string; sort: string }
): Promise<void> {
  await gotoPortalList(page)
  await page.getByRole('button', { name: /新\s*增/ }).first().click()
  const dialog = page.locator('.el-dialog:visible').filter({ hasText: '新增门户' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('请输入门户名称').fill(portal.name)
  await dialog.locator('input[placeholder*="main_portal"]').fill(portal.code)
  await dialog.locator('.el-radio').filter({ hasText: '自定义' }).click()
  await dialog.locator('input[placeholder*="/system/user"]').fill('/system/user')
  await dialog.locator('.el-input-number input').fill(portal.sort)
  const created = page.waitForResponse(
    (r) => r.url().includes('/infra/portal/create') && r.request().method() === 'POST'
  )
  await dialog.getByRole('button', { name: /确\s*定/ }).click()
  expect((await created).ok()).toBeTruthy()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

/** 全量列表的行文本（不过滤） */
async function allRows(page: Page): Promise<string[]> {
  await gotoPortalList(page)
  await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })
  return page.locator('.el-table__row').allTextContents()
}

async function findRow(page: Page, name: string) {
  await gotoPortalList(page)
  await page.getByPlaceholder('请输入门户名称').fill(name)
  await page.getByRole('button', { name: /搜\s*索/ }).first().click()
  const row = page.locator('.el-table__row').filter({ hasText: name }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  return row
}

async function publishRow(page: Page, name: string): Promise<void> {
  const row = await findRow(page, name)
  await row.getByRole('button', { name: /发\s*布/ }).click()
  const published = page.waitForResponse(
    (r) => r.url().includes('/infra/portal/publish') && r.request().method() === 'POST'
  )
  await confirmBox(page)
  expect((await published).ok()).toBeTruthy()
}

async function deleteRow(page: Page, name: string): Promise<void> {
  const row = await findRow(page, name)
  await row.getByRole('button', { name: /更\s*多/ }).click()
  await page.locator('.el-dropdown-menu:visible').getByText('删除').click()
  const deleted = page.waitForResponse(
    (r) => r.url().includes('/infra/portal/delete') && r.request().method() === 'DELETE'
  )
  await confirmBox(page)
  expect((await deleted).ok()).toBeTruthy()
}

test('门户排序列走查', async ({ page }) => {
  test.setTimeout(600_000)
  await login(page)

  await test.step('列表存在排序列', async () => {
    await gotoPortalList(page)
    await expect(page.locator('.el-table__header th', { hasText: '排序' })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/portal-sort-01-column.png`, fullPage: true })
  })

  await test.step('创建 A(sort=1)、B(sort=5)，列表 A 在 B 前（旧逻辑按 id 倒序则 B 在前）', async () => {
    await createLinkPortal(page, PORTAL_A)
    await createLinkPortal(page, PORTAL_B)
    const rows = await allRows(page)
    const ia = rows.findIndex((r) => r.includes(PORTAL_A.name))
    const ib = rows.findIndex((r) => r.includes(PORTAL_B.name))
    expect(ia, `A 应在列表中: ${JSON.stringify(rows.slice(0, 5))}`).toBeGreaterThanOrEqual(0)
    expect(ib).toBeGreaterThanOrEqual(0)
    expect(ia, 'sort=1 的 A 应排在 sort=5 的 B 之前').toBeLessThan(ib)
    // A 行排序列显示 1（序号/编号/名称/编码/类型/排序 → 第 6 列）
    const rowA = page.locator('.el-table__row').filter({ hasText: PORTAL_A.name }).first()
    await expect(rowA.locator('td').nth(5)).toHaveText('1')
    await page.screenshot({ path: `${SHOTS}/portal-sort-02-order.png`, fullPage: true })
  })

  await test.step('编辑 B 排序为 0 后，B 升到首行（sort=0 且 id 最大）', async () => {
    const row = await findRow(page, PORTAL_B.name)
    await row.getByRole('button', { name: /编\s*辑/ }).click()
    const dialog = page.locator('.el-dialog:visible').filter({ hasText: '编辑门户' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.el-input-number input')).toHaveValue('5')
    await dialog.locator('.el-input-number input').fill('0')
    const updated = page.waitForResponse(
      (r) => r.url().includes('/infra/portal/update') && r.request().method() === 'PUT'
    )
    await dialog.getByRole('button', { name: /确\s*定/ }).click()
    expect((await updated).ok()).toBeTruthy()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    const rows = await allRows(page)
    expect(rows[0], `首行应为 B: ${rows[0]}`).toContain(PORTAL_B.name)
  })

  await test.step('发布 A/B 后，配置面板门户下拉按 sort 排序（B 在 A 前）', async () => {
    await publishRow(page, PORTAL_A.name)
    await publishRow(page, PORTAL_B.name)
    await page.goto('/index')
    await page.waitForLoadState('networkidle')
    await page.locator('.v-setting').click()
    const drawer = page.locator('.el-drawer:visible')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('首页门户')).toBeVisible({ timeout: 10_000 })
    await drawer.locator('.el-select').first().locator('.el-select__wrapper').click()
    const dropdown = page.locator('.el-select-dropdown:visible')
    await dropdown.waitFor({ state: 'visible' })
    const options = await dropdown.locator('.el-select-dropdown__item').allTextContents()
    const ia = options.findIndex((o) => o.includes(PORTAL_A.name))
    const ib = options.findIndex((o) => o.includes(PORTAL_B.name))
    expect(ib, `下拉应含 B: ${JSON.stringify(options)}`).toBeGreaterThanOrEqual(0)
    expect(ia, `下拉应含 A: ${JSON.stringify(options)}`).toBeGreaterThanOrEqual(0)
    expect(ib, 'sort=0 的 B 应排在 sort=1 的 A 之前').toBeLessThan(ia)
    await page.screenshot({ path: `${SHOTS}/portal-sort-03-setting-dropdown.png` })
    await drawer.locator('.el-drawer__close-btn').click().catch(() => {})
  })

  await test.step('清理：删除 A/B', async () => {
    await deleteRow(page, PORTAL_A.name)
    await deleteRow(page, PORTAL_B.name)
    await gotoPortalList(page)
    await page.getByPlaceholder('请输入门户名称').fill('排序走查')
    await page.getByRole('button', { name: /搜\s*索/ }).first().click()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.el-table__row')).toHaveCount(0)
  })
})
