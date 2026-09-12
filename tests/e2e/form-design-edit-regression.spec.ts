import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 「编辑已有记录」的端到端回归
 *
 * <h3>守的是一次真实故障</h3>
 *
 * 控件总览示例发布之后，列表里点「编辑」改任何一条记录，保存都返回
 * 【500 系统异常】—— 而「新增」是好的，所以从界面上看像是「编辑坏了」。
 *
 * 根因在服务端的变更日志对比：该表有个 time 列（occur_time），
 * JDBC 读出来是 java.sql.Time。它继承自 java.util.Date，却既不是
 * java.sql.Date 也不是 java.sql.Timestamp，于是落进了兜底分支调用
 * toInstant() —— 而 JDK 里 java.sql.Time.toInstant() 是无条件抛
 * UnsupportedOperationException 的。
 *
 * 这段代码跑在事务里、位于真正的 UPDATE 之后，于是
 * 「表里带 time 列 + 开了变更日志」的表单一改就炸，新增却毫发无损。
 *
 * <h3>为什么必须是界面用例，不能只靠服务端单测</h3>
 *
 * 服务端单测能守住 differ 不抛异常，但守不住「用户在页面上改完点确定，
 * 这条改动真的落库了」。本模块反复踩过「接口全绿、用户却用不上」，
 * 所以这里从界面走完整条路：打开 → 改值 → 保存 → 重新读回核对。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 控件总览示例：字段最全，且带 time 列与变更日志，是这条路径最狠的样本 */
const GALLERY = 'test_demo_widget_gallery'

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  expect(response.ok(), '接口登录失败').toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  return body.data!.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

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
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
}

