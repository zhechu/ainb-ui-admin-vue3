<!--
  流程编排（Workflow 定义管理）—— 增量8 / P4 起，2026-09-29 AI助手优化 Req 1 / Req 3

  职责：def 列表 / 分页 / 只读画布 / 发布 / 停用 / 版本管理 / 执行历史（含节点级 trace），
       以及新增·编辑元信息的【页内面板】；画布本身的拖拽编排在整页设计器（editor/index.vue）。

  🔴 Req 1（2026-09-29）：新增/编辑元信息由 640px 弹窗改为页内面板，与工具管理（views/agent/tooldef）
     同一套范式——viewMode 在 'list' / 'form' 间切换，面板与列表同级条件渲染，URL 不变、不加路由。

  🔴 Req 3（2026-09-29）：新增「来源」列与筛选项。除本页「新增」外，规划器与助手对话也会往
     agent_workflow_def 落行（code 形如 wf_plan_*），不标来源就分不清哪条是自己建的。
     来源由服务端按入口写死，前端只读展示。见 WorkflowSourceEnum 与
     sql/mysql/xpy-2026-09-29-agent-workflow-def-source.sql。

  权限（增量14a 拆分，与后端 AgentWorkflowDefController @PreAuthorize 逐字一致）：
     读（查看画布/执行历史）= agent:workflow:query；新增 = :create；编辑 = :update；删除 = :delete；
     发布/停用 = :publish；发起执行（run/resume/event，在 ExecutionHistoryDrawer）= :run。
     按钮权限行 + 角色授权见 sql/mysql/xpy-2026-09-27-agent-fine-grained-perms.sql（super_admin 绕过一切权限点）。
  状态与来源均无数据字典，用本地 map 渲染 tag（同 views/agent/usage 的做法）。
-->
<template>
  <!-- ==================== 列表 ==================== -->
  <!--
    🔴 新增/编辑元信息走【页内面板】而非弹窗（同 views/agent/tooldef 的范式）：
       面板与列表是同级的条件渲染，URL 不变、不加路由。
       表单最坏情况（webhook + 内联经典案例卡）有十来项、每项还带说明，640px 弹窗里必须滚动，
       管理员看不见「上面填了什么、下面要填什么」。
  -->
  <template v-if="viewMode === 'list'">
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
        <!-- Req 3：按来源筛，选「手动添加」即可把大模型悄悄生成的草稿噪音一次滤掉 -->
        <el-form-item label="来源" prop="source">
          <el-select v-model="queryParams.source" placeholder="请选择来源" clearable class="!w-240px">
            <el-option
              v-for="item in SOURCE_OPTIONS"
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
          <!-- Req 2：新增与设计分开——「新增」先在页内面板填元信息建草稿，保存后再跳整页设计器 -->
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
        <!-- Req 3：来源。AUTO 的行不是管理员建的，鼠标悬停说清它从哪来，免得对着不敢删 -->
        <el-table-column label="来源" align="center" prop="source" width="104">
          <template #default="scope">
            <el-tooltip :content="sourceHint(scope.row.source)" placement="top">
              <el-tag :type="sourceTagType(scope.row.source)" size="small" effect="plain">
                {{ sourceLabel(scope.row.source) }}
              </el-tag>
            </el-tooltip>
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
            <!-- Req 2：设计与编辑分开——「设计」跳整页设计器画画布；「编辑」在页内面板只改元信息+触发方式 -->
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
    <!-- Req 3：五种触发方式的经典案例参考手册（只看不建，与新增面板里的内联卡片同源） -->
    <TriggerCaseDialog ref="caseRef" />
  </template>

  <!-- ==================== 新增 / 编辑元信息（页内面板） ==================== -->
  <!-- Req 1：由弹窗改页内。新增成功后由 handleFormSuccess 跳整页设计器 -->
  <WorkflowForm
    v-else-if="viewMode === 'form'"
    ref="formRef"
    @success="handleFormSuccess"
    @cancel="backToList"
  />
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

/**
 * 页内视图切换：'list' 列表 / 'form' 新增·编辑元信息面板。
 * 🔴 面板与列表是同级条件渲染，URL 不变、不加路由（同 views/agent/tooldef 的范式）。
 */
const viewMode = ref<'list' | 'form'>('list')

const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  code: undefined,
  name: undefined,
  status: undefined,
  source: undefined
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
 * 来源本地 map（无数据字典，同状态）。与后端 WorkflowSourceEnum 一致。
 *
 * 🔴 Req 3：除本页「新增」外，规划器（POST /agent/planner/plan-workflow）与智能助手对话里的
 *    「搭流程」意图也会往这张表落行，编码形如 wf_plan_xxx。不标来源的话，管理员对着一堆
 *    自己没建过的流程既不敢删、也找不到自己那几条。
 * 🔴 未回填的历史行 source 可能为空，一律按「手动添加」显示（与后端 WorkflowSourceEnum.isManual 一致）。
 */
const SOURCE_OPTIONS = [
  { value: 'MANUAL', label: '手动添加' },
  { value: 'AUTO', label: '自动生成' }
]
const sourceLabel = (source?: string) =>
  source === 'AUTO' ? '自动生成' : '手动添加'
const sourceTagType = (source?: string): 'success' | 'warning' =>
  source === 'AUTO' ? 'warning' : 'success'
const sourceHint = (source?: string) =>
  source === 'AUTO'
    ? '由「流程规划器」或智能助手对话里的大模型自动生成，不是你在本页手动新建的'
    : '管理员在本页点「新增」手动创建（含版本回滚复制出的新草稿）'

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
 * 新增/编辑元信息（Req 2；2026-09-29 由弹窗改页内面板）。
 * · openCreate：「新增流程」面板——填 名称/编码/触发/模板，建草稿后由 handleFormSuccess 跳设计器；
 * · openFormEdit：「编辑流程信息」面板——只改 名称/描述/触发（编码只读），画布节点原样保留。
 */
const formRef = ref()
/** 🔴 面板是 v-else-if 渲染的，切过去之后必须等 nextTick 才拿得到 ref，否则 open() 打在 undefined 上 */
const openPanel = async (type: 'create' | 'update', row?: AgentWorkflowDefVO) => {
  viewMode.value = 'form'
  await nextTick()
  formRef.value?.open(type, row)
}
const openCreate = () => openPanel('create')
const openFormEdit = (row: AgentWorkflowDefVO) => openPanel('update', row)
/** 面板「返回 / 取消」：只切回列表、不重新拉数据（列表数据没被改过） */
const backToList = () => {
  viewMode.value = 'list'
}
const handleFormSuccess = async (id?: number, isCreate?: boolean) => {
  viewMode.value = 'list'
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
  // 🔴 只在列表态刷新：正停在新增/编辑面板时切回来（例如从设计器返回），
  //    重拉列表会把 viewMode 之外的东西一起扰动，而面板里填了一半的内容更不该被丢掉。
  if (viewMode.value === 'list') getList()
})
</script>
