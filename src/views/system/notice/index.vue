<template>
  <ContentWrap>
    <!-- 搜索工作栏 -->
    <el-form
      class="-mb-15px"
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      label-width="68px"
    >
      <el-form-item label="公告标题" prop="title">
        <el-input
          v-model="queryParams.title"
          placeholder="请输入公告标题"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="公告状态" prop="status">
        <el-select
          v-model="queryParams.status"
          placeholder="请选择公告状态"
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
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['system:notice:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增
        </el-button>
        <el-button
          type="danger"
          plain
          :disabled="checkedIds.length === 0"
          @click="handleDeleteBatch"
          v-hasPermi="['system:notice:delete']"
        >
          <Icon icon="ep:delete" class="mr-5px" /> 批量删除
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
      <el-table-column label="公告编号" align="center" prop="id" />
      <el-table-column label="公告标题" align="center" prop="title" />
      <el-table-column label="公告类型" align="center" prop="type">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.SYSTEM_NOTICE_TYPE" :value="scope.row.type" />
        </template>
      </el-table-column>
      <el-table-column label="状态" align="center" prop="status" width="90">
        <template #default="scope">
          <StatusSwitch
            :model-value="scope.row.status === CommonStatusEnum.ENABLE"
            :loading="statusLoadingId === scope.row.id"
            :permission="['system:notice:update']"
            @change="(next) => handleUpdateStatus(scope.row, next)"
          />
        </template>
      </el-table-column>
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="180"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" align="center" width="160">
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
  <NoticeForm ref="formRef" @success="getList" />
</template>
<script lang="ts" setup>
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { dateFormatter } from '@/utils/formatTime'
import * as NoticeApi from '@/api/system/notice'
import { CommonStatusEnum } from '@/utils/constants'
import NoticeForm from './NoticeForm.vue'
import type { TableActionButton } from '@/components/TableActions'

defineOptions({ name: 'SystemNotice' })

const message = useMessage() // 消息弹窗
const { t } = useI18n() // 国际化
const route = useRoute()

const loading = ref(true) // 列表的加载中
const total = ref(0) // 列表的总页数
const list = ref([]) // 列表的数据
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  title: '',
  type: undefined,
  status: undefined
})
const queryFormRef = ref() // 搜索的表单

/** 查询公告列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await NoticeApi.getNoticePage(queryParams)
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
    await NoticeApi.updateNotice({
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
    await NoticeApi.deleteNotice(id)
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/** 批量删除按钮操作 */
const checkedIds = ref<number[]>([])
const handleRowCheckboxChange = (rows: NoticeApi.NoticeVO[]) => {
  checkedIds.value = rows.map((row) => row.id!)
}

const handleDeleteBatch = async () => {
  try {
    // 删除的二次确认
    await message.delConfirm()
    // 发起批量删除
    await NoticeApi.deleteNoticeList(checkedIds.value)
    checkedIds.value = []
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/** 推送按钮操作 */
const handlePush = async (id: number) => {
  try {
    // 推送的二次确认
    await message.confirm('是否推送所选中通知？')
    // 发起推送
    await NoticeApi.pushNotice(id)
    message.success(t('推送成功'))
  } catch {}
}

const rowButtons: TableActionButton[] = [
  {
    key: 'update',
    label: '编辑',
    permission: ['system:notice:update'],
    onClick: (row) => openForm('update', row.id)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['system:notice:delete'],
    onClick: (row) => handleDelete(row.id)
  },
  {
    key: 'push',
    label: '推送',
    permission: ['system:notice:update'],
    onClick: (row) => handlePush(row.id)
  }
]

/** 初始化 **/
onMounted(async () => {
  getList()
  const id = Number(route.query.id)
  if (Number.isInteger(id) && id > 0) {
    await nextTick()
    openForm('update', id)
  }
})
</script>
