import { expect, test, type Page } from '@playwright/test'

/**
 * 一次性走查脚本：门户类型/可见范围/切换持久化 + 门户与表单版本预览
 * 截图输出到 tests/e2e/.verify-shots/portal-*.png
 */

const SHOTS = 'tests/e2e/.verify-shots'
const ts = Date.now()
const PAGE_PORTAL = { name: `走查页面门户${ts}`, code: `walk_page_${ts}` }
const EXT_PORTAL = { name: `走查外链门户${ts}`, code: `walk_ext_${ts}` }
const DESIGN_PORTAL = { name: `走查设计门户${ts}`, code: `walk_design_${ts}` }

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

/** 可见的消息确认框点确定 */
async function confirmBox(page: Page): Promise<void> {
  const box = page.locator('.el-message-box:visible')
  await box.waitFor({ state: 'visible' })
  await box.locator('.el-button--primary').click()
  await box.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
}

async function gotoPortalList(page: Page): Promise<void> {
  await page.goto('/infra/online/portal')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /新\s*增/ }).first()).toBeVisible({
    timeout: 15_000
  })
}

/** 按名称搜出目标行 */
async function findRow(page: Page, name: string) {
  await gotoPortalList(page)
  await page.getByPlaceholder('请输入门户名称').fill(name)
  await page.getByRole('button', { name: /搜\s*索/ }).first().click()
  const row = page.locator('.el-table__row').filter({ hasText: name }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  return row
}

/** 在门户表单弹窗里填基础信息 */
async function fillPortalForm(page: Page, portal: { name: string; code: string }): Promise<void> {
  const dialog = page.locator('.el-dialog:visible').filter({ hasText: '新增门户' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('请输入门户名称').fill(portal.name)
  await dialog.locator('input[placeholder*="main_portal"]').fill(portal.code)
}

/** 打开设置抽屉里的首页门户下拉并选择 */
async function selectHomePortal(page: Page, optionText: string): Promise<void> {
  await page.locator('.v-setting').click()
  const drawer = page.locator('.el-drawer:visible')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('首页门户')).toBeVisible({ timeout: 10_000 })
  // 首页门户区块在抽屉最顶部，其下拉是第一个 el-select
  const select = drawer.locator('.el-select').first()
  await select.locator('.el-select__wrapper').click()
  const dropdown = page.locator('.el-select-dropdown:visible')
  await dropdown.waitFor({ state: 'visible' })
  const save = page.waitForResponse(
    (r) => r.url().includes('/system/user/profile/theme') && r.request().method() === 'PUT'
  )
  await dropdown
    .locator('.el-select-dropdown__item')
    .filter({ hasText: optionText })
    .first()
    .click()
  if (optionText !== '默认门户') {
    expect((await save).ok()).toBeTruthy()
  } else {
    await save.catch(() => {})
  }
  await page.waitForTimeout(300)
  await drawer.locator('.el-drawer__close-btn').click().catch(() => {})
}

test('门户增强 + 版本预览 走查', async ({ page }) => {
  test.setTimeout(900_000)
  await login(page)

  // ========== 1. 列表按钮文案 ==========
  await test.step('列表文案：新增/发布', async () => {
    await gotoPortalList(page)
    await expect(page.getByRole('button', { name: /新\s*增/ }).first()).toBeVisible()
    expect(await page.getByText('新建门户').count()).toBe(0)
    expect(await page.getByText('重新发布').count()).toBe(0)
    await page.screenshot({ path: `${SHOTS}/portal-01-list.png` })
  })

  // ========== 2. 新增链接门户（页面类型） ==========
  await test.step('新增页面链接门户', async () => {
    await page.getByRole('button', { name: /新\s*增/ }).first().click()
    await fillPortalForm(page, PAGE_PORTAL)
    const dialog = page.locator('.el-dialog:visible')
    await dialog.locator('.el-radio').filter({ hasText: '自定义' }).click()
    await expect(dialog.getByText('链接类型')).toBeVisible()
    await dialog.locator('.el-radio').filter({ hasText: '页面' }).click()
    await dialog.getByPlaceholder(/system\/user/).fill('/system/user')
    await page.screenshot({ path: `${SHOTS}/portal-02-form-page-link.png` })
    await dialog.getByRole('button', { name: /确\s*定/ }).click()
    await expect(page.getByText('创建成功')).toBeVisible({ timeout: 10_000 })
    // 链接门户不跳设计器
    expect(page.url()).not.toContain('portal/editor')
    const row = await findRow(page, PAGE_PORTAL.name)
    await expect(row.getByText('自定义链接')).toBeVisible()
    // 链接门户没有 设计/版本 按钮
    expect(await row.getByRole('button', { name: /设\s*计/ }).count()).toBe(0)
    expect(await row.getByRole('button', { name: /版\s*本/ }).count()).toBe(0)
    await expect(row.getByRole('button', { name: /发\s*布/ })).toBeVisible()
  })

  // ========== 3. 发布页面链接门户（confirm 而非 prompt） ==========
  await test.step('发布页面链接门户', async () => {
    const row = await findRow(page, PAGE_PORTAL.name)
    await row.getByRole('button', { name: /发\s*布/ }).click()
    const box = page.locator('.el-message-box:visible')
    await expect(box.getByText('确认发布门户')).toBeVisible()
    // 链接门户不出现发布说明输入框（confirm 框的 input 节点存在但隐藏）
    await expect(box.locator('.el-message-box__input')).toBeHidden()
    await box.locator('.el-button--primary').click()
    await expect(page.getByText('发布成功')).toBeVisible({ timeout: 10_000 })
    const row2 = await findRow(page, PAGE_PORTAL.name)
    await expect(row2.getByText('已发布')).toBeVisible()
  })

  // ========== 4. 新增外链门户 + 地址校验探测 ==========
  await test.step('新增外链门户', async () => {
    await gotoPortalList(page)
    await page.getByRole('button', { name: /新\s*增/ }).first().click()
    await fillPortalForm(page, EXT_PORTAL)
    const dialog = page.locator('.el-dialog:visible')
    await dialog.locator('.el-radio').filter({ hasText: '自定义' }).click()
    await dialog.locator('.el-radio').filter({ hasText: '外链' }).click()
    const urlInput = dialog.getByPlaceholder(/example\.com/)
    // 探测：非法地址触发校验
    await urlInput.fill('abc')
    await dialog.getByPlaceholder('请输入门户描述').click()
    await expect(dialog.getByText('外链地址需以 http:// 或 https:// 开头')).toBeVisible()
    await urlInput.fill('https://www.baidu.com')
    await page.screenshot({ path: `${SHOTS}/portal-03-form-ext-link.png` })
    await dialog.getByRole('button', { name: /确\s*定/ }).click()
    await expect(page.getByText('创建成功')).toBeVisible({ timeout: 10_000 })
    const row = await findRow(page, EXT_PORTAL.name)
    await row.getByRole('button', { name: /发\s*布/ }).click()
    await confirmBox(page)
    await expect(page.getByText('发布成功')).toBeVisible({ timeout: 10_000 })
  })

  // ========== 5. 新增在线设计门户（可见范围=指定角色）并发布 ==========
  let designId = ''
  await test.step('新增在线设计门户（指定角色可见）', async () => {
    await gotoPortalList(page)
    await page.getByRole('button', { name: /新\s*增/ }).first().click()
    await fillPortalForm(page, DESIGN_PORTAL)
    const dialog = page.locator('.el-dialog:visible')
    await dialog.locator('.el-radio').filter({ hasText: '指定角色' }).click()
    await dialog.locator('.el-select__wrapper').first().click()
    const dropdown = page.locator('.el-select-dropdown:visible')
    await dropdown.waitFor({ state: 'visible' })
    const firstRole = dropdown.locator('.el-select-dropdown__item').first()
    const roleName = (await firstRole.textContent())?.trim() ?? ''
    await firstRole.click()
    // 点描述输入框收起下拉，避免 Escape 连带关闭对话框
    await dialog.getByPlaceholder('请输入门户描述').click()
    await page.screenshot({ path: `${SHOTS}/portal-04-form-design-role.png` })
    await dialog.getByRole('button', { name: /确\s*定/ }).click()
    await expect(page.getByText('创建成功')).toBeVisible({ timeout: 10_000 })
    // 在线设计门户创建后跳设计器
    await page.waitForURL((u) => u.pathname.includes('portal/editor'), { timeout: 15_000 })
    designId = page.url().split('id=')[1] ?? ''
    expect(designId).not.toBe('')
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `${SHOTS}/portal-05-designer.png` })
    console.log(`走查：在线设计门户 id=${designId}，可见角色=${roleName}`)
  })

  await test.step('发布在线设计门户 v1（带发布说明）', async () => {
    const row = await findRow(page, DESIGN_PORTAL.name)
    await row.getByRole('button', { name: /发\s*布/ }).click()
    const box = page.locator('.el-message-box:visible')
    await expect(box.getByText('请输入发布说明')).toBeVisible()
    await box.locator('input').fill('走查发布 v1')
    await box.locator('.el-button--primary').click()
    await expect(page.getByText('发布成功')).toBeVisible({ timeout: 10_000 })
    const row2 = await findRow(page, DESIGN_PORTAL.name)
    await expect(row2.getByText('v1')).toBeVisible()
  })

  // ========== 6. 版本抽屉：预览 + 连发 11 次验证不裁剪 ==========
  await test.step('版本抽屉预览 v1', async () => {
    const row = await findRow(page, DESIGN_PORTAL.name)
    await row.getByRole('button', { name: /版\s*本/ }).click()
    const drawer = page.locator('.el-drawer:visible')
    await expect(drawer.getByText(`版本历史 - ${DESIGN_PORTAL.name}`)).toBeVisible()
    const vRow = drawer.locator('.el-table__row').filter({ hasText: 'v1' }).first()
    await expect(vRow).toBeVisible({ timeout: 10_000 })
    await vRow.getByRole('button', { name: /预\s*览/ }).click()
    const dialog = page.locator('.el-dialog:visible')
    await expect(dialog.getByText(`版本预览 - ${DESIGN_PORTAL.name} v1`)).toBeVisible()
    await expect(dialog.locator('.portal-runtime')).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByRole('button', { name: /回滚到此版本/ })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/portal-06-version-preview.png` })
    await dialog.getByRole('button', { name: /关\s*闭/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await drawer.locator('.el-drawer__close-btn').click()
  })

  await test.step('连续发布至 v12，版本不被裁剪到 10', async () => {
    for (let v = 2; v <= 12; v++) {
      const row = await findRow(page, DESIGN_PORTAL.name)
      await row.getByRole('button', { name: /发\s*布/ }).click()
      const box = page.locator('.el-message-box:visible')
      await box.locator('input').fill(`走查发布 v${v}`)
      await box.locator('.el-button--primary').click()
      await expect(page.getByText('发布成功')).toBeVisible({ timeout: 10_000 })
    }
    const row = await findRow(page, DESIGN_PORTAL.name)
    await expect(row.getByText('v12')).toBeVisible()
    await row.getByRole('button', { name: /版\s*本/ }).click()
    const drawer = page.locator('.el-drawer:visible')
    await expect(drawer.locator('.el-table__row').filter({ hasText: 'v12' }).first()).toBeVisible({
      timeout: 10_000
    })
    // v1 仍然在列表里（旧上限会把它裁掉）
    await expect(drawer.locator('.el-table__row').filter({ hasText: 'v1' }).first()).toBeVisible()
    const count = await drawer.locator('.el-table__row').count()
    console.log(`走查：版本抽屉共 ${count} 个版本（应 ≥ 12）`)
    expect(count).toBeGreaterThanOrEqual(12)
    await page.screenshot({ path: `${SHOTS}/portal-07-version-list-12.png` })
    // 抽屉内预览 v1 并回滚
    await drawer.locator('.el-table__row').filter({ hasText: 'v1' }).first()
      .getByRole('button', { name: /预\s*览/ }).click()
    const dialog = page.locator('.el-dialog:visible')
    await expect(dialog.locator('.portal-runtime')).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: /回滚到此版本/ }).click()
    await confirmBox(page)
    await expect(page.getByText('回滚成功')).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await drawer.locator('.el-drawer__close-btn').click()
  })

  // ========== 7. 配置面板切换 + 落库持久化 + 首页 iframe ==========
  await test.step('配置面板出现首页门户区块，切换到外链门户', async () => {
    await page.locator('.v-setting').click()
    const drawer = page.locator('.el-drawer:visible')
    await expect(drawer.getByText('首页门户')).toBeVisible({ timeout: 10_000 })
    await drawer.locator('.el-select__wrapper').first().click()
    const dropdown = page.locator('.el-select-dropdown:visible')
    await dropdown.waitFor({ state: 'visible' })
    // 链接门户带「链接」标签
    const extOption = dropdown
      .locator('.el-select-dropdown__item')
      .filter({ hasText: EXT_PORTAL.name })
      .first()
    await expect(extOption.getByText('链接')).toBeVisible()
    await expect(
      dropdown.locator('.el-select-dropdown__item').filter({ hasText: PAGE_PORTAL.name }).first()
    ).toBeVisible()
    await expect(
      dropdown.locator('.el-select-dropdown__item').filter({ hasText: DESIGN_PORTAL.name }).first()
    ).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/portal-08-setting-select.png` })
    await page.keyboard.press('Escape')
    await drawer.locator('.el-drawer__close-btn').click()

    await selectHomePortal(page, EXT_PORTAL.name)
    await page.goto('/index')
    await page.waitForLoadState('networkidle')
    const frame = page.locator('.portal-link-frame')
    await expect(frame).toBeVisible({ timeout: 15_000 })
    await expect(frame.getByText(EXT_PORTAL.name)).toBeVisible()
    await expect(frame.getByRole('button', { name: /新标签页打开/ })).toBeVisible()
    const iframe = frame.locator('iframe')
    await expect(iframe).toHaveAttribute('src', 'https://www.baidu.com')
    await page.screenshot({ path: `${SHOTS}/portal-09-home-ext-frame.png` })
  })

  await test.step('刷新后选择仍生效（落库持久化）', async () => {
    await page.reload()
    await page.waitForLoadState('networkidle')
    const frame = page.locator('.portal-link-frame')
    await expect(frame).toBeVisible({ timeout: 20_000 })
    await expect(frame.getByText(EXT_PORTAL.name)).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/portal-10-home-after-reload.png` })
  })

  await test.step('切换到页面链接门户，iframe 指向内部路由', async () => {
    await selectHomePortal(page, PAGE_PORTAL.name)
    await page.goto('/index')
    await page.waitForLoadState('networkidle')
    const frame = page.locator('.portal-link-frame')
    await expect(frame).toBeVisible({ timeout: 15_000 })
    const src = await frame.locator('iframe').getAttribute('src')
    expect(src).toContain('/system/user')
    await page.screenshot({ path: `${SHOTS}/portal-11-home-page-frame.png` })
  })

  await test.step('切回默认门户，链接框架消失', async () => {
    await selectHomePortal(page, '默认门户')
    await page.goto('/index')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2_000)
    expect(await page.locator('.portal-link-frame').count()).toBe(0)
    await page.screenshot({ path: `${SHOTS}/portal-12-home-default.png` })
  })

  // ========== 8. 表单设计版本抽屉：文案 100 + 预览 + 回滚 ==========
  await test.step('表单设计版本预览与回滚', async () => {
    await page.goto('/infra/online/list')
    await page.waitForLoadState('networkidle')
    await page.getByPlaceholder('请输入表单名称').fill('控件总览示例')
    await page.getByRole('button', { name: /搜\s*索/ }).first().click()
    const row = page.locator('.el-table__row').filter({ hasText: '控件总览示例' }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole('button', { name: /版\s*本/ }).click()
    const drawer = page.locator('.el-drawer:visible')
    await expect(drawer.getByText('每个表单最多保留最新 100 个版本')).toBeVisible({
      timeout: 10_000
    })
    const current = drawer.locator('.el-card').filter({ hasText: '当前线上' }).first()
    await expect(current).toBeVisible({ timeout: 10_000 })
    await current.getByRole('button', { name: /预\s*览/ }).click()
    const dialog = page.locator('.el-dialog:visible')
    await expect(dialog.getByText(/版本预览 - v\d+/)).toBeVisible()
    // form-create 渲染出真实表单
    await expect(dialog.locator('form').first()).toBeVisible({ timeout: 30_000 })
    // 兜底空状态不应出现（演示表单自身可能含空状态控件，只查直接子节点）
    expect(await dialog.locator('.version-preview__body > .el-empty').count()).toBe(0)
    await page.screenshot({ path: `${SHOTS}/portal-13-form-version-preview.png` })
    // 回滚到当前线上版本（快照相同，无破坏）
    await dialog.getByRole('button', { name: /回滚到此版本/ }).click()
    await confirmBox(page)
    await expect(page.getByText('回滚成功，配置已写回草稿')).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toBeHidden({ timeout: 10_000 })
  })

  // ========== 9. 暗黑主题可读性 ==========
  await test.step('暗黑主题下门户列表与首页框架可读', async () => {
    await toggleDark(page, true)
    const row = await findRow(page, EXT_PORTAL.name)
    await expect(row).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/portal-14-dark-list.png` })
    await selectHomePortal(page, EXT_PORTAL.name)
    await page.goto('/index')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.portal-link-frame')).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: `${SHOTS}/portal-15-dark-home-frame.png` })
    // 恢复：亮色 + 默认门户
    await selectHomePortal(page, '默认门户')
    await toggleDark(page, false)
  })

  // ========== 10. 清理走查数据 ==========
  await test.step('删除三个走查门户', async () => {
    for (const portal of [PAGE_PORTAL, EXT_PORTAL, DESIGN_PORTAL]) {
      const row = await findRow(page, portal.name)
      await row.getByRole('button', { name: /更\s*多/ }).click()
      await page
        .locator('.el-dropdown-menu:visible')
        .getByText('删除')
        .click()
      await confirmBox(page)
      await expect(page.getByText(/删除成功|操作成功/).first()).toBeVisible({ timeout: 10_000 })
    }
    await gotoPortalList(page)
    for (const portal of [PAGE_PORTAL, EXT_PORTAL, DESIGN_PORTAL]) {
      await page.getByPlaceholder('请输入门户名称').fill(portal.name)
      await page.getByRole('button', { name: /搜\s*索/ }).first().click()
      await page.waitForTimeout(500)
      expect(await page.locator('.el-table__row').filter({ hasText: portal.name }).count()).toBe(0)
    }
  })
})
