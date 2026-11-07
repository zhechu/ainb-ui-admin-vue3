import { describe, expect, it } from 'vitest'
import type { QlzgCaseCandidateVO, QlzgCaseRecallVO, QlzgCaseVO } from '@/api/qlzg/case'
import type { QlzgParamConfirmItemVO, QlzgParamConfirmPreviewVO } from '@/api/qlzg/param'
import type { QlzgParamSnapshotVO } from '@/api/qlzg/paramSnapshot'
import { VALUATION_METHOD_MVP_OPTIONS } from '@/views/qlzg/constants'
import {
  METHOD_REQUIREMENTS,
  buildCaseSelections,
  buildConfirmItem,
  buildConfirmItems,
  buildRunVO,
  buildSnapshotChangeVO,
  candidateSummaryOf,
  caseMatchIsSelected,
  caseSelectionErrors,
  comparisonMethodBlocked,
  confirmGateErrors,
  confirmPrecisionOf,
  confirmRangeOf,
  confirmValueKindOf,
  disclosureEntries,
  isValueModified,
  loadCaseDecisions,
  loadConfirmStates,
  methodNameOf,
  methodOptionStates,
  missingParamRows,
  needsCaseSelection,
  rawValueOf,
  requirementsOf,
  runErrors,
  schemaLikeOf,
  selectedCount,
  snapshotValueKindOf,
  snapshotLabelOf,
  snapshotPercentHintOf,
  snapshotValueText,
  unusableReason,
  usableForDetermination
} from './calcFlow'

/**
 * 测算工作台的守卫。
 *
 * 🔴 这一页是「界面看着对、提交上去被后端拒」风险最高的一处：它要在**一个**请求里
 *    同时满足三份互相独立的清单，而那三份都不在它读的那个接口里。
 *    下面每一条用例都对应一个具体的后端错误码或一句后端注释里的明文约定。
 */

/** 一个百分数型的确认闸行（资本化率）：库里 0.075，界面 7.5 */
const rateItem = (over: Partial<QlzgParamConfirmItemVO> = {}): QlzgParamConfirmItemVO => ({
  paramKey: 'capitalization_rate',
  label: '资本化率',
  type: 'DECIMAL',
  unit: '%',
  scale: 4,
  required: true,
  rangeMin: 0.01,
  rangeMax: 0.3,
  hit: true,
  paramId: 11,
  paramName: '杭州市住宅资本化率',
  valueNum: 0.075,
  sourceType: 'GOVERNMENT',
  sourceTypeDescription: '政府发布',
  fallbackPath: '按辖区回退：330106 → 330100 命中',
  ...over
})

/** 一个文本型的确认闸行（成新率方法）：只有 valueStr 有值 */
const textItem = (over: Partial<QlzgParamConfirmItemVO> = {}): QlzgParamConfirmItemVO => ({
  paramKey: 'condition_rate_method',
  label: '成新率方法',
  type: 'ENUM',
  options: ['STRAIGHT_LINE', 'OBSERVED'],
  hit: true,
  paramId: 12,
  valueStr: 'STRAIGHT_LINE',
  fallbackPath: '全国 000000 命中',
  ...over
})

/** 一行没命中的 */
const missItem = (over: Partial<QlzgParamConfirmItemVO> = {}): QlzgParamConfirmItemVO => ({
  paramKey: 'vacancy_rate',
  label: '空置率',
  type: 'DECIMAL',
  unit: '%',
  scale: 4,
  required: true,
  hit: false,
  paramId: null,
  ...over
})

const preview = (items: QlzgParamConfirmItemVO[], over: Partial<QlzgParamConfirmPreviewVO> = {}): QlzgParamConfirmPreviewVO => ({
  subjectId: 1024,
  subjectName: '某住宅',
  categoryCode: 'REAL_ESTATE_MORTGAGE_RESIDENTIAL',
  regionCode: '330106',
  baseDate: '2026-06-30',
  items,
  missCount: items.filter((item) => !item.hit).length,
  attentionCount: items.filter((item) => item.needAttention).length,
  allFromExpertGuide: false,
  ...over
})

const caseRow = (over: Partial<QlzgCaseVO> = {}): QlzgCaseVO =>
  ({ id: 2048, caseKind: 'SECOND_HAND', sourceType: 'GOVERNMENT', ...over }) as QlzgCaseVO

const candidate = (id: number, over: Partial<QlzgCaseCandidateVO> = {}): QlzgCaseCandidateVO => ({
  rank: id,
  score: 80,
  reviewWarnings: [],
  caseInfo: caseRow({ id }),
  ...over
})

const recall = (
  candidates: QlzgCaseCandidateVO[],
  over: Partial<QlzgCaseRecallVO> = {}
): QlzgCaseRecallVO => ({
  subjectId: 1024,
  baseDate: '2026-06-30',
  candidateCount: candidates.length,
  dispositionCode: 'OK',
  dispositionText: '召回 5 条，充足',
  comparisonMethodAllowed: true,
  candidates,
  ...over
})

// ==================== 四个方法的必需清单（手写黄金副本） ====================

