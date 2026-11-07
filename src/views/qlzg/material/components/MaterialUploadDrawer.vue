<template>
  <el-drawer
    :model-value="modelValue"
    title="上传资料"
    size="70%"
    :modal="false"
    :destroy-on-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    data-testid="upload-drawer"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="h-full flex flex-col">
      <!-- ==================== 拖拽区 ==================== -->
      <!-- 🔴 **只有一个**：拖 1 个文件也行、拖 1 个文件夹也行、明天再拖一批也行。
           刻意不做成「整包上传」/「单个上传」两个按钮 —— 如果两个按钮的区别要用
           「实现」（一个是 webkitdirectory、一个是 multiple）而不是「目的」来解释，
           它们就应该是一个按钮。用户的目的从来只有一个：把手上这些东西交进来。 -->
      <div
        class="flex-none px-16px py-20px border-2px border-dashed rounded-8px text-center cursor-pointer transition-colors"
        :class="
          dragOver
            ? 'border-[var(--el-color-primary)] bg-[var(--el-color-primary-light-9)]'
            : 'border-[var(--el-border-color)] hover:border-[var(--el-color-primary)]'
        "
        data-testid="drop-zone"
        @click="fileInput?.click()"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <div v-loading="scanning" element-loading-text="正在读取文件夹…">
          <Icon icon="ep:upload-filled" :size="40" color="var(--el-color-primary)" />
          <div class="mt-8px text-14px"> 把文件拖到这里，<b>或者把整个文件夹拖进来</b> </div>
          <div class="mt-4px text-12px text-[var(--el-text-color-secondary)]">
            点击这里可以选文件（选文件夹请用拖的）。每拖一次算一个批次，时间线上各占一行
          </div>
        </div>
      </div>
      <!-- 🔴 不加 webkitdirectory：那是「整包上传」按钮的另一种长相，与上面那一个拖拽区重复 -->
      <input ref="fileInput" type="file" multiple class="!hidden" @change="onPick" />

      <!-- ==================== 提示条 ==================== -->
      <div class="flex-none mt-8px">
        <el-alert
          v-if="countError"
          :title="countError"
          type="error"
          :closable="false"
          show-icon
          class="mb-8px"
        />
        <el-alert
          v-if="truncated"
          :title="`文件夹太大，只读到前 ${MAX_FILES_PER_PREPARE} 份就停了，剩下的没有读进来。请分几次拖入`"
          type="warning"
          :closable="false"
          show-icon
          class="mb-8px"
        />
        <el-alert
          v-if="countAdvice"
          :title="countAdvice"
          type="warning"
          :closable="true"
          show-icon
          class="mb-8px"
          @close="countAdvice = ''"
        />
        <!-- 🔴 被跳过的东西**必须列出来**：静默丢掉的表现是「我拖了整个项目文件夹，
             怎么少了 3 份」，而少的那 3 份可能正是 .dwg 图纸这种最要紧的 -->
        <el-alert v-if="skipped.length > 0" type="info" :closable="false" show-icon class="mb-8px">
          <template #title>
            跳过了 {{ skipped.length }} 项（系统文件、快捷方式或空目录）
            <span
              class="ml-8px text-12px cursor-pointer underline"
              @click="showSkipped = !showSkipped"
            >
              {{ showSkipped ? '收起' : '看看是哪些' }}
            </span>
          </template>
          <div v-if="showSkipped" class="max-h-120px overflow-y-auto text-12px">
            <div v-for="(entry, index) in skipped" :key="index">
              {{ entry.name }} —— {{ entry.reason }}
            </div>
          </div>
        </el-alert>
      </div>

      <!-- ==================== 汇总条 ==================== -->
      <div
        v-if="items.length > 0"
        class="flex-none flex items-center justify-between px-12px py-8px mb-8px rounded-6px bg-[var(--el-fill-color-light)]"
      >
        <div class="text-13px" data-testid="upload-summary">
          已收进 {{ summary.done }} / {{ summary.total }} 份
          <template v-if="summary.dedup > 0">
            （其中 {{ summary.dedup }} 份系统里已有同一份字节，直接复用，没有重传）
          </template>
          <template v-if="summary.failed > 0">
            · <span class="text-[var(--el-color-danger)]">失败 {{ summary.failed }} 份</span>
          </template>
          <template v-if="summary.blocked > 0"> · 未上传 {{ summary.blocked }} 份 </template>
        </div>
        <div class="flex items-center gap-8px">
          <el-switch
            v-if="problemCount > 0"
            v-model="onlyProblems"
            active-text="只看没传上去的"
            size="small"
          />
          <el-button v-if="running" size="small" @click="onCancel">取消</el-button>
          <el-button v-else size="small" :disabled="items.length === 0" @click="onClear">
            清空列表
          </el-button>
        </div>
      </div>

      <!-- ==================== 逐份进度 ==================== -->
      <!-- 🔴 每份一行：名字 + 进度条 + 速度 + 剩余时间。**不做成一根总进度条** ——
           总进度条在 20 份里卡住 1 份时停在 95% 不动，用户读到的结论是「系统坏了」，
           而真实情况是某一份在重试。分开列才能指出是哪一份。 -->
      <div class="flex-1 overflow-y-auto">
        <div
          v-for="item in visibleItems"
          :key="item.key"
          class="px-12px py-8px border-b border-b-solid border-b-[var(--el-border-color-lighter)]"
        >
          <div class="flex items-center justify-between gap-8px">
            <span class="flex-1 text-13px truncate" :title="item.fileName">{{
              item.fileName
            }}</span>
            <el-tag :type="stateTagType(item.state)" size="small" class="flex-none">
              {{ UPLOAD_STATE_LABELS[item.state] }}
            </el-tag>
            <el-button
              v-if="item.state === 'FAILED'"
              link
              type="primary"
              size="small"
              class="flex-none"
              :data-testid="`retry-${item.key}`"
              @click="onRetry(item)"
            >
              <!-- 🔴 「重试这一份」，不是「整批重来」：另外 19 份已经落库了，
                   整批重来会把它们再传一遍（秒传能挡掉一部分，但挡不住没算摘要的大文件），
                   而且会在时间线上多出一整批假的「第二次提交」 -->
              重试这一份
            </el-button>
          </div>

          <el-progress
            v-if="showBar(item.state)"
            :percentage="item.percent"
            :stroke-width="6"
            :status="
              item.state === 'FAILED' ? 'exception' : item.state === 'DONE' ? 'success' : undefined
            "
            class="mt-6px"
          />

          <div class="mt-2px text-12px text-[var(--el-text-color-secondary)]">
            <template v-if="item.fileSize != null">{{ formatFileSize(item.fileSize) }}</template>
            <template v-if="item.speed"> · {{ formatSpeed(item.speed) }}</template>
            <template v-if="item.eta"> · {{ item.eta }}</template>
          </div>

          <div
            v-for="(warning, index) in item.warnings"
            :key="index"
            class="mt-2px text-12px text-[var(--el-color-warning)]"
          >
            {{ warning }}
          </div>
          <div v-if="item.error" class="mt-2px text-12px text-[var(--el-color-danger)]">
            {{ item.error }}
          </div>
        </div>
      </div>

      <!-- ==================== 底部 ==================== -->
      <!-- 🔴 这里**没有**「上传完成，提交资料」那个按钮。
           资料没有「提交完成」这个状态 —— 只有「目前到了哪些、还缺哪些」。
           加一个终止按钮等于承诺「点完这次就齐了」，而评估资料天然是分几次补的，
           那个按钮点下去之后用户第二次拖入时会犹豫「是不是还要再提交一次」。 -->
      <div
        class="flex-none flex items-center justify-between pt-10px border-t border-t-solid border-t-[var(--el-border-color-lighter)]"
      >
        <span class="text-12px text-[var(--el-text-color-secondary)]">
          传完就可以关掉这个抽屉，资料会在后面的列表里显示「解析中…」，正文抽取在后台跑
        </span>
        <el-button type="primary" @click="emit('update:modelValue', false)">收起</el-button>
      </div>
    </div>
  </el-drawer>
