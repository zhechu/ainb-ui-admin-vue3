<!--
  FIELD_EQUALS 参数子编辑器：指定某个槽位等于某个字面量值。

  field 从 meta.slots 里选（语义槽位，如 owner/dept/status），value 是字面量字符串
  （后端 resolver 用 String.valueOf 处理，恒存字符串）。operator 固定 EQ，无需用户选。
  v-model 是 { field, value }。
-->
<template>
  <div class="w-full flex items-center gap-8px">
    <el-select
      :model-value="modelValue.field"
      placeholder="选择字段（槽位）"
      filterable
      class="!w-200px"
      @update:model-value="(v: string) => emitField(v)"
    >
      <el-option v-for="s in slots" :key="s.slot" :label="s.slot" :value="s.slot">
        <span>{{ s.slot }}</span>
        <span class="ml-8px text-11px text-gray-400">{{ s.description }}</span>
      </el-option>
    </el-select>
    <span class="text-gray-500">等于</span>
    <el-input
      :model-value="modelValue.value"
      placeholder="填写期望的值"
      class="flex-1"
      @update:model-value="(v: string) => emitValue(v)"
    />
  </div>
</template>

<script lang="ts" setup>
import type { RuleSlotMetaVO } from '@/api/system/grant'

defineOptions({ name: 'FieldEqualsParam' })

const props = defineProps<{
  modelValue: { field: string; value: string }
  slots: RuleSlotMetaVO[]
}>()
const emit = defineEmits<{ 'update:modelValue': [{ field: string; value: string }] }>()

const emitField = (field: string) =>
  emit('update:modelValue', { ...props.modelValue, field })
const emitValue = (value: string) =>
  emit('update:modelValue', { ...props.modelValue, value })
</script>
