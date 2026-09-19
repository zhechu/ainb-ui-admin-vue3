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

  <!--
    左右分栏：左侧角色列表，右侧常驻资源授权面板。
    配权限时几乎总要在几个角色之间来回对照（「这条 CRM 管理员有没有」），
    弹窗模式下每对照一次就要关掉再打开一个，还看不到列表
  -->
  <el-row :gutter="16" class="grant-split-row">
    <el-col :span="9" class="h-full">
      <ContentWrap class="h-full grant-split-pane">
        <el-table
          v-loading="loading"
          :data="list"
          :max-height="roleTableMaxHeight"
          highlight-current-row
          row-key="id"
          @current-change="handleCurrentRoleChange"
          @selection-change="handleRowCheckboxChange"
        >
          <el-table-column type="selection" width="45" />
          <el-table-column label="角色" min-width="160">
            <template #default="scope">
              <div class="flex items-center gap-6px">
                <span class="text-14px">{{ scope.row.name }}</span>
                <dict-tag :type="DICT_TYPE.COMMON_STATUS" :value="scope.row.status" />
              </div>
              <div class="text-11px text-gray-400">{{ scope.row.code }}</div>
            </template>
          </el-table-column>
          <el-table-column align="center" label="操作" width="110">
            <template #default="scope">
              <el-button
                v-hasPermi="['system:role:update']"
                link
                type="primary"
                @click.stop="openForm('update', scope.row.id)"
              >
                编辑
              </el-button>
              <el-button
                v-hasPermi="['system:role:delete']"
                link
                type="danger"
                @click.stop="handleDelete(scope.row.id)"
              >
                删除
              </el-button>
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
    </el-col>

    <el-col :span="15" class="h-full">
      <ContentWrap class="h-full grant-split-pane">
        <div v-if="currentRole" class="mb-12px flex items-center gap-8px">
          <span class="text-16px font-bold">{{ currentRole.name }}</span>
          <span class="text-12px text-gray-400">{{ currentRole.code }}</span>
          <span class="ml-auto text-12px text-gray-400">资源授权</span>
        </div>
        <GrantAssignPanel
          v-hasPermi="['system:grant:query']"
          subject-type="ROLE"
          :subject-ref-id="currentRole?.id"
          :name="currentRole?.name"
        />
      </ContentWrap>
    </el-col>
  </el-row>

  <!-- 表单弹窗：添加/修改 -->
  <RoleForm ref="formRef" @success="getList" />
</template>
<script lang="ts" setup>
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import download from '@/utils/download'
import * as RoleApi from '@/api/system/role'
import RoleForm from './RoleForm.vue'
import GrantAssignPanel from './components/GrantAssignPanel.vue'

defineOptions({ name: 'SystemRole' })

const message = useMessage() // 消息弹窗
const { t } = useI18n() // 国际化

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

/**
 * 左右两栏撑满剩余视口。
 * 原来两个 ContentWrap 高度各自由内容撑开，右侧面板内容多、左侧只有几行角色，
 * 结果页面底部留出一大片空白，而表格反而挤在一个小框里滚
 */
const roleTableMaxHeight = ref(420)
const recalcRoleTableHeight = () => {
  roleTableMaxHeight.value = Math.max(240, window.innerHeight - 330)
}
onMounted(() => {
  recalcRoleTableHeight()
  window.addEventListener('resize', recalcRoleTableHeight)
})
onUnmounted(() => window.removeEventListener('resize', recalcRoleTableHeight))

/** 左侧选中的角色，右侧面板跟着它走 */
const currentRole = ref<RoleApi.RoleVO | undefined>()
const handleCurrentRoleChange = (row?: RoleApi.RoleVO) => {
  // el-table 在数据刷新时会用 null 触发一次 current-change，
  // 直接赋值会让右侧面板在每次查询后闪回空态
  if (row) currentRole.value = row
}

/** 删除按钮操作 */
const handleDelete = async (id: number) => {
  try {
    // 删除的二次确认
    await message.delConfirm()
    // 发起删除
    await RoleApi.deleteRole(id)
    message.success(t('common.delSuccess'))
    // 删掉的正是右侧正在看的那个角色时，把面板清空，否则会停在一个已不存在的角色上
    if (currentRole.value?.id === id) currentRole.value = undefined
    // 刷新列表
    await getList()
  } catch {}
}

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
    if (currentRole.value && checkedIds.value.includes(currentRole.value.id)) {
      currentRole.value = undefined
    }
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

<style lang="scss" scoped>
/* 两栏等高：左栏内容再少也和右栏一样高，底部不留空白 */
.grant-split-row {
  display: flex;
  align-items: stretch;
  min-height: calc(100vh - 250px);
}

.grant-split-pane {
  display: flex;
  flex-direction: column;
  height: 100%;

  :deep(.el-card__body) {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
}
</style>
