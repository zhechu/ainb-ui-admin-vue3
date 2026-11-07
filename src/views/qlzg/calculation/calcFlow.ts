import type { QlzgMethodCodes, QlzgParamSchemaItem } from '@/api/qlzg/category'
import type { QlzgCaseCandidateVO, QlzgCaseRecallVO } from '@/api/qlzg/case'
import type {
  QlzgCalculationRunVO,
  QlzgCaseMatchVO,
  QlzgCaseSelection,
  QlzgParamConfirmItem
} from '@/api/qlzg/calculation'
import type { QlzgParamConfirmItemVO, QlzgParamConfirmPreviewVO } from '@/api/qlzg/param'
import type { QlzgParamSnapshotChangeVO, QlzgParamSnapshotVO } from '@/api/qlzg/paramSnapshot'
import { VALUATION_METHOD_MVP_OPTIONS, labelOf } from '@/views/qlzg/constants'
import {
  displayPrecision,
  displayRange,
  isAbsent,
  toDisplayValue,
  toStoredValue
} from '@/views/qlzg/subject/attrSchema'
import { valueKindOf, type ParamValueKind } from '@/views/qlzg/param/paramSchema'

/**
 * 测算工作台：确认闸 / 案例终选 / 提交装配 / 明细渲染的**唯一**一段可测逻辑
 *
 * <h3>🔴 为什么单独一个纯模块，而不是写在 `CalcRunDialog.vue` 里</h3>
 * 本仓 vitest **没有 jsdom**，组件挂载测不了。而这一页恰好是全 qlzg 前端里
 * 「界面看着对、提交上去被后端拒」风险最高的一处：它要在一个请求里同时满足
 * 三份互相独立的清单（方法的必需参数键、方法的必需标的属性、召回的候选集合），
 * 而这三份清单**都不在**它读的那个接口里 —— 确认闸预览给的是 `param_schema` 的
 * `required`，那是**另一份清单**（见下面 `METHOD_REQUIREMENTS` 的注释）。
 * 所以能在提交前算出来的约束，一律在这里算，并写用例钉住。
 *
 * <h3>🔴 这个模块不许 import `@/config/axios`</h3>
 * 对 `@/api/qlzg/*` 一律用 `import type`：那些模块 value-import 了 axios，
 * 而 axios 在 collect 阶段就读 `window`，vitest 下会直接 `window is not defined`
 * 让整个文件收集失败（不是某条用例失败，是**一条都跑不起来**）。
 * 这是本仓全部 qlzg spec 的共同前提。
 */

// ==================== 四个方法的必需清单（后端 Java 常量的手写副本） ====================

/** 一个方法对输入的三份要求 */
export interface MethodRequirements {
  /**
   * 后端 `ValuationMethod#requiredParamKeys()`，**有序**
   *
   * 🔴 这份清单与确认闸预览里的 `item.required`（来自 `param_schema.required`）
   *    **不是一回事**，两份都可能缺对方有的键：
   *    预览那份是「这个品类认为该填的参数」，这份是「这个方法的算式真要读的参数」。
   *    后端的闸只认这一份（`QlzgCalculationServiceImpl` 取
   *    `method.requiredParamKeys()` 传给 `freeze`）。
   *    ⚠️ 拿预览的 `required` 当闸用，表现是：用户把界面上标红的都确认了，
   *    点提交，收到 `PARAM_CONFIRM_REQUIRED` 报出几个界面上**没有标成必填**的键 ——
   *    他会认为界面在骗他
   */
  paramKeys: string[]
  /**
   * 后端 `ValuationMethod#requiredSubjectAttrs()`，**有序**
   *
   * 🔴 补的地方不一样：参数在确认闸补，属性在**标的属性页**补。
   *    缺了它后端落 `CALCULATION_INPUT_REQUIRED`，与缺参数的
   *    `PARAM_CONFIRM_REQUIRED` 是两个码 —— 后端刻意分开，
   *    前端也要把两个入口分开指（一个跳参数库、一个跳标的编辑）
   */
  subjectAttrs: string[]
  /**
   * 后端 `ValuationMethod#requiresCaseSet()`
   *
   * 🔴 为真时第②步（案例终选）才出现，且至少要终选一条，
   *    否则 `CALCULATION_CASE_REQUIRED`。为假时**不要**发 `caseSelections`：
   *    发了也会写进 `qlzg_case_match`，于是档案里出现「这条案例参与过成本法测算」
   *    这样一个与算式无关的假事实，而 R47（候选条数）读的正是那些行
   */
  requiresCaseSet: boolean
}

/**
 * 四个已实现方法的必需清单
 *
 * <h3>🔴 这是**手写**的黄金副本，不是从后端生成的</h3>
 * 从 Java 源码扫出来再拿去和 Java 比是同义反复，恒绿。四份来源：
 * `MarketComparisonMethod`（`CHAIN` 的五个 `adj_*`）、`IncomeApproachMethod`、
 * `CostMethod`、`HypotheticalDevelopmentMethod` 各自的
 * `REQUIRED_PARAM_KEYS` / `REQUIRED_SUBJECT_ATTRS` / `requiresCaseSet()`。
 *
 * <h3>⚠️ 副本漂了会怎样：两个方向都是**响的**，所以这份副本可以接受</h3>
 * - 后端多了一个必需键、这里没跟上 → 界面不标它必填，用户提交，
 *   后端 `PARAM_CONFIRM_REQUIRED` 的文案里**逐字列出**缺哪几个键。用户被挡住，
 *   但拿到了可操作的信息，不会产生一个错的数。
 * - 这里多写了一个键 → 界面多标一个必填，用户被要求确认一个后端不要求的参数。
 *   提交按钮点不动，也是响的。
 *
 * 🔴 与「`%` 存分数」那类规则的区别正在这里：那一份漂了是**静默**的
 *    （数字看着对、算出来错），所以只能有一份实现；这一份漂了是**响**的，
 *    所以副本 + 用例钉住是划算的。真要漂，改这个文件的人必须先改
 *    `calcFlow.spec.ts` 里那份逐字断言 —— 那是一次显式决定。
 *
 * 🔴 键名**逐字**抄，包括 `development_tax_fee_rate` / `development_profit_rate`
 *    这两个带 `development_` 前缀的（`HypotheticalDevelopmentMethod` 里
 *    常量名叫 `PARAM_TAX_FEE_RATE` / `PARAM_PROFIT_RATE`，**值**才是带前缀的键；
 *    按常量名去猜键会写成 `tax_fee_rate`，而那个键在 schema 里不存在，
 *    于是这一项永远显示成「未命中」）
 */
