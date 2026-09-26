<!--
  Workflow 只读画布对话框（增量8 / P4 第一刀）

  getDef(id) → JSON.parse(dsl) → layoutDsl 自动分层 → Vue Flow 只读渲染节点/边。
  🔴 只读：不可拖动、不可连线、不可选中、不可编辑边。本刀不做拖拽编辑（P4 后续刀）。
  🔴 DSL 无坐标，布局全在前端 layout.ts 算（见其类注释）。
  🔴 VueFlow 容器必须有显式高度，否则 0 高不渲染（R1）——这里固定 h-500px。
  🔴 dsl 可能非法/为空：try/catch + el-alert 显式报错，绝不白屏（R3）。
-->
<template>
  <el-dialog v-model="visible" :title="isPreview ? '流程画布（预览）' : '流程画布（只读）'" width="900px" append-to-body destroy-on-close>
    <el-descriptions v-if="def" :column="2" border size="small" class="mb-12px">
      <el-descriptions-item label="流程编码">{{ def.code }}</el-descriptions-item>
      <el-descriptions-item label="流程名称">{{ def.name }}</el-descriptions-item>
      <el-descriptions-item label="版本">{{ def.version ? 'v' + def.version : '未保存' }}</el-descriptions-item>
      <el-descriptions-item label="状态">
        <el-tag :type="statusTagType(def.status)" size="small">{{ statusLabel(def.status) }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="触发方式">{{ triggerLabel(def.triggerType) }}</el-descriptions-item>
      <el-descriptions-item label="触发键">{{ def.triggerKey || '—' }}</el-descriptions-item>
      <el-descriptions-item label="描述" :span="2">{{ def.description || '—' }}</el-descriptions-item>
    </el-descriptions>

    <el-alert v-if="parseError" :title="parseError" type="error" :closable="false" show-icon />

    <div v-else v-loading="loading" class="canvas-wrap h-500px border border-solid border-[var(--el-border-color)] rounded-6px overflow-hidden">
      <VueFlow
        v-if="flowNodes.length"
        :key="renderKey"
        :nodes="flowNodes"
        :edges="flowEdges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :elements-selectable="false"
        :edges-updatable="false"
        :edges-focusable="false"
        :zoom-on-double-click="false"
        :fit-view-on-init="true"
        class="w-full h-full"
      >
        <Background :gap="16" pattern-color="#dcdfe6" />
        <!-- 自定义节点：类型徽标（按 type 着色）+ 名称 -->
        <template #node-dsl="{ data }">
          <div
            class="dsl-node px-10px py-8px rounded-6px bg-[var(--el-bg-color)] border border-solid border-[var(--el-border-color)] shadow-sm flex flex-col items-start gap-4px min-w-120px"
          >
            <el-tag size="small" :type="data.tagType" effect="plain" class="!text-11px">
              {{ data.nodeType || 'node' }}
            </el-tag>
            <span class="text-13px break-all">{{ data.label }}</span>
          </div>
        </template>
      </VueFlow>
      <el-empty v-else-if="!loading" description="该流程没有可渲染的节点" :image-size="80" />
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import type { Edge, Node } from '@vue-flow/core'
import { AgentWorkflowApi, type AgentWorkflowDefVO } from '@/api/agent/workflow'
import { layoutDsl } from '../layout'

defineOptions({ name: 'WorkflowCanvasDialog' })

const visible = ref(false)
const loading = ref(false)
const def = ref<AgentWorkflowDefVO>()
const parseError = ref('')
const flowNodes = ref<Node[]>([])
const flowEdges = ref<Edge[]>([])
/** 每次渲染换一个 key，强制 VueFlow 重挂载：避免在不同 def / 反复预览间残留上一份的视口与边 */
const renderKey = ref<string | number>('empty')
/** openDsl（未保存草稿预览）时为 true，仅用于标题区分「预览」与「只读」 */
const isPreview = ref(false)

const statusLabel = (status: string) =>
  ({ DRAFT: '草稿', PUBLISHED: '已发布', DISABLED: '已停用' })[status] ?? status
const statusTagType = (status: string): 'info' | 'success' | 'warning' => {
  if (status === 'PUBLISHED') return 'success'
  if (status === 'DISABLED') return 'warning'
  return 'info'
}
const triggerLabel = (type?: string) =>
  type
    ? ({ form_event: '表单事件', schedule: '定时', chat: '对话', webhook: 'Webhook' })[type] ?? type
    : '—'

/**
 * 解析 DSL 原文 → 布局 → 填充画布。open（按 id 拉）与 openDsl（预览未保存草稿）共用。
 * 🔴 dsl 非法/为空时置 parseError 显式报错，绝不白屏（R3）。
 */
const renderFromDsl = (dslText: string | null | undefined, meta: AgentWorkflowDefVO) => {
  def.value = meta
  parseError.value = ''
  flowNodes.value = []
  flowEdges.value = []
  renderKey.value = meta?.id ?? `draft-${Date.now()}`
  if (!dslText) {
    parseError.value = '该流程定义为空（没有 DSL 正文），无法渲染画布。'
    return
  }
  let parsed: any
  try {
    parsed = JSON.parse(dslText)
  } catch (e: any) {
    parseError.value = `DSL 解析失败：${e?.message ?? '格式不合法'}`
    return
  }
  const { nodes, edges } = layoutDsl(parsed)
  flowNodes.value = nodes
  flowEdges.value = edges
}

/** 打开对话框（列表页「查看画布」）：按 id 拉已保存定义 → 解析 → 布局 */
const open = async (id: number) => {
  visible.value = true
  loading.value = true
  isPreview.value = false
  def.value = undefined
  try {
    const data = await AgentWorkflowApi.getDef(id)
    renderFromDsl(data.dsl, data)
  } finally {
    loading.value = false
  }
}

/**
 * 打开对话框（表单「预览画布」）：直接渲染一份<b>未保存</b>的 DSL 原文。
 * meta 供头部展示当前表单里的 code/name/status 等（新建时无 id/version，头部相应显示「未保存」）。
 */
const openDsl = (dslText: string, meta: Partial<AgentWorkflowDefVO>) => {
  visible.value = true
  loading.value = false
  isPreview.value = true
  renderFromDsl(dslText, meta as AgentWorkflowDefVO)
}

defineExpose({ open, openDsl })
</script>
