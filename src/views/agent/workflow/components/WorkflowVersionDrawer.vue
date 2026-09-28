<!--
  版本管理抽屉（增量14b）

  同一 code 的多版本行（DRAFT/PUBLISHED/DISABLED 共存）在此集中管理：
    · 对比：选两个版本 → 各取完整 DSL → 并排 pretty-print JSON（无 diff 库，第一刀只做并排肉眼比对）
    · 回滚：基于某历史版本的 DSL 复制成一个新草稿（绝不改历史快照；产物需再发布才生效）
    · 设为主版本：同 code 多已发布版本中指定当前生效的那一版（执行入口优先选中，灰度回退用）

  🔴 权限（与后端 AgentWorkflowDefController @PreAuthorize 逐字一致）：
     读列表 = agent:workflow:query；回滚 = :create（产物是新草稿）；设主版本 = :publish（改变生效版本）。
  🔴 已发布/已停用版本是不可变快照：这里没有「编辑」入口，改流程只能回滚出新草稿再改。
  状态无数据字典，用本地 map 渲染 tag（同 ExecutionHistoryDrawer）。
-->
<template>
  <el-drawer v-model="visible" :title="`版本管理 · ${title}`" size="70%" append-to-body destroy-on-close>
    <!-- 对比区：选两个版本并排看 DSL -->
    <div class="mb-12px flex items-center gap-8px flex-wrap">
      <span class="text-13px text-gray-500">版本对比：</span>
      <el-select v-model="compareA" placeholder="版本 A" class="!w-160px" size="small">
        <el-option
          v-for="v in list"
          :key="v.id"
          :label="`v${v.version}（${statusLabel(v.status)}）`"
          :value="v.id"
        />
      </el-select>
      <span class="text-gray-400">↔</span>
      <el-select v-model="compareB" placeholder="版本 B" class="!w-160px" size="small">
        <el-option
          v-for="v in list"
          :key="v.id"
          :label="`v${v.version}（${statusLabel(v.status)}）`"
          :value="v.id"
        />
      </el-select>
      <el-button
        size="small"
        type="primary"
        plain
        :disabled="!compareA || !compareB || compareA === compareB"
        :loading="compareLoading"
        @click="handleCompare"
      >
        对比 DSL
      </el-button>
    </div>

    <el-table v-loading="loading" :data="list" stripe row-key="id">
      <el-table-column label="版本" prop="version" width="70" align="center">
        <template #default="scope">v{{ scope.row.version }}</template>
      </el-table-column>
      <el-table-column label="状态" prop="status" width="160" align="center">
        <template #default="scope">
          <el-tag :type="statusTagType(scope.row.status)" size="small">
            {{ statusLabel(scope.row.status) }}
          </el-tag>
          <!-- 主版本徽标：执行入口优先选中它（增量14b） -->
          <el-tag v-if="scope.row.primaryFlag" type="primary" size="small" effect="dark" class="ml-4px">
            主版本
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="触发方式" prop="triggerType" width="100" align="center">
        <template #default="scope">{{ triggerLabel(scope.row.triggerType) }}</template>
      </el-table-column>
      <el-table-column label="负责人" prop="ownerUserId" width="80" align="center" />
      <el-table-column label="描述" prop="description" min-width="160" show-overflow-tooltip />
      <el-table-column label="创建时间" prop="createTime" width="170" :formatter="dateFormatter" />
      <el-table-column label="操作" width="200" align="center" fixed="right">
        <template #default="scope">
          <el-button
            v-if="scope.row.status === 'PUBLISHED' && !scope.row.primaryFlag"
            link
            type="primary"
            @click="handleSetPrimary(scope.row)"
            v-hasPermi="['agent:workflow:publish']"
          >
            设为主版本
          </el-button>
          <el-button
            link
            type="warning"
            @click="handleRollback(scope.row)"
            v-hasPermi="['agent:workflow:create']"
          >
            回滚到此版
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && list.length === 0" description="暂无版本" :image-size="80" />
  </el-drawer>

  <!-- DSL 并排对比对话框 -->
  <el-dialog
    v-model="compareVisible"
    :title="`DSL 对比 · v${compareALabel} ↔ v${compareBLabel}`"
    width="80%"
    append-to-body
    destroy-on-close
  >
    <div class="flex gap-12px">
      <div class="flex-1 min-w-0">
        <div class="mb-6px font-bold text-13px">v{{ compareALabel }}</div>
        <!-- Req6：DSL 对比也用代码编辑器（只读），裸 pre 没有高亮，两个版本的差异全靠肉眼扫 -->
        <CodeEditor :model-value="compareAText" language="json" readonly height="60vh" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="mb-6px font-bold text-13px">v{{ compareBLabel }}</div>
        <CodeEditor :model-value="compareBText" language="json" readonly height="60vh" />
      </div>
    </div>
  </el-dialog>
