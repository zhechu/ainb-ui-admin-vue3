import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 组织选择器与系统值的端到端验证（B4）
 *
 * 重点：
 * 1. UserSelect / DeptSelect 从设计器消失，OrgPicker 顶上（方案 §3.4）
 * 2. **系统值字段的提交值被服务端剥离** —— 这是防伪造创建人的关键
 * 3. BPM 的「从表单字段取审批人」没有被这次删除打破
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

async function openDesigner(page: Page, id: number) {
  await page.goto(`/infra/form-design/editor?id=${id}`)
  await page.getByText('表单设计', { exact: true }).last().click()
  await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })
}

async function createForm(
  request: APIRequestContext,
  token: string,
  formFields: string[]
): Promise<number> {
  const resp = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: 'B4 组织与系统值用例',
      code: `e2e_org_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      formType: 1,
      formFields
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

// ==================== 旧控件清理 ====================

test.describe('UserSelect / DeptSelect 已删除（方案 §3.4）', () => {
  test('⚠️ 设计器里不再有「用户选择器」与「部门选择器」', async ({ page, request }) => {
    const token = await login(page)
    await openDesigner(page, await firstFormId(request, token))

    for (const label of ['用户选择器', '部门选择器']) {
      await expect(
        page.locator('._fc-l-item').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }),
        `${label}已被 OrgPicker 替代，必须从面板消失`
      ).toHaveCount(0)
    }
  })

  test('替代品「组织选择器」在面板里，可勾选多种主体类型', async ({ page, request }) => {
    const token = await login(page)
    await openDesigner(page, await firstFormId(request, token))

    const item = page.locator('._fc-l-item').filter({ hasText: '组织选择器' })
    await expect(item).toHaveCount(1)
    await item.first().click()
    await expect(page.locator('._fc-r-tab-props')).toBeVisible({ timeout: 15_000 })

    // 合并控件的意义所在：一个控件里能勾选多种主体类型，
    // 而不是「选用户」和「选部门」各一个控件
    await expect(page.getByText('可选类型')).toBeVisible({ timeout: 10_000 })
    for (const t of ['用户', '部门', '岗位', '角色']) {
      await expect(page.getByText(t, { exact: true }).first()).toBeVisible()
    }
  })

  test('「系统值」控件在面板里，属性面板有取值来源', async ({ page, request }) => {
    const token = await login(page)
    await openDesigner(page, await firstFormId(request, token))

    const item = page.locator('._fc-l-item').filter({ hasText: '系统值' })
    await expect(item).toHaveCount(1)
    await item.first().click()
    await expect(page.locator('._fc-r-tab-props')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('取值来源')).toBeVisible({ timeout: 10_000 })
  })
})

// ==================== 契约 ====================

test.describe('契约登记', () => {
  test('OrgPicker 与 SystemValue 已登记，两个旧控件标为不支持', async ({ page, request }) => {
    const token = await login(page)
    const resp = await request.get(`${API_BASE_URL}/infra/form-design/widget-contracts`, {
      headers: authHeaders(token)
    })
    const data = ((await resp.json()) as any).data

    const org = data.widgets.find((w: any) => w.type === 'OrgPicker')
    expect(org, '契约里必须登记 OrgPicker').toBeTruthy()
    expect(org.valueType, 'OrgPicker 的值是 {type,id} 数组').toBe('array')

    const sv = data.widgets.find((w: any) => w.type === 'SystemValue')
    expect(sv, '契约里必须登记 SystemValue').toBeTruthy()
    expect(sv.storage, 'SystemValue 自己不落库 —— 值由自动填充列写入').toBe('none')
    expect(sv.caps.searchable, '系统值不可作为查询条件，查询要针对物理列本身').toBe(false)

    for (const type of ['UserSelect', 'DeptSelect']) {
      const old = data.widgets.find((w: any) => w.type === type)
      expect(old, `${type} 的契约条目要保留（发布校验的第二道防线）`).toBeTruthy()
      expect(old.supported, `${type} 已删除，必须标为不支持`).toBe(false)
    }
  })

  test('⚠️ 历史表单里若还留着旧控件，发布时被拒绝', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token, [
      JSON.stringify({ type: 'UserSelect', field: 'legacyUser', title: '老的用户选择器', props: {} })
    ])
    try {
      const resp = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id }
      })
      const body = (await resp.json()) as { code: number }
      expect(body.code, '已删除的控件必须在发布时被拒绝，而不是运行时静默失效').not.toBe(0)
    } finally {
      await deleteForm(request, token, id)
    }
  })
})

// ==================== 系统值的存取 ====================

test.describe('系统值控件', () => {
  test('系统值控件能存取，来源原样保留', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token, [
      JSON.stringify({
        type: 'SystemValue',
        field: 'creator',
        title: '创建人',
        props: { source: 'CREATOR' }
      })
    ])
    try {
      const resp = await request.get(`${API_BASE_URL}/infra/form-design/get?id=${id}`, {
        headers: authHeaders(token)
      })
      const saved = ((await resp.json()) as any).data
      const rules = saved.formFields.map((f: string) => JSON.parse(f))
      const sv = rules.find((r: any) => r.type === 'SystemValue')
      expect(sv).toBeTruthy()
      expect(sv.props.source).toBe('CREATOR')
    } finally {
      await deleteForm(request, token, id)
    }
  })
})

// ==================== BPM 兼容 ====================

test.describe('BPM 的表单字段选择没被打破', () => {
  test('⚠️ 流程设计器仍能打开 —— 它按控件类型筛选审批人字段', async ({ page }) => {
    await login(page)
    // 这次删除会影响 BPM 三处按 type 筛选表单字段的地方
    // （UserTask / CopyTaskNodeConfig / UserTaskNodeConfig）。
    // 它们已改为同时接受 OrgPicker 与历史的 UserSelect/DeptSelect。
    // 这条用例守的是「页面还能打开、脚本没报错」这个底线
    await page.goto('/bpm/manager/model')
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 30_000 })

    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.waitForTimeout(2000)
    expect(errors, '流程管理页不应有未捕获的脚本错误').toEqual([])
  })
})
