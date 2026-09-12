<template>
  <div class="portal-card-settings">
    <el-divider content-position="left">卡片设置</el-divider>
    <el-form-item label="标题名称">
      <el-input
        :model-value="modelValue.title"
        maxlength="50"
        @update:model-value="update('title', $event)"
      />
    </el-form-item>
    <el-form-item label="显示标题">
      <el-switch
        :model-value="modelValue.showHeader !== false"
        @change="update('showHeader', $event)"
      />
    </el-form-item>
    <el-row :gutter="8">
      <el-col :span="12">
        <el-form-item label="字体大小">
          <el-input-number
            :model-value="modelValue.titleFontSize || 14"
            :min="12"
            :max="25"
            controls-position="right"
            class="w-full"
            @update:model-value="update('titleFontSize', $event)"
          />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="字体加粗">
          <el-switch
            :model-value="modelValue.titleFontWeight === true"
            @change="update('titleFontWeight', $event)"
          />
        </el-form-item>
      </el-col>
    </el-row>
    <el-form-item label="字体颜色">
      <el-color-picker
        :model-value="modelValue.titleFontColor || '#303133'"
        show-alpha
        @update:model-value="update('titleFontColor', $event)"
      />
    </el-form-item>
    <el-form-item label="字体位置">
      <el-radio-group
        :model-value="modelValue.titleAlign || 'left'"
        size="small"
        @change="update('titleAlign', $event)"
      >
        <el-radio-button v-for="option in alignOptions" :key="option.value" :label="option.value">
          {{ option.label }}
        </el-radio-button>
      </el-radio-group>
    </el-form-item>
    <el-form-item label="标题背景色">
      <el-color-picker
        :model-value="modelValue.titleBackgroundColor || ''"
        show-alpha
        @update:model-value="update('titleBackgroundColor', $event)"
      />
    </el-form-item>
    <el-form-item label="标题图标">
      <IconSelect
        :model-value="modelValue.titleIcon || ''"
        clearable
        @update:model-value="update('titleIcon', $event)"
      />
    </el-form-item>
    <el-form-item label="图标颜色">
      <el-color-picker
        :model-value="modelValue.titleIconColor || '#606266'"
        show-alpha
        @update:model-value="update('titleIconColor', $event)"
      />
    </el-form-item>
    <el-form-item label="右上角名称">
      <el-input
        :model-value="modelValue.actionText"
        maxlength="30"
        show-word-limit
        @update:model-value="update('actionText', $event)"
      />
    </el-form-item>
    <el-form-item v-if="modelValue.actionText" label="右上角链接">
      <el-input
        :model-value="modelValue.actionUrl"
        placeholder="支持站内路径或 http(s) 地址"
        @update:model-value="update('actionUrl', $event)"
      />
    </el-form-item>
    <el-form-item v-if="modelValue.actionText && modelValue.actionUrl" label="打开方式">
      <el-radio-group
        :model-value="modelValue.actionTarget || '_self'"
        size="small"
        @change="update('actionTarget', $event)"
      >
        <el-radio-button label="_self">当前窗口</el-radio-button>
        <el-radio-button label="_blank">新窗口</el-radio-button>
      </el-radio-group>
    </el-form-item>
  </div>
</template>

<script lang="ts" setup>
defineOptions({ name: 'PortalCardSettings' })

const props = defineProps<{ modelValue: Record<string, any> }>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, any>] }>()
const alignOptions = [
  { label: '左', value: 'left' },
  { label: '中', value: 'center' },
  { label: '右', value: 'right' }
]

const update = (field: string, value: any) => {
  emit('update:modelValue', { ...props.modelValue, [field]: value })
}
</script>

<style lang="scss" scoped>
.portal-card-settings :deep(.el-divider) {
  margin: 16px 0 12px;
}

.portal-card-settings :deep(.el-divider__text) {
  padding: 0 8px 0 0;
  font-size: 12px;
  font-weight: 650;
  color: var(--portal-text-secondary);
}

.w-full {
  width: 100%;
}
</style>
