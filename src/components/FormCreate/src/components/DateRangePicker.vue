<template>
  <el-date-picker
    v-model="innerValue"
    :type="type"
    :value-format="resolvedValueFormat"
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
 * 日期区间（运行时）
 *
 * ## 它补的是「契约里有、前端没有」的那个缺口
 *
 * 控件契约把 `dateRange` 登记成一个规则类型：valueType=array、storage=delimited，
 * 也就是**一列存两头**，落库形如 `2026-09-01,2026-09-30`。后端
 * `FormValueSerializer` 正是按 `rule.type === 'dateRange'` 走分隔串那条路
 * （见 FormValueSerializerTest#testDateRange）。
 *
 * 但设计器内核的「日期区间」只是菜单名，拖出来的规则是
 * `type: 'datePicker' + props.type: 'datetimerange'`。两件事因此同时坏着：
 *
 * 1. 按契约写的规则（`type: 'dateRange'`）在 form-create 里解析不到组件，
 *    渲染成 `<daterange>` 未知元素 —— 就是「日期区间控件无法选择日期」
 * 2. 从菜单拖出来的那个类型是 `datePicker`，后端查契约得到的是
 *    valueType=date、storage=scalar —— 一个数组被当标量往日期列里写，
 *    而且一路不报错
 *
 * 所以这里补渲染器，并在 `useFormCreateDesigner` 里把菜单产出的类型对齐到 `dateRange`。
 *
 * ## value-format 不能省
 *
 * 不设的话 el-date-picker 的值是 Date 对象，提交上去是两个 ISO 串（带时区），
 * 落库形态与读回来的形态对不上。按 type 推一个默认格式，让值自始至终是字符串数组。
 *
 * ⚠️ 格式里**不能出现逗号** —— 分隔串落库就是按逗号拆的，含逗号会让读回来的
 * 项数比存进去的多，而且不报错（契约的 delimitedSeparator 说明里有同样的警告）。
 */
defineOptions({ name: 'DateRangePicker' })

const attrs = useAttrs()

const props = withDefaults(
  defineProps<{
    /** 值：两个元素的字符串数组 */
    modelValue?: string[]
    /** el-date-picker 的区间类型 */
    type?: 'daterange' | 'datetimerange' | 'monthrange'
    /** 值格式。不传时按 type 推 */
    valueFormat?: string
    startPlaceholder?: string
    endPlaceholder?: string
    rangeSeparator?: string
    formCreateInject?: any
  }>(),
  {
    type: 'daterange',
    startPlaceholder: '开始日期',
    endPlaceholder: '结束日期',
    rangeSeparator: '至'
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

/** 各区间类型的默认值格式。都不含逗号 —— 见上面关于分隔串的说明 */
const DEFAULT_VALUE_FORMAT: Record<string, string> = {
  daterange: 'YYYY-MM-DD',
  datetimerange: 'YYYY-MM-DD HH:mm:ss',
  monthrange: 'YYYY-MM'
}

const resolvedValueFormat = computed(
  () => props.valueFormat || DEFAULT_VALUE_FORMAT[props.type] || 'YYYY-MM-DD'
)

const innerValue = ref<string[] | undefined>(props.modelValue)

watch(
  () => props.modelValue,
  (value) => {
    innerValue.value = value
  }
)

/**
 * 清空时发空数组而不是 null
 *
 * 契约里它的 valueType 是 array，服务端按数组序列化。发 null 的话，
 * 「清空了区间」与「从来没填过」在落库时会走成两条不同的路径。
 */
const onChange = (value: string[] | null) => emit('update:modelValue', value ?? [])
</script>
