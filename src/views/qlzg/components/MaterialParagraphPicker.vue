<template>
  <el-dialog
    v-model="visible"
    title="给这一格挂上资料原文依据"
    width="1000"
    :close-on-click-modal="false"
  >
    <!--
      🔴 三个入参全是【指针】：资料编号 + 段落序号。原文由服务端从
         qlzg_material.text_content 里按段号取，前端一个字都不上送。
         让请求体决定「哪一段原文当证据」，就等于让调用方可以提交一段与原件不符的文字，
         而弹层照样弹出、照样显示，界面上看不出任何异常
    -->
    <div v-if="fieldLabel" class="picker-target">
      要挂到：<b>{{ fieldLabel }}</b>
    </div>

    <div class="picker-body">
      <div class="picker-left">
        <div class="pane-title">本项目的资料</div>
        <el-input
          v-model="materialKeyword"
          placeholder="按文件名筛"
          clearable
          size="small"
          class="pane-search"
          @keyup.enter="loadMaterials(1)"
          @clear="loadMaterials(1)"
        />
        <div v-loading="materialLoading" class="material-list">
          <div v-if="!materialLoading && materials.length === 0" class="pane-empty">
            这个项目下还没有资料。资料在「项目详情 → 资料面板」里上传。
          </div>
          <div
            v-for="m in materials"
            :key="m.id"
            class="material-item"
            :class="{ active: m.id === selectedMaterialId }"
            @click="selectMaterial(m)"
          >
            <div class="material-name">{{ m.fileName }}</div>
            <div class="material-sub">
              <el-tag v-if="m.category" size="small" type="info">
                {{ labelOf(MATERIAL_CATEGORY_OPTIONS, m.category) || m.category }}
              </el-tag>
              <!--
                🔴 这一句是「为什么选不了」的答案。抽取还没跑完的资料
                   切不出段落，而它切不出段落**不是**这份资料没用 ——
                   等一下再来就有了。把它显示成「没有正文」的话，
                   评估师会转而去挂另一份更差的依据
              -->
              <span v-if="!m.extractTerminal" class="material-pending">正文解析中</span>
              <span v-else-if="m.extractStatus === 'FAILED'" class="material-pending">
                正文抽取失败
              </span>
              <span v-else-if="m.extractStatus === 'SKIPPED_TOO_LARGE'" class="material-pending">
                文件过大已跳过抽取
              </span>
            </div>
          </div>
          <el-pagination
            v-if="materialTotal > materialPageSize"
            v-model:current-page="materialPageNo"
            :page-size="materialPageSize"
            :total="materialTotal"
            layout="prev, pager, next"
            small
            class="pane-pager"
            @current-change="loadMaterials"
          />
        </div>
      </div>

      <div class="picker-right">
        <div class="pane-title">
          选一段正文
          <span v-if="paragraphs.length > 0" class="pane-count"> 共 {{ paragraphCount }} 段 </span>
        </div>
        <el-input
          v-model="paragraphFilter"
          placeholder="在正文里找关键字（只影响显示，不改段号）"
          clearable
          size="small"
          class="pane-search"
          :disabled="paragraphs.length === 0"
        />
        <div v-loading="paragraphLoading" class="paragraph-list">
          <div v-if="!selectedMaterialId" class="pane-empty">先在左边选一份资料</div>
          <div v-else-if="!paragraphLoading && paragraphs.length === 0" class="pane-empty">
            {{ emptyParagraphHint }}
          </div>
          <div
            v-for="p in visibleParagraphs"
            :key="p.no"
            class="paragraph-item"
            :class="{ active: p.no === selectedParagraphNo }"
            @click="selectedParagraphNo = p.no"
          >
            <!--
              🔴 段号由后端下发、从 1 开始，落进 locator 的就是这个数。
                 前端【不许】自己切段也不许自己编号：另切一套的话，
                 这里显示的「第 12 段」与落库的 s12 会指向不同的文字 ——
                 两个数都合法、都不报错，只有三年后翻档案的人会发现指错了位置
            -->
            <div class="paragraph-no mono">s{{ p.no }}</div>
            <!--
              🔴 pre-wrap 照原样显示，不用 v-html、不再格式化：
                 后端在这一层不做任何加工，而这一段会被原样写进 snapshot_text。
                 前端再折叠一次空白或换一次引号，就会让这里看到的与落库的那一份差一点 ——
                 差的那一点在质询现场叫「与原件不符」
            -->
            <div class="paragraph-text">{{ p.text }}</div>
          </div>
          <div v-if="paragraphFilter && visibleParagraphs.length === 0 && paragraphs.length > 0">
            <div class="pane-empty">没有哪一段含这个关键字</div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="selectedParagraphNo === null"
        @click="submit"
      >
        挂到这一格
      </el-button>
    </template>
  </el-dialog>
