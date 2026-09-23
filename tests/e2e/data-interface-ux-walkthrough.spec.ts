import { expect, test, type Page } from '@playwright/test'

/**
 * 一次性走查脚本：数据接口体验优化三项
 *  1) SQL 配置区编辑器与表结构框等高、搜索框固定不随滚动
 *  2) 表结构搜索：高亮 / 命中计数 / 自动展开 / 空态
 *  3) 版本页「预览」→ 只读表单（与新建/配置同布局）→ 返回回版本列表
 * 截图输出到 tests/e2e/.verify-shots/ux-*.png
 */

const SHOTS = 'tests/e2e/.verify-shots'
const IFACE_NAME = '走查UX接口'
let IFACE_CODE = ''

test.use({ viewport: { width: 1440, height: 1400 }, actionTimeout: 15_000 })

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

async function findRow(page: Page) {
  await page.goto('/infra/data-manage/data-interface')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('请输入接口编码').fill(IFACE_CODE)
  await page.getByRole('button', { name: /搜索/ }).first().click()
  const row = page.locator('.el-table__row').filter({ hasText: IFACE_NAME }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  return row
}

async function setSql(page: Page, sql: string) {
  const editor = page.locator('.monaco-editor').first()
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(sql)
  await page.waitForTimeout(300)
}

test('数据接口体验优化走查', async ({ page }) => {
  test.setTimeout(420_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  IFACE_CODE = `walk_ux_${Date.now()}`
  await login(page)
  await toggleDark(page, false)

  // ========== 打开新建表单（SQL 类型，默认主数据源 → 表结构面板会加载） ==========
  await page.goto('/infra/data-manage/data-interface')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /新建接口/ }).click()
  await expect(page.getByText('新建数据接口')).toBeVisible()

  const panel = page.locator('.w-280px').first()
  await expect(panel).toBeVisible({ timeout: 15_000 })
  // 等表结构树加载出节点
  await expect(panel.locator('.el-tree-node').first()).toBeVisible({ timeout: 25_000 })

  // ---------- 需求一：等高布局 ----------
  const edBox = await page.locator('.code-editor').first().boundingBox()
  const pnBox = await panel.boundingBox()
  expect(edBox, 'editor box').toBeTruthy()
  expect(pnBox, 'panel box').toBeTruthy()
  // 两框高度一致（同一行 items-stretch），且落在 320 附近
  expect(Math.abs(edBox!.height - pnBox!.height)).toBeLessThanOrEqual(3)
  expect(edBox!.height).toBeGreaterThan(280)
  expect(edBox!.height).toBeLessThan(360)
  await page.screenshot({ path: `${SHOTS}/ux-01-layout.png` })

  // ---------- 需求一：搜索框固定在滚动区之外 ----------
  // 结构上：滚动容器内不应有任何 input（搜索框已移出）
  expect(await panel.locator('.el-scrollbar input').count()).toBe(0)
  const searchInput = panel.locator('input').first()
  await expect(searchInput).toBeVisible()
  // 行为上：滚动树后搜索框位置不动
  const beforeBox = await searchInput.boundingBox()
  await panel
    .locator('.el-scrollbar__wrap')
    .first()
    .evaluate((el) => {
      el.scrollTop = 300
    })
  await page.waitForTimeout(200)
  const afterBox = await searchInput.boundingBox()
  expect(Math.abs(beforeBox!.y - afterBox!.y)).toBeLessThan(2)

  // ---------- 需求二：搜索高亮 / 计数 / 自动展开 ----------
  await searchInput.fill('user')
  // ⚠️ 搜索是显式触发的：只填值不会过滤。组件里写明「回车 / 点查询按钮才真正发起搜索：
  // 215 张表逐字过滤既卡又没必要」。这里必须按回车，否则 activeKeyword 为空、计数不渲染。
  await searchInput.press('Enter')
  await page.waitForTimeout(600)
  await expect(panel.getByText(/命中\s*\d+\s*表\s*\/\s*\d+\s*字段/)).toBeVisible()
  // 自动展开命中项所在表
  expect(await panel.locator('.el-tree-node.is-expanded').count()).toBeGreaterThan(0)
  // 高亮：树里出现带非透明背景的片段 span
  const hasHighlight = await panel.locator('.el-tree').evaluate((tree) =>
    Array.from(tree.querySelectorAll('span')).some((s) => {
      const bg = getComputedStyle(s).backgroundColor
      return !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
    })
  )
  expect(hasHighlight, '应有高亮命中片段').toBeTruthy()
  await page.screenshot({ path: `${SHOTS}/ux-02-search.png` })

  // ---------- 需求二：空态 + 清空 ----------
  await searchInput.fill('zzqqxx_not_exist_zz')
  await searchInput.press('Enter') // 同上：显式触发才会过滤
  await page.waitForTimeout(500)
  await expect(panel.getByText('无匹配的表或字段')).toBeVisible()
  const clearBtn = panel.getByRole('button', { name: '清空搜索' })
  await expect(clearBtn).toBeVisible()
  await clearBtn.click()
  await page.waitForTimeout(300)
  await expect(searchInput).toHaveValue('')
  await expect(panel.getByText(/共\s*\d+\s*张表/)).toBeVisible()

  // ---------- 填写并保存 ----------
  await setSql(page, 'SELECT 1 AS ok')
  await page
    .locator('.el-form-item')
    .filter({ hasText: '接口名称' })
    .first()
    .locator('input')
    .fill(IFACE_NAME)
  await page
    .locator('.el-form-item')
    .filter({ hasText: '接口编码' })
    .first()
    .locator('input')
    .fill(IFACE_CODE)
  await page.getByRole('button', { name: /保\s*存/ }).first().click()
  await expect(page.getByRole('button', { name: /新建接口/ })).toBeVisible({ timeout: 20_000 })

  // ---------- 编辑一次以产生版本 ----------
  let row = await findRow(page)
  await row.getByRole('button', { name: '配置' }).click()
  await expect(page.getByText('配置数据接口')).toBeVisible()
  await page
    .locator('.el-form-item')
    .filter({ hasText: '变更说明' })
    .first()
    .locator('input')
    .fill('走查UX首次修改')
  await page.getByRole('button', { name: /保\s*存/ }).first().click()
  await expect(page.getByRole('button', { name: /新建接口/ })).toBeVisible({ timeout: 20_000 })

  // ========== 需求三：版本页「预览」→ 只读表单 ==========
  row = await findRow(page)
  await row.getByRole('button', { name: '版本' }).click()
  await expect(page.getByText(`版本历史 - ${IFACE_NAME}`)).toBeVisible()
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0)
  const vRow = page.locator('.el-table__row').first()
  await expect(vRow).toBeVisible({ timeout: 15_000 })
  await expect(vRow.getByRole('button', { name: '预览' })).toBeVisible()
  await vRow.getByRole('button', { name: '预览' }).click()

  // 进入与新建/配置同布局的只读表单
  await expect(page.getByText(/版本预览/)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.el-dialog:visible')).toHaveCount(0)
  await expect(page.locator('.el-tag').filter({ hasText: '只读' }).first()).toBeVisible()
  // 没有保存按钮
  await expect(page.getByRole('button', { name: /保\s*存/ })).toHaveCount(0)
  // 表单禁用：接口名称输入框 disabled
  const nameInput = page
    .locator('.el-form-item')
    .filter({ hasText: '接口名称' })
    .first()
    .locator('input')
  await expect(nameInput).toBeDisabled()
  // 只读 Monaco 展示快照里的 SQL
  await expect(page.locator('.view-lines').first()).toContainText('SELECT 1', { timeout: 12_000 })
  await page.screenshot({ path: `${SHOTS}/ux-03-version-preview.png` })

  // 返回 → 回到版本列表（而非主列表）
  await page.getByRole('button', { name: /返\s*回/ }).click()
  await expect(page.getByText(`版本历史 - ${IFACE_NAME}`)).toBeVisible({ timeout: 15_000 })

  // ========== 暗黑主题：配置表单 + 表结构搜索可读 ==========
  await page.getByRole('button', { name: /返\s*回/ }).click()
  await page.waitForLoadState('networkidle')
  await toggleDark(page, true)
  row = await findRow(page)
  await row.getByRole('button', { name: '配置' }).click()
  await expect(page.locator('.monaco-editor.vs-dark').first()).toBeVisible({ timeout: 15_000 })
  const darkPanel = page.locator('.w-280px').first()
  await expect(darkPanel.locator('.el-tree-node').first()).toBeVisible({ timeout: 20_000 })
  await darkPanel.locator('input').first().fill('user')
  await page.waitForTimeout(600)
  // 暗黑下高亮背景不应是浅色硬编码（#fdf6ec = rgb(253,246,236)）
  const darkHighlightBg = await darkPanel.locator('.el-tree').evaluate((tree) => {
    const spans = Array.from(tree.querySelectorAll('span'))
    for (const s of spans) {
      const bg = getComputedStyle(s).backgroundColor
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
    }
    return ''
  })
  expect(darkHighlightBg).not.toBe('rgb(253, 246, 236)')
  await page.screenshot({ path: `${SHOTS}/ux-04-dark.png` })
  await page.getByRole('button', { name: /取\s*消/ }).first().click()
  await toggleDark(page, false)

  // ========== 清理临时接口 ==========
  row = await findRow(page)
  await row.getByRole('button', { name: '删除' }).click()
  const box = page.locator('.el-message-box:visible')
  await expect(box).toBeVisible()
  await box.getByRole('button', { name: /确\s*定|OK/ }).click()
  await expect(page.getByText(IFACE_CODE)).toHaveCount(0, { timeout: 15_000 })

  expect(errors, `page errors: ${errors.join('\n')}`).toEqual([])
})
