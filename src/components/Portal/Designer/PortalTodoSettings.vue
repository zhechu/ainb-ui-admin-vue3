<template>
  <div class="portal-todo-settings">
    <el-divider content-position="left">{{
      mode === 'summary' ? '待办设置' : '列表设置'
    }}</el-divider>

    <template v-if="mode === 'summary'">
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="每行数量">
            <el-input-number
              :model-value="modelValue.columns || 5"
              :min="1"
              :max="10"
              controls-position="right"
              class="w-full"
              @update:model-value="update('columns', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="显示边框">
            <el-switch
              :model-value="modelValue.showBorder === true"
              @change="update('showBorder', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="名称字号">
            <el-input-number
              :model-value="modelValue.labelFontSize || 14"
              :min="10"
              :max="25"
              controls-position="right"
              class="w-full"
              @update:model-value="update('labelFontSize', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="名称加粗">
            <el-switch
              :model-value="modelValue.labelFontWeight === true"
              @change="update('labelFontWeight', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="名称颜色">
        <el-color-picker
          :model-value="modelValue.labelFontColor || '#606266'"
          show-alpha
          @update:model-value="update('labelFontColor', $event)"
        />
      </el-form-item>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="数值字号">
            <el-input-number
              :model-value="modelValue.valueFontSize || 24"
              :min="12"
              :max="40"
              controls-position="right"
              class="w-full"
              @update:model-value="update('valueFontSize', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="数值加粗">
            <el-switch
              :model-value="modelValue.valueFontWeight !== false"
              @change="update('valueFontWeight', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="数值颜色">
        <el-color-picker
          :model-value="modelValue.valueFontColor || '#303133'"
          show-alpha
          @update:model-value="update('valueFontColor', $event)"
        />
      </el-form-item>

      <div class="portal-todo-settings__section-title">事项项</div>
      <div class="portal-todo-settings__items">
        <div
          v-for="(entry, index) in modelValue.items || []"
          :key="entry.id || index"
          class="portal-todo-settings__item"
        >
          <div class="portal-todo-settings__item-header">
            <span>事项 {{ Number(index) + 1 }}</span>
            <div>
              <el-button
                text
                circle
                size="small"
                title="上移"
                :disabled="index === 0"
                @click="moveItem(Number(index), -1)"
              >
                <Icon icon="ep:arrow-up" />
              </el-button>
              <el-button
                text
                circle
                size="small"
                title="下移"
                :disabled="Number(index) === (modelValue.items || []).length - 1"
                @click="moveItem(Number(index), 1)"
              >
                <Icon icon="ep:arrow-down" />
              </el-button>
              <el-button text circle size="small" title="删除" @click="removeItem(Number(index))">
                <Icon icon="ep:delete" />
              </el-button>
            </div>
          </div>
          <el-input
            :model-value="entry.label"
            maxlength="30"
            placeholder="事项名称"
            @update:model-value="updateItem(Number(index), 'label', $event)"
          />
          <IconSelect
            :model-value="entry.icon || ''"
            clearable
            @update:model-value="updateItem(Number(index), 'icon', $event)"
          />
          <el-color-picker
            :model-value="entry.color || '#3473ff'"
            show-alpha
            @update:model-value="updateItem(Number(index), 'color', $event)"
          />
          <el-input
            class="portal-todo-settings__input"
            :model-value="entry.url"
            placeholder="跳转路径或链接"
            @update:model-value="updateItem(Number(index), 'url', $event)"
          />
          <el-switch
            :model-value="entry.hidden !== true"
            active-text="显示"
            @change="updateItem(Number(index), 'hidden', !$event)"
          />
        </div>
      </div>
      <el-button class="portal-todo-settings__add" plain type="primary" @click="addItem">
        <Icon icon="ep:plus" />添加事项
      </el-button>
    </template>

    <template v-else>
      <el-form-item label="显示条数">
        <el-input-number
          :model-value="modelValue.pageSize || 7"
          :min="1"
          :max="50"
          controls-position="right"
          class="w-full"
          @update:model-value="update('pageSize', $event)"
        />
      </el-form-item>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { cloneDeep } from 'lodash-es'

defineOptions({ name: 'PortalTodoSettings' })

const props = withDefaults(
  defineProps<{
    modelValue: Record<string, any>
    mode?: 'summary' | 'list'
  }>(),
  { mode: 'summary' }
)
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, any>] }>()

const update = (field: string, value: any) => {
  emit('update:modelValue', { ...props.modelValue, [field]: value })
}

const updateItem = (index: number, field: string, value: any) => {
  const items = cloneDeep(props.modelValue.items || [])
  if (!items[index]) return
  items[index][field] = value
  update('items', items)
}

const addItem = () => {
  update('items', [
    ...(props.modelValue.items || []),
    {
      id: `todo-${Date.now()}`,
      label: '新事项',
      value: 0,
      icon: 'ep:document',
      color: '#3473ff',
      url: '',
      hidden: false
    }
  ])
}

const removeItem = (index: number) => {
  const items = cloneDeep(props.modelValue.items || [])
  items.splice(index, 1)
  update('items', items)
}

const moveItem = (index: number, offset: number) => {
  const items = cloneDeep(props.modelValue.items || [])
  const targetIndex = index + offset
  if (targetIndex < 0 || targetIndex >= items.length) return
  const [entry] = items.splice(index, 1)
  items.splice(targetIndex, 0, entry)
  update('items', items)
}
</script>

<style lang="scss" scoped>
.portal-todo-settings :deep(.el-divider) {
  margin: 16px 0 12px;
}

.portal-todo-settings :deep(.el-divider__text) {
  padding: 0 8px 0 0;
  font-size: 12px;
  font-weight: 650;
  color: var(--portal-text-secondary);
}

.portal-todo-settings__section-title {
  margin: 12px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--portal-text-secondary);
}

.portal-todo-settings__items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.portal-todo-settings__item {
  padding: 8px;
  background: var(--portal-surface-soft);
  border: 1px solid var(--portal-border);
  border-radius: 6px;
}

.portal-todo-settings__item-header {
  display: flex;
  min-height: 24px;
  margin-bottom: 6px;
  color: var(--portal-text-secondary);
  align-items: center;
  justify-content: space-between;
}

.portal-todo-settings__item-header span {
  font-size: 12px;
}

.portal-todo-settings__item-header :deep(.el-button) {
  margin-left: 0;
}

.portal-todo-settings__item :deep(.selector),
.portal-todo-settings__input,
.portal-todo-settings__item :deep(.el-color-picker),
.portal-todo-settings__item :deep(.el-switch) {
  margin-top: 8px;
}

.portal-todo-settings__add {
  width: 100%;
  margin-top: 8px;
}

.w-full {
  width: 100%;
}
</style>
