<template>
  <div class="signature-field">
    <!-- 已签：展示图片。值永远是文件服务的 URL，不是 base64 -->
    <div v-if="showSigned" class="signature-signed">
      <el-image
        :src="modelValue"
        :preview-src-list="[modelValue!]"
        :preview-teleported="true"
        fit="contain"
        :style="frameStyle"
        class="signature-image"
      >
        <template #error>
          <div class="signature-broken">签名图片加载失败</div>
        </template>
      </el-image>
      <div v-if="canRewrite" class="signature-actions">
        <el-button link type="primary" @click="startRewrite">重签</el-button>
      </div>
    </div>

    <!-- 未签 / 重签中：可书写的画布 -->
    <div v-else-if="!disabled" class="signature-draw">
      <canvas
        ref="canvasRef"
        class="signature-canvas"
        :style="frameStyle"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      ></canvas>
      <div class="signature-actions">
        <el-button link :disabled="!hasStroke || uploading" @click="clear">清空</el-button>
        <el-button
          link
          type="primary"
          :disabled="!hasStroke"
          :loading="uploading"
          @click="confirm"
        >
          确认签名
        </el-button>
        <el-button v-if="rewriting" link :disabled="uploading" @click="cancelRewrite">
          取消
        </el-button>
      </div>
    </div>

    <!-- 只读且没签过 -->
    <span v-else class="signature-empty">（未签名）</span>
  </div>
</template>

<script lang="ts" setup>
/**
 * 手写签名控件（运行时）
 *
 * ## 值只能是 URL
 *
 * 内核自带的 signaturePad 把 canvas 直出的 base64 当值，单张 20–100KB：
 * 映射到 varchar(255) 直接写失败，映射到 TEXT 则让列表查询的 `SELECT *`
 * 把每一行的整串一起捞出来、导出体积异常。所以本控件在「确认签名」时
 * 先上传到文件服务，拿到 URL 之后才 emit。
 *
 * 这里有一条不能松的规矩：**上传失败时绝不 emit base64 兜底**。
 * 那样做能让界面看起来成功，代价是把上面三个后果原封不动搬进数据库。
 * 失败就停在画布上让用户重试 —— 他的笔迹还在，重试的成本很低。
 *
 * 服务端另有一道兜底（RichContentGuard）：构造请求直接提交 base64 时，
 * 由它转存文件服务。两道防线各管一段，前端这道管体验，服务端那道管约束。
 *
 * ## 为什么用 pointer 事件而不是 mouse + touch 各写一套
 *
 * pointer 事件同时覆盖鼠标、触屏与手写笔，而签名恰恰是三种设备都会用的场景。
 * 配合 setPointerCapture，笔画划出画布再回来不会断成两截。
 */
import { useUpload } from '@/components/UploadFile/src/useUpload'
import { useUserStore } from '@/store/modules/user'
import { generateUUID } from '@/utils'
import { formatDate } from '@/utils/formatTime'

defineOptions({ name: 'Signature' })

/** 用项目统一的消息 hook：ElMessage 不在自动导入清单里，直接用会运行时报未定义 */
const message = useMessage()

