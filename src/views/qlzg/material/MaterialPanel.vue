<template>
  <div class="flex h-full bg-[var(--el-bg-color)] rounded-8px overflow-hidden">
    <!-- ==================== 左：上传批次时间线 ==================== -->
    <div
      class="w-260px flex-none border-r border-r-solid border-r-[var(--el-border-color-lighter)]"
    >
      <BatchTimeline v-model="activeBatchNo" :batches="batches" :loading="batchLoading" />
    </div>

    <!-- ==================== 右：缺件 + 资料列表 ==================== -->
    <div class="flex-1 min-w-0 flex flex-col p-12px overflow-hidden">
      <MissingItemsPanel :missing="missing" :loading="missingLoading" class="flex-none mb-12px" />

      <!-- ==================== 工具条 ==================== -->
      <el-form class="-mb-15px flex-none" :model="queryParams" inline @submit.prevent>
        <el-form-item label="文件名">
          <el-input
            v-model="queryParams.fileName"
            placeholder="按文件名模糊查"
            clearable
            class="!w-200px"
            @keyup.enter="handleQuery"
          />
        </el-form-item>
        <el-form-item label="正文">
          <el-input
            v-model="queryParams.keyword"
            placeholder="搜正文里的字"
            clearable
            class="!w-200px"
            @keyup.enter="handleQuery"
          />
        </el-form-item>
        <el-form-item label="类别">
          <el-select v-model="queryParams.category" clearable placeholder="全部" class="!w-140px">
            <el-option
              v-for="option in MATERIAL_CATEGORY_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="抽取">
          <el-select
            v-model="queryParams.extractStatus"
            clearable
            placeholder="全部"
            class="!w-140px"
          >
            <el-option
              v-for="option in EXTRACT_STATUS_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">
            <Icon icon="ep:search" class="mr-5px" /> 搜索
          </el-button>
          <el-button @click="resetQuery">
            <Icon icon="ep:refresh" class="mr-5px" /> 重置
          </el-button>
          <el-button
            type="primary"
            plain
            v-hasPermi="['qlzg:material:create']"
            data-testid="open-upload"
            @click="uploadVisible = true"
          >
            <Icon icon="ep:upload" class="mr-5px" /> 上传资料
          </el-button>
          <el-button
            type="success"
            plain
            :disabled="selectedRows.length === 0"
            v-hasPermi="['qlzg:material:update']"
            data-testid="open-classify"
            @click="openClassifyBatch"
          >
            <Icon icon="ep:price-tag" class="mr-5px" /> 归类（{{ selectedRows.length }}）
          </el-button>
          <el-button
            type="success"
            plain
            v-hasPermi="['qlzg:material:query']"
            data-testid="open-export"
            @click="handleExport"
          >
            <Icon icon="ep:download" class="mr-5px" /> 导出
          </el-button>
        </el-form-item>
      </el-form>

      <!-- ==================== 资料表 ==================== -->
      <div class="flex-1 min-h-0 mt-12px overflow-hidden">
        <el-table
          v-loading="listLoading"
          :data="list"
          height="100%"
          row-key="id"
          @selection-change="(rows: QlzgMaterialVO[]) => (selectedRows = rows)"
        >
          <el-table-column type="selection" width="45" reserve-selection />
          <el-table-column label="文件名" prop="fileName" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span>{{ row.fileName }}</span>
              <el-tag v-if="!row.extractTerminal" type="primary" size="small" class="ml-6px">
                解析中…
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="大小" width="90" align="right">
            <template #default="{ row }">{{ formatFileSize(row.fileSize ?? 0) }}</template>
          </el-table-column>
          <el-table-column label="类别" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.category" size="small">
                {{ row.categoryDescription || labelOf(MATERIAL_CATEGORY_OPTIONS, row.category) }}
              </el-tag>
              <!-- 🔴 未归类要**看得见**：M0 阶段归类只能人工做，而没归类的资料
                   不进缺件统计、也不进披露清单，是「传上来了却等于没传」的那一批 -->
              <el-tag v-else type="warning" size="small">未归类</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="清单项" width="140" show-overflow-tooltip>
            <template #default="{ row }">
              <!-- ⚠️ 品类 schema 已删掉这一项时后端**退回编码本身**（不是 null），
                   那是历史资料，编码仍然要显示，兜成 '-' 会让人以为归类丢了 -->
              <span v-if="row.checklistItemCode">{{
                row.checklistItemName || row.checklistItemCode
              }}</span>
              <span v-else class="text-[var(--el-text-color-placeholder)]">—</span>
            </template>
          </el-table-column>
          <el-table-column label="正文" width="110">
            <template #default="{ row }">
              <el-tag :type="extractStatusTagType(row.extractStatus)" size="small">
                {{ extractStatusLabel(row.extractStatus) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="归类来源" width="90">
            <template #default="{ row }">
              <span v-if="row.classifySource">
                {{ labelOf(CLASSIFY_SOURCE_OPTIONS, row.classifySource) }}
              </span>
              <span v-else class="text-[var(--el-text-color-placeholder)]">—</span>
            </template>
          </el-table-column>
          <el-table-column label="所属标的" width="140" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.subjectId">{{ row.subjectName || row.subjectId }}</span>
              <span v-else class="text-[var(--el-text-color-secondary)]">项目级</span>
            </template>
          </el-table-column>
          <!-- 只在「全部批次」时显示这一列：已经按批次过滤了，每行都是同一个号，纯占地方 -->
          <el-table-column v-if="activeBatchNo === ''" label="批次" width="100">
            <template #default="{ row }">
              <el-link type="primary" :underline="false" @click="activeBatchNo = row.uploadBatchNo">
                第 {{ batchIndexOf(row.uploadBatchNo) }} 批
              </el-link>
            </template>
          </el-table-column>
          <el-table-column
            label="收进时间"
            prop="createTime"
            width="160"
            :formatter="dateFormatter"
          />
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openText(row)">正文</el-button>
              <el-button link type="primary" size="small" @click="openOriginal(row)"
                >原件</el-button
              >
              <el-button
                link
                type="primary"
                size="small"
                v-hasPermi="['qlzg:material:update']"
                @click="openClassifyOne(row)"
              >
                归类
              </el-button>
              <el-button
                link
                type="primary"
                size="small"
                v-hasPermi="['qlzg:material:update']"
                @click="openExt(row)"
              >
                字段
              </el-button>
              <el-button
                link
                type="danger"
                size="small"
                v-hasPermi="['qlzg:material:delete']"
                @click="handleDelete(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <Pagination
        class="flex-none"
        :total="total"
        v-model:page="queryParams.pageNo"
        v-model:limit="queryParams.pageSize"
        @pagination="loadList"
      />
    </div>

    <!-- ==================== 弹窗与抽屉 ==================== -->
    <MaterialUploadDrawer
      v-model="uploadVisible"
      :project-id="projectId"
      @confirmed="onConfirmed"
    />
    <MaterialClassifyDialog
      v-model="classifyVisible"
      :materials="classifyTargets"
      :category-code="project?.categoryCode"
      @classified="loadAll"
    />
    <MaterialTextDialog v-model="textVisible" :material-id="currentId" @re-extracted="loadList" />
    <MaterialExtDialog v-model="extVisible" :material-id="currentId" @saved="loadList" />
    <LedgerExportForm ref="exportFormRef" />
  </div>
</template>

<script lang="ts" setup>
import {
  QlzgMaterialApi,
  type QlzgMaterialBatchVO,
  type QlzgMaterialMissingVO,
  type QlzgMaterialVO
} from '@/api/qlzg/material'
import { QlzgProjectApi, type QlzgProjectVO } from '@/api/qlzg/project'
import { dateFormatter } from '@/utils/formatTime'
import { formatFileSize } from '@/utils/file'
import {
  CLASSIFY_SOURCE_OPTIONS,
  EXTRACT_STATUS_OPTIONS,
  extractStatusLabel,
  extractStatusTagType,
  labelOf,
  MATERIAL_CATEGORY_OPTIONS
} from '../constants'
import BatchTimeline from './components/BatchTimeline.vue'
import MissingItemsPanel from './components/MissingItemsPanel.vue'
import MaterialUploadDrawer from './components/MaterialUploadDrawer.vue'
import MaterialClassifyDialog from './components/MaterialClassifyDialog.vue'
import MaterialTextDialog from './components/MaterialTextDialog.vue'
import MaterialExtDialog from './components/MaterialExtDialog.vue'
import LedgerExportForm from '@/views/qlzg/components/LedgerExportForm.vue'

/**
 * 资料面板（I1 的主界面）
 *
 * <h3>🔴 它是**按 projectId 复用的组件**，不是一个路由页面</h3>
 * `index.vue` 只是读 `route.query.projectId` 的一层薄壳。这样做是因为 I4 的作业台
 * 要把同一个面板嵌进「项目 → 标的 → 资料」的三栏布局里，
 * 如果这里直接写成读 `useRoute()` 的页面，作业台就得把整份逻辑抄一遍 ——
 * 而抄出来的那一份不会跟着这边一起改，两个界面对「什么算缺件」的答案会慢慢分岔。
 *
 * <h3>🔴 这里没有「提交资料」这个动作</h3>
 * 资料没有「提交完成」状态，只有「目前到了哪些、还缺哪些」。
 * 所以缺件面板是常驻的、每次有资料落库都重新拉，而不是「提交之后给一个结果」。
 *
 * <h3>⚠️ 缺件结果**不缓存**</h3>
 * 它是「清单应有的项码 − 资料行已覆盖的项码」这个集合差，查询期算的，
 * 库里刻意不存 is_required / missing_flag（存下来的缺件状态会与资料行漂移，而漂移不报错）。
 */
defineOptions({ name: 'QlzgMaterialPanel' })

const props = defineProps<{ projectId: number }>()

const message = useMessage()

const project = ref<QlzgProjectVO>()
const batches = ref<QlzgMaterialBatchVO[]>([])
const batchLoading = ref(false)
const activeBatchNo = ref('')
const missing = ref<QlzgMaterialMissingVO | null>(null)
const missingLoading = ref(false)
const list = ref<QlzgMaterialVO[]>([])
const listLoading = ref(false)
const total = ref(0)
const selectedRows = ref<QlzgMaterialVO[]>([])

const uploadVisible = ref(false)
const classifyVisible = ref(false)
const classifyTargets = ref<QlzgMaterialVO[]>([])
const textVisible = ref(false)
const extVisible = ref(false)
const currentId = ref<number>()

const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  fileName: '',
  keyword: '',
  category: '',
  extractStatus: ''
})

