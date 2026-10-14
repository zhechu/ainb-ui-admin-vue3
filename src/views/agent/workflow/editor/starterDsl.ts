/**
 * 新增流程「模板起步 DSL」构造器（AI助手 流程编排优化 / Req 2）
 *
 * 新增与设计分离后，「新增」弹窗收集 名称 + 编码 + 触发方式 + 模板，据此产出一份**合法可落库**的起步 DSL，
 * 再调 createDef 建草稿、跳整页设计器。本模块是这件事的纯逻辑内核（无 UI / 无请求，可单测）。
 *
 * 🔴 触发方式为什么写进 DSL 而不是单独字段：{@code AgentWorkflowDefSaveVO} 没有 trigger 列，后端
 * {@code WorkflowTriggerExtractor.apply} 只认 DSL 里的 {@code trigger} 块，并在 **createDef/updateDef 落库前**
 * 就 fail-close 校验（form_event 缺 formCode、cron 非法、webhook path 畸形都会抛 WORKFLOW_TRIGGER_CONFIG_INVALID）。
 * 故本模块产出的 trigger 块必须与后端契约逐字对齐：
 *   · chat        → { type:'trigger.chat',       config:{ inputVar:'input', agentId } }（agentId 可空=仅手动运行）
 *   · form_event  → { type:'trigger.form_event', config:{ formCode, eventType } }（eventType ∈ create/update/delete）
 *   · schedule    → { type:'trigger.schedule',   config:{ cron } }（Spring 6 段 cron）
 *   · webhook     → { type:'trigger.webhook',    config:{ path, authType, secret } }（authType ∈ hmac/token，secret 必填）
 *   · none        → 不写 trigger 块（纯手动 / API run-stream 触发）
 *
 * 🔴 createDef **不**做图校验（只 JSON 解析 + trigger 投影），故「空白」模板（nodes/edges 皆空）能建成草稿；
 * 图是否合法留到设计器里「体检」与「发布」时校验（发布要求体检通过）。这正是「先建空白草稿 → 进设计器画」的预期体验。
 *
 * 🔴 **「复制已有」不在本模块**（S5-f 修 G11）：复制品的 DSL 只能由服务端 `POST /agent/workflow-def/copy`
 * 从源定义读出来再改写。前端自己深拷一份 DSL 就是 G11 的形状 —— 前端不知道 `datamodel_create.tableName`、
 * `form_save_draft.code`、`process_create_and_deploy.key`、webhook `path` 会跟源流程抢同一份**不可逆**的外部资源，
 * 而这些在发布期一个都不报。故 {@link buildStarterDsl} 的入参类型是 {@link BuildableTemplate}（不含 'copy'），
 * 编译期就把这条路堵死；'copy' 只作为「起步模板」单选值存在，选中后由复制对话框接管。
 */

import { TRIGGER_CASES } from './triggerCases'

/** 触发方式（与后端 WorkflowTriggerExtractor 归一化后的短名一致；none=不写 trigger 块） */
export type WorkflowTriggerType = 'none' | 'chat' | 'form_event' | 'schedule' | 'webhook'

/**
 * 起步模板：空白 / 经典案例 / 复制已有
 *
 * 🔴 「经典案例」取代了原先的「示例骨架」：示例骨架是一份与触发方式无关的固定骨架，
 *    而案例按**当前选的触发方式**给对应的完整流程（见 triggerCases.ts），
 *    既示范了该触发方式的载荷怎么取，也示范了这类流程通常长什么样。
 */
export type StarterTemplate = 'blank' | 'case' | 'copy'

/**
 * 真正能由前端构造出 DSL 的模板 = {@link StarterTemplate} 去掉 'copy'。
 *
 * 🔴 这不是为了好看的别名，是 **G11 的编译期强制点**：{@link buildStarterDsl} 只收这个类型，
 *    所以「前端拼一份复制品 DSL」写不出来（写出来就是编译错）。复制一律走服务端 `/copy`，
 *    因为只有后端知道哪些格子会跟源流程抢不可逆的外部资源、以及该怎么改写。
 *    守着这一格的是 starterDsl.spec.ts 里那条 `@ts-expect-error` 用例。
 */
export type BuildableTemplate = Exclude<StarterTemplate, 'copy'>

/** 触发方式的配置元信息（按 type 取用对应字段；无关字段忽略） */
export interface WorkflowTriggerMeta {
  type: WorkflowTriggerType
  /** chat：绑定的 Agent 编码 code（留空=仅手动运行） */
  agentId?: string
  /** form_event：表单编码 */
  formCode?: string
  /** form_event：create/update/delete */
  eventType?: string
  /** schedule：Spring 6 段 cron */
  cron?: string
  /** webhook：URL 安全 path（字母/数字/下划线/连字符，1~64） */
  path?: string
  /** webhook：hmac/token（必填；平台已无「不鉴权」档），缺省 hmac */
  authType?: string
  /** webhook：验签密钥，无条件必填（authType 只剩 hmac/token 两档） */
  secret?: string
}

/** 构造起步 DSL 的入参 */
export interface StarterMeta {
  code: string
  name: string
  description?: string
  trigger: WorkflowTriggerMeta
}

