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
      <!--
        🔴 智能查看模式下**整组查询条件都要藏起来**，不是只藏表格。

        这五个条件是 getGrantPage 的**服务端**筛选参数，而树形走的是另一个端点
        （getEffectiveTree）、一次拿回整棵剪好合并好的树，既没有分页也没有这些筛选项。
        留着它们，操作者填完点不了、或者以为填了就筛了 —— 两种都比藏起来更坏。
        参照 DictDataTable.vue 里 `<Pagination v-if="!treeEnabled">` 及其注释
        「树形下拿到的是完整一棵树，没有分页的概念」
      -->
      <template v-if="viewMode === 'list'">
        <!--
          🔴 「权限标识」刻意排在第一位，别按「常用度」把它挪回后面去。

          两个抽屉都是非模态穿透的（见 GrantForm.vue 模板顶部注释），开着的时候这一栏是能点的 ——
          一边配授权一边回头查「这个权限标识已经授过什么」正是穿透要交付的东西。
          而这一栏是按 inline 从左往右排的：排在第四位时它落在 x≈1133~1313（1920px 视口），
          任何合理宽度的抽屉都盖得住它，穿透就等于白做；排在第一位它落在 x≈245~493，
          连拖到下限 760px 的抽屉都盖不住。

          顺序本身也站得住：权限标识（system:user 这种全串）是这五个条件里**最精确**的一个，
          精确条件排在模糊条件（资源名称）前面是常见口径
        -->
        <el-form-item label="权限标识" prop="resourcePermission">
          <el-input
            v-model="queryParams.resourcePermission"
            class="!w-180px"
            clearable
            placeholder="如 system:user"
            @keyup.enter="handleQuery"
          />
        </el-form-item>
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
      </template>
      <el-form-item>
        <template v-if="viewMode === 'list'">
          <el-button @click="handleQuery">
            <Icon class="mr-5px" icon="ep:search" />
            搜索
          </el-button>
          <el-button @click="resetQuery">
            <Icon class="mr-5px" icon="ep:refresh" />
            重置
          </el-button>
        </template>
        <!--
          🔴 切换按钮**两种模式下都必须在**，且位置固定在「重置」之后、「新增授权」之前
          （用户原话「在【新增授权】按钮前面」）。树形模式下搜索表单整组被藏起来，
          这一栏只剩它和后面两个写按钮 —— 藏了它就没人能切回列表
        -->
        <el-button :disabled="!roleId" plain type="primary" @click="toggleViewMode">
          <Icon class="mr-5px" :icon="viewMode === 'list' ? 'ep:share' : 'ep:list'" />
          {{ viewMode === 'list' ? '切换智能查看' : '切换编辑列表' }}
        </el-button>
        <!--
          🔴 下面这几个写按钮（外加列表表格里的「编辑」「删除」）在抽屉开着期间必须禁用。

          两个抽屉都是非模态穿透的，所以抽屉开着的时候这一栏与表格**是可以点的** ——
          这正是穿透要交付的能力。但可点不等于点什么都安全：
          「新增授权」「批量授权」「编辑」都会调 open() 重填同一个抽屉实例，
          于是把操作者正在填的内容**静默替换**掉（批量抽屉里那可能是几百个已勾资源
          加上一整套「保留 / 覆盖」选择）；「删除」「批量删除」则会在授权进行中删掉授权行。
          🔴 这条理由在树形模式下一字不差地同样适用，所以那两个写按钮的 :disabled 原样带着 drawerOpen。

          🔴 反过来，**搜索、重置、五个查询条件、翻页、行首勾选框、切换按钮、
          树里的展开箭头与两个显示开关一个都不许禁** ——
          一边配授权一边回头看这一页，就是穿透存在的全部理由，把它们一起禁掉等于把功能退回遮罩模式。
          勾选框留着也无害：批量删除已经禁用，而抽屉提交成功后 handleGrantSuccess() 里的
          getList() 会自然清掉勾选
        -->
        <!--
          🔴 【新增授权】【批量授权】**两种模式下都必须在**，别因为它们原先躲在 v-if="list"
          里就以为树形模式不该有（上一轮就是这么错的，本轮是把它改回来）。

          权限地图的价值恰恰在于「看出缺什么，然后就地补上」：
          看着树发现某个子树整片没权限，就该能当场点开抽屉配掉，
          而不是先切回列表、配完再切回来。而抽屉是非模态穿透的，配的时候这棵树还看得见 ——
          树的「资源名称」列是 fixed: LEFT，右侧滑出的抽屉盖不住它，
          所以「一边看地图一边配授权」是真的能一边看一边配。

          ⚠️ 【批量删除】不一样，它**只属于列表模式**，理由见下面那个 template 前的注释

          🔴 这两个按钮是**常驻**的（两种模式下都在），所以它们的权限判据用 v-hasPermi 指令是安全的 ——
          指令已经改成「打标记 + CSS display:none」，不再把节点从 DOM 里摘掉。
          改之前这里被迫写成 v-if="canCreate"：老实现摘了节点却不动 vnode 树，
          常驻按钮因此变成游离的 insertBefore 锚点，切换视图时 Vue 直接抛 NotFoundError
          （实测无 system:grant:create 的账号切两次视图 = 29 条 JS 错误，超管 0 条）。
          完整理由与实测数据在 directives/permission/hasPermi.ts，别在这里重抄一遍再漂移
        -->
        <el-button
          v-hasPermi="['system:grant:create']"
          :disabled="!roleId || drawerOpen"
          plain
          type="primary"
          @click="openForm('create')"
        >
          <Icon class="mr-5px" icon="ep:plus" />
          新增授权
        </el-button>
        <el-button
          v-hasPermi="['system:grant:create']"
          :disabled="!roleId || drawerOpen"
          plain
          type="primary"
          @click="openBatchForm"
        >
          <Icon class="mr-5px" icon="ep:copy-document" />
          批量授权
        </el-button>
        <!--
          🔴 【批量删除】没跟着放进常驻段，不是漏了：它的 :disabled 依赖 checkedIds，
          而勾选来自 <el-table type="selection">。树形用的是 el-table-v2，
          **压根不支持 type="selection"**，而且用户明确要求树只读。
          放进树形模式就是一个永远灰着的按钮 —— 比不放更坏，
          因为它会让人以为「批量删除坏了」，而不是「这里本来就没有可勾的行」
        -->
        <template v-if="viewMode === 'list'">
          <el-button
            v-hasPermi="['system:grant:delete']"
            :disabled="!checkedIds.length || drawerOpen"
            plain
            type="danger"
            @click="handleDeleteBatch"
          >
            <Icon class="mr-5px" icon="ep:delete" />
            批量删除{{ checkedIds.length ? `（${checkedIds.length}）` : '' }}
          </el-button>
        </template>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!--
    🔴 两个视图是**两个互斥的 v-if 块、两个组件实例**，不是在同一个 <el-table> 上来回切树形 props。
    src/views/system/resource/index.vue 的脚本注释记着后者的代价：切 lazy / 树形 props 会让
    渲染器直接崩（「Page crashed」），而且**没有任何 JS 错误**，:key 强制重建也救不回来。
    智能查看用的是 el-table-v2（完全不同的组件），天然就是两个实例，风险为零
  -->
  <ContentWrap v-if="viewMode === 'list'">
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
            <!--
              🔴 三态而不是两态。原先非数据集行也显示「不受限（全部行）」，
              那是句假话 —— 菜单/按钮上压根没有「行」这个概念，行过滤是按物理表名
              反查 DATASET 资源的（见 ResourceMapper#selectListByDatasetTable）。
              现在改用后端新加的 resourceType 判，与相邻「字段模式」列的 `-` 同口径
            -->
            <span
              v-else-if="!isRowFilterableResource(scope.row.resourceType)"
              class="text-gray-400"
            >
              -
            </span>
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
            <!-- 抽屉开着时禁用，理由见上面搜索栏那三个按钮前的注释 -->
            <el-button
              v-hasPermi="['system:grant:update']"
              :disabled="drawerOpen"
              link
              type="primary"
              @click="openForm('update', scope.row)"
            >
              编辑
            </el-button>
            <el-button
              v-hasPermi="['system:grant:delete']"
              :disabled="drawerOpen"
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

  <!--
    智能查看（树形权限地图）。**树本身只读**：没有勾选列、没有操作列、没有分页，
    所以列表页那条「刻意不加 row-key / reserve-selection」的注释不受影响、继续成立，
    没有去「顺手统一」。判定全在后端 GrantDecisionEngine#explain，这里一行判定逻辑都没有。

    ⚠️ 「树只读」不等于「树形模式下不能改授权」：工具栏上的【新增授权】【批量授权】
    是**刻意留着**的 —— 用户那句「只读即可，应该做不了编辑的」针对的是树里的
    行内编辑 / 删除 / 勾选，不是「这一页不许发起授权」。地图的价值就是看出缺什么、就地补上。

    ref 是给抽屉提交成功后**就地**刷新这棵树用的，见 handleGrantSuccess
  -->
  <ContentWrap v-else>
    <GrantEffectiveTree ref="treeRef" :role-id="roleId" />
  </ContentWrap>

  <!-- 新增/编辑授权抽屉。@closed 用来解禁那几个写按钮，见上面搜索栏前的注释 -->
  <GrantForm ref="formRef" @closed="drawerOpen = false" @success="handleGrantSuccess" />
  <!-- 批量授权抽屉：资源多选 × 动作多选，提交笛卡尔积 -->
  <GrantBatchForm ref="batchFormRef" @closed="drawerOpen = false" @success="handleGrantSuccess" />
