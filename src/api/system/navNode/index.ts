import request from '@/config/axios'

// 分端导航节点 VO（对应后端 NavNodeRespVO / NavNodeSaveVO）
export interface NavNodeVO {
  id: number
  terminal: string // 端标识，参见 NavTerminalEnum；当前仅 app
  parentId: number // 父节点编号，0 表示根
  nodeType: number // 节点类型：1=分组 2=子分组 3=导航项
  name: string // 展示名称
  route?: string // 叶子节点页面路径（须命中移动端 pages.json）
  permissions?: string // 权限串列表，逗号分隔，任一命中即可见；空表示不设权限门槛
  menuRefId?: number // 可选：指回 system_menu.id
  icon?: string // 图标（wot-ui 图标名或图片路径）
  iconColor?: string // 图标颜色
  isTabbar?: boolean // 是否 tabbar 页
  onlyPc?: boolean // 是否仅 PC（移动端点击跳提示页）
  query?: string // 页面参数（如在线表单 code=xxx）
  sort: number // 同级排序
  visible?: boolean // 该端是否显示
  status: number // 状态，参见 CommonStatusEnum
  createTime?: Date
}

// 批量排序 VO（拖拽排序用，同一事务落库）
export interface NavNodeSortVO {
  id: number
  parentId: number
  sort: number
}

// 查询导航节点列表（编辑器用，未做授权过滤，返回全部节点）
export const getNavNodeList = (params?: any) => {
  return request.get({ url: '/system/nav-node/list', params })
}

// 查询导航节点详情
export const getNavNode = (id: number) => {
  return request.get({ url: '/system/nav-node/get?id=' + id })
}

// 新增导航节点
export const createNavNode = (data: NavNodeVO) => {
  return request.post({ url: '/system/nav-node/create', data })
}

// 修改导航节点
export const updateNavNode = (data: NavNodeVO) => {
  return request.put({ url: '/system/nav-node/update', data })
}

// 批量修改导航节点排序 / 父节点
export const updateNavNodeSort = (data: NavNodeSortVO[]) => {
  return request.put({ url: '/system/nav-node/update-sort', data })
}

// 删除导航节点
export const deleteNavNode = (id: number) => {
  return request.delete({ url: '/system/nav-node/delete?id=' + id })
}

// 批量删除导航节点
// 🔴 ids 走逗号串而非数组：axios 默认把数组序列化成 ids[]=1&ids[]=2，后端 @RequestParam List<Long> 收不到
export const deleteNavNodeList = (ids: number[]) => {
  return request.delete({ url: '/system/nav-node/delete-list', params: { ids: ids.join(',') } })
}
