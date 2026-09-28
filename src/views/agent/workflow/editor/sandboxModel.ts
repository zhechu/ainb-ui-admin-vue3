/**
 * 沙箱测试的纯逻辑模型（增量 Req4b / coze 式沙箱试跑）
 *
 * 🔴 与 editorModel.ts / replayModel.ts / editorHistory.ts 同款纪律：纯函数、不依赖 Vue 运行时，
 *    便于 vitest 单测（见 sandboxModel.spec.ts）。组件只负责渲染与订阅事件流，折叠逻辑全在这里。
 *
 * <h3>沙箱事件从哪来</h3>
 * 后端 {@code AgentWorkflowSandboxServiceImpl} 复用正式执行的 {@code WorkflowEvent} 事件模型，逐节点流式回传：
 *   META(启动) → NODE(每个节点跑完，带全量 state 快照) …→ DONE(最终 state) / INTERRUPTED(命中人工闸口) / ERROR。
 * 🔴 NODE 事件在节点<b>完成后</b>才发，且 state 是<b>累积全量快照</b>（不是单节点输出）。故本模块：
 *   - 「节点输出」= 本次 state 相对上一次 state 的差异（新增/变更的键）；
 *   - 「节点输入」= 上一个快照（即该节点跑之前看到的世界）；
 *   - 「写操作被 mock」= 差异里出现 {@code __sandboxMock:true} 的占位结果（见后端 AgentToolExecutor.mockResult）。
 *
 * <h3>沙箱纪律（面板须如实告知用户）</h3>
 * 真跑大模型与只读工具（会消耗 token），写/不可逆工具被 mock（无副作用），不落库、不计配额；
 * 命中 hitl/wait 中断即停（v1 不支持沙箱内 resume）。
 */

import type { WorkflowEventVO } from '@/api/agent/workflow'
import { nodeTypeMeta } from '../nodeSummary'
import type { EditorDsl, EditorDslNode } from '../editorModel'

/** 单节点在沙箱里的展示状态 */
export type SandboxNodeStatus =
  | 'wait' // 尚未执行（排队中）
  | 'running' // 正在执行（据线性后继推断，画布高亮用）
  | 'success' // 成功完成
  | 'mock' // 完成，但写操作被沙箱 mock（成功的一种，视觉区分）
  | 'fail' // 执行失败
  | 'interrupted' // 命中人工确认/等待节点，沙箱在此停止
  | 'skip' // 整轮结束后仍未走到（分支未命中）

/** 整轮沙箱的状态 */
export type SandboxRunStatus = 'idle' | 'running' | 'done' | 'failed' | 'interrupted'

export type SandboxTagType = 'primary' | 'success' | 'warning' | 'danger' | 'info'

export interface SandboxStatusMeta {
  label: string
  tagType: SandboxTagType
  /** 画布节点边框/光晕色（内联样式用），取 Element Plus 语义色变量，随明暗主题自适应 */
  color: string
}

/** 节点状态 → 展示元信息（与 replayModel.NODE_STATUS_META 同构，另加 mock/interrupted/skip 三态） */
export const SANDBOX_NODE_STATUS_META: Record<SandboxNodeStatus, SandboxStatusMeta> = {
  wait: { label: '等待', tagType: 'info', color: 'var(--el-border-color)' },
  running: { label: '执行中', tagType: 'primary', color: 'var(--el-color-primary)' },
  success: { label: '成功', tagType: 'success', color: 'var(--el-color-success)' },
  mock: { label: '已模拟写操作', tagType: 'warning', color: 'var(--el-color-warning)' },
  fail: { label: '失败', tagType: 'danger', color: 'var(--el-color-danger)' },
  interrupted: { label: '已中断', tagType: 'warning', color: 'var(--el-color-warning)' },
  skip: { label: '未执行', tagType: 'info', color: 'var(--el-border-color-light)' }
}

