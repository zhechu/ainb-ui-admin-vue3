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
  /**
   * 主体的展示名，形如 `super_admin（超级管理员）`、`研发部（RD）`
   *
   * 🔴 由后端从权威业务表批量解析（`SubjectDisplayNameResolver`），不是 `sys_subject.name`
   * ——那张表按需登记、USER 维度压根没有行，且 name 列自己就写明「可能过期、判定逻辑不许读」。
   * 解析不到（跨租户、已删除、被停用）时后端会给 `#123（未找到）`，前端直接展示即可，
   * 不要再自己拼 simple-list：那需要为每种主体各拉一次全量列表，且拿不到角色标识与部门编码
   */
  subjectName?: string
  resourceId: number
  resourcePermission?: string
  resourceName?: string
  /**
   * 资源类型：MENU/ACTION/PROCESS/CATEGORY/DATASET/COLUMN/FIELD
   *
   * 用来判「这一行上的 ruleId / fieldMode 有没有意义」——行过滤规则只在 DATASET 上会被读到，
   * 绑在菜单上是死字段。没有它，列表页只能对所有行一律显示「不受限（全部行）」，那句话对死字段是假的
   */
  resourceType?: string
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

// ========== 生效权限树（智能查看）==========

/**
 * 一项生效动作，以及它是**从哪来的**
 *
 * 🔴 这里没有一个字段是前端算出来的：判决与出处全部由后端
 * `GrantDecisionEngine#explain` 给出，`isAllowed` 已退化成 `explain(...).allowed()`，
 * 所以图上说「拥有」与鉴权放行在构造上不可能分叉。
 * 前端只负责把 `source` 翻译成人话，绝不重算优先级
 */
export interface EffectiveActionVO {
  /** 动作码；`*` 表示「全部动作」——要么是通配授权折叠而来，要么是无人配置时的默认放行 */
  action: string
  effect: string // ALLOW | DENY
  /**
   * 权限来源：
   * - `EXPLICIT` 本资源自己配的行
   * - `INHERITED` 祖先配的行（扁平列表永远展示不出来的信息）
   * - `ALL_USERS` 全员主体 `ALL / all-users` 的行
   * - `DEFAULT` 链上没有任何行，回落到资源的 default_effect 列
   */
  source: 'EXPLICIT' | 'INHERITED' | 'ALL_USERS' | 'DEFAULT'
  /** 投出决定性一票的资源节点。INHERITED 时指向那个祖先，前端显示「继承自「X」」 */
  sourceResourceId?: number
  sourceResourceName?: string
  /** 命中的授权行编号，可用来跳回列表页定位；source=DEFAULT 时为空（压根没有行） */
  grantId?: number
  ruleId?: number
  ruleName?: string
  fieldMode?: string // EDITABLE | READONLY | HIDDEN
  expireTime?: string
  /** 命中的是谁的行：主体闭包里可能同时有本角色、继承来的上级角色、全员主体 */
  subjectType?: string
  subjectRefId?: number
  subjectCode?: string
}

export interface EffectiveResourceNodeVO {
  id: number
  parentId: number
  name: string
  permission?: string
  type: string // MENU/ACTION/PROCESS/CATEGORY/DATASET/COLUMN/FIELD
  depth?: number
  sort?: number
  /** 资源的 default_effect **列**，不是按 type 推出来的值（实测 PROCESS 有 18 行是 ALLOW） */
  defaultEffect?: string
  /**
   * 自身没有任何生效权限、仅为撑起树而保留的路径节点。
   * 不区分的话前端会把一个空目录渲染成「有权限」
   */
  structural: boolean
  actions: EffectiveActionVO[]
  children: EffectiveResourceNodeVO[]
}

export interface EffectiveTreeSummaryVO {
  /** 最终树里的节点数，含 structural 路径节点 */
  nodeCount: number
  /** 最终树里的生效动作数（折叠成 `*` 的按 1 计） */
  actionCount: number
  inheritedCount: number
  allUsersCount: number
  /**
   * 纯默认放行（无人配置）的节点数。🔴 与 includeDefaultAllow 开关**无关**，
   * 两种模式下都是同一个数 —— 它存在的意义就是告诉你「收起了多少个」
   */
  defaultAllowCount: number
  /** 被显式 DENY 否决的 (资源 × 动作) 数。不含「没人配过」的 default_effect=DENY */
  deniedCount: number
  /** 已过期、未计入判定的授权行数。不报数的话树形节点数和列表页行数对不上，会被当成 bug */
  expiredSkippedCount: number
  /** 该角色是超管角色：真实鉴权**旁路**授权台账，这张图画的是台账，两者不是一回事 */
  superAdminRole: boolean
}

