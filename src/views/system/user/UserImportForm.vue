<template>
  <Dialog v-model="dialogVisible" title="导入用户" width="1000px">
    <!-- 三步的顺序是有讲究的：先看文件解析成什么，再看每行对不对，最后才落库 -->
    <el-steps :active="step" align-center finish-status="success" class="ui-steps">
      <el-step title="上传文件" description="选一份 Excel" />
      <el-step title="检查数据" description="表头对不对、哪几行有问题" />
      <el-step title="导入结果" description="成功多少、失败为什么" />
    </el-steps>

    <!-- ========== 第 1 步：上传 ========== -->
    <div v-if="step === 0" class="ui-upload">
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".xls,.xlsx"
        :on-change="handleFileChange"
        :on-exceed="handleExceed"
        drag
      >
        <Icon icon="ep:upload" :size="48" />
        <div class="el-upload__text">把文件拖到这里，或<em>点击选择</em></div>
        <template #tip>
          <div class="el-upload__tip">
            后缀名 .xls 或 .xlsx，最多 {{ maxImportRows }} 行 / {{ maxFileSizeMb }}MB。
            表头请用模板里的列名 —— 顺序可以打乱，<b>我们按列名匹配，不按位置</b>。
          </div>
        </template>
      </el-upload>

      <div class="ui-template">
        <span>还没有数据？</span>
        <el-button link type="primary" :loading="templateLoading" @click="handleDownloadTemplate">
          下载导入模板
        </el-button>
        <span class="ui-template-tip">
          模板里的「用户性别」「账号状态」填中文即可，系统会反查成对应的编码
        </span>
      </div>
    </div>

    <!-- ========== 第 2 步：预检与确认 ========== -->
    <div v-else-if="step === 1" class="ui-preview">
      <!-- 统计条。用户第一眼看的就是它 -->
      <div class="ui-summary">
        <div class="ui-summary-item">
          <span class="ui-summary-num">{{ preview?.summary.totalRows ?? 0 }}</span>
          <span class="ui-summary-label">数据行</span>
        </div>
        <div class="ui-summary-item ui-ok">
          <span class="ui-summary-num">{{ preview?.summary.newCount ?? 0 }}</span>
          <span class="ui-summary-label">将新增</span>
        </div>
        <div class="ui-summary-item ui-warn">
          <span class="ui-summary-num">{{ preview?.summary.existsCount ?? 0 }}</span>
          <span class="ui-summary-label">库中已存在</span>
        </div>
        <div class="ui-summary-item ui-warn">
          <span class="ui-summary-num">{{ preview?.summary.duplicateCount ?? 0 }}</span>
          <span class="ui-summary-label">文件内重复</span>
        </div>
        <div class="ui-summary-item ui-error">
          <span class="ui-summary-num">{{ preview?.summary.invalidCount ?? 0 }}</span>
          <span class="ui-summary-label">校验未通过</span>
        </div>
      </div>

      <!-- 表头映射：让用户看见「哪一列对到了哪个字段」 -->
      <el-collapse v-model="openedPanels" class="ui-collapse">
        <el-collapse-item name="mapping">
          <template #title>
            <span class="ui-collapse-title">
              表头匹配结果
              <el-tag size="small" type="success" class="ui-tag">
                {{ preview?.mappings.length ?? 0 }} 列已识别
              </el-tag>
              <el-tag
                v-if="preview?.unmatchedColumns.length"
                size="small"
                type="warning"
                class="ui-tag"
              >
                {{ preview?.unmatchedColumns.length }} 列未识别
              </el-tag>
              <el-tag
                v-if="preview?.duplicateColumns.length"
                size="small"
                type="danger"
                class="ui-tag"
              >
                {{ preview?.duplicateColumns.length }} 列重复
              </el-tag>
            </span>
          </template>
          <el-table :data="preview?.mappings ?? []" size="small" border max-height="240">
            <el-table-column prop="columnLetter" label="列" width="60" align="center" />
            <el-table-column prop="header" label="Excel 表头" min-width="150" />
            <el-table-column label="对应字段" min-width="200">
              <template #default="{ row }">
                <span>{{ row.fieldLabel }}</span>
                <el-tag v-if="row.required" size="small" type="danger" class="ui-tag">必填</el-tag>
                <el-tag v-if="row.dict" size="small" type="info" class="ui-tag">字典</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="field" label="字段名" min-width="140" />
          </el-table>

          <!-- 未识别与重复列要单独说清楚，这是最容易让人困惑的两件事 -->
          <div v-if="preview?.unmatchedColumns.length" class="ui-note ui-note-warn">
            <div v-for="col in preview.unmatchedColumns" :key="col.columnLetter">
              ⚠️ {{ col.columnLetter }} 列「{{ col.header }}」：{{ col.reason }}
            </div>
          </div>
          <div v-if="preview?.duplicateColumns.length" class="ui-note ui-note-error">
            <div v-for="col in preview.duplicateColumns" :key="col.columnLetter">
              ✖ {{ col.columnLetter }} 列「{{ col.header }}」：{{ col.reason }}
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>

      <!-- 整表级问题：缺必填列、被行数上限截断。这类问题一条都导不了或导不全，必须显眼 -->
      <el-alert
        v-if="preview?.tableErrors.length"
        type="error"
        :closable="false"
        class="ui-alert"
        show-icon
      >
        <template #title>这份文件有以下问题，请先处理</template>
        <div v-for="(err, i) in preview.tableErrors" :key="i">{{ err.message }}</div>
      </el-alert>

      <!--
        重复策略放在这里而不是上传前：
        改造前那个「是否更新已经存在的用户数据」的复选框是在上传【之前】勾的，
        也就是让用户在还不知道有几条已存在的时候盲选。
        现在这个选择是在看到「15 条已存在」之后做的
      -->
      <div v-if="hasExists" class="ui-strategy">
        <span class="ui-strategy-label">
          库中已存在的 {{ preview?.summary.existsCount }} 条怎么处理？
        </span>
        <el-radio-group v-model="strategy">
          <el-radio value="SKIP">跳过，并在结果里列出来（默认，不改任何已有数据）</el-radio>
          <el-radio value="UPDATE">
            按「{{ (preview?.updateKeyFields ?? []).join(' + ') || '登录名称' }}」覆盖更新
          </el-radio>
        </el-radio-group>
      </div>

      <el-checkbox v-model="allOrNothing" class="ui-all-or-nothing">
        全对才导（只要还剩一行不通过，整批都不导）
      </el-checkbox>

      <!-- 逐行预检 -->
      <div class="ui-rows-head">
        <span>数据预览</span>
        <span class="ui-rows-tip">
          共 {{ preview?.summary.totalRows ?? 0 }} 条， 这里显示
          {{ preview?.rows.length ?? 0 }} 条； 有问题的行可以点「删除」剔掉，其余会照常导入
        </span>
      </div>
      <el-table
        :data="displayRows"
        size="small"
        border
        max-height="300"
        :row-class-name="rowClassName"
      >
        <el-table-column prop="rowNo" label="行" width="60" align="center" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ row.statusText }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内容 / 问题" min-width="500">
          <template #default="{ row }">
            <!-- 有问题就先说问题，这是用户最需要看的东西 -->
            <div v-for="(err, i) in row.errors" :key="'e' + i" class="ui-row-error">
              <span v-if="err.columnLetter" class="ui-col">{{ err.columnLetter }} 列</span>
              <span v-if="err.fieldLabel" class="ui-field">{{ err.fieldLabel }}</span>
              {{ err.message }}
              <span v-if="err.rawValue" class="ui-raw">（原文：{{ err.rawValue }}）</span>
            </div>
            <div v-for="(warn, i) in row.warnings" :key="'w' + i" class="ui-row-warn">
              {{ warn.message }}
            </div>
            <div v-if="!row.errors?.length" class="ui-row-ok">{{ summarizeRow(row) }}</div>
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
    <div v-else class="ui-result">
      <el-result :icon="resultIcon" :title="resultTitle" :sub-title="resultSubTitle" />

      <el-alert
        v-if="result?.tableErrors.length"
        type="error"
        :closable="false"
        class="ui-alert"
        show-icon
      >
        <div v-for="(err, i) in result.tableErrors" :key="i">{{ err.message }}</div>
      </el-alert>

      <el-table
        v-if="result?.failures.length"
        :data="result.failures"
        size="small"
        border
        max-height="320"
      >
        <el-table-column prop="rowNo" label="行号" width="70" align="center" />
        <el-table-column prop="username" label="登录名" width="150" />
        <el-table-column prop="fieldLabel" label="出错字段" width="120" />
        <el-table-column prop="message" label="原因" min-width="300" />
        <el-table-column prop="rawValue" label="原文" width="120" />
      </el-table>
      <div v-if="result?.failures.length" class="ui-note">
        按上面的行号回到 Excel 改完，重新上传一次即可 —— 已经导进去的不会重复。
      </div>
    </div>

    <template #footer>
      <el-button v-if="step === 0" @click="dialogVisible = false">取 消</el-button>
      <el-button v-if="step === 1" @click="backToUpload">上一步</el-button>
      <el-button v-if="step === 0" type="primary" :loading="previewLoading" @click="handlePreview">
        下一步
      </el-button>
      <el-button
        v-if="step === 1"
        type="primary"
        :loading="executeLoading"
        :disabled="nothingToImport"
        @click="handleExecute"
      >
        确认导入
      </el-button>
      <el-button v-if="step === 2" type="primary" @click="handleClose">完 成</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import * as UserApi from '@/api/system/user'
