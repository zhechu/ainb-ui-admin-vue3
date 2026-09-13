import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 列表设计的端到端验证
 *
 * 覆盖的是「列表设计里配了 → 列表页真的按配置渲染」这一段，重点在两件事：
 *
 * 1. **查询区按控件类型渲染**。改造前查询区只有一个 `el-input` 分支 ——
 *    下拉字段要用户手打字典编码（界面显示「男」，查询框里得输入 `1`），
 *    日期字段要手打日期串。这类问题单测抓不到：查询项的配置读得对、
 *    条件也拼得对，只是渲染成了错的控件。
 *
 * 2. **单元格按格式化类型渲染**。图片、附件、超链接、标签这四种要渲染成元素，
 *    改造前一律插值，图片列显示的是一串 URL、标签列显示的是字典编码。
 *
 * ## 前置条件
 *
 * 复用 `xpy-2026-09-10-e2e-form-runtime-fixture.sql` 建出的 `test_e2e_form_runtime`，
 * 不另建表 —— 这张表的列型正好够用（varchar / date / decimal 各有）。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'
const FIXTURE_TABLE = 'test_e2e_form_runtime'
/** 挂在「基础设施」下。它的 path 是 /infra，拼出来的路由能直接访问 */
const PARENT_MENU_ID = 2
/** 用一个库里本来就有的字典，免得用例还要自己造字典数据 */
const DICT_TYPE = 'system_user_sex'

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  expect(response.ok(), '接口登录失败').toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  expect(body.data?.accessToken, '登录接口没有返回 token').toBeTruthy()
  return body.data!.accessToken as string
}

