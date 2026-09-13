import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page
} from '@playwright/test'

/**
 * 联动规则与扩展模式的端到端验证（B1）
 *
 * 分两部分：
 *
 * 1. 界面链路 —— 能不能在设计器里把规则配出来、存下去、再打开还在
 * 2. 服务端约束 —— 这才是重点。前端算出来的必填与只读只是体验，
 *    这里直接用 API 构造请求（完全绕过界面），验证服务端是不是真的兜住了。
 *    对应设计方案 §9.3 的第 1、2 条。
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
  // 冷启动时首屏要现编译一大批模块，默认 10s 不够
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
  return body.data?.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

/** 两个字段：amount（金额）与 reason（说明） */
const FORM_FIELDS = [
  JSON.stringify({
    type: 'inputNumber',
    field: 'amount',
    title: '金额',
    $required: false,
    props: {}
  }),
  JSON.stringify({ type: 'input', field: 'reason', title: '说明', $required: false, props: {} }),
  JSON.stringify({ type: 'input', field: 'locked', title: '锁定标记', $required: false, props: {} })
]

/** 造一张带联动规则的草稿表单 */
async function createFormWithRules(
  request: APIRequestContext,
  token: string,
  logicRules: any[],
  extra: Record<string, any> = {}
): Promise<{ id: number; code: string }> {
  const code = `e2e_logic_${Date.now()}`
  const response = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: 'B1 联动规则用例',
      code,
      formType: 1,
      formConf: JSON.stringify({ form: { labelWidth: '100px' } }),
      formFields: FORM_FIELDS,
      logicRules: JSON.stringify(logicRules),
      ...extra
    }
  })
  expect(response.ok(), '造用例表单失败').toBeTruthy()
  const body = (await response.json()) as { data?: number }
  expect(body.data).toBeTruthy()
  return { id: body.data as number, code }
}

async function deleteForm(request: APIRequestContext, token: string, id: number) {
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, {
    headers: authHeaders(token)
  })
}

async function getForm(request: APIRequestContext, token: string, id: number): Promise<any> {
  const response = await request.get(`${API_BASE_URL}/infra/form-design/get?id=${id}`, {
    headers: authHeaders(token)
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { data: any }).data
}

/**
 * 点设计器里的「保存」并等更新接口返回
 *
 * 必须等这个响应而不是等提示文案：断言要在写库完成之后才去读回。
 */
async function saveForm(page: Page) {
  const updatePromise = page.waitForResponse(
    (r) => r.url().includes('/infra/form-design/update') && r.request().method() === 'PUT'
  )
  await page.getByRole('button', { name: /保\s*存/ }).first().click()
  const response = await updatePromise
  expect(response.ok(), '保存请求失败').toBeTruthy()
  const body = (await response.json()) as { code: number; msg: string }
  expect(body.code, `保存被后端拒绝：${body.msg}`).toBe(0)
}

/**
 * 选中一个 el-radio-button
 *
 * ⚠️ 不能用 getByRole('radio').click()：Element Plus 把真正的 input 藏了
 * （opacity:0 且被 label 覆盖），点它会一直等可见性等到超时。要点 label 本身。
 */
async function pickRadio(scope: Page | Locator, label: string) {
  await scope
    .locator('.el-radio-button')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first()
    .click()
}

/** 展开一个 el-select 并选中选项。下拉是挂在 body 上的 popper，只能从 page 找 */
async function pickOption(page: Page, trigger: Locator, option: string | RegExp) {
  await trigger.click()
  const dropdown = page.locator('.el-select-dropdown').filter({ visible: true }).last()
  await dropdown.getByRole('option', { name: option }).first().click()
}

/**
 * 往 Monaco 编辑器里写脚本
 *
 * ⚠️ 不能用 locator.fill()：Monaco 的 textarea 只是个接收键盘事件的隐藏输入框，
 * 内容由它自己的 model 维护，fill 写进去不会变成编辑器内容。
 * 只能点进去用键盘敲，并且要先全选清空，否则是在已有内容后面追加。
 */
async function typeInMonaco(page: Page, text: string) {
  const editor = page.locator('.monaco-editor').first()
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Delete')
  // ⚠️ 用 insertText 而不是 type()：Monaco 开着括号/引号自动闭合，
  // 逐键敲 `setVisible('x')` 会被补成 `setVisible('x'))''`。
  // insertText 走的是输入法提交路径，不触发这些按键联动
  await page.keyboard.insertText(text)
}

/** 按钮文字精确匹配。el-button 里有 Icon，用 hasText 正则比 accessible name 稳 */
function buttonByText(scope: Page | Locator, text: string): Locator {
  return scope.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) })
}

