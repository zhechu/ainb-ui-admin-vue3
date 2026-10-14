import request from '@/config/axios'

/** 入参定义 */
export type ParamDefinitionVO = {
  name: string
  label?: string
  /** STRING / INT / LONG / DECIMAL / BOOLEAN / DATE / DATETIME */
  type: string
  required?: boolean
  defaultValue?: string
  remark?: string
}

/** 数据接口 */
export type DataInterfaceVO = {
  id: number
  name: string
  /** 责任人，手填字符串 */
  owner?: string
  code: string
  /** 分类：internal-内部 external-外部，字典 infra_form_type */
  category?: string
  /** 标签，字典 infra_data_interface_tag。库里是逗号串，接口层收发都是数组 */
  tags?: string[]
  /** 1-SQL 2-静态JSON 3-HTTP转发 */
  type: number
  status: number
  dataSourceConfigId?: number
  config: string
  params?: string
  script?: string
  /** SQL 动作类型，由用户配置时选择：SELECT / INSERT / UPDATE / DELETE */
  sqlStatementType?: string
  /** 动作类型的中文名，后端直接下发 */
  sqlStatementTypeName?: string
  hasWriteOperation?: boolean
  version?: number
  /** 是否记录调用日志：0-否 1-是 */
  logEnabled?: number
  remark?: string
  creator?: string
  createTime?: Date
  updater?: string
  updateTime?: Date
  /** 是否分页 0-否 1-是 */
  hasPage?: number
  /** COUNT SQL（分页时用） */
  countSql?: string
  /** HTTP基础URL */
  baseUrl?: string
  /** 是否允许内网访问 0-否 1-是 */
  allowInternalUrl?: number
}

/** 保存请求。params 是数组，与 DO 里的 JSON 字符串不同 */
export type DataInterfaceSaveReqVO = {
  id?: number
  name: string
  /** 责任人，手填字符串 */
  owner?: string
  code: string
  /** 分类：internal-内部 external-外部，字典 infra_form_type */
  category?: string
  /** 标签，必填。后端 @NotEmpty，前端也在表单规则里拦一道，省一次往返 */
  tags: string[]
  type: number
  status?: number
  dataSourceConfigId?: number
  config: string
  params?: ParamDefinitionVO[]
  script?: string
  /**
   * SQL 动作类型，SQL 类型必填
   *
   * 由用户显式选择而非程序推断 —— 一个接口能配多条 SQL，
   * 程序判断不准，用户自己选更精确
   */
  sqlStatementType?: string
  remark?: string
  changeSummary?: string
  riskConfirmed?: boolean
  /** 是否记录调用日志：0-否 1-是。为空默认开启 */
  logEnabled?: number
  /** 是否分页 */
  hasPage?: number
  /** COUNT SQL */
  countSql?: string
  /** HTTP基础URL */
  baseUrl?: string
  /** 是否允许内网访问 */
  allowInternalUrl?: number
}

/** 版本快照 */
export type DataInterfaceVersionVO = {
  id: number
  interfaceId: number
  version: number
  snapshot: string
  changeSummary?: string
  creator?: string
  createTime: Date
}

/** 调用日志 */
export type DataInterfaceLogVO = {
  id: number
  interfaceId: number
  interfaceCode: string
  invokeType: number
  requestParams?: string
  executeSql?: string
  success: boolean
  /** 失败原因摘要，最长 500 字符 */
  errorMsg?: string
  /** 失败原因完整内容，展开行显示 */
  errorDetail?: string
  resultCount?: number
  duration: number
  userId?: number
  userIp?: string
  createTime: Date
}

/** 下拉选项 */
export type OptionVO = {
  value: any
  label: string
  writeOperation?: boolean
}

/** SQL 语句探测结果。用于提示「选的动作类型和 SQL 对不上」 */
export type SqlDetectVO = {
  success: boolean
  errorMsg?: string
  statementCount?: number
  statementTypes?: string[]
  /** 去重后检出的写语句类型，为空表示 SQL 全是查询 */
  writeStatementTypes?: string[]
  hasWriteOperation?: boolean
  suggestedStatementType?: string
}

// ==================== 配置管理 ====================

export const createDataInterface = (data: DataInterfaceSaveReqVO) => {
  return request.post({ url: '/infra/data-interface/create', data })
}

