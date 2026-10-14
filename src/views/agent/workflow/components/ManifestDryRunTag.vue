<template>
  <!-- 预演结论标签（S3）：把一项变更的 dryRun 三态压成一颗内联小标签。
       🔴 「预演」= 平台在发布/审批前把「照这份 DSL 真跑会发生什么」试算一遍，不落地。
       代码里的 dryRun 是机器名，界面上只说「预演」——「干跑」是 dry run 的直译，
       用户读不通，已于 2026-10-03 从全部用户可见文案里退场（注释与后端保留机器口径）。
       🔴 三态不能塌成两态，这是清单四条硬纪律里的第二条（方案 §L1147）：
       NOT_PROBED 是「本次没校验」，**不是**「不通过」——把它渲染成红色，
       用户会去改一份本来没问题的 DSL；渲染成绿色更糟，等于替 infra 的故障背书。
       reason 三态都必填且是探测拿回来的原文，故只放进 tooltip 照抄，不自己编话。 -->
  <!-- 🔴 data-testid 挂在 el-tag 上而不是 el-tooltip 上：el-tooltip 不渲染自己的根元素
       （它只克隆默认插槽 + 一个 teleport 出去的浮层），属性挂在它身上会被当成
       「非 props 的多余属性」丢掉 —— 于是 e2e 找不到这个 testid，纪律②就没人守了。
       挂在 el-tag 上还顺带让断言能直接读到 el-tag--danger / --warning 这个类型 class。 -->
  <el-tooltip v-if="dryRun" :content="dryRun.reason || label" placement="top" :show-after="120">
    <el-tag
      data-testid="dry-run-tag"
      :type="tagType"
      size="small"
      :effect="tagEffect"
      class="ml-6px align-middle"
    >
      {{ label }}
    </el-tag>
  </el-tooltip>
</template>

<script setup lang="ts">
import type { ManifestDryRunVO } from '@/api/agent/workflow'

defineOptions({ name: 'ManifestDryRunTag' })

const props = defineProps<{
  /** 一项变更的预演结论；缺席就不画标签（可见的缺席，好过一颗假装知道的标签） */
  dryRun?: ManifestDryRunVO | null
}>()

const label = computed(() => {
  switch (props.dryRun?.outcome) {
    case 'PASSED':
      return '预演通过'
    case 'REJECTED':
      return '预演不通过'
    case 'NOT_PROBED':
      return '本次没校验'
    default:
      return '未知'
  }
})

const tagType = computed(() => {
  switch (props.dryRun?.outcome) {
    case 'PASSED':
      return 'success'
    case 'REJECTED':
      return 'danger'
    case 'NOT_PROBED':
      return 'warning'
    default:
      return 'info'
  }
})

/** 只有「不通过」用实心：它是唯一需要审批人立刻看见并据此拒批的一态 */
const tagEffect = computed(() => (props.dryRun?.outcome === 'REJECTED' ? 'dark' : 'plain'))
</script>
