import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'
const SYSTEM_THEME_COLORS = [
  '#409eff',
  '#009688',
  '#536dfe',
  '#ff5c93',
  '#ee4f12',
  '#0096c7',
  '#9c27b0',
  '#ff9800'
]
const HEADER_THEME_COLORS = [
  '#fff',
  '#151515',
  '#5172dc',
  '#e74c3c',
  '#24292e',
  '#394664',
  '#009688',
  '#383f45'
]
const MENU_THEME_COLORS = [
  '#fff',
  '#001529',
  '#212121',
  '#273352',
  '#191b24',
  '#383f45',
  '#001628',
  '#344058'
]

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

const parseThemeConfig = (serialized: string | null | undefined) => {
  expect(serialized, '主题配置接口应返回 themeConfig').toBeTruthy()
  return JSON.parse(serialized as string) as {
    layout: string
    isDark: boolean
    breadcrumb: boolean
    tagsView: boolean
    fixedMenu: boolean
    theme: {
      elColorPrimary: string
      topHeaderBgColor: string
      leftMenuBgColor: string
    }
  }
}

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
  expect(inputCount).toBeGreaterThanOrEqual(2)
  if (inputCount >= 3) {
    await inputs.nth(0).fill('xpy')
  }
  await inputs.nth(inputCount - 2).fill('admin')
  await inputs.nth(inputCount - 1).fill('admin123')

  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/system/auth/login') && response.request().method() === 'POST'
  )
  const themeLoadPromise = waitForThemeLoad(page)
  await form.locator('button').last().click()

  const loginResponse = await loginResponsePromise
  expect(loginResponse.ok()).toBeTruthy()
  const loginBody = (await loginResponse.json()) as {
    data?: {
      accessToken?: string
    }
  }
  const themeResponse = await themeLoadPromise
  expect(themeResponse.ok()).toBeTruthy()

  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('.v-setting')).toBeVisible()

  const themeBody = (await themeResponse.json()) as {
    data?: {
      themeConfig?: string
    }
  }
  const originalThemeConfig = themeBody.data?.themeConfig || null
  if (originalThemeConfig) {
    const expectedIsDark = parseThemeConfig(originalThemeConfig).isDark
    await expect
      .poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
      .toBe(expectedIsDark)
  }

  return {
    accessToken: loginBody.data?.accessToken,
    originalThemeConfig
  }
}

async function openSettings(page: Page) {
  await page.locator('.v-setting').click()
  const drawer = page.locator('.el-drawer:visible')
  await expect(drawer).toBeVisible()
  return drawer
}

/**
 * 选一个颜色，并保证它与当前选中的不是同一个
 *
 * 点已经选中的颜色不会改变配置，也就不会触发保存请求，waitForThemeSave 会一直等到超时。
 * 这不是假设：上一轮就是因为库里残留了上次跑测留下的主题色，正好等于用例要点的那个，
 * 用例从此每次必挂。所以这里跟 selectDifferentLayout 一样，先看当前是哪个再挑。
 */
async function selectColor(
  page: Page,
  drawer: ReturnType<typeof page.locator>,
  pickerIndex: number,
  colors: string[],
  preferredIndex: number
) {
  const picker = drawer.locator('.v-color-radio-picker').nth(pickerIndex)
  const options = picker.locator('span')
  await expect(options.nth(preferredIndex)).toBeVisible()

  const activeClass = (await options.nth(preferredIndex).getAttribute('class')) || ''
  const targetIndex = activeClass.includes('is-active')
    ? (preferredIndex + 1) % colors.length
    : preferredIndex
  const target = options.nth(targetIndex)

  const savePromise = waitForThemeSave(page)
  await target.click()
  const saveResponse = await savePromise
  expect(saveResponse.ok()).toBeTruthy()
  await expect(target).toHaveClass(/is-active/)
  return { index: targetIndex, value: colors[targetIndex] }
}

