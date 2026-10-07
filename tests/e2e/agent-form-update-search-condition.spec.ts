import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiHeaders, apiLogin, gotoWithAuth, login, API_BASE_URL } from './helpers/auth'
import { deleteWorkflowDraftsByCode } from './helpers/workflow'

/**
 * D4-20：改表也要能新增查询条件（迭代七第 08 轮 · 裁定 R-02）—— **浏览器实证**
 *
 * <h3>为什么非要走浏览器</h3>
 * 方案 §5③ 原话：「🔴 不许这样算通过：『后端提取范围改了 + 单测绿』。D4-20 的判据在浏览器里。」
 * 后端单测能证明 `FormUpdateChangeExtractor` 把 `searchable` 送进了 `searchConditions`，
 * 但 D4-20 的原始症状是**两侧口径分岔**：前端「表单字段」区块**认** FORM_UPDATE、
 * 「查询条件」区块**不认** ⟹ 同一份清单上，改表加的可查询字段在一张表里有行、
 * 在另一张表里凭空消失。那是渲染层的病，只有在真 DOM 上才验得出来。
 *
 * <h3>为什么用手写 DSL，而不是靠真发那条路当守卫（0 LLM token）</h3>
 * 真发那条路（`prompt-template-build-matrix.spec.ts` 的 case 59）本轮**也**量到了同一个翻转：
 * 基线轮 `search-conditions=无` → 对照轮 `=有`、可查询 1 个「竞对报价」。
 * 🔴 但它**每轮重新掷骰子**，不能当回归守卫：同一条示例、同一个模型（model_id=78）、
 * 规划温度钉死 0.1，`patch` 的形状照样会变 ——
 * 2026-10-05 的 def #467 是字面量 `patch.formFields[].searchable=true`，
 * 2026-10-08 基线轮的 def #566 却是 `"patch": "{{$.patch_payload.patch}}"` 整个占位符。
 * 拿它守卫 D4-20，下一轮可能因为模型换了个写法就红（假警报），
 * 也可能反过来因为碰巧写对而掩盖真回归。所以本文件把形状钉死，真发那条只作旁证。
 *
 * <h3>🔴 顺带量到的缺陷：第 ③ 条用例钉住它，**不是**认可它</h3>
 * 「改表加查询条件」有两条 patch 路线，实测结果完全相反
 * （原始探针脚本 `C:/code/yudao/_tmp/r08-probe-patch.py`，输出 `r08-probe-out.txt`）：
 *
 * - **路线 B**（工具合法）：`patch.listConf.searchItems` 里加一项 ⟹ 查询条件**真的落地**，
 *   列表页查询区多出一项并且真能筛（第 ② 条用例）。
 * - **路线 A**（模型真发时用的那条）：`patch.formFields` 里塞**字段描述符对象** +
 *   `searchable:true` ⟹ 工具返回 `code=0`「表单已修改」，但
 *   ①`listConf.searchItems` **一个都没多**（查询条件压根没落地）；
 *   ②`formFields` 是**整键替换**，原来 2 条 form-create 规则被换成 1 条；
 *   ③存进去的那条是描述符的 JSON 文本（`{"field":"memo",…,"searchable":true}`），
 *   **不是** form-create 规则（没有 `type`/`props`）⟹ 控件渲染不出来。
 *
 * 根因不在「模型不听话」，而在**教法缺口**：`FormSaveDraftTool`（新建表单）会把描述符
 * 转成规则、并按 `searchable=true` 生成 `searchItems`；而 `FormUpdateTool`（改表单）
 * 全文件对 `searchItems` / `listConf` / `searchable` **零提及** —— 它的 paramsSchema
 * 压根没教过「改表时怎么加查询条件」。模型于是把新建那套形状照搬过来，
 * 工具一声不响地收下、存成垃圾、还回一句「表单已修改」。
 * 这正是 AGENTS.md 点名的本子系统头号缺陷形态：「配置保存成功但不生效且无提示」。
 *
 * 🔴 **本轮只报不修**（方案 §9 的不做清单 + §2.5「撞上再报，不要自行决定」的同一纪律）。
 * 连带后果必须说清楚：D4-20 修好之后，变更预演**会**照路线 A 的 DSL 画出「查询条件」区块
 * （第 ① 条用例），因为清单的职责是如实反映 DSL 写了什么；但那份 DSL 真跑起来
 * 并不会产出这个查询条件。也就是「清单说的」与「跑出来的」在路线 A 上对不上 ——
 * 该补的是**校验器**的一条规则（`form_update.patch.formFields` 的元素必须是字符串规则，
 * 不是描述符对象），不是把清单再改回装看不见。
 *
 * <h3>数据自净</h3>
 * 表单夹具绑的是既有的 `test_e2e_form_runtime`（`xpy-2026-09-10-e2e-form-runtime-fixture.sql`
 * 建的，列表设计那批用例共用），**不建新表**；流程 def 与表单都在 finally / afterAll 里删掉。
 * 走 `/infra-form-design/preview?code=` 直达运行时列表页，**不建菜单** ⟹ 无菜单残留。
 *
 * 前置：后端 48080 + 前端 dev server 同时在跑。
 */

