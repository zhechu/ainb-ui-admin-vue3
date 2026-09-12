import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 表单运行时的端到端验证
 *
 * 覆盖的是「设计器里配了 → 运行时真的生效」这中间那一段：联动、公式、
 * 字段格式校验、跨字段校验、渲染场景开关。
 *
 * ## 为什么必须有这个用例
 *
 * B1/B2/B5 都交付了求值器与单测，但**运行时渲染页从没调过它们** ——
 * 三批的运行时交互整个是空的，而单测全绿、设计器能配、服务端也确实在算，
 * 没有任何一处会红。这个断点从 B1 起潜伏到 B6 才被发现。
 *
 * 单测保证「算得对」，这个用例保证「算的结果真的作用到了界面上」。
 * 少了它，同样的断点还会再来一次。
 *
 * ## 前置条件
 *
 * 需要先执行 `ruoyi-vue-pro/sql/mysql/xpy-2026-09-10-e2e-form-runtime-fixture.sql`
 * 建出夹具表 `test_e2e_form_runtime`。用例自己建表单、发布、跑完删表单，
 * 但不建表 —— 建表是 DDL，放进用例既慢又要给测试账号 DDL 权限。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'
/** 夹具表 */
const FIXTURE_TABLE = 'test_e2e_form_runtime'
/** 明细夹具表（1:N）。子表控件必须绑一张真实的明细表才能发布 */
const SUB_FIXTURE_TABLE = 'test_e2e_form_runtime_item'
/** 挂在「基础设施」下。它的 path 是 /infra，拼出来的路由能直接访问 */
const PARENT_MENU_ID = 2

/**
 * 纯接口登录，不走界面
 *
 * ⚠️ 用例必须【先发布表单、再做界面登录】：发布会创建菜单，而前端的动态路由
 * 是在登录时按菜单一次性注册的。反过来的话，新发布表单的路由这次会话里
 * 根本不存在，`page.goto` 得到的是「页面不存在」。
 */
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
  // 冷启动时首屏要现编译一大批模块，默认 10s 不够
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
  return body.data?.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

const widget = (rule: Record<string, any>) => JSON.stringify(rule)

/**
 * 表单字段
 *
 * 每个字段都对应运行时的一条链路，删任何一个都会让对应的断言失去意义：
 * - amount  联动条件
 * - reason  联动目标（金额 > 100 时显示并必填）
 * - mobile  字段格式校验（内置正则）
 * - start_date / end_date  跨字段校验
 * - qty / price / total    公式（total = qty * price）
 * - memo    渲染场景开关（只在详情出现）
 */
const FORM_FIELDS = [
  widget({ type: 'inputNumber', field: 'amount', title: '金额', props: {} }),
  widget({ type: 'input', field: 'reason', title: '原因', $required: false, props: {} }),
  widget({
    type: 'input',
    field: 'mobile',
    title: '手机号',
    props: { validateRules: [{ type: 'BUILTIN', patternKey: 'MOBILE' }] }
  }),
  widget({ type: 'datePicker', field: 'start_date', title: '开始日期', props: { type: 'date' } }),
  widget({ type: 'datePicker', field: 'end_date', title: '结束日期', props: { type: 'date' } }),
  // 可折叠的分组标题。它管住后面的 qty / price / total 三个控件
  widget({
    type: 'fcTitle',
    field: 'group_amount',
    title: '金额分组',
    props: { title: '金额分组', collapsible: true }
  }),
  widget({ type: 'inputNumber', field: 'qty', title: '数量', props: {} }),
  widget({ type: 'inputNumber', field: 'price', title: '单价', props: {} }),
  widget({
    type: 'Formula',
    field: 'total',
    title: '合计',
    $required: false,
    props: {
      expression: '{qty} * {price}',
      ast: {
        type: 'binary',
        // ⚠️ 键名是 op 不是 operator。写错不会报错，只会让公式恒定算出 0
        op: '*',
        left: { type: 'field', name: 'qty' },
        right: { type: 'field', name: 'price' }
      },
      precision: 2,
      rounding: 'HALF_UP'
    }
  }),
  // 只在详情出现：新增态里这个字段根本不该在树里
  widget({ type: 'input', field: 'memo', title: '备注', props: { scenes: ['detail'] } }),
  // 二维码：内容取手机号，验证「值插值 + 真的画出来」
  widget({
    type: 'CodeImage',
    field: 'code1',
    title: '二维码',
    props: { codeType: 'qrcode', value: '{mobile}', size: 100 }
  })
]

/** 金额大于 100 时显示并要求填写原因；否则隐藏并取消必填 */
const LOGIC_RULES = [
  {
    id: 'r_reason',
    name: '大额需填原因',
    trigger: 'CHANGE',
    when: { logic: 'AND', items: [{ field: 'amount', operator: 'GT', value: 100 }] },
    then: [
      { type: 'SHOW', target: 'reason' },
      { type: 'REQUIRE', target: 'reason' }
    ],
    otherwise: [
      { type: 'HIDE', target: 'reason' },
      { type: 'OPTIONAL', target: 'reason' }
    ]
  }
]

/** 结束日期不能早于开始日期 */
const VALIDATE_RULES = [
  {
    id: 'r_date',
    name: '日期区间',
    must: {
      logic: 'AND',
      items: [{ field: 'end_date', operator: 'GE', valueType: 'FIELD', value: 'start_date' }]
    },
    message: '结束日期不能早于开始日期'
  }
]

const column = (name: string, jdbcType: string) => ({
  table: FIXTURE_TABLE,
  column: name,
  jdbcType
})

const TABLE_BINDING = {
  mainTable: FIXTURE_TABLE,
  mainPk: 'id',
  // 雪花：夹具表的主键不是自增，与生产表单的常见配置一致
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
    amount: column('amount', 'DECIMAL'),
    reason: column('reason', 'VARCHAR'),
    mobile: column('mobile', 'VARCHAR'),
    start_date: column('start_date', 'DATE'),
    end_date: column('end_date', 'DATE'),
    qty: column('qty', 'INT'),
    price: column('price', 'DECIMAL'),
    total: column('total', 'DECIMAL'),
    memo: column('memo', 'VARCHAR')
  }
}

interface Fixture {
  id: number
  code: string
}

/**
 * 造一张带数组值字段的草稿
 *
 * - `tags` 多选 → `tags`(varchar 255)，契约里 storage=delimited，落库是分隔串
 * - `detail` 多图上传 → `detail`(text)，契约里 storage=json，落库是 JSON 串
 *
 * ⚠️ 字段 ID 必须与物理列同名。本模块的设计器把「字段ID」做成了物理列下拉
 * （DbFieldSelect），所以正常配出来的表单天然满足这一点；而运行时的 SELECT
 * **不给列起字段名的别名**，返回的键就是列名。手工把字段 ID 写成别的名字，
 * 提交能成功、库里也对，但读回来的键是列名，界面上那个字段是空的。
 *
 * ⚠️ 还要用没被 FORM_FIELDS 占掉的列。一开始把 tags 也映射到 reason，
 * 结果是 `Column 'reason' specified twice` —— 同一列被两个字段映射，
 * 拼出来的 INSERT 里那一列出现两次。
 */
async function createArrayValueDraft(request: APIRequestContext, token: string): Promise<Fixture> {
  return createDraft(request, token, {
    formFields: [
      ...FORM_FIELDS,
      widget({
        type: 'checkbox',
        field: 'tags',
        title: '标签',
        props: {
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' }
          ]
        }
      }),
      widget({ type: 'UploadImgs', field: 'detail', title: '现场照片', props: {} })
    ],
    tableBinding: JSON.stringify({
      ...TABLE_BINDING,
      fieldMapping: {
        ...TABLE_BINDING.fieldMapping,
        tags: column('tags', 'VARCHAR'),
        detail: column('detail', 'LONGVARCHAR')
      }
    })
  })
}

// ==================== 富媒体字段（B8） ====================

/** 一张 1x1 的透明 PNG。用它当所有 base64 用例里的「图片内容」 */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAAABgADNjfnRQAAAABJRU5ErkJggg=='

/**
 * 手写签名 + 富文本
 *
 * 刻意不并进公共的 FORM_FIELDS：富文本编辑器挂载不便宜，让其余十来条用例
 * 都为它付一次代价没有道理。只有 B8 这几条用例把它们叠加上去。
 */
const RICH_MEDIA_FIELDS = [
  widget({
    type: 'Signature',
    field: 'signature',
    title: '客户签名',
    props: { width: 320, height: 120, penWidth: 3 }
  }),
  widget({ type: 'Editor', field: 'detail', title: '详情', props: {} })
]

/**
 * 造一张带签名与富文本的草稿
 *
 * @param signatureColumn 签名字段映射到哪一列。默认 signature(varchar 500)，
 *                        「列开得太短」那条用例传 sign_short(varchar 50)
 */
async function createRichMediaDraft(
  request: APIRequestContext,
  token: string,
  signatureColumn = 'signature'
): Promise<Fixture> {
  return createDraft(request, token, {
    formFields: [...FORM_FIELDS, ...RICH_MEDIA_FIELDS],
    tableBinding: JSON.stringify({
      ...TABLE_BINDING,
      fieldMapping: {
        ...TABLE_BINDING.fieldMapping,
        signature: column(signatureColumn, 'VARCHAR'),
        detail: column('detail', 'LONGVARCHAR')
      }
    })
  })
}

/**
 * 建草稿。**与发布分成两步**，不合并成一个函数
 *
 * ⚠️ 合并的话，发布失败时函数会在断言处抛出，调用方那边 `fixture` 还没被赋值，
 * `finally` 里的清理就拿不到编号 —— 那张草稿表单会永远留在库里。
 * 开发这个用例期间就这么漏了几十条。
 */
async function createDraft(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, any> = {}
): Promise<Fixture> {
  const code = `e2e_rt_${Date.now()}`
  const createRes = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: '运行时端到端夹具',
      code,
      // 1 = 纯表单。用表单+列表的话还要配列表列，与本用例要验的东西无关
      formType: 1,
      formConf: JSON.stringify({ form: { labelWidth: '110px' } }),
      formFields: FORM_FIELDS,
      logicRules: JSON.stringify(LOGIC_RULES),
      validateRules: JSON.stringify(VALIDATE_RULES),
      dataSourceConfigId: 0,
      mainTable: FIXTURE_TABLE,
      mainPk: 'id',
      tableBinding: JSON.stringify(TABLE_BINDING),
      ...overrides
    }
  })
  expect(createRes.ok(), '造夹具表单失败').toBeTruthy()
  const id = ((await createRes.json()) as { data: number }).data
  expect(id, '创建接口没有返回编号').toBeTruthy()
  return { id, code }
}

