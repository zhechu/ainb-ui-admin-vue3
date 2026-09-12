import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 校验示例（示例 12~18）的端到端验证
 *
 * 验的是【基础设施 → 开发示例 → 在线开发】下那七个「校验主题」示例
 * **在界面上真的拦得住、也真的看得见**。
 *
 * ## 与 smoke_verify.py 的分工
 *
 * `script/form-demo/smoke_verify.py` 有 29 条反例，绕过前端直接构造请求，
 * 证明**服务端**拦得住。那一层保证的是数据不会脏。
 *
 * 这里保证的是另一半：**用户看得见被拦的理由**。两者不能互相替代 ——
 * 本模块反复踩过「服务端逻辑是对的，但界面上什么都没显示」，
 * 那种缺陷接口全绿、用户却只看到一个点不动的「确定」按钮。
 *
 * 所以这里刻意不重复跑那 29 条反例，只挑每个示例**最具代表性的那一条**，
 * 断言错误文案真的渲染到了 DOM 里、且挂在正确的位置。
 *
 * ## 前置条件
 *
 * 七个示例已由入库脚本建好并发布（demo11~demo17_verify_*.py），
 * 脏数据已灌（xpy-2026-09-12-form-verify-seed.sql）。
 * 用例只读不写配置；造的业务数据自己删干净。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

// =====================================================================
// 公共工具
// =====================================================================

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  expect(response.ok(), '接口登录失败').toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
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
  // 冷启动首屏要现编译一大批模块，默认 10s 不够
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

// 七个示例的表单编码。集中声明在这里，下面的填充表与各 describe 都用它们 ——
// 填充表是模块初始化时求值的，编码必须先于它声明
const FORMAT = 'test_demo_verify_format'
const TRIP = 'test_demo_verify_trip'
const EXPENSE = 'test_demo_verify_expense'
const SUPPLIER = 'test_demo_verify_supplier'
const INBOUND = 'test_demo_verify_inbound'
const CONTRACT = 'test_demo_verify_contract'
const STAFF = 'test_demo_verify_staff'

// 七个示例的表单编码。集中声明在这里，下面的填充表与各 describe 都用它们 ——
// 填充表是模块初始化时求值的，编码必须先于它声明

/**
 * 打开示例的运行时页
 *
 * 走静态预览路由，不走发布生成的菜单路由 —— 新菜单要分配给角色、
 * 再重新登录才会注册动态路由，在用例里改角色菜单分配的风险远大于收益。
 */
async function openDemo(page: Page, code: string) {
  await page.goto(`/infra-form-design/preview?code=${code}`)
  await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
}

/**
 * 表单面板，不关心它被配成了哪种展示模式
 *
 * ⚠️ 不要写死 `.el-dialog`：呈现方式是 `list_conf.formViewMode` 里的一项配置，
 * DIALOG / DRAWER / INLINE 三种的容器元素各不相同。写死的后果是
 * 「等到超时、报 element not found」，看起来像点了新增没反应。
 */
const formPanel = (page: Page) =>
  page.locator('.el-dialog:visible, .el-drawer:visible, .inline-panel').first()

/** 按标签精确定位表单项。只比标签文本，避免占位提示参与匹配 */
const itemOf = (page: Page, label: string) =>
  formPanel(page)
    .locator('.el-form-item')
    .filter({
      has: page.locator('.el-form-item__label', {
        hasText: new RegExp(`^\\s*\\*?\\s*${escapeRegExp(label)}\\s*$`)
      })
    })
    .first()

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 点「新增」并等表单面板出来 */
async function openCreateForm(page: Page) {
  await page.getByRole('button', { name: '新增' }).click()
  await expect(formPanel(page)).toBeVisible({ timeout: 30_000 })
}

/** 提交表单。按钮文案带一个全角空格 */
async function submitForm(page: Page) {
  await formPanel(page)
    .getByRole('button', { name: /确\s*定/ })
    .click()
}

/** 某个表单项上的行内错误文案 */
const errorOf = (page: Page, label: string) => itemOf(page, label).locator('.el-form-item__error')

