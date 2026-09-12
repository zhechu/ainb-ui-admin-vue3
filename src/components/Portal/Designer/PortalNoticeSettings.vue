<template>
  <div class="portal-notice-settings">
    <el-divider content-position="left">公告通知设置</el-divider>
    <el-form-item label="展示风格">
      <el-radio-group
        :model-value="modelValue.styleType || 'table'"
        size="small"
        @change="update('styleType', $event)"
      >
        <el-radio-button label="table">表格</el-radio-button>
        <el-radio-button label="horizontal">横向列表</el-radio-button>
        <el-radio-button label="vertical">纵向列表</el-radio-button>
      </el-radio-group>
    </el-form-item>
    <el-row :gutter="8">
      <el-col :span="12">
        <el-form-item label="显示条数">
          <el-input-number
            :model-value="modelValue.count || 5"
            :min="1"
            :max="50"
            controls-position="right"
            class="w-full"
            @update:model-value="update('count', $event)"
          />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="显示图片">
          <el-switch
            :model-value="modelValue.showImage === true"
            @change="update('showImage', $event)"
          />
        </el-form-item>
      </el-col>
    </el-row>

    <template v-if="modelValue.styleType === 'table' || !modelValue.styleType">
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="显示边框">
            <el-switch
              :model-value="modelValue.border !== false"
              @change="update('border', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="显示序号">
            <el-switch
              :model-value="modelValue.showIndex !== false"
              @change="update('showIndex', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="显示表头">
        <el-switch
          :model-value="modelValue.tableShowHeader !== false"
          @change="update('tableShowHeader', $event)"
        />
      </el-form-item>
      <template v-if="modelValue.tableShowHeader !== false">
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="表头字号">
              <el-input-number
                :model-value="modelValue.headerFontSize || 14"
                :min="12"
                :max="25"
                controls-position="right"
                class="w-full"
                @update:model-value="update('headerFontSize', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="表头加粗">
              <el-switch
                :model-value="modelValue.headerFontWeight === true"
                @change="update('headerFontWeight', $event)"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="表头颜色">
          <el-color-picker
            :model-value="modelValue.headerFontColor || '#303133'"
            show-alpha
            @update:model-value="update('headerFontColor', $event)"
          />
        </el-form-item>
        <el-form-item label="表头背景色">
          <el-color-picker
            :model-value="modelValue.headerBackgroundColor || '#f3f6f9'"
            show-alpha
            @update:model-value="update('headerBackgroundColor', $event)"
          />
        </el-form-item>
      </template>
    </template>

    <el-row :gutter="8">
      <el-col :span="12">
        <el-form-item label="内容字号">
          <el-input-number
            :model-value="modelValue.rowFontSize || 14"
            :min="12"
            :max="25"
            controls-position="right"
            class="w-full"
            @update:model-value="update('rowFontSize', $event)"
          />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="内容颜色">
          <el-color-picker
            :model-value="modelValue.rowFontColor || '#606266'"
            show-alpha
            @update:model-value="update('rowFontColor', $event)"
          />
        </el-form-item>
      </el-col>
    </el-row>
    <el-form-item label="溢出省略">
      <el-switch
        :model-value="modelValue.showOverflow !== false"
        @change="update('showOverflow', $event)"
      />
    </el-form-item>
    <el-row :gutter="8">
      <el-col :span="12">
        <el-form-item label="奇数行背景">
          <el-color-picker
            :model-value="modelValue.oddRowColor || ''"
            show-alpha
            @update:model-value="update('oddRowColor', $event)"
          />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="偶数行背景">
          <el-color-picker
            :model-value="modelValue.evenRowColor || ''"
            show-alpha
            @update:model-value="update('evenRowColor', $event)"
          />
        </el-form-item>
      </el-col>
    </el-row>

    <div class="portal-notice-settings__section-title">字段列</div>
    <div class="portal-notice-settings__columns">
      <div
        v-for="(column, index) in modelValue.columns || []"
        :key="`${column.key}-${index}`"
        class="portal-notice-settings__column"
      >
        <div class="portal-notice-settings__column-header">
          <span>字段 {{ Number(index) + 1 }}</span>
          <el-button text circle size="small" title="删除" @click="removeColumn(Number(index))">
            <Icon icon="ep:delete" />
          </el-button>
        </div>
        <el-select
          :model-value="column.key"
          class="w-full"
          @change="updateColumn(Number(index), 'key', $event)"
        >
          <el-option
            v-for="option in fieldOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
            :disabled="isFieldUsed(option.value, Number(index))"
          />
        </el-select>
        <el-input
          class="portal-notice-settings__column-input"
          :model-value="column.label"
          maxlength="20"
          placeholder="显示名称"
          @update:model-value="updateColumn(Number(index), 'label', $event)"
        />
        <el-row :gutter="8" class="portal-notice-settings__column-row">
          <el-col :span="12">
            <el-input-number
              :model-value="column.fontSize || 14"
              :min="10"
              :max="25"
              controls-position="right"
              class="w-full"
              @update:model-value="updateColumn(Number(index), 'fontSize', $event)"
            />
          </el-col>
          <el-col :span="12">
            <el-switch
              :model-value="column.visible !== false"
              active-text="显示"
              @change="updateColumn(Number(index), 'visible', $event)"
            />
          </el-col>
        </el-row>
        <el-color-picker
          :model-value="column.color || '#606266'"
          show-alpha
          @update:model-value="updateColumn(Number(index), 'color', $event)"
        />
      </div>
    </div>
    <el-button
      class="portal-notice-settings__add"
      plain
      type="primary"
      :disabled="!canAddColumn"
      @click="addColumn"
    >
      <Icon icon="ep:plus" />添加字段
    </el-button>
  </div>
