<!--
  Workflow 可视化编辑器（增量14d / P4 可视化编辑器首刀）

  在既有「JSON 原文 + 校验 + 只读预览」（WorkflowDefFormDialog + WorkflowCanvasDialog）之上，
  补一个<b>可交互编辑</b>的画布：左侧节点目录点击新增、中间 Vue Flow 画布可拖动/连线/选中、
  右侧节点配置面板（名称/outputVar/tool 下拉/config JSON）、底部 DSL JSON 兜底编辑。

  🔴 事实源是 DSL 对象（dsl.value），Vue Flow 图只是它的派生视图。所有增删改都走 editorModel.ts 的
     纯函数就地改 DSL 数组，再 buildFlow() 重算视图——绝不「从图反推 DSL」（那样会丢条件边 cases/未知字段）。
     往返保真由 editorModel.spec.ts 兜底（trigger/variables/settings 等非图形字段原样保留）。
  🔴 坐标是临时的：DSL 不带坐标（与只读画布一致），故每次 open 用 layoutDsl 自动分层布局；用户拖动的位置
     记在组件内的 positions（仅本次编辑会话有效，不落库、不写回 DSL）。重开按自动布局重来。
  🔴 首刀范围：点击新增节点 + 拖动定位 + 拉线连普通边 + 选中删节点/删边 + 节点配置面板。
     <b>不做</b>：从目录拖拽到指定坐标（DnD 落点换算）、条件边 case 的可视化编辑（走底部 JSON）、
     节点级调试运行/回放。这些记 P4 后续刀。
  🔴 VueFlow 容器必须有显式高度，否则 0 高不渲染（R1）——画布区固定 h-520px。
