import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * 自关联的端到端验证（B10 ③）
 *
 * 「同一张表里父子相认」——部门树、物料 BOM。设计方案把它列在 B10，
 * 交接文档记的是「`StepTableBinding.vue:632` 自关联明确不支持」。
 *
 * 放开的只是**只读关联**（joinTable）：SQL 上靠别名区分两侧，机制本来就支持。
 * 副表 / 明细表的自关联仍然拒绝——它们要往那张表写数据，而那张表就是主表，
 * 一次提交会对同一张表发两条互不知情的写入。
 *
 * ⚠️ 需要先建夹具表：
 * `mysql -uroot -p --default-character-set=utf8mb4 ruoyi-vue-pro
 *    < sql/mysql/xpy-2026-09-11-e2e-selfjoin-fixture.sql`
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'
const TABLE = 'test_e2e_selfjoin'
const PARENT_MENU_ID = 2

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  const body = (await response.json()) as { data?: { accessToken?: string } }
  expect(body.data?.accessToken, '登录失败').toBeTruthy()
  return body.data!.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

const FIELDS = [
  JSON.stringify({ type: 'input', field: 'name', title: '名称', props: {} }),
  JSON.stringify({ type: 'input', field: 'parent_id', title: '上级ID', props: {} })
]

const FIELD_MAPPING = {
  name: { table: TABLE, column: 'name', jdbcType: 'VARCHAR' },
  parent_id: { table: TABLE, column: 'parent_id', jdbcType: 'VARCHAR' }
}

/** 一条正确的自关联配置：别名 parent，ON 用别名，展示列别名带前缀 */
const goodSelfJoin = {
  table: TABLE,
  alias: 'parent',
  joinType: 'LEFT',
  on: [{ left: `${TABLE}.parent_id`, right: 'parent.id' }],
  selectColumns: [{ column: 'name', as: 'parent_name' }]
}

async function createDraft(
  request: APIRequestContext,
  token: string,
  binding: Record<string, any>,
  extra: Record<string, any> = {}
): Promise<{ id: number; code: string }> {
  const code = `e2e_sj_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const response = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: '自关联用例',
      code,
      formType: 1,
      formConf: JSON.stringify({ form: {} }),
      formFields: FIELDS,
      dataSourceConfigId: 0,
      mainTable: TABLE,
      mainPk: 'id',
      tableBinding: JSON.stringify({ mainTable: TABLE, mainPk: 'id', ...binding }),
      ...extra
    }
  })
  const body = (await response.json()) as { code: number; data: number; msg: string }
  expect(body.code, `造用例表单失败：${body.msg}`).toBe(0)
  return { id: body.data, code }
}

const publish = async (request: APIRequestContext, token: string, id: number) => {
  const response = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
    headers: authHeaders(token),
    data: { id, parentMenuId: PARENT_MENU_ID }
  })
  return (await response.json()) as { code: number; msg: string }
}

const cleanup = async (
  request: APIRequestContext,
  token: string,
  fixture?: { id: number }
) => {
  if (!fixture) return
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${fixture.id}`, {
    headers: authHeaders(token)
  })
}

