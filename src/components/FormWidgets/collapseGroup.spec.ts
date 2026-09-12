/**
 * 分组标题折叠的单元测试
 *
 * 两条最要紧的：分组范围是「到下一个标题为止」，以及折叠时标题自己要留下 ——
 * 标题被一起摘掉的话，折起来就再也点不开了。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collapseStorageKey,
  collectCollapseGroups,
  filterRulesByCollapse,
  readCollapsed,
  writeCollapsed
} from './collapseGroup'

const title = (field: string, extra: Record<string, any> = {}) => ({
  type: 'fcTitle',
  field,
  props: { title: field, collapsible: true, ...extra }
})

const input = (field: string) => ({ type: 'input', field })

describe('收集可折叠分组', () => {
  it('⚠️ 分组范围是「本标题之后、下一个标题之前」', () => {
    const groups = collectCollapseGroups([
      title('t1'),
      input('a'),
      input('b'),
      title('t2'),
      input('c')
    ])
    expect(groups.map((g) => g.key)).toEqual(['t1', 't2'])
    expect(groups[0].members).toEqual(['a', 'b'])
    expect(groups[1].members).toEqual(['c'])
  })

  it('⚠️ 不可折叠的标题同样是一条分割线 —— 它后面的控件不该算进上一个分组', () => {
    const groups = collectCollapseGroups([
      title('t1'),
      input('a'),
      title('plain', { collapsible: false }),
      input('b')
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].members).toEqual(['a'])
  })

  it('标题之前的控件不属于任何分组', () => {
    const groups = collectCollapseGroups([input('before'), title('t1'), input('a')])
    expect(groups[0].members).toEqual(['a'])
  })

  it('默认折叠取自属性', () => {
    const groups = collectCollapseGroups([title('t1', { defaultCollapsed: true })])
    expect(groups[0].defaultCollapsed).toBe(true)
  })

  it('布局容器里可以有自己的分组', () => {
    const groups = collectCollapseGroups([
      { type: 'col', children: [title('inner'), input('x')] }
    ])
    expect(groups.map((g) => g.key)).toEqual(['inner'])
    expect(groups[0].members).toEqual(['x'])
  })

  it('没有可折叠标题时返回空数组', () => {
    expect(collectCollapseGroups([input('a')])).toEqual([])
    expect(collectCollapseGroups(null)).toEqual([])
  })
})

describe('按折叠状态过滤', () => {
  const tree = () => [title('t1'), input('a'), input('b'), title('t2'), input('c')]

  const fieldsOf = (rules: any[]): string[] => rules.map((r) => r.field)

  it('⚠️ 折叠时标题自己必须留下 —— 摘掉的话就再也点不开了', () => {
    const filtered = filterRulesByCollapse(tree(), new Set(['t1']))
    expect(fieldsOf(filtered)).toEqual(['t1', 't2', 'c'])
  })

  it('只影响被折叠的那个分组', () => {
    const filtered = filterRulesByCollapse(tree(), new Set(['t2']))
    expect(fieldsOf(filtered)).toEqual(['t1', 'a', 'b', 't2'])
  })

  it('没有折叠时原样返回同一个数组 —— 白重建一棵树会让表单无谓重渲染', () => {
    const original = tree()
    expect(filterRulesByCollapse(original, new Set())).toBe(original)
  })

  it('⚠️ 不污染原树', () => {
    const original = tree()
    filterRulesByCollapse(original, new Set(['t1']))
    expect(fieldsOf(original)).toEqual(['t1', 'a', 'b', 't2', 'c'])
  })

  it('布局容器内部的折叠只影响容器内部', () => {
    const rules = [
      { type: 'col', children: [title('inner'), input('x')] },
      input('outside')
    ]
    const filtered = filterRulesByCollapse(rules, new Set(['inner']))
    expect(filtered[0].children.map((r: any) => r.field)).toEqual(['inner'])
    expect(filtered[1].field).toBe('outside')
  })

  it('⚠️ 文本子节点要原样留下 —— 丢了它，按钮和标签就成了空壳', () => {
    // 与 renderScene 是同一类：按钮/标签/文字/自定义 HTML 的文案是 children 里的
    // 字符串而不是规则对象，按「不是对象就跳过」处理会把文案吃掉
    const rules = [
      title('t1'),
      { type: 'elButton', field: 'btn', children: ['按钮文字'] },
      { type: 'col', children: ['容器里的说明'] }
    ]
    const filtered = filterRulesByCollapse(rules, new Set(['other']))
    expect(filtered[1].children).toEqual(['按钮文字'])
    expect(filtered[2].children).toEqual(['容器里的说明'])
  })

  it('分组折起来时，它名下的文本子节点也跟着收起来', () => {
    const rules = [title('t1'), '跟在标题后面的一段文字', input('a')]
    expect(filterRulesByCollapse(rules, new Set(['t1']))).toEqual([title('t1')])
    // 没折时它还在原处
    expect(filterRulesByCollapse(rules, new Set(['other'])).length).toBe(3)
  })
})

describe('折叠状态的记忆', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k)
    })
  })

  it('记住之后按记住的来，没记过则用默认值', () => {
    const group = { key: 't1', title: '', members: [], defaultCollapsed: true }
    expect(readCollapsed('demo', group), '没记过时用默认值').toBe(true)

    writeCollapsed('demo', 't1', false)
    expect(readCollapsed('demo', group), '记过之后以用户的选择为准').toBe(false)
  })

  it('按表单 + 标题分别记', () => {
    expect(collapseStorageKey('a', 't')).not.toBe(collapseStorageKey('b', 't'))
    expect(collapseStorageKey('a', 't1')).not.toBe(collapseStorageKey('a', 't2'))
  })

  it('⚠️ localStorage 不可用时不报错 —— 隐私模式下它会抛异常', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      }
    })
    const group = { key: 't1', title: '', members: [], defaultCollapsed: true }
    expect(() => writeCollapsed('demo', 't1', true)).not.toThrow()
    expect(readCollapsed('demo', group), '读不到时回落到默认值').toBe(true)
  })
})