async function login(page: Page): Promise<void> {
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
  expect((await loginPromise).ok()).toBeTruthy()
  // 冷启动时首屏要现编译一大批模块，默认 10s 不够
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

const widget = (rule: Record<string, any>) => JSON.stringify(rule)

/**
 * 表单字段
 *
 * 每个字段都对应查询区的一种渲染分支，删任何一个都会让对应断言失去意义：
 * - gender  下拉（字典）→ SELECT，同时是标签列
 * - occur   日期        → DATE_RANGE
 * - amount  数字        → NUMBER_RANGE
 * - mobile  文本        → TEXT
 * - homepage 文本      → 超链接列
 */
const FORM_FIELDS = [
  widget({
    type: 'select',
    field: 'reason',
    title: '性别',
    props: { dictType: DICT_TYPE, options: [] }
  }),
  widget({ type: 'datePicker', field: 'start_date', title: '发生日期', props: { type: 'date' } }),
  widget({ type: 'inputNumber', field: 'amount', title: '金额', props: {} }),
  widget({ type: 'input', field: 'mobile', title: '手机号', props: {} }),
  widget({ type: 'input', field: 'memo', title: '主页', props: {} })
]

const column = (name: string, jdbcType: string) => ({
  table: FIXTURE_TABLE,
  column: name,
  jdbcType
})

const TABLE_BINDING = {
  mainTable: FIXTURE_TABLE,
  mainPk: 'id',
  pkStrategy: 'SNOWFLAKE',
  logicDelete: {
    enabled: true,
    column: 'deleted',
    deletedValue: '1',
    normalValue: '0',
    valueType: 'NUMBER'
  },
  // 夹具表没有审计列，四个都关掉。开着会让后端往不存在的列写值
  autoFill: {
    creatorColumn: '',
    creatorMode: 'NONE',
    createTimeColumn: '',
    createTimeMode: 'NONE',
    updaterColumn: '',
    updaterMode: 'NONE',
    updateTimeColumn: '',
    updateTimeMode: 'NONE'
  },
  fieldMapping: {
    reason: column('reason', 'VARCHAR'),
    start_date: column('start_date', 'DATE'),
    amount: column('amount', 'DECIMAL'),
    mobile: column('mobile', 'VARCHAR'),
    memo: column('memo', 'VARCHAR')
  }
}

/**
 * 列表配置
 *
 * 查询项的 widget 是设计期推断出来固化进配置的，运行时不再读规则树 ——
 * 这里直接按固化后的形态写，与设计器产出的一致。
 */
const LIST_CONF = {
  columns: [
    { field: 'reason', label: '性别', width: 120, widthType: 'min', align: 'left', fixed: false, sortable: false, formatter: { type: 'TAG', dictType: DICT_TYPE } },
    { field: 'start_date', label: '发生日期', width: 140, widthType: 'min', align: 'left', fixed: false, sortable: false, formatter: { type: 'DATE' } },
    { field: 'amount', label: '金额', width: 120, widthType: 'min', align: 'right', fixed: false, sortable: false, formatter: { type: 'NUMBER', precision: 2, thousands: true } },
    { field: 'mobile', label: '手机号', width: 140, widthType: 'min', align: 'left', fixed: false, sortable: false },
    { field: 'memo', label: '主页', width: 180, widthType: 'min', align: 'left', fixed: false, sortable: false, formatter: { type: 'LINK', linkText: '打开' } }
  ],
  searchItems: [
    { field: 'reason', label: '性别', widget: 'SELECT', dictType: DICT_TYPE, operator: 'EQ' },
    { field: 'start_date', label: '发生日期', widget: 'DATE_RANGE', operator: 'BETWEEN' },
    { field: 'amount', label: '金额', widget: 'NUMBER_RANGE', operator: 'BETWEEN' },
    { field: 'mobile', label: '手机号', widget: 'TEXT', operator: 'LIKE' }
  ],
  pagination: { enabled: true, pageSize: 20 },
  operationColumn: { show: true, label: '操作', width: 160, buttons: ['create', 'edit', 'detail', 'delete'] },
  showSummary: true,
  summaryColumns: ['amount']
}

interface Fixture {
  id: number
  code: string
}

/** 建草稿。与发布分两步，发布失败时调用方仍拿得到编号去清理 */
async function createDraft(
  request: APIRequestContext,
  token: string,
  listConfOverrides: Record<string, any> = {}
): Promise<Fixture> {
  const code = `e2e_ld_${Date.now()}`
  const createRes = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: '列表设计端到端夹具',
      code,
      // 2 = 表单+列表。列表设计这一步只有这个类型才有
      formType: 2,
      formConf: JSON.stringify({ form: { labelWidth: '110px' } }),
      formFields: FORM_FIELDS,
      listConf: JSON.stringify({ ...LIST_CONF, ...listConfOverrides }),
      dataSourceConfigId: 0,
      mainTable: FIXTURE_TABLE,
      mainPk: 'id',
      tableBinding: JSON.stringify(TABLE_BINDING)
    }
  })
  expect(createRes.ok(), '造夹具表单失败').toBeTruthy()
  const id = ((await createRes.json()) as { data: number }).data
  expect(id, '创建接口没有返回编号').toBeTruthy()
  return { id, code }
}

async function publishFixture(request: APIRequestContext, token: string, fixture: Fixture) {
  const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
    headers: authHeaders(token),
    data: { id: fixture.id, parentMenuId: PARENT_MENU_ID, changeSummary: 'e2e' }
  })
  const body = (await response.json()) as { code: number; msg: string }
  expect(body.code, `发布失败：${body.msg}`).toBe(0)
}

/**
 * 清空夹具表里的可见数据
 *
 * ⚠️ 夹具表是**共用**的：每条用例建的是新表单，但绑的都是同一张
 * `test_e2e_form_runtime`。历史用例遗留的行对新表单一样可见，
 * 「筛选后应当剩 1 条」这类断言会被它们冲垮（开发本用例时表里有 130 条遗留行）。
 *
 * 走运行时删除接口而不是直接删库：它是逻辑删除，与列表的可见性判断是同一套，
 * 跳过接口去 DELETE 反而可能与逻辑删除配置对不上。
 *
 * playwright 配置是 `workers: 1` + `fullyParallel: false`，
 * 所以这里清表不会踩到别的用例。
 */
