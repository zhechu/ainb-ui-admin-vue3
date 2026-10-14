import dayjs from 'dayjs'
import type { GrantSaveReqVO, RuleTemplateMetaItemVO } from '@/api/system/grant'
import {
  GRANT_ACTION_OPTIONS,
  grantActionOptionsFor,
  isRowFilterableResource,
  type GrantActionOption
} from '@/views/system/resource/constants'

/**
 * 授权表单共用的纯函数。
 *
 * 单独成一个模块而不是写在 GrantBatchForm.vue 里，是为了能被 vitest 直接测：
 * `expandGrantBatch` 与 `intersectGrantActionOptions` 决定「提交出去的是哪些行」，
 * 写错了不会报错、只会静默配出错误权限。而弹窗组件要 mount 才测得到，
 * 本仓的 vitest.config.ts 刻意不挂自动导入插件，`useMessage` 这类全局在测试
 * 环境里是未定义的，组件测不起来 —— 纯函数是唯一能被钉住的那一层
 */

/**
 * 单次批量授权的条数上限，与后端 `GrantBatchSaveReqVO#items` 上的 `@Size(max = 500)` 互为镜像。
 *
 * ⚠️ 改一处必须改另一处：这里放大了，用户会先看到本地计数通过、再吃一个后端 400；
 * 这里缩小了，后端的余量白留着没人用。前端拦的意义在于提交**之前**就能看见，
 * 而不是等一次网络往返换回一句参数错误
 */
export const GRANT_BATCH_MAX_ITEMS = 500

/**
 * 取一批资源类型上「都配得通」的动作交集。
 *
 * **为什么是交集不是并集**：并集会在勾了 MENU 时把 START / DESIGN / MANAGE / VIEW_ALL
 * 也端出来，选中即产生「能保存但永不参与鉴权」的死行 —— 单条表单里那是一行，
 * 批量入口一次就是 N 行（每个资源一份），正是 upsert 要消灭的那类噪声。
 *
 * **为什么交集必须保留预留动作**：`effective = false` 的 CREATE / UPDATE / DELETE /
 * EXPORT / IMPORT / PRINT / REFERENCE 一个都不能裁 ——「一次给一个资源开
 * 查看/新增/修改/删除」这个高频场景配的**正是预留动作**，裁掉它们等于砍掉批量授权的
 * 一半用途。它们配了不生效这件事由 `reservedActionWarning` 的常驻警告负责说明，
 * 不是靠从选项里消失来暗示。
 *
 * @param resourceTypes 已勾选资源的类型列表；空数组表示还没勾，回落到「不按类型收窄」
 */
export const intersectGrantActionOptions = (
  resourceTypes: (string | undefined)[]
): GrantActionOption[] => {
  if (!resourceTypes.length) return grantActionOptionsFor(undefined)
  const allowed = resourceTypes.map(
    (type) => new Set(grantActionOptionsFor(type).map((item) => item.value))
  )
  // 🔴 基数是 GRANT_ACTION_OPTIONS 全集，不是 grantActionOptionsFor(undefined)：
  // 后者已经滤掉了 processOnly 那四项，拿它当基数会让「勾的全是 PROCESS / CATEGORY」时
  // START / DESIGN / MANAGE / VIEW_ALL 错误地消失 —— 而这恰好是唯一能配出它们的场景
  return GRANT_ACTION_OPTIONS.filter((item) => allowed.every((set) => set.has(item.value)))
}

/**
 * 既有授权行上「批量表单管不着」的那几个字段的快照。
 *
 * 允许 null：后端 GrantRespVO 对空值返回的就是 null，不是 undefined
 */
export interface GrantMergeSource {
  ruleId?: number | null
  fieldMode?: string | null
  expireTime?: string | null
}

/**
 * 授权行的键，镜像后端 `GrantAdminServiceImpl.GrantKey` **去掉主体三元组**。
 *
 * 去掉是因为既有行是按主体查回来的（`getGrantListBySubject('ROLE', refId)`），
 * 一个抽屉里主体恒定，入键只会让每个键都拖着同一段前缀。
 * `contextResourceId` 保留：后端键里有它，批量展开虽然从不填（永远传 undefined），
 * 但既有行可能有值 —— 少了这一段，一条带上下文的行会被误判成「和本次要写的行同键」，
 * 于是它的 ruleId / fieldMode 被补到一条其实不相干的行上
 */
