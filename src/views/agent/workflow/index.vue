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

  🔴 删除（2026-10-09）：可删判据从「只有草稿」放宽到「草稿 + 已停用」，并新增勾选列与批量删除。
     判据由服务端派生成 row.deletable 下发（与 editable 同一套 G14 收敛手法），前端**不**自己判 status。
     已停用的行曾发布过、名下可能有执行史，后端删除时连带软删执行行与节点 trace、并释放 checkpoint。
     ⚠️ 后端另有一档 force-delete（能删**已发布**的行、仅 super_admin 持有），本页**不暴露**它 ——
        它不是常规删除的复数形式，爆炸半径差一个数量级，没有 UI 是现状而非遗漏。

  权限（增量14a 拆分，与后端 AgentWorkflowDefController @PreAuthorize 逐字一致）：
     读（查看画布/执行历史）= agent:workflow:query；新增 = :create；编辑 = :update；
     删除（单删与批量删**共用**同一个点）= :delete；
     发布/停用 = :publish；发起执行（run/resume/event，在 ExecutionHistoryDrawer）= :run。
     按钮权限行 + 角色授权见 sql/mysql/xpy-2026-09-27-agent-fine-grained-perms.sql（super_admin 绕过一切权限点）。
     🔴 批量删除**不需要**新的授权脚本：沿用 :delete，理由同后端（批量只是单删的复数形式）。
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
          <!--
            批量删除（2026-10-09）。🔴 只有 row.deletable（草稿 / 已停用）的行勾得上，与单行删除同口径；
               已发布行须先停用再删 —— 否则一整页勾选能把线上正被触发入口选用的流程连带清掉。
            🔴 规则藏在灰掉的复选框里没人能猜到，故用 tooltip 说明（同 views/agent/def 的做法）。
               包一层 span 是因为禁用的 el-button 不派发鼠标事件，tooltip 挂不上去。
            🔴 这里用 checkPermi 而不是 v-hasPermi：整枚按钮（含 tooltip 外壳）要一起消失。
               只把内层按钮 v-hasPermi 掉的话，没权限的人会看到一枚永远灰着、悬停还有说明的空壳。
          -->
          <el-tooltip
            v-if="checkPermi(['agent:workflow:delete'])"
            content="仅「草稿 / 已停用」的流程可勾选；已停用的行名下若有执行历史，会一并清掉"
            placement="top"
          >
            <span class="ml-12px align-middle">
              <el-button
                type="danger"
                plain
                :disabled="checkedIds.length === 0"
                @click="handleDeleteBatch"
                data-testid="wf-batch-delete-btn"
              >
                <Icon icon="ep:delete" class="mr-5px" />
                批量删除{{ checkedIds.length ? `（${checkedIds.length}）` : '' }}
              </el-button>
            </span>
          </el-tooltip>
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
      <el-table
        class="xpy-list-table"
        stripe
        v-loading="loading"
        :data="list"
        @selection-change="handleRowCheckboxChange"
      >
        <!--
          批量删除的勾选列（2026-10-09）。🔴 selectable 把不该删的行直接灰掉，
             而不是让用户勾上之后再换来一次「整批被拒」。
          🔴 判据读服务端下发的 row.deletable，**不**在这里写
             `status === 'DRAFT' || status === 'DISABLED'` —— 智能体页（views/agent/def）那份
             isRowSelectable 是自己判 status 的，本页有 deletable 这一格，别照抄过来（G14 的那份重复）。
          ⚠️ 前端挡这一道只是 UX，真判据在后端：还有 pin 与在途执行两道闸门要扫**别的行**，
             deletable 预测不了它们。绕过前端直调接口照样整批被拒。
        -->
        <el-table-column type="selection" width="44" :selectable="isRowSelectable" />
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
        <!-- 这里不显示「编号」：流程是拿流程编码和流程名称认的，自增 id 对使用者没有意义。
             id 本身照旧在行数据里 —— 设计器路由（?id=）、执行历史、版本抽屉都按它取行 -->
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
        <!--
          负责人 = 这条流程触发时「以谁的身份跑」（后端 AgentWorkflowDefDO#ownerUserId：
          权限由 yudao 权限 API 按此 userId 从库实时派生，为 NULL 时 fail-close 跳过）。
          所以这一格不是普通的审计字段，它回答的是「这个自动化继承了谁的权限」——
          显示成裸 id 等于没显示。改用与接口管理「更新者」同一套映射（useUserLabel）。
          宽度 180 是浏览器实测值：现值最长「超级管理员（admin）」在 .cell 里 scrollWidth=164
          （含左右内边距 24px），160 的列会差 6px 而出省略号；180 留 14px 余量，
          更长的昵称仍交给 show-overflow-tooltip
        -->
        <el-table-column
          label="负责人"
          align="center"
          prop="ownerUserId"
          width="180"
          show-overflow-tooltip
          :formatter="ownerFormatter"
        />
        <el-table-column
          label="创建时间"
          align="center"
          prop="createTime"
          width="180"
          :formatter="dateFormatter"
        />
        <!--
          操作列收敛到 TableActions：草稿行 7 个动作 → 行内 3 枚 + 「更多」×4，
          列宽从 min-width 520 改成固定 width（浏览器 100% 缩放实测，数字见提交说明）。
          旧 520 的依据是「草稿行 8 枚 link 钮实测 436px」——出处 e2e spec 已随 tests/
          删除，本就只剩量级参考意义；折叠后行内只有 4 字+4 字+2 字+更多，量级完全不同，故重新量。
          🔴 「查看画布」2026-10-11 退役：只读画布与「查看设计」同质，两个入口只留后者；
             它曾是 WorkflowCanvasDialog 的唯一入口，按钮没了对话框也就没人挂，组件一并删除。
          🔴 不可删行的「删除」保持禁用 + tooltip（后端下发的 deleteDeniedReason）：
             理由不能因为折叠而消失，TableActions 对行内与「更多」下拉项都挂 tooltip。
          🔴 2026-10-09 那枚非草稿行的实心「复制为新草稿」主操作随折叠退役：进「更多」后
             与其余项同为纯文字（组件契约：下拉里不加料），再在行内单留一枚实心钮
             等于在同一个单元格里养第二套渲染路径。它的文案保留在下拉项里。
          行级判据原样搬进 rowButtons 配置，一条没改：设计/查看设计 与 编辑 按 editable、
          发布/停用 按 status（可发布性与可编辑性是两条规矩，服务端只下发了后者）、
          删除 按 deletable（草稿 + 已停用，与 editable 自 2026-10-09 起分家）。
        -->
        <el-table-column label="操作" align="center" width="270" fixed="right">
          <template #default="scope">
            <TableActions :row="scope.row" :buttons="rowButtons" />
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
import { checkPermi } from '@/utils/permission'
import {
  AgentWorkflowApi,
  type AgentWorkflowDefVO,
  type AgentPlannerAdoptionStatVO
} from '@/api/agent/workflow'
import ExecutionHistoryDrawer from './components/ExecutionHistoryDrawer.vue'
import WorkflowVersionDrawer from './components/WorkflowVersionDrawer.vue'
import WorkflowForm from './components/WorkflowForm.vue'
import TriggerCaseDialog from './editor/components/TriggerCaseDialog.vue'
import PublishGateDialog from './components/PublishGateDialog.vue'
import WorkflowCopyDialog from './components/WorkflowCopyDialog.vue'
import { precheckPublish } from './publishGate'
import { triggerTypeLabel } from './editor/triggerCases'
import type { TableActionButton } from '@/components/TableActions'
import { useUserLabel } from '@/hooks/web/useUserLabel'

