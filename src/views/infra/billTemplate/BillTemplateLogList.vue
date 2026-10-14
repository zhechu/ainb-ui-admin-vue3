<template>
  <ContentWrap>
    <!-- 顶部操作栏：页内展示，从列表行点「日志」进来，锁定单个模板 -->
    <div class="bt-panel-header mb-15px flex items-center justify-between">
      <div class="flex items-center">
        <el-button link @click="emit('back')">
          <Icon icon="ep:arrow-left" class="mr-5px" /> 返回
        </el-button>
        <span class="bt-panel-title ml-8px">取号日志 - {{ templateName }}</span>
      </div>
    </div>

    <el-alert type="info" :closable="false" class="mb-10px">
      <template #title>
        仅模板开启「取号日志」后才会记录。取号时间区间<b>必填且不超过 3 个月</b>，防止日志量大拖慢查询。
        gen_type / 周期 / 序号为取号当时的快照，按序号排序可核对连号；
        业务事务回滚时号码<b>不归还</b>，出现跳号属正常现象——日志正是跳号的审计凭证。
      </template>
    </el-alert>

    <el-form :inline="true" size="small" class="-mb-15px">
      <el-form-item label="取号时间" required>
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
      <el-form-item label="单据编号">
        <el-input
          v-model="queryParams.billNo"
          placeholder="模糊匹配"
          clearable
          @keyup.enter="handleQuery"
          class="!w-160px"
        />
      </el-form-item>
      <el-form-item label="来源">
        <el-select v-model="queryParams.source" clearable placeholder="全部" class="!w-120px">
          <el-option
            v-for="item in SOURCE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
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
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="list" size="small">
      <el-table-column label="取号时间" prop="createTime" width="170" :formatter="dateFormatter" />
      <el-table-column label="单据编号" min-width="180" :show-overflow-tooltip="true">
        <template #default="{ row }">
          <span v-if="row.billNo" class="font-mono">{{ row.billNo }}</span>
          <span v-else class="text-[var(--el-text-color-secondary)]">-</span>
        </template>
      </el-table-column>
      <el-table-column label="生成方式" width="100" align="center">
        <template #default="{ row }">
          <el-tag size="small">{{ genTypeLabel(row.genType) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="周期" width="110" align="center">
        <template #default="{ row }">
          {{ row.period || '-' }}
        </template>
      </el-table-column>
      <el-table-column label="序号" width="80" align="center">
        <template #default="{ row }">
          <span v-if="row.seq != null">{{ row.seq }}</span>
          <span v-else class="text-[var(--el-text-color-secondary)]">-</span>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="100" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="sourceTagType(row.source)">
            {{ sourceLabel(row.source) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="取号人" prop="userId" width="90" align="center">
        <template #default="{ row }">
          <span v-if="row.userId != null">{{ row.userId }}</span>
          <span v-else class="text-[var(--el-text-color-secondary)]">-</span>
        </template>
      </el-table-column>
      <el-table-column label="结果" width="80" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.success" type="success" size="small">成功</el-tag>
          <el-tag v-else type="danger" size="small">失败</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="失败原因" min-width="160" :show-overflow-tooltip="true">
        <template #default="{ row }">
          <span v-if="row.success" class="text-[var(--el-text-color-secondary)]">-</span>
          <span v-else class="text-[var(--el-color-danger)]">{{ row.errorMsg || '-' }}</span>
        </template>
      </el-table-column>
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
import * as BillTemplateApi from '@/api/infra/billTemplate'
import { GEN_TYPE_OPTIONS } from './constants'

/** 取号日志（页内展示，锁定单个模板） */
defineOptions({ name: 'BillTemplateLogList' })

const emit = defineEmits(['back'])

const message = useMessage()

/** 取号来源，与后端 BillTemplateServiceImpl 的 SOURCE_* 常量对应 */
const SOURCE_OPTIONS = [
  { label: '业务出号', value: 1 },
  { label: '表单预占', value: 2 },
  { label: '测试取号', value: 3 }
]

const loading = ref(false)
const list = ref<BillTemplateApi.BillTemplateLogVO[]>([])
const total = ref(0)
const templateId = ref<number>()
const templateName = ref('')
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  templateId: undefined as number | undefined,
  billNo: undefined as string | undefined,
  source: undefined as number | undefined,
  success: undefined as boolean | undefined,
  createTime: [] as string[]
})

const genTypeLabel = (genType: number) =>
  GEN_TYPE_OPTIONS.find((item) => item.value === genType)?.label ?? String(genType)

const sourceLabel = (source: number) =>
  SOURCE_OPTIONS.find((item) => item.value === source)?.label ?? String(source)

/** 来源标签颜色：测试取号用 info 弱化，与正式出号一眼区分 */
const sourceTagType = (source: number) => {
  if (source === 3) return 'info'
  return source === 2 ? 'warning' : 'primary'
}

/** 默认查近 7 天：日志表可能很大，一进来就全量查既慢又没必要 */
const defaultTimeRange = (): string[] => [
  formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'YYYY-MM-DD 00:00:00'),
  formatDate(new Date(), 'YYYY-MM-DD HH:mm:ss')
]

const open = async (id: number, name?: string) => {
  templateId.value = id
  templateName.value = name || ''
  resetQueryParams()
  await getList()
}
defineExpose({ open })

const resetQueryParams = () => {
  queryParams.pageNo = 1
  queryParams.templateId = templateId.value
  queryParams.billNo = undefined
  queryParams.source = undefined
  queryParams.success = undefined
  queryParams.createTime = defaultTimeRange()
}

/** 取号时间必填且不超过 3 个月：日志表可能很大，放开查会拖垮性能 */
const validateTimeRange = (): boolean => {
  const range = queryParams.createTime
  if (!range || range.length !== 2 || !range[0] || !range[1]) {
    message.warning('请选择取号时间区间')
    return false
  }
  if (dayjs(range[1]).isAfter(dayjs(range[0]).add(3, 'month'))) {
    message.warning('取号时间区间不能大于 3 个月，请缩小范围')
    return false
  }
  return true
}

const getList = async () => {
  if (!validateTimeRange()) {
    return
  }
  loading.value = true
  try {
    const data = await BillTemplateApi.getBillTemplateLogPage(queryParams)
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

const resetQuery = () => {
  resetQueryParams()
  getList()
}
</script>

<style lang="scss" scoped>
.bt-panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
</style>
