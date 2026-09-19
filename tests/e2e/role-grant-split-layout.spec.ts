import { expect, test, type Page } from '@playwright/test'

/**
 * 角色管理「资源授权」左右分栏的端到端验证
 *
 * 守的是两件在单测里看不出来的事：
 *  1. 面板是 props 驱动的，左边换角色右边必须跟着换 —— 原来是 open() 命令式调用，
 *     改成 watch 之后如果 immediate 触发早于 closeRowForm 定义，面板会直接白屏
 *  2. 新增授权的表单是内联展开，不再是第二层弹窗
 */

async function login(page: Page): Promise<void> {
  await page.goto('/login')
  // 登录页里有 5 个 form.login-form（登录/短信/注册/授权/重置密码），
  // 同一时刻只有一个可见，必须筛出可见的那个，否则 strict mode 直接报错
  const form = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
  await form.waitFor({ state: 'visible' })
  // 按 placeholder 定位，不要按 input 下标 ——
  // 表单里还有「记住我」的 checkbox input，下标法会把密码填到 checkbox 上
  const tenant = form.getByPlaceholder('请输入租户名称')
  if (await tenant.count()) await tenant.fill('xpy')
  await form.getByPlaceholder('请输入用户名').fill('admin')
  await form.getByPlaceholder('请输入密码').fill('admin123')
  const loginPromise = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.getByRole('button', { name: /登\s*录/ }).first().click()
  expect((await loginPromise).ok()).toBeTruthy()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
}

