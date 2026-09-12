import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import backendContractSnapshot from '@/components/FormWidgets/contracts/form-widget-contracts.json'
import {
  CONTRACT_VERSION,
  SUB_TABLE_WIDGET_TYPE,
  SUB_FIELD_SEPARATOR,
  NESTED_RULE_PATH,
  RICH_TEXT_WIDGET_TYPES,
  DELIMITED_SEPARATOR,
  listWidgetContracts,
  listUnsupportedWidgetTypes
} from '@/components/FormWidgets/contracts'

/**
 * 表单控件契约的前后端一致性验证
 *
 * 契约的规范副本在后端 resources 下，前端有一份构建期副本（两个仓库是独立的 git 仓库，
 * 没有共享构建产物）。运行时前端读本地副本 —— `subTableWidgetType` 这类结构性事实在
 * 模块加载期就要用，改成异步拉接口会把一批同步函数染成异步，牵动面远超收益。
 *
 * 代价是两份文件可能漂移，本用例就是拦这个的：拉后端接口，与前端副本逐项比对。
 * 任一侧改了契约而另一侧没跟上，这里就会失败并指出差异。
 *
 * ⚠️ 本用例拦不住「两侧同时被改成不同内容」（各自都自洽）。那只能靠流程约束：
 * 永远先改后端规范副本，再复制到前端。详见 SYNC.md。
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
  // 超时给到 60s 而不是用默认的 10s：登录成功后要加载整个后台首屏，
  // 开发服务器冷启动时这一步会现编译一大批模块，10s 不够。
  // 这不是被测逻辑慢，纯粹是首次编译的固定开销，短超时只会制造随机失败
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
  return body.data?.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

interface BackendContract {
  contractVersion: number
  subTableWidgetType: string
  subFieldSeparator: string
  nestedRulePath: string
  layoutContainerTypes: string[]
  richTextWidgetTypes: string[]
  delimitedSeparator: string
  widgets: Array<{
    type: string
    label: string
    group: string
    supported: boolean | null
    deprecated: boolean | null
    valueType: string
    storage: string
    columnTypes: string[] | null
    caps: Record<string, boolean | null> | null
    maskable: boolean | null
  }>
}

async function fetchBackendContract(
  request: APIRequestContext,
  token: string
): Promise<BackendContract> {
  const response = await request.get(`${API_BASE_URL}/infra/form-design/widget-contracts`, {
    headers: authHeaders(token)
  })
  expect(response.ok(), '取控件契约接口失败').toBeTruthy()
  const body = (await response.json()) as { data?: BackendContract }
  expect(body.data, '契约接口返回体里没有 data').toBeTruthy()
  return body.data as BackendContract
}

/** 后端的布尔字段允许为 null（契约 JSON 里省略了缺省值），归一化后再比 */
const normalizeBool = (value: boolean | null | undefined, fallback: boolean): boolean =>
  value === null || value === undefined ? fallback : value

