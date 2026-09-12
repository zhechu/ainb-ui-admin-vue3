import { describe, expect, it } from 'vitest'
import { collectFormulaFields, recalculateFormulas } from './useFormulaRuntime'

describe('子表内的公式按行求值', () => {
  const subFormulaRules = [
    {
      type: 'group',
      field: 'items',
      props: {
        rule: [
          { type: 'inputNumber', field: 'qty' },
          { type: 'inputNumber', field: 'price' },
          {
            type: 'Formula',
            field: 'amount',
            props: {
              expression: '{qty} * {price}',
              ast: {
                type: 'binary',
                op: '*',
                left: { type: 'field', name: 'qty' },
                right: { type: 'field', name: 'price' }
              },
              precision: 2
            }
          }
        ]
      }
    }
  ]

  it('收集时带上所属子表，不与主表同名字段混为一谈', () => {
    const formulas = collectFormulaFields(subFormulaRules)
    expect(formulas).toHaveLength(1)
    expect(formulas[0].subField).toBe('items')
  })

  it('⚠️ 每一行各算各的，而不是去主表上找 qty / price', () => {
    // 不区分作用域的话，它会去主表上找 qty/price，找不到就恒定算出 0 ——
    // 配了公式却永远是 0，而且不报错
    const data: any = {
      items: [
        { qty: 2, price: 100 },
        { qty: 3, price: 50.5 }
      ]
    }
    recalculateFormulas(collectFormulaFields(subFormulaRules), data)
    expect(data.items[0].amount).toBe(200)
    expect(data.items[1].amount).toBe(151.5)
  })

  it('⚠️ 变更集回的是子表控件的字段名，不是明细字段名', () => {
    // 调用方拿它去 api.setValue 推回界面，要推的是整个子表数组。
    // 回明细字段名的话主表上根本没有那个字段，推回去是个空操作
    const data: any = { items: [{ qty: 2, price: 100 }] }
    const changed = recalculateFormulas(collectFormulaFields(subFormulaRules), data)
    expect(changed).toEqual(['items'])
  })

  it('值没变时不进变更集', () => {
    const data: any = { items: [{ qty: 2, price: 100, amount: 200 }] }
    expect(recalculateFormulas(collectFormulaFields(subFormulaRules), data)).toEqual([])
  })

  it('子表为空或不是数组时不抛异常', () => {
    const formulas = collectFormulaFields(subFormulaRules)
    expect(() => recalculateFormulas(formulas, { items: [] })).not.toThrow()
    expect(() => recalculateFormulas(formulas, {})).not.toThrow()
    expect(() => recalculateFormulas(formulas, { items: null })).not.toThrow()
    expect(() => recalculateFormulas(formulas, { items: [null, 42] })).not.toThrow()
  })

  it('主表公式与子表公式互不干扰', () => {
    const rules = [
      ...subFormulaRules,
      {
        type: 'Formula',
        field: 'total',
        props: {
          ast: {
            type: 'binary',
            op: '+',
            left: { type: 'field', name: 'a' },
            right: { type: 'field', name: 'b' }
          },
          precision: 2
        }
      }
    ]
    const data: any = { a: 1, b: 2, items: [{ qty: 2, price: 3 }] }
    const changed = recalculateFormulas(collectFormulaFields(rules), data)
    expect(data.total).toBe(3)
    expect(data.items[0].amount).toBe(6)
    expect(changed.sort()).toEqual(['items', 'total'])
  })
})
