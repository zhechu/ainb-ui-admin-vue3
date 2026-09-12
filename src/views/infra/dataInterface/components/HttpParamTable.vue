<template>
  <div class="http-param-table">
    <el-table :data="tableData" border size="small" :max-height="400">
      <el-table-column label="启用" width="60" align="center">
        <template #default="{ row, $index }">
          <el-checkbox v-model="row.enabled" @change="handleChange" />
        </template>
      </el-table-column>
      <el-table-column label="参数名" width="200">
        <template #default="{ row, $index }">
          <el-input
            v-model="row.key"
            placeholder="参数名"
            size="small"
            @input="handleChange"
            clearable
          />
        </template>
      </el-table-column>
      <el-table-column label="参数值">
        <template #default="{ row, $index }">
          <el-input
            v-model="row.value"
            placeholder="参数值，支持 #{参数名} 占位符"
            size="small"
            @input="handleChange"
            clearable
          />
        </template>
      </el-table-column>
      <el-table-column label="描述" width="200">
        <template #default="{ row, $index }">
          <el-input
            v-model="row.description"
            placeholder="参数描述"
            size="small"
            @input="handleChange"
            clearable
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80" align="center">
        <template #default="{ row, $index }">
          <el-button
            type="danger"
            link
            size="small"
            @click="handleDelete($index)"
            icon="Delete"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-button
      type="primary"
      link
      size="small"
      class="mt-8px"
      @click="handleAdd"
      icon="Plus"
    >
      添加参数
    </el-button>
    <div v-if="placeholder" class="text-12px text-gray-500 mt-8px">
      <Icon icon="ep:info-filled" class="mr-4px" />
      {{ placeholder }}
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
import Icon from '@/components/Icon/src/Icon.vue'

defineOptions({ name: 'HttpParamTable' })

interface HttpParam {
  key: string
  value: string
  description?: string
  enabled?: boolean
}

const props = withDefaults(
  defineProps<{
    data: HttpParam[]
    placeholder?: string
  }>(),
  {
    data: () => [],
    placeholder: ''
  }
)

const emit = defineEmits(['change'])

const tableData = ref<HttpParam[]>([])

// 初始化数据
watch(
  () => props.data,
  (newData) => {
    tableData.value = newData && newData.length > 0 ? [...newData] : []
  },
  { immediate: true, deep: true }
)

const handleAdd = () => {
  tableData.value.push({
    key: '',
    value: '',
    description: '',
    enabled: true
  })
  handleChange()
}

const handleDelete = (index: number) => {
  tableData.value.splice(index, 1)
  handleChange()
}

const handleChange = () => {
  // 同步数据到父组件
  props.data.splice(0, props.data.length, ...tableData.value)
  emit('change')
}
</script>

<style scoped>
.http-param-table {
  padding: 0 12px;
}
</style>
