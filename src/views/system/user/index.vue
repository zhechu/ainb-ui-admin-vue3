<template>
  <doc-alert title="用户体系" url="https://doc.iocoder.cn/user-center/" />
  <doc-alert title="三方登陆" url="https://doc.iocoder.cn/social-user/" />
  <doc-alert title="Excel 导入导出" url="https://doc.iocoder.cn/excel-import-and-export/" />

  <!-- gutter 收紧到 10：默认 20 时左右两卡片之间会有一条贯穿整页的宽灰缝，观感松散 -->
  <el-row :gutter="10">
    <!-- 左侧部门树 -->
    <el-col :span="4" :xs="24">
      <ContentWrap class="h-1/1">
        <DeptTreeSelect @node-click="handleDeptNodeClick" />
      </ContentWrap>
    </el-col>
    <el-col :span="20" :xs="24">
      <!-- 搜索 -->
      <ContentWrap>
        <el-form
          class="-mb-15px"
          :model="queryParams"
          ref="queryFormRef"
          :inline="true"
          label-width="68px"
        >
          <el-form-item label="用户名称" prop="username">
            <el-input
              v-model="queryParams.username"
              placeholder="请输入用户名称"
              clearable
              @keyup.enter="handleQuery"
              class="!w-240px"
            />
          </el-form-item>
          <el-form-item label="手机号码" prop="mobile">
            <el-input
              v-model="queryParams.mobile"
              placeholder="请输入手机号码"
              clearable
              @keyup.enter="handleQuery"
              class="!w-240px"
            />
          </el-form-item>
          <el-form-item label="状态" prop="status">
            <el-select
              v-model="queryParams.status"
              placeholder="请选择用户状态"
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
              type="datetimerange"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              class="!w-240px"
            />
          </el-form-item>
          <el-form-item>
            <el-button @click="handleQuery"><Icon icon="ep:search" />搜索</el-button>
            <el-button @click="resetQuery"><Icon icon="ep:refresh" />重置</el-button>
            <el-button
              type="primary"
              plain
              @click="openForm('create')"
              v-hasPermi="['system:user:create']"
            >
              <Icon icon="ep:plus" /> 新增
            </el-button>
            <el-button
              type="warning"
              plain
              @click="handleImport"
              v-hasPermi="['system:user:import']"
            >
              <Icon icon="ep:upload" /> 导入
            </el-button>
            <!--
              导出走弹窗，不走下拉。
              下拉放得下选项，放不下【前提】—— 上限多少、这次查询有多少条、
              会不会被截断，这三件事在下拉里没有位置，只能塞一句既不知道
              用户查了多少条、也不会在超限时变色的小字
            -->
            <el-button
              type="success"
              plain
              v-hasPermi="['system:user:export']"
              @click="handleExport"
            >
              <Icon icon="ep:download" /> 导出
            </el-button>
            <el-button
              type="danger"
              plain
              :disabled="checkedIds.length === 0"
              @click="handleDeleteBatch"
              v-hasPermi="['system:user:delete']"
            >
              <Icon icon="ep:delete" />批量删除
            </el-button>
          </el-form-item>
        </el-form>
      </ContentWrap>
      <ContentWrap>
        <el-table class="xpy-list-table" stripe v-loading="loading" :data="list" @selection-change="handleRowCheckboxChange">
          <el-table-column type="selection" width="55" />
          <el-table-column label="序号" type="index" width="44" align="center" :index="indexMethod(queryParams)" class-name="col-index"
        label-class-name="col-index"
      />
          <el-table-column v-if="isVisible('id')" label="用户编号" align="center" key="id" prop="id" />
          <el-table-column
            v-if="isVisible('username')"
            label="用户名称"
            align="center"
            prop="username"
            :show-overflow-tooltip="true"
          />
          <el-table-column
            v-if="isVisible('nickname')"
            label="用户昵称"
            align="center"
            prop="nickname"
            :show-overflow-tooltip="true"
          />
          <el-table-column
            v-if="isVisible('deptName')"
            label="部门"
            align="center"
            key="deptName"
            prop="deptName"
            :show-overflow-tooltip="true"
          />
          <el-table-column v-if="isVisible('mobile')" label="手机号码" align="center" prop="mobile" width="120" />
          <el-table-column v-if="isVisible('status')" label="状态" key="status">
            <template #default="scope">
              <el-switch
                v-model="scope.row.status"
                :active-value="0"
                :inactive-value="1"
                @change="handleStatusChange(scope.row)"
                :disabled="!checkPermi(['system:user:update'])"
              />
            </template>
          </el-table-column>
          <el-table-column
            v-if="isVisible('createTime')"
            label="创建时间"
            align="center"
            prop="createTime"
            :formatter="dateFormatter"
            width="180"
          />
          <el-table-column label="操作" align="center" width="260" fixed="right">
            <template #default="scope">
              <TableActions :row="scope.row" :buttons="rowButtons" />
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
    </el-col>
  </el-row>

  <!-- 添加或修改用户对话框 -->
  <UserForm ref="formRef" @success="getList" />
  <!-- 用户导入对话框 -->
  <UserImportForm ref="importFormRef" @success="getList" />
  <!-- 用户导出对话框 -->
  <UserExportForm ref="exportFormRef" />
  <!-- 分配角色 -->
  <UserAssignRoleForm ref="assignRoleFormRef" @success="getList" />
