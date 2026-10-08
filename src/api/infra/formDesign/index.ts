import request from '@/config/axios'

/**
 * 表单设计
 *
 * 独立的低代码表单模块，与「表单构建」（infra/build，只产出代码不落库）
 * 和「流程表单」（bpm/form，仅供工作流使用）完全隔离。
 */
export type FormDesignVO = {
  /** 该表单是否存在服务端扩展点实现。设计期模式错配提示用 */
  hasServerExtension?: boolean
  /** 服务端扩展点实现类名 */
  serverExtensionNames?: string[]
  id: number
  name: string
  /** 表单编码，运行时与菜单引用它，发布后不可修改 */
  code: string
  /** 分类，字典 infra_form_design_category */
  category?: string
  /** 1-纯表单 2-表单+列表 */
  formType: number
  /** 0-草稿 1-已发布 2-已发布有改动 */
  status: number
  /** form-create 的 getOption() */
  formConf?: string
  /** form-create 的 getRule() 逐条序列化 */
  formFields?: string[]
  /** 联动规则 JSON 数组 */
  logicRules?: string
  /** 跨字段校验规则 JSON 数组 */
  validateRules?: string
  /** 自定义按钮 JSON 数组：[{key,label,icon,position,action,visibleWhen,permission}] */
  customButtons?: string
  /** 详情页页签 JSON 数组：[{key,label,type}] */
  detailTabs?: string
  /** 打印模板 HTML，占位符为 {字段} */
  printTemplate?: string
  /** 扩展模式：0-无 1-前端脚本 2-服务端扩展点 */
  extensionMode?: number
  /** 前端脚本 JSON */
  formScript?: string
  /** beforeSubmit 超时后的动作：1-阻断 2-放行 */
  submitHookTimeoutAction?: number
  /** 列表配置 JSON，仅表单+列表类型有意义 */
  listConf?: string
  /** 数据源编号，0 为主库 */
  dataSourceConfigId?: number
  mainTable?: string
  mainPk?: string
  /** 表绑定 JSON：字段映射/从表关联/子表配置 */
  tableBinding?: string
  /** 当前线上版本号，0 表示从未发布 */
  publishedVersion?: number
  /** 发布生成的菜单编号 */
  menuId?: number
  sort?: number
  remark?: string
  creator?: string
  createTime?: Date
  updater?: string
  updateTime?: Date
  // ========== AI 产物治理（B4-1）==========
  /**
   * 乐观锁版本。保存时必须原样回传，缺了后端会直接拒（缺它乐观锁形同没开）。
   *
   * ⚠️ 与本文件里另外两个 version <b>不是一回事</b>，三者同名不同义：
   * · 本字段      —— 这一<b>行记录</b>被改过几次，用于并发覆盖检测；
   * · publishedVersion —— 线上是第几<b>次发布</b>；
   * · FormDesignVersionVO.version —— 草稿快照的序号。
   * 混用的表现是「保存被拒，说版本冲突」，而用户看不出是哪一层在冲突
   */
  version?: number
  /** 来源：MANUAL=人工创建 / AI=Agent 工具创建。只读，服务端按入口盖章 */
  source?: string
  /** 人工是否改过这张 AI 建的表单。只读、且只增不减，服务端按入口盖章 */
  manualEditedFlag?: boolean
}

/** 保存请求。formFields 是数组，与 DO 里的 JSON 字符串不同 */
export type FormDesignSaveReqVO = {
  id?: number
  name: string
  code: string
  category?: string
  formType: number
  formConf?: string
  formFields?: string[]
  /** 联动规则 JSON 数组 */
  logicRules?: string
  /** 跨字段校验规则 JSON 数组 */
  validateRules?: string
  /** 自定义按钮 JSON 数组 */
  customButtons?: string
  /** 详情页页签 JSON 数组 */
  detailTabs?: string
  /** 打印模板 HTML，占位符为 {字段}。落库前由服务端按白名单清洗 */
  printTemplate?: string
  /** 扩展模式：0-无 1-前端脚本 2-服务端扩展点 */
  extensionMode?: number
  /** 前端脚本 JSON */
  formScript?: string
  /** beforeSubmit 超时后的动作：1-阻断 2-放行 */
  submitHookTimeoutAction?: number
  listConf?: string
  dataSourceConfigId?: number
  mainTable?: string
  mainPk?: string
  tableBinding?: string
  sort?: number
  remark?: string
  /**
   * 乐观锁版本（B4-4），修改时必传。取自 getFormDesign 的返回值，原样带回。
   * 🔴 不是 schemaVersion、也不是 publishedVersion —— 见 FormDesignVO.version 上那段辨析
   */
  version?: number
}

/** 精简信息，供其它功能引用表单时使用 */
export type FormDesignSimpleVO = {
  id: number
  name: string
  code: string
  formType: number
  status: number
}

/** 版本快照 */
export type FormDesignVersionVO = {
  id: number
  designId: number
  version: number
  snapshot: string
  changeSummary?: string
  creator?: string
  createTime: Date
}

/** 发布请求 */
export type FormDesignPublishReqVO = {
  id: number
  changeSummary?: string
  /** 上级菜单编号，首次发布时必填 */
  parentMenuId?: number
  menuSort?: number
}

