import { describe, expect, it } from 'vitest'
import {
  applyStepsValidate,
  collectStepFields,
  STEPS_WIDGET_TYPE,
  STEP_WIDGET_TYPE
} from './formSteps'

/**
 * 步骤条容器的纯逻辑测试
 *
 * 组件那一半（头部、上一步/下一步、显隐）由 e2e 在真实浏览器里守 ——
 * 交接文档里记着一条教训：本模块的每个 UI 特性都是第 2 次以上迭代才验证通过的，
 * 单测全绿不等于功能生效。这里只测两件能纯函数化的事：
 * 「一步里有哪些字段」与「校验函数挂没挂上」。
 */
describe('步骤条容器', () => {
  const field = (name: string) => ({ type: 'input', field: name })

  describe('collectStepFields', () => {
    it('收集直接子级的字段', () => {
      const step = { type: STEP_WIDGET_TYPE, children: [field('a'), field('b')] }
      expect(collectStepFields(step)).toEqual(['a', 'b'])
    })

    it('收集嵌套在栅格、卡片里的字段', () => {
      const step = {
        type: STEP_WIDGET_TYPE,
        children: [
          { type: 'fcRow', children: [{ type: 'col', children: [field('a')] }] },
          { type: 'elCard', children: [field('b')] }
        ]
      }
      expect(collectStepFields(step)).toEqual(['a', 'b'])
    })

    it('⚠️ 遇到嵌套的步骤条就停：那是另一个容器的事', () => {
      // 把内层步骤条的字段算进来的话，外层的「这一步没填完」会把
      // 内层还没走到的步骤也一起要求填了
      const step = {
        type: STEP_WIDGET_TYPE,
        children: [
          field('a'),
          {
            type: STEPS_WIDGET_TYPE,
            children: [{ type: STEP_WIDGET_TYPE, children: [field('inner')] }]
          }
        ]
      }
      expect(collectStepFields(step)).toEqual(['a'])
    })

    it('步骤自己的 field 不算字段', () => {
      // 布局容器也有 field（设计器靠它做选中与复制），但它不参与表单值，
      // 混进去会让校验对着一个不存在的表单项报错
      const step = { type: STEP_WIDGET_TYPE, field: 'step_1', children: [field('a')] }
      expect(collectStepFields(step)).toEqual(['a'])
    })

    it('空节点与非对象一律返回空数组', () => {
      expect(collectStepFields(null)).toEqual([])
      expect(collectStepFields(undefined)).toEqual([])
      expect(collectStepFields({ type: STEP_WIDGET_TYPE })).toEqual([])
    })
  })

  describe('applyStepsValidate', () => {
    const validate = async () => true

    it('挂到步骤条容器上', () => {
      const rules: any[] = [{ type: STEPS_WIDGET_TYPE, props: { stepValidate: true } }]
      applyStepsValidate(rules, validate)
      expect(rules[0].props.validateStep).toBe(validate)
    })

    it('容器嵌在别的布局里也要挂上', () => {
      const rules: any[] = [
        { type: 'fcRow', children: [{ type: STEPS_WIDGET_TYPE, props: {} }] }
      ]
      applyStepsValidate(rules, validate)
      expect(rules[0].children[0].props.validateStep).toBe(validate)
    })

    it('没写 stepValidate 时视为开启', () => {
      // 属性面板的默认值是开。规则里没有这个键的情况来自手写 JSON 或旧数据，
      // 按开处理与界面上看到的一致
      const rules: any[] = [{ type: STEPS_WIDGET_TYPE }]
      applyStepsValidate(rules, validate)
      expect(rules[0].props.validateStep).toBe(validate)
    })

    it('⚠️ 显式关掉时不挂：容器取不到函数即视为不校验', () => {
      const rules: any[] = [{ type: STEPS_WIDGET_TYPE, props: { stepValidate: false } }]
      applyStepsValidate(rules, validate)
      expect(rules[0].props.validateStep).toBeUndefined()
    })

    it('不碰别的控件', () => {
      const rules: any[] = [{ type: 'elTabs', props: {} }, field('a')]
      applyStepsValidate(rules, validate)
      expect(rules[0].props.validateStep).toBeUndefined()
      expect((rules[1] as any).props?.validateStep).toBeUndefined()
    })
  })
})
