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
      <span class="ml-auto text-12px text-gray-400">资源授权</span>
    </div>

    <!-- 搜索工作栏 -->
    <el-form :inline="true" :model="queryParams" class="-mb-15px" label-width="68px">
      <el-form-item label="动作" prop="action">
        <el-select v-model="queryParams.action" class="!w-200px" clearable placeholder="全部">
          <el-option
            v-for="a in GRANT_ACTION_OPTIONS"
            :key="a.value"
            :label="a.label"
            :value="a.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="效果" prop="effect">
        <el-select v-model="queryParams.effect" class="!w-160px" clearable placeholder="全部">
          <el-option label="允许 ALLOW" value="ALLOW" />
          <el-option label="拒绝 DENY" value="DENY" />
        </el-select>
      </el-form-item>
      <el-form-item label="资源名称" prop="resourceName">
        <el-input
          v-model="queryParams.resourceName"
          class="!w-160px"
          clearable
          placeholder="模糊搜索"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="权限标识" prop="resourcePermission">
        <el-input
          v-model="queryParams.resourcePermission"
          class="!w-180px"
          clearable
          placeholder="如 system:user"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="到期时间" prop="expireTime">
        <el-date-picker
          v-model="queryParams.expireTime"
          :default-time="[new Date(2000, 0, 1, 0, 0, 0), new Date(2000, 0, 1, 23, 59, 59)]"
          class="!w-240px"
          type="daterange"
          start-placeholder="到期日起"
          end-placeholder="到期日止"
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
          v-hasPermi="['system:grant:create']"
          :disabled="!roleId"
          plain
          type="primary"
          @click="openForm('create')"
        >
          <Icon class="mr-5px" icon="ep:plus" />
          新增授权
        </el-button>
        <el-button
          v-hasPermi="['system:grant:create']"
          :disabled="!roleId"
          plain
          type="primary"
          @click="openBatchForm"
        >
          <Icon class="mr-5px" icon="ep:copy-document" />
          批量授权
        </el-button>
        <el-button
          v-hasPermi="['system:grant:delete']"
          :disabled="!checkedIds.length"
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

  <ContentWrap>
    <el-empty
      v-if="!roleId"
      description="缺少角色参数，请从角色管理页的「资源授权」进入"
      :image-size="80"
    />
    <template v-else>
      <el-table
        v-loading="loading"
        :data="list"
        class="xpy-list-table"
        stripe
        @selection-change="handleSelectionChange"
      >
        <!--
          ⚠️ 刻意不加 row-key / reserve-selection：翻页或搜索重载即重置勾选。
          跨页攒住用户已经看不见的 id，正是批量删除最危险的输入
        -->
        <el-table-column type="selection" width="46" align="center" />
        <el-table-column
          label="序号"
          type="index"
          width="44"
          align="center"
          class-name="col-index"
          label-class-name="col-index"
          :index="indexMethod(queryParams)"
        />
        <el-table-column label="资源名称" min-width="160" show-overflow-tooltip>
          <template #default="scope">
            <span v-if="scope.row.resourceName">{{ scope.row.resourceName }}</span>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column
          label="权限标识"
          prop="resourcePermission"
          min-width="180"
          show-overflow-tooltip
        >
          <template #default="scope">
            <span v-if="scope.row.resourcePermission">{{ scope.row.resourcePermission }}</span>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column align="center" label="动作" prop="action" width="120">
          <template #default="scope">
            <el-tag size="small" :type="scope.row.action === '*' ? 'warning' : 'info'">
              {{ formatGrantAction(scope.row.action) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column align="center" label="效果" prop="effect" width="90">
          <template #default="scope">
            <el-tag size="small" :type="scope.row.effect === 'ALLOW' ? 'success' : 'danger'">
              {{ scope.row.effect === 'ALLOW' ? '允许' : '拒绝' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="行过滤规则" min-width="140" show-overflow-tooltip>
          <template #default="scope">
            <span v-if="scope.row.ruleName">{{ scope.row.ruleName }}</span>
            <span v-else class="text-gray-400">不受限（全部行）</span>
          </template>
        </el-table-column>
        <el-table-column align="center" label="字段模式" width="100">
          <template #default="scope">
            <el-tag
              v-if="scope.row.fieldMode"
              size="small"
              :type="fieldModeTagType(scope.row.fieldMode) as any"
            >
              {{ fieldModeLabel(scope.row.fieldMode) }}
            </el-tag>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column align="center" label="到期时间" width="170">
          <template #default="scope">
            <span v-if="scope.row.expireTime">{{ formatDate(scope.row.expireTime) }}</span>
            <span v-else class="text-gray-400">永不过期</span>
          </template>
        </el-table-column>
        <el-table-column align="center" label="状态" width="90">
          <template #default="scope">
            <el-tag size="small" :type="scope.row.expired ? 'danger' : 'success'">
              {{ scope.row.expired ? '已过期' : '生效中' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column align="center" fixed="right" label="操作" width="120">
          <template #default="scope">
            <el-button
              v-hasPermi="['system:grant:update']"
              link
              type="primary"
              @click="openForm('update', scope.row)"
            >
              编辑
            </el-button>
            <el-button
              v-hasPermi="['system:grant:delete']"
              link
              type="danger"
              @click="handleDelete(scope.row.id)"
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
    </template>
  </ContentWrap>

  <!-- 新增/编辑授权弹窗 -->
  <GrantForm ref="formRef" @success="getList" />
  <!-- 批量授权弹窗：资源多选 × 动作多选，提交笛卡尔积 -->
  <GrantBatchForm ref="batchFormRef" @success="getList" />
</template>
<script lang="ts" setup>
import { formatDate } from '@/utils/formatTime'
import * as GrantApi from '@/api/system/grant'
import type { GrantVO } from '@/api/system/grant'
import * as RoleApi from '@/api/system/role'
import { GRANT_ACTION_OPTIONS, formatGrantAction } from '@/views/system/resource/constants'
import GrantForm from './GrantForm.vue'
import GrantBatchForm from './GrantBatchForm.vue'

defineOptions({ name: 'SystemRoleGrantPage' })

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
    // 角色不存在（被删了或 id 是编的）：保持空态，列表接口自然查不到数据
    role.value = undefined
  }
}

const loading = ref(false)
const list = ref<GrantVO[]>([])
const total = ref(0)
/**
 * 勾选的行 id。
 *
 * ⚠️ 不用 reserve-selection，也不跨页保留：翻页/搜索重载后行对象全换一批，
 * 攥着上一批已经不在视图里的 id 去批量删除，是最难事后追查的一类误删
 */
const checkedIds = ref<number[]>([])
const handleSelectionChange = (rows: GrantVO[]) => {
  checkedIds.value = rows.map((row) => row.id)
}
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  action: undefined as string | undefined,
  effect: undefined as string | undefined,
  resourceName: undefined as string | undefined,
  resourcePermission: undefined as string | undefined,
  expireTime: [] as string[]
})

/** 查询授权列表（走后端分页接口，避免全量拉取卡死页面） */
const getList = async () => {
  // 表格重载后行对象全换一批，先把上一批的勾选扔掉（理由见 checkedIds 的注释）
  checkedIds.value = []
  if (!roleId.value) {
    list.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const data = await GrantApi.getGrantPage({
      pageNo: queryParams.pageNo,
      pageSize: queryParams.pageSize,
      subjectType: 'ROLE',
      subjectRefId: roleId.value,
      action: queryParams.action,
      effect: queryParams.effect,
      resourceName: queryParams.resourceName,
      resourcePermission: queryParams.resourcePermission,
      expireTime: queryParams.expireTime?.length ? queryParams.expireTime : undefined
    })
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
  queryParams.action = undefined
  queryParams.effect = undefined
  queryParams.resourceName = undefined
  queryParams.resourcePermission = undefined
  queryParams.expireTime = []
  handleQuery()
}

/** 新增/编辑授权 */
const formRef = ref()
const openForm = (type: 'create' | 'update', row?: GrantVO) => {
  formRef.value.open(type, roleId.value, row)
}

/** 批量授权 */
const batchFormRef = ref()
const openBatchForm = () => {
  batchFormRef.value.open(roleId.value)
}

/** 删除授权行 */
const handleDelete = async (id: number) => {
  try {
    await message.confirm('确认删除该授权行？删除后立即生效。')
  } catch {
    return
  }
  await GrantApi.deleteGrant(id)
  message.success('删除成功')
  // 当前页只剩这一条时往前翻一页，否则会停在一个空页上
  if (list.value.length === 1 && queryParams.pageNo > 1) {
    queryParams.pageNo--
  }
  await getList()
}

/**
 * 批量删除授权行。
 *
 * 后端是**全有或全无**：勾里的 id 只要有一个已不存在（另一个管理员刚删掉、
 * 或另一个标签页操作过），整批都不删并报错 —— 静默部分成功会让操作者以为整批都删了。
 * 所以这里失败时不清空勾选，让人看清是哪一批没删掉
 */
const handleDeleteBatch = async () => {
  const ids = [...checkedIds.value]
  if (!ids.length) return
  try {
    await message.delConfirm(
      `确认删除勾选的 ${ids.length} 条授权？删除后立即生效，该角色将立刻失去对应权限。`
    )
  } catch {
    return
  }
  await GrantApi.deleteGrantList(ids)
  message.success(`已删除 ${ids.length} 条授权`)
  checkedIds.value = []
  // 本页被删空时往前翻一页。单条删除那个 `length === 1` 就是本条件的特例；
  // 勾选不跨页，删掉的条数至多等于本页行数，回退一页必然落在有数据的页上
  if (ids.length >= list.value.length && queryParams.pageNo > 1) {
    queryParams.pageNo--
  }
  await getList()
}

const fieldModeLabel = (mode: string) => {
  return { EDITABLE: '可编辑', READONLY: '只读', HIDDEN: '隐藏' }[mode] ?? mode
}
const fieldModeTagType = (mode: string) => {
  return { EDITABLE: 'success', READONLY: 'warning', HIDDEN: 'danger' }[mode] ?? ''
}

const handleBack = () => {
  // 直接进来（无历史记录）时 back() 会没反应，兜底跳回角色管理
  if (window.history.state?.back) {
    router.back()
  } else {
    router.push({ path: '/system/org-permission/role' })
  }
}

/** 初始化 */
onMounted(async () => {
  await loadRole()
  await getList()
})
</script>
