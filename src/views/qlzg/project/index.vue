<template>
  <ContentWrap>
    <!--
      🔴 退化形态的常驻横幅（§2.6.5 交付物 ② 的前端那一半）。
         挂在**项目台账**而不是别处：QlzgMenuVisibilityCustomizer 藏掉
         case / caseSource / calculation / calcResult / review 之后，
         这里就是整个模块的落地页 —— 用户第一眼看到的页面。
      ⚠️ 不能挂进 ContentWrap 的 #header 插槽：那个插槽被 title 这个 prop 门控，
         本页的 ContentWrap 没有 title，塞进去的整排东西会从 DOM 里消失
         （由 src/views/qlzg/contentWrapHeaderTitle.spec.ts 钉住）
    -->
    <ModuleFormBanner />
    <!-- 搜索工作栏 -->
    <el-form
      class="-mb-15px"
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      label-width="88px"
    >
      <el-form-item label="项目编号" prop="projectNo">
        <el-input
          v-model="queryParams.projectNo"
          placeholder="请输入项目编号"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="项目名称" prop="projectName">
        <el-input
          v-model="queryParams.projectName"
          placeholder="请输入项目名称"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="委托方" prop="clientId">
        <el-select
          v-model="queryParams.clientId"
          filterable
          remote
          clearable
          reserve-keyword
          :remote-method="searchClients"
          :loading="clientLoading"
          placeholder="输入名称搜索"
          class="!w-240px"
        >
          <el-option
            v-for="item in clientOptions"
            :key="item.id"
            :label="item.clientName"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="评估品类" prop="categoryCode">
        <el-select
          v-model="queryParams.categoryCode"
          clearable
          placeholder="请选择评估品类"
          class="!w-240px"
        >
          <el-option
            v-for="item in categoryOptions"
            :key="item.categoryCode"
            :label="item.categoryName"
            :value="item.categoryCode"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="项目状态" prop="status">
        <el-select
          v-model="queryParams.status"
          clearable
          placeholder="请选择项目状态"
          class="!w-240px"
        >
          <el-option
            v-for="item in PROJECT_STATUS_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="评估目的" prop="purpose">
        <el-select
          v-model="queryParams.purpose"
          clearable
          placeholder="请选择评估目的"
          class="!w-240px"
        >
          <el-option
            v-for="item in PURPOSE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="法定评估" prop="isStatutory">
        <el-select
          v-model="queryParams.isStatutory"
          clearable
          placeholder="请选择"
          class="!w-240px"
        >
          <el-option label="是" :value="true" />
          <el-option label="否" :value="false" />
        </el-select>
      </el-form-item>
      <el-form-item label="评估基准日" prop="baseDate">
        <el-date-picker
          v-model="queryParams.baseDate"
          value-format="YYYY-MM-DD"
          type="daterange"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['qlzg:project:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 立项
        </el-button>
        <el-button type="success" plain @click="handleExport" v-hasPermi="['qlzg:project:query']">
          <Icon icon="ep:download" class="mr-5px" /> 导出
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        :index="indexMethod(queryParams)"
        class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="项目编号" align="center" prop="projectNo" width="150" />
      <el-table-column label="项目名称" align="center" prop="projectName" min-width="200" />
      <el-table-column label="委托方" align="center" prop="clientName" min-width="160" />
      <el-table-column label="评估品类" align="center" prop="categoryName" width="120" />
      <el-table-column label="评估目的" align="center" prop="purpose" width="100">
        <template #default="scope">
          {{ labelOf(PURPOSE_OPTIONS, scope.row.purpose) }}
        </template>
      </el-table-column>
      <el-table-column label="价值类型" align="center" prop="valueType" width="100">
        <template #default="scope">
          {{ labelOf(VALUE_TYPE_OPTIONS, scope.row.valueType) }}
        </template>
      </el-table-column>
      <el-table-column
        label="评估基准日"
        align="center"
        prop="baseDate"
        width="110"
        :formatter="dateFormatter2"
      />
      <el-table-column label="法定" align="center" prop="isStatutory" width="70">
        <template #default="scope">
          <el-tag v-if="scope.row.isStatutory" type="warning">法定</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="承办人员" align="center" min-width="180">
        <template #default="scope">
          <!-- 🔴 nickname 为 null 的那一项也要占位：过滤掉会让署名顺序整体前移 -->
          <span v-for="(user, index) in appraisersOf(scope.row)" :key="index">
            {{ index > 0 ? '、' : '' }}{{ user.nickname || `已离岗（${user.userId}）` }}
          </span>
          <span v-if="!appraisersOf(scope.row).length">-</span>
        </template>
      </el-table-column>
      <el-table-column label="项目负责人" align="center" prop="ownerUserName" width="110" />
      <el-table-column label="状态" align="center" prop="status" width="100">
        <template #default="scope">
          <el-tag :type="projectStatusTagType(scope.row.status)">
            {{ scope.row.statusDescription || UNKNOWN_LABEL_FALLBACK }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" align="center" min-width="300" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openMaterial(scope.row)">资料</el-button>
          <el-button
            link
            type="primary"
            @click="openReport(scope.row)"
            v-hasPermi="['qlzg:report:query']"
          >
            报告
          </el-button>
          <el-button
            v-if="scope.row.status !== 'VOIDED'"
            link
            type="primary"
            @click="openForm('update', scope.row.id)"
            v-hasPermi="['qlzg:project:update']"
          >
            编辑
          </el-button>
          <!--
            🔴 项目级复核档位的**唯一**入口就是这一个按钮，不在「编辑」表单里
               （理由写在 ProjectForm 类注释那一条「刻意不渲染」上：改档位必须留下一行
               qlzg_review_waiver，而「保存项目」这个动作不留痕）。
               后端 QlzgProjectSaveReqVO 已经摘掉了 reviewMode 那一列，
               所以就算把它做进表单也提交不上去 —— 由 QlzgReviewModeWritePathGuardTest 钉住
            🔴 作废的项目不给入口：项目级变更**只对之后新建的报告生效**，
               而作废项目下不会再有新建的报告，那一次变更除了多一行留痕以外没有任何产出
            🔴 没装复核模块也不给入口：v-hasPermi 拦不住超管（他的权限集合是 *:*:*），
               REPORT_ONLY 下点开的弹层会去调 /qlzg/review/config/org，而那个 Controller
               整个没进容器 —— 回 code=404「请求地址不存在」，HTTP 状态码却是 200。
               判据见 reviewInstalled
          -->
          <el-button
            v-if="scope.row.status !== 'VOIDED' && reviewInstalled"
            link
            type="primary"
            :loading="modeLoadingId === scope.row.id"
            @click="openReviewMode(scope.row)"
            v-hasPermi="['qlzg:review:config']"
          >
            复核档位
          </el-button>
          <el-button
            v-if="scope.row.status !== 'VOIDED'"
            link
            type="warning"
            @click="openVoid(scope.row)"
            v-hasPermi="['qlzg:project:update']"
          >
            作废
          </el-button>
          <el-button
            link
            type="danger"
            @click="handleDelete(scope.row)"
            v-hasPermi="['qlzg:project:delete']"
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

  <!-- 表单弹窗：立项 / 改项目 -->
  <ProjectForm ref="formRef" @success="getList" />

  <!-- 导出弹窗 -->
  <LedgerExportForm ref="exportFormRef" />

  <!--
    变更本项目复核档位的弹层（与机构内控配置页、复核工作台共用同一个组件）

    🔴 **不绑** @rejected：那个事件是给「页面上有一份变更历史列表」的调用方用的 ——
       被程序性拒绝的那一次后端照样写了一行 rejected = 1 的留痕，列表要刷新才看得见。
       本页没有那份列表（项目级留痕目前只能从该项目下某份报告的复核工作台读到），
       绑上去也只是空跑一次 getList，而列表里没有任何一列显示档位
  -->
  <ReviewModeChangeDialog ref="modeDialogRef" @success="getList" />

  <!-- 作废弹窗 -->
  <Dialog v-model="voidVisible" title="作废项目" width="560">
    <el-alert type="warning" :closable="false" class="mb-16px">
      <template #title>
        <span class="text-13px">作废是终态，不可逆，也不能撤销</span>
      </template>
      <div class="text-12px">
        作废后项目及其资料、标的都<b>保留</b>在档案里（仍可查询、仍可导出），只是不能再改动。
        这与「删除」不是一件事：删除只允许删掉一个还没收进任何东西的空壳。
      </div>
    </el-alert>
    <el-form ref="voidFormRef" :model="voidForm" :rules="voidRules" label-width="90px">
      <el-form-item label="项目">
        <span class="text-13px">{{ voidForm.projectName }}</span>
      </el-form-item>
      <el-form-item label="作废理由" prop="voidReason">
        <el-input
          v-model="voidForm.voidReason"
          type="textarea"
          :rows="4"
          maxlength="500"
          show-word-limit
          placeholder="请写明作废原因，这段话会留在档案里"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="voidLoading" type="danger" @click="submitVoid">确认作废</el-button>
      <el-button @click="voidVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { dateFormatter2 } from '@/utils/formatTime'
import { QlzgCategoryApi, type QlzgCategorySimpleVO } from '@/api/qlzg/category'
import { QlzgClientApi } from '@/api/qlzg/client'
import { QlzgProjectApi, type QlzgAppraiser, type QlzgProjectVO } from '@/api/qlzg/project'
import { QlzgReportApi } from '@/api/qlzg/report'
import { QlzgReviewConfigApi, type QlzgOrgReviewConfigVO } from '@/api/qlzg/reviewConfig'
import {
  PROJECT_STATUS_OPTIONS,
  PURPOSE_OPTIONS,
  UNKNOWN_LABEL_FALLBACK,
  VALUE_TYPE_OPTIONS,
  labelOf,
  projectStatusTagType
} from '@/views/qlzg/constants'
import ProjectForm from './ProjectForm.vue'
import ReviewModeChangeDialog from '../review/ReviewModeChangeDialog.vue'
import LedgerExportForm from '@/views/qlzg/components/LedgerExportForm.vue'
import { isInstalled, loadModuleForm } from '@/views/qlzg/moduleForm'
// ⚠️ src/views/** 下的组件不在自动导入清单里（只有 src/components/** 在），必须显式 import
import ModuleFormBanner from '@/views/qlzg/components/ModuleFormBanner.vue'

/**
 * 评估项目台账
 *
 * <h3>🔴 「作废」与「删除」是两个动作，界面上刻意分开摆</h3>
 * 用户说「把这个做废了的单子删掉」时，他要的其实是**作废**：
 * 删除只允许删掉一个还没收进任何标的与资料的**空壳**
 * （否则后端抛 {@code PROJECT_NOT_EMPTY_FOR_DELETE}），而作废保留全部档案、只是不能再改。
 * 把两者混成一个「删除」按钮的后果是：用户点了删除、收到一句拒绝、
 * 然后以为「这单子删不掉了」——而真正的出路（作废）就摆在旁边却没被指出来。
 * 所以删除的确认框里会直接把人引向作废。
 *
 * <h3>🔴 列表展示一律用后端算好的描述字段</h3>
 * 状态用 {@code statusDescription}、品类用 {@code categoryName}、委托方用 {@code clientName}、
 * 负责人用 {@code ownerUserName}，都是服务端解析好发来的。前端再建一份状态映射就会与枚举分叉，
 * 表现是「列表里显示『资料收集』、点进去显示『MATERIAL』」。
 * {@code PROJECT_STATUS_OPTIONS} 那份本地清单只服务于**筛选下拉** ——
 * 那个场景后端不给列表，只给单行的描述。
 *
 * <h3>🔴 「复核档位」是这一行上唯一改复核配置的入口，而它<b>不在</b>「编辑」表单里</h3>
 * 改档位必须留下一行 {@code qlzg_review_waiver}（谁、什么时候、≥10 字的理由、
 * 法定评估业务的告知勾选），而「保存项目」这个动作不留痕。
 * 后端 {@code QlzgProjectSaveReqVO} 因此**一并摘掉了** {@code reviewMode} 那一列
 * （与 {@code projectNo} / {@code status} 同一条纪律，由
 * {@code QlzgReviewModeWritePathGuardTest} 钉住）—— 表单里放一个下拉是提交不上去的。
 * ⚠️ 也别为了「少点一次」把它并进表单：那样一次「保存项目」就会顺手改掉档位，
 * 而 §11.9.2.6 要防的恰恰是「赶稿的那一刻被顺手点掉」。
 *
 * <h3>⚠️ 承办人员那一列不能过滤掉 nickname 为空的项</h3>
 * 用户被删或当前登录人无权看见时，后端给的是 {@code nickname: null} 而**不是**少一个人。
 * 过滤掉的话署名顺序会整体前移，而 {@code appraiserUserIds} 的顺序就是报告署名顺序 ——
 * 那是会印在报告上的东西。所以这里渲染成「已离岗（编号）」占位。
 */
defineOptions({ name: 'QlzgProject' })

const message = useMessage()
const { t } = useI18n()
const { push } = useRouter()

const loading = ref(true)
const total = ref(0)
const list = ref<QlzgProjectVO[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  projectNo: '',
  projectName: '',
  clientId: undefined as number | undefined,
  categoryCode: undefined as string | undefined,
  status: undefined as string | undefined,
  purpose: undefined as string | undefined,
  isStatutory: undefined as boolean | undefined,
  baseDate: [] as string[]
})
const queryFormRef = ref()

const categoryOptions = ref<QlzgCategorySimpleVO[]>([])
const clientOptions = ref<{ id: number; clientName: string }[]>([])
const clientLoading = ref(false)

/**
 * 承办人员列表
 *
 * 🔴 原样返回，**不按 nickname 过滤**：后端在用户被删或当前登录人无权看见时给的是
 *    {@code nickname: null} 而不是少一个人，过滤掉会让署名顺序整体前移。
 *    而 {@code appraiserUserIds} 的顺序就是报告署名顺序 —— 那是会印在报告上的东西。
 *
 * <p>⚠️ 单独抽一个函数也是为了让模板拿到 {@code QlzgAppraiser[]}：
 *    表格插槽里的 {@code scope.row} 是 any，直接在模板上写
 *    {@code scope.row.appraiserUsers ?? []} 会让 v-for 的下标退化成
 *    {@code string | number}（Vue 的 v-for 类型要同时覆盖数组、对象、数字与字符串），
 *    于是 {@code index > 0} 这种比较过不了类型检查。
 */
const appraisersOf = (row: QlzgProjectVO): QlzgAppraiser[] => row.appraiserUsers ?? []

/** 查询项目列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await QlzgProjectApi.getProjectPage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

/** 搜索按钮操作 */
const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}