</template>

<script lang="ts" setup>
import {
  createUploadItems,
  formatSpeed,
  isInFlight,
  summarize,
  UPLOAD_STATE_LABELS,
  type UploadItem,
  type UploadItemState
} from '../uploadQueue'
import { retryOne, runUploadBatch } from '../uploadRunner'
import { batchCountVerdict, MAX_FILES_PER_PREPARE } from '../uploadLimits'
import {
  flattenDataTransfer,
  flattenFileList,
  type PickedResult,
  type SkippedEntry
} from '../folderFlatten'
import { formatFileSize } from '@/utils/file'
import { refreshDesktopAvailability } from '../../bridge/bridgeRuntime'

/**
 * 上传抽屉（一次拖拽 → 一批资料落库）
 *
 * <h3>🔴 它是**可以收起来的抽屉**，不是模态框</h3>
 * 三处配置合起来才成立，少一处就退化回「强制等待」：
 * `:modal="false"`（不遮页面，用户能一边传一边翻后面的资料列表）、
 * `:destroy-on-close="false"`（收起时**不卸载**，上传继续在后台跑）、
 * `:close-on-press-escape="false"`（误按 Esc 会把进度收起来，用户以为传失败了）。
 * 所以「收起」不是「取消」：真要停，用汇总条上那个**取消**按钮。
 *
 * <h3>🔴 关页面要拦，关抽屉不拦</h3>
 * 令牌是一次性的（Redis GETDEL）、且没有断点续传，所以刷新/关标签页会让正在传的
 * 那几份既没落库、令牌也废了，只能重新拖 —— 这一条用 `beforeunload` 拦。
 * 但收起抽屉不会杀掉任何东西，所以**不拦**：拦了就是把「可以边传边干别的」又变回模态框。
 *
 * <h3>🔴 传给 runner 的必须是 `items.value` 里的元素本身</h3>
 * runner 用 `Object.assign` 原地改这些对象来驱动进度条（理由见 `uploadRunner.ts` 文件头）。
 * 传浅拷贝不会报错，只会「一切正常、进度条不动」，所以追加新批次时是先赋值给
 * `items.value`、再从里面 `slice` 出刚追加的那几行（那才是 Vue 的响应式代理）。
 */