const FIXTURE_TABLE = 'test_e2e_form_runtime'
/** 发布时挂在「基础设施」下；本文件其实不建菜单，但 publish 接口首次发布要求给 */
const PARENT_MENU_ID = 2
const TS = Date.now().toString().slice(-8)

/** 两个字段：mobile 一开始就可查，memo 是本轮要「改表加上去」的那个 */
const FIELD_MOBILE = { type: 'input', field: 'mobile', title: '手机号', props: {} }
const FIELD_MEMO = { type: 'input', field: 'memo', title: '主页', props: {} }

/** 查询项的 widget 是**查询控件**编码（TEXT/SELECT/DATE_RANGE/…），与表单控件编码不是一个目录 */
const SEARCH_MOBILE = { field: 'mobile', label: '手机号', widget: 'TEXT', operator: 'LIKE' }
const SEARCH_MEMO = { field: 'memo', label: '主页', widget: 'TEXT', operator: 'LIKE' }

const listConf = (searchItems: unknown[]) => ({
  columns: [
    { field: 'mobile', label: '手机号' },
    { field: 'memo', label: '主页' }
  ],
  searchItems,
  pagination: { enabled: true, pageSize: 20 },
  operationColumn: { show: true, label: '操作', width: 160, buttons: ['edit'] }
})

const column = (name: string) => ({ table: FIXTURE_TABLE, column: name, jdbcType: 'VARCHAR' })

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
  // 夹具表没有审计列，四个都关掉；开着会让后端往不存在的列写值
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
  fieldMapping: { mobile: column('mobile'), memo: column('memo') }
}

interface FormFixture {
  id: number
  code: string
}

async function createForm(
  request: APIRequestContext,
  token: string,
  searchItems: unknown[]
): Promise<FormFixture> {
  const code = `e2e_r08_${TS}_${Math.random().toString(36).slice(2, 6)}`
  const res = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: apiHeaders(token),
    data: {
      name: `D4-20夹具${TS}`,
      code,
      // 2 = 表单+列表：只有这个类型才有列表设计，才有查询区可验
      formType: 2,
      formConf: JSON.stringify({ form: { labelWidth: '110px' } }),
      formFields: [FIELD_MOBILE, FIELD_MEMO].map((r) => JSON.stringify(r)),
      listConf: JSON.stringify(listConf(searchItems)),
      dataSourceConfigId: 0,
      mainTable: FIXTURE_TABLE,
      mainPk: 'id',
      tableBinding: JSON.stringify(TABLE_BINDING)
    }
  })
  const body = (await res.json()) as { code: number; data?: number; msg?: string }
  expect(body.code, `造夹具表单失败：${body.msg ?? JSON.stringify(body)}`).toBe(0)
  expect(body.data, '创建接口没返回表单编号').toBeTruthy()
  return { id: body.data!, code }
}

