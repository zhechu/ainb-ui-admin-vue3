import { describe, expect, it } from 'vitest'
import type { QlzgParamSchemaItem } from '@/api/qlzg/category'
import type { QlzgParamVO } from '@/api/qlzg/param'
import {
  EFFECTIVE_UNTIL_FOREVER,
  NATIONAL_REGION_CODE,
  buildSaveVO,
  canBeBlockRuleLocked,
  displayValueOf,
  effectiveRangeLabel,
  effectiveStateOf,
  emptyFormModel,
  isLegalRegionCode,
  isLongTermEffective,
  loadFormModel,
  regionScopeLabel,
  validateFormModel,
  valueColumnsOf,
  valueKindOf
} from './paramSchema'

/**
 * 参数库换算的边界测试
 *
 * 🔴 这些用例钉的是**后端 {@code QlzgParamServiceImpl} / {@code QlzgParamMapper} 的镜像行为**。
 *    两边不一致的表现全都是「不报错但结果错」，而参数库里最坏的一种是**值放错列**：
 *    那一行照样能被四维回退命中（命中只看 {@code param_key} 与四个维度），
 *    命中之后引擎按 {@code type} 读它认定的那一列 —— 读到 null。
 *    于是「参数库明明有这个数，测算却说缺输入」，而 {@code PARAM_VALUE_REQUIRED} 拦不住它。
 *    所以 {@link valueKindOf} 与 {@link valueColumnsOf} 那一组用例是这份测试存在的**主要理由**。
 *
 * ⚠️ 百分数往返（填 7.5 → 存 0.075 → 再显示 7.5）**不在这里重复测**：
 *    那条规则只有一份实现，在 {@code subject/attrSchema.ts} 里，
 *    它的往返用例在 {@code attrSchema.spec.ts}。这里只测参数库**特有**的那几件事，
 *    以及「参数库确实在用那份实现」（{@link displayValueOf} 的百分数用例）。
 */

const item = (over: Partial<QlzgParamSchemaItem> = {}): QlzgParamSchemaItem => ({
  key: 'k',
  label: '测试参数',
  type: 'DECIMAL',
  scope: 'PARAM',
  ...over
})

/** 资本化率：种子里真实存在的那一份（scale 4、单位 %、range [0.01, 0.30]） */
const rateItem = (over: Partial<QlzgParamSchemaItem> = {}) =>
  item({
    key: 'capitalization_rate',
    label: '资本化率',
    type: 'DECIMAL',
    unit: '%',
    scale: 4,
    range: { min: 0.01, max: 0.3 },
    ...over
  })

const row = (over: Partial<QlzgParamVO> = {}): QlzgParamVO => ({
  id: 1,
  paramKey: 'capitalization_rate',
  paramName: '杭州市住宅资本化率',
  regionCode: '330100',
  effectiveUntil: EFFECTIVE_UNTIL_FOREVER,
  longTermEffective: true,
  sourceType: 'GOVERNMENT',
  status: 1,
  ...over
})

// ==================== 辖区码 ====================

describe('isLegalRegionCode', () => {
  it('恰好 6 位数字才合法，与 QlzgParamLookup#isLegalRegionCode 同口径', () => {
    expect(isLegalRegionCode('330106')).toBe(true)
    expect(isLegalRegionCode(NATIONAL_REGION_CODE)).toBe(true)
  })

  it('🔴 5 位 / 7 位 / 带字母 / 空一律不合法', () => {
    // 后端不报错，它只是把回退阶梯削成 ["000000"] —— 这条参数从此只能被全国那一级命中
    expect(isLegalRegionCode('33010')).toBe(false)
    expect(isLegalRegionCode('3301060')).toBe(false)
    expect(isLegalRegionCode('33010A')).toBe(false)
    expect(isLegalRegionCode('')).toBe(false)
    expect(isLegalRegionCode(null)).toBe(false)
    expect(isLegalRegionCode(undefined)).toBe(false)
  })
})

