<template>
  <el-popover
    v-model:visible="visible"
    placement="bottom-start"
    :width="340"
    :show-arrow="false"
    trigger="click"
    popper-class="portal-container-add-popper"
  >
    <template #reference>
      <button
        class="portal-container-add"
        type="button"
        :aria-expanded="visible"
        aria-haspopup="menu"
      >
        <Icon icon="ep:plus" :size="14" />
        <span>添加控件</span>
      </button>
    </template>

    <div class="portal-container-add__menu" role="menu" @click.stop>
      <div class="portal-container-add__groups">
        <button
          v-for="group in groups"
          :key="group.key"
          class="portal-container-add__group"
          :class="{ 'is-active': activeGroupKey === group.key }"
          type="button"
          role="menuitem"
          @mouseenter="activeGroupKey = group.key"
          @focus="activeGroupKey = group.key"
          @click="activeGroupKey = group.key"
        >
          <Icon :icon="group.icon" :size="15" />
          <span>{{ group.label }}</span>
          <Icon icon="ep:arrow-right" :size="13" />
        </button>
      </div>

      <div class="portal-container-add__definitions">
        <div class="portal-container-add__definitions-title">{{ activeGroup.label }}</div>
        <button
          v-for="definition in activeDefinitions"
          :key="definition.type"
          class="portal-container-add__definition"
          type="button"
          role="menuitem"
          @click="handleCommand(definition.type)"
        >
          <Icon :icon="definition.icon" :size="15" />
          <span>{{ definition.label }}</span>
        </button>
      </div>
    </div>
  </el-popover>
</template>

<script lang="ts" setup>
import {
  getComponentsByGroup,
  PORTAL_COMPONENT_GROUPS,
  type PortalComponentDefinition,
  type PortalComponentGroup
} from '@/components/Portal/helper/componentRegistry'

defineOptions({ name: 'PortalContainerAdd' })

const emit = defineEmits<{ add: [type: string] }>()
const visible = ref(false)
const groupKeys: PortalComponentGroup[] = ['layout', 'basic', 'system', 'chart']
const groups = computed(() =>
  groupKeys.map((key) => ({
    ...PORTAL_COMPONENT_GROUPS.find((group) => group.key === key)!,
    definitions: getComponentsByGroup(key)
  }))
)
const activeGroupKey = ref<PortalComponentGroup>('layout')
const activeGroup = computed(
  () => groups.value.find((group) => group.key === activeGroupKey.value) || groups.value[0]
)
const activeDefinitions = computed<PortalComponentDefinition[]>(
  () => activeGroup.value?.definitions || []
)

const handleCommand = (type: string) => {
  emit('add', type)
  visible.value = false
}
</script>

<style lang="scss" scoped>
.portal-container-add {
  display: inline-flex;
  min-height: 30px;
  padding: 0 10px;
  color: var(--el-color-primary);
  cursor: pointer;
  background: var(--el-color-primary-light-9);
  border: 1px dashed var(--el-color-primary-light-5);
  border-radius: 4px;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.portal-container-add:hover {
  background: var(--el-color-primary-light-8);
  border-color: var(--el-color-primary);
}

:deep(.el-dropdown-menu__item) {
  display: flex;
  min-width: 130px;
  align-items: center;
  gap: 7px;
}

.portal-container-add__menu {
  display: grid;
  min-height: 188px;
  grid-template-columns: 128px minmax(0, 1fr);
  gap: 8px;
}

.portal-container-add__groups {
  padding-right: 8px;
  border-right: 1px solid var(--el-border-color-lighter);
}

.portal-container-add__group,
.portal-container-add__definition {
  display: flex;
  width: 100%;
  min-height: 34px;
  padding: 0 8px;
  color: var(--el-text-color-regular);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 4px;
  align-items: center;
  gap: 7px;
}

.portal-container-add__group span,
.portal-container-add__definition span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.portal-container-add__group:hover,
.portal-container-add__group.is-active,
.portal-container-add__definition:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.portal-container-add__definitions {
  min-width: 0;
}

.portal-container-add__definitions-title {
  min-height: 34px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  line-height: 34px;
  color: var(--el-text-color-secondary);
}

@media (width <= 520px) {
  .portal-container-add__menu {
    grid-template-columns: 112px minmax(0, 1fr);
  }
}
</style>
