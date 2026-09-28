<!--
  流程设计器 · 中栏画布（增量8 / P4，Phase C）

  从 WorkflowEditorCanvas.vue 拆出的 VueFlow 段：工具条（缩放/适配/删节点/删连线/开发者模式）+ 画布
  （自定义节点卡片、拖拽落点、连线、选中）+ 空画布引导 + 底部流程 JSON 兜底（开发者模式）。
  本身不持有 DSL 状态，全部经 props.editor（useWorkflowEditor）读写；useVueFlow 的缩放/坐标 API 在本组件内取。
-->
<template>
  <div class="wf-designer">
    <div class="wf-designer__toolbar">
      <el-button size="small" circle title="放大" @click="zoomIn()">
        <Icon icon="ep:zoom-in" />
      </el-button>
      <el-button size="small" circle title="缩小" @click="zoomOut()">
        <Icon icon="ep:zoom-out" />
      </el-button>
      <el-button size="small" circle title="适配画布" @click="fitView({ padding: 0.2 })">
        <Icon icon="ep:full-screen" />
      </el-button>
      <el-divider direction="vertical" />
      <el-button
        v-if="!readonly"
        size="small"
        type="danger"
        plain
        :disabled="!selectedNodeId"
        @click="deleteNode"
      >
        <Icon icon="ep:delete" class="mr-3px" />删除节点
      </el-button>
      <el-button
        v-if="!readonly"
        size="small"
        type="danger"
        plain
        :disabled="!selectedEdge"
        @click="deleteEdge"
      >
        <Icon icon="ep:delete" class="mr-3px" />删除连线
      </el-button>
      <span class="wf-designer__tip">从节点右侧圆点拉线到另一节点左侧圆点即连线</span>
      <el-tooltip
        content="打开后可直接编辑流程的 JSON 原文、配置失败恢复与补偿等高级项"
        placement="bottom"
        :show-after="300"
      >
        <div class="wf-designer__dev">
          <span>开发者模式</span>
          <el-switch v-model="devMode" size="small" data-testid="dev-mode-switch" />
        </div>
      </el-tooltip>
    </div>

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

    <!-- 底部：流程 JSON 兜底编辑（属开发者模式）——画布改动实时同步到此；也可直接改 JSON 后「应用到画布」 -->
    <div v-if="devMode" class="wf-designer__json">
      <div class="wf-designer__json-bar">
        <span>流程 JSON（事实源）。画布改动实时同步到此；也可直接改 JSON 后「应用到画布」。</span>
        <el-button v-if="!readonly" size="small" @click="applyJson">
          <Icon icon="ep:refresh-right" class="mr-4px" />应用到画布
        </el-button>
      </div>
      <el-input
        v-model="dslText"
        type="textarea"
        :rows="6"
        class="wf-json-input"
        spellcheck="false"
        :readonly="readonly"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, watch } from 'vue'
import { VueFlow, Handle, Position, MarkerType, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
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
  onConnect,
  onNodeDragStop,
  onNodeClick,
  onEdgeClick,
  clearSelection,
  deleteNode,
  deleteEdge,
  insertSample,
  applyJson,
  selectedNodeId,
  selectedEdge,
  dslObject
} = props.editor

const { zoomIn, zoomOut, fitView, screenToFlowCoordinate } = useVueFlow(flowId)

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

.wf-designer__toolbar {
  display: flex;
  flex-shrink: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  align-items: center;
  gap: 6px;
}

.wf-designer__tip {
  margin-left: auto;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.wf-designer__dev {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
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
  font-size: 15px;
  font-weight: 600;
}

.wf-designer__empty-steps {
  margin-bottom: 14px;
  padding-left: 18px;
  font-size: 12px;
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
  font-size: 12px;
  color: var(--el-text-color-secondary);
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* 画布节点卡片 */
.wf-node {
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

.wf-node__sbx {
  width: 100%;
  font-size: 11px;
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
  font-size: 11px;
}

.wf-node__label {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
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
  font-size: 11px;
  line-height: 15px;
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
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 10px;
    line-height: 14px;
    color: var(--el-text-color-regular);
  }
}

.wf-node__out-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.wf-json-input :deep(textarea) {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.5;
}

:deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--el-color-primary);
}
</style>
