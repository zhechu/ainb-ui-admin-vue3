import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contractOf } from './nodeIoContract'
import { buildStarterDsl, type WorkflowTriggerMeta, type WorkflowTriggerType } from './starterDsl'
import { TRIGGER_CASES, TRIGGER_CASE_ORDER } from './triggerCases'

/**
 * 后端发布闸门（`WorkflowDslValidator` 的 V 系列）的**夹具生成器**（AI助手 流程编排优化 / S10-A4②）
 *
 * <h3>为什么 DSL 在这里拼、不在 Python 里拼</h3>
 * 方案 §A4-② 的原话是「必须走前端自己的 {@code buildStarterDsl} 组装，不要在 Python 里另拼一份 DSL
 * —— 那是节点目录的第二份副本」。本文件就是这条要求的落点：所有送进真 {@code /validate} 的 DSL，
 * 都由 {@code starterDsl.buildStarterDsl('case', …)} 产出五个经典案例、再对其做**最小编译期可见的突变**得到。
 * 于是「节点该往哪个 config 键填什么」只有一份来源（{@code nodeIoContract} + {@code triggerCases}），
 * Python 侧只负责发请求与断言，不认识任何节点目录。
 *
 * <h3>🔴 为什么不是 skipped 的单测</h3>
 * 下面每条 `it` 都真跑，断的是**夹具自身的结构不变量**（每个 config 键都是该节点类型声明过的端口、
 * 拒绝侧确实突变了、id 不重复……）。它们不需要后端，故 `pnpm test:unit` 就能守；
 * 需要后端的那一半（把 DSL 打到真 `/validate` 上双向断言）由
 * {@code ruoyi-vue-pro/script/verify-workflow-orchestration/verify_dsl_gate.py} 驱动：
 * 它设 {@code DSL_FIXTURES_OUT} 跑本文件拿到 JSON，再逐条发请求。
 *
 * <h3>🔴 为什么每条规则都要有「该放的放了」那一侧</h3>
 * fail-close 之下最危险的实现错误是**多拦**而不是漏拦。把 {@code hitl.confirm} 一起禁掉、
 * 把 {@code wait(duration)} 一起禁掉、把 {@code authType=hmac} 也当成没鉴权，
 * 都能让「拼错工具名被拒」那条断言继续通过 —— 而后端单测全绿。
 * 所以本文件里 `side: 'accept'` 的夹具与 `side: 'reject'` 的一样多，且成对出现：
 *   · V13 拒「定时 + 人工确认」，同时放「**聊天** + 人工确认」⟹ 证明 confirm 不是被全局禁掉；
 *   · V11 在定时下不把 confirm 当闸口（照样拒），在聊天下把它当闸口（放行）⟹ 证明 usableGates 认触发方式；
 *   · V14 拒「等外部事件却没写谁来发」，同时放 duration 档、也放「写了唤醒方」那一档（只降到黄标）。
 *
 * <h3>⚠️ 关于 V9 与 V17</h3>
 * 后端 V 系列**有些号不是一条生效规则**：V9 从未实现（只在 {@code WorkflowDslValidator} 的一段
 * Javadoc 里被提到），V17 结构上不可能触发（{@code UntrustedInputTracer} 只追顶层字符串入参）。
 * 🔴 号段到哪一号为止、其中几条真生效，权威只有 {@code WorkflowDslValidator} 的类 javadoc **一份**；
 * 这里刻意不抄数字 —— 抄一份就会在下一条规则落地时变成假话，而本文件恰恰是钉「号数 ≠ 生效条数」
 * 这件事本身的那道机制保护（迭代七 §3.5 附带项）。
 * 故本文件不产这两条的夹具，也不该有人因为「凑不齐那个数」而硬造 —— 硬造出来的夹具会稳定地绿，
 * 绿的原因是那条规则根本不存在。
 */

// ==================== 类型 ====================

interface DslNode {
  id: string
  type: string
  name?: string
  config?: Record<string, any>
}

interface DslEdge {
  from: string
  to?: string
  type?: string
  cases?: Record<string, string>
  default?: string
}

interface Dsl {
  dslVersion: string
  id: string
  name: string
  description: string
  trigger?: { type: string; config: Record<string, any> }
  variables: Record<string, any>[]
  nodes: DslNode[]
  edges: DslEdge[]
  settings: Record<string, any>
}

/** 夹具对某个工具键的前置要求；Python 侧先探 {@code /agent/tool-def/registered-list} 再决定「量没量到」 */
interface ToolNeed {
  key: string
  /** 期望的**声明**风险（不是生效风险）：V11/V3/V16 读的都是 declaredRisk，租户覆盖改不动判据 */
  declaredRisk?: string
}

/** 一条夹具 = 一份 DSL + 打到真 /validate 之后的双向期望 */
export interface GateFixture {
  /** 稳定标识，Python 报告里按它逐行出结论 */
  id: string
  /** 'CLASSIC' | 'V1' | … | 'STRUCT' */
  rule: string
  /** accept=该放；reject=该拒；warn=该放但要有黄标 */
  side: 'accept' | 'reject' | 'warn'
  /** 这条夹具证明什么（中文，直接进报告） */
  title: string
  /** 从哪个经典案例突变而来（'-' = 直接就是案例本身） */
  base: string
  /** null ⟺ needs 里有参数当前环境给不出 ⟹ Python 必须报「未量到」而不是「通过」 */
  dsl: string | null
  /** 缺了就量不到的**活体参数**名（见 LIVE_PARAMS） */
  needs: LiveParam[]
  /**
   * 这条夹具的 DSL 里**实际用到**的工具键（含 agent_loop.tools[]），由 DSL 反推、不手写
   *
   * 🔴 反推而不是手填：手填的那份清单会漏（webhook 案例里一个 tool 节点都没有，却曾被填上 form_list），
   *    漏了的后果是「这个租户把某工具停用了，夹具照发，被 V2 拒，报告读起来像 V11 坏了」。
   *    Python 侧拿这份清单去比对 /agent/tool-def/registered-list：键不存在、被停用、
   *    或 declaredRiskLevel 与 {@link DECLARED_RISK} 的期望不符 ⟹ 判「未量到」（退出码 2），不判「有缺陷」。
   */
  needsTools: ToolNeed[]
  /**
   * 非空 ⟹ Python 发 `/validate` 时必须带上 `id` 这个字段
   *
   * 🔴 只有 V5 需要它：降档判据 executedCount 是按 id 反查的，不带 id 就恒为 0，
   *    那条规则在 `/validate` 上永远不可能触发 —— 夹具会稳定地绿，绿的原因是规则根本没被问到。
   */
  validateId: string | null
  expectPassed: boolean
  /** errors 里必须**含有**的逐字片段（取自后端消息格式串的首句，不是自己编的） */
  expectErrorsContain: string[]
  /** errors 里必须**不含**的片段 —— 「该拒的拒了」之外还要证明「没顺手多拒别的」 */
  expectErrorsNotContain: string[]
  expectWarningsContain: string[]
  expectWarningsNotContain: string[]
  /** true ⟹ 额外断言 warnings 为空（只有五个经典案例敢这么断） */
  expectClean: boolean
}

/**
 * 需要 Python 现场探出来再注进来的活体值
 *
 * 🔴 这些值**刻意不写死**：写死就是把「今天这个租户里恰好有一张叫 biz_x 的表」当成永恒事实。
 *    给不出时对应夹具的 dsl 为 null，Python 报「未量到」（退出码 2），绝不因为跑不了就算通过。
 */
export const LIVE_PARAMS = [
  /** 一条**已发布**的流程编码，供 V10 的「合法子流程」那一侧用 */
  'subWorkflowCode',
  /** 一个**已部署**的 BPM 流程模型 key，供 V7 的放行侧用 */
  'bpmProcessDefKey',
  /** 库里**真实存在**的物理表名，供 V4/V5 的干跑拒绝侧用 */
  'existingTable',
  /** 一个**确定不在**可用聊天模型清单里的数字 id，供 V8 的黄标侧用 */
  'unusedModelId',
  /** 一个**已停用**的内置工具键，供 V2 用；没有就不量（不能靠改租户数据造一个） */
  'disabledToolKey',
  /**
   * 一条**已真跑过至少一次**的流程定义 id，供 V5 用
   *
   * 🔴 V5 是「降档」规则：`foldDryRunRejections` 只在 {@code executedCount > 0 且 conflict != null} 时
   *    把 REJECTED 降成 warning。而 executedCount 是按请求里那个可选的 {@code id} 反查出来的 ——
   *    不传 id 就恒为 0，V5 在 `/validate` 上**永远不可能触发**。
   *    所以这条夹具必须同时带 `validateIdFrom`，让 Python 把 id 一起发过去。
   *    环境里没有跑过的流程时它落「未量到」，不是「通过」。
   */
  'executedWorkflowId'
] as const

type LiveParam = (typeof LIVE_PARAMS)[number]

// ==================== 组装五个经典案例 ====================

/**
 * 逐字复刻 {@code TriggerCaseView.vue} 里那句 {@code buildStarterDsl('case', …)} 的入参
 *
 * 🔴 复刻的是**入参**，不是产物：code 取 {@code demo_<triggerType>}、name 取案例标题、
 *    description 取场景说明、trigger 取 {@code {type, ...triggerDefaults}}。
 *    这里若自己另写一套 code/name，量到的就不是用户点「用这个案例」时真正会落库的那份 DSL。
 */
const classicMetaOf = (type: WorkflowTriggerType) => {
  const c = TRIGGER_CASES[type]
  return {
    code: `demo_${type}`,
    name: c.title,
    description: c.scenario,
    trigger: { type, ...c.triggerDefaults } as WorkflowTriggerMeta
  }
}

