/**
 * 子表增强的单元测试
 *
 * 重点守两件事：
 * 1. 合计的口径与公式字段一致 —— 否则同一份明细，公式算出的合计与合计行显示的
 *    可能差一分钱，用户会认为是系统算错了
 * 2. 判空口径与后端 SubTableGuard 一致 —— 否则会出现「界面上没标红但提交被拒」
 */
import { describe, expect, it } from 'vitest'
import {
  calculateSummary,
  duplicateRow,
  validateRequiredCells,
  validateRowCount
} from './useSubTableEnhance'

describe('子表合计', () => {
  const rows = [{ price: 10 }, { price: 20 }, { price: 5 }]

  it('SUM 求和', () => {
    const result = calculateSummary(rows, [
      { field: 'price', label: '单价', method: 'SUM' }
    ])
    expect(result.price).toBe(35)
  })

  it('⚠️ 与公式字段同源：空值被忽略而不是让整列算成空', () => {
    const result = calculateSummary([{ price: 10 }, { price: null }, { price: '20' }], [
      { field: 'price', label: '单价', method: 'SUM' }
    ])
    // 字符串 "20" 也要按数字参与 —— 表单里的数值往往是字符串
    expect(result.price).toBe(30)
  })

  it('AVG 按有值行数平均', () => {
    const result = calculateSummary([{ p: 10 }, { p: 20 }, { p: null }], [
      { field: 'p', label: 'P', method: 'AVG' }
    ])
    expect(result.p).toBe(15)
  })

  it('COUNT 数所有行，包括值为空的', () => {
    const result = calculateSummary([{ p: 1 }, { p: null }, {}], [
      { field: 'p', label: 'P', method: 'COUNT' }
    ])
    expect(result.p).toBe(3)
  })

  it('MAX / MIN', () => {
    const result = calculateSummary(rows, [
      { field: 'price', label: '单价', method: 'MAX' },
      { field: 'price', label: '单价', method: 'MIN' }
    ])
    // 后一条覆盖前一条（同字段），这里只验证不报错且算出了值
    expect(result.price).toBe(5)
  })

  it('空明细时 SUM 得 0，不是空', () => {
    expect(calculateSummary([], [{ field: 'p', label: 'P', method: 'SUM' }]).p).toBe(0)
  })

  it('按配置的精度收敛', () => {
    const result = calculateSummary([{ p: 10 }, { p: 20 }], [
      { field: 'p', label: 'P', method: 'AVG', precision: 1 }
    ])
    expect(result.p).toBe(15)
  })

  it('没有合计列时返回空对象', () => {
    expect(calculateSummary(rows, [])).toEqual({})
  })

  it('明细为 null 时不抛异常', () => {
    expect(() =>
      calculateSummary(null, [{ field: 'p', label: 'P', method: 'SUM' }])
    ).not.toThrow()
  })
})

describe('行复制', () => {
  it('⚠️ 深拷贝：复制出的行改数组值不会影响原行', () => {
    const row = { name: 'A', tags: ['x', 'y'] }
    const copy = duplicateRow(row)
    copy.tags.push('z')
    expect(row.tags, '浅拷贝会让两行共用同一个数组').toHaveLength(2)
  })

  it('⚠️ 主键被清掉 —— 否则保存时会被当成更新原行', () => {
    const copy = duplicateRow({ id: 100, name: 'A' })
    expect(copy.id).toBeUndefined()
    expect(copy.name).toBe('A')
  })

  it('可以指定多个主键字段', () => {
    const copy = duplicateRow({ id: 1, rowKey: 2, name: 'A' }, ['id', 'rowKey'])
    expect(copy.id).toBeUndefined()
    expect(copy.rowKey).toBeUndefined()
  })

  it('空行不抛异常', () => {
    expect(() => duplicateRow(undefined as any)).not.toThrow()
  })
})

describe('行内必填校验', () => {
  const columns = [
    { field: 'price', label: '单价', required: true },
    { field: 'remark', label: '备注', required: false }
  ]

  it('⚠️ 报错带行号，且从 1 开始（与界面一致，不是数组下标）', () => {
    const errors = validateRequiredCells(
      'items',
      [{ price: 10 }, { price: null }, { price: 20 }],
      columns
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].rowNumber).toBe(2)
    expect(errors[0].message).toContain('第 2 行')
    expect(errors[0].label).toBe('单价')
  })

  it('⚠️ 判空口径与后端一致：null / undefined / 空串 / 空数组都算空', () => {
    const errors = validateRequiredCells(
      'items',
      [{ price: null }, { price: undefined }, { price: '' }, { price: [] }],
      columns
    )
    expect(
      errors,
      '两边口径不一致会出现「界面上没标红但提交被拒」'
    ).toHaveLength(4)
  })

  it('数字 0 不算空', () => {
    expect(validateRequiredCells('items', [{ price: 0 }], columns)).toHaveLength(0)
  })

  it('非必填列留空不报错', () => {
    expect(validateRequiredCells('items', [{ price: 1, remark: '' }], columns)).toHaveLength(0)
  })

  it('明细为空时没有错误', () => {
    expect(validateRequiredCells('items', [], columns)).toHaveLength(0)
    expect(validateRequiredCells('items', null, columns)).toHaveLength(0)
  })
})

describe('行数区间校验', () => {
  it('低于下限时报错', () => {
    expect(validateRowCount('明细', 0, 1, null)).toContain('至少')
  })

  it('高于上限时报错', () => {
    expect(validateRowCount('明细', 5, null, 3)).toContain('最多')
  })

  it('在区间内时通过', () => {
    expect(validateRowCount('明细', 2, 1, 5)).toBeNull()
  })

  it('没配限制时一律通过', () => {
    expect(validateRowCount('明细', 999, null, null)).toBeNull()
    expect(validateRowCount('明细', 0, 0, 0)).toBeNull()
  })
})
