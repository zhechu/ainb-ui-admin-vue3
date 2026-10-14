<!--
  AI 助手用量看板

  ⚠️ 两个权限点是分开的，界面也要跟着分开：
    agent:usage:query  —— 看聚合用量
    agent:usage:detail —— 看输入原文（隐私敏感）
  所以「调用明细」那一段挂了独立的 v-hasPermi，没有该权限的人连标签页都看不到。
-->
<template>
  <ContentWrap>
    <!-- 我的配额：放最上面，因为它回答的是用户最关心的「我还能用多少」 -->
    <el-alert
      v-for="quota in myQuota"
      :key="quota.level"
      :type="quota.exceeded ? 'error' : quotaWarnLevel(quota)"
      :closable="false"
      class="mb-10px"
      show-icon
    >
      <template #title>
        {{ quota.level === 'USER' ? '我的' : '本租户'
        }}{{ quota.period === 'DAY' ? '日' : '月' }}配额：
        <template v-if="quota.tokenLimit">
          已用 {{ formatNumber(quota.usedTokens) }} / {{ formatNumber(quota.tokenLimit) }} token
          （{{ ratioOf(quota.usedTokens, quota.tokenLimit) }}%）
        </template>
        <template v-if="quota.costLimit">
          已用 {{ quota.usedCost }} / {{ quota.costLimit }} 元
        </template>
        <span v-if="quota.exceeded" class="ml-8px">—— 已达上限，新的提问会被拒绝</span>
      </template>
    </el-alert>

    <!-- 查询条件 -->
    <el-form :inline="true" class="-mb-15px">
      <el-form-item label="下钻维度">
        <el-radio-group v-model="dimension" @change="loadSummary">
          <el-radio-button v-for="item in DIMENSIONS" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="时间范围">
        <el-date-picker
          v-model="timeRange"
          type="datetimerange"
          value-format="YYYY-MM-DD HH:mm:ss"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          @change="loadSummary"
        />
      </el-form-item>
      <el-form-item>
        <el-button @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap>
    <!-- 合计：先给总数，再给分解。看板上没有总数的话，人会自己拿计算器加 -->
    <el-descriptions :column="4" border class="mb-15px">
      <el-descriptions-item label="调用次数">{{
        formatNumber(total.callCount)
      }}</el-descriptions-item>
      <el-descriptions-item label="输入 token">{{
        formatNumber(total.promptTokens)
      }}</el-descriptions-item>
      <el-descriptions-item label="输出 token">{{
        formatNumber(total.completionTokens)
      }}</el-descriptions-item>
      <el-descriptions-item label="合计 token">{{
        formatNumber(total.totalTokens)
      }}</el-descriptions-item>
    </el-descriptions>

    <el-table v-loading="loading" :data="summary" stripe class="xpy-list-table">
      <el-table-column :label="currentDimensionLabel" prop="groupLabel" min-width="180" />
      <el-table-column label="调用次数" prop="callCount" width="110" align="right" />
      <el-table-column label="输入 token" prop="promptTokens" width="130" align="right">
        <template #default="{ row }">{{ formatNumber(row.promptTokens) }}</template>
      </el-table-column>
      <el-table-column label="输出 token" prop="completionTokens" width="130" align="right">
        <template #default="{ row }">{{ formatNumber(row.completionTokens) }}</template>
      </el-table-column>
      <el-table-column label="合计 token" prop="totalTokens" width="130" align="right">
        <template #default="{ row }">{{ formatNumber(row.totalTokens) }}</template>
      </el-table-column>
      <el-table-column label="占比" width="160">
        <template #default="{ row }">
          <el-progress
            :percentage="Number(ratioOf(row.totalTokens, total.totalTokens))"
            :stroke-width="12"
          />
        </template>
      </el-table-column>
      <el-table-column label="费用（元）" prop="totalCost" width="120" align="right" />
    </el-table>

    <!-- 费用恒为 0 时说明单价没配，直说比让人猜好 -->
    <el-alert
      v-if="total.totalTokens > 0 && Number(total.totalCost) === 0"
      type="info"
      :closable="false"
      class="mt-10px"
      show-icon
      title="费用列全为 0，是因为还没有配置模型单价。token 用量是准确的，金额需要配置单价后才有意义。"
    />
  </ContentWrap>

  <!-- 调用明细：独立权限 -->
  <ContentWrap v-hasPermi="['agent:usage:detail']" title="最近的调用明细">
    <el-table
      v-loading="detailLoading"
      :data="records"
      stripe
      max-height="420"
      class="xpy-list-table"
    >
      <el-table-column label="时间" prop="beginTime" width="170" :formatter="dateFormatter" />
      <el-table-column label="场景" prop="scene" width="120" />
      <el-table-column label="模型" prop="modelName" width="140" />
      <el-table-column label="token" prop="totalTokens" width="90" align="right" />
      <el-table-column label="来源" width="100">
        <template #default="{ row }">
          <!-- 估算值要标出来：账单上对它的口径不同 -->
          <el-tag v-if="row.tokenSource === 'ESTIMATED'" type="warning" size="small">估算</el-tag>
          <el-tag v-else type="success" size="small">厂商回传</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="耗时(ms)" prop="durationMs" width="100" align="right" />
      <el-table-column label="状态" prop="status" width="100" />
      <el-table-column label="输入原文" prop="inputText" min-width="260" show-overflow-tooltip />
    </el-table>
  </ContentWrap>
