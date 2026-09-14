import request from '@/config/axios'

export interface UserVO {
  id: number
  username: string
  nickname: string
  deptId: number
  deptName?: string
  postIds: string[]
  email: string
  mobile: string
  sex: number
  avatar: string
  loginIp: string
  status: number
  remark: string
  loginDate: Date
  createTime: Date
}

// 获取用户精简信息列表
export const getSimpleUserList = (): Promise<UserVO[]> => {
  return request.get({ url: '/system/user/simple-list' })
}

// 按用户编号查询用户精简信息（点头像弹名片）
export const getSimpleUser = (id: number | string) => {
  return request.get<UserVO>({ url: '/system/user/get-simple', params: { id } })
}

// 按昵称模糊搜索用户（加好友）
export const getSimpleUserListByNickname = (nickname: string) => {
  return request.get<UserVO[]>({
    url: '/system/user/list-by-nickname',
    params: { nickname }
  })
}

// 查询用户管理列表
export const getUserPage = (params: PageParam) => {
  return request.get({ url: '/system/user/page', params })
}

// 查询用户管理列表
export const getUserList = (ids: number[]) => {
  return request.get({ url: '/system/user/list', params: { ids: ids.join(',') } })
}

// 查询用户详情
export const getUser = (id: number) => {
  return request.get({ url: '/system/user/get?id=' + id })
}

// 新增用户
export const createUser = (data: UserVO) => {
  return request.post({ url: '/system/user/create', data })
}

// 修改用户
export const updateUser = (data: UserVO) => {
  return request.put({ url: '/system/user/update', data })
}

// 删除用户
export const deleteUser = (id: number) => {
  return request.delete({ url: '/system/user/delete?id=' + id })
}

// 批量删除用户
export const deleteUserList = (ids: number[]) => {
  return request.delete({ url: '/system/user/delete-list', params: { ids: ids.join(',') } })
}

// 导出用户
/** 导出结果。带上「有没有被上限截断」—— 截断了不说的话用户以为导全了 */
export interface UserExportResultVO {
  blob: Blob
  truncated: boolean
  /** 服务端生效的上限。仅 truncated 时有值 */
  maxRows?: number
  /** 实际总条数。仅 truncated 时有值 */
  total?: number
}

/**
 * 导出用户
 *
 * ⚠️ 不用 `request.download`
 *
 * 那个封装最终只把 Blob 交出来（响应拦截器对 blob 直接 `return response.data`），
 * **响应头拿不到** —— 而「这次导出有没有被上限截断」正是走响应头传的。
 * 用它的话前端永远不知道文件是不是完整的，只能默默存下一个少了一半的表。
 *
 * 所以这里直接发 axios 拿完整响应。没有去改 `request.download` 的返回形态：
 * 那个函数被所有模块的导出在用，改它要一并回归全部导出路径，
 * 收益与风险不成比例。要推广时再抽一个公共的带元信息的下载函数。
 *
 * @param scope CURRENT_PAGE-当前页 / ALL-全部
 */
export const exportUser = async (
  params: any,
  scope: 'CURRENT_PAGE' | 'ALL' = 'ALL'
): Promise<UserExportResultVO> => {
  const { getAccessToken, getTenantId } = await import('@/utils/auth')
  const axios = (await import('axios')).default
  const baseUrl = import.meta.env.VITE_BASE_URL + import.meta.env.VITE_API_URL

  const res = await axios.get(`${baseUrl}/system/user/export-excel`, {
    params: { ...params, scope },
    responseType: 'blob',
    headers: {
      Authorization: 'Bearer ' + getAccessToken(),
      'tenant-id': getTenantId() || ''
    }
  })

  // 响应可能是一段错误 JSON 而不是 Excel。
  // ⚠️ 判据用头两个字节（xlsx 是 zip，必然以 PK 开头），不看 Content-Type ——
  // ExcelUtils.write 是先写流后设头的，成功的导出在浏览器这边根本没有 Content-Type
  const magic = new Uint8Array(await res.data.slice(0, 2).arrayBuffer())
  if (!(magic[0] === 0x50 && magic[1] === 0x4b)) {
    const text = await new Response(res.data).text()
    let msg = ''
    try {
      msg = JSON.parse(text)?.msg || ''
    } catch {
      msg = text.slice(0, 200)
    }
    throw new Error(msg || '导出失败')
  }

  return {
    blob: res.data,
    truncated: String(res.headers['x-export-truncated'] || '') === 'true',
    maxRows: Number(res.headers['x-export-max-rows']) || undefined,
    total: Number(res.headers['x-export-total']) || undefined
  }
}

// 下载用户导入模板
export const importUserTemplate = () => {
  return request.download({ url: '/system/user/get-import-template' })
}

// 用户密码重置
export const resetUserPassword = (id: number, password: string) => {
  const data = {
    id,
    password
  }
  return request.put({ url: '/system/user/update-password', data: data })
}

// 用户状态修改
export const updateUserStatus = (id: number, status: number) => {
  const data = {
    id,
    status
  }
  return request.put({ url: '/system/user/update-status', data: data })
}
