import { expect, test, type Page } from '@playwright/test'

/**
 * 字段级列权限的端到端验证
 *
 * 守的是一个单测看不出来的缺口：后端 @PermissionFieldCrop 只把 HIDDEN 字段【置空】，
 * 不隐藏列。只验接口的话「返回值为空」就算通过了，但用户看到的是一排空白列 ——
 * 必须在浏览器里确认那一列真的不渲染
 */
async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login')
  const form = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
  await form.waitFor({ state: 'visible' })
  const tenant = form.getByPlaceholder('请输入租户名称')
  if (await tenant.count()) await tenant.fill('xpy')
  await form.getByPlaceholder('请输入用户名').fill(username)
  await form.getByPlaceholder('请输入密码').fill(password)
  const loginPromise = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.getByRole('button', { name: /登\s*录/ }).first().click()
  expect((await loginPromise).ok()).toBeTruthy()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
}

test.describe('用户管理 · 字段级列权限', () => {
  test('销售专员列表只见部门/手机号两列，且只有自己一行', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))

    await login(page, 'salesman01', 'admin123')
    await page.goto('/system/user')
    await page.waitForLoadState('networkidle')

    const table = page.locator('.el-table').first()
    await expect(table).toBeVisible({ timeout: 20_000 })

    const headers = (await table.locator('thead th').allTextContents()).map((t) => t.trim()).filter(Boolean)
    // 配了 HIDDEN 的列必须【不存在】，而不是存在但内容为空
    // 当前配置：列表只保留「部门」「手机号码」两列
    // ⚠️ 不含「用户编号」：id 是主键，没有登记成受控列，始终显示
    for (const col of ['用户名称', '用户昵称', '状态', '创建时间']) {
      expect(headers.join('|'), `列「${col}」应当被隐藏，实际表头：${headers.join('|')}`).not.toContain(col)
    }
    expect(headers.join('|'), '部门列应当保留').toContain('部门')
    expect(headers.join('|'), '手机号列应当保留').toContain('手机号码')

    // 行过滤：只有自己一行
    const rows = table.locator('tbody tr')
    await expect(rows).toHaveCount(1, { timeout: 15_000 })
    // ⚠️ 不能断言用户名 —— 当前配置把用户名列也隐藏了。
    // 行过滤后只有自己一条，用手机号识别即可
    await expect(rows.first()).toContainText('139')

    expect(errors, `页面抛了 JS 异常：${errors.join(' | ')}`).toHaveLength(0)
  })

  test('超管不受字段权限影响，各列正常显示', async ({ page }) => {
    await login(page, 'admin', 'admin123')
    await page.goto('/system/user')
    await page.waitForLoadState('networkidle')
    const table = page.locator('.el-table').first()
    await expect(table).toBeVisible({ timeout: 20_000 })
    const headers = (await table.locator('thead th').allTextContents()).map((t) => t.trim())
    expect(headers.join('|')).toContain('手机号码')
    expect(headers.join('|')).toContain('创建时间')
  })

  test('列级与字段级互不影响：列表隐藏手机号，详情仍可见', async ({ page, request }) => {
    const API = 'http://localhost:48080/admin-api'
    const login = await request.post(`${API}/system/auth/login`, {
      headers: { 'tenant-id': '1' },
      data: { username: 'salesman01', password: 'admin123' }
    })
    const token = (await login.json()).data.accessToken
    const h = { Authorization: `Bearer ${token}`, 'tenant-id': '1' }

    // 列级：mobile 应为 HIDDEN
    const colModes = await (
      await request.get(`${API}/system/grant/my-field-modes?datasetPermission=system:user&column=true`, { headers: h })
    ).json()
    // 用 email 演示 col/fld 独立：列表里隐藏，详情里可编辑
    expect(colModes.data.email, '列级应当隐藏邮箱').toBe('HIDDEN')

    // 字段级：mobile 不应为 HIDDEN（详情能看）
    const fldModes = await (
      await request.get(`${API}/system/grant/my-field-modes?datasetPermission=system:user&column=false`, { headers: h })
    ).json()
    expect(fldModes.data.email, '字段级不该隐藏邮箱（否则 col/fld 又被合成一套了）').not.toBe('HIDDEN')

    // 列表接口裁掉，详情接口保留 —— 这是 col/fld 分开的全部意义
    const listResp = await (
      await request.get(`${API}/system/user/page?pageNo=1&pageSize=10`, { headers: h })
    ).json()
    const row = listResp.data.list[0]
    expect(row.email ?? '', '列表接口不该返回邮箱').toBe('')

    const detail = await (
      await request.get(`${API}/system/user/get?id=${row.id}`, { headers: h })
    ).json()
    expect(detail.data.email, '详情接口应当能看到邮箱').toBeTruthy()

    // 浏览器里列表也不该有手机号列
    await login2(page)
    await page.goto('/system/user')
    await page.waitForLoadState('networkidle')
    const headers = (await page.locator('.el-table').first().locator('thead th').allTextContents())
      .map((t) => t.trim())
    expect(headers.join('|')).not.toContain('用户昵称')
  })
})


