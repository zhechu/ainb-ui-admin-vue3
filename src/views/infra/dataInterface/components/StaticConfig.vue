<template>
  <div class="w-full">
    <el-alert type="info" :closable="false" class="mb-8px">
      <template #title>直接返回下面的 JSON。适合做枚举字典、前端联调占位数据。</template>
    </el-alert>
    <el-input
      v-model="jsonText"
      type="textarea"
      :rows="8"
      placeholder="[{&quot;value&quot;: 1, &quot;label&quot;: &quot;启用&quot;}, {&quot;value&quot;: 0, &quot;label&quot;: &quot;停用&quot;}]"
      spellcheck="false"
      class="json-input"
      @blur="validateJson"
    />
    <div v-if="jsonError" class="mt-6px text-12px text-red-500">JSON 格式有误：{{ jsonError }}</div>
    <el-button v-else-if="jsonText" link type="primary" size="small" class="mt-6px" @click="format">
      格式化
    </el-button>
  </div>
</template>

<script lang="ts" setup>
import { useVModel } from '@vueuse/core'

/** 静态 JSON 配置 */
defineOptions({ name: 'StaticConfig' })

const props = withDefaults(defineProps<{ modelValue?: string }>(), { modelValue: '' })
const emit = defineEmits(['update:modelValue'])
const jsonText = useVModel(props, 'modelValue', emit) as Ref<string>

const jsonError = ref('')

/** 失焦时校验，把错误提前暴露给用户，而不是等保存或调用时才报 */
const validateJson = () => {
  jsonError.value = ''
  if (!jsonText.value?.trim()) {
    return
  }
  try {
    JSON.parse(jsonText.value)
  } catch (e: any) {
    jsonError.value = e?.message ?? '无法解析'
  }
}

const format = () => {
  try {
    jsonText.value = JSON.stringify(JSON.parse(jsonText.value), null, 2)
    jsonError.value = ''
  } catch (e: any) {
    jsonError.value = e?.message ?? '无法解析'
  }
}
</script>

<style lang="scss" scoped>
.json-input :deep(.el-textarea__inner) {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}
</style>
