<template>
  <div class="code-image">
    <canvas v-show="!errorText && resolvedValue" ref="canvasRef"></canvas>
    <span v-if="!resolvedValue" class="code-empty">（没有内容）</span>
    <span v-else-if="errorText" class="code-error">{{ errorText }}</span>
  </div>
</template>

<script lang="ts" setup>
/**
 * 条码 / 二维码控件（运行时）
 *
 * 纯展示，不落库。值支持 `{字段}` 插值 —— 典型用法是把单号变成条码
 * （`{order_no}`），贴在打印出来的单据上。
 *
 * ## 条形码与二维码是同一个控件
 *
 * 靠 `codeType` 切换，而不是做成两个控件。做成两个的话，用户想从条形码换成
 * 二维码就得删了重拖，之前配的值模板、尺寸全都要重来。
 *
 * ## 画不出来时显示原因，不留白
 *
 * 条形码对内容有要求（CODE128 只认 ASCII，EAN-13 必须是 13 位数字）。
 * 画不出来时留一片空白的话，用户完全不知道是没填、还是内容不合法 ——
 * 所以这里明确显示出来。
 */
import QRCode from 'qrcode'
import JsBarcode from 'jsbarcode'
import { interpolateTemplate } from '@/components/FormWidgets/template'

defineOptions({ name: 'CodeImage' })

const props = defineProps<{
  /** qrcode（默认）或 barcode */
  codeType?: string
  /** 值模板，支持 {字段} 插值 */
  value?: string
  /** 二维码边长 / 条形码高度，像素 */
  size?: number
  /** 条形码格式，如 CODE128、EAN13 */
  format?: string
  /** 条形码下方是否显示文字 */
  displayValue?: boolean
  /** 设计器注入，用来取同表单其它字段的值 */
  formCreateInject?: any
}>()

const canvasRef = ref<HTMLCanvasElement>()
const errorText = ref('')

const formData = computed<Record<string, any>>(
  () => props.formCreateInject?.api?.formData?.() ?? {}
)

/** 插值后的值。不做任何编码 —— 编码之后扫出来的就不是原值了 */
const resolvedValue = computed(() => interpolateTemplate(props.value, formData.value))

const isBarcode = computed(() => String(props.codeType ?? 'qrcode').toLowerCase() === 'barcode')

const draw = async () => {
  errorText.value = ''
  const canvas = canvasRef.value
  const text = resolvedValue.value
  if (!canvas || !text) return
  try {
    if (isBarcode.value) {
      JsBarcode(canvas, text, {
        format: props.format || 'CODE128',
        height: props.size || 60,
        displayValue: props.displayValue !== false,
        margin: 4
      })
    } else {
      await QRCode.toCanvas(canvas, text, { width: props.size || 120, margin: 1 })
    }
  } catch (e) {
    // 条形码对内容有要求，画不出来是常态而不是意外。
    // 把原因显示出来，别让用户对着一片空白猜
    errorText.value = `无法生成${isBarcode.value ? '条形码' : '二维码'}：${
      e instanceof Error ? e.message : String(e)
    }`
  }
}

// 值或样式一变就重画。侦听的是算好的值，不是整个表单数据
watch(
  [resolvedValue, isBarcode, () => props.size, () => props.format, () => props.displayValue],
  draw
)
onMounted(draw)
</script>

<style lang="scss" scoped>
.code-image {
  display: inline-block;
}

.code-empty,
.code-error {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.code-error {
  color: var(--el-color-danger);
}
</style>