describe('METHOD_REQUIREMENTS：后端四个方法常量的手写副本', () => {
  it('🔴 恰好是 MVP 那四个码，不多不少——多一个就是给了一个点了必然报 NOT_IMPLEMENTED 的选项', () => {
    expect(Object.keys(METHOD_REQUIREMENTS).sort()).toEqual(
      VALUATION_METHOD_MVP_OPTIONS.map((option) => option.value).sort()
    )
    expect(Object.keys(METHOD_REQUIREMENTS)).toHaveLength(4)
  })

  it('🔴 比较法的五个 adj_* 键**逐字且有序**，顺序取自《房地产估价规范》的修正次序', () => {
    // 后端 MarketComparisonMethod 的 REQUIRED_PARAM_KEYS = CHAIN.stream().map(item -> item[0])，
    // 而 CHAIN 是有序的：五步修正链的次序本身就是口径的一部分
    expect(METHOD_REQUIREMENTS.MARKET_COMPARISON.paramKeys).toEqual([
      'adj_transaction',
      'adj_market_time',
      'adj_location',
      'adj_physical',
      'adj_equity'
    ])
  })

  it('🔴 假设开发法那两个键带 development_ 前缀——Java 常量名不带，按常量名猜就永远显示「未命中」', () => {
    // PARAM_TAX_FEE_RATE = "development_tax_fee_rate"、PARAM_PROFIT_RATE = "development_profit_rate"
    expect(METHOD_REQUIREMENTS.HYPOTHETICAL_DEVELOPMENT.paramKeys).toEqual([
      'replacement_cost',
      'development_tax_fee_rate',
      'development_profit_rate'
    ])
  })

  it('收益法 / 成本法的键与属性', () => {
    expect(METHOD_REQUIREMENTS.INCOME_APPROACH.paramKeys).toEqual([
      'capitalization_rate',
      'vacancy_rate',
      'operating_expense_ratio'
    ])
    expect(METHOD_REQUIREMENTS.INCOME_APPROACH.subjectAttrs).toEqual([
      'annual_potential_income',
      'building_area'
    ])
    expect(METHOD_REQUIREMENTS.COST.paramKeys).toEqual([
      'replacement_cost',
      'condition_rate_method'
    ])
    expect(METHOD_REQUIREMENTS.COST.subjectAttrs).toEqual(['building_area'])
    expect(METHOD_REQUIREMENTS.MARKET_COMPARISON.subjectAttrs).toEqual([
      'building_area',
      'area_type'
    ])
    expect(METHOD_REQUIREMENTS.HYPOTHETICAL_DEVELOPMENT.subjectAttrs).toEqual([
      'developed_value',
      'building_area'
    ])
  })

  it('🔴 只有比较法 requiresCaseSet——其余三个发了 caseSelections 会往 case_match 里写与算式无关的行', () => {
    expect(METHOD_REQUIREMENTS.MARKET_COMPARISON.requiresCaseSet).toBe(true)
    for (const code of ['INCOME_APPROACH', 'COST', 'HYPOTHETICAL_DEVELOPMENT']) {
      expect(METHOD_REQUIREMENTS[code].requiresCaseSet).toBe(false)
      expect(needsCaseSelection(code)).toBe(false)
    }
    expect(needsCaseSelection('MARKET_COMPARISON')).toBe(true)
  })

  it('认不出的方法码给空清单，让后端的闸去拦——前端不假装知道第 5 个方法要什么', () => {
    expect(requirementsOf('DCF_FCFF').paramKeys).toEqual([])
    expect(requirementsOf(null).subjectAttrs).toEqual([])
    expect(needsCaseSelection('EVA')).toBe(false)
  })
})

// ==================== 方法下拉 ====================

describe('methodOptionStates：品类的方法集 × MVP 四个', () => {
  it('🔴 拿不到品类方法集时**一律放行**：那是「详情没拉到」，不是「品类不允许」', () => {
    for (const state of methodOptionStates(null)) {
      expect(state.allowed).toBe(true)
      expect(state.reason).toBeUndefined()
    }
    expect(methodOptionStates(undefined)).toHaveLength(4)
  })

  it('不在 allowed 里的要**列出来并给理由**，不是从下拉里删掉', () => {
    const states = methodOptionStates({
      allowed: ['MARKET_COMPARISON', 'COST'],
      recommended: ['MARKET_COMPARISON'],
      forbidden: []
    })
    expect(states).toHaveLength(4)
    const income = states.find((state) => state.value === 'INCOME_APPROACH')!
    expect(income.allowed).toBe(false)
    expect(income.reason).toContain('method_codes.allowed')
    expect(states.find((state) => state.value === 'MARKET_COMPARISON')!.recommended).toBe(true)
    expect(states.find((state) => state.value === 'COST')!.recommended).toBe(false)
  })

  it('forbidden 压过 allowed——两个集合都提到同一个码时按不支持处理', () => {
    const states = methodOptionStates({
      allowed: ['COST'],
      recommended: [],
      forbidden: ['COST']
    })
    const cost = states.find((state) => state.value === 'COST')!
    expect(cost.allowed).toBe(true)
    expect(cost.forbidden).toBe(true)
    expect(cost.reason).toBe('本品类明确不支持这一方法')
  })

  it('🔴 永远只有四个选项：枚举里另外 20 个码点了必然 CALCULATION_METHOD_NOT_IMPLEMENTED', () => {
    expect(methodOptionStates({ allowed: ['DCF_FCFF', 'EVA'], recommended: [], forbidden: [] })).toHaveLength(4)
    expect(methodOptionStates(null).map((state) => state.value)).toEqual([
      'MARKET_COMPARISON',
      'INCOME_APPROACH',
      'COST',
      'HYPOTHETICAL_DEVELOPMENT'
    ])
  })
})

// ==================== schema 适配与百分数口径 ====================

describe('schemaLikeOf：把摊平的 rangeMin/rangeMax 接回 attrSchema 那几个函数', () => {
  it('🔴 百分数的范围要 ×100 再给输入框：库里的 [0.01, 0.3] 显示成 [1, 30]', () => {
    // 直接把 0.01/0.3 塞给显示 7.5 的框，用户会看到「超出 [0.01, 0.3]」而完全不知道该填什么
    expect(confirmRangeOf(rateItem())).toEqual({ min: 1, max: 30 })
    expect(confirmRangeOf(rateItem({ rangeMin: null, rangeMax: null }))).toEqual({})
    expect(confirmRangeOf(textItem())).toEqual({})
  })

  it('🔴 百分数的小数位减 2：scale=4 的分数 0.0750 显示成 7.50 只要 2 位', () => {
    expect(confirmPrecisionOf(rateItem())).toBe(2)
    expect(confirmPrecisionOf(rateItem({ unit: '元/㎡', scale: 4 }))).toBe(4)
    // INT 恒 0 位（整数没有小数），与 scale 写的什么无关
    expect(confirmPrecisionOf(rateItem({ type: 'INT', unit: null, scale: 4 }))).toBe(0)
    // 🔴 scale 缺失时**先**返回 undefined，压根不看 type —— 所以 INT 也一样拿不到 0。
    //    这条钉住的是 displayPrecision 的判序：把「type === INT → 0」提到前面，
    //    一条没声明 scale 的整数会被强制成 0 位，而它本来该按控件默认放行
    expect(confirmPrecisionOf(rateItem({ type: 'INT', unit: null, scale: null }))).toBeUndefined()
    expect(confirmPrecisionOf(rateItem({ scale: null }))).toBeUndefined()
  })

  it('label 缺失时回落到键名——界面上显示英文键名比显示空白好，键名至少搜得到', () => {
    expect(schemaLikeOf(rateItem({ label: undefined })).label).toBe('capitalization_rate')
    expect(schemaLikeOf(rateItem()).scope).toBe('PARAM')
    expect(schemaLikeOf(textItem()).options).toEqual(['STRAIGHT_LINE', 'OBSERVED'])
  })

  it('🔴 0.29 这一类值也要削掉浮点噪声（0.29 * 100 在 JS 里是 28.999999999999996）', () => {
    expect(confirmRangeOf(rateItem({ rangeMin: 0.29, rangeMax: 1.1 }))).toEqual({ min: 29, max: 110 })
  })
})

