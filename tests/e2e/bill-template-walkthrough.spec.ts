import { expect, test, type Page } from '@playwright/test'

/**
 * 一次性走查脚本：单据模板取号日志 + 新建/编辑页内化
 * 截图输出到 tests/e2e/.verify-shots/bt-*.png
 */

const SHOTS = 'tests/e2e/.verify-shots'
// 后端绝对地址：与 .env.local 的 VITE_BASE_URL + VITE_API_URL 一致。
// 该工程未启用 Vite 代理，前端 axios 直连 :48080，所以这里也必须用绝对地址，
// 否则相对 /admin-api 会被解析到 :80 dev server 上而 404。
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:48080/admin-api'
const ts = Date.now()
const ON_NAME = '走查日志开模板'
const ON_CODE = `walk_log_on_${ts}`
const OFF_NAME = '走查日志关模板'
const OFF_CODE = `walk_log_off_${ts}`

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

/** 回列表并按编码搜索出目标行 */
async function findRow(page: Page, code: string) {
  await page.goto('/infra/data-manage/bill-template')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('请输入模板编码').fill(code)
  await page.getByRole('button', { name: /搜索/ }).first().click()
  const row = page.locator('.el-table__row').filter({ hasText: code }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  return row
}

/** 取号日志开关（表单里 label 为「取号日志」的 switch） */
function logSwitch(page: Page) {
  return page
    .locator('.el-form-item')
    .filter({ has: page.locator('.el-form-item__label', { hasText: '取号日志' }) })
    .locator('.el-switch')
    .first()
}

/**
 * 把「取号日志」开关切到目标状态
 *
 * 页内表单很长，开关靠底部，Playwright 的自动滚动有时无法把它带进视口
 * （命中「Element is outside of the viewport」）。这里先用原生 scrollIntoView
 * 居中（能滚动嵌套滚动容器），再点可见的 .el-switch__core，而不是隐藏的 input。
 */
async function setLogSwitch(page: Page, on: boolean) {
  const sw = logSwitch(page)
  await sw.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const checked = await sw.evaluate((el) => el.classList.contains('is-checked'))
  if (checked !== on) {
    await sw.locator('.el-switch__core').click()
  }
  expect(await sw.evaluate((el) => el.classList.contains('is-checked'))).toBe(on)
}

/** 通过页面登录态调 occupy 接口触发一次真实取号（前端预占即业务取号入口） */
async function occupy(page: Page, code: string): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('ACCESS_TOKEN')
    if (!raw) return ''
    // web-storage-cache 存的是 {c:创建时间, e:过期时间, v:JSON.stringify(值)}，
    // 真正的 token 在 v 里、且被二次 JSON 序列化过（.c 是时间戳，别拿错）
    try {
      const item = JSON.parse(raw)
      return typeof item.v === 'string' ? JSON.parse(item.v) : String(item.v ?? '')
    } catch {
      return ''
    }
  })
  expect(token, 'ACCESS_TOKEN 解析失败').toBeTruthy()
  const resp = await page.request.post(`${API_BASE}/infra/bill-template/occupy?code=${code}`, {
    headers: { Authorization: `Bearer ${token}`, 'tenant-id': '1' }
  })
  const text = await resp.text()
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`occupy 返回非 JSON：status=${resp.status()} body=${text.slice(0, 200)}`)
  }
  expect(body.code, JSON.stringify(body)).toBe(0)
  return body.data as string
}

test.use({ viewport: { width: 1440, height: 1600 }, actionTimeout: 15_000 })

