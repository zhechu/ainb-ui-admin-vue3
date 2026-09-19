import { expect, test, type Page } from '@playwright/test'

/** 权限模块几个管理页的体验修复验证 */
async function login(page: Page): Promise<void> {
  await page.goto('/login')
  const form = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
  await form.waitFor({ state: 'visible' })
  const tenant = form.getByPlaceholder('请输入租户名称')
  if (await tenant.count()) await tenant.fill('xpy')
  await form.getByPlaceholder('请输入用户名').fill('admin')
  await form.getByPlaceholder('请输入密码').fill('admin123')
  const p = page.waitForResponse((r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST')
  await form.getByRole('button', { name: /登\s*录/ }).first().click()
  expect((await p).ok()).toBeTruthy()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
}

/** 内容区底部与视口底部的空隙，用来判断「底部一大片空白」 */
async function bottomGap(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.el-card'))
    if (!cards.length) return 9999
    const last = cards[cards.length - 1].getBoundingClientRect()
    return Math.round(window.innerHeight - last.bottom)
  })
}

test.describe('权限模块页面体验', () => {
  test('规则管理：自定义规则不被标成内置且可删除，搜索可用', async ({ page, request }) => {
    await login(page)

    // 通过接口预置一条「用内置模板建的自定义规则」——
    // 这正是用户报的场景。走接口建是为了让用例聚焦在【列表如何呈现它】上，
    // 而不是耗在新增弹窗的控件定位上
    // 直接调登录接口拿 token，不依赖浏览器的存储键（各版本不一致）
    const API = 'http://localhost:48080/admin-api'
    const loginResp = await request.post(`${API}/system/auth/login`, {
      headers: { 'tenant-id': '1' },
      data: { username: 'admin', password: 'admin123' }
    })
    const token = (await loginResp.json()).data.accessToken
    const name = `e2e规则${Date.now()}`
    const created = await request.post(`${API}/system/rule/create`, {
      headers: { Authorization: `Bearer ${token}`, 'tenant-id': '1' },
      data: { name, template: 'BUILT_IN_OWNER_ONLY', status: 0 }
    })
    expect(created.ok(), '预置规则失败').toBeTruthy()

    await page.goto('/system/rule')
    await page.waitForLoadState('networkidle')
    const table = page.locator('.el-table').first()
    await expect(table).toBeVisible({ timeout: 20_000 })

    // 内置种子：标「内置」且删除禁用
    await page.getByPlaceholder('请输入规则名称').fill('仅自己的数据')
    await page.getByRole('button', { name: /搜索/ }).first().click()
    await page.waitForTimeout(800)
    const seed = table.locator('tbody tr').first()
    await expect(seed).toContainText('内置')
    await expect(seed.getByRole('button', { name: '删除' })).toBeDisabled()

    // 自定义规则：虽然用的是内置模板，也必须标「自定义」且可删 —— 用户报的 BUG 就在这
    await page.getByPlaceholder('请输入规则名称').fill(name)
    await page.getByRole('button', { name: /搜索/ }).first().click()
    await page.waitForTimeout(800)
    await expect(table.locator('tbody tr'), '搜索应当只剩这一条').toHaveCount(1)
    const mine = table.locator('tbody tr').first()
    await expect(mine, '用了内置模板的自定义规则被误标成「内置」').toContainText('自定义')
    await expect(
      mine.getByRole('button', { name: '删除' }),
      '自定义规则的删除按钮不该被禁用'
    ).toBeEnabled()

    // 真的能删掉
    await mine.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确 定/ }).click()
    await expect(page.getByText('删除成功')).toBeVisible({ timeout: 15_000 })
  })

  test('权限诊断：权限标识与用户都可下拉选择', async ({ page }) => {
    await login(page)
    await page.goto('/system/permission-diag')
    await page.waitForLoadState('networkidle')

    // ⚠️ el-select 的 placeholder 渲染成 span，不是 input 属性，getByPlaceholder 定位不到。
    // 按表单项结构定位：第 1 个 select 是权限标识，第 3 个是用户（中间是动作）
    const form = page.locator('.el-form').first()
    const selects = form.locator('.el-select')
    await expect(selects.first()).toBeVisible({ timeout: 20_000 })
    expect(await selects.count(), '表单里应当有 3 个下拉：权限标识/动作/用户').toBeGreaterThanOrEqual(3)

    // 权限标识：可搜索下拉
    await selects.nth(0).click()
    await selects.nth(0).locator('input').first().fill('system:user:query')
    await page.waitForTimeout(1000)
    await page.locator('.el-select-dropdown__item:visible').filter({ hasText: 'system:user:query' }).first().click()

    // 用户：可选择，不用再手填 id
    await selects.nth(2).click()
    await page.waitForTimeout(800)
    const firstUser = page.locator('.el-select-dropdown__item:visible').first()
    await expect(firstUser).toBeVisible({ timeout: 10_000 })
    await firstUser.click()

    // 页面标题也叫「权限诊断」，会和按钮同名，限定在表单内
    await form.getByRole('button', { name: /诊断/ }).first().click()
    await page.waitForTimeout(1500)
    // 诊断出结果（不关心允许还是拒绝，只要不报错）
    await expect(page.locator('.el-card').first()).toBeVisible()
  })

  test('底部空白：列表页在「内容多」和「内容少」两种状态下都撑满', async ({ page }) => {
    await login(page)

    for (const [path, label, searchSel, kw] of [
      ['/system/resource', '权限资源', '支持模糊搜索，如 system:user', 'system:user:query'],
      ['/system/rule', '规则管理', '请输入规则名称', '仅自己的数据']
    ] as const) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1200)
      const before = await bottomGap(page)
      expect(before, `${label}（默认）底部空白 ${before}px`).toBeLessThan(160)

      // ⚠️ 关键场景：搜索后行数骤减。
      // 表格若用 max-height，内容少时高度会塌成内容高度、卡片跟着缩，
      // 底部空出一大片（实测曾是 275px）——这正是用户反馈的现象
      await page.getByPlaceholder(searchSel).fill(kw)
      const searchBtn = page.getByRole('button', { name: /搜索/ })
      if (await searchBtn.count()) await searchBtn.first().click()
      await page.waitForTimeout(1500)
      const after = await bottomGap(page)
      expect(after, `${label}（搜索后仅少量行）底部空白 ${after}px，表格高度塌了`).toBeLessThan(160)
    }

    // 诊断页：未诊断时本就无内容，不做撑满，但要有引导而不是纯空白
    await page.goto('/system/permission-diag')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/这个人为什么有/)).toBeVisible({ timeout: 15_000 })
  })
})
