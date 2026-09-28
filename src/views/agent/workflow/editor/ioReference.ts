/**
 * 变量引用的构造 / 解析 / 上游可达性 —— 类型化端口「点选上游产出」的核心逻辑（Phase E / Req5）
 *
 * 🔴 与 editorModel / nodeIoContract 同款纪律：纯函数、不依赖 Vue 运行时，便于 vitest 单测。
 *
 * 🔴 关键设计：本模块只产出 / 解析既有的 `{{$.var}}` 模板串，绝不引入第二套引用语义。
 *    「端口到端口连线」「属性面板选上游变量」最终都落成 `config[key] = "{{$.xxx}}"`，
 *    运行时仍由后端 StateTemplateResolver 解析 —— 故对存量流程 100% 向后兼容（Req6 红线）。
 *
 * 🔴 可达性判定与后端 `WorkflowDslValidator.validateReferenceReachability` 同口径：
 *    反向 BFS 求祖先集；引用变量若「有节点产出、但产出者都不在上游」→ 警告（非错误）。
 *    只读 `nodeIoContract` 登记的输出端口当「产出」，未登记的（如循环体 itemVar）不参与，避免误报。
 */

import type { EditorDsl, EditorDslEdge, EditorDslNode } from '../editorModel'
import {
  NODE_IO_CONTRACTS,
  resolveOutVarName,
  dataTypeLabel,
  type IoDataType,
  type OutPort
} from './nodeIoContract'

/** 抓取完整引用 `{{$.root.path.sub}}` → root + path（供 parseReference 判定「整段就是一个引用」） */
const FULL_REF_RE = /^\s*\{\{\s*\$\.([a-zA-Z][a-zA-Z0-9]*)((?:\.[A-Za-z0-9_]+)*)\s*\}\}\s*$/

/** 起点/终点伪根（不是数据变量，不参与可达性判定） */
const PSEUDO = new Set(['START', 'END', '__START__', '__END__'])

/** 条件边判定（与 editorModel.isConditionalEdge 同口径） */
const isConditional = (e: EditorDslEdge): boolean =>
  (e.type ?? '').toLowerCase() === 'conditional' || (!!e.cases && Object.keys(e.cases).length > 0)

/** 一条边的全部目标端点：普通边 = {to}；条件边 = cases 的值 + default */
const edgeTargets = (e: EditorDslEdge): string[] => {
  if (!e) return []
  if (isConditional(e)) {
    const out: string[] = []
    for (const v of Object.values(e.cases ?? {})) if (v) out.push(String(v))
    if (e.default) out.push(String(e.default))
    return out
  }
  return e.to ? [String(e.to)] : []
}

const nodesOf = (dsl: EditorDsl): EditorDslNode[] => (Array.isArray(dsl?.nodes) ? dsl.nodes : [])
const edgesOf = (dsl: EditorDsl): EditorDslEdge[] => (Array.isArray(dsl?.edges) ? dsl.edges : [])

/** 展示用节点名：有 name 用 name，否则回退 id / 「第 N 步」 */
const labelOf = (n: EditorDslNode | undefined, i = 0): string => {
  if (!n) return `第 ${i + 1} 步`
  return n.name?.trim() || n.id || `第 ${i + 1} 步`
}

/** 构造引用串：`{{$.varName}}` 或带路径 `{{$.varName.path}}` */
export const buildReference = (varName: string, path?: string): string => {
  const name = (varName ?? '').trim()
  if (!name) return ''
  const p = (path ?? '').replace(/^[.$\s]+/, '').trim()
  return p ? `{{$.${name}.${p}}}` : `{{$.${name}}}`
}

/** 解析「整段就是一个引用」的文本；不是单一完整引用（含字面量混排 / 多段）返回 null */
export const parseReference = (text: unknown): { root: string; path: string } | null => {
  if (typeof text !== 'string') return null
  const m = FULL_REF_RE.exec(text)
  if (!m) return null
  return { root: m[1], path: (m[2] ?? '').replace(/^\./, '') }
}

/** 递归收集任意值里 `{{$.x}}` 的全部根变量名（字符串 / 对象值 / 数组元素都下钻） */
export const collectRoots = (value: unknown, sink: Set<string> = new Set()): Set<string> => {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/\{\{\s*\$\.([a-zA-Z][a-zA-Z0-9_]*)/g)) sink.add(m[1])
  } else if (Array.isArray(value)) {
    for (const item of value) collectRoots(item, sink)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectRoots(v, sink)
  }
  return sink
}

/** 变量名 → 产出它的节点 id 集合（仅取契约登记的输出端口，对齐后端口径） */
export const producersOf = (dsl: EditorDsl): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>()
  for (const n of nodesOf(dsl)) {
    if (!n?.id) continue
    const c = NODE_IO_CONTRACTS[n.type ?? '']
    if (!c) continue
    for (const p of c.outputs) {
      const varName = resolveOutVarName(n, p)
      if (varName) {
        if (!map.has(varName)) map.set(varName, new Set())
        map.get(varName)!.add(n.id)
      }
    }
  }
  return map
}

/** 反向邻接：to → from 集合（普通边看 to；条件边看 cases 值 + default；END/空 跳过） */
const buildIncoming = (dsl: EditorDsl): Map<string, Set<string>> => {
  const inc = new Map<string, Set<string>>()
  for (const e of edgesOf(dsl)) {
    const from = e?.from ? String(e.from) : ''
    if (!from) continue
    for (const to of edgeTargets(e)) {
      if (!to || to === 'END') continue
      if (!inc.has(to)) inc.set(to, new Set())
      inc.get(to)!.add(from)
    }
  }
  return inc
}