-->
<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="1200px"
    top="6vh"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-alert
      v-if="parseError"
      :title="parseError"
      type="error"
      :closable="false"
      show-icon
      class="mb-10px"
    />

    <div v-else class="flex gap-10px h-520px">
      <!-- 左：节点目录（点击新增） -->
      <div class="w-136px flex-shrink-0 border border-solid border-[var(--el-border-color)] rounded-6px p-8px overflow-auto">
        <div class="text-12px font-600 text-[var(--el-text-color-secondary)] mb-8px">节点目录</div>
        <div
          v-for="opt in NODE_TYPE_OPTIONS"
          :key="opt.value"
          class="palette-item mb-6px px-8px py-6px rounded-4px border border-solid border-[var(--el-border-color)] cursor-pointer flex items-center gap-6px hover:border-[var(--el-color-primary)]"
          @click="onAddNode(opt.value)"
        >
          <el-tag size="small" :type="opt.tagType" effect="plain" class="!text-11px !px-4px">{{ opt.label }}</el-tag>
        </div>
        <div class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mt-6px">
          点击即加入画布，再拖动定位。
        </div>
      </div>

      <!-- 中：画布 + 工具条 -->
      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex items-center gap-8px mb-6px flex-shrink-0">
          <el-button size="small" @click="onRelayout">
            <Icon icon="ep:refresh" class="mr-4px" />重新布局
          </el-button>
          <el-button size="small" type="danger" plain :disabled="!selectedNodeId" @click="onDeleteNode">
            <Icon icon="ep:delete" class="mr-4px" />删除节点
          </el-button>
          <el-button size="small" type="danger" plain :disabled="!selectedEdge" @click="onDeleteEdge">
            <Icon icon="ep:delete" class="mr-4px" />删除连线
          </el-button>
          <span class="text-11px text-[var(--el-text-color-placeholder)] ml-auto">
            拖动节点右侧圆点连到另一节点左侧圆点即连线
          </span>
        </div>
        <div class="flex-1 min-h-0 border border-solid border-[var(--el-border-color)] rounded-6px overflow-hidden">
          <VueFlow
            :nodes="flowNodes"
            :edges="flowEdges"
            :nodes-draggable="true"
            :nodes-connectable="true"
            :elements-selectable="true"
            :edges-updatable="false"
            :zoom-on-double-click="false"
            :fit-view-on-init="true"
            :min-zoom="0.3"
            :default-edge-options="{ type: 'default', markerEnd: MarkerType.ArrowClosed }"
            class="w-full h-full"
            @connect="onConnect"
            @node-drag-stop="onNodeDragStop"
            @node-click="onNodeClick"
            @edge-click="onEdgeClick"
            @pane-click="onPaneClick"
          >
            <Background :gap="16" pattern-color="#dcdfe6" />
            <template #node-dsl="{ data, selected }">
              <div
                class="dsl-node px-10px py-8px rounded-6px bg-[var(--el-bg-color)] shadow-sm flex flex-col items-start gap-4px min-w-120px"
                :class="selected ? 'editor-node--selected' : 'editor-node'"
              >
                <Handle v-if="!data.isStart" type="target" :position="Position.Left" />
                <el-tag size="small" :type="data.tagType" effect="plain" class="!text-11px">
                  {{ data.nodeType || 'node' }}
                </el-tag>
                <span class="text-13px break-all">{{ data.label }}</span>
                <Handle v-if="!data.isEnd" type="source" :position="Position.Right" />
              </div>
            </template>
          </VueFlow>
        </div>
      </div>

      <!-- 右：配置面板 -->
      <div class="w-300px flex-shrink-0 border border-solid border-[var(--el-border-color)] rounded-6px p-10px overflow-auto">
        <!-- 选中节点 -->
        <template v-if="selectedNode">
          <div class="text-12px font-600 mb-8px flex items-center gap-6px">
            节点配置
            <el-tag size="small" :type="nodeTypeTag(selectedNode.type)" effect="plain" class="!text-11px">
              {{ selectedNode.type || 'node' }}
            </el-tag>
          </div>
          <el-form label-position="top" size="small">
            <el-form-item label="节点 ID">
              <el-input :model-value="selectedNode.id" disabled />
            </el-form-item>
            <el-form-item label="名称">
              <el-input v-model="selectedNode.name" placeholder="节点显示名" @input="buildFlow" />
            </el-form-item>
            <el-form-item v-if="selectedNode.type === 'tool'" label="工具（toolId）">
              <el-select
                v-model="selConfig.toolId"
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入工具键"
                class="w-full"
                @change="buildFlow"
              >
                <el-option v-for="t in toolList" :key="t.name" :label="t.name" :value="t.name">
                  <span class="float-left">{{ t.name }}</span>
                  <span class="float-right text-12px text-[var(--el-text-color-secondary)] ml-12px max-w-140px truncate">
                    {{ t.description }}
                  </span>
                </el-option>
              </el-select>
            </el-form-item>
            <el-form-item label="输出变量（outputVar）">
              <el-input v-model="selConfig.outputVar" placeholder="结果写入的 state 变量名" @input="buildFlow" />
            </el-form-item>
            <el-form-item label="完整 config（JSON）">
              <el-input
                v-model="configText"
                type="textarea"
                :rows="6"
                class="editor-json"
                placeholder="节点 config，JSON 对象"
              />
              <el-button size="small" class="mt-6px" @click="onApplyConfig">应用到节点 config</el-button>
            </el-form-item>
          </el-form>
        </template>

        <!-- 选中连线 -->
        <template v-else-if="selectedEdge">
          <div class="text-12px font-600 mb-8px">连线</div>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="起点">{{ selectedEdge.from }}</el-descriptions-item>
            <el-descriptions-item label="终点">{{ selectedEdge.to }}</el-descriptions-item>
            <el-descriptions-item label="分支">
              <el-tag v-if="selectedEdge.route === DEFAULT_ROUTE" size="small" type="warning">default</el-tag>
              <el-tag v-else-if="selectedEdge.route" size="small" type="warning">{{ selectedEdge.route }}</el-tag>
              <span v-else class="text-12px text-[var(--el-text-color-secondary)]">普通顺序边</span>
            </el-descriptions-item>
          </el-descriptions>
          <div class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mt-8px">
            条件分支（cases/default）为只读展示；要增改分支路由请用底部 DSL JSON。
          </div>
          <el-button size="small" type="danger" plain class="mt-10px w-full" @click="onDeleteEdge">删除此连线</el-button>
        </template>

        <!-- 未选中 -->
        <div v-else class="text-12px text-[var(--el-text-color-secondary)] leading-20px">
          <div class="font-600 mb-6px">操作提示</div>
          <ul class="pl-16px mb-0">
            <li>左侧目录点击新增节点</li>
            <li>拖动节点调整位置</li>
            <li>从节点右侧圆点拉到另一节点左侧圆点连线</li>
            <li>单击节点/连线在此编辑或删除</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 底部：DSL JSON 兜底编辑（条件边 case、trigger、variables 等非画布可编辑项走这里） -->
    <div v-if="!parseError" class="mt-10px">
      <div class="flex items-center justify-between mb-6px">
        <span class="text-12px text-[var(--el-text-color-secondary)]">
          DSL JSON（事实源）。画布改动实时同步到此；也可直接改 JSON 后「应用到画布」。
        </span>
        <el-button size="small" @click="onApplyJson">
          <Icon icon="ep:refresh-right" class="mr-4px" />应用到画布
        </el-button>
      </div>
      <el-input v-model="dslText" type="textarea" :rows="6" class="editor-json" spellcheck="false" />
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!!parseError" @click="handleConfirm">应用到表单</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { VueFlow, Handle, Position, MarkerType } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import type { Edge, Node } from '@vue-flow/core'
import { getToolList, type AgentToolVO } from '@/api/agent/config'
import { layoutDsl } from '../layout'
import {
  NODE_TYPE_OPTIONS,
  DEFAULT_ROUTE,
  nodeTypeTag,
  addNode,
  removeNode,
  addEdge,
  removeEdge,
  type EditorDsl,
  type EditorDslEdge
} from '../editorModel'

