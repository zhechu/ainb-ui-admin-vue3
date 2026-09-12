import { generateUUID } from '@/utils'
import { localeProps } from '@/components/FormCreate/src/utils'

/**
 * 条码 / 二维码控件的设计器规则
 *
 * 纯展示控件，不落库、不参与校验。
 *
 * 值支持 `{字段}` 插值。这里用的是简单插值而不是公式引擎 ——
 * 条码的值几乎总是「某个单号」或「固定前缀 + 单号」，用公式 AST 表达
 * 要先把值转成字符串再拼接，而公式引擎是算数值的，这条路绕得太远。
 */
export const useCodeImageRule = () => {
  const label = '条码/二维码'
  const name = 'CodeImage'
  return {
    icon: 'icon-qrcode',
    label,
    name,
    rule() {
      return {
        type: name,
        // 展示类控件也要有 field：设计器靠它做选中与复制
        field: generateUUID(),
        title: label,
        info: '',
        $required: false,
        props: {
          codeType: 'qrcode',
          value: '',
          size: 120,
          format: 'CODE128',
          displayValue: true
        }
      }
    },
    props(_, { t }) {
      return localeProps(t, name + '.props', [
        {
          type: 'radio',
          field: 'codeType',
          title: '类型',
          options: [
            { label: '二维码', value: 'qrcode' },
            { label: '条形码', value: 'barcode' }
          ]
        },
        {
          type: 'input',
          field: 'value',
          title: '内容',
          info: '支持 {字段} 插值，如 {order_no}',
          props: { placeholder: '{order_no}' }
        },
        {
          type: 'inputNumber',
          field: 'size',
          title: '尺寸',
          info: '二维码是边长，条形码是高度，单位像素',
          props: { min: 40, max: 400 }
        },
        {
          type: 'select',
          field: 'format',
          title: '条形码格式',
          info: '仅条形码用。CODE128 只认 ASCII，EAN13 必须是 13 位数字',
          options: [
            { label: 'CODE128', value: 'CODE128' },
            { label: 'CODE39', value: 'CODE39' },
            { label: 'EAN13', value: 'EAN13' },
            { label: 'ITF14', value: 'ITF14' }
          ]
        },
        { type: 'switch', field: 'displayValue', title: '条形码下方显示文字' }
      ])
    }
  }
}