async function createRow(
  request: APIRequestContext,
  token: string,
  data: Record<string, any>
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/create`, {
    headers: authHeaders(token),
    data
  })
  const body = (await response.json()) as { code: number; msg: string; data: any }
  expect(body.code, `造数据失败：${body.msg}`).toBe(0)
  return String(body.data)
}

async function readRow(
  request: APIRequestContext,
  token: string,
  id: string
): Promise<Record<string, any>> {
  const response = await request.get(
    `${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/get?id=${id}`,
    { headers: authHeaders(token) }
  )
  const body = (await response.json()) as { code: number; msg: string; data: any }
  expect(body.code, `读取失败：${body.msg}`).toBe(0)
  return body.data
}

async function readChangeLogs(
  request: APIRequestContext,
  token: string,
  id: string
): Promise<Array<{ changes: string }>> {
  const response = await request.get(
    `${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/data-logs?id=${id}`,
    { headers: authHeaders(token) }
  )
  const body = (await response.json()) as { code: number; data: any }
  return body.code === 0 ? (body.data ?? []) : []
}

async function deleteRow(request: APIRequestContext, token: string, id?: string) {
  if (!id) return
  await request
    .delete(`${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/delete?id=${id}`, {
      headers: authHeaders(token)
    })
    .catch(() => undefined)
}

/** 造一条带 time 列的记录 —— occur_time 是这条路径的引爆点，不能省 */
const seedRow = (title: string) => ({
  title,
  description: '编辑回归用例造的数据',
  amount: 1200.5,
  rate_score: 4,
  enabled: 1,
  priority: '2',
  bill_status: 'DRAFT',
  occur_date: '2026-06-01',
  occur_time: '14:05:00'
})

/**
 * 表单容器：弹窗 / 抽屉 / 页内，三种都认
 *
 * ⚠️ 不要写死 .el-dialog。表单装在哪里由列表设计里的「表单呈现方式」决定，
 * 而那是一项配置 —— 示例表单的这项配置被改过之后，本文件三条用例
 * 会一起以「弹窗没出现」失败，而真正的原因与编辑功能毫无关系，
 * 排查时极易被带偏。用例要守的是「编辑能用」，不是「编辑用弹窗」。
 */
const formPanel = (page: Page) =>
  page.locator('.el-dialog:visible, .el-drawer:visible, .inline-panel').first()

/** 表单容器的确认按钮。页内模式的页脚不是 .el-dialog__footer */
const confirmButton = (panel: ReturnType<typeof formPanel>) =>
  // 用可访问名而不是正则匹配 textContent：按钮的 textContent 带着模板缩进
  // （"\n          确 定\n        "），锚定正则会匹配不上
  panel.getByRole('button', { name: '确 定' })

/**
 * 打开某条记录的编辑表单
 *
 * 按标题定位到行，而不是取第一行 —— 示例自带两条演示数据，
 * 取第一行会改到演示数据上。
 */
async function openEditForm(page: Page, title: string) {
  const row = page.locator('.el-table__body-wrapper tbody tr').filter({ hasText: title }).first()
  await expect(row, `列表里找不到「${title}」这一行`).toBeVisible({ timeout: 30_000 })
  await row.getByRole('button', { name: '编辑' }).click()
  const panel = formPanel(page)
  await expect(panel, '点了编辑但表单没出现').toBeVisible({ timeout: 20_000 })
  // 表单是异步渲染的，等第一个控件出来再操作
  await expect(panel.locator('.el-form-item').first()).toBeVisible({ timeout: 20_000 })
  return panel
}

test.describe('控件总览示例 · 编辑已有记录', () => {
  test('⚠️ 改一个字段并保存：不能 500，改动要真的落库', async ({ page, request }) => {
    const token = await apiLogin(request)
    const title = `E2E编辑回归-${Date.now()}`
    let id: string | undefined
    try {
      id = await createRow(request, token, seedRow(title))

      // 把服务端 500 直接暴露成断言失败，而不是等到后面「值没变」时才发现
      const failures: string[] = []
      page.on('response', async (res) => {
        if (!res.url().includes(`/runtime/${GALLERY}/update`)) return
        try {
          const body = await res.json()
          if (body?.code !== 0) failures.push(`update 返回 code=${body?.code} msg=${body?.msg}`)
        } catch {
          /* 非 JSON 响应跳过 */
        }
      })

      await login(page)
      await page.goto(`/infra-form-design/preview?code=${GALLERY}`)
      const panel = await openEditForm(page, title)

      // 改标题：文本框是最稳的落点，不依赖任何控件的内部结构
      const newTitle = `${title}-已改`
      const titleInput = panel.locator('input[type="text"]').first()
      await titleInput.fill(newTitle)

      const updatePromise = page.waitForResponse((r) =>
        r.url().includes(`/runtime/${GALLERY}/update`)
      )
      await confirmButton(panel).click()
      await updatePromise

      expect(failures, `保存报错了：${failures.join('；')}`).toEqual([])

      // 弹窗关掉 = 前端认为成功。失败时它会留在原地让用户重试
      await expect(panel, '保存后表单没关闭，说明提交没成功').toBeHidden({ timeout: 15_000 })

      // 真的落库了吗
      const saved = await readRow(request, token, id)
      expect(saved.title, '改动没落库').toBe(newTitle)
      // ⚠️ time 列必须原样还在。它是引爆点，被清空/改错同样算回归
      expect(String(saved.occur_time), 'time 列在保存后丢了或被改了').toContain('14:05')
    } finally {
      await deleteRow(request, token, id)
    }
  })

  test('⚠️ 变更日志记下真改动，且不记 time 列的假变更', async ({ page, request }) => {
    // 修复的另一半：java.sql.Time 与 LocalTime 要格式化成同一种形态。
    // 不一致的话，一个没被碰过的时间字段每次保存都会记一条
    // 「14:05:00 → 14:05」的假变更，真正的改动会被这类噪音淹没。
    const token = await apiLogin(request)
    const title = `E2E变更日志-${Date.now()}`
    let id: string | undefined
    try {
      id = await createRow(request, token, seedRow(title))

      await login(page)
      await page.goto(`/infra-form-design/preview?code=${GALLERY}`)
      const panel = await openEditForm(page, title)

      const newTitle = `${title}-改标题`
      await panel.locator('input[type="text"]').first().fill(newTitle)
      const updatePromise = page.waitForResponse((r) =>
        r.url().includes(`/runtime/${GALLERY}/update`)
      )
      await confirmButton(panel).click()
      await updatePromise
      await expect(panel).toBeHidden({ timeout: 15_000 })

      const logs = await readChangeLogs(request, token, id)
      expect(logs.length, '改了字段却没有变更日志').toBeGreaterThan(0)

      const changed = logs.flatMap((log) => {
        try {
          return JSON.parse(log.changes || '[]') as Array<{ field: string }>
        } catch {
          return []
        }
      })
      expect(changed.some((c) => c.field === 'title'), '标题的改动没被记下来').toBeTruthy()
      expect(
        changed.some((c) => c.field === 'occur_time'),
        `没碰过的 time 列被记成了变更：${JSON.stringify(changed)}`
      ).toBeFalsy()
    } finally {
      await deleteRow(request, token, id)
    }
  })

  test('页面录入：新增一条 → 列表里看得见 → 再编辑一次仍然正常', async ({ page, request }) => {
    // 走用户真实的那条路：不预先造数据，全部在界面上录。
    // 新增与编辑共用同一个表单渲染器，但提交走的是两个接口，
    // 只测其中一个都会漏掉另一半。
    const token = await apiLogin(request)
    const title = `E2E录入-${Date.now()}`
    let id: string | undefined
    try {
      await login(page)
      await page.goto(`/infra-form-design/preview?code=${GALLERY}`)
      await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

      // ---- 新增 ----
      await page.getByRole('button', { name: '新增' }).first().click()
      const addPanel = formPanel(page)
      await expect(addPanel.locator('.el-form-item').first()).toBeVisible({ timeout: 20_000 })
      await addPanel.locator('input[type="text"]').first().fill(title)

      const createPromise = page.waitForResponse((r) =>
        r.url().includes(`/runtime/${GALLERY}/create`)
      )
      await confirmButton(addPanel).click()
      const createRes = await createPromise
      const createBody = (await createRes.json()) as { code: number; msg: string; data: any }
      expect(createBody.code, `新增失败：${createBody.msg}`).toBe(0)
      id = String(createBody.data)
      await expect(addPanel, '新增后表单没关闭').toBeHidden({ timeout: 15_000 })

      // ---- 列表里看得见 ----
      await expect(page.locator('.el-table__body-wrapper tbody')).toContainText(title, {
        timeout: 20_000
      })

      // ---- 再编辑一次 ----
      const editPanel = await openEditForm(page, title)
      const editedTitle = `${title}-二次编辑`
      await editPanel.locator('input[type="text"]').first().fill(editedTitle)
      const updatePromise = page.waitForResponse((r) =>
        r.url().includes(`/runtime/${GALLERY}/update`)
      )
      await confirmButton(editPanel).click()
      const updateRes = await updatePromise
      const updateBody = (await updateRes.json()) as { code: number; msg: string }
      expect(updateBody.code, `编辑失败：${updateBody.msg}`).toBe(0)
      await expect(editPanel).toBeHidden({ timeout: 15_000 })

      const saved = await readRow(request, token, id)
      expect(saved.title).toBe(editedTitle)
    } finally {
      await deleteRow(request, token, id)
    }
  })
})