describe('confirmValueKindOf / rawValueOf：读哪一列与写哪一列必须是同一列', () => {
  it('DECIMAL/INT → NUM，STRING/ENUM/DATE → STR', () => {
    expect(confirmValueKindOf(rateItem())).toBe('NUM')
    expect(confirmValueKindOf(rateItem({ type: 'INT' }))).toBe('NUM')
    expect(confirmValueKindOf(textItem())).toBe('STR')
    expect(confirmValueKindOf(textItem({ type: 'STRING' }))).toBe('STR')
    expect(confirmValueKindOf(textItem({ type: 'DATE', valueStr: '2026-01-01' }))).toBe('STR')
  })

  it('🔴 type 缺失时按「哪一列已经有值」回落，而 NUM 是**兜底**不是先判的一档', () => {
    // 先判 NUM 的话，一条只有 valueStr 的文本型参数会被认成 NUM，提交时写进 valueNum
    expect(confirmValueKindOf(textItem({ type: undefined }))).toBe('STR')
    expect(confirmValueKindOf({ ...rateItem(), type: undefined, valueNum: null })).toBe('NUM')
    expect(
      confirmValueKindOf({ ...rateItem(), type: undefined, valueNum: null, valueJson: { a: 1 } })
    ).toBe('JSON')
  })

  it('rawValueOf 按 kind 取列：文本型读 valueStr，不是 valueNum', () => {
    expect(rawValueOf(rateItem())).toBe(0.075)
    expect(rawValueOf(textItem())).toBe('STRAIGHT_LINE')
    expect(rawValueOf({ ...rateItem(), type: undefined, valueNum: null, valueJson: { a: 1 } })).toEqual({ a: 1 })
  })
})

// ==================== 确认闸状态 ====================

describe('loadConfirmStates：初始状态', () => {
  it('🔴 默认 confirmed = false —— 逐项确认就是 HITL 第①闸的全部意义，不能默认帮人勾上', () => {
    const states = loadConfirmStates(preview([rateItem(), textItem()]))
    expect(states.capitalization_rate.confirmed).toBe(false)
    expect(states.capitalization_rate.touched).toBe(false)
    expect(states.capitalization_rate.modifyReason).toBe('')
  })

  it('🔴 未命中的行也建状态：missCount 是确认闸最重要的一个数，藏起来等于让人在不知道缺口径的情况下提交', () => {
    const states = loadConfirmStates(preview([rateItem(), missItem()]))
    expect(Object.keys(states)).toEqual(['capitalization_rate', 'vacancy_rate'])
    expect(states.vacancy_rate.display).toBeUndefined()
  })

  it('百分数行的输入框初值是显示口径（0.075 → 7.5），文本行原样', () => {
    const states = loadConfirmStates(preview([rateItem(), textItem()]))
    expect(states.capitalization_rate.display).toBe(7.5)
    expect(states.condition_rate_method.display).toBe('STRAIGHT_LINE')
  })

  it('空预览给空状态表，不抛', () => {
    expect(loadConfirmStates(null)).toEqual({})
    expect(loadConfirmStates(preview([]))).toEqual({})
  })
})

describe('isValueModified：改没改', () => {
  it('没碰过就是没改，哪怕显示值与初值不同（不可能发生，但判据不看值）', () => {
    const item = rateItem()
    expect(isValueModified(item, { confirmed: true, touched: false, display: 99, modifyReason: '' })).toBe(false)
    expect(isValueModified(item, undefined)).toBe(false)
  })

  it('🔴 碰过但把原值打了回去 = 没改：后端比出来是没改，前端还要求理由就是一次假拦', () => {
    // 假拦的后果不只是烦人：用户会写一句理由，而那句理由被追加进快照的 basis，
    // 档案里于是多出一条**不存在的**偏离
    const item = rateItem()
    expect(isValueModified(item, { confirmed: true, touched: true, display: 7.5, modifyReason: '' })).toBe(false)
    expect(isValueModified(item, { confirmed: true, touched: true, display: '7.5', modifyReason: '' })).toBe(false)
  })

  it('碰过且值真的变了 = 改了', () => {
    const item = rateItem()
    expect(isValueModified(item, { confirmed: true, touched: true, display: 6, modifyReason: '' })).toBe(true)
    // 🔴 清空也是改：把一个有值的口径确认成空，后端 PARAM_VALUE_REQUIRED 会拦，
    //    但前端要先说清楚这是「改动」而不是「没填」
    expect(isValueModified(item, { confirmed: true, touched: true, display: '', modifyReason: '' })).toBe(true)
  })

  it('🔴 文本那一半按**全等**比（后端是 Objects.equals，不 trim）', () => {
    // 库里存的是带空白的 ' 出让 '，用户点进输入框再点出来，控件可能把空白吃掉 ——
    // 那时后端确实会判成改了，前端必须与它同口径，否则「前端说没改、后端要理由」
    const item = textItem({ valueStr: ' 出让 ' })
    expect(isValueModified(item, { confirmed: true, touched: true, display: '出让', modifyReason: '' })).toBe(true)
    expect(isValueModified(item, { confirmed: true, touched: true, display: ' 出让 ', modifyReason: '' })).toBe(false)
  })

  it('复合值在确认闸上不可编辑，恒为未改', () => {
    const item = rateItem({ type: undefined, valueNum: null, valueJson: { steps: [1] } })
    expect(isValueModified(item, { confirmed: true, touched: true, display: { steps: [2] }, modifyReason: '' })).toBe(false)
  })
})

