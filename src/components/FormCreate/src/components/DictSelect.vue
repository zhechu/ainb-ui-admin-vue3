<!-- 数据字典 Select 选择器 -->
<template>
  <el-select
    v-if="selectType === 'select'"
    v-model="selectedValue"
    class="w-1/1"
    v-bind="attrs"
    @change="handleChange"
  >
    <el-option
      v-for="(dict, index) in getDictOptions"
      :key="index"
      :label="dict.label"
      :value="dict.value"
    />
  </el-select>
  <el-radio-group
    v-if="selectType === 'radio'"
    v-model="selectedValue"
    class="w-1/1"
    v-bind="attrs"
    @change="handleChange"
  >
    <el-radio v-for="(dict, index) in getDictOptions" :key="index" :value="dict.value">
      {{ dict.label }}
    </el-radio>
  </el-radio-group>
  <el-checkbox-group
    v-if="selectType === 'checkbox'"
    v-model="selectedValue"
    class="w-1/1"
    v-bind="attrs"
    @change="handleChange"
  >
    <el-checkbox
      v-for="(dict, index) in getDictOptions"
      :key="index"
      :label="dict.label"
      :value="dict.value"
    />
  </el-checkbox-group>
</template>

<script lang="ts" setup>
import { buildDictOptions } from '@/components/FormCreate/src/utils/optionSource'

defineOptions({ name: 'DictSelect' })

const attrs = useAttrs()

// 接受父组件参数
interface Props {
  dictType: string // 字典类型
  modelValue?: any // 选中值，由 form-create 默认 modelValue 绑定
  valueType?: 'str' | 'int' | 'bool' // 字典值类型
  selectType?: 'select' | 'radio' | 'checkbox' // 选择器类型，下拉框 select、多选框 checkbox、单选框 radio
  formCreateInject?: any
}

const props = withDefaults(defineProps<Props>(), {
  valueType: 'str',
  selectType: 'select'
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void
}>()

const selectedValue = ref<any>()

watch(
  () => props.modelValue,
  (newValue) => {
    selectedValue.value = newValue
  },
  { immediate: true }
)

/**
 * 获得字典配置
 *
 * 复用 buildDictOptions，与内置控件的「数据字典」选项来源走同一套解析。
 * 这样一来，历史表单里绑的字典如果后来被改成了树形，这里也会按全路径展平，
 * 而不是铺成一列看不出层级的同名选项。
 */
const getDictOptions = computed(() =>
  buildDictOptions({ dictType: props.dictType, valueType: props.valueType }, false)
)

const handleChange = (value: any) => {
  emit('update:modelValue', value)
}
</script>