import type {
  UserImportPreviewVO,
  UserImportPreviewRowVO,
  UserImportResultVO
} from '@/api/system/user'
import download from '@/utils/download'

/**
 * 用户导入向导
 *
 * ## 为什么要有中间那一步
 *
 * 改造前是「传完直接落库，然后弹一个 message.alert，里面是一长串拼起来的用户名」。
 * 这种形态最糟的地方不是失败本身，而是**失败与成功混在一次不可撤销的写入里**：
 * 一份 500 行的文件里有 3 行部门编号填错，用户点完确定才知道，
 * 此时 497 行已经进库了，他只能拿着一串用户名去猜哪几行要补。
 *
 * 三步之后，中间那一步把「会发生什么」和「真的发生」分开了。
 *
 * ⚠️ 所有校验都以**服务端**为准。前端在这里做的只是展示，
 * 不做任何「看起来没问题就放行」的判断。
 */
defineOptions({ name: 'SystemUserImportForm' })

const message = useMessage()
const emits = defineEmits(['success'])

const dialogVisible = ref(false)
const step = ref(0)

const uploadRef = ref()
const selectedFile = ref<File | null>(null)
const previewLoading = ref(false)
const executeLoading = ref(false)
const templateLoading = ref(false)

const preview = ref<UserImportPreviewVO | null>(null)
const result = ref<UserImportResultVO | null>(null)
const strategy = ref<'SKIP' | 'UPDATE'>('SKIP')
const allOrNothing = ref(false)
const removedRows = ref<number[]>([])
const openedPanels = ref<string[]>(['mapping'])

