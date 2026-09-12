/**
 * 数组型控件空值归一的单元测试
 *
 * 守的是一次真实故障：控件总览示例里，编辑一条「穿梭框字段没填过」的记录，
 * 弹窗直接打不开。库里那一列是 NULL，读回来是 null，而 Element Plus 的穿梭框
 * 在 `props.modelValue.includes(...)` 上崩掉 —— 异常发生在渲染期，
 * 整个弹窗渲染不出来，列表却好好的，很难联想到是某个没填过的字段导致的。
 *
 * 另一半同样要守：**不能见到数组型字段就无脑覆盖**。
 * 子表控件的值类型也是数组，把它的空值补成 [] 会让「明细一行都没有」
 * 与「还没加载明细」在提交时长得一样。
 */

import { describe, expect, it } from 'vitest'
import { collectArrayFields, normalizeArrayValues } from './arrayValue'

/** 穿梭框：契约里的类型名是 elTransfer */
const transfer = (field: string) => ({ type: 'elTransfer', field })
const input = (field: string) => ({ type: 'input', field })
const checkbox = (field: string) => ({ type: 'checkbox', field })

describe('collectArrayFields', () => {
  it('认得出数组型控件，跳过标量控件', () => {
    const { main, sub } = collectArrayFields([transfer('tags'), input('title'), checkbox('hobby')])
    expect([...main].sort()).toEqual(['hobby', 'tags'])
    expect(sub.size).toBe(0)
  })

  it('布局容器里的字段仍算主表字段', () => {
    const { main } = collectArrayFields([
      { type: 'row', children: [{ type: 'col', children: [transfer('tags')] }] }
    ])
    expect([...main]).toEqual(['tags'])
  })

  it('⚠️ 子表控件本身不登记，只递归它内部的字段', () => {
    // group 的 valueType 也是 array，但它是容器
    const { main, sub } = collectArrayFields([
      { type: 'group', field: 'items', props: { rule: [transfer('subTags'), input('name')] } }
    ])
    expect(main.has('items'), '子表控件自己不该被当成待补字段').toBe(false)
    expect([...(sub.get('items') ?? [])]).toEqual(['subTags'])
  })
})

describe('normalizeArrayValues', () => {
  const rules = [transfer('tags'), input('title')]

  it('⚠️ null 补成空数组 —— 这正是穿梭框崩溃的那个值', () => {
    const result = normalizeArrayValues({ tags: null, title: 'x' }, rules)
    expect(result.tags).toEqual([])
    expect(result.title).toBe('x')
  })

  it('⚠️ 字段压根没出现在记录里也要补', () => {
    // 控件照样会渲染，拿到的仍然是 undefined，一样会崩
    const result = normalizeArrayValues({ title: 'x' }, rules)
    expect(result.tags).toEqual([])
  })

  it('已有的值一律不碰', () => {
    const result = normalizeArrayValues({ tags: ['a', 'b'], title: 'x' }, rules)
    expect(result.tags).toEqual(['a', 'b'])
  })

  it('⚠️ 空数组不是空值，不当作待补', () => {
    const record = { tags: [], title: 'x' }
    expect(normalizeArrayValues(record, rules)).toBe(record)
  })

  it('不修改入参', () => {
    const record: Record<string, any> = { tags: null }
    normalizeArrayValues(record, rules)
    expect(record.tags).toBeNull()
  })

  it('没有数组型字段时原样返回入参', () => {
    const record = { title: 'x' }
    expect(normalizeArrayValues(record, [input('title')])).toBe(record)
  })

  it('null / undefined 记录返回空对象，不抛异常', () => {
    expect(normalizeArrayValues(null, rules)).toEqual({})
    expect(normalizeArrayValues(undefined, rules)).toEqual({})
  })

  it('子表明细里的数组字段逐行补', () => {
    const subRules = [
      { type: 'group', field: 'items', props: { rule: [transfer('subTags')] } }
    ]
    const result = normalizeArrayValues(
      { items: [{ subTags: null }, { subTags: ['a'] }] },
      subRules
    )
    expect(result.items[0].subTags).toEqual([])
    expect(result.items[1].subTags).toEqual(['a'])
  })

  it('⚠️ 子表本身为空时不补成 []，保持原样', () => {
    const subRules = [{ type: 'group', field: 'items', props: { rule: [transfer('subTags')] } }]
    const result = normalizeArrayValues({ items: null }, subRules)
    expect(result.items, '明细为空与明细是空数组不是一回事').toBeNull()
  })
})
