<template>
  <Dialog v-model="dialogVisible" class="role-member-add-dialog" title="添加成员" width="960px">
    <div class="mb-12px flex flex-wrap items-center gap-8px">
      <el-input
        v-model="queryParams.username"
        class="!w-200px"
        clearable
        placeholder="按用户账号搜索"
        @keyup.enter="handleQuery"
      />
      <el-tree-select
        v-model="queryParams.deptId"
        :data="deptTree"
        :props="defaultProps"
        check-strictly
        clearable
        class="!w-220px"
        placeholder="按部门筛选"
      />
      <el-button @click="handleQuery">
        <Icon class="mr-5px" icon="ep:search" />
        搜索
      </el-button>
      <el-button @click="resetQuery">
        <Icon class="mr-5px" icon="ep:refresh" />
        重置
      </el-button>
      <span class="ml-auto text-12px text-gray-400">已是该角色成员的用户不可勾选</span>
    </div>

    <!--
      ⚠️ overflow-hidden 是必须的：Pagination 组件自带 float-right，
      不建 BFC 的话浮动会溢出到 Dialog footer 区域，造成分页栏和底部按钮错位/重叠
    -->
    <div class="overflow-hidden">
      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="list"
        class="xpy-list-table"
        stripe
        max-height="420"
        row-key="id"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="45" :selectable="isUserSelectable" reserve-selection />
        <el-table-column label="用户编号" prop="id" width="100" />
        <el-table-column label="用户账号" prop="username" min-width="140" show-overflow-tooltip />
        <el-table-column label="用户昵称" prop="nickname" min-width="140" show-overflow-tooltip />
        <el-table-column label="部门" prop="deptName" min-width="140" show-overflow-tooltip>
          <template #default="scope">
            <span v-if="scope.row.deptName">{{ scope.row.deptName }}</span>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column align="center" label="状态" prop="status" width="100">
          <template #default="scope">
            <dict-tag :type="DICT_TYPE.COMMON_STATUS" :value="scope.row.status" />
          </template>
        </el-table-column>
      </el-table>
      <Pagination
        v-model:limit="queryParams.pageSize"
        v-model:page="queryParams.pageNo"
        :total="total"
        @pagination="getList"
      />
    </div>

    <template #footer>
      <!-- Dialog 的 footer slot 默认左对齐，这里显式右对齐 -->
      <div class="text-right">
        <el-button @click="dialogVisible = false">取 消</el-button>
        <el-button
          :disabled="selection.length === 0"
          :loading="saving"
          type="primary"
          @click="submit"
        >
          添加（已选 {{ selection.length }} 人）
        </el-button>
      </div>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { DICT_TYPE } from '@/utils/dict'
import { defaultProps, handleTree } from '@/utils/tree'
import * as UserApi from '@/api/system/user'
import * as DeptApi from '@/api/system/dept'
import * as PermissionApi from '@/api/system/permission'

defineOptions({ name: 'SystemRoleMemberAddForm' })

const message = useMessage()

const dialogVisible = ref(false)
const roleId = ref<number>()

const open = async (id: number) => {
  roleId.value = id
  dialogVisible.value = true
  queryParams.pageNo = 1
  queryParams.username = ''
  queryParams.deptId = undefined
  selection.value = []
  tableRef.value?.clearSelection()
  await Promise.all([loadDeptTree(), getList()])
}
defineExpose({ open })

const emit = defineEmits<{ success: [] }>()

// -------- 部门树（与主体无关，弹窗生命周期内只拉一次） --------
const deptTree = ref<DeptApi.DeptVO[]>([])
const deptLoaded = ref(false)
const loadDeptTree = async () => {
  if (deptLoaded.value) return
  const data = await DeptApi.getSimpleDeptList()
  deptTree.value = handleTree(data, 'id', 'parentId')
  deptLoaded.value = true
}

