<template>
  <el-dialog
    :model-value="modelValue"
    :title="text?.fileName || '资料正文'"
    width="900px"
    top="6vh"
    append-to-body
    @update:model-value="onVisibleChange"
    @open="load"
  >
    <div v-loading="loading" class="min-h-200px">
      <div class="flex items-center gap-8px mb-12px text-13px">
        <el-tag :type="extractStatusTagType(text?.extractStatus)" size="small">
          {{ extractStatusLabel(text?.extractStatus) }}
        </el-tag>
        <span v-if="text && text.extractTerminal" class="text-[var(--el-text-color-secondary)]">
          共 {{ text.paragraphCount }} 段
        </span>
        <span v-else class="text-[var(--el-text-color-secondary)]">解析中…</span>
        <el-button
          v-if="text && extractRetryable(text.extractTerminal, text.extractStatus)"
          link
          type="primary"
          size="small"
          data-testid="re-extract"
          @click="onReExtract"
        >
          重新抽取
        </el-button>
        <el-button link type="primary" size="small" @click="onOpenOriginal">查看原件</el-button>
      </div>

      <!-- 🔴 非终态：转圈。`textContent` 为 null 有四种原因（排队中 / 正在抽 / 太大跳过 / 失败），
           前两种要继续转、后两种要给结论。判据是 `extractTerminal`，**不是** `textContent == null`。 -->
      <div v-if="text && !text.extractTerminal" class="py-40px text-center">
        <Icon icon="ep:loading" :size="24" class="animate-spin" />
        <div class="mt-8px text-13px text-[var(--el-text-color-secondary)]">
          正文还在抽取，抽完会自动显示（每 5 秒问一次）
        </div>
      </div>

      <!-- 🔴 FAILED：给出原因，并说明「文件本身没问题」 -->
      <el-alert
        v-else-if="text?.extractStatus === 'FAILED'"
        type="error"
        :closable="false"
        show-icon
      >
        <template #title>正文抽取失败</template>
        {{ text?.extractError || '原因未知' }}。文件本身已经存好了、可以下载归档，只是里面的字搜不到
      </el-alert>

      <!-- 🔴 SKIPPED_TOO_LARGE **不是错误**：那是为了保护抽取队列主动跳过的。
           标红会让用户以为这份坏了、反复重传，而重传多少次结果都一样 -->
      <el-alert
        v-else-if="text?.extractStatus === 'SKIPPED_TOO_LARGE'"
        type="info"
        :closable="false"
        show-icon
      >
        <template #title>这份太大，没有抽取正文</template>
        文件本身完全可用（能下载、能归档、能作为报告附件），只是里面的字搜不到。
        需要检索这份内容时，请把它拆成几份小的重新上传
      </el-alert>

      <!-- 🔴 SUCCESS + 空正文是**扫描件的正常终态**，不是「抽取失败」 -->
      <el-alert
        v-else-if="text && text.extractTerminal && !text.textContent"
        type="info"
        :closable="false"
        show-icon
      >
        <template #title>这份没有可抽取的文字</template>
        多半是扫描件或纯图片（照片、图纸、盖章页的图像版）。文件本身完好，
        需要里面的内容时请人工看一眼原件
      </el-alert>

      <pre
        v-else-if="text?.textContent"
        class="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all m-0 p-12px text-13px leading-22px bg-[var(--el-fill-color-lighter)] rounded-6px font-sans"
        >{{ shownText }}</pre
      >

      <div v-if="truncatedText" class="mt-8px text-12px text-[var(--el-text-color-secondary)]">
        正文共 {{ text?.textContent?.length }} 字，这里只显示前
        {{ MAX_SHOWN_CHARS }} 字（全文请查看原件）
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { QlzgMaterialApi, type QlzgMaterialTextVO } from '@/api/qlzg/material'
import { extractRetryable, extractStatusLabel, extractStatusTagType } from '../../constants'

/**
 * 资料正文查看
 *
 * 🔴 「还在抽不在抽」的判据是后端发来的 `extractTerminal`，前端**不抄一份状态码集合**。
 *    两份定义的坏法很具体：后端加了个新状态码，前端那份集合没跟上，
 *    于是「排队中」的资料被显示成「没有正文」，用户以为这份是扫描件。
 *
 * ⚠️ `textContent` 可能很大（一份 200 页的 PDF 抽出来几十万字），
 *    所以只渲染前 {@link MAX_SHOWN_CHARS} 字。`<pre>` 一次性塞几十万字的代价是
 *    浏览器卡死几秒，而用户其实只想确认「抽出来了、内容对不对」。
 */
defineOptions({ name: 'QlzgMaterialTextDialog' })

const props = defineProps<{
  modelValue: boolean
  materialId?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void
  /** 重抽被受理 —— 父组件据此刷新列表里的抽取状态 */
  (e: 'reExtracted'): void
}>()

const message = useMessage()

/** 渲染上限。超出部分不塞进 DOM，只在下面说明「还有多少字」 */
const MAX_SHOWN_CHARS = 20000
/** 非终态时的轮询间隔 */
const POLL_INTERVAL = 5000

const loading = ref(false)
const text = ref<QlzgMaterialTextVO>()
let pollTimer: ReturnType<typeof setInterval> | undefined

const shownText = computed(() => (text.value?.textContent ?? '').slice(0, MAX_SHOWN_CHARS))
const truncatedText = computed(() => (text.value?.textContent?.length ?? 0) > MAX_SHOWN_CHARS)

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
}

const load = async () => {
  if (!props.materialId) {
    return
  }
  loading.value = true
  try {
    text.value = await QlzgMaterialApi.getText(props.materialId)
  } finally {
    loading.value = false
  }
  // 🔴 到终态就停：不停的话一个忘了关的弹窗会每 5 秒问一次，问上一整天
  if (text.value?.extractTerminal) {
    stopPolling()
  } else if (!pollTimer) {
    pollTimer = setInterval(load, POLL_INTERVAL)
  }
}

const onVisibleChange = (visible: boolean) => {
  emit('update:modelValue', visible)
  if (!visible) {
    stopPolling()
    text.value = undefined
  }
}

const onReExtract = async () => {
  if (!props.materialId) {
    return
  }
  await QlzgMaterialApi.reExtract(props.materialId)
  message.success('已重新排队抽取')
  emit('reExtracted')
  await load()
}

/**
 * 🔴 **点击那一刻**才取地址，不在打开弹窗时预取
 *
 * 每次调用都会记一条 PREVIEW/OUT 计量行，那是**只追加的收费依据**。
 * 预取的话，用户只是想看正文、并没有要看原件，账上却多出一条「看过」，
 * 而出账时它和真的看过的那条没有任何区别。
 */
const onOpenOriginal = async () => {
  if (!props.materialId) {
    return
  }
  const readUrl = await QlzgMaterialApi.getReadUrl(props.materialId)
  window.open(readUrl.url, '_blank')
}

onBeforeUnmount(stopPolling)
</script>
