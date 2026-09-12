<template>
  <div class="portal-palette">
    <div class="portal-palette__title">
      <Icon icon="ep:menu" :size="16" />
      <span>控件库</span>
    </div>
    <div class="portal-palette__groups">
      <el-dropdown
        v-for="group in PORTAL_COMPONENT_GROUPS"
        :key="group.key"
        trigger="click"
        placement="bottom-start"
        @command="handleAdd"
      >
        <button type="button" class="portal-palette__group">
          <Icon :icon="group.icon" :size="16" />
          <span>{{ group.label }}</span>
          <el-tag size="small" effect="plain">{{ getComponentsByGroup(group.key).length }}</el-tag>
          <Icon icon="ep:arrow-down" :size="12" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="portal-palette__menu">
            <el-dropdown-item
              v-for="item in getComponentsByGroup(group.key)"
              :key="item.type"
              :command="item.type"
            >
              <span
                class="portal-palette__menu-item"
                draggable="true"
                :title="item.description"
                @dragstart.stop="handleDragStart($event, item.type)"
              >
                <Icon :icon="item.icon" :size="16" />
                <span>{{ item.label }}</span>
              </span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {
  getComponentsByGroup,
  PORTAL_COMPONENT_GROUPS
} from '@/components/Portal/helper/componentRegistry'

defineOptions({ name: 'PortalPalette' })
const emit = defineEmits<{ add: [type: string] }>()

const handleDragStart = (event: DragEvent, type: string) => {
  event.dataTransfer?.setData('portal/type', type)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

const handleAdd = (type: string | number | object) => {
  if (typeof type === 'string') emit('add', type)
}
</script>

<style lang="scss" scoped>
.portal-palette {
  display: flex;
  min-width: 0;
  min-height: 54px;
  padding: 8px 16px;
  background: var(--portal-surface);
  border-bottom: 1px solid var(--portal-border-light);
  align-items: center;
  gap: 18px;
}

.portal-palette__title {
  display: flex;
  flex: 0 0 auto;
  color: var(--portal-text-primary);
  align-items: center;
  gap: 6px;
}

.portal-palette__title span {
  font-size: 13px;
  font-weight: 650;
}

.portal-palette__groups {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
}

.portal-palette__group {
  display: inline-flex;
  min-height: 34px;
  padding: 0 10px;
  color: var(--portal-text-tertiary);
  white-space: nowrap;
  cursor: pointer;
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  border-radius: 4px;
  align-items: center;
  gap: 6px;
}

.portal-palette__group:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
}

.portal-palette__group :deep(.el-tag) {
  margin-left: 2px;
}

.portal-palette__menu-item {
  display: flex;
  min-width: 142px;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  cursor: grab;
}

.portal-palette__menu-item > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-palette :deep(.el-dropdown-menu__item) {
  padding: 4px 12px;
}

@media (width <= 700px) {
  .portal-palette {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .portal-palette__groups {
    width: 100%;
  }
}
</style>