</template>

<script setup lang="ts">
import { dateFormatter } from '@/utils/formatTime'
import * as UsageApi from '@/api/agent/usage'
import type { AgentUsageDimension } from '@/api/agent/usage'

defineOptions({ name: 'AgentUsage' })

const DIMENSIONS: { value: AgentUsageDimension; label: string }[] = [
  { value: 'SCENE', label: '按场景' },
  { value: 'USER', label: '按用户' },
  { value: 'MODEL', label: '按模型' },
  { value: 'DAY', label: '按日期' }
]

const loading = ref(false)
const detailLoading = ref(false)
const dimension = ref<AgentUsageDimension>('SCENE')
const timeRange = ref<string[]>([])
const summary = ref<UsageApi.AgentUsageGroupVO[]>([])
const records = ref<UsageApi.AgentUsageRecordVO[]>([])
const myQuota = ref<UsageApi.AgentQuotaUsageVO[]>([])

const currentDimensionLabel = computed(
  () => DIMENSIONS.find((item) => item.value === dimension.value)?.label ?? '分组'
)

/** 合计。在前端算而不是让后端再查一次 —— 分组结果加起来就是总数 */
const total = computed(() => {
  return summary.value.reduce(
    (acc, row) => ({
      callCount: acc.callCount + (row.callCount ?? 0),
      promptTokens: acc.promptTokens + (row.promptTokens ?? 0),
      completionTokens: acc.completionTokens + (row.completionTokens ?? 0),
      totalTokens: acc.totalTokens + (row.totalTokens ?? 0),
      totalCost: acc.totalCost + Number(row.totalCost ?? 0)
    }),
    { callCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCost: 0 }
  )
})

const formatNumber = (value?: number) => (value ?? 0).toLocaleString('zh-CN')

/** 占比。分母为 0 时返回 0，避免出现 NaN% */
const ratioOf = (used?: number, limit?: number) => {
  if (!limit || limit <= 0) return '0'
  return (((used ?? 0) / limit) * 100).toFixed(1)
}

/** 配额还没超限时，按接近程度给不同颜色 */
const quotaWarnLevel = (quota: UsageApi.AgentQuotaUsageVO) => {
  const ratio = Number(ratioOf(quota.usedTokens, quota.tokenLimit))
  return ratio >= 80 ? 'warning' : 'info'
}

const loadSummary = async () => {
  loading.value = true
  try {
    summary.value = await UsageApi.getUsageSummary({
      dimension: dimension.value,
      beginTime: timeRange.value?.[0],
      endTime: timeRange.value?.[1]
    })
  } finally {
    loading.value = false
  }
}

const loadRecords = async () => {
  detailLoading.value = true
  try {
    records.value = await UsageApi.getRecentUsage(50)
  } catch {
    // 没有 agent:usage:detail 权限时这里会 403，属于预期 —— 静默即可，
    // 该区块本身也被 v-hasPermi 隐藏了
    records.value = []
  } finally {
    detailLoading.value = false
  }
}

const resetQuery = () => {
  timeRange.value = []
  dimension.value = 'SCENE'
  loadSummary()
}

onMounted(async () => {
  myQuota.value = await UsageApi.getMyQuota()
  await loadSummary()
  await loadRecords()
})
</script>
