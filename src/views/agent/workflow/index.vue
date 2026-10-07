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
      <!--
        B5-8：AI 规划采纳率 —— 一个只读数字，回答「AI 起草的流程到底被不被采纳、采纳前要不要人改」。
        🔴 放列表上方而非某一行：它是**跨全部草稿的聚合**，不属于任何单条流程。
        🔴 拿不到（adoptionStat=undefined）时显示「—」，绝不显示假的 0%；分母为 0 时后端给 null、这里渲染「暂无」。
        🔴 悬停看口径与复核方式（ADOPTION_HINT）：数字要能被只读 SQL 对齐，否则就是个没法验证的装饰。
      -->
      <div class="mb-12px flex items-center text-13px text-[var(--el-text-color-secondary)]">
        <Icon icon="ep:data-analysis" class="mr-5px" />
        <span>AI 规划采纳率：</span>
        <el-tooltip :content="ADOPTION_HINT" placement="top">
          <span class="ml-4px font-600 text-[var(--el-color-primary)]">{{ adoptionText }}</span>
        </el-tooltip>
      </div>
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
        <!--
          🔴 min-width 不能按「刚好放下」给：这一列的按钮折行**不报错**，只是悄悄折成两行。
             e2e（tests/e2e/agent-workflow-copy.spec.ts 的「操作列不换行」）实测：
             草稿行 8 钮需宽 436px、已发布行 6 钮需宽 434px ⟹ 原来的 440 只剩 4px 余量，
             任何一个按钮文案变长就折行。取 520（余量 ~84px）。改这一列的按钮请同步改这个数。
        -->
        <el-table-column label="操作" align="center" min-width="520" fixed="right">
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
            <!--
              🔴 S5-d（修 G14 的前端那半）：「设计」去掉 v-if="status === 'DRAFT'"，改为**常显**。
                 非草稿行进的是同一个设计器，只是它自己按服务端下发的 editable 落成只读态
                 （editor/index.vue 的 readonly 也改成读 editable，不再自己判 'DRAFT'）。
                 文案按 editable 切：设计 / 查看设计 —— 让用户在点之前就知道会不会改得动。
              🔴 权限从 agent:workflow:update **放宽**到 agent:workflow:query：只读查看不该要写权限。
                 S5-a 量过这次放宽是安全的（授权脚本第 3 步是从 query 持有者派生出写授权，
                 故 update 持有者 ⊆ query 持有者，只会让更多人看见）。
                 ⚠️ 但台账 #109：hasPermi 对 *:*:* 短路、e2e 恒以 admin 登录 ⟹ 这次放宽在 e2e 里
                 **结构性地证明不了**，别拿「e2e 绿」当它的验收判据。
              🔴 「编辑」「删除」也改判 row.editable 而不是 status === 'DRAFT'：判据的唯一出处是
                 后端 WorkflowDefStatusEnum#isDraft，服务端派生成 editable 下发。
                 前端再抄一份 'DRAFT' 字面量，等状态机加一档就是「按钮亮着、点了被后端拒」。
            -->
            <el-button
              link
              type="primary"
              @click="openEditor(scope.row)"
              v-hasPermi="['agent:workflow:query']"
              data-testid="wf-design-btn"
            >
              {{ scope.row.editable ? '设计' : '查看设计' }}
            </el-button>
            <el-button
              v-if="scope.row.editable"
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
            <!--
              🔴 发布/停用**保留** status === 判据，不跟着改 editable：
                 「可发布性」与「可编辑性」是两条不同的规矩，服务端只下发了后者。
                 （后端另有 isExecutable / publishDef 的可发布性判据，但没有对应的广告位字段，
                 前端在这里自己判 status 是**唯一**选择，不是 G14 那种重复。）
              🔴 S5-d：复制按钮**所有状态都可用**（草稿/已发布/已停用都能当模板抄），权限归 create
                 —— 产物是一个新 DRAFT，与「新建流程」同类写动作，后端不新设权限点。
                 非草稿行把它升成**主操作**（plain 实心而非 link）并改叫「复制为新草稿」：
                 面对一条改不动的流程，用户真正想做的就是这件事，
                 而不是一排灰掉的链接里再找一个「编辑」。
                 ⚠️ 下面两枚是同一个 v-if/v-else 链，中间**不要插注释**（会打断分支配对）。
            -->
            <el-button
              v-if="scope.row.editable"
              link
              type="primary"
              @click="openCopy(scope.row)"
              v-hasPermi="['agent:workflow:create']"
              data-testid="wf-copy-btn"
            >
              复制
            </el-button>
            <el-button
              v-else
              type="primary"
              plain
              size="small"
              @click="openCopy(scope.row)"
              v-hasPermi="['agent:workflow:create']"
              data-testid="wf-copy-as-draft-btn"
            >
              复制为新草稿
            </el-button>
            <el-button
              v-if="scope.row.editable"
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

    <!-- 只读画布对话框（S5-d：底部加「打开完整设计器（只读）」，看得到每格配置） -->
    <WorkflowCanvasDialog ref="canvasRef" @design="goDesign" />
    <!-- 执行历史抽屉 -->
    <ExecutionHistoryDrawer ref="historyRef" />
    <!-- 版本管理抽屉（增量14b：对比/回滚/设主版本） -->
    <WorkflowVersionDrawer ref="versionRef" @success="getList" />
    <!-- Req 3：五种触发方式的经典案例参考手册（只看不建，与新增面板里的内联卡片同源） -->
    <TriggerCaseDialog ref="caseRef" />
    <!-- S4b：发布体检不通过时逐条列出「改哪儿」，与后端闸门同一份判据 -->
    <PublishGateDialog ref="gateRef" @design="goDesignFromGate" />
    <!--
      S5-d：复制对话框。🔴 @success 只负责刷新列表，**不负责关对话框** ——
      复制这一步不跑发布体检，rewritten[] 是唯一的用户可见信号且取不回来第二次，
      所以对话框自己停在清单阶段等用户读完（详见组件注释）。
    -->
    <WorkflowCopyDialog ref="copyRef" @success="getList" @design="goDesign" />
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
import {
  AgentWorkflowApi,
  type AgentWorkflowDefVO,
  type AgentPlannerAdoptionStatVO
} from '@/api/agent/workflow'
import WorkflowCanvasDialog from './components/WorkflowCanvasDialog.vue'
import ExecutionHistoryDrawer from './components/ExecutionHistoryDrawer.vue'
import WorkflowVersionDrawer from './components/WorkflowVersionDrawer.vue'
import WorkflowForm from './components/WorkflowForm.vue'
import TriggerCaseDialog from './editor/components/TriggerCaseDialog.vue'
import PublishGateDialog from './components/PublishGateDialog.vue'
import WorkflowCopyDialog from './components/WorkflowCopyDialog.vue'
import { precheckPublish } from './publishGate'
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

