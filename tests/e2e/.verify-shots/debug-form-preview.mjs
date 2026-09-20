import { chromium } from '@playwright/test'

const b = await chromium.launch()
const page = await b.newPage()
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300))
})
page.on('response', async (r) => { if (r.url().includes('form-design/get-version')) { const t = await r.text().catch(() => ''); console.log('[resp]', r.status(), r.url().slice(-60), t.slice(0, 300)) } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 500)))
await page.goto('http://127.0.0.1:80/login')
const form = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
await form.waitFor({ state: 'visible' })
const tenant = form.getByPlaceholder('请输入租户名称')
if (await tenant.count()) await tenant.fill('xpy')
await form.getByPlaceholder('请输入用户名').fill('admin')
await form.getByPlaceholder('请输入密码').fill('admin123')
await form.getByRole('button', { name: /登\s*录/ }).first().click()
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })

await page.goto('http://127.0.0.1:80/infra/online/list')
await page.waitForLoadState('networkidle')
await page.getByPlaceholder('请输入表单名称').fill('控件总览示例')
await page.getByRole('button', { name: /搜\s*索/ }).first().click()
const row = page.locator('.el-table__row').filter({ hasText: '控件总览示例' }).first()
await row.waitFor({ state: 'visible', timeout: 15_000 })
await row.getByRole('button', { name: /版\s*本/ }).click()
const drawer = page.locator('.el-drawer:visible')
await drawer.waitFor({ state: 'visible' })
const current = drawer.locator('.el-card').filter({ hasText: '当前线上' }).first()
await current.waitFor({ state: 'visible', timeout: 10_000 })
await current.getByRole('button', { name: /预\s*览/ }).click()
await page.waitForTimeout(2500)
console.log('=== MSG@2.5s ===', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.el-message')].map((m) => m.textContent))))
await page.waitForTimeout(3500)
const dialogs = await page.evaluate(() =>
  [...document.querySelectorAll('.el-dialog')].map((d) => ({
    visible: getComputedStyle(d).display !== 'none' && d.getBoundingClientRect().width > 0,
    title: d.querySelector('.el-dialog__title')?.textContent,
    bodyHtml: d.querySelector('.el-dialog__body')?.innerHTML.slice(0, 400)
  }))
)
console.log('=== DIALOGS ===')
console.log(JSON.stringify(dialogs, null, 2))
const msgs = await page.evaluate(() =>
  [...document.querySelectorAll('.el-message')].map((m) => m.textContent)
)
console.log('=== MESSAGES ===', JSON.stringify(msgs))
await page.screenshot({ path: 'tests/e2e/.verify-shots/portal-17-debug-form-preview.png' })
await b.close()
