<template>
  <!-- <doc-alert title="审批接入（业务表单）" url="https://doc.enlev.cn/bpm/use-business-form/" /> -->

  <ContentWrap>
    <!-- 搜索工作栏 -->
    <el-form
      ref="queryFormRef"
      :inline="true"
      :model="queryParams"
      class="-mb-15px"
      label-width="68px"
    >
      <el-form-item label="请假类型" prop="type">
        <el-select
          v-model="queryParams.type"
          class="!w-240px"
          clearable
          placeholder="请选择请假类型"
        >
          <el-option
            v-for="dict in getIntDictOptions(DICT_TYPE.BPM_OA_LEAVE_TYPE)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="申请时间" prop="createTime">
        <el-date-picker
          v-model="queryParams.createTime"
          :default-time="[new Date('1 00:00:00'), new Date('1 23:59:59')]"
          class="!w-240px"
          end-placeholder="结束日期"
          start-placeholder="开始日期"
          type="daterange"
          value-format="YYYY-MM-DD HH:mm:ss"
        />
      </el-form-item>
      <el-form-item label="审批结果" prop="status">
        <el-select
          v-model="queryParams.status"
          class="!w-240px"
          clearable
          placeholder="请选择审批结果"
        >
          <el-option
            v-for="dict in getIntDictOptions(DICT_TYPE.BPM_PROCESS_INSTANCE_STATUS)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="原因" prop="reason">
        <el-input
          v-model="queryParams.reason"
          class="!w-240px"
          clearable
          placeholder="请输入原因"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery">
          <Icon class="mr-5px" icon="ep:search" />
          搜索
        </el-button>
        <el-button @click="resetQuery">
          <Icon class="mr-5px" icon="ep:refresh" />
          重置
        </el-button>
        <el-button plain type="primary" @click="handleCreate()">
          <Icon class="mr-5px" icon="ep:plus" />
          发起请假
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        :index="indexMethod(queryParams)"
      class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column align="center" label="申请编号" prop="id" />
      <el-table-column align="center" label="状态" prop="status">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.BPM_PROCESS_INSTANCE_STATUS" :value="scope.row.status" />
        </template>
      </el-table-column>
      <el-table-column
        :formatter="dateFormatter"
        align="center"
        label="开始时间"
        prop="startTime"
        width="180"
      />
      <el-table-column
        :formatter="dateFormatter"
        align="center"
        label="结束时间"
        prop="endTime"
        width="180"
      />
      <el-table-column align="center" label="请假类型" prop="type">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.BPM_OA_LEAVE_TYPE" :value="scope.row.type" />
        </template>
      </el-table-column>
      <el-table-column align="center" label="原因" prop="reason" />
      <el-table-column
        :formatter="dateFormatter"
        align="center"
        label="申请时间"
        prop="createTime"
        width="180"
      />
      <el-table-column align="center" label="操作" width="200" fixed="right">
        <template #default="scope">
          <TableActions :row="scope.row" :buttons="rowButtons" />
        </template>
      </el-table-column>
    </el-table>
    <!-- 分页 -->
    <Pagination
      v-model:limit="queryParams.pageSize"
      v-model:page="queryParams.pageNo"
      :total="total"
      @pagination="getList"
    />
  </ContentWrap>
</template>
<script lang="ts" setup>
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { dateFormatter } from '@/utils/formatTime'
import * as LeaveApi from '@/api/bpm/leave'
import * as ProcessInstanceApi from '@/api/bpm/processInstance'
import type { TableActionButton } from '@/components/TableActions'

defineOptions({ name: 'BpmOALeave' })

const message = useMessage() // 消息弹窗
const router = useRouter() // 路由
const { t } = useI18n() // 国际化

const loading = ref(true) // 列表的加载中
const total = ref(0) // 列表的总页数
const list = ref([]) // 列表的数据
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  type: undefined,
  status: undefined,
  reason: undefined,
  createTime: []
})
const queryFormRef = ref() // 搜索的表单

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await LeaveApi.getLeavePage(queryParams)
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

/** 添加操作 */
const handleCreate = () => {
  router.push({ name: 'OALeaveCreate' })
}

/** 重新发起操作 */
const handleReCreate = (row: LeaveApi.LeaveVO) => {
  router.push({
    name: 'OALeaveCreate',
    query: {
      id: row.id
    }
  })
}

/** 详情操作 */
const handleDetail = (row: LeaveApi.LeaveVO) => {
  router.push({
    name: 'OALeaveDetail',
    query: {
      id: row.id
    }
  })
}

/** 取消请假操作 */
const cancelLeave = async (row) => {
  // 二次确认
  const { value } = await ElMessageBox.prompt('请输入取消原因', '取消流程', {
    confirmButtonText: t('common.ok'),
    cancelButtonText: t('common.cancel'),
    inputPattern: /^[\s\S]*.*\S[\s\S]*$/, // 判断非空，且非空格
    inputErrorMessage: '取消原因不能为空'
  })
  // 发起取消
  await ProcessInstanceApi.cancelProcessInstanceByStartUser(row.id, value)
  message.success('取消成功')
  // 刷新列表
  await getList()
}

/** 审批进度 */
const handleProcessDetail = (row) => {
  router.push({
    name: 'BpmProcessInstanceDetail',
    query: {
      id: row.processInstanceId
    }
  })
}

// result === 1 / status !== 1 这两个魔数原样从模板的 v-if 搬过来，没有换成语义常量：
// 换常量会顺带改动判定口径，超出「只换操作列」的范围。两者实际互斥，所以最多 3 个可见、不折叠
const rowButtons: TableActionButton[] = [
  {
    key: 'detail',
    label: '详情',
    permission: ['bpm:oa-leave:query'],
    onClick: (row) => handleDetail(row)
  },
  {
    key: 'process',
    label: '进度',
    permission: ['bpm:oa-leave:query'],
    onClick: (row) => handleProcessDetail(row)
  },
  {
    key: 'cancel',
    label: '取消',
    type: 'danger',
    permission: ['bpm:oa-leave:create'],
    show: (row) => row.result === 1,
    onClick: (row) => cancelLeave(row)
  },
  {
    key: 'recreate',
    label: '重新发起',
    permission: ['bpm:oa-leave:create'],
    show: (row) => row.status !== 1,
    onClick: (row) => handleReCreate(row)
  }
]

watch(
  () => router.currentRoute.value,
  () => {
    getList()
  }
)

/** 初始化 **/
onMounted(() => {
  getList()
})
</script>