/** 五种触发方式 → 经典案例 DSL（原文）。这是全部夹具的**唯一**起点 */
const classicDslOf = (type: WorkflowTriggerType): string => buildStarterDsl('case', classicMetaOf(type))

const CLASSIC: Record<WorkflowTriggerType, string> = TRIGGER_CASE_ORDER.reduce(
  (acc, t) => ({ ...acc, [t]: classicDslOf(t) }),
  {} as Record<WorkflowTriggerType, string>
)

const parse = (dsl: string): Dsl => JSON.parse(dsl) as Dsl
const stringify = (dsl: Dsl): string => JSON.stringify(dsl, null, 2)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** 在 from→to 这条边上插一个节点，变成 from→node→to。找不到这条边就抛 —— 绝不静默跳过 */
const insertBetween = (dsl: Dsl, from: string, to: string, node: DslNode): Dsl => {
  const next = clone(dsl)
  const i = next.edges.findIndex((e) => e.from === from && e.to === to)
  expect(i, `夹具构造失败：${from}→${to} 这条边不存在`).toBeGreaterThanOrEqual(0)
  next.nodes.push(node)
  next.edges.splice(i, 1, { from, to: node.id }, { from: node.id, to })
  return next
}

/** 追加一个从 START 走不到的节点（V18 的孤儿）。刻意不连任何边 */
const addOrphan = (dsl: Dsl, node: DslNode): Dsl => {
  const next = clone(dsl)
  next.nodes.push(node)
  return next
}

const declareVar = (dsl: Dsl, key: string, type: string): Dsl => {
  const next = clone(dsl)
  if (!next.variables.some((v) => v.key === key)) next.variables.push({ key, type, merge: 'replace' })
  return next
}

/** 改某个节点 config 里的一格；节点不存在就抛 */
const setNodeConfig = (dsl: Dsl, id: string, patch: Record<string, any>): Dsl => {
  const next = clone(dsl)
  const node = next.nodes.find((n) => n.id === id)
  expect(node, `夹具构造失败：节点 ${id} 不存在`).toBeTruthy()
  node!.config = { ...(node!.config ?? {}), ...patch }
  return next
}

const setTrigger = (dsl: Dsl, patch: Record<string, any>): Dsl => {
  const next = clone(dsl)
  expect(next.trigger, '夹具构造失败：这份 DSL 没有 trigger 块').toBeTruthy()
  next.trigger!.config = { ...next.trigger!.config, ...patch }
  return next
}

// ==================== 夹具构造 ====================

/** 后端消息格式串里的**逐字片段**（首句）。改文案时这里会红 —— 那是设计如此，别把断言改松 */
const MARK = {
  V1: '请改正工具键，或先到「工具管理」登记它',
  V2: '已停用：运行期网关会直接拒绝调用',
  V3: '的 agent_loop 只允许只读工具',
  V4: '这么改跑不通 —— 这是发布前对平台做的只读预演结论',
  V5: '要用的东西平台上已经有了',
  // V6 有两半，两句文案各说一半，故各留一个标记：主表在不在（V6_TABLE）、字段映射的列在不在（V6_COLUMN）
  V6_TABLE: '但数据库里没有这张表',
  V6_COLUMN: '上不存在的列',
  V7_BLANK: '缺少 bpmProcessDefKey',
  V7_UNKNOWN: '在 BPM 里查不到对应的流程模型',
  V8_TYPE: '但运行期是按数字读这一格的、且不做变量替换',
  V8_WARN: '不在当前可用的聊天模型里',
  V10_BLANK: '的 sub_workflow 缺少 workflowId',
  V10_SELF: '引用了它自己',
  V11_IRREVERSIBLE: '声明风险是「不可逆」，但它的上游没有人工闸口',
  V11_WARN: '个写操作节点的上游没有人工闸口（最高声明风险',
  // 🔴 V13 与 V16 的文案里都有「跑起来时没有人在场」，用那句就区分不出是哪条在说话。
  //    这里取 V13 独有的那半句
  V13: '它会推一张聊天确认卡然后挂起',
  V14_ERROR: '且该节点没有声明外部唤醒方',
  V14_WARN: '靠外部系统唤醒（声明：',
  V15: 'webhook 触发器没有配鉴权',
  V16: '外部能写的数据 → 写工具入参',
  V18: '从 START 沿 edges 走不到，它永远不会执行',
  V19: '没在 variables[] 里声明：执行器会照这个名字把结果写进 state',
  // 🔴 V19 与 V23 的文案都以「没在 variables[] 里声明」开头，用那半句区分不出是谁在说话。
  //    这里各取自己独有的后半句：V19 说「执行器会照这个名字写」，V23 说「这个节点自己就是挂起点」
  V23: '而这个节点自己就是挂起点',
  STRUCT: '既不在 variables[] 里、'
} as const

const TOOL = {
  FORM_LIST: 'form_list',
  DATAMODEL_LIST: 'datamodel_list',
  DATAMODEL_CREATE: 'datamodel_create',
  DATA_INTERFACE_INVOKE: 'data_interface_invoke',
  FORM_DATA_CREATE: 'form_data_create'
} as const

/** 库里肯定没有的表名：V6 的拒绝侧用它，V4 的放行侧也用它（干跑只读，不会真建） */
const GHOST_TABLE = 'biz_e2e_ghost_table_not_exist'
/** V4 放行侧用的「全新表名」。名字里带 not_exist 是给人看的：谁也不会误以为这张表真的被建出来了 */
const FRESH_TABLE = 'biz_e2e_fresh_table_not_exist'
/** BPM 里肯定没有的流程 key */
const GHOST_BPM_KEY = 'e2e_ghost_process_not_exist'

/**
 * {@code datamodel_create} 的入参：建表定义**整个嵌在 model 下面一层**
 *
 * 🔴 这一格是照着后端读的键写的，不是照着直觉写的：
 *    {@code ChangeManifestDryRunner#probeTableCreate} 取表名走的是
 *    {@code ManifestArgs.str(ManifestArgs.map(args,"model"),"tableName")}，
 *    {@code DataModelParamResolver.CREATE_PARAMS_SCHEMA} 也把 model 标成必填对象。
 *    把 tableName 平铺在顶层的话，干跑读到的是**空表名**，于是 V4 照样报「这么改跑不通」——
 *    夹具绿了，量的却是「参数缺失」而不是它声称要量的「表名撞车」。
 *    这种「红对了、绿错了」的夹具比没有夹具更坏：它会把后来人的注意力从真问题上引开。
 * 🔴 给一份**本身合法**的定义（tableComment 中文且不与表名同、columns 至少一列、STRING 显式给 length、
 *    primaryKey 恒 false），这样拒绝侧的唯一变量才是表名。
 */
const createModelArg = (tableName: string): Record<string, any> => ({
  model: {
    tableName,
    tableComment: '闸门夹具用的表，只干跑不落库',
    modelName: '闸门夹具表',
    columns: [
      {
        columnName: 'remark',
        columnComment: '备注',
        columnType: 'STRING',
        length: 64,
        nullable: true,
        primaryKey: false
      }
    ]
  }
})

/** 一个写工具节点（拒绝侧的常客）；args 缺省为空对象，各条夹具自己填 */
const writeToolNode = (id: string, toolId: string, outputVar: string, args?: Record<string, any>): DslNode => ({
  id,
  type: 'tool',
  name: `写工具 ${toolId}`,
  config: { toolId, args: args ?? {}, outputVar }
})

/**
 * 夹具里那个人工确认闸口用的**自定义**确认键名（不是平台缺省名）
 *
 * 🔴 刻意不用缺省名：缺省名已被后端 `KeyStrategyFactoryGenerator#generate` 无条件注册，
 *    于是 V19（出站：写了未声明的键、下游又有挂起点）与 V23（入站：挂起节点自己那一次 resume
 *    要读的键未声明）**两条都会对它闭嘴**。夹具全用缺省名的话，这两条规则在 e2e 上就一格也量不到，
 *    而报告照样写着「通过」。留着自定义名，才走的是真作者最常走的那条路。
 * 🔴 代价是每条用到它的夹具都必须在 `variables[]` 里声明它 —— 漏一条，那条夹具会以 `passed=false`
 *    红在 e2e 上，红的原因跟它声称要量的规则毫无关系（正是本文件开头骂过的那种「红对了、绿错了」）。
 *    所以声明这件事收在 {@link declareConfirmVar} 一处做，并由
 *    「每个非默认输出端口名都声明过」那条离线自检兜底：漏了当场在 `pnpm test:unit` 就红，不用等后端。
 */
const CONFIRM_APPROVE_VAR = 'approved'

const confirmNode = (id: string, approveVar: string = CONFIRM_APPROVE_VAR): DslNode => ({
  id,
  type: 'hitl.confirm',
  name: '人工确认',
  config: { approveVar }
})

/** 把 {@link CONFIRM_APPROVE_VAR} 补进 `variables[]`（`declareVar` 幂等，重复调用不会多写一条） */
const declareConfirmVar = (dsl: Dsl): Dsl => declareVar(dsl, CONFIRM_APPROVE_VAR, 'boolean')

/**
 * 插一个人工确认闸口，**并同时**声明它那个自定义确认键
 *
 * 🔴 建图与声明绑成一个动作，就是为了不给「插了闸口忘了声明」留缝隙 ——
 *    这两件事分处两地时，漏掉的那一半不会在离线自检里报错，只会在 e2e 上以一条无关的红出现。
 *    少数几个夹具的闸口不是这么插的（`chatGatedWrite` / `scheduleWithWrite` 自己接管了连线），
 *    那两处各自调 {@link declareConfirmVar}，同理由那条离线自检兜底。
 */
const insertConfirmGate = (dsl: Dsl, from: string, to: string, id = 'gate_confirm'): Dsl =>
  declareConfirmVar(insertBetween(dsl, from, to, confirmNode(id)))

