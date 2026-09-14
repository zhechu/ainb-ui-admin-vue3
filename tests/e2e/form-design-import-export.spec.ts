import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

/**
 * 导入导出示例（IE01–IE03）的端到端验证
 *
 * 验的是这套导入导出在**浏览器里真的能用**。这一层不能省：本模块最常见的缺陷形态是
 * 「配了、保存成功了、但没生效，且没有任何提示」—— 单测全绿、发布成功、
 * 接口冒烟通过，三者都拦不住它。
 *
 * 接口层的断言（字典反查、公式重算、重复策略、幂等）已经由
 * `script/form-demo/smoke_ie.py` 覆盖了 43 条，这里**不重复**。
 * 这里只验界面上那几件接口层看不见的事：
 *
 * <ul>
 *   <li>按钮真的出现在工具栏上，点了真的开弹窗</li>
 *   <li>表头匹配结果真的展示给用户看了（参考产品完全没有这一步）</li>
 *   <li>坏值行真的标红了，错误原因真的写在界面上</li>
 *   <li>导入完之后列表真的刷新了 —— 用户最容易怀疑的就是这一条</li>
 *   <li>模板真的下得下来</li>
 * </ul>
 *
 * ## 前置条件
 *
 * 示例已由 `script/form-demo/demo_ie_forms.py` 建好并发布，
 * 样例文件由 `demo_ie_data.py` 生成在 `script/form-demo/samples/` 下。
 *
 * ## ⚠️ 本用例会写数据
 *
 * 与表格示例那批（只读）不同：导入这件事本身就是写。用例用自己的编码前缀
 * （E2EIE）造数据，跑完清掉 —— 不碰 demo_ie_data.py 灌的那 80 条，
 * 否则其它用例的统计数会跟着变。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 样例文件目录。与 demo_ie_data.py 的产出位置一致 */
const SAMPLES_DIR = path.resolve(
  __dirname,
  '../../../ruoyi-vue-pro/script/form-demo/samples'
)

const CODE_BASIC = 'test_demo_ie_basic'
const CODE_DETAIL = 'test_demo_ie_detail'

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

/**
 * 打开示例的运行时页
 *
 * 走静态预览路由，不走发布生成的菜单路由 —— 新菜单要分配给角色、再重新登录
 * 才会注册动态路由，在用例里改角色菜单分配的风险远大于收益。
 */
async function openRuntime(page: Page, code: string) {
  await page.goto(`/infra-form-design/preview?code=${code}`)
  await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
}

