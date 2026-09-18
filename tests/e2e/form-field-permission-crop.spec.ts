import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { readXlsxText } from './helpers/xlsx'

/**
 * 字段级权限裁剪（S4b-2）的端到端验证
 *
 * ## 为什么这条用例必须走浏览器
 *
 * 这个子系统最典型的缺陷形态是「配了、保存成功了、但没生效，且没有任何提示」
 * （见 CLAUDE.md）。字段裁剪尤其符合这个形状：
 * 接口返回 200、配置读得到、单测也绿，唯一能说明它真的生效的证据是
 * **界面上那一列真的没了、那个框真的灰了**。
 *
 * 本阶段自己就栽过一次：夹具授权漏了 `tenant_id`，三条授权确确实实写进了
 * `sys_grant`，接口却当没配过一样全部放行 —— 库里查得到、日志没报错、
 * 断言的是接口 200 的话一样会绿。
 *
 * ## 三条断言的分工
 *
 * | 配置 | 走哪一步判定 | 界面上应当看到 |
 * |---|---|---|
 * | `fld:contact_mobile` DENY | 第一步「能不能看见」 | 详情里字段消失，**列表里仍在** |
 * | `fld:id_card` READONLY | 第二步「能不能改」 | 详情里值仍在，但输入框置灰 |
 * | `col:contact_email` DENY | 第一步 | 列表里列消失，**详情里仍在** |
 *
 * 一、三两条互为对照：它们证明 COLUMN 与 FIELD 是**两套独立资源**，
 * 而不是「配一处两处都生效」。这一点单看某一条是看不出来的。
 *
 * ## ⚠️ 前置条件
 *
 * 1. 先执行 `ruoyi-vue-pro/sql/mysql/xpy-2026-09-16-e2e-field-permission-fixture.sql`
 *    造出三条授权。字段权限的配置界面要到 S8 才做，当前没有任何接口能创建授权，
 *    所以用例没法自己准备夹具
 * 2. 示例表单 `test_demo_verify_supplier` 已发布，且 S4a 的资源登记已跑过
 *
 * 夹具没跑的话，用例会在第一条断言就失败，且失败信息会提示去跑 SQL。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'
const FORM_CODE = 'test_demo_verify_supplier'

/** 详情里被 DENY 的字段：列表里应当仍然看得见 */
const HIDDEN_FIELD_TITLE = '联系手机（MOBILE）'
/** 详情里被置为只读的字段 */
const READONLY_FIELD_TITLE = '法人证件号（ID_CARD）'
/** 列表里被 DENY 的列：详情里应当仍然看得见 */
const HIDDEN_COLUMN_LABEL = '联系邮箱'
/** 对照列：没配任何权限，必须一直在 */
const CONTROL_COLUMN_LABEL = '法人姓名'

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  expect(response.ok(), '接口登录失败').toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  expect(body.data?.accessToken, '登录接口没有返回 token').toBeTruthy()
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
  // 冷启动时首屏要现编译一大批模块，默认 10s 不够
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
}

/**
 * 先确认夹具在位。不做这一步的话，夹具没跑时的失败信息会是
 * 「找不到某个元素」—— 看着像界面坏了，实际只是没造数据
 */
async function assertFixtureReady(request: APIRequestContext, token: string) {
  const response = await request.get(
    `${API_BASE_URL}/infra/form-design/runtime/${FORM_CODE}/config`,
    {
      headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID }
    }
  )
  expect(response.ok(), `读不到 ${FORM_CODE} 的运行时配置`).toBeTruthy()
  const body = (await response.json()) as { data?: { formFields?: string[] } }
  const joined = (body.data?.formFields || []).join(' ')
  expect(
    joined.includes('"contact_mobile"'),
    '夹具似乎没生效：contact_mobile 仍在 formFields 里。' +
      '请先执行 ruoyi-vue-pro/sql/mysql/xpy-2026-09-16-e2e-field-permission-fixture.sql，' +
      '并确认插入的 3 行 sys_grant 的 tenant_id 是 1 而不是 0'
  ).toBeFalsy()
}