describe('regionScopeLabel', () => {
  it('🔴 先判全国：000000 也以 0000 结尾，顺序反了会得到「省级」', () => {
    expect(regionScopeLabel('000000')).toBe('全国')
  })

  it('省 / 市 / 区县按末尾的 0 分档', () => {
    expect(regionScopeLabel('330000')).toBe('省级')
    expect(regionScopeLabel('330100')).toBe('市级')
    expect(regionScopeLabel('330106')).toBe('区县级')
  })

  it('非法码返回 null（调用方要显示原值，让那一行看得出来是坏的）', () => {
    expect(regionScopeLabel('33010')).toBeNull()
    expect(regionScopeLabel(null)).toBeNull()
  })
})

// ==================== 有效期 ====================

describe('isLongTermEffective', () => {
  it('🔴 只读后端派生的布尔，不比日期字面量', () => {
    expect(isLongTermEffective(row({ longTermEffective: true }))).toBe(true)
    expect(isLongTermEffective(row({ longTermEffective: false }))).toBe(false)
  })

  it('后端没给这个字段时按 false 处理——宁可显示一个九千多年的日期，也不要谎称长期有效', () => {
    expect(isLongTermEffective(row({ longTermEffective: undefined }))).toBe(false)
    expect(isLongTermEffective(null)).toBe(false)
    expect(isLongTermEffective(undefined)).toBe(false)
  })
})

describe('effectiveStateOf', () => {
  const today = '2026-11-01'

  it('用字符串比较，边界这两天都算在有效期内', () => {
    expect(effectiveStateOf('2026-11-01', '2026-11-01', today)).toBe('VALID')
    expect(effectiveStateOf('2026-01-01', '2026-11-01', today)).toBe('VALID')
    expect(effectiveStateOf('2026-11-01', '2027-01-01', today)).toBe('VALID')
  })

  it('生效日空 = 不限起始，不参与判定', () => {
    expect(effectiveStateOf(null, '2027-01-01', today)).toBe('VALID')
    expect(effectiveStateOf(undefined, EFFECTIVE_UNTIL_FOREVER, today)).toBe('VALID')
  })

  it('失效日早于今天是「已过期」，生效日晚于今天是「尚未生效」', () => {
    expect(effectiveStateOf('2020-01-01', '2026-10-31', today)).toBe('EXPIRED')
    expect(effectiveStateOf('2027-01-01', EFFECTIVE_UNTIL_FOREVER, today)).toBe('NOT_YET')
  })

  it('🔴 「启用但已过期」是一个真实状态：status 与有效期是两条独立的轴', () => {
    // 四维回退按 effective_from <= baseDate <= effective_until 过滤，
    // 所以这一行 status=1 也照样查不到，而台账上它看着完全正常
    const expired = row({ status: 1, effectiveUntil: '2026-10-31', longTermEffective: false })
    expect(expired.status).toBe(1)
    expect(effectiveStateOf(expired.effectiveFrom, expired.effectiveUntil, today)).toBe('EXPIRED')
  })

  it('没给参照日时一律说「有效期内」——台账拿不到评估基准日，不猜', () => {
    expect(effectiveStateOf('2020-01-01', '2020-12-31', null)).toBe('VALID')
    expect(effectiveStateOf('2020-01-01', '2020-12-31', undefined)).toBe('VALID')
  })
})

describe('effectiveRangeLabel', () => {
  it('长期有效显示四个字，不显示 9999-12-31', () => {
    expect(effectiveRangeLabel(row())).toBe('长期有效')
    expect(effectiveRangeLabel(row({ effectiveFrom: '2024-01-01' }))).toBe(
      '2024-01-01 起，长期有效'
    )
  })

  it('起始日空显示「不限起始」而不是留白——留白与「这一格没数据」长得一样', () => {
    expect(
      effectiveRangeLabel(row({ longTermEffective: false, effectiveUntil: '2026-12-31' }))
    ).toBe('不限起始 ~ 2026-12-31')
  })

  it('两头都有就显示区间', () => {
    expect(
      effectiveRangeLabel(
        row({
          longTermEffective: false,
          effectiveFrom: '2024-01-01',
          effectiveUntil: '2026-12-31'
        })
      )
    ).toBe('2024-01-01 ~ 2026-12-31')
  })
})

// ==================== 值落在哪一列 ====================

