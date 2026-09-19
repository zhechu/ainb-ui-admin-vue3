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
  /** 是否系统内置：内置规则不允许删除，只能停用 */
  builtIn?: boolean
  createTime?: Date
}

export interface RulePageReqVO extends PageParam {
  name?: string
  template?: string
  status?: number
  builtIn?: boolean
  createTime?: string[]
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

/**
 * 查询全部启用的资源列表（前端自行组装树）
 *
 * @param type 资源类型，传了则只查该类型
 * @param includeFieldLevel 是否包含 COLUMN/FIELD 级资源。后端默认 false ——
 *        字段资源按表单数量线性增长，默认放进树里会把真正要配的 ACTION 淹没掉。
 *        但不传的后果是【授权页里根本找不到字段资源，字段权限配不出来】，
 *        所以要有一个显式开关让人能打开
 */
export const getResourceList = async (
  type?: string,
  includeFieldLevel = false
): Promise<ResourceVO[]> => {
  const params: Record<string, any> = {}
  if (type) params.type = type
  if (includeFieldLevel) params.includeFieldLevel = true
  return await request.get({ url: '/system/resource/list', params })
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

/** 分页查询某个主体的授权（角色资源授权页列表用） */
export interface GrantPageReqVO extends PageParam {
  subjectType: string
  subjectRefId?: number
  subjectCode?: string
  resourceId?: number
  action?: string
  effect?: string
  resourceName?: string
  resourcePermission?: string
  /** 到期时间范围 [起, 止]，格式 YYYY-MM-DD HH:mm:ss */
  expireTime?: string[]
}

export const getGrantPage = async (params: GrantPageReqVO) => {
  return await request.get({ url: '/system/grant/page', params })
}

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

/** 分页查询规则（规则管理页） */
export const getRulePage = async (params: RulePageReqVO) => {
  return await request.get({ url: '/system/rule/page', params })
}

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

/** 批量删除规则（内置规则、被授权引用的规则不能删） */
export const deleteRuleList = async (ids: number[]): Promise<boolean> => {
  return await request.delete({ url: '/system/rule/delete-list', params: { ids: ids.join(',') } })
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

/**
 * 查询【当前登录用户】对某数据集的字段模式
 *
 * 返回形如 { mobile: 'HIDDEN', sex: 'READONLY' }。没配过的字段不会出现在结果里，
 * 调用方按「不存在 = 不受限」处理
 *
 * @param datasetPermission 数据集权限标识，如 system:user
 * @param column true=列表列(:col:)，false=详情字段(:fld:)
 */
export const getMyFieldModes = async (
  datasetPermission: string,
  column = false
): Promise<Record<string, string>> => {
  return await request.get({
    url: '/system/grant/my-field-modes',
    params: { datasetPermission, column }
  })
}

/** 新增权限资源 */
export const createResource = async (data: any): Promise<number> => {
  return await request.post({ url: '/system/resource/create', data })
}

/** 修改权限资源。菜单派生的资源仅可改 sort/status，后端会校验 */
export const updateResource = async (data: any): Promise<boolean> => {
  return await request.put({ url: '/system/resource/update', data })
}

/** 删除权限资源。有子资源 / 有授权引用 / 菜单派生的，后端会拒绝 */
export const deleteResource = async (id: number): Promise<boolean> => {
  return await request.delete({ url: '/system/resource/delete', params: { id } })
}

/** 按父节点查子资源（树表懒加载）。根节点传 0 */
export const getResourceChildren = async (
  parentId: number,
  includeFieldLevel = false
): Promise<ResourceVO[]> => {
  return await request.get({
    url: '/system/resource/list-children',
    params: { parentId, includeFieldLevel }
  })
}

// ========== 规则模板元数据（后端驱动，杜绝前端硬编码漂移）==========

/** 参数子编辑器种类，与后端 RuleTemplateMetaRegistry.KIND_* 一致 */
export type ParamKind = 'STATUS_LIST' | 'DEPT_MULTI' | 'SLOT' | 'TEXT' | 'CONDITION_TREE'

/** 模板分组 */
export type TemplateGroup = 'basic' | 'derived' | 'advanced'

export interface RuleParamSpecVO {
  key: string
  kind: ParamKind
  label: string
  required: boolean
  valueType?: 'number' | 'string'
}

export interface RuleTemplateMetaItemVO {
  code: string
  displayName: string
  group: TemplateGroup
  businessDescription: string
  requiredSlots: string[]
  paramSpecs: RuleParamSpecVO[]
}

export interface RuleSlotMetaVO {
  slot: string
  description: string
}

export interface RuleOperatorMetaVO {
  code: string
  label: string
  /** 一元操作符（IS_NULL/IS_NOT_NULL），无需值 */
  unary: boolean
  /** 多值操作符（IN/NOT_IN），值必须是集合变量 */
  multiValue: boolean
}

export interface RuleVariableMetaVO {
  name: string
  label: string
  /** 集合类型变量，仅这些可用于 IN/NOT_IN */
  collection: boolean
}

export interface RuleTemplateMetaVO {
  templates: RuleTemplateMetaItemVO[]
  slots: RuleSlotMetaVO[]
  operators: RuleOperatorMetaVO[]
  variables: RuleVariableMetaVO[]
}

/** 查询规则模板元数据（模板/槽位/操作符/变量），供规则编辑器动态渲染 */
export const getRuleTemplateMeta = async (): Promise<RuleTemplateMetaVO> => {
  return await request.get({ url: '/system/rule/template-meta' })
}