async function openRuntime(page: Page) {
  await page.goto(`/infra-form-design/preview?code=${FORM_CODE}`)
  await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
}

/** 列表表头的全部列名 */
async function headerLabels(page: Page): Promise<string[]> {
  const texts = await page.locator('.el-table__header-wrapper th').allInnerTexts()
  return texts.map((t) => t.trim()).filter(Boolean)
}

test.describe('字段级权限裁剪', () => {
  test('⚠️ 列表：配在 COLUMN 上的 DENY 让列消失，配在 FIELD 上的不影响列表', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    await assertFixtureReady(request, token)
    await login(page)
    await openRuntime(page)

    const labels = await headerLabels(page)

    expect(labels, `对照列「${CONTROL_COLUMN_LABEL}」没配权限，必须一直在`).toContain(
      CONTROL_COLUMN_LABEL
    )
    expect(
      labels,
      `「${HIDDEN_COLUMN_LABEL}」的 DENY 配在 col: 上，列表里应当看不到这一列`
    ).not.toContain(HIDDEN_COLUMN_LABEL)
    // 与上一条互为对照：contact_mobile 的 DENY 配在 fld: 上，
    // 只该影响详情。列表里跟着消失的话，说明列与字段被当成了一套资源
    expect(
      labels,
      '「联系手机」的 DENY 配在 fld: 上，不该影响列表 —— 列与字段是两套独立资源'
    ).toContain('联系手机')
  })

  test('⚠️ 详情：HIDDEN 字段整条消失，READONLY 字段值还在但置灰', async ({ page, request }) => {
    const token = await apiLogin(request)
    await assertFixtureReady(request, token)
    await login(page)
    await openRuntime(page)

    // 进第一行的编辑态。用编辑而不是详情：只读态下所有控件本来就是禁用的，
    // 那样 READONLY 的断言就失去意义了
    const firstRow = page.locator('.el-table__body-wrapper tbody tr').first()
    await firstRow.getByRole('button', { name: '编辑' }).first().click()

    const formPanel = page.locator('.el-dialog, .el-drawer').filter({ hasText: '法人姓名' }).first()
    await expect(formPanel, '编辑面板没打开').toBeVisible({ timeout: 30_000 })

    // ① HIDDEN：整条规则被剔除，界面上连标签都不该有
    await expect(
      formPanel.locator('.el-form-item').filter({ hasText: HIDDEN_FIELD_TITLE }),
      `「${HIDDEN_FIELD_TITLE}」被配了 DENY，详情里应当整条消失`
    ).toHaveCount(0)

    // ② 对照：contact_email 的 DENY 配在 col: 上，详情里必须还在
    await expect(
      formPanel.locator('.el-form-item').filter({ hasText: '联系邮箱（EMAIL）' }).first(),
      '「联系邮箱」的 DENY 配在 col: 上，详情里应当仍然看得见'
    ).toBeVisible()

    // ③ READONLY：字段还在，但输入框禁用。
    //    「值还在」这一点很重要 —— 只读不等于不可见，
    //    若这里连值都没了，说明第二步判定被错当成了第一步
    const readonlyItem = formPanel
      .locator('.el-form-item')
      .filter({ hasText: READONLY_FIELD_TITLE })
      .first()
    await expect(readonlyItem, `「${READONLY_FIELD_TITLE}」应当仍然可见`).toBeVisible()
    const readonlyInput = readonlyItem.locator('input').first()
    await expect(readonlyInput, 'READONLY 字段的输入框应当是禁用的').toBeDisabled()
    await expect(readonlyInput, 'READONLY 字段的值仍应下发（只读 ≠ 不可见）').not.toHaveValue('')
  })
})

/**
 * S4c 收口的另外三个出口
 *
 * 读取出口不止 config / get / page 三个。S4b-2 只裁了那三个，
 * 剩下的每一个没裁的出口都是一扇后门 —— 下面这三条各自钉住一扇。
 */
