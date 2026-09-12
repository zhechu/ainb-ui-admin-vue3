import request from '@/config/axios'
import type { DataModelColumnVO } from '@/api/infra/dataModel'

/** 查询条件 */
export type DataConditionVO = {
  columnName: string
  /** EQ / NE / LIKE / GT / GE / LT / LE / BETWEEN / IN / IS_NULL / IS_NOT_NULL */
  operator: string
  value?: any
}

/** 分页查询请求 */
export type DataPageReqVO = {
  modelId: number
  pageNo: number
  pageSize: number
  conditions?: DataConditionVO[]
  sortField?: string
  sortAsc?: boolean
}

/** 业务数据行。字段名由模型决定，因此是动态 key */
export type DataRowVO = Record<string, any>

/** 分页查询业务数据 */
export const getDataPage = (data: DataPageReqVO) => {
  return request.post({ url: '/infra/data-model-data/page', data })
}

/** 获得单条业务数据 */
export const getData = (modelId: number, id: string | number) => {
  return request.get({ url: '/infra/data-model-data/get', params: { modelId, id } })
}

/** 获得字段定义，供动态渲染列表与表单 */
export const getDataColumns = (modelId: number): Promise<DataModelColumnVO[]> => {
  return request.get({ url: '/infra/data-model-data/list-columns', params: { modelId } })
}

/** 创建业务数据 */
export const createData = (modelId: number, data: DataRowVO) => {
  return request.post({ url: '/infra/data-model-data/create', params: { modelId }, data })
}

/** 更新业务数据 */
export const updateData = (modelId: number, id: string | number, data: DataRowVO) => {
  return request.put({ url: '/infra/data-model-data/update', params: { modelId, id }, data })
}

/** 删除业务数据 */
export const deleteData = (modelId: number, id: string | number) => {
  return request.delete({ url: '/infra/data-model-data/delete', params: { modelId, id } })
}

/** 批量删除业务数据 */
export const deleteDataList = (modelId: number, ids: (string | number)[]) => {
  return request.delete({
    url: '/infra/data-model-data/delete-list',
    params: { modelId, ids: ids.join(',') }
  })
}
