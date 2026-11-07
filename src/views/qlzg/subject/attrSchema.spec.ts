import { describe, expect, it } from 'vitest'
import type { QlzgParamSchemaItem } from '@/api/qlzg/category'
import {
  ATTR_TYPE,
  GEO_BOUNDS,
  buildAttrsPayload,
  displayPrecision,
  displayRange,
  isAbsent,
  loadAttrsModel,
  missingRequiredLabels,
  orphanKeys,
  toDisplayValue,
  toStoredValue
} from './attrSchema'

/**
 * 标的属性换算的边界测试
 *
 * 🔴 这些用例钉的是**后端 {@code QlzgSubjectAttrsProcessor} 的镜像行为**，不是前端自己的约定。
 *    两边不一致的表现全都是「不报错但结果错」，而其中最难被发现的一种是百分数：
 *    用户填 7.5、库里存 0.075、再打开显示 0.075% —— 每一步单独看都「对」，
 *    而报告上的资本化率就差了 100 倍。所以这一组的往返用例是这份测试存在的**主要理由**。
 */

const item = (over: Partial<QlzgParamSchemaItem> = {}): QlzgParamSchemaItem => ({
  key: 'k',
  label: '测试项',
  type: ATTR_TYPE.DECIMAL,
  scope: 'SUBJECT_ATTR',
  ...over
})

const percentItem = (over: Partial<QlzgParamSchemaItem> = {}) =>
  item({
    key: 'capitalization_rate',
    label: '资本化率',
    type: ATTR_TYPE.DECIMAL,
    unit: '%',
    ...over
  })

describe('isAbsent', () => {
  it('null / undefined / 空串 / 纯空白 / 空对象 / 空数组都算没填', () => {
    expect(isAbsent(null)).toBe(true)
    expect(isAbsent(undefined)).toBe(true)
    expect(isAbsent('')).toBe(true)
    expect(isAbsent('   ')).toBe(true)
    expect(isAbsent({})).toBe(true)
    expect(isAbsent([])).toBe(true)
  })

  it('0 与 false 不算没填——面积为 0 是一个声明过的值', () => {
    expect(isAbsent(0)).toBe(false)
    expect(isAbsent(false)).toBe(false)
  })
})

describe('displayPrecision', () => {
  it('百分数项减 2 位：库里 scale 4 的分数，界面上只需要 2 位', () => {
    expect(displayPrecision(percentItem({ scale: 4 }))).toBe(2)
    expect(displayPrecision(percentItem({ scale: 6 }))).toBe(4)
  })

  it('scale 比 2 小时夹到 0，不给负精度', () => {
    expect(displayPrecision(percentItem({ scale: 1 }))).toBe(0)
    expect(displayPrecision(percentItem({ scale: 2 }))).toBe(0)
  })

  it('非百分数的 DECIMAL 原样用 scale', () => {
    expect(displayPrecision(item({ scale: 2 }))).toBe(2)
    expect(displayPrecision(item({ scale: 0 }))).toBe(0)
  })

  it('INT 恒为 0 位', () => {
    expect(displayPrecision(item({ type: ATTR_TYPE.INT, scale: 4 }))).toBe(0)
  })

  it('🔴 没声明 scale 时返回 undefined，不替它补一个', () => {
    // 补零会凭空造出精度：库里存 1234567、界面显示 1234567.00，
    // 而那两个 0 从来没有被任何人断言过
    expect(displayPrecision(item({}))).toBeUndefined()
    expect(displayPrecision(percentItem({}))).toBeUndefined()
  })

  it('STRING / ENUM / DATE 不参与小数位', () => {
    expect(displayPrecision(item({ type: ATTR_TYPE.STRING, scale: 4 }))).toBeUndefined()
    expect(displayPrecision(item({ type: ATTR_TYPE.DATE, scale: 4 }))).toBeUndefined()
  })
})