test('单据模板取号日志 + 页内化走查', async ({ page }) => {
  test.setTimeout(420_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  await toggleDark(page, false)

  // ========== A1 列表：操作列有「取号日志」按钮 ==========
  await page.goto('/infra/data-manage/bill-template')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.el-table__row').first().getByRole('button', { name: /取号日志/ })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/bt-01-list.png` })

  // ========== B 新建：页内表单 + 取号日志开关默认关闭 ==========
  await page.getByRole('button', { name: /新建模板/ }).click()
  await expect(page.locator('.bt-form-title')).toHaveText('新建单据模板')
  // 页内而非弹窗
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0)
  // 开关默认关闭
  const sw = logSwitch(page)
  await expect(sw).toBeVisible()
  expect(await sw.evaluate((el) => el.classList.contains('is-checked'))).toBe(false)
  // 填表
  await page.getByPlaceholder('请输入模板名称').fill(ON_NAME)
  await page.getByPlaceholder('只允许字母、数字、下划线').fill(ON_CODE)
  await setLogSwitch(page, true)
  // 范例试算正常（页内壳下 watch 去抖仍工作）
  const exampleBox = page.locator('.example-box')
  await expect(exampleBox).toBeVisible()
  await expect.poll(async () => {
    const text = (await exampleBox.innerText()).trim()
    return text && text !== '-' && !text.includes('试算中')
  }, { timeout: 10_000 }).toBeTruthy()
  await page.screenshot({ path: `${SHOTS}/bt-02-form.png` })
  // 保存 → 回列表
  await page.getByRole('button', { name: /保\s*存/ }).first().click()
  await expect(page.getByRole('button', { name: /新建模板/ })).toBeVisible({ timeout: 15_000 })

  // ========== C 取号日志面板：页内 + 时间段默认近 7 天 + 初始为空 ==========
  let row = await findRow(page, ON_CODE)
  await row.getByRole('button', { name: /取号日志/ }).click()
  await expect(page.locator('.bt-panel-title')).toHaveText(`取号日志 - ${ON_NAME}`)
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0)
  // 时间段默认已填
  const rangeInputs = page.locator('.el-date-editor--datetimerange input')
  await expect(rangeInputs.first()).not.toHaveValue('')
  await expect(page.locator('.el-table__row')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/bt-03-log-empty.png` })
  await page.getByRole('button', { name: /返回/ }).click()
  await expect(page.getByRole('button', { name: /新建模板/ })).toBeVisible()

  // ========== D 真实取号 → 日志落库（复用不重复记） ==========
  const no1 = await occupy(page, ON_CODE)
  const no2 = await occupy(page, ON_CODE)
  expect(no2).toBe(no1) // 预占幂等：第二次复用，不消耗计数

  row = await findRow(page, ON_CODE)
  await row.getByRole('button', { name: /取号日志/ }).click()
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await expect(page.locator('.el-table__row')).toHaveCount(1, { timeout: 10_000 })
  const logRow = page.locator('.el-table__row').first()
  await expect(logRow).toContainText(no1)
  await expect(logRow).toContainText('表单预占')
  await expect(logRow).toContainText('成功')
  await page.screenshot({ path: `${SHOTS}/bt-04-log-row.png` })

  // ========== D2 单据编号搜索 ==========
  await page.getByPlaceholder('模糊匹配').fill(no1)
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await expect(page.locator('.el-table__row')).toHaveCount(1, { timeout: 10_000 })
  await page.getByPlaceholder('模糊匹配').fill('ZZZ_NOT_EXIST')
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await expect(page.locator('.el-table__empty-block')).toBeVisible({ timeout: 10_000 })
  await page.getByPlaceholder('模糊匹配').fill('')

  // ========== D3 时间段搜索：改为 2020 年窗口应查不到 ==========
  // datetimerange 用 fill 原子写入两个触发输入（fill 不做命中测试，不会被浮层挡住），
  // 再走面板「确定」提交；逐字 pressSequentially 常常提交不进 v-model，面板还会浮着挡住「搜索」。
  await rangeInputs.first().click()
  await rangeInputs.first().fill('2020-01-01 00:00:00')
  await rangeInputs.nth(1).fill('2020-01-02 00:00:00')
  const pickerOk = page
    .locator('.el-picker-panel:visible')
    .getByRole('button', { name: /确定/ })
    .first()
  if (await pickerOk.count()) {
    await pickerOk.click()
  } else {
    await rangeInputs.nth(1).press('Enter')
  }
  // 点标题让输入失焦：若没真正提交进模型，失焦后会被还原，下面断言立刻暴露问题（而不是卡在空块超时）
  await page.locator('.bt-panel-title').click()
  await expect(rangeInputs.first()).toHaveValue('2020-01-01 00:00:00', { timeout: 5_000 })
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await expect(page.locator('.el-table__empty-block')).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: `${SHOTS}/bt-05-log-range-empty.png` })
  // 重置 → 回到默认近 7 天，能查到那条日志
  await page.getByRole('button', { name: /重置/ }).first().click()
  await expect(page.locator('.el-table__row')).toHaveCount(1, { timeout: 10_000 })

  // ========== E 第二个模板：开关保持默认关闭 → 取号不落日志 ==========
  await page.getByRole('button', { name: /返回/ }).click()
  await page.getByRole('button', { name: /新建模板/ }).click()
  await expect(page.locator('.bt-form-title')).toHaveText('新建单据模板')
  await page.getByPlaceholder('请输入模板名称').fill(OFF_NAME)
  await page.getByPlaceholder('只允许字母、数字、下划线').fill(OFF_CODE)
  expect(await logSwitch(page).evaluate((el) => el.classList.contains('is-checked'))).toBe(false)
  await page.getByRole('button', { name: /保\s*存/ }).first().click()
  await expect(page.getByRole('button', { name: /新建模板/ })).toBeVisible({ timeout: 15_000 })

  const no3 = await occupy(page, OFF_CODE)
  expect(no3).toBeTruthy()

  row = await findRow(page, OFF_CODE)
  await row.getByRole('button', { name: /取号日志/ }).click()
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await expect(page.locator('.el-table__empty-block')).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: `${SHOTS}/bt-06-log-off-empty.png` })
  await page.getByRole('button', { name: /返回/ }).click()

  // ========== F 编辑：页内 + 开关回填 ==========
  row = await findRow(page, ON_CODE)
  await row.getByRole('button', { name: /编辑/ }).click()
  await expect(page.locator('.bt-form-title')).toHaveText('编辑单据模板')
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0)
  expect(await logSwitch(page).evaluate((el) => el.classList.contains('is-checked'))).toBe(true)
  await page.screenshot({ path: `${SHOTS}/bt-07-edit.png` })
  await page.getByRole('button', { name: /取\s*消/ }).first().click()
  await expect(page.getByRole('button', { name: /新建模板/ })).toBeVisible()

  // ========== G 暗黑主题 ==========
  await toggleDark(page, true)
  row = await findRow(page, ON_CODE)
  await row.getByRole('button', { name: /取号日志/ }).click()
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await expect(page.locator('.el-table__row')).toHaveCount(1, { timeout: 10_000 })
  await page.screenshot({ path: `${SHOTS}/bt-08-dark-log.png` })
  await page.getByRole('button', { name: /返回/ }).click()
  row = await findRow(page, ON_CODE)
  await row.getByRole('button', { name: /编辑/ }).click()
  await expect(page.locator('.bt-form-title')).toHaveText('编辑单据模板')
  await page.screenshot({ path: `${SHOTS}/bt-09-dark-form.png` })

  // 走查结束把主题切回浅色，避免把暗黑偏好留在账号上影响后续人工浏览
  await toggleDark(page, false)

  expect(errors, errors.join('\n')).toEqual([])
})