describe('buildConfirmItem：装配那 8 个字段', () => {
  it('🔴 未命中的行返回 null —— paramId 不可空，发上去只会得到一句与处境无关的 PARAM_NOT_EXISTS', () => {
    expect(buildConfirmItem(missItem(), { confirmed: true, touched: false, display: 5, modifyReason: '' })).toBeNull()
    expect(buildConfirmItem(rateItem({ hit: true, paramId: null }))).toBeNull()
    expect(buildConfirmItem(rateItem({ hit: false, paramId: 11 }))).toBeNull()
  })

  it('🔴 未改动时把预览给的值**逐字**发回去，不发换算往返的那一份', () => {
    // valueStr 那一半后端比的是 Objects.equals 且不 trim，一次往返就能造出一个假改动
    const item = textItem({ valueStr: ' 出让 ' })
    const built = buildConfirmItem(item, { confirmed: true, touched: false, display: '出让', modifyReason: '' })!
    expect(built.valueStr).toBe(' 出让 ')
    expect(built.modifyReason).toBeUndefined()
  })

  it('🔴 fallbackPath 原样回传：漏发不报错，后果是 provenance.locator 少了回退那一句（§11.3.1 明文要求）', () => {
    const built = buildConfirmItem(rateItem(), { confirmed: true, touched: false, display: 7.5, modifyReason: '' })!
    expect(built.fallbackPath).toBe('按辖区回退：330106 → 330100 命中')
    expect(built.paramKey).toBe('capitalization_rate')
    expect(built.paramId).toBe(11)
    expect(built.confirmed).toBe(true)
  })

  it('🔴 改了值：新值进**它该在的那一列**，另外两列保持预览原样', () => {
    const item = rateItem({ valueStr: '某个说明', valueJson: { a: 1 } })
    const built = buildConfirmItem(item, { confirmed: true, touched: true, display: 6, modifyReason: ' 本区域成交活跃 ' })!
    expect(built.valueNum).toBe(0.06)
    expect(built.valueStr).toBe('某个说明')
    expect(built.valueJson).toEqual({ a: 1 })
    // 🔴 trim 过：理由会被追加进 basis 列，前后空白会在报告里显示成一段莫名的缩进
    expect(built.modifyReason).toBe('本区域成交活跃')
  })

  it('改了文本值时只动 valueStr，valueNum 原样', () => {
    const item = textItem({ valueNum: 3 })
    const built = buildConfirmItem(item, { confirmed: true, touched: true, display: 'OBSERVED', modifyReason: '现场勘察' })!
    expect(built.valueStr).toBe('OBSERVED')
    expect(built.valueNum).toBe(3)
  })

  it('confirmed = false 也照样装配（后端 skip 它，但请求要是屏幕上那一页的忠实形状）', () => {
    const built = buildConfirmItem(rateItem(), { confirmed: false, touched: false, display: 7.5, modifyReason: '' })!
    expect(built.confirmed).toBe(false)
    expect(built.valueNum).toBe(0.075)
  })

  it('没有状态时按未确认、未改动处理', () => {
    const built = buildConfirmItem(rateItem())!
    expect(built.confirmed).toBe(false)
    expect(built.valueNum).toBe(0.075)
    expect(built.valueStr).toBeNull()
    expect(built.valueJson).toBeNull()
  })
})

describe('buildConfirmItems：提交清单', () => {
  it('🔴 跳过未命中的行，保留 confirmed=false 的行', () => {
    const items = [rateItem(), missItem(), textItem()]
    const states = loadConfirmStates(preview(items))
    states.capitalization_rate.confirmed = true
    const built = buildConfirmItems(preview(items), states)
    expect(built.map((row) => row.paramKey)).toEqual(['capitalization_rate', 'condition_rate_method'])
    expect(built[0].confirmed).toBe(true)
    expect(built[1].confirmed).toBe(false)
  })

  it('一条都没命中时返回空数组（后端会抛「冻结口径至少要有一条参数」，由 confirmGateErrors 先拦）', () => {
    expect(buildConfirmItems(preview([missItem()]), loadConfirmStates(preview([missItem()])))).toEqual([])
  })
})

describe('missingParamRows：缺口径的清单', () => {
  it('🔴 本方法必需的排前面：十几行未命中时第一眼要看到挡住测算的那几个', () => {
    const items = [
      missItem({ paramKey: 'economic_life', label: '经济寿命' }),
      missItem({ paramKey: 'capitalization_rate', label: '资本化率' }),
      missItem({ paramKey: 'adj_location', label: '区位修正' })
    ]
    const rows = missingParamRows(preview(items), 'INCOME_APPROACH')
    expect(rows.map((row) => row.paramKey)).toEqual(['capitalization_rate', 'economic_life', 'adj_location'])
    expect(rows[0].requiredByMethod).toBe(true)
    expect(rows[1].requiredByMethod).toBe(false)
  })

  it('命中的行不在清单里；没有方法码时全部标成非必需', () => {
    const items = [rateItem(), missItem()]
    expect(missingParamRows(preview(items), 'INCOME_APPROACH')).toHaveLength(1)
    expect(missingParamRows(preview(items)).every((row) => !row.requiredByMethod)).toBe(true)
  })

  it('label 缺失时回落到键名', () => {
    expect(missingParamRows(preview([missItem({ label: undefined })]))[0].label).toBe('vacancy_rate')
  })
})

// ==================== 确认闸的阻断项 ====================