/** 打开导入向导 */
async function openImportDialog(page: Page) {
  await page.getByRole('button', { name: /导入/ }).first().click()
  const dialog = page.getByRole('dialog').filter({ hasText: '导入数据' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  return dialog
}

/** 选一份样例文件并走到「检查数据」那一步 */
async function uploadAndPreview(page: Page, dialog: ReturnType<Page['locator']>, file: string) {
  await dialog.locator('input[type="file"]').setInputFiles(path.join(SAMPLES_DIR, file))
  const previewPromise = page.waitForResponse(
    (r) => r.url().includes('/import/preview') && r.request().method() === 'POST'
  )
  await dialog.getByRole('button', { name: '下一步' }).click()
  const response = await previewPromise
  expect(response.ok(), '预览接口失败').toBeTruthy()
  await expect(dialog.getByText('表头匹配结果')).toBeVisible({ timeout: 30_000 })
}

/** 用接口清掉本用例造的数据 —— 不碰示例自带的 80 条 */
async function cleanup(request: APIRequestContext, token: string, prefix: string) {
  const headers = { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID }
  for (const code of [CODE_BASIC, CODE_DETAIL]) {
    const listResp = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${code}/page`,
      {
        headers,
        data: {
          pageNo: 1,
          pageSize: 100,
          conditions: [{ field: 'supplier_code', operator: 'LIKE', value: prefix }]
        }
      }
    )
    const body = (await listResp.json()) as { data?: { list?: Array<{ id: string }> } }
    for (const row of body.data?.list ?? []) {
      await request.delete(
        `${API_BASE_URL}/infra/form-design/runtime/${code}/delete?id=${row.id}`,
        { headers }
      )
    }
  }
}

test.describe('导入导出示例', () => {
  let token = ''

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)

    // 用例文件由 script/form-demo/demo_ie_data.py 产出。
    //
    // ⚠️ 刻意不在这里用 Node 现写 xlsx：那意味着项目里有两个 xlsx 写入器，
    //    改一处忘另一处时，e2e 会对着一份与冒烟脚本格式不同的文件做断言。
    //    缺文件时直接失败并说清怎么补 —— 比跑出一堆看不懂的报错强
    for (const file of ['e2e-ie-ok.xlsx', 'e2e-ie-bad.xlsx']) {
      expect(
        fs.existsSync(path.join(SAMPLES_DIR, file)),
        `缺少样例文件 ${file}，请先跑 script/form-demo/demo_ie_data.py`
      ).toBeTruthy()
    }
  })

  test.beforeEach(async ({ request }) => {
    await cleanup(request, token, 'E2EIE')
  })

  test.afterAll(async ({ request }) => {
    await cleanup(request, token, 'E2EIE')
  })

  test('工具栏上有导入按钮，点了开向导', async ({ page }) => {
    await login(page)
    await openRuntime(page, CODE_BASIC)

    const importButton = page.getByRole('button', { name: /导入/ }).first()
    await expect(importButton, '工具栏上应当有导入按钮').toBeVisible()

    const dialog = await openImportDialog(page)
    await expect(dialog.getByText('上传文件')).toBeVisible()
    await expect(dialog.getByText('检查数据')).toBeVisible()
    await expect(dialog.getByText('导入结果')).toBeVisible()
    // 提示里要说清「顺序可以打乱」—— 这是与参考产品最大的差别，得让用户知道
    await expect(dialog.getByText(/按列名匹配/)).toBeVisible()
  })

  test('模板下得下来，且是真的 xlsx', async ({ page }) => {
    await login(page)
    await openRuntime(page, CODE_BASIC)
    const dialog = await openImportDialog(page)

    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: '下载导入模板' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/)

    const filePath = await download.path()
    expect(filePath, '模板没有落盘').toBeTruthy()
    const head = fs.readFileSync(filePath!).subarray(0, 2)
    expect(head.toString('latin1'), 'xlsx 必须以 PK 开头').toBe('PK')
  })

  test('表头匹配结果展示给用户看了', async ({ page }) => {
    await login(page)
    await openRuntime(page, CODE_BASIC)
    const dialog = await openImportDialog(page)
    await uploadAndPreview(page, dialog, 'e2e-ie-ok.xlsx')

    // 9 列全部识别
    await expect(dialog.getByText('9 列已识别')).toBeVisible()
    // 逐列的对应关系要列出来，而不是只给一个数字
    await expect(dialog.getByRole('cell', { name: '供应商编码', exact: true }).first()).toBeVisible()
    // 统计条。⚠️ 用 .ie-summary-label 限定 —— 「将新增」同时是每一行的状态标签，
    // 不限定会撞上三个元素（这本身正说明逐行状态也渲染出来了）
    await expect(dialog.locator('.ie-summary-label', { hasText: '将新增' })).toBeVisible()
    // 两条数据都判成了新增
    await expect(
      dialog.locator('.el-tag__content', { hasText: '将新增' })
    ).toHaveCount(2)
  })

  test('坏值行标红，错误原因写在界面上', async ({ page }) => {
    await login(page)
    await openRuntime(page, CODE_BASIC)
    const dialog = await openImportDialog(page)
    await uploadAndPreview(page, dialog, 'e2e-ie-bad.xlsx')

    // 预览表里要有一行是标红的
    await expect(dialog.locator('.ie-row-bad').first()).toBeVisible()
    // 错误原因要能看见，且带列字母 —— 用户是拿它去 Excel 里定位的
    await expect(dialog.getByText(/必须是数字/)).toBeVisible()
    await expect(dialog.getByText(/G 列/)).toBeVisible()
  })

  test('导入成功后列表真的刷新了', async ({ page }) => {
    await login(page)
    await openRuntime(page, CODE_BASIC)

    // 先用查询把列表缩到本用例的范围，免得被那 80 条演示数据淹掉
    const dialog = await openImportDialog(page)
    await uploadAndPreview(page, dialog, 'e2e-ie-ok.xlsx')

    const executePromise = page.waitForResponse(
      (r) => r.url().includes('/import/execute') && r.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: '确认导入' }).click()
    expect((await executePromise).ok()).toBeTruthy()

    // 结果页
    await expect(dialog.getByText('全部导入成功')).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByText(/新增 2 条/)).toBeVisible()

    // 关掉弹窗，列表要刷新 —— 用户最容易怀疑的就是这一条
    const reloadPromise = page.waitForResponse(
      (r) => r.url().includes(`/runtime/${CODE_BASIC}/page`) && r.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: '完成' }).click()
    expect((await reloadPromise).ok(), '导入完成后应当重新拉列表').toBeTruthy()

    // 查一下新导的数据真的在列表里
    await page.getByPlaceholder(/供应商编码/).first().fill('E2EIE001')
    await page.getByRole('button', { name: /搜索|查询/ }).first().click()
    await expect(page.getByRole('cell', { name: 'E2EIE001' })).toBeVisible({ timeout: 30_000 })
  })

  test('同一份预览不能导入两次', async ({ page }) => {
    await login(page)
    await openRuntime(page, CODE_BASIC)
    const dialog = await openImportDialog(page)
    await uploadAndPreview(page, dialog, 'e2e-ie-ok.xlsx')

    await dialog.getByRole('button', { name: '确认导入' }).click()
    await expect(dialog.getByText('全部导入成功')).toBeVisible({ timeout: 30_000 })

    // 界面上已经没有「确认导入」了（走到了第三步），这一条由接口层冒烟覆盖。
    // 这里验的是界面确实不给第二次机会
    await expect(dialog.getByRole('button', { name: '确认导入' })).toBeHidden()
  })

  test('导出按钮点了真的下文件', async ({ page }) => {
    await login(page)
    await openRuntime(page, CODE_BASIC)

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: /导出/ }).first().click()
    // 导出前有一个确认框
    const confirm = page.getByRole('button', { name: /确定|确 定/ }).last()
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click()
    }
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/)

    const filePath = await download.path()
    const head = fs.readFileSync(filePath!).subarray(0, 2)
    expect(head.toString('latin1'), '导出的必须是真 xlsx').toBe('PK')
  })

  test('主子表示例：明细列出现在表头匹配结果里', async ({ page }) => {
    await login(page)
    await openRuntime(page, CODE_DETAIL)
    const dialog = await openImportDialog(page)
    await dialog
      .locator('input[type="file"]')
      .setInputFiles(path.join(SAMPLES_DIR, 'import-detail-sorted.xlsx'))
    const previewPromise = page.waitForResponse(
      (r) => r.url().includes('/import/preview') && r.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: '下一步' }).click()
    expect((await previewPromise).ok()).toBeTruthy()

    await expect(dialog.getByText('表头匹配结果')).toBeVisible({ timeout: 30_000 })
    // 明细列要标出它属于哪张子表 —— 否则用户分不清「电话」是主表的还是明细的
    await expect(dialog.getByText('联系人明细').first()).toBeVisible()
  })
})
