import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/**
 * 归零用的主题配置
 *
 * 其余字段留空即可 —— 前端加载时会用默认值补齐，并把补齐后的完整快照回写落库。
 * 但 isDark 必须显式给出：login() 会拿「接口返回的配置」和「页面上的 dark class」
 * 比对，只写 {} 的话前者解析出 undefined、后者是补齐后的 false，断言必然对不上。
 */
const DEFAULT_THEME_CONFIG = JSON.stringify({ isDark: false })

const isThemeRequest = (response: { url(): string; request(): { method(): string } }) =>
  response.url().includes('/system/user/profile/theme')

const waitForThemeLoad = (page: Page) =>
  page.waitForResponse(
    (response) => isThemeRequest(response) && response.request().method() === 'GET'
  )

const waitForThemeSave = (page: Page) =>
  page.waitForResponse(
    (response) => isThemeRequest(response) && response.request().method() === 'PUT'
  )

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
  if (inputCount >= 3) await inputs.nth(0).fill('xpy')
  await inputs.nth(inputCount - 2).fill('admin')
  await inputs.nth(inputCount - 1).fill('admin123')

  const themeLoadPromise = waitForThemeLoad(page)
  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/system/auth/login') && response.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  const loginResponse = await loginResponsePromise
  expect(loginResponse.ok()).toBeTruthy()
  const loginBody = (await loginResponse.json()) as { data?: { accessToken?: string } }
  const themeResponse = await themeLoadPromise
  expect(themeResponse.ok()).toBeTruthy()
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('.v-setting')).toBeVisible()

  const themeBody = (await themeResponse.json()) as { data?: { themeConfig?: string } }
  return {
    accessToken: loginBody.data?.accessToken,
    originalThemeConfig: themeBody.data?.themeConfig || null
  }
}

/**
 * 把当前用户的主题配置重置回默认，并等页面按默认值重新渲染
 *
 * 这两个用例会直接改登录用户在库里的主题配置。如果上一次运行没能还原
 * （用例超时时 Playwright 已经关掉 context，finally 里的还原请求发不出去），
 * 脏配置就会留在库里，让下一次运行从一个非预期的状态开始 —— 轻则断言错位，
 * 重则点到一个「已经是目标值」的选项，不触发保存请求，用例直接死等。
 *
 * 所以每次开跑前先重置：传空配置，后端取不到有效 JSON 就会回落到默认值。
 */
async function resetThemeToDefault(
  request: APIRequestContext,
  page: Page,
  accessToken: string | undefined
) {
  if (!accessToken) return
  const response = await request.put(`${API_BASE_URL}/system/user/profile/theme`, {
    data: { themeConfig: DEFAULT_THEME_CONFIG },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'tenant-id': TENANT_ID
    }
  })
  expect(response.ok()).toBeTruthy()
  const themeLoadPromise = waitForThemeLoad(page)
  await page.reload()
  await themeLoadPromise
}

async function restoreTheme(
  request: APIRequestContext,
  accessToken: string | undefined,
  themeConfig: string | null
) {
  if (!accessToken) return
  await request.put(`${API_BASE_URL}/system/user/profile/theme`, {
    data: { themeConfig: themeConfig || '{}' },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'tenant-id': TENANT_ID
    }
  })
}

async function ensureDarkTheme(page: Page) {
  if (await page.locator('html').evaluate((element) => element.classList.contains('dark'))) return

  await page.locator('.v-setting').click()
  const drawer = page.locator('.el-drawer:visible')
  await expect(drawer).toBeVisible()
  await Promise.all([waitForThemeSave(page), drawer.locator('.v-theme-switch').click()])
  await expect(page.locator('html')).toHaveClass(/dark/)
  await drawer
    .locator('.el-drawer__close-btn')
    .click()
    .catch(() => {})
}

const visibleElementStyle = async (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        width: rect.width,
        height: rect.height
      }
    })

test('表单构建与设计页面应支持暗黑主题', async ({ page, request }) => {
  const session = await login(page)
  const { accessToken, originalThemeConfig } = session

  try {
    // 先归零，避免上一次运行留下的脏配置让本次从非预期状态开始
    await resetThemeToDefault(request, page, accessToken)
    await ensureDarkTheme(page)

    for (const path of ['/infra/build', '/bpm/manager/form/edit']) {
      await page.goto(path)
      await expect(page.locator('._fc-designer')).toBeVisible()
      await expect(page.locator('html')).toHaveClass(/dark/)

      const designerStyle = await visibleElementStyle(page, '._fc-designer')
      const canvasStyle = await visibleElementStyle(page, '._fc-m-con')
      expect(designerStyle.backgroundColor).not.toBe('rgb(255, 255, 255)')
      expect(canvasStyle.backgroundColor).not.toBe('rgb(255, 255, 255)')
      expect(designerStyle.width).toBeGreaterThan(0)
      expect(designerStyle.height).toBeGreaterThan(0)
    }

    await page.goto('/infra/online/editor')
    await page.locator('input[placeholder="请输入表单名称"]').fill('暗色主题检查')
    await page.locator('input[placeholder*="表单编码"]').fill('dark_theme_check')
    await page.locator('.cursor-pointer').filter({ hasText: '表单设计' }).click()
    await expect(page.locator('.form-design-wrapper')).toBeVisible()
    await expect(page.locator('._fc-designer')).toBeVisible()

    const formDesignStyle = await visibleElementStyle(page, '.form-design-wrapper')

    // 字段映射已挪到设计器左栏「大纲」之后的第三个页签，默认不激活 ——
    // 不先切过去，.mapping-area 在 DOM 里是 v-show 隐藏的，取不到可见样式，
    // 而 actionTimeout 默认不限时，会一直挂到用例超时
    await page.locator('._fc-l-tab').filter({ hasText: '字段映射' }).first().click()
    await expect(page.locator('.mapping-area')).toBeVisible()
    const mappingStyle = await visibleElementStyle(page, '.mapping-area')
    expect(formDesignStyle.backgroundColor).not.toBe('rgb(255, 255, 255)')
    expect(mappingStyle.backgroundColor).not.toBe('rgb(255, 255, 255)')

    // 按名字定位而不是「序号+名字」：步骤序号会随步骤增减而变
    // （「逻辑与扩展」曾经插在表单设计之后，现已改成设计器里的弹窗入口，序号又变了一次）。
    // 用例本不该被步骤顺序绑住，它关心的只是「列表设计这一步长什么样」
    await page.locator('.cursor-pointer').filter({ hasText: '列表设计' }).click()
    await expect(page.locator('.step-list-design')).toBeVisible()
    await expect(page.locator('.step-list-design .el-tabs')).toBeVisible()
    const listStyle = await visibleElementStyle(page, '.step-list-design')
    expect(listStyle.color).not.toBe('rgb(0, 0, 0)')
  } finally {
    // 收尾统一归零，而不是还原登录时抓到的快照 —— 那份快照可能本身就是上一次
    // 没还原干净的脏配置，照着还原等于把脏状态永久留在账号上
    await restoreTheme(request, accessToken, DEFAULT_THEME_CONFIG)
  }
})