const waitNode = (id: string, config: Record<string, any>): DslNode => ({
  id,
  type: 'wait',
  name: '等待',
  config
})

const llmNode = (id: string, outputVar: string): DslNode => ({
  id,
  type: 'llm',
  name: '大模型',
  config: { prompt: '把上游结果用中文复述一遍：{{$.input}}', outputVar }
})

/**
 * 「聊天触发 → 人工确认闸口 → 一个写工具节点 → 大模型收尾」的一张图
 *
 * 🔴 所有**测写工具**的夹具都必须挂在这个形状上，不能挂在定时案例上。
 *    建表/改表是 IRREVERSIBLE，定时（无头）触发下 `hitl.confirm` 不是可用闸口 ⟹ V11 先报一条阻断错误 ⟹
 *    `passed` 恒为 false。于是放行侧那条「V4/V6 的文案**不该**出现」永远无法与 `passed=true` 同时成立 ——
 *    夹具稳定地红，而红的原因跟它声称要量的那条规则毫无关系。
 *    把闸口配齐之后 V11/V13 都满足，图里唯一还能报错的就只剩被测的那一条，红绿才有归因。
 * ⚠️ 闸口用 `hitl.confirm` 而不是 `hitl.bpm_approval`：后者要绑一个已部署的 BPM 流程（V7 会去查），
 *    等于给一条测 V4 的夹具凭空添一个活体前置条件。
 * ⚠️ 这张图里**不能有** `datamodel_create`/`datamodel_import` 之外的建表节点跑到 form_save_draft 上游 ——
 *    V6 见到「本流程会在 save_draft 之前建表」就整项跳过（表此刻还不存在，校验无从谈起）。
 */
const chatGatedWrite = (write: DslNode, outputVar: string): Dsl => {
  let dsl = declareVar(parse(CLASSIC.chat), outputVar, 'object')
  const gate = confirmNode('gate_confirm')
  dsl = declareConfirmVar(insertBetween(dsl, 'lookup_forms', 'answer', gate))
  return insertBetween(dsl, gate.id, 'answer', write)
}

interface Spec {
  id: string
  rule: string
  side: GateFixture['side']
  title: string
  base: WorkflowTriggerType | '-'
  dsl: string | null
  needs?: LiveParam[]
  /** 发 /validate 时要带上的 id 取自哪个活体参数（见 GateFixture.validateId） */
  validateIdFrom?: LiveParam
  expectErrorsContain?: string[]
  expectErrorsNotContain?: string[]
  expectWarningsContain?: string[]
  expectWarningsNotContain?: string[]
  expectClean?: boolean
}

const specs: Spec[] = []
const add = (s: Spec) => specs.push(s)

// ---------- CLASSIC：五个案例本身必须干净 ----------

for (const t of TRIGGER_CASE_ORDER) {
  add({
    id: `CLASSIC-${t}`,
    rule: 'CLASSIC',
    side: 'accept',
    title: `「${TRIGGER_CASES[t].title}」案例开箱即过体检（0 error 0 warning）`,
    base: '-',
    dsl: CLASSIC[t],
    expectClean: true
  })
}

// ---------- V1：工具键必须认得出 ----------

const BAD_TOOL = 'form_list_E2E_NOT_EXIST'
add({
  id: 'V1-reject-unknown-tool',
  rule: 'V1',
  side: 'reject',
  title: '拼错的工具键被拒（且报错里带着那个拼错的名字，作者能对着改）',
  base: 'chat',
  dsl: stringify(setNodeConfig(parse(CLASSIC.chat), 'lookup_forms', { toolId: BAD_TOOL })),
  expectErrorsContain: [MARK.V1, BAD_TOOL]
})
add({
  id: 'V1-accept-known-tool',
  rule: 'V1',
  side: 'accept',
  title: '同一个节点换成真实存在的只读工具键就放行 —— 证明 V1 没有把所有工具一起禁掉',
  base: 'chat',
  dsl: CLASSIC.chat,
  expectErrorsNotContain: [MARK.V1]
})

// ---------- V2：工具必须启用 ----------

add({
  id: 'V2-reject-disabled-tool',
  rule: 'V2',
  side: 'reject',
  title: '引用一个已停用的内置工具被拒（运行期网关本来也会拒，这里提前说人话）',
  base: 'chat',
  // 🔴 不能靠改租户数据造一个停用工具：那是把被测系统的状态当夹具改，跑完还得记得改回来。
  //    环境里本来就有停用的工具才量，没有就报「未量到」
  dsl: null,
  needs: ['disabledToolKey'],
  expectErrorsContain: [MARK.V2]
})
add({
  id: 'V2-accept-enabled-tool',
  rule: 'V2',
  side: 'accept',
  title: '同一个节点引用一个**启用中**的工具就放行 —— 证明 V2 判的是启用状态，不是「见到工具就查一遍然后拒」',
  base: 'chat',
  dsl: CLASSIC.chat,
  expectErrorsNotContain: [MARK.V2]
})

// ---------- V3：agent_loop 里只许只读工具 ----------

/**
 * 一个**结构完整**的 agent_loop 节点
 *
 * 🔴 `outputVar` 必须显式给：契约里它的 defaultName 是 null（「必须由用户命名」），
 *    后端照此报「agent_loop 节点(x) 缺少 outputVar」。少写这一格的后果不是「V3 少测一点」，
 *    而是放行侧那条 `passed=true` **恒不成立** —— 夹具红在一个与 V3 无关的结构错上，
 *    而看报告的人只会去查 V3。
 */
const loopNode = (tools: string[]): DslNode => ({
  id: 'loop_readonly',
  type: 'agent_loop',
  name: '循环查证',
  config: {
    goal: '把用户问题查清楚',
    prompt: '{{$.input}}',
    tools,
    maxSteps: 3,
    outputVar: 'loop_answer',
    trajectoryVar: 'loop_trace'
  }
})

/** agent_loop 的两个输出端口都写进 state，故两个变量都得声明（否则 V19 会来插一脚） */
const withLoop = (tools: string[]): Dsl => {
  let dsl = insertBetween(parse(CLASSIC.chat), 'lookup_forms', 'answer', loopNode(tools))
  dsl = declareVar(dsl, 'loop_answer', 'string')
  return declareVar(dsl, 'loop_trace', 'array')
}

add({
  id: 'V3-reject-write-tool-in-loop',
  rule: 'V3',
  side: 'reject',
  title: 'agent_loop 里放写工具被拒（循环里模型自己决定调什么，不能给它不可逆的手）',
  base: 'chat',
  dsl: stringify(withLoop([TOOL.DATAMODEL_CREATE])),
  expectErrorsContain: [MARK.V3, TOOL.DATAMODEL_CREATE]
})
add({
  id: 'V3-accept-readonly-tool-in-loop',
  rule: 'V3',
  side: 'accept',
  title: '同一位置的 agent_loop 换成只读工具就放行 —— 证明 V3 禁的是「写」，不是 agent_loop 这个节点',
  base: 'chat',
  dsl: stringify(withLoop([TOOL.FORM_LIST])),
  expectErrorsNotContain: [MARK.V3],
  expectClean: true
})

// ---------- V4/V5：发布前只读干跑 ----------

/** 建表节点（V4/V5/V11 共用同一个形状，只有表名在变） */
const createTableNode = (id: string, tableName: string): DslNode =>
  writeToolNode(id, TOOL.DATAMODEL_CREATE, 'create_result', createModelArg(tableName))

add({
  id: 'V4-reject-dry-run',
  rule: 'V4',
  side: 'reject',
  title:
    '建一张库里已经有的表 → 干跑把它判成 REJECTED，折成一条阻断错误。' +
    '（撞车这一支的结论同时落在 conflict 与 dryRun 上，而闸门只读 dryRun —— 只写 conflict 会得到' +
    '一份「0 项跑不通」却注定跑不通的清单）',
  base: 'chat',
  dsl: null,
  needs: ['existingTable'],
  expectErrorsContain: [MARK.V4]
})
add({
  id: 'V4-accept-fresh-table-name',
  rule: 'V4',
  side: 'accept',
  title:
    '同一个建表节点换一个库里**没有**的新表名，干跑就不拒 —— 证明 V4 报的是「这么改跑不通」这个具体结论，' +
    '不是「见到 datamodel_create 就拦」。⚠️ 只打到 /validate（干跑全程只读，一个写接口都不调），' +
    '本夹具从不发布、不建表',
  base: 'chat',
  dsl: stringify(chatGatedWrite(createTableNode('create_fresh', FRESH_TABLE), 'create_result')),
  expectClean: true,
  expectErrorsNotContain: [MARK.V4, MARK.V5, MARK.V6_TABLE]
})
add({
  id: 'V5-warn-conflict-but-already-executed',
  rule: 'V5',
  side: 'warn',
  title:
    '同一份「表名撞车」的 DSL，但按一个**已真跑过**的流程 id 去校验 → 降档成黄标、不拦发布' +
    '（极可能就是它自己早先的版本建的）。🔴 这条与 V4-reject 是同一份 DSL，唯一差别是请求带不带 id —— ' +
    'executedCount 是 0 还是 >0，决定了 fail-close 还是降档',
  base: 'chat',
  dsl: null,
  needs: ['existingTable', 'executedWorkflowId'],
  validateIdFrom: 'executedWorkflowId',
  expectWarningsContain: [MARK.V5],
  expectErrorsNotContain: [MARK.V4]
})

// ---------- V6：form_save_draft 绑的主表与列必须真实存在 ----------

/** V6 报「没有这张表」时那半句独有的文案（form_save_draft 专属，datamodel_* 走的是 V4 那条干跑折叠） */
const FORM_CODE = (suffix: string) => `e2e_gate_probe_${suffix}`

