import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 属性面板 · 数据脱敏配置项
 *
 * 服务端的 FormDataMasker 按 `props.maskRule` 决定遮不遮，而这一项要真的
 * 出现在属性面板里，普通用户才配得上 —— 否则脱敏就只有写脚本的人用得上。
 *
 * 入口是 `useMaskRule` 通过 `appendComponentProps` 追加的，控件范围取自契约的
 * `maskable` 位。这条链路上任意一环断掉（契约位被清、注册被别的追加项顶掉、
 * 菜单名与规则类型不同名）都不会报错，表现就是「面板里没有这一项」。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

async function login(page: Page): Promise<string> {
  await page.goto('/login')
  const form = page
    .locator('form.login-form')
    .filter({ has: page.locator('input[type="password"]') })
    .filter({ has: page.locator('input[type="checkbox"]') })
    .first()
  await expect(form).toBeVisible()
  const inputs = form.locator('input:visible')
  const count = await inputs.count()
  if (count >= 3) await inputs.nth(0).fill('xpy')
  await inputs.nth(count - 2).fill('admin')
  await inputs.nth(count - 1).fill('admin123')
  const loginPromise = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  const response = await loginPromise
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
  return body.data?.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

async function createForm(request: APIRequestContext, token: string): Promise<number> {
  const resp = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: '脱敏面板用例',
      code: `e2e_mask_panel_${Date.now()}`,
      formType: 1,
      formConf: JSON.stringify({ form: { labelWidth: '100px' } }),
      formFields: [JSON.stringify({ type: 'input', field: 'phone', title: '手机号', props: {} })]
    }
  })
  expect(resp.ok()).toBeTruthy()
  return ((await resp.json()) as { data: number }).data
}

async function deleteForm(request: APIRequestContext, token: string, id: number) {
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, {
    headers: authHeaders(token)
  })
}

test.describe('属性面板 · 数据脱敏', () => {
  test('⚠️ 输入框的属性面板里有「数据脱敏」，且能选到具体策略', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token)
    try {
      await page.goto(`/infra/online/editor?id=${id}`)
      await page.getByText('表单设计', { exact: true }).last().click()
      await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })

      // 从左侧面板拖一个输入框进来，属性面板随之打开。
      // 用精确匹配：「输入框」是「多行输入框」「密码输入框」的前缀，
      // 宽松匹配会一次命中三个，first() 拿到哪个取决于渲染顺序
      await page
        .locator('._fc-l-item')
        .filter({ hasText: /^输入框$/ })
        .first()
        .click()
      const props = page.locator('._fc-r-tab-props')
      await expect(props).toBeVisible({ timeout: 20_000 })

      // 入口确实在面板里
      const maskItem = props.locator('.el-form-item').filter({ hasText: '数据脱敏' })
      await expect(maskItem).toBeVisible({ timeout: 15_000 })

      // 不只是标签存在 —— 要真能选出一个策略
      await maskItem.locator('.el-select').first().click()
      const dropdown = page.locator('.el-select-dropdown').filter({ visible: true }).last()
      await expect(dropdown.getByRole('option', { name: /手机号/ })).toBeVisible({ timeout: 10_000 })
      await expect(dropdown.getByRole('option', { name: /身份证/ })).toBeVisible()
      await expect(dropdown.getByRole('option', { name: /不脱敏/ })).toBeVisible()
    } finally {
      await deleteForm(request, token, id)
    }
  })
})