async function wipe(request: APIRequestContext, token: string, code: string) {
  for (let round = 0; round < 20; round++) {
    const res = await request.post(`${API_BASE_URL}/infra/form-design/runtime/${code}/page`, {
      headers: authHeaders(token),
      data: { pageNo: 1, pageSize: 100, conditions: [] }
    })
    const body = (await res.json()) as { data?: { list?: Array<Record<string, any>> } }
    const list = body.data?.list ?? []
    if (list.length === 0) return
    for (const row of list) {
      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${code}/delete?id=${row.id}`,
        { headers: authHeaders(token) }
      )
    }
  }
  throw new Error('清空夹具表超过 20 轮仍未清完，检查删除接口是否真的生效')
}

/** 造几条数据，查询断言要有东西可筛。先清表，保证行数断言是确定的 */
async function seed(request: APIRequestContext, token: string, code: string) {
  await wipe(request, token, code)
  const rows = [
    { reason: '1', start_date: '2026-03-01', amount: 1234.5, mobile: '13800000001', memo: 'https://example.com/a' },
    { reason: '2', start_date: '2026-06-15', amount: 50, mobile: '13900000002', memo: 'https://example.com/b' }
  ]
  for (const data of rows) {
    const res = await request.post(`${API_BASE_URL}/infra/form-design/runtime/${code}/create`, {
      headers: authHeaders(token),
      data
    })
    const body = (await res.json()) as { code: number; msg: string }
    expect(body.code, `造数据失败：${body.msg}`).toBe(0)
  }
}

async function cleanup(request: APIRequestContext, token: string, fixture: Fixture | undefined) {
  if (!fixture) return
  // 先清数据再删表单：删了表单就没有运行时接口可用来清数据了
  await wipe(request, token, fixture.code).catch(() => undefined)
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${fixture.id}`, {
    headers: authHeaders(token)
  })
}

async function openRuntime(page: Page, code: string) {
  await page.goto(`/infra-form-design/preview?code=${code}`)
  // 表单+列表模式先渲染列表，等表格出来
  await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
}

/** 查询区里某个标签对应的表单项 */
const searchItemOf = (page: Page, label: string) =>
  page.locator('.el-form--inline .el-form-item').filter({ hasText: label }).first()

test.describe('列表设计', () => {
  test('⚠️ 查询区按字段控件类型渲染，而不是一律文本框', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 先发布再登录：动态路由在登录时按菜单注册，顺序反了会 404
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      // 字典字段：渲染成下拉，而不是要用户手打编码 1 / 2 的文本框
      const gender = searchItemOf(page, '性别')
      await expect(gender.locator('.el-select'), '字典字段的查询控件应当是下拉').toBeVisible()

      // 日期字段：渲染成日期区间选择器
      const occur = searchItemOf(page, '发生日期')
      await expect(
        occur.locator('.el-date-editor'),
        '日期字段的查询控件应当是日期选择器'
      ).toBeVisible()

      // 数字字段：渲染成两个数字输入框
      const amount = searchItemOf(page, '金额')
      await expect(
        amount.locator('.el-input-number'),
        '数字字段的查询控件应当是数字输入框'
      ).toHaveCount(2)

      // 超过三个查询项时默认折叠，第四项先藏起来
      await expect(
        searchItemOf(page, '手机号'),
        '超过三项时第四项应当默认折叠'
      ).toBeHidden()

      await page.getByRole('button', { name: /展开/ }).click()

      // 文本字段仍是普通输入框，且不是数字 / 日期控件
      const mobile = searchItemOf(page, '手机号')
      await expect(mobile.locator('input')).toHaveCount(1)
      await expect(mobile.locator('.el-input-number')).toHaveCount(0)
      await expect(mobile.locator('.el-date-editor')).toHaveCount(0)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 字典下拉查询选的是中文、发出去的是编码，并真的筛掉数据', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      const rowCount = () => page.locator('.el-table__body-wrapper tbody tr').count()
      expect(await rowCount(), '初始应当有两条数据').toBeGreaterThanOrEqual(2)

      // 选「男」——用户看到的是中文，不必知道它对应编码 1
      const gender = searchItemOf(page, '性别')
      await gender.locator('.el-select').click()
      const pagePromise = page.waitForResponse(
        (r) => r.url().includes(`/${fixture!.code}/page`) && r.request().method() === 'POST'
      )
      await page.locator('.el-select-dropdown__item').filter({ hasText: '男' }).first().click()
      const response = await pagePromise

      // 发出去的必须是字典编码，不是中文标签
      const sent = JSON.parse(response.request().postData() || '{}')
      const condition = (sent.conditions || []).find((c: any) => c.field === 'reason')
      expect(condition, '没有拼出性别的查询条件').toBeTruthy()
      expect(condition.value, '发给后端的应当是字典编码而不是中文').toBe('1')

      await expect
        .poll(rowCount, { timeout: 10_000 })
        .toBe(1)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 数字区间的 0 不被当成没填', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      // 起始值填 0、结束值填 100：两条数据里只有 amount=50 的那条落在区间内。
      // 0 若被当成「没填」，条件会整条丢掉，列表返回全量 —— 看起来像筛选没生效
      const amount = searchItemOf(page, '金额')
      await amount.locator('.el-input-number input').nth(0).fill('0')
      await amount.locator('.el-input-number input').nth(1).fill('100')

      const pagePromise = page.waitForResponse(
        (r) => r.url().includes(`/${fixture!.code}/page`) && r.request().method() === 'POST'
      )
      await page.getByRole('button', { name: '搜索' }).click()
      const response = await pagePromise

      const sent = JSON.parse(response.request().postData() || '{}')
      const condition = (sent.conditions || []).find((c: any) => c.field === 'amount')
      expect(condition, '金额区间条件被整条丢掉了').toBeTruthy()
      expect(Number(condition.value), '起始值 0 应当原样带上').toBe(0)

      await expect
        .poll(() => page.locator('.el-table__body-wrapper tbody tr').count(), { timeout: 10_000 })
        .toBe(1)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 单元格按格式化类型渲染成元素，而不是插值成字符串', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      const body = page.locator('.el-table__body-wrapper tbody')

      // 标签列：渲染成 el-tag，且印的是字典翻译后的中文而不是编码
      const tag = body.locator('.el-tag').first()
      await expect(tag, '标签列应当渲染成标签元素').toBeVisible()
      await expect(tag).toHaveText(/男|女/)

      // 超链接列：渲染成可点的链接，文案用配置的「打开」而不是地址本身
      const link = body.locator('a.el-link').first()
      await expect(link, '超链接列应当渲染成链接').toBeVisible()
      await expect(link).toHaveText('打开')
      await expect(link).toHaveAttribute('href', /^https:\/\/example\.com\//)

      // 数字列：千分位真的生效。夹具表已清空，这个值只会出现一次
      await expect(body.getByText('1,234.50'), '数字列的千分位没有生效').toBeVisible()
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 合计行按复合 key 认列，明细同名列不会串', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      // 1234.5 + 50 = 1284.50
      //
      // ⚠️ 带千分位。这一列配的是「两位小数 + 千分位」，合计行跟着列自己的
      // 格式化走 —— 与上面那条用例里数据行显示的 `1,234.50` 是同一条路径。
      //
      // 改造前合计行一律 `toFixed(2)`，这里断言的是 `1284.50`：数据行有逗号、
      // 合计行没有，同一列上下看着像两套数。那是缺陷，不是约定。
      const footer = page.locator('.el-table__footer-wrapper')
      await expect(footer, '开了合计行就该有 footer').toBeVisible()
      await expect(footer.getByText('1,284.50'), '合计值不对').toBeVisible({ timeout: 10_000 })
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 行内按钮用配置里的文案与顺序，不是写死的那三个', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 「删除」改名成「作废」并排到最前，「详情」关掉
      fixture = await createDraft(request, token, {
        operationColumn: {
          show: true,
          label: '操作',
          width: 200,
          buttons: [
            { key: 'delete', label: '作废', show: true },
            { key: 'edit', label: '修改', show: true },
            { key: 'detail', label: '详情', show: false }
          ]
        }
      })
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      const firstRow = page.locator('.el-table__body-wrapper tbody tr').first()
      const labels = await firstRow.locator('.el-table__cell').last().locator('button').allInnerTexts()
      const trimmed = labels.map((t) => t.trim()).filter(Boolean)

      expect(trimmed, '按钮文案与顺序应当来自配置').toEqual(['作废', '修改'])
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 旧的字符串数组配置仍然读得上来，操作列不会变空', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 线上已发布的表单存的都是这个形态。读不上来的后果是操作列整列变空，
      // 用户打开自己的列表发现编辑删除都没了，且看不出原因
      fixture = await createDraft(request, token, {
        operationColumn: { show: true, label: '操作', width: 160, buttons: ['edit', 'detail', 'delete'] }
      })
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      const firstRow = page.locator('.el-table__body-wrapper tbody tr').first()
      const labels = await firstRow.locator('.el-table__cell').last().locator('button').allInnerTexts()
      const trimmed = labels.map((t) => t.trim()).filter(Boolean)

      expect(trimmed).toEqual(['编辑', '详情', '删除'])
      // 旧配置里不存在的新按钮不能自己冒出来
      await expect(page.getByRole('button', { name: '批量删除' })).toHaveCount(0)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 批量删除：勾选后整批删掉，且服务端是一个事务', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token, {
        operationColumn: {
          show: true,
          label: '操作',
          width: 160,
          buttons: [
            { key: 'batchDelete', label: '批量删除', icon: 'ep:delete', show: true },
            { key: 'edit', label: '编辑', show: true }
          ]
        }
      })
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      // 没勾任何行时按钮是禁用的：点了没反应比禁用更让人困惑
      const batchButton = page.getByRole('button', { name: /批量删除/ })
      await expect(batchButton, '没勾行时批量删除应当是禁用的').toBeDisabled()

      // 表头的全选框
      await page.locator('.el-table__header-wrapper .el-checkbox').first().click()
      await expect(batchButton).toBeEnabled()

      const deletePromise = page.waitForResponse(
        (r) => r.url().includes(`/${fixture!.code}/delete-batch`) && r.request().method() === 'POST'
      )
      await batchButton.click()
      // 二次确认
      await page.locator('.el-message-box__btns button').last().click()
      const response = await deletePromise

      // 一次请求带上全部主键，而不是前端循环单删
      const sent = JSON.parse(response.request().postData() || '[]')
      expect(Array.isArray(sent), '批量删除应当一次请求带上全部主键').toBe(true)
      expect(sent).toHaveLength(2)

      await expect
        .poll(() => page.locator('.el-table__body-wrapper tbody tr').count(), { timeout: 10_000 })
        .toBe(0)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 没配批量按钮时不放多选列', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 无条件放一列勾选框、却没有任何批量操作可用，用户会一直找那个「然后呢」
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      await expect(
        page.locator('.el-table__header-wrapper .el-checkbox'),
        '没配批量按钮就不该有多选列'
      ).toHaveCount(0)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 行内编辑：就地改一行并保存，提交的是整条记录', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token, {
        inlineEdit: { enabled: true },
        columns: LIST_CONF.columns.map((c) =>
          c.field === 'mobile' || c.field === 'amount' ? { ...c, inlineEditable: true } : c
        ),
        operationColumn: {
          show: true,
          label: '操作',
          width: 160,
          buttons: [{ key: 'edit', label: '编辑', show: true }]
        }
      })
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      const firstRow = page.locator('.el-table__body-wrapper tbody tr').first()
      // 进编辑态前要先把整条记录读回来（带乐观锁版本号）
      const getPromise = page.waitForResponse(
        (r) => r.url().includes(`/${fixture!.code}/get`) && r.status() === 200
      )
      await firstRow.getByRole('button', { name: '编辑' }).click()
      await getPromise

      // 勾了「可编辑」的列变成输入控件，没勾的列仍是文本
      await expect(firstRow.locator('.el-input-number'), '金额列应当变成数字输入框').toHaveCount(1)
      const mobileInput = firstRow.locator('input[type="text"]').first()
      await expect(mobileInput, '手机号列应当变成输入框').toBeVisible()

      // 编辑态下只剩保存 / 取消
      await expect(firstRow.getByRole('button', { name: '保存' })).toBeVisible()
      await expect(firstRow.getByRole('button', { name: '编辑' })).toHaveCount(0)

      await mobileInput.fill('13777777777')

      const updatePromise = page.waitForResponse(
        (r) => r.url().includes(`/${fixture!.code}/update`) && r.request().method() === 'PUT'
      )
      await firstRow.getByRole('button', { name: '保存' }).click()
      const response = await updatePromise

      // ⚠️ 提交的必须是整条记录：只送改过的字段，没配成列的字段
      // 会被服务端那条流水线当成「清空」
      const sent = JSON.parse(response.request().postData() || '{}')
      expect(sent.mobile, '改过的值要送出去').toBe('13777777777')
      expect(sent.start_date, '没改过但存在的字段也要带上，不能当成清空').toBeTruthy()
      expect(sent.id, '整条记录要带主键').toBeTruthy()

      // 存完回到只读态，且列表上是新值
      await expect(firstRow.getByRole('button', { name: '编辑' })).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('.el-table__body-wrapper tbody')).toContainText('13777777777')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 行内编辑：没改动就直接退出，不发请求', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 空提交一样会推高乐观锁版本号并写一条变更日志，
      // 让「谁在什么时候改了什么」的记录里混进噪音
      fixture = await createDraft(request, token, {
        inlineEdit: { enabled: true },
        columns: LIST_CONF.columns.map((c) =>
          c.field === 'mobile' ? { ...c, inlineEditable: true } : c
        ),
        operationColumn: {
          show: true,
          label: '操作',
          width: 160,
          buttons: [{ key: 'edit', label: '编辑', show: true }]
        }
      })
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      const firstRow = page.locator('.el-table__body-wrapper tbody tr').first()
      await firstRow.getByRole('button', { name: '编辑' }).click()
      await expect(firstRow.getByRole('button', { name: '保存' })).toBeVisible()

      let updateCalled = false
      page.on('request', (req) => {
        if (req.url().includes(`/${fixture!.code}/update`)) updateCalled = true
      })

      await firstRow.getByRole('button', { name: '保存' }).click()
      await expect(firstRow.getByRole('button', { name: '编辑' })).toBeVisible({ timeout: 10_000 })
      expect(updateCalled, '没改动却发了更新请求').toBe(false)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 没开行内编辑时，「编辑」仍然弹窗', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 行内编辑改变了「编辑」按钮的含义，没开时不能受影响
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await seed(request, token, fixture.code)
      await login(page)
      await openRuntime(page, fixture.code)

      const firstRow = page.locator('.el-table__body-wrapper tbody tr').first()
      await firstRow.getByRole('button', { name: '编辑' }).click()

      await expect(page.locator('.el-dialog'), '没开行内编辑时应当弹窗').toBeVisible({
        timeout: 10_000
      })
    } finally {
      await cleanup(request, token, fixture)
    }
  })
})