describe('valueKindOf', () => {
  it('🔴 由 schema 的 type 决定，DECIMAL / INT → NUM', () => {
    expect(valueKindOf(rateItem(), null)).toBe('NUM')
    expect(valueKindOf(item({ type: 'INT' }), null)).toBe('NUM')
  })

  it('STRING / ENUM / DATE → STR', () => {
    expect(valueKindOf(item({ type: 'STRING' }), null)).toBe('STR')
    expect(valueKindOf(item({ type: 'ENUM' }), null)).toBe('STR')
    expect(valueKindOf(item({ type: 'DATE' }), null)).toBe('STR')
  })

  it('GEO → JSON（PARAM 作用域今天没有 GEO 键，这一支是给台账渲染兜底的）', () => {
    expect(valueKindOf(item({ type: 'GEO' }), null)).toBe('JSON')
  })

  it('🔴 有 schema 时**不看**哪一列有值——值放错列正是要抓的故障', () => {
    // 一条 DECIMAL 参数被填进了 valueStr：kind 仍然是 NUM，
    // 于是表单会把值写回 valueNum 并把 valueStr 清掉（自愈），而不是照着错的列继续写
    expect(valueKindOf(rateItem(), row({ valueStr: '0.06' }))).toBe('NUM')
  })

  it('没有 schema 时按这一行已经填了哪一列回落', () => {
    expect(valueKindOf(null, row({ valueStr: 'YEAR' }))).toBe('STR')
    expect(valueKindOf(null, row({ valueJson: { a: 1 } }))).toBe('JSON')
    expect(valueKindOf(null, row({ valueNum: 0.06 }))).toBe('NUM')
  })

  it('三列都空 / 压根没有行时给 NUM（最常见的一档）', () => {
    expect(valueKindOf(null, row())).toBe('NUM')
    expect(valueKindOf(null, null)).toBe('NUM')
    expect(valueKindOf(undefined, undefined)).toBe('NUM')
  })

  it('🔴 回落顺序是 STR → JSON → NUM：valueStr 与 valueJson 同时有值时认 valueStr', () => {
    expect(valueKindOf(null, row({ valueStr: 'YEAR', valueJson: { a: 1 } }))).toBe('STR')
  })
})

describe('valueColumnsOf', () => {
  it('🔴 另外两列显式置 null，不是省掉——updateById 是全行更新', () => {
    expect(valueColumnsOf('NUM', 0.06)).toEqual({ valueNum: 0.06, valueStr: null, valueJson: null })
    expect(valueColumnsOf('STR', 'YEAR')).toEqual({
      valueNum: null,
      valueStr: 'YEAR',
      valueJson: null
    })
    expect(valueColumnsOf('JSON', { a: 1 })).toEqual({
      valueNum: null,
      valueStr: null,
      valueJson: { a: 1 }
    })
  })

  it('改了 paramKey 换到另一种类型时，上一类型那一列被清掉', () => {
    const before = row({ valueNum: 0.06 })
    expect(valueKindOf(null, before)).toBe('NUM')
    // 换成一个 STRING 型的键
    expect(valueColumnsOf(valueKindOf(item({ type: 'STRING' }), before), '基准地价 2024 版')).toEqual({
      valueNum: null,
      valueStr: '基准地价 2024 版',
      valueJson: null
    })
  })

  it('值为空时三列全 null（后端的 PARAM_VALUE_REQUIRED 会拦，前端也拦，见 validateFormModel）', () => {
    expect(valueColumnsOf('NUM', undefined)).toEqual({
      valueNum: null,
      valueStr: null,
      valueJson: null
    })
    expect(valueColumnsOf('STR', '')).toEqual({ valueNum: null, valueStr: null, valueJson: null })
  })

  it('🔴 0 是一个声明过的值，不算空', () => {
    expect(valueColumnsOf('NUM', 0)).toEqual({ valueNum: 0, valueStr: null, valueJson: null })
  })
})

// ==================== 台账那一格 ====================

