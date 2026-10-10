/**
 * 权限资源枚举的中文展示口径（需求 3）。
 *
 * 走前端常量模块而不是系统字典：这些 code 与后端 ResourceTypeEnum 一一对应、不会由管理员
 * 自助增改，与 infra/formDesign 的 FORM_TYPE_OPTIONS 是同一惯例；引字典反而要多一条 SQL 迁移。
 * 资源页、资源详情面板、权限诊断页共用这一份，避免三处各写一遍再漂移。
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
