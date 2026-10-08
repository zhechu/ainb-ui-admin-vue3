import request from '@/config/axios'

/** 数据模型 */
export type DataModelVO = {
  id: number
  dataSourceConfigId: number
  tableName: string
  tableComment: string
  modelName: string
  remark?: string
  createTime?: Date
  // ========== AI 产物治理（B4-1）==========
  /** 乐观锁版本。改表时必须原样回传，缺了后端会直接拒（缺它乐观锁形同没开） */
  version?: number
  /** 来源：MANUAL=人工创建 / AI=Agent 工具创建 / IMPORT=导入已有表登记。只读，服务端按入口盖章 */
  source?: string
  /** 人工是否改过这条 AI 建的模型。只读、且只增不减，服务端按入口盖章 */
  manualEditedFlag?: boolean
}

/** 数据模型字段 */
export type DataModelColumnVO = {
  columnName: string
  columnComment: string
  columnType: string
  length?: number
  scale?: number
  nullable: boolean
  primaryKey: boolean
  autoIncrement?: boolean
  defaultValue?: string
  /** 原字段名。改名时传入，为空表示不改名 */
  oldColumnName?: string
  /** 是否带 ON UPDATE CURRENT_TIMESTAMP，只对 DATETIME 有意义 */
  onUpdateCurrentTimestamp?: boolean
  /*
   * 以下三项是业务语义，不落物理表结构，单独存进 infra_data_model.column_meta。
   * 改表时按提交的完整字段列表重建：改名跟随 oldColumnName、删列自动清理。
   */
  /** 字典类型，对应 system_dict_data.dict_type */
  dictType?: string
  /** 关联的表名。仅业务语义，不建物理外键 */
  refTable?: string
  /** 关联的列名 */
  refColumn?: string
}

/** 系统列注入策略，仅建表时生效 */
export const SYSTEM_COLUMN_PROFILES = [
  { value: 'TENANT', label: '多租户表（推荐）', tip: '含 tenant_id，与框架表一致。业务表一律用这个' },
  { value: 'GLOBAL', label: '全局表', tip: '不含 tenant_id，数据对所有租户可见。仅用于全租户共享的字典型数据' },
  { value: 'LEGACY', label: '兼容存量样板表', tip: '含 version、不含 tenant_id，对齐 test_demo_* 结构。新表不要用' }
]

/** 数据模型索引 */
export type DataModelIndexVO = {
  indexName: string
  /** NORMAL 普通 / UNIQUE 唯一 */
  indexType: string
  columnNames: string[]
}

/** 模型结构：字段 + 索引 */
export type DataModelStructureVO = {
  columns: DataModelColumnVO[]
  indexes: DataModelIndexVO[]
  /**
   * 物理表结构的指纹（sha256），由后端按【实时读到的结构】算出。
   *
   * 🔴 改表时必须原样回传：后端在执行任何 DDL 之前会拿它与库里的实际结构再比一次，
   *    对不上就中止 —— 挡的是「有人绕过数据建模直接改了库（DBA 手工 SQL、迁移脚本、别的工具）」。
   *    那类改动不经过登记行，压根不会推高 version，光靠乐观锁看不见。
   * ⚠️ 它是【实时值】而不是库里存的基线，所以不能拿旧的一份凑数：
   *    自己跟自己比恒等，那道闸就成了空操作
   */
  schemaFingerprint?: string
  /** 登记行的乐观锁版本，与 schemaFingerprint 成对取回、成对回传 */
  version?: number
}

/** 数据模型保存请求 */
export type DataModelSaveReqVO = {
  id?: number
  dataSourceConfigId: number
  tableName: string
  tableComment: string
  modelName: string
  remark?: string
  columns: DataModelColumnVO[]
  indexes?: DataModelIndexVO[]
  /** 是否已知晓风险。删除字段等有损操作需要显式确认 */
  riskConfirmed?: boolean
  /**
   * 系统列策略，仅建表时生效，改表传了也会被忽略。
   * 不传按 TENANT 处理。不落库 —— 物理表有没有 tenant_id 列本身就是唯一事实来源
   */
  systemColumnProfile?: string
  // ========== AI 产物治理（B4-2 / B4-3 / B4-4）==========
  /**
   * 乐观锁版本，改表时必传。取自 getDataModelStructure 的返回值，原样带回。
   * 🔴 不传后端会直接拒（不是「跳过加锁」）：缺了它 MyBatis-Plus 会静默不加版本条件，
   *    并发覆盖照旧发生且不报错
   */
  version?: number
  /** 结构指纹，改表时必传。见 DataModelStructureVO.schemaFingerprint */
  schemaFingerprint?: string
  /**
   * 确认要删列（B4-3）。与 riskConfirmed 不是一回事、也不能互相替代：
   * riskConfirmed 管【数据】（这些列里的行可以丢，只在表里有数据时用得上），
   * 本项管【结构】（我确实要删这几列，与表里有没有数据无关 —— 空表上它才是唯一那道闸）。
   * 🔴 只能由人在界面上点二次确认弹窗后置真，AI 路径恒不传
   */
  confirmDropColumns?: boolean
}