async function publishForm(request: APIRequestContext, token: string, fixture: FormFixture) {
  const res = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
    headers: apiHeaders(token),
    data: { id: fixture.id, parentMenuId: PARENT_MENU_ID, changeSummary: 'D4-20 e2e' }
  })
  const body = (await res.json()) as { code: number; msg?: string }
  expect(body.code, `发布失败：${body.msg ?? JSON.stringify(body)}`).toBe(0)
}

/**
 * 走 form_update 工具改表单（不是直接调 form-design/update）
 *
 * 🔴 必须走工具：本文件要验的是「**模型能用的那条路**改表加查询条件到底生不生效」。
 * 直接调 form-design/update 会绕过 FormUpdateTool 的 patch 语义，量到的就不是同一件事。
 * 用的是诊断端点 `/agent/diagnostic/tool-execute`，它走完整链路（网关校验 → 上下文重建 → 执行）。
 */
async function runFormUpdate(
  request: APIRequestContext,
  token: string,
  formId: number,
  patch: Record<string, unknown>
) {
  const res = await request.post(`${API_BASE_URL}/agent/diagnostic/tool-execute?tool=form_update`, {
    headers: apiHeaders(token),
    data: { id: formId, patch }
  })
  const body = (await res.json()) as { code: number; data?: any; msg?: string }
  expect(body.code, `form_update 调用失败：${body.msg ?? JSON.stringify(body)}`).toBe(0)
  return body.data
}

async function readForm(request: APIRequestContext, token: string, formId: number) {
  const res = await request.get(`${API_BASE_URL}/infra/form-design/get?id=${formId}`, {
    headers: apiHeaders(token)
  })
  const body = (await res.json()) as { code: number; data?: any; msg?: string }
  expect(body.code, `读表单失败：${body.msg ?? ''}`).toBe(0)
  const raw = body.data?.listConf
  const conf = typeof raw === 'string' && raw ? JSON.parse(raw) : raw
  return {
    searchItems: (conf?.searchItems ?? []) as Array<Record<string, unknown>>,
    formFields: (body.data?.formFields ?? []) as unknown[]
  }
}