export const METHOD_REQUIREMENTS: Record<string, MethodRequirements> = {
  MARKET_COMPARISON: {
    paramKeys: [
      'adj_transaction',
      'adj_market_time',
      'adj_location',
      'adj_physical',
      'adj_equity'
    ],
    subjectAttrs: ['building_area', 'area_type'],
    requiresCaseSet: true
  },
  INCOME_APPROACH: {
    paramKeys: ['capitalization_rate', 'vacancy_rate', 'operating_expense_ratio'],
    subjectAttrs: ['annual_potential_income', 'building_area'],
    requiresCaseSet: false
  },
  COST: {
    paramKeys: ['replacement_cost', 'condition_rate_method'],
    subjectAttrs: ['building_area'],
    requiresCaseSet: false
  },
  HYPOTHETICAL_DEVELOPMENT: {
    paramKeys: ['replacement_cost', 'development_tax_fee_rate', 'development_profit_rate'],
    subjectAttrs: ['developed_value', 'building_area'],
    requiresCaseSet: false
  }
}

/** 认不出的方法码：返回一份空清单，让后端的闸去拦，前端不假装知道 */
export const requirementsOf = (methodCode?: string | null): MethodRequirements =>
  (methodCode && METHOD_REQUIREMENTS[methodCode]) || {
    paramKeys: [],
    subjectAttrs: [],
    requiresCaseSet: false
  }

/** 这个方法要不要走案例终选那一步 */
export const needsCaseSelection = (methodCode?: string | null): boolean =>
  requirementsOf(methodCode).requiresCaseSet

// ==================== 方法下拉 ====================

/** 一个方法在下拉里的状态 */
export interface MethodOptionState {
  label: string
  value: string
  /** 品类的 `method_codes.allowed` 里有它 */
  allowed: boolean
  /** 品类的 `method_codes.recommended` 里有它 —— 🔴 是提示不是白名单 */
  recommended: boolean
  /** 品类的 `method_codes.forbidden` 里有它 */
  forbidden: boolean
  /** 不能选时给用户看的那一句；能选时是 undefined */
  reason?: string
}

/**
 * 四个 MVP 方法 × 品类的方法集 → 下拉状态
 *
 * <h3>🔴 不允许的方法要**列出来并灰掉**，不是从下拉里删掉</h3>
 * 删掉的表现是用户找不到「收益法」，然后认为系统少了功能 ——
 * 而正确的信息是「这个品类不允许用收益法」。灰掉 + 一句理由，
 * 才把 `CALCULATION_METHOD_NOT_ALLOWED`（「品类「{}」不允许使用方法「{}」」）
 * 在**点之前**就告诉他。
 *
 * <h3>🔴 拿不到品类的方法集时（{@code methodCodes} 为空）一律放行</h3>
 * 那是「品类详情没拉到」，不是「品类不允许」。此时拦住用户等于把一次网络失败
 * 变成一个功能不可用，而后端本来就会拦。所以四个都能选，由后端当权威。
 *
 * <h3>⚠️ 只有四个，永远不要放 24 个</h3>
 * `QlzgValuationMethodEnum` 有 24 个码，其余 20 个一律以
 * `CALCULATION_METHOD_NOT_IMPLEMENTED` 拒回来。给一个点了必然报错的选项，
 * 比不给更坏 —— 用户会认为系统坏了，而报错文案里的「MVP 实现四种」
 * 是给人读的第二手信息，下拉里那四个是第一手。
 */
export const methodOptionStates = (methodCodes?: QlzgMethodCodes | null): MethodOptionState[] => {
  const known = !!methodCodes
  const allowed = new Set(methodCodes?.allowed ?? [])
  const recommended = new Set(methodCodes?.recommended ?? [])
  const forbidden = new Set(methodCodes?.forbidden ?? [])
  return VALUATION_METHOD_MVP_OPTIONS.map((option) => {
    const isAllowed = !known || allowed.has(option.value)
    const isForbidden = forbidden.has(option.value)
    const selectable = isAllowed && !isForbidden
    return {
      label: option.label,
      value: option.value,
      allowed: isAllowed,
      recommended: recommended.has(option.value),
      forbidden: isForbidden,
      reason: selectable
        ? undefined
        : isForbidden
          ? '本品类明确不支持这一方法'
          : '本品类的允许方法集里没有它（method_codes.allowed）'
    }
  })
}

// ==================== 确认闸：一行 ====================

