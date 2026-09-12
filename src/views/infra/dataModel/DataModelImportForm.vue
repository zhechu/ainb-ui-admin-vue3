<template>
  <Dialog title="导入已有表" v-model="dialogVisible" width="900px">
    <el-alert type="info" :closable="false" class="mb-10px">
      <template #title>
        导入<b>只登记模型</b>，不会执行任何 DDL、不改动表结构。系统内置表（system_ / infra_ / bpm_ 等前缀）
        导入后也<b>不允许改结构</b>。
      </template>
    </el-alert>

    <el-form :inline="true" class="-mb-15px">
      <el-form-item label="表名">
        <el-input
          v-model="queryParams.tableName"
          placeholder="模糊匹配"
          clearable
          @keyup.enter="getList"
          class="!w-200px"
        />
      </el-form-item>
      <el-form-item label="表描述">
        <el-input
          v-model="queryParams.tableComment"
          placeholder="模糊匹配"
          clearable
          @keyup.enter="getList"
          class="!w-200px"
        />
      </el-form-item>
      <el-form-item>
        <el-button @click="getList"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
      </el-form-item>
    </el-form>

    <el-table
      v-loading="loading"
      :data="list"
      height="400"
      @selection-change="handleSelectionChange"
      ref="tableRef"
    >
      <el-table-column type="selection" width="55" />
      <el-table-column label="表名" prop="TABLE_NAME" :show-overflow-tooltip="true" />
      <el-table-column label="表描述" prop="TABLE_COMMENT" :show-overflow-tooltip="true" />
    </el-table>

    <template #footer>
      <span class="mr-15px text-gray-500">已选 {{ selectedTables.length }} 张表</span>
      <el-button type="primary" :disabled="selectedTables.length === 0 || formLoading" @click="submitForm">
        确 定
      </el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import * as DataModelApi from '@/api/infra/dataModel'

/** 导入已有表 */
defineOptions({ name: 'DataModelImportForm' })

const message = useMessage()

const dialogVisible = ref(false)
const loading = ref(false)
const formLoading = ref(false)
const list = ref<DataModelApi.DatabaseTableVO[]>([])
const selectedTables = ref<string[]>([])
const queryParams = reactive({
  dataSourceConfigId: 0,
  tableName: undefined,
  tableComment: undefined
})

const open = async () => {
  dialogVisible.value = true
  selectedTables.value = []
  await getList()
}
defineExpose({ open })

const emit = defineEmits(['success'])

const getList = async () => {
  loading.value = true
  try {
    list.value = await DataModelApi.getDatabaseTableList(queryParams)
  } finally {
    loading.value = false
  }
}

const handleSelectionChange = (rows: DataModelApi.DatabaseTableVO[]) => {
  selectedTables.value = rows.map((row) => row.TABLE_NAME)
}

const submitForm = async () => {
  formLoading.value = true
  try {
    await DataModelApi.importTables(queryParams.dataSourceConfigId, selectedTables.value)
    message.success(`成功导入 ${selectedTables.value.length} 张表`)
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}
</script>