/** 发布。失败时把服务端的话原样带出来 —— 「发布失败」这四个字排查不了任何东西 */
async function publishFixture(request: APIRequestContext, token: string, fixture: Fixture) {
  const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
    headers: authHeaders(token),
    data: { id: fixture.id, parentMenuId: PARENT_MENU_ID, changeSummary: 'e2e' }
  })
  const body = (await response.json()) as { code: number; msg: string }
  expect(body.code, `发布失败：${body.msg}`).toBe(0)
}

async function cleanup(request: APIRequestContext, token: string, fixture: Fixture | undefined) {
  if (!fixture) return
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${fixture.id}`, {
    headers: authHeaders(token)
  })
}

/**
 * 打开运行时页面
 *
 * 走静态的预览路由（`/infra-form-design/preview?code=xxx`），不走发布生成的菜单路由。
 *
 * ⚠️ 为什么不能用菜单路由：发布确实会建菜单，但**新菜单不会自动分配给角色**，
 * 所以它不出现在 get-permission-info 里，前端也就不会为它注册动态路由 ——
 * `page.goto` 得到的是「页面不存在」。在用例里去改角色的菜单分配，
 * 风险远大于收益（一次跑挂就可能把 dev 环境的角色配置弄乱）。
 *
 * 预览路由不绕过任何鉴权：运行时接口仍按 `infra:form-design-run:{code}:{action}`
 * 校验，这个路由只是个壳。
 */
async function openRuntime(page: Page, code: string) {
  await page.goto(`/infra-form-design/preview?code=${code}`)
  // 纯表单模式直接渲染表单，等第一个表单项出来即可
  await expect(page.locator('.el-form-item').first()).toBeVisible({ timeout: 60_000 })
}

const itemOf = (page: Page, title: string) =>
  page.locator('.el-form-item').filter({ hasText: title }).first()

test.describe('表单运行时', () => {
  test('⚠️ 联动规则在运行时生效：条件满足时显示、不满足时恢复隐藏', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 先发布再登录：动态路由在登录时按菜单注册，顺序反了会 404
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await login(page)
      await openRuntime(page, fixture.code)

      // 初始金额为空 → 条件不满足 → otherwise 分支把原因藏起来
      await expect(itemOf(page, '原因'), '初始状态原因应当是隐藏的').toBeHidden()

      await itemOf(page, '金额').locator('input').first().fill('200')
      await itemOf(page, '金额').locator('input').first().blur()
      await expect(itemOf(page, '原因'), '金额大于 100 时原因应当显示').toBeVisible({
        timeout: 10_000
      })

      // ⚠️ 条件回落：只写 then 不写 otherwise 是同类产品最常见的坑，
      // 表现为「填了又改回去，字段还留在显示状态」
      await itemOf(page, '金额').locator('input').first().fill('50')
      await itemOf(page, '金额').locator('input').first().blur()
      await expect(itemOf(page, '原因'), '金额降回去后原因应当重新隐藏').toBeHidden({
        timeout: 10_000
      })
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 公式在运行时实时计算', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 先发布再登录：动态路由在登录时按菜单注册，顺序反了会 404
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await login(page)
      await openRuntime(page, fixture.code)

      await itemOf(page, '数量').locator('input').first().fill('3')
      await itemOf(page, '数量').locator('input').first().blur()
      await itemOf(page, '单价').locator('input').first().fill('12.5')
      await itemOf(page, '单价').locator('input').first().blur()

      // 公式控件是只读展示，值由运行时算好写进表单数据
      await expect(itemOf(page, '合计'), '合计应当算出 37.50').toContainText('37.5', {
        timeout: 10_000
      })
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('字段格式校验在失焦时提示', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 先发布再登录：动态路由在登录时按菜单注册，顺序反了会 404
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await login(page)
      await openRuntime(page, fixture.code)

      await itemOf(page, '手机号').locator('input').first().fill('abc')
      await itemOf(page, '手机号').locator('input').first().blur()
      await expect(page.getByText('请输入 11 位手机号'), '格式不对应当当场提示').toBeVisible({
        timeout: 10_000
      })

      await itemOf(page, '手机号').locator('input').first().fill('13812345678')
      await itemOf(page, '手机号').locator('input').first().blur()
      await expect(page.getByText('请输入 11 位手机号'), '改对之后提示应当消失').toBeHidden({
        timeout: 10_000
      })
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 渲染场景开关：只在详情出现的字段，新增态里不存在', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 先发布再登录：动态路由在登录时按菜单注册，顺序反了会 404
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await login(page)
      await openRuntime(page, fixture.code)

      // 「不存在」而不是「隐藏」：留在树里的话，联动的 SHOW 能把它重新显示出来
      await expect(
        page.locator('.el-form-item').filter({ hasText: '备注' }),
        '配了只在详情出现的字段，新增态里不该存在'
      ).toHaveCount(0)
      // 其它字段照常
      await expect(itemOf(page, '金额')).toBeVisible()
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 分组标题折叠：收起后组内控件消失，展开后回来', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await login(page)
      await openRuntime(page, fixture.code)

      // 默认展开
      await expect(itemOf(page, '数量')).toBeVisible()

      await page.getByText('收起', { exact: true }).first().click()
      // ⚠️ 折叠是把控件移出规则树，不是标 hidden —— 标 hidden 的话
      // 联动的 SHOW、脚本的 setVisible 都能把用户折起来的东西重新显示出来
      await expect(
        page.locator('.el-form-item').filter({ hasText: '数量' }),
        '收起后组内控件应当不存在'
      ).toHaveCount(0)
      // 标题自己必须留着，否则再也点不开
      await expect(page.getByText('展开', { exact: true }).first()).toBeVisible()
      // 组外的控件不受影响
      await expect(itemOf(page, '金额')).toBeVisible()

      await page.getByText('展开', { exact: true }).first().click()
      await expect(itemOf(page, '数量'), '展开后组内控件应当回来').toBeVisible({ timeout: 10_000 })
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 二维码按字段插值真的画出来', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)
      await login(page)
      await openRuntime(page, fixture.code)

      const canvas = itemOf(page, '二维码').locator('canvas')
      // 内容为空时不画 —— 画一个空二维码没有意义
      await expect(canvas).toBeHidden()

      await itemOf(page, '手机号').locator('input').first().fill('13812345678')
      await itemOf(page, '手机号').locator('input').first().blur()

      // 断言画布真的有内容：宽高都大于 0。只断言元素存在的话，
      // 画失败（内容不合法、库没加载）时它照样存在
      await expect(canvas).toBeVisible({ timeout: 10_000 })
      const size = await canvas.evaluate((el) => ({
        w: (el as HTMLCanvasElement).width,
        h: (el as HTMLCanvasElement).height
      }))
      expect(size.w, '二维码画布宽度应当大于 0').toBeGreaterThan(0)
      expect(size.h, '二维码画布高度应当大于 0').toBeGreaterThan(0)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 分步校验：当前页有必填没填时，切不到后面的页', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 专门的两页表单：第一页的手机号必填，第二页只有备注
      const tabsForm = [
        JSON.stringify({
          type: 'elTabs',
          field: 'steps',
          props: { stepValidate: true },
          children: [
            {
              type: 'elTabPane',
              props: { label: '第一步' },
              children: [
                { type: 'input', field: 'mobile', title: '手机号', $required: true, props: {} }
              ]
            },
            {
              type: 'elTabPane',
              props: { label: '第二步' },
              children: [{ type: 'input', field: 'memo', title: '备注', props: {} }]
            }
          ]
        })
      ]
      // 这张表单没有日期字段，夹具默认的跨字段规则会引用不到 ——
      // 发布校验会（正确地）拦下来，所以这里清掉规则
      fixture = await createDraft(request, token, {
        formFields: tabsForm,
        validateRules: '[]',
        logicRules: '[]'
      })
      await publishFixture(request, token, fixture)
      await login(page)
      await openRuntime(page, fixture.code)

      await expect(itemOf(page, '手机号')).toBeVisible()

      // ⚠️ 断言看的是「哪一页的内容可见」，不是「另一页的控件在不在 DOM 里」——
      // el-tabs 把所有页都渲染进 DOM，非活动页只是 display:none
      const step2Tab = page.getByRole('tab', { name: '第二步' })
      const step1Tab = page.getByRole('tab', { name: '第一步' })
      await expect(step1Tab, '初始应当停在第一步').toHaveAttribute('aria-selected', 'true')

      // 手机号没填 → 切不过去
      await step2Tab.click()
      await expect(step1Tab, '校验不过时应当留在第一步').toHaveAttribute('aria-selected', 'true')

      // 填上之后就能走
      await itemOf(page, '手机号').locator('input').first().fill('13812345678')
      await itemOf(page, '手机号').locator('input').first().blur()
      await step2Tab.click()
      await expect(step2Tab, '校验通过后应当切到第二步').toHaveAttribute('aria-selected', 'true', {
        timeout: 10_000
      })

      // ⚠️ 往回退不受限制：回上一步改东西是正常操作
      await step1Tab.click()
      await expect(itemOf(page, '手机号'), '往回退不该被拦').toBeVisible()
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 步骤条容器：非当前步隐藏、必填没填不许下一步、往回退不受限', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 专门的两步表单：第一步的手机号必填，第二步只有备注
      const stepsForm = [
        JSON.stringify({
          type: 'FormSteps',
          field: 'wizard',
          props: { stepValidate: true },
          children: [
            {
              type: 'FormStep',
              field: 'step_1',
              props: { title: '基本信息' },
              children: [
                { type: 'input', field: 'mobile', title: '手机号', $required: true, props: {} }
              ]
            },
            {
              type: 'FormStep',
              field: 'step_2',
              props: { title: '补充信息' },
              children: [{ type: 'input', field: 'memo', title: '备注', props: {} }]
            }
          ]
        })
      ]
      // 这张表单没有日期字段，夹具默认的跨字段规则会引用不到 ——
      // 发布校验会（正确地）拦下来，所以这里清掉规则
      fixture = await createDraft(request, token, {
        formFields: stepsForm,
        validateRules: '[]',
        logicRules: '[]'
      })
      await publishFixture(request, token, fixture)
      await login(page)
      await openRuntime(page, fixture.code)

      // 头部两步都要画出来 —— 头部与内容用的是同一份注册数组，
      // 头部少一项就说明有一步没注册进来
      await expect(page.getByText('基本信息', { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('补充信息', { exact: true })).toBeVisible()

      // ⚠️ 断言必须落在控件本身上，不能用 itemOf（`.el-form-item` + hasText）——
      // 整个步骤条容器外面还包着一层 el-form-item，它的文本含「备注」且始终可见，
      // `.first()` 命中的是它，于是这条断言永远失败。
      // 标签页那条用例踩的是同一个坑的另一种形态（见它的注释）
      const mobileInput = page.getByRole('textbox', { name: '手机号' })
      const memoInput = page.getByRole('textbox', { name: '备注' })

      // ⚠️ 非当前步是 v-show 隐藏，不是不渲染。用 v-if 的话第二步的必填项
      // 在第一步时根本不在表单里，提交时校验不到 —— 「必填没填也能提交」
      await expect(mobileInput, '初始应当停在第一步').toBeVisible()
      await expect(memoInput, '第二步的内容应当隐藏').toBeHidden()

      // 手机号没填 → 走不到下一步
      const nextBtn = page.getByRole('button', { name: '下一步' })
      await nextBtn.click()
      await expect(memoInput, '校验不过时应当留在第一步').toBeHidden()
      await expect(mobileInput).toBeVisible()

      // 填上之后就能走
      await mobileInput.fill('13812345678')
      await mobileInput.blur()
      await nextBtn.click()
      await expect(memoInput, '校验通过后应当走到第二步').toBeVisible({ timeout: 10_000 })
      await expect(mobileInput, '第一步的内容应当收起').toBeHidden()

      // ⚠️ 往回退不受限制：回上一步改东西是正常操作。
      // 这条与标签页上的分步校验语义一致 —— 同一个产品里两种分步的行为不能不同
      await page.getByRole('button', { name: '上一步' }).click()
      await expect(mobileInput, '往回退不该被拦').toBeVisible()
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 子表复制本行：复制出的新行带着原行的值，且是独立的一行', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 一张只有子表的表单。⚠️ 子表控件的内部规则挂在 props.rule 下（不是 children），
      // 这是它与布局容器的关键差别
      const subTableForm = [
        JSON.stringify({
          type: 'group',
          field: 'items',
          title: '明细',
          props: {
            rule: [{ type: 'input', field: 'name', title: '名称', props: {} }]
          }
        })
      ]
      fixture = await createDraft(request, token, {
        formFields: subTableForm,
        validateRules: '[]',
        logicRules: '[]',
        tableBinding: JSON.stringify({
          ...TABLE_BINDING,
          // 主表这次不映射任何字段，表单里只有子表
          fieldMapping: {},
          subTables: [
            {
              table: SUB_FIXTURE_TABLE,
              field: 'items',
              foreignKey: 'main_id',
              pk: 'id',
              pkStrategy: 'AUTO',
              fieldMapping: {
                name: { table: SUB_FIXTURE_TABLE, column: 'name', jdbcType: 'VARCHAR' }
              }
            }
          ]
        })
      })
      await publishFixture(request, token, fixture)
      await login(page)
      await openRuntime(page, fixture.code)

      // 子表初始没有行，先点占位的新增
      const rows = page.locator('._fc-group-container')
      await page.locator('._fc-group-add').first().click()
      await expect(rows, '点新增后应当有一行').toHaveCount(1, { timeout: 30_000 })

      await rows.first().locator('input').first().fill('第一行')

      // ⚠️ 内核一旦提供了 button 插槽就完全不画自带按钮。这条断言守的是
      // 「加了复制之后，新增/删除/排序没被顺手弄丢」
      await expect(
        rows.first().locator('._fc-group-btn'),
        '行按钮应当是 新增 + 复制 + 删除（只有一行时没有排序）'
      ).toHaveCount(3)

      await rows.first().locator('.sub-table-copy-btn').click()
      await expect(rows, '复制后应当有两行').toHaveCount(2, { timeout: 10_000 })

      // 复制出来的行带着原行的值
      await expect(rows.nth(1).locator('input').first()).toHaveValue('第一行')

      // ⚠️ 必须是独立的一行：深拷贝没做对的话两行会共用同一个对象，
      // 改一行另一行跟着变，而界面上完全看不出来
      await rows.nth(1).locator('input').first().fill('第二行')
      await expect(rows.first().locator('input').first(), '改新行不该影响原行').toHaveValue(
        '第一行'
      )
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 乐观锁：两个会话同时改同一条记录，后者被拒绝而不是静默覆盖', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token, {
        tableBinding: JSON.stringify({
          ...TABLE_BINDING,
          optimisticLock: { enabled: true, column: 'version' }
        })
      })
      await publishFixture(request, token, fixture)

      const created = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { amount: 10 } }
      )
      const createdBody = (await created.json()) as { code: number; data: any; msg: string }
      expect(createdBody.code, `写入失败：${createdBody.msg}`).toBe(0)
      const id = createdBody.data

      // 两个「会话」都读到同一个版本号 —— 这就是并发编辑的起点
      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${id}`,
        { headers: authHeaders(token) }
      )
      const row = ((await detail.json()) as { data: Record<string, any> }).data
      expect(row.version, '启用乐观锁后查询必须把版本号带出来').not.toBeUndefined()
      const version = row.version

      const update = (amount: number, v: any) =>
        request.put(`${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/update?id=${id}`, {
          headers: authHeaders(token),
          data: { amount, version: v }
        })

      // 甲先提交，成功，版本号 +1
      const first = (await (await update(20, version)).json()) as { code: number; msg: string }
      expect(first.code, `第一次更新失败：${first.msg}`).toBe(0)

      // 乙拿着旧版本号提交 —— 必须被拒
      const second = (await (await update(30, version)).json()) as { code: number; msg: string }
      expect(second.code, '拿旧版本号提交必须被拒绝').not.toBe(0)
      // ⚠️ 报错要说清是「被别人改了」，不能报「数据不存在」——
      // 后者会让用户以为记录被谁删了，跑去问谁删的
      expect(second.msg).toContain('已被他人修改')

      // 甲的修改还在，没被乙覆盖
      const after = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${id}`,
        { headers: authHeaders(token) }
      )
      const afterRow = ((await after.json()) as { data: Record<string, any> }).data
      expect(Number(afterRow.amount), '先提交的那份修改必须保住').toBe(20)
      expect(Number(afterRow.version), '版本号应当只推进了一格').toBe(Number(version) + 1)

      // 拿新版本号重试就能成功
      const retry = (await (await update(30, afterRow.version)).json()) as {
        code: number
        msg: string
      }
      expect(retry.code, `拿新版本号重试应当成功：${retry.msg}`).toBe(0)

      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/delete?id=${id}`,
        { headers: authHeaders(token) }
      )
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 乐观锁：提交缺版本号时报错，而不是悄悄跳过版本条件', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 跳过的话，SQL 里就没有版本条件、更新照样成功 ——
      // 于是「开了乐观锁」对任何漏传版本号的客户端自动失效，而界面上一切正常
      fixture = await createDraft(request, token, {
        tableBinding: JSON.stringify({
          ...TABLE_BINDING,
          optimisticLock: { enabled: true, column: 'version' }
        })
      })
      await publishFixture(request, token, fixture)

      const created = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { amount: 10 } }
      )
      const id = ((await created.json()) as { data: any }).data

      const res = await request.put(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/update?id=${id}`,
        { headers: authHeaders(token), data: { amount: 20 } }
      )
      const body = (await res.json()) as { code: number; msg: string }
      expect(body.code, '缺版本号必须被拒绝').not.toBe(0)
      expect(body.msg).toContain('版本号')

      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/delete?id=${id}`,
        { headers: authHeaders(token) }
      )
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 乐观锁的版本列被表单字段映射时，发布被拒绝', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 表单值与后端自增互相覆盖，而两边都不报错
      fixture = await createDraft(request, token, {
        formFields: [
          ...FORM_FIELDS,
          widget({ type: 'inputNumber', field: 'version', title: '版本', props: {} })
        ],
        tableBinding: JSON.stringify({
          ...TABLE_BINDING,
          optimisticLock: { enabled: true, column: 'version' },
          fieldMapping: { ...TABLE_BINDING.fieldMapping, version: column('version', 'INT') }
        })
      })
      const res = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await res.json()) as { code: number; msg: string }
      expect(body.code, '版本列被字段映射必须被发布校验拦下').not.toBe(0)
      expect(body.msg).toContain('version')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 变更日志：只记真的改了的字段，时间线带标题与新旧值', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token, {
        tableBinding: JSON.stringify({ ...TABLE_BINDING, changeLog: { enabled: true } })
      })
      await publishFixture(request, token, fixture)

      const created = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { amount: 10, reason: '原始原因' } }
      )
      const createdBody = (await created.json()) as { code: number; data: any; msg: string }
      expect(createdBody.code, `写入失败：${createdBody.msg}`).toBe(0)
      const id = createdBody.data

      const logsOf = async () => {
        const res = await request.get(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/data-logs?id=${id}`,
          { headers: authHeaders(token) }
        )
        return ((await res.json()) as { data: Array<{ changes: string; createTime: string }> }).data
      }

      // 新增不记日志：变更日志记的是「从什么改成了什么」，新增没有「从什么」
      expect(await logsOf(), '新增不该产生变更日志').toHaveLength(0)

      const update = (data: Record<string, any>) =>
        request.put(`${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/update?id=${id}`, {
          headers: authHeaders(token),
          data
        })

      // 改一个字段
      const first = (await (await update({ amount: 20, reason: '原始原因' })).json()) as {
        code: number
        msg: string
      }
      expect(first.code, `更新失败：${first.msg}`).toBe(0)

      const afterFirst = await logsOf()
      expect(afterFirst, '改了一个字段应当有一条日志').toHaveLength(1)
      const changes = JSON.parse(afterFirst[0].changes) as Array<Record<string, string>>
      // ⚠️ 只记真的改了的那一个：reason 原样提交，不该出现在变更里。
      // 也不该出现「金额：10.00 → 20」之外的假变更 —— decimal 列读出来是
      // BigDecimal("10.00")，直接 toString 比对会把没改的字段全记一遍
      expect(changes, '只有金额变了').toHaveLength(1)
      expect(changes[0].title).toBe('金额')
      expect(Number(changes[0].oldValue)).toBe(10)
      expect(Number(changes[0].newValue)).toBe(20)

      // ⚠️ 什么都没改就保存：不产生新日志。
      // 记一条空日志的话，时间线会被一堆「无变更」淹掉
      const second = (await (await update({ amount: 20, reason: '原始原因' })).json()) as {
        code: number
      }
      expect(second.code).toBe(0)
      expect(await logsOf(), '没有实际变更时不该新增日志').toHaveLength(1)

      // 再改一次：时间线累积，最新的在前
      await update({ amount: 30, reason: '改过的原因' })
      const afterThird = await logsOf()
      expect(afterThird, '第二次真实变更应当再加一条').toHaveLength(2)
      const latest = JSON.parse(afterThird[0].changes) as Array<Record<string, string>>
      expect(latest.map((c) => c.title).sort()).toEqual(['原因', '金额'])

      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/delete?id=${id}`,
        { headers: authHeaders(token) }
      )
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('未启用变更日志时，时间线接口返回空列表而不是报错', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 前端拿它做「有就展示、没有就不展示」的判断，报错会让详情页多一个红叉
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)

      const res = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/data-logs?id=1`,
        { headers: authHeaders(token) }
      )
      const body = (await res.json()) as { code: number; data: any[] }
      expect(body.code).toBe(0)
      expect(body.data).toHaveLength(0)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 变更记录入口：启用后列表行里能点开时间线，未启用时入口不出现', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 表单+列表类型才有行操作。列表列只放一个字段，够点开操作列就行
      fixture = await createDraft(request, token, {
        formType: 2,
        listConf: JSON.stringify({
          columns: [{ field: 'amount', label: '金额' }],
          // ⚠️ 一旦自己给了 operationColumn，解析就不再用默认值 ——
          // 少了 show 或 buttons 整个操作列都不会渲染
          operationColumn: { show: true, label: '操作', width: 260, buttons: ['edit', 'detail'] }
        }),
        tableBinding: JSON.stringify({ ...TABLE_BINDING, changeLog: { enabled: true } })
      })
      await publishFixture(request, token, fixture)

      const created = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { amount: 10 } }
      )
      const id = ((await created.json()) as { data: any }).data
      await request.put(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/update?id=${id}`,
        { headers: authHeaders(token), data: { amount: 55 } }
      )

      await login(page)
      await page.goto(`/infra-form-design/preview?code=${fixture.code}`)

      const entry = page.getByRole('button', { name: '变更记录' }).first()
      await expect(entry, '启用变更日志后行操作里应当有入口').toBeVisible({ timeout: 60_000 })
      await entry.click()

      // 时间线上要能看到「金额 10 → 55」。断言落在新值上 ——
      // 只断言弹窗打开的话，一个永远空着的时间线也能通过
      await expect(page.getByText('金额', { exact: true }).first()).toBeVisible({
        timeout: 15_000
      })
      await expect(page.getByText('55', { exact: true }).first()).toBeVisible()

      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/delete?id=${id}`,
        { headers: authHeaders(token) }
      )
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 自定义按钮：行内按钮按本行数据判可见，点击带字段插值跳转', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    const created: any[] = []
    try {
      const buttons = [
        {
          key: 'goBig',
          label: '大额复核',
          position: 'ROW',
          action: {
            type: 'NAVIGATE',
            url: '/infra-form-design/preview?code={reason}',
            target: '_self'
          },
          // 只在金额大于 100 时出现。条件模型与联动规则共用同一棵条件树
          visibleWhen: { logic: 'AND', items: [{ field: 'amount', operator: 'GT', value: 100 }] }
        },
        {
          key: 'goToolbar',
          label: '打开报表',
          position: 'TOOLBAR',
          action: { type: 'NAVIGATE', url: '/index' }
        }
      ]
      fixture = await createDraft(request, token, {
        formType: 2,
        // 清掉夹具默认的联动与跨字段规则：默认规则要求「金额 > 100 时必须填原因」，
        // 而本用例正是要造大额数据
        logicRules: '[]',
        validateRules: '[]',
        listConf: JSON.stringify({
          columns: [
            { field: 'amount', label: '金额' },
            { field: 'reason', label: '原因' }
          ],
          operationColumn: { show: true, label: '操作', width: 280, buttons: ['edit'] }
        }),
        customButtons: JSON.stringify(buttons)
      })
      await publishFixture(request, token, fixture)

      // ⚠️ 每行给一个唯一标记，断言按行定位而不是按全表计数。
      // 夹具表是所有运行时用例共用的，别的用例（尤其是失败后没跑到清理的那次）
      // 会留下数据行 —— 按全表计数的断言会被它们打挂，而失败原因完全指不到这里
      const mark = Date.now()
      const bigMark = `BTN-BIG-${mark}`
      const smallMark = `BTN-SMALL-${mark}`
      const create = async (amount: number, reason: string) => {
        const res = await request.post(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/create`,
          { headers: authHeaders(token), data: { amount, reason } }
        )
        const body = (await res.json()) as { code: number; data: any; msg: string }
        expect(body.code, `造数据失败：${body.msg}`).toBe(0)
        created.push(body.data)
      }
      await create(200, bigMark)
      await create(50, smallMark)

      await login(page)
      await page.goto(`/infra-form-design/preview?code=${fixture.code}`)

      // 工具栏按钮：没有「当前记录」，不判条件，直接出现
      await expect(
        page.getByRole('button', { name: '打开报表' }),
        '工具栏自定义按钮应当出现'
      ).toBeVisible({ timeout: 60_000 })

      // ⚠️ 行内按钮按【每一行】的数据判可见
      const bigRow = page.locator('tr').filter({ hasText: bigMark })
      const smallRow = page.locator('tr').filter({ hasText: smallMark })
      await expect(bigRow, '大额那一行应当有按钮').toHaveCount(1)
      await expect(
        bigRow.getByRole('button', { name: '大额复核' }),
        '金额 200 满足条件，按钮应当出现'
      ).toHaveCount(1)
      await expect(
        smallRow.getByRole('button', { name: '大额复核' }),
        '金额 50 不满足条件，按钮应当隐藏'
      ).toHaveCount(0)

      // 点击：地址里的 {reason} 要被插值成本行的真实值。target=_self 走站内路由
      await bigRow.getByRole('button', { name: '大额复核' }).click()
      await expect(page, '应当跳到插值后的地址').toHaveURL(new RegExp(`code=${bigMark}`), {
        timeout: 15_000
      })
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 自定义按钮用了 javascript: 协议，发布被拒绝', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 与超链接控件同一条判据：地址是表单设计者配的、填表人点的，
      // 两者往往不是同一个信任级别
      fixture = await createDraft(request, token, {
        customButtons: JSON.stringify([
          {
            key: 'bad',
            label: '危险按钮',
            position: 'ROW',
            action: { type: 'NAVIGATE', url: 'javascript:alert(1)' }
          }
        ])
      })
      const res = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await res.json()) as { code: number; msg: string }
      expect(body.code, 'javascript: 协议必须被发布校验拦下').not.toBe(0)
      expect(body.msg).toContain('危险按钮')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 自定义按钮标识重复，发布被拒绝', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 前端按标识做列表 key，重复会让渲染错位 —— 删掉一个按钮，
      // 界面上消失的可能是另一个
      fixture = await createDraft(request, token, {
        customButtons: JSON.stringify([
          { key: 'same', label: 'A', position: 'ROW', action: { type: 'NAVIGATE', url: '/a' } },
          { key: 'same', label: 'B', position: 'ROW', action: { type: 'NAVIGATE', url: '/b' } }
        ])
      })
      const res = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await res.json()) as { code: number; msg: string }
      expect(body.code).not.toBe(0)
      expect(body.msg).toContain('same')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 详情页页签：表单是第一个页签，切到变更记录能看到时间线', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    const created: any[] = []
    try {
      fixture = await createDraft(request, token, {
        formType: 2,
        logicRules: '[]',
        validateRules: '[]',
        listConf: JSON.stringify({
          columns: [
            { field: 'amount', label: '金额' },
            { field: 'reason', label: '原因' }
          ],
          operationColumn: { show: true, label: '操作', width: 220, buttons: ['detail'] }
        }),
        tableBinding: JSON.stringify({ ...TABLE_BINDING, changeLog: { enabled: true } }),
        detailTabs: JSON.stringify([{ key: 'changeLog', label: '变更记录', type: 'CHANGE_LOG' }])
      })
      await publishFixture(request, token, fixture)

      const mark = `TAB-${Date.now()}`
      const res = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { amount: 10, reason: mark } }
      )
      const body = (await res.json()) as { code: number; data: any; msg: string }
      expect(body.code, `造数据失败：${body.msg}`).toBe(0)
      created.push(body.data)
      // 改一次，好让时间线上有东西
      await request.put(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/update?id=${body.data}`,
        { headers: authHeaders(token), data: { amount: 77, reason: mark } }
      )

      await login(page)
      await page.goto(`/infra-form-design/preview?code=${fixture.code}`)

      // 按行定位再点详情 —— 夹具表是共用的，别的用例的残留行会打挂按全表的断言
      const row = page.locator('tr').filter({ hasText: mark })
      await expect(row).toHaveCount(1, { timeout: 60_000 })
      await row.getByRole('button', { name: '详情' }).click()

      // 表单是固定的第一个页签
      const formTab = page.getByRole('tab', { name: '表单' })
      await expect(formTab, '表单应当是第一个页签').toBeVisible({ timeout: 15_000 })
      await expect(formTab).toHaveAttribute('aria-selected', 'true')

      // 切到变更记录：时间线上要有那次改动（金额 → 77）
      await page.getByRole('tab', { name: '变更记录' }).click()
      await expect(page.getByText('金额', { exact: true }).first()).toBeVisible({
        timeout: 15_000
      })
      await expect(page.getByText('77', { exact: true }).first()).toBeVisible()
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 配了变更记录页签但没开变更日志，发布被拒绝', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 两个开关分处两个步骤，很容易只开一个 —— 而那样页签会永远是空的
      fixture = await createDraft(request, token, {
        detailTabs: JSON.stringify([{ key: 'changeLog', label: '变更记录', type: 'CHANGE_LOG' }])
      })
      const res = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await res.json()) as { code: number; msg: string }
      expect(body.code).not.toBe(0)
      expect(body.msg).toContain('变更记录')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  // ==================== B9 打印模板 ====================

  test('⚠️ 打印模板：配了才出现「打印」按钮，插值后的值进打印文档且被 HTML 转义', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    const created: any[] = []
    try {
      fixture = await createDraft(request, token, {
        formType: 2,
        logicRules: '[]',
        validateRules: '[]',
        listConf: JSON.stringify({
          columns: [{ field: 'reason', label: '原因' }],
          operationColumn: { show: true, label: '操作', width: 260, buttons: ['detail'] }
        }),
        printTemplate:
          '<h3>出库单</h3><table><tr><td>金额</td><td>{amount}</td></tr>' +
          '<tr><td>原因</td><td>{reason}</td></tr></table>'
      })
      await publishFixture(request, token, fixture)

      // 原因里刻意放一段脚本：值来自库里的字段，不比用户输入更可信 ——
      // 不转义的话它会在打印预览里执行
      const marker = `PRINT_${Date.now()}`
      const createRes = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        {
          headers: authHeaders(token),
          data: { amount: 66, reason: `${marker}<script>alert(1)</script>` }
        }
      )
      const createdBody = (await createRes.json()) as { code: number; data: any; msg: string }
      expect(createdBody.code, `写入失败：${createdBody.msg}`).toBe(0)
      created.push(createdBody.data)

      // 打印走的是 iframe.contentWindow.print()。headless 下 print() 本身是空操作，
      // 但把它盖掉更稳 —— 哪天有人加了 --headed 跑一次，一个卡住的打印对话框
      // 会让整组用例超时，而失败原因完全指不到这里
      await page.addInitScript(() => {
        window.print = () => {}
      })
      await login(page)
      await page.goto(`/infra-form-design/preview?code=${fixture!.code}`)

      // 按行定位，不按全表计数 —— 夹具表是所有运行时用例共用的，
      // 失败后没跑到清理的那次会留下数据行
      const row = page.locator('tr').filter({ hasText: marker }).first()
      await expect(row, '列表里应当能看到刚造的那一行').toBeVisible({ timeout: 60_000 })

      const printButton = row.getByRole('button', { name: '打印' })
      await expect(printButton, '配了打印模板后行操作里应当有「打印」').toBeVisible()
      await printButton.click()

      // 断言落在打印文档本身，而不是「按钮点得动」：后者一个空白模板也能通过。
      // printHtml 是把整份文档写进 iframe 的 srcdoc 的
      const srcdoc = page.locator('iframe[aria-hidden="true"]').first()
      await expect(srcdoc).toHaveAttribute('srcdoc', /出库单/, { timeout: 15_000 })
      const doc = (await srcdoc.getAttribute('srcdoc')) ?? ''
      expect(doc, '占位符应当换成这条记录的金额').toContain('66')
      expect(doc, '占位符应当换成这条记录的原因').toContain(marker)
      // 这一条是这组用例真正要钉住的：值里的脚本被转义成了文本
      expect(doc, '值里的 <script> 必须被转义').toContain('&lt;script&gt;')
      expect(doc, '打印文档里不得出现可执行的 script 标签').not.toContain('<script>')

      // ⚠️ srcdoc 属性对不等于文档真的渲染出来了。第一版把 iframe 先 append
      // 再 document.write，srcdoc 里的内容是对的、iframe 里却是空白 ——
      // 所以再落一条断言在 iframe 内部的 DOM 上，那才是打印流里的东西。
      // （print() 已被盖成空操作，afterprint 不会触发，iframe 不会被回收掉）
      const printFrame = page.frameLocator('iframe[aria-hidden="true"]').first()
      await expect(
        printFrame.locator('body'),
        '打印文档必须真的渲染出来，而不只是 srcdoc 属性对'
      ).toContainText(marker, { timeout: 15_000 })
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 没配打印模板时「打印」按钮不出现', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    const created: any[] = []
    try {
      // 无条件放按钮的话，点开是一张空白的打印预览，
      // 用户的第一反应是「打印功能坏了」
      fixture = await createDraft(request, token, {
        formType: 2,
        logicRules: '[]',
        validateRules: '[]',
        listConf: JSON.stringify({
          columns: [{ field: 'reason', label: '原因' }],
          operationColumn: { show: true, label: '操作', width: 260, buttons: ['detail'] }
        })
      })
      await publishFixture(request, token, fixture)

      const marker = `NOPRINT_${Date.now()}`
      const createRes = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { amount: 1, reason: marker } }
      )
      created.push(((await createRes.json()) as { data: any }).data)

      await login(page)
      await page.goto(`/infra-form-design/preview?code=${fixture.code}`)

      const row = page.locator('tr').filter({ hasText: marker }).first()
      await expect(row).toBeVisible({ timeout: 60_000 })
      // 详情按钮在，说明操作列确实渲染出来了 —— 少了这一条，
      // 「整个操作列没渲染」也会让下面的断言通过
      await expect(row.getByRole('button', { name: '详情' })).toBeVisible()
      await expect(row.getByRole('button', { name: '打印' })).toHaveCount(0)
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 打印模板引用了不存在的字段，发布被拒绝', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 这一条的失败方式是「没有失败」：占位符取不到值就印成空白，不报错。
      // 设计者拿到的反馈是「这一格印不出来」，而他会先去怀疑模板的样式
      fixture = await createDraft(request, token, {
        printTemplate: '<p>金额：{amount}</p><p>不存在：{no_such_field}</p>'
      })
      const res = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await res.json()) as { code: number; msg: string }
      expect(body.code, '引用不存在字段的打印模板必须被发布校验拦下').not.toBe(0)
      expect(body.msg).toContain('no_such_field')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 打印模板落库前被清洗：绕过界面塞进 <script>，读回来已经没有了', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 模板是设计者写的 HTML，与富文本字段同一个理由要过白名单。
      // 前端的编辑器不会产出 script，但改一改请求就能塞进去
      fixture = await createDraft(request, token, {
        printTemplate: '<p>金额：{amount}</p><script>alert(1)</script>'
      })
      const res = await request.get(`${API_BASE_URL}/infra/form-design/get?id=${fixture.id}`, {
        headers: authHeaders(token)
      })
      const body = (await res.json()) as { data: { printTemplate: string } }
      expect(body.data.printTemplate, '模板里的正常内容要保留').toContain('{amount}')
      expect(body.data.printTemplate, 'script 必须被清洗掉').not.toContain('script')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 超链接用了 javascript: 协议，发布被拒绝', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 地址是表单设计者配的、填表人点的，两者往往不是同一个信任级别 ——
      // 所以这一条必须由服务端把关，改一改请求就能绕过前端那份判断
      fixture = await createDraft(request, token, {
        formFields: [
          ...FORM_FIELDS,
          JSON.stringify({
            type: 'Link',
            field: 'bad_link',
            title: '危险链接',
            props: { url: 'javascript:alert(1)' }
          })
        ]
      })
      const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code, 'javascript: 协议的链接必须被发布校验拦下').not.toBe(0)
      expect(body.msg).toContain('危险链接')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 服务端复校验兜底：绕过界面直接提交，格式错的数据照样被拒', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)

      // 完全不经过界面，直接打接口 —— 前端的格式校验在这条路径上等于不存在
      const badFormat = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { mobile: 'abc' } }
      )
      const badBody = (await badFormat.json()) as { code: number; msg: string }
      expect(badBody.code, '手机号格式错误应当被服务端拒绝').not.toBe(0)
      expect(badBody.msg).toContain('手机号')

      // 跨字段校验同理
      const badRange = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        {
          headers: authHeaders(token),
          data: { start_date: '2026-09-10', end_date: '2026-09-01' }
        }
      )
      const rangeBody = (await badRange.json()) as { code: number; msg: string }
      expect(rangeBody.code, '结束日期早于开始日期应当被服务端拒绝').not.toBe(0)
      expect(rangeBody.msg).toContain('结束日期')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 公式由服务端权威重算：前端提交一个错的合计，落库的仍是算出来的值', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)

      // 构造请求把合计塞成 9999 —— 前端算出来的值不可信，服务端必须重算
      const created = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { qty: 3, price: 12.5, total: 9999 } }
      )
      const createdBody = (await created.json()) as { code: number; data: any; msg: string }
      expect(createdBody.code, `写入失败：${createdBody.msg}`).toBe(0)

      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${createdBody.data}`,
        { headers: authHeaders(token) }
      )
      const row = ((await detail.json()) as { data: Record<string, any> }).data
      expect(Number(row.total), '服务端应当用自己算的 37.5 覆盖前端提交的 9999').toBe(37.5)

      // 删掉这行数据。删表单不会连带删它写进夹具表的数据 ——
      // 不清的话夹具表会随着每次跑用例慢慢长胖
      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/delete?id=${createdBody.data}`,
        { headers: authHeaders(token) }
      )
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  // ==================== B8 富媒体：库里不得出现 base64 ====================

  test('⚠️ 绕过界面直接提交 base64 签名：服务端转存文件服务，落库只有 URL', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createRichMediaDraft(request, token)
      await publishFixture(request, token, fixture)

      // 前端的签名控件在「确认签名」时就已经上传、只提交 URL 了。
      // 这条走的是绕过它的那条路：直接把 canvas 直出的 base64 打进接口。
      // 单张签名的 base64 是 20–100KB，映射到 varchar 列根本写不进去
      const created = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { signature: PNG_DATA_URL } }
      )
      const createdBody = (await created.json()) as { code: number; data: any; msg: string }
      expect(createdBody.code, `写入失败：${createdBody.msg}`).toBe(0)

      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${createdBody.data}`,
        { headers: authHeaders(token) }
      )
      const row = ((await detail.json()) as { data: Record<string, any> }).data
      const stored = String(row.signature ?? '')
      expect(stored, '落库的签名不能是 base64').not.toContain('base64')
      expect(stored, '落库的签名应当是文件服务的地址').toMatch(/^https?:\/\//)

      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/delete?id=${createdBody.data}`,
        { headers: authHeaders(token) }
      )
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 富文本：内联 base64 图片被转存，script 与事件属性被清洗掉', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createRichMediaDraft(request, token)
      await publishFixture(request, token, fixture)

      const created = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        {
          headers: authHeaders(token),
          data: {
            detail:
              `<p style="color:red">正文</p><img src="${PNG_DATA_URL}">` +
              '<script>alert(1)</script><img src="http://cdn/a.png" onerror="alert(1)">'
          }
        }
      )
      const createdBody = (await created.json()) as { code: number; data: any; msg: string }
      expect(createdBody.code, `写入失败：${createdBody.msg}`).toBe(0)

      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${createdBody.data}`,
        { headers: authHeaders(token) }
      )
      const html = String(
        ((await detail.json()) as { data: Record<string, any> }).data.detail ?? ''
      )
      expect(html, '内联图片必须已转存，库里不得留 base64').not.toContain('base64')
      expect(html, 'script 标签必须被清洗掉').not.toContain('<script')
      expect(html, '事件属性必须被清洗掉').not.toContain('onerror')
      // ⚠️ 清洗不能顺手把排版也洗掉：编辑器的字号颜色对齐全靠内联样式，
      // 洗掉它的表现是「保存后格式全丢」，用户只会觉得富文本坏了
      expect(html, '内联样式要保留').toContain('color:red')

      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/delete?id=${createdBody.data}`,
        { headers: authHeaders(token) }
      )
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 签名字段映射到 varchar(50)，发布被拒绝', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 文件 URL 动辄 130 个字符以上。放到 varchar(50) 里，发布能过、界面能填，
      // 签完名点保存的那一刻才由数据库报截断错误；宽松模式的库更糟 ——
      // 它会把 URL 截断后照样存进去，那条记录的签名从此指向一个不存在的文件
      fixture = await createRichMediaDraft(request, token, 'sign_short')
      const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code, '放不下文件 URL 的列必须在发布期被拒').not.toBe(0)
      expect(body.msg).toContain('客户签名')
      expect(body.msg).toContain('sign_short')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  // ==================== 提交期超长值拦截（方案 §9.3 第 14 条） ====================

  test('⚠️ 向 varchar(255) 提交 10KB：服务端拦下并说清字段与上限，不是数据库层的 500', async ({
    request
  }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)

      // 不拦的话，用户拿到的是一句英文的
      // Data truncation: Data too long for column 'reason' at row 1 ——
      // 既看不出是界面上的哪个字段（列名和标题往往不一样），也不知道上限是多少
      const response = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { reason: 'a'.repeat(10240) } }
      )
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code, '超长值必须被服务端拦下').not.toBe(0)
      // 报错要能定位：字段标题、超了多少、上限多少、对应哪一列，四样缺一不可
      expect(body.msg, '要用字段标题而不是列名').toContain('原因')
      expect(body.msg).toContain('10240')
      expect(body.msg).toContain('255')
      expect(body.msg, '列名给实施人员改表用').toContain('reason')
      // 不能把整段值塞进错误消息 —— 拦下来的值动辄几 KB
      expect(body.msg.length, '错误消息不该把整个值带出来').toBeLessThan(300)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 多个字段同时超长，一次性全报出来', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)

      // 报第一条就返回的话，用户改完一处再提交又被拦下一处，来回好几轮。
      //
      // ⚠️ 这里刻意用 reason / memo 两个【没配格式校验】的字段。第一版用了 mobile，
      // 拿到的却是「请输入 11 位手机号」—— 格式校验在提交流水线里，
      // 而长度拦截在 serialize 之后（它要量的是落库形态），所以格式校验先触发。
      // 那不是 bug，但用它来验「长度错误会不会汇总」是验不到的
      const response = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        {
          headers: authHeaders(token),
          data: { reason: 'a'.repeat(300), memo: 'b'.repeat(400) }
        }
      )
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code).not.toBe(0)
      expect(body.msg).toContain('原因')
      expect(body.msg).toContain('备注')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('正好卡在上限与 255 个汉字都放行 —— varchar 的上限是字符数，不是字节数', async ({
    request
  }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    const created: any[] = []
    try {
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)

      // 边界差一个就是一次「配对了却存不进去」
      const exact = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { reason: 'a'.repeat(255) } }
      )
      const exactBody = (await exact.json()) as { code: number; data: any; msg: string }
      expect(exactBody.code, `正好 255 字符应当放行：${exactBody.msg}`).toBe(0)
      created.push(exactBody.data)

      // 255 个汉字在 utf8mb4 下是 765 字节，但 varchar(255) 的 255 是字符数。
      // 按字节比的话这里会被误拦，而它其实存得进去
      const chinese = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { reason: '中'.repeat(255) } }
      )
      const chineseBody = (await chinese.json()) as { code: number; data: any; msg: string }
      expect(chineseBody.code, `255 个汉字应当放行：${chineseBody.msg}`).toBe(0)
      created.push(chineseBody.data)
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ TEXT 列的上限是字节数：三万汉字被拦下，两万放行', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    const created: any[] = []
    try {
      // detail 是 text 列，上限 65535 【字节】
      fixture = await createRichMediaDraft(request, token)
      await publishFixture(request, token, fixture)

      // 20000 汉字 = 60000 字节 < 65535
      const ok = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { detail: '中'.repeat(20000) } }
      )
      const okBody = (await ok.json()) as { code: number; data: any; msg: string }
      expect(okBody.code, `六万字节应当放行：${okBody.msg}`).toBe(0)
      created.push(okBody.data)

      // 30000 汉字 = 30000 字符（按字符数比「没超」）= 90000 字节（实际会报 1406）。
      // 这一条正是按字符数比会静默漏掉的那一类 —— 漏了就退化成数据库层的 500
      const tooLong = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { detail: '中'.repeat(30000) } }
      )
      const body = (await tooLong.json()) as { code: number; msg: string }
      expect(body.code, 'TEXT 列按字节判定，三万汉字必须被拦下').not.toBe(0)
      expect(body.msg).toContain('90000 字节')
      expect(body.msg).toContain('65535 字节')
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  // ==================== 详情页页签：关联数据（B9） ====================

  /**
   * 造一张「子单据」表单：memo 列当外键（指向主记录的主键）
   *
   * ⚠️ 外键列必须是 varchar —— 主键是雪花 ID，放进 int 列会溢出，
   * 第一版拿 qty(int) 当外键，EQ 条件永远匹配不上，而页签只是空着，看不出原因
   */
  async function createChildForm(request: APIRequestContext, token: string): Promise<Fixture> {
    return createDraft(request, token, {
      formType: 2,
      logicRules: '[]',
      validateRules: '[]',
      formFields: [
        widget({ type: 'input', field: 'memo', title: '父单据', props: {} }),
        widget({ type: 'input', field: 'reason', title: '说明', props: {} })
      ],
      listConf: JSON.stringify({
        columns: [{ field: 'reason', label: '说明' }],
        operationColumn: { show: true, label: '操作', width: 150, buttons: ['detail'] }
      }),
      tableBinding: JSON.stringify({
        ...TABLE_BINDING,
        fieldMapping: {
          memo: column('memo', 'VARCHAR'),
          reason: column('reason', 'VARCHAR')
        }
      })
    })
  }

  test('⚠️ 关联数据页签：详情里列出挂在这条记录下面的单据，不含别人的', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    let parent: Fixture | undefined
    let child: Fixture | undefined
    const created: Array<{ code: string; id: any }> = []
    try {
      child = await createChildForm(request, token)
      await publishFixture(request, token, child)

      const marker = `REL_${Date.now()}`
      parent = await createDraft(request, token, {
        formType: 2,
        logicRules: '[]',
        validateRules: '[]',
        listConf: JSON.stringify({
          columns: [{ field: 'reason', label: '说明' }],
          operationColumn: { show: true, label: '操作', width: 150, buttons: ['detail'] }
        }),
        detailTabs: JSON.stringify([
          {
            key: 'children',
            label: '子单据',
            type: 'RELATION_LIST',
            targetFormCode: child.code,
            targetField: 'memo'
          }
        ])
      })
      await publishFixture(request, token, parent)

      // 一条主记录
      const parentRes = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${parent.code}/create`,
        { headers: authHeaders(token), data: { reason: marker } }
      )
      const parentBody = (await parentRes.json()) as { code: number; data: any; msg: string }
      expect(parentBody.code, `建主记录失败：${parentBody.msg}`).toBe(0)
      const parentId = String(parentBody.data)
      created.push({ code: parent.code, id: parentBody.data })

      // 两条挂在它下面的 + 一条挂在别处的。第三条是这条用例的重点：
      // 关联条件真的生效的话，它不该出现在页签里
      for (const item of [
        { memo: parentId, reason: `${marker}_子A` },
        { memo: parentId, reason: `${marker}_子B` },
        { memo: '99999999999', reason: `${marker}_别人的` }
      ]) {
        const res = await request.post(
          `${API_BASE_URL}/infra/form-design/runtime/${child.code}/create`,
          { headers: authHeaders(token), data: item }
        )
        const body = (await res.json()) as { code: number; data: any; msg: string }
        expect(body.code, `建子记录失败：${body.msg}`).toBe(0)
        created.push({ code: child.code, id: body.data })
      }

      const pageErrors: string[] = []
      page.on('pageerror', (e) => pageErrors.push(e.message))
      await login(page)
      await page.goto(`/infra-form-design/preview?code=${parent.code}`)

      const row = page.locator('tr').filter({ hasText: marker }).first()
      await expect(row).toBeVisible({ timeout: 60_000 })
      await row.getByRole('button', { name: '详情' }).click()

      // 切到关联数据页签。⚠️ 断言必须限定在页签面板内 —— 父子表单绑的是同一张
      // 夹具表，主列表里也有这些子记录，按全页找会命中两处（strict mode 直接失败），
      // 而「别人的不在」那条更会因为主列表里有它而误判
      await page.getByRole('tab', { name: '子单据' }).click()
      const panel = page.getByRole('tabpanel', { name: '子单据' })
      await expect(panel.getByText(`${marker}_子A`)).toBeVisible({ timeout: 15_000 })
      await expect(panel.getByText(`${marker}_子B`)).toBeVisible()
      // ⚠️ 这一条才是重点：关联字段写错时运行时会【静默忽略】条件，
      // 把目标表单的全部数据列出来。不断言「别人的不在」的话，那种情况也会通过
      await expect(panel.getByText(`${marker}_别人的`)).toHaveCount(0)
      expect(pageErrors, `详情渲染时抛了异常：${pageErrors.join(' / ')}`).toEqual([])
    } finally {
      for (const item of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${item.code}/delete?id=${item.id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, parent)
      await cleanup(request, token, child)
    }
  })

  test('⚠️ 关联字段不在目标表单上，发布被拒绝', async ({ request }) => {
    const token = await apiLogin(request)
    let parent: Fixture | undefined
    let child: Fixture | undefined
    try {
      child = await createChildForm(request, token)
      await publishFixture(request, token, child)

      // 字段名写错时，分页接口对认不出的字段是【静默忽略】（那是它刻意的容错），
      // 于是页签会列出目标表单的全部数据 —— 看起来像是把别人家的单据也带出来了
      parent = await createDraft(request, token, {
        detailTabs: JSON.stringify([
          {
            key: 'children',
            label: '子单据',
            type: 'RELATION_LIST',
            targetFormCode: child.code,
            targetField: 'no_such_field'
          }
        ])
      })
      const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: parent.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code).not.toBe(0)
      expect(body.msg).toContain('no_such_field')
    } finally {
      await cleanup(request, token, parent)
      await cleanup(request, token, child)
    }
  })

  test('⚠️ 目标表单还没发布，发布被拒绝 —— 运行时调的是它的分页接口', async ({ request }) => {
    const token = await apiLogin(request)
    let parent: Fixture | undefined
    let child: Fixture | undefined
    try {
      // 刻意不发布子表单
      child = await createChildForm(request, token)
      parent = await createDraft(request, token, {
        detailTabs: JSON.stringify([
          {
            key: 'children',
            label: '子单据',
            type: 'RELATION_LIST',
            targetFormCode: child.code,
            targetField: 'memo'
          }
        ])
      })
      const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: parent.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code).not.toBe(0)
      expect(body.msg).toContain(child.code)
    } finally {
      await cleanup(request, token, parent)
      await cleanup(request, token, child)
    }
  })

  // ==================== 自定义按钮：调数据接口（B9） ====================

  /**
   * 造一个写型的数据接口（UPDATE），供「调数据接口」按钮引用
   *
   * ⚠️ 必须是写型的 —— 这个动作存在的理由就是控件取选项那条路
   * （`/data-interface/options`）被服务端强制只允许读取型，作废单据这类过不去。
   */
  async function createWriteInterface(
    request: APIRequestContext,
    token: string
  ): Promise<{ id: number; code: string }> {
    const code = `e2e_void_${Date.now()}`
    const response = await request.post(`${API_BASE_URL}/infra/data-interface/create`, {
      headers: authHeaders(token),
      data: {
        name: '作废单据(e2e)',
        code,
        type: 1,
        status: 0,
        dataSourceConfigId: 0,
        config: `UPDATE ${FIXTURE_TABLE} SET reason = '已作废' WHERE id = #{id}`,
        sqlStatementType: 'UPDATE',
        params: [{ name: 'id', type: 'String', required: true }],
        riskConfirmed: true
      }
    })
    const body = (await response.json()) as { code: number; data: number; msg: string }
    expect(body.code, `造数据接口失败：${body.msg}`).toBe(0)
    return { id: body.data, code }
  }

  const invokeButtonUrl = (formCode: string, buttonKey: string, id?: any) =>
    `${API_BASE_URL}/infra/form-design/runtime/${formCode}/invoke-button` +
    `?buttonKey=${encodeURIComponent(buttonKey)}${id === undefined ? '' : `&id=${id}`}`

  test('⚠️ 调数据接口按钮：写型接口能执行，记录真的被改了', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    let iface: { id: number; code: string } | undefined
    const created: any[] = []
    try {
      iface = await createWriteInterface(request, token)
      fixture = await createDraft(request, token, {
        customButtons: JSON.stringify([
          {
            key: 'voidOrder',
            label: '作废',
            position: 'ROW',
            action: {
              type: 'INVOKE',
              interfaceCode: iface.code,
              // 入参由服务端按这份映射、从它自己重新读的记录里取
              params: [{ name: 'id', field: 'id' }],
              successMessage: '已作废'
            }
          }
        ])
      })
      await publishFixture(request, token, fixture)

      const create = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { reason: '待处理' } }
      )
      const createBody = (await create.json()) as { code: number; data: any; msg: string }
      expect(createBody.code, `写入失败：${createBody.msg}`).toBe(0)
      created.push(createBody.data)

      const invoke = await request.post(
        invokeButtonUrl(fixture.code, 'voidOrder', createBody.data),
        { headers: authHeaders(token) }
      )
      const invokeBody = (await invoke.json()) as { code: number; msg: string }
      expect(invokeBody.code, `调用失败：${invokeBody.msg}`).toBe(0)

      // 断言落在【数据真的变了】上，而不是「接口返回 0」——
      // 后者一个什么都没做的接口也能通过
      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${createBody.data}`,
        { headers: authHeaders(token) }
      )
      const row = ((await detail.json()) as { data: Record<string, any> }).data
      expect(row.reason).toBe('已作废')
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
      if (iface) {
        await request.delete(`${API_BASE_URL}/infra/data-interface/delete?id=${iface.id}`, {
          headers: authHeaders(token)
        })
      }
    }
  })

  test('⚠️ 端点只认按钮标识：直接送接口编码调不动，这是它全部安全性的来源', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    let iface: { id: number; code: string } | undefined
    try {
      iface = await createWriteInterface(request, token)
      // 这张表单【没有】任何 INVOKE 按钮 —— 也就是没给这个接口接过线
      fixture = await createDraft(request, token)
      await publishFixture(request, token, fixture)

      // 把接口编码当按钮标识送进去。能调通的话，这个端点就等于
      // 「任何对某张表单有 update 权限的人都能调任意写型数据接口」
      const byInterfaceCode = await request.post(invokeButtonUrl(fixture.code, iface.code, 1), {
        headers: authHeaders(token)
      })
      const body = (await byInterfaceCode.json()) as { code: number; msg: string }
      expect(body.code, '送接口编码必须调不动').not.toBe(0)
      expect(body.msg).toContain(iface.code)

      // 不存在的按钮标识同理
      const unknown = await request.post(invokeButtonUrl(fixture.code, 'notExists', 1), {
        headers: authHeaders(token)
      })
      expect(((await unknown.json()) as { code: number }).code).not.toBe(0)
    } finally {
      await cleanup(request, token, fixture)
      if (iface) {
        await request.delete(`${API_BASE_URL}/infra/data-interface/delete?id=${iface.id}`, {
          headers: authHeaders(token)
        })
      }
    }
  })

  test('⚠️ 跳转按钮不能用这个端点执行 —— 动作类型对不上要拦', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createDraft(request, token, {
        customButtons: JSON.stringify([
          { key: 'go', label: '跳转', position: 'ROW', action: { type: 'NAVIGATE', url: '/index' } }
        ])
      })
      await publishFixture(request, token, fixture)

      const response = await request.post(invokeButtonUrl(fixture.code, 'go', 1), {
        headers: authHeaders(token)
      })
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code).not.toBe(0)
      expect(body.msg).toContain('跳转')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 引用了不存在的数据接口，发布被拒绝', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      // 接口被删了而按钮还留着：点下去只会报一句用户看不懂的错，
      // 而他不知道是接口没了。发布是拦住它的地方
      fixture = await createDraft(request, token, {
        customButtons: JSON.stringify([
          {
            key: 'ghost',
            label: '幽灵按钮',
            position: 'ROW',
            action: { type: 'INVOKE', interfaceCode: 'no_such_interface' }
          }
        ])
      })
      const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code).not.toBe(0)
      expect(body.msg).toContain('no_such_interface')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 入参映射引用了不存在的字段，发布被拒绝 —— 它会静默传空', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    let iface: { id: number; code: string } | undefined
    try {
      iface = await createWriteInterface(request, token)
      // 接口收到一个空的单号照样会执行，作废动作就作用在了错误的对象上，
      // 而界面上一切正常 —— 这一条比「按钮画不出来」严重得多
      fixture = await createDraft(request, token, {
        customButtons: JSON.stringify([
          {
            key: 'badParam',
            label: '入参配错',
            position: 'ROW',
            action: {
              type: 'INVOKE',
              interfaceCode: iface.code,
              params: [{ name: 'id', field: 'no_such_field' }]
            }
          }
        ])
      })
      const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: fixture.id, parentMenuId: PARENT_MENU_ID }
      })
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code).not.toBe(0)
      expect(body.msg).toContain('no_such_field')
    } finally {
      await cleanup(request, token, fixture)
      if (iface) {
        await request.delete(`${API_BASE_URL}/infra/data-interface/delete?id=${iface.id}`, {
          headers: authHeaders(token)
        })
      }
    }
  })

  // ==================== B8 上传值契约：{name, size, type} ====================

  test('⚠️ 上传值落库补齐元信息：前端只发 URL，库里存 [{name,url,size,type}]', async ({
    request
  }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    const created: any[] = []
    try {
      // 真传一个文件，让 infra_file 里有它的原文件名/大小/MIME —— 元信息就是从那儿来的。
      // 造一个假 URL 的话查不到元信息，这条用例会退化成「什么都没验」
      const fileName = `合同扫描件_${Date.now()}.txt`
      const upload = await request.post(`${API_BASE_URL}/infra/file/upload`, {
        headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID },
        multipart: {
          file: { name: fileName, mimeType: 'text/plain', buffer: Buffer.from('hello b8') }
        }
      })
      const uploadBody = (await upload.json()) as { code: number; data: string; msg: string }
      expect(uploadBody.code, `上传失败：${uploadBody.msg}`).toBe(0)
      const url = uploadBody.data

      fixture = await createDraft(request, token, {
        formFields: [
          ...FORM_FIELDS,
          widget({ type: 'UploadFile', field: 'detail', title: '附件', props: {} })
        ],
        tableBinding: JSON.stringify({
          ...TABLE_BINDING,
          fieldMapping: { ...TABLE_BINDING.fieldMapping, detail: column('detail', 'LONGVARCHAR') }
        })
      })
      await publishFixture(request, token, fixture)

      // 共享的上传组件只发 URL（src 下有 80 个调用方，改不得），
      // 所以这里也只发 URL —— 补元信息是服务端的事
      const create = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { detail: [url] } }
      )
      const createBody = (await create.json()) as { code: number; data: any; msg: string }
      expect(createBody.code, `写入失败：${createBody.msg}`).toBe(0)
      created.push(createBody.data)

      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${createBody.data}`,
        { headers: authHeaders(token) }
      )
      const row = ((await detail.json()) as { data: Record<string, any> }).data
      expect(Array.isArray(row.detail), '落库形态应当是数组').toBeTruthy()
      const item = row.detail[0]
      // 这四个键就是设计方案 §5.9 要的契约。原文件名是核心 ——
      // 补齐之前库里只有 /20260911/xxx 这样的地址，看不出这是什么文件
      expect(item.name).toBe(fileName)
      expect(item.url).toBe(url)
      expect(item.size).toBe(8)
      expect(item.type).toContain('text/plain')
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 查不到元信息的外部地址保持原样，不造一个只有 url 的假对象', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    const created: any[] = []
    try {
      fixture = await createDraft(request, token, {
        formFields: [
          ...FORM_FIELDS,
          widget({ type: 'UploadFile', field: 'detail', title: '附件', props: {} })
        ],
        tableBinding: JSON.stringify({
          ...TABLE_BINDING,
          fieldMapping: { ...TABLE_BINDING.fieldMapping, detail: column('detail', 'LONGVARCHAR') }
        })
      })
      await publishFixture(request, token, fixture)

      // 一个 infra_file 里没有的地址（外部系统贴进来的）。补成 {url} 的话，
      // 同一个字段里一半是对象一半是字符串，读的人无从判断
      const external = 'https://example.com/outside.pdf'
      const create = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { detail: [external] } }
      )
      const createBody = (await create.json()) as { code: number; data: any; msg: string }
      expect(createBody.code, `写入失败：${createBody.msg}`).toBe(0)
      created.push(createBody.data)

      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${createBody.data}`,
        { headers: authHeaders(token) }
      )
      const row = ((await detail.json()) as { data: Record<string, any> }).data
      expect(row.detail).toEqual([external])
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 单图与签名仍是裸 URL —— 落库形态是 scalar', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    const created: any[] = []
    try {
      const upload = await request.post(`${API_BASE_URL}/infra/file/upload`, {
        headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID },
        multipart: {
          file: { name: `sign_${Date.now()}.png`, mimeType: 'image/png', buffer: Buffer.from('x') }
        }
      })
      const url = ((await upload.json()) as { data: string }).data

      fixture = await createRichMediaDraft(request, token)
      await publishFixture(request, token, fixture)

      // 签名字段只有一个值，包一层对象换不来什么；而 FIRST_URL 那条落库路径也要跟着改
      const create = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { signature: url } }
      )
      const createBody = (await create.json()) as { code: number; data: any; msg: string }
      expect(createBody.code, `写入失败：${createBody.msg}`).toBe(0)
      created.push(createBody.data)

      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${createBody.data}`,
        { headers: authHeaders(token) }
      )
      const row = ((await detail.json()) as { data: Record<string, any> }).data
      expect(typeof row.signature, '签名应当仍是裸 URL 字符串').toBe('string')
      expect(row.signature).toBe(url)
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 详情页能渲染出附件：库里是对象数组，运行时收敛回 URL 交给共享组件', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    const created: any[] = []
    try {
      const upload = await request.post(`${API_BASE_URL}/infra/file/upload`, {
        headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID },
        multipart: {
          file: { name: `ui_${Date.now()}.txt`, mimeType: 'text/plain', buffer: Buffer.from('ui') }
        }
      })
      const url = ((await upload.json()) as { data: string }).data
      const tail = url.substring(url.lastIndexOf('/') + 1)

      const marker = `B8UI_${Date.now()}`
      fixture = await createDraft(request, token, {
        formType: 2,
        logicRules: '[]',
        validateRules: '[]',
        formFields: [
          ...FORM_FIELDS,
          widget({ type: 'UploadFile', field: 'detail', title: '附件', props: {} })
        ],
        listConf: JSON.stringify({
          columns: [{ field: 'reason', label: '原因' }],
          operationColumn: { show: true, label: '操作', width: 200, buttons: ['detail'] }
        }),
        tableBinding: JSON.stringify({
          ...TABLE_BINDING,
          fieldMapping: { ...TABLE_BINDING.fieldMapping, detail: column('detail', 'LONGVARCHAR') }
        })
      })
      await publishFixture(request, token, fixture)

      const create = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { reason: marker, detail: [url] } }
      )
      const createBody = (await create.json()) as { code: number; data: any; msg: string }
      expect(createBody.code, `写入失败：${createBody.msg}`).toBe(0)
      created.push(createBody.data)

      // ⚠️ 抓 pageerror：共享的 UploadFile 拿到对象会在
      // url.substring(url.lastIndexOf('/')) 上抛 TypeError，而那发生在渲染里 ——
      // 表现是整张表单一片空白，控制台只有一句看不出出处的报错。
      // 不抓的话这条用例会因为「什么都没渲染出来」而以别的方式失败，指不到真因
      const pageErrors: string[] = []
      page.on('pageerror', (e) => pageErrors.push(e.message))

      await login(page)
      await page.goto(`/infra-form-design/preview?code=${fixture.code}`)
      const row = page.locator('tr').filter({ hasText: marker }).first()
      await expect(row).toBeVisible({ timeout: 60_000 })
      await row.getByRole('button', { name: '详情' }).click()

      // 附件控件要真的把文件渲染出来。共享组件按 URL 的最后一段做显示名
      await expect(page.getByText(tail).first(), '详情里应当能看到附件').toBeVisible({
        timeout: 15_000
      })
      expect(pageErrors, `详情渲染时抛了异常：${pageErrors.join(' / ')}`).toEqual([])
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 手写签名控件：画完确认后，值是文件 URL 而不是 base64', async ({ page, request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createRichMediaDraft(request, token)
      await publishFixture(request, token, fixture)
      await login(page)
      await openRuntime(page, fixture.code)

      const item = itemOf(page, '客户签名')
      const canvas = item.locator('canvas')
      await expect(canvas, '签名控件应当渲染出画布').toBeVisible({ timeout: 30_000 })

      // 在画布上划一笔。pointer 事件覆盖鼠标/触屏/手写笔，
      // Playwright 的 mouse 动作会产生 pointerdown/move/up
      const box = (await canvas.boundingBox())!
      await page.mouse.move(box.x + 20, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2 - 20, { steps: 12 })
      await page.mouse.up()

      await item.getByRole('button', { name: '确认签名' }).click()

      // 确认后切换到已签状态：展示的是文件服务返回的图片地址。
      // ⚠️ 断言 src 不含 base64 是这条用例的全部意义 —— 上传失败时控件
      // 刻意不拿 base64 兜底，那样会让界面看起来成功而库里存下一串 base64
      const image = item.locator('img')
      await expect(image, '确认后应当展示已签名的图片').toBeVisible({ timeout: 30_000 })
      const src = (await image.getAttribute('src')) ?? ''
      expect(src, '签名的值不能是 base64').not.toContain('base64')
      expect(src, '签名的值应当是文件服务的地址').toMatch(/^https?:\/\//)
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  // ==================== 数组值落库 ====================

  test('⚠️ 数组值能进一列里去：多选存分隔串、多图存 JSON，读回来还是数组', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createArrayValueDraft(request, token)
      await publishFixture(request, token, fixture)

      // 改造前这一步是 500：值原样交给 JDBC，MySQL 驱动把 ArrayList 当
      // Serializable 序列化成字节流往列里写，报
      // 「Incorrect string value: '\xAC\xED\x00\x05sr...'」
      const file = { name: 'a.png', url: 'http://cdn/a.png', size: 100, type: 'image/png' }
      const created = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { tags: ['a', 'b'], detail: [file] } }
      )
      const createdBody = (await created.json()) as { code: number; data: any; msg: string }
      expect(createdBody.code, `写入失败：${createdBody.msg}`).toBe(0)

      // ⚠️ 读方向必须与写方向成对。只做写不做读的话，这里拿到的是
      // 「a,b」这样一串原始字符串 —— 提交看起来成功了，打开却是乱的
      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${createdBody.data}`,
        { headers: authHeaders(token) }
      )
      const row = ((await detail.json()) as { data: Record<string, any> }).data
      expect(row.tags, '多选值应当还原成数组').toEqual(['a', 'b'])
      expect(Array.isArray(row.detail), '多图值应当还原成数组').toBeTruthy()
      expect(row.detail[0]?.url).toBe('http://cdn/a.png')

      // 更新走的是另一条 SQL 构建路径，同样要覆盖
      const updated = await request.put(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/update?id=${createdBody.data}`,
        { headers: authHeaders(token), data: { id: createdBody.data, tags: ['b'], detail: [] } }
      )
      const updatedBody = (await updated.json()) as { code: number; msg: string }
      expect(updatedBody.code, `更新失败：${updatedBody.msg}`).toBe(0)

      const after = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${createdBody.data}`,
        { headers: authHeaders(token) }
      )
      const afterRow = ((await after.json()) as { data: Record<string, any> }).data
      expect(afterRow.tags, '更新后仍是数组').toEqual(['b'])

      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/delete?id=${createdBody.data}`,
        { headers: authHeaders(token) }
      )
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 选项值里含分隔符：报错而不是静默多存一项', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: Fixture | undefined
    try {
      fixture = await createArrayValueDraft(request, token)
      await publishFixture(request, token, fixture)

      // 照拼进去的话，读回来是三项而不是两项，且不会有任何报错
      const created = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { tags: ['a,b', 'c'] } }
      )
      const body = (await created.json()) as { code: number; msg: string }
      expect(body.code, '值里含分隔符必须被拒绝').not.toBe(0)
      expect(body.msg).toContain('标签')
    } finally {
      await cleanup(request, token, fixture)
    }
  })
})
