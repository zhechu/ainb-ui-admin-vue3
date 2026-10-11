<template>
  <doc-alert title="功能权限" url="https://doc.iocoder.cn/resource-permission" />
  <doc-alert title="数据权限" url="https://doc.iocoder.cn/data-permission" />

  <ContentWrap>
    <!-- 搜索工作栏 -->
    <el-form
      ref="queryFormRef"
      :inline="true"
      :model="queryParams"
      class="-mb-15px"
      label-width="68px"
    >
      <el-form-item label="角色名称" prop="name">
        <el-input
          v-model="queryParams.name"
          class="!w-240px"
          clearable
          placeholder="请输入角色名称"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="角色标识" prop="code">
        <el-input
          v-model="queryParams.code"
          class="!w-240px"
          clearable
          placeholder="请输入角色标识"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" class="!w-240px" clearable placeholder="请选择状态">
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
          :default-time="[new Date('1 00:00:00'), new Date('1 23:59:59')]"
          class="!w-240px"
          end-placeholder="结束日期"
          start-placeholder="开始日期"
          type="daterange"
          value-format="YYYY-MM-DD HH:mm:ss"
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
        <el-button
          v-hasPermi="['system:role:create']"
          plain
          type="primary"
          @click="openForm('create')"
        >
          <Icon class="mr-5px" icon="ep:plus" />
          新增
        </el-button>
        <el-button
          v-hasPermi="['system:role:export']"
          :loading="exportLoading"
          plain
          type="success"
          @click="handleExport"
        >
          <Icon class="mr-5px" icon="ep:download" />
          导出
        </el-button>
        <el-button
          v-hasPermi="['system:role:delete']"
          :disabled="checkedIds.length === 0"
          plain
          type="danger"
          @click="handleDeleteBatch"
        >
          <Icon class="mr-5px" icon="ep:delete" />
          批量删除
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap>
    <el-table
      v-loading="loading"
      :data="list"
      class="xpy-list-table"
      stripe
      row-key="id"
      @selection-change="handleRowCheckboxChange"
    >
      <el-table-column type="selection" width="45" />
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        class-name="col-index"
        label-class-name="col-index"
        :index="indexMethod(queryParams)"
      />
      <!-- 实测：10 位角色编号（如 9000000543）在 100px 下会折成 2 行、把整行顶到 63px -->
      <el-table-column align="center" label="角色编号" prop="id" width="110" />
      <el-table-column label="角色名称" prop="name" min-width="140" show-overflow-tooltip />
      <el-table-column align="center" label="角色类型" prop="type" width="110">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.SYSTEM_ROLE_TYPE" :value="scope.row.type" />
        </template>
      </el-table-column>
      <el-table-column
        label="角色标识"
        prop="code"
        min-width="140"
        show-overflow-tooltip
      />
      <el-table-column align="center" label="显示顺序" prop="sort" width="90" />
      <el-table-column label="备注" prop="remark" min-width="140" show-overflow-tooltip>
        <template #default="scope">
          <span v-if="scope.row.remark">{{ scope.row.remark }}</span>
          <span v-else class="text-gray-400">-</span>
        </template>
      </el-table-column>
      <el-table-column align="center" label="状态" prop="status" width="90">
        <template #default="scope">
          <StatusSwitch
            :model-value="scope.row.status === CommonStatusEnum.ENABLE"
            :loading="statusLoadingId === scope.row.id"
            :permission="['system:role:update']"
            @change="(next) => handleUpdateStatus(scope.row, next)"
          />
        </template>
      </el-table-column>
      <el-table-column
        :formatter="dateFormatter"
        align="center"
        label="创建时间"
        prop="createTime"
        width="170"
      />
      <!-- 实测：编辑 成员 资源授权 删除 = 224px（含 .cell 左右内边距），220 会折行 -->
      <el-table-column align="center" fixed="right" label="操作" width="230">
        <template #default="scope">
          <TableActions :row="scope.row" :buttons="rowButtons" />
        </template>
      </el-table-column>
    </el-table>
    <Pagination
      v-model:limit="queryParams.pageSize"
      v-model:page="queryParams.pageNo"
      :total="total"
      @pagination="getList"
    />
  </ContentWrap>

  <!-- 表单弹窗：添加/修改 -->
  <RoleForm ref="formRef" @success="getList" />
</template>
<script lang="ts" setup>
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { dateFormatter } from '@/utils/formatTime'
import download from '@/utils/download'
import * as RoleApi from '@/api/system/role'
import { CommonStatusEnum } from '@/utils/constants'
import RoleForm from './RoleForm.vue'
import type { TableActionButton } from '@/components/TableActions'

defineOptions({ name: 'SystemRole' })

const message = useMessage() // 消息弹窗
const { t } = useI18n() // 国际化
const router = useRouter()

const loading = ref(true) // 列表的加载中
const total = ref(0) // 列表的总页数
const list = ref([]) // 列表的数据
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  code: '',
  name: '',
  status: undefined,
  createTime: []
})
const queryFormRef = ref() // 搜索的表单
const exportLoading = ref(false) // 导出的加载中

/** 查询角色列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await RoleApi.getRolePage(queryParams)
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

/** 成员配置：页内跳转到独立的成员页（与「资源授权」一致，不弹窗） */
const openMemberPage = (row: RoleApi.RoleVO) => {
  router.push({ name: 'SystemRoleMember', query: { roleId: String(row.id) } })
}

/** 资源授权：页内跳转到独立的授权页面（不弹窗） */
const openGrantPage = (row: RoleApi.RoleVO) => {
  router.push({ name: 'SystemRoleGrant', query: { roleId: String(row.id) } })
}

/** 状态列快捷开关：走整行更新接口，与编辑表单保存同一条后端路径 */
const statusLoadingId = ref<number | null>(null)
const handleUpdateStatus = async (row: any, next: boolean) => {
  statusLoadingId.value = row.id
  try {
    await RoleApi.updateRole({
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
    await RoleApi.deleteRole(id)
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

const rowButtons: TableActionButton[] = [
  {
    key: 'update',
    label: '编辑',
    permission: ['system:role:update'],
    onClick: (row) => openForm('update', row.id)
  },
  {
    key: 'member',
    label: '成员',
    permission: ['system:permission:assign-user-role'],
    onClick: (row) => openMemberPage(row)
  },
  {
    key: 'grant',
    label: '资源授权',
    permission: ['system:grant:query'],
    onClick: (row) => openGrantPage(row)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['system:role:delete'],
    onClick: (row) => handleDelete(row.id)
  }
]

/** 批量删除按钮操作 */
const checkedIds = ref<number[]>([])
const handleRowCheckboxChange = (rows: RoleApi.RoleVO[]) => {
  checkedIds.value = rows.map((row) => row.id)
}

const handleDeleteBatch = async () => {
  try {
    // 删除的二次确认
    await message.delConfirm()
    // 发起批量删除
    await RoleApi.deleteRoleList(checkedIds.value)
    checkedIds.value = []
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/** 导出按钮操作 */
const handleExport = async () => {
  try {
    // 导出的二次确认
    await message.exportConfirm()
    // 发起导出
    exportLoading.value = true
    const data = await RoleApi.exportRole(queryParams)
    download.excel(data, '角色数据.xls')
  } catch {
  } finally {
    exportLoading.value = false
  }
}

/** 初始化 */
onMounted(() => {
  getList()
})
</script>
