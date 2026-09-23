import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 设计期体检的端到端验证（B10 ②）
 *
 * 项目方定的是「**一次列全**」：发布校验原先是「抛第一条就返回」，用户得
 * 「改一个、发一次」来回好几轮。
 *
 * 两条路走**同一份校验** —— 体检说没问题而发布被拒是最糟的情况，用户会不知道
 * 该信哪个。所以这里有一条用例专门钉住「体检 0 条 ⇒ 发布成功」。
 *
 * ## ⚠️ 分组短路
 *
 * 「收集全部」有个副作用：前面的校验失败后，后面的会基于错误的前提继续跑，
 * 冒出一堆派生出来的**次生错误**（表不存在时，列不存在、外键类型不匹配、
 * 列放不下文件 URL……会一口气报十几条，而真正要修的只有一条）。
 * **次生错误比漏报更烦人** —— 它把真正的原因埋了。所以基础组有错就只报这一组。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'
const TABLE = 'test_e2e_form_runtime'
const PARENT_MENU_ID = 2

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  const body = (await response.json()) as { data?: { accessToken?: string } }
  expect(body.data?.accessToken, '登录失败').toBeTruthy()
  return body.data!.accessToken as string
}

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

const column = (name: string) => ({ table: TABLE, column: name, jdbcType: 'VARCHAR' })

async function createDraft(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, any> = {}
): Promise<{ id: number; code: string }> {
  const code = `e2e_insp_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const response = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: '体检用例',
      code,
      formType: 1,
      formConf: JSON.stringify({ form: {} }),
      formFields: [JSON.stringify({ type: 'input', field: 'reason', title: '原因', props: {} })],
      dataSourceConfigId: 0,
      mainTable: TABLE,
      mainPk: 'id',
      tableBinding: JSON.stringify({
        mainTable: TABLE,
        mainPk: 'id',
        fieldMapping: { reason: column('reason') }
      }),
      ...overrides
    }
  })
  const body = (await response.json()) as { code: number; data: number; msg: string }
  expect(body.code, `造用例表单失败：${body.msg}`).toBe(0)
  return { id: body.data, code }
}

const inspect = async (request: APIRequestContext, token: string, id: number) => {
  const response = await request.get(`${API_BASE_URL}/infra/form-design/inspect?id=${id}`, {
    headers: authHeaders(token)
  })
  return ((await response.json()) as { data: string[] }).data
}

const cleanup = async (request: APIRequestContext, token: string, fixture?: { id: number }) => {
  if (!fixture) return
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${fixture.id}`, {
    headers: authHeaders(token)
  })
}

