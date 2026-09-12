/**
 * 渲染场景开关的单元测试
 *
 * 两条最要紧的：
 * - 缺省是「全都出现」——存量表单没有这个属性，反过来会让已发布的表单变空白
 * - 过滤是「删掉」而不是「隐藏」——留在树里的话，联动的 SHOW 能把它重新显示出来
 */

import { describe, expect, it } from 'vitest'
import {
  collectSceneConfig,
  filterRulesByScene,
  isVisibleInScene,
  RENDER_SCENE_OPTIONS
} from './renderScene'

describe('单个字段的场景判定', () => {
  it('⚠️ 没配过 scenes 的字段在所有场景都出现', () => {
    expect(isVisibleInScene({ field: 'a' }, 'form')).toBe(true)
    expect(isVisibleInScene({ field: 'a', props: {} }, 'detail')).toBe(true)
    // 空数组同样视为没配 —— 用户清空了勾选，意图更可能是「不限制」
    expect(isVisibleInScene({ field: 'a', props: { scenes: [] } }, 'form')).toBe(true)
  })

  it('配了就按配的来', () => {
    const rule = { field: 'a', props: { scenes: ['form'] } }
    expect(isVisibleInScene(rule, 'form')).toBe(true)
    expect(isVisibleInScene(rule, 'detail')).toBe(false)
  })
})

describe('按场景过滤规则树', () => {
  const tree = () => [
    { type: 'input', field: 'always' },
    { type: 'input', field: 'onlyForm', props: { scenes: ['form'] } },
    { type: 'input', field: 'onlyDetail', props: { scenes: ['detail'] } },
    {
      type: 'col',
      children: [{ type: 'input', field: 'nested', props: { scenes: ['detail'] } }]
    },
    {
      type: 'group',
      field: 'items',
      props: {
        rule: [
          { type: 'input', field: 'col1' },
          { type: 'input', field: 'col2', props: { scenes: ['form'] } }
        ]
      }
    }
  ]

  const fieldsOf = (rules: any[]): string[] => {
    const out: string[] = []
    const walk = (list: any[]) => {
      for (const r of list) {
        if (r.field) out.push(r.field)
        if (Array.isArray(r.children)) walk(r.children)
        if (Array.isArray(r.props?.rule)) walk(r.props.rule)
      }
    }
    walk(rules)
    return out
  }

  it('表单场景：只留下 form 场景的字段', () => {
    const fields = fieldsOf(filterRulesByScene(tree(), 'form'))
    expect(fields).toContain('always')
    expect(fields).toContain('onlyForm')
    expect(fields).not.toContain('onlyDetail')
    expect(fields).not.toContain('nested')
    // 子表明细列也要按场景过滤
    expect(fields).toContain('col2')
  })

  it('详情场景：只留下 detail 场景的字段', () => {
    const fields = fieldsOf(filterRulesByScene(tree(), 'detail'))
    expect(fields).toContain('always')
    expect(fields).not.toContain('onlyForm')
    expect(fields).toContain('onlyDetail')
    expect(fields).toContain('nested')
    expect(fields).not.toContain('col2')
  })

  it('⚠️ 过滤是删掉而不是标 hidden —— 留在树里的话联动的 SHOW 能把它重新显示出来', () => {
    const filtered = filterRulesByScene(tree(), 'detail')
    const found = filtered.find((r: any) => r.field === 'onlyForm')
    expect(found).toBeUndefined()
  })

  it('⚠️ 不污染原树 —— 完整树还要给另一个场景用', () => {
    const original = tree()
    filterRulesByScene(original, 'form')
    expect(fieldsOf(original)).toContain('onlyDetail')
    expect((original[4] as any).props?.rule).toHaveLength(2)
  })

  it('容器配了场景时，连同里面的字段一起消失', () => {
    const rules = [
      {
        type: 'card',
        props: { scenes: ['detail'] },
        children: [{ type: 'input', field: 'inside' }]
      }
    ]
    expect(fieldsOf(filterRulesByScene(rules, 'form'))).toEqual([])
    expect(fieldsOf(filterRulesByScene(rules, 'detail'))).toEqual(['inside'])
  })

  it('空树与非法入参不报错', () => {
    expect(filterRulesByScene([], 'form')).toEqual([])
    expect(filterRulesByScene(null, 'form')).toEqual([])
    expect(filterRulesByScene(undefined, 'detail')).toEqual([])
  })

  it('⚠️ 文本子节点要原样留下 —— 丢了它，按钮和标签就成了空壳', () => {
    // 按钮、标签、文字、自定义 HTML 的文案在 form-create 里是 children 里的
    // 字符串，不是规则对象。过滤时按「不是对象就跳过」处理会把它们吃掉，
    // 表现是控件渲染出来了、里面一个字都没有 —— 界面上看不出是过滤干的
    const rules = [
      { type: 'elButton', field: 'btn', children: ['这是一个按钮'] },
      { type: 'elTag', field: 'tag', children: ['标签文字'] },
      { type: 'col', children: ['卡片里的一段说明'] }
    ]
    const result = filterRulesByScene(rules, 'form')
    expect(result[0].children).toEqual(['这是一个按钮'])
    expect(result[1].children).toEqual(['标签文字'])
    expect(result[2].children).toEqual(['卡片里的一段说明'])
  })

  it('文本子节点与规则对象混排时，顺序不变', () => {
    const rules = [
      {
        type: 'col',
        children: ['前缀', { field: 'a' }, '中间', { field: 'b', props: { scenes: ['detail'] } }, '后缀']
      }
    ]
    // 只有配了 detail 的那个字段被滤掉，文本一个不少
    expect(filterRulesByScene(rules, 'form')[0].children).toEqual([
      '前缀',
      { field: 'a' },
      '中间',
      '后缀'
    ])
  })
})

describe('场景配置的收集', () => {
  it('只收集真的配过的字段', () => {
    const config = collectSceneConfig([
      { field: 'a' },
      { field: 'b', props: { scenes: ['form'] } },
      { type: 'col', children: [{ field: 'c', props: { scenes: ['detail'] } }] }
    ])
    expect(config).toEqual({ b: ['form'], c: ['detail'] })
  })
})

describe('场景清单', () => {
  it('⚠️ 只列真的会生效的场景 —— 勾了不生效的复选框比没有这个功能更糟', () => {
    expect(RENDER_SCENE_OPTIONS.map((o) => o.value)).toEqual(['form', 'detail'])
  })
})
