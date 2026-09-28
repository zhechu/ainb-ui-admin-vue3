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

    <!-- 警告：后端不会报错的静默改写。默认折叠成一句人话汇总，点「查看详情」才展开技术原文，
         避免把 JSON 片段 / recovery:compensate 这类术语直接甩给业务用户。 -->
    <div v-if="warnings?.length" class="px-16px pt-10px">
      <el-alert type="warning" :closable="false" show-icon class="!py-6px">
        <template #title>
          <div class="flex items-center gap-6px">
            <span>有 {{ warnings.length }} 条技术提示，通常不影响运行。</span>
            <el-link type="warning" :underline="false" class="!text-12px" @click="showWarnings = !showWarnings">
              {{ showWarnings ? '收起' : '查看详情' }}
            </el-link>
          </div>
        </template>
        <ul v-if="showWarnings" class="pl-18px mb-0 mt-4px">
          <li v-for="(w, i) in warnings" :key="i" class="text-12px leading-20px">{{ w }}</li>
        </ul>
      </el-alert>
    </div>

    <!-- 只读节点预览：plan-as-workflow 产出的是一整份 DSL（DAG），这里列出节点顺序与类型。
         刻意没有勾选框 —— 与线性 plan 的「逐项勾选执行」不同，Workflow 是一个整体，确认即整份运行。
         AI助手 UX 修复：每个节点两行式（中文类型徽标 + 名称 + 完成勾 / 灰字一句话摘要），
         点击展开 config 详情行，让用户看清「这个节点到底要做什么」，而不只是一个名字。 -->
    <div v-if="nodes?.length" class="divide-y divide-[var(--el-border-color-lighter)]">
      <div
        v-for="(node, idx) in nodes"
        :key="node.id"
        data-testid="workflow-node"
        class="px-16px py-10px"
      >
        <div
          class="flex items-center gap-10px cursor-pointer"
          @click="toggle(node.id)"
        >
          <el-tag
            size="small"
            effect="plain"
            :type="nodeTypeMeta(node.type).tagType"
            class="!text-11px flex-shrink-0"
          >
            {{ nodeTypeMeta(node.type).label }}
          </el-tag>
          <div class="flex-1 min-w-0">
            <div class="text-14px break-words">{{ node.name || `步骤 ${idx + 1}` }}</div>
            <div
              v-if="node.summary"
              class="text-12px text-[var(--el-text-color-secondary)] leading-18px mt-2px break-words"
            >
              {{ node.summary }}
            </div>
          </div>
          <!-- 运行进度：该节点已完成则打勾（NODE 事件在节点完成时到达） -->
          <el-icon v-if="isNodeDone(node.id)" class="text-[var(--el-color-success)] flex-shrink-0">
            <CircleCheck />
          </el-icon>
          <!-- 有详情可展开时给个箭头指示 -->
          <el-icon
            v-if="node.details?.length"
            class="text-[var(--el-text-color-placeholder)] flex-shrink-0 transition-transform"
            :class="expanded.has(node.id) ? 'rotate-90' : ''"
          >
            <ArrowRight />
          </el-icon>
        </div>
        <!-- 展开态：config 详情行（中文标签 → 值） -->
        <div
          v-if="expanded.has(node.id) && node.details?.length"
          class="mt-8px ml-2px pl-10px border-l-2px border-l-solid border-[var(--el-border-color-lighter)]"
        >
          <div
            v-for="(d, i) in node.details"
            :key="i"
            class="text-12px leading-20px flex gap-6px"
          >
            <span class="text-[var(--el-text-color-secondary)] flex-shrink-0">{{ d.label }}：</span>
            <span class="text-[var(--el-text-color-regular)] break-words min-w-0">{{ d.value }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="px-16px py-12px text-13px text-[var(--el-text-color-secondary)]">
      （未能解析出节点预览）
    </div>

    <!-- 执行顺序：把 edges 译成「A → B / A →（分支）B」文本行，让用户看清节点如何串联 -->
    <div
      v-if="edgesText?.length"
      class="px-16px py-10px bg-[var(--el-fill-color-blank)] border-t border-[var(--el-border-color-lighter)] border-t-solid"
    >
      <div class="text-12px font-600 text-[var(--el-text-color-secondary)] mb-6px">执行顺序</div>
      <ol class="pl-18px mb-0">
        <li
          v-for="(line, i) in edgesText"
          :key="i"
          class="text-13px text-[var(--el-text-color-regular)] leading-22px"
        >
          {{ line }}
        </li>
      </ol>
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
import { nodeTypeMeta, type SummaryNode } from '@/views/agent/workflow/nodeSummary'

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
  /** 只读节点预览（父组件用 nodeSummary.buildSummaryNodes 从 dsl 组装，含一句话摘要与详情行） */
  nodes?: SummaryNode[]
  /** 流程走向文本行（父组件用 nodeSummary.flowStepsText 从 dsl.edges 组装） */
  edgesText?: string[]
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

/** 展开态：记录哪些节点 id 的 config 详情被展开（点击节点行切换） */
const expanded = ref<Set<string>>(new Set())
/** 技术提示默认折叠，点「查看详情」才展开原文 */
const showWarnings = ref(false)
const toggle = (id: string) => {
  const next = new Set(expanded.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expanded.value = next
}

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
</script>

