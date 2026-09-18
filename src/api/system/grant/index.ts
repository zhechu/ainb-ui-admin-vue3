import request from '@/config/axios'

// ========== VO 类型定义 ==========

export interface ResourceVO {
  id: number
  permission: string
  name: string
  type: string // MENU/ACTION/PROCESS/CATEGORY/DATASET/COLUMN/FIELD
  parentId: number
  path: string
  depth: number
  sort: number
  defaultEffect: string // ALLOW | DENY
  status: number
  /** 记录分享策略：OWNER_ONLY | ANY_VIEWER | DISABLED；空表示未配置，回落到默认 */
  sharePolicy?: string
}

export interface GrantVO {
  id: number
  subjectType: string
  subjectRefId?: number
  subjectCode?: string
  resourceId: number
  resourcePermission?: string
  resourceName?: string
  contextResourceId?: number
  action: string
  effect: string // ALLOW | DENY
  ruleId?: number
  ruleName?: string
  fieldMode?: string // 必须与后端 FieldModeEnum 一致：EDITABLE | READONLY | HIDDEN
  expireTime?: string
  expired?: boolean
  createTime?: string
}

export interface GrantSaveReqVO {
  id?: number
  subjectType: string
  subjectRefId?: number
  subjectCode?: string
  resourceId: number
  contextResourceId?: number
  action: string
  effect: string
  ruleId?: number
  fieldMode?: string
  expireTime?: string
}

export interface RuleVO {
  id: number
  name: string
  template: string
  params?: string
  description?: string
  status: number
}

export interface SubjectVO {
  id: number
  type: string
  refId?: number
  code?: string
  name?: string
  status: number
}

// ========== 权限资源 ==========

/** 查询全部启用的资源列表（前端自行组装树） */
export const getResourceList = async (type?: string): Promise<ResourceVO[]> => {
  return await request.get({ url: '/system/resource/list', params: type ? { type } : {} })
}

/** 查询单个资源 */
export const getResource = async (id: number): Promise<ResourceVO> => {
  return await request.get({ url: '/system/resource/get', params: { id } })
}

// ========== 行过滤规则 ==========

/** 查询启用的规则列表（授权配置页下拉） */
export const getSimpleRuleList = async (): Promise<RuleVO[]> => {
  return await request.get({ url: '/system/rule/simple-list' })
}

// ========== 授权主体 ==========

/** 按类型查询主体列表（授权配置页主体下拉） */
export const getSubjectListByType = async (type: string): Promise<SubjectVO[]> => {
  return await request.get({ url: '/system/subject/list-by-type', params: { type } })
}

// ========== 授权配置（sys_grant）==========

/** 查询某个主体的全部授权 */
export const getGrantListBySubject = async (
  subjectType: string,
  subjectRefId?: number,
  subjectCode?: string
): Promise<GrantVO[]> => {
  return await request.get({
    url: '/system/grant/list-by-subject',
    params: { subjectType, subjectRefId, subjectCode }
  })
}

/** 新增授权行 */
export const createGrant = async (data: GrantSaveReqVO): Promise<number> => {
  return await request.post({ url: '/system/grant/create', data })
}

/** 修改授权行 */
export const updateGrant = async (data: GrantSaveReqVO): Promise<boolean> => {
  return await request.put({ url: '/system/grant/update', data })
}

/** 查询资源上的所有授权行（资源配置面板用） */
export const getGrantListByResource = async (resourceId: number): Promise<GrantVO[]> => {
  return await request.get({ url: '/system/grant/list-by-resource', params: { resourceId } })
}

/** 删除授权行 */
export const deleteGrant = async (id: number): Promise<boolean> => {
  return await request.delete({ url: '/system/grant/delete', params: { id } })
}

// ========== 行过滤规则（S8b 补全）==========

/** 查询全部规则（含停用） */
export const getRuleList = async (): Promise<RuleVO[]> => {
  return await request.get({ url: '/system/rule/list' })
}

/** 配置资源的记录分享策略（TODO #48）。传空串表示清除配置，回落到默认 */
export const updateSharePolicy = async (id: number, sharePolicy: string): Promise<boolean> => {
  return await request.put({ url: '/system/resource/update-share-policy',
    params: { id, sharePolicy } })
}

/** 查询单条规则 */
export const getRule = async (id: number): Promise<RuleVO> => {
  return await request.get({ url: '/system/rule/get', params: { id } })
}

/** 新增规则 */
export const createRule = async (data: Omit<RuleVO, 'id'>): Promise<number> => {
  return await request.post({ url: '/system/rule/create', data })
}

/** 修改规则 */
export const updateRule = async (data: RuleVO): Promise<boolean> => {
  return await request.put({ url: '/system/rule/update', data })
}

/** 删除规则（内置规则 BUILT_IN_ 前缀不能删） */
export const deleteRule = async (id: number): Promise<boolean> => {
  return await request.delete({ url: '/system/rule/delete', params: { id } })
}

// ========== 语义槽位映射（S8b）==========

export interface SlotMappingVO {
  id: number
  resourceId: number
  slot: string
  columnName: string
  description?: string
}

/** 查询某资源的全部槽位映射 */
export const getSlotMappingList = async (resourceId: number): Promise<SlotMappingVO[]> => {
  return await request.get({ url: '/system/slot-mapping/list-by-resource', params: { resourceId } })
}

/** 新增槽位映射 */
export const createSlotMapping = async (data: Omit<SlotMappingVO, 'id'>): Promise<number> => {
  return await request.post({ url: '/system/slot-mapping/create', data })
}

/** 修改槽位映射 */
export const updateSlotMapping = async (data: SlotMappingVO): Promise<boolean> => {
  return await request.put({ url: '/system/slot-mapping/update', data })
}

/** 删除槽位映射 */
export const deleteSlotMapping = async (id: number): Promise<boolean> => {
  return await request.delete({ url: '/system/slot-mapping/delete', params: { id } })
}

// ========== 权限诊断（S8d）==========

export interface DiagGrantRow {
  id: number
  subjectType: string
  subjectRefId?: number
  subjectCode?: string
  resourceId: number
  action: string
  effect: string
  expireTime?: string
  active: boolean
  subjectHit: boolean
  actionHit: boolean
  effective: boolean
}

export interface PermissionDiagVO {
  userId: number
  permission: string
  action: string
  subjects: string[]
  resourceChain: ResourceVO[]
  allGrants: DiagGrantRow[]
  conclusion: 'ALLOWED' | 'DENIED'
  reason: string
}

/** 诊断某用户对指定权限点的决策路径 */
export const diagPermission = async (
  permission: string,
  action?: string,
  userId?: number
): Promise<PermissionDiagVO> => {
  return await request.get({
    url: '/system/permission-diag/check',
    params: { permission, action, userId }
  })
}