describe('confirmGateErrors：提交前把后端会拒的原因说清楚', () => {
  const confirmedAll = (items: QlzgParamConfirmItemVO[]) => {
    const states = loadConfirmStates(preview(items))
    for (const key of Object.keys(states)) states[key].confirmed = true
    return states
  }

  /** 成本法要的那两个键都命中——这是「一切正常」那一份预览 */
  const costItems = () => [
    rateItem({
      paramKey: 'replacement_cost',
      label: '重置成本',
      type: 'DECIMAL',
      unit: '元/㎡',
      scale: 2,
      rangeMin: null,
      rangeMax: null,
      valueNum: 8000,
      paramId: 21
    }),
    textItem()
  ]

  it('全部命中、全部确认、没改值 → 没有阻断项', () => {
    const items = costItems()
    expect(confirmGateErrors(preview(items), confirmedAll(items), 'COST')).toEqual([])
  })

  it('🔴 schema 的 required 与方法的必需键是**两份清单**：界面标红的不等于挡提交的', () => {
    // 收益法要 capitalization_rate / vacancy_rate / operating_expense_ratio，
    // 而这一份预览里 capitalization_rate 的 schema required 是 false
    const items = [rateItem({ required: false }), missItem({ paramKey: 'operating_expense_ratio', required: false })]
    const errors = confirmGateErrors(preview(items), confirmedAll(items), 'INCOME_APPROACH')
    expect(errors.join('\n')).toContain('vacancy_rate')
    expect(errors.join('\n')).toContain('operating_expense_ratio')
    expect(errors.join('\n')).toContain('PARAM_CONFIRM_REQUIRED')
  })

  it('一条都没命中时先说这句，不要让用户去读后端那句「冻结口径至少要有一条参数」', () => {
    const errors = confirmGateErrors(preview([missItem()]), confirmedAll([missItem()]), 'COST')
    expect(errors[0]).toContain('一个参数都没命中')
  })

  it('品类的 PARAM 作用域是空的 → 指向品类声明，不指向参数库', () => {
    const errors = confirmGateErrors(preview([]), {}, 'COST')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('先去品类里声明')
  })

  it('🔴 改了值没写理由：逐行报，并说清这句话会落到 basis 列', () => {
    const items = costItems()
    const states = confirmedAll(items)
    states.replacement_cost.touched = true
    states.replacement_cost.display = 9000
    const errors = confirmGateErrors(preview(items), states, 'COST')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('重置成本')
    expect(errors[0]).toContain('basis')
  })

  it('改了值且写了理由 → 放行', () => {
    const items = costItems()
    const states = confirmedAll(items)
    states.replacement_cost.touched = true
    states.replacement_cost.display = 9000
    states.replacement_cost.modifyReason = '本年建材价格上涨'
    expect(confirmGateErrors(preview(items), states, 'COST')).toEqual([])
  })

  it('🔴 确认了却把值清空 → 拦住（后端 PARAM_VALUE_REQUIRED 的口径是「三列全空」）', () => {
    const items = costItems()
    const states = confirmedAll(items)
    states.replacement_cost.touched = true
    states.replacement_cost.display = ''
    const errors = confirmGateErrors(preview(items), states, 'COST')
    expect(errors.some((error) => error.includes('确认了却没有值'))).toBe(true)
  })

  it('未确认的行不检查值与理由——它压根不会被冻结（后端 skip）', () => {
    // economic_life 不是成本法的必需键（CostMethod 只声明了 replacement_cost 与 condition_rate_method），
    // 所以它未确认、且值被清空，都不该挡住提交
    const items = [
      ...costItems(),
      rateItem({
        paramKey: 'economic_life',
        label: '经济寿命',
        type: 'INT',
        unit: '年',
        scale: null,
        rangeMin: null,
        rangeMax: null,
        valueNum: 50,
        paramId: 22,
        required: false
      })
    ]
    const states = confirmedAll(items)
    states.economic_life.confirmed = false
    states.economic_life.touched = true
    states.economic_life.display = ''
    expect(confirmGateErrors(preview(items), states, 'COST')).toEqual([])
  })

  it('🔴 刻意**不**在这里校验标的属性：属性不在这个接口里，缺它由后端 CALCULATION_INPUT_REQUIRED 报键名', () => {
    const items = [rateItem()]
    expect(confirmGateErrors(preview(items), confirmedAll(items), 'MARKET_COMPARISON').join('\n')).not.toContain(
      'building_area'
    )
  })
})

// ==================== 案例终选 ====================

describe('loadCaseDecisions / selectedCount：初始终选', () => {
  it('🔴 默认**全部采纳**：后端的规则是不对称的（选了一条就要求给其余每条写理由）', () => {
    const decisions = loadCaseDecisions(recall([candidate(1), candidate(2), candidate(3)]))
    expect(Object.keys(decisions)).toEqual(['1', '2', '3'])
    expect(selectedCount(decisions)).toBe(3)
    expect(decisions[1].rejectedReason).toBe('')
  })

  it('空召回给空表，不抛', () => {
    expect(loadCaseDecisions(null)).toEqual({})
    expect(loadCaseDecisions(recall([]))).toEqual({})
  })
})

describe('buildCaseSelections：终选清单', () => {
  it('🔴 **每一条**候选都提交，选中的与剔除的都提交——未提交的那些不写行，档案里就分不清「看过没选」与「没看到」', () => {
    const candidates = [candidate(1), candidate(2), candidate(3)]
    const decisions = loadCaseDecisions(recall(candidates))
    decisions[2].selected = false
    decisions[2].rejectedReason = ' 来源为中介口头报价 '
    const selections = buildCaseSelections(recall(candidates), decisions)
    expect(selections).toHaveLength(3)
    expect(selections.map((row) => row.caseId)).toEqual([1, 2, 3])
    expect(selections[0]).toEqual({ caseId: 1, selected: true, rejectedReason: null })
    // 🔴 理由 trim：它要写进报告，前后空白会显示成莫名的缩进
    expect(selections[1]).toEqual({ caseId: 2, selected: false, rejectedReason: '来源为中介口头报价' })
  })

  it('🔴 selected 在这里是 Boolean（读回来的 case_match.selected 是 Integer 1/0）', () => {
    const selections = buildCaseSelections(recall([candidate(1)]), loadCaseDecisions(recall([candidate(1)])))
    expect(typeof selections[0].selected).toBe('boolean')
  })

  it('顺序按召回给的 rank，不自己 sort——case_match.sort 存的就是候选的 rank', () => {
    const candidates = [candidate(7), candidate(3), candidate(9)]
    expect(buildCaseSelections(recall(candidates), loadCaseDecisions(recall(candidates))).map((row) => row.caseId)).toEqual([7, 3, 9])
  })

  it('没有决定的候选按采纳处理（初值就是全采纳，别让它变成剔除）', () => {
    expect(buildCaseSelections(recall([candidate(1)]), {})[0].selected).toBe(true)
  })

  it('剔除了却只写了空白 → 发 null，让后端的 CASE_MATCH_REJECT_REASON_REQUIRED 去拦', () => {
    const decisions = { 1: { selected: false, rejectedReason: '   ' } }
    expect(buildCaseSelections(recall([candidate(1)]), decisions)[0].rejectedReason).toBeNull()
  })
})