const batchIndexOf = (batchNo: string) =>
  batches.value.findIndex((batch) => batch.uploadBatchNo === batchNo) + 1

const loadProject = async () => {
  project.value = await QlzgProjectApi.getProject(props.projectId)
}

const loadBatches = async () => {
  batchLoading.value = true
  try {
    batches.value = await QlzgMaterialApi.getBatchList(props.projectId)
  } finally {
    batchLoading.value = false
  }
}

const loadMissing = async () => {
  missingLoading.value = true
  try {
    missing.value = await QlzgMaterialApi.getMissingItems(props.projectId)
  } catch {
    // 项目还没定品类时后端会给一个业务错，拦截器已经弹过提示了；
    // 这里把面板置空即可，不要因为缺件算不出来就让整个资料列表打不开
    missing.value = null
  } finally {
    missingLoading.value = false
  }
}

const loadList = async () => {
  listLoading.value = true
  try {
    const data = await QlzgMaterialApi.getMaterialPage({
      ...queryParams,
      projectId: props.projectId,
      uploadBatchNo: activeBatchNo.value || undefined
    })
    list.value = data.list
    total.value = data.total
  } finally {
    listLoading.value = false
  }
}

const loadAll = async () => {
  await Promise.all([loadBatches(), loadMissing(), loadList()])
}

