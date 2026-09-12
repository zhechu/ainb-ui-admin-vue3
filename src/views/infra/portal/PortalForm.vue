<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="620px">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="90px"
    >
      <el-form-item label="门户名称" prop="name">
        <el-input v-model="formData.name" clearable placeholder="请输入门户名称" />
      </el-form-item>
      <el-form-item label="门户编码" prop="code">
        <el-input
          v-model="formData.code"
          :disabled="codeDisabled"
          clearable
          placeholder="例如：main_portal"
          @blur="handleCodeBlur"
        />
        <div class="form-tip">仅允许字母、数字和下划线，发布后不可修改编码。</div>
      </el-form-item>
      <el-form-item label="门户描述" prop="description">
        <el-input
          v-model="formData.description"
          :rows="3"
          type="textarea"
          placeholder="请输入门户描述"
        />
      </el-form-item>
      <el-form-item label="默认门户">
        <el-switch v-model="formData.isDefault" active-text="首页展示" />
      </el-form-item>
      <el-form-item label="启用状态">
        <el-switch v-model="formData.enabled" active-text="启用" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确定</el-button>
      <el-button @click="dialogVisible = false">取消</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import * as PortalApi from '@/api/infra/portal'
import {
  createDefaultPortalConfig,
  stringifyPortalConfig
} from '@/components/Portal/helper/componentRegistry'

defineOptions({ name: 'InfraPortalForm' })

const message = useMessage()
const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref<'create' | 'update'>('create')
const formRef = ref()
const formData = ref<PortalApi.PortalSaveReqVO>({
  name: '',
  code: '',
  description: '',
  content: stringifyPortalConfig(createDefaultPortalConfig()),
  isDefault: false,
  enabled: true
})
const formRules = reactive({
  name: [{ required: true, message: '门户名称不能为空', trigger: 'blur' }],
  code: [
    { required: true, message: '门户编码不能为空', trigger: 'blur' },
    { pattern: /^[A-Za-z_][A-Za-z0-9_]*$/, message: '编码格式不正确', trigger: 'blur' }
  ]
})

const codeDisabled = computed(() => formType.value === 'update' && !!formData.value.id)

const open = (type: 'create' | 'update', row?: PortalApi.PortalVO) => {
  formType.value = type
  dialogTitle.value = type === 'create' ? '新建门户' : '编辑门户'
  formData.value =
    type === 'update' && row
      ? {
          id: row.id,
          name: row.name,
          code: row.code,
          description: row.description,
          content: row.content,
          isDefault: row.isDefault,
          enabled: row.enabled
        }
      : {
          name: '',
          code: '',
          description: '',
          content: stringifyPortalConfig(createDefaultPortalConfig()),
          isDefault: false,
          enabled: true
        }
  dialogVisible.value = true
  nextTick(() => formRef.value?.clearValidate())
}
defineExpose({ open })

const emit = defineEmits<{ success: [id?: number] }>()

const handleCodeBlur = async () => {
  if (!formData.value.code || codeDisabled.value) return
  const available = await PortalApi.checkPortalCode(formData.value.code, formData.value.id)
  if (!available) message.warning(`门户编码“${formData.value.code}”已被占用`)
}

const submitForm = async () => {
  if (!(await formRef.value?.validate())) return
  formLoading.value = true
  try {
    let id = formData.value.id
    if (formType.value === 'create') {
      id = await PortalApi.createPortal(formData.value)
      message.success('创建成功')
    } else {
      await PortalApi.updatePortal(formData.value)
      message.success('保存成功')
    }
    dialogVisible.value = false
    emit('success', id)
  } finally {
    formLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.form-tip {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
