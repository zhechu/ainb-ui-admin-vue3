<!-- 对话后建议（方案 §9）-->
<template>
  <div v-if="suggestions && suggestions.length > 0" class="flex flex-wrap gap-8px mt-10px">
    <el-tag
      v-for="(item, index) in suggestions"
      :key="index"
      class="cursor-pointer !px-12px !py-16px"
      type="info"
      effect="plain"
      round
      @click="emit('select', item)"
    >
      <span class="flex items-center gap-4px">
        <Icon icon="ep:promotion" :size="13" />
        {{ item.text }}
      </span>
    </el-tag>
  </div>
</template>

<script setup lang="ts">
import type { AgentSuggestionVO } from '@/api/agent/assistant'

/**
 * 建议条
 *
 * 方案 §9.3 的三条约束在这里落地：
 *  - 最多 3 条（后端已截断，前端不再重复限制，避免两处上限不一致）
 *  - 必须可点击直接执行 —— 所以整个标签是可点的，点了立刻发送，不是只填进输入框让用户再按一次
 *  - 不得凭空建议做不到的事 —— 权限预筛在后端做（前端拿不到工具授权信息，
 *    在这里过滤只会是假的安全感）
 */
defineProps<{
  suggestions?: AgentSuggestionVO[]
}>()

const emit = defineEmits<{
  (e: 'select', suggestion: AgentSuggestionVO): void
}>()
</script>