describe('displayValueOf', () => {
  it('🔴 百分数项乘回 100，与表单口径一致（台账显示 0.075、表单显示 7.5 会让人以为其中一个错了）', () => {
    expect(displayValueOf(rateItem(), row({ valueNum: 0.075 }))).toBe('7.50')
  })

  it('scale 决定小数位：库里 0.0750 显示成 7.50，不是 7.5', () => {
    expect(displayValueOf(rateItem({ scale: 4 }), row({ valueNum: 0.075 }))).toBe('7.50')
    expect(displayValueOf(rateItem({ scale: 3 }), row({ valueNum: 0.075 }))).toBe('7.5')
  })

  it('🔴 非百分数的 DECIMAL 沿用 scale，不減 2', () => {
    expect(displayValueOf(item({ scale: 2, unit: '元/㎡' }), row({ valueNum: 3200 }))).toBe(
      '3200.00'
    )
  })

  it('🔴 没有 schema 时**不补零**，只把浮点噪声削掉', () => {
    // 1.1 * 100 在 JS 里是 110.00000000000001（实测），台账是纯文本，
    // 表单那层 el-input-number 的 precision 挡不住它
    expect(displayValueOf(null, row({ valueNum: 1234567 }))).toBe('1234567')
    expect(displayValueOf(undefined, row({ valueNum: 0.06 }))).toBe('0.06')
  })

  it('文本型原样显示', () => {
    expect(displayValueOf(item({ type: 'STRING' }), row({ valueStr: '杭政函〔2024〕15号' }))).toBe(
      '杭政函〔2024〕15号'
    )
    expect(displayValueOf(item({ type: 'ENUM' }), row({ valueStr: 'YEAR' }))).toBe('YEAR')
  })

  it('复合值压成一行 JSON，不留白', () => {
    expect(displayValueOf(null, row({ valueJson: { lng: 120.1, lat: 30.2 } }))).toBe(
      '{"lng":120.1,"lat":30.2}'
    )
  })

  it('没有值返回空串，不是 "null" 也不是 "undefined"', () => {
    expect(displayValueOf(rateItem(), row())).toBe('')
    expect(displayValueOf(item({ type: 'STRING' }), row())).toBe('')
    expect(displayValueOf(null, row({ valueJson: null }))).toBe('')
  })
})

// ==================== 表单模型 ====================

describe('emptyFormModel', () => {
  it('新建的初值：长期有效打开、来源是机构内部、状态启用', () => {
    const model = emptyFormModel()
    expect(model.longTermEffective).toBe(true)
    expect(model.sourceType).toBe('ORG_INTERNAL')
    expect(model.status).toBe(1)
    // 🔴 辖区码留空：它是必填项，不给一个默认值（比如 000000）——「全国」必须是人显式选的。
    //    品类留空是**另一件事**：'' 就是「通用参数」那一档的模型值（见下一条用例），
    //    所以新建表单从一开始就显示「通用参数」，而不是一个看着像漏填的空框
    expect(model.regionCode).toBe('')
    expect(model.categoryCode).toBe('')
  })

  it('🔴 品类用空串表示「通用参数」，不用 null——模型里这一档只能有一种写法', () => {
    // 下拉里「通用参数」是一个 value="" 的**显式选项**（有语义的选择，不是「还没选」）。
    // 模型值是 null 的话 el-select 命不中它，编辑一条通用参数时品类框会**空着** ——
    // 用户看到一个像漏填了的框，顺手挑一个品类，
    // 一条通用参数就被静默收窄成某个品类专属的了（提交成功、不报错）
    expect(emptyFormModel().categoryCode).toBe('')
    expect(loadFormModel(row({ categoryCode: null }), rateItem()).categoryCode).toBe('')
    expect(loadFormModel(row({ categoryCode: 'REAL_ESTATE' }), rateItem()).categoryCode).toBe(
      'REAL_ESTATE'
    )
    // 往回走仍然是 NULL：'' 被 isAbsent 判成 absent，于是发 undefined（不发空串）
    expect(buildSaveVO(emptyFormModel(), rateItem()).categoryCode).toBeUndefined()
  })

  it('🔴 失效日期初值是 null，不是哨兵：哨兵值只在提交那一刻造出来', () => {
    // 让它躺在模型里的话「开关开着 + 日期有值」从第一秒就成立，
    // 而 validateFormModel 要拦的正是这个组合 —— 一个新建表单什么都没动就过不了校验
    expect(emptyFormModel().effectiveUntil).toBeNull()
    expect(buildSaveVO(emptyFormModel(), null).effectiveUntil).toBe(EFFECTIVE_UNTIL_FOREVER)
  })

  it('🔴 不带 canBeBlockRule：那一列由后端按 source_type 派生', () => {
    expect(Object.keys(emptyFormModel())).not.toContain('canBeBlockRule')
  })
})