/**
 * 按触发方式构造 DSL 的 {@code trigger} 块；none 返回 undefined（表示不写该块）。
 *
 * 🔴 与后端 applyXxx 的必填项逐字对齐，避免「建草稿时后端抛 WORKFLOW_TRIGGER_CONFIG_INVALID」。
 * 深层格式（cron 是否合法、path 字符集）由后端权威校验并给出人话报错，前端只做「必填项在不在」。
 */
export function buildTriggerBlock(trigger: WorkflowTriggerMeta): Record<string, any> | undefined {
  switch (trigger.type) {
    case 'chat':
      return { type: 'trigger.chat', config: { inputVar: 'input', agentId: trigger.agentId ?? '' } }
    case 'form_event':
      return {
        type: 'trigger.form_event',
        config: { formCode: trigger.formCode ?? '', eventType: trigger.eventType ?? '' }
      }
    case 'schedule':
      return { type: 'trigger.schedule', config: { cron: trigger.cron ?? '' } }
    case 'webhook': {
      // 🔴 authType 只剩 hmac/token 两档、secret 无条件必填（后端 applyWebhook 落库前就拒，
      // 入站 verifyAuth 对缺省/none/未知值也一律拒）：缺省给 hmac，secret 原样带上。
      // 空串也照写 —— 「缺密钥」这句人话报错由后端权威给出，前端不另造一套口径（否则两份必然漂）
      const config: Record<string, any> = {
        path: trigger.path ?? '',
        authType: trigger.authType || 'hmac',
        secret: trigger.secret ?? ''
      }
      return { type: 'trigger.webhook', config }
    }
    case 'none':
    default:
      return undefined
  }
}

/**
 * 经典案例骨架：取**当前触发方式**对应的案例图主体（见 triggerCases.ts）。
 *
 * 🔴 案例只提供 variables/nodes/edges（「流程长什么样」），trigger 块仍由 {@link buildTriggerBlock}
 *    独家组装（「怎么被触发」）——两者分工明确，不会出现「案例里的 trigger 与实际选的不一致」。
 * 🔴 body() 每次返回全新对象：editorModel 的变更是就地突变，共享字面量会被上一次用脏。
 */
const caseBase = (type: WorkflowTriggerType): Record<string, any> => {
  const body = TRIGGER_CASES[type]?.body()
  return {
    dslVersion: '1.0',
    id: '',
    name: '',
    description: '',
    variables: body?.variables ?? [
      { key: 'input', type: 'string', merge: 'replace', required: false },
      { key: 'output', type: 'string', merge: 'replace' }
    ],
    nodes: body?.nodes ?? [],
    edges: body?.edges ?? [],
    settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
  }
}

/** 空白骨架：只有 input/output 变量，nodes/edges 皆空，交给设计器画（createDef 不做图校验，可建草稿） */
const blankBase = (): Record<string, any> => ({
  dslVersion: '1.0',
  id: '',
  name: '',
  description: '',
  variables: [
    { key: 'input', type: 'string', merge: 'replace', required: false },
    { key: 'output', type: 'string', merge: 'replace' }
  ],
  nodes: [],
  edges: [],
  settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
})

/**
 * 构造起步 DSL 原文（JSON 字符串，2 空格缩进）。
 *
 * - blank：空画布起步；
 * - case：当前触发方式的经典案例（完整可跑、开箱可过体检）。
 *
 * 两种模板都会：写入 code/name/description、按触发方式注入 trigger 块（none 则删除 trigger）。
 *
 * 🔴 **没有 'copy' 这一档**（S5-f 修 G11）：复制品的 DSL 由服务端 `/copy` 从源定义读出来再改写冲突项，
 *    前端不拼装。入参类型 {@link BuildableTemplate} 就是这件事的强制点。
 */
export function buildStarterDsl(template: BuildableTemplate, meta: StarterMeta): string {
  const base: Record<string, any> = template === 'blank' ? blankBase() : caseBase(meta.trigger.type)

  base.dslVersion = base.dslVersion || '1.0'
  base.id = meta.code
  base.name = meta.name
  base.description = meta.description ?? ''

  const trigger = buildTriggerBlock(meta.trigger)
  if (trigger) {
    base.trigger = trigger
  } else {
    delete base.trigger
  }

  return JSON.stringify(base, null, 2)
}

/**
 * 编辑元信息时，只替换既有 DSL 的 trigger 块，其余（尤其画布节点）原样保留。
 *
 * 用于「编辑」弹窗改触发方式：updateDef 会重跑 trigger 投影，故必须回传完整 DSL；
 * 但我们只想动 trigger，不能覆盖设计器里的草稿节点。dslText 非法时原样返回（不破坏数据）。
 */
export function injectTrigger(dslText: string, trigger: WorkflowTriggerMeta): string {
  const parsed = tryParse(dslText)
  if (!parsed) return dslText
  const block = buildTriggerBlock(trigger)
  if (block) {
    parsed.trigger = block
  } else {
    delete parsed.trigger
  }
  return JSON.stringify(parsed, null, 2)
}

function tryParse(text?: string): Record<string, any> | undefined {
  if (!text) return undefined
  try {
    const obj = JSON.parse(text)
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : undefined
  } catch {
    return undefined
  }
}
