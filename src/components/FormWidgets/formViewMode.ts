/**
 * 表单的呈现方式
 *
 * 运行时点「新增 / 编辑 / 详情」时，表单装在哪里由这个配置决定。
 *
 * 原先固定是居中弹窗。字段一多，弹窗里那点高度就得一路滚，而滚动条一出现，
 * 底部的「确定」又被压到视口外面 —— 用户得先滚到最底才能提交。
 * 字段越多这件事越难受，偏偏字段多正是低代码表单的常态。
 *
 * 三种模式都只影响「装在哪」，表单本身、校验、提交流程完全一致，
 * 因此存在 listConf 里（纯前端配置），后端不参与。
 */
export type FormViewMode = 'DIALOG' | 'DRAWER' | 'INLINE'

export const FORM_VIEW_MODES: Array<{ value: FormViewMode; label: string; desc: string }> = [
  {
    value: 'DIALOG',
    label: '居中弹窗',
    desc: '不离开列表，字段少时最省事'
  },
  {
    value: 'DRAWER',
    label: '右侧抽屉',
    desc: '比弹窗高，适合字段多但每个都窄的表单'
  },
  {
    value: 'INLINE',
    label: '页内显示',
    desc: '整页给表单，按钮固定在底部；字段很多、需要长时间录入时用这个'
  }
]

const VALID_MODES = new Set<string>(FORM_VIEW_MODES.map((item) => item.value))

/**
 * 归一化配置里的值
 *
 * 存量表单的 listConf 里没有这个键，认不出的值也一律回落到居中弹窗 ——
 * 那是改造前的行为，回落到它不会让任何一张已发布的表单看起来变了样。
 */
export const parseFormViewMode = (raw: unknown): FormViewMode =>
  typeof raw === 'string' && VALID_MODES.has(raw) ? (raw as FormViewMode) : 'DIALOG'