/**
 * B5-8：AI 规划采纳率（只读数字）。
 *
 * 🔴 与列表相互独立：本页的「发布」走 publishDefById（管理页发布），**不在**采纳率埋点范围内
 *    （埋点只盖「AI 生成 + 聊天确认并运行」，见后端 AgentPlannerAdoptionService 类注释），
 *    故本页任何操作都不会改这个数字 —— 进页面时拉一次即可，不跟着 getList 刷。
 * 🔴 拿不到就置 undefined（渲染成占位），**绝不**阻塞列表：这是个附加观测数字，
 *    它 403/500 不该让整页流程列表打不开（与本页 publish 预检「查不动就当不挡」同一原则）。
 */
const adoptionStat = ref<AgentPlannerAdoptionStatVO>()
const adoptionText = computed(() => {
  const s = adoptionStat.value
  if (!s) return '—'
  // 🔴 rate 为 null = 分母 0（还没有任何 AI 草稿），渲染「暂无」而不是「null%」或刺眼的「0%」
  const rate = s.adoptionRate == null ? '暂无' : `${s.adoptionRate}%`
  return `${rate}（生成 ${s.generated} · 采纳 ${s.adopted} · 手改 ${s.handModified}）`
})
const ADOPTION_HINT =
  'AI 起草的流程草稿中，被「确认并运行」的占比。括号内是原始计数，与 agent_planner_adoption 表行数一致，可用只读 SQL 复核。「暂无」表示本租户还没有任何 AI 草稿。管理页手写的流程与其发布不计入。'
