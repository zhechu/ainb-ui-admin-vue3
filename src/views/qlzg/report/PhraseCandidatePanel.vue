<template>
  <div class="phrase-panel">
    <div class="panel-head">
      <span class="panel-title">本节可用话术</span>
      <el-button link type="primary" :loading="loading" @click="load">
        <Icon icon="ep:refresh" class="mr-3px" /> 换一批
      </el-button>
    </div>

    <!--
      🔴 空**不是**故障，而这句话必须把原因说出来：候选清单有一条 SQL 闸
         （只返回 review_status = APPROVED 的行），而平台自带的 56 条种子目前全是草稿。
         不写这一句的话，评估师会得出「这个工具的推荐是坏的」——
         而正确的动作是去话术库点「审核通过」
    -->
    <el-alert v-if="!loading && list.length === 0" type="info" :closable="false" show-icon>
      <template #title>这里现在没有候选</template>
      <div class="panel-hint">{{ emptyCandidateText(sectionCode) }}</div>
    </el-alert>

    <el-alert
      v-else-if="loadError"
      type="error"
      :closable="false"
      show-icon
      :title="loadError"
      class="mb-8px"
    />

    <div v-loading="loading" class="panel-body">
      <el-card
        v-for="item in list"
        :key="item.id"
        shadow="never"
        class="cand-card"
        :body-style="{ padding: '10px 12px' }"
      >
        <div class="cand-head">
          <span class="cand-name">{{ item.phraseName }}</span>
          <!--
            🔴 分数**不做浮点运算、不 toFixed**：它是后端 4 位定标的 BigDecimal，
               补出来的那一位在后端明细里没有对应项，对不上账。
               顺序也按后端给的（它已经排好了），前端不再排一次
          -->
          <el-tag size="small" type="info" effect="plain">{{ scoreText(item.score) }} 分</el-tag>
        </div>

        <div class="cand-meta">
          <el-tag size="small" :type="item.triggered === true ? 'success' : 'warning'" effect="plain">
            {{ triggeredLabel(item) }}
          </el-tag>
          <el-tag v-if="item.platform" size="small" effect="plain">平台</el-tag>
          <span v-if="item.clauseRef" class="cand-clause">{{ item.clauseRef }}</span>
          <span v-if="item.usageCount" class="cand-usage">用过 {{ item.usageCount }} 次</span>
        </div>

        <!--
          🔴 「为什么排在这里」必须显示出来（§11.6.2 要的是**可解释**）：
             只显示一个分数的话，那个分数对评估师没有意义，
             他只能从头读一遍每条正文 —— 而四十条正文比一句话慢得多
        -->
        <div v-if="candidateReasonText(item)" class="cand-because">
          {{ candidateReasonText(item) }}
        </div>

        <div class="cand-actions">
          <el-button link type="primary" @click="openInsert(item)">预览并插入</el-button>
          <el-button link @click="toggleDetail(item.id)">
            {{ detailOpen.has(item.id) ? '收起明细' : '打分明细' }}
          </el-button>
        </div>

        <!--
          🔴 明细只用于「展开看」，不要据此重算分数或重拼理由：
             那份 scoreDetail 是给机器复算的，前端拼出来的措辞会与后端对不上，
             而「工具给的理由与它自己算的分对不上」正是评估师不再信任排序的那个瞬间
        -->
        <div v-if="detailOpen.has(item.id)" class="cand-detail">
          <div v-for="(reason, idx) in item.reasons ?? []" :key="idx" class="detail-line">
            · {{ reason }}
          </div>
          <pre v-if="item.scoreDetail" class="detail-json">{{
            JSON.stringify(item.scoreDetail, null, 2)
          }}</pre>
        </div>
      </el-card>
    </div>

    <!-- 插入对话框：先渲染预览、看完警示再插 -->
    <Dialog v-model="insertVisible" title="预览并插入话术" width="720">
      <div v-loading="rendering">
        <el-alert v-if="renderError" type="error" :closable="false" show-icon :title="renderError">
          <div class="panel-hint">
            渲染失败时<b>不能</b>插入：话术正文里的占位符取不到值就是硬失败，
            不是留个空格 —— 一处被静默清空的空格在一份法定报告里读起来像「这一项本来就没有」。
          </div>
        </el-alert>

        <template v-else>
          <el-descriptions :column="2" border size="small" class="mb-12px">
            <el-descriptions-item label="话术">{{ current?.phraseName }}</el-descriptions-item>
            <el-descriptions-item label="准则条款">{{ current?.clauseRef || '—' }}</el-descriptions-item>
          </el-descriptions>

          <!--
            🔴 warnings 非空说明正文里有原样保留的片段（例如一段模板层的 {{...}}）。
               静默插进去的后果要到成文那一刻才显形：出稿期闸 B 会把它数成一个残留，
               而那份 Word 上印着两个花括号 —— 评估师那时已经想不起来是哪一步带进来的。
               所以这里要求他**显式认一次**，而不是只把警示画出来
          -->
          <el-alert
            v-if="warnings.length > 0"
            type="warning"
            :closable="false"
            show-icon
            class="mb-12px"
          >
            <template #title>这一段正文里有 {{ warnings.length }} 处会被原样印进报告</template>
            <div v-for="(warn, idx) in warnings" :key="idx" class="panel-hint">{{ warn }}</div>
            <el-checkbox v-model="warningAck" class="mt-8px">
              我已看过上面这几处，仍然要原样插入
            </el-checkbox>
          </el-alert>

          <el-form label-width="110px" class="mt-4px">
            <el-form-item label="渲染后的正文">
              <el-input :model-value="rendered" type="textarea" :rows="8" readonly />
              <div class="panel-hint">
                这是按<b>当前标的</b>替换过占位符之后的正文，也就是插入后写进报告的那一段。
                插入之后要改措辞，请在中栏那一格里直接改（改完来源仍是「话术」）。
              </div>
            </el-form-item>

            <el-form-item label="插到哪个字段键" required>
              <el-select
                v-model="insertForm.fieldKey"
                filterable
                allow-create
                default-first-option
                placeholder="请选择或输入字段键"
                class="w-full"
              >
                <el-option
                  v-for="opt in fieldKeyOptions"
                  :key="opt.key"
                  :label="`${opt.label}（${opt.key}）`"
                  :value="opt.key"
                />
              </el-select>
              <!--
                🔴 这一栏**不能**给默认值：它决定这段正文落在报告的哪个位置
                   （成文时按模板里绑到该键的占位符替换）。
                   替他选一个的话，一段免责声明可能出现在「现场查勘」那一节 ——
                   而两份 Word 都不会报错，只有通读一遍才发现
              -->
              <div class="panel-hint">
                成文时这一格会填进模板里<b>绑到该字段键</b>的那个占位符。选错的话，
                这段正文会出现在报告的另一个位置。手输一个品类里没有的键会被后端拦下。
              </div>
            </el-form-item>

            <el-form-item label="占位符名">
              <el-input v-model="insertForm.placeholder" placeholder="可空，留空时渲染按字段键回落" maxlength="100" />
            </el-form-item>

            <el-form-item label="顺序">
              <el-input-number v-model="insertForm.sort" :min="0" :precision="0" controls-position="right" />
              <div class="panel-hint">
                同一节里按这一列排。可空。
              </div>
            </el-form-item>
          </el-form>
        </template>
      </div>

      <template #footer>
        <el-button
          type="primary"
          :disabled="rendering || !!renderError || warningsNotAcked"
          :loading="inserting"
          @click="submitInsert"
        >
          插 入
        </el-button>
        <el-button @click="insertVisible = false">取 消</el-button>
      </template>
    </Dialog>
  </div>