export const updateDataInterface = (data: DataInterfaceSaveReqVO) => {
  return request.put({ url: '/infra/data-interface/update', data })
}

export const deleteDataInterface = (id: number) => {
  return request.delete({ url: '/infra/data-interface/delete', params: { id } })
}

/** 启用/停用 */
export const updateStatus = (id: number, status: number) => {
  return request.put({ url: '/infra/data-interface/update-status', params: { id, status } })
}

export const getDataInterface = (id: number) => {
  return request.get({ url: '/infra/data-interface/get', params: { id } })
}

export const getDataInterfacePage = (params: any) => {
  return request.get({ url: '/infra/data-interface/page', params })
}

// ==================== 执行 ====================

/** 在线预览。返回 { data, executeSql } */
export const preview = (id: number, args: Record<string, any>) => {
  return request.post({ url: '/infra/data-interface/preview', params: { id }, data: args })
}

/** 按编码调用 */
export const invoke = (code: string, args: Record<string, any>) => {
  return request.post({ url: '/infra/data-interface/invoke', params: { code }, data: args })
}

// ==================== 运行时取数（供表单控件的选项数据源使用）====================

/** 数据接口精简信息。给「选一个接口」的场景用，不含 SQL / 脚本等实现细节 */
export type DataInterfaceSimpleVO = {
  id: number
  name: string
  code: string
  category?: string
  /** 1-SQL 2-静态JSON 3-HTTP转发 */
  type: number
  hasPage?: number
  /** 接口版本号，前端据此让选项缓存自动失效 */
  version?: number
  params?: ParamDefinitionVO[]
  remark?: string
}

/**
 * 可用于运行时取数的接口列表
 *
 * 后端只返回「启用中 + 读取型」的接口，选到的一定能用，不会出现选完才在运行时报错。
 */
export const getReadOnlySimpleList = (): Promise<DataInterfaceSimpleVO[]> => {
  return request.get({ url: '/infra/data-interface/simple-list' })
}

/**
 * 全部启用中的接口（含写型）
 *
 * 只给设计期用：自定义按钮的「调数据接口」动作要选的往往是写型接口
 * （作废单据这类），而上面那个清单刻意只返回读取型 —— 它服务的是运行时取数，
 * 只需登录态，把写型接口放进去等于暴露给每一个填单人。
 */
export const getEnabledSimpleList = (): Promise<DataInterfaceSimpleVO[]> => {
  return request.get({ url: '/infra/data-interface/simple-list', params: { readOnly: false } })
}

/**
 * 运行时取数
 *
 * 与 invoke 的区别是只需登录态，不需要数据接口的管理权限 —— 填单人不可能有那个权限。
 * 后端强制只允许读取型接口。
 */
export const fetchOptions = (code: string, args: Record<string, any>) => {
  return request.post({ url: '/infra/data-interface/options', params: { code }, data: args })
}

// ==================== 版本管理 ====================

export const getVersionPage = (interfaceId: number, params: any) => {
  return request.get({
    url: '/infra/data-interface/version-page',
    params: { interfaceId, ...params }
  })
}

export const getVersion = (interfaceId: number, version: number) => {
  return request.get({ url: '/infra/data-interface/get-version', params: { interfaceId, version } })
}

export const rollbackVersion = (interfaceId: number, version: number) => {
  return request.put({ url: '/infra/data-interface/rollback', params: { interfaceId, version } })
}

// ==================== 日志与选项 ====================

export const getLogPage = (params: any) => {
  return request.get({ url: '/infra/data-interface/log-page', params })
}

/** 接口类型选项 */
export const getTypeOptions = (): Promise<OptionVO[]> => {
  return request.get({ url: '/infra/data-interface/list-type' })
}

/** SQL 动作类型选项。只返回可选的四种：查询/新增/修改/删除 */
export const getStatementTypeOptions = (): Promise<OptionVO[]> => {
  return request.get({ url: '/infra/data-interface/list-statement-type' })
}

/** 探测 SQL 里实际包含的语句类型。用于配置界面即时提示，不影响保存 */
export const detectSql = (sql: string): Promise<SqlDetectVO> => {
  return request.post({ url: '/infra/data-interface/detect-sql', data: { sql } })
}
