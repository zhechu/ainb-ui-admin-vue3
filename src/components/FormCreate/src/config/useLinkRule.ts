import { generateUUID } from '@/utils'
import { localeProps } from '@/components/FormCreate/src/utils'

/**
 * 超链接控件的设计器规则
 *
 * 纯展示控件，不落库、不参与校验，所以没有「字段 ID 映射」「是否必填」这些属性。
 *
 * 地址支持 `{字段}` 插值。不做成「选一个字段」的下拉，是因为真实用法里
 * 地址往往由固定前缀 + 一到多个字段拼成
 * （`https://crm.example.com/customer/{customer_id}?from={source}`），
 * 下拉表达不了。
 */
export const useLinkRule = () => {
  const label = '超链接'
  const name = 'Link'
  return {
    icon: 'icon-link',
    label,
    name,
    rule() {
      return {
        type: name,
        // 展示类控件也要有 field：设计器靠它做选中与复制，缺了会出现两个控件
        // 共用一份属性的怪现象
        field: generateUUID(),
        title: label,
        info: '',
        $required: false,
        props: {
          url: '',
          text: '',
          target: '_blank',
          type: 'primary',
          underline: false
        }
      }
    },
    props(_, { t }) {
      return localeProps(t, name + '.props', [
        {
          type: 'input',
          field: 'url',
          title: '地址',
          info: '支持 {字段} 插值，如 https://example.com/order/{order_no}。只允许 http/https/mailto/tel',
          props: { placeholder: 'https://example.com/{field}' }
        },
        {
          type: 'input',
          field: 'text',
          title: '链接文字',
          info: '留空时显示地址本身'
        },
        {
          type: 'select',
          field: 'target',
          title: '打开方式',
          options: [
            { label: '新窗口', value: '_blank' },
            { label: '当前窗口', value: '_self' }
          ]
        },
        {
          type: 'select',
          field: 'type',
          title: '颜色',
          options: [
            { label: '主色', value: 'primary' },
            { label: '默认', value: 'default' },
            { label: '成功', value: 'success' },
            { label: '警告', value: 'warning' },
            { label: '危险', value: 'danger' },
            { label: '信息', value: 'info' }
          ]
        },
        { type: 'switch', field: 'underline', title: '显示下划线' }
      ])
    }
  }
}