// ==================== 设计态 ====================

export const createFormDesign = (data: FormDesignSaveReqVO) => {
  return request.post({ url: '/infra/form-design/create', data })
}

export const updateFormDesign = (data: FormDesignSaveReqVO) => {
  return request.put({ url: '/infra/form-design/update', data })
}

export const deleteFormDesign = (id: number) => {
  return request.delete({ url: '/infra/form-design/delete', params: { id } })
}

export const getFormDesign = (id: number) => {
  return request.get({ url: '/infra/form-design/get', params: { id } })
}

export const getFormDesignPage = (params: any) => {
  return request.get({ url: '/infra/form-design/page', params })
}

export const getFormDesignSimpleList = (): Promise<FormDesignSimpleVO[]> => {
  return request.get({ url: '/infra/form-design/simple-list' })
}

/** 复制表单。副本为草稿状态，不继承菜单与版本历史 */
/**
 * 设计期体检
 *
 * 把这张表单的问题一次列全，不改动任何数据。与发布走**同一份校验** ——
 * 体检通过就一定发得出去，不会出现「体检说没问题、发布却被拒」。
 *
 * @returns 问题清单，空数组表示可以发布
 */
export const inspectFormDesign = (id: number): Promise<string[]> => {
  return request.get({ url: '/infra/form-design/inspect', params: { id } })
}

export const copyFormDesign = (id: number) => {
  return request.post({ url: '/infra/form-design/copy', params: { id } })
}

/** 校验编码是否可用。可用返回 true */
export const checkCode = (code: string, id?: number): Promise<boolean> => {
  return request.get({ url: '/infra/form-design/check-code', params: { code, id } })
}

// ==================== 发布与版本 ====================

/** 待创建的按钮权限配置 */
export type PublishPermissionConfigVO = {
  name: string
  permission: string
  sort: number
}

/** 待创建的菜单配置。由后端算好，前端拿去调 /system/menu/create */
export type PublishMenuConfigVO = {
  name: string
  path: string
  component: string
  componentName: string
  parentId: number
  sort: number
  icon: string
  permissions: PublishPermissionConfigVO[]
}

/**
 * 发布结果
 *
 * infra 模块不能反向依赖 system（system 已依赖 infra，反向会循环依赖），
 * 所以后端只做校验+存版本，菜单由前端拿 menuConfig 再调 /system/menu/create 建。
 */
export type FormDesignPublishRespVO = {
  version: number
  /** 是否需要前端建菜单。已有菜单时为 false */
  needCreateMenu: boolean
  menuConfig?: PublishMenuConfigVO
}

/** 发布。返回版本号与待创建的菜单配置 */
export const publishFormDesign = (
  data: FormDesignPublishReqVO
): Promise<FormDesignPublishRespVO> => {
  return request.post({ url: '/infra/form-design/publish', data })
}

/** 登记前端已创建的菜单，供下线时精确回收 */
export const bindMenu = (designId: number, menuId: number, permissionMenuIds?: number[]) => {
  return request.post({
    url: '/infra/form-design/bind-menu',
    params: { designId, menuId, permissionMenuIds: permissionMenuIds?.join(',') }
  })
}

/** 下线。返回需要前端删除的菜单编号列表 */
export const unpublishFormDesign = (id: number): Promise<number[]> => {
  return request.post({ url: '/infra/form-design/unpublish', params: { id } })
}

export const getVersionList = (designId: number): Promise<FormDesignVersionVO[]> => {
  return request.get({ url: '/infra/form-design/version-list', params: { designId } })
}

export const getVersion = (
  designId: number,
  version: number
): Promise<FormDesignVersionVO> => {
  return request.get({ url: '/infra/form-design/get-version', params: { designId, version } })
}

/** 回滚。只把快照写回草稿，线上版本不变，需再点发布才生效 */
export const rollbackVersion = (designId: number, version: number) => {
  return request.post({ url: '/infra/form-design/rollback', params: { designId, version } })
}

// ==================== 数据库元数据 ====================

/** 数据源配置 */
export type DataSourceConfigVO = {
  id: number
  name: string
  url?: string
  username?: string
}

/** 可绑定的数据库表 */
export type DbTableVO = {
  name: string
  comment?: string
  /** 系统内置表（system_/infra_/bpm_ 前缀），不可作为可写主表 */
  frameworkTable: boolean
}

/** 可绑定的数据库列 */
export type DbColumnVO = {
  columnName: string
  columnComment?: string
  jdbcType?: string
  /** Java 类型，用于推荐控件类型 */
  javaType?: string
  primaryKey: boolean
  nullable?: boolean
}

export const getDataSourceList = (): Promise<DataSourceConfigVO[]> => {
  return request.get({ url: '/infra/form-design/data-sources' })
}

export const getDbTables = (
  dataSourceConfigId: number,
  nameLike?: string
): Promise<DbTableVO[]> => {
  return request.get({
    url: '/infra/form-design/db-tables',
    params: { dataSourceConfigId, nameLike }
  })
}

export const getTableColumns = (
  dataSourceConfigId: number,
  tableName: string
): Promise<DbColumnVO[]> => {
  return request.get({
    url: '/infra/form-design/table-columns',
    params: { dataSourceConfigId, tableName }
  })
}