describe('loadFormModel', () => {
  it('长期有效的行，失效日期在模型里是 null——留着 9999-12-31 的话关掉开关会看到一个九千多年的日期', () => {
    const model = loadFormModel(row(), rateItem())
    expect(model.longTermEffective).toBe(true)
    expect(model.effectiveUntil).toBeNull()
  })

  it('不是长期有效时把真实失效日期带进模型', () => {
    const model = loadFormModel(
      row({ longTermEffective: false, effectiveUntil: '2026-12-31' }),
      rateItem()
    )
    expect(model.longTermEffective).toBe(false)
    expect(model.effectiveUntil).toBe('2026-12-31')
  })

  it('🔴 值换算到显示口径：库里 0.075 进模型是 7.5', () => {
    expect(loadFormModel(row({ valueNum: 0.075 }), rateItem()).value).toBe(7.5)
  })

  it('没有 schema 时值原样进模型，不换算', () => {
    expect(loadFormModel(row({ valueNum: 0.075 }), null).value).toBe(0.075)
  })

  it('🔴 复合值不走 toDisplayValue——那个函数只认 {lng, lat}，拿去处理任意 JSON 会得到一个空点', () => {
    const json = { steps: [1, 2, 3], note: '三段' }
    expect(loadFormModel(row({ valueJson: json }), null).value).toEqual(json)
  })

  it('可空列一律落成 null 而不是 undefined（表单控件绑的是模型值，undefined 会让受控输入失去初值）', () => {
    const model = loadFormModel(row(), rateItem())
    // 🔴 品类是这一条的**例外**：它落成 ''，那是「通用参数」在模型里的唯一表示。
    //    落成 null 的话编辑一条通用参数时品类框是空的（下拉里没有 value=null 的选项），
    //    用户会当成漏填的必填框顺手挑一个品类 —— 一条通用参数被静默收窄成品类专属，提交还成功
    expect(model.categoryCode).toBe('')
    expect(model.industryCode).toBeNull()
    expect(model.effectiveFrom).toBeNull()
    expect(model.unit).toBeNull()
    expect(model.basisFileId).toBeNull()
  })

  it('🔴 不带 canBeBlockRule / platformLevel / sourceTypeDescription——它们不在写模型上', () => {
    const keys = Object.keys(loadFormModel(row({ canBeBlockRule: true }), rateItem()))
    expect(keys).not.toContain('canBeBlockRule')
    expect(keys).not.toContain('platformLevel')
    expect(keys).not.toContain('sourceTypeDescription')
  })
})