export const grantRowKey = (
  resourceId: number,
  contextResourceId: number | undefined,
  action: string
): string => `${resourceId}|${contextResourceId ?? ''}|${action}`

export interface GrantBatchInput {
  subjectType: string
  subjectRefId?: number
  resourceIds: number[]
  actions: string[]
  effect: string
  expireTime?: string
  /** 本次要绑的行过滤规则；不填 = 不绑（该主体能看到这些表的全部行） */
  ruleId?: number
  /**
   * 资源 id → 资源，用来判 ruleId 该不该落在这一行上。
   *
   * 🔴 **必填，不给默认值**：缺了它 `isRowFilterableResource(undefined)` 恒为 false，
   * 于是所有行都不写 ruleId —— 用户选了规则、提交成功、一条都没生效，且没有任何报错。
   * 一个「漏传就静默降级成 no-op」的入参不能是可选的
   */
  resourceById: ReadonlyMap<number, { type?: string }>
  /**
   * 既有行快照，键见 `grantRowKey`。**传 = 保留**：本次未填的字段沿用旧值；
   * **不传 = 覆盖**：未填的字段一律不写，后端按 null 落库。
   *
   * 🔴 「不传」那半边是**放权方向**的：GrantDO#ruleId / #fieldMode / #expireTime 都标了
   * `@TableField(updateStrategy = FieldStrategy.ALWAYS)`，而 GrantAdminServiceImpl#doUpsert
   * 命中既有行走的是 `updateById` —— null 会真的写进去。行过滤放开成「全部行可见」、
   * `HIDDEN` 的字段重新露出来。所以这张 map 由提交前那个三态弹窗决定传不传，
   * 安全默认是传（保留），清除需要操作者显式点第二个按钮。
   *
   * 用「传不传这张 map」表达选择，而不是加一个 `preserve` 布尔：布尔会让纯函数分出两种行为，
   * 而 map 为空时天然等价于「没什么可保留的」，两条路径收敛成一条
   */
  mergeFrom?: ReadonlyMap<string, GrantMergeSource>
}

/**
 * 把「资源多选 × 动作多选」展开成后端要的 `List<GrantSaveReqVO>`。
 *
 * **为什么在前端展开**：后端只收一个扁平列表，于是「单条新增」就是 size=1 的批量，
 * 两个入口共用同一份校验 —— 若改由后端展开，就得再造一个
 * `resourceIds + actions + 共用字段` 形状的 VO 和第二套校验路径，
 * 而这个 fork 刚被「两份看起来一样的逻辑各自漂移」咬过
 * （动作词表四副本、syncRoleMenuGrants 的血泪注释）。
 * 另一个原因是收窄规则的领域知识只在前端：`processOnly` 元数据在 constants.ts 里，
 * 后端 GrantActionEnum 没有这个概念。
 *
 * **顺序固定为「资源外层、动作内层」**：与弹窗里那句「N 资源 × M 动作 = X 行」的预览
 * 同口径，出问题时能逐行对着核对。
 *
 * **带了什么、刻意不带什么**：
 * - `ruleId`：**本轮开始带**，但只写在 DATASET 行上（见函数体那两处 🔴）。
 *   原先这里写着「行过滤规则是精配动作，批量铺完骨架之后到列表页逐条编辑才对」——
 *   这条决定被推翻了。理由不是「精配不精配」，而是本库有 1801 行存活授权，
 *   「到列表页逐条编辑」不是麻烦，是做不完。
 * - `fieldMode`：仍然不带。它与 ruleId 的差别不在粗细，而在**能不能判有效性**：
 *   ruleId 对整个 DATASET 行有意义，勾没勾到数据集是查得出来的；
 *   fieldMode 只对 COLUMN / FIELD 有意义，而字段级资源默认不在树里
 *   （`useResourceCatalog` 的 includeFieldLevel 开关默认关），批量入口根本拿不到它们，
 *   配出来只可能是无效行。它被误清空的问题由 mergeFrom 那条路径修，
 *   不是由「让用户在批量里配 fieldMode」修。
 * - `contextResourceId`：仍然不带 —— 连单条表单都没有这个入口，后端
 *   `GrantAdminServiceImpl#validateResourcesExist` 的注释也写着它当前无任何 UI 会填。
 */