export interface EffectiveTreeRespVO {
  /** 实际参与判定的主体清单（取自 `SubjectKey#asString()`，已排序），要在页面上明示 */
  subjects: string[]
  summary: EffectiveTreeSummaryVO
  tree: EffectiveResourceNodeVO[]
}

/**
 * 查询某个主体的**生效**权限树（角色权限地图，只读）
 *
 * 与 `getGrantListBySubject` 的区别：那个返回台账上的**行**，这个返回判定后的**结论** ——
 * 同一资源上的 4 行会合并成 1 个节点、父菜单的 ALLOW 会让没有自己行的子按钮显示为生效、
 * 祖先的 DENY 会否决后代自己的 ALLOW、过期的行会消失（但在 summary 里报数）。
 *
 * 🔴 口径要在页面上写清楚，否则一定被当成漏权限报上来：
 * - 只算**角色维度**（该角色 + 其在主体图上的祖先 + 可选的全员主体），
 *   **不含**用户级 / 岗位 / 部门 / 用户组授权，因此**少于**「拥有该角色的用户实际能做的」
 * - 只认**启用**的资源行，与菜单清单、权限清单同口径
 * - `sys_grant` 分租户而 `sys_resource` 是全局表，所以同一棵树在不同租户下剪枝结果不同
 *
 * @param includeFieldLevel 是否包含 COLUMN / FIELD 这两类字段级资源
 * @param includeAllSubject 是否并入全员主体。🔴 关掉会漏掉实测那 9 条全员授权
 * @param includeDefaultAllow 是否包含「纯默认放行」的节点。实测超管角色有 205 个，
 *        全渲染出来会淹掉真正配过的那些，所以默认收起
 */
export const getEffectiveTree = async (
  subjectType: string,
  subjectRefId: number,
  includeFieldLevel = false,
  includeAllSubject = true,
  includeDefaultAllow = false
): Promise<EffectiveTreeRespVO> => {
  return await request.get({
    url: '/system/grant/effective-tree',
    params: {
      subjectType,
      subjectRefId,
      includeFieldLevel,
      includeAllSubject,
      includeDefaultAllow
    }
  })
}

/**
 * 新增授权行（**upsert 语义**）
 *
 * 撞上同「主体 + 资源 + 动作 + 上下文」的既有行时会覆盖它，而不是再插一行。
 * 表上没有唯一索引（软删模型下加了会被已删行占住键），判重全在后端应用层做，
 * 所以返回值可能是新插入行的 id，也可能是被覆盖那条存活行的 id
 */
export const createGrant = async (data: GrantSaveReqVO): Promise<number> => {
  return await request.post({ url: '/system/grant/create', data })
}

/** 批量新增的计数回执 */
export interface GrantBatchSaveRespVO {
  /** 真正插进去的行数 */
  insertedCount: number
  /** 命中既有同键行、被覆盖的行数 */
  updatedCount: number
  /**
   * 顺带收敛掉的**历史**同键重复行数（同键多行且内容一致时只留 id 最小的那条）。
   * 大于 0 说明库里本来就有重复行，值得看一眼
   */
  convergedCount: number
}

/**
 * 批量新增授权行。
 *
 * 笛卡尔展开在**前端**做（见 `views/system/role/grant/batchGrant.ts` 的 expandGrantBatch），
 * 后端只收一个扁平的 `List<GrantSaveReqVO>` —— 这样「单条新增」就是 size=1 的批量，
 * 两个入口共用同一份校验与同一条 upsert 路径。
 *
 * ⚠️ body 是 `{ items }` 包装而不是裸数组：Spring 对 `@RequestBody @Valid List<T>`
 * 不会级联校验元素，包一层 VO 才能让每一项都吃到 GrantSaveReqVO 上的全套注解
 *
 * @param items 上限 500 条，与后端 `@Size(max = 500)` 同步
 */