defineOptions({ name: 'WorkflowEditorDialog' })

const emit = defineEmits<{ (e: 'apply', dsl: string): void }>()
const message = useMessage()

/** layout.ts 内部用的合成端点视觉 id / DSL 保留字（此处复刻，layout.ts 未导出这几个常量） */
const START_VISUAL_ID = '__start__'
const END_VISUAL_ID = '__end__'
const START_KEYWORD = 'START'
const END_KEYWORD = 'END'

const visible = ref(false)
const parseError = ref('')
const meta = ref<{ code?: string; name?: string }>({})

/** 事实源：已解析的 DSL 对象。画布/JSON 都是它的视图 */
const dsl = ref<EditorDsl>({ nodes: [], edges: [] })
/** 本次编辑会话内的临时坐标（视觉 id → 位置），不落库、不写回 DSL */
const positions = ref<Record<string, { x: number; y: number }>>({})
const flowNodes = ref<Node[]>([])
const flowEdges = ref<Edge[]>([])
const selectedNodeId = ref<string | null>(null)
const selectedEdge = ref<{ from: string; to: string; route?: string } | null>(null)
const dslText = ref('')
const configText = ref('{}')
const toolList = ref<AgentToolVO[]>([])

const dialogTitle = computed(() => {
  const suffix = meta.value.name || meta.value.code
  return suffix ? `可视化编辑：${suffix}` : '可视化编辑流程'
})

const selectedNode = computed(() =>
  selectedNodeId.value ? (dsl.value.nodes ?? []).find((n) => n.id === selectedNodeId.value) : undefined
)

/**
 * 选中节点的 config，恒为对象（normalize 已保证每个节点有 config，这里再兜底 ?? {}）。
 * 单独抽一个 computed 是为了让模板 v-model 写 `selConfig.toolId` 而不必对可选的 config 做非空断言；
 * getter 返回的是 DSL 里那个真实 config 对象引用，故对其属性赋值即写回 DSL。
 */
const selConfig = computed<Record<string, any>>(() => selectedNode.value?.config ?? {})

/** 视觉 id ⇄ DSL 保留字/节点 id 的双向映射 */
const toVisual = (ref: string): string =>
  ref === START_KEYWORD ? START_VISUAL_ID : ref === END_KEYWORD ? END_VISUAL_ID : ref
const toDsl = (visualId: string): string =>
  visualId === START_VISUAL_ID ? START_KEYWORD : visualId === END_VISUAL_ID ? END_KEYWORD : visualId

const isConditionalEdge = (e: EditorDslEdge): boolean =>
  (e.type ?? '').toLowerCase() === 'conditional' || (!!e.cases && Object.keys(e.cases).length > 0)

const syncDslText = () => {
  dslText.value = JSON.stringify(dsl.value, null, 2)
}

/**
 * 由 DSL 重算画布视图：layoutDsl 出节点分层坐标 → 覆盖已拖动位置 → 自建带 data(from/to/route) 的边。
 * 🔴 边不复用 layoutDsl 产出的（那批不带原始 from/to/route，删边时无法反查 DSL），这里按 dsl.edges 重建，
 *    条件边展开成多条带 label 的虚线边，每条 data 记住它对应的 DSL 端点与分支键，供 removeEdge 精确回删。
 */
