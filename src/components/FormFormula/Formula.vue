<template>
  <div class="formula-display">
    <span v-if="displayValue !== ''" class="formula-value">{{ displayValue }}</span>
    <span v-else class="formula-empty">—</span>
    <el-tooltip v-if="expression" :content="expression" placement="top">
      <Icon icon="ep:cpu" class="formula-icon" />
    </el-tooltip>
  </div>
</template>

<script lang="ts" setup>
defineOptions({ name: 'Formula' })

/**
 * 计算公式控件（运行时）
 *
 * 只读展示。值由 useFormulaRuntime 统一算好写进表单数据，本组件不自己算 ——
 * 一个字段可能被多个公式依赖，分散计算会算出不一致的中间态。
 *
 * 提交时服务端还会用同一份 AST 权威重算一遍并覆盖，所以这里显示的值仅供参考：
 * 即便前端算错了，入库的也是服务端的结果。
 */
const props = defineProps<{
  modelValue?: any
  /** 原始表达式，鼠标悬停时展示，便于用户理解这个数是怎么来的 */
  expression?: string
  /** 千分位 */
  thousands?: boolean
  /** 保留小数位 */
  precision?: number
  /** 前缀，如 ￥ */
  prefix?: string
  /** 后缀，如 元 */
  suffix?: string
}>()

const displayValue = computed(() => {
  const raw = props.modelValue
  if (raw === null || raw === undefined || raw === '') return ''

  let text: string
  const num = Number(raw)
  if (!Number.isNaN(num) && typeof raw !== 'boolean') {
    text =
      props.precision === null || props.precision === undefined
        ? String(raw)
        : num.toFixed(props.precision)
    if (props.thousands) {
      // 只给整数部分加千分位，小数部分原样保留
      const [intPart, decPart] = text.split('.')
      const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      text = decPart ? `${withSep}.${decPart}` : withSep
    }
  } else {
    text = String(raw)
  }
  return `${props.prefix ?? ''}${text}${props.suffix ?? ''}`
})
</script>

<style lang="scss" scoped>
.formula-display {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
}

.formula-value {
  font-weight: 500;
}

.formula-empty {
  color: var(--el-text-color-placeholder);
}

.formula-icon {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  cursor: help;
}
</style>
