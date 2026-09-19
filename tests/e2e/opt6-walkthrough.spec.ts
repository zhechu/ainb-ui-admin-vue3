import { expect, test, type Page } from '@playwright/test'

/**
 * 一次性走查脚本：单据模板「测试」按钮 + 页内取号测试面板
 *  1) 列表操作列出现「测试」，点击进入页内面板，默认模拟模式
 *  2) 模拟取号可反复执行且不消耗流水（两次结果一致、模板统计不变）
 *  3) 真实取号有二次确认，消耗流水：单号==模拟预演的下一个号，统计+1，日志来源=测试取号
 *  4) 取号日志页来源筛选与标签含「测试取号」
 *  5) 暗黑主题下可读
 * 截图输出到 tests/e2e/.verify-shots/opt6-*.png
 */

const SHOTS = 'tests/e2e/.verify-shots'
const TEMPLATE_NAME = '示例-合同编号'

test.use({ viewport: { width: 1440, height: 1100 }, actionTimeout: 15_000 })

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

test('单据模板取号测试走查', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  await toggleDark(page, false)
  await page.goto('/infra/data-manage/bill-template')
  await page.waitForLoadState('networkidle')

  const row = page.locator('.el-table__row').filter({ hasText: TEMPLATE_NAME }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })

  // ========== 1) 操作列有「测试」按钮 ==========
  await expect(row.getByRole('button', { name: '测试' })).toBeVisible()

  // ========== 前置：开启取号日志，便于验证来源标签 ==========
  await row.getByRole('button', { name: '编辑' }).click()
  const logItem = page.locator('.el-form-item').filter({ hasText: '取号日志' }).first()
  await expect(logItem).toBeVisible({ timeout: 15_000 })
  const logSwitch = logItem.locator('.el-switch')
  if (!(await logSwitch.evaluate((el) => el.classList.contains('is-checked')))) {
    await logSwitch.click()
  }
  // 顶部与底部各有一个「保 存」，取顶部那个
  await page.getByRole('button', { name: /保\s*存/ }).first().click()
  await expect(page.locator('.el-message--success')).toBeVisible()
  await expect(row).toBeVisible({ timeout: 15_000 })

  // ========== 进入测试面板 ==========
  await row.getByRole('button', { name: '测试' }).click()
  await expect(page.getByText(`取号测试 - ${TEMPLATE_NAME}`)).toBeVisible({ timeout: 15_000 })

  // 默认模拟模式
  const simRadio = page.locator('.el-radio').filter({ hasText: '模拟取号' }).first()
  const realRadio = page.locator('.el-radio').filter({ hasText: '真实取号' }).first()
  await expect(simRadio).toHaveClass(/is-checked/)
  await expect(realRadio).not.toHaveClass(/is-checked/)

  const resultBox = page.locator('.bt-result')
  const statItem = (label: string) =>
    page.locator('.el-descriptions__cell').filter({ hasText: label }).locator('..')
  const statValue = async (label: string) =>
    (await statItem(label).locator('.el-descriptions__content').innerText()).trim()

  const seqBefore = Number(await statValue('当前流水'))
  const lastNoBefore = await statValue('最近单号')
  expect(seqBefore).toBeGreaterThan(0)

  const runButton = page.locator('.el-form button.el-button--primary').filter({
    hasText: /模拟取号|真实取号/
  })

  // ========== 2) 模拟取号：两次结果一致，不消耗流水 ==========
  await runButton.click()
  // 编辑保存的 success 提示可能还没消散，取最新一条
  await expect(page.locator('.el-message--success').last()).toBeVisible()
  await expect(resultBox).toBeVisible()
  await expect(resultBox).toContainText('模拟取号 · 未消耗流水')
  const noA = (await resultBox.locator('span.font-mono').first().innerText()).trim()
  expect(noA).toMatch(/^HT\d+$/)
  const seqText1 = await resultBox.innerText()
  const seqA = Number(/流水序号：(\d+)/.exec(seqText1)?.[1])
  expect(seqA).toBe(seqBefore + 1)

  await runButton.click()
  await expect(resultBox).toContainText(noA) // 同一个号：模拟不推进计数
  const seqA2 = Number(/流水序号：(\d+)/.exec(await resultBox.innerText())?.[1])
  expect(seqA2).toBe(seqA)
  // 模板统计未被模拟取号改动
  expect(await statValue('当前流水')).toBe(String(seqBefore))
  expect(await statValue('最近单号')).toBe(lastNoBefore)
  await page.screenshot({ path: `${SHOTS}/opt6-01-simulate.png`, fullPage: true })

  // ========== 3) 真实取号：二次确认 + 消耗流水 ==========
  await realRadio.click()
  await expect(runButton).toContainText('真实取号')
  let testReq = 0
  page.on('request', (r) => {
    if (r.url().includes('/infra/bill-template/test')) testReq++
  })
  await runButton.click()
  const box = page.locator('.el-message-box')
  await expect(box).toBeVisible()
  await expect(box).toContainText('消耗')
  // 取消不发请求
  await box.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(500)
  expect(testReq).toBe(0)
  // 再点并确认
  await runButton.click()
  await expect(box).toBeVisible()
  const resp = page.waitForResponse(
    (r) => r.url().includes('/infra/bill-template/test') && r.request().method() === 'POST'
  )
  await box.getByRole('button', { name: '确认取号' }).click()
  expect((await resp).ok()).toBeTruthy()
  await expect(resultBox).toContainText('真实取号 · 已消耗流水')
  const noB = (await resultBox.locator('span.font-mono').first().innerText()).trim()
  // 真实取到的正是模拟预演的那个号
  expect(noB).toBe(noA)
  // 统计推进
  await expect
    .poll(async () => statValue('最近单号'), { timeout: 10_000 })
    .toBe(noB)
  expect(Number(await statValue('当前流水'))).toBe(seqBefore + 1)

  // 真实之后再模拟：应预演下一个号
  await simRadio.click()
  await runButton.click()
  const seqC = Number(/流水序号：(\d+)/.exec(await resultBox.innerText())?.[1])
  expect(seqC).toBe(seqA + 1)
  const noC = (await resultBox.locator('span.font-mono').first().innerText()).trim()
  expect(noC).not.toBe(noB)

  // 执行历史：4 条，最新在前
  const historyRows = page.locator('.el-table').last().locator('.el-table__row')
  await expect(historyRows).toHaveCount(4)
  await expect(historyRows.nth(0)).toContainText('模拟')
  await expect(historyRows.nth(1)).toContainText('真实')
  await page.screenshot({ path: `${SHOTS}/opt6-02-real-consumed.png`, fullPage: true })

  // ========== 返回列表 ==========
  await page.getByRole('button', { name: /返\s*回/ }).click()
  await expect(row).toBeVisible({ timeout: 15_000 })
  // 列表统计已刷新：当前流水列（序号0 编号1 名称2 编码3 分类4 生成方式5 范例6 重置周期7 当前流水8）
  await expect(row.locator('td').nth(8)).toContainText(String(seqBefore + 1))

  // ========== 4) 取号日志：来源=测试取号 ==========
  await row.getByRole('button', { name: '取号日志' }).click()
  await expect(page.getByText(`取号日志 - ${TEMPLATE_NAME}`)).toBeVisible({ timeout: 15_000 })
  const logTable = page.locator('.el-table').last()
  await expect(logTable.locator('.el-table__row').first()).toContainText(noB)
  await expect(logTable.locator('.el-table__row').first()).toContainText('测试取号')
  // 来源筛选含「测试取号」
  await page.locator('.el-form-item').filter({ hasText: '来源' }).locator('.el-select').click()
  await expect(page.locator('.el-select-dropdown__item').filter({ hasText: '测试取号' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: `${SHOTS}/opt6-03-log-source.png`, fullPage: true })

  // ========== 5) 暗黑主题 ==========
  await page.getByRole('button', { name: /返\s*回/ }).click()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await toggleDark(page, true)
  await row.getByRole('button', { name: '测试' }).click()
  await expect(page.getByText(`取号测试 - ${TEMPLATE_NAME}`)).toBeVisible({ timeout: 15_000 })
  await runButton.click()
  await expect(resultBox).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/opt6-04-dark.png`, fullPage: true })

  expect(errors).toEqual([])
})