defineOptions({ name: 'AgentWorkflow' })

const message = useMessage()
const { push } = useRouter()

// hooks/web 下新建的 hook 不在 build/vite/index.ts 的自动导入白名单里，必须显式 import
const { userFormatter: ownerFormatter } = useUserLabel('负责人')

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
    // 翻页/搜索/删除后清空勾选：checkedIds 存的是编号，而列表已经换了一茬。留着旧编号不只是
    // 「批量删除（N）」的 N 与页面上看得见的勾选数对不上 —— 那批编号可能已经指向别的行，
    // 于是用户看着勾了 3 条、点下去删掉的是另外 3 条（同 views/agent/def 的做法）。
    // el-table 换数据时本身会重算选中态并触发 selection-change，这里显式清一次是不依赖那个时序。
    checkedIds.value = []
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

/**
 * 🔴 这**不是**后端那句 deleteDeniedReason 的第二份副本：只有 `deletable` / `deleteDeniedReason`
 *   两格都拿不到（对接的是还没有这两个派生属性的旧后端）时才会用到它 —— 那种情况下 tooltip
 *   会是空的，用户只看到一枚灰掉的「删除」而得不到任何理由。
 *   措辞刻意不点名任何具体状态，与后端文案同一条纪律（点名会让另一档配上错话）。
 */
