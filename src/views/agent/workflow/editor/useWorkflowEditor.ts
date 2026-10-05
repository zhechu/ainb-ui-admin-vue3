import { computed, onMounted, ref, watch, type Ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { ElMessageBox } from 'element-plus'
import type { Edge, Node } from '@vue-flow/core'
import { MarkerType } from '@vue-flow/core'
import { useMessage } from '@/hooks/web/useMessage'
import { ModelApi, type ModelVO } from '@/api/ai/model/model'
import { KnowledgeApi, type KnowledgeVO } from '@/api/ai/knowledge/knowledge'
import type { NameCatalogToolVO } from '@/api/agent/workflow'
import { layoutDsl, X_GAP, Y_GAP } from '../layout'
import {
  ensureLoaded as ensureNameCatalog,
  gateRiskOf,
  groupedToolOptions,
  keyedLabel,
  nameCatalogError,
  nameResolver,
  toolItems,
  workflowItems
} from '../nameCatalog'
import {
  NODE_TYPE_OPTIONS,
  DEFAULT_ROUTE,
  RULE_OPS,
  nodeTypeLabel,
  nodeTypeTag,
  addNode,
  removeNode,
  addEdge,
  removeEdge,
  setEdgeCase,
  setEdgeDefault,
  addRuleBranch,
  removeRuleBranch,
  addRuleCondition,
  removeRuleCondition,
  branchUsesGroups,
  applyPositionsToDsl,
  readPositionsFromDsl,
  isNonCompensableType,
  getNodeRecovery,
  setNodeRecovery,
  ensureCompensation,
  type EditorDsl,
  type EditorDslEdge,
  type EditorDslNode
} from '../editorModel'
import { NODE_TYPE_META, NODE_TYPE_GROUPS } from '../nodeSummary'
import { fieldsFor, jsonHintFor, isFieldVisible, type ConfigField } from '../nodeConfigSchema'
import {
  contractOf,
  referenceForm,
  showsWholeValueRefPicker,
  dataTypeColor,
  dataTypeLabel,
  resolvedOutputsOf,
  type IoDataType
} from './nodeIoContract'
import {
  computeUpstreamOutputs,
  validateReferences,
  howDownstreamReferences,
  type UpstreamVar,
  type ReferenceWarning,
  type OutputDoc
} from './ioReference'
import { insertAfter, isConditionNode, isConditionalEdge, routeKeyCandidates } from './graphEdit'

/**
 * tags 字段（`agent_loop.tools` / `iteration.body` / `condition.llm.choices`）下拉的一项。
 *
 * 🔴 `block` 不是「暂时不可选」，是「选了必被后端 error 拦下」。short 印在选项行右侧、long 挂 title ——
 *    只置灰不说原因，等于把「发布时才炸」提前成「不知道为什么点不动」，那还是同一个病换了个位置。
 * 🔴 刻意用 disabled 而不是**从列表里滤掉**：这个字段开着 `allow-create`，任何键都能手打进去，
 *    AI 生成 / 手写的 DSL 里也可能本来就有。滤掉只是把候选藏了，坑还在；置灰 + 说原因才是在教约束。
 *    另外 Element Plus 对已选中的 disabled 项**照样给出 label**（`getOption` 只按 value 匹配 cachedOptions，
 *    不看 disabled），所以存量 DSL 里的写工具仍显示「中文名（机器键）」，不会退化成一串裸键。
 * 🔴 风险那几个字段由 tools 分支透传（`Partial<NameCatalogToolVO>`），面板据此画色点、写 title；
 *    body / choices 分支不填，面板就不画点。
 */
export type TagsOption = {
  label: string
  value: string
  block?: { short: string; long: string }
} & Partial<NameCatalogToolVO>

/**
 * `agent_loop.tools` 里这一项为什么挑不动；能挑返回 undefined。
 *
 * 🔴 判据一律取【声明】风险（`declaredRequireConfirm` / `gateRiskOf`），与后端三道闸同地基：
 *    `WorkflowDslValidator.checkToolRef`（体检，读 `declaredRiskOf`）、
 *    `AgentLoopGraphBuilder` 编译期那道、以及它运行期循环里的最后一道。
 *    按生效值判就是 D4-22 那个病：管理员把某工具降过险，界面说「可选」，点发布照样被拒。
 * 🔴 「是不是只读」问的是 `requireConfirm`，不是自己拿风险串去比 `=== 'READ_ONLY'`：
 *    后端 `RiskLevel` 五个值里只有 READ_ONLY 的 requireConfirm 是 false，这个等价关系是它自己给的；
 *    前端再抄一份等级清单，将来后端加一档就会静默判错（`nameCatalog.RISK_TAG_TYPE` 注释里那种坏法）。
 * 🔴 字段缺失（后端未升级 / 目录加载失败）时返回 undefined = 不置灰。宁可少拦一个，
 *    也不要把整个下拉全灰掉；真正的闸在后端，这里只负责别把用户往坑里指。
 *
 * ⚠️ 还有一条这里**刻意没判**：`agent_loop.tools` 只认内置注册表（`AgentLoopGraphBuilder` 里
 *    `toolRegistry.get(name) == null` 就抛「未登记」），故自定义工具（`source !== 'BUILTIN'`）
 *    体检的结构层不报、要到编译期干跑才报。不在前端补这一条的理由与后端
 *    `WorkflowDslValidator.validateToolRefs` 注释里那条「刻意不复制」相同：哪天编译期支持了
 *    自定义只读工具，前端这份副本就成了假拦截。要补得先裁定，别顺手加。
 */
const agentLoopToolBlock = (t: NameCatalogToolVO): { short: string; long: string } | undefined => {
  if ((t.declaredRequireConfirm ?? t.requireConfirm) !== true) return undefined
  const risk = t.declaredRiskDescription || t.riskDescription || gateRiskOf(t) || '非只读'
  return {
    short: '非只读',
    long:
      `agent_loop 只允许只读工具，「${t.displayName || t.name}」的声明风险是「${risk}」。` +
      '自主循环里的模型调用不逐次过 Plan 确认，把写工具放进去等于让模型无人值守地改数据。' +
      '写操作请让 agent_loop 出结论后接 tool 节点，或在它前面加 hitl 确认。'
  }
}

/**
 * 流程设计器的「共享编辑上下文」（增量8 / P4，Phase C）
 *
 * 从 1515 行的巨型组件 WorkflowEditorCanvas.vue 抽出的全部编辑状态与逻辑，供三栏拆分后的
 * WorkflowPalette / WorkflowDesigner / WorkflowPropertyPanel 共用（父页 index.vue 建一份、以 prop 下发）。
 *
 * 🔴 与旧画布同源纪律：事实源是外部传入的 `dslObject`（页面持有），Vue Flow 图只是它的派生视图；
 *    所有增删改都走 editorModel 纯函数就地改 `dslObject.value`，再 buildFlow() 重算——绝不「从图反推 DSL」。
 * 🔴 撤销/重做不在本文件：页面用 `watch(dslObject, {deep})` 监听「就地突变」自动入栈（见 editorHistory.ts）。
 *    本文件只负责「改 dslObject + 重算视图 + 通知页面标脏(onChange)」，改完 history 自然被页面捕获。
 * 🔴 坐标：`dslObject` 各节点的 position 是持久化布局；会话内拖动先记 positions 覆盖层，并同步写回节点
 *    position（C4 修复：让移动可撤销、可标脏）；页面保存经 getDslText()（内部 applyPositionsToDsl）序列化。
 */
export function useWorkflowEditor(
  dslObject: Ref<EditorDsl>,
  options: { readonly: Ref<boolean>; onChange: () => void }
) {
  const readonly = options.readonly
  const onChange = options.onChange
  const message = useMessage()

  /** layout.ts 内部用的合成端点视觉 id / DSL 保留字（复刻，layout.ts 未导出这几个常量） */
  const START_VISUAL_ID = '__start__'
  const END_VISUAL_ID = '__end__'
  const START_KEYWORD = 'START'
  const END_KEYWORD = 'END'

  /** 拖拽落点的 dataTransfer 类型（自定义 MIME，避免与文件拖入等冲突） */
  const DND_MIME = 'application/x-workflow-node'

  /**
   * 补偿字段占位示例。放常量而非写死在模板属性里：内容含字面「双花括号 + $.路径」模板，
   * 写进模板属性会被 vue 编译器当成插值表达式解析报错。
   */
  const BEFORE_IMAGE_PLACEHOLDER = '{"recordId": "{{$.create_out.id}}"}'
  const IDEMPOTENCY_KEY_PLACEHOLDER = '如 {{$.execution.id}}:create_order'

  /** 独立 store id：一个页面只有一个画布实例，Designer 用 useVueFlow(flowId) 拿缩放/坐标换算 API */
  const flowId = `wf-editor-${Math.random().toString(36).slice(2, 8)}`

  const parseError = ref('')
  /**
   * 开发者模式（默认关，持久化到 localStorage）：开启后才展示底部流程 JSON、每节点 config JSON、
   * 失败恢复与补偿（Saga）等高级/技术项。对标表单设计器「JSON 预览刻意隐藏」，让零基础用户只看结构化面板。
   */
  const devMode = useLocalStorage('agent-wf-dev-mode', false)

  /** 编辑会话内的坐标覆盖层（视觉/节点 id → 位置），保存时经 getDslText 写回 DSL 各节点 position */
  const positions = ref<Record<string, { x: number; y: number }>>({})
  const flowNodes = ref<Node[]>([])
  const flowEdges = ref<Edge[]>([])
  const selectedNodeId = ref<string | null>(null)
  const selectedEdge = ref<{ from: string; to: string; route?: string } | null>(null)
  const dslText = ref('')
  const configText = ref('{}')
  /**
   * 工具目录（内置 + 用户自定义合流），来自 `/agent/workflow-def/name-catalog`。
   *
   * 🔴 数据源从 `/agent/config/tool-list` 换过来是 G7 的修复本体：那个接口要 `agent:config:query`，
   * 只有流程编排权限的人拿不到，而旧代码 `.catch(() => [])` 把 403 静默吞成空数组 ——
   * 用户看到的是一个**空下拉 + 零提示**，只能靠 `allow-create` 手打英文工具名。
   * name-catalog 用 `agent:workflow:query`（设计器本来就有的权限），且失败会写 {@link nameCatalogError}。
   *
   * 🔴 做成 computed 而不是 ref + 赋值：目录是模块级共享单例，别处（如管理页维护完工具）调 `refresh()`
   * 之后这里会自动跟上，不必再补一条「谁负责回填 toolList」的约定。
   */
  const toolList = computed<NameCatalogToolVO[]>(() => toolItems())
  const modelList = ref<ModelVO[]>([])
  const kbList = ref<KnowledgeVO[]>([])
  const workflowList = ref<{ label: string; value: string }[]>([])

  /** 归一化：保证 nodes/edges 是数组、每个节点有 config 对象（配置面板 v-model 依赖它非空） */
  const normalize = (parsed: any): EditorDsl => {
    const d: EditorDsl = parsed && typeof parsed === 'object' ? parsed : {}
    if (!Array.isArray(d.nodes)) d.nodes = []
    if (!Array.isArray(d.edges)) d.edges = []
    for (const n of d.nodes) {
      if (n && (!n.config || typeof n.config !== 'object')) n.config = {}
    }
    return d
  }

  // ---------- 左侧目录 ----------

  const paletteGroups = computed(() =>
    NODE_TYPE_GROUPS.map((name) => ({
      name,
      items: NODE_TYPE_OPTIONS.filter((o) => NODE_TYPE_META[o.value]?.group === name).map((o) => ({
        ...o,
        description: NODE_TYPE_META[o.value]?.description ?? ''
      }))
    })).filter((g) => g.items.length)
  )

  const onPaletteDragStart = (event: DragEvent, type: string) => {
    event.dataTransfer?.setData(DND_MIME, type)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (event: DragEvent) => {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  /** 在指定画布坐标新增节点（拖拽落点由 Designer 换算好坐标后调用） */
  const addNodeAt = (type: string, pos?: { x: number; y: number }) => {
    if (readonly.value) return
    const id = addNode(dslObject.value, type)
    if (pos) positions.value[id] = { x: pos.x, y: pos.y }
    selectedNodeId.value = id
    selectedEdge.value = null
    buildFlow()
    onChange()
  }

  const addNodeByClick = (type: string) => {
    if (readonly.value) return
    const id = addNode(dslObject.value, type)
    selectedNodeId.value = id
    selectedEdge.value = null
    buildFlow()
    onChange()
  }

  /** 空画布引导：插入「检索资料 → 大模型总结 → 人工确认 →（拒绝则重写）」示例骨架 */
  const insertSample = () => {
    const kr = addNode(dslObject.value, 'knowledge_retrieval')
    dslObject.value.nodes!.find((n) => n.id === kr)!.name = '检索资料'
    const llm = addNode(dslObject.value, 'llm')
    dslObject.value.nodes!.find((n) => n.id === llm)!.name = '生成总结'
    const hitl = addNode(dslObject.value, 'hitl.confirm')
    dslObject.value.nodes!.find((n) => n.id === hitl)!.name = '人工确认'
    const cond = addNode(dslObject.value, 'condition.rule')
    dslObject.value.nodes!.find((n) => n.id === cond)!.name = '确认结果判断'
    dslObject.value.edges = [
      { from: START_KEYWORD, to: kr },
      { from: kr, to: llm },
      { from: llm, to: hitl },
      { from: hitl, to: cond },
      { from: cond, type: 'conditional', cases: { approved: END_KEYWORD, rejected: llm } }
    ]
    selectedNodeId.value = null
    selectedEdge.value = null
    buildFlow()
    onChange()
  }

  // ---------- 画布视图 ----------

  const selectedNode = computed(() =>
    selectedNodeId.value
      ? (dslObject.value.nodes ?? []).find((n) => n.id === selectedNodeId.value)
      : undefined
  )

  /** 视觉 id ⇄ DSL 保留字/节点 id 的双向映射 */
  const toVisual = (ref: string): string =>
    ref === START_KEYWORD ? START_VISUAL_ID : ref === END_KEYWORD ? END_VISUAL_ID : ref
  const toDsl = (visualId: string): string =>
    visualId === START_VISUAL_ID ? START_KEYWORD : visualId === END_VISUAL_ID ? END_KEYWORD : visualId

  const syncDslText = () => {
    dslText.value = JSON.stringify(dslObject.value, null, 2)
  }

  /**
   * 由 DSL 重算画布视图：layoutDsl 出节点坐标（持久化 position 优先）→ 覆盖会话内已拖动位置 →
   * 按 dsl.edges 自建带 data(from/to/route) 的边（条件边展开成多条带 label 的虚线边）。
   * 🔴 边不复用 layoutDsl 产出的（那批不带原始 from/to/route，删边时无法反查 DSL）。
   */
  const buildFlow = () => {
    // EditorDsl 是 DslGraph 的超集，layoutDsl 只防御性读取少数字段，as any 跨过结构差异
    // 🔴 传 nameResolver：画布节点摘要才会显示「调用工具「创建数据表」（datamodel_create）」而不是裸工具键。
    //    目录是异步加载的，所以 loadCatalogs 完成后要再 buildFlow() 一次（见下）。
    const { nodes } = layoutDsl(dslObject.value as any, nameResolver)
    const dslNodeById = new Map((dslObject.value.nodes ?? []).map((n) => [n.id, n]))
    for (const n of nodes) {
      const isStart = n.id === START_VISUAL_ID
      const isEnd = n.id === END_VISUAL_ID
      // Phase E：节点卡上直接标出「本节点产出哪些变量」（据契约 + 当前 outputVar），让前序产出在画布一眼可见
      const dslNode = isStart || isEnd ? undefined : dslNodeById.get(n.id)
      const outVars = dslNode
        ? resolvedOutputsOf(dslNode).map((o) => ({ name: o.varName, color: dataTypeColor(o.dataType) }))
        : []
      n.data = {
        ...(n.data ?? {}),
        dslId: isStart || isEnd ? null : n.id,
        // Req7：节点右侧「+」要知道自己接在谁后面。合成端点的 DSL 引用是保留字 START/END（不是 null），
        // 这样「开始」节点也能挂「+」，一键把第一个节点插到 START 之后。
        dslRef: isStart ? START_KEYWORD : isEnd ? END_KEYWORD : n.id,
        isStart,
        isEnd,
        outVars
      }
      const stored = positions.value[n.id]
      if (stored) n.position = { x: stored.x, y: stored.y }
    }

    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges: Edge[] = []
    let seq = 0
    const push = (fromRef: string, toRef: string, route?: string, label?: string) => {
      const source = toVisual(fromRef)
      const target = toVisual(toRef)
      if (!nodeIds.has(source) || !nodeIds.has(target)) return
      edges.push({
        id: `e-${seq++}-${route ?? 'main'}`,
        source,
        target,
        label: label || undefined,
        type: 'default',
        markerEnd: MarkerType.ArrowClosed,
        style: label ? { strokeDasharray: '4 3' } : undefined,
        data: { from: fromRef, to: toRef, route }
      })
    }
    for (const e of dslObject.value.edges ?? []) {
      if (!e) continue
      if (isConditionalEdge(e)) {
        for (const [routeKey, tgt] of Object.entries(e.cases ?? {})) {
          if (tgt) push(e.from, tgt, routeKey, routeKey)
        }
        if (e.default) push(e.from, e.default, DEFAULT_ROUTE, 'default')
      } else if (e.to) {
        push(e.from, e.to, undefined, undefined)
      }
    }

    flowNodes.value = nodes
    flowEdges.value = edges
    syncDslText()
  }

  /** 就地突变后的统一收口：重算视图 + 通知页面标脏（history 由页面 deep-watch 自动入栈） */
  const mutate = () => {
    buildFlow()
    onChange()
  }

  /**
   * 引用整体换新（页面载入 / 撤销 / 重做 / JSON 兜底替换）时重算画布。
   * 🔴 必须注册在 buildFlow/mutate 定义之后——immediate 回调同步执行会调用 buildFlow，放前面会撞 TDZ。
   *    只监听引用变化(deep:false)：就地突变由 mutate 显式 buildFlow，不劳 watch（也避免与页面 deep-watch 打架）。
   */
  watch(
    dslObject,
    () => {
      parseError.value = ''
      selectedNodeId.value = null
      selectedEdge.value = null
      positions.value = readPositionsFromDsl(dslObject.value)
      buildFlow()
    },
    { immediate: true, deep: false }
  )

  const onConnect = async (params: any) => {
    const from = toDsl(params.source)
    const to = toDsl(params.target)
    if (!from || !to || from === to) return
    // 条件节点拉线：弹可视化分支选择（替代逼用户手输路由键），选中即写进该 from 的 conditional 边 cases
    const src = (dslObject.value.nodes ?? []).find((n) => n.id === from)
    if (src && (src.type ?? '').startsWith('condition.')) {
      const candidates = routeKeyCandidates(src)
      let routeKey = ''
      if (candidates.length) {
        const picked = await openRouteDialog(candidates)
        if (!picked) return // 取消 = 不连线
        routeKey = picked
      } else {
        try {
          const res = await ElMessageBox.prompt(
            '这个条件节点还没有配置分支。建议先在右侧面板为它添加分支后再连线；也可以先临时输入一个分支名。',
            '这条连线代表哪个分支？',
            {
              confirmButtonText: '确定',
              cancelButtonText: '取消',
              inputPlaceholder: '分支名',
              inputValidator: (v: string) => (v && v.trim() ? true : '分支名不能为空')
            }
          )
          routeKey = (res.value ?? '').trim()
        } catch {
          return // 取消 = 不连线
        }
      }
      if (!routeKey) return
      setEdgeCase(dslObject.value, from, routeKey, to)
      mutate()
      return
    }
    addEdge(dslObject.value, from, to)
    mutate()
  }

  // ---------- 条件分支可视化选择弹窗（替代 ElMessageBox.prompt 手输路由键） ----------
  const routeDialogVisible = ref(false)
  const routeDialogCandidates = ref<string[]>([])
  const routeDialogSelected = ref('')
  let routeDialogResolve: ((key: string | null) => void) | null = null

  /** 结算弹窗：先摘掉 resolver 再回调，保证「确定」后 el-dialog 的 @close 再触发也不会二次覆盖结果 */
  const settleRoute = (key: string | null) => {
    const r = routeDialogResolve
    routeDialogResolve = null
    r?.(key)
  }
  const openRouteDialog = (candidates: string[]): Promise<string | null> => {
    routeDialogCandidates.value = candidates
    routeDialogSelected.value = candidates[0] ?? ''
    routeDialogVisible.value = true
    return new Promise((resolve) => {
      routeDialogResolve = resolve
    })
  }
  const confirmRouteDialog = () => {
    settleRoute(routeDialogSelected.value.trim() || null)
    routeDialogVisible.value = false
  }
  const cancelRouteDialog = () => {
    settleRoute(null)
    routeDialogVisible.value = false
  }
  const routeTargetName = (routeKey: string): string => {
    const n = (dslObject.value.nodes ?? []).find((x) => x.id === routeKey)
    return n?.name || routeKey
  }

  /**
   * 🔴 C4 修复：拖动结束把新坐标写回对应 DSL 节点 position（原来只记 positions 覆盖层，不落 DSL、
   * 不标脏、逃过撤销）。写回后就地突变触发页面 deep-watch → 入撤销栈 + 标脏，使「移动节点」可撤销。
   */
  const onNodeDragStop = (payload: any) => {
    const node = payload?.node
    if (!node?.id) return
    const pos = { x: node.position?.x ?? 0, y: node.position?.y ?? 0 }
    positions.value[node.id] = pos
    const target = (dslObject.value.nodes ?? []).find((n) => n.id === node.id)
    if (target) {
      target.position = { x: pos.x, y: pos.y }
      onChange()
    }
  }

  const selectNode = (visualNodeId: string | null) => {
    selectedEdge.value = null
    selectedNodeId.value = visualNodeId
  }
  const onNodeClick = (payload: any) => selectNode(payload?.node?.data?.dslId ?? null)

  const onEdgeClick = (payload: any) => {
    const d = payload?.edge?.data
    selectedNodeId.value = null
    selectedEdge.value = d ? { from: d.from, to: d.to, route: d.route } : null
  }

  const clearSelection = () => {
    selectedNodeId.value = null
    selectedEdge.value = null
  }

  /**
   * 删除选中节点（指向它的连线与条件分支 case 由 removeNode 一并清理）
   *
   * 🔴 不做二次确认：顶栏「撤销」就是这类误删的兜底，再弹一次确认只是把一次点击变成两次，
   *    且确认框挡住的恰是画布——用户看不到自己删的是哪个节点，确认反而更容易点错。
   */
  const deleteNode = () => {
    if (!selectedNodeId.value || readonly.value) return
    removeNode(dslObject.value, selectedNodeId.value)
    delete positions.value[selectedNodeId.value]
    selectedNodeId.value = null
    mutate()
  }

  /** 删除选中连线（普通边整条删；条件边只删该 route 对应的 case/default）。同样不做二次确认，撤销兜底 */
  const deleteEdge = () => {
    if (!selectedEdge.value || readonly.value) return
    const { from, to, route } = selectedEdge.value
    removeEdge(dslObject.value, from, to, route)
    selectedEdge.value = null
    mutate()
  }

  /**
   * Req7：节点右侧「+」快捷加节点 —— 在 sourceRef（节点 id 或 START 保留字）之后插入新节点并自动接线。
   *
   * 🔴 接线语义交给 graphEdit.insertAfter（纯函数 + 单测）：起点只有一条普通出边就**插进连线中间**
   *    （source→new→next），否则只加 source→new。绝不让普通节点留下两条出边——那在编译期就是歧义。
   * 🔴 条件节点（condition.*）的出边挂在路由键上，必须先问清「走哪个分支」；还没配分支就直接提示去面板加。
   *    顺序很要紧：**先问路由键、后建节点**，否则用户一取消就留下一个孤立节点（脏图，还得再删一次）。
   * 🔴 落点基准取「当前渲染坐标」而不是 DSL 里的 position：没拖动过的节点 position 是空的，
   *    坐标由 layoutDsl 现算，只有 flowNodes 里那份才是画布上真实看到的位置。
   *    往右下各错开半格/一格（直接取 layout 导出的 X_GAP/Y_GAP，不写死数字：改了间距这里自动跟上）——
   *    既不压住原节点，也不去挪动别的节点：整体平移下游会连带改掉用户手工拖出来的布局，
   *    代价大于收益；要收拾整齐用顶栏「重新布局」。
   */
  const addNodeAfter = async (sourceRef: string, type: string): Promise<string | null> => {
    if (readonly.value || !sourceRef || sourceRef === END_KEYWORD) return null
    const src = (dslObject.value.nodes ?? []).find((n) => n.id === sourceRef)
    if (sourceRef !== START_KEYWORD && !src) return null

    let routeKey = ''
    if (isConditionNode(src)) {
      const candidates = routeKeyCandidates(src)
      if (!candidates.length) {
        message.warning('这个条件节点还没有配置分支：请先在右侧面板「添加分支」，再从分支上加节点')
        return null
      }
      const picked = await openRouteDialog(candidates)
      if (!picked) return null // 取消 = 什么都不做
      routeKey = picked
    }

    const base = flowNodes.value.find((n) => n.id === toVisual(sourceRef))?.position ?? { x: 0, y: 0 }
    const pos = { x: base.x + X_GAP / 2, y: base.y + Y_GAP }

    const id = addNode(dslObject.value, type)
    const created = (dslObject.value.nodes ?? []).find((n) => n.id === id)
    if (created) created.position = { ...pos }
    positions.value[id] = { ...pos }
    insertAfter(dslObject.value, { sourceRef, newId: id, routeKey: routeKey || undefined })

    selectedNodeId.value = id
    selectedEdge.value = null
    mutate()
    return id
  }

  /** 重新布局：清空会话坐标覆盖层，回到 layoutDsl 的自动分层坐标（持久化 position 也会被覆盖层清掉后重算） */
  const relayout = () => {
    positions.value = {}
    // 同步抹掉 DSL 里的 position，让 layoutDsl 全自动分层（否则 buildFlow 仍读节点 position）
    for (const n of dslObject.value.nodes ?? []) delete (n as any).position
    buildFlow()
    onChange()
  }

  // ---------- 右侧面板：节点 ----------

  /**
   * 选中节点的 config，恒为对象。getter 返回 DSL 里那个真实 config 对象引用，
   * 故面板 v-model 写 selConfig.xxx 即写回 DSL（与旧画布同款「真实引用」手法）。
   */
  const selConfig = computed<Record<string, any>>(() => selectedNode.value?.config ?? {})

  const nonCompensable = computed(() => isNonCompensableType(selectedNode.value?.type))

  const nodeRecovery = computed(() =>
    selectedNode.value ? getNodeRecovery(selectedNode.value as EditorDslNode) : ''
  )

  const selComp = computed<Record<string, any>>(() => {
    const n = selectedNode.value as EditorDslNode | undefined
    if (!n) return {}
    return n.recovery === 'compensate'
      ? ensureCompensation(n)
      : n.compensation && typeof n.compensation === 'object' && !Array.isArray(n.compensation)
        ? n.compensation
        : {}
  })

  const beforeImageText = ref('')

  const onRecoveryChange = (value: '' | 'forward' | 'compensate') => {
    const n = selectedNode.value as EditorDslNode | undefined
    if (!n) return
    setNodeRecovery(n, value)
    if (value === 'compensate') {
      beforeImageText.value = n.compensation?.before_image
        ? JSON.stringify(n.compensation.before_image, null, 2)
        : ''
    }
    mutate()
  }

  const onBeforeImageChange = () => {
    const text = beforeImageText.value.trim()
    if (!text) {
      delete selComp.value.before_image
      mutate()
      return
    }
    try {
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('before_image 必须是 JSON 对象（参数名 → 模板）')
      }
      selComp.value.before_image = parsed
      mutate()
    } catch (e: any) {
      message.error(`before_image 解析失败：${e?.message ?? '格式不合法'}`)
    }
  }

  const visibleFields = computed<ConfigField[]>(() =>
    fieldsFor(selectedNode.value?.type).filter((f) => isFieldVisible(f, selConfig.value))
  )

  const jsonHint = computed(() => jsonHintFor(selectedNode.value?.type))

  // ---------- Phase E：类型化 I/O 端口 + 上游引用（Req5） ----------

  /**
   * 选中节点「上游可达」的产出变量（引用选择器的数据源）。
   * 沿反向边 BFS 求祖先后按契约收集输出端口；纯派生，dslObject/selectedNodeId 变即重算。
   */
  const upstreamVars = computed<UpstreamVar[]>(() =>
    selectedNodeId.value ? computeUpstreamOutputs(dslObject.value, selectedNodeId.value) : []
  )

  /** 选中节点的输出端口文档（「本节点产出，供下游引用」区：变量名 + 类型 + 下游引用示例） */
  const nodeOutputDocs = computed<OutputDoc[]>(() => howDownstreamReferences(selectedNode.value))

  /**
   * 「下游怎么引用我」的一句话示例（面板顶部说明用）：取第一个产出端口的 {{$.var}} 示例串。
   * 无产出（控制流节点如条件/并行/循环）时给中性兜底，避免面板空说明。
   */
  const outputExample = computed<string>(() =>
    nodeOutputDocs.value.length
      ? `在下游节点的输入里选择本节点的产出，或直接填 ${nodeOutputDocs.value[0].example}`
      : '本节点不产出变量（控制流节点）；它只决定流程走向。'
  )

  /**
   * 选中节点的引用可达性警告（🔴 黄色提示，不阻断保存/发布）。
   * 与后端 WorkflowDslValidator.validateReferenceReachability 同口径：只对「有产出者但不在上游」的引用报警，
   * 声明变量 / input / 循环体 itemVar 等一律不误报（Req6 向后兼容）。
   */
  const nodeRefWarnings = computed<ReferenceWarning[]>(() => {
    if (!selectedNodeId.value) return []
    return validateReferences(dslObject.value).filter((w) => w.nodeId === selectedNodeId.value)
  })

  /** 某 config 字段对应的输入端口（据 key 匹配契约，取 mode/dataType） */
  const inPortFor = (key: string) => contractOf(selectedNode.value?.type)?.inputs.find((i) => i.key === key)

  /** 字段是否必填（据契约；面板标签上打红星，帮非技术人员一眼看出哪些必须填） */
  const isRequiredField = (key: string): boolean => inPortFor(key)?.required === true

  /** 字段可否引用上游 + 写引用的形态（bare=裸变量名 / template={{$.var}} / none=只填字面量） */
  const refFormFor = (key: string): 'bare' | 'template' | 'none' => referenceForm(inPortFor(key)) as any
  const canRefField = (key: string): boolean => refFormFor(key) !== 'none'
  /**
   * 该字段可否挂「整体替换式」引用选择器（= canRefField **且** 编辑器形态是自由文本）。
   *
   * 🔴 与 canRefField 分成两个谓词是必需的，不是冗余：canRefField 只看契约，驱动**展示**
   *    （类型色点 + 「对象」这类类型名，`tool.args` 该显示）；本函数还看 `f.kind`，驱动**能不能写**。
   *    选择器 emit 一个字符串、onPickRef 整体赋值，所以挂在 kv/tags 字段上会把容器换成一个串 ——
   *    `tool.args` 变成 `"{{$.x}}"` ⟹ 后端 configMap 拿到 null ⟹ 工具无参调用且零报错（P1 缺陷 #47）。
   *    `args` 的可引用粒度是**每个值**（顶层字符串值由 ToolNodeExecutor 解析），不是整个对象；
   *    按值引用照旧靠 KeyValueEditor 的值输入框手打，hint 里已写明。
   */
  const canPickRef = (f: ConfigField): boolean => showsWholeValueRefPicker(selectedNode.value?.type, f)
  /**
   * 引用选择器用的窄化形态：仅在 canPickRef 为真时渲染选择器，故这里恒为 bare/template。
   * 单列一个函数是为了让模板 :form 绑定拿到精确类型（refFormFor 的联合含 'none'，选择器 prop 不接受）。
   */
  const pickFormFor = (key: string): 'bare' | 'template' => (refFormFor(key) === 'bare' ? 'bare' : 'template')

  /** 字段的数据类型色点 / 中文名（面板上标类型，让非技术人员看懂「这个口吃什么」） */
  const fieldDataType = (key: string): IoDataType => (inPortFor(key)?.dataType ?? 'string') as IoDataType
  const fieldColor = (key: string): string => dataTypeColor(fieldDataType(key))
  const fieldTypeLabel = (key: string): string => dataTypeLabel(fieldDataType(key))

  /** 引用选择器写回字段值：直接改真实 config 引用 → 就地突变（页面 deep-watch 入撤销栈 + 标脏） */
  const onPickRef = (key: string, value: string) => {
    if (!selectedNode.value || readonly.value) return
    selConfig.value[key] = value
    mutate()
  }

  /**
   * select 字段的可选项。动态来源（tool/model/kb/workflow）映射已加载目录，静态来源用 f.options。
   * value 逐字对齐后端读取的类型：toolId=工具键(string)、modelId/knowledgeBaseId=数字 id、workflowId=流程 code(string)。
   * 🔴 tool 的**分组**形态走 {@link toolOptionGroups}（el-option-group）；这里保留平铺版作兜底，
   *    两者 label 同源 {@link keyedLabel}，不会出现「分组里是中文、平铺里是英文」。
   */
  const optionsFor = (f: ConfigField): { label: string; value: string | number | boolean; desc?: string }[] => {
    if (f.optionsFrom === 'tool') {
      return toolList.value.map((t) => ({
        label: keyedLabel(t.name, t.displayName),
        value: t.name,
        desc: t.description
      }))
    }
    if (f.optionsFrom === 'model') {
      return modelList.value.map((m) => ({ label: m.name, value: m.id, desc: m.model }))
    }
    if (f.optionsFrom === 'kb') {
      return kbList.value.map((k) => ({ label: k.name, value: k.id }))
    }
    if (f.optionsFrom === 'workflow') {
      return workflowList.value
    }
    return f.options ?? []
  }

  /** 工具下拉的分组选项，`el-option-group` 直接吃这个形状（30+ 个工具平铺只能靠肉眼扫） */
  const toolOptionGroups = computed(() => groupedToolOptions())

  /** 目录加载失败的人话原因；🔴 G7 要求它必须可见，空下拉 + 零提示就是原来的病 */
  const catalogError = nameCatalogError

  /**
   * tags 字段的可选项：iteration.body / agent_loop.tools 给节点 id / 工具键候选，choices 无候选纯手输。
   *
   * 🔴 value 一律是**机器键**（写进 DSL 的就是它），只有 label 是中文名。
   * 旧实现返回 `string[]`、label 与 value 同值，所以「把 label 改成中文」会连带把中文写进
   * `agent_loop.tools` —— 模型循环执行时按工具键查不到，静默退化。故这里必须拆成 {label,value}。
   *
   * 🔴 tools 分支还给每一项算 {@link agentLoopToolBlock}：字段标签写着「可用只读工具」，
   * 而此前 30 个工具**一个不落**全给挑，写工具挑进去要到体检/发布才被 V3、V11 撞回来（D4-24）。
   */
  const tagsOptionsFor = (f: ConfigField): TagsOption[] => {
    if (f.key === 'body') return (dslObject.value.nodes ?? []).map((n) => ({ label: n.id, value: n.id }))
    if (f.key === 'tools') {
      return toolList.value.map((t) => ({
        ...t,
        label: keyedLabel(t.name, t.displayName),
        value: t.name,
        block: agentLoopToolBlock(t)
      }))
    }
    return []
  }

  const applyConfig = () => {
    if (!selectedNode.value || readonly.value) return
    try {
      const parsed = JSON.parse(configText.value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('config 必须是 JSON 对象')
      }
      selectedNode.value.config = parsed
      mutate()
      message.success('已应用节点 config')
    } catch (e: any) {
      message.error(`config 解析失败：${e?.message ?? '格式不合法'}`)
    }
  }

  /** 选中节点变化时，把它的 config / before_image 同步到面板的两个 JSON 文本框 */
  watch(selectedNodeId, () => {
    configText.value = selectedNode.value?.config ? JSON.stringify(selectedNode.value.config, null, 2) : '{}'
    const bi = (selectedNode.value as EditorDslNode | undefined)?.compensation?.before_image
    beforeImageText.value = bi ? JSON.stringify(bi, null, 2) : ''
  })

  // ---------- 右侧面板：condition.rule 分支 ----------

  const RULE_OP_OPTIONS = [
    { value: 'eq', label: '等于 (eq)' },
    { value: 'ne', label: '不等于 (ne)' },
    { value: 'gt', label: '大于 (gt)' },
    { value: 'ge', label: '大于等于 (ge)' },
    { value: 'lt', label: '小于 (lt)' },
    { value: 'le', label: '小于等于 (le)' },
    { value: 'contains', label: '包含 (contains)' },
    { value: 'exists', label: '存在 (exists)' },
    { value: 'is_true', label: '为真 (is_true)' },
    { value: 'is_false', label: '为假 (is_false)' }
  ]
  // 对齐 editorModel.RULE_OPS（防止两处目录漂移）
  if (RULE_OP_OPTIONS.map((o) => o.value).join() !== RULE_OPS.join()) {
    console.warn('[useWorkflowEditor] RULE_OP_OPTIONS 与 editorModel.RULE_OPS 不一致，请同步')
  }

  /** exists/is_true/is_false 不需要比较值 */
  const needsValue = (op?: string): boolean => !['exists', 'is_true', 'is_false'].includes(op ?? '')

  const toText = (v: any): string => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'string') return v
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }

  const ruleBranches = computed<any[]>(() => {
    const b = selConfig.value.branches
    return Array.isArray(b) ? b : []
  })

  const conditionsOf = (branch: any): any[] => (Array.isArray(branch?.conditions) ? branch.conditions : [])

  const onBranchField = (branch: any, key: string, value: any) => {
    branch[key] = value
    mutate()
  }

  const onConditionField = (branch: any, condIndex: number, key: string, value: any) => {
    const c = branch?.conditions?.[condIndex]
    if (!c) return
    c[key] = value
    mutate()
  }

  const onAddRuleBranch = () => {
    addRuleBranch(selConfig.value)
    mutate()
  }
  const onRemoveRuleBranch = (index: number) => {
    removeRuleBranch(selConfig.value, index)
    mutate()
  }
  const onAddRuleCondition = (branchIndex: number) => {
    addRuleCondition(selConfig.value, branchIndex)
    mutate()
  }
  const onRemoveRuleCondition = (branchIndex: number, condIndex: number) => {
    removeRuleCondition(selConfig.value, branchIndex, condIndex)
    mutate()
  }

  // ---------- 右侧面板：parallel 分支 ----------

  /** 画布上可选的分支/路由目标节点（不含当前选中节点，防自环） */
  const branchNodeOptions = computed(() =>
    (dslObject.value.nodes ?? [])
      .filter((n) => n.id !== selectedNodeId.value)
      .map((n) => ({ value: n.id, label: n.name ? `${n.name}（${n.id}）` : n.id }))
  )

  /** 条件边 case/default 的目标节点选项：含 START/END 保留字（分支可指向结束） */
  const nodeOptions = computed(() => [
    { value: START_KEYWORD, label: '开始（START）' },
    ...branchNodeOptions.value,
    { value: END_KEYWORD, label: '结束（END）' }
  ])

  interface ParallelRow {
    single: boolean
    value: string
  }

  const parallelRows = computed<ParallelRow[]>(() => {
    const raw = selConfig.value.branches
    if (!Array.isArray(raw)) return []
    return raw.map((b) =>
      Array.isArray(b) && b.length === 1 && typeof b[0] === 'string'
        ? { single: true, value: b[0] }
        : { single: false, value: toText(b) }
    )
  })

  const ensureParallelBranches = (): any[] => {
    if (!Array.isArray(selConfig.value.branches)) selConfig.value.branches = []
    return selConfig.value.branches
  }

  const onParallelRowChange = (index: number, value: any) => {
    const arr = ensureParallelBranches()
    if (!value) arr.splice(index, 1)
    else arr[index] = [String(value)]
    mutate()
  }
  const onParallelAdd = () => {
    ensureParallelBranches().push([])
    mutate()
  }
  const onParallelRemove = (index: number) => {
    ensureParallelBranches().splice(index, 1)
    mutate()
  }

  // ---------- 右侧面板：连线 ----------

  /** 选中连线对应的 DSL 边（按 from + route/to 反查；条件边 route=某 case 键或 DEFAULT_ROUTE） */
  const selectedDslEdge = computed<EditorDslEdge | undefined>(() => {
    const sel = selectedEdge.value
    if (!sel) return undefined
    return (dslObject.value.edges ?? []).find((e) => {
      if (e.from !== sel.from) return false
      if (sel.route === DEFAULT_ROUTE) return isConditionalEdge(e) && e.default === sel.to
      if (sel.route) return isConditionalEdge(e) && e.cases?.[sel.route] === sel.to
      return !isConditionalEdge(e) && e.to === sel.to
    })
  })

  const selectedEdgeIsConditional = computed(
    () => !!selectedDslEdge.value && isConditionalEdge(selectedDslEdge.value)
  )

  const caseRows = computed(() =>
    Object.entries(selectedDslEdge.value?.cases ?? {}).map(([key, to]) => ({ key, to }))
  )

  const defaultTarget = computed(() => selectedDslEdge.value?.default ?? '')

  const onCaseKeyChange = (oldKey: string, newKey: string) => {
    const e = selectedDslEdge.value
    const key = (newKey ?? '').trim()
    if (!e?.cases || !key || key === oldKey) {
      buildFlow() // 还原输入框显示
      return
    }
    const cases: Record<string, string> = {}
    for (const [k, v] of Object.entries(e.cases)) {
      cases[k === oldKey ? key : k] = v
    }
    e.cases = cases
    selectedEdge.value = { from: e.from, to: cases[key], route: key }
    mutate()
  }

  const onCaseToChange = (routeKey: string, to: any) => {
    const e = selectedDslEdge.value
    if (!e?.cases) return
    if (to) {
      e.cases[routeKey] = String(to)
      selectedEdge.value = { from: e.from, to: String(to), route: routeKey }
      mutate()
    } else {
      setEdgeCase(dslObject.value, e.from, routeKey, '')
      selectedEdge.value = null
      mutate()
    }
  }

  const onCaseRemove = (routeKey: string) => {
    const e = selectedDslEdge.value
    if (!e) return
    setEdgeCase(dslObject.value, e.from, routeKey, '')
    selectedEdge.value = null
    mutate()
  }

  const onDefaultChange = (to: any) => {
    const e = selectedDslEdge.value
    if (!e) return
    setEdgeDefault(dslObject.value, e.from, to ? String(to) : '')
    selectedEdge.value = to ? { from: e.from, to: String(to), route: DEFAULT_ROUTE } : null
    mutate()
  }

  const onCaseAdd = async () => {
    const e = selectedDslEdge.value
    if (!e) return
    const src = (dslObject.value.nodes ?? []).find((n) => n.id === e.from)
    const candidates = src ? routeKeyCandidates(src) : []
    const available = candidates.filter((k) => !e.cases?.[k])
    let routeKey = ''
    if (available.length) {
      const picked = await openRouteDialog(available)
      if (!picked) return
      routeKey = picked
    } else {
      try {
        const res = await ElMessageBox.prompt(
          candidates.length
            ? '这个条件节点的分支都已接过线了。若确需新增，请输入一个分支名（要和条件节点里设置的分支一致）。'
            : '请输入新分支的分支名（要和条件节点里设置的分支一致）。',
          '添加分支',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            inputPlaceholder: '分支名',
            inputValidator: (v: string) => (v && v.trim() ? true : '分支名不能为空')
          }
        )
        routeKey = (res.value ?? '').trim()
      } catch {
        return
      }
    }
    if (!routeKey || e.cases?.[routeKey]) return
    setEdgeCase(dslObject.value, e.from, routeKey, '')
    e.cases![routeKey] = ''
    mutate()
  }

  // ---------- DSL JSON 兜底 ----------

  const applyJson = () => {
    if (readonly.value) return
    try {
      const parsed = JSON.parse(dslText.value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('顶层必须是 JSON 对象')
      }
      // 整体换引用：触发本文件 ref-watch（重读坐标+清选中+buildFlow）与页面 deep-watch（入撤销栈+标脏）
      dslObject.value = normalize(parsed)
      onChange()
      message.success('已应用 JSON 到画布')
    } catch (e: any) {
      message.error(`JSON 解析失败：${e?.message ?? '格式不合法'}`)
    }
  }

  // ---------- 目录数据（fail-soft + 缓存） ----------

  const loadCatalogs = async () => {
    // 🔴 名称目录必须先 await：它既喂工具/子流程下拉，又喂画布摘要（layoutDsl 的 resolver）。
    //    ensureLoaded 永不 reject（失败只写 nameCatalogError），所以这里不需要 try/catch。
    await ensureNameCatalog()
    const [models, kbs] = await Promise.all([
      ModelApi.getModelSimpleList(1).catch(() => []),
      KnowledgeApi.getSimpleKnowledgeList().catch(() => [])
    ])
    modelList.value = (models as ModelVO[]) ?? []
    kbList.value = (kbs as KnowledgeVO[]) ?? []
    workflowList.value = workflowItems().map((w) => ({
      value: w.code,
      label: keyedLabel(w.code, w.name)
    }))
    // 🔴 必须重算一次画布：buildFlow 在 onMounted 的 immediate watch 里已经跑过一轮，
    //    那时目录还没回来，节点摘要里全是机器键。不补这一刀，用户要等下一次编辑才看到中文。
    buildFlow()
  }

  onMounted(loadCatalogs)

  // ---------- 对页面暴露 ----------

  /** 页面保存时取 DSL 原文：先把编辑会话内坐标写回各节点 position（持久化布局），再序列化 */
  const getDslText = (): string => {
    applyPositionsToDsl(dslObject.value, positions.value)
    return JSON.stringify(dslObject.value, null, 2)
  }

  return {
    // 事实源（页面持有的 DSL ref）：Designer/PropertyPanel 少量场景直接读它（如空画布判定、Phase E 端口）
    dslObject,
    // 常量（模板占位符等）
    DND_MIME,
    BEFORE_IMAGE_PLACEHOLDER,
    IDEMPOTENCY_KEY_PLACEHOLDER,
    DEFAULT_ROUTE,
    RULE_OP_OPTIONS,
    flowId,
    // 状态
    parseError,
    devMode,
    positions,
    flowNodes,
    flowEdges,
    selectedNodeId,
    selectedEdge,
    selectedNode,
    dslText,
    configText,
    beforeImageText,
    toolList,
    modelList,
    kbList,
    workflowList,
    // 目录 / 派生视图
    paletteGroups,
    selConfig,
    nonCompensable,
    nodeRecovery,
    selComp,
    visibleFields,
    jsonHint,
    // Phase E：类型化 I/O 端口 + 上游引用
    upstreamVars,
    nodeOutputDocs,
    nodeRefWarnings,
    outputExample,
    refFormFor,
    pickFormFor,
    canRefField,
    canPickRef,
    isRequiredField,
    fieldColor,
    fieldTypeLabel,
    onPickRef,
    dataTypeColor,
    ruleBranches,
    branchNodeOptions,
    nodeOptions,
    parallelRows,
    selectedDslEdge,
    selectedEdgeIsConditional,
    caseRows,
    defaultTarget,
    // 纯工具
    nodeTypeLabel,
    nodeTypeTag,
    branchUsesGroups,
    needsValue,
    toText,
    conditionsOf,
    optionsFor,
    tagsOptionsFor,
    toolOptionGroups,
    catalogError,
    routeTargetName,
    // 交互
    onPaletteDragStart,
    onDragOver,
    addNodeAt,
    addNodeByClick,
    addNodeAfter,
    insertSample,
    onConnect,
    onNodeDragStop,
    onNodeClick,
    onEdgeClick,
    clearSelection,
    selectNode,
    deleteNode,
    deleteEdge,
    relayout,
    mutate,
    buildFlow,
    // 分支 / 连线编辑
    onBranchField,
    onConditionField,
    onAddRuleBranch,
    onRemoveRuleBranch,
    onAddRuleCondition,
    onRemoveRuleCondition,
    onParallelRowChange,
    onParallelAdd,
    onParallelRemove,
    onCaseKeyChange,
    onCaseToChange,
    onCaseRemove,
    onDefaultChange,
    onCaseAdd,
    // 补偿 / config / JSON
    onRecoveryChange,
    onBeforeImageChange,
    applyConfig,
    applyJson,
    // 路由弹窗
    routeDialogVisible,
    routeDialogCandidates,
    routeDialogSelected,
    openRouteDialog,
    confirmRouteDialog,
    cancelRouteDialog,
    // 生命周期 / 出口
    loadCatalogs,
    getDslText
  }
}

export type WorkflowEditorContext = ReturnType<typeof useWorkflowEditor>