/** 重置按钮操作 */
const resetQuery = () => {
  queryFormRef.value.resetFields()
  clientOptions.value = []
  handleQuery()
}

/**
 * 导出按钮操作
 *
 * 🔴 这里只负责把「当前查的是什么」交过去，范围选择、上限提示、截断警告、
 * 真正的下载全在 `LedgerExportForm` 里 —— 四个台账共用那一份，理由见它的组件注释。
 *
 * ⚠️ `ledgerName` 必须与后端 `extColumnExporter.write(...)` 收到的那个字符串**逐字相同**：
 * 它同时是弹窗标题、Excel 的 sheet 名与下载文件名前缀，两边各写一份就会分叉，
 * 而分叉的表现只是「文件名和 sheet 名不一样」，没有任何测试会发现
 */
const exportFormRef = ref()
const handleExport = () => {
  exportFormRef.value?.open({
    ledgerName: '项目台账',
    fetcher: QlzgProjectApi.exportExcel,
    pageNo: queryParams.pageNo,
    pageSize: queryParams.pageSize,
    total: total.value,
    buildParams: () => ({ ...queryParams }),
    contentHints: [
      '按列表当前显示的列导出：状态导中文，负责人与承办人员导姓名，日期保留可计算的真值。',
      '不导出编号类字段（委托方编号、品类编码、负责人编号等）——台账是给人看的，编号在里面只是噪音。',
      '评估目的与价值类型导出的是编码原文（如 MORTGAGE / MARKET_VALUE）：这两个字段目前没有枚举也没有字典，中文清单只存在于前端的下拉里，服务端拿不到。'
    ]
  })
}