describe('caseSelectionErrors：终选的阻断项', () => {
  const three = () => recall([candidate(1), candidate(2), candidate(3)])

  it('🔴 不要案例的方法一律返回空：成本法压根不走这一步，拿它去要求终选是造一个不存在的约束', () => {
    expect(caseSelectionErrors(null, {}, 'COST')).toEqual([])
    expect(caseSelectionErrors(null, {}, 'INCOME_APPROACH')).toEqual([])
    expect(caseSelectionErrors(null, {}, 'HYPOTHETICAL_DEVELOPMENT')).toEqual([])
  })

  it('比较法一条候选也没有 → 指向召回面板的六层过滤', () => {
    const errors = caseSelectionErrors(recall([]), {}, 'MARKET_COMPARISON')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('六层过滤')
  })

  it('比较法有候选但全被剔除 → 至少一条（后端 CALCULATION_CASE_REQUIRED）', () => {
    const data = three()
    const decisions = loadCaseDecisions(data)
    for (const key of Object.keys(decisions)) {
      decisions[key].selected = false
      decisions[key].rejectedReason = '不可比'
    }
    const errors = caseSelectionErrors(data, decisions, 'MARKET_COMPARISON')
    expect(errors.join('\n')).toContain('至少要终选一条')
  })

  it('🔴 剔除没写理由要**逐条**报出是哪一条：8 条里漏 1 条时，一句「有剔除没写理由」让人回去一行行找', () => {
    const data = recall([
      candidate(1),
      candidate(2, { caseInfo: caseRow({ id: 2, communityName: '某某花园' }) }),
      candidate(3)
    ])
    const decisions = loadCaseDecisions(data)
    decisions[1].selected = false // 剔了但没写理由 → 这一条要被点名
    decisions[2].selected = false
    decisions[2].rejectedReason = '面积差太大' // 理由齐 → 不报，也不该把名字混进上面那一句
    // 🔴 第 3 条保持采纳：这一条只测「理由缺失」，不能顺手把终选数变成 0 ——
    //    那会同时触发「至少要终选一条」，两个错混在一起时
    //    「逐条点名」到底有没有生效就看不出来了
    const errors = caseSelectionErrors(data, decisions, 'MARKET_COMPARISON')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('#1')
    expect(errors[0]).not.toContain('某某花园')
  })

  it('全部采纳 → 没有阻断项（哪怕只有 1 条：3 条那个阈值是 R48 的**复核**判据，不是准入条件）', () => {
    const data = recall([candidate(1)], { dispositionCode: 'NONE', dispositionText: '召回 1 条，不足' })
    expect(caseSelectionErrors(data, loadCaseDecisions(data), 'MARKET_COMPARISON')).toEqual([])
  })
})

describe('comparisonMethodBlocked：比较法能不能选', () => {
  it('🔴 判据是后端的 comparisonMethodAllowed，**不是** candidateCount >= 3', () => {
    // 3 条那个数在 Java（OK_MIN_COUNT）与脚本 07（expr_params.minCases）里已经是两份，
    // 由后端 QlzgSeedRulePinTest 钉在一起；前端再加一份就没有人钉了
    expect(comparisonMethodBlocked(recall([candidate(1)], { comparisonMethodAllowed: false }))).toBe(true)
    expect(comparisonMethodBlocked(recall([candidate(1)], { comparisonMethodAllowed: true }))).toBe(false)
    expect(comparisonMethodBlocked(recall([candidate(1)]))).toBe(false)
    expect(comparisonMethodBlocked(null)).toBe(false)
  })
})

// ==================== 提交装配 ====================

describe('buildRunVO：/qlzg/calculation/run 的请求体', () => {
  const items = [rateItem({ paramKey: 'adj_transaction', label: '交易情况修正', type: 'DECIMAL', unit: null, scale: 2, rangeMin: null, rangeMax: null, valueNum: 1 })]
  const states = loadConfirmStates(preview(items))
  states.adj_transaction.confirmed = true

  it('🔴 比较法带 caseSelections，其余三个方法**省掉整个键**（不是发空数组）', () => {
    const data = recall([candidate(1)])
    const withCases = buildRunVO(1024, 'MARKET_COMPARISON', preview(items), states, data, loadCaseDecisions(data))
    expect(withCases.caseSelections).toHaveLength(1)
    for (const code of ['INCOME_APPROACH', 'COST', 'HYPOTHETICAL_DEVELOPMENT']) {
      const run = buildRunVO(1024, code, preview(items), states, data, loadCaseDecisions(data))
      expect('caseSelections' in run).toBe(false)
    }
  })

  it('🔴 不发 switches：目前没有任何一个方法读它，而多一个空键就是一次 D5 哈希红', () => {
    const run = buildRunVO(1024, 'COST', preview(items), states)
    expect('switches' in run).toBe(false)
    expect(Object.keys(run).sort()).toEqual(['methodCode', 'paramItems', 'subjectId'])
  })

  it('比较法没有召回数据时发一个空数组（而不是省掉键）：这一支会被 CALCULATION_CASE_REQUIRED 拦，形状要如实', () => {
    expect(buildRunVO(1024, 'MARKET_COMPARISON', preview(items), states, null, {}).caseSelections).toEqual([])
  })
})

