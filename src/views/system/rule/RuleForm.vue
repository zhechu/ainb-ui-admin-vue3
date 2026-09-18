<template>
  <Dialog v-model="dialogVisible" :title="formTitle" width="560px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" v-loading="loading">
      <el-form-item label="规则名称" prop="name">
        <el-input v-model="form.name" placeholder="如：仅查看自己的数据" class="w-full" />
      </el-form-item>
      <el-form-item label="规则模板" prop="template">
        <el-select v-model="form.template" class="w-full" placeholder="选择内置模板或输入自定义代码"
                   filterable allow-create default-first-option>
          <el-option-group label="内置模板">
            <el-option v-for="t in BUILT_IN_TEMPLATES" :key="t.code"
                       :label="t.label" :value="t.code">
              <span>{{ t.label }}</span>
              <span class="ml-8px text-11px text-gray-400">{{ t.code }}</span>
            </el-option>
          </el-option-group>
        </el-select>
      </el-form-item>
      <!-- 动态渲染模板参数说明 -->
      <el-form-item v-if="selectedTemplateHint" label="参数说明">
        <el-alert :title="selectedTemplateHint" type="info" :closable="false" class="text-12px" />
      </el-form-item>
      <el-form-item label="模板参数" prop="params">
        <el-input v-model="form.params" type="textarea" :rows="3"
                  placeholder='JSON 格式，如 {"allowedStatuses":[1,2,3]}&#10;内置派生规则（BPM_PARTICIPANT/RECORD_SHARED）无需参数' />
      </el-form-item>
      <el-form-item label="规则描述">
        <el-input v-model="form.description" type="textarea" :rows="2"
                  placeholder="展示给管理员，帮助选择规则时判断用途" />
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="form.status">
          <el-radio :value="0">启用</el-radio>
          <el-radio :value="1">停用</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :loading="saving" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import * as GrantApi from '@/api/system/grant'
import type { RuleVO } from '@/api/system/grant'

defineOptions({ name: 'SystemRuleForm' })

const emit = defineEmits(['success'])
const message = useMessage()

const dialogVisible = ref(false)
const loading = ref(false)
const saving = ref(false)
const isEdit = ref(false)
const formTitle = computed(() => isEdit.value ? '编辑规则' : '新增规则')

const defaultForm = (): Omit<RuleVO, 'id'> & { id?: number } => ({
  name: '', template: '', params: '', description: '', status: 0,
})
const form = ref(defaultForm())
const formRef = ref()

const rules = {
  name: [{ required: true, message: '规则名称不能为空', trigger: 'blur' }],
  template: [{ required: true, message: '规则模板不能为空', trigger: 'change' }],
}

// 内置模板快捷选项
const BUILT_IN_TEMPLATES = [
  { code: 'BUILT_IN_OWNER_ONLY', label: '仅自己的数据', hint: '无参数。{owner} = 当前用户，需要 owner 槽位' },
  { code: 'BUILT_IN_DEPT_ONLY', label: '本部门数据', hint: '无参数。{dept} = 当前部门，需要 dept 槽位' },
  { code: 'BUILT_IN_DEPT_AND_CHILDREN', label: '本部门及下级', hint: '无参数。{dept} IN 当前部门及所有下级，需要 dept 槽位' },
  { code: 'BUILT_IN_STATUS_IN', label: '指定状态可见', hint: '参数：{"allowedStatuses":[1,2,3]}，需要 status 槽位' },
  { code: 'BUILT_IN_OWNER_OR_DEPT', label: '自己或本部门', hint: '无参数。{owner}=自己 OR {dept}=本部门，需要 owner 和 dept 槽位' },
  { code: 'BUILT_IN_BPM_PARTICIPANT', label: '流程参与者可见', hint: '无参数（派生规则，自动查 bpm_instance_participant），需要 bizKey 槽位' },
  { code: 'BUILT_IN_RECORD_SHARED', label: '共享给我的记录', hint: '无参数（派生规则，自动查 sys_record_share），需要 bizKey 槽位' },
  { code: 'BUILT_IN_FIELD_EQUALS', label: '指定字段等于', hint: '参数：{"field":"slot名","value":"期望值"}，需要对应槽位' },
  { code: 'BUILT_IN_CUSTOM_TREE', label: '自定义条件树', hint: '参数：conditionTree JSON（S3b 格式）' },
]

const selectedTemplateHint = computed(() => {
  const t = BUILT_IN_TEMPLATES.find(x => x.code === form.value.template)
  return t?.hint ?? ''
})

const open = async (row?: RuleVO) => {
  dialogVisible.value = true
  isEdit.value = !!row
  form.value = row ? { ...row } : defaultForm()
  nextTick(() => formRef.value?.clearValidate())
}
defineExpose({ open })

const submitForm = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    if (isEdit.value && form.value.id) {
      await GrantApi.updateRule(form.value as RuleVO)
      message.success('修改成功')
    } else {
      await GrantApi.createRule(form.value)
      message.success('新增成功')
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    saving.value = false
  }
}
</script>