describe('displayRange', () => {
  it('百分数项的区间换算到显示口径', () => {
    // 后端 range 描述的是库里的分数，直接给显示 7.5 的输入框，用户无从下手
    expect(displayRange(percentItem({ range: { min: 0.01, max: 0.3 } }))).toEqual({
      min: 1,
      max: 30
    })
  })

  it('非百分数项原样透传', () => {
    expect(displayRange(item({ range: { min: 10, max: 999 } }))).toEqual({ min: 10, max: 999 })
  })

  it('🔴 乘完要削掉浮点噪声：0.29 * 100 在 JS 里是 28.999999999999996', () => {
    // 不削的后果是「填一个恰好等于上限的值」被拒，而 el-input-number 的 :max
    // 收到这个数之后连加号都点不到 29。它**挑值**：0.3*100 恰好是 30、0.29*100 不是，
    // 所以换一个参数就复现或不复现，报上来的样子是「校验时严时松」
    expect(displayRange(percentItem({ range: { min: 0.07, max: 0.29 } }))).toEqual({
      min: 7,
      max: 29
    })
    // 上面那两个数不削的话分别是 7.000000000000001 与 28.999999999999996
    expect(0.29 * 100).not.toBe(29)
    expect(0.07 * 100).not.toBe(7)
  })

  it('只有一边时另一边留空 = 不限', () => {
    expect(displayRange(item({ range: { min: 0.3 } }))).toEqual({ min: 0.3, max: undefined })
  })

  it('没有 range 时返回空对象', () => {
    expect(displayRange(item({}))).toEqual({})
    expect(displayRange(item({ range: null }))).toEqual({})
  })

  it('🔴 INT 的单位是 % 也不换算：整数百分数在品类定义里不成立', () => {
    expect(
      displayRange(item({ type: ATTR_TYPE.INT, unit: '%', range: { min: 1, max: 9 } }))
    ).toEqual({ min: 1, max: 9 })
  })
})

describe('百分数往返', () => {
  it('库里的分数 → 界面上的百分数', () => {
    expect(toDisplayValue(percentItem({ scale: 4 }), 0.075)).toBe(7.5)
    expect(toDisplayValue(percentItem({ scale: 4 }), 0.3)).toBeCloseTo(30, 10)
  })

  it('界面上的百分数 → 库里的分数', () => {
    expect(toStoredValue(percentItem({ scale: 4 }), 7.5)).toBeCloseTo(0.075, 12)
  })

  it('🔴 先按显示精度截一刀再除，避免浮点噪声落进 decimal(24,8)', () => {
    // scale=4 ⟹ 显示精度 2，所以 7.5678 先截成 7.57，再除成 0.0757
    expect(toStoredValue(percentItem({ scale: 4 }), 7.5678)).toBeCloseTo(0.0757, 12)
  })

  it('⚠️ 刻意不用 7.505 这类「看着正好在中点上」的值做用例', () => {
    // 7.505 的 double 表示是 7.50499999999999989…，本来就**低于**中点，
    // toFixed(2) 给 "7.50" 是对的。拿它当「应该进位」的例子会得到一条
    // 断言错误行为的测试 —— 而它挂了看起来像换算写错了，实际是用例选错了数
    expect(toStoredValue(percentItem({ scale: 4 }), 7.505)).toBeCloseTo(0.075, 12)
  })

  it('没声明 scale 时不做任何舍入，原样换算', () => {
    expect(toStoredValue(percentItem({}), 7.5)).toBeCloseTo(0.075, 12)
  })

  it('一整趟 load → build 之后值不变', () => {
    const schema = [
      percentItem({ scale: 4 }),
      percentItem({ key: 'vacancy_rate', label: '空置率', scale: 4 })
    ]
    const stored = { capitalization_rate: 0.075, vacancy_rate: 0.12 }
    const model = loadAttrsModel(schema, stored)
    expect(model).toEqual({ capitalization_rate: 7.5, vacancy_rate: 12 })
    expect(buildAttrsPayload(schema, model)).toEqual(stored)
  })
})