async function selectDifferentLayout(page: Page, drawer: ReturnType<typeof page.locator>) {
  const layoutPicker = drawer.locator('.v-layout-radio-picker')
  const current = layoutPicker.locator('.is-acitve')
  const currentClass = (await current.getAttribute('class')) || ''
  const targetClass = currentClass.includes('sidebar-nav')
    ? 'v-layout-radio-picker__header-nav'
    : 'v-layout-radio-picker__sidebar-nav'
  const target = layoutPicker.locator(`.${targetClass}`)
  const savePromise = waitForThemeSave(page)
  await target.click()
  const saveResponse = await savePromise
  expect(saveResponse.ok()).toBeTruthy()
  await expect(target).toHaveClass(/is-acitve/)

  // 侧边栏布局才展示菜单主题选择器，完成布局持久化验证后回到该布局继续验证。
  if (targetClass !== 'v-layout-radio-picker__sidebar-nav') {
    const sidebarLayout = layoutPicker.locator('.v-layout-radio-picker__sidebar-nav')
    const sidebarSavePromise = waitForThemeSave(page)
    await sidebarLayout.click()
    const sidebarSaveResponse = await sidebarSavePromise
    expect(sidebarSaveResponse.ok()).toBeTruthy()
    await expect(sidebarLayout).toHaveClass(/is-acitve/)
  }
  return 'sidebar-nav'
}

/**
 * 按标签文案定位「界面显示」里的开关
 *
 * 原先按下标定位，界面上增删任何一个开关都会让后面所有断言错位
 * （移除「页脚」开关时就是这么坏的：nth(17) 从「固定菜单」变成了水印输入框）。
 * 用精确匹配：「面包屑」若按包含匹配会同时命中「面包屑图标」。
 */
function interfaceSwitch(drawer: ReturnType<Page['locator']>, label: string) {
  return drawer
    .locator('.v-interface-display > div')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('.el-switch')
    .first()
}

async function toggleInterfaceOption(
  page: Page,
  drawer: ReturnType<typeof page.locator>,
  label: string
) {
  const option = interfaceSwitch(drawer, label)
  const initialChecked = (await option.getAttribute('class'))?.includes('is-checked') || false
  const savePromise = waitForThemeSave(page)
  await option.click()
  const saveResponse = await savePromise
  expect(saveResponse.ok()).toBeTruthy()
  if (initialChecked) {
    await expect(option).not.toHaveClass(/is-checked/)
  } else {
    await expect(option).toHaveClass(/is-checked/)
  }
  return !initialChecked
}

async function restoreTheme(
  request: APIRequestContext,
  accessToken: string | undefined,
  themeConfig: string | null
) {
  if (!accessToken) {
    return
  }
  const response = await request.put(`${API_BASE_URL}/system/user/profile/theme`, {
    data: { themeConfig: themeConfig || '{}' },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'tenant-id': TENANT_ID
    }
  })
  if (!response.ok()) {
    console.warn(`恢复主题配置失败，HTTP 状态码：${response.status()}`)
  }
}

