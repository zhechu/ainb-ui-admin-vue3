import { chromium } from '@playwright/test'

const b = await chromium.launch()
const page = await b.newPage()
await page.goto('http://127.0.0.1:80/login')
const form = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
await form.waitFor({ state: 'visible' })
const tenant = form.getByPlaceholder('请输入租户名称')
if (await tenant.count()) await tenant.fill('xpy')
await form.getByPlaceholder('请输入用户名').fill('admin')
await form.getByPlaceholder('请输入密码').fill('admin123')
await form.getByRole('button', { name: /登\s*录/ }).first().click()
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
await page.waitForLoadState('networkidle')

await page.locator('.v-setting').click()
const drawer = page.locator('.el-drawer:visible')
await drawer.waitFor({ state: 'visible' })
await page.waitForTimeout(1500)

const html = await drawer.evaluate((el) => el.innerHTML.slice(0, 3000))
console.log('=== DRAWER HEAD HTML ===')
console.log(html)

// 打开下拉，检查 popper 的 z-index 与抽屉 z-index
await drawer.locator('.el-select__wrapper').first().click()
await page.waitForTimeout(800)
const info = await page.evaluate(() => {
  const drawerEl = document.querySelector('.el-overlay')?.querySelector('.el-drawer')
  const overlays = [...document.querySelectorAll('.el-overlay')].map((o) => ({
    cls: o.className,
    z: o.style.zIndex
  }))
  const poppers = [...document.querySelectorAll('.el-popper.el-select__popper')].map((p) => ({
    z: p.style.zIndex, computed: getComputedStyle(p).zIndex, cls: p.className,
    display: getComputedStyle(p).display,
    rect: p.getBoundingClientRect().top
  }))
  return { drawerZ: drawerEl ? getComputedStyle(drawerEl).zIndex : null, overlays, poppers }
})
console.log('=== Z-INDEX INFO ===')
console.log(JSON.stringify(info, null, 2))
await page.screenshot({ path: 'tests/e2e/.verify-shots/portal-16-debug-drawer.png' })
await b.close()