describe('GEO', () => {
  const geo = (over: Partial<QlzgParamSchemaItem> = {}) =>
    item({ key: 'geo_location', label: '坐标', type: ATTR_TYPE.GEO, ...over })

  it('两个分量都有值才算填了', () => {
    expect(toStoredValue(geo(), { lng: 116.397428, lat: 39.9042 })).toEqual({
      lng: 116.397428,
      lat: 39.9042
    })
  })

  it('🔴 只有半个对象时整个键省掉，不发 {lng} 让后端报「缺 lat」', () => {
    expect(toStoredValue(geo(), { lng: 116.4 })).toBeUndefined()
    expect(toStoredValue(geo(), { lat: 39.9 })).toBeUndefined()
    expect(toStoredValue(geo(), {})).toBeUndefined()
    expect(toStoredValue(geo(), { lng: '', lat: '' })).toBeUndefined()
  })

  it('经纬度截到 6 位，与后端同值', () => {
    expect(toStoredValue(geo(), { lng: 116.3974283456, lat: 39.90421234 })).toEqual({
      lng: 116.397428,
      lat: 39.904212
    })
  })

  it('🔴 键名只有 lng / lat，不做别名兼容——R33 拼的是 Point(lng, lat)、顺序敏感', () => {
    expect(toStoredValue(geo(), { longitude: 116.4, latitude: 39.9 })).toBeUndefined()
  })

  it('半个对象回填时照实显示缺哪一边，而不是当成没填', () => {
    expect(toDisplayValue(geo(), { lng: 116.4 })).toEqual({ lng: 116.4, lat: undefined })
  })

  it('🔴 库里没值时也回填一个空对象，不是 undefined', () => {
    // 模板上两个输入框绑的是 model[key].lng / model[key].lat，
    // 模型值是 undefined 的话第一次渲染就会在读属性时抛错
    expect(toDisplayValue(geo(), null)).toEqual({ lng: undefined, lat: undefined })
    expect(toDisplayValue(geo(), undefined)).toEqual({ lng: undefined, lat: undefined })
    // 而这个「空壳对象」在提交侧仍然算没填
    expect(toStoredValue(geo(), toDisplayValue(geo(), null))).toBeUndefined()
  })

  it('界限常量与后端四个 BigDecimal 常量一致', () => {
    expect(GEO_BOUNDS).toEqual({ lngMin: -180, lngMax: 180, latMin: -90, latMax: 90 })
  })
})

describe('toStoredValue 的各类型', () => {
  it('🔴 STRING 的空串整个键省掉——后端收到空串会报错，不是当成清空', () => {
    const str = item({ type: ATTR_TYPE.STRING, key: 'address', label: '坐落' })
    expect(toStoredValue(str, '   ')).toBeUndefined()
    expect(toStoredValue(str, ' 西湖区 ')).toBe('西湖区')
  })

  it('DATE 原样给字符串，后端要的是 yyyy-MM-dd', () => {
    const date = item({ type: ATTR_TYPE.DATE, key: 'built_year', label: '建成日期' })
    expect(toStoredValue(date, '2026-10-30')).toBe('2026-10-30')
    expect(toStoredValue(date, '')).toBeUndefined()
  })

  it('ENUM 原样给码，可选值的校验在后端（两边重复实现就是两份会漂移的检查点）', () => {
    const e = item({
      type: ATTR_TYPE.ENUM,
      key: 'right_type',
      label: '权利类型',
      options: ['出让', '划拨']
    })
    expect(toStoredValue(e, '出让')).toBe('出让')
  })

  it('INT 截断小数，非数省掉', () => {
    const int = item({ type: ATTR_TYPE.INT, key: 'floors', label: '层数' })
    expect(toStoredValue(int, 7.9)).toBe(7)
    expect(toStoredValue(int, 'abc')).toBeUndefined()
  })

  it('DECIMAL 非百分数原样透传', () => {
    expect(toStoredValue(item({}), 123.45)).toBe(123.45)
    expect(toStoredValue(item({}), '1e5')).toBe(100000)
  })
})

