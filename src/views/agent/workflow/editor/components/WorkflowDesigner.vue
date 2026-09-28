<!--
  流程设计器 · 中栏画布（增量8 / P4，Phase C；本轮 Req 4/5/6/7 重构）

  从 WorkflowEditorCanvas.vue 拆出的 VueFlow 段：画布（自定义节点卡片、拖拽落点、连线、选中）
  + 空画布引导 + 底部流程 JSON 兜底（开发者模式）+ 节点右侧「＋」快捷加节点。
  本身不持有 DSL 状态，全部经 props.editor（useWorkflowEditor）读写。

  🔴 Req4：本组件**不再有工具条**。缩放（放大/缩小/适配）与开发者模式开关搬到了顶栏，和撤销/重做同一行——
     原来那一行 34px 高的工具条挤了 5 个按钮 + 一句提示，画布白矮一截，而缩放/开发者模式本就是全局操作。
     删除节点/删除连线也跟着搬进右侧属性面板（它们只作用于「当前选中项」，放面板里才是就近操作）。
  🔴 Req5/6：底部流程 JSON 换成 Monaco 代码框（JsonCodeField），带语法高亮 + 实时格式检查，并可「放大」成弹窗
     （弹窗本身还带项目 Dialog 的全屏切换，即「扩展弹窗的放大效果」）。
  🔴 Req7：鼠标悬停节点 → 右侧浮出「＋」，点开直接选节点类型，自动串到原有连线上（graphEdit.insertAfter）。
