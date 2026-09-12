<template>
  <span class="doc-label">
    {{ text }}
    <!--
      问号图标而不是「查看文档」四个字：它挂在 el-form-item 的 label 上，
      label 宽度是固定的 140px，多几个字就会把标签挤成两行
    -->
    <Icon
      class="doc-label-icon"
      icon="ep:question-filled"
      :size="14"
      title="查看说明"
      @click.stop="emit('doc')"
    />
  </span>
</template>

<script lang="ts" setup>
defineOptions({ name: 'FormDesignDocLabel' })

defineProps<{ text: string }>()

const emit = defineEmits<{ doc: [] }>()
</script>

<style lang="scss" scoped>
.doc-label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.doc-label-icon {
  color: var(--el-text-color-placeholder);
  cursor: pointer;

  &:hover {
    color: var(--el-color-primary);
  }
}
</style>
