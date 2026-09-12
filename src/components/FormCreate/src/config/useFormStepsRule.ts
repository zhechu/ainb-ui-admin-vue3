import { generateUUID } from '@/utils'
import { localeProps } from '@/components/FormCreate/src/utils'
import { STEPS_WIDGET_TYPE, STEP_WIDGET_TYPE } from '@/components/FormWidgets/formSteps'

/**
 * 步骤条容器的设计器规则
 *
 * 设计方案 §5.8 的「布局容器，支持每步校验通过才能下一步」。
 *
 * ## 容器控件的两个关键写法
 *
 * 这套写法是从设计器 dist 里逆向出来的，交接文档第六节有记录：
 *
 * - 容器菜单项上的 `children: '<子节点 type>'` —— 声明它是容器、能装什么。
 *   少了这一行，拖进去的控件会掉到容器外面
 * - 子节点菜单项上的 `inside: true` —— 只能出现在容器内部，不进左侧面板。
 *   少了它，用户能把「步骤」单独拖到画布上，那是一个没有容器的孤儿节点
 *
 * ## 它与标签页上的「分步校验」并存
 *
 * 上一版把「每步校验通过才能下一步」挂在了标签页容器上（stepValidate.ts），
 * 因为那条校验才是分步真正稀缺的部分。现在容器做出来了，两者都保留：
 * 已有表单不用改，新表单要横条样式就用这个。两边的校验语义一致。
 */
export const useFormStepsRule = () => {
  const label = '步骤条'
  return {
    menu: 'layout',
    icon: 'icon-step-form',
    label,
    name: STEPS_WIDGET_TYPE,
    mask: false,
    // ⚠️ 这一行是容器的关键：声明子节点类型
    children: STEP_WIDGET_TYPE,
    rule() {
      return {
        type: STEPS_WIDGET_TYPE,
        // 布局容器也要有 field：设计器靠它做选中、复制与定位
        field: generateUUID(),
        style: { width: '100%' },
        props: { stepValidate: true },
        // 默认给两步。给一步的话用户看不出这是个「多步」容器，
        // 也不会想到还能再加
        children: [makeStep('第一步'), makeStep('第二步')]
      }
    },
    props(_, { t }) {
      return localeProps(t, STEPS_WIDGET_TYPE + '.props', [
        {
          type: 'switch',
          field: 'stepValidate',
          title: '分步校验',
          value: true,
          info: '当前步的字段校验不通过时，不允许走到后面的步；往回退不受限制'
        }
      ])
    }
  }
}

/** 造一个步骤节点 */
const makeStep = (title: string) => ({
  type: STEP_WIDGET_TYPE,
  field: generateUUID(),
  props: { title },
  children: []
})

/**
 * 步骤（容器的子节点）的设计器规则
 *
 * `inside: true` 让它只出现在容器内部。它不进左侧面板，所以
 * `useFormCreateDesigner` 里只 addComponent、不 appendMenuItem。
 */
export const useFormStepRule = () => {
  return {
    label: '步骤',
    name: STEP_WIDGET_TYPE,
    inside: true,
    drag: true,
    dragBtn: false,
    mask: false,
    rule() {
      return makeStep('步骤')
    },
    props(_, { t }) {
      return localeProps(t, STEP_WIDGET_TYPE + '.props', [
        { type: 'input', field: 'title', title: '步骤标题' }
      ])
    }
  }
}
