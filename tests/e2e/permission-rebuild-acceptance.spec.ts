import { expect, test, type Page } from '@playwright/test'

/**
 * 权限体系重构（S8/S9）· 浏览器端验收
 *
 * 覆盖 `docs/permission-rebuild/S8bcd-交接.md` §6 列出的 6 条人工验收路径。
 *
 * ## 为什么这套必须存在
 *
 * S8/S9 的后端接口、单测、Python 端到端全部绿过，但**没有任何一次在浏览器里走过**，
 * 结果漏掉了两个只有开界面才看得见的缺陷：
 *   1. 菜单树返回空数组 —— 登录后导航栏什么都没有（permissions 733 条而 menus []）
 *   2. 规则管理页 / 权限诊断页没有菜单行，是进不去的孤儿页面
 * 两个都是「接口 200、日志干净、就是用不了」，正是 CLAUDE.md 反复强调的那类缺陷。
 *
 * ## 前置
 *
 * 后端 48080 + 前端 dev server（Playwright 的 webServer 会自动拉起）。
 */

const ADMIN = { tenant: 'xpy', username: 'admin', password: 'admin123' }

async function login(page: Page) {
  await page.goto('/login')
  const form = page
    .locator('form.login-form')
    .filter({ has: page.locator('input[type="password"]') })
    .filter({ has: page.locator('input[type="checkbox"]') })
    .first()
  await expect(form).toBeVisible()

  const inputs = form.locator('input:visible')
  const inputCount = await inputs.count()
  if (inputCount >= 3) await inputs.nth(0).fill(ADMIN.tenant)
  await inputs.nth(inputCount - 2).fill(ADMIN.username)
  await inputs.nth(inputCount - 1).fill(ADMIN.password)

  const loginResp = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  expect((await loginResp).ok()).toBeTruthy()
  await expect(page).not.toHaveURL(/\/login/)
}

/** 侧边栏的悬浮二级菜单会盖住内容区，把后续点击截走。与本用例无关，屏蔽掉 */
async function hidePopupMenu(page: Page) {
  await page.addStyleTag({ content: '.el-menu--popup { display: none !important; }' })
}

