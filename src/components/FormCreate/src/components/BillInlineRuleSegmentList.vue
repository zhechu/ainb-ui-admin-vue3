<template>
  <div v-if="!segments || segments.length === 0" class="empty">未配置</div>
  <div v-else class="segment-list">
    <div v-for="(segment, index) in segments" :key="index" class="segment-item">
      <!-- 用上下按钮而不是拖拽：属性面板本身就在一个可滚动的窄栏里，
           HTML5 拖拽在这种容器里的落点判定很不稳定，点两下反而更可控 -->
      <div class="segment-order">
        <el-button
          link
          size="small"
          :disabled="index === 0"
          @click="emit('move', index, index - 1)"
        >
          <Icon icon="ep:arrow-up" />
        </el-button>
        <el-button
          link
          size="small"
          :disabled="index === segments.length - 1"
          @click="emit('move', index, index + 1)"
        >
          <Icon icon="ep:arrow-down" />
        </el-button>
      </div>

      <el-select
        v-model="segment.sourceType"
        size="small"
        class="!w-72px"
        @change="onSourceTypeChange(segment)"
      >
        <el-option label="常量" :value="2" />
        <el-option label="字段" :value="1" />
      </el-select>

      <el-select
        v-if="segment.sourceType === 1"
        v-model="segment.value"
        size="small"
        filterable
        clearable
        placeholder="选择字段"
        class="flex-1"
        @change="emit('change')"
      >
        <el-option
          v-for="item in fieldOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-input
        v-else
        v-model="segment.value"
        size="small"
        placeholder="固定字符"
        class="flex-1"
        @change="emit('change')"
      />

      <el-button link type="danger" size="small" @click="emit('remove', index)">
        <Icon icon="ep:delete" />
      </el-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 内联规则的前后缀段列表
 *
 * 只负责渲染与编辑，增删和排序都通过事件交回父组件 ——
 * 段数组的所有权在父组件那里，双向直接改容易出现两边不同步。
 */
defineOptions({ name: 'BillInlineRuleSegmentList' })

defineProps({
  segments: {
    type: Array as PropType<Array<{ sourceType: number; value: string }>>,
    default: () => []
  },
  fieldOptions: {
    type: Array as PropType<Array<{ label: string; value: string }>>,
    default: () => []
  }
})

const emit = defineEmits(['remove', 'move', 'change'])

/** 换来源类型时清空值：字段名和固定字符不是一回事，留着上一个值只会造成误解 */
const onSourceTypeChange = (segment: { sourceType: number; value: string }) => {
  segment.value = ''
  emit('change')
}
</script>

<style lang="scss" scoped>
.empty {
  padding: 6px 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.segment-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.segment-item {
  display: flex;
  gap: 4px;
  align-items: center;
}

.segment-order {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 0;

  :deep(.el-button) {
    height: 12px;
    padding: 0;
    margin-left: 0;
  }
}
</style>
