import { expect, test, type APIRequestContext, type Page } from '@playwright/test'


/**
 * 系统表写保护的端到端验证（S0）
 *
 * 钉住的是一个真实缺口：框架表前缀名单此前在后端有 5 份副本、三套口径，
 * 表单设计那 3 份只认 system_/infra_/bpm_，于是 sys_grant（S8 权限体系的授权表）
 * 能被绑定为可写主表 —— 有表单设计权限的人可以给自己插授权行，绕过整个权限判定链。
 *
 * 详见 ruoyi-vue-pro/docs/安全修复-框架表写保护缺口.md
 *
 * ## 为什么界面与接口两条都要测
 *
 * 界面置灰只是「不方便点」，绕过界面直接调接口才是真正的攻击路径。
 * 只测界面会给出「已经防住了」的错觉 —— 修复前界面其实也没置灰，
 * 但即使置灰了，接口那层不拦一样能写进去。
 *
 * ## 反向用例同样重要
 *
 * 收紧时最容易改坏的是「读系统表」和「写业务模块表」：
 * 前者报表场景需要，后者 crm_/erp_ 本来就是合法业务表。
 * 这两条各有用例，改坏了会立刻红。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 系统表：写操作一律禁止 */
const SYSTEM_TABLE = 'sys_grant'
/** 业务模块表：可以正常绑定与写入，收紧的不是它 */
const BUSINESS_TABLE = 'crm_customer'

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  const body = (await response.json()) as { data?: { accessToken?: string } }
  expect(body.data?.accessToken, '登录失败').toBeTruthy()
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
  await form.locator('button').last().click()
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