export const sandboxStatusMeta = (status: SandboxNodeStatus): SandboxStatusMeta =>
  SANDBOX_NODE_STATUS_META[status] ?? SANDBOX_NODE_STATUS_META.wait

/** 画布合成端点 id（不在 DSL nodes 里，NODE 事件若带这些 id 直接忽略，不建行） */
const SYNTHETIC_NODE_IDS = new Set(['__START__', '__END__', 'START', 'END'])

/** 一个节点在沙箱时间线里的一行 */
export interface SandboxNodeRow {
  nodeId: string
  /** 友好名：DSL 里的 name，无名回落「步骤 N」，未知 id 回落原 id */
  name: string
  /** 节点类型（用于类型徽标 + 中文名） */
  type?: string
  /** 类型中文名（来自 nodeSummary 权威目录） */
  typeLabel: string
  status: SandboxNodeStatus
  /** 该节点的输出里是否含被 mock 的写操作结果 */
  mocked: boolean
  /** 该节点跑之前看到的 state（输入快照） */
  input?: Record<string, any>
  /** 该节点相对上一快照的产出（输出快照） */
  output?: Record<string, any>
  /** 客户端估算耗时（ms）：本次 NODE 到达时间 - 上次事件时间 */
  durationMs?: number
  errorMsg?: string
  /** 完成顺序（0=尚未完成） */
  seq: number
}

export interface SandboxRun {
  status: SandboxRunStatus
  executionId?: number
  threadName?: string
  /** 时间线行（按 DSL 节点顺序 + 运行中出现的未知节点追加） */
  rows: SandboxNodeRow[]
  /** 用户提供的测试输入（作为首节点的输入快照） */
  initialInput: Record<string, any>
  /** 最近一次 NODE 事件的累积 state，用于给下一节点算差异 */
  prevState?: Record<string, any>
  finalState?: Record<string, any>
  error?: string
  /** 命中中断的节点 id（banner 用） */
  interruptNodeId?: string
  /** 当前应在画布上高亮的节点（最近完成/正在跑的节点；终态清空） */
  activeNodeId?: string
  startedAt?: number
  endedAt?: number
  durationMs?: number
  /** 已完成节点计数（成功/mock/失败/中断），顶栏进度用 */
  completedCount: number
  /** 是否有节点被 mock（面板顶部提示「本次有写操作被模拟」） */
  anyMocked: boolean
  /** 内部：NODE 事件到达序号，用于给行编 seq */
  _seq: number
  /** 内部：上一次事件时间戳，用于估算节点耗时 */
  _lastAt?: number
  /** 内部：nodeId → DSL 节点，找 outputVar/后继用 */
  _nodeById: Map<string, EditorDslNode>
  /** 内部：from → 后继 to 列表（普通边 + 条件边 cases/default 展开） */
  _successors: Map<string, string[]>
}

const asObject = (v: any): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : {}

const asArray = (v: any): any[] => (Array.isArray(v) ? v : [])

/** 后端 mock 占位结果的识别标记（见 AgentToolExecutor.mockResult） */
export const isMockValue = (v: any): boolean => asObject(v).__sandboxMock === true

/** 递归看对象/数组里是否含 mock 占位（工具结果可能被包进数组或对象里）。先判自身再限深，避免深层漏判 */
const containsMock = (v: any, depth = 0): boolean => {
  if (isMockValue(v)) return true
  if (depth > 4) return false
  if (Array.isArray(v)) return v.some((x) => containsMock(x, depth + 1))
  if (v && typeof v === 'object') return Object.values(v).some((x) => containsMock(x, depth + 1))
  return false
}