/**
 * 一个 form_save_draft 节点
 *
 * 🔴 V6 认的就是这个工具：{@code validateSaveDraftMainTable} 只扫 `toolId == form_save_draft` 的节点，
 *    读它 args 顶层的 `mainTable`；`validateSaveDraftColumns` 再读 `fields[].column`
 *    （缺省时用 `field` 顶，口径逐字照 {@code FormSaveDraftTool#build}）。
 *    拿 datamodel_update 去凑 V6 是**测错了规则**：那张表不存在时报的是干跑折叠出来的 V4
 *    「这么改跑不通 …… 找不到表对应的数据模型」，V6 的文案一个字都不会出现。
 * @param fields 省略 = 只测主表那半；给了 = 连列那半一起测（列那半是 V6 新增的、
 *               运行期与 FormSchemaValidator 都不查的那一半）
 */
const saveDraftNode = (id: string, mainTable: string, fields?: Record<string, any>[]): DslNode =>
  writeToolNode(id, 'form_save_draft', 'draft_result', {
    name: '闸门夹具表单',
    code: FORM_CODE(id),
    mainTable,
    ...(fields ? { fields } : {})
  })

const ghostColumn = {
  field: 'e2e_ghost',
  widget: 'input',
  title: '夹具探针字段',
  column: 'e2e_ghost_col_not_exist',
  jdbcType: 'VARCHAR'
}

add({
  id: 'V6-reject-ghost-main-table',
  rule: 'V6',
  side: 'reject',
  title: 'form_save_draft 绑一张库里没有的主表被拒（表单会「保存成功、一用就炸」）',
  base: 'chat',
  dsl: stringify(chatGatedWrite(saveDraftNode('save_ghost', GHOST_TABLE), 'draft_result')),
  expectErrorsContain: [MARK.V6_TABLE, GHOST_TABLE]
})
add({
  id: 'V6-reject-ghost-column',
  rule: 'V6',
  side: 'reject',
  title:
    '主表真实存在、但字段映射到一个表里没有的列 → 照样拒。' +
    '🔴 这半条是 V6 新增的：运行期 FormSaveDraftTool 读了同一份列结构却只拿来对齐 required，' +
    'FormSchemaValidator 从不查库，干跑那半边明写「探不了」—— 三层都不管，' +
    '于是表单发布成功后直到用户提交才撞一句 Unknown column',
  base: 'chat',
  dsl: null,
  needs: ['existingTable'],
  expectErrorsContain: [MARK.V6_COLUMN, 'e2e_ghost_col_not_exist'],
  expectErrorsNotContain: [MARK.V6_TABLE]
})
add({
  id: 'V6-accept-existing-table',
  rule: 'V6',
  side: 'accept',
  title: '同一个节点绑一张**真实存在**的表就不报「没有这张表」—— 证明 V6 真去查了库，而不是恒报',
  base: 'chat',
  dsl: null,
  needs: ['existingTable'],
  expectClean: true,
  expectErrorsNotContain: [MARK.V6_TABLE, MARK.V6_COLUMN]
})

// ---------- V7：BPM 审批必须绑一个已部署的流程 ----------

add({
  id: 'V7-reject-blank-bpm-key',
  rule: 'V7',
  side: 'reject',
  title: 'bpm_approval 没填 bpmProcessDefKey 被拒',
  base: 'schedule',
  dsl: stringify(
    insertBetween(parse(CLASSIC.schedule), 'probe', 'digest', {
      id: 'approve_gate',
      type: 'hitl.bpm_approval',
      name: 'BPM 审批',
      config: {}
    })
  ),
  expectErrorsContain: [MARK.V7_BLANK]
})
add({
  id: 'V7-reject-unknown-bpm-key',
  rule: 'V7',
  side: 'reject',
  title: 'bpm_approval 绑一个 BPM 里查不到的 key 被拒（发布出去也只是永远等不到审批）',
  base: 'schedule',
  dsl: stringify(
    insertBetween(parse(CLASSIC.schedule), 'probe', 'digest', {
      id: 'approve_gate',
      type: 'hitl.bpm_approval',
      name: 'BPM 审批',
      config: { bpmProcessDefKey: GHOST_BPM_KEY }
    })
  ),
  expectErrorsContain: [MARK.V7_UNKNOWN, GHOST_BPM_KEY]
})
add({
  id: 'V7-accept-deployed-bpm-key',
  rule: 'V7',
  side: 'accept',
  title: '同一个节点绑一个**已部署**的 BPM key 就放行 —— 证明 V7 查的是「部署没部署」，不是见到 bpm_approval 就拒',
  base: 'schedule',
  dsl: null,
  needs: ['bpmProcessDefKey'],
  expectErrorsNotContain: [MARK.V7_BLANK, MARK.V7_UNKNOWN]
})

// ---------- V8：modelId 必须是数字，且得是真有的模型 ----------

add({
  id: 'V8-reject-non-numeric-model',
  rule: 'V8',
  side: 'reject',
  title: 'llm 节点的 modelId 填成字符串被拒（运行期按数字读这一格，且不做变量替换）',
  base: 'chat',
  dsl: stringify(setNodeConfig(parse(CLASSIC.chat), 'answer', { modelId: 'not_a_number' })),
  expectErrorsContain: [MARK.V8_TYPE]
})
add({
  id: 'V8-accept-blank-model',
  rule: 'V8',
  side: 'accept',
  title: '不填 modelId（走默认模型）放行 —— 证明 V8 没有把「留空」也当成填错',
  base: 'chat',
  dsl: CLASSIC.chat,
  expectErrorsNotContain: [MARK.V8_TYPE],
  expectWarningsNotContain: [MARK.V8_WARN]
})
add({
  id: 'V8-warn-unknown-model-id',
  rule: 'V8',
  side: 'warn',
  title: 'modelId 填一个平台上没有的数字 → 只给黄标、不拦发布（模型随时可能新增，硬拦会误杀）',
  base: 'chat',
  dsl: null,
  needs: ['unusedModelId'],
  expectWarningsContain: [MARK.V8_WARN]
})

// ---------- V10：子流程必须是别的、已发布的流程 ----------

add({
  id: 'V10-reject-self-reference',
  rule: 'V10',
  side: 'reject',
  title: 'sub_workflow 引用它自己被拒（自己调自己 = 无限递归）',
  base: 'schedule',
  dsl: stringify(
    insertBetween(parse(CLASSIC.schedule), 'probe', 'digest', {
      id: 'call_self',
      type: 'sub_workflow',
      name: '调用子流程',
      config: { workflowId: 'demo_schedule' }
    })
  ),
  expectErrorsContain: [MARK.V10_SELF]
})
add({
  id: 'V10-reject-blank-workflow-id',
  rule: 'V10',
  side: 'reject',
  title: 'sub_workflow 没填 workflowId 被拒',
  base: 'schedule',
  dsl: stringify(
    insertBetween(parse(CLASSIC.schedule), 'probe', 'digest', {
      id: 'call_nothing',
      type: 'sub_workflow',
      name: '调用子流程',
      config: {}
    })
  ),
  expectErrorsContain: [MARK.V10_BLANK]
})
add({
  id: 'V10-accept-published-sub-workflow',
  rule: 'V10',
  side: 'accept',
  title: '同一个节点指向一条**已发布**的别的流程就放行',
  base: 'schedule',
  dsl: null,
  needs: ['subWorkflowCode'],
  expectErrorsNotContain: [MARK.V10_SELF, MARK.V10_BLANK]
})

// ---------- V11：不可逆动作上游必须有人工闸口，且闸口要能被唤醒 ----------

/**
 * 定时案例 + 一个建表节点（可选地在它前面再插一个闸口），返回**未序列化**的 DSL
 *
 * ⚠️ 传进来的 `gate` 是**裸节点**，本函数不认识它的语义 ⟹ 它写进 state 的键得由调用方自己声明
 *    （`hitl.confirm` 就是 {@link declareConfirmVar}）。本函数只管连线，别指望它顺带补声明。
 */
const scheduleWithWrite = (gate?: DslNode): Dsl => {
  let dsl = declareVar(parse(CLASSIC.schedule), 'create_result', 'object')
  const write = createTableNode('create_table', FRESH_TABLE)
  if (gate) {
    dsl = insertBetween(dsl, 'probe', 'digest', gate)
    dsl = insertBetween(dsl, gate.id, 'digest', write)
  } else {
    dsl = insertBetween(dsl, 'probe', 'digest', write)
  }
  return dsl
}

/**
 * 与 {@link scheduleWithWrite} **同形**的一张图，只是挂在聊天触发下
 *
 * 🔴 刻意与拒绝侧逐字同形（同样的 confirm 闸口、同样的建表节点、同样的连线次序），
 *    只换触发方式。两侧唯一的差别必须就是 V11 的那个判据输入 ——
 *    差一点别的（比如顺手把建表节点换成只读工具），放行侧就不再证明任何事了。
 */
const chatWithGatedWrite = (): Dsl =>
  chatGatedWrite(createTableNode('create_table', FRESH_TABLE), 'create_result')

