<template>
  <!-- 人工确认卡片（增量13）：工作流驱动的 Agent 绑定的 chatflow 在 hitl.confirm 节点挂起时出现。
       与 WorkflowDraftCard 同属「结构化可交互卡片」，但语义不同——那张是「要不要发布并运行这份新流程」，
       这张是「这条已在跑的流程走到人工闸口，同意还是拒绝」。确认就在聊天里完成，用户不必跳去工作台。 -->
  <div
    data-testid="hitl-confirm-card"
    class="border border-[var(--el-border-color)] border-solid rounded-8px overflow-hidden mt-8px"
  >
    <!-- 卡片头 -->
    <div
      class="flex items-center justify-between px-16px py-10px bg-[var(--el-fill-color-light)] border-b border-[var(--el-border-color-lighter)] border-b-solid"
    >
      <div class="flex items-center gap-8px min-w-0">
        <Icon icon="ep:warning" class="text-[var(--el-color-warning)] flex-shrink-0" />
        <span class="font-medium text-14px truncate">流程等待人工确认</span>
      </div>
      <el-tag :type="statusTagType" size="small" effect="plain" class="flex-shrink-0">
        {{ statusLabel }}
      </el-tag>
    </div>

    <!-- 提示文案 + 挂起节点 -->
    <div class="px-16px py-12px">
      <div class="text-14px text-[var(--el-text-color-primary)] break-words">
        {{ content || '该流程走到人工确认闸口，已暂停等待您的决定。' }}
      </div>
      <div v-if="nodeId || nodeName" class="text-12px text-[var(--el-text-color-secondary)] mt-6px">
        挂起节点：
        <!-- 🔴 显示名优先，机器键退居其次（S3）：`confirm_create_table` 对审批人没有信息量，
             「确认建表」才是他能据以判断的东西。nodeId 仍留着，因为排查问题时要能对上执行历史 -->
        <span class="text-[var(--el-text-color-primary)]">{{ nodeName || nodeId }}</span>
        <code
          v-if="nodeName"
          data-testid="hitl-node-id"
          class="ml-4px px-4px py-1px bg-[var(--el-fill-color)] rounded"
        >
          {{ nodeId }}
        </code>
      </div>

      <!-- 「点同意之后将会做什么」（S3 / Req 3 的落点）。
           🔴 三态要分清，别让历史消息上挂一堆假的「清单不可用」：
           - 有清单 → 渲染清单
           - 正在取 → 渲染加载态
           - 取过但没取到（manifestError 有值）→ 渲染「清单不可用」
           - 宿主根本没打算取（比如已终态的历史卡片）→ 什么都不渲染，可见的缺席好过一句假警告 -->
      <ChangeManifestCard
        v-if="manifest || manifestLoading || manifestError"
        data-testid="hitl-manifest"
        :manifest="manifest"
        :loading="manifestLoading"
        :error="manifestError"
        collapsible
        class="mt-10px"
      />
    </div>

    <!-- 续跑中提示 -->
    <div
      v-if="running"
      class="px-16px py-10px flex items-center gap-8px text-13px text-[var(--el-color-primary)]"
    >
      <el-icon class="animate-spin"><Loading /></el-icon>
      正在按您的决定续跑流程…
    </div>

    <!-- 续跑失败 -->
    <div v-if="error" class="px-16px py-10px">
      <el-alert :title="error" type="error" :closable="false" show-icon class="!py-6px" />
    </div>

    <!-- 操作栏：未决定→两个按钮；已决定→只读结果标签（刷新重建 / 续跑完成后） -->
    <div
      class="px-16px py-10px bg-[var(--el-fill-color-light)] border-t border-[var(--el-border-color-lighter)] border-t-solid flex items-center justify-end gap-8px"
    >
      <template v-if="!decided">
        <el-button
          size="small"
          :disabled="running"
          data-testid="hitl-reject"
          @click="$emit('decide', false)"
        >
          拒绝
        </el-button>
        <el-button
          type="primary"
          size="small"
          :loading="running"
          data-testid="hitl-approve"
          @click="$emit('decide', true)"
        >
          同意并继续
        </el-button>
      </template>
      <el-tag v-else :type="decidedTagType" size="small" effect="plain">
        {{ decidedLabel }}
      </el-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChangeManifestVO } from '@/api/agent/workflow'
import ChangeManifestCard from '@/views/agent/workflow/components/ChangeManifestCard.vue'

defineOptions({ name: 'HitlConfirmCard' })

const props = defineProps<{
  /** 卡片提示文案（后端 WORKFLOW_CONFIRM 事件的 content） */
  content?: string
  /** 挂起所在的节点 id */
  nodeId?: string
  /**
   * 挂起节点的显示名（S3）：与进度句「正在执行：xx」同一份来源。
   * 空则回落 nodeId —— 但**不要**反过来把 nodeId 当显示名传进来，那等于没做这件事。
   */
  nodeName?: string
  /**
   * 「点同意之后将会做什么」的变更清单（S3 / Req 3）。
   * 🔴 后端已按 `fromNodeId = 挂起节点`裁剪过，只含该闸口<b>之后</b>的动作。
   * 🔴 null 且 manifestError 有值 = 清单生成失败，渲染「清单不可用」；
   *    两者都空 = 宿主没打算取（历史终态卡片），此时整块不渲染。
   */
  manifest?: ChangeManifestVO | null
  /** 宿主正在按 executionId 反查清单（刷新重建时） */
  manifestLoading?: boolean
  /** 清单不可用的原因 */
  manifestError?: string
  /** 是否正在续跑（点了同意/拒绝后、resume 流结束前） */
  running?: boolean
  /**
   * 用户已做的决定；非空=已处理，按钮换成只读结果标签。
   * - 'approved'/'rejected'：直播时点按钮即置位（准确知道同意还是拒绝）
   * - 'resolved'：刷新重建时，执行已结束但库里没存「当时同意还是拒绝」，只能诚实显示「已处理」
   */
  decided?: 'approved' | 'rejected' | 'resolved' | null
  /** 续跑失败原因 */
  error?: string
}>()

defineEmits<{
  /** 用户点「同意并继续 / 拒绝」：父组件负责调 resume-workflow-stream 续跑 */
  decide: [approved: boolean]
}>()

const statusTagType = computed(() => {
  if (props.error) return 'danger'
  if (props.running) return 'warning'
  if (props.decided === 'approved') return 'success'
  return 'info'
})

const statusLabel = computed(() => {
  if (props.error) return '续跑失败'
  if (props.running) return '续跑中'
  if (props.decided === 'approved') return '已同意'
  if (props.decided === 'rejected') return '已拒绝'
  if (props.decided === 'resolved') return '已处理'
  return '待确认'
})

/** 已处理后底部那枚只读标签的文案/颜色（与头部状态标签区分：头部说流程态，底部说用户当时的动作） */
const decidedLabel = computed(() => {
  if (props.decided === 'approved') return '已同意'
  if (props.decided === 'rejected') return '已拒绝'
  return '已处理'
})
const decidedTagType = computed(() => (props.decided === 'approved' ? 'success' : 'info'))
</script>
