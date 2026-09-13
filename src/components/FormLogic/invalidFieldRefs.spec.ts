import { describe, expect, it } from 'vitest'
import { findInvalidFieldRefs } from './invalidFieldRefs'
import type { LogicRule } from './types'

/**
 * 联动规则的「引用了已删字段」检测
 *
 * 这条校验防的是：先配好联动，之后回表单设计把字段删了 ——
 * 运行时整条规则被静默跳过，界面上没有任何异常。
 *
 * 用例分两类：
 * - **漏报**（该报没报）：右值引用、动作目标
 * - **误报**（不该报却报了）：rowScope 规则的明细列。这一类更严重 ——
 *   校验结果现在会挡住保存，误报会把本来正常的表单卡死
 */
describe('findInvalidFieldRefs', () => {
  const MAIN_FIELDS = ['amount', 'remark']
  /** 子表 items 的明细列，层级 key 形态 */
  const WITH_SUB = ['amount', 'items', 'items.price', 'items.qty']

  const rule = (patch: Partial<LogicRule>): LogicRule =>
    ({ id: 'r1', name: 'r1', ...patch }) as LogicRule

  const cond = (field: string) => ({ logic: 'AND', items: [{ field, operator: 'NOT_EMPTY' }] })

  it('字段都在时不报', () => {
    const rules = [rule({ when: cond('amount') as any, then: [{ type: 'SHOW', target: 'remark' }] })]
    expect(findInvalidFieldRefs(rules, MAIN_FIELDS)).toEqual([])
  })

  it('条件左值引用了已删字段', () => {
    const rules = [rule({ when: cond('gone') as any })]
    expect(findInvalidFieldRefs(rules, MAIN_FIELDS)).toEqual(['gone'])
  })

  it('条件右值引用了已删字段（valueType=FIELD）', () => {
    // 「结束日期 ≥ 开始日期」就是把另一个字段写在右值上
    const rules = [
      rule({
        when: {
          logic: 'AND',
          items: [{ field: 'amount', operator: 'GE', valueType: 'FIELD', value: 'gone' }]
        } as any
      })
    ]
    expect(findInvalidFieldRefs(rules, MAIN_FIELDS)).toEqual(['gone'])
  })

  it('右值是常量时不当作字段引用', () => {
    const rules = [
      rule({
        when: {
          logic: 'AND',
          items: [{ field: 'amount', operator: 'GE', valueType: 'CONST', value: 'gone' }]
        } as any
      })
    ]
    expect(findInvalidFieldRefs(rules, MAIN_FIELDS)).toEqual([])
  })

  it('动作目标引用了已删字段，then 与 otherwise 都查', () => {
    const rules = [
      rule({
        then: [{ type: 'SHOW', target: 'goneA' }],
        otherwise: [{ type: 'HIDE', target: 'goneB' }]
      })
    ]
    expect(findInvalidFieldRefs(rules, MAIN_FIELDS)).toEqual(['goneA', 'goneB'])
  })

  it('嵌套条件组也会下钻', () => {
    const rules = [
      rule({
        when: {
          logic: 'AND',
          items: [{ logic: 'OR', items: [{ field: 'gone', operator: 'NOT_EMPTY' }] }]
        } as any
      })
    ]
    expect(findInvalidFieldRefs(rules, MAIN_FIELDS)).toEqual(['gone'])
  })

  it('停用的规则不查，与后端一致', () => {
    const rules = [rule({ enabled: false, when: cond('gone') as any })]
    expect(findInvalidFieldRefs(rules, MAIN_FIELDS)).toEqual([])
  })

  it('结果去重', () => {
    const rules = [
      rule({ when: cond('gone') as any, then: [{ type: 'SHOW', target: 'gone' }] }),
      rule({ id: 'r2', when: cond('gone') as any })
    ]
    expect(findInvalidFieldRefs(rules, MAIN_FIELDS)).toEqual(['gone'])
  })

  it('空输入不报错', () => {
    expect(findInvalidFieldRefs(null, MAIN_FIELDS)).toEqual([])
    expect(findInvalidFieldRefs(undefined, MAIN_FIELDS)).toEqual([])
    expect(findInvalidFieldRefs([], MAIN_FIELDS)).toEqual([])
  })

  // ==================== rowScope：不能误报 ====================

  it('行作用域规则用明细列裸名时放行', () => {
    // 后端求值时拿 rowData 当上下文，字段名就是裸的明细列名
    const rules = [
      rule({
        rowScope: 'items',
        when: cond('price') as any,
        then: [{ type: 'SHOW', target: 'qty' }]
      })
    ]
    expect(findInvalidFieldRefs(rules, WITH_SUB)).toEqual([])
  })

  it('行作用域规则写层级 key 也放行（存量数据两种形态都有）', () => {
    const rules = [rule({ rowScope: 'items', when: cond('items.price') as any })]
    expect(findInvalidFieldRefs(rules, WITH_SUB)).toEqual([])
  })

  it('行作用域规则引用了该子表没有的明细列', () => {
    const rules = [rule({ rowScope: 'items', when: cond('gone') as any })]
    expect(findInvalidFieldRefs(rules, WITH_SUB)).toEqual(['gone'])
  })

  it('非行作用域规则不会把明细列裸名当成存在', () => {
    // price 只以 items.price 的形态存在，主表作用域下取不到
    const rules = [rule({ when: cond('price') as any })]
    expect(findInvalidFieldRefs(rules, WITH_SUB)).toEqual(['price'])
  })
})