add({
  id: 'V11-reject-irreversible-no-gate',
  rule: 'V11',
  side: 'reject',
  title: '定时流程里的建表工具上游没有任何闸口 → 拒（DDL 没有事务，执行了就回不去）',
  base: 'schedule',
  dsl: stringify(scheduleWithWrite()),
  expectErrorsContain: [MARK.V11_IRREVERSIBLE, TOOL.DATAMODEL_CREATE]
})
add({
  id: 'V11-reject-confirm-gate-unusable-when-headless',
  rule: 'V11',
  side: 'reject',
  title:
    '定时流程里放了 hitl.confirm 当闸口 → **照样拒**：无头执行没有聊天窗口，那张确认卡永远没人点。' +
    '同时 V13 也会报 —— 两条各说一件事（V11 说「闸口唤不醒」，V13 说「confirm 本身在无头里非法」）',
  base: 'schedule',
  dsl: stringify(declareConfirmVar(scheduleWithWrite(confirmNode('gate_confirm')))),
  expectErrorsContain: [MARK.V11_IRREVERSIBLE, MARK.V13]
})
add({
  id: 'V11-accept-confirm-gate-when-attended',
  rule: 'V11',
  side: 'accept',
  title:
    '同一张「confirm 闸口 → 建表」的图挂到**聊天**触发下就放行：有人在场时 confirm 是合法闸口。' +
    '这条是「多拦」的照妖镜 —— 把 confirm 全局禁掉、或把 usableGates 写成不认触发方式，都会在这里红',
  base: 'chat',
  dsl: stringify(chatWithGatedWrite()),
  expectErrorsNotContain: [MARK.V11_IRREVERSIBLE, MARK.V13]
})
add({
  id: 'V11-warn-high-write-no-gate',
  rule: 'V11',
  side: 'warn',
  title: '非不可逆的写工具（HIGH）没有闸口 → 只给黄标、不拦发布',
  base: 'schedule',
  dsl: stringify(
    declareVar(
      insertBetween(
        parse(CLASSIC.schedule),
        'probe',
        'digest',
        writeToolNode('invoke_iface', TOOL.DATA_INTERFACE_INVOKE, 'invoke_result', { code: 'e2e_probe' })
      ),
      'invoke_result',
      'object'
    )
  ),
  expectWarningsContain: [MARK.V11_WARN],
  expectErrorsNotContain: [MARK.V11_IRREVERSIBLE]
})

// ---------- V13：无头触发里不许出现 hitl.confirm ----------

add({
  id: 'V13-reject-confirm-under-schedule',
  rule: 'V13',
  side: 'reject',
  title: '定时流程里放 hitl.confirm 被拒（挂起后 resume_at / event_key 都是 NULL，永远醒不过来）',
  base: 'schedule',
  dsl: stringify(insertConfirmGate(parse(CLASSIC.schedule), 'probe', 'digest')),
  expectErrorsContain: [MARK.V13]
})
add({
  id: 'V13-reject-confirm-under-webhook',
  rule: 'V13',
  side: 'reject',
  title: 'webhook 流程里放 hitl.confirm 同样被拒（回调进来时也没有人在界面上等着）',
  base: 'webhook',
  dsl: stringify(insertConfirmGate(parse(CLASSIC.webhook), 'extract_amount', 'route_by_amount')),
  expectErrorsContain: [MARK.V13]
})
add({
  id: 'V13-accept-confirm-under-chat',
  rule: 'V13',
  side: 'accept',
  title: '聊天流程里放 hitl.confirm 放行 —— 证明 V13 认的是「有没有人在场」，不是「confirm 这个节点类型」',
  base: 'chat',
  dsl: stringify(insertConfirmGate(parse(CLASSIC.chat), 'lookup_forms', 'answer')),
  expectErrorsNotContain: [MARK.V13]
})
add({
  id: 'V13-accept-bpm-under-schedule',
  rule: 'V13',
  side: 'accept',
  title: '定时流程里换成 hitl.bpm_approval 就不撞 V13（走待办、有承办人，不依赖聊天窗口）',
  base: 'schedule',
  dsl: null,
  needs: ['bpmProcessDefKey'],
  expectErrorsNotContain: [MARK.V13]
})

// ---------- V14：wait(event) 必须写明谁来唤醒 ----------

add({
  id: 'V14-reject-event-wait-undeclared',
  rule: 'V14',
  side: 'reject',
  title: '定时流程里的 wait(waitType=event) 没声明外部唤醒方 → 拒',
  base: 'schedule',
  dsl: stringify(
    insertBetween(parse(CLASSIC.schedule), 'probe', 'digest', waitNode('wait_event', { waitType: 'event', eventKey: 'e2e_wakeup' }))
  ),
  expectErrorsContain: [MARK.V14_ERROR]
})
add({
  id: 'V14-reject-note-only-is-not-a-declaration',
  rule: 'V14',
  side: 'reject',
  title: '只写 externalWakeup.note、不写 owner/endpoint → 仍按「未声明」判（把问题抄一遍不算答案）',
  base: 'schedule',
  dsl: stringify(
    insertBetween(
      parse(CLASSIC.schedule),
      'probe',
      'digest',
      waitNode('wait_event', {
        waitType: 'event',
        eventKey: 'e2e_wakeup',
        externalWakeup: { note: '会有人来唤醒的' }
      })
    )
  ),
  expectErrorsContain: [MARK.V14_ERROR]
})
add({
  id: 'V14-accept-duration-wait',
  rule: 'V14',
  side: 'accept',
  title: '同一个位置改成 wait(waitType=duration) 放行 —— 证明 V14 没有一刀切禁掉所有 wait',
  base: 'schedule',
  dsl: stringify(
    insertBetween(parse(CLASSIC.schedule), 'probe', 'digest', waitNode('wait_a_bit', { waitType: 'duration', duration: 60 }))
  ),
  expectErrorsNotContain: [MARK.V14_ERROR]
})
add({
  id: 'V14-warn-declared-wakeup',
  rule: 'V14',
  side: 'warn',
  title: '写明了 owner + endpoint 的 wait(event) → 只降到黄标（声明是纯声明，平台核实不了，但也不该拒）',
  base: 'schedule',
  dsl: stringify(
    insertBetween(
      parse(CLASSIC.schedule),
      'probe',
      'digest',
      waitNode('wait_event', {
        waitType: 'event',
        eventKey: 'e2e_wakeup',
        externalWakeup: { owner: '外部对账系统', endpoint: 'POST /agent/workflow/event', note: 'e2e 约定' }
      })
    )
  ),
  expectWarningsContain: [MARK.V14_WARN],
  expectErrorsNotContain: [MARK.V14_ERROR]
})

// ---------- V15：webhook 必须配鉴权 ----------

add({
  id: 'V15-reject-auth-none',
  rule: 'V15',
  side: 'reject',
  title: 'webhook 的 authType=none 被拒（入口免登录，path 又不可依赖地保密）',
  base: 'webhook',
  dsl: stringify(setTrigger(parse(CLASSIC.webhook), { authType: 'none' })),
  expectErrorsContain: [MARK.V15]
})
add({
  id: 'V15-reject-auth-blank',
  rule: 'V15',
  side: 'reject',
  title: 'webhook 的 authType 留空同样被拒（归一化后与 none 一档）',
  base: 'webhook',
  dsl: stringify(setTrigger(parse(CLASSIC.webhook), { authType: '' })),
  expectErrorsContain: [MARK.V15]
})
add({
  id: 'V15-reject-auth-NONE-uppercase',
  rule: 'V15',
  side: 'reject',
  title: 'authType 写成大写 NONE 也被拒 —— 证明判定与提取器同口径地做了 trim + 小写归一化',
  base: 'webhook',
  dsl: stringify(setTrigger(parse(CLASSIC.webhook), { authType: 'NONE' })),
  expectErrorsContain: [MARK.V15]
})
add({
  id: 'V15-accept-hmac',
  rule: 'V15',
  side: 'accept',
  title:
    'authType=hmac 放行 —— 证明 V15 认的是「有没有鉴权」，不是「有没有 secret」。' +
    '（secret 为空由 WorkflowTriggerExtractor 在**落库前**拒，V15 刻意不抄那份判定）',
  base: 'webhook',
  dsl: CLASSIC.webhook,
  expectErrorsNotContain: [MARK.V15]
})

// ---------- V16：外部能写的数据流进写工具入参 ----------

add({
  id: 'V16-warn-untrusted-into-write-tool',
  rule: 'V16',
  side: 'warn',
  title: 'webhook 报文里的字段直接灌进写工具入参 → 黄标（「远程改数据」的形状，但不阻断）',
  base: 'webhook',
  dsl: stringify(
    declareVar(
      insertBetween(
        parse(CLASSIC.webhook),
        'extract_amount',
        'route_by_amount',
        writeToolNode('write_row', TOOL.FORM_DATA_CREATE, 'write_result', {
          code: '{{$.input.formCode}}',
          data: { amount: '{{$.amount}}' }
        })
      ),
      'write_result',
      'object'
    )
  ),
  expectWarningsContain: [MARK.V16]
})
add({
  id: 'V16-accept-attended-same-shape',
  rule: 'V16',
  side: 'accept',
  title: '同一张「外部数据 → 写工具」的图挂到**聊天**触发下不报 V16 —— 有人在场，这条黄标没有意义',
  base: 'chat',
  dsl: stringify(
    declareVar(
      insertBetween(
        parse(CLASSIC.chat),
        'lookup_forms',
        'answer',
        writeToolNode('write_row', TOOL.FORM_DATA_CREATE, 'write_result', {
          code: '{{$.input}}',
          data: { note: '{{$.forms}}' }
        })
      ),
      'write_result',
      'object'
    )
  ),
  expectWarningsNotContain: [MARK.V16]
})

// ---------- V18：从 START 走不到的节点 ----------

