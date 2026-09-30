<!--
  Agent 工具管理（AI助手 问题2 + 2026-09-28 内置工具在线维护 + 2026-09-29 改页内面板 & 自定义工具改绑数据接口）

  两个 tab：
  · 内置工具（默认）：@AgentTool 代码工具。执行体与默认值在代码里、不可新建/删除，但「运维旋钮」
    （展示名/说明/分组/风险/权限/启用/参数说明）可在线维护，改完【立即生效、无需重启】，按【当前租户】生效。
    「恢复默认」= 删覆盖行、退回代码声明。接口不分页，故按关键字/分组过滤后在前端分页。
  · 自定义工具：「无 Java 代码」的工具，本质是**数据接口的 AI 包装层**，落 agent_tool_def，服务端分页。

  🔴 新增/编辑一律【页内面板】而非弹窗：字段多（自定义工具还要展示所绑接口的入参定义），
     弹窗里得滚动，管理员看不见上下文，这正是低代码子系统「配了但配错且不自知」的温床。
     面板与列表是同级的条件渲染，URL 不变、不加路由。

  权限（与后端 AgentToolDefController @PreAuthorize 逐字一致）：
     内置读 = agent:tool-def:query，内置维护/恢复 = agent:tool-def:update；
     自定义读 = :query，新增 = :create，编辑 = :update，删除 = :delete。
     按钮权限行 + 角色授权见 sql/mysql/xpy-2026-09-28-agent-tool-def-menu.sql（super_admin 绕过一切权限点）。

  🔴 与 MCP 的关系：本页的工具**不走 MCP 协议**，是平台自建的进程内工具注册表
     （@AgentTool 声明 + AgentToolRegistry 收集 + AgentSecurityGateway 逐次鉴权），
     由 AgentToolExecutor 直接调用 Java 方法，没有跨进程的 JSON-RPC 往返。
     好处是权限、风险等级、Plan 确认能一处管住；代价是外部 MCP Server 的工具进不来。
     （这段背景原先写在页面顶部提示语里，2026-09-29 按体验要求删掉了提示语，说明留在注释里。）