-->
<template>
  <div class="wf-designer">
    <div
      class="wf-designer__canvas"
      @dragover.prevent="onDragOver"
      @drop.prevent="onDrop"
    >
      <VueFlow
        :id="flowId"
        :nodes="flowNodes"
        :edges="flowEdges"
        :nodes-draggable="!readonly"
        :nodes-connectable="!readonly"
        :elements-selectable="true"
        :edges-updatable="false"
        :zoom-on-double-click="false"
        :fit-view-on-init="true"
        :min-zoom="0.2"
        :default-edge-options="{ type: 'default', markerEnd: MarkerType.ArrowClosed }"
        class="wf-designer__flow"
        @connect="onConnect"
        @node-drag-stop="onNodeDragStop"
        @node-click="onNodeClick"
        @edge-click="onEdgeClick"
        @pane-click="clearSelection"
      >
        <Background :gap="16" pattern-color="#dcdfe6" />
        <template #node-dsl="{ data, selected }">
          <div
            class="wf-node"
            :class="[
              selected ? 'wf-node--selected' : '',
              sandboxCell(data.dslId) ? 'wf-node--sandbox' : '',
              sandboxCell(data.dslId)?.status === 'running' ? 'wf-node--running' : ''
            ]"
            :style="sandboxStyle(data.dslId)"
          >
            <Handle v-if="!data.isStart" type="target" :position="Position.Left" />
            <div class="wf-node__head">
              <el-tag
                v-if="data.typeLabel"
                size="small"
                :type="data.tagType"
                effect="plain"
                class="wf-node__tag"
              >
                {{ data.typeLabel }}
              </el-tag>
              <span class="wf-node__label">{{ data.label }}</span>
              <el-tooltip
                v-if="data.hasGap"
                content="必填配置缺失，请单击节点在右侧面板补全"
                placement="top"
              >
                <span class="wf-node__gap"></span>
              </el-tooltip>
            </div>
            <div v-if="data.summary" class="wf-node__summary">{{ data.summary }}</div>
            <!-- Phase E：本节点产出的变量（前序产出在画布一眼可见；下游可据此引用） -->
            <div v-if="data.outVars?.length" class="wf-node__outs">
              <span
                v-for="o in data.outVars"
                :key="o.name"
                class="wf-node__out"
                :title="`产出变量 ${o.name}，下游节点可引用`"
              >
                <span class="wf-node__out-dot" :style="{ background: o.color }"></span>
                <code>{{ o.name }}</code>
              </span>
            </div>
            <!-- 沙箱试跑状态角标：边跑边在画布上看到每个节点的结局 -->
            <div
              v-if="sandboxCell(data.dslId)"
              class="wf-node__sbx"
              :style="{ color: sandboxCell(data.dslId)!.color }"
            >
              ● {{ sandboxCell(data.dslId)!.label }}
            </div>
            <Handle v-if="!data.isEnd" type="source" :position="Position.Right" />
            <!--
              Req7：悬停浮出的「＋」。放在卡片右侧、圆点（Handle）再往外一点，避免和拉线的手柄抢点击。
              🔴 用 .wf-node:hover 控制显隐是安全的：按钮是 .wf-node 的 DOM 子元素，鼠标移到按钮上时
                 父级 :hover 依然成立，不会「一移过去就消失」。nodrag/nopan 防止点它变成拖节点/平移画布。
            -->
            <button
              v-if="!readonly && !data.isEnd"
              type="button"
              class="wf-node__plus nodrag nopan"
              title="在这一步后面接一个节点"
              data-testid="node-plus"
              @click.stop="openQuickAdd(data)"
            >
              <Icon icon="ep:plus" />
            </button>
          </div>
        </template>
      </VueFlow>

      <!-- 空画布引导层：三步中文指引 + 插入示例骨架 -->
      <div v-if="!readonly && isEmptyCanvas" class="wf-designer__empty">
        <div class="wf-designer__empty-inner">
          <div class="wf-designer__empty-title">三步搭出一条流程</div>
          <ol class="wf-designer__empty-steps">
            <li>从左侧「节点目录」点击或拖入节点（如工具、大模型）</li>
            <li>从节点右侧圆点拉线到下一节点左侧圆点，串起执行顺序</li>
            <li>单击节点，在右侧面板填写它要做什么（红点 = 还缺必填项）</li>
          </ol>
          <el-button type="primary" plain size="small" @click="insertSample">
            <Icon icon="ep:magic-stick" class="mr-4px" />插入示例骨架
          </el-button>
        </div>
      </div>
    </div>

    <!--
      底部：流程 JSON 兜底编辑（属开发者模式）——画布改动实时同步到此；也可直接改 JSON 后「应用到画布」。
      Req6：Monaco 代码框 + 常驻格式检查（写错标点当场报到行列，不用等点「应用」才报错）。
      Req5：「放大」开弹窗编辑，弹窗内还能再切全屏。
    -->
    <div v-if="devMode" class="wf-designer__json" data-testid="dsl-json-panel">
      <div class="wf-designer__json-bar">
        <span class="wf-designer__json-title">流程 JSON（事实源）</span>
        <span class="wf-designer__json-tip">画布改动实时同步到此；也可直接改 JSON 后「应用到画布」。</span>
        <div class="wf-designer__json-acts">
          <el-button size="small" text type="primary" data-testid="dsl-json-enlarge" @click="jsonDialogVisible = true">
            <Icon icon="radix-icons:enter-full-screen" class="mr-3px" />放大
          </el-button>
          <el-button v-if="!readonly" size="small" @click="applyJson">
            <Icon icon="ep:refresh-right" class="mr-4px" />应用到画布
          </el-button>
        </div>
      </div>
      <JsonCodeField
        v-model="dslText"
        height="180px"
        :readonly="readonly"
        :summarize="summarizeDsl"
        test-id="dsl-json-status"
      />
    </div>

    <!-- Req5：放大后的流程 JSON 编辑弹窗（项目 Dialog 自带全屏切换 = 「扩展弹窗的放大效果」） -->
    <Dialog v-model="jsonDialogVisible" title="流程 JSON（事实源）" width="900px">
      <div class="wf-json-dialog__tip">
        这里改的是整条流程的原始定义。改完点「应用到画布」才会生效；格式不对时状态条会红字报到第几行第几列。
      </div>
      <JsonCodeField
        v-model="dslText"
        height="calc(100vh - 300px)"
        :readonly="readonly"
        :summarize="summarizeDsl"
        test-id="dsl-json-status-lg"
      />
      <template #footer>
        <el-button @click="jsonDialogVisible = false">关闭</el-button>
        <el-button v-if="!readonly" type="primary" @click="applyJsonFromDialog">应用到画布</el-button>
      </template>
    </Dialog>

    <!--
      Req7：「＋」点开的快捷选节点弹窗。
      🔴 用 el-dialog 而不是 el-popover：画布容器是 overflow:hidden，popover 贴着节点弹出会被裁掉；
         append-to-body 的弹窗不受画布裁剪，且节点在屏幕任何位置都弹得出来。
    -->
    <el-dialog
      v-model="quickAddVisible"
      title="接一个节点"
      width="460px"
      append-to-body
      data-testid="quick-add-dialog"
    >
      <div class="wf-quick__tip">
        新节点会自动接在「{{ quickAddSource.name }}」后面{{ quickAddSource.hint }}。
      </div>
      <el-scrollbar max-height="420px">
        <template v-for="g in paletteGroups" :key="g.name">
          <div class="wf-quick__group">{{ g.name }}</div>
          <div
            v-for="item in g.items"
            :key="item.value"
            class="wf-quick__item"
            @click="pickQuickAdd(item.value)"
          >
            <el-tag size="small" :type="item.tagType" effect="plain" class="wf-quick__tag">
              {{ item.label }}
            </el-tag>
            <span class="wf-quick__desc">{{ item.description }}</span>
          </div>
        </template>
      </el-scrollbar>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue'
