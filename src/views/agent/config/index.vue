<!--
  AI 助手管理员配置：总开关、配额、工具清单（只读）

  🔴 工具清单刻意做成只读。方案 §3.2 曾设想过在线开关工具，实现时没做 ——
  工具的权限串与风险等级属于实现的一部分，让它可被运行时改写等于把安全约束交给数据。
  把 datamodel_create（不可逆、直接执行 DDL）的风险等级在界面上改成「低风险」，
  它就不再需要用户确认了。要下线某个工具，走改代码 + 发布，留得下痕迹。
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
      <el-table-column label="范围" width="150">
        <template #default="{ row }">
          <el-tag v-if="row.userId == null" type="warning">整个租户</el-tag>
          <span v-else>用户 {{ row.userId }}</span>
        </template>
      </el-table-column>
      <el-table-column label="周期" width="90">
        <template #default="{ row }">{{ row.period === 'DAY' ? '每天' : '每月' }}</template>
      </el-table-column>
      <el-table-column label="token 上限" width="140" align="right">
        <template #default="{ row }">{{ row.tokenLimit ?? '不限' }}</template>
      </el-table-column>
      <el-table-column label="金额上限（元）" width="140" align="right">
        <template #default="{ row }">{{ row.costLimit ?? '不限' }}</template>
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
      <el-table-column label="工具" prop="name" width="220" />
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
        <el-radio-group v-model="quotaScope">
          <el-radio value="TENANT">整个租户</el-radio>
          <el-radio value="USER">指定用户</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="quotaScope === 'USER'" label="用户编号">
        <el-input-number v-model="quotaForm.userId" :min="1" controls-position="right" />
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
        <el-input-number v-model="quotaForm.costLimit" :min="0" :precision="2" controls-position="right" />
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
const quotaScope = ref<'TENANT' | 'USER'>('TENANT')
/** 界面上用百分比，接口用小数 —— 让管理员填 0.8 太容易填成 80 */
const warnPercent = ref(80)

function emptyQuota(): AgentQuotaVO {
  return { period: 'MONTH', warnRatio: 0.8, status: 0 }
}

const riskTagType = (risk: string) =>
  ({ READ_ONLY: 'success', LOW: 'info', MEDIUM: 'warning', HIGH: 'danger', IRREVERSIBLE: 'danger' })[
    risk
  ] ?? 'info'

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
  quotaScope.value = quotaForm.value.userId == null ? 'TENANT' : 'USER'
  warnPercent.value = Math.round((quotaForm.value.warnRatio ?? 0.8) * 100)
  quotaFormVisible.value = true
}

const handleSaveQuota = async () => {
  const payload: AgentQuotaVO = {
    ...quotaForm.value,
    // 租户级配额的 userId 必须是 null 而不是 0 —— 0 是个合法的用户编号
    userId: quotaScope.value === 'TENANT' ? undefined : quotaForm.value.userId,
    warnRatio: warnPercent.value / 100
  }
  if (!payload.tokenLimit && !payload.costLimit) {
    message.warning('token 上限与金额上限至少要填一个，否则这条配额不会限制任何东西')
    return
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

onMounted(async () => {
  await loadConfig()
  await loadQuotas()
  await loadTools()
})
</script>
