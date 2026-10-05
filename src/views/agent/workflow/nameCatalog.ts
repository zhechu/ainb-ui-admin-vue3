/**
 * 名称目录（重构 S1 / L1）—— 「机器键 → 中文名」的唯一前端来源
 *
 * 🔴 诞生背景：DSL 里存的是机器键（工具存 `datamodel_create`、控件存 `datePicker`、
 * 子流程存 `wf_asset_check`），而画布/卡片/执行历史此前把这些键**原样打印给用户**。
 * 业务人员看到「调用工具「datamodel_create」」等于没看到 —— 这不是翻译问题，
 * 是「配置生效了但用户读不懂」，属于本模块的头号缺陷家族。
 *
 * 🔴 与 editorModel.ts / layout.ts / nodeSummary.ts 同款纪律：**纯查询、不抛异常、查不到一律回落原键**。
 * 回落原键是刻意的：显示 `datamodel_create` 至少能让用户去搜、去问；显示空白等于把信息删了。
 *
 * 🔴 后端不缓存（见 `AgentNameCatalogServiceImpl` 类注释：租户级 60s 缓存会重造「配置保存成功但不生效且无提示」），
 * 前端这里的缓存是**页面级**的：一次加载内所有消费方共用同一份、只发一次请求。
 * 跨页面切换会重新 `ensureLoaded()`（已加载则直接命中，不发请求）；
 * 用户在线维护了工具后应调 {@link refresh} 强制重取。
 */

import { ref } from 'vue'
import { AgentWorkflowApi, type NameCatalogVO } from '@/api/agent/workflow'
import { nodeTypeMeta } from './nodeSummary'

/** 目录本体；未加载成功时为 null，所有查询据此回落原键 */
const catalog = ref<NameCatalogVO | null>(null)
const toolMap = ref<Map<string, string>>(new Map())
const widgetMap = ref<Map<string, string>>(new Map())
const operatorMap = ref<Map<string, string>>(new Map())
const workflowMap = ref<Map<string, string>>(new Map())

const loading = ref(false)
const loaded = ref(false)
/** 加载失败的人话原因；🔴 这是 G7「目录加载失败要可见」的载体，消费方据此提示，不许静默吞 */
const error = ref('')

let inflight: Promise<void> | null = null

const index = (data: NameCatalogVO) => {
  toolMap.value = new Map(data.tools.map((t) => [t.name, t.displayName || t.name]))
  widgetMap.value = new Map(Object.entries(data.widgetLabels || {}))
  operatorMap.value = new Map(data.operators.map((o) => [o.operator, o.label || o.operator]))
  workflowMap.value = new Map(data.workflows.map((w) => [w.code, w.name || w.code]))
  catalog.value = data
}

/**
 * 确保目录已加载。**永不 reject**：失败只写 {@link error} 并保持 `loaded=false`，
 * 于是下一次调用会重试（一次网络抖动不该把整个会话的中文名永久锁死在机器键上）。
 *
 * 并发去重靠模块级 `inflight`：画布、属性面板、卡片可能同帧各调一次，只应发一个请求。
 */
