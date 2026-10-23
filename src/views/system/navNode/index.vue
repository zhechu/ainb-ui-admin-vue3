<template>
  <!-- 搜索工作栏 -->
  <ContentWrap>
    <el-form
      ref="queryFormRef"
      :inline="true"
      :model="queryParams"
      class="-mb-15px"
      label-width="68px"
    >
      <el-form-item label="节点名称" prop="name">
        <el-input
          v-model="queryParams.name"
          class="!w-240px"
          clearable
          placeholder="请输入节点名称"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="节点类型" prop="nodeType">
        <el-select
          v-model="queryParams.nodeType"
          class="!w-240px"
          clearable
          placeholder="请选择节点类型"
        >
          <el-option
            v-for="opt in NAV_NODE_TYPE_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select
          v-model="queryParams.status"
          class="!w-240px"
          clearable
          placeholder="请选择状态"
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
        <el-button @click="handleQuery">
          <Icon class="mr-5px" icon="ep:search" />
          搜索
        </el-button>
        <el-button @click="resetQuery">
          <Icon class="mr-5px" icon="ep:refresh" />
          重置
        </el-button>
        <el-button
          v-hasPermi="['system:nav-node:create']"
          plain
          type="primary"
          @click="openForm('create')"
        >
          <Icon class="mr-5px" icon="ep:plus" />
          新增
        </el-button>
        <el-button plain type="danger" @click="toggleExpandAll">
          <Icon class="mr-5px" icon="ep:sort" />
          展开/折叠
        </el-button>
        <el-button
          v-hasPermi="['system:nav-node:delete']"
          :disabled="checkedIds.length === 0"
          plain
          type="danger"
          @click="handleDeleteBatch"
        >
          <Icon class="mr-5px" icon="ep:delete" />
          批量删除{{ checkedIds.length ? `（${checkedIds.length}）` : '' }}
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-alert :closable="false" class="mb-15px" type="info">
      <template #title>
        配置「移动端 App」工作台导航树：分组 ▸ 子分组 ▸ 导航项。导航项通过「权限标识」关联共享权限目录——留空表示所有登录用户可见，选择后仅拥有其中任一权限的用户可见（服务端按登录用户过滤后下发）。
      </template>
    </el-alert>
    <el-table
      v-if="refreshTable"
      v-loading="loading"
      :data="list"
      :default-expand-all="isExpandAll"
      class="xpy-list-table"
      row-key="id"
      @selection-change="handleRowCheckboxChange"
    >
      <el-table-column type="selection" width="55" />
      <el-table-column :min-width="220" label="名称" prop="name" show-overflow-tooltip />
      <el-table-column align="center" label="类型" prop="nodeType" width="90">
        <template #default="scope">
          <el-tag :type="navNodeTypeTag(scope.row.nodeType)">
            {{ navNodeTypeLabel(scope.row.nodeType) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :min-width="220" label="页面路径" prop="route" show-overflow-tooltip>
        <template #default="scope">
          {{ scope.row.route || '-' }}
        </template>
      </el-table-column>
      <el-table-column :min-width="200" label="权限标识" prop="permissions" show-overflow-tooltip>
        <template #default="scope">
          <span v-if="scope.row.permissions">{{ scope.row.permissions }}</span>
          <span v-else class="text-12px text-gray-400">无门槛（登录即可见）</span>
        </template>
      </el-table-column>
      <el-table-column align="center" label="排序" prop="sort" width="70" />
      <el-table-column align="center" label="显示" prop="visible" width="80">
        <template #default="scope">
          <el-tag :type="scope.row.visible ? 'success' : 'info'">
            {{ scope.row.visible ? '显示' : '隐藏' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column align="center" label="状态" prop="status" width="90">
        <template #default="scope">
          <StatusSwitch
            :loading="statusLoadingId === scope.row.id"
            :model-value="scope.row.status === CommonStatusEnum.ENABLE"
            :permission="['system:nav-node:update']"
            @change="(next) => handleUpdateStatus(scope.row, next)"
          />
        </template>
      </el-table-column>
      <el-table-column align="center" fixed="right" label="操作" width="200">
        <template #default="scope">
          <TableActions :buttons="rowButtons" :row="scope.row" />
        </template>
      </el-table-column>
    </el-table>
  </ContentWrap>

  <!-- 表单弹窗：添加/修改 -->
  <NavNodeForm ref="formRef" @success="getList" />
</template>
<script lang="ts" setup>
import type { TableActionButton } from '@/components/TableActions'
import * as NavNodeApi from '@/api/system/navNode'
import { CommonStatusEnum } from '@/utils/constants'
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { handleTree } from '@/utils/tree'
import NavNodeForm from './NavNodeForm.vue'
import { NAV_NODE_TYPE, NAV_NODE_TYPE_OPTIONS, NAV_TERMINAL, navNodeTypeLabel, navNodeTypeTag } from './constants'

defineOptions({ name: 'SystemNavNode' })

const message = useMessage() // 消息弹窗
const { t } = useI18n() // 国际化

const loading = ref(true) // 列表加载中
const list = ref<any[]>([]) // 树形列表数据
const queryParams = reactive({
  terminal: NAV_TERMINAL,
  name: undefined,
  nodeType: undefined,
  status: undefined
})
const queryFormRef = ref() // 搜索表单
const isExpandAll = ref(true) // 是否展开，默认全部展开
const refreshTable = ref(true) // 重新渲染表格状态

/** 批量选中的节点编号 */
const checkedIds = ref<number[]>([])

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await NavNodeApi.getNavNodeList(queryParams)
    list.value = handleTree(data)
    // 刷新后清空勾选，避免残留旧编号在批量删除时误删
    checkedIds.value = []
  } finally {
    loading.value = false
  }
}

/** 展开/折叠操作 */
const toggleExpandAll = () => {
  refreshTable.value = false
  isExpandAll.value = !isExpandAll.value
  nextTick(() => {
    refreshTable.value = true
  })
}

/** 搜索按钮操作 */
const handleQuery = () => {
  getList()
}

/** 重置按钮操作 */
const resetQuery = () => {
  queryFormRef.value.resetFields()
  queryParams.terminal = NAV_TERMINAL // resetFields 会清掉 terminal，补回
  handleQuery()
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, id?: number, parentId?: number) => {
  formRef.value.open(type, id, parentId)
}

/** 状态快捷开关：整行提交（row 来自 /list，含全部必填字段） */
const statusLoadingId = ref<number | null>(null)
const handleUpdateStatus = async (row: any, next: boolean) => {
  statusLoadingId.value = row.id
  try {
    await NavNodeApi.updateNavNode({
      ...row,
      status: next ? CommonStatusEnum.ENABLE : CommonStatusEnum.DISABLE
    })
    message.success(next ? '已启用' : '已停用')
    await getList()
  } finally {
    statusLoadingId.value = null
  }
}

/** 删除按钮操作 */
const handleDelete = async (id: number) => {
  try {
    await message.delConfirm()
    await NavNodeApi.deleteNavNode(id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

/** 批量选择变更 */
const handleRowCheckboxChange = (rows: NavNodeApi.NavNodeVO[]) => {
  checkedIds.value = rows.map((row) => row.id)
}

/** 批量删除按钮操作 */
const handleDeleteBatch = async () => {
  if (checkedIds.value.length === 0) {
    return
  }
  try {
    await message.delConfirm(`确定删除选中的 ${checkedIds.value.length} 个节点吗？`)
    await NavNodeApi.deleteNavNodeList(checkedIds.value)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

/** 行操作按钮 */
const rowButtons: TableActionButton[] = [
  {
    key: 'update',
    label: '修改',
    permission: ['system:nav-node:update'],
    onClick: (row) => openForm('update', row.id)
  },
  {
    key: 'create',
    label: '新增下级',
    permission: ['system:nav-node:create'],
    // 导航项是叶子，不允许再挂子节点（与移动端三层渲染一致）
    show: (row) => row.nodeType !== NAV_NODE_TYPE.ITEM,
    onClick: (row) => openForm('create', undefined, row.id)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['system:nav-node:delete'],
    onClick: (row) => handleDelete(row.id)
  }
]

/** 初始化 **/
onMounted(() => {
  getList()
})
</script>
