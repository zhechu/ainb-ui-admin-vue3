import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { buildXlsx } from './helpers/xlsx'

/**
 * 用户管理的导入导出的端到端验证
 *
 * 验的是这两件事在**浏览器里真的能用**。这一层不能省：导入导出最常见的缺陷形态是
 * 「看起来成功了其实不完整」—— 接口返回 200、界面弹一句「导入成功」，
 * 而实际上有几行被静默丢掉了。单测拦不住它，因为单测里没有那个「用户看到了什么」。
 *
 * 这里盯住的是四件接口层看不见的事：
 *
 * <ul>
 *   <li>导出是弹窗而不是下拉，且上限**常驻**写在弹窗里（不是只在超限时才提）</li>
 *   <li>导入是三步向导，中间那一步真的把逐行判定摆给用户看了</li>
 *   <li>四种行状态（将新增 / 库中已存在 / 文件内重复 / 校验未通过）都标出来了，
 *       且错误原因带着列字母与原文</li>
 *   <li>导完之后列表真的刷新了 —— 用户最容易怀疑的就是这一条</li>
 * </ul>
 *
 * ## ⚠️ 本用例会写数据
 *
 * 导入这件事本身就是写。用例每次用带随机后缀的登录名造数据，跑完用接口删掉。
 * 登录名不能固定：固定的话第二次跑时「将新增」那一行会变成「库中已存在」，
 * 断言全部错位，而那种失败看起来像功能坏了。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 这一批用例造的登录名前缀。清理时按它找 */
const USERNAME_PREFIX = `e2eimp${Date.now().toString().slice(-8)}`

/** 一个必然不存在的部门编号，用来造「校验未通过」的那一行 */
const MISSING_DEPT_ID = '99999999'

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

async function openUserList(page: Page) {
  await page.goto('/system/user')
  await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
}

/** 用接口删掉本次造的用户 */
async function cleanup(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID }
  const response = await request.get(
    `${API_BASE_URL}/system/user/page?pageNo=1&pageSize=100&username=${USERNAME_PREFIX}`,
    { headers }
  )
  if (!response.ok()) return
  const body = (await response.json()) as { data?: { list?: Array<{ id: number }> } }
  for (const row of body.data?.list ?? []) {
    await request.delete(`${API_BASE_URL}/system/user/delete?id=${row.id}`, { headers })
  }
}

