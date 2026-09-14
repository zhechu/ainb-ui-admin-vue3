import { expect, test, type APIRequestContext } from '@playwright/test'
import contractCopy from '../../src/components/FormWidgets/contracts/cell-format-contracts.json'

/**
 * 列格式化契约的前后端一致性
 *
 * ## 它在防什么
 *
 * 列表的格式化在前端（`listCell.ts`），导出在后端。「列表怎么显示、导出就怎么导」
 * 这件事靠的是两端读同一份声明 —— 而两个仓库是独立的 git 仓库，没有共享构建产物，
 * 所以契约以「一份规范 + 一份副本 + 这个测试」的方式落地。
 *
 * 漂了会怎样：前端给某种格式化改了行为、或加了一种新的，后端不知道，
 * 于是**列表显示正常、导出是另一套**。而这件事在界面上完全看不出来 ——
 * 要等用户把导出的表发给别人，对方问「这个 MAKE 是什么意思」才会暴露。
 *
 * ## 为什么逐字段比对而不是比 JSON 字符串
 *
 * 后端接口回的是对象，字段顺序、空字段的处理都可能与文件里的字面量不同。
 * 比字符串会得到一堆假失败，而假失败多了这个测试就会被人跳过。
 *
 * ⚠️ 契约里的 `_comment` 只在文件里、不走接口，所以不参与比对。
 * 它是写给人看的，不该逼着后端模型上多一个用不到的字段。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  expect(response.ok(), '接口登录失败').toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  return body.data!.accessToken as string
}

/** 拉后端的契约 */
async function fetchContract(request: APIRequestContext, token: string): Promise<any> {
  const response = await request.get(
    `${API_BASE_URL}/infra/form-design/cell-format-contracts`,
    { headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID } }
  )
  expect(response.ok(), '取列格式化契约失败').toBeTruthy()
  const body = (await response.json()) as { code: number; data: any }
  expect(body.code, '接口返回了业务错误').toBe(0)
  return body.data
}

const local = contractCopy as any

test.describe('列格式化契约的前后端一致性', () => {
  let token = ''
  let remote: any

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)
    remote = await fetchContract(request, token)
  })

  test('契约版本一致', async () => {
    expect(remote.contractVersion).toBe(local.contractVersion)
  })

  test('空值占位一致', async () => {
    // 前端用它渲染空单元格。两端不一致的话，后端某天想按占位符判空就会判错
    expect(remote.emptyCell).toBe(local.emptyCell)
  })

  test('布尔的文案与判真规则一致', async () => {
    // ⚠️ 这一条尤其要守：判真规则不一致会让同一条数据
    // 在列表上显示「是」、导出成「否」，而两边都不报错
    expect(remote.booleanText.trueText).toBe(local.booleanText.trueText)
    expect(remote.booleanText.falseText).toBe(local.booleanText.falseText)
    expect(remote.booleanText.trueValues).toEqual(local.booleanText.trueValues)
  })

  test('数字格式的拼装规则一致', async () => {
    // 一端拼出 #,##0.00、另一端拼出 #,###.00，差别只在千位分组上，
    // 而那种差异没人会在代码评审里看出来
    for (const key of [
      'integer',
      'integerThousands',
      'decimalSeparator',
      'decimalDigit',
      'defaultPrecision'
    ]) {
      expect(remote.numberFormat[key], `numberFormat.${key} 两侧不一致`).toEqual(
        local.numberFormat[key]
      )
    }
  })

  test('视图产物行的标记一致', async () => {
    // 导出时用它写合计行、导入时用它识别并跳过。
    // 不一致的话导出的合计行会被自己的导入当成一条数据
    expect(remote.rowKinds.summaryLabel).toBe(local.rowKinds.summaryLabel)
    expect(remote.rowKinds.groupLabelPrefix).toBe(local.rowKinds.groupLabelPrefix)
    expect(remote.rowKinds.skipOnImport).toBe(local.rowKinds.skipOnImport)
  })

  test('格式化清单完全一致（数量、type、顺序）', async () => {
    const remoteTypes = remote.formatters.map((f: any) => f.type)
    const localTypes = local.formatters.map((f: any) => f.type)
    // 顺序也比：它就是设计器下拉的顺序
    expect(remoteTypes).toEqual(localTypes)
  })

  test('每种格式化的导出规则一致', async () => {
    const remoteByType = new Map(remote.formatters.map((f: any) => [f.type, f]))
    for (const localItem of local.formatters) {
      const remoteItem = remoteByType.get(localItem.type) as any
      expect(remoteItem, `后端缺少格式化 ${localItem.type}`).toBeTruthy()
      expect(remoteItem.label, `${localItem.type} 的 label 不一致`).toBe(localItem.label)

      const le = localItem.export
      const re = remoteItem.export
      for (const key of [
        'mode',
        'source',
        'valueKind',
        'numFmt',
        'numFmtFrom',
        'numFmtSuffix',
        'divideBy100WhenAlreadyScaled',
        'fillByDictColor',
        'followsList'
      ]) {
        // 两侧都没有这个键时跳过 —— undefined 与 null 在这里是同一个意思
        if (le[key] === undefined && (re[key] === undefined || re[key] === null)) continue
        expect(re[key], `${localItem.type}.export.${key} 两侧不一致`).toEqual(le[key])
      }
    }
  })

  test('⚠️ 故意不跟随列表的三种，两侧都记着这个决定', async () => {
    // followsList=false 存在的意义是让「不跟随」是一个被记录过的决定。
    // 哪天有人把它当成 bug 去「修复」，这条用例会问他：你确定吗
    for (const type of ['LINK', 'IMAGE', 'FILE']) {
      const remoteItem = remote.formatters.find((f: any) => f.type === type)
      const localItem = local.formatters.find((f: any) => f.type === type)
      expect(remoteItem.export.followsList, `${type} 后端应当标记不跟随`).toBe(false)
      expect(localItem.export.followsList, `${type} 前端副本应当标记不跟随`).toBe(false)
    }
  })
})
