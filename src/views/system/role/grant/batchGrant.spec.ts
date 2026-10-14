import { describe, expect, it } from 'vitest'
import type { GrantBatchInput, GrantMergeSource, SlotCoverageInput } from './batchGrant'
import type { ParamKind, RuleParamSpecVO, RuleTemplateMetaItemVO } from '@/api/system/grant'
import { GRANT_ACTION_OPTIONS, grantActionOptionsFor } from '@/views/system/resource/constants'
import {
  GRANT_BATCH_MAX_ITEMS,
  buildSubtreeIndex,
  collectSubtreeIds,
  computeRuleSlotCoverage,
  confirmPastExpireTime,
  expandGrantBatch,
  findUnspecifiedConflicts,
  grantRowKey,
  intersectGrantActionOptions,
  isSubtreeFullyChecked
} from './batchGrant'

/**
 * 批量授权那组纯函数的守卫。
 *
 * 它们决定「点一次确定，究竟有哪些行被提交出去」。写错了不会报错、不会有异常栈，
 * 只会静默配出错误权限 —— 多授了是安全事故，少授了是「我明明勾了怎么没生效」。
 * 两种都只能靠事后追问发现，所以在提交之前就钉住。
 */

/** 后端 GrantActionEnum 里只对流程类资源开放的四个码（constants.ts 的 processOnly） */
const PROCESS_ONLY = ['START', 'DESIGN', 'MANAGE', 'VIEW_ALL']
/** effective = false 的预留码：能存进库、能保存，但不参与鉴权 */
const RESERVED = ['CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'IMPORT', 'PRINT', 'REFERENCE']

/**
 * 资源夹具。1/2 是菜单、4 是按钮、3/5/6 是数据集 ——
 * 数据集与菜单必须混在同一批里，否则「ruleId 只落 DATASET 行」这条取舍根本测不出来
 */
const RESOURCES = new Map<number, { type?: string }>([
  [1, { type: 'MENU' }],
  [2, { type: 'MENU' }],
  [3, { type: 'DATASET' }],
  [4, { type: 'ACTION' }],
  [5, { type: 'DATASET' }],
  [6, { type: 'DATASET' }]
])

const BASE = { subjectType: 'ROLE', subjectRefId: 7, effect: 'ALLOW', resourceById: RESOURCES }
const valuesOf = (options: { value: string }[]) => options.map((item) => item.value)
/** 字段名集合的比较不看顺序 —— 顺序由 MERGE_FIELD_LABELS 决定，是展示细节不是契约 */
const expectFields = (actual: string[], expected: string[]) => {
  expect([...actual].sort()).toEqual([...expected].sort())
}

describe('GRANT_BATCH_MAX_ITEMS', () => {
  it('是 500，与后端 GrantBatchSaveReqVO#items 上的 @Size(max = 500) 互为镜像', () => {
    // ⚠️ 这条用例的作用不是「记住一个数字」，而是改任何一侧时逼人做一次显式决定：
    // 前端放大了 → 用户先看到本地计数通过、再吃一个后端 400；
    // 前端缩小了 → 后端的余量白留着没人用
    expect(GRANT_BATCH_MAX_ITEMS).toBe(500)
  })
})

describe('expandGrantBatch', () => {
  it('2 资源 × 3 动作展开成 6 行，顺序是资源外层、动作内层', () => {
    const items = expandGrantBatch({
      ...BASE,
      resourceIds: [1, 2],
      actions: ['VIEW', 'CREATE', 'DELETE']
    })
    expect(items).toHaveLength(6)
    expect(items.map((item) => [item.resourceId, item.action])).toEqual([
      [1, 'VIEW'],
      [1, 'CREATE'],
      [1, 'DELETE'],
      [2, 'VIEW'],
      [2, 'CREATE'],
      [2, 'DELETE']
    ])
  })

  it('每行都带上同一份主体、效果与到期时间', () => {
    const items = expandGrantBatch({
      ...BASE,
      resourceIds: [1, 2, 3],
      actions: ['VIEW', 'DELETE'],
      expireTime: '2030-01-01 23:59:59'
    })
    expect(items).toHaveLength(6)
    for (const item of items) {
      expect(item.subjectType).toBe('ROLE')
      expect(item.subjectRefId).toBe(7)
      expect(item.effect).toBe('ALLOW')
      expect(item.expireTime).toBe('2030-01-01 23:59:59')
    }
  })

  it('🔴 ruleId 只落在 DATASET 行上，菜单行连这个键都不带', () => {
    const items = expandGrantBatch({
      ...BASE,
      resourceIds: [1, 3],
      actions: ['VIEW'],
      ruleId: 55
    })
    const [menu, dataset] = items
    expect(menu.resourceId).toBe(1)
    // 不是 ruleId: undefined —— 键在不在，是「这行有没有被写过行过滤」的唯一可读证据。
    // 绑在菜单上的 ruleId 是死字段（后端只在 DATASET 上按物理表名反查），
    // 而列表页会把它渲染成一个其实不存在的限制，比留空更误导人
    expect('ruleId' in menu).toBe(false)
    expect(dataset.resourceId).toBe(3)
    expect(dataset.ruleId).toBe(55)
  })

  it('资源不在 resourceById 里时按「非数据集」处理 —— 失效方向是少写一个 ruleId，不是越权', () => {
    const [item] = expandGrantBatch({
      ...BASE,
      resourceIds: [999],
      actions: ['VIEW'],
      ruleId: 55
    })
    expect('ruleId' in item).toBe(false)
  })

  it('🔴 不带 fieldMode / contextResourceId —— 批量入口配不出有效值', () => {
    const items = expandGrantBatch({
      ...BASE,
      resourceIds: [1, 3],
      actions: ['VIEW', 'DELETE'],
      ruleId: 55
    })
    for (const item of items) {
      // fieldMode 只对 COLUMN/FIELD 有效，而字段级资源默认不在树里；
      // contextResourceId 连单条表单都没有入口
      expect('fieldMode' in item).toBe(false)
      expect('contextResourceId' in item).toBe(false)
    }
  })

  it('没选规则时数据集行也不带 ruleId 键', () => {
    const [item] = expandGrantBatch({ ...BASE, resourceIds: [3], actions: ['VIEW'] })
    expect('ruleId' in item).toBe(false)
  })

  it('没勾资源或没选动作时展开成空数组，而不是一行残缺的授权', () => {
    expect(expandGrantBatch({ ...BASE, resourceIds: [], actions: ['VIEW'] })).toEqual([])
    expect(expandGrantBatch({ ...BASE, resourceIds: [1], actions: [] })).toEqual([])
  })
})

describe('grantRowKey', () => {
  it('上下文为空时占一个空段，而不是把动作往前挪一格', () => {
    expect(grantRowKey(3, undefined, 'VIEW')).toBe('3||VIEW')
    expect(grantRowKey(3, 8, 'VIEW')).toBe('3|8|VIEW')
  })

  it('资源、动作、上下文任一处不同就不撞键', () => {
    const keys = new Set([
      grantRowKey(3, undefined, 'VIEW'),
      grantRowKey(3, undefined, 'DELETE'),
      grantRowKey(4, undefined, 'VIEW'),
      grantRowKey(3, 8, 'VIEW')
    ])
    expect(keys.size).toBe(4)
  })
})

describe('expandGrantBatch × mergeFrom', () => {
  const EXISTING = new Map<string, GrantMergeSource>([
    [grantRowKey(3, undefined, 'VIEW'), { ruleId: 11, fieldMode: 'HIDDEN' }],
    [grantRowKey(1, undefined, 'VIEW'), { expireTime: '2030-01-01 23:59:59' }]
  ])

  it('🔴 传 mergeFrom = 本次未填的字段沿用旧值（弹窗里那个「保留既有配置」按钮）', () => {
    const [menu, dataset] = expandGrantBatch({
      ...BASE,
      resourceIds: [1, 3],
      actions: ['VIEW'],
      mergeFrom: EXISTING
    })
    expect(dataset.ruleId).toBe(11)
    expect(dataset.fieldMode).toBe('HIDDEN')
    expect(menu.expireTime).toBe('2030-01-01 23:59:59')
    // 菜单行本次没有 ruleId 可写，旧行上也没有 —— 键必须仍然不存在
    expect('ruleId' in menu).toBe(false)
  })

  it('🔴 不传 mergeFrom = 三个字段一律不写（「按本次填写覆盖」按钮，放权方向的那半边）', () => {
    // 后端 GrantDO#ruleId / #fieldMode / #expireTime 都标了 FieldStrategy.ALWAYS，
    // doUpsert 命中既有行走 updateById —— 请求里没有这几个键，库里就会被写成 NULL。
    // 这条用例钉的是「前端确实什么都没送」，那一半的后果由后端语义决定
    const items = expandGrantBatch({ ...BASE, resourceIds: [1, 3], actions: ['VIEW'] })
    for (const item of items) {
      expect('ruleId' in item).toBe(false)
      expect('fieldMode' in item).toBe(false)
      expect('expireTime' in item).toBe(false)
    }
  })

  it('本次填了的字段以本次为准，不被旧值盖回去', () => {
    const [dataset] = expandGrantBatch({
      ...BASE,
      resourceIds: [3],
      actions: ['VIEW'],
      ruleId: 99,
      expireTime: '2031-01-01 00:00:00',
      mergeFrom: EXISTING
    })
    expect(dataset.ruleId).toBe(99)
    expect(dataset.expireTime).toBe('2031-01-01 00:00:00')
    // fieldMode 批量表单没有控件，只能来自旧值
    expect(dataset.fieldMode).toBe('HIDDEN')
  })

  it('带上下文的既有行不会把值补到同资源同动作的普通行上', () => {
    const withContext = new Map<string, GrantMergeSource>([
      [grantRowKey(3, 8, 'VIEW'), { ruleId: 11, fieldMode: 'HIDDEN' }]
    ])
    const [dataset] = expandGrantBatch({
      ...BASE,
      resourceIds: [3],
      actions: ['VIEW'],
      mergeFrom: withContext
    })
    expect('ruleId' in dataset).toBe(false)
    expect('fieldMode' in dataset).toBe(false)
  })
})

describe('computeRuleSlotCoverage', () => {
  /**
   * 模板元数据夹具，形状照后端 RuleTemplateMetaRegistry 的静态块：
   * - OWNER_ONLY：requiredSlots=[owner]
   * - OWNER_OR_DEPT：requiredSlots=[owner, dept]，两个都得有
   * - FIELD_EQUALS：requiredSlots=[]，槽位名写在 params.field 里
   * - CUSTOM_TREE：requiredSlots=[]，参数是一整棵条件树
   * - ALWAYS_TRUE：requiredSlots=[] 且没有任何 SLOT / CONDITION_TREE 参数 ——
   *   这才是「真的不依赖资源槽位」的那一类，用来把 undecidable 的判据与
   *   `requiredSlots.length === 0` 区分开
   */
  const spec = (key: string, kind: ParamKind): RuleParamSpecVO => ({
    key,
    kind,
    label: key,
    required: true
  })
  const meta = (
    code: string,
    requiredSlots: string[],
    paramSpecs: RuleParamSpecVO[] = []
  ): RuleTemplateMetaItemVO => ({
    code,
    displayName: code,
    group: 'basic',
    businessDescription: '',
    requiredSlots,
    paramSpecs
  })
  const TEMPLATE_META = new Map<string, RuleTemplateMetaItemVO>([
    ['BUILT_IN_OWNER_ONLY', meta('BUILT_IN_OWNER_ONLY', ['owner'])],
    ['BUILT_IN_OWNER_OR_DEPT', meta('BUILT_IN_OWNER_OR_DEPT', ['owner', 'dept'])],
    ['BUILT_IN_FIELD_EQUALS', meta('BUILT_IN_FIELD_EQUALS', [], [spec('field', 'SLOT')])],
    [
      'BUILT_IN_CUSTOM_TREE',
      meta('BUILT_IN_CUSTOM_TREE', [], [spec('conditionTree', 'CONDITION_TREE')])
    ],
    ['BUILT_IN_ALWAYS_TRUE', meta('BUILT_IN_ALWAYS_TRUE', [], [spec('note', 'TEXT')])]
  ])

  /** 槽位映射夹具：3 号有 owner+bizKey、5 号只有 bizKey、6 号有 owner+dept */
  const SLOTS = [
    { resourceId: 3, slot: 'owner' },
    { resourceId: 3, slot: 'bizKey' },
    { resourceId: 5, slot: 'bizKey' },
    { resourceId: 6, slot: 'owner' },
    { resourceId: 6, slot: 'dept' }
  ]

  const coverage = (over: Partial<SlotCoverageInput> = {}) =>
    computeRuleSlotCoverage({
      slotState: 'ready',
      slotMappings: SLOTS,
      resourceIds: [1, 3, 5, 6],
      resourceById: RESOURCES,
      rule: { template: 'BUILT_IN_OWNER_ONLY' },
      templateMeta: TEMPLATE_META,
      ...over
    })

  it('🔴 datasetIds 只收 DATASET —— 菜单与按钮压根不参与行过滤', () => {
    expect(coverage().datasetIds).toEqual([3, 5, 6])
  })

  it('🔴 部分覆盖时报得出是**哪个**资源缺**哪个**槽位', () => {
    const c = coverage()
    expect(c.coveredIds).toEqual([3, 6])
    expect(c.uncoveredIds).toEqual([5])
    expect(c.missingSlots).toEqual(['owner'])
    expect(c.undecidable).toBe(false)
  })

  it('🔴 every 不是 some：OWNER_OR_DEPT 只配了 owner 时算未覆盖', () => {
    const c = coverage({ rule: { template: 'BUILT_IN_OWNER_OR_DEPT' } })
    expect(c.coveredIds).toEqual([6])
    expect(c.uncoveredIds).toEqual([3, 5])
    // 3 号缺 dept、5 号缺 owner 与 dept，并集两个都要报出来（文案要点名）
    expectFields(c.missingSlots, ['owner', 'dept'])
  })

  it('🔴 FIELD_EQUALS 从 params.field 判得出槽位，不是「requiredSlots 为空就算覆盖」', () => {
    const covered = coverage({
      rule: { template: 'BUILT_IN_FIELD_EQUALS', params: JSON.stringify({ field: 'owner' }) }
    })
    expect(covered.undecidable).toBe(false)
    expect(covered.coveredIds).toEqual([3, 6])
    expect(covered.uncoveredIds).toEqual([5])
  })

  it('🔴 FIELD_EQUALS 的 params 里读不出 field 时落 undecidable，而不是当成「不需要槽位」', () => {
    for (const params of [undefined, '{}', 'not json', JSON.stringify({ field: '' })]) {
      const c = coverage({ rule: { template: 'BUILT_IN_FIELD_EQUALS', params } })
      expect(c.undecidable, `params=${params}`).toBe(true)
      expect(c.coveredIds).toEqual([])
      expect(c.uncoveredIds).toEqual([])
    }
  })

  it('🔴 CUSTOM_TREE 恒为 undecidable —— 判不出来既不能报绿也不能报红', () => {
    const c = coverage({
      rule: { template: 'BUILT_IN_CUSTOM_TREE', params: JSON.stringify({ conditionTree: {} }) }
    })
    expect(c.undecidable).toBe(true)
    expect(c.coveredIds).toEqual([])
    expect(c.uncoveredIds).toEqual([])
  })

  it('真·无槽位模板时「全覆盖」是真结论，不是判不出来的兜底', () => {
    const c = coverage({ rule: { template: 'BUILT_IN_ALWAYS_TRUE' } })
    expect(c.undecidable).toBe(false)
    expect(c.coveredIds).toEqual([3, 5, 6])
    expect(c.uncoveredIds).toEqual([])
  })

  it('模板没登记在前端元数据里时落 undecidable（后端加了新模板、前端缓存还是旧的）', () => {
    const c = coverage({ rule: { template: 'BUILT_IN_SOMETHING_NEW' } })
    expect(c.undecidable).toBe(true)
    expect(c.uncoveredIds).toEqual([])
  })

  it('🔴 勾的全是菜单/按钮时 uncoveredIds 为空 —— 纯菜单批量不该每次被红警吓一遍', () => {
    const c = coverage({ resourceIds: [1, 2, 4] })
    expect(c.datasetIds).toEqual([])
    expect(c.coveredIds).toEqual([])
    expect(c.uncoveredIds).toEqual([])
    expect(c.undecidable).toBe(false)
  })

  it.each(['loading', 'failed'] as const)(
    '🔴 slotState=%s 时一律不下「缺槽位」的结论（覆盖度是建议性的，绝不阻断提交）',
    (slotState) => {
      // 5 号明明缺 owner，但槽位数据没到手 —— 报红等于用一句假话拦住一次合法操作，
      // 而操作者没有 system:slot-mapping:query 权限点时请求就会失败
      const c = coverage({ slotState, slotMappings: [], resourceIds: [5] })
      expect(c.state).toBe(slotState)
      expect(c.uncoveredIds).toEqual([])
      expect(c.coveredIds).toEqual([])
      expect(c.undecidable).toBe(false)
      // datasetIds 照算：它只依赖资源树、与槽位数据无关，文案里要点名「D 个数据集」
      expect(c.datasetIds).toEqual([5])
    }
  )

  it('未选规则时不算覆盖度（界面走「未绑定 = 全部行可见」那条文案）', () => {
    const c = coverage({ rule: undefined })
    expect(c.undecidable).toBe(false)
    expect(c.uncoveredIds).toEqual([])
    expect(c.datasetIds).toEqual([3, 5, 6])
  })
})

describe('findUnspecifiedConflicts', () => {
  const input = (over: Partial<GrantBatchInput> = {}): GrantBatchInput => ({
    ...BASE,
    resourceIds: [1, 3],
    actions: ['VIEW', 'DELETE'],
    ...over
  })
  const EXISTING = new Map<string, GrantMergeSource>([
    [grantRowKey(3, undefined, 'VIEW'), { ruleId: 11, fieldMode: 'HIDDEN' }],
    [grantRowKey(1, undefined, 'VIEW'), { expireTime: '2030-01-01 23:59:59' }],
    // 有行但三个字段全空：覆盖它不会丢任何东西，不该把它算进弹窗那个数
    [grantRowKey(3, undefined, 'DELETE'), {}]
  ])

  it('本次什么都没填 → 两行会被抹掉配置，字段名去重', () => {
    const r = findUnspecifiedConflicts(input(), EXISTING)
    expect(r.rows).toBe(2)
    expectFields(r.fields, ['行过滤规则', '字段显示模式', '到期时间'])
  })

  it('🔴 本次填了规则 → 规则不再算「会被抹掉」', () => {
    const r = findUnspecifiedConflicts(input({ ruleId: 99 }), EXISTING)
    expect(r.rows).toBe(2)
    expectFields(r.fields, ['字段显示模式', '到期时间'])
  })

  it('既有 map 为空 → 0 行（没什么可保留的，那个三态弹窗压根不该出现）', () => {
    expect(findUnspecifiedConflicts(input(), new Map())).toEqual({ rows: 0, fields: [] })
  })

  it('既有行三个字段全空 → 不算冲突行', () => {
    const r = findUnspecifiedConflicts(input({ resourceIds: [3], actions: ['DELETE'] }), EXISTING)
    expect(r).toEqual({ rows: 0, fields: [] })
  })

  it('既有行不在本次勾选范围里 → 不算冲突（弹窗不能报一个本次碰不着的行）', () => {
    const r = findUnspecifiedConflicts(input({ resourceIds: [1], actions: ['DELETE'] }), EXISTING)
    expect(r.rows).toBe(0)
  })

  it('🔴 报出的行数 = expandGrantBatch 实际补回旧值的行数（两边迭代空间必须同源）', () => {
    // 漂了的后果是弹窗说「3 行」而实际覆盖 5 行 —— 报少了是假安全，报多了是狼来了
    const batch = input()
    const items = expandGrantBatch({ ...batch, mergeFrom: EXISTING })
    const merged = items.filter((item) => item.ruleId || item.fieldMode || item.expireTime)
    expect(findUnspecifiedConflicts(batch, EXISTING).rows).toBe(merged.length)
  })
})

describe('intersectGrantActionOptions', () => {
  it("['MENU'] 收窄掉流程专属动作", () => {
    const values = valuesOf(intersectGrantActionOptions(['MENU']))
    for (const action of PROCESS_ONLY) {
      expect(values).not.toContain(action)
    }
    expect(values).toContain('VIEW')
  })

  it("🔴 ['PROCESS', 'CATEGORY'] 保留 START/DESIGN/MANAGE/VIEW_ALL —— 交集基数必须是全集", () => {
    // 基数若写成 grantActionOptionsFor(undefined)，它已经滤掉了 processOnly 那四项，
    // 于是「勾的全是流程/分类」这个**唯一能配出流程动作**的场景反而配不出来
    const values = valuesOf(intersectGrantActionOptions(['PROCESS', 'CATEGORY']))
    expect(values).toEqual(expect.arrayContaining(PROCESS_ONLY))
  })

  it("['MENU', 'PROCESS'] 取交集：混了非流程资源就裁掉流程专属动作", () => {
    const values = valuesOf(intersectGrantActionOptions(['MENU', 'PROCESS']))
    for (const action of PROCESS_ONLY) {
      expect(values).not.toContain(action)
    }
  })

  it('空数组回落到「不按类型收窄」，与 grantActionOptionsFor(undefined) 逐项相同', () => {
    expect(intersectGrantActionOptions([])).toEqual(grantActionOptionsFor(undefined))
  })

  it('预留动作在任何组合下都保留 ——「一次开 查看/新增/修改/删除」配的正是它们', () => {
    const combos: (string | undefined)[][] = [
      [],
      ['MENU'],
      ['DATASET'],
      ['PROCESS', 'CATEGORY'],
      ['MENU', 'PROCESS'],
      ['COLUMN', 'FIELD']
    ]
    for (const combo of combos) {
      const values = valuesOf(intersectGrantActionOptions(combo))
      for (const action of RESERVED) {
        // 裁掉预留动作等于砍掉批量授权的一半用途；
        // 「配了不生效」由 reservedActionWarning 的常驻警告说明，不是靠从选项里消失来暗示
        expect(values, `组合 ${JSON.stringify(combo)} 少了 ${action}`).toContain(action)
      }
    }
  })

  it('返回顺序与 GRANT_ACTION_OPTIONS 一致（列表页搜索下拉与批量表单要对得上号）', () => {
    const order = valuesOf(GRANT_ACTION_OPTIONS)
    const values = valuesOf(intersectGrantActionOptions(['MENU']))
    expect(values).toEqual(order.filter((value) => values.includes(value)))
  })
})

describe('collectSubtreeIds / buildSubtreeIndex', () => {
  /**
   * 三层森林，形状照 handleTree 的真实产出：顶层两条，一条有下级、一条是叶子。
   * 本库 sys_resource 的 depth 分布是 1/2/3/4，这个夹具覆盖到「有下级的行」这一类就够了 ——
   * 按钮只在有下级的行上渲染
   */
  const forest = [
    {
      id: 1,
      children: [{ id: 2, children: [{ id: 4 }, { id: 5, children: [] }] }, { id: 3 }]
    },
    { id: 6 }
  ]

  it('单节点 → 只含自身；没有 children 字段与 children: [] 都算叶子', () => {
    expect(collectSubtreeIds({ id: 6 })).toEqual([6])
    expect(collectSubtreeIds({ id: 5, children: [] })).toEqual([5])
  })

  it('🔴 前序遍历、含自身、无重复', () => {
    const ids = collectSubtreeIds(forest[0])
    // 含自身是「全选下级」的语义要求：点一个菜单，它自己也得被授上，
    // 否则配出来的是「下面的按钮全给了、菜单本身看不见」这种自相矛盾的组合
    expect(ids).toEqual([1, 2, 4, 5, 3])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('森林里每个节点都有一条，叶子映射到只含自身的数组', () => {
    const index = buildSubtreeIndex(forest)
    expect([...index.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    expect(index.get(4)).toEqual([4])
    expect(index.get(5)).toEqual([5])
    expect(index.get(6)).toEqual([6])
  })

  it('🔴 索引与 collectSubtreeIds 同源：每个节点的条目就等于对它自己跑一次收集', () => {
    // 索引是「按钮上显示的数量」与 setCheckedKeys 入参的唯一来源。
    // 若这里另写一份遍历，两份逻辑漂移之后按钮写着 5 而实际勾中 4 —— 静默少授一个资源，
    // 而少掉的那个通常是最不起眼的叶子
    const index = buildSubtreeIndex(forest)
    const walk = (nodes: any[]) => {
      nodes.forEach((node) => {
        expect(index.get(node.id), `节点 ${node.id}`).toEqual(collectSubtreeIds(node))
        if (node.children?.length) walk(node.children)
      })
    }
    walk(forest)
  })

  it('父节点的条目 = 自身 + 各子节点的条目拼接（括号里那个数就是这么来的）', () => {
    const index = buildSubtreeIndex(forest)
    expect(index.get(1)).toEqual([1, ...index.get(2)!, ...index.get(3)!])
  })

  it('空树 → 空索引', () => {
    expect(buildSubtreeIndex([]).size).toBe(0)
  })
})

describe('isSubtreeFullyChecked', () => {
  it('🔴 undefined → false：没有索引的行必须显示「全选下级」', () => {
    // 显示成「取消下级」的话，点下去是把一个**没勾上的**资源当成已勾的去取消，
    // 用户看到的就是按钮按了没反应
    expect(isSubtreeFullyChecked(undefined, new Set([1, 2]))).toBe(false)
  })

  it('空数组 → false，而不是 every 的空真', () => {
    expect(isSubtreeFullyChecked([], new Set([1]))).toBe(false)
    expect(isSubtreeFullyChecked([], new Set())).toBe(false)
  })

  it('整片勾上 → true（按钮就地翻成「取消下级」）', () => {
    expect(isSubtreeFullyChecked([1, 2, 4], new Set([1, 2, 4]))).toBe(true)
  })

  it('少勾一个 → false：手动取消掉一个子项后按钮必须回到「全选下级」，一个都没勾同理', () => {
    expect(isSubtreeFullyChecked([1, 2, 4], new Set([1, 2]))).toBe(false)
    expect(isSubtreeFullyChecked([1, 2, 4], new Set([2, 4]))).toBe(false)
    expect(isSubtreeFullyChecked([1, 2, 4], new Set())).toBe(false)
  })

  it('勾了子树外的资源不影响判定 —— 只看这一片，不看总数', () => {
    expect(isSubtreeFullyChecked([1, 2], new Set([1, 2, 99, 100]))).toBe(true)
    expect(isSubtreeFullyChecked([1, 2], new Set([99, 100]))).toBe(false)
  })
})

describe('confirmPastExpireTime', () => {
  // ⚠️ 只测两条不弹窗的分支：vitest.config.ts 刻意不带自动导入插件
  // （见它自己的注释），`useMessage` 在 node 环境里是个未定义的全局，
  // 走到弹窗那条分支只会抛 ReferenceError，测不出任何有意义的东西。
  // 弹窗分支的行为由手工验证覆盖
  it('没填到期时间时直接放行', async () => {
    await expect(confirmPastExpireTime(undefined)).resolves.toBe(true)
  })

  it('到期时间在未来时直接放行', async () => {
    await expect(confirmPastExpireTime('2999-01-01 00:00:00')).resolves.toBe(true)
  })
})