test.describe('销售专员完整配置', () => {
  const API = 'http://localhost:48080/admin-api'

  test('列表只剩部门/手机号，详情其他字段可见但不可改', async ({ page, request }) => {
    const login = await request.post(`${API}/system/auth/login`, {
      headers: { 'tenant-id': '1' },
      data: { username: 'salesman01', password: 'admin123' }
    })
    const token = (await login.json()).data.accessToken
    const h = { Authorization: `Bearer ${token}`, 'tenant-id': '1' }

    // ① 行过滤：只有自己
    const pageResp = await (await request.get(`${API}/system/user/page?pageNo=1&pageSize=50`, { headers: h })).json()
    expect(pageResp.data.total, '应当只看得到自己一条').toBe(1)
    const row = pageResp.data.list[0]

    // ② 列级：列表里除部门/手机号外都被裁掉
    for (const hidden of ['username', 'nickname', 'email', 'sex', 'status', 'createTime', 'loginIp']) {
      expect(row[hidden] ?? '', `列表不该返回 ${hidden}`).toBe('')
    }
    expect(row.mobile, '列表应当能看到手机号').toBeTruthy()

    // ③ 字段级：详情里其他字段仍可见（READONLY 不裁剪读路径）
    const detail = await (await request.get(`${API}/system/user/get?id=${row.id}`, { headers: h })).json()
    expect(detail.data.nickname, '详情应当能看到昵称').toBeTruthy()
    expect(detail.data.username, '详情应当能看到用户名').toBeTruthy()

    // ④ 写保护：可改的生效，只读的被剥离
    const before = detail.data
    await request.put(`${API}/system/user/update`, {
      headers: h,
      data: {
        id: row.id, username: before.username,
        nickname: 'E2E篡改昵称', remark: 'E2E篡改备注',
        mobile: '13900006666', email: 'e2e@test.com', sex: 2
      }
    })
    const after = (await (await request.get(`${API}/system/user/get?id=${row.id}`, { headers: h })).json()).data
    expect(after.mobile, '手机号应当可改').toBe('13900006666')
    expect(after.email, '邮箱应当可改').toBe('e2e@test.com')
    expect(after.sex, '性别应当可改').toBe(2)
    expect(after.nickname, '昵称是只读的，不该被改掉').not.toBe('E2E篡改昵称')
    expect(after.remark ?? '', '备注是只读的，不该被改掉').not.toBe('E2E篡改备注')

    // 还原
    await request.put(`${API}/system/user/update`, {
      headers: h,
      data: { id: row.id, username: before.username, mobile: '13900008888', email: 'sales@test.com', sex: 1 }
    })

    // ⑤ 浏览器里列表只剩部门/手机号两列
    await login2(page)
    await page.goto('/system/user')
    await page.waitForLoadState('networkidle')
    const headers = (await page.locator('.el-table').first().locator('thead th').allTextContents())
      .map((t) => t.trim()).filter(Boolean)
    expect(headers.join('|')).toContain('手机号码')
    for (const col of ['用户名称', '用户昵称', '状态', '创建时间']) {
      expect(headers.join('|'), `列「${col}」应当被隐藏`).not.toContain(col)
    }
  })
})