</template>
<script lang="ts" setup>
import { formatDate } from '@/utils/formatTime'
import * as GrantApi from '@/api/system/grant'
import type { GrantVO } from '@/api/system/grant'
import * as RoleApi from '@/api/system/role'
import {
  GRANT_ACTION_OPTIONS,
  fieldModeLabel,
  fieldModeTagType,
  formatGrantAction,
  isRowFilterableResource
} from '@/views/system/resource/constants'
import GrantForm from './GrantForm.vue'
import GrantBatchForm from './GrantBatchForm.vue'
import GrantEffectiveTree from './GrantEffectiveTree.vue'

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

/**
 * 列表模式（可编辑、服务端分页筛选）与智能查看（只读树形权限地图）二选一。
 *
 * 🔴 两个视图是**两个组件实例**，切换时互不干扰：列表侧的 queryParams / list / total
 * 一律原样留着，所以切回来时搜索条件与页码都还在 —— 这是「切换」而不是「重进页面」该有的样子。
 * 唯一必须清的是勾选：树形模式下 <el-table> 被 v-if 卸载，行首勾选框的视觉状态一并消失，
 * 而 checkedIds 是个普通 ref、不会跟着清 —— 攥着一批界面上已经看不见的 id，
 * 正是上面那条「刻意不加 row-key / reserve-selection」注释要防的东西
 */