add({
  id: 'V18-reject-orphan-node',
  rule: 'V18',
  side: 'reject',
  title: '没有任何边连到的孤儿节点被拒（编译器照样建图，于是发布不拦、运行期一次也不调度，静默失效）',
  base: 'chat',
  // 🔴 孤儿写的 orphan_text 也要声明（放行侧那个 wired_note 早就声明了 note_text）。
  //    两侧原本差**两件事** —— 可达性、以及输出变量声不声明 —— 于是这一对夹具证的不是「V18 判可达性」，
  //    而是「这两件事的某种组合」：把 V18 关掉、改成去查未声明变量，拒绝侧照样红、放行侧照样绿。
  //    补齐之后两侧唯一的差别就只剩那条边，正是本文件对每一对夹具的要求（见 chatWithGatedWrite 那段）。
  //    ⚠️ 对后端行为是**空操作**：孤儿从 START 走不到，V19 那个「下游另有挂起点」的前提在这里不成立。
  dsl: stringify(declareVar(addOrphan(parse(CLASSIC.chat), llmNode('orphan_note', 'orphan_text')), 'orphan_text', 'string')),
  expectErrorsContain: [MARK.V18, 'orphan_note']
})
add({
  id: 'V18-accept-same-node-wired',
  rule: 'V18',
  side: 'accept',
  title: '同一个节点补一条边接进链路就放行 —— 证明 V18 判的是可达性，不是「多了一个节点」',
  base: 'chat',
  dsl: stringify(
    declareVar(insertBetween(parse(CLASSIC.chat), 'lookup_forms', 'answer', llmNode('wired_note', 'note_text')), 'note_text', 'string')
  ),
  expectErrorsNotContain: [MARK.V18]
})

// ---------- V19：写了 state 又在下游挂起，那个变量必须声明过 ----------

const v19Base = (declared: boolean): string => {
  // 🔴 闸口自己那个自定义确认键**必须**声明（`insertConfirmGate` 已经带上）：V19 与 V23 是互补的两条规则，
  //    同一个 `hitl.confirm` 节点两档都能中。不声明的话放行侧会因 V23 而 `passed=false` ——
  //    红的原因不在 V19 身上，这条夹具声称量的东西就白量了；拒绝侧则一次报两条，作者看不出哪条是哪条。
  //    V23 那两档由它自己的夹具单独量（见下面 V23 那一节）。
  let dsl = insertConfirmGate(parse(CLASSIC.chat), 'answer', 'END' as string)
  // 在 confirm 之前再插一个写 ghost 变量的 llm 节点：写完就挂起 ⟹ 恢复时 SAA 只保留注册过合并策略的键
  dsl = insertBetween(dsl, 'answer', 'gate_confirm', llmNode('note_writer', 'ghost_note'))
  if (declared) dsl = declareVar(dsl, 'ghost_note', 'string')
  return stringify(dsl)
}
add({
  id: 'V19-reject-undeclared-var-before-suspend',
  rule: 'V19',
  side: 'reject',
  title: '节点写进一个未声明的变量、下游又有挂起点 → 拒（同一次运行看不出问题，恢复的那一刻被静默丢弃）',
  base: 'chat',
  dsl: v19Base(false),
  expectErrorsContain: [MARK.V19, 'ghost_note']
})
add({
  id: 'V19-accept-same-var-declared',
  rule: 'V19',
  side: 'accept',
  title: '同一个变量在 variables[] 里补一条声明就放行 —— 证明 V19 要的是「声明」，不是「别写变量」',
  base: 'chat',
  dsl: v19Base(true),
  expectErrorsNotContain: [MARK.V19]
})

// ---------- V23：挂起节点**自己**那一次 resume 要读的键，同样必须声明过 ----------

/**
 * V23 专用闸口用的自定义确认键名，且它**不在** `variables[]` 里（拒绝侧的全部意义就在这）
 *
 * 🔴 与 {@link CONFIRM_APPROVE_VAR} 刻意取两个不同的名字：后者在每条用到它的夹具里都声明过，
 *    若 V23 也用它，就得先把它从 `variables[]` 里挖掉 —— 那会同时改掉六条别的夹具的形状，
 *    红起来分不清是谁。各用一个名字，两侧互不牵连。
 */
const V23_UNDECLARED_APPROVE_VAR = 'user_approved'

/**
 * 「聊天触发 → 一个自定义确认键的闸口 → 大模型收尾」，且**下游不再有第二个挂起点**
 *
 * 🔴 「下游没有挂起点」是本形状的关键：后端 V23 在 `suspendAfterWrite` 已经找到下游挂起点时整段闭嘴，
 *    那一档归 V19。于是这张图上唯一还能报错的只剩 V23，红绿才有归因；
 *    反过来它也钉住了两条规则「互补不重叠」——后端若把 V23 的入口条件写错（忘了跳过 V19 已管的那档），
 *    同一个键会报两条，拒绝侧的 `expectErrorsContain` 照样绿，但放行侧会因 `passed=false` 而红。
 * ⚠️ 与 {@link v19Base} 共用「聊天 + 闸口」的形状，差别只有两处：闸口在链路里的位置（那里刻意放到
 *    `answer` 之后，好让 `note_writer` 有一个下游挂起点）、以及确认键声不声明。
 */
const v23Base = (declared: boolean): string => {
  let dsl = insertBetween(parse(CLASSIC.chat), 'lookup_forms', 'answer', confirmNode('gate_confirm', V23_UNDECLARED_APPROVE_VAR))
  if (declared) dsl = declareVar(dsl, V23_UNDECLARED_APPROVE_VAR, 'boolean')
  return stringify(dsl)
}
add({
  id: 'V23-reject-own-resume-var-undeclared',
  rule: 'V23',
  side: 'reject',
  title:
    '挂起节点自己配了个未声明的确认键 → 拒：调用方按那个名字传进来的决定要在进 state 之前先过 ' +
    'OverAllState.input()，键没注册就地被滤掉，节点读到空值 ⟹「同意」被静默判成「拒绝」而执行照样报成功',
  base: 'chat',
  dsl: v23Base(false),
  expectErrorsContain: [MARK.V23, V23_UNDECLARED_APPROVE_VAR, 'approveVar'],
  // 🔴 这一格是本对夹具最锋利的地方：它证明报出来的是 V23 而**不是** V19。
  //    同一个自定义键名两条规则都够得着，谁在说话必须能被区分，否则后端把两条合并成一条、
  //    或把 V19 那句「下游还有一个挂起点」照抄过来，这里都还是绿的
  expectErrorsNotContain: [MARK.V19]
})
add({
  id: 'V23-accept-same-var-declared',
  rule: 'V23',
  side: 'accept',
  title:
    '同一个确认键在 variables[] 里补一条声明就放行 —— 证明 V23 要的是「声明」，' +
    '不是「不许自定义确认键名」（后端 KeyStrategyResumeRuntimeTest 第 ③ 组已实测：声明了，同意就真活得下来）',
  base: 'chat',
  dsl: v23Base(true),
  expectErrorsNotContain: [MARK.V23, MARK.V19]
})

// ---------- 结构：{{$.x}} 引用了一个不存在的东西 ----------

add({
  id: 'STRUCT-reject-dangling-ref',
  rule: 'STRUCT',
  side: 'reject',
  title: '提示词里引用一个既没声明、也没有节点产出的变量被拒（跑起来只会得到一串空值）',
  base: 'chat',
  dsl: stringify(setNodeConfig(parse(CLASSIC.chat), 'answer', { prompt: '请复述：{{$.no_such_var_anywhere}}' })),
  expectErrorsContain: [MARK.STRUCT]
})
add({
  id: 'STRUCT-accept-same-slot-real-var',
  rule: 'STRUCT',
  side: 'accept',
  title:
    '同一格改成引用上游节点真产出的变量（lookup_forms → forms）就放行 —— 与拒绝侧只差那个变量名，' +
    '证明这条规则认的是「引用有没有出处」，不是「提示词里出现了 {{$.」',
  base: 'chat',
  dsl: stringify(setNodeConfig(parse(CLASSIC.chat), 'answer', { prompt: '请复述：{{$.forms}}' })),
  expectErrorsNotContain: [MARK.STRUCT]
})

// ==================== 活体参数注入 ====================

/**
 * 把 Python 探出来的活体值填进那些 `dsl: null` 的夹具
 *
 * 🔴 这一步仍然在 TypeScript 里做：Python 只给**值**，不给 DSL 形状。
 *    形状一旦交给 Python，节点目录就有了第二份副本 —— 正是方案 §A4-② 明令禁止的那件事。
 */
const liveOf = (name: LiveParam): string | undefined => {
  const raw = process.env[`GATE_RT_${name.replace(/([A-Z])/g, '_$1').toUpperCase()}`]
  const v = raw?.trim()
  return v ? v : undefined
}

const providedLive = (): string[] => LIVE_PARAMS.filter((n) => liveOf(n) !== undefined)

/** 「建一张已存在的表」的一张图：V4（拦）与 V5（降档）共用的那一份 DSL */
const dupTableCreateDsl = (existingTable: string): Dsl =>
  chatGatedWrite(createTableNode('create_dup', existingTable), 'create_result')

