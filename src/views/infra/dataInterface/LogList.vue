<template>
  <ContentWrap>
    <!-- 顶部操作栏：内容较多，页内展示 -->
    <div class="di-panel-header mb-15px flex items-center justify-between">
      <div class="flex items-center">
        <el-button link @click="emit('back')">
          <Icon icon="ep:arrow-left" class="mr-5px" /> 返回
        </el-button>
        <span class="di-panel-title ml-8px">{{ panelTitle }}</span>
      </div>
    </div>

    <el-alert type="info" :closable="false" class="mb-10px">
      <template #title>
        记录每次调用的参数、<b>实际执行的 SQL（含自动注入的租户条件）</b>与耗时。
        调用时间区间<b>必填且不超过 3 个月</b>，防止日志量大拖慢查询。
        排查「为什么查不到数据」时，展开看执行的 SQL 最直接；失败时可展开查看<b>完整报错原因</b>。
      </template>
    </el-alert>

    <el-form :inline="true" size="small" class="-mb-15px">
      <el-form-item label="调用时间" required>
        <el-date-picker
          v-model="queryParams.createTime"
          type="datetimerange"
          value-format="YYYY-MM-DD HH:mm:ss"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          :clearable="false"
          class="!w-340px"
        />
      </el-form-item>
      <el-form-item v-if="!isSingleInterface" label="接口编码">
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

    <el-table v-loading="loading" :data="list" size="small">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="px-20px py-10px">
            <div class="mb-5px font-bold">请求参数</div>
            <pre class="code-block">{{ pretty(row.requestParams) }}</pre>
            <template v-if="row.executeSql">
              <div class="mb-5px mt-10px font-bold">实际执行的 SQL</div>
              <pre class="code-block">{{ row.executeSql }}</pre>
            </template>
            <template v-if="row.errorDetail || row.errorMsg">
              <div class="mb-5px mt-10px font-bold text-[var(--el-color-danger)]">报错原因</div>
              <pre class="code-block error">{{ row.errorDetail || row.errorMsg }}</pre>
            </template>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="编号" prop="id" width="70" align="center" />
      <el-table-column v-if="!isSingleInterface" label="接口编码" prop="interfaceCode" :show-overflow-tooltip="true" min-width="140" />
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
      <el-table-column label="报错原因" min-width="200" :show-overflow-tooltip="true">
        <template #default="{ row }">
          <span v-if="row.success" class="text-[var(--el-text-color-secondary)]">-</span>
          <span v-else class="text-[var(--el-color-danger)]">{{ row.errorMsg || '-' }}</span>
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
  </ContentWrap>
</template>

<script lang="ts" setup>
import dayjs from 'dayjs'
import { dateFormatter, formatDate } from '@/utils/formatTime'
import * as DataInterfaceApi from '@/api/infra/dataInterface'

/** 接口调用日志（页内展示）
 *
 * 从列表行点「日志」进来时带 interfaceId，只看该接口；从工具栏「调用日志」进来则看全部。
 */
defineOptions({ name: 'DataInterfaceLogList' })

const emit = defineEmits(['back'])

const message = useMessage()

const loading = ref(false)
const list = ref<DataInterfaceApi.DataInterfaceLogVO[]>([])
const total = ref(0)
/** 是否为「单个接口」的日志视图：锁定了接口，隐藏编码搜索与编码列 */
const isSingleInterface = ref(false)
const interfaceName = ref('')
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  interfaceId: undefined as number | undefined,
  interfaceCode: undefined as string | undefined,
  invokeType: undefined as number | undefined,
  success: undefined as boolean | undefined,
  createTime: [] as string[]
})

const panelTitle = computed(() =>
  isSingleInterface.value && interfaceName.value
    ? `调用日志 - ${interfaceName.value}`
    : '接口调用日志'
)

/** 默认查近 7 天：日志表可能很大，一进来就全量查既慢又没必要 */
const defaultTimeRange = (): string[] => [
  formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'YYYY-MM-DD 00:00:00'),
  formatDate(new Date(), 'YYYY-MM-DD HH:mm:ss')
]

/** 调用时间必填且不超过 3 个月：防止区间过大拖垮查询性能 */
const validateTimeRange = (): boolean => {
  const range = queryParams.createTime
  if (!range || range.length !== 2 || !range[0] || !range[1]) {
    message.warning('请选择调用时间区间')
    return false
  }
  if (dayjs(range[1]).isAfter(dayjs(range[0]).add(3, 'month'))) {
    message.warning('调用时间区间不能大于 3 个月，请缩小范围')
    return false
  }
  return true
}

const open = async (interfaceId?: number, name?: string) => {
  queryParams.pageNo = 1
  queryParams.interfaceId = interfaceId
  queryParams.interfaceCode = undefined
  queryParams.invokeType = undefined
  queryParams.success = undefined
  queryParams.createTime = defaultTimeRange()
  isSingleInterface.value = interfaceId !== undefined
  interfaceName.value = name || ''
  await getList()
}
defineExpose({ open })

const getList = async () => {
  if (!validateTimeRange()) {
    return
  }
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
.di-panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.code-block {
  padding: 10px;
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--el-text-color-regular);
  background-color: var(--el-fill-color-light);
  border-radius: 4px;

  &.error {
    color: var(--el-color-danger);
    background-color: var(--el-color-danger-light-9);
  }
}
</style>
