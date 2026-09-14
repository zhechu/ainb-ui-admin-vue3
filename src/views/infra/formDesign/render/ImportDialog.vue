<template>
  <Dialog v-model="visible" :title="`导入数据 — ${formName || ''}`" width="1080px" :append-to-body="true">
    <!-- 步骤条。三步的顺序是有讲究的：先看文件解析成什么，再看每行对不对，最后才落库 -->
    <el-steps :active="step" align-center finish-status="success" class="ie-steps">
      <el-step title="上传文件" description="选一份 Excel" />
      <el-step title="检查数据" description="表头对不对、哪几行有问题" />
      <el-step title="导入结果" description="成功多少、失败为什么" />
    </el-steps>

    <!-- ========== 第 1 步：上传 ========== -->
    <div v-if="step === 0" class="ie-upload">
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".xls,.xlsx"
        :on-change="handleFileChange"
        :on-exceed="handleExceed"
        drag
      >
        <el-icon class="el-icon--upload"><upload-filled /></el-icon>
        <div class="el-upload__text">把文件拖到这里，或<em>点击选择</em></div>
        <template #tip>
          <div class="el-upload__tip">
            后缀名 .xls 或 .xlsx，最多 5000 行 / 10MB。表头请用字段名 —— 顺序可以打乱，
            <b>我们按列名匹配，不按位置</b>。
          </div>
        </template>
      </el-upload>

      <div class="ie-template">
        <span>还没有数据？</span>
        <el-button link type="primary" :loading="templateLoading" @click="handleDownloadTemplate">
          下载导入模板
        </el-button>
        <span class="ie-template-tip">
          模板按当前表单的字段生成，表头就是字段名，字典列带下拉，第二行是填写说明
        </span>
      </div>
    </div>

    <!-- ========== 第 2 步：预览与确认 ========== -->
    <div v-else-if="step === 1" class="ie-preview">
      <!-- 统计条。用户第一眼看的就是它 -->
      <div class="ie-summary">
        <div class="ie-summary-item">
          <span class="ie-summary-num">{{ preview?.summary.totalRows ?? 0 }}</span>
          <span class="ie-summary-label">数据行</span>
        </div>
        <div class="ie-summary-item ie-ok">
          <span class="ie-summary-num">{{ preview?.summary.newCount ?? 0 }}</span>
          <span class="ie-summary-label">将新增</span>
        </div>
        <div class="ie-summary-item ie-warn">
          <span class="ie-summary-num">{{ preview?.summary.existsCount ?? 0 }}</span>
          <span class="ie-summary-label">库中已存在</span>
        </div>
        <div class="ie-summary-item ie-warn">
          <span class="ie-summary-num">{{ preview?.summary.duplicateCount ?? 0 }}</span>
          <span class="ie-summary-label">文件内重复</span>
        </div>
        <div class="ie-summary-item ie-error">
          <span class="ie-summary-num">{{ preview?.summary.invalidCount ?? 0 }}</span>
          <span class="ie-summary-label">校验未通过</span>
        </div>
      </div>

      <!-- 表头映射：让用户看见「哪一列对到了哪个字段」 -->
      <el-collapse v-model="openedPanels" class="ie-collapse">
        <el-collapse-item name="mapping">
          <template #title>
            <span class="ie-collapse-title">
              表头匹配结果
              <el-tag size="small" type="success" class="ie-tag">
                {{ preview?.mappings.length ?? 0 }} 列已识别
              </el-tag>
              <el-tag v-if="preview?.unmatchedColumns.length" size="small" type="warning" class="ie-tag">
                {{ preview?.unmatchedColumns.length }} 列未识别
              </el-tag>
              <el-tag v-if="preview?.duplicateColumns.length" size="small" type="danger" class="ie-tag">
                {{ preview?.duplicateColumns.length }} 列重复
              </el-tag>
            </span>
          </template>
          <el-table :data="preview?.mappings ?? []" size="small" border max-height="240">
            <el-table-column prop="columnLetter" label="列" width="60" align="center" />
            <el-table-column prop="header" label="Excel 表头" min-width="150" />
            <el-table-column label="对应字段" min-width="180">
              <template #default="{ row }">
                <span>{{ row.fieldLabel }}</span>
                <el-tag v-if="row.subTitle" size="small" type="info" class="ie-tag">
                  {{ row.subTitle }}
                </el-tag>
                <el-tag v-if="row.required" size="small" type="danger" class="ie-tag">必填</el-tag>
                <el-tag v-if="row.formula" size="small" type="warning" class="ie-tag">公式</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="field" label="字段名" min-width="150" />
          </el-table>

          <!-- 未识别与重复列要单独说清楚，这是最容易让人困惑的两件事 -->
          <div v-if="preview?.unmatchedColumns.length" class="ie-note ie-note-warn">
            <div v-for="col in preview.unmatchedColumns" :key="col.columnLetter">
              ⚠️ {{ col.columnLetter }} 列「{{ col.header }}」：{{ col.reason }}
            </div>
          </div>
          <div v-if="preview?.duplicateColumns.length" class="ie-note ie-note-error">
            <div v-for="col in preview.duplicateColumns" :key="col.columnLetter">
              ✖ {{ col.columnLetter }} 列「{{ col.header }}」：{{ col.reason }}
            </div>
          </div>
          <div v-if="preview?.missingRequiredFields.length" class="ie-note ie-note-error">
            ✖ 文件里缺少这些必填列：{{ preview.missingRequiredFields.join('、') }}
          </div>
        </el-collapse-item>
      </el-collapse>

      <!-- 整表级问题：比如明细没排序。这类问题一条都导不了，必须显眼 -->
      <el-alert
        v-if="preview?.tableErrors.length"
        type="error"
        :closable="false"
        class="ie-alert"
        show-icon
      >
        <template #title>这份文件有以下问题，请先处理</template>
        <div v-for="(err, i) in preview.tableErrors" :key="i">{{ err.message }}</div>
      </el-alert>

      <!-- 重复策略：只有当文件里真有「库中已存在」或更新键存在时才有意义 -->
      <div v-if="preview && preview.updateKeyFields.length" class="ie-strategy">
        <span class="ie-strategy-label">
          库中已存在的 {{ preview.summary.existsCount }} 条怎么处理？
        </span>
        <el-radio-group v-model="strategy">
          <el-radio value="SKIP">跳过，并在结果里列出来（默认，不改任何已有数据）</el-radio>
          <el-radio value="UPDATE">按「{{ preview.updateKeyFields.join(' + ') }}」覆盖更新</el-radio>
          <el-radio value="APPEND">不管有没有，都再新增一条</el-radio>
        </el-radio-group>
      </div>
      <div v-else-if="preview" class="ie-note ie-note-warn">
        ⚠️ 这张表单没有配唯一性校验的字段，也没有业务主键，因此无法判断「哪条是已存在的」——
        所有行都会按新增处理。
      </div>

      <el-checkbox v-model="allOrNothing" class="ie-all-or-nothing">
        全对才导（只要有一行不通过，整批都不导）
      </el-checkbox>

      <!-- 逐行预览 -->
      <div class="ie-rows-head">
        <span>数据预览</span>
        <span class="ie-rows-tip">
          共 {{ preview?.summary.totalGroups ?? 0 }} 条，
          这里只显示前 {{ preview?.rows.length ?? 0 }} 条；
          校验未通过的行可以点「删除」剔掉，其余会照常导入
        </span>
      </div>
      <el-table
        :data="displayRows"
        size="small"
        border
        max-height="320"
        :row-class-name="rowClassName"
      >
        <el-table-column label="行" width="70" align="center">
          <template #default="{ row }">
            <span v-if="row.endRowNo && row.endRowNo !== row.rowNo">
              {{ row.rowNo }}~{{ row.endRowNo }}
            </span>
            <span v-else>{{ row.rowNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ row.statusText }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内容 / 问题" min-width="560">
          <template #default="{ row }">
            <!-- 有问题就先说问题，这是用户最需要看的东西 -->
            <div v-for="(err, i) in row.errors" :key="'e' + i" class="ie-row-error">
              <span v-if="err.columnLetter" class="ie-col">{{ err.columnLetter }} 列</span>
              <span v-if="err.fieldLabel" class="ie-field">{{ err.fieldLabel }}</span>
              {{ err.message }}
              <span v-if="err.rawValue" class="ie-raw">（原文：{{ err.rawValue }}）</span>
            </div>
            <div v-for="(warn, i) in row.warnings" :key="'w' + i" class="ie-row-warn">
              {{ warn.message }}
            </div>
            <div v-if="!row.errors?.length" class="ie-row-ok">
              {{ summarizeRow(row) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="removeRow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- ========== 第 3 步：结果 ========== -->
    <div v-else class="ie-result">
      <el-result
        :icon="resultIcon"
        :title="resultTitle"
        :sub-title="resultSubTitle"
      />

      <el-table v-if="result?.failures.length" :data="result.failures" size="small" border max-height="320">
        <el-table-column prop="rowNo" label="行号" width="70" align="center" />
        <el-table-column prop="businessKey" label="业务键" width="150" />
        <el-table-column prop="fieldLabel" label="出错字段" width="130" />
        <el-table-column prop="message" label="原因" min-width="320" />
        <el-table-column prop="rawValue" label="原文" width="120" />
      </el-table>
      <div v-if="result?.failures.length" class="ie-note">
        按上面的行号回到 Excel 改完，重新上传一次即可 —— 已经导进去的不会重复。
      </div>
    </div>

    <template #footer>
      <el-button v-if="step === 0" @click="visible = false">取消</el-button>
      <el-button v-if="step === 1" @click="backToUpload">上一步</el-button>
      <el-button v-if="step === 0" type="primary" :loading="previewLoading" @click="handlePreview">
        下一步
      </el-button>
      <el-button v-if="step === 1" type="primary" :loading="executeLoading" @click="handleExecute">
        确认导入
      </el-button>
      <el-button v-if="step === 2" type="primary" @click="handleClose">完成</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import * as RuntimeApi from '@/api/infra/formDesign/runtime'
import type {
  ImportPreviewVO,
  ImportPreviewRowVO,
  ImportResultVO
} from '@/api/infra/formDesign/runtime'

/**
 * 表格导入向导
 *
 * 三步：上传 → 检查 → 结果。中间那一步是这个功能的价值所在 ——
 * 「传完直接告诉我成功了几条」的写法会把用户带进「导错了也没发现」的坑。
 *
 * ⚠️ 所有校验都以**服务端**为准。前端在这里做的只是展示，
 * 不做任何「看起来没问题就放行」的判断。
 */
defineOptions({ name: 'FormImportDialog' })

const emit = defineEmits(['success'])

const visible = ref(false)
const step = ref(0)
const formCode = ref('')
const formName = ref('')

const uploadRef = ref()
const selectedFile = ref<File | null>(null)
const previewLoading = ref(false)
const executeLoading = ref(false)
const templateLoading = ref(false)

const preview = ref<ImportPreviewVO | null>(null)
const result = ref<ImportResultVO | null>(null)
const strategy = ref<'SKIP' | 'UPDATE' | 'APPEND'>('SKIP')
const allOrNothing = ref(false)
const removedRows = ref<string[]>([])
const openedPanels = ref<string[]>(['mapping'])

/** 预览里显示的行的标签类型 */
const statusTagType = (status: string) => {
  switch (status) {
    case 'NEW':
      return 'success'
    case 'EXISTS':
      return 'warning'
    case 'DUPLICATE_IN_FILE':
      return 'danger'
    case 'INVALID':
      return 'danger'
    default:
      return 'info'
  }
}

const rowClassName = ({ row }: { row: ImportPreviewRowVO }) =>
  row.status === 'INVALID' || row.status === 'DUPLICATE_IN_FILE' ? 'ie-row-bad' : ''

/**
 * 没问题的行显示什么
 *
 * ⚠️ 显示的是**解析后的值**，不是原始文本。这一点是刻意的：
 * 用户在 Excel 里填的是「甲级（战略）」，解析后变成 AAA ——
 * 如果他在这张预览里看到的还是「甲级（战略）」，就没法确认标签反查真的生效了。
 * 而「看不出来」正是导入功能最需要避免的事。
 *
 * 用字段中文名而不是字段名：这一列是给用户对照 Excel 用的。
 */
const summarizeRow = (row: ImportPreviewRowVO): string => {
  const data = row.data ?? {}
  const labelOf = (field: string): string => {
    const mapping = preview.value?.mappings.find((m) => m.field === field)
    return mapping?.fieldLabel ?? field
  }
  const parts: string[] = []
  Object.entries(data).forEach(([field, value]) => {
    if (value === null || value === undefined || value === '') return
    if (Array.isArray(value)) {
      if (!value.length) return
      parts.push(`${labelOf(field)}: ${value.join('、')}`)
      return
    }
    parts.push(`${labelOf(field)}: ${value}`)
  })
  const subCount = Object.values(row.subData ?? {}).reduce(
    (sum: number, rows: any[]) => sum + (rows?.length ?? 0),
    0
  )
  const text = parts.join(' · ') || '(这一行是空的)'
  return subCount ? `${text} ｜ 含 ${subCount} 条明细` : text
}

/**
 * 剔掉的行不显示
 *
 * 用 filter 而不是从 preview.rows 里 splice —— 后者会把「原本有几行」这件事
 * 抹掉，用户剔到一半想撤销就没得撤了。
 */
const displayRows = computed<ImportPreviewRowVO[]>(
  () => preview.value?.rows.filter((r) => !removedRows.value.includes(String(r.rowNo))) ?? []
)

const resultIcon = computed(() => {
  if (!result.value) return 'info'
  if (result.value.failCount === 0) return 'success'
  return result.value.createCount + result.value.updateCount > 0 ? 'warning' : 'error'
})

const resultTitle = computed(() => {
  if (!result.value) return ''
  const r = result.value
  if (r.failCount === 0 && r.tableErrors.length === 0) {
    return '全部导入成功'
  }
  if (r.createCount + r.updateCount + r.skipCount === 0) {
    return '一条都没有导入'
  }
  return '部分导入成功'
})

const resultSubTitle = computed(() => {
  if (!result.value) return ''
  const r = result.value
  const parts = [
    `新增 ${r.createCount} 条`,
    `更新 ${r.updateCount} 条`,
    `跳过 ${r.skipCount} 条`,
    `失败 ${r.failCount} 条`
  ]
  return parts.join('，')
})

function open(code: string, name: string) {
  formCode.value = code
  formName.value = name
  reset()
  visible.value = true
}

function reset() {
  step.value = 0
  selectedFile.value = null
  preview.value = null
  result.value = null
  strategy.value = 'SKIP'
  allOrNothing.value = false
  removedRows.value = []
  openedPanels.value = ['mapping']
  uploadRef.value?.clearFiles?.()
}

function handleFileChange(file: any) {
  const raw: File = file.raw
  // 只认后缀，不看 MIME —— 不同浏览器给出的 type 五花八门，
  // 真正的判据是后端能不能解析
  const ext = (raw?.name ?? '').split('.').pop()?.toLowerCase()
  if (ext !== 'xls' && ext !== 'xlsx') {
    ElMessage.error('只支持 .xls 或 .xlsx 文件')
    uploadRef.value?.clearFiles?.()
    return
  }
  if (raw.size > 10 * 1024 * 1024) {
    ElMessage.error('文件超过 10MB，请拆分后分次导入')
    uploadRef.value?.clearFiles?.()
    return
  }
  selectedFile.value = raw
}

function handleExceed(files: File[]) {
  // 只留最后一个：用户换文件时的预期是「换成刚选的那个」
  uploadRef.value?.clearFiles?.()
  const file = files[0]
  uploadRef.value?.handleStart?.(file)
  handleFileChange({ raw: file })
}

async function handleDownloadTemplate() {
  templateLoading.value = true
  try {
    await RuntimeApi.downloadTemplate(formCode.value)
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '模板下载失败')
  } finally {
    templateLoading.value = false
  }
}

async function handlePreview() {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择文件')
    return
  }
  previewLoading.value = true
  try {
    preview.value = await RuntimeApi.importPreview(formCode.value, selectedFile.value)
    removedRows.value = []
    step.value = 1
  } catch (e: any) {
    // 解析失败要说清是文件的问题 —— 只报「导入失败」的话，
    // 用户会以为是系统坏了，然后反复重试同一个文件
    ElMessage.error(e?.msg || e?.message || '文件解析失败，请确认格式后重试')
  } finally {
    previewLoading.value = false
  }
}

async function handleExecute() {
  if (!preview.value) return
  executeLoading.value = true
  try {
    result.value = await RuntimeApi.importExecute(formCode.value, {
      importToken: preview.value.importToken,
      removedRows: removedRows.value,
      duplicateStrategy: strategy.value,
      allOrNothing: allOrNothing.value
    })
    step.value = 2
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '导入失败')
  } finally {
    executeLoading.value = false
  }
}

