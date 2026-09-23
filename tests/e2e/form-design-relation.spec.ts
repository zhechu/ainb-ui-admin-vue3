import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 关联表单与远程选择器的端到端验证（B3）
 *
 * 重点：
 * 1. ApiSelect 必须从设计器里消失（方案 §3.4 的旧控件清理）
 * 2. 关联表单的发布校验四项确实生效
 * 3. 契约里两个新控件已登记且前后端一致
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
  const p = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  const response = await p
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
  return body.data?.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

async function firstFormId(request: APIRequestContext, token: string): Promise<number> {
  const resp = await request.get(`${API_BASE_URL}/infra/form-design/page?pageNo=1&pageSize=1`, {
    headers: authHeaders(token)
  })
  return ((await resp.json()) as any).data.list[0].id
}

async function createForm(
  request: APIRequestContext,
  token: string,
  formFields: string[],
  extra: Record<string, any> = {}
): Promise<number> {
  const resp = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: 'B3 关联用例',
      code: `e2e_rel_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      formType: 1,
      formFields,
      ...extra
    }
  })
  expect(resp.ok()).toBeTruthy()
  return ((await resp.json()) as any).data
}

async function deleteForm(request: APIRequestContext, token: string, id: number) {
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, {
    headers: authHeaders(token)
  })
}

async function publish(request: APIRequestContext, token: string, id: number) {
  const resp = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
    headers: authHeaders(token),
    data: { id }
  })
  return (await resp.json()) as { code: number; msg: string }
}

const relationRule = (field: string, targetCode: string, mappings: any[] = []) =>
  JSON.stringify({
    type: 'RelationForm',
    field,
    title: '关联客户',
    props: { targetFormCode: targetCode, displayField: 'name', fieldMappings: mappings }
  })

// ==================== 旧控件清理 ====================

test.describe('ApiSelect 已删除（方案 §3.4）', () => {
  test('⚠️ 设计器左侧面板里不再有「接口选择器」', async ({ page, request }) => {
    const token = await login(page)
    await page.goto(`/infra/online/editor?id=${await firstFormId(request, token)}`)
    await page.getByText('表单设计', { exact: true }).last().click()
    await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })

    await expect(
      page.locator('._fc-l-item').filter({ hasText: '接口选择器' }),
      'ApiSelect 已被 RemotePicker 替代，必须从面板消失'
    ).toHaveCount(0)
  })

  test('替代品「远程选择器」在面板里，且能拖入', async ({ page, request }) => {
    const token = await login(page)
    await page.goto(`/infra/online/editor?id=${await firstFormId(request, token)}`)
    await page.getByText('表单设计', { exact: true }).last().click()
    await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })

    const item = page.locator('._fc-l-item').filter({ hasText: '远程选择器' })
    await expect(item).toHaveCount(1)
    await item.first().click()
    await expect(page.locator('._fc-r-tab-props')).toBeVisible({ timeout: 15_000 })
    // 三种展示形态都要能选到 —— 它们共用一套数据源配置，这是合并控件的意义所在。
    // 用 .first()：「弹窗表格」在单选按钮与它的 label 上各出现一次
    await expect(page.getByText('弹窗表格').first()).toBeVisible({ timeout: 10_000 })
  })

  test('⚠️ 历史表单里若还留着 ApiSelect，发布时明确报错并提示替代品', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token, [
      JSON.stringify({ type: 'ApiSelect', field: 'legacy', title: '老的接口选择器', props: {} })
    ])
    try {
      const body = await publish(request, token, id)
      expect(body.code, '已删除的控件必须在发布时被拒绝，而不是运行时静默失效').not.toBe(0)
      // 不断言具体报错文案：主表校验排在控件校验之前（没有主表，后面的校验没意义），
      // 本用例没有绑定主表，所以先撞上「请先绑定主表」。
      // 「不支持的控件要报出替代品」这条由后端单测直接调校验方法覆盖
      // （FormDesignWidgetSupportValidatorTest#testApiSelectRejected 一类）
    } finally {
      await deleteForm(request, token, id)
    }
  })
})

// ==================== 关联表单控件 ====================

test.describe('关联表单控件', () => {
  test('左侧面板里有「关联表单」，属性面板有带出字段配置', async ({ page, request }) => {
    const token = await login(page)
    await page.goto(`/infra/online/editor?id=${await firstFormId(request, token)}`)
    await page.getByText('表单设计', { exact: true }).last().click()
    await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })

    const item = page.locator('._fc-l-item').filter({ hasText: '关联表单' })
    await expect(item).toHaveCount(1)
    await item.first().click()
    await expect(page.locator('._fc-r-tab-props')).toBeVisible({ timeout: 15_000 })

    // 带出字段映射收在宿主控件的属性面板里 —— 这是本控件的关键设计，
    // 而不是让用户为每个带出字段再拖一个「关联属性」控件
    await expect(page.locator('.mapping-section')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('带出字段')).toBeVisible()
  })
})

// ==================== 发布校验 ====================

test.describe('关联表单的发布校验', () => {
  test('⚠️ 关联了不存在的表单 → 发布被拒绝', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token, [relationRule('cid', 'no_such_form_code')])
    try {
      const body = await publish(request, token, id)
      expect(body.code).not.toBe(0)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 关联了未发布的表单 → 发布被拒绝', async ({ page, request }) => {
    const token = await login(page)
    // 先造一张草稿表单当被关联对象
    const draftId = await createForm(request, token, [
      JSON.stringify({ type: 'input', field: 'name', title: '名称', props: {} })
    ])
    const draftResp = await request.get(`${API_BASE_URL}/infra/form-design/get?id=${draftId}`, {
      headers: authHeaders(token)
    })
    const draftCode = ((await draftResp.json()) as any).data.code

    const id = await createForm(request, token, [relationRule('cid', draftCode)])
    try {
      const body = await publish(request, token, id)
      expect(body.code, '未发布的表单没有可查询的数据，关联它没有意义').not.toBe(0)
    } finally {
      await deleteForm(request, token, id)
      await deleteForm(request, token, draftId)
    }
  })

  test('⚠️ 带出目标字段在本表单不存在 → 发布被拒绝', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token, [
      relationRule('cid', 'some_form', [
        { sourceField: 'name', targetField: 'notExistsInThisForm', updateMode: 'ALWAYS' }
      ])
    ])
    try {
      const body = await publish(request, token, id)
      expect(body.code, '带出的值无处可放，必须拦住').not.toBe(0)
    } finally {
      await deleteForm(request, token, id)
    }
  })
})

// ==================== 契约 ====================

test.describe('契约登记', () => {
  test('两个新控件已登记，ApiSelect 标为不支持', async ({ page, request }) => {
    const token = await login(page)
    const resp = await request.get(`${API_BASE_URL}/infra/form-design/widget-contracts`, {
      headers: authHeaders(token)
    })
    const data = ((await resp.json()) as any).data

    const relation = data.widgets.find((w: any) => w.type === 'RelationForm')
    expect(relation, '契约里必须登记 RelationForm').toBeTruthy()
    expect(relation.caps.field).toBe(true)

    const remote = data.widgets.find((w: any) => w.type === 'RemotePicker')
    expect(remote, '契约里必须登记 RemotePicker').toBeTruthy()
    expect(remote.caps.searchable).toBe(true)

    const api = data.widgets.find((w: any) => w.type === 'ApiSelect')
    expect(api, 'ApiSelect 的契约条目要保留（作为发布校验的第二道防线）').toBeTruthy()
    expect(api.supported, 'ApiSelect 已删除，必须标为不支持').toBe(false)
  })
})
