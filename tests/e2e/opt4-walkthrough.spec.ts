import { expect, test, type Page } from '@playwright/test'

/**
 * 一次性走查脚本：单据模板 + 数据接口四项优化
 *  1) 单据模板新建页两栏布局
 *  2) 取号日志：时间区间必填且 ≤3 个月
 *  3) 数据接口日志：新增调用时间区间（必填且 ≤3 个月）
 *  4) 数据接口「记录日志」默认关闭
 * 截图输出到 tests/e2e/.verify-shots/opt4-*.png
 */

const SHOTS = 'tests/e2e/.verify-shots'

test.use({ viewport: { width: 1440, height: 1000 }, actionTimeout: 15_000 })

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

/** datetimerange 原子写入：fill 两个触发输入 → 面板「确定」提交 → 失焦校验 */
async function setRange(page: Page, start: string, end: string): Promise<void> {
  const inputs = page.locator('.el-date-editor input')
  await inputs.first().click()
  await inputs.first().fill(start)
  await inputs.nth(1).fill(end)
  const ok = page.locator('.el-picker-panel:visible').getByRole('button', { name: /确定/ }).first()
  if (await ok.count()) {
    await ok.click()
  } else {
    await inputs.nth(1).press('Enter')
  }
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await expect(inputs.first()).toHaveValue(start, { timeout: 5_000 })
  await expect(inputs.nth(1)).toHaveValue(end, { timeout: 5_000 })
}