/**
 * 把确认闸预览的一行**适配成** schema 项的形状
 *
 * 🔴 存在的理由只有一个：预览把取值范围**摊平**成了 `rangeMin` / `rangeMax`，
 *    而 `attrSchema.ts` 那几个函数读的是嵌套的 `range: {min, max}`。
 *    不适配就得在确认闸这边**再写一份**「`%` 要 ×100、scale 要减 2」的换算 ——
 *    那份换算一旦有两处实现，其中一处忘 ÷100 的表现是**数字看着对**：
 *    资本化率显示 7.5、提交 0.075、收益法算得也对，只有另一条路径把 7.5
 *    直接提交上去时才是错的，而那一次不会报错，只会出一个大十倍的评估值。
 *
 * ⚠️ 只映射换算真要读的那几个键。`scope` 恒填 `'PARAM'`（预览给的就只有 PARAM 作用域的行），
 *    `key` 用 `paramKey`，`label` 缺失时回落到键名本身 —— 界面上显示英文键名
 *    比显示空白好，因为键名至少能在参数库里搜到。
 *
 * 🔴 `type` 缺失时**故意不回落成 `'STRING'`**：那会替 `valueKindOf` 把「没有 schema 可依」
 *    这一档填上，于是它那条「按这一行已经填了哪一列回落」的分支永远走不到，
 *    一条只有 `valueJson` 的复合参数会被认成 STR，提交时写进 `valueStr` ——
 *    正是 `valueKindOf` 要防的那个「值放错列」故障。空串不匹配任何 `ATTR_TYPE`，
 *    所以它落进 `default`，判定的主权交回给那一行自己的值。
 */
export const schemaLikeOf = (item: QlzgParamConfirmItemVO): QlzgParamSchemaItem => ({
  key: item.paramKey,
  label: item.label ?? item.paramKey,
  type: item.type ?? '',
  scope: 'PARAM',
  unit: item.unit ?? undefined,
  scale: item.scale ?? undefined,
  required: item.required,
  options: item.options,
  range:
    item.rangeMin == null && item.rangeMax == null
      ? null
      : { min: item.rangeMin ?? undefined, max: item.rangeMax ?? undefined }
})

/** 这一行的输入控件形状（数值 / 文本 / 只读复合），复用参数库那一份判定 */
export const confirmValueKindOf = (item: QlzgParamConfirmItemVO): ParamValueKind =>
  valueKindOf(schemaLikeOf(item), item)

/** 输入控件的小数位（百分数已减 2） */
export const confirmPrecisionOf = (item: QlzgParamConfirmItemVO): number | undefined =>
  displayPrecision(schemaLikeOf(item))

/** 输入控件的取值范围，**显示口径**（百分数已 ×100、已削浮点噪声） */
export const confirmRangeOf = (item: QlzgParamConfirmItemVO): { min?: number; max?: number } =>
  displayRange(schemaLikeOf(item))

/**
 * 一行在界面上的确认状态
 *
 * <h3>🔴 {@code touched} 是**显式**的，不由「值与初值是否相等」推断</h3>
 * 后端判「改没改」用的是 `Objects.equals` 与 `BigDecimal#compareTo`，
 * 前端在 JS 里比对同一件事必然有出入（`0.06` 与 `0.0600`、字符串前后空白、
 * 浮点噪声）。所以这里只记「用户碰过这个控件没有」，而**提交时**再看碰过之后
 * 算出来的存储值与预览给的那一份是否真的不同（{@link buildConfirmItem}）——
 * 相同就当作没碰，把预览的原值**逐字**发回去。
 *
 * 🔴 「逐字发回去」不是洁癖：`valueStr` 那一半后端比的是 `Objects.equals`，
 *    **不 trim**。把库里的 `' 出让 '` 经过一次显示→提交往返变成 `'出让'`，
 *    后端就判成「改了」，于是要一个理由 —— 而用户什么都没改。
 *    表现是「我只是点了确认，它却要我写改动理由」。
 */
export interface ParamConfirmState {
  /** 评估师逐项确认过。🔴 false 的行不会被冻结（后端 skip），落在必需清单里就挡住测算 */
  confirmed: boolean
  /** 用户碰过值输入框 */
  touched: boolean
  /** 输入框里的值，**显示口径**（百分数已 ×100） */
  display: any
  /** 改动理由。🔴 只在真改了的时候必填，且不给默认值、不预填 */
  modifyReason: string
}

/** 按参数键索引的确认状态 */
export type ParamConfirmStateMap = Record<string, ParamConfirmState>

/** 一个空白状态：命中的行默认**未**确认 —— 逐项确认是 HITL 第①闸的全部意义 */
const blankState = (item: QlzgParamConfirmItemVO): ParamConfirmState => ({
  confirmed: false,
  touched: false,
  display: toDisplayValue(schemaLikeOf(item), rawValueOf(item)),
  modifyReason: ''
})

/**
 * 这一行的**原始**值（库里那一份，未换算）
 *
 * 🔴 三列里只有一列有值，取哪一列由 {@link confirmValueKindOf} 决定 ——
 *    与写回去的那一列必须是同一列，否则「读 valueStr、写 valueNum」
 *    会让一条文本型参数在确认之后变成一个数
 */
export const rawValueOf = (item: QlzgParamConfirmItemVO): unknown => {
  switch (confirmValueKindOf(item)) {
    case 'NUM':
      return item.valueNum
    case 'STR':
      return item.valueStr
    default:
      return item.valueJson
  }
}

/**
 * 预览 → 全部行的初始状态
 *
 * 🔴 **未命中的行也建状态**（`hit = false`）：界面上要把它们列出来并给
 *    「去参数库新建」的入口，而不是一张只有命中行的表 ——
 *    `missCount` 是确认闸最重要的一个数，藏起来等于让人在不知道缺口径的情况下点提交
 */