const props = withDefaults(
  defineProps<{
    /** 值：文件服务的图片 URL */
    modelValue?: string
    /** 画布宽度，像素 */
    width?: number
    /** 画布高度，像素 */
    height?: number
    /** 画笔粗细，像素 */
    penWidth?: number
    /** 画笔颜色 */
    penColor?: string
    /** 画布背景色 */
    bgColor?: string
    /** 是否把签署人与时间烧进图片 */
    watermark?: boolean
    /**
     * 是否允许重签
     *
     * ⚠️ 默认值必须显式写成 true。boolean 类型的 prop 在 Vue 里有「缺省即 false」的
     * 转换规则：不给默认值的话，规则里没写 allowRewrite 就等于写了 false ——
     * 于是只要这个字段已经有值（打开一条已签过的记录、或刚签完），
     * 「重签」按钮就永远不出现，表现正是「手写签名控件用不了」。
     *
     * 设计器的规则里本来就显式写了 allowRewrite: true，所以从设计器拖出来的控件
     * 一直是好的，只有示例、历史表单、外部导入的表单 JSON 会踩到。
     * 这里的默认值与属性面板上「允许重签」的默认勾选保持一致。
     */
    allowRewrite?: boolean
    /** 是否只读 */
    disabled?: boolean
  }>(),
  { allowRewrite: true }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const userStore = useUserStore()
// 目录与富文本、上传三件套并列，便于在文件管理里按用途筛
const { httpRequest } = useUpload('form-signature')

const canvasRef = ref<HTMLCanvasElement>()
/** 本次是否画过。用它判空而不是扫像素：扫像素要读整张 ImageData，且背景色一填就全是非透明像素 */
const hasStroke = ref(false)
const uploading = ref(false)
/** 是否处于重签状态：已有值，但用户点了「重签」 */
const rewriting = ref(false)

const canvasWidth = computed(() => props.width || 400)
const canvasHeight = computed(() => props.height || 160)

const frameStyle = computed(() => ({
  width: `${canvasWidth.value}px`,
  height: `${canvasHeight.value}px`
}))

const showSigned = computed(() => !!props.modelValue && !rewriting.value)
const canRewrite = computed(() => !props.disabled && props.allowRewrite)

// ==================== 画布 ====================

/**
 * 初始化画布
 *
 * 按设备像素比放大位图再用 CSS 缩回去，否则高分屏上的笔迹是一条毛边。
 * 注意 width/height 一赋值就会清空画布内容，所以只在挂载与尺寸变化时做。
 */
const setupCanvas = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  const ratio = window.devicePixelRatio || 1
  canvas.width = canvasWidth.value * ratio
  canvas.height = canvasHeight.value * ratio
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(ratio, ratio)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  fillBackground(ctx)
  hasStroke.value = false
}

/**
 * 填充背景
 *
 * 默认填白而不是留透明：签名最终要贴到打印出来的单据上，
 * 透明背景的 PNG 在深色底或某些打印驱动下会变成一团黑。
 */
const fillBackground = (ctx: CanvasRenderingContext2D) => {
  ctx.save()
  ctx.fillStyle = props.bgColor || '#ffffff'
  ctx.fillRect(0, 0, canvasWidth.value, canvasHeight.value)
  ctx.restore()
}

const pointOf = (event: PointerEvent) => {
  const rect = canvasRef.value!.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

/** 不用 ref：它只在事件回调之间传递状态，不参与渲染 */
let drawing = false

const onPointerDown = (event: PointerEvent) => {
  if (props.disabled || uploading.value) return
  const ctx = canvasRef.value?.getContext('2d')
  if (!ctx) return
  // 捕获指针：笔画划出画布边界再回来时仍然连续，而不是断成两截
  canvasRef.value!.setPointerCapture(event.pointerId)
  const { x, y } = pointOf(event)
  ctx.strokeStyle = props.penColor || '#000000'
  ctx.lineWidth = props.penWidth || 2
  ctx.beginPath()
  ctx.moveTo(x, y)
  // 单击不拖动也要留一个点：签名里的顿点、标点全靠它
  ctx.lineTo(x, y)
  ctx.stroke()
  hasStroke.value = true
  drawing = true
}

const onPointerMove = (event: PointerEvent) => {
  if (!drawing) return
  const ctx = canvasRef.value?.getContext('2d')
  if (!ctx) return
  const { x, y } = pointOf(event)
  ctx.lineTo(x, y)
  ctx.stroke()
}

const onPointerUp = (event: PointerEvent) => {
  if (!drawing) return
  drawing = false
  canvasRef.value?.releasePointerCapture(event.pointerId)
}

const clear = () => {
  const ctx = canvasRef.value?.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value)
  fillBackground(ctx)
  hasStroke.value = false
}