describe('buildSaveVO', () => {
  it('🔴 长期有效开关造出哨兵日期（后端必填，而 DDL 的 DEFAULT 救不了：靠它的话「我没填」与「我判断它长期有效」在库里是同一个东西）', () => {
    const model = { ...emptyFormModel(), longTermEffective: true, effectiveUntil: null }
    expect(buildSaveVO(model, rateItem()).effectiveUntil).toBe(EFFECTIVE_UNTIL_FOREVER)
  })

  it('关掉开关时发模型里那个真实日期', () => {
    const model = {
      ...emptyFormModel(),
      longTermEffective: false,
      effectiveUntil: '2026-12-31'
    }
    expect(buildSaveVO(model, rateItem()).effectiveUntil).toBe('2026-12-31')
  })

  it('🔴 百分数换算成存储口径：填 7.5 发 0.075', () => {
    const model = { ...emptyFormModel(), value: 7.5 }
    expect(buildSaveVO(model, rateItem()).valueNum).toBe(0.075)
  })

  it('值落在 schema 指定的那一列，另外两列是 null', () => {
    const numeric = buildSaveVO({ ...emptyFormModel(), value: 7.5 }, rateItem())
    expect(numeric.valueNum).toBe(0.075)
    expect(numeric.valueStr).toBeNull()
    expect(numeric.valueJson).toBeNull()

    const text = buildSaveVO(
      { ...emptyFormModel(), value: '杭政函〔2024〕15号' },
      item({ type: 'STRING', key: 'benchmark_version' })
    )
    expect(text.valueNum).toBeNull()
    expect(text.valueStr).toBe('杭政函〔2024〕15号')
  })

  it('🔴 没有 schema 时按 original 已经填了哪一列回落——不传 original 会把文本型参数写进 valueNum', () => {
    const original = row({ valueStr: 'YEAR', valueNum: null })
    const model = { ...loadFormModel(original, null), value: 'OBSERVE' }
    const saved = buildSaveVO(model, null, original)
    expect(saved.valueStr).toBe('OBSERVE')
    expect(saved.valueNum).toBeNull()
  })

  it('🔴 复合值原样带回，不碰——不给输入控件不等于这一行改不动了', () => {
    const json = { steps: [1, 2, 3] }
    const original = row({ valueJson: json })
    const model = { ...loadFormModel(original, null), paramName: '改了个名字' }
    const saved = buildSaveVO(model, null, original)
    expect(saved.valueJson).toEqual(json)
    expect(saved.paramName).toBe('改了个名字')
  })

  it('🔴 品类与行业留空发 undefined（= 库里 NULL），不发空串', () => {
    const saved = buildSaveVO({ ...emptyFormModel(), categoryCode: '', industryCode: '  ' }, null)
    expect(saved.categoryCode).toBeUndefined()
    expect(saved.industryCode).toBeUndefined()
  })

  it('生效日留空发 null（= 不限起始，这是一个有语义的 NULL）', () => {
    expect(buildSaveVO({ ...emptyFormModel(), effectiveFrom: '' }, null).effectiveFrom).toBeNull()
  })

  it('🔴 不发 canBeBlockRule：那一列由后端 applyDerivedColumns 强制派生', () => {
    expect(Object.keys(buildSaveVO(emptyFormModel(), rateItem()))).not.toContain('canBeBlockRule')
  })

  it('🔴 不展开 RespVO：五个派生/只读字段一个也不进写模型', () => {
    const original = row({
      longTermEffective: true,
      sourceTypeDescription: '政府发布',
      platformLevel: true,
      creator: '1',
      createTime: new Date()
    })
    const sentKeys = Object.keys(
      buildSaveVO(loadFormModel(original, rateItem()), rateItem(), original)
    )
    for (const leaked of [
      'longTermEffective',
      'sourceTypeDescription',
      'platformLevel',
      'creator',
      'createTime',
      'updateTime'
    ]) {
      expect(sentKeys).not.toContain(leaked)
    }
  })

  it('编辑时带上 id', () => {
    expect(buildSaveVO(loadFormModel(row({ id: 42 }), rateItem()), rateItem()).id).toBe(42)
  })
})

// ==================== 提交前的友好提示 ====================