defineOptions({ name: 'QlzgMaterialUploadDrawer' })

const props = defineProps<{
  modelValue: boolean
  projectId: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void
  /** 有一份落库了 —— 父组件据此刷新资料列表、时间线与缺件面板 */
  (e: 'confirmed'): void
}>()

const message = useMessage()

// 「桌面端到底有没有」的判据在服务端（/qlzg/bridge/chunk-upload 那个信封），不在前端写死。
// 🔴 刻意不 await：抽屉必须立刻能用，探针慢了、失败了、被鉴权挡住都不该拖住它。
//    refreshDesktopAvailability 对任何失败都返回 null，并把六处文案停在诚实那一侧
//    （「桌面客户端尚未发布」），所以最坏的后果只是少一句推荐，不会推荐一个不存在的东西
refreshDesktopAvailability()

const fileInput = ref<HTMLInputElement>()
const dragOver = ref(false)
const scanning = ref(false)
const running = ref(false)
const showSkipped = ref(false)
const onlyProblems = ref(false)
const countError = ref('')
const countAdvice = ref('')
const truncated = ref(false)
const skipped = ref<SkippedEntry[]>([])
const items = ref<UploadItem[]>([])
/** 追加第几批，用于给本地 key 加前缀（不加就会与上一批的 `0-xxx` 撞 key） */
let batchSeq = 0
let abortController: AbortController | undefined

const summary = computed(() => summarize(items.value))

const problemCount = computed(() => summary.value.failed + summary.value.blocked)

const visibleItems = computed(() =>
  onlyProblems.value
    ? items.value.filter((item) => item.state === 'FAILED' || item.state === 'BLOCKED')
    : items.value
)

const stateTagType = (state: UploadItemState): 'primary' | 'success' | 'danger' | 'info' => {
  switch (state) {
    case 'DONE':
      return 'success'
    case 'FAILED':
      return 'danger'
    case 'BLOCKED':
    case 'PENDING':
      return 'info'
    default:
      return 'primary'
  }
}

/** 秒传那一支没有字节要传，画进度条只会让人以为卡住了，所以只显示状态 */
const showBar = (state: UploadItemState) => state !== 'BLOCKED'

const onDrop = async (event: DragEvent) => {
  dragOver.value = false
  if (!event.dataTransfer) {
    return
  }
  await accept(await scan(event.dataTransfer))
}

