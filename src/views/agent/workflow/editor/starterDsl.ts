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
 *   · webhook     → { type:'trigger.webhook',    config:{ path, authType, secret? } }（authType ∈ none/hmac/token）
 *   · none        → 不写 trigger 块（纯手动 / API run-stream 触发）
 *
 * 🔴 createDef **不**做图校验（只 JSON 解析 + trigger 投影），故「空白」模板（nodes/edges 皆空）能建成草稿；
 * 图是否合法留到设计器里「体检」与「发布」时校验（发布要求体检通过）。这正是「先建空白草稿 → 进设计器画」的预期体验。
 */

import { DEFAULT_DSL } from './defaults'

/** 触发方式（与后端 WorkflowTriggerExtractor 归一化后的短名一致；none=不写 trigger 块） */
export type WorkflowTriggerType = 'none' | 'chat' | 'form_event' | 'schedule' | 'webhook'

/** 起步模板：空白 / 示例骨架 / 复制已有 */
export type StarterTemplate = 'blank' | 'sample' | 'copy'

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
  /** webhook：none/hmac/token，缺省 none */
  authType?: string
  /** webhook：hmac/token 时必填的验签密钥 */
  secret?: string
}

/** 构造起步 DSL 的入参 */
export interface StarterMeta {
  code: string
  name: string
  description?: string
  trigger: WorkflowTriggerMeta
  /** copy 模板专用：被复制流程的 DSL 原文（JSON 字符串） */
  copyDsl?: string
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
      const config: Record<string, any> = {
        path: trigger.path ?? '',
        authType: trigger.authType || 'none'
      }
      // 仅 hmac/token 需要 secret；none 不写（写了也无害，但从简）
      if (config.authType !== 'none' && trigger.secret) {
        config.secret = trigger.secret
      }
      return { type: 'trigger.webhook', config }
    }
    case 'none':
    default:
      return undefined
  }
}

/** 示例骨架：直接复用已验证可过体检的 DEFAULT_DSL（START→tool→END），深拷贝后改元信息 */
const sampleBase = (): Record<string, any> => JSON.parse(DEFAULT_DSL)

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
 * 构造起步 DSL 原文（JSON 字符串，2 空格缩进，与 DEFAULT_DSL 风格一致）。
 *
 * - blank：空画布起步；
 * - sample：示例骨架（含一个只读工具演示节点，开箱可过体检）；
 * - copy：深拷贝 {@code meta.copyDsl} 的结构（nodes/edges/variables/settings），重置 id/name/description。
 *
 * 三种模板都会：写入 code/name/description、按触发方式注入 trigger 块（none 则删除 trigger）。
 * copy 模板若 copyDsl 缺失或非法，安全退化为 sample（不因复制源损坏而挡住新建）。
 */
export function buildStarterDsl(template: StarterTemplate, meta: StarterMeta): string {
  let base: Record<string, any>
  if (template === 'copy') {
    const parsed = tryParse(meta.copyDsl)
    base = parsed ?? sampleBase()
  } else if (template === 'blank') {
    base = blankBase()
  } else {
    base = sampleBase()
  }

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