const loadAdoptionStat = async () => {
  try {
    adoptionStat.value = await AgentWorkflowApi.getPlannerAdoptionStat()
  } catch {
    adoptionStat.value = undefined
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
 * Req 2「新增与设计分开」后，本函数只服务行内「设计」/「查看设计」按钮（必带 id 走编辑态）。
 *
 * 🔴 S5-d 起**所有状态**都能进：非草稿行进去是只读态（判据由服务端下发的 editable 决定，
 *    见 editor/index.vue）。原先这里只对 DRAFT 开放，等于「已发布的流程连看都看不进去」，
 *    而只读画布弹窗只能看节点连线、看不到每格的配置。
 * ⚠️ 入参刻意收窄成 `{ id }` 而不是整行：复制完成后只有新 id 在手（对话框 emit 回来的），
 *    两处跳转共用这一个函数 ⟹ 路由名与 query 形状只有一份（D7）。
 */
const openEditor = (row: { id: number }) => {
  push({ name: 'AgentWorkflowEditor', query: { id: String(row.id) } })
}

/**
 * 复制（S5-d）：所有状态都能当模板抄，产物是新编码下的 DRAFT。
 *
 * 🔴 复制成功**不等于**可以关对话框：/copy 响应里的 rewritten[] 是这一步唯一的用户可见信号，
 *    且没有任何端点能把它再取回来一次。故对话框自己停在「清单」阶段，
 *    这里只在它 emit success 时刷新列表（新草稿要出现在列表里）。
 */
const copyRef = ref()
const openCopy = (row: AgentWorkflowDefVO) => {
  copyRef.value?.open(row)
}
/**
 * 只有一个 id 在手时的进设计器入口（复制对话框的「去设计器完善」、只读画布的「打开完整设计器」共用）。
 * 🔴 不复述路由名与 query 形状，一律转给 openEditor —— 那份知识只该有一份（D7）。
 */
const goDesign = (id: number) => openEditor({ id })

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

/**
 * 发布：先本地预检，过了才 DRAFT → PUBLISHED
 *
 * 🔴 S4b 之后后端发布闸门（`assertPublishable`）会拒掉体检不通过的流程，而那条拒绝文案
 *    只会被 axios 拦截器塞进一个 4.5 秒自动消失的通知**标题**（台账 C2 之后调用方 `catch` 里也
 *    拿得到它了，但一长串拼好的修正清单在通知里照样读不完）。
 *    所以「逐条说清改哪儿」只能在这里、发请求之前做完 —— 预检不是省一次往返的优化，
 *    是唯一读得完的通道（判据见 publishGate.ts 顶部那段，那里也写了为什么 C2 已修≠本模块可删）。
 *
 * 🔴 B6 / S16 之后「发布」与「生效」是两件事，本函数必须在**用户点确认之前**就说清这一版会不会立刻上线：
 *    后端只在该 code **没有「钉着且仍在生效」的主版本**时，才把刚发布这版钉为主版本；已经钉过时
 *    发布不动线上生效版本（要切得去「版本」抽屉里显式点「设为主版本」）。原先那句「发布后可被执行」
 *    在第二种情况下是个不成立的承诺 —— 正是本平台头号缺陷形态「操作成功但不生效且无提示」。
 */
const gateRef = ref()
const gateRow = ref<AgentWorkflowDefVO>()
const handlePublish = async (row: AgentWorkflowDefVO) => {
  // 挡住上线的那一版（该 code 已钉的主版本，且不是当前这行）；undefined = 这一版发出去就是线上生效版本。
  // 🔴 必须同时要求 status === 'PUBLISHED'：`disableDefById` 只翻状态、**不清 primary_flag**，
  //    所以「主版本被停用」是能经正常操作走到的状态，不是脏数据。而后端选生效版本的
  //    `selectPublishedByCode` 带 `status = 'PUBLISHED'` 过滤 —— 一个被停用的主版本压根不参与裁决，
  //    生效版本会回落到「PUBLISHED 里 version 最大」。少了这个条件，这里就会指着一个已停用的版本
  //    说「线上跑的还是它」，把话说反（正是本刀要消灭的那类假提示）。
  // 🔴 查不动就当成「不挡」：这一步只负责把话说准，不该变成一道没人授权过的新闸门
  //    （与下面 `publish-blind` 分支同一个原则）。真查不动时后端照样是权威，最坏是提示说得含糊一点。
  let blocker: AgentWorkflowDefVO | undefined
  try {
    const pinned = (await AgentWorkflowApi.getVersionList(row.code)).find(
      (v) => v.primaryFlag && v.status === 'PUBLISHED'
    )
    blocker = pinned && pinned.id !== row.id ? pinned : undefined
  } catch {}
  const liveClause = blocker
    ? `发布后线上生效版本仍是 v${blocker.version}（该流程钉着主版本，发布不自动切换）；` +
      '要让新版接线上，请到「版本」里对它点「设为主版本」。'
    : '发布后它就是线上生效版本。'
  try {
    await message.confirm(`确认发布流程「${row.name || row.code}」(v${row.version})？${liveClause}`)
  } catch {
    return // 用户取消
  }
  // 预检放在确认之后：/validate 含最多 15 秒的 infra/bpm 只读干跑，放前面会让点了取消的人也白等一趟。
  // 🔴 必须另打一次 GET /get?id：分页接口刻意把 dsl 置成 null（一份 DSL 几十 KB，一页 20 行就是兆级负载），
  //    row.dsl 是空的，拿它去预检会永远判成「流程内容为空」。
  // 🔴 第二个参数把身份带上（台账 #81）：后端要按它数「这条流程名下真跑过几次」，据此给**已落地的撞车**
  //    降一档。少了它，一条早已上线的建表流程永远探到「表名已被占用」（占用的正是它自己建的那张表），
  //    于是既不能重新发布、回滚出的草稿也发不出去 —— 降档在 UI 上压根触发不了。
  const verdict = await precheckPublish(
    async () => (await AgentWorkflowApi.getDef(row.id)).dsl,
    (dsl) => AgentWorkflowApi.validateDsl(dsl, row.id)
  )
  if (verdict.action === 'block') {
    gateRow.value = row
    gateRef.value?.open(verdict.errors, verdict.warnings)
    return
  }
  if (verdict.action === 'publish-blind') {
    // 降级照发：预检这一层坏了（多半是 403，台账 #70）不该变成一道没人授权过的新闸门，
    // 后端闸门仍是权威。但要说出来 —— 万一真被拒了，用户至少知道「刚才没预检成」，
    // 而不是对着一条读不到内容的通知发愣。
    message.warning(`${verdict.reason}，将直接尝试发布；若被拒请到设计器里点「体检」看具体原因`)
  } else if (verdict.warnings.length) {
    message.warning(`体检通过，但有 ${verdict.warnings.length} 条建议调整`)
  }
  try {
    await AgentWorkflowApi.publishDef(row.id)
    // 🔴 两种结果必须长得**不一样**：都报「发布成功」就等于把 B6 拆开的两件事又在提示里黏回去，
    //    用户以为上线了、线上跑的还是旧版。没上线那一种用 warning 而不是 success。
    if (blocker) {
      message.warning(
        `已发布 v${row.version}，但线上生效版本仍是 v${blocker.version}。` +
          '需要它接线上请到「版本」里点「设为主版本」。'
      )
    } else {
      message.success(`发布成功，v${row.version} 已是线上生效版本`)
    }
    await getList()
  } catch {}
}

/** 拦截清单上的「去设计器修改」：跳那条流程的整页设计器，页内体检面板会再列一次同样的清单 */
const goDesignFromGate = () => {
  if (gateRow.value) openEditor(gateRow.value)
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
  loadAdoptionStat()
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
  if (viewMode.value === 'list') {
    getList()
    // 采纳率数字也跟着刷：用户可能刚在聊天里「确认并运行」了一条草稿，切回管理页该看到最新值
    loadAdoptionStat()
  }
})
</script>