/** 字段类型选项 */
export type DataModelColumnTypeVO = {
  type: string
  mysqlType: string
  javaType: string
  needLength: boolean
  needScale: boolean
  description: string
}

/** DDL 执行日志 */
export type DataModelLogVO = {
  id: number
  tableName: string
  operateType: string
  executeSql: string
  success: boolean
  errorMsg?: string
  duration: number
  creator?: string
  createTime: Date
}

/** 数据库表（导入用） */
export type DatabaseTableVO = {
  TABLE_NAME: string
  TABLE_COMMENT: string
}

// ==================== 模型管理 ====================

/** 创建数据模型，会真实执行 CREATE TABLE */
export const createDataModel = (data: DataModelSaveReqVO) => {
  return request.post({ url: '/infra/data-model/create', data })
}

/** 更新数据模型，会真实执行 ALTER TABLE 且无法回滚 */
export const updateDataModel = (data: DataModelSaveReqVO) => {
  return request.put({ url: '/infra/data-model/update', data })
}

/** 删除数据模型
 * @param dropTable 是否同时删除真实表
 * @param riskConfirmed 表中有数据时，需显式确认
 */
export const deleteDataModel = (id: number, dropTable = false, riskConfirmed = false) => {
  return request.delete({
    url: `/infra/data-model/delete?id=${id}&dropTable=${dropTable}&riskConfirmed=${riskConfirmed}`
  })
}

/** 导入已有表，仅登记模型不执行 DDL */
export const importTables = (dataSourceConfigId: number, tableNames: string[]) => {
  return request.post({
    url: '/infra/data-model/import',
    params: { dataSourceConfigId, tableNames: tableNames.join(',') }
  })
}

export const getDataModel = (id: number) => {
  return request.get({ url: `/infra/data-model/get?id=${id}` })
}

export const getDataModelPage = (params: any) => {
  return request.get({ url: '/infra/data-model/page', params })
}

/** 获得模型字段列表，实时读取真实表结构 */
export const getDataModelColumns = (id: number) => {
  return request.get({ url: `/infra/data-model/list-columns?id=${id}` })
}

/** 获得模型完整结构：字段 + 索引，实时读取真实表结构 */
export const getDataModelStructure = (id: number): Promise<DataModelStructureVO> => {
  return request.get({ url: `/infra/data-model/structure?id=${id}` })
}

/**
 * 获得系统内置字段列表，新建模型时只读展示
 *
 * ⚠️ 必须带上 profile：新建时界面上的字段是要一并提交的，
 * 若选了 GLOBAL 却仍展示并提交 tenant_id，后端注入器会「让位」，
 * 结果表里照样有 tenant_id —— profile 就成了摆设
 */
export const getSystemColumns = (profile?: string): Promise<DataModelColumnVO[]> => {
  return request.get({ url: '/infra/data-model/list-system-column', params: { profile } })
}

/**
 * 获得系统表前缀列表
 *
 * 前端只用它禁用删除按钮并给提示，真正的拦截在后端 checkNotFrameworkTable。
 * 走接口而不是硬编码，是因为这份名单此前前后端各一份，改一边漏一边。
 */
export const getSystemTablePrefixes = (): Promise<string[]> => {
  return request.get({ url: '/infra/data-model/list-system-table-prefix' })
}

/** 预览待执行的 DDL，不实际执行 */
export const previewDdl = (data: DataModelSaveReqVO) => {
  return request.post({ url: '/infra/data-model/preview-ddl', data })
}

/** 获得数据库的表列表，用于导入 */
export const getDatabaseTableList = (params: any) => {
  return request.get({ url: '/infra/data-model/list-database-table', params })
}

/** 预览表数据 */
export const getTableDataPage = (id: number, pageNo: number, pageSize: number) => {
  return request.get({
    url: '/infra/data-model/table-data-page',
    params: { id, pageNo, pageSize }
  })
}

/** 获得字段类型选项 */
export const getColumnTypeList = () => {
  return request.get({ url: '/infra/data-model/list-column-type' })
}

/** 获得 DDL 执行日志分页 */
export const getDataModelLogPage = (params: any) => {
  return request.get({ url: '/infra/data-model/log-page', params })
}
