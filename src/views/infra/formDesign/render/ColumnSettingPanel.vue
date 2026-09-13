<template>
  <el-popover placement="bottom-end" popper-class="column-setting-popper" :width="340">
    <template #reference>
      <el-button plain :title="'列设置'">
        <Icon icon="ep:setting" />
      </el-button>
    </template>

    <div class="column-setting">
      <div class="column-setting-head">
        <span>列设置</span>
        <el-button link type="primary" @click="emit('reset')">恢复默认</el-button>
      </div>

      <!--
        ⚠️ 拖拽排序改的是 DOM，Vue 并不知道这件事 —— 与设计器里那份列配置
        同一个坑。所以 onEnd 里要把节点放回原位，再由 splice 改数组，
        让 Vue 自己重新渲染。不放回去的话，下一次渲染会在旧位置上再插一份，
        列表里出现两条相同的列。
      -->
      <div ref="listRef" class="column-setting-list">
        <div v-for="col in items" :key="keyOf(col)" class="column-setting-item">
          <el-tooltip
            :content="reorderBlockedReason(col)"
            :disabled="isReorderable(col)"
            placement="left"
          >
            <span class="column-setting-handle" :class="{ 'is-disabled': !isReorderable(col) }">
              <Icon icon="ep:rank" :size="14" />
            </span>
          </el-tooltip>
          <el-checkbox
            :model-value="!col.__hidden"
            @update:model-value="(v: any) => emit('toggle', keyOf(col), !v)"
          >
            {{ col.label || col.field }}
          </el-checkbox>
          <el-input-number
            class="column-setting-width"
            :min="60"
            :model-value="col.width"
            :step="20"
            size="small"
            @update:model-value="(v: any) => emit('resize', keyOf(col), v)"
          />
        </div>
      </div>

      <!--
        必须写明存在哪里。不写的话，用户换台机器发现设置没了，会当成 bug 报上来 ——
        而它是「本次没做服务端持久化」这个已知取舍的必然结果
      -->
      <div class="column-setting-tip">设置只存在这台机器的这个浏览器里，换浏览器需要重新调整。</div>
    </div>
  </el-popover>
</template>

<script lang="ts" setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Sortable from 'sortablejs'
import {
  columnKeyOf,
  isReorderable,
  reorderBlockedReason
} from '@/components/FormWidgets/columnSetting'

defineOptions({ name: 'ColumnSettingPanel' })

const props = defineProps<{
  /** 合并了用户偏好之后的列，顺序就是显示顺序 */
  items: any[]
}>()

const emit = defineEmits<{
  (e: 'toggle', key: string, hidden: boolean): void
  (e: 'resize', key: string, width: number): void
  (e: 'reorder', from: number, to: number): void
  (e: 'reset'): void
}>()

const keyOf = columnKeyOf

const listRef = ref<HTMLElement>()
let sortable: any = null

const initSortable = async () => {
  await nextTick()
  const el = listRef.value
  if (!el) return
  sortable?.destroy?.()
  sortable = Sortable.create(el, {
    handle: '.column-setting-handle:not(.is-disabled)',
    animation: 150,
    // 固定列与明细列不能被拖走，也不能被拖到它们中间 ——
    // 固定列的偏移量按列序算，明细列按子表成组，任何一边错位都很难看出原因
    onMove: (event: any) => isReorderable(props.items[indexOfEl(event.related)] ?? {}),
    onEnd: (event: any) => {
      const { oldIndex, newIndex } = event
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
      // 先把 DOM 放回去，再让数据驱动重新渲染，理由见模板里的说明
      const parent = event.from as HTMLElement
      const moved = parent.children[newIndex]
      parent.removeChild(moved)
      parent.insertBefore(moved, parent.children[oldIndex] ?? null)
      emit('reorder', oldIndex, newIndex)
    }
  })
}

const indexOfEl = (el: Element | null): number =>
  el && listRef.value ? Array.from(listRef.value.children).indexOf(el) : -1

watch(() => props.items.length, initSortable, { immediate: true })
onBeforeUnmount(() => sortable?.destroy?.())
</script>

<style lang="scss" scoped>
.column-setting-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-weight: 600;
}

.column-setting-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 4px 0;
}

.column-setting-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;

  .el-checkbox {
    flex: 1;
    min-width: 0;
    margin-right: 0;
  }
}

.column-setting-handle {
  cursor: grab;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;

  &.is-disabled {
    cursor: not-allowed;
    opacity: 0.35;
  }
}

.column-setting-width {
  width: 108px;
  flex-shrink: 0;
}

.column-setting-tip {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
  line-height: 18px;
  color: var(--el-text-color-secondary);
}
</style>
