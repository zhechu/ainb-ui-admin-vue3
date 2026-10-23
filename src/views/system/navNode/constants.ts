// 「移动端导航」编辑器共用常量

/** 端标识：当前后端 NavTerminalEnum 仅支持 app */
export const NAV_TERMINAL = 'app'

/** 节点类型：与后端 NavNodeTypeEnum 保持一致 */
export const NAV_NODE_TYPE = {
  GROUP: 1,
  SUB_GROUP: 2,
  ITEM: 3
} as const

/** el-tag 配色取值 */
export type NavTagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'

export interface NavNodeTypeOption {
  value: number
  label: string
  tagType: NavTagType
}

/** 节点类型下拉 / 标签选项 */
export const NAV_NODE_TYPE_OPTIONS: NavNodeTypeOption[] = [
  { value: NAV_NODE_TYPE.GROUP, label: '分组', tagType: 'warning' },
  { value: NAV_NODE_TYPE.SUB_GROUP, label: '子分组', tagType: 'primary' },
  { value: NAV_NODE_TYPE.ITEM, label: '导航项', tagType: 'success' }
]

/** 节点类型 → 文案 */
export const navNodeTypeLabel = (type?: number): string =>
  NAV_NODE_TYPE_OPTIONS.find((opt) => opt.value === type)?.label ?? '未知'

/** 节点类型 → 标签配色 */
export const navNodeTypeTag = (type?: number): NavTagType =>
  NAV_NODE_TYPE_OPTIONS.find((opt) => opt.value === type)?.tagType ?? 'info'
