<template>
  <doc-alert title="站内信配置" url="https://doc.iocoder.cn/notify/" />

  <!-- 搜索工作栏 -->
  <ContentWrap>
    <el-form
      class="-mb-15px"
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      label-width="68px"
    >
      <el-form-item label="模板名称" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入模板名称"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="模板编号" prop="code">
        <el-input
          v-model="queryParams.code"
          placeholder="请输入模版编码"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select
          v-model="queryParams.status"
          placeholder="请选择开启状态"
          clearable
          class="!w-240px"
        >
          <el-option
            v-for="dict in getIntDictOptions(DICT_TYPE.COMMON_STATUS)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="创建时间" prop="createTime">
        <el-date-picker
          v-model="queryParams.createTime"
          value-format="YYYY-MM-DD HH:mm:ss"
          type="daterange"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :default-time="[new Date('1 00:00:00'), new Date('1 23:59:59')]"
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
          v-hasPermi="['system:notify-template:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" />新增
        </el-button>
        <el-button
          type="danger"
          plain
          :disabled="checkedIds.length === 0"
          @click="handleDeleteBatch"
          v-hasPermi="['system:notify-template:delete']"
        >
          <Icon icon="ep:delete" class="mr-5px" />批量删除
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table
      v-loading="loading"
      :data="list"
      @selection-change="handleRowCheckboxChange"
      class="xpy-list-table"
      stripe
    >
      <el-table-column type="selection" width="55" />
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        :index="indexMethod(queryParams)"
        class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column
        label="模板编码"
        align="center"
        prop="code"
        width="120"
        :show-overflow-tooltip="true"
      />
      <el-table-column
        label="模板名称"
        align="center"
        prop="name"
        width="120"
        :show-overflow-tooltip="true"
      />
      <el-table-column label="类型" align="center" prop="type">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.SYSTEM_NOTIFY_TEMPLATE_TYPE" :value="scope.row.type" />
        </template>
      </el-table-column>
      <el-table-column label="发送人名称" align="center" prop="nickname" />
      <el-table-column
        label="模板内容"
        align="center"
        prop="content"
        width="200"
        :show-overflow-tooltip="true"
      />
      <el-table-column label="开启状态" align="center" prop="status" width="90">
        <template #default="scope">
          <StatusSwitch
            :model-value="scope.row.status === CommonStatusEnum.ENABLE"
            :loading="statusLoadingId === scope.row.id"
            :permission="['system:notify-template:update']"
            @change="(next) => handleUpdateStatus(scope.row, next)"
          />
        </template>
      </el-table-column>
      <el-table-column label="备注" align="center" prop="remark" />
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="180"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" align="center" width="160" fixed="right">
        <template #default="scope">
          <TableActions :row="scope.row" :buttons="rowButtons" />
        </template>
      </el-table-column>
    </el-table>
    <!-- 分页 -->
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </ContentWrap>

  <!-- 表单弹窗：添加/修改 -->
  <NotifyTemplateForm ref="formRef" @success="getList" />
  <!-- 表单弹窗：测试发送 -->
  <NotifyTemplateSendForm ref="sendFormRef" />
</template>
<script lang="ts" setup>
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { dateFormatter } from '@/utils/formatTime'
import * as NotifyTemplateApi from '@/api/system/notify/template'
import { CommonStatusEnum } from '@/utils/constants'
import NotifyTemplateForm from './NotifyTemplateForm.vue'
import NotifyTemplateSendForm from './NotifyTemplateSendForm.vue'
import type { TableActionButton } from '@/components/TableActions'

defineOptions({ name: 'NotifySmsTemplate' })

const message = useMessage() // 消息弹窗
const { t } = useI18n() // 国际化

const loading = ref(false) // 列表的加载中
const total = ref(0) // 列表的总页数
const list = ref([]) // 列表的数据
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  name: undefined,
  status: undefined,
  code: undefined,
  createTime: []
})
const queryFormRef = ref() // 搜索的表单

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await NotifyTemplateApi.getNotifyTemplatePage(queryParams)
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

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

/** 状态列快捷开关：走整行更新接口，与编辑表单保存同一条后端路径 */
const statusLoadingId = ref<number | null>(null)
const handleUpdateStatus = async (row: any, next: boolean) => {
  statusLoadingId.value = row.id
  try {
    await NotifyTemplateApi.updateNotifyTemplate({
      ...row,
      status: next ? CommonStatusEnum.ENABLE : CommonStatusEnum.DISABLE
    })
    message.success(next ? '已开启' : '已关闭')
    await getList()
  } finally {
    statusLoadingId.value = null
  }
}

/** 删除按钮操作 */
const handleDelete = async (id: number) => {
  try {
    // 删除的二次确认
    await message.delConfirm()
    // 发起删除
    await NotifyTemplateApi.deleteNotifyTemplate(id)
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/** 批量删除按钮操作 */
const checkedIds = ref<number[]>([])
const handleRowCheckboxChange = (rows: NotifyTemplateApi.NotifyTemplateVO[]) => {
  checkedIds.value = rows.map((row) => row.id!)
}

const handleDeleteBatch = async () => {
  try {
    // 删除的二次确认
    await message.delConfirm()
    // 发起批量删除
    await NotifyTemplateApi.deleteNotifyTemplateList(checkedIds.value)
    checkedIds.value = []
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/** 发送站内信按钮 */
const sendFormRef = ref() // 表单 Ref
const openSendForm = (row: NotifyTemplateApi.NotifyTemplateVO) => {
  sendFormRef.value.open(row.id)
}

const rowButtons: TableActionButton[] = [
  {
    key: 'update',
    label: '修改',
    permission: ['system:notify-template:update'],
    onClick: (row) => openForm('update', row.id)
  },
  {
    key: 'send',
    label: '测试',
    permission: ['system:notify-template:send-notify'],
    onClick: (row) => openSendForm(row)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['system:notify-template:delete'],
    onClick: (row) => handleDelete(row.id)
  }
]

/** 初始化 **/
onMounted(() => {
  getList()
})
</script>
