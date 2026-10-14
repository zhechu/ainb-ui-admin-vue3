<script lang="ts" setup>
import { PropType } from 'vue'
import { propTypes } from '@/utils/propTypes'
import { useDesign } from '@/hooks/web/useDesign'

defineOptions({ name: 'ColorRadioPicker' })

const { getPrefixCls } = useDesign()
const { t } = useI18n()

const prefixCls = getPrefixCls('color-radio-picker')

const props = defineProps({
  schema: {
    type: Array as PropType<string[]>,
    default: () => []
  },
  modelValue: propTypes.string.def('')
})

const emit = defineEmits(['update:modelValue', 'change'])

const colorVal = ref(props.modelValue)

watch(
  () => props.modelValue,
  (val: string) => {
    if (val === unref(colorVal)) return
    colorVal.value = val
  }
)

// 监听
watch(
  () => colorVal.value,
  (val: string) => {
    emit('update:modelValue', val)
    emit('change', val)
  }
)
</script>

<template>
  <div :class="prefixCls" class="flex flex-wrap items-center gap-x-10px gap-y-8px">
    <span
      v-for="(item, i) in schema"
      :key="`radio-${i}`"
      :class="{ 'is-active': colorVal === item }"
      :style="{
        background: item
      }"
      :title="item"
      class="h-22px w-22px cursor-pointer border-2px border-gray-300 rounded-3px border-solid text-center leading-22px"
      @click="colorVal = item"
    >
      <Icon v-if="colorVal === item" :size="15" :color="item === '#ffffff' ? '#333' : '#fff'" icon="ep:check" />
    </span>

    <!-- 自选颜色：预设之外的任意色，取色器内也提供同一批预设做快捷选择 -->
    <ElColorPicker
      v-model="colorVal"
      :predefine="schema"
      :title="t('setting.customColor')"
      popper-class="setting-color-popper"
      size="small"
    />
  </div>
</template>

<style lang="scss" scoped>
$prefix-cls: #{$namespace}-color-radio-picker;

.#{$prefix-cls} {
  .is-active {
    border-color: var(--el-color-primary);
  }
}
</style>
