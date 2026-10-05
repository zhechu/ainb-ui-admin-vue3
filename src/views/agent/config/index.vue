<!--
  AI 助手管理员配置：总开关、配额、工具清单（**本页只读**）

  🔴 本页的工具清单只读，但「内置工具不可在线维护」这个说法**已经不成立了**（2026-09-28 起）：
     维护入口在「工具目录 → 内置工具」页（views/agent/tooldef），落 agent_tool_override 覆盖行、
     按当前租户生效。本页保留只读，是因为它答的是另一个问题 ——「助手整体开没开、配额多少、
     当前有哪些工具」，不是「逐个工具怎么调」。

  🔴 本页这里曾写过：「工具的权限串与风险等级属于实现的一部分，让它可被运行时改写等于把安全约束
     交给数据。把 datamodel_create 的风险等级在界面上改成「低风险」，它就不再需要用户确认了。」
     —— 【那半句已经不成立，别照着它推理】。迭代三之后运行期各道闸（只读校验、发布判定、
     agent_loop 只读限制、沙箱 mock、Planner 工具目录、变更清单）读的**全是代码【声明】的风险等级
     （getDeclaredRisk()）**，一行在线维护改不动它们；改风险等级只改**界面上的标注**
     （台账 D4-22）。真被改得动的是**启用开关与权限串** —— 安全网关读的正是这两个覆盖后的值。

  🔴 因此现在的防线不是「不可改写」，而是三条（迭代四 §8.1 / §11 A-Ⅲ：保留 + 审计 + 二次确认）：
     ① 运行期闸只读声明值，覆盖数据碰不到安全判定；② 放松（降风险/删权限）必须二次确认，
     并在 agent_tool_override_audit 落一行（操作人 + 前后值 + 理由）；③ 后端 AgentArchitectureTest
     扫源码钉住 ①，谁把闸改回读生效值就先撞红那条测试。
     ① 只覆盖**风险**；删权限是真放松，靠 ② 兜。