export const loadConfirmStates = (preview?: QlzgParamConfirmPreviewVO | null): ParamConfirmStateMap => {
  const states: ParamConfirmStateMap = {}
  for (const item of preview?.items ?? []) {
    states[item.paramKey] = blankState(item)
  }
  return states
}

/**
 * 这一行**真的**改了值吗
 *
 * 🔴 判据是「换算回存储口径之后与预览给的那一份不同」，不是 `touched`：
 *    用户碰过控件但把原值打了回去，后端比出来是**没改**，
 *    此时前端还要求理由就是一次假拦（而后端不会要，于是前端比后端严 ——
 *    用户写了理由，那句理由被追加进快照的 `basis`，档案里多出一条不存在的偏离）。
 *
 * 🔴 数值那一半按数比（对应后端的 `compareTo`，标度不敏感），
 *    文本那一半按**全等**比（对应 `Objects.equals`，不 trim）。
 *    两份判据刻意不同，因为后端就是两套。
 *
 * 🔴 文本这一支**不走 {@link toStoredValue}**：它对 STRING/ENUM/DATE 会 `trim()`。
 *    库里存的是 `' 出让 '`，用户点进输入框再点出来，控件吃掉了空白 ——
 *    trim 过的比对会说「没改」，于是前端不发 `modifyReason`，后端却判成改了并要理由，
 *    提交当场被拦，而那一句报错读起来像「你改了值却没写理由」，用户明明什么都没改。
 *    所以这里直接拿控件里的原样值与预览给的那一份全等比，与后端同口径。
 */
export const isValueModified = (item: QlzgParamConfirmItemVO, state?: ParamConfirmState): boolean => {
  if (!state?.touched) return false
  const kind = confirmValueKindOf(item)
  if (kind === 'STR') {
    const before = item.valueStr
    if (isAbsent(state.display)) return !isAbsent(before)
    return String(state.display) !== (before ?? '')
  }
  const next = toStoredValue(schemaLikeOf(item), state.display)
  if (kind === 'NUM') {
    const before = item.valueNum
    if (isAbsent(next)) return before != null
    return before == null || Number(before) !== Number(next)
  }
  // 🔴 复合值在确认闸上**不可编辑**（见 buildConfirmItem），所以恒为未改。
  //    这一支留着只是为了「哪天给它加了编辑器」时不会静默地永远判未改
  return false
}

/**
 * 装配一条提交用的确认项（后端那个 record 的 **8** 个字段）
 *
 * <h3>🔴 未命中的行返回 null —— 它不进提交清单</h3>
 * `paramId` 不可空是后端 record 上的明文约定：未命中的参数不能在确认闸上就地填一个数，
 * 因为那个数没有 `basis`（依据）、没有 `sourceType`（出处），
 * 而 R36（I5）要判「每个参数都有依据」。发一条 `paramId = null` 的确认项上去，
 * 后端 `freezeOne` 会拿 null 去 `selectVisibleById`，落 `PARAM_NOT_EXISTS` ——
 * 一句与用户实际处境（「参数库没有这一条」）无关的报错。
 *
 * <h3>🔴 未改动时把预览给的值**逐字**发回去，不发换算往返的那一份</h3>
 * 理由见 {@link ParamConfirmState.touched}。
 *
 * <h3>🔴 `fallbackPath` 必须原样回传</h3>
 * 它是「评估师看到的那一句」回退路径，冻结时**不重跑**查参
 * （重跑会读到已经改过的参数库），所以只能由客户端带上来。
 * 漏发它不报错，后果是 `qlzg_provenance.locator` 少了回退那一句 ——
 * 而 §11.3.1 明文要求 locator 里有它。这是一个**静默**的漏，所以在这里逐字抄。
 */
export const buildConfirmItem = (
  item: QlzgParamConfirmItemVO,
  state?: ParamConfirmState
): QlzgParamConfirmItem | null => {
  if (!item.hit || item.paramId == null) return null
  const confirmed = !!state?.confirmed
  const base: QlzgParamConfirmItem = {
    paramKey: item.paramKey,
    paramId: item.paramId,
    confirmed,
    valueNum: item.valueNum ?? null,
    valueStr: item.valueStr ?? null,
    valueJson: item.valueJson ?? null,
    fallbackPath: item.fallbackPath ?? null
  }
  if (!isValueModified(item, state)) return base
  const kind = confirmValueKindOf(item)
  const stored = toStoredValue(schemaLikeOf(item), state?.display)
  return {
    ...base,
    valueNum: kind === 'NUM' && !isAbsent(stored) ? Number(stored) : base.valueNum,
    valueStr: kind === 'STR' && !isAbsent(stored) ? String(stored) : base.valueStr,
    modifyReason: state?.modifyReason?.trim() || null
  }
}

/**
 * 预览 + 状态 → 提交清单
 *
 * 🔴 **命中的行全部提交**，包括 `confirmed = false` 的：后端对未确认的行只是 skip
 *    （不冻结），而必需键的闸正是靠「有没有一条 `confirmed=true` 且 `paramId` 非空」判的。
 *    只提交勾选过的行也能过，但那会让请求不再是「屏幕上那一页」的忠实形状，
 *    而下一次有人加审计日志时会以为没提交的就是没看见的。
 *
 * 🔴 一条都没命中时返回**空数组**，而后端对空清单抛的是
 *    「冻结口径至少要有一条参数」—— 一句 `invalidParamException`，
 *    读起来像前端发了个坏请求。所以 {@link confirmGateErrors} 会先把它拦下来，
 *    换成一句指向参数库的话。
 */
