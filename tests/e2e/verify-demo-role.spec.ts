import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

/**
 * 演示角色（demo / ty01）真实页面走查
 *
 * 背景：本分支开了 grant-enabled，鉴权走 sys_grant 而不是 system_role_menu。
 * 之前给演示角色配的是 role_menu（对新引擎完全无效），登录后侧边栏只有「首页」。
 * 现在改成给 demo 角色写 sys_grant（ROLE 主体，218 条），本用例就是在浏览器里
 * 证明这套授权【真的能用】——而不是只在数据层看着对。
 *
 * 期望的权限画像：
 *   - 所有启用菜单：可查看（列表能加载、不 403）
 *   - 用户管理这类普通菜单：只读，没有 新增/删除
 *   - 表单设计/门户设计/数据接口/单据模板：增改查（有新增，无删除）
 *   - 在线示例子树：增删改查（新增、行内编辑、删除都在）
 *   - 流程模型：只读，页面上不出现任何新建入口（分类下的「新建」、工具栏的新建分类）
 */

const SHOTS = path.join(__dirname, '.verify-shots')
fs.mkdirSync(SHOTS, { recursive: true })

const loginAs = async (page: Page, username: string) => {
  await page.goto('/login')
  const form = page
    .locator('form.login-form')
    .filter({ has: page.locator('input[type="password"]') })
    .first()
  await expect(form).toBeVisible()
  const inputs = form.locator('input:visible')
  const n = await inputs.count()
  if (n >= 3) await inputs.nth(0).fill('xpy')
  await inputs.nth(n - 2).fill(username)
  await inputs.nth(n - 1).fill('admin123')
  const resp = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  expect((await resp).ok()).toBeTruthy()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20_000 })
}

/** 屏蔽侧边栏悬浮二级菜单，避免它盖住内容区截走点击 */
const hidePopupMenu = (page: Page) =>
  page.addStyleTag({ content: '.el-menu--popup { display: none !important; }' })

/** 内容区所有可见按钮的文本（去掉空白），用来判断增删改查按钮在不在 */
const visibleButtons = async (page: Page): Promise<string[]> => {
  const btns = page.locator('.v-app-content button:visible, .app-content button:visible, section button:visible')
  const texts = await btns.allInnerTexts()
  return texts.map((t) => t.replace(/\s+/g, '')).filter(Boolean)
}

const hasBtn = (texts: string[], re: RegExp) => texts.some((t) => re.test(t))

