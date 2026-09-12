import { generateUUID } from '@/utils'
import { localeProps, makeRequiredRule } from '@/components/FormCreate/src/utils'

/**
 * 手写签名控件的设计器规则
 *
 * 替代内核内置的 signaturePad。两者的差别只有一处，但那一处是整批 B8 的起因：
 * 内核那个把 canvas 直出的 base64 当值（单张 20–100KB，映射到 varchar 写不进去、
 * 映射到 TEXT 则拖慢列表查询与导出），本控件先上传文件服务、只把 URL 当值。
 *
 * 内核的 signaturePad 已在契约里标为 supported=false + deprecated=true，
 * 设计器菜单按契约自动隐藏（createDesignerConfig 的 hiddenItem），
 * 发布校验也会拒绝 —— 历史表单里若还留着，报错会提示改用本控件。
 *
 * ## 属性面板里刻意没有的两项
 *
 * - **签署方式（手写 / 电子签章）**：按本次决策不做电子签章，留一个只有一个选项的
 *   下拉只会让人以为另一种能用
 * - **签署人 / 签署时间字段**：签署人与时间的权威来源是记录自己的 creator /
 *   create_time（由自动填充列承载）。再让用户挑两个字段去存前端提交的那一份，
 *   等于把一个可伪造的值摆在权威值旁边。需要在图片上看到是谁签的，用「签署水印」
 */
export const useSignatureRule = () => {
  const label = '手写签名'
  const name = 'Signature'
  return {
    icon: 'icon-sign',
    label,
    name,
    rule() {
      return {
        type: name,
        field: generateUUID(),
        title: label,
        info: '',
        $required: false,
        props: {
          width: 400,
          height: 160,
          penWidth: 2,
          penColor: '#000000',
          bgColor: '#ffffff',
          watermark: false,
          allowRewrite: true
        }
      }
    },
    props(_, { t }) {
      return localeProps(t, name + '.props', [
        makeRequiredRule(),
        {
          type: 'inputNumber',
          field: 'width',
          title: '画布宽度(px)',
          props: { min: 120, max: 1000 }
        },
        {
          type: 'inputNumber',
          field: 'height',
          title: '画布高度(px)',
          props: { min: 60, max: 600 }
        },
        {
          type: 'inputNumber',
          field: 'penWidth',
          title: '画笔粗细(px)',
          props: { min: 1, max: 12 }
        },
        { type: 'colorPicker', field: 'penColor', title: '画笔颜色' },
        {
          type: 'colorPicker',
          field: 'bgColor',
          title: '画布背景色',
          info: '默认白色。留空会导出透明背景的 PNG，贴到深色底或某些打印驱动下会变成一团黑'
        },
        {
          type: 'switch',
          field: 'watermark',
          title: '签署水印',
          info: '把签署人与当前时间烧进图片，便于打印后自解释。它由前端绘制，不能当凭据用 —— 权威的签署人与时间是记录的创建人与创建时间'
        },
        {
          type: 'switch',
          field: 'allowRewrite',
          title: '允许重签',
          info: '关掉后，已签名的记录在编辑时不能再改签名'
        },
        { type: 'switch', field: 'disabled', title: '是否禁用' }
      ])
    }
  }
}