// ==================== 水印 ====================

/**
 * 把签署人与时间烧进图片
 *
 * 只是让图片自解释（打印出来能看出是谁签的），**不是**权威凭据 ——
 * 它由前端绘制，构造请求就能改。真正的签署人与时间是记录自己的
 * creator / create_time，那两列由后端按登录上下文填。
 */
const drawWatermark = (ctx: CanvasRenderingContext2D) => {
  const signer = userStore.getUser?.nickname || ''
  const text = `${signer} ${formatDate(new Date(), 'YYYY-MM-DD HH:mm')}`.trim()
  ctx.save()
  ctx.font = '12px sans-serif'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(text, canvasWidth.value - 6, canvasHeight.value - 4)
  ctx.restore()
}

// ==================== 确认与上传 ====================

const toPngFile = (canvas: HTMLCanvasElement): Promise<File> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('画布导出失败'))
        return
      }
      // ⚠️ 文件名必须唯一。文件服务生成的存储路径是「日期目录 / 原文件名」，
      // 后缀时间戳默认是关的（FileServiceImpl.PATH_SUFFIX_TIMESTAMP_ENABLE = false）——
      // 固定叫 signature.png 的话，同一天里第二个人签的名会把第一个人的图片覆盖掉，
      // 两条记录从此指向同一张签名，而且两边都不会报错
      resolve(new File([blob], `signature-${generateUUID()}.png`, { type: 'image/png' }))
    }, 'image/png')
  })

const confirm = async () => {
  const canvas = canvasRef.value
  if (!canvas || !hasStroke.value || uploading.value) return
  uploading.value = true
  try {
    if (props.watermark) {
      const ctx = canvas.getContext('2d')
      if (ctx) drawWatermark(ctx)
    }
    const file = await toPngFile(canvas)
    const res = await httpRequest({
      file: file as any,
      onProgress: () => {},
      onSuccess: () => {},
      onError: () => {}
    } as any)
    // 兼容前端直连上传与后端上传两种模式的返回格式，与 Editor 的 customUpload 一致
    const url = (res as any).data?.data || (res as any).data
    if (!url || typeof url !== 'string') {
      throw new Error('文件服务没有返回地址')
    }
    emit('update:modelValue', url)
    rewriting.value = false
  } catch (e: any) {
    // 刻意不 emit base64 兜底：那会让界面看起来成功，而库里存下一串 20–100KB 的 base64。
    // 停在画布上，用户的笔迹还在，重试成本很低
    message.error(e?.msg || e?.message || '签名保存失败，请重试')
  } finally {
    uploading.value = false
  }
}

const startRewrite = () => {
  rewriting.value = true
  // 画布此刻才被渲染出来，要等 DOM 就位再初始化
  nextTick(setupCanvas)
}

const cancelRewrite = () => {
  rewriting.value = false
}

// 尺寸变了要重建位图。这也会清掉未确认的笔迹，
// 但改画布尺寸只发生在设计器的属性面板里，那里本来就没有待确认的签名
watch([canvasWidth, canvasHeight], () => {
  if (canvasRef.value) setupCanvas()
})

// 背景色变了只重填底色，保留已有笔迹
watch(
  () => props.bgColor,
  () => {
    const ctx = canvasRef.value?.getContext('2d')
    if (!ctx || hasStroke.value) return
    fillBackground(ctx)
  }
)

onMounted(setupCanvas)
</script>

<style lang="scss" scoped>
.signature-field {
  display: inline-block;
}

.signature-canvas,
.signature-image {
  display: block;
  border: 1px dashed var(--el-border-color);
  border-radius: 4px;
  // 触屏上按住画布不应该跟着滚页面，否则一笔都画不出来
  touch-action: none;
  cursor: crosshair;
}

.signature-image {
  cursor: default;
  background-color: var(--el-fill-color-light);
}

.signature-broken,
.signature-empty {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.signature-broken {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.signature-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 4px;
}
</style>