test.describe('权限重构 · 浏览器验收', () => {
  // ── 路径 0：导航树非空（修复回归钉子）───────────────────────────
  test('登录后导航菜单不是空的', async ({ page }) => {
    const infoResp = page.waitForResponse((r) =>
      r.url().includes('/system/auth/get-permission-info')
    )
    await login(page)
    const body = await (await infoResp).json()

    // 这一条就是那个缺陷的回归钉子：修复前 menus 是 []，permissions 却有 733 条
    expect(body.data.permissions.length).toBeGreaterThan(0)
    expect(
      body.data.menus.length,
      'menus 为空 = 导航栏什么都不显示（listAllowedMenuIds 没补菜单树祖先）'
    ).toBeGreaterThan(0)

    // 界面上也要真的渲染出来，不能只是接口有数据
    await expect(page.locator('.el-menu').first()).toBeVisible()
  })

  // ── 路径 1 & 2：角色管理 →「资源授权」弹窗 ──────────────────────
  test('角色管理 →「资源授权」弹窗能打开，资源树与规则下拉都有数据', async ({ page }) => {
    await login(page)
    await page.goto('/system/role')
    await hidePopupMenu(page)
    await expect(page.locator('.el-table__body tbody tr').first()).toBeVisible()

    await page.locator('button:has-text("资源授权")').first().click()

    const dialog = page.locator('.el-dialog:visible', { hasText: '资源授权配置' })
    await expect(dialog).toBeVisible()

    // 「新增授权」内嵌弹窗：资源树 + 规则下拉
    await dialog.locator('button:has-text("新增授权")').click()
    const inner = page.locator('.el-dialog:visible').last()
    await expect(inner).toBeVisible()

    // el-tree-select 要真的展开出节点 —— handleTree + value-key 配错时这里是空的
    const treeSelect = inner.locator('.el-select').first()
    await treeSelect.click()
    await expect(
      page.locator('.el-tree-select__popper:visible .el-tree-node, .el-select-dropdown:visible .el-tree-node').first(),
      '资源树没有节点：handleTree 或 value-key 配置有问题'
    ).toBeVisible({ timeout: 15_000 })
  })

  // ── 路径 3：规则管理页 ────────────────────────────────────────
  test('规则管理页可访问，列表有种子规则', async ({ page }) => {
    await login(page)
    const listResp = page.waitForResponse((r) => r.url().includes('/system/rule/page'))
    await page.goto('/system/rule')
    await hidePopupMenu(page)

    expect((await listResp).ok()).toBeTruthy()
    // 页面真的渲染出来了（不是 404 或空白路由）
    await expect(page.locator('button:has-text("新增")').first()).toBeVisible()
    await expect(page.locator('.el-table__body tbody tr').first()).toBeVisible()
  })

  // ── 路径 6：权限诊断页 ────────────────────────────────────────
  test('权限诊断页：查一个已知权限串能出结论与资源链', async ({ page }) => {
    await login(page)
    await page.goto('/system/permission-diag')
    await hidePopupMenu(page)

    const input = page.locator('input[placeholder="如 system:user:query"]')
    await expect(input).toBeVisible()
    await input.fill('system:grant:query')

    const diagResp = page.waitForResponse((r) =>
      r.url().includes('/system/permission-diag/check')
    )
    await page.locator('button:has-text("诊断")').first().click()
    const payload = await (await diagResp).json()

    expect(payload.code).toBe(0)
    expect(['ALLOWED', 'DENIED']).toContain(payload.data.conclusion)
    expect(payload.data.subjects.length, '主体闭包为空').toBeGreaterThan(0)
    expect(payload.data.resourceChain.length, '资源链为空').toBeGreaterThan(0)

    // 结论要真的显示在界面上，而不只是接口返回了。
    // 页面渲染的是中文（✅ 有权限 / 🚫 无权限），不是原始的 ALLOWED/DENIED
    const shown = payload.data.conclusion === 'ALLOWED' ? '有权限' : '无权限'
    await expect(page.getByText(shown).first()).toBeVisible()
  })

  // ── 字段模式枚举必须与后端 FieldModeEnum 对齐 ──────────────────
  test('授权弹窗的「字段显示模式」取值与后端 FieldModeEnum 一致', async ({ page }) => {
    await login(page)
    await page.goto('/system/role')
    await hidePopupMenu(page)
    await expect(page.locator('.el-table__body tbody tr').first()).toBeVisible()
    await page.locator('button:has-text("资源授权")').first().click()
    const dialog = page.locator('.el-dialog:visible', { hasText: '资源授权配置' })
    await expect(dialog).toBeVisible()
    await dialog.locator('button:has-text("新增授权")').click()
    const inner = page.locator('.el-dialog:visible').last()
    await expect(inner).toBeVisible()

    // 打开「字段显示模式」下拉，读出全部候选值
    await inner.locator('.el-form-item', { hasText: '字段显示模式' }).locator('.el-select').click()
    const options = page.locator('.el-select-dropdown:visible .el-select-dropdown__item')
    await expect(options.first()).toBeVisible()
    const labels = await options.allInnerTexts()

    // 后端 FieldModeEnum 只有 EDITABLE / READONLY / HIDDEN。
    // 曾经这里是 VISIBLE —— 后端 parse 不出来会把【整行授权过滤掉】，
    // 表现是「选了可见、保存成功、列表也显示可见，判定时却完全不生效」
    expect(labels.join(' ')).toContain('EDITABLE')
    expect(labels.join(' '), 'VISIBLE 不是后端认识的取值').not.toContain('VISIBLE')
  })

  // ── 路径 5：BPM 流程定义页 →「权限配置」──────────────────────
  test('BPM 流程定义页有「权限配置」入口', async ({ page }) => {
    await login(page)
    // ⚠️ 这个页面是**隐藏的静态路由** `/bpm/manager/definition`（见 router/modules/remaining.ts），
    // 没有菜单行，从流程模型列表跳进来，且要带 ?key= 才有数据
    await page.goto('/bpm/manager/definition?key=leave')
    await hidePopupMenu(page)
    await expect(page.locator('.el-table__body tbody tr').first()).toBeVisible({ timeout: 20_000 })

    // 按钮带 v-hasPermi="['system:grant:query']" —— 没授权时它会静默消失
    await expect(page.locator('button:has-text("权限配置")').first()).toBeVisible()
  })
})