</template>
<script lang="ts" setup>
import {
  QlzgMaterialApi,
  type QlzgMaterialParagraphItemVO,
  type QlzgMaterialVO
} from '@/api/qlzg/material'
import { QlzgReportApi } from '@/api/qlzg/report'
import { useMessage } from '@/hooks/web/useMessage'
import { MATERIAL_CATEGORY_OPTIONS, labelOf } from '@/views/qlzg/constants'

/**
 * 资料段落选择器 —— {@code POST /qlzg/report/field/attach-material} 的唯一入口
 *
 * <h3>🔴 它存在的理由是「MATERIAL 类此前一处写入方都没有」</h3>
 * 验收 D8 判据③要的是「MATERIAL 类能定位到某一段，点开看到<b>原文快照</b>（不是链接）」。
 * 在这个组件与它调的那个端点之前，那一类行<b>压根不存在</b>：
 * 弹层永远弹不出 MATERIAL，而 D8 签不了字
 *
 * <h3>🔴 段号是<b>人选的</b>，不是抽取猜的</h3>
 * 抽取只负责把字节变成文本，它不知道「哪一段支撑了报告上那个数」——
 * 那是评估师的判断。所以这里给的是一个<b>选择器</b>，
 * 而不是一个「自动匹配最相关段落」的按钮。
 * 后者会在界面上省掉一次点击，代价是一批指错位置的溯源，
 * 而指错位置的溯源<b>比没有溯源更坏</b>：它让弹层显示得像是有依据的
 *
 * <h3>🔴 正文里那个筛选框<b>只影响显示</b>，不改段号</h3>
 * {@code visibleParagraphs} 是 {@code paragraphs} 的一个子集，
 * 而 {@code selectedParagraphNo} 取的是后端下发的那个 {@code no}。
 * 按筛选后的下标重新编号的话，筛一次就错一次，
 * 而这个错误在界面上完全看不出来（左右两个数都合法）
 *
 * <h3>⚠️ 挂完<b>不要</b>再调一次 {@code saveFieldValue}</h3>
 * 那是一次值写入，会连带触发「值变了 ⇒ 那份已成文的 Word 不作数」
 * 与「值变了 ⇒ 红标确认打回未确认」，
 * 一次纯证据动作会静默毁掉评估师此前的确认
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgMaterialParagraphPicker' })

const emit = defineEmits<{ success: [provenanceId: number] }>()
const message = useMessage()

const visible = ref(false)
const submitting = ref(false)

const fieldId = ref<number | null>(null)
const projectId = ref<number | null>(null)
const fieldLabel = ref('')

// ---- 左栏：本项目的资料 ----
const materials = ref<QlzgMaterialVO[]>([])
const materialLoading = ref(false)
const materialKeyword = ref('')
const materialPageNo = ref(1)
const materialPageSize = 50
const materialTotal = ref(0)
const selectedMaterialId = ref<number | null>(null)
const selectedMaterial = ref<QlzgMaterialVO | null>(null)

// ---- 右栏：那一份资料的分段正文 ----
const paragraphs = ref<QlzgMaterialParagraphItemVO[]>([])
const paragraphLoading = ref(false)
const paragraphFilter = ref('')
const paragraphCount = ref(0)
const extractTerminal = ref(true)
const extractStatus = ref('')
const extractError = ref<string | null>(null)
const selectedParagraphNo = ref<number | null>(null)

const visibleParagraphs = computed(() => {
  const kw = paragraphFilter.value.trim().toLowerCase()
  if (!kw) return paragraphs.value
  return paragraphs.value.filter((p) => p.text.toLowerCase().includes(kw))
})

const emptyParagraphHint = computed(() => {
  if (!extractTerminal.value) return '这份资料的正文还在解析中，稍后再回来选'
  if (extractStatus.value === 'FAILED') {
    return `这份资料抽不出正文，所以定位不到某一段${
      extractError.value ? `：${extractError.value}` : ''
    }`
  }
  if (extractStatus.value === 'SKIPPED_TOO_LARGE') return '这份文件过大，平台跳过了正文抽取'
  return '这份资料没有可检索正文（多半是扫描件），所以定位不到某一段'
})

const loadMaterials = async (pageNo?: number) => {
  if (projectId.value == null) return
  if (pageNo) materialPageNo.value = pageNo
  materialLoading.value = true
  try {
    const page = await QlzgMaterialApi.getMaterialPage({
      projectId: projectId.value,
      fileName: materialKeyword.value.trim() || undefined,
      pageNo: materialPageNo.value,
      pageSize: materialPageSize
    })
    materials.value = page.list ?? []
    materialTotal.value = page.total ?? 0
  } catch {
    // 🔴 吞掉：报错原文已由 axios 拦截器弹出，这里再抛一次就是两个框，
    //    而一个未处理的 rejection 还会让弹层停在「loading 转完、左栏空白」的状态
    materials.value = []
    materialTotal.value = 0
  } finally {
    materialLoading.value = false
  }
}

const selectMaterial = async (m: QlzgMaterialVO) => {
  if (selectedMaterialId.value === m.id) return
  selectedMaterialId.value = m.id
  selectedMaterial.value = m
  selectedParagraphNo.value = null
  paragraphFilter.value = ''
  paragraphs.value = []
  paragraphCount.value = 0
  // 🔴 抽取没跑完的资料压根不去拉分段：那一次请求必然返回空列表，
  //    而空列表在右栏显示成「没有正文」，与「这份是扫描件」长得一模一样
  if (!m.extractTerminal) {
    extractTerminal.value = false
    extractStatus.value = m.extractStatus ?? ''
    extractError.value = null
    return
  }
  extractTerminal.value = true
  extractStatus.value = m.extractStatus ?? ''
  extractError.value = m.extractError ?? null
  paragraphLoading.value = true
  try {
    const resp = await QlzgMaterialApi.getParagraphs(m.id)
    paragraphs.value = resp.paragraphs ?? []
    paragraphCount.value = resp.paragraphCount ?? paragraphs.value.length
    // 🔴 以后端那一份为准：它与 list 页上那一列可能差一个时刻
    //    （列表是先查的，抽取可能在这中间跑完了）
    extractTerminal.value = resp.extractTerminal
    extractStatus.value = resp.extractStatus ?? extractStatus.value
    extractError.value = resp.extractError ?? null
  } catch {
    paragraphs.value = []
    paragraphCount.value = 0
  } finally {
    paragraphLoading.value = false
  }
}

const submit = async () => {
  if (
    fieldId.value == null ||
    selectedMaterialId.value == null ||
    selectedParagraphNo.value == null
  ) {
    return
  }
  submitting.value = true
  try {
    const provenanceId = await QlzgReportApi.attachMaterialProvenance({
      fieldId: fieldId.value,
      materialId: selectedMaterialId.value,
      paragraphNo: selectedParagraphNo.value
    })
    // 🔴 后端是幂等的：同一段重复挂返回已有的那一行编号、不新写。
    //    所以这里的文案不能说「已新增」—— 说错了会让人以为档案里多了一行
    message.success('已挂上这一段依据')
    visible.value = false
    emit('success', provenanceId)
  } catch {
    // 🔴 弹层**保持打开**、选中的那一段也不清：
    //    失败最常见的原因是「这一格所属的报告已经定稿」，他读完那句报错之后
    //    要做的是回到台账换一份报告，而不是在这一屏里重新翻一遍几十段正文
  } finally {
    submitting.value = false
  }
}

const open = async (query: { fieldId: number; projectId: number; fieldLabel?: string }) => {
  fieldId.value = query.fieldId
  projectId.value = query.projectId
  fieldLabel.value = query.fieldLabel ?? ''
  visible.value = true
  selectedMaterialId.value = null
  selectedMaterial.value = null
  selectedParagraphNo.value = null
  paragraphFilter.value = ''
  materialKeyword.value = ''
  paragraphs.value = []
  paragraphCount.value = 0
  await loadMaterials(1)
}

defineExpose({ open })
</script>
<style lang="scss" scoped>
.picker-target {
  padding: 6px 10px;
  margin-bottom: 10px;
  font-size: 13px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.picker-body {
  display: flex;
  gap: 12px;
  height: 480px;
}

.picker-left {
  display: flex;
  flex: 0 0 320px;
  flex-direction: column;
}

.picker-right {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.pane-title {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.pane-count {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.pane-search {
  margin-bottom: 8px;
}

.pane-empty {
  padding: 16px 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.material-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.material-item {
  padding: 6px 8px;
  margin-bottom: 4px;
  cursor: pointer;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;

  &.active {
    background: var(--el-color-primary-light-9);
    border-color: var(--el-color-primary-light-5);
  }
}

.material-name {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
}

.material-sub {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 2px;
}

.material-pending {
  font-size: 12px;
  color: var(--el-color-warning);
}

.pane-pager {
  margin-top: 6px;
}

.paragraph-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.paragraph-item {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: pointer;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;

  &.active {
    background: var(--el-color-primary-light-9);
    border-color: var(--el-color-primary);
  }
}

.paragraph-no {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.paragraph-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.7;
  /* 🔴 pre-wrap：这里的字面形状就是要落进 snapshot_text 的那一份 */
  white-space: pre-wrap;
  word-break: break-word;
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}
</style>
