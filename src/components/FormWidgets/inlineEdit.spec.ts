import { describe, expect, it } from 'vitest'
import {
  buildSubmitPayload,
  dateValueFormat,
  editableColumns,
  hasChanges,
  inlineEditWidgetOf,
  isInlineEditable,
  pickEditableValues
} from './inlineEdit'

const col = (over: Record<string, any> = {}) => ({ field: 'name', ...over })

describe('哪些列能行内编辑', () => {
  it('普通列可以', () => {
    expect(isInlineEditable(col())).toBe(true)
  })

  it('⚠️ 明细列不行', () => {
    // 一条主记录被摊平成多行，改其中一行的主表值语义不明确
    expect(isInlineEditable(col({ subField: 'items' }))).toBe(false)
  })

  it('图片 / 附件 / 超链接不行', () => {
    expect(isInlineEditable(col({ formatter: { type: 'IMAGE' } }))).toBe(false)
    expect(isInlineEditable(col({ formatter: { type: 'FILE' } }))).toBe(false)
    expect(isInlineEditable(col({ formatter: { type: 'LINK' } }))).toBe(false)
  })

  it('没绑字段的列不行', () => {
    expect(isInlineEditable({ label: '操作' })).toBe(false)
    expect(isInlineEditable(undefined)).toBe(false)
  })

  it('只有勾了「可行内编辑」且本身合规的列才参与', () => {
    const columns = [
      col({ field: 'a', inlineEditable: true }),
      col({ field: 'b' }),
      col({ field: 'c', inlineEditable: true, subField: 'items' })
    ]
    expect(editableColumns(columns).map((c) => c.field)).toEqual(['a'])
  })

  it('列为空时返回空数组而不是抛异常', () => {
    expect(editableColumns(undefined as any)).toEqual([])
  })
})

describe('编辑态渲染成什么控件', () => {
  it('字典与标签列渲染成下拉，并带出字典类型', () => {
    expect(inlineEditWidgetOf(col({ formatter: { type: 'DICT', dictType: 'd1' } }))).toEqual({
      widget: 'SELECT',
      dictType: 'd1'
    })
    expect(inlineEditWidgetOf(col({ formatter: { type: 'TAG', dictType: 'd2' } }))).toEqual({
      widget: 'SELECT',
      dictType: 'd2'
    })
  })

  it('没配字典类型时回落到文本框，不给一个永远空的下拉', () => {
    expect(inlineEditWidgetOf(col({ formatter: { type: 'DICT' } })).widget).toBe('TEXT')
  })

  it('数字与百分比都用数字输入框', () => {
    expect(inlineEditWidgetOf(col({ formatter: { type: 'NUMBER' } })).widget).toBe('NUMBER')
    expect(inlineEditWidgetOf(col({ formatter: { type: 'PERCENT' } })).widget).toBe('NUMBER')
  })

  it('日期与日期时间分开，布尔用开关', () => {
    expect(inlineEditWidgetOf(col({ formatter: { type: 'DATE' } })).widget).toBe('DATE')
    expect(inlineEditWidgetOf(col({ formatter: { type: 'DATETIME' } })).widget).toBe('DATETIME')
    expect(inlineEditWidgetOf(col({ formatter: { type: 'BOOLEAN' } })).widget).toBe('SWITCH')
  })

  it('没配格式化时是文本框', () => {
    expect(inlineEditWidgetOf(col()).widget).toBe('TEXT')
  })

  it('日期格式带不带时分秒跟着控件走', () => {
    expect(dateValueFormat('DATE')).toBe('YYYY-MM-DD')
    expect(dateValueFormat('DATETIME')).toBe('YYYY-MM-DD HH:mm:ss')
  })
})

describe('取值与提交', () => {
  const columns = [
    col({ field: 'price', inlineEditable: true, formatter: { type: 'NUMBER' } }),
    col({ field: 'qty', inlineEditable: true }),
    col({ field: 'name' })
  ]

  it('只取可编辑列的初始值', () => {
    const full = { id: 1, price: 10, qty: 2, name: '甲', remark: '备注' }
    expect(pickEditableValues(full, columns)).toEqual({ price: 10, qty: 2 })
  })

  it('⚠️ 提交的是整条记录，编辑值只是覆盖上去', () => {
    // 只提交改过的字段，会让没配成列的字段（备注、附件）被当成「清空」
    const full = { id: 1, price: 10, qty: 2, remark: '别删我', version: 3 }
    expect(buildSubmitPayload(full, { price: 20 })).toEqual({
      id: 1,
      price: 20,
      qty: 2,
      remark: '别删我',
      version: 3
    })
  })

  it('乐观锁版本号会随整条记录一起带上', () => {
    expect(buildSubmitPayload({ version: 7 }, {}).version).toBe(7)
  })

  it('入参为空时不抛异常', () => {
    expect(buildSubmitPayload(undefined as any, undefined as any)).toEqual({})
  })
})

describe('改没改过', () => {
  it('值变了算改过', () => {
    expect(hasChanges({ price: 10 }, { price: 20 })).toBe(true)
  })

  it('值没变不算改过，避免空提交', () => {
    // 空提交一样会推高版本号并写一条变更日志，让「谁改了什么」混进噪音
    expect(hasChanges({ price: 10 }, { price: 10 })).toBe(false)
  })

  it('⚠️ 数字 1 与字符串 "1" 不算改过', () => {
    // 库里读出来是数字，下拉选项的值是字符串，严格相等会把「没改」判成「改了」
    expect(hasChanges({ status: 1 }, { status: '1' })).toBe(false)
  })

  it('空与 null、undefined 之间互转不算改过', () => {
    expect(hasChanges({ remark: null }, { remark: '' })).toBe(false)
    expect(hasChanges({ remark: undefined }, { remark: null })).toBe(false)
  })

  it('从空改成有值算改过', () => {
    expect(hasChanges({ remark: '' }, { remark: '新内容' })).toBe(true)
  })

  it('从有值改成空算改过', () => {
    expect(hasChanges({ remark: '旧内容' }, { remark: '' })).toBe(true)
  })
})