-->
<template>
  <!-- ==================== 列表 ==================== -->
  <template v-if="viewMode === 'list'">
    <el-tabs v-model="activeTab" class="agent-tooldef-tabs">
      <!-- ==================== 内置工具 ==================== -->
      <el-tab-pane label="内置工具" name="builtin">
        <ContentWrap>
          <el-form class="-mb-15px" :inline="true" label-width="68px">
            <el-form-item label="关键字">
              <el-input
                v-model="builtinKeyword"
                placeholder="工具名 / 展示名 / 说明"
                clearable
                class="!w-240px"
              />
            </el-form-item>
            <el-form-item label="分组">
              <el-select
                v-model="builtinGroup"
                placeholder="全部"
                clearable
                filterable
                class="!w-160px"
              >
                <el-option v-for="g in builtinGroupOptions" :key="g" :label="g" :value="g" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="builtinEnabled" placeholder="全部" clearable class="!w-160px">
                <el-option label="启用" :value="true" />
                <el-option label="停用" :value="false" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button @click="getBuiltinList">
                <Icon icon="ep:refresh" class="mr-5px" />
                刷新
              </el-button>
            </el-form-item>
          </el-form>
        </ContentWrap>

        <ContentWrap>
          <el-table
            class="xpy-list-table"
            stripe
            v-loading="builtinLoading"
            :data="builtinPageList"
          >
            <el-table-column
              label="序号"
              type="index"
              align="center"
              width="70"
              :index="indexMethod(builtinPageQuery)"
            />
            <el-table-column label="展示名" align="center" prop="displayName" min-width="150" show-overflow-tooltip />
            <el-table-column label="工具名" align="center" prop="toolName" min-width="180" show-overflow-tooltip />
            <el-table-column label="分组" align="center" prop="groupName" min-width="100" show-overflow-tooltip>
              <template #default="scope">
                <el-tag v-if="scope.row.groupName" size="small" type="info">{{ scope.row.groupName }}</el-tag>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column label="风险等级" align="center" prop="riskLevel" width="110">
              <template #default="scope">
                <el-tag :type="riskTagType(scope.row.riskLevel)" size="small">
                  {{ riskLabel(scope.row.riskLevel) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="所需权限" align="center" prop="permissions" min-width="180" show-overflow-tooltip>
              <template #default="scope">{{ scope.row.permissions || '登录即可' }}</template>
            </el-table-column>
            <el-table-column label="状态" align="center" prop="enabled" width="90">
              <template #default="scope">
                <el-tag :type="scope.row.enabled ? 'success' : 'info'" size="small">
                  {{ scope.row.enabled ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="维护" align="center" width="90">
              <template #default="scope">
                <el-tag v-if="scope.row.overridden" type="warning" size="small">维护中</el-tag>
                <span v-else class="text-12px text-[var(--el-text-color-placeholder)]">默认</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" align="center" min-width="160" fixed="right">
              <template #default="scope">
                <el-button
                  link
                  type="primary"
                  @click="openBuiltinForm(scope.row)"
                  v-hasPermi="['agent:tool-def:update']"
                >
                  维护
                </el-button>
                <el-button
                  v-if="scope.row.overridden"
                  link
                  type="warning"
                  @click="handleReset(scope.row)"
                  v-hasPermi="['agent:tool-def:update']"
                >
                  恢复默认
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <Pagination
            :total="filteredBuiltinList.length"
            v-model:page="builtinPageNo"
            v-model:limit="builtinPageSize"
          />
        </ContentWrap>
      </el-tab-pane>

      <!-- ==================== 自定义工具 ==================== -->
      <el-tab-pane label="自定义工具" name="custom">
        <!-- 搜索 -->
        <ContentWrap>
          <el-form class="-mb-15px" :model="queryParams" ref="queryFormRef" :inline="true" label-width="68px">
            <el-form-item label="工具键" prop="toolKey">
              <el-input
                v-model="queryParams.toolKey"
                placeholder="请输入工具键"
                clearable
                @keyup.enter="handleQuery"
                class="!w-240px"
              />
            </el-form-item>
            <el-form-item label="分组" prop="groupName">
              <el-input
                v-model="queryParams.groupName"
                placeholder="请输入分组"
                clearable
                @keyup.enter="handleQuery"
                class="!w-240px"
              />
            </el-form-item>
            <el-form-item label="状态" prop="enabled">
              <el-select v-model="queryParams.enabled" placeholder="请选择状态" clearable class="!w-240px">
                <el-option label="启用" :value="true" />
                <el-option label="停用" :value="false" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button @click="handleQuery">
                <Icon icon="ep:search" class="mr-5px" />
                搜索
              </el-button>
              <el-button @click="resetQuery">
                <Icon icon="ep:refresh" class="mr-5px" />
                重置
              </el-button>
              <el-button type="primary" plain @click="openForm()" v-hasPermi="['agent:tool-def:create']">
                <Icon icon="ep:plus" class="mr-5px" /> 新增
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
              align="center"
              width="70"
              :index="indexMethod(queryParams)"
            />
            <el-table-column label="工具键" align="center" prop="toolKey" min-width="160" show-overflow-tooltip />
            <el-table-column label="展示名" align="center" prop="displayName" min-width="140" show-overflow-tooltip />
            <el-table-column label="关联数据接口" align="center" min-width="180" show-overflow-tooltip>
              <template #default="scope">
                <span v-if="interfaceCodeOf(scope.row)">{{ interfaceCodeOf(scope.row) }}</span>
                <span v-else class="text-[var(--el-text-color-placeholder)]">—</span>
              </template>
            </el-table-column>
            <el-table-column label="执行方式" align="center" width="110">
              <template #default="scope">
                <el-tag :type="interfaceModeOf(scope.row) === 'INVOKE' ? 'danger' : 'success'" size="small">
                  {{ interfaceModeOf(scope.row) === 'INVOKE' ? '全能力执行' : '只读查询' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="分组" align="center" prop="groupName" min-width="110" show-overflow-tooltip>
              <template #default="scope">
                <el-tag v-if="scope.row.groupName" size="small" type="info">{{ scope.row.groupName }}</el-tag>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column label="风险等级" align="center" prop="riskLevel" width="120">
              <template #default="scope">
                <el-tag :type="riskTagType(scope.row.riskLevel)" size="small">
                  {{ riskLabel(scope.row.riskLevel) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" align="center" prop="enabled" width="90">
              <template #default="scope">
                <el-tag :type="scope.row.enabled ? 'success' : 'info'" size="small">
                  {{ scope.row.enabled ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column
              label="创建时间"
              align="center"
              prop="createTime"
              width="180"
              :formatter="dateFormatter"
            />
            <el-table-column label="操作" align="center" min-width="200" fixed="right">
              <template #default="scope">
                <el-button link type="primary" @click="openForm(scope.row, 'view')" v-hasPermi="['agent:tool-def:query']">
                  查看
                </el-button>
                <el-button link type="primary" @click="openForm(scope.row, 'edit')" v-hasPermi="['agent:tool-def:update']">
                  编辑
                </el-button>
                <el-button link type="danger" @click="handleDelete(scope.row)" v-hasPermi="['agent:tool-def:delete']">
                  删除
                </el-button>
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
      </el-tab-pane>
    </el-tabs>
  </template>

  <!-- ==================== 页内面板（与列表同级，切 viewMode 换视图） ==================== -->
  <BuiltinToolForm
    v-else-if="viewMode === 'builtin'"
    ref="builtinFormRef"
    @success="onBuiltinSaved"
    @cancel="backToList"
  />
  <ToolDefForm
    v-else-if="viewMode === 'custom'"
    ref="formRef"
    @success="onCustomSaved"
    @cancel="backToList"
  />
</template>

<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import {
  AgentToolDefApi,
  AgentRegisteredToolApi,
  type AgentToolDefVO,
  type AgentRegisteredToolVO
} from '@/api/agent/tooldef'
import ToolDefForm from './components/ToolDefForm.vue'
import BuiltinToolForm from './components/BuiltinToolForm.vue'
import { riskTagType } from '@/views/agent/workflow/nameCatalog'

defineOptions({ name: 'AgentToolDef' })

const message = useMessage()

/** 页内视图：list=列表，builtin=内置工具维护面板，custom=自定义工具新增/编辑/查看面板 */
const viewMode = ref<'list' | 'builtin' | 'custom'>('list')
const activeTab = ref<'builtin' | 'custom'>('builtin')

/** 风险等级本地 map（无数据字典）。与后端 RiskLevel 枚举一致 */
const RISK_OPTIONS = [
  { value: 'READ_ONLY', label: '只读' },
  { value: 'LOW', label: '低风险' },
  { value: 'MEDIUM', label: '中风险' },
  { value: 'HIGH', label: '高风险' },
  { value: 'IRREVERSIBLE', label: '不可逆' }
]
const riskLabel = (risk: string) => RISK_OPTIONS.find((r) => r.value === risk)?.label ?? risk
// 🔴 riskTagType 不在本页定义：权威副本在 workflow/nameCatalog.ts（画布下拉的风险色点、config/index.vue 都吃它）。
// 这里原本存着一份逐字等价的 if 链，漏改的表现是「同一风险等级两个页面不同色」，
// 更坏的是未知等级静默回落成灰 info —— 灰在本模块的语义是「只读/安全」。

/** config 只有 {code,mode}，解析失败就当作没绑（旧数据里的 HTTP config 会走到这一支，显示 —） */
const parseConfig = (row: AgentToolDefVO): { code?: string; mode?: string } => {
  try {
    const cfg = row.config ? JSON.parse(row.config) : {}
    return typeof cfg === 'object' && cfg !== null ? cfg : {}
  } catch {
    return {}
  }
}
const interfaceCodeOf = (row: AgentToolDefVO) => parseConfig(row).code ?? ''
const interfaceModeOf = (row: AgentToolDefVO) => (parseConfig(row).mode ?? 'QUERY').toUpperCase()

// ==================== 内置工具 ====================
const builtinLoading = ref(false)
const builtinList = ref<AgentRegisteredToolVO[]>([])
const builtinKeyword = ref('')
const builtinGroup = ref('')
const builtinEnabled = ref<boolean | undefined>(undefined)
const builtinFormRef = ref()
const builtinPageNo = ref(1)
const builtinPageSize = ref(20)

/** 分组下拉从实际数据里取，避免写死一份跟代码声明漂移的清单 */
const builtinGroupOptions = computed(() =>
  [...new Set(builtinList.value.map((row) => row.groupName).filter((g): g is string => !!g))].sort()
)

const filteredBuiltinList = computed(() => {
  const kw = builtinKeyword.value.trim().toLowerCase()
  return builtinList.value.filter((row) => {
    if (builtinEnabled.value !== undefined && row.enabled !== builtinEnabled.value) return false
    if (builtinGroup.value && row.groupName !== builtinGroup.value) return false
    if (!kw) return true
    return (
      row.toolName.toLowerCase().includes(kw) ||
      (row.displayName ?? '').toLowerCase().includes(kw) ||
      (row.description ?? '').toLowerCase().includes(kw)
    )
  })
})

/** 接口不分页（一次返回全部工具），故过滤后在前端切片 */
const builtinPageList = computed(() => {
  const start = (builtinPageNo.value - 1) * builtinPageSize.value
  return filteredBuiltinList.value.slice(start, start + builtinPageSize.value)
})

/** 给序号列的 indexMethod 用：它只认 {pageNo,pageSize} 这个形状 */
const builtinPageQuery = computed(() => ({
  pageNo: builtinPageNo.value,
  pageSize: builtinPageSize.value
}))

// 过滤条件一变，页码要退回第 1 页，否则停在空白页上像是「数据没了」
watch([builtinKeyword, builtinGroup, builtinEnabled], () => {
  builtinPageNo.value = 1
})

const getBuiltinList = async () => {
  builtinLoading.value = true
  try {
    builtinList.value = await AgentRegisteredToolApi.getRegisteredToolList()
  } finally {
    builtinLoading.value = false
  }
}

const handleReset = async (row: AgentRegisteredToolVO) => {
  try {
    await message.confirm(
      `确认将「${row.displayName || row.toolName}」恢复为代码默认？当前的在线维护（风险/权限/启用等覆盖）将被清除。`
    )
    await AgentRegisteredToolApi.resetRegisteredTool(row.toolName)
    message.success('已恢复默认')
    await getBuiltinList()
  } catch {}
}

// ==================== 自定义工具 ====================
const loading = ref(true)
const total = ref(0)
const list = ref<AgentToolDefVO[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  toolKey: undefined,
  groupName: undefined,
  enabled: undefined
})
const queryFormRef = ref()
const formRef = ref()

const getList = async () => {
  loading.value = true
  try {
    const data = await AgentToolDefApi.getToolDefPage(queryParams)
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
  queryFormRef.value.resetFields()
  handleQuery()
}

const handleDelete = async (row: AgentToolDefVO) => {
  try {
    await message.delConfirm(`确认删除工具「${row.displayName || row.toolKey}」？删除后不可恢复。`)
    await AgentToolDefApi.deleteToolDef(row.id)
    message.success('删除成功')
    await getList()
  } catch {}
}

/**
 * 打开页内面板
 * 面板是 v-else-if 条件渲染的，切完 viewMode 要等 nextTick 让组件挂载后才能拿到 ref 调 open()
 */
const openBuiltinForm = async (row: AgentRegisteredToolVO) => {
  viewMode.value = 'builtin'
  await nextTick()
  builtinFormRef.value?.open(row)
}

const openForm = async (row?: AgentToolDefVO, m?: 'view' | 'edit') => {
  viewMode.value = 'custom'
  await nextTick()
  formRef.value?.open(row?.id, m)
}

/** 保存成功：回列表并刷新对应 tab（写成两个具名函数，别在模板里 @success="f(g)"——那会被编译成内联语句） */
const onBuiltinSaved = async () => {
  viewMode.value = 'list'
  await getBuiltinList()
}
const onCustomSaved = async () => {
  viewMode.value = 'list'
  await getList()
}
/** 返回：只回列表，不强制刷新（没改过东西就别白发一次请求） */
const backToList = () => {
  viewMode.value = 'list'
}

onMounted(() => {
  getBuiltinList()
  getList()
})

// 页面被 keep-alive 缓存时 onMounted 不重跑，故 onActivated 兜底刷新。首次激活跳过，避免与 onMounted 重复请求。
let firstActivated = true
onActivated(() => {
  if (firstActivated) {
    firstActivated = false
    return
  }
  // 从面板态被激活时不回列表：用户可能只是切走又切回来，强行退回会丢掉填了一半的表单
  if (viewMode.value === 'list') {
    getBuiltinList()
    getList()
  }
})
</script>

<style lang="scss" scoped>
.agent-tooldef-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 16px;
  }
}
</style>
