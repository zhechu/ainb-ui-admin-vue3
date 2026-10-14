import request from '@/config/axios'

export interface DeptVO {
  id: number
  name: string
  /**
   * 组织编码，同租户内唯一。
   *
   * 刻意是可选的：本 VO 同时被 /simple-list 复用，而精简接口不返回 code，
   * 写成必填等于在类型上撒谎（消费方拿到的是 undefined 却被告知一定有值）。
   * 走 /create、/update 时后端是必填的，由 DeptForm 的表单规则兜住
   */
  code?: string
  parentId: number
  status: number
  sort: number
  leaderUserId: number
  phone: string
  email: string
  createTime: Date
  children?: DeptVO[]
}

// 查询组织（精简)列表
export const getSimpleDeptList = (): Promise<DeptVO[]> => {
  return request.get({ url: '/system/dept/simple-list' })
}

// 查询组织列表
export const getDeptList = (params: any) => {
  return request.get({ url: '/system/dept/list', params })
}

// 查询组织分页
export const getDeptPage = async (params: PageParam) => {
  return await request.get({ url: '/system/dept/list', params })
}

// 查询组织详情
export const getDept = (id: number) => {
  return request.get({ url: '/system/dept/get?id=' + id })
}

// 新增组织
export const createDept = (data: DeptVO) => {
  return request.post({ url: '/system/dept/create', data })
}

// 修改组织
export const updateDept = (data: DeptVO) => {
  return request.put({ url: '/system/dept/update', data })
}

/**
 * 只改状态。
 *
 * 不复用 updateDept：组织编码在后端是必填的，而存量组织行的 code 是 NULL（不回填），
 * 整行提交会被 Bean Validation 拦成 400 —— 列表页的状态开关会直接坏掉，
 * 且必须逐个补录编码才能恢复。专用接口只提交 id + status，结构性地绕开这个冲突
 */
export const updateDeptStatus = (id: number, status: number) => {
  return request.put({ url: '/system/dept/update-status', data: { id, status } })
}

// 删除组织
export const deleteDept = async (id: number) => {
  return await request.delete({ url: '/system/dept/delete?id=' + id })
}

// 批量删除组织
export const deleteDeptList = async (ids: number[]) => {
  return await request.delete({ url: '/system/dept/delete-list', params: { ids: ids.join(',') } })
}
