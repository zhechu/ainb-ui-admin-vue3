<template>
  <Dialog v-model="dialogVisible" title="批量导入案例" width="1100" :close-on-click-modal="false">
    <el-steps :active="step" align-center finish-status="success" class="mb-20px">
      <el-step title="选择文件与参数" />
      <el-step title="预检" />
      <el-step title="导入结果" />
    </el-steps>

    <div v-loading="loading">
      <!-- ==================== 第 1 步 ==================== -->
      <div v-show="step === 0">
        <el-alert v-if="config.notice" type="warning" :closable="false" show-icon class="mb-12px">
          <template #title>整批共用一份「来源说明文件」</template>
          <!-- 🔴 这段告诫照原样渲染，不在前端重写一份：它是后端按闸 G-10 的口径给的 -->
          <div class="whitespace-pre-wrap">{{ config.notice }}</div>
        </el-alert>

        <!--
          🔴 `sources` 为空时**禁用导入**并给出出口，不是让它空着。
             空着的表现是「数据源那一栏没有可选项」，用户会以为是系统坏了；
             而导入执行时后端会因为 `sourceId` 缺失报一句参数错误，
             那句话不会告诉他真正要做的事是「先去登记一个数据源」
        -->
        <el-alert v-if="!sourceOptions.length" type="error" :closable="false" show-icon class="mb-12px">
          <template #title>还没有登记任何案例数据源，导入无法进行</template>
          <div>
            一批导入进来的案例共用一个出处，而那个出处必须先在「案例数据源」页登记
            （它带着闸 G-10 要逐字引用的署名文本）。
            <el-button link type="primary" @click="goSourcePage">去登记数据源</el-button>
          </div>
        </el-alert>

        <el-form :model="form" label-width="132px">
          <el-form-item label="案例库类型" required>
            <el-select v-model="form.caseKind" placeholder="请选择" class="!w-320px" @change="onCaseKindChange">
              <el-option
                v-for="item in kindOptions"
                :key="item.code"
                :label="item.name"
                :value="item.code"
              />
            </el-select>
            <!--
              🔴 这里原先还写了一遍「对应品类：<codes>」，已删：
                 上面那个下拉的 label 用的就是 `item.name`（= 共用这个案例库类型的品类名连起来），
                 而 `categoryCodes` 是**同一批品类**的码 —— 同一份信息说两遍，
                 第二遍还是评估师读不懂的 `REAL_ESTATE_MORTGAGE_RESIDENTIAL`。
                 留下的是那句话里真正有信息量的部分：为什么必须先选类型再下模板
            -->
            <div v-if="currentKind" class="form-hint w-full">
              模板的列清单是<b>按品类</b>算出来的，所以必须先选类型再下载模板
            </div>
          </el-form-item>

          <el-form-item label="导入模板">
            <el-button :disabled="!form.caseKind" :loading="downloading" @click="downloadTemplate">
              <Icon icon="ep:download" class="mr-5px" /> 下载模板
            </el-button>
            <span v-if="!form.caseKind" class="ml-8px form-hint">先选案例库类型</span>
          </el-form-item>

          <el-form-item label="数据文件" required>
            <el-upload
              :show-file-list="false"
              :auto-upload="false"
              accept=".xlsx,.xls"
              :on-change="onFilePicked"
            >
              <el-button type="primary" plain>
                <Icon icon="ep:folder-opened" class="mr-5px" /> 选择 xlsx 文件
              </el-button>
            </el-upload>
            <div v-if="file" class="ml-12px">
              <Icon icon="ep:document" class="mr-4px" />{{ file.name }}
              <span class="form-hint ml-8px">（{{ (file.size / 1024).toFixed(1) }} KB）</span>
              <el-button link type="danger" class="ml-8px" @click="clearFile">移除</el-button>
            </div>
            <div class="form-hint w-full">
              上限 {{ config.maxFileSizeMb ?? '—' }} MB、{{ config.maxImportRows ?? '—' }} 行；
              超过 {{ config.asyncThreshold ?? '—' }} 行会转成后台任务，界面上显示进度。
              模板里的示例行会被跳过，不计入数据行。
            </div>
          </el-form-item>

          <el-form-item label="数据源" required>
            <el-select
              v-model="form.sourceId"
              placeholder="请选择"
              filterable
              class="!w-320px"
              :disabled="!sourceOptions.length"
            >
              <el-option
                v-for="item in sourceOptions"
                :key="item.id"
                :label="`${item.sourceName}（${item.sourceCode}）`"
                :value="item.id"
              />
            </el-select>
            <div v-if="currentSource?.attributionText" class="form-hint w-full">
              这一批案例在报告里的署名文本：{{ currentSource.attributionText }}
            </div>
          </el-form-item>

          <el-form-item label="来源说明文件" required>
            <el-upload :show-file-list="false" :http-request="doUploadEvidence">
              <el-button plain :loading="uploading">
                <Icon icon="ep:upload" class="mr-5px" /> 上传整批共用的说明文件
              </el-button>
            </el-upload>
            <div v-if="form.evidenceFileId" class="ml-12px">
              <Icon icon="ep:document-checked" class="text-[var(--el-color-success)] mr-4px" />
              {{ evidenceFileName || `文件编号 ${form.evidenceFileId}` }}
              <el-button link type="danger" class="ml-8px" @click="clearEvidence">移除</el-button>
            </div>
            <div class="form-hint w-full">
              与屏 2 那个「佐证材料」是<b>同一个</b>字段：整批案例共用这一份出处证明
            </div>
          </el-form-item>

          <el-form-item label="佐证类型" required>
            <el-select v-model="form.evidenceKind" placeholder="请选择" class="!w-240px">
              <el-option
                v-for="item in evidenceKindOptions"
                :key="item.code"
                :label="item.name"
                :value="item.code"
              />
            </el-select>
          </el-form-item>
        </el-form>

        <el-collapse v-if="columnList.length" class="mt-8px">
          <el-collapse-item :title="`模板里的 ${columnList.length} 列（点开看哪几列会被忽略）`">
            <el-table :data="columnList" size="small" border>
              <el-table-column label="列名" prop="header" min-width="140" />
              <el-table-column label="类型" prop="dataTypeName" width="90" align="center" />
              <el-table-column label="必填" width="70" align="center">
                <template #default="scope">
                  <el-tag v-if="scope.row.requiredColumn" type="danger" size="small">必填</el-tag>
                  <span v-else>—</span>
                </template>
              </el-table-column>
              <el-table-column label="写入" width="90" align="center">
                <template #default="scope">
                  <!-- 🔴 writable 为 false 的列**在模板里有、但会被忽略**，必须标出来 -->
                  <el-tag v-if="scope.row.writable === false" type="info" size="small">只读</el-tag>
                  <span v-else>可写</span>
                </template>
              </el-table-column>
              <el-table-column label="可选值 / 说明" min-width="240">
                <template #default="scope">
                  <div v-if="scope.row.options?.length">{{ scope.row.options.join('、') }}</div>
                  <div class="form-hint">{{ scope.row.note }}</div>
                  <div v-if="scope.row.example" class="form-hint">示例：{{ scope.row.example }}</div>
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </div>

      <!-- ==================== 第 2 步：预检 ==================== -->
      <div v-show="step === 1">
        <template v-if="preview">
          <el-descriptions :column="4" border size="small" class="mb-12px">
            <el-descriptions-item label="数据行">{{ preview.total ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="可导入">
              <span class="text-[var(--el-color-success)]">{{ preview.validCount ?? 0 }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="有错误">
              <span class="text-[var(--el-color-danger)]">{{ preview.invalidCount ?? 0 }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="有警告">
              <span class="text-[var(--el-color-warning)]">{{ preview.warningCount ?? 0 }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="跳过的示例行">
              {{ preview.skippedExampleCount ?? 0 }}
            </el-descriptions-item>
            <el-descriptions-item label="表头列数">{{ preview.headerCount ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="执行方式">
              <el-tag v-if="preview.willBeAsync" type="warning" size="small">后台任务</el-tag>
              <span v-else>同步（当场出结果）</span>
            </el-descriptions-item>
            <el-descriptions-item label="明细行数">
              <span v-if="preview.rowsTruncated">
                只回了前 {{ preview.rowLimit }} 行
                <el-tooltip content="完整清单要等真正导入之后才有">
                  <Icon icon="ep:question-filled" />
                </el-tooltip>
              </span>
              <span v-else>{{ (preview.rows ?? []).length }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <!--
            🔴 文件级问题非空时**不该**让用户往下走，而**行级**错误不该拦：
               §11.2.3 要求「行级错误、不整批失败」，200 条里有 7 条错是正常的，
               那 193 条会进去。判据写在 previewBlockingIssue 里，这里只渲染它的结论
          -->
          <el-alert
            v-if="blockingIssue"
            type="error"
            :closable="false"
            show-icon
            :title="blockingIssue"
            class="mb-12px"
          />
          <el-alert
            v-else-if="(preview.invalidCount ?? 0) > 0"
            type="warning"
            :closable="false"
            show-icon
            class="mb-12px"
          >
            <template #title>
              有 {{ preview.invalidCount }} 行导不进去，其余 {{ preview.validCount ?? 0 }} 行会正常入库
            </template>
            <div>
              这是<b>行级</b>错误，不是整批失败：点「开始导入」之后有错误的行会被跳过并写进失败清单，
              导完可以在结果里看到每一行的原因。
            </div>
          </el-alert>

          <div class="form-hint mb-12px">
            报「服务器忙，任务已排队」时<b>直接再点一次「开始导入」即可</b>：
            文件与幂等键都没变，服务端认得出这是同一次导入，不会导两遍。
            千万不要回去重新选文件 —— 换一次文件就换一次幂等键，那才是真的导两遍。
          </div>

          <el-table
            v-if="(preview.rows ?? []).length"
            :data="preview.rows"
            size="small"
            border
            max-height="380"
          >
            <el-table-column label="行号" prop="rowNo" width="70" align="center" />
            <el-table-column label="结果" width="80" align="center">
              <template #default="scope">
                <el-tag v-if="scope.row.valid" type="success" size="small">可导入</el-tag>
                <el-tag v-else type="danger" size="small">有错误</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="小区名" prop="communityName" min-width="120" />
            <el-table-column label="坐落" prop="address" min-width="180" show-overflow-tooltip />
            <el-table-column label="成交日期" prop="transactionDate" width="110" align="center" />
            <el-table-column label="成交价" prop="transactionPrice" width="110" align="right" />
            <el-table-column label="面积" prop="buildingArea" width="90" align="right" />
            <el-table-column label="问题" min-width="260">
              <template #default="scope">
                <div v-for="(issue, idx) in scope.row.issues ?? []" :key="idx" class="issue-line">
                  <el-tag :type="caseIssueLevelTagType(issue.level)" size="small">
                    {{ labelOf(CASE_IMPORT_ISSUE_LEVEL_OPTIONS, issue.level) }}
                  </el-tag>
                  <span class="ml-6px">
                    <template v-if="issue.columnLetter">[{{ issue.columnLetter }}] </template>
                    {{ issue.fieldLabel || issue.field }}：{{ issue.message }}
                    <span v-if="issue.rawValue" class="form-hint">（原值 {{ issue.rawValue }}）</span>
                  </span>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </template>
        <el-empty v-else description="还没有预检结果" />
      </div>

      <!-- ==================== 第 3 步：结果 ==================== -->
      <div v-show="step === 2">
        <template v-if="polling">
          <el-alert type="info" :closable="false" show-icon class="mb-12px">
            <template #title>后台任务执行中，请勿关闭本页</template>
            <div>
              任务号 {{ progress?.taskNo || progress?.taskId || '—' }}，
              状态 {{ progress?.statusName || '—' }}，进度 {{ progress?.progress ?? 0 }}%。
              每 5 秒刷新一次；关掉弹窗不会中止任务，回来还能在台账里看到结果。
            </div>
          </el-alert>
          <el-progress :percentage="progress?.progress ?? 0" class="mb-12px" />
        </template>

        <template v-if="result">
          <el-descriptions :column="4" border size="small" class="mb-12px">
            <el-descriptions-item label="数据行">{{ result.total ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="已入库">
              <span class="text-[var(--el-color-success)]">{{ result.insertedCount ?? 0 }}</span>
            </el-descriptions-item>
            <!--
              🔴 「已跳过」与「失败」是两列，**不能合并**：跳过是指纹撞车被去重
                 （这批里本来就有的那些行），不是导坏了。并到一起的表现是
                 用户以为失败了 N 条，于是重导一次 —— 而重导多少次结果都一样，
                 因为撞的还是同一批指纹
            -->
            <el-descriptions-item label="已跳过（重复）">
              <el-tooltip content="与库里已有案例指纹相同，被去重跳过。这是正常的，不是失败">
                <span class="text-[var(--el-text-color-secondary)]">
                  {{ result.skippedCount ?? 0 }}
                </span>
              </el-tooltip>
            </el-descriptions-item>
            <el-descriptions-item label="失败">
              <span class="text-[var(--el-color-danger)]">{{ result.failedCount ?? 0 }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="警告">{{ result.warningCount ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="已处理">{{ result.processedCount ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="清单" :span="2">
              <span v-if="result.issuesTruncated">
                只回了前 {{ result.issueLimit }} 条问题
              </span>
              <span v-else>共 {{ (result.issues ?? []).length }} 条</span>
            </el-descriptions-item>
          </el-descriptions>

          <el-alert
            v-if="pollError"
            type="warning"
            :closable="false"
            show-icon
            :title="pollError"
            class="mb-12px"
          />

          <el-table v-if="(result.issues ?? []).length" :data="result.issues" size="small" border max-height="360">
            <el-table-column label="档位" width="80" align="center">
              <template #default="scope">
                <el-tag :type="caseIssueLevelTagType(scope.row.level)" size="small">
                  {{ labelOf(CASE_IMPORT_ISSUE_LEVEL_OPTIONS, scope.row.level) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="行号" prop="rowNo" width="70" align="center">
              <template #default="scope">{{ scope.row.rowNo ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="阶段" prop="phase" width="110" align="center" />
            <el-table-column label="列" prop="fieldLabel" width="120">
              <template #default="scope">{{ scope.row.fieldLabel || scope.row.field || '—' }}</template>
            </el-table-column>
            <el-table-column label="说明" prop="message" min-width="280" />
            <el-table-column label="原值" prop="rawValue" min-width="120" />
          </el-table>
        </template>
        <el-empty v-else-if="!polling" description="还没有结果" />
      </div>
    </div>

    <template #footer>
      <el-button v-if="step > 0 && !polling" :disabled="executing" @click="step--">上一步</el-button>
      <el-button
        v-if="step === 0"
        type="primary"
        :loading="previewing"
        :disabled="!canPreview"
        @click="runPreview"
      >
        预 检
      </el-button>
      <el-button
        v-if="step === 1"
        type="primary"
        :loading="executing"
        :disabled="!!blockingIssue"
        @click="runExecute"
      >
        开始导入
      </el-button>
      <el-button v-if="step === 2 && !polling" type="primary" @click="dialogVisible = false">
        关 闭
      </el-button>
      <el-button :disabled="executing || polling" @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { useRouter } from 'vue-router'
import { CASE_IMPORT_ISSUE_LEVEL_OPTIONS, caseIssueLevelTagType, labelOf } from '@/views/qlzg/constants'
import {
  QlzgCaseApi,
  type QlzgCaseImportConfigVO,
  type QlzgCaseImportExecuteVO,
  type QlzgCaseImportPreviewVO,
  type QlzgCaseImportProgressVO,
  type QlzgCaseImportResultVO
} from '@/api/qlzg/case'
import { newImportToken, previewBlockingIssue, shouldStopPolling } from './caseSchema'

defineOptions({ name: 'QlzgCaseImportForm' })

/**
 * 案例批量导入向导（V5 §11.2.3）
 *
 * <h3>🔴 `importToken` 在**选中文件那一刻**生成一次，两步请求共用</h3>
 * 服务端刻意不替你生成（缺了它报 `CASE_IMPORT_TOKEN_REQUIRED`），
 * 因为它是幂等键：每次请求都新生成一个的话，双击「开始导入」就是两次导入。
 * 反过来，**重新选文件时必须重新生成** —— 换一个文件还沿用旧令牌，
 * 会被幂等键判成「同一次导入」，第二份文件的内容一条都不会进去，而界面显示成功。
 * 这两件事都在 `onFilePicked` / `clearFile` 里做，不要挪到别处。
 *
 * <h3>🔴 停止轮询判后端的 `terminal` 布尔，**不判 status 枚举**</h3>
 * 多一种终态时（例如 I6 加的「已取消」），按枚举写的停止条件会漏掉它，
 * 表现是弹窗关不掉、请求一直打。判据在 `shouldStopPolling` 里。
 * ⚠️ 反方向也成立：**不要**因为「看着卡住了」就自己停。
 *    `/import-progress` 顺带做孤儿任务的懒回收 —— 进程被 kill 之后留下的 RUNNING 行，
 *    是由**下一次查询**判成 INTERRUPTED 的。停止轮询 ⇒ 它永远不会被回收，
 *    于是台账上永远挂着一个「执行中」。所以轮询出错只记一句提示，不停。
 *
 * <h3>🔴 `async` 是唯一的分支判据</h3>
 * `/import-execute` 返回的 `async` 为 true 时结果**不在**这一份响应里，
 * 要拿 `taskId` 去轮询；为 false 时 `result` 就在这一份里。
 * 按「行数多不多」自己猜的话，猜错那一支的表现是「导入成功了但界面显示还没有结果」。
 *
 * <h3>🔴 关闭弹窗时必须停轮询并清空状态</h3>
 * 不停的话定时器会在这个组件销毁之后继续打接口；
 * 不清空的话下次打开会看到上一批的预检结果，而文件已经换了 ——
 * 用户看着「上一次的数字」点「开始导入」，导进去的却是新文件。
 */

const message = useMessage()
const router = useRouter()
const emit = defineEmits(['success'])

/** 轮询间隔。5 秒：再短就是拿服务端的库换界面上的顺滑 */
const POLL_INTERVAL_MS = 5000

const dialogVisible = ref(false)
const loading = ref(false)
const step = ref(0)

const config = ref<QlzgCaseImportConfigVO>({})
const kindOptions = computed(() => config.value.caseKinds ?? [])
const sourceOptions = computed(() => config.value.sources ?? [])
const evidenceKindOptions = computed(() => config.value.evidenceKinds ?? [])
const columnList = computed(() => config.value.columns ?? [])
const currentKind = computed(() => kindOptions.value.find((item) => item.code === form.caseKind))
const currentSource = computed(() => sourceOptions.value.find((item) => item.id === form.sourceId))

const form = reactive({
  caseKind: '',
  sourceId: undefined as number | undefined,
  evidenceFileId: undefined as number | undefined,
  evidenceKind: '',
  importToken: ''
})
const evidenceFileName = ref('')
const file = ref<File | null>(null)

const previewing = ref(false)
const preview = ref<QlzgCaseImportPreviewVO | null>(null)
const blockingIssue = computed(() => previewBlockingIssue(preview.value))

const executing = ref(false)
const polling = ref(false)
const progress = ref<QlzgCaseImportProgressVO | null>(null)
const result = ref<QlzgCaseImportResultVO | null>(null)
const pollError = ref('')
const uploading = ref(false)
const downloading = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | null = null

const canPreview = computed(
  () => !!file.value && !!form.caseKind && !!form.sourceId && !!form.evidenceFileId && !!form.evidenceKind
)

const open = async (preset?: QlzgCaseImportConfigVO) => {
  dialogVisible.value = true
  resetState()
  if (preset?.caseKinds) {
    config.value = preset
    return
  }
  loading.value = true
  try {
    config.value = await QlzgCaseApi.getImportConfig()
  } finally {
    loading.value = false
  }
}
defineExpose({ open })

/** 🔴 换文件 = 换一次导入 = 换一个幂等键，理由见类注释 */
const onFilePicked = (uploadFile: any) => {
  const raw = uploadFile?.raw as File | undefined
  if (!raw) return
  file.value = raw
  form.importToken = newImportToken()
  preview.value = null
  step.value = 0
}

const clearFile = () => {
  file.value = null
  form.importToken = ''
  preview.value = null
}

const onCaseKindChange = () => {
  // 🔴 模板是按品类算出来的，换了类型上一份预检结果就作废了
  preview.value = null
}

const doUploadEvidence = async (options: any) => {
  uploading.value = true
  try {
    const res = await QlzgCaseApi.uploadEvidence(options.file as File)
    form.evidenceFileId = res.fileId
    evidenceFileName.value = res.fileName
    message.success('来源说明文件已上传')
  } catch {
    // 全局拦截器已经把后端那句文案弹出来了
  } finally {
    uploading.value = false
  }
}

const clearEvidence = () => {
  form.evidenceFileId = undefined
  evidenceFileName.value = ''
}

const downloadTemplate = async () => {
  if (!form.caseKind) return
  downloading.value = true
  try {
    const data = await QlzgCaseApi.getImportTemplate(form.caseKind)
    const kindName = currentKind.value?.name ?? form.caseKind
    // 🔴 文件名自己拼：`request.download` 拿不到响应头，
    //    而后端在流写完之后才设 Content-Disposition，那时候响应已经提交了，那个头发不出去
    const blob = new Blob([data])
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `案例导入模板-${kindName}.xlsx`
    link.click()
    URL.revokeObjectURL(link.href)
  } finally {
    downloading.value = false
  }
}

const runPreview = async () => {
  if (!file.value || !canPreview.value) return
  previewing.value = true
  try {
    // 🔴 预检**一个字都不写库**，权限点是 `:query`：只读的人也要能先看看这份文件长什么样
    preview.value = await QlzgCaseApi.importPreview(file.value, form.caseKind)
    step.value = 1
  } finally {
    previewing.value = false
  }
}

const runExecute = async () => {
  if (!file.value || blockingIssue.value) return
  executing.value = true
  try {
    const res: QlzgCaseImportExecuteVO = await QlzgCaseApi.importExecute(file.value, {
      caseKind: form.caseKind,
      sourceId: form.sourceId as number,
      evidenceFileId: form.evidenceFileId as number,
      evidenceKind: form.evidenceKind,
      // 🔴 与预检那一次是**同一个**令牌
      importToken: form.importToken
    })
    step.value = 2
    if (res.async) {
      progress.value = null
      result.value = null
      startPolling(res.taskId as number)
    } else {
      result.value = res.result ?? null
      message.success('导入完成')
      emit('success')
    }
  } finally {
    executing.value = false
  }
}

const startPolling = (taskId: number) => {
  polling.value = true
  pollError.value = ''
  const tick = async () => {
    try {
      const data = await QlzgCaseApi.importProgress(taskId)
      progress.value = data
      if (data.result) result.value = data.result
      if (shouldStopPolling(data)) {
        polling.value = false
        if (data.status === 'FAILED') message.error(data.errorMsg || '导入任务失败')
        else message.success('导入完成')
        emit('success')
        return
      }
    } catch {
      // 🔴 **不停**：这个端点顺带做孤儿任务的懒回收，停了它就永远不会被回收。
      //    只把「查询失败了」这件事说出来，下一个周期照常再试
      pollError.value = '进度查询失败了一次，仍在重试。请不要关闭本页。'
    }
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
  }
  pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
}

const stopPolling = () => {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  polling.value = false
}

const goSourcePage = () => {
  dialogVisible.value = false
  // 🔴 走 path 不走 name：菜单的 `component_name` 一旦没填，`push({ name })` 就是一次
  //    静默失败（vue-router 只在控制台 warn，界面停在原地），而 path 是建菜单时必填的。
  //    标的台账跳资料页用的也是 path，同一条纪律
  router.push({ path: '/qlzg/case-source' })
}

const resetState = () => {
  stopPolling()
  step.value = 0
  file.value = null
  preview.value = null
  progress.value = null
  result.value = null
  pollError.value = ''
  evidenceFileName.value = ''
  form.caseKind = ''
  form.sourceId = undefined
  form.evidenceFileId = undefined
  form.evidenceKind = ''
  form.importToken = ''
}

/** 🔴 关掉就把状态整个清掉，理由见类注释最后一段 */
watch(dialogVisible, (visible) => {
  if (!visible) resetState()
})

onBeforeUnmount(stopPolling)
</script>
<style lang="scss" scoped>
.form-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.issue-line {
  display: flex;
  align-items: flex-start;
  font-size: 12px;
  line-height: 1.7;
}
</style>
