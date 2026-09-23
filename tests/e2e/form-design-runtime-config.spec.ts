import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 「列表设计」步骤里三个运行时配置入口的端到端验证（B9）
 *
 * 打印模板、自定义按钮、详情页页签。三者的共同点：都是
 * `infra_form_design` 上单独的列、都只对「表单+列表」类型有意义、
 * 都配在「列表设计」这一步新增的页签里。
 *
 * ⚠️ **后两项的后端与运行时渲染在 B9 就做完了，但一直没有设计器入口**，
 * 只能打接口配 —— 而运行时那批 e2e 全是用 API 造夹具的，所以它们全绿
 * 并不代表用户能用上。这一份补的就是那个缺口：**界面上真的配得出来**。
 *
 * 运行时那一侧（按钮出不出现、插值与转义、发布校验、落库清洗）在
 * `form-design-runtime.spec.ts` 里，两者不重叠。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

const FIXTURE_TABLE = 'test_e2e_form_runtime'

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

const FORM_FIELDS = [
  JSON.stringify({ type: 'inputNumber', field: 'amount', title: '金额', props: {} }),
  JSON.stringify({ type: 'input', field: 'reason', title: '原因', props: {} })
]

/**
 * 造一张「表单+列表」类型的草稿
 *
 * ⚠️ 必须是 formType 2 —— 「列表设计」步骤只在这个类型下出现，
 * 而打印模板就配在那一步里（「打印」按钮只出现在列表行与详情弹窗上）。
 */
async function createDraft(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, any> = {}
): Promise<{ id: number; code: string }> {
  const code = `e2e_print_${Date.now()}`
  const response = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: 'B9 打印模板用例',
      code,
      formType: 2,
      formConf: JSON.stringify({ form: { labelWidth: '100px' } }),
      formFields: FORM_FIELDS,
      dataSourceConfigId: 0,
      mainTable: FIXTURE_TABLE,
      mainPk: 'id',
      tableBinding: JSON.stringify({
        mainTable: FIXTURE_TABLE,
        mainPk: 'id',
        fieldMapping: {
          amount: { table: FIXTURE_TABLE, column: 'amount', jdbcType: 'DECIMAL' },
          reason: { table: FIXTURE_TABLE, column: 'reason', jdbcType: 'VARCHAR' }
        }
      }),
      listConf: JSON.stringify({
        columns: [{ field: 'amount', label: '金额' }],
        operationColumn: { show: true, label: '操作', width: 200, buttons: ['detail'] }
      }),
      ...overrides
    }
  })
  expect(response.ok(), '造用例表单失败').toBeTruthy()
  const id = ((await response.json()) as { data: number }).data
  expect(id, '创建接口没有返回编号').toBeTruthy()
  return { id, code }
}

