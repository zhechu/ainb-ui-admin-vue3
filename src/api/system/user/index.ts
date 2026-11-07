import request from '@/config/axios'
import { exportExcelWithMeta } from '@/utils/exportExcel'

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
/**
 * 导出用户
 *
 * 返回类型是 `@/utils/exportExcel` 里的 `ExportResult`：带上「有没有被上限截断」，
 * 截断了不说的话用户以为导全了。
 *
 * 🔴 真正的下载逻辑（为什么不用 `request.download`、为什么看头两个字节而不是
 * Content-Type）写在 `exportExcelWithMeta` 上，那里是**全仓唯一一份**。
 * 这里原先自己抄了一份，抽出去是因为 qlzg 的四个台账导出也要同一套 ——
 * 两份魔数判定的下场是下一份修好、另一份还漏着。
 *
 * @param scope CURRENT_PAGE-当前页 / ALL-全部
 */
export const exportUser = (params: any, scope: 'CURRENT_PAGE' | 'ALL' = 'ALL') => {
  return exportExcelWithMeta('/system/user/export-excel', { ...params, scope })
}

// 下载用户导入模板
export const importUserTemplate = () => {
  return request.download({ url: '/system/user/get-import-template' })
}

// ==================== 导入导出的限制 ====================

export interface UserImportExportConfigVO {
  /** 一次最多导出多少条 */
  maxExportRows: number
  /** 一次最多导入多少行 */
  maxImportRows: number
  /** 导入文件的大小上限（MB） */
  maxImportFileSizeMb: number
}

/**
 * 获得导入导出的限制
 *
 * 导出弹窗要在用户点「导出」**之前**就把上限说清楚，而上限是服务端常量。
 * 前端写死一个 2 万的话，后端哪天调了之后界面上那个数就成了假的 ——
 * 而用户会照着它规划自己的分批，比根本不提示更糟。
 */
export const getImportExportConfig = () => {
  return request.get<UserImportExportConfigVO>({ url: '/system/user/import-export-config' })
}

// ==================== 导入：预检 + 执行 ====================

export interface UserImportProblemVO {
  rowNo?: number
  columnLetter?: string
  field?: string
  fieldLabel?: string
  message: string
  rawValue?: string
  level?: string
}

export interface UserImportColumnMappingVO {
  columnLetter: string
  header: string
  field: string
  fieldLabel: string
  required?: boolean
  dict?: boolean
}

export interface UserImportUnmatchedColumnVO {
  columnLetter: string
  header: string
  reason: string
  firstColumnLetter?: string
}

export interface UserImportPreviewRowVO {
  rowNo: number
  /** NEW / EXISTS / DUPLICATE_IN_FILE / INVALID */
  status: string
  statusText: string
  data?: Record<string, any>
  errors?: UserImportProblemVO[]
  warnings?: UserImportProblemVO[]
}

export interface UserImportSummaryVO {
  totalRows: number
  newCount: number
  existsCount: number
  duplicateCount: number
  invalidCount: number
  previewRowCount: number
  /** 文件是不是被行数上限截断了 */
  truncated: boolean
  maxRows?: number
}

export interface UserImportPreviewVO {
  /** 执行时必须原样带回，且只能用一次 */
  importToken: string
  mappings: UserImportColumnMappingVO[]
  unmatchedColumns: UserImportUnmatchedColumnVO[]
  duplicateColumns: UserImportUnmatchedColumnVO[]
  missingRequiredFields: string[]
  rows: UserImportPreviewRowVO[]
  summary: UserImportSummaryVO
  tableErrors: UserImportProblemVO[]
  updateKeyFields: string[]
}

export interface UserImportFailureVO {
  rowNo?: number
  username?: string
  fieldLabel?: string
  message: string
  rawValue?: string
}

export interface UserImportResultVO {
  createCount: number
  updateCount: number
  skipCount: number
  failCount: number
  failures: UserImportFailureVO[]
  tableErrors: UserImportProblemVO[]
}

/**
 * 上传 Excel 做预检
 *
 * ⚠️ 必须用 `request.upload`，不能用 `request.post`
 *
 * `post` 会把 Content-Type 设成 application/json，后端的 `@RequestParam("file")`
 * 拿不到文件，表现是「点了下一步、接口返回 200，但弹窗停在第一步」，极难归因。
 * `upload` 把头设成 multipart/form-data，axios 见到 FormData 会把这个头删掉
 * 交给浏览器补 boundary，链路才是通的。
 *
 * ⚠️ `upload` 返回的是整个响应体 `{code,msg,data}`，不像 `post` 那样已经剥过一层。
 */
export const importPreview = async (file: File): Promise<UserImportPreviewVO> => {
  const formData = new FormData()
  formData.append('file', file)
  const res = await request.upload({
    url: '/system/user/import-preview',
    data: formData,
    timeout: 120_000
  })
  return (res as any)?.data as UserImportPreviewVO
}

/** 执行导入。importToken 只能用一次 */
export const importExecute = (data: {
  importToken: string
  /** 用户在预检表里剔掉的行号 */
  removedRows?: number[]
  /** SKIP-跳过并列出 / UPDATE-按登录名覆盖更新 */
  duplicateStrategy?: string
  allOrNothing?: boolean
}): Promise<UserImportResultVO> => {
  return request.post({ url: '/system/user/import-execute', data, timeout: 120_000 })
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
