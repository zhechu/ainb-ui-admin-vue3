<template>
  <div
    v-if="showHeader"
    class="portal-card-header"
    :style="{ background: titleBackgroundColor || '' }"
  >
    <div
      class="portal-card-header__heading"
      :style="{
        color: resolvedTitleFontColor,
        fontSize: `${titleFontSize || 14}px`,
        fontWeight: titleFontWeight ? 700 : 400,
        justifyContent: headingJustify
      }"
    >
      <Icon v-if="titleIcon" :icon="titleIcon" :color="resolvedTitleIconColor" :size="18" />
      <span class="portal-card-header__title">{{ title }}</span>
    </div>
    <a
      v-if="actionText && actionUrlValue"
      class="portal-card-header__action"
      :href="actionUrlValue"
      :target="actionTarget || '_self'"
      :rel="actionTarget === '_blank' ? 'noopener noreferrer' : undefined"
      @click="handleActionClick"
    >
      {{ actionText }}
    </a>
    <span v-else-if="actionText" class="portal-card-header__action">{{ actionText }}</span>
  </div>
</template>

<script lang="ts" setup>
defineOptions({ name: 'PortalCardHeader', inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    showHeader?: boolean
    title?: string
    titleFontSize?: number
    titleFontWeight?: boolean
    titleFontColor?: string
    titleAlign?: 'left' | 'center' | 'right'
    titleBackgroundColor?: string
    titleIcon?: string
    titleIconColor?: string
    actionText?: string
    actionUrl?: string
    actionTarget?: '_self' | '_blank'
    designer?: boolean
  }>(),
  {
    showHeader: true,
    title: '',
    titleFontSize: 14,
    titleFontWeight: false,
    titleFontColor: '#303133',
    titleAlign: 'left',
    titleBackgroundColor: '',
    titleIcon: '',
    titleIconColor: '#606266',
    actionText: '',
    actionUrl: '',
    actionTarget: '_self',
    designer: false
  }
)

const router = useRouter()
const headingJustify = computed(() => {
  if (props.titleAlign === 'center') return 'center'
  if (props.titleAlign === 'right') return 'flex-end'
  return 'flex-start'
})

const safeUrl = (value: string) => {
  const url = value.trim()
  if (!url) return ''
  if (url.startsWith('/') && !url.startsWith('//')) return url
  try {
    const protocol = new URL(url, window.location.origin).protocol
    return protocol === 'http:' || protocol === 'https:' ? url : ''
  } catch {
    return ''
  }
}

const actionUrlValue = computed(() => safeUrl(props.actionUrl))
const resolvedTitleFontColor = computed(() =>
  props.titleFontColor && props.titleFontColor !== '#303133'
    ? props.titleFontColor
    : 'var(--portal-text-primary)'
)
const resolvedTitleIconColor = computed(() =>
  props.titleIconColor && props.titleIconColor !== '#606266'
    ? props.titleIconColor
    : 'var(--portal-text-secondary)'
)

const handleActionClick = (event: MouseEvent) => {
  if (!actionUrlValue.value) return
  event.preventDefault()
  event.stopPropagation()
  if (props.designer) return
  if (actionUrlValue.value.startsWith('/')) {
    router.push(actionUrlValue.value)
  } else if (props.actionTarget === '_blank') {
    window.open(actionUrlValue.value, '_blank', 'noopener,noreferrer')
  } else {
    window.location.assign(actionUrlValue.value)
  }
}
</script>

<style lang="scss" scoped>
.portal-card-header {
  display: flex;
  min-height: 32px;
  margin: -16px -16px 8px;
  padding: 8px 16px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.portal-card-header__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  flex: 1;
}

.portal-card-header__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-card-header__action {
  max-width: 35%;
  margin-left: 12px;
  overflow: hidden;
  color: var(--el-color-primary);
  font-size: 12px;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (width <= 768px) {
  .portal-card-header {
    margin: -12px -12px 8px;
    padding: 8px 12px;
  }
}
</style>
