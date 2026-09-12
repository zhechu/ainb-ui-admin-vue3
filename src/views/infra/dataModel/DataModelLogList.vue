<template>
  <Dialog title="DDL 执行日志" v-model="dialogVisible" width="1000px">
    <el-alert type="info" :closable="false" class="mb-10px">
      <template #title>
        DDL 无法回滚，这里记录了每一次实际执行的语句（含失败的），是排查表结构异常的第一手依据。
      </template>
    </el-alert>

    <el-form :inline="true" class="-mb-15px">
      <el-form-item label="表名">
        <el-input
          v-model="queryParams.tableName"
          placeholder="模糊匹配"
          clearable
          @keyup.enter="handleQuery"
          class="!w-180px"
        />
      </el-form-item>
      <el-form-item label="类型">
        <el-select v-model="queryParams.operateType" clearable placeholder="全部" class="!w-120px">
          <el-option label="建表" value="CREATE" />
          <el-option label="改表" value="ALTER" />
          <el-option label="删表" value="DROP" />
        </el-select>
      </el-form-item>
      <el-form-item label="结果">
        <el-select v-model="queryParams.success" clearable placeholder="全部" class="!w-120px">
          <el-option label="成功" :value="true" />
          <el-option label="失败" :value="false" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="list" size="small" max-height="420">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="px-20px py-10px">
            <div class="mb-5px font-bold">执行的 SQL</div>
            <pre class="sql-block">{{ row.executeSql }}</pre>
            <template v-if="row.errorMsg">
              <div class="mb-5px mt-10px font-bold text-red-500">失败原因</div>
              <pre class="sql-block error">{{ row.errorMsg }}</pre>
            </template>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="编号" prop="id" width="70" align="center" />
      <el-table-column label="表名" prop="tableName" width="180" :show-overflow-tooltip="true" />
      <el-table-column label="类型" prop="operateType" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="operateTagType(row.operateType)" size="small">{{ row.operateType }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="结果" width="80" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.success" type="success" size="small">成功</el-tag>
          <el-tag v-else type="danger" size="small">失败</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="耗时" prop="duration" width="90" align="center">
        <template #default="{ row }">{{ row.duration }} ms</template>
      </el-table-column>
      <el-table-column label="操作人" prop="creator" width="100" align="center" />
      <el-table-column label="时间" prop="createTime" width="170" :formatter="dateFormatter" />
    </el-table>
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </Dialog>
</template>

<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import * as DataModelApi from '@/api/infra/dataModel'

/** DDL 执行日志 */
defineOptions({ name: 'DataModelLogList' })

const dialogVisible = ref(false)
const loading = ref(false)
const list = ref<DataModelApi.DataModelLogVO[]>([])
const total = ref(0)
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  tableName: undefined,
  operateType: undefined,
  success: undefined
})

const open = async () => {
  dialogVisible.value = true
  queryParams.pageNo = 1
  await getList()
}
defineExpose({ open })

const getList = async () => {
  loading.value = true
  try {
    const data = await DataModelApi.getDataModelLogPage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}

const operateTagType = (type: string) => {
  if (type === 'CREATE') return 'success'
  if (type === 'DROP') return 'danger'
  return 'warning'
}
</script>

<style lang="scss" scoped>
.sql-block {
  padding: 10px;
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  background-color: #f5f7fa;
  border-radius: 4px;

  &.error {
    color: #f56c6c;
    background-color: #fef0f0;
  }
}
</style>