const handleQuery = () => {
  queryParams.pageNo = 1
  loadList()
}

const resetQuery = () => {
  queryParams.fileName = ''
  queryParams.keyword = ''
  queryParams.category = ''
  queryParams.extractStatus = ''
  activeBatchNo.value = ''
  handleQuery()
}

/**
 * 导出按钮操作
 *
 * 🔴 `buildParams` 必须与 `loadList` **逐条对齐**：除了搜索栏那几个条件，
 *    还要带上 `projectId` 与当前选中的批次号。漏了 `projectId` 的后果不是「导多了」——
 *    后端那一支条件为空就等于不过滤，用户会拿到**全机构所有项目**的资料清单，
 *    而弹窗上写的「共 N 条」是这一个项目的数，两个数字对不上但文件已经下完了。
 *
 * ⚠️ 「导出全部」= 当前批次筛选下的全部，不是这个项目的所有资料。
 *    批次时间线上选着第 3 批时，导出的就是第 3 批 —— 这与列表所见一致，
 *    所以说明里要把这件事写出来，否则用户以为导的是整个项目
 */
const exportFormRef = ref()
const handleExport = () => {
  exportFormRef.value?.open({
    ledgerName: '资料台账',
    fetcher: QlzgMaterialApi.exportExcel,
    pageNo: queryParams.pageNo,
    pageSize: queryParams.pageSize,
    total: total.value,
    buildParams: () => ({
      ...queryParams,
      projectId: props.projectId,
      uploadBatchNo: activeBatchNo.value || undefined
    }),
    contentHints: [
      activeBatchNo.value
        ? `当前在批次时间线上选中了 ${activeBatchNo.value}，导出的就是这一批（不是整个项目）。`
        : '未选批次，导出的是本项目当前筛选条件下的全部资料。',
      '导出的是资料**清单**：文件名、大小、类别、清单项、抽取状态、页数、批次、查勘位置。',
      '抽取出来的全文（正文）不进台账 —— 两万行正文是必定撑爆内存的量。要看正文请点行内的「正文」。'
    ]
  })
}