export const buildConfirmItems = (
  preview: QlzgParamConfirmPreviewVO | undefined | null,
  states: ParamConfirmStateMap
): QlzgParamConfirmItem[] => {
  const items: QlzgParamConfirmItem[] = []
  for (const item of preview?.items ?? []) {
    const built = buildConfirmItem(item, states[item.paramKey])
    if (built) items.push(built)
  }
  return items
}

/** 一条缺口径的说明，界面上给「去参数库新建」的入口 */
export interface MissingParamRow {
  paramKey: string
  label: string
  /** 是不是本方法必需的 —— 必需的那些才真的挡住提交 */
  requiredByMethod: boolean
}

/**
 * 未命中的行，必需的排前面
 *
 * 🔴 排序有意义：十几行未命中时，用户要第一眼看到「挡住测算的那几个」，
 *    而不是按 schema 顺序翻。`Array#sort` 在 V8 上是稳定的，
 *    所以同一档内部仍保持预览给的顺序。
 */
export const missingParamRows = (
  preview: QlzgParamConfirmPreviewVO | undefined | null,
  methodCode?: string | null
): MissingParamRow[] => {
  const required = new Set(requirementsOf(methodCode).paramKeys)
  const rows = (preview?.items ?? [])
    .filter((item) => !item.hit)
    .map((item) => ({
      paramKey: item.paramKey,
      label: item.label ?? item.paramKey,
      requiredByMethod: required.has(item.paramKey)
    }))
  return rows.sort((a, b) => Number(b.requiredByMethod) - Number(a.requiredByMethod))
}

/**
 * 提交前的阻断项，**按用户能照着做的顺序**排
 *
 * 🔴 返回的是给人读的中文句子，不是错误码：这一页的整个意义就是
 *    「在点提交之前把后端会拒的那些原因说清楚」，
 *    而把 `PARAM_CONFIRM_REQUIRED` 的码抛给用户等于让他自己去翻 Java。
 * 🔴 刻意**不**在这里校验 `requiredSubjectAttrs`：标的属性不在这一个接口里，
 *    要另拉一次标的详情。缺属性时后端落 `CALCULATION_INPUT_REQUIRED`，
 *    文案里带键名；界面上给一个「去标的属性页」的入口比在这里猜要诚实。
 */
export const confirmGateErrors = (
  preview: QlzgParamConfirmPreviewVO | undefined | null,
  states: ParamConfirmStateMap,
  methodCode?: string | null
): string[] => {
  const errors: string[] = []
  const items = preview?.items ?? []
  if (!items.length) {
    errors.push('这个标的的品类下没有任何测算参数（param_schema 的 PARAM 作用域是空的），先去品类里声明')
    return errors
  }
  const hittable = items.filter((item) => item.hit && item.paramId != null)
  if (!hittable.length) {
    errors.push('一个参数都没命中：口径无法冻结。请先到参数库按下面缺的键各建一条，再回来确认')
  }
  const required = requirementsOf(methodCode).paramKeys
  const missingRequired = required.filter((key) => {
    const item = items.find((candidate) => candidate.paramKey === key)
    const state = states[key]
    return !item || !item.hit || item.paramId == null || !state?.confirmed
  })
  if (missingRequired.length) {
    errors.push(
      `本方法必需的参数还没有逐项确认：${missingRequired.join('、')}` +
        `（后端会以 PARAM_CONFIRM_REQUIRED 拒回来，报的就是这几个键）`
    )
  }
  for (const item of items) {
    const state = states[item.paramKey]
    if (!state?.confirmed) continue
    if (isValueModified(item, state) && !state.modifyReason.trim()) {
      errors.push(
        `「${item.label ?? item.paramKey}」改了值却没写改动理由 —— ` +
          `这句话会被追加进口径快照的依据（basis）列，是这次偏离在档案里唯一的留痕`
      )
    }
    if (confirmValueKindOf(item) !== 'JSON' && isAbsent(state.display)) {
      errors.push(`「${item.label ?? item.paramKey}」确认了却没有值`)
    }
  }
  return errors
}

// ==================== 案例终选 ====================

/** 一条候选的终选决定 */
export interface CaseDecision {
  /** 采纳进测算 */
  selected: boolean
  /** 🔴 `selected = false` 时必填（`CASE_MATCH_REJECT_REASON_REQUIRED`） */
  rejectedReason: string
}

/** 按 caseId 索引的终选决定 */
export type CaseDecisionMap = Record<number, CaseDecision>

/**
 * 召回结果 → 初始终选决定：**全部默认采纳**
 *
 * <h3>🔴 为什么默认全采纳，而不是默认全不采纳</h3>
 * 后端有一条不对称的规则：只要**有**任何一条被选中，未提交的候选一律按
 * 「剔除且没给理由」抛 `CASE_MATCH_REJECT_REASON_REQUIRED`；
 * 而一条都没选时它**不**要求理由（评估师看了一眼决定改用收益法，
 * 为 8 条候选各编一句理由是没有意义的负担，而编出来的理由比没有理由更坏）。
 * 默认全采纳正好落在「常用路径最短」的那一侧：六层召回已经把硬约束筛过了，
 * 打分也排过序了，评估师要做的是**挑出不能用的**，而那一次挑选本来就该写理由
 * —— 剔除一条可比案例是要写进报告的程序性决定（HITL 第②闸）。
 *
 * <h3>⚠️ 默认全采纳会让「直接点提交」把全部候选都送进算式</h3>
 * 这是刻意的：比较法的修正链对条数没有上限，而 R48 要的是**至少** 3 条。
 * 界面上把条数与 R48 的处置（`dispositionText`）并排显示，让人看见自己在提交几条。
 */