-->
<template>
  <!-- 总开关 -->
  <ContentWrap title="总开关">
    <el-form label-width="120px">
      <el-form-item label="启用 AI 助手">
        <el-switch
          v-model="config.enabled"
          :disabled="!hasUpdatePermi"
          @change="handleToggle"
        />
        <span class="ml-12px text-14px color-#909399">
          {{ config.enabled ? '助手已开启，用户可以在「智能助手」页面使用' : '助手已关闭，所有提问会被拒绝' }}
        </span>
      </el-form-item>
      <el-form-item label="开启缘由">
        <el-input
          v-model="config.remark"
          type="textarea"
          :rows="2"
          :disabled="!hasUpdatePermi"
          maxlength="500"
          show-word-limit
          placeholder="记录为什么开、开给谁用 —— 助手能改库里的表和流程，这个问题需要能回答"
          style="max-width: 560px"
        />
      </el-form-item>
      <el-form-item v-if="hasUpdatePermi">
        <el-button type="primary" @click="handleSaveConfig">保存</el-button>
        <span v-if="config.updateTime" class="ml-12px text-13px color-#909399">
          上次修改：{{ formatDate(config.updateTime) }}
          <template v-if="config.updater">（操作人 {{ config.updater }}）</template>
        </span>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 配额 -->
  <ContentWrap title="用量配额" v-hasPermi="['agent:quota:query']">
    <el-alert type="info" :closable="false" class="mb-12px" show-icon>
      <template #title>
        没有配置配额 = 不限制（但仍然全量计量）。删除一条配额，该维度就恢复为不限制。
        达到上限后<b>只拒绝新的提问，不会中断进行中的对话</b>。
      </template>
    </el-alert>

    <el-button
      v-hasPermi="['agent:quota:update']"
      type="primary"
      plain
      class="mb-12px"
      @click="openQuotaForm()"
    >
      新增配额
    </el-button>

    <el-table :data="quotas" v-loading="quotaLoading" stripe>
      <el-table-column label="范围" min-width="180">
        <template #default="{ row }">
          <el-tag v-if="scopeOf(row) === 'TENANT'" type="warning">整个租户</el-tag>
          <span v-else-if="scopeOf(row) === 'USER'">用户 {{ row.userId }}</span>
          <span v-else-if="scopeOf(row) === 'AGENT'">Agent：{{ row.targetKey }}</span>
          <span v-else>工作流：{{ row.targetKey }}</span>
        </template>
      </el-table-column>
      <el-table-column label="周期" width="90">
        <template #default="{ row }">{{ row.period === 'DAY' ? '每天' : '每月' }}</template>
      </el-table-column>
      <el-table-column label="token 上限" width="140" align="right">
        <template #default="{ row }">{{ row.tokenLimit ?? '不限' }}</template>
      </el-table-column>
      <el-table-column label="金额上限（元）" width="140" align="right">
        <template #default="{ row }">
          <!-- 🔴 工作流维度只支持 token（节点 trace 无金额、不改计费语义），金额对它不适用 -->
          <span v-if="scopeOf(row) === 'WORKFLOW'" class="color-#c0c4cc">不适用</span>
          <span v-else>{{ row.costLimit ?? '不限' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="预警线" width="100" align="right">
        <template #default="{ row }">{{ (row.warnRatio * 100).toFixed(0) }}%</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <!-- ⚠️ 0 是开启、1 是关闭，与直觉相反 -->
          <el-tag :type="row.status === 0 ? 'success' : 'info'">
            {{ row.status === 0 ? '生效中' : '已停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" v-if="hasQuotaUpdatePermi">
        <template #default="{ row }">
          <el-button link type="primary" @click="openQuotaForm(row)">编辑</el-button>
          <el-button link type="danger" @click="handleDeleteQuota(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </ContentWrap>

  <!-- 工具清单（只读） -->
  <ContentWrap title="已注册的工具">
    <el-alert type="warning" :closable="false" class="mb-12px" show-icon>
      <template #title>
        工具清单是<b>只读</b>的，不能在线开关。工具的权限串与风险等级属于实现的一部分 ——
        能在界面上把「不可逆」改成「低风险」的话，它就不再需要用户确认了。
        要下线某个工具，改代码并发布，这样留得下痕迹。
      </template>
    </el-alert>
    <el-table :data="tools" v-loading="toolLoading" stripe max-height="460">
      <!-- 🔴 展示名排在第一列（重构 S1 / L1）：后端一直在下发 displayName，只是前端没声明这个字段、
           于是这一屏 30 行全是下划线英文，找工具只能靠肉眼扫。分组列同理（groupName 本轮才开始下发）。 -->
      <el-table-column label="展示名" prop="displayName" width="160" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.displayName || row.name }}
        </template>
      </el-table-column>
      <el-table-column label="工具" prop="name" width="220" />
      <el-table-column label="分组" prop="groupName" width="110" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.groupName">{{ row.groupName }}</span>
          <span v-else class="text-[var(--el-text-color-placeholder)]">未分组</span>
        </template>
      </el-table-column>
      <el-table-column label="风险" width="110">
        <template #default="{ row }">
          <el-tag :type="riskTagType(row.risk)">{{ row.riskDescription }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="需确认" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.requireConfirm" type="danger" size="small">要确认</el-tag>
          <el-tag v-else type="success" size="small">可直接跑</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="需要的权限" min-width="240">
        <template #default="{ row }">
          <el-tag v-for="p in row.permissions" :key="p" class="mr-4px" size="small">{{ p }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="说明" prop="description" min-width="320" show-overflow-tooltip />
    </el-table>
  </ContentWrap>

  <!-- 配额编辑弹窗 -->
  <Dialog v-model="quotaFormVisible" :title="quotaForm.id ? '编辑配额' : '新增配额'" width="520px">
    <el-form :model="quotaForm" label-width="120px">
      <el-form-item label="范围">
        <el-radio-group v-model="quotaScope" @change="handleScopeChange">
          <el-radio value="TENANT">整个租户</el-radio>
          <el-radio value="USER">指定用户</el-radio>
          <el-radio value="AGENT">指定 Agent</el-radio>
          <el-radio value="WORKFLOW">指定工作流</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="quotaScope === 'USER'" label="用户编号">
        <el-input-number v-model="quotaForm.userId" :min="1" controls-position="right" />
      </el-form-item>
      <el-form-item v-if="quotaScope === 'AGENT'" label="选择 Agent">
        <el-select
          v-model="quotaForm.targetKey"
          filterable
          placeholder="按名称/编码筛选"
          style="width: 100%"
        >
          <el-option v-for="a in agentOptions" :key="a.code" :label="a.label" :value="a.code" />
        </el-select>
        <span class="ml-8px text-13px color-#909399">
          绑定的是 Agent 的<b>编码</b>（跨版本稳定），该 Agent 的所有版本用量都计入这条配额
        </span>
      </el-form-item>
      <el-form-item v-if="quotaScope === 'WORKFLOW'" label="选择工作流">
        <el-select
          v-model="quotaForm.targetKey"
          filterable
          placeholder="按名称/编码筛选"
          style="width: 100%"
        >
          <el-option v-for="w in workflowOptions" :key="w.code" :label="w.label" :value="w.code" />
        </el-select>
        <span class="ml-8px text-13px color-#909399">
          绑定的是工作流的<b>编码</b>（跨版本稳定），该工作流的所有版本用量都计入这条配额
        </span>
      </el-form-item>
      <el-form-item label="周期">
        <el-radio-group v-model="quotaForm.period">
          <el-radio value="MONTH">每月</el-radio>
          <el-radio value="DAY">每天</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="token 上限">
        <el-input-number v-model="quotaForm.tokenLimit" :min="0" :step="10000" controls-position="right" />
        <span class="ml-8px text-13px color-#909399">留空表示该维度不限</span>
      </el-form-item>
      <el-form-item label="金额上限（元）">
        <el-input-number
          v-model="quotaForm.costLimit"
          :min="0"
          :precision="2"
          :disabled="quotaScope === 'WORKFLOW'"
          controls-position="right"
        />
        <span v-if="quotaScope === 'WORKFLOW'" class="ml-8px text-13px color-#909399">
          工作流维度只支持 token 上限（节点用量不记金额）
        </span>
      </el-form-item>
      <el-form-item label="预警线">
        <el-input-number
          v-model="warnPercent"
          :min="1"
          :max="100"
          controls-position="right"
        />
        <span class="ml-8px text-13px color-#909399">% —— 达到后通知租户联系人，每周期只发一次</span>
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="quotaForm.status">
          <el-radio :value="0">生效中</el-radio>
          <el-radio :value="1">已停用</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button type="primary" @click="handleSaveQuota">确 定</el-button>
      <el-button @click="quotaFormVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { formatDate } from '@/utils/formatTime'
import { checkPermi } from '@/utils/permission'
import * as ConfigApi from '@/api/agent/config'
import type { AgentQuotaVO } from '@/api/agent/config'
import { AgentDefApi } from '@/api/agent/def'
import { AgentWorkflowApi } from '@/api/agent/workflow'
// 🔴 风险色不在这儿定义：`riskTagType` 的权威副本在 workflow/nameCatalog.ts（画布下拉的风险色点也用它）。
// 本页与 tooldef/index.vue 曾各存一份一模一样的映射，漏改任何一份的表现是「同一风险等级两个页面不同色」，
// 而更坏的一种是**未知等级静默回落成灰色 info**——灰在本模块的语义就是「只读/安全」。
import { riskTagType } from '@/views/agent/workflow/nameCatalog'

defineOptions({ name: 'AgentConfig' })

const message = useMessage()
const hasUpdatePermi = computed(() => checkPermi(['agent:config:update']))
const hasQuotaUpdatePermi = computed(() => checkPermi(['agent:quota:update']))

const config = ref<ConfigApi.AgentConfigVO>({
  enabled: false,
  remark: '',
  configured: false
})
const tools = ref<ConfigApi.AgentToolVO[]>([])
const quotas = ref<AgentQuotaVO[]>([])
const toolLoading = ref(false)
const quotaLoading = ref(false)

const quotaFormVisible = ref(false)
const quotaForm = ref<AgentQuotaVO>(emptyQuota())
const quotaScope = ref<'TENANT' | 'USER' | 'AGENT' | 'WORKFLOW'>('TENANT')
/** 界面上用百分比，接口用小数 —— 让管理员填 0.8 太容易填成 80 */
const warnPercent = ref(80)
/** 可绑定的 Agent / 工作流下拉选项（去重后 code 唯一），进入页面时加载一次 */
const agentOptions = ref<{ code: string; label: string }[]>([])
const workflowOptions = ref<{ code: string; label: string }[]>([])

function emptyQuota(): AgentQuotaVO {
  return { period: 'MONTH', warnRatio: 0.8, status: 0 }
}

/**
 * 一行配额的范围判别：优先看后端权威的 dimension；
 * 老数据（增量前落的行）没有 dimension，按 userId 是否为空回落 TENANT/USER。
 */
function scopeOf(row: AgentQuotaVO): 'TENANT' | 'USER' | 'AGENT' | 'WORKFLOW' {
  return row.dimension ?? (row.userId == null ? 'TENANT' : 'USER')
}

/** 开关只在点「保存」时才真正提交，避免误触就把助手关了 */
const handleToggle = () => {
  if (!config.value.enabled) {
    message.warning('关闭后所有提问都会被拒绝，点「保存」后生效')
  }
}

const handleSaveConfig = async () => {
  await ConfigApi.updateAgentConfig({
    enabled: config.value.enabled,
    remark: config.value.remark
  })
  message.success('已保存')
  await loadConfig()
}

const openQuotaForm = (row?: AgentQuotaVO) => {
  quotaForm.value = row ? { ...row } : emptyQuota()
  quotaScope.value = scopeOf(quotaForm.value)
  warnPercent.value = Math.round((quotaForm.value.warnRatio ?? 0.8) * 100)
  quotaFormVisible.value = true
}

/**
 * 切换范围时清掉上一个范围残留的目标字段，避免把 USER 的 userId 或 AGENT 的 targetKey
 * 带进下一个范围（后端 normalize 会再清一遍，但界面上先清干净、避免误显示）。
 */
const handleScopeChange = () => {
  if (quotaScope.value !== 'USER') {
    quotaForm.value.userId = undefined
  }
  if (quotaScope.value !== 'AGENT' && quotaScope.value !== 'WORKFLOW') {
    quotaForm.value.targetKey = undefined
  }
  // WORKFLOW 不支持金额，切到它时清掉已填的 costLimit，避免带着一个会被后端丢弃的值
  if (quotaScope.value === 'WORKFLOW') {
    quotaForm.value.costLimit = undefined
  }
}

const handleSaveQuota = async () => {
  const scope = quotaScope.value
  // 各范围的必填目标校验：与后端 normalize 同口径，界面上先拦，省一次往返 + 明确提示
  if (scope === 'USER' && !quotaForm.value.userId) {
    message.warning('请指定用户编号')
    return
  }
  if ((scope === 'AGENT' || scope === 'WORKFLOW') && !quotaForm.value.targetKey) {
    message.warning(scope === 'AGENT' ? '请选择要限制的 Agent' : '请选择要限制的工作流')
    return
  }
  // WORKFLOW 只认 token，所以「至少填一个上限」的口径里 costLimit 不参与
  const costEffective = scope === 'WORKFLOW' ? undefined : quotaForm.value.costLimit
  if (!quotaForm.value.tokenLimit && !costEffective) {
    message.warning('token 上限与金额上限至少要填一个，否则这条配额不会限制任何东西')
    return
  }
  const payload: AgentQuotaVO = {
    ...quotaForm.value,
    dimension: scope,
    // 租户级配额的 userId 必须是 null 而不是 0 —— 0 是个合法的用户编号
    userId: scope === 'USER' ? quotaForm.value.userId : undefined,
    // 只有 AGENT/WORKFLOW 带目标 code；TENANT/USER 一律清空
    targetKey: scope === 'AGENT' || scope === 'WORKFLOW' ? quotaForm.value.targetKey : undefined,
    // WORKFLOW 不支持金额（节点 trace 无金额、不改计费语义），强制不带 costLimit
    costLimit: costEffective,
    warnRatio: warnPercent.value / 100
  }
  await ConfigApi.saveQuota(payload)
  message.success('已保存')
  quotaFormVisible.value = false
  await loadQuotas()
}

const handleDeleteQuota = async (row: AgentQuotaVO) => {
  await message.confirm('删除后该维度恢复为「不限制」，确定吗？')
  await ConfigApi.deleteQuota(row.id!)
  message.success('已删除')
  await loadQuotas()
}

const loadConfig = async () => {
  config.value = await ConfigApi.getAgentConfig()
}

const loadQuotas = async () => {
  quotaLoading.value = true
  try {
    quotas.value = await ConfigApi.getQuotaList()
  } finally {
    quotaLoading.value = false
  }
}

const loadTools = async () => {
  toolLoading.value = true
  try {
    tools.value = await ConfigApi.getToolList()
  } finally {
    toolLoading.value = false
  }
}

/**
 * 按 code 去重（agent_def / workflow_def 同 code 多版本共存，下拉只该出现一次），
 * label 用「名称（code）」让管理员既能按名字认、也能核对绑定的是哪个 code。
 */
function uniqueByCode<T extends { code: string; name: string }>(list: T[]): { code: string; label: string }[] {
  const seen = new Set<string>()
  const out: { code: string; label: string }[] = []
  for (const item of list) {
    if (!item.code || seen.has(item.code)) continue
    seen.add(item.code)
    out.push({ code: item.code, label: `${item.name}（${item.code}）` })
  }
  return out
}

/**
 * 加载可绑定的 Agent / 工作流下拉选项。任一失败都回落空数组 ——
 * 配额管理不该因为定义列表拉取失败而整页打不开（fail-soft）。
 *
 * 🔴 需求10：剔掉系统内置行（默认平台助手）。「未选 Agent」这条路上 checkAgentQuota 收到的是空 code
 *    并直接放行，所以给它配一条 AGENT 级配额是<b>配了但永远不触发</b>——本平台头号缺陷的原样复刻。
 *    要限平台助手的用量请用 TENANT / USER 级配额（那两级与是否选 Agent 无关，照样生效）。
 */
const loadTargetOptions = async () => {
  const [agents, workflows] = await Promise.all([
    AgentDefApi.getDefPage({ pageNo: 1, pageSize: 100 }).catch(() => ({ list: [] })),
    AgentWorkflowApi.getDefPage({ pageNo: 1, pageSize: 100 }).catch(() => ({ list: [] }))
  ])
  agentOptions.value = uniqueByCode(((agents as any).list ?? []).filter((a: any) => !a.builtin))
  workflowOptions.value = uniqueByCode((workflows as any).list ?? [])
}

onMounted(async () => {
  await loadConfig()
  await loadQuotas()
  await loadTools()
  await loadTargetOptions()
})
</script>