const DELETE_DENIED_FALLBACK = '当前状态不可删除'

/**
 * 操作列按钮配置。⚠️ 必须是 setup 层 const（TableActions 的契约）：写成每行调一次的
 * 工厂函数会每次渲染新建数组、computed 的依赖追踪也会退化；行级差异全靠下面的函数表达。
 * 顺序即行内 / 下拉里的顺序：只读类在前，写动作居中，删除垫底并带 divided。
 */
const rowButtons: TableActionButton[] = [
  {
    key: 'history',
    label: '执行历史',
    permission: ['agent:workflow:query'],
    onClick: (row) => openHistory(row)
  },
  {
    key: 'versions',
    label: '版本',
    permission: ['agent:workflow:query'],
    onClick: (row) => openVersions(row)
  },
  // S5-d：设计常显、文案按 editable 切；权限是 query 不是 update（只读查看不该要写权限）
  {
    key: 'design',
    label: (row) => (row.editable ? '设计' : '查看设计'),
    permission: ['agent:workflow:query'],
    onClick: (row) => openEditor(row)
  },
  {
    key: 'update',
    label: '编辑',
    permission: ['agent:workflow:update'],
    show: (row) => !!row.editable,
    onClick: (row) => openFormEdit(row)
  },
  // 发布/停用判 status 不判 editable：可发布性与可编辑性是两条规矩，服务端只下发了后者
  {
    key: 'publish',
    label: '发布',
    type: 'success',
    permission: ['agent:workflow:publish'],
    show: (row) => row.status === 'DRAFT',
    onClick: (row) => handlePublish(row)
  },
  {
    key: 'disable',
    label: '停用',
    type: 'warning',
    permission: ['agent:workflow:publish'],
    show: (row) => row.status === 'PUBLISHED',
    onClick: (row) => handleDisable(row)
  },
  // 复制所有状态都可用（草稿/已发布/已停用都能当模板抄），权限归 create
  {
    key: 'copy',
    label: (row) => (row.editable ? '复制' : '复制为新草稿'),
    permission: ['agent:workflow:create'],
    onClick: (row) => openCopy(row)
  },
  // 删除判 deletable（草稿+已停用）；不可删时禁用 + tooltip 给后端理由，而不是整枚隐藏
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['agent:workflow:delete'],
    disabled: (row) => !row.deletable,
    tooltip: (row) => (row.deletable ? '' : row.deleteDeniedReason || DELETE_DENIED_FALLBACK),
    onClick: (row) => handleDelete(row)
  }
]