</template>
<script lang="ts" setup>
import {
  QlzgPhraseApi,
  type QlzgPhraseCandidateVO,
  type QlzgPhraseRenderVO
} from '@/api/qlzg/phrase'
import { QlzgReportApi } from '@/api/qlzg/report'
import { candidateReasonText, emptyCandidateText, scoreText, triggeredLabel } from './reportFlow'

/**
 * 作业台右栏 —— 本节的话术候选 + 插入前的渲染预览
 *
 * <h3>🔴 一律带**当前那一节的章节码**去取候选</h3>
 * `/candidate-list` 不传（或传空）时后端**只**返回不限章节的通用话术，
 * 不是「返回全部章节的话术」。而平台种子的 56 条<b>全部</b>带非空 `section_code`，
 * 所以漏传参数的表现是右栏<b>几乎是空的</b>，而不是「顺序不对」。
 * 空得像个 bug，而它其实是一个入参问题 —— 这就是 {@link emptyCandidateText}
 * 要分两句话说清「没选章节」与「这一节没有通过审核的话术」的原因。
 *
 * <h3>🔴 插入**必须先渲染预览**</h3>
 * `/render` 只算不写（不加 `usage_count`），所以预览是免费的。
 * 而插入那一刻后端会再渲一次、把结果写进 `value_str` —— 前端**不收** content，
 * 因为收了就等于让「渲染」这一步可以被整个跳过：一份带着字面量花括号的正文
 * 会作为**值**进报告，而出稿期闸 B 扫的是渲染产物，扫不到值里面的花括号。
 *
 * <h3>🔴 预览失败时**不给**插入按钮</h3>
 * `PHRASE_PLACEHOLDER_UNRESOLVED` 是硬失败（取不到值就是拒绝，不是留空格）。
 * 那时继续插入只会把同一句报错再撞一次，而评估师会以为是网络问题去重试。
 *
 * <h3>为什么打分与排序**都在后端**</h3>
 * 见 {@link scoreText}：一份由前端重排的候选清单，在两个浏览器上可能给出不同顺序，
 * 而评估师会认为「这个工具每次给的建议都不一样」。可解释性要求的是**可复算**，
 * 不是「看起来合理」。
 */
