import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 脱敏字段「查看明文」的端到端验证
 *
 * 详情接口对脱敏字段返回掩码，用户在编辑页看到的是 `138****5678`，
 * 既核对不了原值也改不明白。这里加的是「点一下取一个字段的明文」。
 *
 * 两条底线要同时守住：
 * 1. 默认仍是掩码 —— 不点就看不到明文，编辑页不会一次性把敏感值全泄出去
 * 2. 服务端只对**确实配了脱敏**的字段放行 —— 否则这个接口就成了
 *    「任意行 + 任意列 → 明文」的读取口，比不脱敏还糟
 *
 * ⚠️ 独立权限点与审计日志本轮未做，当前凡能编辑该表单数据的人都点得动。
 * 那部分补上后，这里要加「无权限时按钮不可用」的用例。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 由 script/form-demo/__seed_plain_probe.py 造出来的表单 */
const FORM_CODE = 'e2e_plain_probe'
const PLAIN_MOBILE = '13812345678'
const MASKED_MOBILE = '138****5678'

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

test.describe('脱敏字段查看明文 · 接口层', () => {
  test('⚠️ 详情接口默认仍返回掩码', async ({ page, request }) => {
    const token = await login(page)
    const resp = await request.get(
      `${API_BASE_URL}/infra/form-design/runtime/${FORM_CODE}/get?id=1`,
      { headers: authHeaders(token) }
    )
    const body = (await resp.json()) as any
    expect(body.code).toBe(0)
    expect(body.data.mobile, '详情不该下发明文').toBe(MASKED_MOBILE)
  })

  test('⚠️ 按字段取明文能拿到真实值', async ({ page, request }) => {
    const token = await login(page)
    const resp = await request.get(
      `${API_BASE_URL}/infra/form-design/runtime/${FORM_CODE}/plain-field?id=1&field=mobile`,
      { headers: authHeaders(token) }
    )
    const body = (await resp.json()) as any
    expect(body.code, `取明文失败：${body.msg}`).toBe(0)
    expect(body.data).toBe(PLAIN_MOBILE)
  })

  test('⚠️ 没配脱敏的字段一律拒绝 —— 否则这就是任意列明文读取口', async ({ page, request }) => {
    const token = await login(page)
    for (const field of ['cust_name', 'amount', 'creator', 'id']) {
      const resp = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${FORM_CODE}/plain-field?id=1&field=${field}`,
        { headers: authHeaders(token) }
      )
      const body = (await resp.json()) as any
      expect(body.code, `字段 ${field} 没配脱敏，不该放行`).not.toBe(0)
      expect(body.msg).toContain('没有配置脱敏')
    }
  })

  test('数据不存在时报「数据不存在」，而不是返回空明文', async ({ page, request }) => {
    const token = await login(page)
    const resp = await request.get(
      `${API_BASE_URL}/infra/form-design/runtime/${FORM_CODE}/plain-field?id=99999999&field=mobile`,
      { headers: authHeaders(token) }
    )
    const body = (await resp.json()) as any
    expect(body.code).not.toBe(0)
  })
})

test.describe('脱敏字段查看明文 · 界面', () => {
  test('⚠️ 编辑页默认显示掩码，点按钮后变成明文', async ({ page }) => {
    await login(page)
    // 走静态预览路由而不是发布生成的菜单路由：新菜单要分配给角色、
    // 再重新登录才会注册动态路由。这与 form-design-demos.spec.ts 的做法一致
    await page.goto(`/infra-form-design/preview?code=${FORM_CODE}`)

    const editButton = page.getByRole('button', { name: /编\s*辑/ }).first()
    await expect(editButton).toBeVisible({ timeout: 30_000 })
    await editButton.click()

    // 表单容器不要写死 .el-dialog —— 呈现方式由 listConf.formViewMode 决定
    const panel = page.locator('.el-dialog:visible, .el-drawer:visible, .inline-panel').first()
    await expect(panel).toBeVisible({ timeout: 20_000 })

    // 默认是掩码
    const mobileInput = panel.locator('input').nth(1)
    await expect(mobileInput, '编辑页默认应显示掩码').toHaveValue(MASKED_MOBILE, {
      timeout: 20_000
    })

    // 「查看明文」挂在输入框的 append 位置
    const toggle = panel.getByRole('button', { name: '查看明文' }).first()
    await expect(toggle, 'append 位置应当有「查看明文」按钮').toBeVisible({ timeout: 10_000 })

    const plainPromise = page.waitForResponse((r) => r.url().includes('/plain-field'))
    await toggle.click()
    const resp = await plainPromise
    expect(resp.ok()).toBeTruthy()

    // 换成真实值，此时改了保存就是改真实值
    await expect(mobileInput).toHaveValue(PLAIN_MOBILE, { timeout: 15_000 })
  })
})