function removeRow(row: ImportPreviewRowVO) {
  removedRows.value.push(String(row.rowNo))
}

function backToUpload() {
  step.value = 0
}

function handleClose() {
  const changed = (result.value?.createCount ?? 0) + (result.value?.updateCount ?? 0) > 0
  visible.value = false
  if (changed) {
    emit('success')
  }
}

defineExpose({ open })
</script>

<style lang="scss" scoped>
.ie-steps {
  margin-bottom: 20px;
}

.ie-upload {
  min-height: 260px;
}

.ie-template {
  margin-top: 16px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.ie-template-tip {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ie-summary {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.ie-summary-item {
  flex: 1;
  padding: 10px 0;
  text-align: center;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}

.ie-summary-num {
  display: block;
  font-size: 22px;
  font-weight: 600;
}

.ie-summary-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.ie-summary-item.ie-ok .ie-summary-num {
  color: var(--el-color-success);
}

.ie-summary-item.ie-warn .ie-summary-num {
  color: var(--el-color-warning);
}

.ie-summary-item.ie-error .ie-summary-num {
  color: var(--el-color-danger);
}

.ie-collapse-title {
  font-weight: 600;
}

.ie-tag {
  margin-left: 6px;
}

.ie-note {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}

.ie-note-warn {
  color: var(--el-color-warning);
}

.ie-note-error {
  color: var(--el-color-danger);
}

.ie-alert {
  margin: 12px 0;
}

.ie-strategy {
  margin: 12px 0;
}

.ie-strategy-label {
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
}

.ie-all-or-nothing {
  margin-bottom: 12px;
}

.ie-rows-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
  font-weight: 600;
}

.ie-rows-tip {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.ie-row-error {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.7;
}

.ie-row-warn {
  color: var(--el-color-warning);
  font-size: 12px;
  line-height: 1.7;
}

.ie-row-ok {
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.ie-col,
.ie-field {
  margin-right: 6px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--el-fill-color);
}

.ie-raw {
  color: var(--el-text-color-secondary);
}

:deep(.ie-row-bad) {
  background: var(--el-color-danger-light-9);
}

.ie-result {
  min-height: 280px;
}
</style>
