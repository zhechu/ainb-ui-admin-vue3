import { expect, test, type Page } from '@playwright/test'

/**
 * 数据建模「系统列策略」与「字典/关联」的端到端验证（P0b / R2 R3 前端接入）
 *
 * ## 为什么这两条必须在浏览器里走
 *
 * 后端单测与 API 探针已经证明「接口行为对」，但这两块的风险恰恰在前端：
 *
 * 1. **策略选了不生效** —— 新建时界面上的字段是要<b>一并提交</b>的。
 *    若切换到 GLOBAL 后界面仍展示 tenant_id，它就会跟着提交上去，
 *    后端注入器发现同名列便「让位」，结果表里照样有 tenant_id ——
 *    保存成功、也没报错，但策略完全没生效。这正是本子系统最典型的缺陷形态。
 *
 * 2. **元数据改了不提交** —— dictType/refTable/refColumn 不参与 DDL，
 *    漏在 buildPayload 里带上的话，弹窗里填了、保存也成功，就是存不进去。
 *
 * 两条都属于「界面看着对、结果不对」，只有真的点一遍才能发现。
 */

const TENANT_ID = process.env.E2E_TENANT_ID || '1'

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
  await form.locator('button').last().click()
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
}

/** 数据建模列表页的路由：/infra（基础设施） → data-manage（数据管理） → data-model */
const DATA_MODEL_PATH = '/infra/data-manage/data-model'

/** 进入数据建模的新建表单 */
async function openCreateForm(page: Page): Promise<void> {
  await page.goto(DATA_MODEL_PATH)
  await page.getByRole('button', { name: '新建模型' }).first().click()
  await expect(page.getByText('系统列策略')).toBeVisible({ timeout: 30_000 })
}

/**
 * 选择系统列策略
 *
 * ⚠️ 不能用 getByRole('combobox').filter({hasText}) —— Element Plus 的 el-select
 * 把选中值渲染在独立的 .el-select__selected-item 里，hasText 匹配不稳定（实测超时）。
 * 按 form-item 的 label 定位才是可靠的。
 */
async function pickProfile(page: Page, optionName: RegExp): Promise<void> {
  await page.locator('.el-form-item').filter({ hasText: '系统列策略' }).locator('.el-select').click()
  await page.getByRole('option', { name: optionName }).click()
}

/** 读出字段表格里当前展示的所有字段名 */
async function shownColumnNames(page: Page): Promise<string[]> {
  const inputs = page.locator('.column-table input[placeholder^="字段名"]')
  return (await inputs.all()).reduce<Promise<string[]>>(async (acc, input) => {
    const list = await acc
    list.push((await input.inputValue()).trim())
    return list
  }, Promise.resolve([]))
}