export const createGrantList = async (items: GrantSaveReqVO[]): Promise<GrantBatchSaveRespVO> => {
  return await request.post({ url: '/system/grant/create-list', data: { items } })
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

/**
 * 批量删除授权行。全有或全无：只要有一个 id 在库里不存在（另一个管理员刚删掉、
 * 或另一个标签页操作过），整批都不删 —— 静默部分成功会让操作者以为整批都删了。
 *
 * ⚠️ ids 必须逗号拼接：axios 的 paramsSerializer 用的是 qs allowDots，
 * `ids[]=` 绑不上后端的 `@RequestParam List<Long>`
 */
export const deleteGrantList = async (ids: number[]): Promise<boolean> => {
  return await request.delete({ url: '/system/grant/delete-list', params: { ids: ids.join(',') } })
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

/** 槽位候选项，来自后端 PermissionSlotEnum 全集 */
export interface SlotOptionVO {
  slot: string
  description: string
  /**
   * 该槽位的候选列名，按优先级从高到低
   *
   * ⚠️ 这是自动推断「猜」的时候用的名单，不是约定 —— 展示给人当起点，猜错了照样恒假
   */
  candidates?: string[]
  /** 该槽位在本资源上是否已配过映射（重复配会撞唯一索引 uk_resource_slot） */
  mapped?: boolean
}

/** 物理表候选项（「先选表」那一级） */
export interface SlotTableOptionVO {
  tableName: string
  /** 表注释，可能为空 */
  tableComment?: string
}

/** 物理列候选项（「再选字段」那一级） */
export interface SlotColumnOptionVO {
  columnName: string
  /** 列注释，可能为空 */
  columnComment?: string
}

export interface SlotMappingOptionsVO {
  slots: SlotOptionVO[]
  /**
   * 当前库里的物理表
   *
   * 🔴 只有表名，没有列：这个库两百多张表、三千多列，一次摊开是几十万字节，
   * 而一次只配一行。选了表再调 getSlotMappingTableColumns 取列
   * （不写精确数字：它随建模变动漂移，而「几百 KB vs 一行」这个量级差不会）
   */
  tables: SlotTableOptionVO[]
}

/** 查询槽位映射编辑器的候选项（槽位词表 + 物理表名） */
export const getSlotMappingOptions = async (resourceId: number): Promise<SlotMappingOptionsVO> => {
  return await request.get({ url: '/system/slot-mapping/options', params: { resourceId } })
}

/**
 * 查询某张物理表的列
 *
 * ⚠️ 表不存在时返回空数组而不是报错 —— 此时下拉里没东西可挑，只剩手输。
 * 两级下拉都必须 allow-create，它们只是提速、不是白名单：
 * 做成白名单的后果是「查不出来的列永远配不上槽位」，而那是唯一能让规则生效的办法
 */
export const getSlotMappingTableColumns = async (
  tableName: string
): Promise<SlotColumnOptionVO[]> => {
  return await request.get({ url: '/system/slot-mapping/table-columns', params: { tableName } })
}

/** 查询某资源的全部槽位映射 */
export const getSlotMappingList = async (resourceId: number): Promise<SlotMappingVO[]> => {
  return await request.get({ url: '/system/slot-mapping/list-by-resource', params: { resourceId } })
}

/**
 * 查询全部槽位映射（批量授权前核对规则覆盖度用）
 *
 * 后端是 @TenantIgnore 全局表，量级两百来行，一次拉全量比按资源逐个查简单 ——
 * 结果与「当前选了哪个规则」无关，于是懒加载、请求序号、AbortController 那一整套都不需要
 */
export const getSlotMappingListAll = async (): Promise<SlotMappingVO[]> => {
  return await request.get({ url: '/system/slot-mapping/list' })
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

/** 批量删除资源。全有或全无：其中只要有菜单派生的、被授权引用的、或有子资源没一起勾选的，整批都不删 */
export const deleteResourceList = async (ids: number[]): Promise<boolean> => {
  return await request.delete({ url: '/system/resource/delete-list', params: { ids: ids.join(',') } })
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