/**
 * 单行删除：草稿与已停用可删（已发布须先停用）
 *
 * 🔴 确认框文案**不点名状态**：判据放宽到「草稿 + 已停用」之后，原来那句「确认删除草稿流程…」
 *    对已停用的行就是假话 —— 状态徽标写着「已停用」、弹窗却说「草稿」，用户会怀疑自己点错了行。
 * 🔴 必须说出**连带清执行史**：已停用意味着曾发布过，名下可能有执行史与节点 trace，后端会一并软删。
 *    只说「删除后不可恢复」不足以让人知道连带清掉的是哪些东西。
 *    ⚠️ 用「若…会一并清掉」而不是断言有：草稿名下确实一条都没有，断言就成了另一句假话。
 * ⚠️ 后端还有两道闸门（被 pin / 有在途执行）会拒删，那句 msg 由 axios 拦截器弹通知，
 *    这里**不要**另编一份文案（编出来的会与后端点名的那一行对不上）。
 */
const handleDelete = async (row: AgentWorkflowDefVO) => {
  try {
    await message.delConfirm(
      `确认删除流程「${row.name || row.code}」(v${row.version})？删除后不可恢复；` +
        '若它名下有执行历史与节点明细，会一并清掉。'
    )
    await AgentWorkflowApi.deleteDef(row.id)
    message.success('删除成功')
    await getList()
  } catch {}
}

// ==================== 批量删除（2026-10-09）====================

const checkedIds = ref<number[]>([])

/**
 * 哪些行勾得上：读服务端下发的 {@code row.deletable}
 *
 * 🔴 **不在这里重写判据**（不写 `status === 'DRAFT' || status === 'DISABLED'`）。
 *   同产品线的智能体页（views/agent/def）那份 isRowSelectable 是自己判 status 的，
 *   本页有 deletable 这一格，抄那份就是把后端 `WorkflowDefStatusEnum#isDeletable`
 *   在前端复写一遍 —— G14 要收敛的正是这种重复。
 * 🔴 真值判断而不是 `!== false`：拿不到这一格时按「勾不上」处理，与后端对 status 为空的处理同方向。
 * ⚠️ 这一道只是 UX。deletable 只覆盖状态闸门；被 pin / 有在途执行那两道要扫**别的行**，
 *   列表接口不会为每行预算，故「勾上了却整批被拒」是预期内的，权威理由是后端返回的那句 msg。
 */
const isRowSelectable = (row: AgentWorkflowDefVO) => !!row.deletable

const handleRowCheckboxChange = (rows: AgentWorkflowDefVO[]) => {
  checkedIds.value = rows.map((row) => row.id)
}

/**
 * 批量删除。后端是「全成或全不成」：所有行的三道闸门全跑完才开始动任何数据，
 * 有一条不合规就整批拒绝、一条都不少。这么设计不是因为整洁 ——
 * 释放 checkpoint 发的是真实 UPDATE，`@Transactional` 回滚不了它。
 *
 * 🔴 确认框把要删的名字列出来（最多 5 个 +「等 N 个」）：批量删不可恢复，
 *   只显示数量不足以让人发现「勾错了」。
 * 🔴 文案点名**连带清执行史**，且**不点名状态** —— 勾中的可能既有草稿也有已停用的行，
 *   写死「草稿」对后者是假话（与上面单行删除同一条纪律）。
 */
const handleDeleteBatch = async () => {
  if (checkedIds.value.length === 0) {
    return
  }
  const rows = list.value.filter((row) => checkedIds.value.includes(row.id))
  const names = rows.map((row) => `「${row.name || row.code}」v${row.version}`)
  const preview =
    names.length <= 5 ? names.join('、') : `${names.slice(0, 5).join('、')} 等 ${names.length} 个`
  try {
    await message.delConfirm(
      `确认删除选中的 ${names.length} 条流程：${preview}？删除后不可恢复；` +
        '若它们名下有执行历史与节点明细，会一并清掉。'
    )
    await AgentWorkflowApi.deleteDefList(checkedIds.value)
    message.success('删除成功')
    // getList 内部会清空勾选
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
