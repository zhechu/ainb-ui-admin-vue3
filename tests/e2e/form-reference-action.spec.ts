import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * REFERENCE 弱动作的端到端验证（S4c）
 *
 * ## 这个动作要解决什么
 *
 * 关联表单控件原先直接调 `/page`，于是「填订单要选客户」这件事要求用户有
 * **客户表单的完整 query 权限** —— 给了，他就能浏览客户列表全部数据、全部字段、
 * 还能导出；不给，关联控件点开是空的，订单根本填不下去。
 *
 * REFERENCE 是这两难之间的第三条路：只能按关键字搜、条数受限、
 * 只返回「主键 + 显示字段 + 带出映射声明的那几个字段」。
 *
 * ## 断言的重点不是「能取到数」
 *
 * 能取到数是最不值得测的部分。真正要钉住的是两件事：
 *
 * 1. **它确实比 query 窄**（字段数少一截）。不窄的话这个动作就白设了 ——
 *    而「白设了」在界面上完全看不出来，下拉框照样能选
 * 2. **目标表单与可见字段不接受调用方指定**。这是它全部安全性的来源；
 *    一旦能传，这个接口就比它要替代的 query 还宽
 *
 * ## 前置条件
 *
 * 开发库里的 `test_demo_contract`（跨表取数示例）已发布，其 `customer_id`
 * 关联控件指向 `test_demo_customer`。这两张是 demo 脚本造的示例表单。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 引用方表单 */
const SOURCE_FORM = 'test_demo_contract'
/** 引用方表单上的关联控件字段 */
const RELATION_FIELD = 'customer_id'
/** 被引用的目标表单 */
const TARGET_FORM = 'test_demo_customer'

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

async function referenceOptions(
  request: APIRequestContext,
  token: string,
  query: Record<string, string>
) {
  const search = new URLSearchParams(query).toString()
  const response = await request.get(
    `${API_BASE_URL}/infra/form-design/runtime/${SOURCE_FORM}/reference-options?${search}`,
    { headers: authHeaders(token) }
  )
  return (await response.json()) as { code: number; msg: string; data?: Record<string, any>[] }
}

test.describe('REFERENCE 弱动作', () => {
  test('⚠️ 比 query 窄：只返回主键 + 显示字段 + 带出字段', async ({ request }) => {
    const token = await apiLogin(request)

    const body = await referenceOptions(request, token, { field: RELATION_FIELD })
    expect(body.code, `取候选数据失败：${body.msg}`).toBe(0)
    const rows = body.data ?? []
    expect(rows.length, '示例表单里应当有客户数据').toBeGreaterThan(0)

    // 与 /page 对照。这才是「弱」的证据 ——
    // 光看 reference 返回了几个字段，说明不了它比什么窄
    const pageResponse = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${TARGET_FORM}/page`,
      {
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        data: { pageNo: 1, pageSize: 1 }
      }
    )
    const pageRows =
      ((await pageResponse.json()) as { data?: { list?: Record<string, any>[] } }).data?.list ?? []
    expect(pageRows.length, '对照组取不到数据，用例没法比较').toBeGreaterThan(0)

    const referenceKeys = Object.keys(rows[0])
    const pageKeys = Object.keys(pageRows[0])
    expect(
      referenceKeys.length,
      `REFERENCE 返回 ${referenceKeys.length} 个字段、query 返回 ${pageKeys.length} 个。` +
        '不比 query 窄的话，这个动作就白设了 —— 而界面上完全看不出来'
    ).toBeLessThan(pageKeys.length)

    // 审计类字段是最典型的「不该跟着带出去」的那批
    for (const leaked of ['creator', 'updater', 'create_time', 'update_time']) {
      expect(referenceKeys, `${leaked} 不该出现在关联候选数据里`).not.toContain(leaked)
    }
  })

  test('⚠️ 目标表单只能从已发布配置里读，不接受调用方指定', async ({ request }) => {
    const token = await apiLogin(request)

    // 编一个不存在的控件字段名。放行的话，说明服务端信了调用方的话 ——
    // 那这个接口就成了「任意表单任意字段」的读取口
    const forged = await referenceOptions(request, token, { field: 'not_a_real_widget' })
    expect(forged.code, '不存在的关联控件必须被拒').not.toBe(0)
    expect(forged.data, '被拒时不能顺带返回数据').toBeFalsy()

    // 换一张没有这个控件的表单当源表单，同样要拒。
    // 否则可以拿「带出字段最多的那张表单」当模板，去多读目标表单几列
    const response = await request.get(
      `${API_BASE_URL}/infra/form-design/runtime/test_demo_verify_supplier/reference-options` +
        `?field=${RELATION_FIELD}`,
      { headers: authHeaders(token) }
    )
    const body = (await response.json()) as { code: number }
    expect(body.code, '源表单上没有这个关联控件时必须拒').not.toBe(0)
  })

  test('⚠️ 关键字搜得到，且条数受服务端硬上限约束', async ({ request }) => {
    const token = await apiLogin(request)

    const all = await referenceOptions(request, token, { field: RELATION_FIELD })
    expect(all.code).toBe(0)
    const total = (all.data ?? []).length
    expect(total).toBeGreaterThan(0)

    // 关键字取第一条的显示值，保证一定搜得到 —— 写死中文关键字的话，
    // demo 数据一改用例就失效，而失败信息会指向「搜索坏了」
    const keyword = String((all.data ?? [])[0].customer_name ?? '').slice(0, 2)
    test.skip(!keyword, '示例数据没有 customer_name，跳过搜索断言')

    const searched = await referenceOptions(request, token, {
      field: RELATION_FIELD,
      keyword
    })
    expect(searched.code).toBe(0)
    expect((searched.data ?? []).length, '关键字应当搜得到至少一条').toBeGreaterThan(0)

    // 超大 limit 不能突破服务端硬上限（50）。
    // 突破了的话，配上关键字就能把目标表单分批捞干净 —— 那就等于 query 了
    const huge = await referenceOptions(request, token, {
      field: RELATION_FIELD,
      limit: '9999'
    })
    expect(huge.code).toBe(0)
    expect((huge.data ?? []).length, '返回条数不能超过服务端硬上限').toBeLessThanOrEqual(50)
  })
})