describe('runErrors：两步的阻断项合成一份', () => {
  it('确认闸与终选的错误都在里面', () => {
    const errors = runErrors(preview([missItem()]), {}, recall([]), {}, 'MARKET_COMPARISON')
    expect(errors.some((error) => error.includes('一个参数都没命中'))).toBe(true)
    expect(errors.some((error) => error.includes('六层过滤'))).toBe(true)
  })

  it('成本法不看案例，所以召回为空也不挡', () => {
    const items = [
      rateItem({
        paramKey: 'replacement_cost',
        label: '重置成本',
        type: 'DECIMAL',
        unit: '元/㎡',
        scale: 2,
        rangeMin: null,
        rangeMax: null,
        valueNum: 8000,
        paramId: 21
      }),
      textItem()
    ]
    const states = loadConfirmStates(preview(items))
    for (const key of Object.keys(states)) states[key].confirmed = true
    expect(runErrors(preview(items), states, null, {}, 'COST')).toEqual([])
  })
})

// ==================== 明细渲染 ====================

describe('caseMatchIsSelected：Integer 1/0 不是 Boolean', () => {
  it('🔴 只认 === 1：写 row.selected === true 会恒假，于是全部案例显示成「已剔除」', () => {
    expect(caseMatchIsSelected({ selected: 1 })).toBe(true)
    expect(caseMatchIsSelected({ selected: 0 })).toBe(false)
    expect(caseMatchIsSelected({ selected: undefined })).toBe(false)
    expect(caseMatchIsSelected(null)).toBe(false)
    // 这一条是那个陷阱本身：TS 上 selected?: number，传 true 进来只能是 JS 里漏了类型
    expect(caseMatchIsSelected({ selected: true as unknown as number })).toBe(false)
  })
})

describe('disclosureEntries：披露逐条列出', () => {
  it('🔴 保持插入顺序，且**不挑认识的键**：少显示一条披露，在报告里就是一个漏掉的限制条件', () => {
    const entries = disclosureEntries({
      development_kind: '住宅',
      negative_value: true,
      area_type_mismatch: false
    })
    expect(entries.map((entry) => entry.key)).toEqual(['development_kind', 'negative_value', 'area_type_mismatch'])
  })

  it('🔴 false 要显示成 "false" 而不是空串：Vue 对 false 的输出是空，「值是 false」与「没有值」是两件事', () => {
    const entries = disclosureEntries({ a: false, b: true, c: 0, d: 1.5 })
    expect(entries.map((entry) => entry.text)).toEqual(['false', 'true', '0', '1.5'])
  })

  it('对象值 stringify，字符串原样（不加引号）', () => {
    expect(disclosureEntries({ a: { x: 1 } })[0].text).toBe('{"x":1}')
    expect(disclosureEntries({ a: '住宅' })[0].text).toBe('住宅')
    expect(disclosureEntries({ a: null })[0].text).toBe('null')
  })

  it('空与 null 给空表', () => {
    expect(disclosureEntries(null)).toEqual([])
    expect(disclosureEntries({})).toEqual([])
  })
})

describe('usableForDetermination / unusableReason：只有 SUCCESS 能拿去做结果确定', () => {
  it('STALE 是**警示**不是失败：它是一次曾经成功、现在已经过期的运行', () => {
    expect(usableForDetermination({ status: 'SUCCESS' })).toBe(true)
    expect(usableForDetermination({ status: 'STALE' })).toBe(false)
    expect(usableForDetermination({ status: 'FAILED' })).toBe(false)
    expect(unusableReason({ status: 'STALE' })).toContain('不可用于出稿')
  })

  it('FAILED 带上后端那句 errorMessage', () => {
    expect(unusableReason({ status: 'FAILED', errorMessage: ' 缺少必需输入：building_area ' })).toBe(
      '缺少必需输入：building_area'
    )
    expect(unusableReason({ status: 'FAILED' })).toContain('没有算出结果')
  })

  it('认不出的状态按不可用处理，并说出来——静默灰掉一行会让人以为数据丢了', () => {
    expect(unusableReason({ status: 'WHATEVER' })).toContain('WHATEVER')
    expect(unusableReason({ status: 'SUCCESS' })).toBeNull()
    expect(unusableReason(null)).toBeNull()
  })
})

// ==================== 口径变更 ====================

const snapshot = (over: Partial<QlzgParamSnapshotVO> = {}): QlzgParamSnapshotVO => ({
  id: 900,
  calculationId: 800,
  paramId: 11,
  paramKey: 'capitalization_rate',
  frozenValueNum: 0.075,
  changeCount: 0,
  ...over
})

describe('snapshotValueKindOf：判据是「哪一列已经有值」，快照上没有 schema', () => {
  it('三列分别有值时各归各', () => {
    expect(snapshotValueKindOf(snapshot())).toBe('NUM')
    expect(snapshotValueKindOf(snapshot({ frozenValueNum: null, frozenValueStr: 'x' }))).toBe('STR')
    expect(snapshotValueKindOf(snapshot({ frozenValueNum: null, frozenValueJson: { a: 1 } }))).toBe('JSON')
  })

  it('🔴 两列都有值时按 NUM（数值是冻结口径里压倒性的一档），其余列由 buildSnapshotChangeVO 原样带回', () => {
    expect(snapshotValueKindOf(snapshot({ frozenValueStr: '某个说明' }))).toBe('NUM')
  })

  it('三列都空 → NUM（兜底，与参数库那一份同一口径）', () => {
    expect(snapshotValueKindOf(snapshot({ frozenValueNum: null }))).toBe('NUM')
    expect(snapshotValueKindOf(null)).toBe('NUM')
  })

  it('🔴 0 算「有值」：isAbsent 不把 0 当空，一个 0 的修正系数是合法口径', () => {
    expect(snapshotValueKindOf(snapshot({ frozenValueNum: 0, frozenValueStr: 'x' }))).toBe('NUM')
  })
})