test('单据模板/数据接口四项优化走查', async ({ page }) => {
  test.setTimeout(420_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  let logPageReqs = 0
  page.on('request', (r) => {
    if (r.url().includes('log-page')) logPageReqs++
  })

  await login(page)
  await toggleDark(page, false)

  // ========== 1) 单据模板新建页：两栏布局 ==========
  await page.goto('/infra/data-manage/bill-template')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /新建模板/ }).click()
  await expect(page.locator('.bt-form-title')).toHaveText('新建单据模板')
  await expect(page.locator('.bt-col-title', { hasText: '基本信息' })).toBeVisible()
  await expect(page.locator('.bt-col-title', { hasText: '生成配置' })).toBeVisible()
  // 两栏并排：标题框的 y 接近、x 明显分开
  const boxes = await page.locator('.bt-col-title').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y }
    })
  )
  expect(boxes.length).toBe(2)
  expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(10)
  expect(boxes[1].x - boxes[0].x).toBeGreaterThan(300)
  // 左栏含基本信息控件、右栏含生成配置控件
  const leftCol = page.locator('.el-col').filter({ has: page.locator('.bt-col-title', { hasText: '基本信息' }) })
  const rightCol = page.locator('.el-col').filter({ has: page.locator('.bt-col-title', { hasText: '生成配置' }) })
  await expect(leftCol.getByPlaceholder('请输入模板名称')).toBeVisible()
  await expect(leftCol.locator('.el-form-item__label', { hasText: '备注' })).toBeVisible()
  await expect(rightCol.locator('.el-form-item__label', { hasText: '生成方式' })).toBeVisible()
  await expect(rightCol.locator('.el-form-item__label', { hasText: '取号日志' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/opt4-01-bt-two-col.png`, fullPage: true })

  // ========== 4) 数据接口新建：记录日志默认关闭（顺路先验，避免后面来回切页） ==========
  await page.getByRole('button', { name: /取\s*消/ }).first().click()
  await page.goto('/infra/data-manage/data-interface')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /新建/ }).first().click()
  const logItem = page
    .locator('.el-form-item')
    .filter({ has: page.locator('.el-form-item__label', { hasText: '记录日志' }) })
  await expect(logItem.locator('.el-switch')).toBeVisible()
  expect(await logItem.locator('.el-switch').evaluate((el) => el.classList.contains('is-checked'))).toBe(
    false
  )
  await expect(logItem).toContainText('默认关闭')
  await page.screenshot({ path: `${SHOTS}/opt4-02-di-log-default-off.png` })
  await page.getByRole('button', { name: /返\s*回|取\s*消/ }).first().click()

  // ========== 3) 数据接口日志页：调用时间区间必填 + ≤3 个月 ==========
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /调用日志/ }).first().click()
  await expect(page.locator('.di-panel-title')).toBeVisible()
  const diRangeItem = page
    .locator('.el-form-item')
    .filter({ has: page.locator('.el-form-item__label', { hasText: '调用时间' }) })
  await expect(diRangeItem).toBeVisible()
  // 必填标记（el-form-item required → 根节点带 is-required，label 前有星号）
  expect(await diRangeItem.evaluate((el) => el.classList.contains('is-required'))).toBe(true)
  await expect(diRangeItem.locator('.el-date-editor')).toBeVisible()
  // 默认近 7 天已预填
  const diInputs = diRangeItem.locator('.el-date-editor input')
  await expect(diInputs.first()).toHaveValue(/^\d{4}-\d{2}-\d{2} 00:00:00$/)
  await expect(diInputs.nth(1)).toHaveValue(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  // 不可清空
  expect(await diRangeItem.locator('.el-date-editor .el-input__clear').count()).toBe(0)
  const diReqBefore = logPageReqs
  expect(diReqBefore).toBeGreaterThan(0) // open() 已用默认区间查过一次
  // 超限区间 → warning 且不发请求
  await setRange(page, '2020-01-01 00:00:00', '2020-05-01 00:00:00')
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await expect(
    page.locator('.el-message--warning').filter({ hasText: /不能大于\s*3\s*个月/ }).first()
  ).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(500)
  expect(logPageReqs).toBe(diReqBefore)
  await page.screenshot({ path: `${SHOTS}/opt4-03-di-log-range-blocked.png` })
  // 合法区间（恰好 3 个月）→ 正常发起请求
  await setRange(page, '2020-01-01 00:00:00', '2020-04-01 00:00:00')
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await page.waitForTimeout(1_500)
  expect(logPageReqs).toBe(diReqBefore + 1)
  await page.getByRole('button', { name: /返\s*回/ }).first().click()

  // ========== 2) 单据模板取号日志：区间必填 + ≤3 个月 ==========
  await page.goto('/infra/data-manage/bill-template')
  await page.waitForLoadState('networkidle')
  const row = page.locator('.el-table__row').first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  const btReqBefore = logPageReqs
  await row.getByRole('button', { name: /取号日志/ }).click()
  await expect(page.locator('.bt-panel-title')).toContainText('取号日志 -')
  const btRangeItem = page
    .locator('.el-form-item')
    .filter({ has: page.locator('.el-form-item__label', { hasText: '取号时间' }) })
  await expect(btRangeItem).toBeVisible()
  const btInputs = btRangeItem.locator('.el-date-editor input')
  await expect(btInputs.first()).toHaveValue(/^\d{4}-\d{2}-\d{2} 00:00:00$/)
  await page.waitForTimeout(1_000)
  expect(logPageReqs).toBeGreaterThan(btReqBefore) // 默认区间自动查询成功
  // 超限 → warning 且不发请求
  const overBefore = logPageReqs
  await setRange(page, '2020-01-01 00:00:00', '2020-05-01 00:00:00')
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await expect(
    page.locator('.el-message--warning').filter({ hasText: /不能大于\s*3\s*个月/ }).first()
  ).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(500)
  expect(logPageReqs).toBe(overBefore)
  // 重置 → 回到默认近 7 天且正常查询
  const resetBefore = logPageReqs
  await page.getByRole('button', { name: /重置/ }).first().click()
  await page.waitForTimeout(1_500)
  expect(logPageReqs).toBeGreaterThan(resetBefore)
  await expect(btInputs.first()).toHaveValue(/^\d{4}-\d{2}-\d{2} 00:00:00$/)
  await page.screenshot({ path: `${SHOTS}/opt4-04-bt-log-range.png` })

  // ========== 暗黑主题抽查 ==========
  await page.getByRole('button', { name: /返\s*回/ }).first().click()
  await toggleDark(page, true)
  await page.getByRole('button', { name: /新建模板/ }).click()
  await expect(page.locator('.bt-col-title', { hasText: '基本信息' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/opt4-05-dark-bt-form.png`, fullPage: true })
  await page.getByRole('button', { name: /取\s*消/ }).first().click()
  await page.goto('/infra/data-manage/data-interface')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /调用日志/ }).first().click()
  await expect(page.locator('.di-panel-title')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/opt4-06-dark-di-log.png` })

  expect(errors).toEqual([])
})