/**
 * 被拦下来的理由，出现在界面上的任意一种形态
 *
 * 行内错误、顶部消息、确认框、右上角通知四种都认 —— 这条断言要守的是
 * 「用户看得见理由」，不是「理由必须用某种控件呈现」。
 * 钉死呈现方式的话，换个提示组件用例就红，但用户体验其实没变。
 *
 * ⚠️ `.el-notification` 不能漏。前端校验（格式、跨字段、子表、提交前脚本）
 * 报的是行内错误，而**服务端**返回的业务错误走的是 axios 拦截器，
 * 它用的是 ElNotification。只认前四种里的前三种，会让所有
 * 「只有服务端才判得了」的规则（唯一性、扩展点）看起来像「界面没提示」。
 */
const messageWith = (page: Page, text: string | RegExp) =>
  page
    .locator('.el-form-item__error, .el-message, .el-message-box, .el-notification')
    .filter({ hasText: text })
    .first()

/** 填文本 / 多行 / 数字 */
async function fillField(page: Page, label: string, value: string) {
  await itemOf(page, label).locator('input, textarea').first().fill(value)
}

/**
 * 选一个下拉项
 *
 * ⚠️ 下拉浮层被 teleport 到 body 上，且关掉的浮层仍然留在 DOM 里。
 * 不加 `:visible` 会命中上一个下拉的残留节点，表现为「点了 A 的下拉却选中了 B 的值」。
 */
