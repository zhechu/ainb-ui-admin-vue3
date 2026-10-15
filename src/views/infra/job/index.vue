<template>
  <doc-alert title="定时任务" url="https://doc.enlev.cn/job/" />
  <doc-alert title="异步任务" url="https://doc.enlev.cn/async-task/" />
  <doc-alert title="消息队列" url="https://doc.enlev.cn/message-queue/" />

  <ContentWrap>
    <!-- 搜索工作栏 -->
    <el-form
      class="-mb-15px"
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      label-width="100px"
    >
      <el-form-item label="任务名称" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入任务名称"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="任务状态" prop="status">
        <el-select
          v-model="queryParams.status"
          placeholder="请选择任务状态"
          clearable
          class="!w-240px"
        >
          <el-option
            v-for="dict in getIntDictOptions(DICT_TYPE.INFRA_JOB_STATUS)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="处理器的名字" prop="handlerName">
        <el-input
          v-model="queryParams.handlerName"
          placeholder="请输入处理器的名字"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['infra:job:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增
        </el-button>
        <el-button
          type="success"
          plain
          @click="handleExport"
          :loading="exportLoading"
          v-hasPermi="['infra:job:export']"
        >
          <Icon icon="ep:download" class="mr-5px" /> 导出
        </el-button>
        <el-button type="info" plain @click="handleJobLog()" v-hasPermi="['infra:job:query']">
          <Icon icon="ep:zoom-in" class="mr-5px" /> 执行日志
        </el-button>
        <el-button
          type="warning"
          plain
          @click="handleSyncJob()"
          :loading="syncLoading"
          v-hasPermi="['infra:job:create']"
        >
          <Icon icon="ep:refresh" class="mr-5px" /> 同步任务
        </el-button>
        <el-button
          type="danger"
          plain
          :disabled="checkedIds.length === 0"
          @click="handleDeleteBatch"
          v-hasPermi="['infra:job:delete']"
        >
          <Icon icon="ep:delete" class="mr-5px" /> 批量删除
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list" @selection-change="handleRowCheckboxChange">
      <el-table-column type="selection" width="55" />
      <el-table-column label="序号" type="index" width="44" align="center" :index="indexMethod(queryParams)" class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="任务编号" align="center" prop="id" />
      <el-table-column label="任务名称" align="center" prop="name" />
      <el-table-column label="任务状态" align="center" prop="status">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.INFRA_JOB_STATUS" :value="scope.row.status" />
        </template>
      </el-table-column>
      <el-table-column label="处理器的名字" align="center" prop="handlerName" />
      <el-table-column label="处理器的参数" align="center" prop="handlerParam" />
      <el-table-column label="CRON 表达式" align="center" prop="cronExpression" />
      <el-table-column label="操作" align="center" min-width="220" fixed="right">
        <template #default="scope">
          <TableActions :row="scope.row" :buttons="rowButtons" />
        </template>
      </el-table-column>
    </el-table>
    <!-- 分页组件 -->
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </ContentWrap>

  <!-- 表单弹窗：添加/修改 -->
  <JobForm ref="formRef" @success="getList" />
  <!-- 表单弹窗：查看 -->
  <JobDetail ref="detailRef" />
</template>
<script lang="ts" setup>
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import type { TableActionButton } from '@/components/TableActions'
import JobForm from './JobForm.vue'
import JobDetail from './JobDetail.vue'
import download from '@/utils/download'
import * as JobApi from '@/api/infra/job'
import { InfraJobStatusEnum } from '@/utils/constants'

defineOptions({ name: 'InfraJob' })

const { t } = useI18n() // 国际化
const message = useMessage() // 消息弹窗
const { push } = useRouter() // 路由

const loading = ref(true) // 列表的加载中
const total = ref(0) // 列表的总页数
const list = ref([]) // 列表的数据
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  name: undefined,
  status: undefined,
  handlerName: undefined
})
const queryFormRef = ref() // 搜索的表单
const exportLoading = ref(false) // 导出的加载中
const syncLoading = ref(false) // 同步的加载中

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await JobApi.getJobPage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

/** 搜索按钮操作 */
const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}