</template>
<script lang="ts" setup>
import { useFieldPermission } from '@/hooks/web/useFieldPermission'
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { checkPermi } from '@/utils/permission'
import type { TableActionButton } from '@/components/TableActions'
import { dateFormatter } from '@/utils/formatTime'
import { CommonStatusEnum } from '@/utils/constants'
import * as UserApi from '@/api/system/user'
import UserForm from './UserForm.vue'
import UserImportForm from './UserImportForm.vue'
import UserExportForm from './UserExportForm.vue'
import UserAssignRoleForm from './UserAssignRoleForm.vue'
import DeptTreeSelect from '@/views/system/dept/components/DeptTreeSelect.vue'

defineOptions({ name: 'SystemUser' })

/**
 * 字段级权限：后端 @PermissionFieldCrop 只把 HIDDEN 字段【置空】，
 * 不隐藏列（VO 是强类型的，删不掉属性）。所以列的显隐必须前端来做，
 * 否则表现是「配了隐藏，那一列还在，只是变成空白」
 */
// ⚠️ 第二个参数 true = 按【列级】(:col:) 判定。
// 这是列表页，管的是「这一列显不显示」；详情页才用字段级(:fld:)。
// 传错的后果是读了另一套资源，配置永远不生效且不报错
const { isVisible } = useFieldPermission('system:user', true)

const message = useMessage() // 消息弹窗
const { t } = useI18n() // 国际化

const loading = ref(true) // 列表的加载中
const total = ref(0) // 列表的总页数
const list = ref([]) // 列表的数
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  username: undefined,
  mobile: undefined,
  status: undefined,
  deptId: undefined as number | undefined,
  createTime: []
})
const queryFormRef = ref() // 搜索的表单

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await UserApi.getUserPage(queryParams)
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
  queryFormRef.value?.resetFields()
  handleQuery()
}

/** 处理部门被点击 */
const handleDeptNodeClick = async (deptId: number | undefined) => {
  queryParams.deptId = deptId
  await getList()
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

/** 用户导入 */
const importFormRef = ref()
const handleImport = () => {
  importFormRef.value.open()
}

/** 修改用户状态 */
const handleStatusChange = async (row: UserApi.UserVO) => {
  try {
    // 修改状态的二次确认
    const text = row.status === CommonStatusEnum.ENABLE ? '启用' : '停用'
    await message.confirm('确认要"' + text + '""' + row.username + '"用户吗?')
    // 发起修改状态
    await UserApi.updateUserStatus(row.id, row.status)
    // 刷新列表
    await getList()
  } catch {
    // 取消后，进行恢复按钮
    row.status =
      row.status === CommonStatusEnum.ENABLE ? CommonStatusEnum.DISABLE : CommonStatusEnum.ENABLE
  }
}

/**
 * 导出
 *
 * 真正的下载在 UserExportForm 里做 —— 范围、上限提示、截断警告都在那一屏，
 * 这里只负责把「当前查的是什么」交过去。
 */
const exportFormRef = ref()
const handleExport = () => {
  exportFormRef.value?.open({
    pageNo: queryParams.pageNo,
    pageSize: queryParams.pageSize,
    total: total.value,
    buildParams: () => ({ ...queryParams })
  })
}

/**
 * 操作列按钮清单。四个按钮不折叠（折叠成「三个 + 更多」比四个按钮还宽），
 * 所以这一页不再有「更多」下拉，handleCommand 的 command 字符串映射也随之消失
 */
const rowButtons: TableActionButton[] = [
  {
    key: 'update',
    label: '修改',
    permission: ['system:user:update'],
    onClick: (row) => openForm('update', row.id)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['system:user:delete'],
    onClick: (row) => handleDelete(row.id)
  },
  {
    key: 'resetPwd',
    label: '重置密码',
    permission: ['system:user:update-password'],
    onClick: (row) => handleResetPwd(row)
  },
  {
    key: 'role',
    label: '分配角色',
    permission: ['system:permission:assign-user-role'],
    onClick: (row) => handleRole(row)
  }
]

/** 删除按钮操作 */
const handleDelete = async (id: number) => {
  try {
    // 删除的二次确认
    await message.delConfirm()
    // 发起删除
    await UserApi.deleteUser(id)
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/** 批量删除按钮操作 */
const checkedIds = ref<number[]>([])
const handleRowCheckboxChange = (rows: UserApi.UserVO[]) => {
  checkedIds.value = rows.map((row) => row.id)
}

const handleDeleteBatch = async () => {
  try {
    // 删除的二次确认
    await message.delConfirm()
    // 发起批量删除
    await UserApi.deleteUserList(checkedIds.value)
    checkedIds.value = []
    message.success(t('common.delSuccess'))
    // 刷新列表
    await getList()
  } catch {}
}

/** 重置密码 */
const handleResetPwd = async (row: UserApi.UserVO) => {
  try {
    // 重置的二次确认
    const result = await message.prompt(
      '请输入"' + row.username + '"的新密码',
      t('common.reminder')
    )
    const password = result.value
    // 发起重置
    await UserApi.resetUserPassword(row.id, password)
    message.success('修改成功，新密码是：' + password)
  } catch {}
}

/** 分配角色 */
const assignRoleFormRef = ref()
const handleRole = (row: UserApi.UserVO) => {
  assignRoleFormRef.value.open(row)
}

/** 初始化 */
onMounted(() => {
  getList()
})
</script>