test('演示角色真实页面走查', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  const forbidden: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => {
    // 只统计业务接口的 403；静态资源/第三方不算
    if (r.status() === 403 && r.url().includes('/admin-api/')) forbidden.push(r.url())
  })

  await loginAs(page, 'ty01')
  await hidePopupMenu(page)

  // ===== 0. 导航树非空：侧边栏真的渲染出了菜单 =====
  const infoResp = page.waitForResponse((r) => r.url().includes('/system/auth/get-permission-info'))
  await page.reload()
  const info = await (await infoResp).json()
  console.log('===PERM_INFO===', 'menus(roots):', info.data.menus.length, 'permissions:', info.data.permissions.length)
  expect(info.data.menus.length).toBeGreaterThan(0)
  const sidebarText = await page.locator('.el-menu').first().innerText().catch(() => '')
  console.log('===SIDEBAR===', JSON.stringify(sidebarText.replace(/\s+/g, ' ').slice(0, 200)))
  for (const root of ['系统管理', '基础设施']) {
    expect(sidebarText, `侧边栏应出现顶级菜单「${root}」`).toContain(root)
  }
  await page.screenshot({ path: path.join(SHOTS, 'demo-00-sidebar.png') })

  // ===== 1. 用户管理：只读（有查看、无新增/删除）=====
  await page.goto('/system/org-permission/user')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.el-table__row, .el-table__empty-block').first()).toBeVisible({ timeout: 20_000 })
  let btns = await visibleButtons(page)
  console.log('===USER_BUTTONS===', JSON.stringify(btns))
  expect(hasBtn(btns, /新增|新建/), '用户管理应【没有】新增按钮（只读）').toBe(false)
  expect(hasBtn(btns, /删除/), '用户管理应【没有】删除按钮（只读）').toBe(false)
  expect(hasBtn(btns, /导出|导入/), '用户管理应【没有】导入导出按钮（只读）').toBe(false)
  await page.screenshot({ path: path.join(SHOTS, 'demo-01-user-viewonly.png') })

  // ===== 2. 表单设计：增改查（有新增，无删除）=====
  await page.goto('/infra/online/list')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.el-table__row, .el-table__empty-block').first()).toBeVisible({ timeout: 20_000 })
  btns = await visibleButtons(page)
  console.log('===FORM_DESIGN_BUTTONS===', JSON.stringify(btns))
  expect(hasBtn(btns, /新增|新建|创建/), '表单设计应【有】新增按钮').toBe(true)
  await page.screenshot({ path: path.join(SHOTS, 'demo-02-formdesign.png') })

  // ===== 2b. 门户设计：增改查（有新增，无删除）=====
  await page.goto('/infra/online/portal')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.el-table__row, .el-table__empty-block, .portal-card, .el-card').first()).toBeVisible({ timeout: 20_000 })
  btns = await visibleButtons(page)
  console.log('===PORTAL_DESIGN_BUTTONS===', JSON.stringify(btns.slice(0, 20)))
  expect(hasBtn(btns, /新增|新建|创建/), '门户设计应【有】新增按钮').toBe(true)
  await page.screenshot({ path: path.join(SHOTS, 'demo-02b-portal.png') })

  // ===== 3. 数据接口：增改查（有新增，无删除）=====
  await page.goto('/infra/data-manage/data-interface')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.el-table__row, .el-table__empty-block').first()).toBeVisible({ timeout: 20_000 })
  btns = await visibleButtons(page)
  console.log('===DATA_INTERFACE_BUTTONS===', JSON.stringify(btns))
  expect(hasBtn(btns, /新增|新建|创建/), '数据接口应【有】新增按钮').toBe(true)
  await page.screenshot({ path: path.join(SHOTS, 'demo-03-data-interface.png') })

  // ===== 4. 单据模板：增改查（有新增，无删除）=====
  await page.goto('/infra/data-manage/bill-template')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.el-table__row, .el-table__empty-block').first()).toBeVisible({ timeout: 20_000 })
  btns = await visibleButtons(page)
  console.log('===BILL_TEMPLATE_BUTTONS===', JSON.stringify(btns))
  expect(hasBtn(btns, /新增|新建|创建/), '单据模板应【有】新增按钮').toBe(true)
  await page.screenshot({ path: path.join(SHOTS, 'demo-04-bill-template.png') })

  // ===== 5. 在线示例（查看明文验证）：增删改查 =====
  await page.goto('/infra/form-demo/form-design-run/e2e_plain_probe')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.el-table__row, .el-table__empty-block').first()).toBeVisible({ timeout: 25_000 })
  btns = await visibleButtons(page)
  console.log('===ONLINE_EXAMPLE_BUTTONS===', JSON.stringify(btns))
  expect(hasBtn(btns, /新增|新建|创建/), '在线示例应【有】新增按钮（增）').toBe(true)
  await page.screenshot({ path: path.join(SHOTS, 'demo-05-online-crud.png') })

  // 行内操作：有数据行时，编辑（改）与删除（删）都应在
  const firstRow = page.locator('.el-table__row').first()
  if (await firstRow.count()) {
    const rowText = (await firstRow.innerText()).replace(/\s+/g, '')
    console.log('===ONLINE_FIRST_ROW===', rowText.slice(0, 120))
    expect(/编辑|修改/.test(rowText), '在线示例数据行应有【编辑/修改】（改）').toBe(true)
    expect(/删除/.test(rowText), '在线示例数据行应有【删除】（删）').toBe(true)
  } else {
    console.log('===ONLINE_FIRST_ROW=== (无数据行，跳过行内按钮断言)')
  }

  // ===== 6. 流程模型：演示角色只有查看权，页面上不该出现任何「新建」入口 =====
  await page.goto('/bpm/manager/model')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h3', { hasText: '流程模型' }).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1500)
  btns = await visibleButtons(page)
  console.log('===BPM_MODEL_BUTTONS===', JSON.stringify(btns))
  expect(
    btns.filter((t) => /新建|新增|创建/.test(t)),
    '流程模型页不应出现任何新建/新增按钮（演示角色无 bpm:model:create）'
  ).toEqual([])
  expect(
    btns.filter((t) => t === '分类'),
    '流程模型页不应出现分类设置按钮（演示角色无 bpm:category:update/delete）'
  ).toEqual([])
  const contentButtons = page.locator(
    '.v-app-content button:visible, .app-content button:visible, section button:visible'
  )
  expect(
    await contentButtons.filter({ hasText: '分类' }).count(),
    '流程模型页不应出现分类设置按钮'
  ).toBe(0)
  expect(
    await page
      .locator(
        '.v-app-content button.w-30px:visible, .app-content button.w-30px:visible, section button.w-30px:visible'
      )
      .count(),
    '流程模型工具栏的「更多操作」齿轮不应出现（里面是新建分类/分类排序）'
  ).toBe(0)
  await page.screenshot({ path: path.join(SHOTS, 'demo-06-bpm-model.png') })

  console.log('===FORBIDDEN(403)===', JSON.stringify(forbidden))
  console.log('===PAGE_ERRORS===', JSON.stringify(errors))
  expect(forbidden, '走查过程中不应出现任何 403').toEqual([])
  expect(errors, '走查过程中不应有页面异常').toEqual([])
})