describe('validateFormModel', () => {
  const ok = (over: Partial<ReturnType<typeof emptyFormModel>> = {}) => ({
    ...emptyFormModel(),
    paramKey: 'capitalization_rate',
    paramName: '杭州市住宅资本化率',
    regionCode: '330100',
    value: 7.5,
    ...over
  })

  it('🔴 一个什么都没动过的新建表单，只要填了必填项就能过', () => {
    // 这一条钉的是 emptyFormModel 与 validateFormModel **不互相打架**：
    // 后者的「长期有效开着 + 日期也有值」那条拦截，不能把前者造出来的初值也拦下
    expect(validateFormModel(ok(), rateItem())).toBeNull()
    expect(validateFormModel(ok(), null)).toBeNull()
  })

  it('🔴 5 位辖区码要拦下来，并且说清后果（后端不报错，它只是把回退阶梯削成 ["000000"]）', () => {
    const message = validateFormModel(ok({ regionCode: '33010' }), rateItem())
    expect(message).toContain('6 位')
    expect(message).toContain('全国')
  })

  it('关掉长期有效又不填失效日期时，提示里要给出「打开开关」这条出路', () => {
    const message = validateFormModel(
      ok({ longTermEffective: false, effectiveUntil: null }),
      rateItem()
    )
    expect(message).toContain('开关')
  })

  it('🔴 长期有效与失效日期同时给了要拦：不拦的话后端会用哨兵值覆盖，用户看不到自己填的日期没了', () => {
    const message = validateFormModel(
      ok({ longTermEffective: true, effectiveUntil: '2026-12-31' }),
      rateItem()
    )
    expect(message).toContain('9999-12-31')
  })

  it('生效日晚于失效日要拦', () => {
    expect(
      validateFormModel(
        ok({ longTermEffective: false, effectiveFrom: '2027-01-01', effectiveUntil: '2026-12-31' }),
        rateItem()
      )
    ).toContain('生效日期不能晚于失效日期')
  })

  it('🔴 range 按**显示口径**报：库里是 [0.01, 0.30]，界面上要说「不能大于 30%」', () => {
    const message = validateFormModel(ok({ value: 40 }), rateItem())
    expect(message).toContain('30')
    expect(message).toContain('%')
    expect(message).not.toContain('0.3')
  })

  it('下界同样按显示口径报', () => {
    expect(validateFormModel(ok({ value: 0.5 }), rateItem())).toContain('不能小于 1%')
  })

  it('范围内的值放行，边界值也放行', () => {
    expect(validateFormModel(ok({ value: 1 }), rateItem())).toBeNull()
    expect(validateFormModel(ok({ value: 30 }), rateItem())).toBeNull()
  })

  it('ENUM 的取值必须在 options 里', () => {
    const enumItem = item({
      key: 'condition_rate_method',
      type: 'ENUM',
      options: ['YEAR', 'OBSERVE', 'RESTORATION_COST']
    })
    expect(validateFormModel(ok({ value: 'OBSERVE' }), enumItem)).toBeNull()
    const message = validateFormModel(ok({ value: 'GUESS' }), enumItem)
    expect(message).toContain('YEAR')
    expect(message).toContain('RESTORATION_COST')
  })

  it('值留空要拦（后端的 PARAM_VALUE_REQUIRED 会拦，但那是提交之后的事）', () => {
    expect(validateFormModel(ok({ value: undefined }), rateItem())).toContain('请填写参数')
    expect(validateFormModel(ok({ value: '' }), rateItem())).toContain('请填写参数')
  })

  it('🔴 0 是一个声明过的值，不算留空', () => {
    const vacancy = rateItem({ key: 'vacancy_rate', label: '空置率', range: { min: 0, max: 1 } })
    expect(validateFormModel(ok({ value: 0 }), vacancy)).toBeNull()
  })

  it('没有 schema 时不校验值——通用参数那一支是自由输入，键在不在 schema 里由后端判', () => {
    expect(validateFormModel(ok({ value: undefined }), null)).toBeNull()
    expect(validateFormModel(ok({ value: 1e9 }), undefined)).toBeNull()
  })

  it('🔴 复合值不校验值：拦下来的话这一行连改个名字都提交不了', () => {
    const original = row({ valueJson: { a: 1 } })
    expect(validateFormModel(ok({ value: undefined }), null, original)).toBeNull()
  })

  it('必填的几个字段留空各自有一句话', () => {
    expect(validateFormModel(ok({ paramKey: '' }), rateItem())).toContain('参数键')
    expect(validateFormModel(ok({ paramName: '  ' }), rateItem())).toContain('参数名称')
    expect(validateFormModel(ok({ sourceType: '' }), rateItem())).toContain('来源类型')
  })
})

describe('canBeBlockRuleLocked', () => {
  it('🔴 专家指引一律锁死（§11.9.1 纪律 2：专家指引只能出 WARN，不能卡住出稿）', () => {
    expect(canBeBlockRuleLocked('EXPERT_GUIDE')).toBe(true)
  })

  it('其余四类都不锁', () => {
    for (const type of ['STANDARD', 'GOVERNMENT', 'ORG_INTERNAL', 'MARKET']) {
      expect(canBeBlockRuleLocked(type)).toBe(false)
    }
  })

  it('没选来源时不锁——真正的强制在服务端，前端这一层只负责让用户看得见它为什么灰', () => {
    expect(canBeBlockRuleLocked(null)).toBe(false)
    expect(canBeBlockRuleLocked(undefined)).toBe(false)
    expect(canBeBlockRuleLocked('')).toBe(false)
  })
})
