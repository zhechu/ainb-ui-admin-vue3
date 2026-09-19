import { expect, test, type Page } from '@playwright/test'

/**
 * 一次性走查脚本：数据接口新建页五项优化
 *  1) 表结构面板无「表结构」标题行；表名命中时保留显示其下字段
 *  2) 搜索只在回车 / 点查询按钮时发起（逐字输入不过滤）
 *  3) 数据源控件隐藏
 *  4) 动作类型提示语与单选同行
 *  5) 分页开启后 COUNT SQL 编辑器可正常填写
 * 截图输出到 tests/e2e/.verify-shots/opt5-*.png
 */

const SHOTS = 'tests/e2e/.verify-shots'

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

test('数据接口新建页五项优化走查', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  await toggleDark(page, false)

  await page.goto('/infra/data-manage/data-interface')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /新建/ }).first().click()
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15_000 })

  // 表结构面板容器（含搜索框的那一列）
  const panel = page
    .locator('div.w-280px')
    .filter({ has: page.getByPlaceholder('搜索表名 / 字段 / 说明') })
  await expect(panel).toBeVisible({ timeout: 15_000 })

  // ========== 1a) 无「表结构」标题行 ==========
  expect(await panel.getByText('表结构', { exact: true }).count()).toBe(0)
  // 搜索行：输入框 + 查询按钮 + 刷新按钮
  const searchInput = panel.getByPlaceholder('搜索表名 / 字段 / 说明')
  await expect(searchInput).toBeVisible()
  expect(await panel.locator('.el-button').count()).toBeGreaterThanOrEqual(2)

  // ========== 3) 数据源控件隐藏 ==========
  expect(
    await page.locator('.el-form-item__label', { hasText: '数据源' }).count()
  ).toBe(0)

  // ========== 4) 动作类型提示语与单选同行 ==========
  const radioBox = await page.locator('.el-radio-group').first().boundingBox()
  const tipSpan = page
    .locator('span')
    .filter({ hasText: '一个接口可写多条 SQL，请按实际意图选择动作类型' })
    .last()
  const tipBox = await tipSpan.boundingBox()
  expect(radioBox).toBeTruthy()
  expect(tipBox).toBeTruthy()
  // 同一行：提示语顶边落在单选组高度范围内（允许少量偏差）
  expect(Math.abs(tipBox!.y - radioBox!.y)).toBeLessThan(radioBox!.height)

  // ========== 2) 逐字输入不发起搜索 ==========
  const countLine = panel.locator('div.shrink-0', { hasText: /共|命中/ }).last()
  await expect(countLine).toContainText(/共 \d+ 张表/)
  const visibleTreeNodes = () => panel.locator('.el-tree-node:visible').count()
  const nodesBefore = await visibleTreeNodes()
  await searchInput.fill('act_evt')
  await page.waitForTimeout(600)
  // 未回车：树不过滤、计数行不变、无高亮
  await expect(countLine).toContainText(/共 \d+ 张表/)
  expect(await visibleTreeNodes()).toBe(nodesBefore)
  const highlighted = () =>
    panel
      .locator('.el-tree-node span')
      .evaluateAll((els) =>
        els.some((el) => {
          const bg = getComputedStyle(el).backgroundColor
          return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
        })
      )
  expect(await highlighted()).toBe(false)

  // 回车后才搜索
  await searchInput.press('Enter')
  await page.waitForTimeout(600)
  await expect(countLine).toContainText(/命中 \d+ 表 \/ \d+ 字段/)
  expect(await visibleTreeNodes()).toBeLessThan(nodesBefore)
  expect(await highlighted()).toBe(true)

  // ========== 1b) 表名命中 → 保留显示其下字段 ==========
  // act_evt 命中 act_evt_log 表名，其字段应展开可见
  const expanded = panel.locator('.el-tree-node.is-expanded')
  expect(await expanded.count()).toBeGreaterThan(0)
  expect(await visibleTreeNodes()).toBeGreaterThan(1) // 表 + 若干字段
  await page.screenshot({ path: `${SHOTS}/opt5-01-table-hit-keeps-columns.png` })

  // 点查询按钮也能发起（输入后不回车，直接点按钮）
  await searchInput.fill('')
  await searchInput.press('Enter')
  await expect(countLine).toContainText(/共 \d+ 张表/)
  await searchInput.fill('bytearray')
  const searchBtn = panel.locator('.el-button').first()
  await searchBtn.click()
  await page.waitForTimeout(600)
  await expect(countLine).toContainText(/命中 \d+ 表 \/ \d+ 字段/)

  // 🔍 空态：搜不存在的关键字 → 空态 + 清空搜索恢复全量
  await searchInput.fill('zzz_not_exist_anywhere')
  await searchBtn.click()
  await page.waitForTimeout(600)
  await expect(panel.getByText('无匹配的表或字段')).toBeVisible()
  await panel.getByRole('button', { name: /清空搜索/ }).click()
  await page.waitForTimeout(400)
  await expect(countLine).toContainText(/共 \d+ 张表/)

  // ========== 5) 分页开启后 COUNT SQL 可填写 ==========
  const pageItem = page
    .locator('.el-form-item')
    .filter({ has: page.locator('.el-form-item__label', { hasText: '是否分页' }) })
  await pageItem.locator('.el-switch').click()
  await page.waitForTimeout(1_000)
  const countItem = page
    .locator('.el-form-item')
    .filter({ has: page.locator('.el-form-item__label', { hasText: 'COUNT SQL' }) })
    .last() // 外层「配置」form-item 也包含该 label，取最内层
  const countEditor = countItem.locator('.monaco-editor')
  await expect(countEditor).toBeVisible()
  const countBox = await countEditor.boundingBox()
  expect(countBox!.width).toBeGreaterThan(500)
  // 主编辑器仍可输入
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.insertText('SELECT 1 FROM dual')
  await page.waitForTimeout(300)
  // COUNT SQL 可输入
  await countEditor.click()
  await page.keyboard.insertText('SELECT COUNT(*) FROM dual')
  await page.waitForTimeout(300)
  const countText = (await countEditor.locator('.view-lines').innerText()).replace(/\u00a0/g, ' ')
  expect(countText).toContain('SELECT COUNT(*)')
  await page.screenshot({ path: `${SHOTS}/opt5-02-count-sql-editable.png`, fullPage: true })

  // ========== 暗黑主题 ==========
  await toggleDark(page, true)
  await page.screenshot({ path: `${SHOTS}/opt5-03-dark.png`, fullPage: true })

  expect(errors).toEqual([])
})