</template>

<script lang="ts" setup>
import { cloneDeep } from 'lodash-es'

defineOptions({ name: 'PortalNoticeSettings' })

const props = defineProps<{ modelValue: Record<string, any> }>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, any>] }>()
const fieldOptions = [
  { label: '分类', value: 'category' },
  { label: '标题', value: 'title' },
  { label: '摘要', value: 'content' },
  { label: '时间', value: 'time' },
  { label: '创建人', value: 'creator' }
]

const update = (field: string, value: any) => {
  emit('update:modelValue', { ...props.modelValue, [field]: value })
}

const updateColumn = (index: number, field: string, value: any) => {
  const columns = cloneDeep(props.modelValue.columns || [])
  if (!columns[index]) return
  columns[index][field] = value
  update('columns', columns)
}

const isFieldUsed = (value: string, currentIndex: number) =>
  (props.modelValue.columns || []).some(
    (column: any, index: number) => index !== currentIndex && column.key === value
  )

const canAddColumn = computed(() => fieldOptions.some((option) => !isFieldUsed(option.value, -1)))

const addColumn = () => {
  const columns = props.modelValue.columns || []
  const nextField = fieldOptions.find((option) => !isFieldUsed(option.value, -1))
  if (!nextField) return
  update('columns', [
    ...columns,
    {
      key: nextField.value,
      label: nextField.label,
      visible: true,
      fontSize: 14,
      fontWeight: false,
      color: '#606266'
    }
  ])
}

const removeColumn = (index: number) => {
  const columns = cloneDeep(props.modelValue.columns || [])
  columns.splice(index, 1)
  update('columns', columns)
}
</script>

<style lang="scss" scoped>
.portal-notice-settings :deep(.el-divider) {
  margin: 16px 0 12px;
}

.portal-notice-settings :deep(.el-divider__text) {
  padding: 0 8px 0 0;
  font-size: 12px;
  font-weight: 650;
  color: var(--portal-text-secondary);
}

.portal-notice-settings__section-title {
  margin: 12px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--portal-text-secondary);
}

.portal-notice-settings__columns {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.portal-notice-settings__column {
  padding: 8px;
  background: var(--portal-surface-soft);
  border: 1px solid var(--portal-border);
  border-radius: 6px;
}

.portal-notice-settings__column-header {
  display: flex;
  min-height: 24px;
  color: var(--portal-text-secondary);
  align-items: center;
  justify-content: space-between;
}

.portal-notice-settings__column-header span {
  font-size: 12px;
}

.portal-notice-settings__column-header :deep(.el-button) {
  margin-left: 0;
}

.portal-notice-settings__column-input,
.portal-notice-settings__column-row,
.portal-notice-settings__column :deep(.el-color-picker) {
  margin-top: 8px;
}

.portal-notice-settings__add {
  width: 100%;
  margin-top: 8px;
}

.w-full {
  width: 100%;
}
</style>