/** 与后端 UserController 的常量对齐，真正显示的是接口回来的值 */
const DEFAULT_MAX_ROWS = 20000
const DEFAULT_MAX_FILE_SIZE_MB = 10
const maxImportRows = ref(DEFAULT_MAX_ROWS)
const maxFileSizeMb = ref(DEFAULT_MAX_FILE_SIZE_MB)

const hasExists = computed(() => (preview.value?.summary.existsCount ?? 0) > 0)

/**
 * 剔掉的行不显示
 *
 * 用 filter 而不是从 preview.rows 里 splice —— 后者会把「原本有几行」这件事抹掉
 */
const displayRows = computed<UserImportPreviewRowVO[]>(
  () => preview.value?.rows.filter((row) => !removedRows.value.includes(row.rowNo)) ?? []
)

/**
 * 「确认导入」按不按得动
 *
 * 一行都不剩时按掉：点下去只会得到一条「导入数据不能为空」。
 *
 * ⚠️ 判据里要带上 `rows.length === totalRows` —— 行数多时服务端只回前若干行明细，
 * 用户把**显示出来的**那几行全删了不等于整批空了，后面还有没显示的行照样要导。
 * 不带这个条件的话，大文件删掉可见的几行就再也点不动了。
 */
const nothingToImport = computed(() => {
  const summary = preview.value?.summary
  if (!summary || summary.totalRows === 0) return true
  const allRowsShown = (preview.value?.rows.length ?? 0) === summary.totalRows
  return allRowsShown && displayRows.value.length === 0
})