test.describe('设计期体检', () => {
  test('⚠️ 一次列全：四类问题同时报出，而不是「改一个、发一次」', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    try {
      fixture = await createDraft(request, token, {
        formFields: [
          JSON.stringify({ type: 'input', field: 'reason', title: '原因', props: {} }),
          JSON.stringify({
            type: 'select',
            field: 'memo',
            title: '状态',
            props: { dictSource: { dictType: 'no_such_dict', valueType: 'str' } }
          })
        ],
        tableBinding: JSON.stringify({
          mainTable: TABLE,
          mainPk: 'id',
          fieldMapping: { reason: column('reason'), memo: column('memo') }
        }),
        customButtons: JSON.stringify([
          { key: 'b1', label: '没地址', position: 'ROW', action: { type: 'NAVIGATE' } }
        ]),
        detailTabs: JSON.stringify([{ key: 't1', label: '怪页签', type: 'NO_SUCH_TYPE' }]),
        printTemplate: '<p>{no_such_field}</p>'
      })

      const problems = await inspect(request, token, fixture.id)
      // 改成收集式之前只会报第一条，用户得改一个发一次、四轮
      expect(problems.length, `应当一次报出四类：${JSON.stringify(problems)}`).toBe(4)
      const joined = problems.join('|')
      expect(joined).toContain('no_such_dict')
      expect(joined).toContain('没地址')
      expect(joined).toContain('NO_SUCH_TYPE')
      expect(joined).toContain('no_such_field')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 同一类里的多个实例也要列全：三列都不存在就报三条', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    try {
      // 字段映射是最值得做成收集式的一处 —— DBA 删了三列，第一条就抛会让用户
      // 「改一处、再发布、又被拦下一处」来回三轮
      fixture = await createDraft(request, token, {
        formFields: [1, 2, 3].map((i) =>
          JSON.stringify({ type: 'input', field: `f${i}`, title: `F${i}`, props: {} })
        ),
        tableBinding: JSON.stringify({
          mainTable: TABLE,
          mainPk: 'id',
          fieldMapping: {
            f1: { table: TABLE, column: 'no_col_1', jdbcType: 'VARCHAR' },
            f2: { table: TABLE, column: 'no_col_2', jdbcType: 'VARCHAR' },
            f3: { table: TABLE, column: 'no_col_3', jdbcType: 'VARCHAR' }
          }
        })
      })

      const problems = await inspect(request, token, fixture.id)
      expect(problems.length, `三列缺失应当报三条：${JSON.stringify(problems)}`).toBe(3)
      // 逐条返回而不是拼成一条长文案 —— 拼起来的话面板里挤成一行，数不清有几个问题
      for (const col of ['no_col_1', 'no_col_2', 'no_col_3']) {
        expect(problems.some((p) => p.includes(col)), `应当报到 ${col}`).toBeTruthy()
      }
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 分组短路：主表不存在时只报这一条，不冒出一堆次生错误', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    try {
      // 这张表单同时还有一个引用不存在字段的打印模板。不短路的话，
      // 「列不存在」「打印占位符找不到字段」等等会一起报出来 ——
      // 而真正要修的只有「表不存在」。次生错误把真正的原因埋了
      fixture = await createDraft(request, token, {
        mainTable: 'no_such_table',
        tableBinding: JSON.stringify({
          mainTable: 'no_such_table',
          mainPk: 'id',
          fieldMapping: { reason: { table: 'no_such_table', column: 'c1', jdbcType: 'VARCHAR' } }
        }),
        printTemplate: '<p>{nope}</p>'
      })

      const problems = await inspect(request, token, fixture.id)
      expect(problems.length, `应当只报一条：${JSON.stringify(problems)}`).toBe(1)
      expect(problems[0]).toContain('no_such_table')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 体检 0 条问题 ⇒ 发布一定成功（两条路同一份校验）', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    try {
      fixture = await createDraft(request, token)

      const problems = await inspect(request, token, fixture.id)
      expect(problems, `这张表单本该没问题：${JSON.stringify(problems)}`).toEqual([])

      // 体检说没问题而发布被拒是最糟的情况 —— 用户不知道该信哪个
      const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code, `体检通过了却发布失败：${body.msg}`).toBe(0)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 发布被拒时也一次列全，不是只报第一条', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    try {
      fixture = await createDraft(request, token, {
        customButtons: JSON.stringify([
          { key: 'b1', label: '没地址', position: 'ROW', action: { type: 'NAVIGATE' } }
        ]),
        printTemplate: '<p>{no_such_field}</p>'
      })
      const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code).not.toBe(0)
      // 发布仍然「一条不满足就拒绝」，只是报的时候一次列全
      expect(body.msg).toContain('没地址')
      expect(body.msg).toContain('no_such_field')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('界面上的体检按钮：点一下弹出报告，逐条列出', async ({ page, request }) => {
    const token = await login(page)
    let fixture: { id: number; code: string } | undefined
    try {
      fixture = await createDraft(request, token, {
        printTemplate: '<p>{no_such_field}</p>'
      })
      await page.goto(`/infra/online/editor?id=${fixture.id}`)

      const button = page.getByRole('button', { name: /体\s*检/ })
      await expect(button, '设计器头部应当有体检按钮').toBeVisible({ timeout: 60_000 })
      await button.click()

      // 报告里逐条列出，而不是挤成一段
      await expect(page.getByText('设计期体检')).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('.inspect-list li').first()).toContainText('no_such_field')
    } finally {
      await cleanup(request, token, fixture)
    }
  })
})
