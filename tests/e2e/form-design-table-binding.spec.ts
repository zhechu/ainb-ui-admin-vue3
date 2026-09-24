import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 数据绑定步骤的端到端验证
 *
 * 覆盖表名旁的两个快捷动作：复制表名、跳到业务数据。
 * 两个都是「点了要真的发生点什么」的功能 —— 复制要真进剪贴板，
 * 跳转要真到业务数据页并定位到这张表，所以断言都落在结果上而不是按钮可见性上。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 这张表在示例数据里已纳入数据建模，跳转用例依赖它 */
const MODELED_TABLE = 'test_customer'

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

/** 造一张绑定了指定主表的草稿表单 */
async function createBoundForm(
  request: APIRequestContext,
  token: string,
  mainTable: string
): Promise<number> {
  const resp = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: '绑定步骤用例',
      code: `e2e_binding_${Date.now()}`,
      formType: 1,
      formConf: JSON.stringify({ form: { labelWidth: '100px' } }),
      formFields: [
        JSON.stringify({ type: 'input', field: 'name', title: '名称', props: {} })
      ],
      dataSourceConfigId: 0,
      mainTable,
      mainPk: 'id',
      pkStrategy: 'AUTO'
    }
  })
  expect(resp.ok(), '造用例表单失败').toBeTruthy()
  return ((await resp.json()) as { data: number }).data
}

async function deleteForm(request: APIRequestContext, token: string, id: number) {
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, {
    headers: authHeaders(token)
  })
}

/** 打开设计器并切到「数据绑定」这一步 */
async function openBindingStep(page: Page, id: number) {
  await page.goto(`/infra/online/editor?id=${id}`)
  await page.getByText('数据绑定', { exact: true }).last().click()
  await expect(page.locator('.table-field').first()).toBeVisible({ timeout: 30_000 })
}

test.describe('数据绑定 · 表名快捷动作', () => {
  test('⚠️ 复制表名要真的进剪贴板', async ({ page, request, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const token = await login(page)
    const id = await createBoundForm(request, token, MODELED_TABLE)
    try {
      await openBindingStep(page, id)

      // 主表那一行的第一个按钮是「复制表名」
      await page.locator('.table-field .table-quick-actions button').first().click()
      await expect(page.getByText(`已复制表名：${MODELED_TABLE}`)).toBeVisible({ timeout: 10_000 })

      // 断言落在剪贴板真实内容上 —— 只验提示的话，copy 静默失败也照样绿
      const clipboard = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboard, '剪贴板内容不对').toBe(MODELED_TABLE)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 点业务数据要跳到该表的数据页并带上 modelId', async ({ page, request }) => {
    const token = await login(page)
    const id = await createBoundForm(request, token, MODELED_TABLE)
    try {
      await openBindingStep(page, id)

      // 先取该表的数据模型 id，用来核对跳转带的参数确实是这张表
      const modelResp = await request.get(
        `${API_BASE_URL}/infra/data-model/page?pageNo=1&pageSize=50&tableName=${MODELED_TABLE}`,
        { headers: authHeaders(token) }
      )
      const list = ((await modelResp.json()) as any).data.list as any[]
      const expected = list.find((m) => m.tableName === MODELED_TABLE)
      expect(expected, `示例数据里应当有 ${MODELED_TABLE} 的数据模型`).toBeTruthy()

      await page.locator('.table-field .table-quick-actions button').nth(1).click()

      await page.waitForURL(/data-model-data/, { timeout: 20_000 })
      expect(new URL(page.url()).searchParams.get('modelId')).toBe(String(expected.id))
      // 跳过去要真的定位到这张表，而不是停在「请选择模型」
      await expect(page.getByText(MODELED_TABLE).first()).toBeVisible({ timeout: 20_000 })
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('表没有对应数据模型时，说清楚下一步该做什么', async ({ page, request }) => {
    const token = await login(page)
    // 建模里不会有这张表 —— 它只存在于表单绑定里
    const id = await createBoundForm(request, token, 'e2e_not_modeled_table')
    try {
      await openBindingStep(page, id)
      await page.locator('.table-field .table-quick-actions button').nth(1).click()

      // 不能只说「没找到」，要指出去哪儿补。
      // 对同一个元素断言而不是分两次 getByText：「数据建模」在左侧菜单里也有
      // （strict mode 会因匹配到多个而失败），而且提示条几秒后就自己淡出了
      const warning = page.locator('.el-message').filter({ hasText: /还没有对应的数据模型/ })
      await expect(warning).toBeVisible({ timeout: 15_000 })
      await expect(warning).toContainText('数据建模')
      // 没找到就不该跳走（仍停在编辑器；编辑器路由随「在线开发」菜单重组为 /infra/online/editor）
      expect(page.url()).toContain('/infra/online/editor')
    } finally {
      await deleteForm(request, token, id)
    }
  })
})
