/**
 * 权限资源枚举的中文展示口径（需求 3）。
 *
 * 走前端常量模块而不是系统字典：这些 code 与后端 ResourceTypeEnum 一一对应、不会由管理员
 * 自助增改，与 infra/formDesign 的 FORM_TYPE_OPTIONS 是同一惯例；引字典反而要多一条 SQL 迁移。
 * 资源页、资源详情面板、权限诊断页、角色资源授权页共用这一份，避免多处各写一遍再漂移。
 */

/** 资源类型下拉项。顺序与后端 ResourceTypeEnum 的声明顺序一致 */
export const RESOURCE_TYPE_OPTIONS = [
  { label: '菜单', value: 'MENU' },
  { label: '操作', value: 'ACTION' },
  { label: '流程', value: 'PROCESS' },
  { label: '分类', value: 'CATEGORY' },
  { label: '数据集', value: 'DATASET' },
  { label: '列', value: 'COLUMN' },
  { label: '字段', value: 'FIELD' }
]

/**
 * 认不出的 code 原样显示而不是 '-'：后端新增类型而前端漏配时，界面上看得见原值，
 * 比静默变一条横线好排查
 */
export const formatResourceType = (type: string | undefined) =>
  RESOURCE_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type

/**
 * 类型 tag 配色。前 5 个映射是页面原有的，不动；补上原来缺失、落到 EP 默认蓝的
 * PROCESS 与 CATEGORY，补的规则：
 *   · 分组层 = info —— CATEGORY 与 MENU 同类（ResourceTypeEnum 对 CATEGORY 的注释
 *     说它是 PROCESS 的父资源）
 *   · 可授权的行为 = primary —— PROCESS 与 ACTION 同类
 */
export const resourceTypeTagType = (type: string) =>
  ({
    ACTION: 'primary',
    DATASET: 'warning',
    MENU: 'info',
    COLUMN: 'success',
    FIELD: 'success',
    PROCESS: 'primary',
    CATEGORY: 'info'
  })[type] ?? ''

export const DEFAULT_EFFECT_OPTIONS = [
  { label: '允许', value: 'ALLOW' },
  { label: '拒绝', value: 'DENY' }
]

export const formatDefaultEffect = (effect: string | undefined) =>
  DEFAULT_EFFECT_OPTIONS.find((item) => item.value === effect)?.label ?? effect

/**
 * 默认效果的 tag 配色：DENY 一律 info（灰）。
 *
 * ⚠️ 下一个人很容易「顺手统一成红」，改之前先读这段：MENU/ACTION/PROCESS/CATEGORY 这 4 类的
 * 出厂默认就是 DENY（见 ResourceTypeEnum#defaultEffect），它是常态不是异常；列表页一屏几十行
 * 几乎全是 DENY，全染红等于把红色用废（报警疲劳）。
 * 授权列表里 grant 行的 effect=DENY 继续用红 —— 那是有人显式配的一条禁止。
 * 统一成灰之后两种颜色反而携带信息：灰 = 出厂默认拒绝，红 = 有人显式拒绝。
 */
export const defaultEffectTagType = (effect: string | undefined) =>
  effect === 'ALLOW' ? 'success' : 'info'

/**
 * 授权主体类型的中文。措辞与 ResourceDetailPanel 新增授权表单的下拉项逐字一致，
 * 两处漂移的话会出现「表单里选的是『所有登录用户』、列表里显示另一个词」
 */
export const SUBJECT_TYPE_OPTIONS = [
  { label: '角色', value: 'ROLE' },
  { label: '用户', value: 'USER' },
  { label: '部门', value: 'DEPT' },
  { label: '用户组', value: 'GROUP' },
  { label: '所有登录用户', value: 'ALL' },
  { label: '系统身份', value: 'SYSTEM' }
]

export const formatSubjectType = (type: string | undefined) =>
  SUBJECT_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type

/**
 * 授权动作的中文，按后端 GrantActionEnum 全集配（13 个）。
 *
 * 这是全站唯一一份动作词表：角色资源授权页的列表动作列、搜索下拉、编辑表单下拉都从这里取，
 * 不再各自维护私有副本 —— 三份列表曾经逐字相同，但「相同」是靠人盯的，改一处忘两处就漂移。
 *
 * `*` 的 label 刻意带上星号：它是通配符而不是一个具体动作，
 * 只写「全部动作」会和下面的 VIEW_ALL「查看全部」读起来分不清谁是谁。
 * REFERENCE 用「被引用查询」，逐字取自 GrantActionEnum 的 javadoc。
 */
export const GRANT_ACTION_OPTIONS = [
  { label: '* 全部动作', value: '*' },
  { label: '查看', value: 'VIEW' },
  { label: '新增', value: 'CREATE' },
  { label: '修改', value: 'UPDATE' },
  { label: '删除', value: 'DELETE' },
  { label: '导出', value: 'EXPORT' },
  { label: '导入', value: 'IMPORT' },
  { label: '打印', value: 'PRINT' },
  { label: '发起', value: 'START' },
  { label: '设计', value: 'DESIGN' },
  { label: '管理', value: 'MANAGE' },
  { label: '查看全部', value: 'VIEW_ALL' },
  { label: '被引用查询', value: 'REFERENCE' }
]

/**
 * 认不出的 code 原样显示（与 formatResourceType 同一口径），不能改成 '-'：
 * sys_grant.action 里存着枚举外的历史值（实测有 EXEC），兜底掉了就渲染成空白 tag，
 * 界面上既看不出这一行是什么动作，也看不出它是脏数据
 */
export const formatGrantAction = (action: string | undefined) =>
  GRANT_ACTION_OPTIONS.find((item) => item.value === action)?.label ?? action
