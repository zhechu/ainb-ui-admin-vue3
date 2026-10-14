<template>
  <div class="w-full">
    <div class="mb-8px">
      <el-button v-if="!readonly" size="small" type="primary" plain @click="add">
        <Icon icon="ep:plus" class="mr-5px" /> 添加参数
      </el-button>
      <span
        :class="readonly ? '' : 'ml-8px'"
        class="text-12px text-[var(--el-text-color-secondary)]"
      >
        参数名对应 SQL 里的 <code>#{参数名}</code>；未在此定义的请求参数会被忽略
      </span>
    </div>
    <el-table :data="params" border size="small" max-height="260">
      <el-table-column label="参数名" width="140">
        <template #default="{ row }">
          <el-input v-model="row.name" size="small" placeholder="status" @input="sync" />
        </template>
      </el-table-column>
      <el-table-column label="显示名" width="120">
        <template #default="{ row }">
          <el-input v-model="row.label" size="small" placeholder="订单状态" @input="sync" />
        </template>
      </el-table-column>
      <el-table-column label="类型" width="120">
        <template #default="{ row }">
          <el-select v-model="row.type" size="small" @change="sync">
            <el-option v-for="t in TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="必填" width="70" align="center">
        <template #default="{ row }">
          <el-checkbox v-model="row.required" @change="sync" />
        </template>
      </el-table-column>
      <el-table-column label="默认值" width="120">
        <template #default="{ row }">
          <el-input v-model="row.defaultValue" size="small" placeholder="选填" @input="sync" />
        </template>
      </el-table-column>
      <el-table-column label="说明" min-width="140">
        <template #default="{ row }">
          <el-input v-model="row.remark" size="small" placeholder="选填" @input="sync" />
        </template>
      </el-table-column>
      <el-table-column v-if="!readonly" label="操作" width="70" align="center">
        <template #default="{ $index }">
          <el-button link type="danger" size="small" @click="remove($index)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <span class="text-[var(--el-text-color-secondary)]">暂无参数</span>
      </template>
    </el-table>
  </div>
</template>

<script lang="ts" setup>
import type { ParamDefinitionVO } from '@/api/infra/dataInterface'

/** 入参定义表格 */
defineOptions({ name: 'ParamTable' })

const props = withDefaults(
  defineProps<{ modelValue?: ParamDefinitionVO[]; readonly?: boolean }>(),
  {
    modelValue: () => [],
    readonly: false
  }
)
const emit = defineEmits(['update:modelValue'])

/** 与后端 ValueConverter 支持的类型保持一致 */
const TYPES = ['STRING', 'INT', 'LONG', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME']

const params = ref<ParamDefinitionVO[]>([])

watch(
  () => props.modelValue,
  (val) => {
    // 用副本，避免直接改父组件的数组
    params.value = Array.isArray(val) ? val.map((item) => ({ ...item })) : []
  },
  { immediate: true, deep: false }
)

const sync = () => {
  emit('update:modelValue', params.value)
}

const add = () => {
  params.value.push({ name: '', label: '', type: 'STRING', required: false, defaultValue: '' })
  sync()
}

const remove = (index: number) => {
  params.value.splice(index, 1)
  sync()
}
</script>
