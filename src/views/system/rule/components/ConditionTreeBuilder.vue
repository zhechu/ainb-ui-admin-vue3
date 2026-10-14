<!--
  条件树构建器：CUSTOM_TREE 参数子编辑器。

  根节点恒为不可删除的 GROUP，内部委托给递归的 ConditionNodeEditor 渲染。
  v-model 是整棵 ConditionNodeModel，任何子节点变更都以「新树」上抛。
-->
<template>
  <div class="w-full">
    <ConditionNodeEditor
      :node="modelValue"
      :meta="meta"
      :depth="1"
      :can-delete="false"
      @update="(n) => emit('update:modelValue', n)"
    />
    <div class="mt-6px text-12px text-gray-400 leading-18px">
      「属于 / 不属于」的值只能选集合变量（如「当前部门及下级」）；条件树最多嵌套
      {{ MAX_TREE_DEPTH }} 层。
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { RuleTemplateMetaVO } from '@/api/system/grant'
import ConditionNodeEditor from './ConditionNodeEditor.vue'
import { MAX_TREE_DEPTH } from './ruleParams'
import type { ConditionNodeModel } from './ruleParams'

defineOptions({ name: 'ConditionTreeBuilder' })

defineProps<{
  modelValue: ConditionNodeModel
  meta: RuleTemplateMetaVO
}>()
const emit = defineEmits<{ 'update:modelValue': [ConditionNodeModel] }>()
</script>