/** 从某节点出发沿反向边 BFS 收集祖先（includeSelf 默认 true，对齐后端） */
export const ancestorsOf = (
  dsl: EditorDsl,
  startId: string,
  opts: { includeSelf?: boolean } = {}
): Set<string> => {
  const includeSelf = opts.includeSelf !== false
  const incoming = buildIncoming(dsl)
  const visited = new Set<string>()
  const queue: string[] = [startId]
  if (includeSelf) visited.add(startId)
  while (queue.length) {
    const cur = queue.shift()!
    for (const prev of incoming.get(cur) ?? []) {
      if (!visited.has(prev)) {
        visited.add(prev)
        queue.push(prev)
      }
    }
  }
  if (!includeSelf) visited.delete(startId)
  return visited
}

/** 上游某节点的一个可引用产出 */
export interface UpstreamVar {
  /** 变量名（写进引用串 `{{$.varName}}` 的那个） */
  varName: string
  dataType: IoDataType
  /** 面向业务人员的中文说明（「节点名：端口 label」） */
  label: string
  /** 产出该变量的上游节点 */
  nodeId: string
  nodeName: string
  /** 端口对应的 config 键（null = 恒用默认名） */
  configKey: string | null
  dataTypeLabel: string
}

/**
 * 计算某节点上游可达的全部产出变量（供属性面板「引用选择器」下拉 / 画布端口连线用）。
 * 沿反向边 BFS 求祖先（不含自身），按节点声明顺序收集各祖先契约的输出端口；同名变量去重。
 */
export const computeUpstreamOutputs = (dsl: EditorDsl, nodeId: string): UpstreamVar[] => {
  if (!nodeId) return []
  const ancestors = ancestorsOf(dsl, nodeId, { includeSelf: false })
  if (!ancestors.size) return []
  const result: UpstreamVar[] = []
  const seenVar = new Set<string>()
  for (const n of nodesOf(dsl)) {
    if (!n?.id || !ancestors.has(n.id)) continue
    const c = NODE_IO_CONTRACTS[n.type ?? '']
    if (!c) continue
    const nodeName = labelOf(n)
    for (const op of c.outputs) {
      const varName = resolveOutVarName(n, op)
      if (!varName || seenVar.has(varName)) continue
      seenVar.add(varName)
      result.push({
        varName,
        dataType: op.dataType,
        label: `${nodeName}：${op.label}`,
        nodeId: n.id,
        nodeName,
        configKey: op.configKey,
        dataTypeLabel: dataTypeLabel(op.dataType)
      })
    }
  }
  return result
}

export interface ReferenceWarning {
  nodeId: string
  nodeName: string
  varName: string
  kind: 'unreachable'
  message: string
}

/**
 * 校验引用可达性（🔴 只出「警告」，绝不阻断）：节点引用了 `{{$.x}}`，而产出 x 的节点不在它的上游 →
 * 运行到本节点时 x 很可能还没值。与后端 `WorkflowDslValidator.validateReferenceReachability` 同口径。
 *
 * 🔴 刻意只对「有产出者的变量」判定：未登记的变量（循环体 itemVar、声明变量、input、脚本内部 state 等）
 *    直接跳过，避免对合法的老流程 / 子图变量误报。故只输出 'unreachable' 一类警告。
 */
export const validateReferences = (dsl: EditorDsl): ReferenceWarning[] => {
  const producers = producersOf(dsl)
  if (!producers.size) return []
  const warnings: ReferenceWarning[] = []
  const nodes = nodesOf(dsl)
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (!n?.id || !n.config) continue
    const ancestors = ancestorsOf(dsl, n.id, { includeSelf: true })
    const refs = collectRoots(n.config)
    const nodeName = labelOf(n, i)
    for (const ref of refs) {
      if (PSEUDO.has(ref)) continue
      const prod = producers.get(ref)
      if (!prod || prod.size === 0) continue // 非「节点产出」变量：可达性不适用
      let reachable = false
      for (const p of prod) if (ancestors.has(p)) { reachable = true; break }
      if (!reachable) {
        warnings.push({
          nodeId: n.id,
          nodeName,
          varName: ref,
          kind: 'unreachable',
          message: `节点「${nodeName}」引用了 {{$.${ref}}}，但产出「${ref}」的节点不在它的上游——运行到这里时「${ref}」很可能还没有值。请把产出该变量的节点排到本节点之前，或改为引用已声明变量 / 字面值。`
        })
      }
    }
  }
  return warnings
}

/** 本节点输出的人话描述 + 下游引用示例（Req5「后序节点如何引用」） */
export interface OutputDoc {
  varName: string
  dataType: IoDataType
  dataTypeLabel: string
  label: string
  example: string
}

export const howDownstreamReferences = (node: EditorDslNode | null | undefined): OutputDoc[] => {
  if (!node) return []
  const c = NODE_IO_CONTRACTS[node.type ?? '']
  if (!c) return []
  const out: OutputDoc[] = []
  const seen = new Set<string>()
  for (const op of c.outputs as OutPort[]) {
    const varName = resolveOutVarName(node, op)
    if (!varName || seen.has(varName)) continue
    seen.add(varName)
    out.push({
      varName,
      dataType: op.dataType,
      dataTypeLabel: dataTypeLabel(op.dataType),
      label: op.label,
      example: `{{$.${varName}}}`
    })
  }
  return out
}
