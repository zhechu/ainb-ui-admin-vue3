<template>
  <div class="sub-table-summary-field">
    <div v-if="!columns.length" class="empty-tip">
      子表里还没有可合计的列。合计只对数字类的明细列有意义 ——
      先在子表里放一个「数字输入」或「计算公式」控件。
    </div>

    <template v-else>
      <div v-for="(item, index) in summaries" :key="index" class="summary-item">
        <el-select
          v-model="item.field"
          placeholder="选择明细列"
          size="small"
          class="w-full mb-6px"
          @change="onFieldChange(item)"
        >
          <el-option
            v-for="column in columns"
            :key="column.field"
            :label="column.label"
            :value="column.field"
          />
        </el-select>
        <div class="summary-row">
          <el-select v-model="item.method" size="small" class="flex-1" @change="emitChange">
            <el-option v-for="m in METHODS" :key="m.value" :label="m.label" :value="m.value" />
          </el-select>
          <el-input-number
            v-model="item.precision"
            :min="0"
            :max="6"
            size="small"
            controls-position="right"
            class="w-90px"
            @change="emitChange"
          />
          <el-button link type="danger" size="small" @click="remove(index)">删除</el-button>
        </div>
      </div>

      <el-button link type="primary" size="small" @click="add">+ 添加合计列</el-button>
    </template>
  </div>
</template>

<script lang="ts" setup>
/**
 * 子表「合计行」的配置
 *
 * 产出 `props.summaryColumns`，运行时据此在子表下方渲染一行合计。
 *
 * 合计值由 `useSubTableEnhance.calculateSummary` 算，它内部复用公式求值器 ——
 * 这样「空值怎么算、字符串数值怎么转、精度怎么收敛」与公式字段完全一致。
 * 否则同一份明细，公式字段算出的合计与合计行显示的可能差一分钱，
 * 而用户只会认为是系统算错了。
 */
import type { SubTableSummaryColumn } from '@/components/FormCreate/src/subtable/useSubTableEnhance'
import { readNestedRules } from '@/components/FormWidgets/contracts'

defineOptions({ name: 'SubTableSummaryField' })

const props = defineProps<{
  /** 设计器注入：当前正在配置的规则（子表控件本身） */
  formCreateInject?: any
}>()

const METHODS = [
  { value: 'SUM', label: '求和' },
  { value: 'AVG', label: '平均' },
  { value: 'COUNT', label: '计数' },
  { value: 'MAX', label: '最大' },
  { value: 'MIN', label: '最小' }
]

/**
 * 可合计的明细列
 *
 * 只列数字类控件。给文本列配 SUM 得到的永远是 0 ——
 * 那不是「合计为 0」，是「这一列根本不该合计」，让它出现在下拉里只会误导。
 */
const NUMERIC_TYPES = new Set(['inputNumber', 'slider', 'rate', 'Formula'])

const rule = computed(() => props.formCreateInject?.rule ?? {})

const columns = computed(() => {
  const result: Array<{ field: string; label: string }> = []
  const walk = (list: any[] | undefined) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      if (item.field && NUMERIC_TYPES.has(item.type)) {
        result.push({ field: item.field, label: item.title || item.field })
      }
      // 明细列也可能被放在栅格里
      walk(item.children)
    }
  }
  walk(readNestedRules(rule.value))
  return result
})

const summaries = ref<SubTableSummaryColumn[]>([])

watch(
  () => rule.value.props?.summaryColumns,
  (value) => {
    summaries.value = Array.isArray(value) ? value.map((item: any) => ({ ...item })) : []
  },
  { immediate: true, deep: true }
)

const emitChange = () => {
  if (!rule.value.props) rule.value.props = {}
  // 空数组写成 undefined：formFields 是逐条序列化后存库的，
  // 每个子表都带一个空 summaryColumns 会让 JSON 白白变胖
  rule.value.props.summaryColumns = summaries.value.length
    ? summaries.value.map((item) => ({ ...item }))
    : undefined
}

/** 选了列就把标题带过来，合计行上显示的是标题而不是字段 ID */
const onFieldChange = (item: SubTableSummaryColumn) => {
  const column = columns.value.find((c) => c.field === item.field)
  if (column) item.label = column.label
  emitChange()
}

const add = () => {
  const first = columns.value[0]
  summaries.value.push({
    field: first?.field ?? '',
    label: first?.label ?? '',
    method: 'SUM',
    precision: 2
  })
  emitChange()
}

const remove = (index: number) => {
  summaries.value.splice(index, 1)
  emitChange()
}
</script>

<style lang="scss" scoped>
.sub-table-summary-field {
  .empty-tip {
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
  }

  .summary-item {
    padding: 8px;
    margin-bottom: 8px;
    background: var(--el-fill-color-light);
    border-radius: 4px;
  }

  .summary-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
}
</style>