async function cleanup(
  request: APIRequestContext,
  token: string,
  fixture: { id: number } | undefined
) {
  if (!fixture) return
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${fixture.id}`, {
    headers: authHeaders(token)
  })
}

/** 打开设计器并切到「列表设计」下的某个页签 */
async function openListTab(page: Page, id: number, tab: string) {
  await page.goto(`/infra/online/editor?id=${id}`)
  // 设计器要现编译一大批模块
  await page.getByText('列表设计', { exact: true }).click({ timeout: 60_000 })
  await page.getByRole('tab', { name: tab }).click()
}

/** 点保存并等接口回来。⚠️ 不等的话下一步的 goto 会打断请求，保存静默丢失 */
async function save(page: Page) {
  const savePromise = page.waitForResponse(
    (r) => r.url().includes('/infra/form-design/update') && r.request().method() === 'PUT'
  )
  await page.getByRole('button', { name: /保\s*存/ }).first().click()
  const response = await savePromise
  expect(response.ok(), '保存失败').toBeTruthy()
}

test.describe('打印模板设计器', () => {
  test('⚠️ 点字段清单把 {字段} 插进正文，保存后重新打开还在', async ({ page, request }) => {
    const token = await login(page)
    let fixture: { id: number; code: string } | undefined
    try {
      fixture = await createDraft(request, token)
      await openListTab(page, fixture.id, '打印模板')

      const editorBody = page.locator('.w-e-text-container [contenteditable="true"]').first()
      await expect(editorBody, '模板编辑器应当渲染出来').toBeVisible({ timeout: 30_000 })

      // 先在正文里打一段文字，模拟真实使用（也顺带让编辑器有了选区）
      await editorBody.click()
      await editorBody.pressSequentially('出库单 金额：')

      // 点右侧的字段项插入占位符。⚠️ 这一步依赖 wangEditor 的 selection ——
      // 点按钮会让编辑器失焦，实现里要先 restoreSelection 才插得进去
      await page.locator('.field-panel-item').filter({ hasText: '{amount}' }).first().click()
      await expect(editorBody, '占位符应当插进正文').toContainText('{amount}')

      // 保存并重新打开：模板的回显没走 collect/restore（它不是 listConf 的一部分），
      // 所以这条链路要单独钉一次
      await save(page)

      await openListTab(page, fixture.id, '打印模板')
      const reopened = page.locator('.w-e-text-container [contenteditable="true"]').first()
      await expect(reopened, '重新打开后模板内容应当还在').toContainText('{amount}', {
        timeout: 30_000
      })
      await expect(reopened).toContainText('出库单')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 模板引用了不存在的字段时，页面上有警告', async ({ page, request }) => {
    const token = await login(page)
    let fixture: { id: number; code: string } | undefined
    try {
      // 发布校验会拦一次，这里是即时反馈 —— 不然用户要等到点发布才知道，
      // 而那时他已经把模板整页排好版了
      fixture = await createDraft(request, token, {
        printTemplate: '<p>金额：{amount}</p><p>不存在：{no_such_field}</p>'
      })
      await openListTab(page, fixture.id, '打印模板')

      // ⚠️ 断言要落在告警条上，不能只按文本找 —— `no_such_field` 同时出现在
      // 编辑器正文里（那是模板本身），按文本找会命中两个元素，
      // 严格模式下直接失败，而失败原因指不到「告警到底出没出来」
      await expect(
        page.locator('.el-alert--warning').filter({ hasText: 'no_such_field' }),
        '引用了取不到值的字段应当有警告'
      ).toBeVisible({ timeout: 30_000 })
    } finally {
      await cleanup(request, token, fixture)
    }
  })
})

test.describe('自定义按钮设计器', () => {
  test('⚠️ 界面上配出一个行内按钮，保存后读回来的 JSON 是运行时认得的形状', async ({
    page,
    request
  }) => {
    const token = await login(page)
    let fixture: { id: number; code: string } | undefined
    try {
      fixture = await createDraft(request, token)
      await openListTab(page, fixture.id, '自定义按钮')

      await page.getByRole('button', { name: /添加按钮/ }).click()

      const card = page.locator('.button-card').first()
      await expect(card, '按钮卡片应当出现').toBeVisible({ timeout: 30_000 })
      await card.getByPlaceholder('按钮名称，如「大额复核」').fill('大额复核')
      await card.getByPlaceholder('如 goBig，同一张表单内不能重复').fill('goBig')
      await card
        .getByPlaceholder('如 /infra-form-design/preview?code={reason}')
        .fill('/index?no={reason}')

      await save(page)

      // 断言落在**存下来的 JSON** 上，而不是「界面上填进去了」：
      // 这一整条用例要证的是「设计器产出的形状运行时认得」，
      // 而运行时读的是这段 JSON。少了这一条，一个键名拼错的编辑器也能通过
      const res = await request.get(
        `${API_BASE_URL}/infra/form-design/get?id=${fixture.id}`,
        { headers: authHeaders(token) }
      )
      const saved = (await res.json()) as { data: { customButtons: string } }
      const buttons = JSON.parse(saved.data.customButtons)
      expect(buttons).toHaveLength(1)
      expect(buttons[0].key).toBe('goBig')
      expect(buttons[0].label).toBe('大额复核')
      expect(buttons[0].position).toBe('ROW')
      expect(buttons[0].action).toMatchObject({
        type: 'NAVIGATE',
        url: '/index?no={reason}',
        target: '_blank'
      })

      // 重新打开要能回显 —— 这条链路没走 collect/restore，值得单独钉一次
      await openListTab(page, fixture.id, '自定义按钮')
      await expect(
        page.locator('.button-card').first().getByPlaceholder('按钮名称，如「大额复核」'),
        '重新打开后按钮应当还在'
      ).toHaveValue('大额复核', { timeout: 30_000 })
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 标识重复与 javascript: 地址在界面上就有警告，不必等到发布', async ({
    page,
    request
  }) => {
    const token = await login(page)
    let fixture: { id: number; code: string } | undefined
    try {
      // 发布校验会拦，但那时用户已经配完一整批按钮了
      fixture = await createDraft(request, token, {
        customButtons: JSON.stringify([
          { key: 'same', label: 'A', position: 'ROW', action: { type: 'NAVIGATE', url: '/a' } },
          {
            key: 'same',
            label: 'B',
            position: 'ROW',
            action: { type: 'NAVIGATE', url: 'javascript:alert(1)' }
          }
        ])
      })
      await openListTab(page, fixture.id, '自定义按钮')

      const warning = page.locator('.el-alert--warning').first()
      await expect(warning, '配错的按钮应当有警告').toBeVisible({ timeout: 30_000 })
      await expect(warning).toContainText('标识「same」重复')
      await expect(warning).toContainText('不被允许的协议')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('工具栏位置要说明可见条件不生效 —— 否则用户会以为自己配错了', async ({
    page,
    request
  }) => {
    const token = await login(page)
    let fixture: { id: number; code: string } | undefined
    try {
      // 运行时是【忽略】工具栏上的条件，不是把按钮藏起来。
      // 界面上不说的话，用户配了一条不生效的条件却毫无察觉
      fixture = await createDraft(request, token, {
        customButtons: JSON.stringify([
          {
            key: 'toolbar',
            label: '打开报表',
            position: 'TOOLBAR',
            action: { type: 'NAVIGATE', url: '/index' }
          }
        ])
      })
      await openListTab(page, fixture.id, '自定义按钮')

      await expect(
        page.getByText('工具栏按钮的可见条件不生效', { exact: false }),
        '工具栏位置应当有说明'
      ).toBeVisible({ timeout: 30_000 })
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 调数据接口动作：能选接口、配入参，界面上写明鉴权是临时状态', async ({
    page,
    request
  }) => {
    const token = await login(page)
    let fixture: { id: number; code: string } | undefined
    let ifaceId: number | undefined
    try {
      // 造一个写型接口。⚠️ 设计器用的是含写型的那份清单 ——
      // 读取型那份服务的是运行时取数，作废单据这类选不到
      const ifaceCode = `e2e_ui_void_${Date.now()}`
      const created = await request.post(`${API_BASE_URL}/infra/data-interface/create`, {
        headers: authHeaders(token),
        data: {
          name: '作废单据(设计器 e2e)',
          code: ifaceCode,
          type: 1,
          status: 0,
          dataSourceConfigId: 0,
          config: `UPDATE ${FIXTURE_TABLE} SET reason = 'x' WHERE id = #{id}`,
          sqlStatementType: 'UPDATE',
          params: [{ name: 'id', type: 'String', required: true }],
          riskConfirmed: true
        }
      })
      const createdBody = (await created.json()) as { code: number; data: number; msg: string }
      expect(createdBody.code, `造接口失败：${createdBody.msg}`).toBe(0)
      ifaceId = createdBody.data

      fixture = await createDraft(request, token, {
        customButtons: JSON.stringify([
          { key: 'voidIt', label: '作废', position: 'ROW', action: { type: 'INVOKE' } }
        ])
      })
      await openListTab(page, fixture.id, '自定义按钮')

      const card = page.locator('.button-card').first()
      await expect(card).toBeVisible({ timeout: 30_000 })

      // 没选接口时应当有警告 —— 点了不会有任何反应
      await expect(page.locator('.el-alert--warning').first()).toContainText('没选接口')

      // 选接口。写型的能出现在清单里，这一条钉住了「用的是含写型的那份」。
      // ⚠️ 不能用 getByPlaceholder 定位 el-select：这一版 Element Plus 把占位符渲染成
      // <span> 而不是 input 的 placeholder 属性，getByPlaceholder 找不到它，
      // 表现是用例一直等到超时，而快照里那一格看着完全正常。
      // 仓库里既有的用例都是按 .el-select + .el-select-dropdown__item 来点的
      await card.locator('.el-select').filter({ hasText: '选择要调用的接口' }).first().click()
      await page
        .locator('.el-select-dropdown__item:visible', { hasText: ifaceCode })
        .first()
        .click()
      await expect(page.locator('.el-alert--warning')).toHaveCount(0)

      // ⚠️ 这句必须留在界面上：鉴权沿用表单自己的权限，是临时状态
      await expect(
        page.getByText('没有针对数据接口的独立权限模型', { exact: false }),
        '界面上要写明鉴权是临时状态'
      ).toBeVisible()

      // 配一条入参映射
      await card.getByRole('button', { name: /添加参数/ }).click()
      await card.getByPlaceholder('如 id').fill('id')

      await save(page)
      const res = await request.get(`${API_BASE_URL}/infra/form-design/get?id=${fixture.id}`, {
        headers: authHeaders(token)
      })
      const saved = (await res.json()) as { data: { customButtons: string } }
      const button = JSON.parse(saved.data.customButtons)[0]
      expect(button.action.type).toBe('INVOKE')
      expect(button.action.interfaceCode).toBe(ifaceCode)
      expect(button.action.params).toEqual([{ name: 'id', field: '' }])
    } finally {
      await cleanup(request, token, fixture)
      if (ifaceId) {
        await request.delete(`${API_BASE_URL}/infra/data-interface/delete?id=${ifaceId}`, {
          headers: authHeaders(token)
        })
      }
    }
  })
})

