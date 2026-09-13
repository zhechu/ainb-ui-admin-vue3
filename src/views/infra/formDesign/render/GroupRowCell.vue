<template>
  <!--
    分组行

    整行只渲染这一个单元格（外层用 span-method 把它 colspan 到满行），
    所以这里要把「组名 + 条数 + 各列小计」全部排在一行里。

    ⚠️ 点击整行切换折叠，而不是只点那个小箭头：箭头只有十几个像素宽，
    而分组行横跨整张表 —— 用户的直觉是点哪儿都行，点了没反应会以为折叠坏了。
  -->
  <div class="grid-group-row" @click="emit('toggle', row.__groupKey)">
    <Icon
      class="grid-group-arrow"
      :icon="row.__groupCollapsed ? 'ep:arrow-right' : 'ep:arrow-down'"
      :size="14"
    />
    <span class="grid-group-label">{{ row.__groupLabel }}</span>
    <span v-if="showCount" class="grid-group-count">（{{ row.__groupCount }} 条）</span>
    <span v-for="item in sums" :key="item.field" class="grid-group-sum">
      {{ item.label }}：<strong>{{ item.text }}</strong>
    </span>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { formatSummaryValue } from '@/components/FormWidgets/listCell'
import type { GroupRow } from '@/components/FormWidgets/rowGroup'

defineOptions({ name: 'GroupRowCell' })

const props = defineProps<{
  /** 分组行 */
  row: GroupRow
  /** 列配置，用来取小计列的标题与格式化 */
  columns: any[]
  /** 分组行上要不要显示条数 */
  showCount?: boolean
}>()

const emit = defineEmits<{ (e: 'toggle', key: string): void }>()

/**
 * 小计的显示项
 *
 * 走 `formatSummaryValue` 而不是自己拼字符串 —— 与列表底部的合计行、
 * 与数据行都是同一条格式化路径。三处各写一遍的话，同一列会在
 * 数据行、分组小计、总合计上显示成三种样子。
 */
const sums = computed(() =>
  Object.entries(props.row.__groupSums ?? {}).map(([field, value]) => {
    const col = props.columns.find((c: any) => c.field === field && !c.subField)
    return {
      field,
      label: col?.label || field,
      text: formatSummaryValue(value, col?.formatter)
    }
  })
)
</script>

<style lang="scss" scoped>
.grid-group-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-weight: 600;
}

.grid-group-arrow {
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.grid-group-label {
  color: var(--el-color-primary);
}

.grid-group-count {
  color: var(--el-text-color-secondary);
  font-weight: 400;
}

/* 小计推到右边，与组名拉开距离 —— 挤在一起时读不出哪个数配哪个标题 */
.grid-group-sum {
  margin-left: 16px;
  font-weight: 400;
  color: var(--el-text-color-regular);
}

.grid-group-sum:first-of-type {
  margin-left: auto;
}
</style>
