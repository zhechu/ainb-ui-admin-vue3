import { describe, expect, it } from 'vitest'
import {
  backfillSearchWidget,
  coerceOperator,
  inferSearchWidget,
  isRangeWidget,
  isValuelessOperator,
  operatorsFor,
  SEARCH_OPERATORS,
  SEARCH_WIDGETS,
  toSingleVariant
} from './searchWidget'

describe('查询控件推断', () => {
  it('下拉类控件推断成下拉，并带出字典类型', () => {
    expect(inferSearchWidget({ type: 'select', props: { dictType: 'order_status' } })).toEqual({
      widget: 'SELECT',
      dictType: 'order_status'
    })
    expect(inferSearchWidget({ type: 'radio', dictType: 'sex' })).toEqual({
      widget: 'SELECT',
      dictType: 'sex'
    })
    expect(inferSearchWidget({ type: 'checkbox', __config__: { dictType: 'tag' } })).toEqual({
      widget: 'SELECT',
      dictType: 'tag'
    })
  })

  it('没配字典类型的下拉控件不返回 dictType，而不是返回空串', () => {
    // 空串会让运行时以为「配了一个叫空串的字典」，去请求一个必然 404 的接口
    expect(inferSearchWidget({ type: 'select' })).toEqual({ widget: 'SELECT' })
  })

  it('日期推断成区间而不是单日期', () => {
    // 「等于某一天」对 datetime 列几乎永远查不到，不能作为默认
    expect(inferSearchWidget({ type: 'datePicker' }).widget).toBe('DATE_RANGE')
  })

  it('数字推断成数字区间，开关推断成是否', () => {
    expect(inferSearchWidget({ type: 'inputNumber' }).widget).toBe('NUMBER_RANGE')
    expect(inferSearchWidget({ type: 'switch' }).widget).toBe('SWITCH')
  })

  it('认不出的控件与空规则都回落到文本框', () => {
    expect(inferSearchWidget({ type: 'signature' }).widget).toBe('TEXT')
    expect(inferSearchWidget(undefined).widget).toBe('TEXT')
    expect(inferSearchWidget(null).widget).toBe('TEXT')
  })
})

describe('操作符与控件的配套关系', () => {
  it('每种控件的操作符清单都非空，且都是后端认识的操作符', () => {
    const known = new Set(SEARCH_OPERATORS.map((op) => op.value))
    for (const { value } of SEARCH_WIDGETS) {
      const ops = operatorsFor(value)
      expect(ops.length).toBeGreaterThan(0)
      ops.forEach((op) => expect(known.has(op.value)).toBe(true))
    }
  })

  it('区间控件只给 BETWEEN', () => {
    expect(operatorsFor('DATE_RANGE').map((o) => o.value)).toEqual(['BETWEEN'])
    expect(operatorsFor('NUMBER_RANGE').map((o) => o.value)).toEqual(['BETWEEN'])
    expect(isRangeWidget('DATE_RANGE')).toBe(true)
    expect(isRangeWidget('TEXT')).toBe(false)
    expect(isRangeWidget(undefined)).toBe(false)
  })

  it('日期不给 LIKE', () => {
    // 后端执行得了，但对 datetime 列做字符串匹配的结果取决于驱动，属于能跑但不可预期
    expect(operatorsFor('DATE').map((o) => o.value)).not.toContain('LIKE')
  })

  it('未知控件按文本框处理，不返回空清单', () => {
    expect(operatorsFor(undefined).map((o) => o.value)).toEqual(
      operatorsFor('TEXT').map((o) => o.value)
    )
  })
})

describe('切换控件类型时的操作符归一', () => {
  it('操作符在新控件下仍成立时保持不变', () => {
    expect(coerceOperator('TEXT', 'LIKE')).toBe('LIKE')
    expect(coerceOperator('NUMBER', 'GE')).toBe('GE')
  })

  it('操作符不成立时顶上该控件的首选项，而不是清空', () => {
    // 清空会让「换一下控件类型，这个查询项就查不动了」
    expect(coerceOperator('DATE_RANGE', 'LIKE')).toBe('BETWEEN')
    expect(coerceOperator('SELECT', 'LIKE')).toBe('EQ')
  })

  it('没有传操作符时给出首选项', () => {
    expect(coerceOperator('TEXT')).toBe('LIKE')
    expect(coerceOperator('SWITCH')).toBe('EQ')
  })
})

describe('无值操作符', () => {
  it('为空 / 不为空不需要填值', () => {
    expect(isValuelessOperator('IS_NULL')).toBe(true)
    expect(isValuelessOperator('IS_NOT_NULL')).toBe(true)
  })

  it('其余操作符都要填值', () => {
    expect(isValuelessOperator('EQ')).toBe(false)
    expect(isValuelessOperator(undefined)).toBe(false)
  })
})

describe('旧查询项补 widget', () => {
  it('日期字段配的是 BETWEEN 时给区间控件', () => {
    const r = backfillSearchWidget({ operator: 'BETWEEN' }, { type: 'datePicker' })
    expect(r.widget).toBe('DATE_RANGE')
    expect(r.operator).toBe('BETWEEN')
  })

  it('日期字段配的是等于时降级成单日期，不把语义改成查一段时间', () => {
    // 已发布表单的查询结果不能因为这次改造而变
    const r = backfillSearchWidget({ operator: 'EQ' }, { type: 'datePicker' })
    expect(r.widget).toBe('DATE')
    expect(r.operator).toBe('EQ')
  })

  it('数字字段配的是大于时降级成单值数字', () => {
    const r = backfillSearchWidget({ operator: 'GT' }, { type: 'inputNumber' })
    expect(r.widget).toBe('NUMBER')
    expect(r.operator).toBe('GT')
  })

  it('文本字段的 BETWEEN 原样保留，不被改写成数字区间', () => {
    // 编号区间 A001 ~ A999 是真实用法，改成数字区间会让它查不出东西
    const r = backfillSearchWidget({ operator: 'BETWEEN' }, { type: 'input' })
    expect(r.widget).toBe('TEXT')
    expect(r.operator).toBe('BETWEEN')
  })

  it('下拉字段带出字典类型，操作符归一到等于', () => {
    const r = backfillSearchWidget(
      { operator: 'LIKE' },
      { type: 'select', props: { dictType: 'order_status' } }
    )
    expect(r).toEqual({ widget: 'SELECT', dictType: 'order_status', operator: 'EQ' })
  })

  it('规则树里找不到的字段（关联列 / 审计列）回落到文本框', () => {
    const r = backfillSearchWidget({ operator: 'LIKE' }, undefined)
    expect(r.widget).toBe('TEXT')
    expect(r.operator).toBe('LIKE')
  })

  it('单值变体转换对非区间控件是恒等的', () => {
    expect(toSingleVariant('TEXT')).toBe('TEXT')
    expect(toSingleVariant('DATE_RANGE')).toBe('DATE')
    expect(toSingleVariant('NUMBER_RANGE')).toBe('NUMBER')
  })
})