describe('buildSnapshotChangeVO：改口径只能改值，不能改值的类型', () => {
  it('🔴 三列**全部**带上：少发一列在后端就是「把它清空了」，validateValueShapeUnchanged 会拒', () => {
    const row = snapshot({ frozenValueStr: '某个说明' })
    const built = buildSnapshotChangeVO(row, 0.06, ' 本区域成交活跃 ')!
    expect(built).toEqual({
      id: 900,
      valueNum: 0.06,
      valueStr: '某个说明',
      valueJson: null,
      changeReason: '本区域成交活跃'
    })
  })

  it('改文本列时数值列原样带回（这里是 null，不是 0）', () => {
    const row = snapshot({ frozenValueNum: null, frozenValueStr: 'STRAIGHT_LINE' })
    const built = buildSnapshotChangeVO(row, 'OBSERVED', '现场勘察')!
    expect(built.valueStr).toBe('OBSERVED')
    expect(built.valueNum).toBeNull()
  })

  it('🔴 理由为空（含只有空白）返回 null —— 不给默认值，一个预填了「修正」的理由框等于没有理由框', () => {
    expect(buildSnapshotChangeVO(snapshot(), 0.06, '')).toBeNull()
    expect(buildSnapshotChangeVO(snapshot(), 0.06, '   ')).toBeNull()
  })

  it('复合值那一列即使界面上不给编辑也必须原样发回去', () => {
    const row = snapshot({ frozenValueNum: null, frozenValueJson: { steps: [1, 2] } })
    expect(buildSnapshotChangeVO(row, undefined, '口径调整')!.valueJson).toEqual({ steps: [1, 2] })
  })

  it('数值列清空时原值带回，不发 null 上去（那会被判成「把这一列清空了」）', () => {
    expect(buildSnapshotChangeVO(snapshot(), '', '口径调整')!.valueNum).toBe(0.075)
  })
})

describe('snapshotValueText：快照那一格显示什么', () => {
  it('🔴 百分数**不**换算：快照上没有 unit，无从判断这一行是不是百分数', () => {
    // 换算的话就是拿一个猜出来的口径去改一个已经冻结的数 —— 而快照的全部意义是「当时那一个值」
    expect(snapshotValueText(snapshot())).toBe('0.075')
    expect(snapshotValueText(snapshot({ frozenValueNum: null, frozenValueStr: '出让' }))).toBe('出让')
    expect(snapshotValueText(snapshot({ frozenValueNum: null, frozenValueJson: { a: 1 } }))).toBe('{"a":1}')
    expect(snapshotValueText(snapshot({ frozenValueNum: null }))).toBe('—')
    expect(snapshotValueText(null)).toBe('—')
  })
})

describe('snapshotLabelOf / snapshotPercentHintOf：快照上刻意没有的那几栏，从确认闸预览另找一份', () => {
  it('参数名取预览的 label，找不到就显示键名本身（键名至少能在参数库里搜到）', () => {
    expect(snapshotLabelOf(snapshot(), [rateItem()])).toBe('资本化率')
    expect(snapshotLabelOf(snapshot(), [rateItem({ label: '   ' })])).toBe('capitalization_rate')
    expect(snapshotLabelOf(snapshot(), [])).toBe('capitalization_rate')
    expect(snapshotLabelOf(snapshot())).toBe('capitalization_rate')
    expect(snapshotLabelOf(null)).toBe('—')
  })

  it('🔴 百分数只给一句「= 7.5%」提示，**不改**冻结的那个值', () => {
    // 换算显示值等于拿今天的 schema 去改一个已经冻结的数：
    // 万一这个键的 unit 后来从 % 改成了 元/㎡，换算出来的就是一个假的百分比
    expect(snapshotPercentHintOf(snapshot(), [rateItem()])).toBe('= 7.5%')
    expect(snapshotValueText(snapshot())).toBe('0.075')
  })

  it('🔴 非百分数、非数值、拿不到预览时一律返回空串——绝不按值的大小猜是不是百分比', () => {
    // 猜出来的 7.5% 与真的 7.5% 长得一样，而前者可能是 0.075 元/㎡
    expect(snapshotPercentHintOf(snapshot(), [rateItem({ unit: '元/㎡' })])).toBe('')
    expect(snapshotPercentHintOf(snapshot(), [rateItem({ unit: null })])).toBe('')
    expect(snapshotPercentHintOf(snapshot({ frozenValueNum: null, frozenValueStr: '出让' }), [textItem()])).toBe('')
    expect(snapshotPercentHintOf(snapshot(), [])).toBe('')
    expect(snapshotPercentHintOf(snapshot())).toBe('')
    expect(snapshotPercentHintOf(null, [rateItem()])).toBe('')
  })

  it('🔴 浮点噪声同样被削掉：0.29 的提示是「= 29%」，不是「= 28.999999999999996%」', () => {
    expect(snapshotPercentHintOf(snapshot({ frozenValueNum: 0.29 }), [rateItem()])).toBe('= 29%')
  })
})

// ==================== 小工具 ====================

describe('methodNameOf / candidateSummaryOf', () => {
  it('🔴 展示已有数据优先用后端的 methodName，前端那份只是回落', () => {
    expect(methodNameOf('COST', '成本法（后端给的）')).toBe('成本法（后端给的）')
    expect(methodNameOf('COST')).toBe('成本法')
    expect(methodNameOf(null, '  ')).toBe('')
  })

  it('认不出的方法码显示码本身（labelOf 的口径）：后端 methodName 缺失时至少能拿去查', () => {
    expect(methodNameOf('DCF_FCFF')).toBe('DCF_FCFF')
  })

  it('🔴 qlzg_case **没有** caseNo 列：按「编号」拼摘要会得到一个恒为空的字符串', () => {
    expect(candidateSummaryOf(candidate(1, { caseInfo: caseRow({ id: 1, communityName: '某某花园' }) }))).toBe('某某花园')
    expect(candidateSummaryOf(candidate(2, { caseInfo: caseRow({ id: 2, address: '某路 1 号' }) }))).toBe('某路 1 号')
    expect(candidateSummaryOf(candidate(3))).toBe('#3')
    expect(candidateSummaryOf(null)).toBe('—')
  })
})
