<script lang="ts" setup>
import type { ComponentPublicInstance } from 'vue'
import { propTypes } from '@/utils/propTypes'
import { useDesign } from '@/hooks/web/useDesign'

defineOptions({ name: 'ContentWrap' })

const { getPrefixCls } = useDesign()

const prefixCls = getPrefixCls('content-wrap')

type CardRef = ComponentPublicInstance & { $el: HTMLElement }

const cardRef = ref<CardRef>()
const isListContent = ref(false)
let autoHeightApplied = false
let layoutFrame = 0
let resizeObserver: ResizeObserver | undefined
let mutationObserver: MutationObserver | undefined

const getCardElement = () => {
  const element = cardRef.value?.$el
  return element instanceof HTMLElement ? element : undefined
}

const hasHeightClass = (element: HTMLElement) => {
  return Array.from(element.classList).some(
    (className) =>
      /^(?:!+)?(?:h|min-h|max-h)-/.test(className)
  )
}

const getScrollViewport = (element: HTMLElement) => {
  let parent = element.parentElement
  while (parent && parent !== document.body) {
    if (parent.classList.contains('el-scrollbar__wrap')) {
      return parent
    }
    if (parent.classList.contains('el-dialog')) {
      return parent
    }
    parent = parent.parentElement
  }
  return null
}

const getNextCardTop = (card: HTMLElement) => {
  let sibling = card.nextElementSibling
  while (sibling) {
    if (sibling instanceof HTMLElement && sibling.classList.contains(prefixCls)) {
      const top = sibling.getBoundingClientRect().top
      return top > card.getBoundingClientRect().top ? top : undefined
    }
    sibling = sibling.nextElementSibling
  }
  return undefined
}

const updateListLayout = () => {
  cancelAnimationFrame(layoutFrame)
  layoutFrame = requestAnimationFrame(() => {
    const card = getCardElement()
    const body = card?.querySelector<HTMLElement>(':scope > .el-card__body')
    const table = body?.querySelector<HTMLElement>('.el-table')
    const pagination = body?.querySelector<HTMLElement>('.el-pagination')

    const hasCustomHeight =
      !!table &&
      (table.hasAttribute('height') ||
        table.hasAttribute('max-height') ||
        !!table.style.height ||
        !!table.style.maxHeight ||
        hasHeightClass(table))
    const cardHasCustomHeight =
      !!card &&
      !autoHeightApplied &&
      (!!card.style.height ||
        !!card.style.maxHeight ||
        hasHeightClass(card))

    if (!card || !body || !table || !pagination || hasCustomHeight || cardHasCustomHeight) {
      isListContent.value = false
      if (autoHeightApplied) {
        card?.style.removeProperty('height')
        autoHeightApplied = false
      }
      return
    }

    if (!isListContent.value) {
      isListContent.value = true
      nextTick(updateListLayout)
      return
    }

    const viewport = getScrollViewport(card)
    const viewportBottom = viewport?.getBoundingClientRect().bottom ?? window.innerHeight
    const nextCardTop = getNextCardTop(card)
    const contentBottom = Math.min(viewportBottom, nextCardTop ?? Number.POSITIVE_INFINITY)
    const cardRect = card.getBoundingClientRect()
    const contentSection = card.closest('section')
    const sectionStyle = contentSection ? getComputedStyle(contentSection) : undefined
    const paddingBottom = Number.parseFloat(sectionStyle?.paddingBottom || '0') || 0
    const marginBottom = Number.parseFloat(getComputedStyle(card).marginBottom || '0') || 0
    const height = Math.floor(contentBottom - cardRect.top - paddingBottom - marginBottom - 1)

    // 窄屏下搜索区可能已经占满首屏，列表卡片位于首屏之外时保留自然高度，
    // 让外层页面滚动，避免把列表压缩成几像素。
    if (height < 200) {
      isListContent.value = false
      if (autoHeightApplied) {
        card.style.removeProperty('height')
        autoHeightApplied = false
      }
      return
    }

    card.style.height = `${height}px`
    autoHeightApplied = true
  })
}

defineProps({
  title: propTypes.string.def(''),
  message: propTypes.string.def(''),
  bodyStyle: propTypes.object.def({ padding: '10px', overflow: 'hidden' })
})

onMounted(() => {
  nextTick(() => {
    updateListLayout()

    const card = getCardElement()
    const body = card?.querySelector<HTMLElement>(':scope > .el-card__body')
    if (!card || !body) {
      return
    }

    resizeObserver = new ResizeObserver(updateListLayout)
    resizeObserver.observe(card)
    if (card.parentElement) {
      resizeObserver.observe(card.parentElement)
    }
    const contentSection = card.closest('section')
    if (contentSection) {
      resizeObserver.observe(contentSection)
    }
    const viewport = getScrollViewport(card)
    if (viewport) {
      resizeObserver.observe(viewport)
    }

    mutationObserver = new MutationObserver(updateListLayout)
    mutationObserver.observe(body, { childList: true, subtree: true })
  })
  window.addEventListener('resize', updateListLayout)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(layoutFrame)
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  window.removeEventListener('resize', updateListLayout)
})
</script>

<template>
  <ElCard
    ref="cardRef"
    :body-style="bodyStyle"
    :class="[prefixCls, 'mb-15px', { [`${prefixCls}--list`]: isListContent }]"
    shadow="never"
  >
    <template v-if="title" #header>
      <div class="flex items-center">
        <span class="text-16px font-700">{{ title }}</span>
        <ElTooltip v-if="message" effect="dark" placement="right">
          <template #content>
            <div class="max-w-200px">{{ message }}</div>
          </template>
          <Icon :size="14" class="ml-5px" icon="ep:question-filled" />
        </ElTooltip>
        <div class="flex flex-grow pl-20px">
          <slot name="header"></slot>
        </div>
      </div>
    </template>
    <slot></slot>
  </ElCard>
</template>

<style lang="scss" scoped>
$prefix-cls: #{$namespace}-content-wrap;

.#{$prefix-cls}--list {
  display: flex;
  flex-direction: column;
  min-height: 0;

  :deep(.el-card__header) {
    flex: 0 0 auto;
  }

  :deep(.el-card__body) {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  :deep(.el-table) {
    width: 100%;
    min-height: 0;
    flex: 1 1 auto;
  }

  :deep(.v-table-container) {
    min-height: 0;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
  }

  :deep(.v-table-container > .el-table) {
    flex: 1 1 auto;
  }

  :deep(.el-table--default .el-table__cell) {
    padding-top: 4px;
    padding-bottom: 4px;
  }

  :deep(.el-table--default .cell) {
    line-height: 21px;
  }

  :deep(.el-pagination) {
    flex: 0 0 auto;
    float: none;
    justify-content: flex-end;
    margin: 10px 0 0;
  }

  :deep(.el-card__body > * > .el-pagination) {
    margin-top: 10px;
  }
}
</style>
