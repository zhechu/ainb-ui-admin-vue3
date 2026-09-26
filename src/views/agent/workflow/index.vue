<!--
  流程编排（Workflow 定义管理）—— 增量8 / P4 第一刀

  修复「流程编排」菜单点开是空白页的缺陷：菜单行早已存在（component=agent/workflow/index、
  component_name=AgentWorkflow、permission=agent:workflow:query），但页面文件此前不存在。

  本刀只读 + 管理：def 列表 / 分页 / 只读画布 / 发布 / 停用 / 执行历史（含节点级 trace）。
  🔴 有界：暂不做拖拽编辑、节点配置面板、新建-编辑表单、调试运行（P4 后续刀）。

  权限：读写统一 agent:workflow:query（照后端 AgentWorkflowDefController 的 D1 决策，细粒度写权限留后续）。
  状态无数据字典，用本地 map 渲染 tag（同 views/agent/usage 的做法）。
-->
<template>
  <!-- 搜索 -->
  <ContentWrap>
    <el-form class="-mb-15px" :model="queryParams" ref="queryFormRef" :inline="true" label-width="68px">
      <el-form-item label="流程编码" prop="code">
        <el-input
          v-model="queryParams.code"
          placeholder="请输入流程编码"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="流程名称" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入流程名称"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" placeholder="请选择状态" clearable class="!w-240px">
          <el-option
            v-for="item in STATUS_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
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
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column label="编号" align="center" prop="id" width="80" />
      <el-table-column label="流程编码" align="center" prop="code" min-width="160" show-overflow-tooltip />
      <el-table-column label="流程名称" align="center" prop="name" min-width="160" show-overflow-tooltip />
      <el-table-column label="版本" align="center" prop="version" width="70" />
      <el-table-column label="状态" align="center" prop="status" width="100">
        <template #default="scope">
          <el-tag :type="statusTagType(scope.row.status)" size="small">
            {{ statusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="触发方式" align="center" prop="triggerType" width="110">
        <template #default="scope">
          <span>{{ triggerLabel(scope.row.triggerType) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="负责人" align="center" prop="ownerUserId" width="90" />
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="180"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" align="center" min-width="240" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            @click="openCanvas(scope.row.id)"
            v-hasPermi="['agent:workflow:query']"
          >
            查看画布
          </el-button>
          <el-button
            link
            type="primary"
            @click="openHistory(scope.row)"
            v-hasPermi="['agent:workflow:query']"
          >
            执行历史
          </el-button>
          <el-button
            v-if="scope.row.status === 'DRAFT'"
            link
            type="success"
            @click="handlePublish(scope.row)"
            v-hasPermi="['agent:workflow:query']"
          >
            发布
          </el-button>
          <el-button
            v-if="scope.row.status === 'PUBLISHED'"
            link
            type="warning"
            @click="handleDisable(scope.row)"
            v-hasPermi="['agent:workflow:query']"
          >
            停用
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <!-- 分页 -->
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </ContentWrap>

  <!-- 只读画布对话框 -->
  <WorkflowCanvasDialog ref="canvasRef" />
  <!-- 执行历史抽屉 -->
  <ExecutionHistoryDrawer ref="historyRef" />
</template>

<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import { AgentWorkflowApi, type AgentWorkflowDefVO } from '@/api/agent/workflow'
import WorkflowCanvasDialog from './components/WorkflowCanvasDialog.vue'
import ExecutionHistoryDrawer from './components/ExecutionHistoryDrawer.vue'

defineOptions({ name: 'AgentWorkflow' })

const message = useMessage()

const loading = ref(true)
const total = ref(0)
const list = ref<AgentWorkflowDefVO[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  code: undefined,
  name: undefined,
  status: undefined
})
const queryFormRef = ref()

/** 状态本地 map（无数据字典）。与后端 WorkflowDefStatusEnum 一致 */
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
  return 'info' // DRAFT 及未知
}

/** 触发方式本地 map（无数据字典）。与后端触发器 type 一致 */
const TRIGGER_LABELS: Record<string, string> = {
  form_event: '表单事件',
  schedule: '定时',
  chat: '对话',
  webhook: 'Webhook'
}
const triggerLabel = (type?: string) => (type ? TRIGGER_LABELS[type] ?? type : '—')

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await AgentWorkflowApi.getDefPage(queryParams)
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

/** 查看画布 */
const canvasRef = ref()
const openCanvas = (id: number) => {
  canvasRef.value.open(id)
}

/** 执行历史 */
const historyRef = ref()
const openHistory = (row: AgentWorkflowDefVO) => {
  historyRef.value.open(row.id, row.name || row.code)
}

/** 发布：DRAFT → PUBLISHED */
const handlePublish = async (row: AgentWorkflowDefVO) => {
  try {
    await message.confirm(`确认发布流程「${row.name || row.code}」(v${row.version})？发布后可被执行。`)
    await AgentWorkflowApi.publishDef(row.id)
    message.success('发布成功')
    await getList()
  } catch {}
}

/** 停用：PUBLISHED → DISABLED */
const handleDisable = async (row: AgentWorkflowDefVO) => {
  try {
    await message.confirm(
      `确认停用流程「${row.name || row.code}」(v${row.version})？停用后不再接受新执行，在途实例按原版本跑完。`
    )
    await AgentWorkflowApi.disableDef(row.id)
    message.success('停用成功')
    await getList()
  } catch {}
}

onMounted(() => {
  getList()
})
</script>