export const expandGrantBatch = (input: GrantBatchInput): GrantSaveReqVO[] => {
  const items: GrantSaveReqVO[] = []
  for (const resourceId of input.resourceIds) {
    // 🔴 ruleId 只写给数据集行。绑在 MENU / ACTION / COLUMN 上后端从不读它
    //（GrantDecisionEngine#isAllowed 与 #resolveFieldMode 都不看 ruleId，行过滤也不沿资源树上溯），
    // 而列表页会把它渲染成一个其实不存在的限制 —— 那不是中性噪声，是假信息
    const rowRuleId = isRowFilterableResource(input.resourceById.get(resourceId)?.type)
      ? input.ruleId
      : undefined
    for (const action of input.actions) {
      const merge = input.mergeFrom?.get(grantRowKey(resourceId, undefined, action))
      const item: GrantSaveReqVO = {
        subjectType: input.subjectType,
        subjectRefId: input.subjectRefId,
        resourceId,
        action,
        effect: input.effect
      }
      const expireTime = input.expireTime || merge?.expireTime || undefined
      const ruleId = rowRuleId ?? merge?.ruleId ?? undefined
      const fieldMode = merge?.fieldMode || undefined
      // 🔴 三个字段都只在**有值时**才落键。留着 `ruleId: undefined` 在网络上等价
      //（JSON.stringify 会丢掉它），但会让 `'ruleId' in item` 恒为 true ——
      // 那条钉住「死字段不写」的断言就废了，而它正是本轮的核心取舍
      if (expireTime) item.expireTime = expireTime
      if (ruleId != null) item.ruleId = ruleId
      if (fieldMode) item.fieldMode = fieldMode
      items.push(item)
    }
  }
  return items
}

export interface SlotCoverageInput {
  /** 槽位映射那份数据的取数状态；不是 'ready' 时一律不下「缺槽位」的结论 */
  slotState: 'loading' | 'ready' | 'failed'
  /** 全量槽位映射；slotState !== 'ready' 时不读 */
  slotMappings: readonly { resourceId: number; slot: string }[]
  resourceIds: readonly number[]
  resourceById: ReadonlyMap<number, { type?: string }>
  /** 当前选中的规则；未选时传 undefined */
  rule?: { template?: string; params?: string }
  /** code → 模板元数据，来自 useRuleTemplateMeta 的 templateMap */
  templateMeta?: ReadonlyMap<string, RuleTemplateMetaItemVO>
}

export interface RuleSlotCoverage {
  state: 'loading' | 'ready' | 'failed'
  /** 已勾资源里 type=DATASET 的那些 —— 只有它们会被行过滤读到 */
  datasetIds: number[]
  coveredIds: number[]
  /** 🔴 state !== 'ready' 时**恒为空数组**，理由见 computeRuleSlotCoverage */
  uncoveredIds: number[]
  /** 该规则依赖哪些槽位判不出来（槽位写在参数里、模板没登记、或参数缺失） */
  undecidable: boolean
  /** 未覆盖资源上实际缺的槽位并集，供文案点名「缺 owner 槽位」 */
  missingSlots: string[]
}

/**
 * 从规则的 params JSON 里读一个槽位名。读不出来返回 undefined（= 判不了），
 * **绝不返回空串当作「不需要槽位」** —— 那会把一个 fail-close 的规则报成绿色
 */
