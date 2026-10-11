<template>
  <div class="portal-designer">
    <div
      ref="canvasRef"
      class="portal-designer__canvas"
      :class="{ 'is-populated': layoutItems.length }"
      @dragover.prevent
      @drop="handleDrop"
      @pointerdown="handlePointerDown"
    >
      <GridLayout
        v-if="layoutItems.length"
        class="portal-designer__grid"
        :layout="layoutItems"
        :col-num="columns"
        :row-height="rowHeight"
        :margin="[gap, gap]"
        :is-draggable="true"
        :is-resizable="true"
        :auto-size="true"
        :vertical-compact="true"
        :use-css-transforms="true"
        :prevent-collision="false"
        @layout-updated="handleLayoutChange"
      >
        <template #item="{ item: entry }">
          <div
            class="portal-designer__item"
            :class="{ 'is-selected': getPortalItem(entry).id === selectedId }"
            @click.stop="$emit('select', getPortalItem(entry).id)"
          >
            <PortalWidget
              :item="getPortalItem(entry)"
              :designer="true"
              :selected-id="selectedId"
              @select="$emit('select', $event)"
              @add-nested="handleNestedAdd"
              @remove="$emit('remove', $event)"
              @duplicate="$emit('duplicate', $event)"
            />
            <div class="portal-designer__item-label">
              <Icon :icon="getComponentDefinition(getPortalItem(entry).type).icon" :size="13" />
              <span>{{ getComponentDefinition(getPortalItem(entry).type).label }}</span>
            </div>
            <div class="portal-designer__item-actions">
              <el-button
                circle
                size="small"
                title="复制控件"
                @click.stop="$emit('duplicate', getPortalItem(entry).id)"
              >
                <Icon icon="ep:copy-document" />
              </el-button>
              <el-button
                circle
                size="small"
                title="删除控件"
                @click.stop="$emit('remove', getPortalItem(entry).id)"
              >
                <Icon icon="ep:delete" />
              </el-button>
            </div>
          </div>
        </template>
      </GridLayout>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { PortalConfig, PortalItem } from '@/api/infra/portal'
import { getComponentDefinition } from '@/components/Portal/helper/componentRegistry'
import PortalWidget from '@/components/Portal/Runtime/PortalWidget.vue'
import { GridLayout, type LayoutItem } from 'grid-layout-plus'
import { onBeforeUnmount } from 'vue'

defineOptions({ name: 'PortalDesigner' })

const props = defineProps<{ modelValue: PortalConfig; selectedId?: string }>()
const emit = defineEmits<{
  select: [id: string]
  add: [type: string, position?: { x: number; y: number }]
  addNested: [type: string, parentId: string, tabId?: string]
  update: [item: PortalItem]
  layout: [items: Array<{ id: string; x: number; y: number; w: number; h: number }>]
  remove: [id: string]
  duplicate: [id: string]
}>()

const canvasRef = ref<HTMLElement>()
const columns = computed(() => Math.max(1, props.modelValue.columns || 24))
const rowHeight = computed(() => Math.max(1, props.modelValue.rowHeight || 8))
const gap = computed(() => Math.max(0, props.modelValue.gap || 12))

type DesignerLayoutItem = LayoutItem & {
  portalItem: PortalItem
  dragIgnoreFrom: string
  resizeIgnoreFrom: string
}

const dragIgnoreFrom = '.portal-designer__item-actions, button, a, input, textarea, select'
const resizeIgnoreFrom = 'button, a, input, textarea, select'
const layoutItems = ref<DesignerLayoutItem[]>([])

const getPortalItem = (entry: LayoutItem) => (entry as DesignerLayoutItem).portalItem

const createLayoutItem = (item: PortalItem): DesignerLayoutItem => {
  const layout = {
    i: item.id,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: 1,
    minH: 1,
    maxW: columns.value,
    dragIgnoreFrom,
    resizeIgnoreFrom
  } as DesignerLayoutItem
  Object.defineProperty(layout, 'portalItem', {
    configurable: true,
    writable: true,
    value: item
  })
  return layout
}

watch(
  [() => props.modelValue.items, columns],
  ([items]) => {
    const previousItems = new Map(layoutItems.value.map((item) => [String(item.i), item]))
    layoutItems.value = items.map((item) => {
      const layout = previousItems.get(item.id)
      if (!layout) return createLayoutItem(item)

      Object.assign(layout, {
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        maxW: columns.value,
        portalItem: item
      })
      return layout
    })
  },
  { immediate: true, deep: true, flush: 'sync' }
)

let pointerTracking = false
let autoScrollFrame: number | undefined
let autoScrollSpeed = 0

const runAutoScroll = () => {
  autoScrollFrame = undefined
  const canvas = canvasRef.value
  if (!pointerTracking || !canvas || !autoScrollSpeed) return

  const previousScrollTop = canvas.scrollTop
  canvas.scrollTop += autoScrollSpeed
  if (canvas.scrollTop !== previousScrollTop) {
    autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
  }
}

const setAutoScrollSpeed = (speed: number) => {
  autoScrollSpeed = speed
  if (!speed) {
    if (autoScrollFrame !== undefined) {
      window.cancelAnimationFrame(autoScrollFrame)
      autoScrollFrame = undefined
    }
    return
  }
  if (autoScrollFrame === undefined) {
    autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
  }
}