import { VueFlow, Handle, Position, MarkerType, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import JsonCodeField from './JsonCodeField.vue'
import type { WorkflowEditorContext } from '../useWorkflowEditor'

defineOptions({ name: 'WorkflowDesigner' })

const props = defineProps<{
  editor: WorkflowEditorContext
  readonly: boolean
  /** 沙箱试跑的画布高亮覆盖层：nodeId → {status,color,label}（可选，不传则无高亮，与 Phase C 用法兼容） */
  sandboxOverlay?: Record<string, { status: string; color: string; label: string }>
}>()
const {
  flowId,
  flowNodes,
  flowEdges,
  devMode,
  dslText,
  DND_MIME,
  onDragOver,
  addNodeAt,
  addNodeAfter,
  onConnect,
  onNodeDragStop,
  onNodeClick,
  onEdgeClick,
  clearSelection,
  insertSample,
  applyJson,
  paletteGroups,
  dslObject
} = props.editor

// 缩放 API 仍在本组件取（顶栏按钮由页面调 useVueFlow(同一个 flowId) 拿同一份 store）；
// screenToFlowCoordinate 是拖拽落点换算，只有本组件用得到。
const { fitView, screenToFlowCoordinate } = useVueFlow(flowId)

/** Req5：放大弹窗可见性 */
const jsonDialogVisible = ref(false)

/** 状态条摘要：让「画布改动同步到 JSON」肉眼可验，也顺带告诉开发者这张图现在多大 */
const summarizeDsl = (parsed: Record<string, any>): string => {
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes.length : 0
  const edges = Array.isArray(parsed?.edges) ? parsed.edges.length : 0
  return `${nodes} 个节点 / ${edges} 条连线`
}

/** 放大弹窗里点「应用」：应用成功后关窗，别让弹窗挡住刚更新的画布 */
const applyJsonFromDialog = () => {
  applyJson()
  jsonDialogVisible.value = false
}

// ---------- Req7：节点右侧「＋」快捷加节点 ----------

const quickAddVisible = ref(false)
const quickAddSource = ref<{ ref: string; name: string; hint: string }>({ ref: '', name: '', hint: '' })

const openQuickAdd = (data: any) => {
  const sourceRef = data?.dslRef
  if (props.readonly || !sourceRef || sourceRef === 'END') return
  const isStart = sourceRef === 'START'
  quickAddSource.value = {
    ref: sourceRef,
    name: isStart ? '开始' : data.label || sourceRef,
    hint: isStart ? '，成为流程的第一步' : '，插到它原有的下一步之前'
  }
  quickAddVisible.value = true
}

const pickQuickAdd = async (type: string) => {
  const sourceRef = quickAddSource.value.ref
  quickAddVisible.value = false
  // 等快捷弹窗真的卸载再往下走：起点是条件节点时会紧接着弹「选择分支」，两个弹窗叠着会抢焦点
  await nextTick()
  await addNodeAfter(sourceRef, type)
}

/** 取某 DSL 节点当前的沙箱状态格（合成端点 dslId 为 null，天然不高亮） */
const sandboxCell = (dslId: string | null | undefined) =>
  dslId ? props.sandboxOverlay?.[dslId] : undefined

/** 沙箱高亮的内联样式：按状态色染边框 + 一圈同色光环（color 是 CSS 变量，box-shadow 直接吃 var()） */
const sandboxStyle = (dslId: string | null | undefined) => {
  const cell = sandboxCell(dslId)
  if (!cell) return undefined
  return { borderColor: cell.color, boxShadow: `0 0 0 2px ${cell.color}` }
}

/** 拖拽落点：screenToFlowCoordinate 把屏幕坐标换算成画布坐标，节点直接落在松手处 */
const onDrop = (event: DragEvent) => {
  if (props.readonly) return
  const type = event.dataTransfer?.getData(DND_MIME)
  if (!type) return
  const pos = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  addNodeAt(type, { x: pos.x, y: pos.y })
}

/** 空画布判定：DSL 里没有任何真实节点（与旧画布 inner.nodes.length 同口径） */
const isEmptyCanvas = computed(() => !(dslObject.value.nodes ?? []).length)

// 开发者模式切换会增删底部 JSON 面板，画布可视高度随之变化；等 DOM 更新且 VueFlow 量到新尺寸后再适配，
// 否则原本贴合的节点会溢出被遮。setTimeout 比 rAF 稳（rAF 太早量到的还是旧高度）。
watch(devMode, () => setTimeout(() => fitView({ padding: 0.2 }), 150))
</script>

<style lang="scss" scoped>
.wf-designer {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.wf-designer__canvas {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.wf-designer__flow {
  width: 100%;
  height: 100%;
}

.wf-designer__empty {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  background: rgb(255 255 255 / 90%);
  align-items: center;
  justify-content: center;
}

.wf-designer__empty-inner {
  max-width: 360px;
  padding: 0 20px;
  text-align: center;
}

.wf-designer__empty-title {
  margin-bottom: 10px;
  font-size: var(--wf-fs-lg, 15px);
  font-weight: 600;
}

.wf-designer__empty-steps {
  margin-bottom: 14px;
  padding-left: 18px;
  font-size: var(--wf-fs-sm, 12px);
  line-height: 22px;
  color: var(--el-text-color-secondary);
  text-align: left;
}

.wf-designer__json {
  flex-shrink: 0;
  padding: 8px 10px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.wf-designer__json-bar {
  display: flex;
  margin-bottom: 6px;
  align-items: center;
  gap: 8px;
}

.wf-designer__json-title {
  flex-shrink: 0;
  font-size: var(--wf-fs-sm, 12px);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.wf-designer__json-tip {
  min-width: 0;
  overflow: hidden;
  font-size: var(--wf-fs-xs, 11px);
  color: var(--el-text-color-placeholder);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-designer__json-acts {
  display: flex;
  margin-left: auto;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.wf-json-dialog__tip {
  margin-bottom: 8px;
  font-size: var(--wf-fs-sm, 12px);
  line-height: var(--wf-lh, 1.6);
  color: var(--el-text-color-secondary);
}

/* Req7：「＋」快捷加节点弹窗 */
.wf-quick__tip {
  margin-bottom: 10px;
  font-size: var(--wf-fs-sm, 12px);
  line-height: var(--wf-lh, 1.6);
  color: var(--el-text-color-secondary);
}

.wf-quick__group {
  margin: 10px 0 4px;
  font-size: var(--wf-fs-xs, 11px);
  font-weight: 600;
  color: var(--el-text-color-placeholder);
}

.wf-quick__item {
  display: flex;
  margin-bottom: 4px;
  padding: 6px 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  cursor: pointer;
  align-items: center;
  gap: 8px;
  transition: all 0.15s;

  &:hover {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }
}

.wf-quick__tag {
  flex-shrink: 0;
  min-width: 74px;
  justify-content: center;
}

.wf-quick__desc {
  min-width: 0;
  overflow: hidden;
  font-size: var(--wf-fs-xs, 11px);
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 画布节点卡片 */
.wf-node {
  position: relative;
  display: flex;
  min-width: 160px;
  max-width: 240px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color);
  box-shadow: 0 1px 4px rgb(0 0 0 / 8%);
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
}

.wf-node--selected {
  border: 2px solid var(--el-color-primary);
}

/* 沙箱高亮：边框色由内联 style 按状态给；running 态加呼吸动画，让「正在跑」一眼可见 */
.wf-node--sandbox {
  border-width: 2px;
}

.wf-node--running {
  animation: wf-node-pulse 1.1s ease-in-out infinite;
}

@keyframes wf-node-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.55;
  }
}

/* Req7：悬停才浮出的「＋」。right 取 -34px 是为了躲开拉线用的圆点手柄（它在 -4px 处、宽 10px） */
.wf-node__plus {
  position: absolute;
  top: 50%;
  right: -34px;
  display: flex;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--el-color-primary);
  border-radius: 50%;
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  cursor: pointer;
  opacity: 0;
  transform: translateY(-50%);
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s;
  font-size: var(--wf-fs-sm, 12px);
}

.wf-node:hover .wf-node__plus,
.wf-node__plus:focus-visible {
  opacity: 1;
}

.wf-node__plus:hover {
  background: var(--el-color-primary);
  color: #fff;
}

.wf-node__sbx {
  width: 100%;
  font-size: var(--wf-fs-xs, 11px);
  font-weight: 600;
  line-height: 15px;
}

.wf-node__head {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 4px;
}

.wf-node__tag {
  flex-shrink: 0;
  padding: 0 4px;
  font-size: var(--wf-fs-xs, 11px);
}

.wf-node__label {
  overflow: hidden;
  font-size: var(--wf-fs-md, 13px);
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-node__gap {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: auto;
  border-radius: 50%;
  background: var(--el-color-danger);
  flex-shrink: 0;
}

.wf-node__summary {
  display: -webkit-box;
  width: 100%;
  overflow: hidden;
  font-size: var(--wf-fs-sm, 12px);
  line-height: 17px;
  color: var(--el-text-color-secondary);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* Phase E：节点产出变量芯片 */
.wf-node__outs {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.wf-node__out {
  display: inline-flex;
  padding: 1px 5px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  align-items: center;
  gap: 3px;

  code {
    font-family: var(--wf-mono, monospace);
    font-size: var(--wf-fs-xs, 11px);
    line-height: 15px;
    color: var(--el-text-color-regular);
  }
}

.wf-node__out-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

:deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--el-color-primary);
}
</style>
