<template>
  <!-- 规划进度条 -->
  <div v-if="status === 'planning'" class="flex items-center gap-10px py-12px">
    <el-icon class="animate-spin text-[var(--el-color-primary)]"><Loading /></el-icon>
    <span class="text-14px text-[var(--el-text-color-secondary)]">{{ planningText }}</span>
  </div>

  <!-- Plan 卡片 -->
  <div
    v-else-if="status === 'pending' || status === 'done'"
    class="border border-[var(--el-border-color)] border-solid rounded-8px overflow-hidden mt-8px"
  >
    <!-- 卡片头 -->
    <div
      class="flex items-center justify-between px-16px py-10px bg-[var(--el-fill-color-light)] border-b border-[var(--el-border-color-lighter)] border-b-solid"
    >
      <div class="flex items-center gap-8px">
        <Icon icon="ep:list" class="text-[var(--el-color-primary)]" />
        <span class="font-medium text-14px">{{ summary }}</span>
      </div>
      <el-tag v-if="status === 'done'" :type="planDoneTagType" size="small" effect="plain">
        {{ planDoneLabel }}
      </el-tag>
      <el-tag v-else size="small" type="warning" effect="plain">待确认</el-tag>
    </div>

    <!-- 警告 -->
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

    <!-- 步骤列表 -->
    <div class="divide-y divide-[var(--el-border-color-lighter)]">
      <div
        v-for="step in steps"
        :key="step.id"
        class="px-16px py-10px flex items-start gap-10px"
      >
        <!-- 勾选框（只在待确认时可交互） -->
        <el-checkbox
          v-model="step.selected"
          :disabled="status !== 'pending'"
          class="flex-shrink-0 mt-1px"
          @change="() => emitSelectionChange()"
        />

        <!-- 步骤内容 -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-6px flex-wrap">
            <!-- 状态图标（执行完毕时） -->
            <el-icon v-if="step.status === 'SUCCESS'" class="text-[var(--el-color-success)]">
              <CircleCheck />
            </el-icon>
            <el-icon
              v-else-if="step.status === 'FAILED'"
              class="text-[var(--el-color-danger)]"
            >
              <CircleClose />
            </el-icon>
            <el-icon
              v-else-if="step.status === 'RUNNING'"
              class="animate-spin text-[var(--el-color-primary)]"
            >
              <Loading />
            </el-icon>
            <el-icon
              v-else-if="step.status === 'SKIPPED'"
              class="text-[var(--el-text-color-placeholder)]"
            >
              <Remove />
            </el-icon>

            <span class="text-14px break-words">{{ step.title }}</span>

            <!-- 不可逆标记 -->
            <el-tag
              v-if="step.irreversible"
              size="small"
              type="danger"
              effect="plain"
              class="!text-11px"
            >
              ⚠ 不可逆
            </el-tag>
          </div>

          <!-- 展开的参数（调试用，默认折叠） -->
          <el-collapse-transition>
            <div
              v-if="expandedStepId === step.id"
              class="mt-6px text-12px text-[var(--el-text-color-secondary)] bg-[var(--el-fill-color-darker)] rounded-4px p-8px font-mono whitespace-pre-wrap break-all"
            >
              {{ JSON.stringify(step.params, null, 2) }}
            </div>
          </el-collapse-transition>

          <!-- 执行结果/失败原因 -->
          <div
            v-if="step.status === 'FAILED' && step.errorMsg"
            class="mt-4px text-12px text-[var(--el-color-danger)]"
          >
            {{ step.errorMsg }}
          </div>

          <!-- 详情展开按钮 -->
          <button
            class="mt-4px text-12px text-[var(--el-text-color-placeholder)] hover:text-[var(--el-color-primary)] cursor-pointer bg-transparent border-none p-0"
            @click="toggleExpand(step.id)"
          >
            {{ expandedStepId === step.id ? '收起参数' : '查看参数' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 操作栏（只在待确认时显示） -->
    <div
      v-if="status === 'pending'"
      class="px-16px py-10px bg-[var(--el-fill-color-light)] border-t border-[var(--el-border-color-lighter)] border-t-solid flex items-center justify-between"
    >
      <span class="text-12px text-[var(--el-text-color-secondary)]">
        <el-icon><Clock /></el-icon>
        {{ expireCountdown }} 后过期
      </span>
      <div class="flex gap-8px">
        <el-button size="small" @click="$emit('cancel')">取消</el-button>
        <el-button
          type="primary"
          size="small"
          :loading="executing"
          :disabled="!hasSelected"
          @click="$emit('execute')"
        >
          确认执行
        </el-button>
      </div>
    </div>

    <!-- 执行结果摘要 -->
    <div
      v-if="status === 'done' && executeResult"
      class="px-16px py-10px bg-[var(--el-fill-color-light)] border-t border-[var(--el-border-color-lighter)] border-t-solid text-13px"
    >
      <span class="text-[var(--el-color-success)]">{{ executeResult.successCount }} 步成功</span>
      <span v-if="executeResult.failedCount" class="ml-8px text-[var(--el-color-danger)]">
        {{ executeResult.failedCount }} 步失败
      </span>
      <span v-if="executeResult.skippedCount" class="ml-8px text-[var(--el-text-color-secondary)]">
        {{ executeResult.skippedCount }} 步跳过
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AgentPlanStepVO, AgentPlanExecuteResultVO } from '@/api/agent/plan'

defineOptions({ name: 'AgentPlanCard' })

const props = defineProps<{
  /** 卡片所处的显示状态 */
  status: 'planning' | 'pending' | 'done'
  /** 正在规划时的进度文字 */
  planningText?: string
  /** 计划摘要 */
  summary?: string
  /** 步骤列表 */
  steps?: AgentPlanStepVO[]
  /** 校验器警告 */
  warnings?: string[]
  /** 过期时间 */
  expireTime?: Date
  /** 是否正在执行 */
  executing?: boolean
  /** 执行结果（done 时） */
  executeResult?: AgentPlanExecuteResultVO | null
  /** 最终计划状态（done 时用来决定颜色） */
  planStatus?: string
}>()

const emit = defineEmits<{
  execute: []
  cancel: []
  /** 勾选变化后通知父组件（父组件负责持久化到后端） */
  selectionChange: [selectedIds: number[]]
}>()

const expandedStepId = ref<number | null>(null)

const hasSelected = computed(() => props.steps?.some((s) => s.selected) ?? false)

/** 距过期还有多久（用人类可读的格式） */
const expireCountdown = computed(() => {
  if (!props.expireTime) return '—'
  const diff = Math.max(0, new Date(props.expireTime).getTime() - Date.now())
  const minutes = Math.ceil(diff / 60_000)
  return minutes > 1 ? `${minutes} 分钟` : '不到 1 分钟'
})

/** 每分钟刷一次倒计时 */
let countdownTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  countdownTimer = setInterval(() => {
    // 触发响应式更新（expireCountdown 依赖 Date.now()，间接刷新）
  }, 30_000)
})
onBeforeUnmount(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})

const planDoneTagType = computed(() => {
  if (props.planStatus === 'DONE') return 'success'
  if (props.planStatus === 'PARTIAL_FAILED') return 'warning'
  if (props.planStatus === 'CANCELLED' || props.planStatus === 'EXPIRED') return 'info'
  return 'info'
})

const planDoneLabel = computed(() => {
  const map: Record<string, string> = {
    DONE: '已完成',
    PARTIAL_FAILED: '部分失败',
    CANCELLED: '已取消',
    EXPIRED: '已过期'
  }
  return map[props.planStatus ?? ''] ?? '已结束'
})

const toggleExpand = (stepId: number) => {
  expandedStepId.value = expandedStepId.value === stepId ? null : stepId
}

const emitSelectionChange = () => {
  const selected = (props.steps ?? []).filter((s) => s.selected).map((s) => s.id)
  emit('selectionChange', selected)
}
</script>
