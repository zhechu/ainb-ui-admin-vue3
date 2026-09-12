<template>
  <ContentWrap :bodyStyle="{ padding: '20px 16px' }">
    <SimpleProcessDesigner
      :model-form-id="modelFormId"
      :model-form-type="modelFormType"
      :model-form-design-code="modelFormDesignCode"
      :start-user-ids="startUserIds"
      :start-dept-ids="startDeptIds"
      @success="handleSuccess"
      ref="designerRef"
    />
  </ContentWrap>
</template>
<script setup lang="ts">
import { SimpleProcessDesigner } from '@/components/SimpleProcessDesignerV2/src/'

defineOptions({
  name: 'SimpleModelDesign'
})

defineProps<{
  modelName?: string
  modelFormId?: number
  modelFormType?: number
  /** 在线表单编码，表单类型为 ONLINE 时使用 */
  modelFormDesignCode?: string
  startUserIds?: number[]
  startDeptIds?: number[]
}>()

const emit = defineEmits(['success'])

// 修改成功回调
const handleSuccess = (data?: any) => {
  console.info('handleSuccess', data)
  if (data) {
    emit('success', data)
  }
}
</script>
<style lang="scss" scoped></style>
