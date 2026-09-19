<template>
  <div class="w-full">
    <CodeEditor
      v-model="scriptText"
      language="javascript"
      :placeholder="PLACEHOLDER"
      :readonly="readonly"
      :minLines="5"
      :maxLines="10"
    />
    <el-button
      v-if="!readonly"
      link
      type="primary"
      size="small"
      class="mt-6px"
      @click="fillExample"
    >
      填入示例
    </el-button>
  </div>
</template>

<script lang="ts" setup>
import { useVModel } from '@vueuse/core'
import CodeEditor from '@/components/CodeEditor'

/** JS 后处理脚本配置 */
defineOptions({ name: 'ScriptConfig' })

const props = withDefaults(defineProps<{ modelValue?: string; readonly?: boolean }>(), {
  modelValue: '',
  readonly: false
})
const emit = defineEmits(['update:modelValue'])
const scriptText = useVModel(props, 'modelValue', emit) as Ref<string>

const PLACEHOLDER = `// data 为执行结果，return 返回加工后的数据
return data;`

const EXAMPLE = `// 把查询结果转成下拉框需要的 { value, label } 结构
return data.list.map(function (row) {
  return { label: row.name, value: row.code };
});`

const fillExample = () => {
  scriptText.value = EXAMPLE
}
</script>
