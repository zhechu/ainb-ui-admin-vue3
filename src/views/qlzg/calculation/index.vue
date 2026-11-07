<template>
  <!--
    🔴 `title` 这个 prop **必须给**：ContentWrap 的 `<template v-if="title" #header>`
       把整个头部（连同 #header 插槽）一起 gate 在 title 上。
       不给 title 的后果不是「少了个标题」，而是**下面那排按钮全部消失**，
       且没有任何报错 —— 页面看着是好的，只是回不去标的台账、也发不起测算。
       标题文字由 ContentWrap 自己渲染，插槽里**不要**再写一遍。
  -->
  <ContentWrap title="测算">
    <template #header>
      <div class="flex items-center justify-end w-full">
        <el-button
          v-if="subjectId"
          type="primary"
          plain
          @click="openRun"
          v-hasPermi="['qlzg:calculation:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 发起测算
        </el-button>
        <el-button
          v-if="subjectId"
          type="primary"
          plain
          @click="goCalcResult"
          v-hasPermi="['qlzg:calc-result:query']"
        >
          <Icon icon="ep:select" class="mr-5px" /> 去定值
        </el-button>
        <el-button v-if="subjectId" :loading="loading" @click="getList">
          <Icon icon="ep:refresh" class="mr-5px" /> 刷新
        </el-button>
        <el-button @click="goBack">
          <Icon icon="ep:back" class="mr-5px" /> 回标的台账
        </el-button>
      </div>
    </template>

    <!--
      没有 subjectId 时不渲染表格，而是把「为什么什么都没有」说清楚。
      这个菜单是隐藏的、只能从标的台账那一行的「测算」进来，
      所以直接敲 URL 一定会落到这一支；此时渲染一张空表
      会让人以为「这个标的还没算过」，而实际上只是缺一个入参
    -->
    <el-alert v-if="!subjectId" type="warning" :closable="false" show-icon class="mb-12px">
      <template #title>这一页要从标的台账进来</template>
      <div>
        测算的入参<b>只有一个标的编号</b>：品类码、评估基准日与可用的评估方法都取自标的所属的项目，
        不能单独指定。请回到「标的台账」，在某一行的操作里点「测算」。
      </div>
    </el-alert>

    <template v-if="subjectId">
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
        class="mb-12px"
      />

      <el-descriptions v-if="subject" :column="3" border size="small" class="mb-12px">
        <el-descriptions-item label="标的">{{ subject.subjectName }}</el-descriptions-item>
        <el-descriptions-item label="所属项目">
          {{ subject.projectNo || '—' }}　{{ subject.projectName || '' }}
        </el-descriptions-item>
        <el-descriptions-item label="账面价值（元）">
          {{ subject.bookValue == null ? '—' : thousands(subject.bookValue) }}
        </el-descriptions-item>
      </el-descriptions>

      <!--
        🔴 这张表**不过滤**：FAILED 与 STALE 都在里面，与 list-by-subject 的口径一致。
           「试过的都在这儿」是复核要回答的问题之一，只列成功的那几条等于把
           「算不出来的那一次」从档案里抹掉。灰掉的行必须自己说清为什么灰
      -->
      <el-table
        class="xpy-list-table"
        stripe
        v-loading="loading"
        :data="list"
        :row-class-name="rowClassName"
      >
        <el-table-column label="序号" type="index" width="44" align="center" />
        <el-table-column label="评估方法" width="140" align="center">
          <template #default="scope">
            {{ methodNameOf(scope.row.methodCode, scope.row.methodName) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="130" align="center">
          <template #default="scope">
            <el-tag :type="calculationStatusTagType(scope.row.status)" size="small">
              {{ scope.row.statusDescription || scope.row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="评估值（元）" width="150" align="right">
          <template #default="scope">
            <b v-if="scope.row.resultValue != null">{{ thousands(scope.row.resultValue) }}</b>
            <span v-else class="form-hint">—</span>
          </template>
        </el-table-column>
        <el-table-column label="单价（元/㎡）" width="120" align="right">
          <template #default="scope">{{ thousands(scope.row.unitPrice) }}</template>
        </el-table-column>
        <el-table-column label="引擎版本" width="110" align="center">
          <template #default="scope">{{ scope.row.engineVersion || '—' }}</template>
        </el-table-column>
        <el-table-column label="耗时" width="90" align="center">
          <template #default="scope">
            {{ scope.row.durationMs == null ? '—' : `${scope.row.durationMs} ms` }}
          </template>
        </el-table-column>
        <el-table-column
          label="测算时间"
          align="center"
          prop="createTime"
          width="170"
          :formatter="dateFormatter"
        />
        <el-table-column label="为什么这一行不能用于出稿" min-width="280">
          <template #default="scope">
            <span v-if="unusableReason(scope.row)" class="unusable-reason">
              {{ unusableReason(scope.row) }}
            </span>
            <span v-else class="form-hint">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              @click="openDetail(scope.row.id)"
              v-hasPermi="['qlzg:calculation:query']"
            >
              明细
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="这个标的还没有跑过测算">
            <el-button
              type="primary"
              plain
              @click="openRun"
              v-hasPermi="['qlzg:calculation:create']"
            >
              发起第一次测算
            </el-button>
          </el-empty>
        </template>
      </el-table>
    </template>
  </ContentWrap>

  <!-- 三步向导：选方法 → 确认闸 → 案例终选 -->
  <CalcRunDialog ref="runRef" @success="onRunSuccess" />

  <!-- 明细抽屉：算式步骤 / 披露 / 冻结口径 / 案例终选 -->
  <CalcDetailDrawer ref="detailRef" @changed="getList" />
</template>
<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import { QlzgSubjectApi, type QlzgSubjectVO } from '@/api/qlzg/subject'
import { QlzgCalculationApi, type QlzgCalculationVO } from '@/api/qlzg/calculation'
import { calculationStatusTagType, thousands } from '@/views/qlzg/constants'
import { methodNameOf, unusableReason } from './calcFlow'
import CalcRunDialog from './CalcRunDialog.vue'
import CalcDetailDrawer from './CalcDetailDrawer.vue'

/**
 * 测算页 —— 一层薄壳 + 一张「试过的都在这儿」的表
 *
 * <h3>🔴 这个菜单是**隐藏**的（`visible = false`），只能从标的台账那一行的「测算」进来</h3>
 * 测算的入参只有标的编号：品类、基准日、可用方法都取自标的所属的项目。
 * 一个能点进去、进去却只能看到一句「请从标的台账进来」的菜单项，
 * 比没有这个菜单更让人困惑。与案例召回页同一条纪律。
 *
 * <h3>🔴 `reportId` 与 `provenanceIds` 两栏刻意不列</h3>
 * 两个在 I3 恒为 null（报告的写入路径在 I4，溯源在 I6）。
 * 一个恒为空的列会让人以为数据丢了，而它其实还没开始写。
 *
 * <h3>为什么这一页不做分页</h3>
 * 一个标的的测算次数是**个位数到几十条**（每换一种方法、每次改了口径重算各一条），
 * 而复核要的是「一眼看见全部试过的」。分页会把「上一次失败的那一条」翻到第二页去，
 * 于是它看起来像没发生过。后端 `list-by-subject` 本来也不分页
 */
defineOptions({ name: 'QlzgCalculation' })

const route = useRoute()
const router = useRouter()

const subjectId = computed(() => {
  const raw = route.query.subjectId
  const text = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number(text)
  // 🔴 `Number('')` 与 `Number(undefined)` 分别是 0 与 NaN，
  //    0 会被当成一个合法的标的编号发出去，后端回一句「标的不存在」，
  //    用户看到的结论就成了「测算功能坏了」
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
})

const loading = ref(false)
const loadError = ref('')
const list = ref<QlzgCalculationVO[]>([])
const subject = ref<QlzgSubjectVO | null>(null)

/** 灰掉不能用于出稿的那几行（STALE / FAILED），并让原因列自己说话 */
const rowClassName = ({ row }: { row: QlzgCalculationVO }) =>
  unusableReason(row) ? 'row-unusable' : ''

const getList = async () => {
  const id = subjectId.value
  if (!id) return
  loading.value = true
  try {
    const [listResult, subjectResult] = await Promise.allSettled([
      QlzgCalculationApi.listBySubject(id),
      QlzgSubjectApi.getSubject(id)
    ])
    if (listResult.status === 'fulfilled') {
      list.value = listResult.value
      loadError.value = ''
    } else {
      list.value = []
      loadError.value = listResult.reason?.message || '测算列表加载失败'
    }
    // 标的概要失败得起：它只是页眉上那三格，列表本身照常能用
    subject.value = subjectResult.status === 'fulfilled' ? subjectResult.value : null
  } finally {
    loading.value = false
  }
}

const runRef = ref()
const openRun = () => {
  if (subjectId.value) runRef.value.open(subjectId.value)
}

const detailRef = ref()
const openDetail = (calculationId: number) => {
  detailRef.value.open(calculationId)
}

/**
 * 跑完一次之后：刷新列表 + 直接把明细打开
 *
 * 🔴 `run` 返回的是测算 id，而且 **FAILED 也返回 id**（失败的运行同样落库，
 *    因为「算不出来」本身要留痕）。所以这里**不按「有没有抛异常」判断成败**，
 *    而是一律打开明细让人看见 `status` 与 `errorMessage`
 */
const onRunSuccess = (calculationId: number) => {
  getList()
  openDetail(calculationId)
}

/**
 * 跳结果确定页
 *
 * 🔴 不带「哪几条测算」过去：结果确定页自己按 `list-by-subject` 重取一遍并默认全勾成功的。
 *    带一份勾选状态过去就要在两个页面之间维护同一份选择，
 *    而它随时会因为一次刷新 / 一次重算变成 STALE 而失效 —— 那份失效在跳转后看不出来
 */
const goCalcResult = () => {
  if (!subjectId.value) return
  router.push({ path: '/qlzg/calc-result', query: { subjectId: subjectId.value } })
}

const goBack = () => {
  // 🔴 走 path 不走 name：菜单的 component_name 一旦没填，push({ name }) 就是一次
  //    静默失败（vue-router 只在控制台 warn，界面停在原地），而 path 是建菜单时必填的
  router.push({ path: '/qlzg/subject' })
}

watch(
  subjectId,
  (id) => {
    if (id) {
      getList()
    } else {
      list.value = []
      subject.value = null
      loadError.value = ''
    }
  },
  { immediate: true }
)
</script>
<style lang="scss" scoped>
.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.unusable-reason {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

:deep(.el-table .row-unusable) {
  --el-table-tr-bg-color: var(--el-fill-color-lighter);

  color: var(--el-text-color-secondary);
}
</style>
