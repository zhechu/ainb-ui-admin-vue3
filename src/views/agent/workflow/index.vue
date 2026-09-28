<!--
  流程编排（Workflow 定义管理）—— 增量8 / P4 第一刀

  修复「流程编排」菜单点开是空白页的缺陷：菜单行早已存在（component=agent/workflow/index、
  component_name=AgentWorkflow、permission=agent:workflow:query），但页面文件此前不存在。

  本刀只读 + 管理：def 列表 / 分页 / 只读画布 / 发布 / 停用 / 执行历史（含节点级 trace）。
  🔴 有界：暂不做拖拽编辑、节点配置面板、新建-编辑表单、调试运行（P4 后续刀）。

  权限（增量14a 拆分，与后端 AgentWorkflowDefController @PreAuthorize 逐字一致）：
     读（查看画布/执行历史）= agent:workflow:query；新增 = :create；编辑 = :update；删除 = :delete；
     发布/停用 = :publish；发起执行（run/resume/event，在 ExecutionHistoryDrawer）= :run。
     按钮权限行 + 角色授权见 sql/mysql/xpy-2026-09-27-agent-fine-grained-perms.sql（super_admin 绕过一切权限点）。
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
        <!-- 操作按钮放搜索表单末尾，与 tenant 等列表页同款布局（AI助手 UX 修复：原先孤悬在列表区顶部） -->
        <!-- Req 2：新增与设计分开——「新增」先弹元信息弹窗建草稿，再由弹窗回调跳整页设计器 -->
        <el-button
          type="primary"
          plain
          @click="openCreate"
          v-hasPermi="['agent:workflow:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增
        </el-button>
        <!-- Req 3：五种触发方式的经典案例，不建数据也不需要权限，纯粹给人参考 -->
        <el-button plain @click="openCases" data-testid="trigger-case-btn">
          <Icon icon="ep:reading" class="mr-5px" /> 触发案例
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <!-- Req 1：序号列（参考模型配置页 views/ai/model/model/index.vue；indexMethod 已配 auto-import） -->
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        :index="indexMethod(queryParams)"
        class-name="col-index"
        label-class-name="col-index"
      />
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
      <el-table-column label="触发方式" align="center" prop="triggerType" width="124">
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
      <el-table-column label="操作" align="center" min-width="440" fixed="right">
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
            link
            type="primary"
            @click="openVersions(scope.row)"
            v-hasPermi="['agent:workflow:query']"
          >
            版本
          </el-button>
          <!-- Req 2：设计与编辑分开——「设计」跳整页设计器画画布；「编辑」弹窗只改元信息+触发方式 -->
          <el-button
            v-if="scope.row.status === 'DRAFT'"
            link
            type="primary"
            @click="openEditor(scope.row)"
            v-hasPermi="['agent:workflow:update']"
          >
            设计
          </el-button>
          <el-button
            v-if="scope.row.status === 'DRAFT'"
            link
            type="primary"
            @click="openFormEdit(scope.row)"
            v-hasPermi="['agent:workflow:update']"
          >
            编辑
          </el-button>
          <el-button
            v-if="scope.row.status === 'DRAFT'"
            link
            type="success"
            @click="handlePublish(scope.row)"
            v-hasPermi="['agent:workflow:publish']"
          >
            发布
          </el-button>
          <el-button
            v-if="scope.row.status === 'PUBLISHED'"
            link
            type="warning"
            @click="handleDisable(scope.row)"
            v-hasPermi="['agent:workflow:publish']"
          >
            停用
          </el-button>
          <el-button
            v-if="scope.row.status === 'DRAFT'"
            link
            type="danger"
            @click="handleDelete(scope.row)"
            v-hasPermi="['agent:workflow:delete']"
          >
            删除
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
  <!-- 版本管理抽屉（增量14b：对比/回滚/设主版本） -->
  <WorkflowVersionDrawer ref="versionRef" @success="getList" />
  <!-- Req 2：新增/编辑元信息弹窗（新增成功后跳整页设计器） -->
  <WorkflowForm ref="formRef" @success="handleFormSuccess" />
  <!-- Req 3：五种触发方式的经典案例参考手册（只看不建，与新增弹窗里的内联卡片同源） -->
  <TriggerCaseDialog ref="caseRef" />