const buildDsl = (s: Spec): string | null => {
  if (s.dsl) return s.dsl
  const needs = s.needs ?? []
  if (needs.some((n) => liveOf(n) === undefined)) return null
  switch (s.id) {
    case 'V2-reject-disabled-tool':
      return stringify(setNodeConfig(parse(CLASSIC.chat), 'lookup_forms', { toolId: liveOf('disabledToolKey')! }))
    case 'V4-reject-dry-run':
    case 'V5-warn-conflict-but-already-executed':
      // 🔴 两条共用同一份 DSL —— 这是刻意的：V4 与 V5 的差别**只在** executedCount，
      //    共用才能证明「降档」这件事真的只由那一个输入决定。各拼一份的话，
      //    两份之间任何一个无关的差别都能把结论解释掉。
      return stringify(dupTableCreateDsl(liveOf('existingTable')!))
    case 'V6-reject-ghost-column':
      // 主表是真的（故 V6_TABLE 不报）、列是编的（故 V6_COLUMN 报）：两半各自独立可归因
      return stringify(
        chatGatedWrite(saveDraftNode('save_badcol', liveOf('existingTable')!, [ghostColumn]), 'draft_result')
      )
    case 'V6-accept-existing-table':
      // ⚠️ 刻意不带 fields：带上就得再探一个「该表真实存在的列名」当活体参数，
      //    而列那半由 V6-reject-ghost-column 单独量。这里只问「主表存在时 V6 会不会闭嘴」
      return stringify(chatGatedWrite(saveDraftNode('save_real', liveOf('existingTable')!), 'draft_result'))
    case 'V7-accept-deployed-bpm-key':
      return stringify(
        insertBetween(parse(CLASSIC.schedule), 'probe', 'digest', {
          id: 'approve_gate',
          type: 'hitl.bpm_approval',
          name: 'BPM 审批',
          config: { bpmProcessDefKey: liveOf('bpmProcessDefKey')! }
        })
      )
    case 'V8-warn-unknown-model-id':
      return stringify(setNodeConfig(parse(CLASSIC.chat), 'answer', { modelId: Number(liveOf('unusedModelId')!) }))
    case 'V10-accept-published-sub-workflow':
      return stringify(
        insertBetween(parse(CLASSIC.schedule), 'probe', 'digest', {
          id: 'call_sub',
          type: 'sub_workflow',
          name: '调用子流程',
          config: { workflowId: liveOf('subWorkflowCode')! }
        })
      )
    case 'V13-accept-bpm-under-schedule':
      return stringify(
        insertBetween(parse(CLASSIC.schedule), 'probe', 'digest', {
          id: 'approve_gate',
          type: 'hitl.bpm_approval',
          name: 'BPM 审批',
          config: { bpmProcessDefKey: liveOf('bpmProcessDefKey')! }
        })
      )
    default:
      throw new Error(`夹具 ${s.id} 声明了 needs 却没有对应的构造分支 —— 加一条 case，别让它悄悄 null`)
  }
}

/**
 * 「这个工具键应当解析得到，且它的**声明**风险应当是这个值」——夹具的前置条件表
 *
 * 🔴 只有出现在这张表里的键才算前置条件。`form_list_E2E_NOT_EXIST` 那种**故意查不到**的键不在表里，
 *    它就是被断言的对象本身；把它也当前置条件去注册表里找，V1 的每条夹具都会变成「未量到」。
 * 🔴 记的是 declaredRiskLevel（代码里 `@AgentTool(risk=…)` 的值），不是生效的 riskLevel：
 *    V11/V3/V16 读的都是 `tools.declaredRiskOf(...)`，租户在线维护改的是生效值、改不动判据。
 *    拿生效值当前置条件的话，某个租户把 datamodel_create 调成 READ_ONLY，
 *    V11 的拒绝侧就会静默地量不到东西 —— 而报告上写着「通过」。
 */
const DECLARED_RISK: Record<string, string> = {
  form_list: 'READ_ONLY',
  datamodel_list: 'READ_ONLY',
  data_interface_list: 'READ_ONLY',
  form_data_get: 'READ_ONLY',
  datamodel_create: 'IRREVERSIBLE',
  data_interface_invoke: 'HIGH',
  form_data_create: 'LOW',
  // ⚠️ LOW 而不是「无风险」：它照样进 V11 的 unguardedWrites 统计（只是不阻断），
  //    所以 V6 的夹具仍然要把闸口配上，否则报告里会多一条与 V6 无关的黄标
  form_save_draft: 'LOW'
}

/**
 * 从一份 DSL 里反推它依赖的工具键（tool 节点的 toolId + agent_loop 的 tools[]）
 *
 * 🔴 反推而不是每条夹具手填一份清单：手填会漏、会多、会在案例改了工具之后悄悄过期。
 *    漏一个的后果是「这个租户把它停用了，夹具照发，被 V2 拒，报告读起来像是别的规则坏了」。
 */
const toolsUsedBy = (dslText: string | null): ToolNeed[] => {
  if (!dslText) return []
  const keys = new Set<string>()
  for (const n of parse(dslText).nodes) {
    const cfg = n.config ?? {}
    if (n.type === 'tool' && typeof cfg.toolId === 'string' && DECLARED_RISK[cfg.toolId]) {
      keys.add(cfg.toolId)
    }
    if (n.type === 'agent_loop' && Array.isArray(cfg.tools)) {
      for (const t of cfg.tools) if (typeof t === 'string' && DECLARED_RISK[t]) keys.add(t)
    }
  }
  return [...keys].sort().map((key) => ({ key, declaredRisk: DECLARED_RISK[key] }))
}

const fixtures = (): GateFixture[] =>
  specs.map((s) => {
    const dsl = buildDsl(s)
    return {
      id: s.id,
      rule: s.rule,
      side: s.side,
      title: s.title,
      base: s.base,
      dsl,
      needs: s.needs ?? [],
      needsTools: toolsUsedBy(dsl),
      validateId: s.validateIdFrom ? (liveOf(s.validateIdFrom) ?? null) : null,
      expectPassed: s.side !== 'reject',
      expectErrorsContain: s.expectErrorsContain ?? [],
      expectErrorsNotContain: s.expectErrorsNotContain ?? [],
      expectWarningsContain: s.expectWarningsContain ?? [],
      expectWarningsNotContain: s.expectWarningsNotContain ?? [],
      expectClean: s.expectClean ?? false
    }
  })

export { fixtures as buildGateFixtures, CLASSIC, classicDslOf, classicMetaOf }

// ==================== 自检：夹具本身必须站得住 ====================

