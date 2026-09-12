import { generateUUID } from '@/utils'
import { localeProps } from '@/components/FormCreate/src/utils'

/**
 * 计算公式控件的设计器规则
 *
 * 属性面板里的表达式编辑器（FormulaEditor）会把表达式解析成 AST 存进 props.ast，
 * 运行时前后端都只读这个 AST 求值，不再解析表达式。
 *
 * 公式字段是只读的：值由公式算出，用户不能直接编辑；提交时服务端还会用同一份 AST
 * 权威重算并覆盖。因此它没有「默认值」「是否必填」这类属性 —— 必填一个用户
 * 填不了的字段没有意义。
 */
export const useFormulaRule = () => {
  const label = '计算公式'
  const name = 'Formula'
  return {
    icon: 'icon-calculator',
    label,
    name,
    rule() {
      return {
        type: name,
        field: generateUUID(),
        title: label,
        info: '',
        // 公式字段不参与必填校验：值是算出来的，用户没有途径去"填"它
        $required: false,
        props: {
          expression: '',
          ast: null,
          precision: 2,
          rounding: 'HALF_UP',
          thousands: false,
          prefix: '',
          suffix: ''
        }
      }
    },
    props(_, { t }) {
      return localeProps(t, name + '.props', [
        {
          type: 'FormulaEditorField',
          field: '__formula__',
          title: '公式',
          // 这一项承载表达式、AST、精度、舍入、千分位五个属性，
          // 拆成五个独立表单项的话，用户改表达式时看不到精度设置，反过来也是
          props: {}
        },
        { type: 'input', field: 'prefix', title: '前缀', props: { placeholder: '如 ￥' } },
        { type: 'input', field: 'suffix', title: '后缀', props: { placeholder: '如 元' } }
      ])
    }
  }
}