/** 重置按钮操作 */
const resetQuery = () => {
  queryFormRef.value.resetFields()
  handleQuery()
}

/** 导出按钮操作 */
const handleExport = async () => {
  try {
    // 导出的二次确认
    await message.exportConfirm()
    // 发起导出
    exportLoading.value = true
    const data = await JobApi.exportJob(queryParams)
    download.excel(data, '定时任务.xls')
  } catch {
  } finally {
    exportLoading.value = false
  }
}

/** 同步任务到 Quartz */
const handleSyncJob = async () => {
  try {
    await message.confirm('确认要同步所有任务到调度器?', t('common.reminder'))
    syncLoading.value = true
    await JobApi.syncJob()
    message.success('同步成功')
    await getList()
  } catch {
  } finally {
    syncLoading.value = false
  }
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

/** 修改状态操作 */
const handleChangeStatus = async (row: JobApi.JobVO) => {
  try {
    // 修改状态的二次确认
    const text = row.status === InfraJobStatusEnum.STOP ? '开启' : '关闭'
    await message.confirm(
      '确认要' + text + '定时任务编号为"' + row.id + '"的数据项?',
      t('common.reminder')
    )
    const status =
      row.status === InfraJobStatusEnum.STOP ? InfraJobStatusEnum.NORMAL : InfraJobStatusEnum.STOP
    await JobApi.updateJobStatus(row.id, status)
    message.success(text + '成功')
    // 刷新列表
    await getList()
  } catch {}
}

/** 删除按钮操作 */
const handleDelete = async (id: number) => {
  try {
    // 删除的二次确认
    await message.delConfirm()
    // 发起删除
    await JobApi.deleteJob(id)
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/** 批量删除按钮操作 */
const checkedIds = ref<number[]>([])
const handleRowCheckboxChange = (rows: JobApi.JobVO[]) => {
  checkedIds.value = rows.map((row) => row.id)
}

const handleDeleteBatch = async () => {
  try {
    // 删除的二次确认
    await message.delConfirm()
    // 发起批量删除
    await JobApi.deleteJobList(checkedIds.value)
    checkedIds.value = []
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/**
 * 操作列按钮清单。顺序即显示顺序：前三个行内，第四个起收进「更多」。
 * 原来「更多」靠 handleCommand 的 switch 把 command 字符串映射回 handler，
 * 现在每个按钮自带 onClick，映射这层样板消失
 */
const rowButtons: TableActionButton[] = [
  {
    key: 'update',
    label: '编辑',
    permission: ['infra:job:update'],
    onClick: (row) => openForm('update', row.id)
  },
  {
    key: 'status',
    label: (row) => (row.status === InfraJobStatusEnum.STOP ? '开启' : '暂停'),
    permission: ['infra:job:update'],
    onClick: (row) => handleChangeStatus(row)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['infra:job:delete'],
    onClick: (row) => handleDelete(row.id)
  },
  {
    key: 'run',
    label: '执行一次',
    permission: ['infra:job:trigger'],
    onClick: (row) => handleRun(row)
  },
  {
    key: 'detail',
    label: '任务详细',
    permission: ['infra:job:query'],
    onClick: (row) => openDetail(row.id)
  },
  {
    key: 'log',
    label: '调度日志',
    permission: ['infra:job:query'],
    onClick: (row) => handleJobLog(row.id)
  }
]

/** 执行一次 */
const handleRun = async (row: JobApi.JobVO) => {
  try {
    // 二次确认
    await message.confirm('确认要立即执行一次' + row.name + '?', t('common.reminder'))
    // 提交执行
    await JobApi.runJob(row.id)
    message.success('执行成功')
    // 刷新列表
    await getList()
  } catch {}
}

/** 查看操作 */
const detailRef = ref()
const openDetail = (id: number) => {
  detailRef.value.open(id)
}

/** 跳转执行日志 */
const handleJobLog = (id?: number) => {
  if (id && id > 0) {
    push('/job/job-log?id=' + id)
  } else {
    push('/job/job-log')
  }
}

/** 初始化 **/
onMounted(() => {
  getList()
})
</script>