describe('发布闸门夹具的自检（不需要后端）', () => {
  const all = fixtures()

  it('五个经典案例都造得出来，且 trigger 块与所选触发方式一致', () => {
    for (const t of TRIGGER_CASE_ORDER) {
      const dsl = parse(CLASSIC[t])
      expect(dsl.id, `${t} 案例的 code 该是 demo_${t}`).toBe(`demo_${t}`)
      expect(dsl.name, `${t} 案例的 name 该取案例标题`).toBe(TRIGGER_CASES[t].title)
      expect(dsl.nodes.length, `${t} 案例不该是空画布`).toBeGreaterThan(0)
      if (t === 'none') {
        // 🔴 none 的语义就是「不写 trigger 块」：写了反而会被后端当成有触发器，
        //    V11/V13/V14 三条判据的输入全变（triggerTypeOf 返回 null 时 V11 直接 return）
        expect(dsl.trigger, 'none 案例不该有 trigger 块').toBeUndefined()
      } else {
        expect(dsl.trigger?.type, `${t} 案例的 trigger.type`).toBe(`trigger.${t}`)
      }
    }
  })

  it('夹具 id 不重复（重复了 Python 报告会两行同名，看不出哪条红了）', () => {
    const ids = all.map((f) => f.id)
    expect(new Set(ids).size, `重复的 id：${ids.filter((v, i) => ids.indexOf(v) !== i).join(', ')}`).toBe(ids.length)
  })

  it('每条夹具的 DSL 都能 parse，且节点类型都在 I/O 契约目录里', () => {
    for (const f of all) {
      if (!f.dsl) continue
      const dsl = parse(f.dsl)
      expect(dsl.nodes.length, `${f.id} 不该是空图`).toBeGreaterThan(0)
      for (const n of dsl.nodes) {
        expect(contractOf(n.type), `${f.id} 用了契约目录里没有的节点类型 ${n.type}`).toBeTruthy()
      }
    }
  })

  it('每个节点的 config 键都是该类型**声明过**的端口键 —— 拼错键名的夹具会稳定地绿，却什么也没量到', () => {
    for (const f of all) {
      if (!f.dsl) continue
      for (const n of parse(f.dsl).nodes) {
        const c = contractOf(n.type)!
        const inKeys = new Set(c.inputs.map((p) => p.key))
        const outKeys = new Set(c.outputs.map((p) => p.configKey).filter((k): k is string => !!k))
        for (const key of Object.keys(n.config ?? {})) {
          expect(inKeys.has(key) || outKeys.has(key), `${f.id} 的节点 ${n.id}(${n.type}) 用了未声明的 config 键「${key}」`).toBe(true)
        }
      }
    }
  })

  it('每个节点的 id 在同一份 DSL 内不重复', () => {
    for (const f of all) {
      if (!f.dsl) continue
      const ids = parse(f.dsl).nodes.map((n) => n.id)
      expect(new Set(ids).size, `${f.id} 有重复节点 id：${ids.join(', ')}`).toBe(ids.length)
    }
  })

  it('拒绝侧的夹具确实突变了，没有跟它的经典案例一字不差（一字不差 = 后端会说 passed，这条夹具等于没写）', () => {
    for (const f of all) {
      if (!f.dsl || f.base === '-') continue
      if (f.side !== 'reject') continue
      expect(f.dsl, `${f.id} 与 ${f.base} 案例完全相同，突变没落地`).not.toBe(CLASSIC[f.base as WorkflowTriggerType])
    }
  })

  it('每条拒绝侧夹具都钉了至少一个后端逐字文案片段（只断 passed=false 的话，因为别的原因被拒也算绿）', () => {
    for (const f of all) {
      if (f.side !== 'reject') continue
      expect(f.expectErrorsContain.length, `${f.id} 是拒绝侧却没有 expectErrorsContain`).toBeGreaterThan(0)
    }
  })

  it('声明了 needs 的夹具，参数给不出时 dsl 必须为 null（Python 靠这个判「未量到」）', () => {
    for (const f of all) {
      const missing = f.needs.filter((n) => liveOf(n) === undefined)
      if (missing.length) {
        expect(f.dsl, `${f.id} 缺 ${missing.join(',')} 却仍产出了 DSL —— 那会拿占位值去发请求`).toBeNull()
      }
    }
  })

  it('要按 id 校验的夹具，id 给不出时不许产出 DSL（否则它量到的是 V4，报告上却写着 V5）', () => {
    for (const f of all) {
      if (f.validateId) expect(f.dsl, `${f.id} 带了 validateId 却没有 DSL`).not.toBeNull()
    }
    const v5 = all.find((f) => f.rule === 'V5')!
    if (v5.dsl !== null) {
      expect(v5.validateId, 'V5 必须有 id：executedCount 是按 id 反查的，不带 id 恒为 0，那条规则压根没被问到').toBeTruthy()
    }
  })

  it('放行侧夹具不该同时钉「必须有 error」（自相矛盾的期望会让 Python 永远红）', () => {
    for (const f of all) {
      if (f.side === 'reject') continue
      expect(f.expectErrorsContain, `${f.id} 是 ${f.side} 侧却要求 errors 含内容`).toEqual([])
    }
  })

  it('每条生效规则都同时钉了「这里必须报」和「那里必须不报」两侧', () => {
    // 🔴 判据是**断言的形状**，不是 side 标签：V16/V8-warn/V14-warn 这类只出黄标的规则
    //    根本没有 reject 侧，按 side 分组会把它们误判成「只有放行侧」，
    //    然后逼着人去给一条 warning-only 的规则硬造一个拒绝夹具 —— 那条夹具会稳定地红，
    //    红的原因还是「规则本来就不该拒」，等于把噪音写进测试。
    //    真正的双向性是：既有夹具断言「必须出现某句话」，也有夹具断言「必须不出现某句话」。
    //    只有前者的规则，一个「多拦」的实现能骗过它；只有后者的规则，一个「漏拦」的实现能骗过它。
    const flagged = new Set<string>()
    const unflagged = new Set<string>()
    for (const f of all) {
      if (f.expectErrorsContain.length || f.expectWarningsContain.length) flagged.add(f.rule)
      if (f.expectErrorsNotContain.length || f.expectWarningsNotContain.length || f.expectClean) unflagged.add(f.rule)
    }
    for (const f of all) {
      if (f.rule === 'CLASSIC') continue
      expect(flagged.has(f.rule), `规则 ${f.rule} 没有任何「必须报出来」的断言 —— 漏拦的实现会全绿`).toBe(true)
      expect(unflagged.has(f.rule), `规则 ${f.rule} 没有任何「必须不报」的断言 —— 多拦的实现会全绿`).toBe(true)
    }
  })
  it('放行侧 / 黄标侧夹具里的每个工具键都在 DECLARED_RISK 表里（否则它依赖一个谁也没核实过的工具）', () => {
    // 🔴 拒绝侧不查：那一侧本来就允许出现故意查不到的键（BAD_TOOL 就是 V1 的断言对象）。
    //    放行侧一旦出现表外的键，说明这条夹具的「通过」建立在「后端没去解析这个键」之上 ——
    //    那不是放行，那是没量到，而报告上会写着通过。
    for (const f of all) {
      if (f.side === 'reject' || !f.dsl) continue
      for (const n of parse(f.dsl).nodes) {
        const cfg = n.config ?? {}
        const keys: string[] = []
        if (n.type === 'tool' && typeof cfg.toolId === 'string') keys.push(cfg.toolId)
        if (n.type === 'agent_loop' && Array.isArray(cfg.tools)) keys.push(...cfg.tools.filter((t: any) => typeof t === 'string'))
        for (const k of keys) {
          expect(DECLARED_RISK[k], `${f.id}（${f.side} 侧）用了前置条件表里没有的工具键「${k}」`).toBeTruthy()
        }
      }
    }
  })

  it('needsTools 是从 DSL 反推出来的，不是手填的 —— 案例换了工具，清单要自己跟上', () => {
    const webhook = all.find((f) => f.id === 'CLASSIC-webhook')!
    // webhook 案例里一个 tool 节点都没有（script + condition.rule + 两个 llm），
    // 手填的年代这里曾写着 form_list，于是「form_list 被停用」会让一条与它无关的夹具报「未量到」
    expect(webhook.needsTools, 'webhook 案例不该依赖任何工具键').toEqual([])
    const none = all.find((f) => f.id === 'CLASSIC-none')!
    expect(none.needsTools.map((t) => t.key), 'none 案例串了两个只读工具').toEqual(['datamodel_list', 'form_list'])
    const v11 = all.find((f) => f.id === 'V11-reject-irreversible-no-gate')!
    // 🔴 两个键，不是一个：这条夹具是在 schedule 案例上突变的，案例本身的 probe 节点就在用
    //    data_interface_list。手写清单的年代正是这种「基底带来的依赖」最容易漏 ——
    //    漏了的表现是「data_interface_list 被停用时，V2 先拒，报告读起来像 V11 坏了」
    expect(v11.needsTools, 'V11 拒绝侧的依赖 = 建表工具 + 案例基底自带的只读工具').toEqual([
      { key: 'data_interface_list', declaredRisk: 'READ_ONLY' },
      { key: 'datamodel_create', declaredRisk: 'IRREVERSIBLE' }
    ])
    const v6 = all.find((f) => f.id === 'V6-reject-ghost-main-table')!
    // form_save_draft 是 LOW 不是「无风险」：它照样进 V11 的 unguardedWrites 统计，
    // 所以 V6 的夹具也挂着 confirm 闸口 —— 反推出来的清单里于是只有基底的 form_list 与它自己
    expect(v6.needsTools, 'V6 拒绝侧的依赖 = form_save_draft + 聊天基底自带的 form_list').toEqual([
      { key: 'form_list', declaredRisk: 'READ_ONLY' },
      { key: 'form_save_draft', declaredRisk: 'LOW' }
    ])
  })

  it('V6 的夹具里不许有建表节点跑到 form_save_draft 上游 —— 有则后端整项跳过 V6，夹具会绿得毫无意义', () => {
    // 🔴 后端 WorkflowDslValidator#validateSaveDraftMainTable 见到「本流程会在 save_draft 之前建表」就 continue：
    //    表与列此刻还不存在，两项校验都无从谈起。这条 continue 是对的，
    //    但它意味着「顺手在 V6 夹具前面加一个 datamodel_create」会让拒绝侧静默失效 ——
    //    而放行侧照样绿（它断言的正是「没有 V6 文案」），于是只有半边会红，很容易被当成偶发
    const CREATORS = ['datamodel_create', 'datamodel_import']
    for (const f of all.filter((x) => x.rule === 'V6' && x.dsl !== null)) {
      const creators = parse(f.dsl!)
        .nodes.filter((n) => n.type === 'tool' && CREATORS.includes(String(n.config?.toolId)))
        .map((n) => n.id)
      expect(creators, `${f.id} 里有建表节点，后端会整项跳过 V6`).toEqual([])
    }
  })

  it('每个节点写的变量都在 variables[] 里声明过（V19/V23 的夹具除外 —— 那两条规则的断言对象就是这个「没声明」）', () => {
    // 🔴 这条守的是**红绿归因**，不是后端行为：后端 V19 只在「下游另有挂起点」时报、V23 只报挂起节点自己，
    //    所以一个未声明的输出变量名在多数形状下是合法的。但夹具不是「多数形状」——
    //    一条声称量 V11 的夹具若顺带带着一个未声明的确认键，V23 会给它添一条阻断错误，
    //    放行侧当场 `passed=false` 红在 e2e 上，而红的原因跟 V11 毫无关系；
    //    拒绝侧更坏：它照样绿（`expectErrorsContain` 只要求「含」），报告上写着 V11 通过，
    //    量的却是两条错误的并集。
    // 🔴 故这里刻意比后端**严**：一律要求声明。缺省名不用声明（后端无条件注册过，滤不掉），
    //    所以只查「配了值、且配的不是缺省名」的那些端口。
    // ⚠️ 本条不需要后端、也不需要可达性信息，故 `pnpm test:unit` 就能拦住 —— 漏声明这种错
    //    本该在这一层红，不该拖到 e2e 上以一条不相干的失败出现。
    const ABOUT_UNDECLARED = new Set(['V19', 'V23'])
    for (const f of all) {
      if (!f.dsl || ABOUT_UNDECLARED.has(f.rule)) continue
      const dsl = parse(f.dsl)
      const declared = new Set(dsl.variables.map((v) => String(v.key)))
      for (const n of dsl.nodes) {
        for (const p of contractOf(n.type)?.outputs ?? []) {
          const configured = p.configKey ? String(n.config?.[p.configKey] ?? '').trim() : ''
          // 没配 ⟹ 执行器落缺省名；配的就是缺省名 ⟹ 已被无条件注册。两种都滤不掉，不必声明
          if (!configured || configured === p.defaultName) continue
          expect(
            declared.has(configured),
            `${f.id} 的节点 ${n.id}(${n.type}) 把「${configured}」写进 state 却没在 variables[] 里声明 —— ` +
              `下游一有挂起点就是 V19，它自己就是挂起点则是 V23，两种都会让这条夹具红在与 ${f.rule} 无关的地方`
          ).toBe(true)
        }
      }
    }
  })
})

// ==================== 落盘（只在 Python 驱动时） ====================

describe('导出夹具给 verify_dsl_gate.py', () => {
  it('设了 DSL_FIXTURES_OUT 就写 JSON；没设就什么也不做（pnpm test:unit 不留垃圾文件）', () => {
    const out = process.env.DSL_FIXTURES_OUT?.trim()
    const all = fixtures()
    const payload = {
      generatedAt: new Date().toISOString(),
      liveParamsProvided: providedLive(),
      liveParamsKnown: [...LIVE_PARAMS],
      fixtureCount: all.length,
      measurableCount: all.filter((f) => f.dsl !== null).length,
      fixtures: all
    }
    if (!out) {
      expect(all.length, '夹具一条都没造出来').toBeGreaterThan(0)
      return
    }
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8')
    expect(payload.measurableCount, '一条可量的夹具都没有，Python 会整体报「未量到」').toBeGreaterThan(0)
  })
})
