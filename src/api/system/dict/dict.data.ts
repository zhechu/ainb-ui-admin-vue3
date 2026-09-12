import request from '@/config/axios'

export interface DictDataVO {
  id?: number
  parentId?: number
  treeLevel?: number
  sort?: number
  label: string
  value: string
  dictType: string
  status: number
  colorType: string
  cssClass: string
  remark: string
  createTime?: Date
}

// 查询字典数据（精简)列表
export const getSimpleDictDataList = () => {
  return request.get({ url: '/system/dict-data/simple-list' })
}

export interface DictDataSyncVO {
  version: number
  list: DictDataVO[]
}

// 同步字典：版本号 + 全量数据一次返回，两者一定是自洽的一对
export const syncDictData = (): Promise<DictDataSyncVO> => {
  return request.get({ url: '/system/dict-data/sync' })
}

// 查询字典版本号，用于判断本地缓存是否还新鲜
export const getDictDataVersion = (): Promise<number> => {
  return request.get({ url: '/system/dict-data/version' })
}

// 查询字典数据列表
export const getDictDataPage = (params: PageParam) => {
  return request.get({ url: '/system/dict-data/page', params })
}

// 查询字典数据详情
export const getDictData = (id: number) => {
  return request.get({ url: '/system/dict-data/get?id=' + id })
}

// 根据字典类型查询字典数据
export const getDictDataByType = (dictType: string) => {
  return request.get({ url: '/system/dict-data/type?type=' + dictType })
}

// 新增字典数据
export const createDictData = (data: DictDataVO) => {
  return request.post({ url: '/system/dict-data/create', data })
}

// 修改字典数据
export const updateDictData = (data: DictDataVO) => {
  return request.put({ url: '/system/dict-data/update', data })
}

// 删除字典数据
export const deleteDictData = (id: number, cascade = false) => {
  return request.delete({ url: '/system/dict-data/delete', params: { id, cascade } })
}

// 查询某个字典的数据列表（扁平，前端 handleTree 组装成树）
export const getDictDataTreeList = (dictType: string, keyword?: string): Promise<DictDataVO[]> => {
  return request.get({ url: '/system/dict-data/tree-list', params: { dictType, keyword } })
}

// 查询某个节点的直接子级，供懒加载字典按需展开
export const getDictDataChildren = (dictType: string, parentId?: number): Promise<DictDataVO[]> => {
  return request.get({ url: '/system/dict-data/children', params: { dictType, parentId } })
}

// 移动字典数据节点
export const moveDictData = (data: { id: number; parentId: number; sort: number }) => {
  return request.put({ url: '/system/dict-data/move', data })
}

// 批量删除字典数据
export const deleteDictDataList = (ids: number[]) => {
  return request.delete({ url: '/system/dict-data/delete-list', params: { ids: ids.join(',') } })
}

// 导出字典数据。父子关系用「上级键值」表达，导出的文件可以改完直接导回来
export const exportDictData = (dictType: string) => {
  return request.download({ url: '/system/dict-data/export-excel', params: { dictType } })
}

// 下载导入模板
export const importDictDataTemplate = () => {
  return request.download({ url: '/system/dict-data/get-import-template' })
}

export interface DictDataImportRespVO {
  createValues: string[]
  updateValues: string[]
  failureValues: Record<string, string>
}

// 导入字典数据的接口地址，配合 el-upload 使用
export const getDictDataImportUrl = () =>
  import.meta.env.VITE_BASE_URL + import.meta.env.VITE_API_URL + '/system/dict-data/import-excel'
