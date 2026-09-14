import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { closeLogicDialog, openLogicDialog } from './helpers/designer'

/**
 * 设计器里各配置行的布局验证
 *
 * 专防一类回归：**UnoCSS 的固定宽度类被 Element Plus 的 width:100% 压过**。
 *
 * `.w-180px` 与 `.el-select` 同为单类选择器、优先级相同，谁生效只取决于样式表的
 * 加载顺序 —— 实测 Element Plus 胜出。于是控件各自撑满再被 flex 均分：
 * 要么把旁边 flex:1 的输入框挤成 0 宽（点得到、填不进去），
 * 要么自己被压成几十像素（框还在，内容一个字看不见）。
 *
 * 两种坏法都不报错、不影响保存，纯靠肉眼才能发现，所以用尺寸断言钉住。
 * 断言只卡「量级」而不卡精确像素，避免字体与缩放带来的脆弱。
 *
 * 修的时候不要再用 `w-XXXpx`（也不要用 `w-XXXpx!` 硬压），
 * 用 `flex: 0 0 宽度` / `flex: 1 1 最小宽度`，不与任何外部样式争优先级。
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

async function createForm(
  request: APIRequestContext,
  token: string,
  formFields: string[]
): Promise<number> {
  const resp = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: '设计器布局用例',
      code: `e2e_layout_${Date.now()}`,
      // 2 = 表单+列表，列表设计那一步只有这个类型才有
      formType: 2,
      formConf: JSON.stringify({ form: { labelWidth: '100px' } }),
      formFields
    }
  })
  return ((await resp.json()) as { data: number }).data
}

async function deleteForm(request: APIRequestContext, token: string, id: number) {
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, {
    headers: authHeaders(token)
  })
}

/** 取元素宽度，取不到就返回 0 让断言失败并打印出来 */
async function widthOf(page: Page, selector: string, index = 0): Promise<number> {
  const box = await page.locator(selector).nth(index).boundingBox()
  return box?.width ?? 0
}

const FIELDS = [
  JSON.stringify({ type: 'inputNumber', field: 'amount', title: '金额', props: {} }),
  JSON.stringify({ type: 'input', field: 'reason', title: '说明', props: {} })
]

test.describe('设计器配置行的布局', () => {
  test('⚠️ 联动条件行：比较值输入框必须有可用宽度', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token, FIELDS)
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await openLogicDialog(page)
      await page.getByRole('button', { name: /新增规则/ }).click({ timeout: 30_000 })
      await page
        .locator('button')
        .filter({ hasText: /^\s*条件\s*$/ })
        .first()
        .click()

      await expect(page.locator('.condition-row').first()).toBeVisible({ timeout: 15_000 })

      // 三个下拉各自钉死宽度，不再各占三分之一
      expect(await widthOf(page, '.condition-row .cond-field')).toBeGreaterThan(150)
      expect(await widthOf(page, '.condition-row .cond-field')).toBeLessThan(230)
      expect(await widthOf(page, '.condition-row .cond-operator')).toBeLessThan(180)

      // 回归点：曾经被挤成 0 宽，看得见框、点不进去
      const valueWidth = await widthOf(page, '.condition-row .cond-value')
      expect(valueWidth, '比较值输入框被挤没了').toBeGreaterThan(200)
      // 真的能填进去才算数
      const input = page.locator('.condition-row').first().getByPlaceholder('输入比较值')
      await input.fill('12345')
      await expect(input).toHaveValue('12345')
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 自定义按钮卡片头：名称与位置不该各占半行', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token, FIELDS)
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.locator('.cursor-pointer').filter({ hasText: '列表设计' }).first().click()
      await page.getByRole('tab', { name: '自定义按钮' }).click()
      await page
        .getByRole('button', { name: /添加按钮|新增按钮|添加/ })
        .first()
        .click({ timeout: 30_000 })

      await expect(page.locator('.card-header').first()).toBeVisible({ timeout: 20_000 })

      // 回归点：两者曾各被撑成 459px，平分整行
      const labelWidth = await widthOf(page, '.card-header .btn-label')
      const posWidth = await widthOf(page, '.card-header .btn-position')
      expect(labelWidth, '按钮名称被撑满了').toBeLessThan(260)
      expect(labelWidth).toBeGreaterThan(150)
      expect(posWidth, '位置下拉被撑满了').toBeLessThan(220)
      expect(posWidth).toBeGreaterThan(120)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 关联控件的带出字段行：三个下拉都要看得见内容', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token, FIELDS)
    try {
      await page.goto(`/infra/form-design/editor?id=${id}`)
      await page.getByText('表单设计', { exact: true }).last().click()
      await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })

      // 点左侧面板把控件加到画布，属性面板随之打开
      await page.locator('._fc-l-item').filter({ hasText: '关联表单' }).first().click()
      await expect(page.locator('.mapping-section')).toBeVisible({ timeout: 20_000 })

      // 选一张已发布表单，「添加」才可用
      await page.locator('._fc-r-tab-props .el-select').first().click()
      await page
        .locator('.el-select-dropdown')
        .filter({ visible: true })
        .last()
        .locator('.el-select-dropdown__item')
        .first()
        .click()
      const addBtn = page.locator('.mapping-head button')
      await expect(addBtn).toBeEnabled({ timeout: 20_000 })
      await addBtn.click()

      await expect(page.locator('.mapping-row').first()).toBeVisible({ timeout: 20_000 })

      // 回归点：属性面板只有 260px 宽，两个字段下拉曾被压到 34px ——
      // 框在、但选中的字段名一个字都看不见。放不下就该折行，而不是压扁
      const selects = page.locator('.mapping-row').first().locator('.el-select')
      const n = await selects.count()
      expect(n).toBe(3)
      for (let i = 0; i < n; i++) {
        const box = await selects.nth(i).boundingBox()
        expect(box?.width ?? 0, `第 ${i + 1} 个下拉被压扁了`).toBeGreaterThan(100)
      }
    } finally {
      await deleteForm(request, token, id)
    }
  })
})
