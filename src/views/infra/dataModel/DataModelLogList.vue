<template>
  <Dialog :title="dialogTitle" v-model="dialogVisible" width="1080px">
    <el-alert type="info" :closable="false" show-icon class="mb-12px">
      <template #title>
        DDL <b>无法回滚</b>，这里记录了每一次实际执行的语句（含失败的），是排查表结构异常的第一手依据。
      </template>
    </el-alert>

    <!-- 过滤条：浅底卡片，与日志表格区分开 -->
    <el-form :inline="true" class="log-filter mb-12px">
      <el-form-item label="表名">
        <el-input
          v-model="queryParams.tableName"
          placeholder="模糊匹配"
          clearable
          @keyup.enter="handleQuery"
          class="!w-200px"
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
        <el-button type="primary" @click="handleQuery">
          <Icon icon="ep:search" class="mr-5px" /> 搜索
        </el-button>
        <el-button @click="resetQuery">
          <Icon icon="ep:refresh" class="mr-5px" /> 重置
        </el-button>
      </el-form-item>
    </el-form>

    <div class="overflow-hidden">
      <el-table
        v-loading="loading"
        :data="list"
        stripe
        size="default"
        max-height="460"
        class="log-table"
        :header-cell-style="{ background: 'var(--el-fill-color-light)', color: 'var(--el-text-color-primary)' }"
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="sql-panel">
              <div class="sql-panel__head">
                <Icon icon="ep:document" class="mr-5px" />
                <span>执行的 SQL</span>
              </div>
              <pre class="sql-block">{{ row.executeSql }}</pre>
              <template v-if="row.errorMsg">
                <div class="sql-panel__head error mt-12px">
                  <Icon icon="ep:warning-filled" class="mr-5px" />
                  <span>失败原因</span>
                </div>
                <pre class="sql-block error">{{ row.errorMsg }}</pre>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="编号" prop="id" width="80" align="center" />
        <el-table-column label="表名" prop="tableName" min-width="180" :show-overflow-tooltip="true" />
        <el-table-column label="类型" prop="operateType" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="operateTagType(row.operateType)" size="small" effect="light">
              {{ operateLabel(row.operateType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.success" type="success" size="small" effect="light">
              <Icon icon="ep:circle-check" class="mr-3px" /> 成功
            </el-tag>
            <el-tag v-else type="danger" size="small" effect="light">
              <Icon icon="ep:circle-close" class="mr-3px" /> 失败
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="耗时" prop="duration" width="100" align="center">
          <template #default="{ row }">
            <span class="duration">{{ row.duration }} ms</span>
          </template>
        </el-table-column>
        <el-table-column label="操作人" prop="creator" width="120" align="center" />
        <el-table-column label="执行时间" prop="createTime" width="180" align="center" :formatter="dateFormatter" />
        <template #empty>
          <div class="py-20px text-gray-400">
            <Icon icon="ep:document-delete" class="mr-5px" /> 暂无 DDL 执行记录
          </div>
        </template>
      </el-table>
      <Pagination
        :total="total"
        v-model:page="queryParams.pageNo"
        v-model:limit="queryParams.pageSize"
        @pagination="getList"
      />
    </div>
  </Dialog>
</template>

<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import * as DataModelApi from '@/api/infra/dataModel'

/** DDL 执行日志 */
defineOptions({ name: 'DataModelLogList' })

const dialogVisible = ref(false)
const dialogTitle = ref('DDL 执行日志')
const loading = ref(false)
const list = ref<DataModelApi.DataModelLogVO[]>([])
const total = ref(0)
const queryParams = reactive<{
  pageNo: number
  pageSize: number
  tableName: string | undefined
  operateType: string | undefined
  success: boolean | undefined
}>({
  pageNo: 1,
  pageSize: 20,
  tableName: undefined,
  operateType: undefined,
  success: undefined
})

const open = async (tableName?: string) => {
  dialogVisible.value = true
  dialogTitle.value = tableName ? `DDL 执行日志 - ${tableName}` : 'DDL 执行日志'
  queryParams.pageNo = 1
  // 按模型查看时预填表名过滤；不传则展示全部日志
  queryParams.tableName = tableName
  queryParams.operateType = undefined
  queryParams.success = undefined
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

/** 重置过滤：保留当前表名（按模型查看时不丢失上下文），只清空类型与结果 */
const resetQuery = () => {
  queryParams.operateType = undefined
  queryParams.success = undefined
  handleQuery()
}

const operateTagType = (type: string) => {
  if (type === 'CREATE') return 'success'
  if (type === 'DROP') return 'danger'
  return 'warning'
}

const operateLabel = (type: string) => {
  if (type === 'CREATE') return '建表'
  if (type === 'DROP') return '删表'
  if (type === 'ALTER') return '改表'
  return type
}
</script>

<style lang="scss" scoped>
.log-filter {
  padding: 12px 12px 0;
  background-color: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.log-table {
  width: 100%;

  :deep(.el-table__expanded-cell) {
    padding: 0 !important;
    background-color: var(--el-bg-color);
  }
}

.duration {
  font-family: Consolas, Monaco, monospace;
  color: var(--el-text-color-secondary);
}

.sql-panel {
  padding: 12px 16px;
  background-color: var(--el-fill-color-lighter);

  &__head {
    display: flex;
    align-items: center;
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: bold;
    color: var(--el-text-color-regular);

    &.error {
      color: var(--el-color-danger);
    }
  }
}

.sql-block {
  padding: 12px;
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-all;
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;

  &.error {
    color: var(--el-color-danger);
    background-color: var(--el-color-danger-light-9);
    border-color: var(--el-color-danger-light-7);
  }
}
</style>
