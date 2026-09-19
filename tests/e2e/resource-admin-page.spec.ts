import { expect, test, type Page } from '@playwright/test'

/**
 * 「权限资源」页面可达性验证
 *
 * 这个页面此前是孤儿：ResourceDetailPanel.vue 存在且功能不少（授权列表/槽位映射/
 * 字段权限/子资源四个页签），但没有列表页、没有菜单指向它，谁也进不去。
 * 而 ResourceAdminController 的注释还写着「字段权限入口在资源详情页」——
 * 描述了一个不存在的入口。本用例守住它确实能打开
 */
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

test.describe('权限资源页', () => {
  test('页面可打开，能按权限标识搜索并进入资源详情', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))

    await login(page)
    await page.goto('/system/resource')
    await page.waitForLoadState('networkidle')

    // 列表渲染出来（而不是白屏/404）
    const table = page.locator('.el-table').first()
    await expect(table).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/共 \d+ 个资源/)).toBeVisible({ timeout: 15_000 })

    // 按权限标识搜索
    await page.getByPlaceholder('支持模糊搜索，如 system:user').fill('system:user')
    await page.getByRole('button', { name: /搜索/ }).click()
    await page.waitForTimeout(800)
    await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })

    // 勾上「包含列/字段级资源」，再按字段资源的权限串搜索。
    // ⚠️ 必须走搜索：默认视图是懒加载的，只有根节点，字段资源藏在 system:user 下面
    await page.locator('.el-checkbox__label').filter({ hasText: '包含列 / 字段级资源' }).click({ force: true })
    await page.waitForTimeout(1000)
    await page.getByPlaceholder('支持模糊搜索，如 system:user').fill('system:user:fld:mobile')
    await page.getByRole('button', { name: /搜索/ }).click()
    await page.waitForTimeout(1500)
    const fldRow = table.locator('tbody tr').filter({ hasText: 'system:user:fld:mobile' }).first()
    await expect(fldRow).toBeVisible({ timeout: 15_000 })

    // 点进详情，资源详情面板应当打开
    await fldRow.getByRole('button', { name: '详情' }).click()
    await expect(page.getByText('字段权限').first()).toBeVisible({ timeout: 15_000 })

    expect(errors, `页面抛了 JS 异常：${errors.join(' | ')}`).toHaveLength(0)
  })

  test('懒加载：首屏只渲染根节点，展开时才拉子节点', async ({ page }) => {
    await login(page)
    const childReqs: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/system/resource/list-children')) childReqs.push(r.url())
    })

    await page.goto('/system/resource')
    await page.waitForLoadState('networkidle')
    const table = page.locator('.el-table').first()
    await expect(table).toBeVisible({ timeout: 20_000 })

    // ⚠️ 这里统计的是 DOM 行数而不是「可见」行数：
    // el-table 树形会把全部节点渲染进 tbody，折叠只是 CSS 隐藏 ——
    // 所以「折叠」并不能降低渲染量，只有 lazy 才能。全库 650+，首屏应当只有根节点级别
    const first = await table.locator('tbody tr').count()
    expect(first, `首屏渲染 ${first} 行，懒加载没生效`).toBeLessThan(200)

    // 首屏应当发过一次 parentId=0 的请求
    expect(childReqs.some((u) => /parentId=0/.test(u))).toBeTruthy()

    // 展开第一个可展开的行 → 触发子节点请求，行数增加
    const before = childReqs.length
    await table.locator('.el-table__expand-icon').first().click()
    await page.waitForTimeout(1500)
    expect(childReqs.length, '展开时没有请求子节点').toBeGreaterThan(before)
    expect(await table.locator('tbody tr').count()).toBeGreaterThan(first)
  })

  test('可新增自定义资源，重复权限标识被拒并给出可读提示', async ({ page }) => {
    await login(page)
    await page.goto('/system/resource')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 20_000 })

    const perm = `demo:e2e:res${Date.now()}`
    // 新增
    await page.getByRole('button', { name: /新增/ }).first().click()
    const dlg = page.locator('.el-dialog').filter({ hasText: '新增资源' })
    await expect(dlg).toBeVisible({ timeout: 10_000 })
    await dlg.getByPlaceholder('如 system:user:query').fill(perm)
    await dlg.getByPlaceholder('如 用户查询').fill('E2E 测试资源')
    await dlg.getByRole('button', { name: /确 定/ }).click()
    await expect(dlg).toBeHidden({ timeout: 15_000 })

    // 再建一次同权限标识 → 必须被拒，且提示可读（不是「系统异常」）
    await page.getByRole('button', { name: /新增/ }).first().click()
    const dlg2 = page.locator('.el-dialog').filter({ hasText: '新增资源' })
    await dlg2.getByPlaceholder('如 system:user:query').fill(perm)
    await dlg2.getByPlaceholder('如 用户查询').fill('重复')
    await dlg2.getByRole('button', { name: /确 定/ }).click()
    await expect(page.getByText(/权限标识.*已存在/)).toBeVisible({ timeout: 15_000 })
    await dlg2.getByRole('button', { name: /取 消/ }).click()

    // 清理：删掉刚建的
    await page.getByPlaceholder('支持模糊搜索，如 system:user').fill(perm)
    await page.getByRole('button', { name: /搜索/ }).click()
    await page.waitForTimeout(1000)
    const row = page.locator('.el-table tbody tr').filter({ hasText: perm }).first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确 定/ }).click()
    await expect(page.getByText('删除成功')).toBeVisible({ timeout: 15_000 })
  })
})
