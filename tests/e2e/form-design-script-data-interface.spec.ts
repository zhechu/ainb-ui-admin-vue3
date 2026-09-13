import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 前端脚本调用数据接口的端到端验证
 *
 * 沙箱原先刻意不提供任何后端入口。现在开了一个受控的口子 `callDataInterface`：
 * 只能按编码调「数据接口」模块里已登记并启用的接口，服务端强制只读
 * （SQL 仅 SELECT、HTTP 仅 GET/HEAD），走的是仅需登录态的运行时端点。
 *
 * 这里验的是**真实链路**：脚本 → 沙箱 → 运行时端点 → 真实接口 → 拿到数据并影响提交。
 * 单测里 callDataInterface 是 mock 的，证明不了这条链真的通。
 *
 * 同时守住边界：fetch / XHR / WebSocket 这些能打任意 URL 的东西仍然一个都拿不到。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 示例数据里的只读接口，返回商品选项（含 value/label/price） */
const DATA_INTERFACE_CODE = 'test_demo_product_options'

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

async function deleteForm(request: APIRequestContext, token: string, id: number) {
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, {
    headers: authHeaders(token)
  })
}

test.describe('脚本调用数据接口', () => {
  test('⚠️ 运行时端点真的能按编码取到数据，且只需登录态', async ({ page, request }) => {
    const token = await login(page)
    // 这一条不经过界面：先确认脚本将要依赖的那个端点本身是通的，
    // 后面界面用例失败时才能区分「是脚本没跑」还是「接口本身不通」
    const resp = await request.post(
      `${API_BASE_URL}/infra/data-interface/options?code=${DATA_INTERFACE_CODE}`,
      { headers: authHeaders(token), data: {} }
    )
    expect(resp.ok()).toBeTruthy()
    const body = (await resp.json()) as any
    expect(body.code, `运行时取数失败：${body.msg}`).toBe(0)
  })

  test('⚠️ 沙箱里 callDataInterface 可用，而 fetch/XHR 仍然拿不到', async ({ page }) => {
    await login(page)
    // 直接在页面上下文里跑一段沙箱脚本，验证注入的能力边界。
    // 走真实的 sandbox 模块，不是复刻一份判断逻辑
    const probe = await page.evaluate(async () => {
      const mod = await import('/src/components/FormScript/sandbox.ts')
      const ctx: any = {
        formData: {},
        setFieldValue() {},
        getFieldValue() {},
        setVisible() {},
        setRequired() {},
        setDisabled() {},
        message: { success() {}, warning() {}, error() {}, confirm: async () => true },
        utils: { formatDate: () => '', formatMoney: () => '', uuid: () => '' },
        callDataInterface: async () => [{ ok: 1 }]
      }
      return {
        call: mod.runScript('return typeof callDataInterface', ctx).value,
        fetch: mod.runScript('return typeof fetch', ctx).value,
        xhr: mod.runScript('return typeof XMLHttpRequest', ctx).value,
        ws: mod.runScript('return typeof WebSocket', ctx).value
      }
    })
    expect(probe.call, 'callDataInterface 应当可用').toBe('function')
    expect(probe.fetch, 'fetch 必须仍然拿不到').toBe('undefined')
    expect(probe.xhr, 'XMLHttpRequest 必须仍然拿不到').toBe('undefined')
    expect(probe.ws, 'WebSocket 必须仍然拿不到').toBe('undefined')
  })

  test('⚠️ beforeSubmit 里 await 真实接口，结果能决定放不放行', async ({ page }) => {
    await login(page)
    // 用真实的 runSubmitHook + 真实的 fetchOptions，只有 DOM 提示是桩
    const result = await page.evaluate(async (code) => {
      const [sandbox, api] = await Promise.all([
        import('/src/components/FormScript/sandbox.ts'),
        import('/src/api/infra/dataInterface/index.ts')
      ])
      const ctx: any = {
        formData: {},
        setFieldValue() {},
        getFieldValue() {},
        setVisible() {},
        setRequired() {},
        setDisabled() {},
        message: { success() {}, warning() {}, error() {}, confirm: async () => true },
        utils: { formatDate: () => '', formatMoney: () => '', uuid: () => '' },
        callDataInterface: (c: string, args: any) => api.fetchOptions(c, args ?? {})
      }
      const hook = `
        const rows = await callDataInterface('${code}', {})
        if (!rows || rows.length === 0) { return false }
        return true
      `
      const r = await sandbox.runSubmitHook(hook, ctx, 'BLOCK', 8000)
      return { ok: r.ok, value: r.value, timedOut: r.timedOut }
    }, DATA_INTERFACE_CODE)

    expect(result.timedOut, '不该超时').toBeFalsy()
    expect(result.ok).toBe(true)
    // 示例接口有数据 → 脚本返回 true → 放行
    expect(result.value, '接口取到数据时应放行').toBe(true)
  })

  test('⚠️ 接口取不到数据时，脚本能据此阻断提交', async ({ page }) => {
    await login(page)
    const result = await page.evaluate(async () => {
      const [sandbox, api] = await Promise.all([
        import('/src/components/FormScript/sandbox.ts'),
        import('/src/api/infra/dataInterface/index.ts')
      ])
      const ctx: any = {
        formData: {},
        setFieldValue() {},
        getFieldValue() {},
        setVisible() {},
        setRequired() {},
        setDisabled() {},
        message: { success() {}, warning() {}, error() {}, confirm: async () => true },
        utils: { formatDate: () => '', formatMoney: () => '', uuid: () => '' },
        // 编码不存在 → 运行时端点报错 → 宿主实现记日志并返回 null
        callDataInterface: async (c: string, args: any) => {
          try {
            return await api.fetchOptions(c, args ?? {})
          } catch {
            return null
          }
        }
      }
      const hook = `
        const rows = await callDataInterface('definitely_not_exist_code', {})
        return !!rows
      `
      const r = await sandbox.runSubmitHook(hook, ctx, 'BLOCK', 8000)
      return { ok: r.ok, value: r.value }
    })

    // 取不到就返回 false，提交被拦住 —— 而不是脚本崩掉导致整个提交失败
    expect(result.ok).toBe(true)
    expect(result.value).toBe(false)
  })
})