const statusTagType = (status: string) => {
  switch (status) {
    case 'NEW':
      return 'success'
    case 'EXISTS':
      return 'warning'
    case 'DUPLICATE_IN_FILE':
    case 'INVALID':
      return 'danger'
    default:
      return 'info'
  }
}

const rowClassName = ({ row }: { row: UserImportPreviewRowVO }) =>
  row.status === 'INVALID' || row.status === 'DUPLICATE_IN_FILE' ? 'ui-row-bad' : ''

/**
 * 没问题的行显示什么
 *
 * ⚠️ 显示的是**解析后的值**，不是原始文本：用户在 Excel 里填的是部门编号 100，
 * 这里显示的是「研发部」；填的是「男」，服务端存的是 1。
 * 如果这张预览里显示的还是原文，用户就没法确认反查真的生效了 ——
 * 而「看不出来」正是导入功能最需要避免的事。
 */
const summarizeRow = (row: UserImportPreviewRowVO): string => {
  const data = row.data ?? {}
  const parts = Object.entries(data)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `${label}: ${value}`)
  return parts.join(' · ') || '(这一行是空的)'
}

const resultIcon = computed(() => {
  if (!result.value) return 'info'
  if (result.value.failCount === 0 && !result.value.tableErrors.length) return 'success'
  return result.value.createCount + result.value.updateCount > 0 ? 'warning' : 'error'
})

const resultTitle = computed(() => {
  if (!result.value) return ''
  const r = result.value
  if (r.tableErrors.length) return '整批都没有导入'
  if (r.failCount === 0) return '全部导入成功'
  if (r.createCount + r.updateCount === 0) return '一条都没有导入'
  return '部分导入成功'
})

const resultSubTitle = computed(() => {
  if (!result.value) return ''
  const r = result.value
  // 四个数分开报，用户自己就能核对自己选的策略有没有生效
  return `新增 ${r.createCount} 条，更新 ${r.updateCount} 条，跳过 ${r.skipCount} 条，失败 ${r.failCount} 条`
})

/** 打开弹窗 */
const open = async () => {
  reset()
  dialogVisible.value = true
  try {
    const config = await UserApi.getImportExportConfig()
    maxImportRows.value = config?.maxImportRows || DEFAULT_MAX_ROWS
    maxFileSizeMb.value = config?.maxImportFileSizeMb || DEFAULT_MAX_FILE_SIZE_MB
  } catch (e) {
    console.warn('[UserImportForm] 取导入上限失败，用默认值', e)
  }
}
defineExpose({ open })