test.describe('详情页页签设计器', () => {
  test('⚠️ 配了变更记录页签却没开变更日志：界面上直接说清楚该去哪一步打开', async ({
    page,
    request
  }) => {
    const token = await login(page)
    let fixture: { id: number; code: string } | undefined
    try {
      // 两个开关分处两个步骤（页签在这里、变更日志在「数据绑定」），很容易只开一个，
      // 而那样页签会永远是空的 —— 不报错，用户只会以为这条数据没被改过。
      // 这是详情页页签这一块最值得拦的一条
      fixture = await createDraft(request, token)
      await openListTab(page, fixture.id, '详情页页签')

      await page.getByRole('button', { name: /添加页签/ }).click()
      await page.getByPlaceholder('如 changeLog').fill('changeLog')
      await page.getByPlaceholder('如 变更记录').fill('变更记录')

      const warning = page.locator('.el-alert--warning').first()
      await expect(warning, '没开变更日志时应当有警告').toBeVisible({ timeout: 30_000 })
      await expect(warning).toContainText('记录变更日志')

      await save(page)
      const res = await request.get(
        `${API_BASE_URL}/infra/form-design/get?id=${fixture.id}`,
        { headers: authHeaders(token) }
      )
      const saved = (await res.json()) as { data: { detailTabs: string } }
      // ⚠️ 警告不阻断保存 —— 「列表设计」这一步本来就没有必填校验，
      // 在这里抛错会让用户存不了一张还没配完的表单。发布才是不可绕过的那道
      expect(JSON.parse(saved.data.detailTabs)).toEqual([
        { key: 'changeLog', label: '变更记录', type: 'CHANGE_LOG' }
      ])
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 关联数据页签：选目标表单后能选它的字段，没配齐时有警告', async ({ page, request }) => {
    const token = await login(page)
    let fixture: { id: number; code: string } | undefined
    let target: { id: number; code: string } | undefined
    try {
      // 目标表单要有字段可选 —— createDraft 造的那张有 amount / reason
      target = await createDraft(request, token)
      fixture = await createDraft(request, token, {
        detailTabs: JSON.stringify([
          { key: 'children', label: '子单据', type: 'RELATION_LIST' }
        ])
      })
      await openListTab(page, fixture.id, '详情页页签')

      // 没配齐目标表单与关联字段时要有警告 —— 缺任何一个页签里都只会是一片空白
      const warning = page.locator('.el-alert--warning').first()
      await expect(warning).toBeVisible({ timeout: 30_000 })
      await expect(warning).toContainText('没配齐目标表单与关联字段')

      // 选目标表单。⚠️ 用 .el-select 定位，不用 getByPlaceholder ——
      // 这一版 Element Plus 的 select 占位符是 <span> 而不是 input 的 placeholder
      await page.locator('.el-select').filter({ hasText: '选择表单' }).first().click()
      await page
        .locator('.el-select-dropdown__item:visible', { hasText: target.code })
        .first()
        .click()

      // 目标表单的字段要能被拉出来（走的是「表单简单列表 + 按 id 拉详情再解字段」，
      // 与关联表单控件同一套做法）
      await page.locator('.el-select').filter({ hasText: '目标表单上指向本记录的字段' }).first().click()
      await page.locator('.el-select-dropdown__item:visible', { hasText: 'reason' }).first().click()
      await expect(page.locator('.el-alert--warning')).toHaveCount(0)

      await save(page)
      const res = await request.get(`${API_BASE_URL}/infra/form-design/get?id=${fixture.id}`, {
        headers: authHeaders(token)
      })
      const saved = (await res.json()) as { data: { detailTabs: string } }
      const tab = JSON.parse(saved.data.detailTabs)[0]
      expect(tab.targetFormCode).toBe(target.code)
      expect(tab.targetField).toBe('reason')
    } finally {
      await cleanup(request, token, fixture)
      await cleanup(request, token, target)
    }
  })

  test('开了变更日志时没有警告', async ({ page, request }) => {
    const token = await login(page)
    let fixture: { id: number; code: string } | undefined
    try {
      fixture = await createDraft(request, token, {
        tableBinding: JSON.stringify({
          mainTable: FIXTURE_TABLE,
          mainPk: 'id',
          fieldMapping: {
            amount: { table: FIXTURE_TABLE, column: 'amount', jdbcType: 'DECIMAL' },
            reason: { table: FIXTURE_TABLE, column: 'reason', jdbcType: 'VARCHAR' }
          },
          changeLog: { enabled: true }
        }),
        detailTabs: JSON.stringify([
          { key: 'changeLog', label: '变更记录', type: 'CHANGE_LOG' }
        ])
      })
      await openListTab(page, fixture.id, '详情页页签')

      // 先等页签内容真的回显出来，再断言「没有警告」——
      // 少了这一步，页面还没加载完时这条断言也会通过
      await expect(page.getByPlaceholder('如 变更记录')).toHaveValue('变更记录', {
        timeout: 30_000
      })
      await expect(page.locator('.el-alert--warning')).toHaveCount(0)
    } finally {
      await cleanup(request, token, fixture)
    }
  })
})
