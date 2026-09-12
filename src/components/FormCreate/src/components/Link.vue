<template>
  <el-link
    v-if="href"
    :href="href"
    :target="target"
    :type="linkType"
    :underline="underline"
    rel="noopener noreferrer"
  >
    {{ displayText }}
  </el-link>
  <!-- 地址为空或协议不安全时降级成纯文本：渲染成一个点不动的链接更让人困惑 -->
  <span v-else class="link-plain">{{ displayText }}</span>
</template>

<script lang="ts" setup>
/**
 * 超链接控件（运行时）
 *
 * 纯展示，不落库。地址支持 `{字段}` 插值，例如
 * `https://crm.example.com/customer/{customer_id}`。
 *
 * ## 协议白名单
 *
 * 只放行 http/https/mailto/tel 与相对地址。`javascript:` 与 `data:` 被挡在外面 ——
 * 这个地址是**表单设计者**配的、**填表人**点的，两者往往不是同一个信任级别。
 * 判定在 `linkUrl.ts`，服务端发布校验时还会用等价规则再拦一次。
 *
 * ## 为什么固定 rel="noopener noreferrer"
 *
 * `target="_blank"` 打开的页面能通过 `window.opener` 反向操纵原页面（钓鱼跳转）。
 * 这个属性不做成可配 —— 没有任何正当理由需要关掉它。
 */
import { resolveLinkUrl } from '@/components/FormWidgets/linkUrl'

/** el-link 认的颜色。写成联合类型而不是 string —— 传个别的值 el-link 会静默用默认色 */
type LinkType = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

defineOptions({ name: 'Link' })

const props = defineProps<{
  /** 地址模板，支持 {字段} 插值 */
  url?: string
  /** 链接文字。为空时显示地址本身 */
  text?: string
  /** _blank / _self */
  target?: string
  /** element-plus 的链接类型 */
  type?: LinkType
  underline?: boolean
  /** 设计器注入，用来取同表单其它字段的值做插值 */
  formCreateInject?: any
}>()

/** 当前表单数据。取不到时按空对象处理，插值结果就是空串 */
const formData = computed<Record<string, any>>(
  () => props.formCreateInject?.api?.formData?.() ?? {}
)

const href = computed(() => resolveLinkUrl(props.url, formData.value))

/** 认不出来的颜色回落到 default，而不是原样传给 el-link */
const linkType = computed<LinkType>(() =>
  (['default', 'primary', 'success', 'warning', 'danger', 'info'] as const).includes(
    props.type as LinkType
  )
    ? (props.type as LinkType)
    : 'default'
)

/** 文字为空时退回显示地址 —— 一个没有文字的链接在页面上是不可见的 */
const displayText = computed(() => props.text || href.value || props.url || '')
</script>

<style lang="scss" scoped>
.link-plain {
  color: var(--el-text-color-regular);
}
</style>