test.describe('数据建模：系统列策略与业务语义', () => {
  test('切换系统列策略，界面展示的系统列跟着变', async ({ page }) => {
    await login(page)
    await openCreateForm(page)

    // 默认 TENANT：应当有 tenant_id、没有 version
    let names = await shownColumnNames(page)
    expect(names, 'TENANT 策略下应展示 tenant_id').toContain('tenant_id')
    expect(names, 'TENANT 策略下不该有 version').not.toContain('version')

    // 切到 GLOBAL：tenant_id 必须从界面上消失
    // —— 它若留着就会被一并提交，注入器让位，策略形同虚设
    await pickProfile(page, /全局表/)
    await expect
      .poll(async () => (await shownColumnNames(page)).includes('tenant_id'), {
        timeout: 15_000,
        message: 'GLOBAL 策略下 tenant_id 必须从界面消失'
      })
      .toBe(false)

    // 同时应出现显著的安全提示 —— 丢掉租户隔离不能悄悄发生
    await expect(
      page.locator('.el-alert').filter({ hasText: '对所有租户可见' })
    ).toBeVisible()

    // 切到 LEGACY：应出现 version，仍然没有 tenant_id
    await pickProfile(page, /兼容存量样板表/)
    await expect
      .poll(async () => await shownColumnNames(page), { timeout: 15_000 })
      .toEqual(expect.arrayContaining(['version']))
    names = await shownColumnNames(page)
    expect(names, 'LEGACY 策略下不该有 tenant_id').not.toContain('tenant_id')
  })

  test('改表时不展示系统列策略 —— 它只在建表那一刻有意义', async ({ page }) => {
    await login(page)
    await page.goto(DATA_MODEL_PATH)
    // 进入任意一个已有模型的设计页
    const firstRow = page.locator('.el-table__row').first()
    await expect(firstRow).toBeVisible({ timeout: 30_000 })
    await firstRow.getByRole('button', { name: '设计' }).first().click()
    await expect(page.getByText('字段列表', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('系统列策略')).toBeHidden()
  })

  test('字典/关联弹窗：填了能回显，清空能清掉', async ({ page }) => {
    await login(page)
    await openCreateForm(page)

    // 加一个业务字段
    await page.getByRole('button', { name: /添加字段/ }).click()
    const nameInput = page.locator('.column-table input[placeholder^="字段名"]').nth(1)
    await nameInput.fill('order_status')

    // 打开业务语义弹窗，填字典类型
    await page.getByRole('button', { name: '设置' }).first().click()
    await expect(page.getByText(/这里配的是/)).toBeVisible()
    await page.getByPlaceholder(/order_status，对应字典/).fill('order_status')
    await page.getByRole('button', { name: '确 定' }).click()

    // 表格里应回显摘要
    await expect(page.getByRole('button', { name: /字典：order_status/ })).toBeVisible()

    // 再打开，填关联并清空字典
    await page.getByRole('button', { name: /字典：order_status/ }).click()
    await page.getByPlaceholder(/order_status，对应字典/).fill('')
    await page.getByPlaceholder('如 biz_customer').fill('biz_customer')
    await page.getByPlaceholder('如 id').fill('id')
    await page.getByRole('button', { name: '确 定' }).click()
    await expect(page.getByRole('button', { name: /关联：biz_customer\.id/ })).toBeVisible()

    // 清空按钮应把摘要清掉，回到「设置」
    await page.getByRole('button', { name: /关联：biz_customer\.id/ }).click()
    await page.getByRole('button', { name: '清 空' }).click()
    await expect(page.getByRole('button', { name: '设置' }).first()).toBeVisible()
  })

  test('新建 GLOBAL 表并保存：建出来的表真的没有 tenant_id，且元数据存得住', async ({
    page,
    request
  }) => {
    const table = 'biz_e2e_profile_meta'
    // 前置清理：可能有上次失败留下的残留
    const login2 = await request.post('http://127.0.0.1:48080/admin-api/system/auth/login', {
      headers: { 'tenant-id': TENANT_ID },
      data: { username: 'admin', password: 'admin123' }
    })
    const token = ((await login2.json()) as any).data.accessToken as string
    const headers = { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID }
    // ⚠️ 必须按表名过滤：分页 pageSize 上限是 200，传更大的值后端直接返回 400 与空列表，
    // 「查不到」会被误读成「没建出来」
    const pageResp = await request.get(
      `http://127.0.0.1:48080/admin-api/infra/data-model/page?pageNo=1&pageSize=20&tableName=${table}`,
      { headers }
    )
    for (const item of (((await pageResp.json()) as any).data?.list ?? []) as any[]) {
      if (item.tableName === table) {
        await request.delete(
          `http://127.0.0.1:48080/admin-api/infra/data-model/delete?id=${item.id}&dropTable=true&riskConfirmed=true`,
          { headers }
        )
      }
    }

    await login(page)
    await openCreateForm(page)
    await page.getByPlaceholder('如 biz_order').fill(table)
    await page.getByPlaceholder('如 订单表').fill('端到端探针表')
    await page.getByPlaceholder('如 订单模型').fill('端到端探针')

    // 选 GLOBAL
    await pickProfile(page, /全局表/)

    // 加一个带字典的业务字段
    await page.getByRole('button', { name: /添加字段/ }).click()
    await page.locator('.column-table input[placeholder^="字段名"]').nth(1).fill('order_status')
    await page.locator('.column-table input[placeholder="描述"]').nth(1).fill('订单状态')
    await page.getByRole('button', { name: '设置' }).first().click()
    await page.getByPlaceholder(/order_status，对应字典/).fill('order_status')
    await page.getByRole('button', { name: '确 定' }).click()

    await page.getByRole('button', { name: '保 存' }).click()
    await expect(page.getByText(/新增成功|创建成功/)).toBeVisible({ timeout: 30_000 })

    // 用接口核对真实结果 —— 界面提示「成功」不等于建出来的东西是对的
    const listResp = await request.get(
      `http://127.0.0.1:48080/admin-api/infra/data-model/page?pageNo=1&pageSize=20&tableName=${table}`,
      { headers }
    )
    const created = (((await listResp.json()) as any).data?.list ?? []).find(
      (m: any) => m.tableName === table
    )
    expect(created, '模型应已登记').toBeTruthy()

    const structResp = await request.get(
      `http://127.0.0.1:48080/admin-api/infra/data-model/structure?id=${created.id}`,
      { headers }
    )
    const columns = (((await structResp.json()) as any).data?.columns ?? []) as any[]
    const names = columns.map((c) => c.columnName)
    expect(names, 'GLOBAL 策略建出的表不该有 tenant_id').not.toContain('tenant_id')
    const statusCol = columns.find((c) => c.columnName === 'order_status')
    expect(statusCol?.dictType, '字典类型应当存得住').toBe('order_status')

    // 清理
    await request.delete(
      `http://127.0.0.1:48080/admin-api/infra/data-model/delete?id=${created.id}&dropTable=true&riskConfirmed=true`,
      { headers }
    )
  })
})
