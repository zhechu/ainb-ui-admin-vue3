<template>
  <Dialog title="接口调用日志" v-model="dialogVisible" width="1000px">
    <el-alert type="info" :closable="false" class="mb-10px">
      <template #title>
        记录每次调用的参数、<b>实际执行的 SQL（含自动注入的租户条件）</b>与耗时。
        排查「为什么查不到数据」时，展开看执行的 SQL 最直接。
      </template>
    </el-alert>

    <el-form :inline="true" size="small" class="-mb-15px">
      <el-form-item label="接口编码">
        <el-input
          v-model="queryParams.interfaceCode"
          placeholder="模糊匹配"
          clearable
          @keyup.enter="handleQuery"
          class="!w-160px"
        />
      </el-form-item>
      <el-form-item label="方式">
        <el-select v-model="queryParams.invokeType" clearable placeholder="全部" class="!w-120px">
          <el-option label="在线预览" :value="1" />
          <el-option label="接口调用" :value="2" />
        </el-select>
      </el-form-item>
      <el-form-item label="结果">
        <el-select v-model="queryParams.success" clearable placeholder="全部" class="!w-110px">
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
            <div class="mb-5px font-bold">请求参数</div>
            <pre class="code-block">{{ pretty(row.requestParams) }}</pre>
            <template v-if="row.executeSql">
              <div class="mb-5px mt-10px font-bold">实际执行的 SQL</div>
              <pre class="code-block">{{ row.executeSql }}</pre>
            </template>
            <template v-if="row.errorMsg">
              <div class="mb-5px mt-10px font-bold text-red-500">失败原因</div>
              <pre class="code-block error">{{ row.errorMsg }}</pre>
            </template>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="编号" prop="id" width="70" align="center" />
      <el-table-column label="接口编码" prop="interfaceCode" :show-overflow-tooltip="true" min-width="140" />
      <el-table-column label="方式" width="90" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.invokeType === 1 ? 'info' : ''">
            {{ row.invokeType === 1 ? '预览' : '调用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="结果" width="80" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.success" type="success" size="small">成功</el-tag>
          <el-tag v-else type="danger" size="small">失败</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="条数" prop="resultCount" width="70" align="center" />
      <el-table-column label="耗时" width="90" align="center">
        <template #default="{ row }">{{ row.duration }} ms</template>
      </el-table-column>
      <el-table-column label="调用人" width="180" align="center">
        <template #default="{ row }">
          {{ row.userNickname ? `[${row.userNickname}(${row.username})]` : row.userId }}
        </template>
      </el-table-column>
      <el-table-column label="IP" prop="userIp" width="120" align="center" />
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
import * as DataInterfaceApi from '@/api/infra/dataInterface'

/** 接口调用日志 */
defineOptions({ name: 'DataInterfaceLogList' })

const dialogVisible = ref(false)
const loading = ref(false)
const list = ref<DataInterfaceApi.DataInterfaceLogVO[]>([])
const total = ref(0)
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  interfaceId: undefined as number | undefined,
  interfaceCode: undefined,
  invokeType: undefined,
  success: undefined
})

/** 从列表页点某个接口的日志时带 interfaceId；从工具栏点则看全部 */
const open = async (interfaceId?: number) => {
  dialogVisible.value = true
  queryParams.pageNo = 1
  queryParams.interfaceId = interfaceId
  await getList()
}
defineExpose({ open })

const getList = async () => {
  loading.value = true
  try {
    const data = await DataInterfaceApi.getLogPage(queryParams)
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

const pretty = (raw?: string) => {
  if (!raw) {
    return '（无参数）'
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
</script>

<style lang="scss" scoped>
.code-block {
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