const viewMode = ref<'list' | 'tree'>('list')
const toggleViewMode = () => {
  checkedIds.value = []
  viewMode.value = viewMode.value === 'list' ? 'tree' : 'list'
}

/**
 * 树形视图的句柄，只用来在抽屉提交成功后**就地**重载（见 handleGrantSuccess）。
 *
 * ⚠️ 「切换视图」这条路不需要它：树在 v-else 分支里，每次切进来都会重新挂载，
 * onMounted 自己就把数据拉新了。需要显式重载的只有「人还停在树形页、抽屉里刚存了一笔」这一种。
 *
 * 🔴 上面那句「靠重新挂载保证新鲜」是**隐式**的 —— 将来谁给这两个分支套上 <KeepAlive>
 * 或把 v-if 换成 v-show，树就会开始返回陈旧权限，而且不报任何错。
 * 所以 handleGrantSuccess 写成「两个视图都刷」，不依赖这个前提
 */
const treeRef = ref()

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

/**
 * 有没有抽屉正开着。
 *
 * 🔴 两个抽屉都是非模态穿透的，开着的时候这一页是可点的，于是「点行内编辑」会静默替换掉
 * 抽屉里正在填的内容、「点批量删除」会在授权进行中删行。这个 ref 就是用来在那期间
 * 禁掉这五个会毁数据的按钮的（新增授权 / 批量授权 / 批量删除 / 行内编辑 / 行内删除）。
 * 禁哪些、以及**为什么搜索与翻页一个都不许禁**，见模板里搜索栏前那段注释。
 *
 * 置回 false 走抽屉 emit 的 `closed`（收起动画结束）而不是 `close`（动画开始）——
 * 后者会让按钮在抽屉还盖在页面上时就活过来，点到的东西是看不见的
 */
const drawerOpen = ref(false)

/** 新增/编辑授权 */
const formRef = ref()
const openForm = (type: 'create' | 'update', row?: GrantVO) => {
  drawerOpen.value = true
  formRef.value.open(type, roleId.value, row)
}

/** 批量授权 */
const batchFormRef = ref()
const openBatchForm = () => {
  drawerOpen.value = true
  batchFormRef.value.open(roleId.value)
}

/**
 * 抽屉提交成功后**两个视图都要刷**，别只刷当前可见的那一个。
 *
 * 🔴 只刷列表（本轮之前就是 `@success="getList"`）：用户在树形页存的，
 * 眼前那棵树一动不动 —— 第一反应必然是「没存上」，于是再提交一遍。
 * 而 `/create` 是 upsert，第二遍会**静默覆盖**第一遍，
 * 用户永远不知道自己刚刚白担心了一场，也没人能从数据上看出这件事发生过。
 *
 * 🔴 只刷树也不行：切回列表会看到**存之前**那一页 —— list / queryParams 都是父组件的 ref，
 * 不会因为 v-if 重新挂载而重新拉取，而树形模式下恰恰可能刚通过抽屉改过授权。
 *
 * 两个都刷的代价只是多一次分页查询，而它恰好发生在用户刚点完保存、最不敏感的那一刻。
 * treeRef 在列表模式下是 undefined（组件被 v-if 卸载），所以 `?.` 天然就是
 * 「只刷挂载着的那棵树」，不需要再判 viewMode；getList() 则两种模式下都该跑，
 * 理由见上。两个请求互不依赖，并发发出即可
 */
const handleGrantSuccess = () => {
  getList()
  treeRef.value?.reload()
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