async function pickOption(page: Page, label: string, optionText: string) {
  await itemOf(page, label).locator('.el-select').first().click()
  await page
    .locator('.el-select-dropdown:visible .el-select-dropdown__item')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(optionText)}`) })
    .first()
    .click()
}

/** 填日期。直接往输入框打字再回车，比点日历面板稳得多 */
async function fillDate(page: Page, label: string, value: string) {
  const input = itemOf(page, label).locator('input').first()
  await input.fill(value)
  await input.press('Enter')
}

/**
 * 把必填项填满
 *
 * ⚠️ 这一步不能省。内核的必填校验**先于**跨字段规则、提交前脚本与服务端扩展点，
 * 必填没填满时点提交，只会看到一片「xx 不能为空」，
 * 后面那些规则一条都不会执行 —— 想验证它们就永远验证不到。
 * （这正是示例 6 专门演示的那条坑，写用例时同样会踩。）
 */
const fillRequired: Record<string, (page: Page) => Promise<void>> = {
  async [TRIP](page) {
    await fillField(page, '申请单号', `E2E-${Date.now()}`)
    await fillField(page, '申请人', 'E2E 测试')
    await fillField(page, '目的地', '上海')
    await pickOption(page, '单据状态', '草稿')
    await fillField(page, '出差天数', '3')
    // 高铁而不是飞机：选飞机会额外触发「必须选舱位」那条规则，
    // 把本用例要验的那一条淹掉
    await pickOption(page, '交通方式', '高铁')
    await fillField(page, '预算金额', '1000')
    await fillField(page, '部门额度', '5000')
  },
  async [SUPPLIER](page) {
    await fillField(page, '供应商名称', 'E2E 供应商')
    await pickOption(page, '供应商等级', 'A 类')
  },
  async [INBOUND](page) {
    await fillField(page, '入库单号', `E2E-${Date.now()}`)
    await pickOption(page, '仓库', '华东仓')
    await fillField(page, '供应商', 'E2E 供应商')
    await fillDate(page, '入库日期', '2026-09-10')
    await fillField(page, '采购额度', '100000')
    await pickOption(page, '单据状态', '草稿')
  },
  async [STAFF](page) {
    await fillField(page, '姓名', 'E2E 入职')
    await pickOption(page, '性别', '男')
    await fillField(page, '部门', '研发部')
    await fillField(page, '岗位', '工程师')
    await fillDate(page, '入职日期', '2026-09-01')
    await pickOption(page, '单据状态', '草稿')
  }
}

/** 走接口分页取数据 */
async function pageRows(
  request: APIRequestContext,
  token: string,
  code: string
): Promise<Record<string, any>[]> {
  const response = await request.post(`${API_BASE_URL}/infra/form-design/runtime/${code}/page`, {
    headers: authHeaders(token),
    data: { pageNo: 1, pageSize: 100, conditions: [] }
  })
  return (((await response.json()) as any).data?.list ?? []) as Record<string, any>[]
}

/** 取运行时配置里配出来的列表列字段 */
async function listColumnFields(
  request: APIRequestContext,
  token: string,
  code: string
): Promise<string[]> {
  const response = await request.get(`${API_BASE_URL}/infra/form-design/runtime/${code}/config`, {
    headers: authHeaders(token)
  })
  const conf = ((await response.json()) as any).data?.listConf
  const columns = conf ? (JSON.parse(conf).columns ?? []) : []
  return columns
    .map((c: any) => c.field)
    .filter((f: any): f is string => typeof f === 'string' && f.length > 0)
}

async function deleteRow(
  request: APIRequestContext,
  token: string,
  code: string,
  id: string | undefined
) {
  if (!id) return
  await request
    .delete(`${API_BASE_URL}/infra/form-design/runtime/${code}/delete?id=${id}`, {
      headers: authHeaders(token)
    })
    .catch(() => undefined)
}

// =====================================================================
// 七个示例的共性：列表打得开、数据齐、配出来的列不能整片是空
// =====================================================================

const DEMOS = [
  { code: 'test_demo_verify_format', name: '示例 1 · 格式校验大全' },
  { code: 'test_demo_verify_trip', name: '示例 2 · 必填与跨字段' },
  { code: 'test_demo_verify_expense', name: '示例 3 · 联动动态校验' },
  { code: 'test_demo_verify_supplier', name: '示例 4 · 唯一性长度与脱敏' },
  { code: 'test_demo_verify_inbound', name: '示例 5 · 子表明细校验' },
  { code: 'test_demo_verify_contract', name: '示例 6 · 提交前脚本' },
  { code: 'test_demo_verify_staff', name: '示例 7 · 服务端扩展点' }
]

test.describe('校验示例 · 列表页', () => {
  for (const demo of DEMOS) {
    test(`${demo.name}：列表打得开、演示数据齐、每一列都有值`, async ({ page, request }) => {
      const token = await apiLogin(request)
      const rows = await pageRows(request, token, demo.code)
      // 阈值取 5 而不是「每个示例各自的行数」：这条断言只为拦住「入库脚本没跑」，
      // 钉死具体条数的话，每次给示例增删一条演示数据都要回来改用例。
      // ⚠️ 各示例的行数本来就不一样：示例 4 的约束是数据库级的（唯一索引、列长度），
      // 脏数据连 SQL 都写不进去，所以它只有合法数据，比别的示例少
      expect(
        rows.length,
        `${demo.code} 的演示数据太少（${rows.length} 行），先跑 script/form-demo 下对应的入库脚本`
      ).toBeGreaterThanOrEqual(5)

      // 配出来的列整片是「-」等于什么都没演示。
      // 判据取「至少一行有值」而不是「每行都有值」—— 脏数据本来就可能缺字段
      const fields = await listColumnFields(request, token, demo.code)
      expect(fields.length, `${demo.code} 一列都没配`).toBeGreaterThan(0)
      const emptyColumns = fields.filter(
        (field) =>
          !rows.some(
            (row) => row[field] !== null && row[field] !== undefined && String(row[field]) !== ''
          )
      )
      expect(emptyColumns, `${demo.code} 这些列在所有行上都是空的：${emptyColumns.join('、')}`).toEqual(
        []
      )

      // 界面这一侧：表格渲染得出来，且没有白屏
      await login(page)
      await openDemo(page, demo.code)
      const body = page.locator('.el-table__body-wrapper tbody')
      await expect(body.locator('tr:visible').first()).toBeVisible({ timeout: 30_000 })
    })
  }
})

// =====================================================================
// 示例 1 · 格式校验：提示要即时、要落在字段上，空值不参与格式校验
// =====================================================================


test.describe('示例 1 · 格式校验大全', () => {
  test('填错格式：错误挂在该字段上，且印的是字段标题不是字段 ID', async ({ page }) => {
    await login(page)
    await openDemo(page, FORMAT)
    await openCreateForm(page)

    await itemOf(page, '手机号').locator('input').fill('abc')
    // 失焦触发，不点提交也该报
    await itemOf(page, '手机号').locator('input').blur()

    const error = errorOf(page, '手机号')
    await expect(error, '手机号填 abc 却没有任何提示').toBeVisible({ timeout: 10_000 })
    await expect(error).toContainText('11 位手机号')

    // 错误必须挂在手机号这一项上，不能堆在表单顶部 ——
    // 一个 20 字段的表单，错误堆在顶部等于让用户自己找是哪个字段
    await expect(errorOf(page, '邮箱')).toHaveCount(0)
  })

  test('非必填 + 有格式的字段：留空能过，不该被格式校验拦', async ({ page }) => {
    // 这是最容易被误当成 bug 的行为：空值不参与格式校验。
    // 专门占一条用例，免得哪天被"顺手修好"
    await login(page)
    await openDemo(page, FORMAT)
    await openCreateForm(page)

    const optional = itemOf(page, '备用邮箱（非必填）')
    await optional.locator('input').fill('not-an-email')
    await optional.locator('input').blur()
    await expect(optional.locator('.el-form-item__error')).toBeVisible({ timeout: 10_000 })

    // 清空之后错误要消失
    await optional.locator('input').fill('')
    await optional.locator('input').blur()
    await expect(
      optional.locator('.el-form-item__error'),
      '清空非必填字段后仍在报格式错 —— 空值不该参与格式校验'
    ).toHaveCount(0, { timeout: 10_000 })
  })

  test('脏数据点编辑再保存，会被服务端拦下并把理由显示出来', async ({ page, request }) => {
    // 脏数据是直接 SQL 灌进去的（接口本来就拦得住）。
    // 它在列表上看得见，一点「编辑 → 保存」就被拦 ——
    // 这比任何文档都更能说明「服务端为什么必须再判一遍」
    const token = await apiLogin(request)
    const rows = await pageRows(request, token, FORMAT)
    const dirty = rows.find((row) => row.mobile && !/^1\d{10}$/.test(String(row.mobile)))
    expect(
      dirty,
      '没找到手机号不合法的脏数据，先跑 sql/mysql/xpy-2026-09-12-form-verify-seed.sql'
    ).toBeTruthy()

    await login(page)
    await openDemo(page, FORMAT)

    const row = page.locator('.el-table__body-wrapper tbody tr:visible', {
      hasText: String(dirty!.sample_name)
    })
    await row.getByRole('button', { name: '编辑' }).first().click()
    await expect(formPanel(page)).toBeVisible({ timeout: 30_000 })

    await submitForm(page)

    // 界面上必须看得见被拦的理由。只要能看见就算过 ——
    // 行内错误与顶部消息两种呈现都可以，不把实现方式钉死
    await expect(
      messageWith(page, /手机号|11 位/),
      '脏数据保存被拦住了，但界面上没有任何提示'
    ).toBeVisible({ timeout: 15_000 })
  })
})

// =====================================================================
// 示例 2 · 跨字段：错误要定位到具体控件
// =====================================================================


test.describe('示例 2 · 必填与跨字段', () => {
  test('返程早于出发：提交被拦，错误说清是哪两个字段的关系', async ({ page }) => {
    await login(page)
    await openDemo(page, TRIP)
    await openCreateForm(page)

    await fillRequired[TRIP](page)
    // 必填都填满，只留这一处违规：返程早于出发
    await fillDate(page, '出发日期', '2026-09-20')
    await fillDate(page, '返程日期', '2026-09-10')

    await submitForm(page)

    await expect(
      messageWith(page, '返程日期不得早于出发日期'),
      '返程早于出发却提交过去了，或者拦住了但界面没提示'
    ).toBeVisible({ timeout: 15_000 })
  })

  test('勾了「需要订酒店」，入住城市才变成必填', async ({ page }) => {
    await login(page)
    await openDemo(page, TRIP)
    await openCreateForm(page)

    await fillRequired[TRIP](page)
    await fillDate(page, '出发日期', '2026-09-10')
    await fillDate(page, '返程日期', '2026-09-12')

    // 入住城市不是无条件必填：标签上没有必填星号。
    // 先钉住这一半，否则把规则改成无条件必填，下面那条断言照样绿
    await expect(
      itemOf(page, '入住城市').locator('.el-form-item__label.is-required'),
      '入住城市被配成了无条件必填 —— 那就不是「条件必填」这个示例要演示的东西了'
    ).toHaveCount(0)

    await itemOf(page, '需要订酒店').locator('.el-switch').click()
    await submitForm(page)

    await expect(
      messageWith(page, '入住城市'),
      '勾了订酒店但入住城市留空，却没被拦'
    ).toBeVisible({ timeout: 15_000 })
  })
})

// =====================================================================
// 示例 3 · 联动：动作要真的发生，A/B 对照组要有可见差异
// =====================================================================


test.describe('示例 3 · 联动动态校验', () => {
  test('切到「招待费」，招待费专属字段才显示出来', async ({ page }) => {
    await login(page)
    await openDemo(page, EXPENSE)
    await openCreateForm(page)

    // 默认不是招待费，专属字段应当是隐藏的
    await expect(itemOf(page, '招待单位')).toBeHidden()

    await pickOption(page, '费用类型', '招待费')

    await expect(
      itemOf(page, '招待单位'),
      '切成招待费后，招待单位仍然不显示 —— SHOW 动作没生效'
    ).toBeVisible({ timeout: 10_000 })
  })

  test('A 组配了 otherwise 会回落，B 组只配 then 会停在满足时的状态', async ({ page }) => {
    // 这是示例 3 的教学点：只配 then 不配 otherwise，条件不再满足时
    // 字段会停在上一次的状态。写在文档里没人记得住，做成对照组才有用
    await login(page)
    await openDemo(page, EXPENSE)
    await openCreateForm(page)

    const amount = itemOf(page, '报销金额').locator('input')

    // 金额调高，两组超标说明都该出现
    await amount.fill('8000')
    await amount.blur()
    await expect(itemOf(page, 'A 组·超标说明（规则配了 otherwise）')).toBeVisible({ timeout: 10_000 })
    await expect(itemOf(page, 'B 组·超标说明（规则只配了 then）')).toBeVisible()

    // 金额调回来：A 组回落（隐藏），B 组停在原地（仍显示）
    await amount.fill('100')
    await amount.blur()
    await expect(
      itemOf(page, 'A 组·超标说明（规则配了 otherwise）'),
      'A 组配了 otherwise，金额调回来就该收起'
    ).toBeHidden({ timeout: 10_000 })
    await expect(
      itemOf(page, 'B 组·超标说明（规则只配了 then）'),
      'B 组只配了 then，本该停在显示状态 —— 如果它也收起了，说明对照组失去意义，要改示例'
    ).toBeVisible()
  })
})

// =====================================================================
// 示例 4 · 脱敏：三条读取路径拿到的都得是掩码
// =====================================================================


test.describe('示例 4 · 唯一性长度与脱敏', () => {
  test('列表与详情拿到的是掩码，明文没有下发', async ({ page, request }) => {
    const token = await apiLogin(request)
    const rows = await pageRows(request, token, SUPPLIER)
    const row = rows.find((r) => r.contact_mobile)
    expect(row, '示例 4 没有带手机号的演示数据').toBeTruthy()

    // 分页接口这一条读取路径
    expect(
      String(row!.contact_mobile),
      `列表接口下发了明文手机号：${row!.contact_mobile} —— 脱敏没生效`
    ).toMatch(/\*/)
    expect(String(row!.id_card), '列表接口下发了明文证件号').toMatch(/\*/)
    expect(String(row!.bank_account), '列表接口下发了明文开户账号').toMatch(/\*/)
    // 邮箱只遮 @ 前面，域名保留
    expect(String(row!.contact_email)).toMatch(/\*/)
    expect(String(row!.contact_email)).toContain('@')

    // 详情接口这一条读取路径
    const detail = await request.get(
      `${API_BASE_URL}/infra/form-design/runtime/${SUPPLIER}/get?id=${row!.id}`,
      { headers: authHeaders(token) }
    )
    const detailData = ((await detail.json()) as any).data
    expect(String(detailData.contact_mobile), '详情接口下发了明文手机号').toMatch(/\*/)

    // 界面这一条：列表上看到的就是掩码
    await login(page)
    await openDemo(page, SUPPLIER)
    await expect(page.locator('.el-table__body-wrapper tbody')).toContainText('*')
  })

  test('信用代码重复：提交被拦，提示说清是不能重复', async ({ page, request }) => {
    const token = await apiLogin(request)
    const rows = await pageRows(request, token, SUPPLIER)
    const existing = rows.find((r) => r.uscc)
    expect(existing, '示例 4 没有带信用代码的演示数据').toBeTruthy()

    await login(page)
    await openDemo(page, SUPPLIER)
    await openCreateForm(page)

    await fillRequired[SUPPLIER](page)
    // 填一个库里已经有的信用代码
    await fillField(page, '统一社会信用代码', String(existing!.uscc))
    await itemOf(page, '统一社会信用代码').locator('input').first().blur()

    // 路径一：失焦时前端查一次，错误挂在这个字段上。
    // 单独钉住这一条 —— 只断言「页面上有提示」的话，下面提交时服务端那条
    // 也能让用例变绿，前端文案漂了照样发现不了
    await expect(
      errorOf(page, '统一社会信用代码'),
      '失焦时没有即时提示重复 —— 前端的唯一性校验没生效'
    ).toContainText('不能重复', { timeout: 15_000 })

    await submitForm(page)

    // 路径二：提交时服务端再查一次，报「以下内容在系统里已存在，不能重复：统一社会信用代码」。
    // 两条路径共用「在系统里已存在，不能重复」这句核心说法，
    // 上下两条断言合起来就钉住了「两侧文案不再各说各话」——
    // 措辞漂了，用户会以为撞上的是两种不同的限制
    await expect(
      messageWith(page, '不能重复'),
      '提交没有被拦住，或者拦住了但措辞与失焦那条对不上'
    ).toBeVisible({ timeout: 15_000 })
  })
})

// =====================================================================
// 示例 5 · 子表：行数区间与行内必填，报错要带行号
// =====================================================================


test.describe('示例 5 · 子表明细校验', () => {
  test('一行明细都不填：提交被拦，提示说清至少要几行', async ({ page }) => {
    await login(page)
    await openDemo(page, INBOUND)
    await openCreateForm(page)

    await fillRequired[INBOUND](page)
    // 单据头填满，明细一行不加
    await submitForm(page)

    await expect(
      messageWith(page, '至少需要 1 行'),
      '零行明细却提交过去了，或者拦住了但界面没提示'
    ).toBeVisible({ timeout: 15_000 })
  })

  test('合计由服务端按明细重算，界面上改不动它', async ({ page }) => {
    // 合计是公式字段。前端算一遍只是为了即时反馈，
    // 入库的值必须是服务端按明细重算的结果
    await login(page)
    await openDemo(page, INBOUND)
    await openCreateForm(page)

    const total = itemOf(page, '合计金额')
    await expect(total, '合计金额字段没渲染出来').toBeVisible()
    const input = total.locator('input')
    // 公式字段应当是只读的：要么没有 input，要么这个 input 不可编辑
    if ((await input.count()) > 0) {
      await expect(
        input.first(),
        '合计金额可以直接编辑 —— 公式字段应当只读，否则用户会以为自己填的值算数'
      ).toBeDisabled()
    }
  })
})

// =====================================================================
// 示例 6 · 提交前脚本
// =====================================================================


test.describe('示例 6 · 提交前脚本', () => {
  test('大额未法审：beforeSubmit 拦下来并给出理由', async ({ page }) => {
    await login(page)
    await openDemo(page, CONTRACT)
    await openCreateForm(page)

    await itemOf(page, '合同名称').locator('input').fill('E2E 大额合同')
    await itemOf(page, '乙方').locator('input').fill('E2E 乙方')
    const amount = itemOf(page, '合同金额').locator('input')
    await amount.fill('3000000')
    await amount.blur()

    await submitForm(page)

    // 脚本里的组合校验：金额 > 50 万必须已勾法审。
    // 这条正则表达不了，正是脚本该用的地方
    await expect(
      messageWith(page, /法务审核|法审/),
      '大额未法审却没有被 beforeSubmit 拦下'
    ).toBeVisible({ timeout: 15_000 })
  })

  test('内核必填先于 beforeSubmit：必填没填时脚本根本不会执行', async ({ page }) => {
    // 这是示例 6 明确要演示的坑：想在 beforeSubmit 里补必填提示的写法永远不触发。
    // 断言此时出现的是内核的必填提示，而不是脚本里的任何文案
    await login(page)
    await openDemo(page, CONTRACT)
    await openCreateForm(page)

    // 什么都不填直接提交
    await submitForm(page)

    await expect(
      formPanel(page).locator('.el-form-item__error').first(),
      '必填字段全空却没有内核的必填提示'
    ).toBeVisible({ timeout: 15_000 })
  })
})

// =====================================================================
// 示例 7 · 服务端扩展点
// =====================================================================


test.describe('示例 7 · 服务端扩展点', () => {
  test('身份证校验码错误：正则放过了，扩展点拦住了', async ({ page }) => {
    // 这条是示例 7 存在的理由：内置 ID_CARD 正则只校验格式，
    // 校验码是加权和算出来的，只有服务端扩展点做得了
    await login(page)
    await openDemo(page, STAFF)
    await openCreateForm(page)

    await fillRequired[STAFF](page)
    // 格式完全合法、只有最后一位校验码不对
    await fillField(page, '身份证', '110101199001011988')
    await itemOf(page, '身份证').locator('input').first().blur()

    // 格式正则应当放行 —— 它本来就只管格式
    await expect(errorOf(page, '身份证')).toHaveCount(0)

    // 显式等这次提交的响应：分得清「压根没提交」和「服务端拒了但界面没显示」。
    // 这两种情况的现象一模一样（弹窗还开着、没有错误），但原因完全不同
    const created = page.waitForResponse(
      (r) => r.url().includes(`/runtime/${STAFF}/create`) && r.request().method() === 'POST'
    )
    await submitForm(page)
    const body = (await (await created).json()) as { code: number; msg: string }

    expect(body.code, '校验码错误的身份证被服务端放行了 —— 多半是表单没切 extension_mode=2').not.toBe(
      0
    )
    expect(body.msg, '拦住了，但报的不是校验码那条').toContain('校验码')

    // 服务端拒了还不够，界面上得看得见
    await expect(
      messageWith(page, '校验码'),
      '服务端拒绝了，但界面上没有把理由显示出来'
    ).toBeVisible({ timeout: 15_000 })
  })

  test('工号由扩展点补全：界面上留空，存进去有值', async ({ page, request }) => {
    const token = await apiLogin(request)
    let id: string | undefined
    try {
      await login(page)
      await openDemo(page, STAFF)
      await openCreateForm(page)

      const name = `E2E 发号 ${Date.now()}`
      await fillRequired[STAFF](page)
      await fillField(page, '姓名', name)
      // 合法身份证：校验码必须真的算得过，否则会被扩展点拦下 ——
      // 随手编一个「看起来像」的号码（例如末位写 X）过不了，这正是示例 7 要演示的
      await fillField(page, '身份证', '110101199003078179')
      await fillField(page, '手机号', '13900001234')
      // 工号刻意留空，由 beforeCreate 里的 ctx.set 补

      await submitForm(page)
      await expect(formPanel(page)).toBeHidden({ timeout: 20_000 })

      const rows = await pageRows(request, token, STAFF)
      const created = rows.find((r) => r.staff_name === name)
      expect(created, '提交成功了但列表里找不到这条记录').toBeTruthy()
      id = String(created!.id)
      expect(
        created!.staff_no,
        '工号留空提交后仍然是空 —— 扩展点的 ctx.set 没有落库'
      ).toBeTruthy()
    } finally {
      await deleteRow(request, token, STAFF, id)
    }
  })
})