test.describe('角色管理 · 资源授权分栏', () => {
  test('左侧选角色，右侧面板跟着切换，且没有第二层弹窗', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await login(page)
    await page.goto('/system/role')
    await page.waitForLoadState('networkidle')

    // 左侧角色列表
    const roleRows = page.locator('.el-table__row')
    await expect(roleRows.first()).toBeVisible({ timeout: 20_000 })
    expect(await roleRows.count()).toBeGreaterThan(1)

    // 初始应是空态提示，而不是白屏
    await expect(page.getByText('从左侧选择一个角色')).toBeVisible()

    // 点第一个角色 → 右侧加载它的授权
    const firstGrantResp = page.waitForResponse(
      (r) => r.url().includes('/system/grant/list-by-subject'), { timeout: 20_000 }
    )
    await roleRows.first().locator('td').nth(1).click()
    expect((await firstGrantResp).ok()).toBeTruthy()
    await expect(page.getByText('已配置')).toBeVisible({ timeout: 15_000 })

    // 切到第二个角色 → 必须重新请求（props 驱动生效）
    const secondGrantResp = page.waitForResponse(
      (r) => r.url().includes('/system/grant/list-by-subject'), { timeout: 20_000 }
    )
    await roleRows.nth(1).locator('td').nth(1).click()
    expect((await secondGrantResp).ok()).toBeTruthy()

    // 新增授权是内联展开，不是弹窗：点开后页面上不应出现第二个 dialog
    const dialogsBefore = await page.locator('.el-overlay-dialog').count()
    await page.getByRole('button', { name: /新增授权/ }).click()
    await expect(page.getByText('未绑定行过滤规则')).toBeVisible({ timeout: 10_000 })
    const dialogsAfter = await page.locator('.el-overlay-dialog').count()
    expect(dialogsAfter).toBe(dialogsBefore)

    // 不选资源直接提交，必须被校验拦住（原来 resourceId 初值是 0，能蒙混过关）
    await page.getByRole('button', { name: /^确 定$/ }).click()
    await expect(page.getByText('请选择资源')).toBeVisible({ timeout: 10_000 })

    expect(pageErrors, `页面抛了 JS 异常：${pageErrors.join(' | ')}`).toHaveLength(0)
  })

  test('授权列表可按关键字与动作筛选，切角色时筛选条件重置', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await login(page)
    await page.goto('/system/role')
    await page.waitForLoadState('networkidle')

    const roleRows = page.locator('.el-table__row')
    await expect(roleRows.first()).toBeVisible({ timeout: 20_000 })

    // 选中第一个有授权的角色
    await roleRows.first().locator('td').nth(1).click()
    await expect(page.getByText(/已配置\s*\d+\s*条/)).toBeVisible({ timeout: 15_000 })

    const search = page.getByPlaceholder('搜索资源名称 / 权限标识 / 规则名')
    await expect(search).toBeVisible()

    // 搜一个几乎必然不存在的串 → 应出现「没有符合条件的授权」
    await search.fill('zzz_not_exist_zzz')
    await expect(page.getByText('没有符合条件的授权')).toBeVisible({ timeout: 10_000 })
    // 计数要显示筛选结果
    await expect(page.getByText(/筛出\s*0\s*条/)).toBeVisible()

    // 重置后恢复。⚠️ 页面顶部的角色搜索栏也有一个「重置」，
    // 直接按名字取会命中两个，必须限定在授权面板内（那个是 link 型小按钮）
    await page.locator('.grant-assign-panel').getByRole('button', { name: '重置' }).click()
    await expect(page.getByText('没有符合条件的授权')).toBeHidden({ timeout: 10_000 })

    // 再次输入后切换角色，筛选条件应被清掉（否则会误以为新角色没有授权）
    await search.fill('zzz_not_exist_zzz')
    await expect(page.getByText('没有符合条件的授权')).toBeVisible({ timeout: 10_000 })
    await roleRows.nth(1).locator('td').nth(1).click()
    await expect(search).toHaveValue('', { timeout: 10_000 })

    expect(pageErrors, `页面抛了 JS 异常：${pageErrors.join(' | ')}`).toHaveLength(0)
  })

  test('资源选择器可通过开关找到字段级资源（system:user:fld:mobile）', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))

    await login(page)
    await page.goto('/system/role')
    await page.waitForLoadState('networkidle')

    const roleRows = page.locator('.el-table__row')
    await expect(roleRows.first()).toBeVisible({ timeout: 20_000 })
    await roleRows.first().locator('td').nth(1).click()
    await expect(page.getByText(/已配置\s*\d+\s*条/)).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /新增授权/ }).click()
    // 先等表单真正渲染出来再找里面的控件
    await expect(page.getByText('未绑定行过滤规则')).toBeVisible({ timeout: 15_000 })

    // ⚠️ 不能用 getByPlaceholder 定位 el-select：Element Plus 把 placeholder 渲染成
    // 一个 span，不是 input 的 placeholder 属性（查询区那个是真 el-input，所以能用）。
    // 这里按表单结构定位——卡片里第一个 el-select 就是资源选择器
    const formCard = page.locator('.grant-assign-panel .el-card')
    const resourceSelect = formCard.locator('.el-select').first()
    await expect(resourceSelect).toBeVisible({ timeout: 15_000 })
    await resourceSelect.click()
    const searchInput = resourceSelect.locator('input').first()

    // 默认不含字段级资源：搜 fld 搜不到
    await searchInput.fill('system:user:fld:mobile')
    await page.waitForTimeout(500)
    await expect(page.locator('.el-tree-node').filter({ hasText: 'mobile' })).toHaveCount(0)

    // 开关就在下拉浮层顶部，不用先收起浮层再去别处找 —— 这正是把它放进 #header 的目的。
    // ⚠️ el-checkbox 真正的 <input> 是 opacity:0 的，check() 会判定为不可见，
    // 点 .el-checkbox__label 才是用户实际的点击目标
    const dropdown = page.locator('.el-select-dropdown').filter({ hasText: '显示字段级资源' })
    await expect(dropdown).toBeVisible({ timeout: 10_000 })
    await dropdown.locator('.el-checkbox__label').first().click({ force: true })
    await expect(dropdown.locator('.el-checkbox.is-checked')).toHaveCount(1, { timeout: 5_000 })
    await page.waitForTimeout(1200)
    await searchInput.fill('mobile')
    await page.waitForTimeout(800)
    await expect(
      page.locator('.el-tree-node').filter({ hasText: 'mobile' }).first()
    ).toBeVisible({ timeout: 10_000 })

    expect(errors, `页面抛了 JS 异常：${errors.join(' | ')}`).toHaveLength(0)
  })
})