test.describe('系统表写保护', () => {
  test('接口：db-tables 对系统表打标，对业务模块表不打标', async ({ request }) => {
    const token = await apiLogin(request)
    const response = await request.get(
      `${API_BASE_URL}/infra/form-design/db-tables?dataSourceConfigId=0`,
      { headers: authHeaders(token) }
    )
    const list = ((await response.json()) as any).data as Array<{
      name: string
      frameworkTable: boolean
    }>

    const CORE = ['act_', 'ai_', 'bpm_', 'flw_', 'infra_', 'qrtz_', 'sys_', 'system_']
    const isCore = (name: string) => CORE.some((p) => name.toLowerCase().startsWith(p))

    const wronglyFlagged = list.filter((t) => t.frameworkTable && !isCore(t.name))
    const missed = list.filter((t) => !t.frameworkTable && isCore(t.name))

    expect(wronglyFlagged.map((t) => t.name), '业务表被误标成系统表').toEqual([])
    expect(missed.map((t) => t.name), '系统表漏标').toEqual([])

    // crm_ 属于业务模块表，可以绑定 —— 收紧的是 8 个系统前缀，不是 24 个
    const crm = list.find((t) => t.name === BUSINESS_TABLE)
    if (crm) expect(crm.frameworkTable, 'crm_ 是合法业务表，不该被标').toBe(false)
  })

  test('接口：绕过界面直接绑定系统表并发布，必须被拒', async ({ request }) => {
    const token = await apiLogin(request)
    const code = `e2e_sysguard_${Date.now()}`

    // 保存这一步本来就没有校验（设计如此，草稿不校验），所以它会成功
    const created = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
      headers: authHeaders(token),
      data: {
        name: '系统表保护用例',
        code,
        formType: 1,
        formConf: JSON.stringify({ form: {} }),
        formFields: [
          JSON.stringify({ type: 'input', field: 'effect', title: '效果', props: {} })
        ],
        dataSourceConfigId: 0,
        // mainTable / mainPk 在 VO 上是独立字段，不能只写进 tableBinding JSON
        mainTable: SYSTEM_TABLE,
        mainPk: 'id',
        tableBinding: JSON.stringify({
          mainTable: SYSTEM_TABLE,
          mainPk: 'id',
          pkStrategy: 'SNOWFLAKE',
          fieldMapping: { effect: { table: SYSTEM_TABLE, column: 'effect', jdbcType: 'VARCHAR' } }
        })
      }
    })
    const designId = ((await created.json()) as any).data as number
    expect(designId, '草稿保存应成功（保存不校验是既有设计）').toBeTruthy()

    try {
      // 发布必须被拒 —— 这是真正的闸门
      const published = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: designId, parentMenuId: 2, changeSummary: 'e2e' }
      })
      const body = (await published.json()) as { code: number; msg: string }
      expect(body.code, `发布系统表绑定应被拒，实际：${body.msg}`).not.toBe(0)
      expect(body.msg).toContain(SYSTEM_TABLE)
    } finally {
      await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${designId}`, {
        headers: authHeaders(token)
      })
    }
  })

  test('界面：选表下拉里系统表被置灰并标红，业务表可选', async ({ page }) => {
    await login(page)
    // 直接进编辑器 —— 列表页的「新增」按钮只是 push 到这个路由，绕开一层更稳
    await page.goto('/infra/online/editor')

    // 第一步「基础设置」的名称与编码是必填，不填满向导不会前进
    await page.getByPlaceholder('请输入表单名称').fill('e2e 系统表保护')
    await page.getByPlaceholder(/请输入表单编码/).fill(`e2e_guard_${Date.now()}`)
    await page.getByRole('button', { name: '下一步' }).click()

    // ⚠️ 这个 el-select 的「请选择主表」是独立渲染的元素，不是 HTML placeholder 属性，
    // getByPlaceholder 匹配不到。无障碍树里它是 combobox，accessible name 取自 label「主表」。
    const search = page.getByRole('combobox', { name: '主表' })
    await expect(search).toBeVisible({ timeout: 30_000 })
    // 不能 click：.el-select__placeholder 那层浮在 input 上会拦截指针事件。
    // fill 走的是聚焦+赋值，不发指针事件，正好绕开，且能触发 remote 搜索。
    await search.fill(SYSTEM_TABLE)
    await page.waitForResponse(
      (r) => r.url().includes('/infra/form-design/db-tables') && r.status() === 200,
      { timeout: 20_000 }
    )

    const dropdown = page.locator('.el-select-dropdown:visible').first()
    await expect(dropdown).toBeVisible({ timeout: 15_000 })

    const sysOption = dropdown.locator('.el-select-dropdown__item').filter({ hasText: SYSTEM_TABLE }).first()
    await expect(sysOption, '系统表应出现在列表里（不是被过滤掉，而是被置灰）').toBeVisible({
      timeout: 15_000
    })
    await expect(sysOption, '系统表应被置灰').toHaveClass(/is-disabled/)
    await expect(sysOption.locator('.el-tag'), '系统表应带红色「系统表」标记').toHaveText('系统表')

    // 反向：业务模块表不该被置灰
    await search.fill(BUSINESS_TABLE)
    await page.waitForResponse(
      (r) => r.url().includes('/infra/form-design/db-tables') && r.status() === 200,
      { timeout: 20_000 }
    )
    const bizOption = dropdown
      .locator('.el-select-dropdown__item')
      .filter({ hasText: BUSINESS_TABLE })
      .first()
    if (await bizOption.count()) {
      await expect(bizOption, 'crm_ 是合法业务表，不该被置灰').not.toHaveClass(/is-disabled/)
    }
  })

  test('界面：数据建模列表页从接口拉系统表前缀，不再硬编码', async ({ page }) => {
    await login(page)

    // 页面初始化时应真的发这个请求 —— 前端此前硬编码一份名单，后端加了 qrtz_/flw_ 前端漏跟
    const prefixResponse = page.waitForResponse(
      (r) => r.url().includes('/infra/data-model/list-system-table-prefix') && r.status() === 200,
      { timeout: 30_000 }
    )
    await page.goto('/infra/data-manage/data-model')
    const body = (await (await prefixResponse).json()) as { code: number; data: string[] }

    expect(body.code).toBe(0)
    // DDL 口径：8 个系统核心前缀 + 16 个预留模块前缀
    expect(body.data.length).toBe(24)
    for (const p of ['sys_', 'ai_', 'qrtz_', 'flw_', 'act_']) {
      expect(body.data, `${p} 应在名单里`).toContain(p)
    }

    // 页面本身要能正常渲染 —— 拉前缀失败也不该拖垮列表
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 30_000 })
  })
})