const reset = () => {
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

const handleFileChange = (file: any) => {
  const raw: File = file.raw
  // 只认后缀，不看 MIME —— 不同浏览器给出的 type 五花八门，
  // 真正的判据是后端能不能解析
  const ext = (raw?.name ?? '').split('.').pop()?.toLowerCase()
  if (ext !== 'xls' && ext !== 'xlsx') {
    message.error('只支持 .xls 或 .xlsx 文件')
    uploadRef.value?.clearFiles?.()
    return
  }
  if (raw.size > maxFileSizeMb.value * 1024 * 1024) {
    message.error(`文件超过 ${maxFileSizeMb.value}MB，请拆分后分次导入`)
    uploadRef.value?.clearFiles?.()
    return
  }
  selectedFile.value = raw
}

/** 换文件时留最后一个：用户的预期是「换成刚选的那个」，不是「不许换」 */
const handleExceed = (files: File[]) => {
  uploadRef.value?.clearFiles?.()
  const file = files[0]
  uploadRef.value?.handleStart?.(file)
  handleFileChange({ raw: file })
}

const handleDownloadTemplate = async () => {
  templateLoading.value = true
  try {
    const res = await UserApi.importUserTemplate()
    download.excel(res, '用户导入模板.xls')
  } catch (e: any) {
    message.error(e?.msg || e?.message || '模板下载失败')
  } finally {
    templateLoading.value = false
  }
}

const handlePreview = async () => {
  if (!selectedFile.value) {
    message.warning('请先选择文件')
    return
  }
  previewLoading.value = true
  try {
    preview.value = await UserApi.importPreview(selectedFile.value)
    removedRows.value = []
    // 有已存在的行时默认仍是「跳过」—— 覆盖是会改线上数据的那一个，
    // 不该由默认值替用户做这个决定
    strategy.value = 'SKIP'
    step.value = 1
  } catch (e: any) {
    // 解析失败要说清是文件的问题 —— 只报「导入失败」的话，
    // 用户会以为是系统坏了，然后反复重试同一个文件
    message.error(e?.msg || e?.message || '文件解析失败，请确认格式后重试')
  } finally {
    previewLoading.value = false
  }
}

const handleExecute = async () => {
  if (!preview.value) return
  executeLoading.value = true
  try {
    result.value = await UserApi.importExecute({
      importToken: preview.value.importToken,
      removedRows: removedRows.value,
      duplicateStrategy: strategy.value,
      allOrNothing: allOrNothing.value
    })
    step.value = 2
  } catch (e: any) {
    message.error(e?.msg || e?.message || '导入失败')
  } finally {
    executeLoading.value = false
  }
}

const removeRow = (row: UserImportPreviewRowVO) => {
  removedRows.value.push(row.rowNo)
}

const backToUpload = () => {
  step.value = 0
}

const handleClose = () => {
  const changed = (result.value?.createCount ?? 0) + (result.value?.updateCount ?? 0) > 0
  dialogVisible.value = false
  if (changed) {
    emits('success')
  }
}
</script>

<style lang="scss" scoped>
.ui-steps {
  margin-bottom: 20px;
}

.ui-upload {
  min-height: 260px;
}

.ui-template {
  margin-top: 16px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.ui-template-tip {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ui-summary {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.ui-summary-item {
  flex: 1;
  padding: 10px 0;
  text-align: center;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}

.ui-summary-num {
  display: block;
  font-size: 22px;
  font-weight: 600;
}

.ui-summary-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.ui-summary-item.ui-ok .ui-summary-num {
  color: var(--el-color-success);
}

.ui-summary-item.ui-warn .ui-summary-num {
  color: var(--el-color-warning);
}

.ui-summary-item.ui-error .ui-summary-num {
  color: var(--el-color-danger);
}

.ui-collapse-title {
  font-weight: 600;
}

.ui-tag {
  margin-left: 6px;
}

.ui-note {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}

.ui-note-warn {
  color: var(--el-color-warning);
}

.ui-note-error {
  color: var(--el-color-danger);
}

.ui-alert {
  margin: 12px 0;
}

.ui-strategy {
  margin: 12px 0;
}

.ui-strategy-label {
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
}

.ui-all-or-nothing {
  margin-bottom: 12px;
}

.ui-rows-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
  font-weight: 600;
}

.ui-rows-tip {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.ui-row-error {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.7;
}

.ui-row-warn {
  color: var(--el-color-warning);
  font-size: 12px;
  line-height: 1.7;
}

.ui-row-ok {
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.ui-col,
.ui-field {
  margin-right: 6px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--el-fill-color);
}

.ui-raw {
  color: var(--el-text-color-secondary);
}

:deep(.ui-row-bad) {
  background: var(--el-color-danger-light-9);
}

.ui-result {
  min-height: 280px;
}
</style>