defineOptions({ name: 'QlzgPhraseCandidatePanel' })

const props = defineProps<{
  reportId: number | null
  sectionId: number | null
  sectionCode?: string | null
  /** 字段键候选。🔴 允许手输：品类里没有的键由后端拦（REPORT_FIELD_KEY_UNKNOWN） */
  fieldKeyOptions?: { key: string; label: string }[]
}>()

const emit = defineEmits<{ (e: 'inserted', fieldId: number): void }>()

const message = useMessage()

const loading = ref(false)
const loadError = ref('')
const list = ref<QlzgPhraseCandidateVO[]>([])
const detailOpen = ref(new Set<number>())

const insertVisible = ref(false)
const rendering = ref(false)
const renderError = ref('')
const rendered = ref('')
const warnings = ref<string[]>([])
const warningAck = ref(false)
const inserting = ref(false)
const current = ref<QlzgPhraseCandidateVO | null>(null)

const insertForm = ref({
  fieldKey: '',
  placeholder: '',
  sort: undefined as number | undefined
})

const warningsNotAcked = computed(() => warnings.value.length > 0 && !warningAck.value)

const toggleDetail = (id: number) => {
  const next = new Set(detailOpen.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  detailOpen.value = next
}

const load = async () => {
  const reportId = props.reportId
  if (!reportId || !props.sectionId) {
    list.value = []
    loadError.value = ''
    return
  }
  loading.value = true
  try {
    list.value = (await QlzgPhraseApi.getCandidateList(reportId, props.sectionCode)) ?? []
    loadError.value = ''
  } catch (error: any) {
    list.value = []
    loadError.value = error?.message || '候选话术加载失败'
  } finally {
    loading.value = false
  }
}

const openInsert = async (item: QlzgPhraseCandidateVO) => {
  current.value = item
  insertForm.value = { fieldKey: '', placeholder: '', sort: undefined }
  rendered.value = ''
  warnings.value = []
  warningAck.value = false
  renderError.value = ''
  insertVisible.value = true
  if (!props.reportId) return
  rendering.value = true
  try {
    const preview: QlzgPhraseRenderVO = await QlzgPhraseApi.renderForReport(item.id, props.reportId)
    rendered.value = preview?.content ?? ''
    warnings.value = (preview?.warnings ?? []).filter((warn) => !!warn)
  } catch (error: any) {
    // 🔴 报错原文由 axios 拦截器弹一次，这里再落到 alert 上：
    //    toast 三秒就没了，而他要在 alert 上读到「为什么插不进去」才不会再试一次
    renderError.value = error?.message || '渲染失败，这一条现在插不进去'
  } finally {
    rendering.value = false
  }
}

const submitInsert = async () => {
  const fieldKey = insertForm.value.fieldKey.trim()
  if (!fieldKey) {
    message.error('请先选定这一段要插到哪个字段键')
    return
  }
  if (!props.reportId || !props.sectionId || !current.value) return
  inserting.value = true
  try {
    const fieldId = await QlzgReportApi.insertPhrase({
      reportId: props.reportId,
      sectionId: props.sectionId,
      phraseId: current.value.id,
      fieldKey,
      placeholder: insertForm.value.placeholder.trim() || null,
      sort: insertForm.value.sort ?? null
    })
    message.success('已插入本节。这一节的来源已标为「话术」，改值时不要另存一次')
    insertVisible.value = false
    emit('inserted', fieldId)
    // 🔴 插入会让 usage_count +1，而它是打分的一项 —— 所以清单要重取一遍，
    //    否则评估师会看到「刚插过的那一条分数没变」，以为计数没生效
    await load()
  } finally {
    inserting.value = false
  }
}

watch(() => [props.reportId, props.sectionId, props.sectionCode], load, { immediate: true })
</script>
<style lang="scss" scoped>
.phrase-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
}

.panel-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.panel-body {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
}

.cand-card {
  margin-bottom: 8px;
  border: 1px solid var(--el-border-color-lighter);
}

.cand-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cand-name {
  font-size: 13px;
  font-weight: 600;
}

.cand-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
}

.cand-clause,
.cand-usage {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.cand-because {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.cand-actions {
  margin-top: 6px;
}

.cand-detail {
  padding-top: 6px;
  margin-top: 6px;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.detail-line {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.detail-json {
  max-height: 160px;
  padding: 6px 8px;
  margin: 6px 0 0;
  overflow: auto;
  font-size: 11px;
  line-height: 1.5;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}
</style>
