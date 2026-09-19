import { expect, test, type Page } from '@playwright/test'

/**
 * 一次性走查脚本：数据接口页内化 + 业务数据双模式
 * 截图输出到 tests/e2e/.verify-shots/enh-*.png
 */

const SHOTS = 'tests/e2e/.verify-shots'
const IFACE_NAME = '走查临时接口'
let IFACE_CODE = ''

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

async function isDark(page: Page): Promise<boolean> {
  return page.locator('html').evaluate((el) => el.classList.contains('dark'))
}

async function toggleDark(page: Page, on: boolean): Promise<void> {
  if ((await isDark(page)) === on) return
  await page.locator('.v-setting').click()
  const drawer = page.locator('.el-drawer:visible')
  await expect(drawer).toBeVisible()
  const save = page.waitForResponse(
    (r) => r.url().includes('/system/user/profile/theme') && r.request().method() === 'PUT'
  )
  await drawer.locator('.v-theme-switch').click()
  await save
  await page.waitForTimeout(500)
  expect(await isDark(page)).toBe(on)
  await drawer.locator('.el-drawer__close-btn').click().catch(() => {})
}

/** 回列表并按唯一编码搜索出临时接口那一行 */
async function findRow(page: Page) {
  await page.goto('/infra/data-manage/data-interface')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('请输入接口编码').fill(IFACE_CODE)
  await page.getByRole('button', { name: /搜索/ }).first().click()
  const row = page.locator('.el-table__row').filter({ hasText: IFACE_NAME }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  return row
}

/** 在第一个 monaco 编辑器（SQL 配置）里整段替换文本 */
async function setSql(page: Page, sql: string) {
  const editor = page.locator('.monaco-editor').first()
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(sql)
  await page.waitForTimeout(300)
}

test('数据接口 + 业务数据 走查', async ({ page }) => {
  test.setTimeout(420_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  IFACE_CODE = `walk_tmp_${Date.now()}`
  await login(page)
  await toggleDark(page, false)

  // ========== A1 列表：责任人列 + 日志按钮 ==========
  await page.goto('/infra/data-manage/data-interface')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.el-table__header').getByText('责任人').first()).toBeVisible()
  await expect(page.locator('.el-table__row').first().getByRole('button', { name: '日志' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/enh-01-list.png` })

  // ========== A2 新建：页内表单 + 责任人/记录日志/多行备注 ==========
  await page.getByRole('button', { name: /新建接口/ }).click()
  await expect(page.getByText('新建数据接口')).toBeVisible()
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0)
  const ownerItem = page.locator('.el-form-item').filter({ hasText: '责任人' }).first()
  await ownerItem.locator('input').fill('李四')
  const logItem = page.locator('.el-form-item').filter({ hasText: '记录日志' }).first()
  await expect(logItem.locator('.el-switch')).toBeVisible()
  const remarkItem = page.locator('.el-form-item').filter({ hasText: '备注' }).first()
  await expect(remarkItem.locator('textarea')).toBeVisible()
  await remarkItem.locator('textarea').fill('第一行备注\n第二行备注')
  await page
    .locator('.el-form-item')
    .filter({ hasText: '接口名称' })
    .first()
    .locator('input')
    .fill(IFACE_NAME)
  await page
    .locator('.el-form-item')
    .filter({ hasText: '接口编码' })
    .first()
    .locator('input')
    .fill(IFACE_CODE)
  await setSql(page, 'SELECT 1 AS ok')
  await page.screenshot({ path: `${SHOTS}/enh-02-form.png` })
  await page.getByRole('button', { name: /保\s*存/ }).first().click()
  await expect(page.getByRole('button', { name: /新建接口/ })).toBeVisible({ timeout: 20_000 })

  // 列表出现新行，责任人=李四
  let row = await findRow(page)
  await expect(row.getByText('李四')).toBeVisible()

  // ========== A3 编辑一次 → 产生版本 ==========
  await row.getByRole('button', { name: '配置' }).click()
  await expect(page.getByText('配置数据接口')).toBeVisible()
  await page
    .locator('.el-form-item')
    .filter({ hasText: '变更说明' })
    .first()
    .locator('input')
    .fill('走查首次修改')
  await page.getByRole('button', { name: /保\s*存/ }).first().click()
  await expect(page.getByRole('button', { name: /新建接口/ })).toBeVisible({ timeout: 20_000 })

  // ========== A4 预览（页内 + 执行成功） ==========
  row = await findRow(page)
  await row.getByRole('button', { name: '预览' }).click()
  await expect(page.getByText(`在线预览 - ${IFACE_NAME}`)).toBeVisible()
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0)
  await page.getByRole('button', { name: /执\s*行/ }).click()
  await expect(page.getByText('执行结果')).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: `${SHOTS}/enh-03-preview.png` })
  await page.getByRole('button', { name: /返\s*回/ }).click()

  // ========== A5 改成坏 SQL → 预览失败 → 产生报错日志 ==========
  row = await findRow(page)
  await row.getByRole('button', { name: '配置' }).click()
  await setSql(page, 'SELECT * FROM walk_no_such_table_xyz')
  await page.getByRole('button', { name: /保\s*存/ }).first().click()
  await expect(page.getByRole('button', { name: /新建接口/ })).toBeVisible({ timeout: 20_000 })
  row = await findRow(page)
  await row.getByRole('button', { name: '预览' }).click()
  await page.getByRole('button', { name: /执\s*行/ }).click()
  await expect(page.locator('.el-alert--error')).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: `${SHOTS}/enh-04-preview-error.png` })
  await page.getByRole('button', { name: /返\s*回/ }).click()

  // ========== A6 行内日志：报错原因列 + 展开详情 ==========
  row = await findRow(page)
  await row.getByRole('button', { name: '日志' }).click()
  await expect(page.getByText(`调用日志 - ${IFACE_NAME}`)).toBeVisible()
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0)
  await expect(page.locator('.el-table__header').getByText('报错原因').first()).toBeVisible()
  const failRow = page.locator('.el-table__row').filter({ hasText: '失败' }).first()
  await expect(failRow).toBeVisible({ timeout: 15_000 })
  await expect(failRow.locator('td').nth(5)).toContainText('walk_no_such_table_xyz', { timeout: 5_000 }).catch(async () => {
    // 列位置兜底：整行包含即可
    await expect(failRow).toContainText(/Table|不存在|walk_no_such/)
  })
  await failRow.locator('.el-table__expand-icon').click()
  await expect(page.locator('pre.code-block.error')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('pre.code-block.error')).toContainText('walk_no_such_table_xyz')
  await page.screenshot({ path: `${SHOTS}/enh-05-log-expand.png` })
  await page.getByRole('button', { name: /返\s*回/ }).click()

  // ========== A7 工具栏全量日志 ==========
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /调用日志/ }).click()
  await expect(page.getByText('接口调用日志')).toBeVisible()
  await expect(
    page.locator('.el-form-item').filter({ hasText: '接口编码' }).first()
  ).toBeVisible()
  await page.getByRole('button', { name: /返\s*回/ }).click()

  // ========== A8 版本历史 + 快照可视化 ==========
  await page.waitForLoadState('networkidle')
  row = await findRow(page)
  await row.getByRole('button', { name: '版本' }).click()
  await expect(page.getByText(`版本历史 - ${IFACE_NAME}`)).toBeVisible()
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0)
  const vRow = page.locator('.el-table__row').first()
  await expect(vRow).toBeVisible({ timeout: 15_000 })
  await vRow.locator('.el-table__expand-icon').click()
  await expect(page.getByText('配置快照')).toBeVisible()
  const desc = page.locator('.el-descriptions').first()
  await expect(desc).toBeVisible({ timeout: 10_000 })
  await expect(desc).toContainText('责任人')
  await expect(desc).toContainText('李四')
  await page.screenshot({ path: `${SHOTS}/enh-06-version-snapshot.png` })
  await page.getByRole('button', { name: /返\s*回/ }).click()

  // ========== A9 暗黑主题 ==========
  await page.waitForLoadState('networkidle')
  await toggleDark(page, true)
  row = await findRow(page)
  await row.getByRole('button', { name: '日志' }).click()
  const failRowDark = page.locator('.el-table__row').filter({ hasText: '失败' }).first()
  await failRowDark.locator('.el-table__expand-icon').click()
  const errPre = page.locator('pre.code-block.error').first()
  await expect(errPre).toBeVisible({ timeout: 10_000 })
  const errBg = await errPre.evaluate((el) => getComputedStyle(el).backgroundColor)
  const codeBg = await page
    .locator('pre.code-block')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  // 硬编码浅色 = rgb(245,247,250)/rgb(254,240,240)，暗黑下不允许出现
  expect(errBg).not.toBe('rgb(254, 240, 240)')
  expect(codeBg).not.toBe('rgb(245, 247, 250)')
  await page.screenshot({ path: `${SHOTS}/enh-07-dark-log.png` })
  await page.getByRole('button', { name: /返\s*回/ }).click()
  await page.waitForLoadState('networkidle')
  row = await findRow(page)
  await row.getByRole('button', { name: '配置' }).click()
  // monaco 应切到 vs-dark
  await expect(page.locator('.monaco-editor.vs-dark').first()).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: `${SHOTS}/enh-08-dark-form.png` })
  await page.getByRole('button', { name: /取\s*消/ }).first().click()
  await toggleDark(page, false)

  // ========== A10 清理临时接口 ==========
  row = await findRow(page)
  await row.getByRole('button', { name: '删除' }).click()
  const box = page.locator('.el-message-box:visible')
  await expect(box).toBeVisible()
  await box.getByRole('button', { name: /确\s*定|OK/ }).click()
  await expect(page.getByText(IFACE_CODE)).toHaveCount(0, { timeout: 15_000 })

  // ========== B 业务数据双模式 ==========
  await page.goto('/infra/data-manage/data-model-data')
  await page.waitForLoadState('networkidle')
  // 选一个有数据的模型（列表第一个模型可能是空表）
  await page
    .locator('.el-form-item')
    .filter({ hasText: '业务模型' })
    .locator('.el-select')
    .first()
    .click()
  await page
    .locator('.el-select-dropdown:visible .el-select-dropdown__item')
    .filter({ hasText: 'system_login_log' })
    .first()
    .click()
  await expect(page.locator('.el-table__header')).toBeVisible({ timeout: 15_000 })

  // B1 默认原始数据模式
  const rawBtn = page.locator('.el-radio-button').filter({ hasText: '原始数据' })
  await expect(rawBtn).toHaveClass(/is-active/)
  // 无多选框列
  await expect(page.locator('.el-table__column--selection')).toHaveCount(0)
  // 列 = 物理字段名（含系统列）
  const rawHeaders = await page.locator('.el-table__header th').allInnerTexts()
  expect(rawHeaders).toContain('id')
  expect(rawHeaders).toContain('create_time')
  expect(rawHeaders).toContain('deleted')
  // create_time 值 = 原始毫秒时间戳（不格式化）
  const ctIdx = rawHeaders.indexOf('create_time')
  const dataRow = page.locator('.el-table__row').first()
  await expect(dataRow).toBeVisible({ timeout: 15_000 })
  const ctText = (await dataRow.locator('td').nth(ctIdx).innerText()).trim()
  expect(ctText).toMatch(/^\d{10,13}$/)
  await page.screenshot({ path: `${SHOTS}/enh-09-raw-mode.png` })

  // B2 字段 + 关键字搜索
  await page
    .locator('.el-form-item')
    .filter({ hasText: '字段' })
    .locator('.el-select')
    .first()
    .click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first().click()
  await page.getByPlaceholder('输入关键字模糊匹配').fill('1')
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await page.waitForTimeout(1000)
  await expect(page.locator('.el-table')).toBeVisible()

  // B3 行点击 → 全字段详情弹窗
  const anyRow = page.locator('.el-table__row').first()
  if (await anyRow.count()) {
    await anyRow.locator('td').nth(2).click()
    const dialog = page.locator('.el-dialog:visible').filter({ hasText: '数据详情' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog.locator('.el-descriptions__label').first()).toContainText('id')
    await page.screenshot({ path: `${SHOTS}/enh-10-row-detail.png` })
    await dialog.locator('.el-dialog__footer').getByRole('button', { name: /关\s*闭/ }).click()
  }

  // B4 切换展示模式
  await page.locator('.el-radio-button').filter({ hasText: '展示模式' }).click()
  await page.waitForTimeout(1500)
  const fmtHeaders = await page.locator('.el-table__header th').allInnerTexts()
  // 展示模式过滤系统列：deleted 不再出现
  expect(fmtHeaders).not.toContain('deleted')
  await page.screenshot({ path: `${SHOTS}/enh-11-formatted-mode.png` })

  // 切回原始模式无回归
  await page.locator('.el-radio-button').filter({ hasText: '原始数据' }).click()
  await page.waitForTimeout(1000)
  const backHeaders = await page.locator('.el-table__header th').allInnerTexts()
  expect(backHeaders).toContain('deleted')

  expect(errors, `page errors: ${errors.join('\n')}`).toEqual([])
})