test('主题配置应保存到数据库并在刷新及新浏览器上下文中恢复', async ({ browser, page, request }) => {
  let session: Awaited<ReturnType<typeof login>> | undefined
  let secondContext

  try {
    session = await login(page)
    const drawer = await openSettings(page)

    const layoutValue = await selectDifferentLayout(page, drawer)
    const systemColor = await selectColor(page, drawer, 0, SYSTEM_THEME_COLORS, 2)
    const headerColor = await selectColor(page, drawer, 1, HEADER_THEME_COLORS, 3)
    const menuColor = await selectColor(page, drawer, 2, MENU_THEME_COLORS, 4)

    const darkSwitch = drawer.locator('.v-theme-switch')
    const isDark = await page
      .locator('html')
      .evaluate((element) => element.classList.contains('dark'))
    if (!isDark) {
      const darkSavePromise = waitForThemeSave(page)
      await darkSwitch.click()
      const darkSaveResponse = await darkSavePromise
      expect(darkSaveResponse.ok()).toBeTruthy()
    }
    await expect(page.locator('html')).toHaveClass(/dark/)

    const breadcrumbValue = await toggleInterfaceOption(page, drawer, '面包屑')
    const tagsViewValue = await toggleInterfaceOption(page, drawer, '标签页')
    const fixedMenuValue = await toggleInterfaceOption(page, drawer, '固定菜单')

    const reloadThemePromise = waitForThemeLoad(page)
    await page.reload()
    const reloadThemeResponse = await reloadThemePromise
    expect(reloadThemeResponse.ok()).toBeTruthy()
    const savedTheme = parseThemeConfig((await reloadThemeResponse.json()).data?.themeConfig)
    expect(savedTheme.layout).toBe(layoutValue)
    expect(savedTheme.isDark).toBe(true)
    expect(savedTheme.breadcrumb).toBe(breadcrumbValue)
    expect(savedTheme.tagsView).toBe(tagsViewValue)
    expect(savedTheme.fixedMenu).toBe(fixedMenuValue)
    expect(savedTheme.theme.elColorPrimary).toBe(systemColor.value)
    expect(savedTheme.theme.topHeaderBgColor).toBe(headerColor.value)
    expect(savedTheme.theme.leftMenuBgColor).toBe(menuColor.value)
    await expect(page.locator('html')).toHaveClass(/dark/)

    const reloadedDrawer = await openSettings(page)
    await expect(
      reloadedDrawer.locator('.v-color-radio-picker').nth(0).locator('span').nth(systemColor.index)
    ).toHaveClass(/is-active/)
    await expect(
      reloadedDrawer.locator('.v-color-radio-picker').nth(1).locator('span').nth(headerColor.index)
    ).toHaveClass(/is-active/)
    await expect(
      reloadedDrawer.locator('.v-color-radio-picker').nth(2).locator('span').nth(menuColor.index)
    ).toHaveClass(/is-active/)
    if (breadcrumbValue) {
      await expect(interfaceSwitch(reloadedDrawer, '面包屑')).toHaveClass(/is-checked/)
    } else {
      await expect(interfaceSwitch(reloadedDrawer, '面包屑')).not.toHaveClass(/is-checked/)
    }
    if (tagsViewValue) {
      await expect(interfaceSwitch(reloadedDrawer, '标签页')).toHaveClass(/is-checked/)
    } else {
      await expect(interfaceSwitch(reloadedDrawer, '标签页')).not.toHaveClass(/is-checked/)
    }
    if (fixedMenuValue) {
      await expect(interfaceSwitch(reloadedDrawer, '固定菜单')).toHaveClass(/is-checked/)
    } else {
      await expect(interfaceSwitch(reloadedDrawer, '固定菜单')).not.toHaveClass(/is-checked/)
    }

    secondContext = await browser.newContext({ locale: 'zh-CN' })
    const secondPage = await secondContext.newPage()
    await login(secondPage)
    await expect(secondPage.locator('html')).toHaveClass(/dark/)

    const secondDrawer = await openSettings(secondPage)
    await expect(
      secondDrawer.locator('.v-color-radio-picker').nth(0).locator('span').nth(systemColor.index)
    ).toHaveClass(/is-active/)
    await expect(
      secondDrawer.locator('.v-color-radio-picker').nth(1).locator('span').nth(headerColor.index)
    ).toHaveClass(/is-active/)
    await expect(
      secondDrawer.locator('.v-color-radio-picker').nth(2).locator('span').nth(menuColor.index)
    ).toHaveClass(/is-active/)
    if (fixedMenuValue) {
      await expect(interfaceSwitch(secondDrawer, '固定菜单')).toHaveClass(/is-checked/)
    } else {
      await expect(interfaceSwitch(secondDrawer, '固定菜单')).not.toHaveClass(/is-checked/)
    }
  } finally {
    await secondContext?.close()
    await restoreTheme(request, session?.accessToken, session?.originalThemeConfig)
  }
})