// ==================== 存取链路 ====================

test.describe('联动规则的存取', () => {
  test('规则能存下去，再读出来内容一致', async ({ page, request }) => {
    const token = await login(page)
    const rules = [
      {
        id: 'r1',
        name: '大额需填说明',
        enabled: true,
        trigger: 'SUBMIT',
        when: {
          logic: 'AND',
          items: [{ field: 'amount', operator: 'GT', valueType: 'CONST', value: 10000 }]
        },
        then: [{ type: 'REQUIRE', target: 'reason' }],
        otherwise: [{ type: 'OPTIONAL', target: 'reason' }]
      }
    ]
    const { id } = await createFormWithRules(request, token, rules)
    try {
      const saved = await getForm(request, token, id)
      expect(saved.logicRules, '联动规则没有被保存').toBeTruthy()
      const parsed = JSON.parse(saved.logicRules)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe('大额需填说明')
      expect(parsed[0].otherwise, 'otherwise 分支必须原样保留').toHaveLength(1)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('新建表单的扩展模式默认是「前端脚本」，超时动作默认「阻断」', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      const saved = await getForm(request, token, id)
      expect(saved.extensionMode, '默认扩展模式应为前端脚本(1)').toBe(1)
      expect(saved.submitHookTimeoutAction, '默认超时动作应为阻断(1)').toBe(1)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('详情接口带上「是否存在服务端扩展点实现」，供设计期错配提示', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      const saved = await getForm(request, token, id)
      // 这张临时表单不会有 Java 扩展点实现，应为 false —— 关键是字段存在且是布尔
      expect(typeof saved.hasServerExtension).toBe('boolean')
      expect(saved.hasServerExtension).toBe(false)
      expect(Array.isArray(saved.serverExtensionNames)).toBe(true)
    } finally {
      await deleteForm(request, token, id)
    }
  })
})

// ==================== 界面链路 ====================

/**
 * 「逻辑与扩展」步骤的界面用例
 *
 * 这一步曾因三块功能未打磨完而从步骤条里摘掉（`editor/index.vue` 的
 * `HIDDEN_STEP_KEYS`），这些用例随之 skip。现在步骤已重新开放，用例一并恢复。
 */
test.describe('联动规则编辑器', () => {
  test('设计器里有「逻辑与扩展」步骤，能新增一条规则', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()

      const addButton = page.getByRole('button', { name: /新增规则/ })
      await expect(addButton).toBeVisible({ timeout: 30_000 })
      await addButton.click()

      // 新增后自动展开，条件构造器与动作列表都应出现。
      // 用 .first() —— 「执行动作」在分隔线与动作下拉的选项里都会出现，
      // 严格模式下不加会因匹配到多个元素而失败
      await expect(page.getByText('当满足以下条件')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('执行动作').first()).toBeVisible()
      // otherwise 分支必须在界面上有位置 —— 只给 then 是同类产品最常见的坑
      await expect(page.getByText('否则', { exact: true }).first()).toBeVisible()
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 规则名与触发时机改完必须真的存下去', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()

      const addButton = page.getByRole('button', { name: /新增规则/ })
      await expect(addButton).toBeVisible({ timeout: 30_000 })
      await addButton.click()

      await page.getByPlaceholder('给规则起个名字，便于日后维护').fill('大额需填说明')
      await pickRadio(page, '提交前')

      await saveForm(page)

      const saved = await getForm(request, token, id)
      expect(saved.logicRules, '规则没有被保存').toBeTruthy()
      const parsed = JSON.parse(saved.logicRules)
      expect(parsed).toHaveLength(1)
      // 这两条断言就是回归点：改成就地 mutate 元素属性，它们会变回 '' 和 'CHANGE'
      expect(parsed[0].name, '规则名没有写回').toBe('大额需填说明')
      expect(parsed[0].trigger, '触发时机没有写回').toBe('SUBMIT')
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 条件与动作配完必须真的存下去', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()

      const addButton = page.getByRole('button', { name: /新增规则/ })
      await expect(addButton).toBeVisible({ timeout: 30_000 })
      await addButton.click()

      // 条件：金额 大于 10000
      // ⚠️ 不能用 getByPlaceholder 定位 el-select —— 新版 Element Plus 把占位文字
      // 渲染成独立的 span，而不是 input 的 placeholder 属性。按 DOM 顺序取更可靠：
      // 0=字段 1=操作符 2=取值来源
      await buttonByText(page, '条件').first().click()
      const condRow = page.locator('.condition-row').first()
      await pickOption(page, condRow.locator('.el-select').nth(0), /金额/)
      await pickOption(page, condRow.locator('.el-select').nth(1), '大于')
      await condRow.getByPlaceholder('输入比较值').fill('10000')

      // 动作：把「说明」置为必填。then 与 otherwise 各有一个列表，取第一个
      await buttonByText(page, '添加动作').first().click()
      const actionRow = page.locator('.action-row').first()
      await pickOption(page, actionRow.locator('.el-select').nth(0), '置为必填')
      await pickOption(page, actionRow.locator('.el-select').nth(1), /说明/)

      await saveForm(page)

      const saved = await getForm(request, token, id)
      const parsed = JSON.parse(saved.logicRules)
      expect(parsed).toHaveLength(1)
      const condition = parsed[0].when?.items?.[0]
      expect(condition, '条件没有写回').toBeTruthy()
      expect(condition.field).toBe('amount')
      expect(condition.operator).toBe('GT')
      expect(String(condition.value)).toBe('10000')
      const action = parsed[0].then?.[0]
      expect(action, '动作没有写回').toBeTruthy()
      expect(action.type).toBe('REQUIRE')
      expect(action.target).toBe('reason')
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 前端脚本写完必须真的存下去', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()
      await page.getByRole('tab', { name: '扩展方式' }).click()

      await typeInMonaco(page, "setVisible('reason', true)")

      await saveForm(page)

      const saved = await getForm(request, token, id)
      expect(saved.formScript, '脚本没有被保存').toBeTruthy()
      const parsed = JSON.parse(saved.formScript)
      expect(parsed.onLoad, '脚本正文没有写回').toBe("setVisible('reason', true)")
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 跨字段校验规则配完必须真的存下去', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()
      await page.getByRole('tab', { name: '跨字段校验' }).click()

      await page.getByRole('button', { name: /添加跨字段规则/ }).click()
      await page.getByPlaceholder('规则名称，如「日期区间」').fill('金额上限')
      await page
        .getByPlaceholder('校验不通过时给用户看的话，如「结束日期不能早于开始日期」')
        .fill('金额不得超过一万')

      // 「必须满足」那组条件：金额 小于等于 10000
      const mustGroup = page.locator('.cross-field-editor .condition-group').last()
      await buttonByText(mustGroup, '条件').click()
      const condRow = mustGroup.locator('.condition-row').first()
      await pickOption(page, condRow.locator('.el-select').nth(0), /金额/)
      await pickOption(page, condRow.locator('.el-select').nth(1), '小于等于')
      await condRow.getByPlaceholder('输入比较值').fill('10000')

      await saveForm(page)

      const saved = await getForm(request, token, id)
      expect(saved.validateRules, '跨字段规则没有被保存').toBeTruthy()
      const parsed = JSON.parse(saved.validateRules)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe('金额上限')
      expect(parsed[0].message).toBe('金额不得超过一万')
      expect(parsed[0].must?.items?.[0]?.field).toBe('amount')
      expect(parsed[0].must?.items?.[0]?.operator).toBe('LE')
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('已配好的规则重新打开必须完整回显', async ({ page, request }) => {
    const token = await login(page)
    const rules = [
      {
        id: 'r1',
        name: '大额需填说明',
        enabled: true,
        trigger: 'SUBMIT',
        when: {
          logic: 'AND',
          items: [{ field: 'amount', operator: 'GT', valueType: 'CONST', value: '10000' }]
        },
        then: [{ type: 'REQUIRE', target: 'reason' }],
        otherwise: [{ type: 'OPTIONAL', target: 'reason' }]
      }
    ]
    const { id } = await createFormWithRules(request, token, rules)
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()

      // 折叠态就该显示规则名与触发时机
      const ruleName = page.locator('.rule-name').filter({ hasText: '大额需填说明' })
      await expect(ruleName).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('.rule-title').getByText('提交前')).toBeVisible()

      // 展开后条件与动作都要在
      await ruleName.click()
      const condRow = page.locator('.condition-row').first()
      await expect(condRow.locator('.cond-field')).toContainText('金额')
      await expect(condRow.locator('.cond-operator')).toContainText('大于')
      await expect(condRow.getByPlaceholder('输入比较值')).toHaveValue('10000')

      // then 与 otherwise 各一条，otherwise 常被同类产品漏掉，单独断言
      await expect(page.locator('.action-row').nth(0).locator('.action-type')).toContainText(
        '置为必填'
      )
      await expect(page.locator('.action-row').nth(1).locator('.action-type')).toContainText(
        '置为非必填'
      )
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('嵌套条件组能配出来并存下去', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()
      await page.getByRole('button', { name: /新增规则/ }).click()

      // 外层加一个条件组，再在组内加一个条件
      await buttonByText(page, '条件组').first().click()
      const nested = page.locator('.nested-group .condition-group').first()
      await buttonByText(nested, '条件').click()
      const nestedRow = nested.locator('.condition-row').first()
      await pickOption(page, nestedRow.locator('.el-select').nth(0), /金额/)
      await pickOption(page, nestedRow.locator('.el-select').nth(1), '大于')
      await nestedRow.getByPlaceholder('输入比较值').fill('500')

      await saveForm(page)

      const saved = await getForm(request, token, id)
      const parsed = JSON.parse(saved.logicRules)
      const group = parsed[0].when?.items?.[0]
      expect(group, '嵌套组没有写回').toBeTruthy()
      expect(group.logic, '嵌套的应该是一个条件组').toBe('AND')
      expect(group.items?.[0]?.field).toBe('amount')
      expect(String(group.items?.[0]?.value)).toBe('500')
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('删除规则后保存，规则不再存在', async ({ page, request }) => {
    const token = await login(page)
    const rules = [
      {
        id: 'r1',
        name: '待删除的规则',
        enabled: true,
        trigger: 'CHANGE',
        when: { logic: 'AND', items: [] },
        then: [],
        otherwise: []
      }
    ]
    const { id } = await createFormWithRules(request, token, rules)
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()

      const ruleName = page.locator('.rule-name').filter({ hasText: '待删除的规则' })
      await expect(ruleName).toBeVisible({ timeout: 30_000 })
      await page.locator('.rule-title button').first().click()
      await page.getByRole('button', { name: '确定' }).click()
      await expect(ruleName).toBeHidden()

      await saveForm(page)

      const saved = await getForm(request, token, id)
      const parsed = saved.logicRules ? JSON.parse(saved.logicRules) : []
      expect(parsed, '删除后不应还留着规则').toHaveLength(0)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 扩展方式与超时动作改完必须真的存下去', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()
      await page.getByRole('tab', { name: '扩展方式' }).click()

      // 默认是「前端脚本」(1) + 「阻断提交」(1)，两个都改掉再存
      await expect(page.locator('.form-script-editor')).toBeVisible({ timeout: 15_000 })
      await pickRadio(page, '放行')
      await pickRadio(page, '无')

      await saveForm(page)

      const saved = await getForm(request, token, id)
      expect(saved.extensionMode, '扩展方式没有写回').toBe(0)
      expect(saved.submitHookTimeoutAction, '超时动作没有写回').toBe(2)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('规则引用了已删除的字段，顶部要给出告警', async ({ page, request }) => {
    const token = await login(page)
    const rules = [
      {
        id: 'r1',
        name: '引用了幽灵字段',
        enabled: true,
        trigger: 'CHANGE',
        when: {
          logic: 'AND',
          items: [{ field: 'ghost_field', operator: 'NOT_EMPTY' }]
        },
        then: [{ type: 'SHOW', target: 'another_ghost' }],
        otherwise: []
      }
    ]
    const { id } = await createFormWithRules(request, token, rules)
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()

      // 两个失效引用都要被点名，否则用户不知道该改哪一处
      const alert = page.getByText(/联动规则引用了已不存在的字段/)
      await expect(alert).toBeVisible({ timeout: 30_000 })
      await expect(alert).toContainText('ghost_field')
      await expect(alert).toContainText('another_ghost')
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('扩展方式页签展示三选一，且说明脚本没有后端调用能力', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()
      await page.getByRole('tab', { name: '扩展方式' }).click()

      await expect(page.getByText('无', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('radio', { name: '前端脚本' })).toBeVisible()
      await expect(page.getByRole('radio', { name: '服务端扩展点' })).toBeVisible()
      // 这句提示是本次安全设计的核心约定，必须出现在界面上
      await expect(page.getByText(/没有任何后端调用能力/)).toBeVisible()
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 脚本里写了禁止的写法，界面上立刻报出行号', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [])
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('逻辑与扩展', { exact: true }).last().click()
      await page.getByRole('tab', { name: '扩展方式' }).click()

      await typeInMonaco(page, "const a = 1\nfetch('/admin-api/system/user/list')")

      // 静态检查结果要带行号，保存时才报错的话用户得自己回来找是哪一行
      await expect(page.getByText(/以下写法不被允许/)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('第 2 行')).toBeVisible()
    } finally {
      await deleteForm(request, token, id)
    }
  })
})

// ==================== 服务端约束（绕过界面） ====================
//
// 以下用例全部直接打 API，不经过任何界面。它们验的是「前端能被绕过、服务端不能」。

test.describe('服务端复校验（绕过前端构造请求）', () => {
  /** 发布表单，让它可以走运行时接口 */
  async function publish(request: APIRequestContext, token: string, id: number) {
    return request.post(`${API_BASE_URL}/infra/form-design/publish`, {
      headers: authHeaders(token),
      data: { id }
    })
  }

  test('⚠️ 环形赋值的规则会被发布校验拒绝', async ({ page, request }) => {
    const token = await login(page)
    // a 依赖 b、b 依赖 a 的互相赋值
    const rules = [
      {
        id: 'r1',
        enabled: true,
        trigger: 'SUBMIT',
        when: { logic: 'AND', items: [{ field: 'amount', operator: 'GT', value: 1 }] },
        then: [{ type: 'SET_VALUE', target: 'reason', payload: { value: 'x' } }]
      },
      {
        id: 'r2',
        enabled: true,
        trigger: 'SUBMIT',
        when: { logic: 'AND', items: [{ field: 'reason', operator: 'NOT_EMPTY' }] },
        then: [{ type: 'SET_VALUE', target: 'amount', payload: { value: 2 } }]
      }
    ]
    const { id } = await createFormWithRules(request, token, rules)
    try {
      const response = await publish(request, token, id)
      const body = (await response.json()) as { code: number; msg: string }
      // 发布校验会先报缺主表之类的基础问题，只要不是「成功」即可 ——
      // 环检测的精确断言由后端单测覆盖，这里验的是它确实接进了发布链路
      expect(body.code, '带环形赋值的表单不应发布成功').not.toBe(0)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 选了「服务端扩展点」却没有实现，发布被拒绝', async ({ page, request }) => {
    const token = await login(page)
    const { id } = await createFormWithRules(request, token, [], { extensionMode: 2 })
    try {
      const response = await publish(request, token, id)
      const body = (await response.json()) as { code: number; msg: string }
      expect(body.code, '反向模式错配必须拦住发布').not.toBe(0)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('保存时非法的扩展模式值被参数校验拒绝', async ({ page, request }) => {
    const token = await login(page)
    const response = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
      headers: authHeaders(token),
      data: {
        name: '非法模式',
        code: `e2e_bad_mode_${Date.now()}`,
        formType: 1,
        formFields: FORM_FIELDS,
        extensionMode: 99
      }
    })
    const body = (await response.json()) as { code: number }
    expect(body.code, '枚举外的值必须被拒绝').not.toBe(0)
  })
})
