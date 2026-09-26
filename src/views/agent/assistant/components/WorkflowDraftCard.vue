<template>
  <!-- 规划进度条 -->
  <!-- 🔴 data-testid 沿用旧 PlanCard 的契约，是给 e2e 用的：要断言的正是「这句进度文字会不会随时间变化」。
       规划路径曾经把事件全积压到最后 1 秒才一次性发出，界面上这句话一动不动地挂五分钟，
       用户看到的就是「输入完没反应」。只靠肉眼看不出来，必须采样比对 -->
  <div
    v-if="status === 'planning'"
    data-testid="assistant-planning"
    class="flex items-center gap-10px py-12px"
  >
    <el-icon class="animate-spin text-[var(--el-color-primary)]"><Loading /></el-icon>
    <span
      data-testid="assistant-planning-text"
      class="text-14px text-[var(--el-text-color-secondary)]"
      >{{ planningText }}</span
    >
  </div>

  <!-- Workflow 草稿卡片 -->
  <div
    v-else
    data-testid="workflow-draft-card"
    class="border border-[var(--el-border-color)] border-solid rounded-8px overflow-hidden mt-8px"
  >
    <!-- 卡片头 -->
    <div
      class="flex items-center justify-between px-16px py-10px bg-[var(--el-fill-color-light)] border-b border-[var(--el-border-color-lighter)] border-b-solid"
    >
      <div class="flex items-center gap-8px min-w-0">
        <Icon icon="ep:share" class="text-[var(--el-color-primary)] flex-shrink-0" />
        <span class="font-medium text-14px truncate">{{ summary || '流程草稿' }}</span>
      </div>
      <el-tag :type="statusTagType" size="small" effect="plain" class="flex-shrink-0">
        {{ statusLabel }}
      </el-tag>
    </div>

    <!-- 警告：后端不会报错的静默改写，不在卡片上说出来就没有第二次机会了 -->
    <div v-if="warnings?.length" class="px-16px pt-10px">
      <el-alert
        v-for="(w, i) in warnings"
        :key="i"
        :title="w"
        type="warning"
        :closable="false"
        show-icon
        class="mb-6px !py-6px"
      />
    </div>

    <!-- 只读节点预览：plan-as-workflow 产出的是一整份 DSL（DAG），这里列出节点顺序与类型。
         刻意没有勾选框 —— 与线性 plan 的「逐项勾选执行」不同，Workflow 是一个整体，确认即整份运行 -->
    <div v-if="nodes?.length" class="divide-y divide-[var(--el-border-color-lighter)]">
      <div
        v-for="node in nodes"
        :key="node.id"
        data-testid="workflow-node"
        class="px-16px py-10px flex items-center gap-10px"
      >
        <el-tag size="small" effect="plain" :type="nodeTagType(node.type)" class="!text-11px flex-shrink-0">
          {{ node.type }}
        </el-tag>
        <span class="text-14px break-words flex-1 min-w-0">{{ node.name || node.id }}</span>
        <!-- 运行进度：该节点已完成则打勾（NODE 事件在节点完成时到达） -->
        <el-icon v-if="isNodeDone(node.id)" class="text-[var(--el-color-success)] flex-shrink-0">
          <CircleCheck />
        </el-icon>
      </div>
    </div>
    <div v-else class="px-16px py-12px text-13px text-[var(--el-text-color-secondary)]">
      （未能解析出节点预览）
    </div>

    <!-- 运行中提示 -->
    <div
      v-if="running"
      class="px-16px py-10px flex items-center gap-8px text-13px text-[var(--el-color-primary)]"
    >
      <el-icon class="animate-spin"><Loading /></el-icon>
      正在运行…（已完成 {{ runProgress?.length ?? 0 }} 个节点）
    </div>

    <!-- 运行终态 -->
    <div v-if="!running && runResult" class="px-16px py-10px">
      <el-alert
        v-if="runResult === 'success'"
        title="运行完成"
        type="success"
        :closable="false"
        show-icon
        class="!py-6px"
      />
      <el-alert
        v-else-if="runResult === 'error'"
        :title="runError || '运行失败'"
        type="error"
        :closable="false"
        show-icon
        class="!py-6px"
      />
      <el-alert
        v-else-if="runResult === 'interrupted'"
        title="流程已挂起，等待人工确认；可在「流程执行」页恢复"
        type="warning"
        :closable="false"
        show-icon
        class="!py-6px"
      />
    </div>

    <!-- 操作栏 -->
    <div
      v-if="status === 'pending' || status === 'published'"
      class="px-16px py-10px bg-[var(--el-fill-color-light)] border-t border-[var(--el-border-color-lighter)] border-t-solid flex items-center justify-end gap-8px"
    >
      <el-button v-if="status === 'pending'" size="small" :disabled="running" @click="$emit('cancel')">
        取消
      </el-button>
      <el-button type="primary" size="small" :loading="running" @click="$emit('confirm')">
        {{ status === 'pending' ? '确认并运行' : '运行' }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WorkflowNodePreview } from '@/api/agent/planner'

defineOptions({ name: 'WorkflowDraftCard' })

const props = defineProps<{
  /** 卡片显示状态：planning 生成中 / pending 草稿待确认 / published 已发布可运行 / done 已结束 */
  status: 'planning' | 'pending' | 'published' | 'done'
  /** 生成中的进度文字 */
  planningText?: string
  /** 摘要（标题） */
  summary?: string
  /** 校验器警告（后端不报错的静默改写） */
  warnings?: string[]
  /** 只读节点预览（父组件 parse dsl 得到） */
  nodes?: WorkflowNodePreview[]
  /** 定义状态：DRAFT / PUBLISHED / DISABLED / CANCELLED（本地取消） */
  defStatus?: string
  /** 是否正在运行 */
  running?: boolean
  /** 运行进度：已完成的节点 */
  runProgress?: { nodeId: string; name?: string }[]
  /** 运行终态 */
  runResult?: 'success' | 'error' | 'interrupted' | null
  /** 运行失败原因 */
  runError?: string
}>()

defineEmits<{
  /** 取消：本地消除卡片（DRAFT 定义留存无害） */
  cancel: []
  /** 确认并运行：父组件负责 publish → run-stream */
  confirm: []
}>()

const isNodeDone = (nodeId: string) =>
  (props.runProgress ?? []).some((n) => n.nodeId === nodeId)

const statusTagType = computed(() => {
  if (props.status === 'pending') return 'warning'
  if (props.status === 'published') return 'success'
  // done：按终态细分
  if (props.defStatus === 'CANCELLED') return 'info'
  if (props.runResult === 'success') return 'success'
  if (props.runResult === 'error') return 'danger'
  if (props.runResult === 'interrupted') return 'warning'
  return 'info'
})

const statusLabel = computed(() => {
  if (props.status === 'pending') return '待确认'
  if (props.status === 'published') return props.running ? '运行中' : '已发布'
  if (props.defStatus === 'CANCELLED') return '已取消'
  if (props.runResult === 'success') return '运行完成'
  if (props.runResult === 'error') return '运行失败'
  if (props.runResult === 'interrupted') return '已挂起'
  return '已结束'
})

/** 节点类型 → 徽标颜色。类型有十几种且随版本增加，认不出的默认 info，不硬猜 */
const nodeTagType = (type: string) => {
  if (!type) return 'info'
  if (type === 'tool') return 'primary'
  if (type === 'llm') return 'success'
  if (type.startsWith('condition')) return 'warning'
  if (type.startsWith('hitl')) return 'danger'
  return 'info'
}
</script>