export const loadCaseDecisions = (recall?: QlzgCaseRecallVO | null): CaseDecisionMap => {
  const decisions: CaseDecisionMap = {}
  for (const candidate of recall?.candidates ?? []) {
    const caseId = candidate.caseInfo?.id
    if (caseId == null) continue
    decisions[caseId] = { selected: true, rejectedReason: '' }
  }
  return decisions
}

/**
 * 装配终选清单
 *
 * 🔴 **每一条候选都提交**，选中的与被剔除的都提交。后端对未提交的候选不写行，
 *    于是「他看过但没选」与「他压根没看到」在档案里无法区分 ——
 *    而 I4 复核要回答的恰好是「为什么没用那条更近的案例」。
 * 🔴 顺序按召回给的 `rank`（即数组顺序），不要自己 sort：
 *    `qlzg_case_match.sort` 存的是候选的 rank，档案里的顺序应当与召回面板一致。
 * 🔴 `selected` 在这里是 **Boolean**，而读回来的 `QlzgCaseMatchVO.selected` 是
 *    **Integer 1/0**（两份形状不同，见 `caseMatchIsSelected`）。
 */
export const buildCaseSelections = (
  recall: QlzgCaseRecallVO | undefined | null,
  decisions: CaseDecisionMap
): QlzgCaseSelection[] => {
  const selections: QlzgCaseSelection[] = []
  for (const candidate of recall?.candidates ?? []) {
    const caseId = candidate.caseInfo?.id
    if (caseId == null) continue
    const decision = decisions[caseId]
    const selected = decision?.selected !== false
    selections.push({
      caseId,
      selected,
      rejectedReason: selected ? null : decision?.rejectedReason?.trim() || null
    })
  }
  return selections
}

/** 采纳了几条 */
export const selectedCount = (decisions: CaseDecisionMap): number =>
  Object.values(decisions).filter((decision) => decision.selected).length

/**
 * 终选那一步的阻断项
 *
 * 🔴 只在方法 `requiresCaseSet()` 时才检查「至少一条」：
 *    成本法压根不走这一步，拿它去要求终选会造出一个不存在的约束。
 * 🔴 剔除理由是**逐条**报的，带上案例摘要：8 条里漏了 1 条时，
 *    一句「有剔除没写理由」会让人回去一行一行找。
 */
export const caseSelectionErrors = (
  recall: QlzgCaseRecallVO | undefined | null,
  decisions: CaseDecisionMap,
  methodCode?: string | null
): string[] => {
  const errors: string[] = []
  const candidates = recall?.candidates ?? []
  if (!needsCaseSelection(methodCode)) return errors
  if (!candidates.length) {
    errors.push(
      '本方法必须有已终选的可比案例，而这一次召回一条候选也没有。' +
        '请先到召回面板看看六层过滤把案例都筛在哪一层了'
    )
    return errors
  }
  if (!selectedCount(decisions)) {
    errors.push('本方法至少要终选一条可比案例（后端会落 CALCULATION_CASE_REQUIRED）')
  }
  for (const candidate of candidates) {
    const caseId = candidate.caseInfo?.id
    if (caseId == null) continue
    const decision = decisions[caseId]
    if (decision?.selected !== false) continue
    if (!decision.rejectedReason.trim()) {
      errors.push(
        `案例「${candidateSummaryOf(candidate)}」被剔除了却没写理由 —— ` +
          '剔除一条可比案例是要写进报告的程序性决定'
      )
    }
  }
  return errors
}

/**
 * 比较法能不能选
 *
 * 🔴 判据取自召回结果的 `comparisonMethodAllowed` / `comparisonMethodBlockReason`，
 *    **不是** `candidateCount >= 3`：3 条那个阈值是 R48 的**复核**判据（WARN/BLOCK 级披露），
 *    而「能不能用比较法」是后端按第 4–6 层的硬过滤算出来的另一件事。
 *    在前端拿 3 去当准入条件，等于把 R48 的种子阈值又抄一份到第三种语言里
 *    （Java 的 `OK_MIN_COUNT`、脚本 07 的 `expr_params.minCases` 已经是两份，
 *    由后端 `QlzgSeedRulePinTest` 钉在一起；这里再加一份就没有人钉了）。
 *    条数不足时照样让人跑，跑完 `dispositionText` 会把 R48 的处置建议照原样给他看。
 */
export const comparisonMethodBlocked = (recall?: QlzgCaseRecallVO | null): boolean =>
  recall?.comparisonMethodAllowed === false

// ==================== 提交装配 ====================

/**
 * 装配 `/qlzg/calculation/run` 的请求体
 *
 * 🔴 `caseSelections` 只在方法要案例时带上，其余三个方法**省掉整个键**
 *    （不是发一个空数组）：省掉与空数组在后端是同一支（`hasCaseSelections` 判空），
 *    但发空数组会让读请求日志的人以为「他看过候选、一条都没选」，
 *    而实际上是「这个方法压根不看案例」。
 * 🔴 `switches` 目前没有任何一个方法读它，所以**不发**。
 *    发一个空对象的话，`input_snapshot` 里会多一个 `{}`，
 *    而 D5 的确定性验收比的是那个 JSON 的哈希 —— 多一个键就是一次红。
 */
export const buildRunVO = (
  subjectId: number,
  methodCode: string,
  preview: QlzgParamConfirmPreviewVO | undefined | null,
  states: ParamConfirmStateMap,
  recall?: QlzgCaseRecallVO | null,
  decisions?: CaseDecisionMap
): QlzgCalculationRunVO => {
  const run: QlzgCalculationRunVO = {
    subjectId,
    methodCode,
    paramItems: buildConfirmItems(preview, states)
  }
  if (needsCaseSelection(methodCode)) {
    run.caseSelections = buildCaseSelections(recall, decisions ?? {})
  }
  return run
}