</template>

<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import { AgentWorkflowApi, type AgentWorkflowDefVO } from '@/api/agent/workflow'

defineOptions({ name: 'WorkflowVersionDrawer' })

const message = useMessage()
const emit = defineEmits<{ success: [] }>()

const visible = ref(false)
const loading = ref(false)
const title = ref('')
const code = ref('')
const list = ref<AgentWorkflowDefVO[]>([])

/** 状态本地 map（无数据字典），与后端 WorkflowDefStatusEnum 一致 */
const STATUS_OPTIONS = [
  { value: 'DRAFT', label: '草稿' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'DISABLED', label: '已停用' }
]
const statusLabel = (status: string) =>
  STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status
const statusTagType = (status: string): 'info' | 'success' | 'warning' => {
  if (status === 'PUBLISHED') return 'success'
  if (status === 'DISABLED') return 'warning'
  return 'info'
}
const TRIGGER_LABELS: Record<string, string> = {
  form_event: '表单事件',
  schedule: '定时',
  chat: '对话',
  webhook: 'Webhook'
}
const triggerLabel = (type?: string) => (type ? TRIGGER_LABELS[type] ?? type : '—')

const getList = async () => {
  loading.value = true
  try {
    list.value = await AgentWorkflowApi.getVersionList(code.value)
  } finally {
    loading.value = false
  }
}

/** 打开抽屉：按 code 拉全部版本 */
const open = async (defCode: string, defTitle: string) => {
  visible.value = true
  code.value = defCode
  title.value = defTitle
  compareA.value = undefined
  compareB.value = undefined
  list.value = []
  await getList()
}

// ========== 对比 ==========
const compareA = ref<number | undefined>()
const compareB = ref<number | undefined>()
const compareLoading = ref(false)
const compareVisible = ref(false)
const compareALabel = ref('')
const compareBLabel = ref('')
const compareAText = ref('')
const compareBText = ref('')

/** DSL 原文 → pretty-print JSON；解析失败则原样返回（不因格式错而阻断对比） */
const pretty = (dsl?: string | null): string => {
  if (!dsl) return '（无 DSL）'
  try {
    return JSON.stringify(JSON.parse(dsl), null, 2)
  } catch {
    return dsl
  }
}

const handleCompare = async () => {
  if (!compareA.value || !compareB.value) return
  compareLoading.value = true
  try {
    const [a, b] = await Promise.all([
      AgentWorkflowApi.getDef(compareA.value),
      AgentWorkflowApi.getDef(compareB.value)
    ])
    compareALabel.value = String(a.version)
    compareBLabel.value = String(b.version)
    compareAText.value = pretty(a.dsl)
    compareBText.value = pretty(b.dsl)
    compareVisible.value = true
  } finally {
    compareLoading.value = false
  }
}

// ========== 回滚（基于旧版 DSL 复制成新草稿） ==========
const handleRollback = async (row: AgentWorkflowDefVO) => {
  try {
    await message.confirm(
      `确认基于 v${row.version} 回滚？将复制其 DSL 生成一个新草稿（不改动任何历史版本），需再发布才生效。`
    )
    const newId = await AgentWorkflowApi.rollback(row.id)
    message.success(`已基于 v${row.version} 创建新草稿（编号 ${newId}），请到列表编辑后发布`)
    await getList()
    emit('success')
  } catch {}
}

// ========== 设为主版本 ==========
const handleSetPrimary = async (row: AgentWorkflowDefVO) => {
  try {
    await message.confirm(
      `确认把 v${row.version} 设为主版本？此后「${row.code}」的执行入口将优先选中它（而非最新版本）。`
    )
    await AgentWorkflowApi.setPrimary(row.id)
    message.success('已设为主版本')
    await getList()
    emit('success')
  } catch {}
}

defineExpose({ open })
</script>
