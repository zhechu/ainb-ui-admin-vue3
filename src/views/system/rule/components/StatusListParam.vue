<!--
  STATUS_IN 参数子编辑器：允许的状态值列表。

  状态值随数据集而变（不同业务的 status 含义不同），没有统一字典源，
  所以用纯 tag 输入：filterable + allow-create，业务人员直接敲值回车即可。
  v-model 是 string[]，序列化时由 ruleParams 负责把纯数字串转 number。
-->
<template>
  <el-select
    :model-value="modelValue"
    multiple
    filterable
    allow-create
    default-first-option
    :reserve-keyword="false"
    placeholder="输入状态值后回车，可添加多个，如 1、2、3"
    class="w-full"
    @update:model-value="handleUpdate"
  >
    <!-- 无预置选项：状态值由业务数据集决定，全部手输 -->
  </el-select>
</template>

<script lang="ts" setup>
defineOptions({ name: 'StatusListParam' })

defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const handleUpdate = (val: string[]) => {
  // allow-create 可能带进空白项，这里统一 trim + 去空
  emit(
    'update:modelValue',
    (val ?? []).map((x) => String(x).trim()).filter((x) => x !== '')
  )
}
</script>