/** 两步的阻断项合成一份，用于「提交」按钮的禁用与 tooltip */
export const runErrors = (
  preview: QlzgParamConfirmPreviewVO | undefined | null,
  states: ParamConfirmStateMap,
  recall: QlzgCaseRecallVO | undefined | null,
  decisions: CaseDecisionMap,
  methodCode?: string | null
): string[] => [
  ...confirmGateErrors(preview, states, methodCode),
  ...caseSelectionErrors(recall, decisions, methodCode)
]

// ==================== 明细渲染 ====================

/**
 * `qlzg_case_match.selected` 是 **Integer 1/0**，提交那一份是 Boolean
 *
 * 🔴 写 `row.selected === true` 会**恒假**（1 !== true），
 *    于是明细里全部案例都显示成「已剔除」，而那一页是复核人核对终选的唯一入口。
 *    写 `if (row.selected)` 在 0 上恰好也对，但它在 `undefined` 上同样为假 ——
 *    与「后端没给这一列」无法区分。所以只认 `=== 1`。
 */
export const caseMatchIsSelected = (row?: Pick<QlzgCaseMatchVO, 'selected'> | null): boolean =>
  row?.selected === 1

/**
 * 披露条目，**按键的插入顺序**逐条列出
 *
 * 🔴 不要挑几个认识的键显示：`disclosures` 是一个开放的 Map，
 *    键由方法自己决定（`development_kind` / `negative_value` / `area_type_mismatch` …）。
 *    少显示一条披露，在报告里就是一个漏掉的限制条件 ——
 *    而漏掉的那一条恰好是方法认为需要说明的那一条。
 * 🔴 值可能是布尔、数字、字符串或对象，所以 stringify 一遍：
 *    直接 `{{ value }}` 渲染一个对象会得到 `[object Object]`，
 *    渲染 `false` 会得到空字符串（Vue 对 false 的输出是空），
 *    而「这一条披露的值是 false」与「这一条披露没有值」在报告里是两件事。
 */
export const disclosureEntries = (
  disclosures?: Record<string, any> | null
): { key: string; text: string }[] =>
  Object.entries(disclosures ?? {}).map(([key, value]) => ({
    key,
    text:
      typeof value === 'string'
        ? value
        : typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : String(value)
  }))

/** 这一条测算能不能拿去做结果确定（只有 SUCCESS 能） */
export const usableForDetermination = (row?: { status?: string } | null): boolean =>
  row?.status === 'SUCCESS'

/**
 * 列表里那几行为什么灰着
 *
 * 🔴 `list-by-subject` **不过滤**：FAILED 与 STALE 都在里面，这是刻意的
 *    （「试过的都在这儿」）。灰掉可以，但要说清为什么灰 ——
 *    一行灰掉的记录加上一个不解释的界面，用户会认为数据丢了。
 */
export const unusableReason = (row?: { status?: string; errorMessage?: string | null } | null): string | null => {
  if (!row) return null
  if (row.status === 'STALE') return '输入已变化但未重算，结果不可用于出稿（CALCULATION_STALE）'
  if (row.status === 'FAILED') return row.errorMessage?.trim() || '这一次测算没有算出结果'
  if (row.status === 'SUCCESS') return null
  return `后端给了一个前端不认识的状态「${row.status}」，按不可用处理`
}

// ==================== 口径变更（change-value） ====================

/**
 * 一条快照的值该改哪一列
 *
 * 🔴 判据是「哪一列**已经有值**」，不是参数类型：快照上没有 schema
 *    （`QlzgParamSnapshotRespVO` 刻意不带 `paramName` / `unit` / `type`，
 *    因为快照要的是当时那一个值，而类型会跟着品类 schema 变）。
 *
 * 🔴 优先级是 **NUM → STR → JSON**，不是「先看文本」：数值是冻结口径里压倒性的一档
 *    （五个 `adj_*` 修正系数、资本化率、重置成本全是数），
 *    而文本那一档只有 `condition_rate_method` 这类枚举。
 *    ⚠️ 一行里**两列都有值**是数据异常（参数库那侧的 `valueColumnsOf` 会把另外两列显式置 null），
 *    此时按 NUM 处理并把其余列原样带回 —— 反正 {@link buildSnapshotChangeVO}
 *    要求三列全发，形状不会因为这次改动而变。
 *
 * 🔴 三列都空时也返回 `'NUM'`（兜底），与参数库 {@code valueKindOf} 同一口径：
 *    那一列会被原样带回（null），所以不会凭空造出一个值
 */
export const snapshotValueKindOf = (
  row?: Pick<QlzgParamSnapshotVO, 'frozenValueNum' | 'frozenValueStr' | 'frozenValueJson'> | null
): ParamValueKind => {
  if (!isAbsent(row?.frozenValueNum)) return 'NUM'
  if (!isAbsent(row?.frozenValueStr)) return 'STR'
  if (!isAbsent(row?.frozenValueJson)) return 'JSON'
  return 'NUM'
}