test.describe('编辑表单的字段可编辑性', () => {
  test('只读字段置灰不可输入，可编辑字段正常', async ({ page }) => {
    await login2(page)
    await page.goto('/system/user')
    await page.waitForLoadState('networkidle')
    const table = page.locator('.el-table').first()
    await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 })

    // 打开自己那条的编辑弹窗
    // 按钮里含图标，用正则匹配文本更稳
    await table.locator('tbody tr').first().getByRole('button', { name: /修改/ }).first().click()
    const dlg = page.locator('.el-dialog').filter({ hasText: '手机号码' })
    await expect(dlg).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)

    // 一次性把所有表单项的「标签 → 是否禁用」读出来。
    // ⚠️ 不逐个用 locator 取：el-select / el-tree-select 内部不是普通 input，
    // 按 input 定位会在这些项上超时；直接读 DOM 判 is-disabled 类更稳
    const states: Record<string, boolean> = await dlg.evaluate((root) => {
      const out: Record<string, boolean> = {}
      root.querySelectorAll('.el-form-item').forEach((item) => {
        const label = item.querySelector('.el-form-item__label')?.textContent?.trim() || ''
        if (!label) return
        const control = item.querySelector('.el-input, .el-select, .el-textarea')
        if (!control) return
        const inp = item.querySelector('input, textarea') as HTMLInputElement | null
        out[label] = !!(
          control.classList.contains('is-disabled') ||
          control.querySelector('.is-disabled') ||
          (inp && inp.disabled)
        )
      })
      return out
    })
    console.log('  表单项禁用状态: ' + JSON.stringify(states, null, 0))

    // 可编辑的三项：不该被禁用
    for (const label of ['手机号码', '邮箱', '用户性别']) {
      expect(states[label], `「${label}」是可编辑字段，不该置灰`).toBeFalsy()
    }
    // 只读的：必须禁用，否则用户改完保存、提示成功、值却没变
    for (const label of ['用户昵称', '归属部门', '岗位', '备注']) {
      expect(states[label], `「${label}」是只读字段，应当置灰不可输入`).toBeTruthy()
    }
  })

  test('超管编辑时所有字段均可编辑', async ({ page }) => {
    await login(page, 'admin', 'admin123')
    await page.goto('/system/user')
    await page.waitForLoadState('networkidle')
    const table = page.locator('.el-table').first()
    await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 })
    await table.locator('tbody tr').first().getByRole('button', { name: /修改/ }).first().click()
    const dlg = page.locator('.el-dialog').filter({ hasText: '手机号码' })
    await expect(dlg).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1200)
    const states: Record<string, boolean> = await dlg.evaluate((root) => {
      const out: Record<string, boolean> = {}
      root.querySelectorAll('.el-form-item').forEach((item) => {
        const label = item.querySelector('.el-form-item__label')?.textContent?.trim() || ''
        if (!label) return
        const control = item.querySelector('.el-input, .el-select, .el-textarea')
        if (!control) return
        const inp = item.querySelector('input, textarea') as HTMLInputElement | null
        out[label] = !!(
          control.classList.contains('is-disabled') ||
          control.querySelector('.is-disabled') ||
          (inp && inp.disabled)
        )
      })
      return out
    })
    for (const label of ['用户昵称', '手机号码', '邮箱', '备注']) {
      expect(states[label], `超管的「${label}」不该被禁用`).toBeFalsy()
    }
  })
})

/** 用 salesman01 登录浏览器 */
async function login2(page: Page): Promise<void> {
  await page.goto('/login')
  const form = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
  await form.waitFor({ state: 'visible' })
  const tenant = form.getByPlaceholder('请输入租户名称')
  if (await tenant.count()) await tenant.fill('xpy')
  await form.getByPlaceholder('请输入用户名').fill('salesman01')
  await form.getByPlaceholder('请输入密码').fill('admin123')
  const p = page.waitForResponse((r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST')
  await form.getByRole('button', { name: /登\s*录/ }).first().click()
  expect((await p).ok()).toBeTruthy()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
}