const onPick = async (event: Event) => {
  const input = event.target as HTMLInputElement
  // 🔴 顺序敏感：`flattenFileList` 读的是 `input.files` 这个**活的** FileList，
  //    清空 value 之后它就空了，所以必须先摊平再清
  const picked = flattenFileList(input.files ?? [])
  // 🔴 清空 value 是为了「选同一份文件重试」也能触发 change，否则用户点了没反应
  input.value = ''
  await accept(picked)
}

/** 拖文件夹要一个个 `readEntries`（每次最多回 100 条），几千份时要几秒，这期间必须有反馈 */
const scan = async (dataTransfer: DataTransfer): Promise<PickedResult> => {
  scanning.value = true
  try {
    return await flattenDataTransfer(dataTransfer)
  } catch (error) {
    // 拖进来的可能是别的东西（网页上的链接、跨站的文件），浏览器会抛 SecurityError
    countError.value = `读取拖入的内容失败：${(error as Error)?.message ?? '未知原因'}。请改用点击选择文件`
    return { files: [], skipped: [], fromFolder: false, truncated: false }
  } finally {
    scanning.value = false
  }
}

const accept = async (picked: PickedResult) => {
  skipped.value = picked.skipped
  showSkipped.value = false
  truncated.value = picked.truncated

  if (picked.files.length === 0) {
    if (picked.skipped.length === 0) {
      countError.value = '没有读到任何文件。拖进来的是空文件夹，或者全是系统文件'
    }
    return
  }
  countError.value = ''

  // 🔴 先判「上一批还在不在传」再问「要不要用桌面端」：
  //    反过来问的话，用户在确认框上点了「继续」，才告诉他「其实现在传不了」，
  //    那个「继续」就白点了 —— 而它看起来像是系统答应了
  if (running.value) {
    message.warning('上一批还在传。等它传完，或者点「取消」，再拖下一批')
    return
  }

  const verdict = batchCountVerdict(picked.files.length)
  if (verdict.blocked) {
    countError.value = verdict.message
    return
  }
  if (verdict.message) {
    // 🔴 「建议用桌面端」必须在**上传之前**问：传 400 份要几十分钟，中途关页面就得从头再来
    //    （没有断点续传），这句话只有在还没开始时才有用，传完了再说等于马后炮
    try {
      await message.confirm(verdict.message, '这一次份数有点多')
    } catch {
      return
    }
    countAdvice.value = verdict.message
  }

  const fresh = createUploadItems(picked)
  fresh.forEach((item, index) => {
    item.key = `${batchSeq}-${index}-${item.fileName}`
  })
  batchSeq++
  const startIndex = items.value.length
  items.value = [...items.value, ...fresh]
  // 🔴 从 items.value 里切出来的才是响应式代理，直接传 fresh 会导致进度条不动
  await run(items.value.slice(startIndex))
}

const run = async (live: UploadItem[]) => {
  running.value = true
  onlyProblems.value = false
  abortController = new AbortController()
  try {
    await runUploadBatch({
      projectId: props.projectId,
      items: live,
      onConfirmed: () => emit('confirmed'),
      signal: abortController.signal
    })
  } finally {
    running.value = false
    abortController = undefined
  }
}

const onRetry = async (item: UploadItem) => {
  // 🔴 重试一份也是走 runUploadBatch（一份一批），所以这里同样要把 running 置起来：
  //    否则重试期间用户又拖一批进来，两批的进度条会互相打架
  running.value = true
  try {
    await retryOne(props.projectId, item, () => emit('confirmed'))
  } finally {
    running.value = false
  }
}

const onCancel = () => {
  abortController?.abort()
}

const onClear = () => {
  items.value = []
  skipped.value = []
  truncated.value = false
  countAdvice.value = ''
  countError.value = ''
  onlyProblems.value = false
}

/**
 * 刷新/关标签页时拦一道
 *
 * ⚠️ `returnValue` 设成什么字符串都没用（Chrome 早就不显示了），
 *    但**必须设**，否则部分浏览器根本不调 `preventDefault` 那套逻辑。
 */
const onBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!items.value.some((item) => isInFlight(item.state))) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
</script>
