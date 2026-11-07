<template>
  <ContentWrap>
    <!-- 搜索工作栏 -->
    <el-form class="-mb-15px" :model="queryParams" :inline="true" label-width="88px">
      <el-form-item label="所属项目" prop="projectId">
        <el-select
          v-model="queryParams.projectId"
          filterable
          remote
          clearable
          reserve-keyword
          :remote-method="searchProjects"
          :loading="projectLoading"
          placeholder="输入项目名称搜索"
          class="!w-240px"
          @change="getList"
        >
          <el-option
            v-for="item in projectOptions"
            :key="item.id"
            :label="`${item.projectNo}　${item.projectName}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button :loading="loading" :disabled="!queryParams.projectId" @click="getList">
          <Icon icon="ep:refresh" class="mr-5px" /> 刷新
        </el-button>
        <el-button
          type="primary"
          plain
          :disabled="!queryParams.projectId"
          @click="openForm"
          v-hasPermi="['qlzg:report:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新建报告
        </el-button>
        <el-button @click="goTemplate">
          <Icon icon="ep:document" class="mr-5px" /> 报告模板
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap title="报告台账">
    <template #header>
      <div class="flex items-center justify-end w-full">
        <span class="form-hint">
          共 {{ list.length }} 份<span v-if="queryParams.projectId">（本项目全部报告，含已作废）</span>
        </span>
      </div>
    </template>

    <!--
      🔴 没有「全部报告」这个视图，不是漏做：后端只有 /list-by-project，
         报告台账是**从项目进去**的，与「测算」「结果确定」两页同一个入口形状。
         直接敲 URL 落到这一支时，渲染一张空表会被读成「这个机构一份报告都没有」，
         而真相只是缺一个入参 —— 所以这里把话说明白，并且给出项目搜索框
    -->
    <el-alert v-if="!queryParams.projectId" type="warning" :closable="false" show-icon class="mb-12px">
      <template #title>先在上方选一个项目</template>
      <div>
        报告是按<b>项目</b>列出来的（一个项目下可以有多个标的，每个标的可以出多份报告）。
        也可以从「项目台账」某一行的操作里点「报告」直接进来。
      </div>
    </el-alert>

    <el-alert
      v-else-if="loadError"
      type="error"
      :closable="false"
      show-icon
      :title="loadError"
      class="mb-12px"
    />

    <el-descriptions v-if="project" :column="3" border size="small" class="mb-12px">
      <el-descriptions-item label="项目">
        {{ project.projectNo }}　{{ project.projectName }}
      </el-descriptions-item>
      <el-descriptions-item label="品类">{{ project.categoryName || project.categoryCode }}</el-descriptions-item>
      <el-descriptions-item label="评估基准日">{{ project.baseDate || '—' }}</el-descriptions-item>
    </el-descriptions>

    <!--
      🔴 这张表**不过滤**：VOIDED 也在里面。报告号的唯一性查全库**含 VOIDED**
         （作废掉的号也不会被复用），所以「这一号为什么没了」必须能从台账上答出来。
         只列活着的报告，等于把作废这件事从档案里抹掉
    -->
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list" :row-class-name="rowClassName">
      <el-table-column label="序号" type="index" width="44" align="center" />
      <el-table-column label="报告号" prop="reportNo" width="180" />
      <el-table-column label="标题" min-width="220">
        <template #default="scope">
          {{ reportTitleOf(scope.row, labelOf(REPORT_TYPE_OPTIONS, scope.row.reportType)) }}
        </template>
      </el-table-column>
      <el-table-column label="交付物" width="110" align="center">
        <template #default="scope">
          {{ scope.row.reportTypeDescription || labelOf(REPORT_TYPE_OPTIONS, scope.row.reportType) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100" align="center">
        <template #default="scope">
          <el-tag :type="reportStatusTagType(scope.row.status)" size="small">
            {{ scope.row.statusDescription || labelOf(REPORT_STATUS_OPTIONS, scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="本报告版本" width="100" align="center">
        <template #default="scope">第 {{ scope.row.versionNo ?? 1 }} 版</template>
      </el-table-column>
      <el-table-column label="成稿" width="110" align="center">
        <template #default="scope">
          <!--
            🔴 三档必须是三句话：STALE 说的是「那份 Word 里是改之前的值」，
               NEVER 说的是「手上什么都没有」。共用一句提示的话，
               评估师会把一份旧值的 Word 交出去 —— 而两份文件在纸面上长得一模一样
          -->
          <el-tooltip :content="composeStateText(scope.row)" placement="top">
            <el-tag :type="composeStateTagType(scope.row)" size="small">
              {{ composeStateLabel(scope.row) }}
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="残留占位符" width="170" align="center">
        <template #default="scope">
          <span :class="scope.row.placeholderRemaining > 0 ? 'warn-text' : 'form-hint'">
            {{ placeholderRemainingText(scope.row) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="作业档位" width="130" align="center">
        <template #default="scope">
          {{ labelOf(WORK_MODE_OPTIONS, scope.row.mode) || scope.row.mode || '—' }}
        </template>
      </el-table-column>
      <el-table-column label="token 成本" width="110" align="right">
        <template #default="scope">
          <!--
            🔴 这一格是 D2 验收的可对账证据，恒为 0.000000。
               显示成「¥0」的话，客户 IT 拿它去对库里那一列会对不上
          -->
          <span class="mono">{{ tokenCostText(scope.row.tokenCost) }}</span>
        </template>
      </el-table-column>
      <el-table-column
        label="定稿时间"
        align="center"
        prop="finalizedAt"
        width="170"
        :formatter="dateFormatter"
      />
      <el-table-column label="作废" width="150" align="center">
        <template #default="scope">
          <span v-if="scope.row.status === 'VOIDED'" class="form-hint">
            {{ voidedByText(scope.row) }}
          </span>
          <span v-else class="form-hint">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" align="center" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            @click="openWorkbench(scope.row.id)"
            v-hasPermi="['qlzg:report:query']"
          >
            {{ scope.row.status === 'VOIDED' ? '查看' : '作业台' }}
          </el-button>
          <el-button
            link
            type="primary"
            :disabled="!scope.row.wordFileId"
            @click="download(scope.row)"
            v-hasPermi="['qlzg:report:query']"
          >
            下载
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="queryParams.projectId ? '这个项目还没有报告' : '请先选一个项目'">
          <el-button
            v-if="queryParams.projectId"
            type="primary"
            plain
            @click="openForm"
            v-hasPermi="['qlzg:report:create']"
          >
            建第一份报告
          </el-button>
        </el-empty>
      </template>
    </el-table>
  </ContentWrap>

  <ReportForm ref="formRef" :project="project" @success="getList" />
</template>
<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import { QlzgProjectApi, type QlzgProjectVO } from '@/api/qlzg/project'
import { QlzgReportApi, type QlzgReportVO } from '@/api/qlzg/report'
import {
  REPORT_STATUS_OPTIONS,
  REPORT_TYPE_OPTIONS,
  WORK_MODE_OPTIONS,
  labelOf,
  reportStatusTagType
} from '@/views/qlzg/constants'
import {
  composeState,
  composeStateTagType,
  composeStateText,
  placeholderRemainingText,
  reportTitleOf,
  tokenCostText,
  voidedByText
} from './reportFlow'
import ReportForm from './ReportForm.vue'

/**
 * 报告台账 —— 从项目进去的一层薄壳
 *
 * <h3>🔴 这一页是**菜单**，作业台是 `remaining.ts` 里的静态路由</h3>
 * 两者是**兄弟**、共用 `qlzg:report` 这一个权限族，而塌缩之后整个族只有**一行**
 * `sys_resource`、只有**一个** `menu_id` —— 承载行指向谁，另一个就从非超管的
 * 导航集合里消失（案例台账与案例召回已经栽过一次）。
 * 所以带按钮子菜单的这一个当菜单，详情页走静态路由 + `activeMenu` 回指这里。
 *
 * <h3>🔴 定稿 / 退回修订 / 作废三个动作**不在这一页**</h3>
 * 它们都在作业台里。理由不是「页面太挤」，而是那三个动作都要先看清上下文
 * （残留占位符是哪几个键、红标还剩几格、成稿是不是旧的），
 * 而在台账上弹一个只有「确定 / 取消」的对话框，等于让评估师在不看正文的情况下
 * 对一份法定报告做不可逆的决定。台账上只留「进去看」与「下载」。
 *
 * <h3>为什么不分页</h3>
 * 后端 `/list-by-project` 本来就不分页：一个项目下的报告是**个位数到十几份**
 * （每个标的一份技术报告 + 一份结果报告，改一版不新增一行）。
 * 分页会把「作废掉的那一份」翻到第二页去，于是它看起来像没发生过。
 */
defineOptions({ name: 'QlzgReport' })

const route = useRoute()
const router = useRouter()
const message = useMessage()

const loading = ref(false)
const loadError = ref('')
const list = ref<QlzgReportVO[]>([])
const project = ref<QlzgProjectVO | null>(null)
const projectOptions = ref<QlzgProjectVO[]>([])
const projectLoading = ref(false)

const queryParams = reactive({ projectId: undefined as number | undefined })

/** 成稿那一格的短标签。长句子在 tooltip 里，理由见模板上那段注释 */
const composeStateLabel = (row: QlzgReportVO): string => {
  const state = composeState(row)
  if (state === 'NEVER') return '未成文'
  if (state === 'STALE') return '需重新成文'
  return '成稿一致'
}

/** 🔴 已作废的行灰掉，但**不隐藏**，理由见模板上那段注释 */
const rowClassName = ({ row }: { row: QlzgReportVO }) => (row.status === 'VOIDED' ? 'row-voided' : '')

const searchProjects = async (keyword: string) => {
  if (!keyword) return
  projectLoading.value = true
  try {
    const data = await QlzgProjectApi.getProjectPage({ pageNo: 1, pageSize: 20, projectName: keyword })
    projectOptions.value = data.list
  } finally {
    projectLoading.value = false
  }
}

const getList = async () => {
  const id = queryParams.projectId
  if (!id) {
    list.value = []
    project.value = null
    loadError.value = ''
    return
  }
  loading.value = true
  try {
    const [listResult, projectResult] = await Promise.allSettled([
      QlzgReportApi.getReportListByProject(id),
      QlzgProjectApi.getProject(id)
    ])
    if (listResult.status === 'fulfilled') {
      list.value = listResult.value ?? []
      loadError.value = ''
    } else {
      list.value = []
      loadError.value = listResult.reason?.message || '报告清单加载失败'
    }
    // 项目概要失败得起：它只是页眉上那三格，清单本身照常能用
    project.value = projectResult.status === 'fulfilled' ? projectResult.value : null
  } finally {
    loading.value = false
  }
}

const formRef = ref()
const openForm = () => {
  if (!queryParams.projectId) return
  formRef.value.open(queryParams.projectId, project.value)
}

/**
 * 进作业台
 *
 * 🔴 走 path 不走 name：静态路由的 `name` 只要与库里某个菜单的 `component_name`
 *    撞上就会被覆盖，而覆盖是一次静默失败（vue-router 只在控制台 warn）。
 *    path 是 `remaining.ts` 里写死的，不会被任何东西改掉
 */
const openWorkbench = (reportId: number) => {
  router.push({ path: '/qlzg-report/workbench', query: { reportId } })
}

const goTemplate = () => {
  router.push({ path: '/qlzg/template' })
}

/**
 * 下载成稿
 *
 * <h3>🔴 只在**点击那一刻**调 `/word-url`，不要为了刷新界面而调</h3>
 * 计量发生在取地址那一刻，不是在成文那一刻。成文了但从来没人下载的报告流量是 0，
 * 所以「取地址」这个动作**就是**一次计量事件 —— 反复调它会在客户的账单上
 * 出现一排他从来没做过的下载。
 *
 * <h3>🔴 `finalized = false` 时下载到的是一份**草稿**，文件名要说出来</h3>
 * 一份草稿的 Word 与定稿的 Word 在纸面上**没有区别**（定稿不改正文，只冻结一版），
 * 而交出去的是哪一份，30 年后翻档案的人只能靠文件名分辨。
 *
 * ⚠️ 中转路由（`presigned = false`）是私有化部署的常态，而
 *    `/infra/file/{configId}/get/**` 挂着 permitAll（`window.open` 带不上 `Authorization` 头），
 *    所以不需要带**登录态**、也不需要走 `request.download`。
 *    🔴 但 `info.url` 必须**原样**交给 `window.open`：非 S3 介质下它带着
 *    `?relay_token=…`，那是放行判据的一半，而且是**单程票**（后端核销时是一条 Redis DEL）。
 *    自己拼地址或剪掉 query 的表现是 403「该文件不允许通过此通道下载」，看着像权限没配
 */
const download = async (row: QlzgReportVO) => {
  if (!row.id) return
  try {
    const info = await QlzgReportApi.getWordFileUrl(row.id)
    if (!info?.url) {
      message.warning('取不到下载地址，请重新成文一次')
      return
    }
    if (info.finalized !== true) {
      message.warning(`下载到的是${row.reportNo}的草稿，还没定稿，不要交付`)
    }
    window.open(info.url, '_blank')
  } catch {
    // 🔴 报错原文已经由 axios 拦截器弹出来了。这里只补一句「下一步点哪里」：
    //    REPORT_WORD_FILE_MISSING 的文案里带报告号，但不带「去点成文」这个动作
    message.error('还没成过文，请先进作业台点一次「成文」')
  }
}

onMounted(() => {
  const raw = route.query.projectId
  const text = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number(text)
  // 🔴 `Number('')` 是 0、`Number(undefined)` 是 NaN，
  //    0 会被当成一个合法的项目编号发出去，后端回一句「项目不存在」，
  //    用户看到的结论就成了「报告功能坏了」
  if (Number.isInteger(parsed) && parsed > 0) {
    queryParams.projectId = parsed
    // 选中项的 label 要先有那一条 option，否则框里显示的是编号
    QlzgProjectApi.getProject(parsed)
      .then((detail) => {
        project.value = detail
        projectOptions.value = [detail]
      })
      .catch(() => {
        project.value = null
      })
      .finally(() => getList())
    return
  }
  getList()
})

watch(
  () => route.query.projectId,
  (raw) => {
    const text = Array.isArray(raw) ? raw[0] : raw
    const parsed = Number(text)
    if (Number.isInteger(parsed) && parsed > 0 && parsed !== queryParams.projectId) {
      queryParams.projectId = parsed
      QlzgProjectApi.getProject(parsed)
        .then((detail) => {
          project.value = detail
          projectOptions.value = [detail]
        })
        .catch(() => {
          project.value = null
        })
        .finally(() => getList())
    }
  }
)
</script>
<style lang="scss" scoped>
.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.warn-text {
  font-size: 12px;
  color: var(--el-color-warning);
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}

:deep(.el-table .row-voided) {
  --el-table-tr-bg-color: var(--el-fill-color-lighter);

  color: var(--el-text-color-secondary);
}
</style>