describe('buildAttrsPayload', () => {
  const schema = [
    item({ key: 'building_area', label: '建筑面积', scale: 2, required: true }),
    item({ key: 'land_area', label: '土地面积', scale: 2 }),
    percentItem({ key: 'usable_area_ratio', label: '得房率', scale: 4 })
  ]

  it('只输出 schema 声明过的键，顺序跟着 schema 走', () => {
    const payload = buildAttrsPayload(schema, {
      land_area: 200,
      building_area: 350.5,
      usable_area_ratio: 75
    })
    expect(Object.keys(payload)).toEqual(['building_area', 'land_area', 'usable_area_ratio'])
    expect(payload).toEqual({ building_area: 350.5, land_area: 200, usable_area_ratio: 0.75 })
  })

  it('🔴 模型里多出来的键被丢掉——回传孤儿键会让这个标的再也改不动', () => {
    const payload = buildAttrsPayload(schema, {
      building_area: 350.5,
      removed_legacy_key: '历史值'
    })
    expect(payload).toEqual({ building_area: 350.5 })
  })

  it('没填的选填项整个键省掉，不写 null', () => {
    // 写 null 的话 attrs 里会攒一堆 {"land_area":null}，而 I5 的事实装载
    // 分不清「这个属性没填」和「这个属性不存在」
    expect(buildAttrsPayload(schema, { building_area: 350.5 })).toEqual({ building_area: 350.5 })
  })

  it('0 是一个声明过的值，要发出去', () => {
    expect(buildAttrsPayload(schema, { building_area: 0 })).toEqual({ building_area: 0 })
  })

  it('全空时返回 {}——🔴 而 {} 在后端的语义是「清空全部属性」，不是「不修改」', () => {
    expect(buildAttrsPayload(schema, {})).toEqual({})
  })
})

describe('loadAttrsModel', () => {
  const schema = [
    item({ key: 'building_area', label: '建筑面积', scale: 2 }),
    percentItem({ key: 'usable_area_ratio', label: '得房率', scale: 4 })
  ]

  it('attrs 为 null 时每一项都是 undefined', () => {
    expect(loadAttrsModel(schema, null)).toEqual({
      building_area: undefined,
      usable_area_ratio: undefined
    })
  })

  it('孤儿键不进模型', () => {
    const model = loadAttrsModel(schema, { building_area: 1, legacy: 'x' })
    expect(Object.keys(model)).toEqual(['building_area', 'usable_area_ratio'])
  })
})

describe('orphanKeys', () => {
  const schema = [item({ key: 'building_area', label: '建筑面积' })]

  it('库里有值、schema 已不再定义的键要被报出来', () => {
    expect(orphanKeys(schema, { building_area: 1, legacy_a: 'x', legacy_b: 2 })).toEqual([
      'legacy_a',
      'legacy_b'
    ])
  })

  it('值为空的孤儿键不报——它们本来就会被后端静默跳过', () => {
    expect(orphanKeys(schema, { legacy: null, legacy2: '', legacy3: {} })).toEqual([])
  })

  it('attrs 为 null 时返回空', () => {
    expect(orphanKeys(schema, null)).toEqual([])
    expect(orphanKeys(schema, undefined)).toEqual([])
  })
})

describe('missingRequiredLabels', () => {
  const schema = [
    item({ key: 'building_area', label: '建筑面积', required: true }),
    item({ key: 'land_area', label: '土地面积' }),
    percentItem({ key: 'usable_area_ratio', label: '得房率', required: true })
  ]

  it('只报必填且没填的项，用显示名', () => {
    expect(missingRequiredLabels(schema, { building_area: 350 })).toEqual(['得房率'])
  })

  it('填了 0 不算没填', () => {
    expect(missingRequiredLabels(schema, { building_area: 0, usable_area_ratio: 0 })).toEqual([])
  })

  it('GEO 只有半个也算没填', () => {
    const geoSchema = [
      item({ key: 'geo_location', label: '坐标', type: ATTR_TYPE.GEO, required: true })
    ]
    expect(missingRequiredLabels(geoSchema, { geo_location: { lng: 116.4 } })).toEqual(['坐标'])
  })

  it('label 缺失时退回 key，不留空白', () => {
    const noLabel = [item({ key: 'raw_key', label: '', required: true })]
    expect(missingRequiredLabels(noLabel, {})).toEqual(['raw_key'])
  })
})