/**
 * 装配 `/qlzg/param-snapshot/change-value` 的请求体
 *
 * <h3>🔴 三列**全部**带上，改的那一列换成新值，其余两列原样回传</h3>
 * 理由见 {@link snapshotValueKindOf}：形状变了后端就拒。
 * 而「原样回传」意味着复合值那一列即使界面上不给编辑，也必须发回去。
 *
 * <h3>🔴 `changeReason` 必填、不 trim 成空、不给默认值</h3>
 * 后端 `PARAM_SNAPSHOT_CHANGE_REASON_REQUIRED` 的文案引的是
 * 《资产评估执业准则——资产评估方法》「一经确定不得随意变更」。
 * 一个预填了「修正」的理由框等于没有理由框，而 R08（I5）会读它。
 *
 * <h3>⚠️ 改完这一次测算就被标成 STALE</h3>
 * `changeFrozenValue` 末尾调 `calculationMapper.markStale(...)`。
 * 所以弹窗提交成功之后必须**重新拉一次明细**，
 * 否则界面上还显示着 SUCCESS 而库里已经是 STALE ——
 * 用户会拿着一个已经被自己改废了的结果去出稿。
 */
export const buildSnapshotChangeVO = (
  row: QlzgParamSnapshotVO,
  value: unknown,
  changeReason: string
): QlzgParamSnapshotChangeVO | null => {
  const reason = changeReason.trim()
  if (!reason) return null
  const kind = snapshotValueKindOf(row)
  return {
    id: row.id,
    valueNum: kind === 'NUM' && !isAbsent(value) ? Number(value) : row.frozenValueNum ?? null,
    valueStr: kind === 'STR' && !isAbsent(value) ? String(value) : row.frozenValueStr ?? null,
    valueJson: row.frozenValueJson ?? null,
    changeReason: reason
  }
}

/** 快照那一格显示什么（百分数**不**换算：快照上没有 unit，无从判断） */
export const snapshotValueText = (row?: QlzgParamSnapshotVO | null): string => {
  if (!row) return '—'
  const kind = snapshotValueKindOf(row)
  if (kind === 'STR') return row.frozenValueStr ?? '—'
  if (kind === 'JSON') return row.frozenValueJson ? JSON.stringify(row.frozenValueJson) : '—'
  return row.frozenValueNum == null ? '—' : String(row.frozenValueNum)
}

/**
 * 在确认闸预览里找同一个键的那一行
 *
 * 🔴 快照刻意不带 `paramName` / `unit` / `type`（它是历史，不是参数库的视图），
 *    所以界面上要显示参数名就得另找一份。这里用的是**当前**的确认闸预览 ——
 *    它反映的是今天的 schema，与冻结那一刻可能不同。
 *    ⚠️ 因此它**只**用来给人读（名字、单位），不用来改值：
 *    冻结的那一个数一律按 {@link snapshotValueText} 原样显示
 */
const findConfirmItem = (
  paramKey: string | undefined,
  items?: QlzgParamConfirmItemVO[] | null
): QlzgParamConfirmItemVO | undefined =>
  paramKey ? (items ?? []).find((item) => item.paramKey === paramKey) : undefined

/** 快照那一行的参数名。找不到就显示键名本身 —— 键名至少能在参数库里搜到 */
export const snapshotLabelOf = (
  row?: Pick<QlzgParamSnapshotVO, 'paramKey'> | null,
  items?: QlzgParamConfirmItemVO[] | null
): string => {
  if (!row) return '—'
  return findConfirmItem(row.paramKey, items)?.label?.trim() || row.paramKey
}

/**
 * 百分数项的「= 7.5%」提示
 *
 * <h3>🔴 为什么要有这一句，而不是直接换算那个值</h3>
 * 冻结口径表里显示 `0.075` 而报告与确认闸上都写 `7.5%`，复核人会以为其中一个错了 ——
 * 而两个都「对」。但**换算显示值**又意味着用今天的 schema 去改一个已经冻结的数：
 * 万一这个键的 `unit` 后来从 `%` 改成了 `元/㎡`，换算出来的就是一个假的百分比。
 * 所以两样都显示：冻结的原值是权威，括号里那一句是给人读的提示，谁都不冒充谁。
 *
 * 🔴 拿不到预览（请求失败 / 键已经不在 schema 里）时返回空串，
 *    **不**回落到「按值的大小猜是不是百分比」—— 猜出来的 7.5% 与真的 7.5% 长得一样，
 *    而前者可能是 0.075 元/㎡
 */
export const snapshotPercentHintOf = (
  row?: QlzgParamSnapshotVO | null,
  items?: QlzgParamConfirmItemVO[] | null
): string => {
  if (!row || snapshotValueKindOf(row) !== 'NUM') return ''
  const item = findConfirmItem(row.paramKey, items)
  if (!item || item.unit !== '%') return ''
  const display = toDisplayValue(schemaLikeOf(item), row.frozenValueNum)
  return display == null ? '' : `= ${display}%`
}

// ==================== 小工具 ====================

/** 方法码 → 中文名。🔴 展示已有数据优先用后端的 `methodName`，这是回落 */
export const methodNameOf = (methodCode?: string | null, fallback?: string | null): string =>
  fallback?.trim() || labelOf(VALUATION_METHOD_MVP_OPTIONS, methodCode)

/**
 * 候选的摘要：小区名 → 地址 → `#id`
 *
 * 🔴 `qlzg_case` **没有** `caseNo` 这一列（案例编号是导入批次里的行号，不落库），
 *    所以不要按「编号」去拼摘要 —— 那会得到一个恒为空的字符串。
 *    召回面板显示的就是「小区名（未填时）+ 地址」，这里保持同一口径，
 *    否则同一条案例在两个页面上有两个名字，用户会以为是两条
 */
export const candidateSummaryOf = (candidate?: QlzgCaseCandidateVO | null): string => {
  const info = candidate?.caseInfo
  if (!info) return '—'
  return info.communityName?.trim() || info.address?.trim() || `#${info.id}`
}
