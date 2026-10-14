<!--
  DEPT_IN 参数子编辑器：指定可见的部门。

  ⚠️ check-strictly 必须开：后端 DEPT_IN 只匹配所选部门【本身】，不会展开下级。
     选父不自动含子——要含下级请改用「本部门及下级」模板。
  形状照抄 views/crm/customer/limitConfig/CustomerLimitConfigForm.vue 的多部门 tree-select。
-->
<template>
  <div class="w-full">
    <el-tree-select
      :model-value="modelValue"
      :data="deptTree"
      :props="defaultProps"
      multiple
      filterable
      check-strictly
      node-key="id"
      placeholder="请选择可见的部门（可多选）"
      class="w-full"
      @update:model-value="handleUpdate"
    />
    <div class="mt-4px text-12px text-gray-400 leading-18px">
      仅所选部门本身的记录可见，不含下级部门；如需包含下级请改用「本部门及下级」模板。
      后端会自动兜底包含配置人所在部门。
    </div>
  </div>
</template>

<script lang="ts" setup>
import { defaultProps, handleTree } from '@/utils/tree'
import * as DeptApi from '@/api/system/dept'

defineOptions({ name: 'DeptIdsParam' })

defineProps<{ modelValue: number[] }>()
const emit = defineEmits<{ 'update:modelValue': [number[]] }>()

const deptTree = ref<any[]>([])

const handleUpdate = (val: number[]) => emit('update:modelValue', val ?? [])

onMounted(async () => {
  deptTree.value = handleTree(await DeptApi.getSimpleDeptList())
})
</script>