</template>

<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import { AgentWorkflowApi, type AgentWorkflowDefVO } from '@/api/agent/workflow'
import WorkflowCanvasDialog from './components/WorkflowCanvasDialog.vue'
import ExecutionHistoryDrawer from './components/ExecutionHistoryDrawer.vue'
import WorkflowVersionDrawer from './components/WorkflowVersionDrawer.vue'
import WorkflowForm from './components/WorkflowForm.vue'
import TriggerCaseDialog from './editor/components/TriggerCaseDialog.vue'
import { triggerTypeLabel } from './editor/triggerCases'

defineOptions({ name: 'AgentWorkflow' })

const message = useMessage()
const { push } = useRouter()

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

/**
 * 触发方式中文名：统一取 triggerCases.ts 的 TRIGGER_TYPE_LABELS（无数据字典）。
 * 🔴 原先这里存了一份本地 map（chat 叫「对话」），新增弹窗的下拉却叫「对话驱动 Agent」——
 *    同一个 triggerType 在两处叫不同名字，用户对着列表找不到弹窗里那一项。收敛到单一来源。
 */
const triggerLabel = (type?: string) => (type ? triggerTypeLabel(type) : '—')

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

/** 版本管理（增量14b）：按 code 列出该流程的全部版本，供对比/回滚/设主版本 */
const versionRef = ref()
const openVersions = (row: AgentWorkflowDefVO) => {
  versionRef.value.open(row.code, row.name || row.code)
}

/**
 * 设计：跳整页设计器（隐藏路由 AgentWorkflowEditor，仿门户设计器）画画布。
 * Req 2「新增与设计分开」后，本函数只服务行内「设计」按钮（必带 id 走编辑态）。
 * 仅对 DRAFT 行开放（与后端 updateDef 草稿守卫一致）。
 */
const openEditor = (row: AgentWorkflowDefVO) => {
  push({ name: 'AgentWorkflowEditor', query: { id: String(row.id) } })
}

/**
 * 新增/编辑元信息弹窗（Req 2）。
 * · openCreate：弹「新增流程」——填 名称/编码/触发/模板，建草稿后由 handleFormSuccess 跳设计器；
 * · openFormEdit：弹「编辑流程信息」——只改 名称/描述/备注/触发（编码只读），画布节点原样保留。
 */
const formRef = ref()
const openCreate = () => formRef.value?.open('create')
const openFormEdit = (row: AgentWorkflowDefVO) => formRef.value?.open('update', row)
const handleFormSuccess = async (id?: number, isCreate?: boolean) => {
  await getList()
  // 新增成功 → 直进整页设计器（对齐门户 handleFormSuccess）；编辑元信息只刷新列表
  if (isCreate && id) push({ name: 'AgentWorkflowEditor', query: { id: String(id) } })
}

/** Req 3：打开「触发方式经典案例」参考手册（只读，不建数据、不需要任何按钮权限） */
const caseRef = ref()
const openCases = () => caseRef.value?.open()

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

/** 删除：仅 DRAFT 可删（草稿从未被执行入口选中，删了不留孤儿；后端 deleteDef 对非草稿抛 WORKFLOW_DEF_NOT_DRAFT） */
const handleDelete = async (row: AgentWorkflowDefVO) => {
  try {
    await message.delConfirm(
      `确认删除草稿流程「${row.name || row.code}」(v${row.version})？删除后不可恢复。`
    )
    await AgentWorkflowApi.deleteDef(row.id)
    message.success('删除成功')
    await getList()
  } catch {}
}

onMounted(() => {
  getList()
})

// 从整页设计器返回时刷新列表（页面被 keep-alive 缓存时 onMounted 不会重跑）；首次激活跳过，避免与 onMounted 重复请求
let firstActivated = true
onActivated(() => {
  if (firstActivated) {
    firstActivated = false
    return
  }
  getList()
})
</script>