const loading = ref(false)
const saving = ref(false)
const tableRef = ref()
const list = ref<UserApi.UserVO[]>([])
const total = ref(0)
const queryParams = reactive({
  pageNo: 1,
  pageSize: 10,
  username: '',
  deptId: undefined as number | undefined
})
const selection = ref<UserApi.UserVO[]>([])
/** 已是当前角色成员的用户 id，用于禁选 */
const memberIds = ref<Set<number>>(new Set())

/**
 * 拉全部用户（可按 username/deptId 过滤）+ 当前角色的成员集合。
 * 成员集合一次拉 100 条，角色成员撑死几百个基本够用；
 * 真的超了也只是禁选失效——submit 里会去重，不会产生脏数据
 */
const getList = async () => {
  if (!roleId.value) return
  loading.value = true
  try {
    const [pageData, roleMembers] = await Promise.all([
      UserApi.getUserPage(queryParams),
      UserApi.getUserPage({ pageNo: 1, pageSize: 100, roleId: roleId.value })
    ])
    list.value = pageData.list
    total.value = pageData.total
    memberIds.value = new Set(roleMembers.list.map((u: UserApi.UserVO) => u.id))
  } finally {
    loading.value = false
  }
}

const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}

const resetQuery = () => {
  queryParams.username = ''
  queryParams.deptId = undefined
  handleQuery()
}

const isUserSelectable = (row: UserApi.UserVO) => !memberIds.value.has(row.id)

const handleSelectionChange = (rows: UserApi.UserVO[]) => {
  selection.value = rows
}

const submit = async () => {
  if (!roleId.value || selection.value.length === 0) return
  saving.value = true
  try {
    // ⚠️ assignUserRole 是【全量覆盖】：每个用户先取现有角色，追加当前角色后再提交，
    // 直接传 [roleId] 会把用户的其他角色全部抹掉
    await Promise.all(
      selection.value.map(async (user) => {
        const roleIds: number[] = await PermissionApi.getUserRoleList(user.id)
        if (roleIds.includes(roleId.value!)) return
        await PermissionApi.assignUserRole({
          userId: user.id,
          roleIds: [...roleIds, roleId.value!]
        })
      })
    )
    message.success('添加成功')
    dialogVisible.value = false
    selection.value = []
    tableRef.value?.clearSelection()
    emit('success')
  } finally {
    saving.value = false
  }
}
</script>

<style lang="scss">
/*
  弹窗必须整体落在视口内，footer（取消 / 添加）才能常驻底部右下角。
  现状有两个坑：
  1) Dialog.vue 里 `.com-dialog .el-dialog { margin:0!important }` 与对
     `.el-overlay-dialog` 的 flex 居中都是「后代选择器」，但 com-dialog / 自定义
     class 实际落在 .el-dialog 元素自身，选择器永远不命中 → EP 默认的
     margin-top(约15vh) 生效，弹窗被往下顶；
  2) 表格 max-height 固定 420，header+body+footer 叠加后在小视口超出屏幕，
     footer 被顶到屏幕外，不滚动根本点不到。
  这里把 .el-dialog 变成限高的 flex 列：header/footer 固定、body 伸缩并内部滚动，
  总高不超过 100vh-40px，footer 稳定可见。
  用全局样式而非 scoped：Dialog 被 teleport 到 body，scoped 的 :deep 够不到。
*/
.role-member-add-dialog.el-dialog {
  margin-top: 20px !important; // 覆盖 EP 的 ~15vh 顶部定位，改由限高保证不溢出
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;

  .#{$elNamespace}-dialog__body {
    flex: 1 1 auto;
    min-height: 0; // 允许在 flex 列里收缩，否则内容会撑破 max-height
    overflow-y: auto;
  }

  // footer 默认无右内边距，按钮会贴死对话框右边框，补上留白
  .#{$elNamespace}-dialog__footer {
    flex: 0 0 auto;
    padding: 12px 20px;
  }
}
</style>
