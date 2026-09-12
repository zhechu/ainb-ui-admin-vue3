<template>
  <el-time-picker
    v-model="innerValue"
    is-range
    :value-format="valueFormat"
    :start-placeholder="startPlaceholder"
    :end-placeholder="endPlaceholder"
    :range-separator="rangeSeparator"
    class="w-1/1"
    v-bind="attrs"
    @update:model-value="onChange"
  />
</template>

<script lang="ts" setup>
/**
 * 时间区间（运行时）
 *
 * 与 DateRangePicker 同一件事的时间版：契约把 `timeRange` 登记成
 * valueType=array、storage=delimited 的规则类型，而设计器内核的「时间区间」菜单
 * 拖出来的是 `type: 'timePicker' + props.isRange: true`。
 * 缺渲染器时按契约写的规则会渲染成 `<timerange>` 未知元素。
 *
 * 详细缘由见 DateRangePicker.vue 的注释，两者是同一个「菜单名 ≠ 规则类型」的缺口。
 */
defineOptions({ name: 'TimeRangePicker' })

const attrs = useAttrs()

const props = withDefaults(
  defineProps<{
    /** 值：两个元素的字符串数组 */
    modelValue?: string[]
    /** ⚠️ 不能含逗号：分隔串落库按逗号拆 */
    valueFormat?: string
    startPlaceholder?: string
    endPlaceholder?: string
    rangeSeparator?: string
    formCreateInject?: any
  }>(),
  {
    valueFormat: 'HH:mm:ss',
    startPlaceholder: '开始时间',
    endPlaceholder: '结束时间',
    rangeSeparator: '至'
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const innerValue = ref<string[] | undefined>(props.modelValue)

watch(
  () => props.modelValue,
  (value) => {
    innerValue.value = value
  }
)

/** 清空时发空数组，理由同 DateRangePicker */
const onChange = (value: string[] | null) => emit('update:modelValue', value ?? [])
</script>