const readParamSlot = (params: string | undefined, key: string): string | undefined => {
  if (!params) return undefined
  try {
    const value = JSON.parse(params)?.[key]
    return typeof value === 'string' && value ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * 算「已勾资源里，哪些具备当前规则要求的槽位」。
 *
 * **为什么要算**：缺槽位不是「规则不生效」，是**整张业务表一行都查不出来**。
 * `ConditionTreeEvaluator#buildConditionSql` 查不到列名只打一条 WARN 然后返回空串，
 * 整条规则求成空片段时 `DataRowFilterResolver#resolve` 给 ALLOW 补 `1=0`、DENY 走 denyAll。
 * 本库槽位覆盖极稀（owner 只有 22 个资源配了、dept 只有 2 个），
 * 所以把 OWNER_ONLY 铺到一百个数据集上，大部分会当场失明且不报错。
 * 这类后果必须在提交**之前**看得见。
 *
 * 🔴 **state !== 'ready' 时 uncoveredIds 必须是空数组**。覆盖度是**建议性**的：
 * 拿不到槽位数据就退化成「无法核对」，绝不阻断提交，也绝不把 178 个数据集全报成缺槽位 ——
 * 操作者没有 `system:slot-mapping:query` 权限点时请求会失败，
 * 那时报红等于用一句假话拦住一次合法操作。
 *
 * 🔴 **undecidable 的判据不是 `requiredSlots.length === 0`**：FIELD_EQUALS 与 CUSTOM_TREE
 * 的 requiredSlots 都是空的，但它们的槽位恰恰写在参数里，而且正是 fail-close 最凶的两类。
 * 拿「空 ⇒ 已覆盖」当判据，会把最危险的规则报成绿色；将来真新增一个无槽位模板时，
 * 它还会静默继承这个错判。所以判据落在 paramSpecs 的 kind 上
 */
export const computeRuleSlotCoverage = (input: SlotCoverageInput): RuleSlotCoverage => {
  const datasetIds = input.resourceIds.filter((id) =>
    isRowFilterableResource(input.resourceById.get(id)?.type)
  )
  const base: RuleSlotCoverage = {
    state: input.slotState,
    datasetIds,
    coveredIds: [],
    uncoveredIds: [],
    undecidable: false,
    missingSlots: []
  }
  if (!input.rule) return base
  if (input.slotState !== 'ready') return base

  const meta = input.rule.template ? input.templateMeta?.get(input.rule.template) : undefined
  // 模板没登记（后端新增了模板、前端元数据缓存还是旧的）→ 判不出来，不能默认绿
  if (!meta) return { ...base, undecidable: true }

  const requiredSlots = [...meta.requiredSlots]
  for (const spec of meta.paramSpecs) {
    // 条件树里每个节点自带 slot，要递归收集才知道依赖哪些槽位。本轮不做，但绝不能显示成绿色
    if (spec.kind === 'CONDITION_TREE') return { ...base, undecidable: true }
    if (spec.kind !== 'SLOT') continue
    // FIELD_EQUALS 这类「槽位名写在参数里」的模板是**可判**的：params[spec.key] 就是槽位名
    const slot = readParamSlot(input.rule.params, spec.key)
    if (!slot) return { ...base, undecidable: true }
    requiredSlots.push(slot)
  }

  // 走到这里 requiredSlots 为空 = 该模板确实不依赖任何资源槽位，「全覆盖」是真结论
  if (!requiredSlots.length) return { ...base, coveredIds: datasetIds }

  const slotsByResource = new Map<number, Set<string>>()
  for (const mapping of input.slotMappings) {
    const owned = slotsByResource.get(mapping.resourceId)
    if (owned) owned.add(mapping.slot)
    else slotsByResource.set(mapping.resourceId, new Set([mapping.slot]))
  }

  const coveredIds: number[] = []
  const uncoveredIds: number[] = []
  const missingSlots = new Set<string>()
  for (const id of datasetIds) {
    const owned = slotsByResource.get(id)
    // 🔴 every 不是 some：OWNER_OR_DEPT 要 [owner, dept] 两个，只配了 owner 照样求不出条件
    const lacked = requiredSlots.filter((slot) => !owned?.has(slot))
    if (lacked.length) {
      uncoveredIds.push(id)
      lacked.forEach((slot) => missingSlots.add(slot))
    } else {
      coveredIds.push(id)
    }
  }
  return { ...base, coveredIds, uncoveredIds, missingSlots: [...missingSlots] }
}

/** 二次确认弹窗里要报的字段中文名，顺序即弹窗里的列出顺序 */
const MERGE_FIELD_LABELS: { key: keyof GrantMergeSource; label: string }[] = [
  { key: 'ruleId', label: '行过滤规则' },
  { key: 'fieldMode', label: '字段显示模式' },
  { key: 'expireTime', label: '到期时间' }
]

export interface UnspecifiedConflicts {
  /** 会被抹掉至少一项既有配置的授权行数 */
  rows: number
  /** 涉及的字段中文名，去重 */
  fields: string[]
}

/**
 * 找出「本次没填、但既有行上有值」的行 —— 也就是选「按本次填写覆盖」会被抹掉的东西。
 *
 * 存在的理由是那个覆盖 bug 的**可见性**：后端 FieldStrategy.ALWAYS + updateById 会把 null
 * 真写进库，而批量表单没有 fieldMode 控件、ruleId 也可能空着。不报数的话，
 * 操作者点一次「确定」就静默放权，事后只能靠「我明明配过怎么没了」来发现。
 *
 * ⚠️ 迭代的空间必须与 `expandGrantBatch` 一致（resourceIds × actions，contextResourceId 恒空）。
 * 两边漂移的后果是弹窗报的行数与实际被覆盖的行数不是同一个数 —— 报少了是假安全，
 * 报多了是狼来了。spec 里有一条用例专门钉这个耦合
 */
export const findUnspecifiedConflicts = (
  input: GrantBatchInput,
  existingByKey: ReadonlyMap<string, GrantMergeSource>
): UnspecifiedConflicts => {
  if (!existingByKey.size) return { rows: 0, fields: [] }
  // 本次表单里「没填」的字段。fieldMode 恒为 true：批量表单压根没有这个控件
  const blank: Record<keyof GrantMergeSource, boolean> = {
    ruleId: input.ruleId == null,
    fieldMode: true,
    expireTime: !input.expireTime
  }
  const fields = new Set<string>()
  let rows = 0
  for (const resourceId of input.resourceIds) {
    for (const action of input.actions) {
      const existing = existingByKey.get(grantRowKey(resourceId, undefined, action))
      if (!existing) continue
      const lost = MERGE_FIELD_LABELS.filter(({ key, label }) => {
        if (!blank[key] || existing[key] == null) return false
        fields.add(label)
        return true
      })
      if (lost.length) rows++
    }
  }
  return { rows, fields: [...fields] }
}

/**
 * 收集「该资源 + 它下面全部资源」的 id，**含自身**，前序遍历。
 *
 * 树结构相关的三件事（收集、建索引、判断是否已整片勾上）都放在这个模块里而不是
 * 写在 GrantBatchForm.vue 里，理由与本模块其它函数相同：组件测不动，纯函数测得动。
 * 而这三件事决定「点一次『全选下级』到底勾上了哪些资源」，错了不会报错，
 * 只会静默多授或少授一片权限
 */
export const collectSubtreeIds = (node: any): number[] => {
  const ids: number[] = []
  const walk = (n: any) => {
    ids.push(n.id)
    n.children?.forEach(walk)
  }
  walk(node)
  return ids
}

/**
 * 一次性建好 资源 id → 子树 id 列表 的索引。
 *
 * **为什么不在模板里现算**：按钮文案要在每次勾选变化后对每个可见行重算一遍
 * （「全选下级」还是「取消下级」取决于该片是否已勾满）。树有一两千个节点，
 * 虚拟化下一屏约 20 行，而顶层菜单的子树能有几百个 id —— 现算就是
 * 20 × 几百 次遍历、每次重渲染都来一遍。建一次索引后每行只剩一次 Map 查 + 一次 every
 *
 * 内部走 collectSubtreeIds 而不是另写一份遍历：两份遍历逻辑迟早漂移，
 * 漂了之后「按钮上显示的数量」与「点下去实际勾中的数量」就不是同一个数了
 */
export const buildSubtreeIndex = (tree: any[]): Map<number, number[]> => {
  const index = new Map<number, number[]>()
  const walk = (nodes: any[]) => {
    nodes.forEach((node) => {
      index.set(node.id, collectSubtreeIds(node))
      if (node.children?.length) walk(node.children)
    })
  }
  walk(tree)
  return index
}

/**
 * 该片资源是否已被完整勾选 —— 决定按钮显示「取消下级」还是「全选下级」。
 *
 * ⚠️ 没有索引（`undefined`）或空数组时返回 **false**：这类行本来就不该渲染按钮
 * （叶子节点没有下级），但万一渲染出来了，显示「全选下级」至多是多点一次，
 * 显示「取消下级」则会把一个**没勾上的**资源当成已勾上的去取消，看着像按钮失灵
 */
export const isSubtreeFullyChecked = (
  subtreeIds: number[] | undefined,
  checkedSet: ReadonlySet<number>
): boolean => {
  if (!subtreeIds?.length) return false
  return subtreeIds.every((id) => checkedSet.has(id))
}

/**
 * 到期时间填了过去的时间 = 保存即「已过期」，几乎一定是手误，先问一句。
 *
 * 抽出来是给单条表单与批量表单共用的：**两个入口必须是同一句文案**。
 * 同一个手误在两处得到不同提示，用户会以为是两回事
 *
 * @returns true 表示可以继续提交（没填到期时间、时间不在过去、或用户点了继续）
 */
export const confirmPastExpireTime = async (expireTime?: string): Promise<boolean> => {
  if (!expireTime || !dayjs(expireTime).isBefore(dayjs())) return true
  const message = useMessage()
  const ok = await message
    .confirm('到期时间早于当前时间，保存后该授权会立即处于「已过期」状态。是否继续？')
    .catch(() => false)
  return !!ok
}