test.describe('字段级权限裁剪 · 其余出口（S4c）', () => {
  test('⚠️ 导出：列表里看不到的列，导出也不能导出来', async ({ request }) => {
    const token = await apiLogin(request)
    await assertFixtureReady(request, token)

    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${FORM_CODE}/export`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'tenant-id': TENANT_ID,
          'Content-Type': 'application/json'
        },
        data: { scope: 'ALL' }
      }
    )
    expect(response.ok(), '导出接口没返回成功').toBeTruthy()
    const buffer = Buffer.from(await response.body())
    expect(buffer.subarray(0, 2).toString('latin1'), '导出的必须是真 xlsx').toBe('PK')

    const text = readXlsxText(buffer)

    // 对照组先立住：断言方式本身得是有效的。
    // 少了这一条，「文件根本没解开」和「列被正确裁掉了」看起来一模一样
    expect(text, `对照列「${CONTROL_COLUMN_LABEL}」必须出现在导出文件里`).toContain(
      CONTROL_COLUMN_LABEL
    )
    expect(
      text,
      `「${HIDDEN_COLUMN_LABEL}」在列表里已经被 DENY 掉，导出文件里也不能有 —— ` +
        '「列表看不到的列能导出来」是这一类缺陷最常见的漏口'
    ).not.toContain(HIDDEN_COLUMN_LABEL)
  })

  test('⚠️ 导出：前端传 visibleFields 也不能把被裁的列要回来', async ({ request }) => {
    const token = await apiLogin(request)
    await assertFixtureReady(request, token)

    // 显式点名要那一列。visibleFields 来自浏览器本地的列设置，
    // 是**调用方可控**的入参 —— 裁剪若发生在它之后就会被它绕过
    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${FORM_CODE}/export`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'tenant-id': TENANT_ID,
          'Content-Type': 'application/json'
        },
        data: { scope: 'ALL', visibleFields: ['contact_email', 'contact_name'] }
      }
    )
    expect(response.ok()).toBeTruthy()
    const text = readXlsxText(Buffer.from(await response.body()))

    expect(text, '没被裁的列点名要，应当要得到').toContain(CONTROL_COLUMN_LABEL)
    expect(
      text,
      '被裁掉的列即使被点名也不能导出 —— 裁剪必须发生在 visibleFields 过滤之前'
    ).not.toContain(HIDDEN_COLUMN_LABEL)
  })

  test('⚠️ plain-field：HIDDEN 字段不能从「查看明文」这个口子读出来', async ({ request }) => {
    const token = await apiLogin(request)
    await assertFixtureReady(request, token)
    const headers = { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID }
    const base = `${API_BASE_URL}/infra/form-design/runtime/${FORM_CODE}`

    // 先拿一条真实主键，不写死 id —— 写死的话数据一变用例就失效，
    // 而且失败原因会指向「数据不存在」而不是权限
    const pageResponse = await request.post(`${base}/page`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { pageNo: 1, pageSize: 1 }
    })
    const pageBody = (await pageResponse.json()) as {
      data?: { list?: Array<Record<string, unknown>> }
    }
    const row = pageBody.data?.list?.[0]
    expect(row, '示例表单里一条数据都没有，用例没法继续').toBeTruthy()
    const id = String(row!.id)

    // ① HIDDEN 字段：必须拒。
    //    这个接口返回的是**明文**，不裁的话它比不裁剪的 get 还多泄露一层 ——
    //    详情里看不到的手机号，从这里能拿到 13900001111
    const hidden = await request.get(`${base}/plain-field?id=${id}&field=contact_mobile`, {
      headers
    })
    const hiddenBody = (await hidden.json()) as { code: number; data?: unknown }
    expect(
      hiddenBody.code,
      'HIDDEN 字段的明文查看必须被拒绝。返回 0 说明字段权限被这个出口整个绕过了'
    ).not.toBe(0)
    expect(hiddenBody.data, '被拒时不能顺带把值带回来').toBeFalsy()

    // ② READONLY 字段：同样要拒。
    //    看明文是为了改，而 READONLY 的提交值本来就会被丢弃，
    //    放行只是白白扩大泄露面
    const readonly = await request.get(`${base}/plain-field?id=${id}&field=id_card`, {
      headers
    })
    expect(
      ((await readonly.json()) as { code: number }).code,
      'READONLY 字段改不了，就没有看明文的理由'
    ).not.toBe(0)
  })
})