/** 委托方远程搜索。🔴 委托方没有 simple-list：一个机构几万个主数据，不能一次性拉全量 */
const searchClients = async (keyword: string) => {
  if (!keyword) return
  clientLoading.value = true
  try {
    const data = await QlzgClientApi.getClientPage({ pageNo: 1, pageSize: 20, clientName: keyword })
    clientOptions.value = data.list.map((item) => ({ id: item.id, clientName: item.clientName }))
  } finally {
    clientLoading.value = false
  }
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

/** 进资料面板。🔴 资料页按 projectId 复用，不读路由之外的任何东西 */
const openMaterial = (row: QlzgProjectVO) => {
  push({ path: '/qlzg/material', query: { projectId: row.id } })
}

/**
 * 进这个项目的报告台账
 *
 * 🔴 报告台账是**菜单页**（它带 `qlzg:report:*` 那一族按钮），所以这里跳的是它自己的
 *    path，`projectId` 走 query —— 台账页认这个键并预填搜索栏，与资料页同一套复用手法。
 *    报告作业台则是 `/qlzg-report/workbench` 那条静态路由，**不要**从这里直接跳过去：
 *    作业台要的是 reportId，而一个项目下可能有好几份报告（结果报告、技术报告、
 *    以及作废后重出的那一份），挑哪一份是台账页那一行的事。
 */
const openReport = (row: QlzgProjectVO) => {
  push({ path: '/qlzg/report', query: { projectId: row.id } })
}

// ==================== 变更项目级复核档位 ====================

const modeDialogRef = ref()
/** 正在读弹层上下文的那一行。🔴 按行记，不用一个全局 loading：全局的那个会让六个按钮一起转 */
const modeLoadingId = ref<number | null>(null)

/**
 * 「复核档位」这个按钮**画不画**
 *
 * <p>🔴 它已经挂了 {@code v-hasPermi="['qlzg:review:config']"}，但那**不足以**在退化形态下藏掉它：
 * 超管的权限集合是 {@code *:*:*}，什么权限点都拦不住他。于是在 REPORT_ONLY 形态下这个按钮照画，
 * 点开的弹层调 {@code /qlzg/review/config/org} —— 那个 Controller 归
 * {@code @QlzgModuleGate(REVIEW)}，整个没进容器，回 {@code code=404「请求地址不存在」}。
 * 而**本仓 404 的 HTTP 状态码是 200**，弹层就停在「当前档位：未知」上，后端日志干净。
 * 与标的台账那三个跨模块按钮、报告作业台的「复核工作台」入口是同一类缺陷
 *
 * <p>⚠️ 取不到形态时 {@code isInstalled} 一律答 true（理由写在 {@code moduleForm.ts} 的文件头），
 * 即按钮**照常出现** —— 与 {@code QlzgMenuVisibilityCustomizer}「认不出归属当 CORE 处理」同向。
 * 漏画的代价是「多一个点开是空的入口」，误画的代价是
 * 「一个装着的功能从台账上消失了」，后者严重得多
 */
const reviewInstalled = computed(() => isInstalled('review'))

/**
 * 打开项目级变更弹层
 *
 * <h3>🔴 三个请求刻意用 {@code allSettled}，不是 {@code all}</h3>
 * 它们要三个<b>不同</b>的权限点，而失败之后的处理<b>不一样</b>：
 * <ul>
 *   <li>{@code /config/org} 与项目详情供的是弹层那两个必须的数（当前档位、告知文案）。
 *       少一个就<b>不开</b> —— 开一个「当前档位：未知」的弹层，用户会照着它挑，
 *       而后端 CAS 拿真实值一比就拒（{@code REVIEW_MODE_CONFIG_CONCURRENT}），
 *       那一次往返除了「功能坏了」的印象以外没有任何产出。
 *       与机构内控配置页 {@code ModePanel#openChangeDialog} 同一条纪律。</li>
 *   <li>报告清单<b>只</b>用来算那个 N。读不到就传 null ——
 *       持有 {@code qlzg:review:config} 的人不一定有 {@code qlzg:report:query}，
 *       用 {@code all} 的话一次 403 会把整个入口一起吞掉，
 *       而弹层对「N 取不到」本来就有一套如实的文案。</li>
 * </ul>
 *
 * <h3>🔴 {@code currentEffectiveMode} 传**解析后**的档位，不是那一列的字面值</h3>
 * {@code qlzg_project.review_mode} 可空，空的含义是「跟着机构级走」。
 * 后端 {@code assertChanged} 比的是解析后的值（{@code QlzgReviewModeServiceImpl#changeProjectMode}
 * 类内那句「from / to 都是『本项目之后新建报告会拿到的档位』」），
 * 前端要比出同一个结论就得做同一次解析 —— 按字面值比的话，
 * 「已经是继承、又选一次跟随机构配置」会被判成一次变更，于是放过一次必然被拒的提交
 *
 * <h3>🔴 {@code statutory} 取**项目自己那一列**，不是 {@code /config/org} 那个 statutory</h3>
 * 后端判的是 {@code Boolean.TRUE.equals(project.getIsStatutory())}，
 * 而 org 那个是 {@code countStatutoryActive() > 0}
 * （含义是「本机构名下**有**法定评估项目」，一个保守的超集）。
 * 拿超集去判，一个非法定项目会印出「本次变更涉及法定评估业务」并要求勾告知，
 * 而后端那一边压根不校验这个勾 —— 界面上多出来的那段红字不会被任何一处拦下，
 * 它说的只是一件与这个项目无关的事
 */
const openReviewMode = async (row: QlzgProjectVO) => {
  if (modeLoadingId.value != null) return
  modeLoadingId.value = row.id
  const [orgRes, projectRes, reportsRes] = await Promise.allSettled([
    QlzgReviewConfigApi.getOrgConfig(),
    QlzgProjectApi.getProject(row.id),
    QlzgReportApi.getReportListByProject(row.id)
  ])
  modeLoadingId.value = null
  const org: QlzgOrgReviewConfigVO | null = orgRes.status === 'fulfilled' ? orgRes.value : null
  const project: QlzgProjectVO | null = projectRes.status === 'fulfilled' ? projectRes.value : null
  // 🔴 报错原文已由 axios 拦截器弹出来了，这里**不补**一句自己的
  //    （本模块的纪律是「把后端那句原文显示出来，不要自己猜」），也**不 rethrow** ——
  //    本函数是 @click 的处理器，抛出去只会变成一条没人接的 promise 拒绝
  if (!org || !project) return
  const reports = reportsRes.status === 'fulfilled' ? reportsRes.value : null
  modeDialogRef.value?.open({
    level: 'PROJECT',
    scopeLabel: '本项目之后新建的报告',
    currentEffectiveMode: project.reviewMode || org.reviewMode,
    statutory: project.isStatutory ?? false,
    noticeText: org.noticeText ?? null,
    // 🔴 数的是**本项目**下 DRAFT 的份数，不是 /config/org 那个 draftReportCount ——
    //    后者是本机构**全部**在编报告。拿它去说「已在编制的 N 份报告不受影响」，
    //    会把别的项目的报告一起算进来，而那句话就印在本项目的弹层里。
    //    判据与后端 QlzgReportStatusEnum#editable() 逐字相同（「是 DRAFT」，
    //    不是「不是 FINALIZED 且不是 VOIDED」）
    draftReportCount: reports ? reports.filter((item) => item.status === 'DRAFT').length : null,
    inheritResolvesTo: org.reviewMode,
    projectId: project.id
  })
}

/** 删除按钮操作 */
const handleDelete = async (row: QlzgProjectVO) => {
  try {
    await message.delConfirm(
      `确定要删除项目「${row.projectName}」吗？` +
        '只有还没收进任何标的与资料的空壳项目能删；' +
        '已经有资料的项目请改用「作废」——作废会保留全部档案，删除不会。',
      '删除项目'
    )
    await QlzgProjectApi.deleteProject(row.id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

// ==================== 作废 ====================

const voidVisible = ref(false)
const voidLoading = ref(false)
const voidFormRef = ref()
const voidForm = reactive({
  id: undefined as number | undefined,
  projectName: '',
  voidReason: ''
})
const voidRules = reactive({
  voidReason: [{ required: true, message: '作废理由不能为空', trigger: 'blur' }]
})

const openVoid = (row: QlzgProjectVO) => {
  voidForm.id = row.id
  voidForm.projectName = `${row.projectNo}　${row.projectName}`
  voidForm.voidReason = ''
  voidVisible.value = true
  voidFormRef.value?.clearValidate()
}

const submitVoid = async () => {
  if (!voidFormRef.value || !voidForm.id) return
  const valid = await voidFormRef.value.validate()
  if (!valid) return
  voidLoading.value = true
  try {
    await QlzgProjectApi.voidProject({ id: voidForm.id, voidReason: voidForm.voidReason.trim() })
    message.success('项目已作废')
    voidVisible.value = false
    await getList()
  } finally {
    voidLoading.value = false
  }
}

/** 初始化 **/
onMounted(async () => {
  // 🔴 形态快照**自己**取一次，不靠 <ModuleFormBanner> 顺手预热那份：
  //    「按钮画不画」依赖另一个组件的挂载顺序是隐式耦合，而漏掉的后果是**静默**的
  //    （isInstalled 取不到形态答 true ⟹ 按钮照常出现 ⟹ 与修复前一模一样）。
  //    loadModuleForm 带缓存与 in-flight 去重，两处都调也只发一次请求
  loadModuleForm()
  await getList()
  categoryOptions.value = await QlzgCategoryApi.getSimpleList()
})
</script>
