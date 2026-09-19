<template>
  <ContentWrap>
    <!-- 角色信息 + 返回 -->
    <div class="mb-12px flex items-center gap-8px">
      <el-button @click="handleBack">
        <Icon class="mr-5px" icon="ep:back" />
        返回
      </el-button>
      <template v-if="role">
        <span class="text-16px font-bold">{{ role.name }}</span>
        <span class="text-12px text-gray-400">{{ role.code }}</span>
      </template>
      <span v-else class="text-14px text-gray-400">未指定角色</span>
      <span class="ml-auto text-12px text-gray-400">成员配置</span>
    </div>

    <!-- 搜索工作栏 -->
    <el-form :inline="true" :model="queryParams" class="-mb-15px" label-width="68px">
      <el-form-item label="账号" prop="username">
        <el-input
          v-model="queryParams.username"
          class="!w-220px"
          clearable
          placeholder="按用户账号搜索"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="部门" prop="deptId">
        <el-tree-select
          v-model="queryParams.deptId"
          :data="deptTree"
          :props="defaultProps"
          check-strictly
          clearable
          class="!w-220px"
          placeholder="按部门筛选"
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
          v-hasPermi="['system:permission:assign-user-role']"
          :disabled="!roleId"
          plain
          type="primary"
          @click="openAddForm"
        >
          <Icon class="mr-5px" icon="ep:plus" />
          添加成员
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap>
    <el-empty
      v-if="!roleId"
      description="缺少角色参数，请从角色管理页的「成员」按钮进入"
      :image-size="80"
    />
    <template v-else>
      <el-table v-loading="loading" :data="list" class="xpy-list-table" stripe>
        <el-table-column
          label="序号"
          type="index"
          width="44"
          align="center"
          class-name="col-index"
          label-class-name="col-index"
          :index="indexMethod(queryParams)"
        />
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
        <el-table-column
          align="center"
          label="创建时间"
          prop="createTime"
          width="170"
          :formatter="dateFormatter"
        />
        <el-table-column align="center" fixed="right" label="操作" width="100">
          <template #default="scope">
            <el-button
              v-hasPermi="['system:permission:assign-user-role']"
              link
              type="danger"
              :loading="removingId === scope.row.id"
              @click="handleRemove(scope.row)"
            >
              移除
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
    </template>
  </ContentWrap>

  <!--
    添加成员 Dialog。
    ⚠️ 必须与页面主内容平级而不是塞进 ContentWrap 内部：EP 的 teleport 会把遮罩
    挂到最近的定位祖先，嵌进 ContentWrap 会导致遮罩只盖住卡片而不是全屏
  -->
  <MemberAddForm ref="addFormRef" @success="getList" />
</template>
<script lang="ts" setup>
import { DICT_TYPE } from '@/utils/dict'
import { dateFormatter } from '@/utils/formatTime'
import { defaultProps, handleTree } from '@/utils/tree'
import * as UserApi from '@/api/system/user'
import * as RoleApi from '@/api/system/role'
import * as DeptApi from '@/api/system/dept'
import * as PermissionApi from '@/api/system/permission'
import MemberAddForm from './MemberAddForm.vue'

defineOptions({ name: 'SystemRoleMemberPage' })

const message = useMessage()
const route = useRoute()
const router = useRouter()

/** 角色编号从路由 query 取；非法/缺失时页面显示空态而不是崩溃 */
const roleId = computed(() => {
  const raw = Number(route.query.roleId)
  return Number.isFinite(raw) && raw > 0 ? raw : undefined
})

const role = ref<RoleApi.RoleVO>()
const loadRole = async () => {
  if (!roleId.value) {
    role.value = undefined
    return
  }
  try {
    role.value = await RoleApi.getRole(roleId.value)
  } catch {
    // 角色被删或 id 是编的：保持空态，成员接口自然查不到数据
    role.value = undefined
  }
}

const loading = ref(false)
const list = ref<UserApi.UserVO[]>([])
const total = ref(0)
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  username: '',
  deptId: undefined as number | undefined,
  roleId: undefined as number | undefined
})

// -------- 部门树（页面生命周期内只拉一次） --------
const deptTree = ref<DeptApi.DeptVO[]>([])
const loadDeptTree = async () => {
  const data = await DeptApi.getSimpleDeptList()
  deptTree.value = handleTree(data, 'id', 'parentId')
}

/** 走 UserPageReqVO.roleId 后端原生分页；不用再自己算集合 */
const getList = async () => {
  if (!roleId.value) {
    list.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    queryParams.roleId = roleId.value
    const data = await UserApi.getUserPage(queryParams)
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
  queryParams.username = ''
  queryParams.deptId = undefined
  handleQuery()
}

// -------- 移除成员 --------
// ⚠️ assignUserRole 是【全量覆盖】：必须先取用户现有角色，过滤掉当前角色再提交，
// 直接把 [roleId] 传上去会把用户的其他角色全部抹掉

const removingId = ref<number>()
const handleRemove = async (row: UserApi.UserVO) => {
  try {
    await message.confirm(`确认将用户「${row.nickname || row.username}」移出该角色？`)
  } catch {
    return
  }
  removingId.value = row.id
  try {
    const roleIds: number[] = await PermissionApi.getUserRoleList(row.id)
    await PermissionApi.assignUserRole({
      userId: row.id,
      roleIds: roleIds.filter((id) => id !== roleId.value)
    })
    message.success('移除成功')
    // 当前页只剩这一条时往前翻一页，否则会停在一个空页上
    if (list.value.length === 1 && queryParams.pageNo > 1) {
      queryParams.pageNo--
    }
    await getList()
  } finally {
    removingId.value = undefined
  }
}

// -------- 添加成员 --------

const addFormRef = ref()
const openAddForm = () => {
  addFormRef.value.open(roleId.value)
}

const handleBack = () => {
  // 直接进来（无历史记录）时 back() 会没反应，兜底跳回角色管理
  if (window.history.state?.back) {
    router.back()
  } else {
    router.push({ path: '/system/org-permission/role' })
  }
}

onMounted(async () => {
  await Promise.all([loadRole(), loadDeptTree()])
  await getList()
})
</script>
