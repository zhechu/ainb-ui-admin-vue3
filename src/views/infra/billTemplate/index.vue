<template>
  <!-- 页内视图切换：列表 / 新建编辑表单 / 取号日志，参照数据接口页的做法 -->
  <template v-if="viewMode === 'list'">
  <ContentWrap>
    <el-form class="-mb-15px" :model="queryParams" ref="queryFormRef" :inline="true">
      <el-form-item label="模板名称" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入模板名称"
          clearable
          @keyup.enter="handleQuery"
          class="!w-200px"
        />
      </el-form-item>
      <el-form-item label="模板编码" prop="code">
        <el-input
          v-model="queryParams.code"
          placeholder="请输入模板编码"
          clearable
          @keyup.enter="handleQuery"
          class="!w-200px"
        />
      </el-form-item>
      <el-form-item label="分类" prop="category">
        <el-select v-model="queryParams.category" placeholder="全部" clearable class="!w-140px">
          <el-option
            v-for="dict in getStrDictOptions(DICT_TYPE.INFRA_BILL_TEMPLATE_CATEGORY)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="生成方式" prop="genType">
        <el-select v-model="queryParams.genType" placeholder="全部" clearable class="!w-140px">
          <el-option
            v-for="item in GEN_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" placeholder="全部" clearable class="!w-120px">
          <el-option label="开启" :value="0" />
          <el-option label="停用" :value="1" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['infra:bill-template:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新建模板
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column label="序号" type="index" width="44" align="center" :index="indexMethod(queryParams)" class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="编号" align="center" prop="id" width="70" />
      <el-table-column label="模板名称" prop="name" :show-overflow-tooltip="true" min-width="140" />
      <el-table-column label="模板编码" prop="code" :show-overflow-tooltip="true" min-width="140" />
      <el-table-column label="分类" align="center" width="100">
        <template #default="{ row }">
          <DictTag
            v-if="row.category"
            :type="DICT_TYPE.INFRA_BILL_TEMPLATE_CATEGORY"
            :value="row.category"
          />
          <span v-else class="text-[var(--el-text-color-secondary)]">-</span>
        </template>
      </el-table-column>
      <el-table-column label="生成方式" align="center" width="110">
        <template #default="{ row }">
          <el-tag size="small">{{ genTypeLabel(row.genType) }}</el-tag>
        </template>
      </el-table-column>
      <!-- 范例是这张表里最有用的一列：管理员一眼就能确认规则配对了没有 -->
      <el-table-column label="范例" prop="example" :show-overflow-tooltip="true" min-width="180">
        <template #default="{ row }">
          <span class="font-mono">{{ row.example || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="重置周期" align="center" width="110">
        <template #default="{ row }">
          {{ resetCycleLabel(row) }}
        </template>
      </el-table-column>
      <el-table-column label="当前流水" align="center" width="100">
        <template #default="{ row }">
          <!-- 权威值在 Redis，这里是出号后回写的展示值，可能略滞后，因此加 tooltip 说明 -->
          <el-tooltip
            v-if="row.genType === GEN_TYPE.TIME"
            content="出号后回写的展示值，可能略滞后于实际流水"
            placement="top"
          >
            <span>{{ row.currentNumber ?? 0 }}</span>
          </el-tooltip>
          <span v-else class="text-[var(--el-text-color-secondary)]">-</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" align="center" width="90">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 0"
            @change="handleStatusChange(row)"
            v-hasPermi="['infra:bill-template:update']"
          />
        </template>
      </el-table-column>
      <el-table-column
        label="更新时间"
        align="center"
        prop="updateTime"
        width="170"
        :formatter="dateFormatter"
      />
      <!-- 实测：测试 取号日志 编辑 删除 = 224px（含 .cell 左右内边距），220 会折行 -->
      <el-table-column label="操作" align="center" width="230" fixed="right">
        <template #default="{ row }">
          <TableActions :row="row" :buttons="rowButtons" />
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

  <BillTemplateForm
    v-else-if="viewMode === 'form'"
    ref="formRef"
    @success="handlePanelDone"
    @back="handlePanelBack"
  />

  <BillTemplateLogList v-else-if="viewMode === 'log'" ref="logRef" @back="handlePanelBack" />

  <!-- 取号测试：真实取号会消耗流水并回写统计，返回时刷新列表 -->
  <BillTemplateTestPanel v-else-if="viewMode === 'test'" ref="testRef" @back="handlePanelDone" />
</template>

<script lang="ts" setup>
import { ElMessageBox } from 'element-plus'
import { dateFormatter } from '@/utils/formatTime'
import { DICT_TYPE, getStrDictOptions } from '@/utils/dict'
import * as BillTemplateApi from '@/api/infra/billTemplate'
import BillTemplateForm from './BillTemplateForm.vue'
import BillTemplateLogList from './BillTemplateLogList.vue'
import BillTemplateTestPanel from './BillTemplateTestPanel.vue'
import { GEN_TYPE, GEN_TYPE_OPTIONS, RESET_CYCLE_OPTIONS } from './constants'
import type { TableActionButton } from '@/components/TableActions'

/** 单据模板列表 */
defineOptions({ name: 'InfraBillTemplate' })

const message = useMessage()
const { t } = useI18n()

/** 页内视图：列表 / 新建编辑表单 / 取号日志 / 取号测试 */
const viewMode = ref<'list' | 'form' | 'log' | 'test'>('list')

const loading = ref(true)
const list = ref<BillTemplateApi.BillTemplateVO[]>([])
const total = ref(0)
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  name: undefined,
  code: undefined,
  category: undefined,
  genType: undefined,
  status: undefined
})
const queryFormRef = ref()

const genTypeLabel = (genType: number) =>
  GEN_TYPE_OPTIONS.find((item) => item.value === genType)?.label ?? String(genType)

/**
 * 重置周期的展示文案
 *
 * 用后端下发的 resetCycleActual（AUTO 已解析成具体周期），前端不重复实现解析规则。
 * 否则列表里一片「跟随日期格式」，管理员还得对着日期格式心算一遍。
 */
const resetCycleLabel = (row: BillTemplateApi.BillTemplateVO) => {
  if (row.genType !== GEN_TYPE.TIME) {
    return '-'
  }
  const cycle = row.resetCycleActual || row.resetCycle
  return RESET_CYCLE_OPTIONS.find((item) => item.value === cycle)?.label ?? cycle ?? '-'
}

const getList = async () => {
  loading.value = true
  try {
    const data = await BillTemplateApi.getBillTemplatePage(queryParams)
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
  queryFormRef.value?.resetFields()
  handleQuery()
}

const formRef = ref()
const openForm = async (type: string, id?: number) => {
  viewMode.value = 'form'
  // 面板是条件渲染的，必须等挂载后才能拿到 ref
  await nextTick()
  formRef.value?.open(type, id)
}

const logRef = ref()
const openLog = async (row: BillTemplateApi.BillTemplateVO) => {
  viewMode.value = 'log'
  await nextTick()
  logRef.value?.open(row.id, row.name)
}

const testRef = ref()
const openTest = async (row: BillTemplateApi.BillTemplateVO) => {
  viewMode.value = 'test'
  await nextTick()
  testRef.value?.open(row.id, row.name)
}

/** 面板内保存成功：回列表并刷新 */
const handlePanelDone = () => {
  viewMode.value = 'list'
  getList()
}

/** 面板返回：只回列表，不刷新 */
const handlePanelBack = () => {
  viewMode.value = 'list'
}

/** 启用 / 停用 */
const handleStatusChange = async (row: BillTemplateApi.BillTemplateVO) => {
  const newStatus = row.status === 0 ? 1 : 0
  try {
    await BillTemplateApi.updateStatus(row.id, newStatus)
    message.success(newStatus === 0 ? '已启用' : '已停用')
    await getList()
  } catch {
    // 失败时不刷新列表，开关会因为重新渲染回到原状态
  }
}

/**
 * 删除模板
 *
 * 已出过号的模板后端会直接拒绝，这里先在前端提示一次，省掉一次无谓的请求往返。
 */
const handleDelete = async (row: BillTemplateApi.BillTemplateVO) => {
  if (row.lastNo) {
    message.warning(`模板「${row.name}」已生成过单号，不允许删除。如需停止使用请改为「停用」`)
    return
  }
  try {
    await ElMessageBox.confirm(`确认删除单据模板「${row.name}」吗？此操作不可恢复。`, '删除确认', {
      confirmButtonText: t('common.ok'),
      cancelButtonText: t('common.cancel'),
      type: 'warning'
    })
  } catch {
    return
  }
  await BillTemplateApi.deleteBillTemplate(row.id)
  message.success(t('common.delSuccess'))
  await getList()
}

// 删除不做 disabled（已出过号的模板禁删）：置灰的按钮不解释原因，
// 而 handleDelete 里那句 message.warning 会告诉用户「如需停止使用请改为停用」
const rowButtons: TableActionButton[] = [
  {
    key: 'test',
    label: '测试',
    permission: ['infra:bill-template:query'],
    onClick: (row) => openTest(row)
  },
  {
    key: 'log',
    label: '取号日志',
    permission: ['infra:bill-template:query'],
    onClick: (row) => openLog(row)
  },
  {
    key: 'update',
    label: '编辑',
    permission: ['infra:bill-template:update'],
    onClick: (row) => openForm('update', row.id)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['infra:bill-template:delete'],
    onClick: (row) => handleDelete(row)
  }
]

onMounted(() => {
  getList()
})
</script>