watch(activeBatchNo, () => {
  queryParams.pageNo = 1
  loadList()
})

/**
 * 一份落库 → 刷新
 *
 * 🔴 用**前沿节流**合并：一份一刷的话，拖 20 份就是 20 组请求（列表 + 时间线 + 缺件），
 *    而它们全都在几秒内发生，浏览器对同一域名只有 6 条连接，
 *    刷新请求会把正在传的字节挤到后面去 —— 用户看到的是进度条突然不动了。
 */
let refreshTimer: ReturnType<typeof setTimeout> | undefined
const onConfirmed = () => {
  if (refreshTimer) {
    return
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined
    loadAll()
  }, 800)
}

const openText = (row: QlzgMaterialVO) => {
  currentId.value = row.id
  textVisible.value = true
}

/**
 * 打开「编辑自定义字段」
 *
 * 🔴 与 {@link openText} 共用 {@link currentId}：两个弹窗不会同时开着，
 *    而各自都是在 {@code modelValue} 变 true 的那一刻才按这个 id 去读，
 *    所以复用是安全的。⚠️ 但别把它改成「打开时把整行传进去」——
 *    表格行里的 {@code ext} 是**列表接口**返回的那一份，可能已经过期，
 *    而 update-ext 是整列覆盖，拿过期值写回去就是把别人刚改的删掉。
 *    弹窗自己按 id 重读一次，正是为了避免这件事。
 */
const openExt = (row: QlzgMaterialVO) => {
  currentId.value = row.id
  extVisible.value = true
}

/**
 * 归类弹窗的候选行
 *
 * ⚠️ 点「归类（N）」时传的是**选中的那 N 行**，不是当前页 ——
 *    传整页而只勾了 3 行的话，弹窗里那 3 行是勾着的、另外 17 行也能勾，
 *    看着像是「刚才那 3 行没选上」，而用户其实已经在表格里选过了
 * 🔴 两个入口各自**显式**设定候选，不用「候选为空就取选中行」那种推断：
 *    从表格行的「归类」进来是单行，关掉之后候选还留着那一行，
 *    再点工具条就会把上一次那一行当成这次的选中项 —— 而那一次用户勾的是另外 8 行
 */
const openClassifyBatch = () => {
  classifyTargets.value = [...selectedRows.value]
  classifyVisible.value = true
}

const openClassifyOne = (row: QlzgMaterialVO) => {
  classifyTargets.value = [row]
  classifyVisible.value = true
}

/**
 * 🔴 **点击那一刻**才取读取地址，不在列表加载时预取
 *
 * 每次调用都会记一条 PREVIEW/OUT 计量行，那是**只追加的收费依据**。
 * 一页 20 行预取一遍 = 凭空多出 20 条下行计费，而账上看不出它与「用户真的看了」有什么区别。
 */
const openOriginal = async (row: QlzgMaterialVO) => {
  const readUrl = await QlzgMaterialApi.getReadUrl(row.id)
  window.open(readUrl.url, '_blank')
}

const handleDelete = async (row: QlzgMaterialVO) => {
  try {
    // 🔴 确认框要把两件事说清楚：① 字节**不会**被删（仍然占着存储、仍然计过费）；
    //    ② 已经被报告引用的资料删掉之后，溯源会指向一个不存在的落点
    await message.delConfirm(
      `确定删除「${row.fileName}」吗？删除的只是这条资料记录，` +
        '文件本身仍会保留在存储里（占用的空间不会释放）。' +
        '如果这份资料已经被报告引用，引用处会变成指向空落点'
    )
  } catch {
    return
  }
  await QlzgMaterialApi.deleteMaterial(row.id)
  message.success('删除成功')
  await loadAll()
}

watch(
  () => props.projectId,
  (id) => {
    if (id) {
      loadProject()
      loadAll()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = undefined
  }
})
</script>