const stableStringify = (v: any): string => {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * 计算 state 差异：next 相对 prev 新增或变更的键。
 * 用稳定 JSON 比较值（避免引用不等误判）；只回差异键，不整包塞，面板负载可控。
 */
export const diffState = (
  prev: Record<string, any> | undefined,
  next: Record<string, any>
): Record<string, any> => {
  const p = asObject(prev)
  const n = asObject(next)
  const diff: Record<string, any> = {}
  for (const [k, val] of Object.entries(n)) {
    if (!(k in p) || stableStringify(p[k]) !== stableStringify(val)) {
      diff[k] = val
    }
  }
  return diff
}

/** 收集 DSL 里 from→to 的后继（普通边 to + 条件边 cases 值 + default），供「推断下一个 running 节点」用 */
const buildSuccessors = (dsl: EditorDsl): Map<string, string[]> => {
  const map = new Map<string, string[]>()
  const push = (from: string, to?: string) => {
    if (!from || !to) return
    const arr = map.get(from) ?? []
    if (!arr.includes(to)) arr.push(to)
    map.set(from, arr)
  }
  for (const e of asArray(dsl.edges)) {
    const from = e?.from
    if (!from) continue
    push(from, e.to)
    push(from, e.default)
    for (const tgt of Object.values(asObject(e.cases))) {
      push(from, typeof tgt === 'string' ? tgt : undefined)
    }
  }
  return map
}

/**
 * 用 DSL 初始化一轮沙箱：所有 DSL 节点建行为 'wait'，记录 id→节点、后继表、测试输入。
 * 🔴 行按 DSL nodes 顺序排（作者认得的顺序）；运行中出现 DSL 里没有的节点 id 再追加到末尾。
 */
export const createSandboxRun = (
  dsl: EditorDsl,
  input: Record<string, any> = {}
): SandboxRun => {
  const nodes = asArray(dsl.nodes) as EditorDslNode[]
  const nodeById = new Map<string, EditorDslNode>()
  const rows: SandboxNodeRow[] = []
  nodes.forEach((n, i) => {
    if (!n?.id) return
    nodeById.set(n.id, n)
    rows.push({
      nodeId: n.id,
      name: n.name ? String(n.name) : `步骤 ${i + 1}`,
      type: n.type,
      typeLabel: nodeTypeMeta(n.type).label,
      status: 'wait',
      mocked: false,
      seq: 0
    })
  })
  return {
    status: 'idle',
    rows,
    initialInput: asObject(input),
    // 🔴 prevState 用测试输入初始化：图跑起来时首批 state 快照已含被 seed 的入参变量，
    //    若从 undefined 起算，这些入参会被误当成「首节点的产出」。从 input 起算，首节点差异只含它真正新增的键。
    prevState: asObject(input),
    completedCount: 0,
    anyMocked: false,
    _seq: 0,
    _nodeById: nodeById,
    _successors: buildSuccessors(dsl)
  }
}

const findRow = (run: SandboxRun, nodeId: string): SandboxNodeRow | undefined =>
  run.rows.find((r) => r.nodeId === nodeId)

/** 运行中出现 DSL 里没有的节点（如子图内部节点）：追加一行，避免进度丢失 */
const ensureRow = (run: SandboxRun, nodeId: string): SandboxNodeRow => {
  const existing = findRow(run, nodeId)
  if (existing) return existing
  const node = run._nodeById.get(nodeId)
  const row: SandboxNodeRow = {
    nodeId,
    name: node?.name ? String(node.name) : nodeId,
    type: node?.type,
    typeLabel: nodeTypeMeta(node?.type).label,
    status: 'wait',
    mocked: false,
    seq: 0
  }
  run.rows.push(row)
  return row
}

/**
 * 线性后继推断：completedId 完成后，若它有且仅有一个真实 DSL 后继且该后继仍在 'wait'，
 * 则把该后继标为 'running'（给线性流程一个「正在跑」的可视反馈）。
 * 多后继（条件/并行）语义不明确，保持 'wait'，不谎报。
 */
const markNextRunning = (run: SandboxRun, completedId: string): void => {
  const successors = (run._successors.get(completedId) ?? []).filter(
    (id) => !SYNTHETIC_NODE_IDS.has(id)
  )
  if (successors.length !== 1) return
  const next = findRow(run, successors[0])
  if (next && next.status === 'wait') {
    next.status = 'running'
    run.activeNodeId = next.nodeId
  }
}

/** 把仍处 'running' 的行收敛为指定终态（ERROR 时定位失败节点用） */
const runningRows = (run: SandboxRun): SandboxNodeRow[] =>
  run.rows.filter((r) => r.status === 'running')

/**
 * 折叠一个沙箱事件到 run（就地修改并返回，兼顾 Vue 响应式与单测）。
 * @param now 事件到达时间戳（默认 Date.now，单测可注入以验证耗时估算）
 */
export const reduceSandboxEvent = (
  run: SandboxRun,
  event: WorkflowEventVO,
  now: number = Date.now()
): SandboxRun => {
  if (!event || !event.type) return run
  switch (event.type) {
    case 'META': {
      run.status = 'running'
      run.executionId = event.executionId
      run.threadName = event.threadName
      run.startedAt = now
      run._lastAt = now
      // 入口节点（START 的后继）标 running
      const entries = (run._successors.get('START') ?? []).filter(
        (id) => !SYNTHETIC_NODE_IDS.has(id)
      )
      if (entries.length === 1) {
        const first = findRow(run, entries[0])
        if (first && first.status === 'wait') {
          first.status = 'running'
          run.activeNodeId = first.nodeId
        }
      }
      break
    }
    case 'NODE': {
      const nodeId = event.nodeId
      if (!nodeId || SYNTHETIC_NODE_IDS.has(nodeId)) break
      const state = asObject(event.state)
      const row = ensureRow(run, nodeId)
      const inputSnapshot = run.prevState ?? run.initialInput
      const output = diffState(run.prevState, state)
      // 若节点声明了 outputVar，确保它出现在 output 里（差异算法通常已含，兜底补全）
      const outVar = run._nodeById.get(nodeId)?.config?.outputVar
      if (typeof outVar === 'string' && outVar && outVar in state && !(outVar in output)) {
        output[outVar] = state[outVar]
      }
      const mocked = containsMock(output)
      row.input = inputSnapshot
      row.output = output
      row.mocked = mocked
      row.status = mocked ? 'mock' : 'success'
      run._seq += 1
      row.seq = run._seq
      run.completedCount += 1
      if (mocked) run.anyMocked = true
      const elapsed = run._lastAt != null ? Math.max(0, now - run._lastAt) : undefined
      if (elapsed != null) row.durationMs = elapsed
      run.prevState = state
      run._lastAt = now
      run.activeNodeId = nodeId
      markNextRunning(run, nodeId)
      break
    }
    case 'INTERRUPTED': {
      run.status = 'interrupted'
      const nodeId = event.nodeId
      run.interruptNodeId = nodeId
      if (nodeId) {
        const row = ensureRow(run, nodeId)
        row.status = 'interrupted'
        run.activeNodeId = nodeId
      }
      run.endedAt = now
      run.durationMs = run.startedAt != null ? Math.max(0, now - run.startedAt) : undefined
      finalizeSkipped(run)
      break
    }
    case 'DONE': {
      run.status = 'done'
      run.finalState = asObject(event.state)
      // 🔴 不把仍 'running' 的行提升为 success：running 只是「线性后继推断」的视觉态，
      //    真跑完的节点一定已发过 NODE 事件并被标 success/mock。DONE 时还 running = 从没执行 = 应 skip（下面 finalizeSkipped 收敛）。
      run.activeNodeId = undefined
      run.endedAt = now
      run.durationMs = run.startedAt != null ? Math.max(0, now - run.startedAt) : undefined
      finalizeSkipped(run)
      break
    }
    case 'ERROR': {
      run.status = 'failed'
      run.error = event.errorMsg || '沙箱执行失败'
      // 失败落在「正在跑」的节点上（NODE 事件到达前的那个）
      const running = runningRows(run)
      if (running.length > 0) {
        for (const r of running) {
          r.status = 'fail'
          r.errorMsg = run.error
        }
      }
      run.activeNodeId = undefined
      run.endedAt = now
      run.durationMs = run.startedAt != null ? Math.max(0, now - run.startedAt) : undefined
      finalizeSkipped(run)
      break
    }
    default:
      break
  }
  return run
}

/** 终态收敛：仍 'wait' 的行标 'skip'（整轮结束都没走到 = 分支未命中/被中断截断） */
const finalizeSkipped = (run: SandboxRun): void => {
  for (const r of run.rows) {
    if (r.status === 'wait' || r.status === 'running') r.status = 'skip'
  }
}

/** 画布高亮覆盖层的一格：设计器据此染节点边框色 + 角标 */
export interface SandboxOverlayCell {
  status: SandboxNodeStatus
  color: string
  label: string
}

/**
 * 把一轮沙箱的节点状态投影成「画布高亮覆盖层」：nodeId → {status,color,label}。
 * 🔴 wait 态不进覆盖层（还没轮到，不染，避免满屏灰）；其余态按语义色染边框，让作者边跑边在画布上看到进度。
 */
export const buildSandboxOverlay = (run: SandboxRun): Record<string, SandboxOverlayCell> => {
  const overlay: Record<string, SandboxOverlayCell> = {}
  for (const r of run.rows) {
    if (r.status === 'wait') continue
    const meta = sandboxStatusMeta(r.status)
    overlay[r.nodeId] = { status: r.status, color: meta.color, label: meta.label }
  }
  return overlay
}

// ==================== 测试输入 ====================

/** 支持的输入值类型（对齐 DSL variables[].type） */
export type SandboxInputType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any'

export interface SandboxInputField {
  key: string
  type: SandboxInputType
  required: boolean
  /** 类型中文提示（非技术人员友好） */
  hint: string
  /** 初始值（对象/数组用 JSON 文本，标量用字符串） */
  initial: string
}

const TYPE_HINTS: Record<SandboxInputType, string> = {
  string: '文本',
  number: '数字',
  boolean: '是/否',
  object: 'JSON 对象，如 {"a":1}',
  array: 'JSON 数组，如 [1,2,3]',
  any: '任意值（文本或 JSON）'
}

const normalizeType = (raw?: string): SandboxInputType => {
  const t = (raw ?? '').toLowerCase()
  if (t === 'number' || t === 'int' || t === 'integer' || t === 'long' || t === 'double') return 'number'
  if (t === 'boolean' || t === 'bool') return 'boolean'
  if (t === 'object' || t === 'map' || t === 'json') return 'object'
  if (t === 'array' || t === 'list') return 'array'
  if (t === 'string' || t === 'text') return 'string'
  return 'any'
}

/**
 * 从 DSL variables 生成测试输入表单字段（非技术人员友好：按声明的键逐个填，标类型提示）。
 *
 * 🔴 排除「流程自己产出的变量」：某个节点的 config.outputVar 与之同名（如 report / formList / output），
 *    说明它是跑出来的结果而不是入参。原先只按类型过滤，导致经典案例里的 report（string）被当成测试输入
 *    摆给作者填——既莫名其妙，填了还会被节点覆写，属于「配了但不生效且无提示」的典型。
 *    required=true 的仍然收（作者显式声明要外部给值，不与产出判定硬碰）。
 * 🔴 其余非必填的标量键仍列出来（可能是分支条件要读的入参）；面板另给「高级：直接编辑 JSON」兜底。
 */
export const buildSandboxInputFields = (dsl: EditorDsl): SandboxInputField[] => {
  const produced = new Set<string>()
  for (const n of asArray(dsl.nodes)) {
    const ov = asObject(asObject(n).config).outputVar
    if (typeof ov === 'string' && ov.trim()) produced.add(ov.trim())
  }

  const vars = asArray(dsl.variables)
  const fields: SandboxInputField[] = []
  for (const v of vars) {
    const key = asObject(v).key
    if (typeof key !== 'string' || !key) continue
    const type = normalizeType(asObject(v).type)
    const required = asObject(v).required === true
    if (produced.has(key) && !required) continue
    fields.push({
      key,
      type,
      required,
      hint: TYPE_HINTS[type],
      initial: ''
    })
  }
  return fields
}

/** 按声明类型把用户填的字符串转成真实值（对象/数组走 JSON.parse，失败回落原字符串） */
export const coerceInputValue = (raw: string, type: SandboxInputType): any => {
  const text = (raw ?? '').trim()
  if (text === '') return undefined
  switch (type) {
    case 'number': {
      const n = Number(text)
      return Number.isFinite(n) ? n : text
    }
    case 'boolean':
      return text === 'true' || text === '1' || text === '是' || text === 'yes'
    case 'object':
    case 'array': {
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
    case 'any': {
      // 像 JSON 就解析，否则当字符串
      if (/^[[{]/.test(text)) {
        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      }
      return text
    }
    default:
      return text
  }
}

/**
 * 表单模式下逐字段的格式检查：返回人话错误文案，合法（或无需检查）返回 ''。
 *
 * 🔴 coerceInputValue 对填错的情况一律「回落原字符串」，那是为了让流程总能跑起来，但副作用是
 *    作者把 `{a:1}`（少引号）填进 object 入参时，流程拿到的是字符串而不是对象，跑出来的结果莫名其妙，
 *    界面上却一句提示都没有 —— 正是本模块的头号缺陷「配了但不生效且无提示」。所以运行前必须挡一道。
 */
export const sandboxFieldJsonError = (
  raw: string | undefined,
  type: SandboxInputType
): string => {
  const text = (raw ?? '').trim()
  if (text === '') return ''
  if (type === 'number') {
    return Number.isFinite(Number(text)) ? '' : '这里要填数字，如 100'
  }
  if (type !== 'object' && type !== 'array' && type !== 'any') return ''
  // any 类型只在「看着像 JSON」时才要求它合法，否则就是个普通字符串
  if (type === 'any' && !/^[[{]/.test(text)) return ''
  try {
    const parsed = JSON.parse(text)
    if (type === 'array' && !Array.isArray(parsed)) return '这里要填 JSON 数组，如 [1,2,3]'
    if (
      type === 'object' &&
      (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    ) {
      return '这里要填 JSON 对象，如 {"a":1}'
    }
    return ''
  } catch (e: any) {
    return `JSON 格式错误：${e?.message ?? '格式不正确'}`
  }
}

/** 把表单字段收集成 input 对象（空值跳过，不塞 undefined 键） */
export const collectSandboxInput = (
  fields: { key: string; type: SandboxInputType; value?: string }[]
): Record<string, any> => {
  const out: Record<string, any> = {}
  for (const f of fields) {
    if (!f?.key) continue
    const val = coerceInputValue(f.value ?? '', f.type)
    if (val !== undefined) out[f.key] = val
  }
  return out
}

/**
 * 高级模式：把用户直接编辑的 JSON 文本解析成 input 对象。
 * 返回 {ok,value} 或 {ok:false,error}（面板显示错误、不发起运行）。空文本视为空对象、合法。
 */
export const parseSandboxInputText = (
  text: string
): { ok: true; value: Record<string, any> } | { ok: false; error: string } => {
  const t = (text ?? '').trim()
  if (!t) return { ok: true, value: {} }
  try {
    const parsed = JSON.parse(t)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: '请输入一个 JSON 对象，如 {"input":"你好"}' }
    }
    return { ok: true, value: parsed as Record<string, any> }
  } catch (e: any) {
    return { ok: false, error: `JSON 解析失败：${e?.message ?? '格式不正确'}` }
  }
}

/**
 * 把任意值渲染成面板可读的单行/多行文本（对象走 JSON，标量直转）。
 * 🔴 与 nodeSummary.readable 同旨，但这里保留完整 JSON（面板里可展开看全量），仅做安全 stringify。
 */
export const renderSandboxValue = (v: any): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