export const ensureLoaded = async (): Promise<void> => {
  if (loaded.value) return
  if (inflight) return inflight
  loading.value = true
  inflight = (async () => {
    try {
      index(await AgentWorkflowApi.getNameCatalog())
      loaded.value = true
      error.value = ''
    } catch (e: any) {
      // 🔴 不 rethrow：调用方都在渲染路径上，抛出去会变成控制台一行红字 + 界面依旧显示机器键，
      // 用户两头都看不到原因。写进 error 让消费方显式提示（G7）。
      error.value = e?.message || '名称目录加载失败，界面将显示工具/控件的原始标识'
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight
}

/** 强制重取（在线维护过工具、或加载失败后用户点重试时用） */
export const refresh = async (): Promise<void> => {
  loaded.value = false
  inflight = null
  await ensureLoaded()
}

const pick = (map: Map<string, string>, key?: string | null): string => {
  if (!key) return ''
  return map.get(key) || key
}

/**
 * 名称解析器：交给 {@link summarizeNode} 等纯函数用的注入点。
 *
 * 🔴 刻意导出**一个固定对象**而不是每次新建：nodeSummary 的纯函数可能被塞进 `computed`，
 * 若解析器身份每次都变，依赖收集会把整棵树反复标脏。
 * 🔴 nodeSummary.ts 保持 Vue-free（它能被 vitest 直接跑），所以解析器由这边注入、那边不 import 本文件。
 */
export interface NameResolver {
  toolLabel: (key?: string | null) => string
  nodeTypeLabel: (type?: string | null) => string
  widgetLabel: (type?: string | null) => string
  operatorLabel: (op?: string | null) => string
  workflowLabel: (code?: string | null) => string
}

export const nameResolver: NameResolver = {
  toolLabel: (key) => pick(toolMap.value, key),
  /** 节点类型不走后端目录：`NODE_TYPE_META` 已是前端权威副本（逐字对齐后端），再拉一份必然漂移 */
  nodeTypeLabel: (type) => nodeTypeMeta(type).label,
  widgetLabel: (type) => pick(widgetMap.value, type),
  operatorLabel: (op) => pick(operatorMap.value, op),
  workflowLabel: (code) => pick(workflowMap.value, code)
}

/** 工具目录明细（下拉分组、管理页标记用）；未加载时为空数组 */
export const toolItems = () => catalog.value?.tools ?? []

/**
 * 已发布子流程明细（`sub_workflow` 节点的下拉）；未加载时为空数组。
 *
 * 🔴 后端已按 code 去重（同 code 只留主版本/最新版）。旧实现用
 * `getDefPage({status:'PUBLISHED', pageSize:100})`，那是**按版本行**分页的，
 * 于是同一条流程发布过 3 个版本就在下拉里出现 3 行、value 还都是同一个 code。
 */
export const workflowItems = () => catalog.value?.workflows ?? []

/**
 * 「中文名（机器键）」—— 下拉的 `:label` 一律用它。
 *
 * 🔴 为什么两个都塞进 label 而不是只显示中文：`el-select` 的 `filterable` **按 label 过滤**，
 * 只显示中文就等于「运维知道工具键却搜不到」。两个都在，中文用户和排障的人各取所需。
 */
export const keyedLabel = (name: string, displayName?: string | null): string =>
  displayName && displayName !== name ? `${displayName}（${name}）` : name

/** `el-option-group` 直接吃的形状 */
export interface ToolOptionGroup {
  label: string
  options: {
    label: string
    value: string
    desc?: string
    requireConfirm?: boolean
    risk?: string
    riskDescription?: string
    /** 🔴 画点/写 title 用这三个，不用上面那组生效值，理由见 {@link gateRiskOf} */
    declaredRisk?: string
    declaredRiskDescription?: string
    declaredRequireConfirm?: boolean
    riskOverridden?: boolean
  }[]
}

/**
 * 风险等级 → Element 语义色。**这是前端唯一一份**，别处不要再抄。
 *
 * 🔴 抄过的下场已经在库里出现过：`config/index.vue` 与 `tooldef/index.vue` 曾各有一份同构映射
 * （重构 S1 已把两处都改成 import 本文件）。后端 `RiskLevel` 增一个等级时，漏改的那一份不会报错，
 * 只会让那个等级**静默显示成灰色（info）**——看上去像「只读」，是最坏的一种错法。
 * 放在 L1 是因为本文件的职责就是「机器键 → 人能读的呈现」，风险色属于同一件事。
 *
 * ⚠️ 仍未收敛的是「风险等级 → **中文**」：`tooldef/index.vue` 的 `RISK_OPTIONS`/`riskLabel` 还有一份，
 * 与后端 `RiskLevel` 的描述、以及目录接口的 `riskDescription` 三者同义。收它需要后端出一个字典出口，
 * 不是前端能单方面解决的（方案 §3-L1 已登记）。
 */
const RISK_TAG_TYPE: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
  READ_ONLY: 'success',
  LOW: 'info',
  MEDIUM: 'warning',
  HIGH: 'danger',
  IRREVERSIBLE: 'danger'
}

export const riskTagType = (risk?: string | null) => (risk ? RISK_TAG_TYPE[risk] ?? 'info' : 'info')

/** 风险等级 → CSS 颜色变量，给下拉里那个小色点用（`el-tag` 塞不进 7px 的圆点） */
const RISK_DOT_COLOR: Record<string, string> = {
  LOW: 'var(--el-color-info)',
  MEDIUM: 'var(--el-color-warning)',
  HIGH: 'var(--el-color-danger)',
  IRREVERSIBLE: 'var(--el-color-danger)'
}

/**
 * 写操作工具的风险色点颜色；只读工具返回 `''`（= 不画点）。
 *
 * 🔴 只读不画点是刻意的：30 个工具里大半是只读，全画上一排绿点等于没画，
 * 反而把「这一条会改数据、且不可逆」这个真正要跳出来的信息淹掉。
 * 🔴 未知等级也返回 `''` 而不是兜一个灰色——见 {@link RISK_TAG_TYPE} 注释里那种静默错法。
 * 这里宁可少画一个点，也不要画一个把 IRREVERSIBLE 说成「info」的点。
 */
export const riskDotColor = (risk?: string | null): string => (risk ? RISK_DOT_COLOR[risk] ?? '' : '')

/**
 * 画风险色点该按哪个等级：**一律【声明】值**，缺失才回落生效值。
 *
 * 🔴 这不是风格问题。运行期各道闸（只读校验 V3/V11、发布判定、agent_loop 只读限制、沙箱 mock、
 * 变更清单）读的都是 `@AgentTool(risk=…)` 的声明值，而「降险」这个在线维护动作只改生效值。
 * 按生效值画点的下场是：管理员把某个 IRREVERSIBLE 工具降成只读之后，设计器下拉里那颗红点
 * **直接消失**（只读不画点），用户以为挑了个安全工具编进 agent_loop，点发布才被 V3 撞回来。
 * 色点是本页唯一的危险信号，它必须说的是「闸门会怎么判」，不是「维护页上现在写着什么」。
 *
 * 🔴 回落生效值只为兼容未升级的后端（响应里没有 declared* 那种形状）：那时按老口径显示，
 * 总比一颗点都不画好。
 */
export const gateRiskOf = (t: {
  declaredRisk?: string | null
  risk?: string | null
}): string | null | undefined => t.declaredRisk ?? t.risk

/** 无分组的工具归到这一组（后端 groupName 空串即「不分组」） */
const UNGROUPED = '未分组'

/**
 * 工具下拉选项，按 groupName 分组。
 *
 * 🔴 组间顺序直接沿用后端返回顺序（`AgentNameCatalogServiceImpl` 已按中文拼音排过），
 * 这里只做「切段」不再排序 —— 两处各排一次必然漂移，且前端排序对中文只能按码点（无意义）。
 */
export const groupedToolOptions = (): ToolOptionGroup[] => {
  const groups: ToolOptionGroup[] = []
  let current: ToolOptionGroup | null = null
  for (const t of toolItems()) {
    const g = t.groupName || UNGROUPED
    if (!current || current.label !== g) {
      current = { label: g, options: [] }
      groups.push(current)
    }
    current.options.push({
      label: keyedLabel(t.name, t.displayName),
      value: t.name,
      desc: t.description,
      requireConfirm: t.requireConfirm,
      risk: t.risk,
      riskDescription: t.riskDescription,
      declaredRisk: t.declaredRisk,
      declaredRiskDescription: t.declaredRiskDescription,
      declaredRequireConfirm: t.declaredRequireConfirm,
      riskOverridden: t.riskOverridden
    })
  }
  return groups
}

export const nameCatalogLoading = loading
export const nameCatalogLoaded = loaded
export const nameCatalogError = error

/**
 * 组件侧入口。**返回的是模块级同一份状态**（不是每次新建），所以画布、属性面板、卡片各自调用也只发一个请求。
 *
 * 🔴 这里刻意不做 `onMounted` 自动加载：三个消费方挂载时机不同，且只读画布可能在弹窗里反复挂载；
 * 由调用方在自己的 `onMounted` / `loadCatalogs` 里显式 `await ensureLoaded()`，失败路径才有一个确定的归属点（G7）。
 */
export const useNameCatalog = () => ({
  resolver: nameResolver,
  toolItems,
  workflowItems,
  groupedToolOptions,
  keyedLabel,
  loading,
  loaded,
  error,
  ensureLoaded,
  refresh
})