test.describe('表单控件契约的前后端一致性', () => {
  test('结构性事实两侧一致', async ({ page, request }) => {
    const token = await login(page)
    const backend = await fetchBackendContract(request, token)

    expect(backend.contractVersion, '契约版本号不一致').toBe(CONTRACT_VERSION)
    expect(
      backend.subTableWidgetType,
      '子表控件类型不一致 —— 这一项对不上，子表功能会整体失效'
    ).toBe(SUB_TABLE_WIDGET_TYPE)
    expect(
      backend.subFieldSeparator,
      '子字段分隔符不一致 —— 对不上会导致子表字段配了权限却不生效'
    ).toBe(SUB_FIELD_SEPARATOR)
    expect(backend.nestedRulePath, '嵌套规则路径不一致').toBe(NESTED_RULE_PATH)
    expect(
      backend.richTextWidgetTypes ?? [],
      '富文本控件类型不一致 —— 对不上会导致某一类富文本字段的 base64 图片既不转存也不清洗'
    ).toEqual(RICH_TEXT_WIDGET_TYPES)
    expect(
      backend.delimitedSeparator,
      '多值分隔符不一致 —— 对不上会让「存进去 3 项、读回来 2 项」，而且不报错'
    ).toBe(DELIMITED_SEPARATOR)
  })

  test('控件清单两侧完全一致（数量、type、顺序）', async ({ page, request }) => {
    const token = await login(page)
    const backend = await fetchBackendContract(request, token)
    const frontend = listWidgetContracts()

    const backendTypes = backend.widgets.map((w) => w.type)
    const frontendTypes = frontend.map((w) => w.type)

    // 先比集合差异：这样报错信息能直接指出「哪个控件只有一侧有」，
    // 比直接比数组更容易定位
    const onlyInBackend = backendTypes.filter((t) => !frontendTypes.includes(t))
    const onlyInFrontend = frontendTypes.filter((t) => !backendTypes.includes(t))
    expect(onlyInBackend, '这些控件只在后端契约里有，前端副本没跟上').toEqual([])
    expect(onlyInFrontend, '这些控件只在前端副本里有，后端契约没跟上').toEqual([])

    // 顺序也要一致：契约文件的声明顺序被当作稳定顺序使用（左侧菜单、接口返回）
    expect(frontendTypes, '控件顺序两侧不一致').toEqual(backendTypes)
  })

  test('每个控件的契约细节两侧一致', async ({ page, request }) => {
    const token = await login(page)
    const backend = await fetchBackendContract(request, token)
    const frontendByType = new Map(listWidgetContracts().map((w) => [w.type, w]))

    for (const backendWidget of backend.widgets) {
      const frontendWidget = frontendByType.get(backendWidget.type)
      expect(frontendWidget, `前端副本里缺少控件 ${backendWidget.type}`).toBeTruthy()
      if (!frontendWidget) continue

      const where = `控件 ${backendWidget.type}`
      expect(frontendWidget.label, `${where} 的 label 不一致`).toBe(backendWidget.label)
      expect(frontendWidget.group, `${where} 的 group 不一致`).toBe(backendWidget.group)
      expect(frontendWidget.valueType, `${where} 的 valueType 不一致`).toBe(backendWidget.valueType)
      expect(frontendWidget.storage, `${where} 的 storage 不一致`).toBe(backendWidget.storage)
      expect(frontendWidget.supported, `${where} 的 supported 不一致`).toBe(
        normalizeBool(backendWidget.supported, true)
      )
      expect(frontendWidget.deprecated, `${where} 的 deprecated 不一致`).toBe(
        normalizeBool(backendWidget.deprecated, false)
      )
      expect(frontendWidget.maskable, `${where} 的 maskable 不一致`).toBe(
        normalizeBool(backendWidget.maskable, false)
      )
      expect(frontendWidget.columnTypes, `${where} 的 columnTypes 不一致`).toEqual(
        backendWidget.columnTypes ?? []
      )

      const backendCaps = backendWidget.caps ?? {}
      for (const cap of [
        'field',
        'subTable',
        'listColumn',
        'searchable',
        'exportable',
        'sortable'
      ] as const) {
        expect(frontendWidget.caps[cap], `${where} 的能力位 ${cap} 不一致`).toBe(
          normalizeBool(backendCaps[cap], false)
        )
      }
    }
  })

  test('前端 JSON 副本与后端接口返回的 JDBC 类型族规则一致', async ({ page, request }) => {
    const token = await login(page)
    await fetchBackendContract(request, token)

    // 类型族规则不通过接口下发（前端只在本地用），这里退一步验证前端副本自身完整：
    // 族有定义、关键字非空、且顺序满足那几对必须靠顺序区分的陷阱
    const rules = (backendContractSnapshot as any).jdbcTypeFamilies as Array<{
      family: string
      keywords: string[]
    }>
    expect(rules?.length, '前端副本缺少 jdbcTypeFamilies').toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule.family, 'jdbcTypeFamilies 里有条目缺 family').toBeTruthy()
      expect(rule.keywords?.length, `类型族 ${rule.family} 没有关键字`).toBeGreaterThan(0)
    }

    const orderOf = (family: string) => rules.findIndex((r) => r.family === family)
    // "TIMESTAMP" 含 "TIME"、"DATETIME" 含 "DATE"
    expect(orderOf('DATETIME'), 'DATETIME 必须排在 TIME 之前').toBeLessThan(orderOf('TIME'))
    expect(orderOf('DATETIME'), 'DATETIME 必须排在 DATE 之前').toBeLessThan(orderOf('DATE'))
    // "LONGVARCHAR" 含 "VARCHAR"
    expect(orderOf('TEXT'), 'TEXT 必须排在 STRING 之前').toBeLessThan(orderOf('STRING'))
    // "BIGINT" 含 "INT"
    expect(orderOf('LONG'), 'LONG 必须排在 INTEGER 之前').toBeLessThan(orderOf('INTEGER'))
  })

  test('不支持的控件清单非空，且包含会静默丢明细数据的两个子表变体', async ({ page, request }) => {
    const token = await login(page)
    const backend = await fetchBackendContract(request, token)

    const unsupported = listUnsupportedWidgetTypes()
    // 这份清单会被喂给设计器的 hiddenItem，空了就等于没隐藏任何控件
    expect(unsupported.length, '不支持控件清单为空，设计器的 hiddenItem 会失效').toBeGreaterThan(0)
    expect(unsupported, 'tableForm 必须被隐藏：它会让明细数据静默写不进库').toContain('tableForm')
    expect(unsupported, 'subForm 必须被隐藏：本模块不支持嵌套对象字段').toContain('subForm')

    // 后端也要认为它们不支持，否则发布校验这道第二防线是空的
    const backendUnsupported = backend.widgets
      .filter((w) => normalizeBool(w.supported, true) === false)
      .map((w) => w.type)
    expect(backendUnsupported.sort(), '不支持控件清单两侧不一致').toEqual(unsupported.sort())
  })
})
