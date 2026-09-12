<template>
  <section
    class="portal-theme portal-runtime"
    :class="{ 'portal-runtime--flush': flush }"
    :style="{ background: customBackground }"
  >
    <div class="portal-runtime__inner">
      <div class="portal-runtime__grid" :style="gridStyle">
        <div
          v-for="item in config.items"
          :key="item.id"
          class="portal-runtime__item"
          :style="itemStyle(item)"
        >
          <PortalWidget :item="item" />
        </div>
      </div>
      <el-empty v-if="!config.items.length" description="门户暂未配置内容" />
    </div>
  </section>
</template>

<script lang="ts" setup>
import type { PortalItem, PortalRuntimeVO } from '@/api/infra/portal'
import { parsePortalConfig } from '@/components/Portal/helper/componentRegistry'
import PortalWidget from './PortalWidget.vue'

defineOptions({ name: 'PortalRuntime' })

const props = defineProps<{ portal: PortalRuntimeVO; flush?: boolean }>()
const flush = computed(() => props.flush === true)
const config = computed(() => parsePortalConfig(props.portal.content))
const customBackground = computed(() => {
  const background = config.value.background
  return background && background.toLowerCase() !== '#f4f7fb' ? background : undefined
})
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${config.value.columns || 24}, minmax(0, 1fr))`,
  gridAutoRows: `${config.value.rowHeight || 8}px`,
  gap: `${config.value.gap || 12}px`
}))

const itemStyle = (item: PortalItem) => ({
  gridColumn: `${item.x + 1} / span ${item.w}`,
  gridRow: `${item.y + 1} / span ${item.h}`
})
</script>

<style lang="scss" scoped>
.portal-runtime {
  width: 100%;
  min-width: 0;
  min-height: calc(100vh - 24px);
  padding: 12px;
  color: var(--portal-text-regular);
  overflow-x: hidden;
  background: var(--portal-page-bg);
}

.portal-runtime--flush {
  padding: 0;
}

.portal-runtime__inner {
  width: 100%;
  max-width: none;
  margin: 0;
}

.portal-runtime__grid {
  display: grid;
  align-items: stretch;
}

.portal-runtime__item {
  min-width: 0;
  min-height: 0;
}

@media (width <= 768px) {
  .portal-runtime {
    padding: 8px;
  }

  .portal-runtime--flush {
    padding: 0;
  }

  .portal-runtime__grid {
    grid-template-columns: 1fr !important;
    grid-auto-rows: auto !important;
  }

  .portal-runtime__item {
    grid-column: auto !important;
    grid-row: auto !important;
    min-height: 160px;
  }
}
</style>