/** 清掉夹具表里的可见行。表是共用的，历史遗留行会冲垮「筛完剩 1 条」这类断言 */
async function wipe(request: APIRequestContext, token: string, code: string) {
  for (let round = 0; round < 20; round++) {
    const res = await request.post(`${API_BASE_URL}/infra/form-design/runtime/${code}/page`, {
      headers: apiHeaders(token),
      data: { pageNo: 1, pageSize: 100, conditions: [] }
    })
    const list =
      ((await res.json()) as { data?: { list?: Array<{ id: number }> } }).data?.list ?? []
    if (list.length === 0) return
    for (const row of list) {
      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${code}/delete?id=${row.id}`,
        { headers: apiHeaders(token) }
      )
    }
  }
  throw new Error('清空夹具表超过 20 轮仍未清完')
}

async function seed(request: APIRequestContext, token: string, code: string) {
  await wipe(request, token, code)
  // memo 用能唯一定位的前缀：断言要的是「筛完只剩这一条」，值必须能区分
  const rows = [
    { mobile: '13800000001', memo: `r08-hit-${TS}` },
    { mobile: '13900000002', memo: `r08-miss-${TS}` }
  ]
  for (const data of rows) {
    const res = await request.post(`${API_BASE_URL}/infra/form-design/runtime/${code}/create`, {
      headers: apiHeaders(token),
      data
    })
    const body = (await res.json()) as { code: number; msg?: string }
    expect(body.code, `造数据失败：${body.msg ?? ''}`).toBe(0)
  }
}

async function deleteForm(request: APIRequestContext, token: string, fixture?: FormFixture) {
  if (!fixture) return
  // 先清数据再删表单：删了表单就没有运行时接口可用来清数据了
  await wipe(request, token, fixture.code).catch(() => undefined)
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${fixture.id}`, {
    headers: apiHeaders(token)
  })
}

/** 运行时列表页：走 preview 直达，不需要菜单 */
const runtimePath = (code: string) => `/infra-form-design/preview?code=${code}`

/** 查询区里某个标签对应的表单项 */
const searchItemOf = (page: any, label: string) =>
  page.locator('.el-form--inline .el-form-item').filter({ hasText: label })

const WF_CODE = `e2e_r08u_${TS}`
const WF_NAME = `D4-20改表加查询条件${TS}`
const WEBHOOK_PATH = `e2e_r08u_${TS}`

test.describe('D4-20：改表也要能新增查询条件（浏览器实证）', () => {
  test.setTimeout(300_000)

  test('① 变更预演：FORM_UPDATE 带的可查询字段真的进了「查询条件」区块', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    const H = apiHeaders(token)
    let form: FormFixture | undefined
    const wfCode = WF_CODE
    try {
      // 目标表单必须真存在：清单的干跑会去探它，编一个 id 只会量到「探不到」那条路
      form = await createForm(request, token, [SEARCH_MOBILE])

      // 🔴 patch 用**路线 A** 的形状（描述符对象 + searchable），因为那正是模型真发时写的
      //    （def #570 / #467 实测）。清单的职责是如实反映 DSL 写了什么，
      //    所以这里该出现「查询条件」；那条形状本身能不能跑通是第 ③ 条用例的事。
      const dsl = JSON.stringify({
        dslVersion: '1.0',
        id: wfCode,
        name: WF_NAME,
        description: 'D4-20 浏览器实证：改表加一个可查询字段，0 LLM token',
        // 只能用 webhook：它不需要任何前置数据，secret 是 DSL 里的一个字符串而已
        trigger: {
          type: 'trigger.webhook',
          config: { path: WEBHOOK_PATH, authType: 'hmac', secret: 'e2e-only-not-a-real-secret' }
        },
        variables: [{ key: 'output', type: 'object', merge: 'replace' }],
        nodes: [
          {
            id: 'n_update',
            type: 'tool',
            name: '给表单加可查询字段',
            config: {
              toolId: 'form_update',
              args: {
                id: form.id,
                patch: {
                  formFields: [
                    {
                      field: 'memo',
                      title: '主页',
                      widget: 'input',
                      column: 'memo',
                      jdbcType: 'VARCHAR',
                      required: false,
                      searchable: true,
                      operator: 'LIKE'
                    },
                    // 🔴 刻意配一个 searchable:false 的：只断「该有的有」抓不住
                    //    「把整个字段表都塞进查询区」这种反向塌方
                    {
                      field: 'mobile',
                      title: '手机号',
                      widget: 'input',
                      column: 'mobile',
                      jdbcType: 'VARCHAR',
                      required: false,
                      searchable: false
                    }
                  ]
                }
              },
              outputVar: 'output'
            }
          }
        ],
        edges: [
          { from: 'START', to: 'n_update' },
          { from: 'n_update', to: 'END' }
        ],
        settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
      })

      const created = (await (
        await request.post(`${API_BASE_URL}/agent/workflow-def/create`, {
          headers: H,
          data: { code: wfCode, name: WF_NAME, dsl }
        })
      ).json()) as { code: number; data?: number; msg?: string }
      expect(created.code, `建流程草稿失败：${created.msg ?? ''}`).toBe(0)
      const defId = created.data!

      await login(page)
      await gotoWithAuth(page, `/agent-workflow/editor?id=${defId}`)
      // /validate 的响应自带 manifest，所以点完体检紧接着就出现，不需要再找一个按钮
      await page.getByRole('button', { name: '体检', exact: true }).click()

      const card = page.getByTestId('designer-manifest')
      await expect(card).toBeVisible({ timeout: 30000 })

      // ---------- D4-20 的判据本体：改表也能让「查询条件」区块出现 ----------
      const search = card.getByTestId('manifest-search-conditions')
      await expect(
        search,
        'FORM_UPDATE 带的 searchable 字段没有进「查询条件」区块 —— 这就是 D4-20 的原始症状'
      ).toBeVisible({ timeout: 15000 })
      await expect(search).toContainText('主页')
      await expect(search).toContainText('包含') // operator=LIKE 已翻译成中文，不是机器码
      await expect(
        search,
        'searchable:false 的字段出现在查询区，就是「读了但没照做」的反向塌方'
      ).not.toContainText('手机号')

      // ---------- 同一份清单上两张表必须同源（D4-20 坏的就是这个同源性） ----------
      const fields = card.getByTestId('manifest-form-fields')
      await expect(fields).toBeVisible({ timeout: 15000 })
      // 「表单字段」表两个字段都在，且「可查询」列一个是、一个否
      const rows = fields.locator('.el-table').first().locator('tbody tr.el-table__row')
      await expect(rows).toHaveCount(2)
      const queryable: string[] = []
      for (let r = 0; r < (await rows.count()); r++) {
        const cells = rows.nth(r).locator('td')
        // 列序：字段 / 标题 / 控件 / 绑定列类型 / 必填 / 可查询
        const title = (await cells.nth(1).innerText()).trim()
        if ((await cells.nth(5).innerText()).trim() === '是') queryable.push(title)
      }
      const conditions: string[] = []
      const condRows = search.locator('tbody tr.el-table__row')
      for (let r = 0; r < (await condRows.count()); r++) {
        conditions.push((await condRows.nth(r).locator('td').first().innerText()).trim())
      }
      expect(
        [...queryable].sort(),
        `两张表的字段集合不相等：「表单字段」里可查询的=[${queryable.join('、')}]，` +
          `「列表查询条件」=[${conditions.join('、')}]。二者在前端同源（都吃 detail.fields[]），` +
          `不相等就是其中一个区块漏认了 FORM_UPDATE —— D4-20 的形状`
      ).toEqual([...conditions].sort())
      expect(conditions, '集合相等但两边都是空的，等于什么都没验到').toEqual(['主页'])
    } finally {
      await deleteWorkflowDraftsByCode(request, await apiLogin(request), wfCode).catch(
        () => undefined
      )
      await deleteForm(request, token, form)
    }
  })

  test('② 保存后真的生效：走 listConf.searchItems 这条工具合法路线，列表页多出一个查询项并真能筛', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    let form: FormFixture | undefined
    try {
      // 先发布再登录：动态路由在登录时装配，顺序反了会 404
      form = await createForm(request, token, [SEARCH_MOBILE])
      await publishForm(request, token, form)
      await seed(request, token, form.code)
      await login(page)
      await gotoWithAuth(page, runtimePath(form.code))
      await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

      // 改之前：查询区只有「手机号」，没有「主页」
      await expect(searchItemOf(page, '手机号').first()).toBeVisible()
      await expect(searchItemOf(page, '主页'), '还没改表，「主页」的查询项就该不存在').toHaveCount(
        0
      )
      const rowCount = () => page.locator('.el-table__body-wrapper tbody tr').count()
      expect(await rowCount(), '初始应当有两条数据').toBe(2)

      // 改表：把「主页」加进查询区。listConf 是**整键替换**，所以要带上原有的那一项
      await runFormUpdate(request, token, form.id, {
        listConf: listConf([SEARCH_MOBILE, SEARCH_MEMO])
      })
      // form_update 只改配置，不发布；用户看到的仍是旧版本，必须再发一次
      await publishForm(request, token, form)

      await gotoWithAuth(page, runtimePath(form.code))
      await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

      // 改之后：查询区真的多出了「主页」
      const memo = searchItemOf(page, '主页').first()
      await expect(memo, '改表加的查询项没有出现在列表页查询区').toBeVisible()
      await expect(memo.locator('input').first()).toBeVisible()

      // 并且**真的能筛**：填一个只命中一条的值，看发出去的条件与剩下的行数
      await memo.locator('input').first().fill(`r08-hit-${TS}`)
      const pagePromise = page.waitForResponse(
        (r) => r.url().includes(`/runtime/${form!.code}/page`) && r.request().method() === 'POST'
      )
      await page.getByRole('button', { name: '搜索' }).click()
      const response = await pagePromise
      const sent = JSON.parse(response.request().postData() || '{}')
      const condition = (sent.conditions || []).find((c: any) => c.field === 'memo')
      expect(
        condition,
        `查询区画出来了但没拼进查询条件，发出去的是 ${JSON.stringify(sent.conditions)}`
      ).toBeTruthy()
      await expect.poll(rowCount, { timeout: 15_000 }).toBe(1)
    } finally {
      await deleteForm(request, token, form)
    }
  })

  test('③ 缺陷现场：模型真发时用的 patch.formFields 描述符路线，查询条件落不了地，却报「表单已修改」', async ({
    request
  }) => {
    const token = await apiLogin(request)
    let form: FormFixture | undefined
    try {
      form = await createForm(request, token, [SEARCH_MOBILE])
      const before = await readForm(request, token, form.id)
      expect(before.searchItems, '夹具前提：初始只有一个查询项').toHaveLength(1)
      expect(before.formFields, '夹具前提：初始两条 form-create 规则').toHaveLength(2)

      // 与 def #570（2026-10-08 对照轮 case 59 真发产物）逐字同形的 patch
      const data = await runFormUpdate(request, token, form.id, {
        formFields: [
          {
            field: 'memo',
            title: '主页',
            widget: 'input',
            column: 'memo',
            jdbcType: 'VARCHAR',
            required: false,
            searchable: true,
            operator: 'LIKE'
          }
        ]
      })

      // 🔴 下面这些断言钉的是**当前的错误行为**，不是期望行为。
      //    修好之后这条用例会红 —— 那时应当把断言**改成**「searchItems 多了一项、
      //    原有规则还在」，而不是删掉这条用例。删了就等于把这个缺陷重新变成没人看的。
      expect(
        String(data?.message ?? ''),
        '工具竟然没报成功？那这条缺陷的形状变了，重新量'
      ).toContain('表单已修改')

      const after = await readForm(request, token, form.id)
      // ① 查询条件压根没落地
      expect(
        after.searchItems,
        'searchable:true 没有变成 listConf.searchItems —— 查询条件没落地，但工具报了成功'
      ).toHaveLength(1)
      expect(after.searchItems.some((s) => s.field === 'memo')).toBe(false)
      // ② formFields 是整键替换，原有字段的规则被冲掉
      expect(
        after.formFields,
        '原来两条规则被整键替换成一条 —— 另一个字段（手机号）从表单里消失了'
      ).toHaveLength(1)
      // ③ 存进去的是描述符 JSON 文本，不是 form-create 规则
      const stored = after.formFields[0]
      expect(typeof stored, '存进去的竟然不是字符串？形状变了，重新量').toBe('string')
      const parsed = JSON.parse(String(stored))
      expect(parsed.searchable, '存进去的确实是描述符（带 searchable）').toBe(true)
      expect(
        parsed.type,
        '描述符里没有 form-create 规则的 type ⟹ 运行时渲染不出控件'
      ).toBeUndefined()
      expect(parsed.props).toBeUndefined()
    } finally {
      await deleteForm(request, token, form)
    }
  })
})