test.describe('用户管理 · 导入导出', () => {
  let token = ''

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)
  })

  test.afterAll(async ({ request }) => {
    await cleanup(request, token)
  })

  // ==================== 导出 ====================

  async function openExportDialog(page: Page) {
    await page.getByRole('button', { name: /导出/ }).first().click()
    const dialog = page.getByRole('dialog').filter({ hasText: '导出用户' })
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    return dialog
  }

  test('导出是弹窗，范围可选，且上限常驻显示', async ({ page }) => {
    await login(page)
    await openUserList(page)
    const dialog = await openExportDialog(page)

    // 两种范围
    await expect(dialog.getByText('当前页')).toBeVisible()
    await expect(dialog.getByText('全部', { exact: false }).first()).toBeVisible()

    // ⚠️ 这条是本次改造的重点：上限要在【点导出之前】就看得见。
    // 改造前它藏在下拉菜单的一句小字里，既不知道用户这次查了多少条，
    // 也不会在超限时变色
    await expect(dialog.getByText('导出上限')).toBeVisible()
    await expect(dialog.getByText(/一次最多导出\s*\d+\s*条/)).toBeVisible()

    // 库里的用户远没到 2 万，所以【不该】出现超限警告 ——
    // 否则上面那条断言就退化成「警告里正好也有这几个字」
    await expect(dialog.locator('.el-alert')).toHaveCount(0)

    // 导出的原则是照列表来，不该出现任何选列、选格式之类的选项
    await expect(dialog.getByText(/选择字段|导出字段|值模式/)).toHaveCount(0)
  })

  test('点导出真的下到一份 xlsx', async ({ page }) => {
    await login(page)
    await openUserList(page)
    const dialog = await openExportDialog(page)

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    await dialog.getByRole('button', { name: '导 出' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toContain('用户数据')

    // ⚠️ 判据是头两个字节（xlsx 是 zip，必然以 PK 开头），不看扩展名 ——
    // 后端出错时也可能回一段 JSON，而浏览器照样把它存成 .xlsx
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).subarray(0, 2).toString('latin1'), '导出的必须是真 xlsx').toBe(
      'PK'
    )
  })

  test('选「当前页」时文件名带上页码 —— 两个文件混在下载目录里要分得出谁是谁', async ({
    page
  }) => {
    await login(page)
    await openUserList(page)
    const dialog = await openExportDialog(page)

    await dialog.getByText('当前页').click()
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    await dialog.getByRole('button', { name: '导 出' }).click()
    expect((await downloadPromise).suggestedFilename()).toContain('第1页')
  })

  // ==================== 导入 ====================

  async function openImportDialog(page: Page) {
    await page.getByRole('button', { name: /导入/ }).first().click()
    const dialog = page.getByRole('dialog').filter({ hasText: '导入用户' })
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    return dialog
  }

  /**
   * 造一份四行的导入文件，四行刚好覆盖四种状态
   *
   * 多出来的「内部备注」列是故意的：它该被识别为「未识别的列」并明确告诉用户
   * 这一列会被忽略，而不是静默丢掉
   */
  function buildImportFile(seq: string) {
    return buildXlsx([
      ['登录名称', '用户名称', '部门编号', '用户性别', '内部备注'],
      [`${USERNAME_PREFIX}a${seq}`, 'E2E 导入甲', '', '男', '随便写的'],
      ['admin', '管理员', '', '', ''],
      [`${USERNAME_PREFIX}a${seq}`, 'E2E 重复行', '', '', ''],
      [`${USERNAME_PREFIX}b${seq}`, 'E2E 部门不对', MISSING_DEPT_ID, '', '']
    ])
  }

  async function uploadAndPreview(page: Page, dialog: ReturnType<Page['locator']>, seq: string) {
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'e2e-users.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: buildImportFile(seq)
    })
    const previewPromise = page.waitForResponse(
      (r) => r.url().includes('/system/user/import-preview') && r.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: '下一步' }).click()
    expect((await previewPromise).ok(), '预检接口失败').toBeTruthy()
    await expect(dialog.getByText('表头匹配结果')).toBeVisible({ timeout: 30_000 })
  }

  test('导入第一步就把行数与大小上限说清楚', async ({ page }) => {
    await login(page)
    await openUserList(page)
    const dialog = await openImportDialog(page)

    await expect(dialog.getByText('上传文件')).toBeVisible()
    await expect(dialog.getByText(/最多\s*\d+\s*行/)).toBeVisible()
    await expect(dialog.getByText(/\d+MB/)).toBeVisible()
    // 按列名匹配这件事要写出来：用户最常问的就是「列的顺序能不能换」
    await expect(dialog.getByText(/按列名匹配/)).toBeVisible()
  })

  test('预检把表头映射与四种行状态都摆出来，没识别的列也不静默丢掉', async ({ page }) => {
    await login(page)
    await openUserList(page)
    const dialog = await openImportDialog(page)
    await uploadAndPreview(page, dialog, '1')

    // 表头映射：识别了 4 列，剩下那一列要明说被忽略
    await expect(dialog.getByText('4 列已识别')).toBeVisible()
    await expect(dialog.getByText('1 列未识别')).toBeVisible()
    await expect(dialog.getByText(/E 列「内部备注」/)).toBeVisible()

    // 四种状态各一行
    await expect(dialog.getByText('将新增').first()).toBeVisible()
    await expect(dialog.getByText('库中已存在').first()).toBeVisible()
    await expect(dialog.getByText('文件内重复').first()).toBeVisible()
    await expect(dialog.getByText('校验未通过').first()).toBeVisible()

    // ⚠️ 错误必须带上【哪一列】与【原文】，用户才知道回 Excel 改哪一格
    await expect(dialog.getByText('部门不存在')).toBeVisible()
    await expect(dialog.getByText(`（原文：${MISSING_DEPT_ID}）`)).toBeVisible()
    await expect(dialog.getByText('C 列').first()).toBeVisible()

    // 有「库中已存在」的行时才问怎么处理 —— 而且是在看到有几条之后才问，
    // 不是改造前那样在上传前盲勾一个复选框
    await expect(dialog.getByText(/库中已存在的\s*1\s*条怎么处理/)).toBeVisible()
  })

  test('确认导入之后：计数分开报，失败明细带行号，列表跟着刷新', async ({ page }) => {
    await login(page)
    await openUserList(page)
    const dialog = await openImportDialog(page)
    await uploadAndPreview(page, dialog, '2')

    const executePromise = page.waitForResponse(
      (r) => r.url().includes('/system/user/import-execute') && r.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: '确认导入' }).click()
    expect((await executePromise).ok(), '执行接口失败').toBeTruthy()

    // 新增 1（甲）、更新 0、跳过 1（admin，策略默认是跳过）、失败 2（重复行 + 部门不对）
    await expect(dialog.getByText(/新增\s*1\s*条/)).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByText(/跳过\s*1\s*条/)).toBeVisible()
    await expect(dialog.getByText(/失败\s*2\s*条/)).toBeVisible()

    // ⚠️ 失败明细要带行号。改造前只给一串用户名，用户还得回 Excel 里挨个搜
    await expect(dialog.getByRole('cell', { name: '4', exact: true })).toBeVisible()
    await expect(dialog.getByRole('cell', { name: '5', exact: true })).toBeVisible()

    // 点完成之后列表要刷新 —— 导进去了但列表还是老样子，用户会以为没成功
    const listPromise = page.waitForResponse(
      (r) => r.url().includes('/system/user/page') && r.request().method() === 'GET'
    )
    await dialog.getByRole('button', { name: '完 成' }).click()
    expect((await listPromise).ok()).toBeTruthy()

    await page.getByPlaceholder('请输入用户名称').fill(`${USERNAME_PREFIX}a2`)
    await page.getByRole('button', { name: /搜索/ }).click()
    await expect(page.getByRole('cell', { name: `${USERNAME_PREFIX}a2` })).toBeVisible({
      timeout: 30_000
    })
  })

  test('「全对才导」勾上时，还剩不合格的行就一条都不写', async ({ page }) => {
    await login(page)
    await openUserList(page)
    const dialog = await openImportDialog(page)
    await uploadAndPreview(page, dialog, '3')

    await dialog.locator('.el-checkbox', { hasText: '全对才导' }).click()
    const executePromise = page.waitForResponse((r) =>
      r.url().includes('/system/user/import-execute')
    )
    await dialog.getByRole('button', { name: '确认导入' }).click()
    expect((await executePromise).ok()).toBeTruthy()

    await expect(dialog.getByText('整批都没有导入').first()).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByText(/新增\s*0\s*条/)).toBeVisible()
  })

  test('剔掉有问题的行之后，「全对才导」就能过 —— 判据是剔除【之后】还剩多少', async ({
    page
  }) => {
    await login(page)
    await openUserList(page)
    const dialog = await openImportDialog(page)
    await uploadAndPreview(page, dialog, '4')

    // 把两行有问题的剔掉。
    // ⚠️ 按【状态文案】定位而不是按行号：行号那一列的内容是个裸数字，
    // 表里别处（错误消息里的「第 2 行」之类）也会有数字，按它定位既脆又不好读
    for (const status of ['文件内重复', '校验未通过']) {
      await dialog
        .locator('tr', { hasText: status })
        .getByRole('button', { name: '删除' })
        .click()
    }
    await dialog.locator('.el-checkbox', { hasText: '全对才导' }).click()

    const executePromise = page.waitForResponse((r) =>
      r.url().includes('/system/user/import-execute')
    )
    await dialog.getByRole('button', { name: '确认导入' }).click()
    expect((await executePromise).ok()).toBeTruthy()

    await expect(dialog.getByText('整批都没有导入')).toHaveCount(0)
    await expect(dialog.getByText(/新增\s*1\s*条/)).toBeVisible({ timeout: 30_000 })  })
})
