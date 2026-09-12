import request from '@/config/axios'

export interface DictTypeVO {
  id?: number
  parentId?: number
  nodeType?: number
  name: string
  type: string
  sort?: number
  treeEnable?: number
  cacheMode?: number
  status: number
  remark: string
  createTime?: Date
}

/** 分类节点类型 */
export enum DictTypeNodeEnum {
  GROUP = 1,
  DICT = 2
}

/** 缓存模式 */
export enum DictCacheModeEnum {
  FULL = 1,
  LAZY = 2
}

// 查询字典（精简)列表
export const getSimpleDictTypeList = (): Promise<DictTypeVO[]> => {
  return request.get({ url: '/system/dict-type/simple-list' })
}

// 查询字典分类列表（扁平，前端 handleTree 组装成树）
export const getDictTypeList = (keyword?: string): Promise<DictTypeVO[]> => {
  return request.get({ url: '/system/dict-type/list', params: { keyword } })
}

// 移动字典分类
export const moveDictType = (data: { id: number; parentId: number; sort: number }) => {
  return request.put({ url: '/system/dict-type/move', data })
}

// 查询字典列表
export const getDictTypePage = (params: PageParam) => {
  return request.get({ url: '/system/dict-type/page', params })
}

// 查询字典详情
export const getDictType = (id: number) => {
  return request.get({ url: '/system/dict-type/get?id=' + id })
}

// 新增字典
export const createDictType = (data: DictTypeVO) => {
  return request.post({ url: '/system/dict-type/create', data })
}

// 修改字典
export const updateDictType = (data: DictTypeVO) => {
  return request.put({ url: '/system/dict-type/update', data })
}

// 删除字典
export const deleteDictType = (id: number) => {
  return request.delete({ url: '/system/dict-type/delete?id=' + id })
}

// 批量删除字典类型
export const deleteDictTypeList = (ids: number[]) => {
  return request.delete({ url: '/system/dict-type/delete-list', params: { ids: ids.join(',') } })
}

// 导出字典
export const exportDictType = (params) => {
  return request.download({
    url: '/system/dict-type/export-excel',
    params
  })
}

/** 迁移包的冲突处理策略 */
export enum DictImportPolicyEnum {
  /** 已存在的分类与数据保持原样，只补新增 */
  SKIP = 1,
  /** 已存在的按包里的内容更新 */
  OVERWRITE = 2,
  /** 整棵子树新建一份，编码与名称自动加后缀 */
  RENAME = 3
}

/** 单个分类的导入结果 */
export interface DictImportTypeResultVO {
  type: string
  savedType?: string
  name: string
  action: 'created' | 'updated' | 'skipped' | 'renamed' | 'failed'
  reason?: string
  dataCreateCount: number
  dataUpdateCount: number
  dataSkipCount: number
  dataFailures: Record<string, string>
}

export interface DictImportRespVO {
  types: DictImportTypeResultVO[]
}

// 导出字典迁移包：该分类及其全部子分类，连同这些字典下的数据
export const exportDictTypeJson = (id: number) => {
  return request.download({ url: '/system/dict-type/export-json', params: { id } })
}

// 导入字典迁移包
export const importDictTypeJson = (
  file: File,
  policy: DictImportPolicyEnum,
  parentId?: number
): Promise<DictImportRespVO> => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('policy', String(policy))
  // 不传 parentId 时后端会挂到分类树的根，所以这里只在有值时才带上
  if (parentId) {
    formData.append('parentId', String(parentId))
  }
  return request.post({
    url: '/system/dict-type/import-json',
    data: formData,
    headersType: 'multipart/form-data'
  })
}