const buildFlow = () => {
  // EditorDsl 是 DslGraph 的超集（条件边的 to 可省略、节点带 config/索引签名），layoutDsl 只防御性读取少数字段，
  // 故此处按 DslGraph 形状传入是安全的；用 as any 跨过 EditorDslEdge.to 可选 vs DslEdge.to 必填的结构差异。
  const { nodes } = layoutDsl(dsl.value as any)
  for (const n of nodes) {
    const isStart = n.id === START_VISUAL_ID
    const isEnd = n.id === END_VISUAL_ID
    n.data = { ...(n.data ?? {}), dslId: isStart || isEnd ? null : n.id, isStart, isEnd }
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
  for (const e of dsl.value.edges ?? []) {
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

const onAddNode = (type: string) => {
  const id = addNode(dsl.value, type)
  buildFlow()
  selectedNodeId.value = id
  selectedEdge.value = null
}

const onConnect = (params: any) => {
  const from = toDsl(params.source)
  const to = toDsl(params.target)
  if (!from || !to || from === to) return
  addEdge(dsl.value, from, to)
  buildFlow()
}

const onNodeDragStop = (payload: any) => {
  const node = payload?.node
  if (node?.id) positions.value[node.id] = { x: node.position.x, y: node.position.y }
}

const onNodeClick = (payload: any) => {
  selectedEdge.value = null
  selectedNodeId.value = payload?.node?.data?.dslId ?? null
}

const onEdgeClick = (payload: any) => {
  const d = payload?.edge?.data
  selectedNodeId.value = null
  selectedEdge.value = d ? { from: d.from, to: d.to, route: d.route } : null
}

const onPaneClick = () => {
  selectedNodeId.value = null
  selectedEdge.value = null
}

const onDeleteNode = () => {
  if (!selectedNodeId.value) return
  removeNode(dsl.value, selectedNodeId.value)
  delete positions.value[selectedNodeId.value]
  selectedNodeId.value = null
  buildFlow()
}

const onDeleteEdge = () => {
  if (!selectedEdge.value) return
  removeEdge(dsl.value, selectedEdge.value.from, selectedEdge.value.to, selectedEdge.value.route)
  selectedEdge.value = null
  buildFlow()
}

const onRelayout = () => {
  positions.value = {}
  buildFlow()
}

const onApplyConfig = () => {
  if (!selectedNode.value) return
  try {
    const parsed = JSON.parse(configText.value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config 必须是 JSON 对象')
    }
    selectedNode.value.config = parsed
    buildFlow()
    message.success('已应用节点 config')
  } catch (e: any) {
    message.error(`config 解析失败：${e?.message ?? '格式不合法'}`)
  }
}

const onApplyJson = () => {
  try {
    const parsed = JSON.parse(dslText.value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('顶层必须是 JSON 对象')
    }
    dsl.value = normalize(parsed)
    selectedNodeId.value = null
    selectedEdge.value = null
    buildFlow()
    message.success('已应用 JSON 到画布')
  } catch (e: any) {
    message.error(`JSON 解析失败：${e?.message ?? '格式不合法'}`)
  }
}

/** 选中节点变化时，把它的 config 同步到面板的 JSON 文本框 */
watch(selectedNodeId, () => {
  configText.value = selectedNode.value?.config ? JSON.stringify(selectedNode.value.config, null, 2) : '{}'
})

const handleConfirm = () => {
  emit('apply', JSON.stringify(dsl.value, null, 2))
  visible.value = false
}

/**
 * 打开编辑器
 * @param dslTextIn 当前表单里的 DSL 原文（未保存草稿也可编辑）
 * @param metaIn    供标题展示的 code/name
 */
const open = async (dslTextIn: string, metaIn?: { code?: string; name?: string }) => {
  meta.value = metaIn ?? {}
  parseError.value = ''
  selectedNodeId.value = null
  selectedEdge.value = null
  positions.value = {}
  visible.value = true

  if (!dslTextIn?.trim()) {
    parseError.value = 'DSL 为空，无法进入可视化编辑。请先在表单里填写或选择一份 DSL。'
    return
  }
  let parsed: any
  try {
    parsed = JSON.parse(dslTextIn)
  } catch (e: any) {
    parseError.value = `DSL 解析失败：${e?.message ?? '格式不合法'}。请修正 JSON 后再打开可视化编辑。`
    return
  }
  dsl.value = normalize(parsed)
  buildFlow()

  if (!toolList.value.length) {
    try {
      toolList.value = (await getToolList()) ?? []
    } catch {
      toolList.value = [] // 工具目录拉取失败不阻断编辑（tool 下拉可手输 toolId）
    }
  }
}

defineExpose({ open })
</script>

<style scoped>
/* 画布节点描边：默认浅灰，选中态用主色高亮（VueFlow 传 selected 到 slot） */
.editor-node {
  border: 1px solid var(--el-border-color);
}
.editor-node--selected {
  border: 2px solid var(--el-color-primary);
}
/* JSON/config 文本框用等宽字体，便于读写缩进 */
.editor-json :deep(textarea) {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.5;
}
/* VueFlow 连接桩（handle）稍微放大，方便点击拉线 */
:deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  background: var(--el-color-primary);
  border-radius: 50%;
}
</style>
