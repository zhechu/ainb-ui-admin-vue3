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
      <el-form-item label="门户类型" prop="type">
        <el-radio-group v-model="formData.type" :disabled="typeDisabled">
          <el-radio :value="0">在线设计</el-radio>
          <el-radio :value="1">自定义</el-radio>
        </el-radio-group>
        <div class="form-tip">在线设计：拖拽组件设计门户页面；自定义：跳转到页面或外链。类型创建后不可修改。</div>
      </el-form-item>
      <template v-if="formData.type === 1">
        <el-form-item label="链接类型" prop="linkType">
          <el-radio-group v-model="formData.linkType">
            <el-radio :value="0">页面</el-radio>
            <el-radio :value="1">外链</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="链接地址" prop="linkUrl">
          <el-input
            v-model="formData.linkUrl"
            clearable
            :placeholder="
              formData.linkType === 1 ? '例如：https://example.com' : '例如：/system/user（系统内页面路由）'
            "
          />
          <div class="form-tip">
            {{
              formData.linkType === 1
                ? '外链需以 http:// 或 https:// 开头；若对方站点禁止内嵌，首页会提供「新标签页打开」入口。'
                : '页面为系统内路由地址，需以 / 开头。'
            }}
          </div>
        </el-form-item>
      </template>
      <el-form-item label="门户描述" prop="description">
        <el-input
          v-model="formData.description"
          :rows="3"
          type="textarea"
          placeholder="请输入门户描述"
        />
      </el-form-item>
      <el-form-item label="可见范围" prop="visibleScope">
        <el-radio-group v-model="formData.visibleScope" @change="handleScopeChange">
          <el-radio :value="0">所有人</el-radio>
          <el-radio :value="1">指定角色</el-radio>
          <el-radio :value="2">指定用户</el-radio>
        </el-radio-group>
        <div class="form-tip">控制哪些用户可以在首页切换到该门户；超级管理员始终可见。</div>
      </el-form-item>
      <el-form-item v-if="formData.visibleScope === 1" label="可见角色" prop="visibleIdArr">
        <el-select
          v-model="formData.visibleIdArr"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          class="w-full"
          placeholder="请选择角色"
        >
          <el-option
            v-for="role in roleOptions"
            :key="role.id"
            :label="role.name"
            :value="role.code"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="formData.visibleScope === 2" label="可见用户" prop="visibleIdArr">
        <el-select
          v-model="formData.visibleIdArr"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          class="w-full"
          placeholder="请选择用户"
        >
          <el-option
            v-for="user in userOptions"
            :key="user.id"
            :label="user.nickname"
            :value="String(user.id)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="排序" prop="sort">
        <el-input-number v-model="formData.sort" :min="0" :step="1" controls-position="right" />
        <div class="form-tip">值越小越靠前，门户列表与首页门户切换均按此排序。</div>
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
import { getSimpleRoleList, type RoleVO } from '@/api/system/role'
import { getSimpleUserList } from '@/api/system/user'
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

type PortalFormData = PortalApi.PortalSaveReqVO & { visibleIdArr: string[] }

const defaultFormData = (): PortalFormData => ({
  name: '',
  code: '',
  description: '',
  type: 0,
  linkType: 0,
  linkUrl: '',
  sort: 0,
  content: stringifyPortalConfig(createDefaultPortalConfig()),
  isDefault: false,
  enabled: true,
  visibleScope: 0,
  visibleIds: undefined,
  visibleIdArr: []
})
const formData = ref<PortalFormData>(defaultFormData())

const validateLinkUrl = (_rule: any, value: string, callback: (err?: Error) => void) => {
  if (formData.value.type !== 1) {
    callback()
    return
  }
  if (!value || !value.trim()) {
    callback(new Error('链接地址不能为空'))
    return
  }
  if (formData.value.linkType === 1 && !/^https?:\/\//i.test(value.trim())) {
    callback(new Error('外链地址需以 http:// 或 https:// 开头'))
    return
  }
  if (formData.value.linkType === 0 && !value.trim().startsWith('/')) {
    callback(new Error('页面地址为系统内路由，需以 / 开头'))
    return
  }
  callback()
}
const validateVisibleIds = (_rule: any, value: string[], callback: (err?: Error) => void) => {
  if (formData.value.visibleScope !== 0 && (!value || value.length === 0)) {
    callback(new Error('请至少选择一个可见对象'))
    return
  }
  callback()
}
const formRules = reactive({
  name: [{ required: true, message: '门户名称不能为空', trigger: 'blur' }],
  code: [
    { required: true, message: '门户编码不能为空', trigger: 'blur' },
    { pattern: /^[A-Za-z_][A-Za-z0-9_]*$/, message: '编码格式不正确', trigger: 'blur' }
  ],
  linkUrl: [{ validator: validateLinkUrl, trigger: 'blur' }],
  visibleIdArr: [{ validator: validateVisibleIds, trigger: 'change' }]
})

const codeDisabled = computed(() => formType.value === 'update' && !!formData.value.id)
const typeDisabled = computed(() => formType.value === 'update' && !!formData.value.id)

const roleOptions = ref<RoleVO[]>([])
const userOptions = ref<{ id: number; nickname: string }[]>([])
const handleScopeChange = async (scope: number) => {
  formData.value.visibleIdArr = []
  if (scope === 1 && roleOptions.value.length === 0) {
    roleOptions.value = await getSimpleRoleList()
  }
  if (scope === 2 && userOptions.value.length === 0) {
    userOptions.value = await getSimpleUserList()
  }
}

const open = async (type: 'create' | 'update', row?: PortalApi.PortalVO) => {
  formType.value = type
  dialogTitle.value = type === 'create' ? '新增门户' : '编辑门户'
  if (type === 'update' && row) {
    const visibleScope = row.visibleScope ?? 0
    formData.value = {
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      type: row.type ?? 0,
      linkType: row.linkType ?? 0,
      linkUrl: row.linkUrl || '',
      sort: row.sort ?? 0,
      content: row.content,
      isDefault: row.isDefault,
      enabled: row.enabled,
      visibleScope,
      visibleIds: row.visibleIds,
      visibleIdArr:
        visibleScope !== 0 && row.visibleIds
          ? row.visibleIds.split(',').filter((item) => item)
          : []
    }
    if (visibleScope === 1) {
      roleOptions.value = await getSimpleRoleList()
    }
    if (visibleScope === 2) {
      userOptions.value = await getSimpleUserList()
    }
  } else {
    formData.value = defaultFormData()
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
    const isLink = formData.value.type === 1
    const data: PortalApi.PortalSaveReqVO = {
      id: formData.value.id,
      name: formData.value.name,
      code: formData.value.code,
      description: formData.value.description,
      type: formData.value.type,
      linkType: isLink ? formData.value.linkType : undefined,
      linkUrl: isLink ? formData.value.linkUrl?.trim() : undefined,
      sort: formData.value.sort ?? 0,
      content: isLink ? '' : formData.value.content,
      isDefault: formData.value.isDefault,
      enabled: formData.value.enabled,
      visibleScope: formData.value.visibleScope,
      visibleIds:
        formData.value.visibleScope === 0 ? undefined : formData.value.visibleIdArr.join(',')
    }
    let id = data.id
    if (formType.value === 'create') {
      id = await PortalApi.createPortal(data)
      message.success('创建成功')
    } else {
      await PortalApi.updatePortal(data)
      message.success('保存成功')
    }
    dialogVisible.value = false
    // 在线设计门户创建后进入设计器；链接门户没有设计环节
    emit('success', formType.value === 'create' && !isLink ? id : undefined)
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
