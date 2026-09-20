// 一次性验证：项目配置「首页门户」下拉选中后回显名称而非 code
import { chromium } from '@playwright/test'

const BASE = 'http://127.0.0.1:80'
const SHOTS = 'tests/e2e/.verify-shots'

const log = (...args) => console.log(...args)
const assert = (ok, msg) => {
  if (!ok) {
    console.error('FAIL:', msg)
    process.exitCode = 1
    throw new Error(msg)
  }
  log('PASS:', msg)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
try {
  // 登录
  await page.goto(`${BASE}/login`)
  const form = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
  await form.waitFor({ state: 'visible' })
  const tenant = form.getByPlaceholder('请输入租户名称')
  if (await tenant.count()) await tenant.fill('xpy')
  await form.getByPlaceholder('请输入用户名').fill('admin')
  await form.getByPlaceholder('请输入密码').fill('admin123')
  await form.getByRole('button', { name: /登\s*录/ }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 })

  const openDrawer = async () => {
    await page.locator('.v-setting').click()
    const drawer = page.locator('.el-drawer:visible')
    await drawer.waitFor({ state: 'visible' })
    await drawer.getByText('首页门户').waitFor({ state: 'visible', timeout: 10000 })
    return drawer
  }
  const selectDisplayText = (drawer) =>
    drawer.locator('.el-select').first().locator('.el-select__selection').innerText()

  // 当前持久化值可能已是某门户：先断言回显是名称而非 code，再切换到「常规门户」验证变化链路
  let drawer = await openDrawer()
  let text = (await selectDisplayText(drawer)).trim()
  log('初始回显:', JSON.stringify(text))
  assert(!/^[a-z_]+$/i.test(text) || text === '默认门户', `初始回显不是裸 code（实际：${text}）`)

  await drawer.locator('.el-select').first().locator('.el-select__wrapper').click()
  const dropdown = page.locator('.el-select-dropdown:visible')
  await dropdown.waitFor({ state: 'visible' })
  log('下拉项:', JSON.stringify(await dropdown.locator('.el-select-dropdown__item').allTextContents()))
  const save = page.waitForResponse(
    (r) => r.url().includes('/system/user/profile/theme') && r.request().method() === 'PUT',
    { timeout: 8000 }
  )
  await dropdown.locator('.el-select-dropdown__item').filter({ hasText: '常规门户' }).first().click()
  const saveResp = await save.catch(() => null)
  assert(saveResp && saveResp.ok(), '切换门户触发 PUT theme')
  await page.waitForTimeout(300)
  text = (await selectDisplayText(drawer)).trim()
  assert(text.includes('常规门户') && !text.includes('daily'), `选中后回显名称（实际：${text}）`)
  await page.screenshot({ path: `${SHOTS}/portal-sort-04-select-label.png` })
  await drawer.locator('.el-drawer__close-btn').click().catch(() => {})

  // 刷新后回显（懒加载完成后）
  await page.goto(`${BASE}/index`)
  await page.waitForLoadState('networkidle')
  drawer = await openDrawer()
  // 等下拉数据加载完成（选中项能匹配到 option 后才回显 label）
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.el-drawer .el-select .el-select__selection')
      return el && el.textContent.includes('常规门户')
    },
    null,
    { timeout: 10000 }
  )
  text = (await selectDisplayText(drawer)).trim()
  assert(text.includes('常规门户') && !text.includes('daily'), `刷新后回显名称（实际：${text}）`)

  // 复位为默认门户
  await drawer.locator('.el-select').first().locator('.el-select__wrapper').click()
  const dd2 = page.locator('.el-select-dropdown:visible')
  await dd2.waitFor({ state: 'visible' })
  await dd2.locator('.el-select-dropdown__item').filter({ hasText: '默认门户' }).first().click()
  await page.waitForTimeout(600)
  await drawer.locator('.el-drawer__close-btn').click().catch(() => {})
  log('DONE: 已复位为默认门户')
} finally {
  await browser.close()
}