const stopPointerTracking = () => {
  pointerTracking = false
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', stopPointerTracking)
  window.removeEventListener('pointercancel', stopPointerTracking)
  setAutoScrollSpeed(0)
}

const handlePointerDown = (event: PointerEvent) => {
  const target = event.target as HTMLElement | null
  if (
    !target?.closest('.vgl-item:not(.vgl-item--placeholder)') ||
    target.closest('button, a, input, textarea, select, .portal-container-add')
  ) {
    return
  }
  pointerTracking = true
  window.addEventListener('pointermove', handlePointerMove, { passive: true })
  window.addEventListener('pointerup', stopPointerTracking, { passive: true })
  window.addEventListener('pointercancel', stopPointerTracking, { passive: true })
}

const handlePointerMove = (event: PointerEvent) => {
  if (!pointerTracking || event.buttons === 0) {
    stopPointerTracking()
    return
  }
  const canvas = canvasRef.value
  if (!canvas) return

  const rect = canvas.getBoundingClientRect()
  const edge = 56
  let speed = 0
  if (event.clientY < rect.top + edge && canvas.scrollTop > 0) {
    speed = -Math.min(18, Math.ceil((rect.top + edge - event.clientY) / 6))
  } else if (
    event.clientY > rect.bottom - edge &&
    canvas.scrollTop < canvas.scrollHeight - canvas.clientHeight
  ) {
    speed = Math.min(18, Math.ceil((event.clientY - (rect.bottom - edge)) / 6))
  }
  setAutoScrollSpeed(speed)
}

const handleLayoutChange = (
  layout: Array<{ i: string | number; x: number; y: number; w: number; h: number }>
) => {
  const items = layout
    .map((entry) => ({
      id: String(entry.i),
      x: Math.max(0, Math.trunc(entry.x)),
      y: Math.max(0, Math.trunc(entry.y)),
      w: Math.max(1, Math.trunc(entry.w)),
      h: Math.max(1, Math.trunc(entry.h))
    }))
    .filter((entry) => props.modelValue.items.some((item) => item.id === entry.id))
  if (items.length) emit('layout', items)
}

const handleNestedAdd = (type: string, parentId: string, tabId?: string) => {
  emit('addNested', type, parentId, tabId)
}

const handleDrop = (event: DragEvent) => {
  const type = event.dataTransfer?.getData('portal/type')
  const canvas = canvasRef.value
  if (!canvas || !type) return
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, canvas.clientWidth)
  const colWidth = (width - gap.value * (columns.value + 1)) / columns.value
  const offsetLeft = event.clientX - rect.left + canvas.scrollLeft
  const offsetTop = event.clientY - rect.top + canvas.scrollTop
  const x = Math.max(
    0,
    Math.min(columns.value - 1, Math.round((offsetLeft - gap.value) / (colWidth + gap.value)))
  )
  const y = Math.max(0, Math.round((offsetTop - gap.value) / (rowHeight.value + gap.value)))
  emit('add', type, { x, y })
}

onBeforeUnmount(stopPointerTracking)
</script>

<style lang="scss" scoped>
.portal-designer {
  display: flex;
  min-width: 0;
  min-height: 0;
  padding: 8px 12px;
  background: var(--portal-page-bg);
  flex: 1;
  flex-direction: column;
}

.portal-designer__canvas {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: auto;
  background-color: var(--portal-grid-bg);
  background-image: radial-gradient(var(--portal-grid-dot) 1px, transparent 1px);
  background-size: 20px 20px;
  border: 1px solid var(--portal-border);
  border-radius: 6px;
}

.portal-designer__canvas.is-populated::after {
  display: block;
  height: clamp(140px, 26vh, 260px);
  content: '';
}

.portal-designer__grid {
  min-height: 560px;
}

.portal-designer__item {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  cursor: move;
}

.portal-designer__grid :deep(.vgl-item) {
  min-width: 0;
  min-height: 0;
}

.portal-designer__grid :deep(.vgl-item--placeholder) {
  background: var(--portal-selection-bg);
  border: 1px dashed var(--el-color-primary);
  border-radius: 6px;
}

.portal-designer__item.is-selected :deep(.portal-widget) {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-primary) 16%, transparent);
}

.portal-designer__item-label {
  position: absolute;
  top: 4px;
  left: 5px;
  z-index: 3;
  display: none;
  max-width: calc(100% - 72px);
  padding: 3px 6px;
  overflow: hidden;
  color: var(--el-color-primary);
  pointer-events: none;
  background: color-mix(in srgb, var(--portal-surface) 90%, transparent);
  border-radius: 4px;
  align-items: center;
  gap: 4px;
}

.portal-designer__item-label span {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-designer__item:hover .portal-designer__item-label,
.portal-designer__item.is-selected .portal-designer__item-label {
  display: flex;
}

.portal-designer__item-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 4;
  display: none;
  gap: 4px;
}

.portal-designer__item:hover .portal-designer__item-actions,
.portal-designer__item.is-selected .portal-designer__item-actions {
  display: flex;
}

.portal-designer__item-actions :deep(.el-button) {
  margin-left: 0;
}

@media (width <= 700px) {
  .portal-designer {
    min-height: 720px;
  }

  .portal-designer__canvas {
    min-height: 680px;
  }
}
</style>
