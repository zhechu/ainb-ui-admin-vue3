<!--
  Agent 工具管理（AI助手 问题2 + 2026-09-28 增量：内置工具放出来在线维护）

  两个 tab：
  · 内置工具（默认）：22 个 @AgentTool 代码工具。执行体与默认值在代码里、不可新建/删除，但「运维旋钮」
    （展示名/说明/分组/风险/权限/启用/参数说明）可在线维护，改完【立即生效、无需重启】，按【当前租户】生效。
    「恢复默认」= 删覆盖行、退回代码声明。前端过滤、不分页（规模=工具数）。
  · 自定义工具：「无 Java 代码」的 HTTP 工具（本期），落 agent_tool_def，列表/分页/新建/编辑/删除。

  权限（与后端 AgentToolDefController @PreAuthorize 逐字一致）：
     内置读 = agent:tool-def:query，内置维护/恢复 = agent:tool-def:update；
     自定义读 = :query，新增 = :create，编辑 = :update，删除 = :delete。
     按钮权限行 + 角色授权见 sql/mysql/xpy-2026-09-28-agent-tool-def-menu.sql（super_admin 绕过一切权限点）。
  🔴 自定义工具凭据脱敏：后端 get/page 返回的 config 里 bearerToken/basicPassword/apiKeyValue 已替换成掩码 `******`，
     编辑弹窗会把等于掩码的凭据清空并提示「已配置（留空则不修改）」，提交时省略该键，由后端回填旧值。
-->
<template>
  <el-tabs v-model="activeTab" class="agent-tooldef-tabs">
    <!-- ==================== 内置工具 ==================== -->
    <el-tab-pane label="内置工具" name="builtin">
      <ContentWrap>
        <el-form class="-mb-15px" :inline="true" label-width="68px">
          <el-form-item label="关键字">
            <el-input
              v-model="builtinKeyword"
              placeholder="工具名 / 展示名"
              clearable
              class="!w-240px"
            />
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
        <el-table class="xpy-list-table" stripe v-loading="builtinLoading" :data="filteredBuiltinList">
          <el-table-column label="工具名" align="center" prop="toolName" min-width="180" show-overflow-tooltip />
          <el-table-column label="展示名" align="center" prop="displayName" min-width="130" show-overflow-tooltip />
          <el-table-column label="分组" align="center" prop="groupName" min-width="100" show-overflow-tooltip>
            <template #default="scope">{{ scope.row.groupName || '—' }}</template>
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
          <el-table-column label="实现类" align="center" prop="implClassName" min-width="220" show-overflow-tooltip>
            <template #default="scope">{{ shortClassName(scope.row.implClassName) }}</template>
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
              <Icon icon="ep:plus" class="mr-5px" /> 新增工具
            </el-button>
          </el-form-item>
        </el-form>
      </ContentWrap>

      <!-- 列表 -->
      <ContentWrap>
        <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
          <el-table-column label="编号" align="center" prop="id" width="80" />
          <el-table-column label="工具键" align="center" prop="toolKey" min-width="160" show-overflow-tooltip />
          <el-table-column label="展示名" align="center" prop="displayName" min-width="140" show-overflow-tooltip />
          <el-table-column label="分组" align="center" prop="groupName" min-width="110" show-overflow-tooltip />
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

  <!-- 自定义工具 新增/编辑/查看弹窗 -->
  <ToolDefFormDialog ref="formRef" @success="getList" />
  <!-- 内置工具 维护弹窗 -->
  <BuiltinToolFormDialog ref="builtinFormRef" @success="getBuiltinList" />
</template>

<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import {
  AgentToolDefApi,
  AgentRegisteredToolApi,
  type AgentToolDefVO,
  type AgentRegisteredToolVO
} from '@/api/agent/tooldef'
import ToolDefFormDialog from './components/ToolDefFormDialog.vue'
import BuiltinToolFormDialog from './components/BuiltinToolFormDialog.vue'

defineOptions({ name: 'AgentToolDef' })

const message = useMessage()

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
const riskTagType = (risk: string): 'info' | 'success' | 'warning' | 'danger' => {
  if (risk === 'READ_ONLY') return 'success'
  if (risk === 'LOW') return 'info'
  if (risk === 'MEDIUM') return 'warning'
  if (risk === 'HIGH' || risk === 'IRREVERSIBLE') return 'danger'
  return 'info'
}
/** 实现类全名 → 简单类名（表格太窄，全名放不下） */
const shortClassName = (fqcn?: string) => (fqcn ? fqcn.substring(fqcn.lastIndexOf('.') + 1) : '—')

// ==================== 内置工具 ====================
const builtinLoading = ref(false)
const builtinList = ref<AgentRegisteredToolVO[]>([])
const builtinKeyword = ref('')
const builtinEnabled = ref<boolean | undefined>(undefined)
const builtinFormRef = ref()

const filteredBuiltinList = computed(() => {
  const kw = builtinKeyword.value.trim().toLowerCase()
  return builtinList.value.filter((row) => {
    if (builtinEnabled.value !== undefined && row.enabled !== builtinEnabled.value) return false
    if (!kw) return true
    return (
      row.toolName.toLowerCase().includes(kw) || (row.displayName ?? '').toLowerCase().includes(kw)
    )
  })
})

const getBuiltinList = async () => {
  builtinLoading.value = true
  try {
    builtinList.value = await AgentRegisteredToolApi.getRegisteredToolList()
  } finally {
    builtinLoading.value = false
  }
}

const openBuiltinForm = (row: AgentRegisteredToolVO) => {
  builtinFormRef.value.open(row)
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

const openForm = (row?: AgentToolDefVO, mode?: 'view' | 'edit') => {
  formRef.value.open(row?.id, mode)
}

const handleDelete = async (row: AgentToolDefVO) => {
  try {
    await message.delConfirm(`确认删除工具「${row.displayName || row.toolKey}」？删除后不可恢复。`)
    await AgentToolDefApi.deleteToolDef(row.id)
    message.success('删除成功')
    await getList()
  } catch {}
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
  getBuiltinList()
  getList()
})
</script>

<style lang="scss" scoped>
.agent-tooldef-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 16px;
  }
}
</style>
