<template>
  <!-- 下拉：字典列 -->
  <el-select
    v-if="widget.widget === 'SELECT'"
    :model-value="modelValue"
    class="w-full"
    clearable
    filterable
    size="small"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-option
      v-for="opt in dictOptions"
      :key="opt.value"
      :label="opt.label"
      :value="opt.value"
    />
  </el-select>

  <!-- 数字 -->
  <el-input-number
    v-else-if="widget.widget === 'NUMBER'"
    :model-value="modelValue"
    class="w-full"
    controls-position="right"
    size="small"
    @update:model-value="emit('update:modelValue', $event)"
  />

  <!-- 日期 / 日期时间 -->
  <el-date-picker
    v-else-if="widget.widget === 'DATE' || widget.widget === 'DATETIME'"
    :model-value="modelValue"
    class="w-full"
    size="small"
    :type="widget.widget === 'DATETIME' ? 'datetime' : 'date'"
    :value-format="dateFormat"
    @update:model-value="emit('update:modelValue', $event)"
  />

  <!--
    开关。落库是 tinyint 0/1，所以显式声明两个值 ——
    不声明的话 el-switch 发出来的是布尔，写进 tinyint 列得到的是 0/1 没错，
    但读回来与写进去的类型不一致，「改没改过」的比较会一直判成改过
  -->
  <el-switch
    v-else-if="widget.widget === 'SWITCH'"
    :active-value="1"
    :inactive-value="0"
    :model-value="normalizedSwitchValue"
    size="small"
    @update:model-value="emit('update:modelValue', $event)"
  />

  <!-- 文本 -->
  <el-input
    v-else
    :model-value="modelValue"
    class="w-full"
    clearable
    size="small"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { getStrDictOptions } from '@/utils/dict'
import { dateValueFormat, inlineEditWidgetOf } from '@/components/FormWidgets/inlineEdit'

defineOptions({ name: 'InlineEditCell' })

/**
 * 行内编辑的单元格编辑器
 *
 * 渲染成什么由列已有的格式化配置决定 —— 它本来就是按控件类型推断出来的。
 * 再引一套推断，就会出现「列表里显示成字典、编辑时却是文本框」。
 */
const props = defineProps<{
  modelValue: any
  /** 列配置，格式化配置在 col.formatter 上 */
  col: any
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: any): void }>()

const widget = computed(() => inlineEditWidgetOf(props.col))
const dateFormat = computed(() => dateValueFormat(widget.value.widget))

/** 字典选项。按字典类型取，取不到时是空数组而不是报错 */
const dictOptions = computed(() =>
  widget.value.dictType ? getStrDictOptions(widget.value.dictType) : []
)

/**
 * 开关值归一
 *
 * 库里可能存成数字 1、字符串 '1' 或布尔 true（历史数据），
 * 不归一的话 el-switch 认不出「开」的状态，显示成关着的
 */
const normalizedSwitchValue = computed(() => {
  const value = props.modelValue
  return value === 1 || value === '1' || value === true ? 1 : 0
})
</script>
