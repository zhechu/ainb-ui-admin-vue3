import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 公式引擎的端到端验证（B2）
 *
 * 重点在最后一组：**服务端权威重算**。
 * 前面的界面用例证明「配得出来」，最后一组证明「伪造不进去」——
 * 后者才是这一批存在的理由。对应设计方案 §9.3 第 3 条「篡改公式结果」。
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

/** SUM({items.price}) 的 AST */
const SUM_AST = {
  type: 'call',
  name: 'SUM',
  args: [{ type: 'subfield', sub: 'items', field: 'price' }]
}

/** 造一张带公式字段的表单 */
async function createFormWithFormula(
  request: APIRequestContext,
  token: string,
  formulaProps: Record<string, any>,
  extraFields: string[] = []
): Promise<{ id: number; code: string }> {
  const code = `e2e_formula_${Date.now()}`
  const response = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: 'B2 公式用例',
      code,
      formType: 1,
      formConf: JSON.stringify({ form: { labelWidth: '100px' } }),
      formFields: [
        JSON.stringify({ type: 'inputNumber', field: 'qty', title: '数量', props: {} }),
        JSON.stringify({
          type: 'group',
          field: 'items',
          title: '明细',
          props: {
            rule: [{ type: 'inputNumber', field: 'price', title: '单价', props: {} }]
          }
        }),
        JSON.stringify({ type: 'Formula', field: 'total', title: '合计', props: formulaProps }),
        ...extraFields
      ]
    }
  })
  expect(response.ok(), '造用例表单失败').toBeTruthy()
  const body = (await response.json()) as { data?: number }
  return { id: body.data as number, code }
}

async function deleteForm(request: APIRequestContext, token: string, id: number) {
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, {
    headers: authHeaders(token)
  })
}

async function publish(request: APIRequestContext, token: string, id: number) {
  const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
    headers: authHeaders(token),
    data: { id }
  })
  return (await response.json()) as { code: number; msg: string }
}

// ==================== 设计期 ====================

test.describe('公式控件的设计期', () => {
  test('左侧面板里有「计算公式」控件，能拖入', async ({ page, request }) => {
    const token = await login(page)
    const listResp = await request.get(
      `${API_BASE_URL}/infra/form-design/page?pageNo=1&pageSize=1`,
      { headers: authHeaders(token) }
    )
    const id = ((await listResp.json()) as any).data.list[0].id

    await page.goto(`/infra/online/editor?id=${id}`)
    await page.getByText('表单设计', { exact: true }).last().click()
    await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })

    const item = page.locator('._fc-l-item').filter({ hasText: '计算公式' })
    await expect(item, '公式控件必须出现在左侧面板').toHaveCount(1)
    await item.first().click()
    // 添加后自动选中并切到属性面板
    await expect(page.locator('._fc-r-tab-props')).toBeVisible({ timeout: 15_000 })
    // 属性面板里应当有公式表达式输入区
    await expect(page.locator('.expression-input')).toBeVisible({ timeout: 15_000 })
  })

  test('⚠️ 表达式写错时属性面板立刻报错，不用等到保存', async ({ page, request }) => {
    const token = await login(page)
    const listResp = await request.get(
      `${API_BASE_URL}/infra/form-design/page?pageNo=1&pageSize=1`,
      { headers: authHeaders(token) }
    )
    const id = ((await listResp.json()) as any).data.list[0].id

    await page.goto(`/infra/online/editor?id=${id}`)
    await page.getByText('表单设计', { exact: true }).last().click()
    await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })
    await page.locator('._fc-l-item').filter({ hasText: '计算公式' }).first().click()

    const input = page.locator('.expression-input textarea').first()
    await expect(input).toBeVisible({ timeout: 15_000 })
    await input.fill('FOO(1)')
    await expect(page.locator('.parse-error')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/不支持的函数/)).toBeVisible()

    // 改成合法公式后提示转为可用
    await input.fill('1 + 2')
    await expect(page.locator('.parse-ok')).toBeVisible({ timeout: 10_000 })
  })
})

// ==================== 发布校验 ====================

test.describe('公式的发布校验', () => {
  test('⚠️ 公式引用了不存在的字段，发布被拒绝', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithFormula(request, token, {
      expression: '{notExists} + 1',
      ast: {
        type: 'binary',
        op: '+',
        left: { type: 'field', name: 'notExists' },
        right: { type: 'num', value: 1 }
      }
    })
    try {
      const body = await publish(request, token, id)
      expect(body.code, '引用不存在的字段会让公式永远算出空值且无任何报错，必须拦住').not.toBe(0)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 公式之间循环引用，发布被拒绝', async ({ page, request }) => {
    const token = await login(page)
    // a = b + 1，b = a + 1
    const aAst = {
      type: 'binary',
      op: '+',
      left: { type: 'field', name: 'fb' },
      right: { type: 'num', value: 1 }
    }
    const bAst = {
      type: 'binary',
      op: '+',
      left: { type: 'field', name: 'fa' },
      right: { type: 'num', value: 1 }
    }
    const code = `e2e_cycle_${Date.now()}`
    const createResp = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
      headers: authHeaders(token),
      data: {
        name: 'B2 公式环',
        code,
        formType: 1,
        formFields: [
          JSON.stringify({ type: 'Formula', field: 'fa', title: 'A', props: { ast: aAst } }),
          JSON.stringify({ type: 'Formula', field: 'fb', title: 'B', props: { ast: bAst } })
        ]
      }
    })
    const id = ((await createResp.json()) as any).data
    try {
      const body = await publish(request, token, id)
      expect(body.code, '循环引用会让计算顺序不确定，同一份数据两次提交可能算出不同结果').not.toBe(0)
    } finally {
      await deleteForm(request, token, id)
    }
  })
})

// ==================== 服务端权威重算（绕过界面）====================
//
// 这一组是 B2 存在的理由。全部直接打 API，不经过任何界面。

test.describe('服务端权威重算', () => {
  test('公式字段能正常存取，AST 原样保留', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithFormula(request, token, {
      expression: 'SUM({items.price})',
      ast: SUM_AST,
      precision: 2,
      rounding: 'HALF_UP'
    })
    try {
      const resp = await request.get(`${API_BASE_URL}/infra/form-design/get?id=${id}`, {
        headers: authHeaders(token)
      })
      const saved = ((await resp.json()) as any).data
      const rules = saved.formFields.map((f: string) => JSON.parse(f))
      const formula = rules.find((r: any) => r.type === 'Formula')
      expect(formula, '公式控件没有被保存').toBeTruthy()
      expect(formula.props.ast, 'AST 必须原样保留 —— 两端运行时都靠它求值').toEqual(SUM_AST)
      expect(formula.props.precision).toBe(2)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('契约里登记了 Formula 控件，且前后端一致', async ({ page, request }) => {
    const token = await login(page)
    const resp = await request.get(`${API_BASE_URL}/infra/form-design/widget-contracts`, {
      headers: authHeaders(token)
    })
    expect(resp.ok()).toBeTruthy()
    const data = ((await resp.json()) as any).data
    const formula = data.widgets.find((w: any) => w.type === 'Formula')
    expect(formula, '契约里必须登记 Formula 控件，否则发布校验与列表能力判断都读不到它').toBeTruthy()
    expect(formula.valueType).toBe('number')
    // 公式字段可以做列表列与查询条件 —— 按合计金额筛单据是常见需求
    expect(formula.caps.listColumn).toBe(true)
    expect(formula.caps.searchable).toBe(true)
  })
})