test.describe('自关联（部门树 / 物料 BOM）', () => {
  test('⚠️ 只读自关联能发布，且真的带出上级名称', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    const created: any[] = []
    try {
      fixture = await createDraft(
        request,
        token,
        { fieldMapping: FIELD_MAPPING, joinTables: [goodSelfJoin] },
        {
          formType: 2,
          listConf: JSON.stringify({
            columns: [
              { field: 'name', label: '名称' },
              { field: 'parent_name', label: '上级' }
            ],
            operationColumn: { show: true, label: '操作', width: 150, buttons: ['detail'] }
          })
        }
      )
      const published = await publish(request, token, fixture.id)
      expect(published.code, `自关联应当能发布：${published.msg}`).toBe(0)

      const parentRes = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { name: '总公司' } }
      )
      const parentId = ((await parentRes.json()) as { data: any }).data
      created.push(parentId)
      const childRes = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
        { headers: authHeaders(token), data: { name: '研发部', parent_id: String(parentId) } }
      )
      created.push(((await childRes.json()) as { data: any }).data)

      const pageRes = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/page`,
        { headers: authHeaders(token), data: { pageNo: 1, pageSize: 10 } }
      )
      const list = ((await pageRes.json()) as { data: { list: any[] } }).data.list
      const child = list.find((row) => row.name === '研发部')
      // 断言落在「上级名称真的带出来了」上 —— 只断言发布成功的话，
      // 一个 ON 条件配歪、一行都关联不上的自关联也会通过
      expect(child?.parent_name, '子记录应当带出上级名称').toBe('总公司')
      // 顶层记录没有上级，应当是空而不是它自己 —— ON 写错时最典型的症状就是「关联到自己」
      const root = list.find((row) => row.name === '总公司')
      expect(root?.parent_name).toBeFalsy()
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 自关联没起别名，发布被拒 —— SQL 会变成 FROM t JOIN t', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    try {
      const { alias, ...noAlias } = goodSelfJoin
      fixture = await createDraft(request, token, {
        fieldMapping: FIELD_MAPPING,
        joinTables: [{ ...noAlias, on: [{ left: `${TABLE}.parent_id`, right: `${TABLE}.id` }] }]
      })
      const result = await publish(request, token, fixture.id)
      expect(result.code).not.toBe(0)
      expect(result.msg).toContain('别名')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ ON 两侧都没用别名，发布被拒 —— 它会静默退化成「主表.列 = 主表.列」', async ({
    request
  }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    try {
      // 这一条是自关联最隐蔽的坑：qualifyOnSide 先按「是不是已声明的表名」解析，
      // 而自关联时表名就是主表名 —— 两侧都写表名的话 SQL 跑得通、结果却是错的
      fixture = await createDraft(request, token, {
        fieldMapping: FIELD_MAPPING,
        joinTables: [
          { ...goodSelfJoin, on: [{ left: `${TABLE}.parent_id`, right: `${TABLE}.id` }] }
        ]
      })
      const result = await publish(request, token, fixture.id)
      expect(result.code).not.toBe(0)
      expect(result.msg).toContain('静默')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 展示列别名与主表字段重名，发布被拒 —— 结果 Map 只会留一个', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    try {
      fixture = await createDraft(request, token, {
        fieldMapping: FIELD_MAPPING,
        joinTables: [{ ...goodSelfJoin, selectColumns: [{ column: 'name', as: 'name' }] }]
      })
      const result = await publish(request, token, fixture.id)
      expect(result.code).not.toBe(0)
      expect(result.msg).toContain('重名')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('⚠️ 写入型自关联（副表）仍然被拒 —— 会对同一张表发两条互不知情的写入', async ({
    request
  }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    try {
      fixture = await createDraft(request, token, {
        fieldMapping: FIELD_MAPPING,
        sideTables: [
          { table: TABLE, pk: 'id', foreignKey: 'parent_id', relationField: 'id', fieldMapping: {} }
        ]
      })
      const result = await publish(request, token, fixture.id)
      expect(result.code).not.toBe(0)
      // 报错要指向正确的替代方案，而不是笼统的「不支持」
      expect(result.msg).toContain('只读关联')
    } finally {
      await cleanup(request, token, fixture)
    }
  })

  test('同一张表 JOIN 两次（上级 + 上上级）不算重复配置', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    try {
      // 按表名去重的话，第二次会被误判成「已配置过」——
      // 而「显示上级与上上级」是树形建模里很自然的需求
      fixture = await createDraft(request, token, {
        fieldMapping: FIELD_MAPPING,
        joinTables: [
          goodSelfJoin,
          {
            table: TABLE,
            alias: 'grandparent',
            joinType: 'LEFT',
            on: [{ left: 'parent.parent_id', right: 'grandparent.id' }],
            selectColumns: [{ column: 'name', as: 'grandparent_name' }]
          }
        ]
      })
      const result = await publish(request, token, fixture.id)
      expect(result.code, `两级自关联应当能发布：${result.msg}`).toBe(0)
    } finally {
      await cleanup(request, token, fixture)
    }
  })
})
