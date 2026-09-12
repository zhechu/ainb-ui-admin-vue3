import { describe, expect, it } from 'vitest'
import { collectDefaultValues } from './formDefaults'

describe('collectDefaultValues', () => {
  it('抓得到顶层控件的默认值', () => {
    const rules = [
      { field: 'status', value: 'DRAFT' },
      { field: 'amount', value: 0 },
      { field: 'remark' } // 没配默认值的不应出现，否则会把它写成 undefined 之外的东西
    ]
    expect(collectDefaultValues(rules)).toEqual({ status: 'DRAFT', amount: 0 })
  })

  it('布局容器里的控件与外层同作用域，要一起收', () => {
    const rules = [
      {
        type: 'row',
        children: [
          { type: 'col', children: [{ field: 'city', value: 'SH' }] },
          { field: 'level', value: 'A' }
        ]
      }
    ]
    expect(collectDefaultValues(rules)).toEqual({ city: 'SH', level: 'A' })
  })

  it('子表内部的字段不收 —— 平铺到顶层会写出一个不存在的字段', () => {
    const rules = [
      { field: 'title', value: '默认标题' },
      {
        type: 'group',
        field: 'items',
        props: { rule: [{ field: 'price', value: 99 }] }
      }
    ]
    const defaults = collectDefaultValues(rules)
    expect(defaults).toHaveProperty('title')
    expect(defaults).not.toHaveProperty('price')
  })

  it('数组与对象默认值要拷贝，否则用户的改动会污染下一次新增', () => {
    const source = ['a', 'b']
    const defaults = collectDefaultValues([{ field: 'tags', value: source }])
    expect(defaults.tags).toEqual(['a', 'b'])
    defaults.tags.push('c')
    expect(source, '默认值被改坏了').toEqual(['a', 'b'])
  })

  it('规则树坏掉时不抛异常', () => {
    expect(collectDefaultValues(undefined as any)).toEqual({})
    expect(collectDefaultValues([null, undefined, 'x'] as any)).toEqual({})
  })
})
