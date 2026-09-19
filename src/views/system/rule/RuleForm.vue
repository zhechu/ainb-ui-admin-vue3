<template>
  <Dialog v-model="dialogVisible" :title="formTitle" width="860px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" v-loading="loading">
      <el-form-item label="规则名称" prop="name">
        <el-input
          v-model="form.name"
          :disabled="isView"
          placeholder="如：仅查看自己的数据"
          class="w-full"
        />
      </el-form-item>

      <el-form-item label="规则模板" prop="template">
        <div class="w-full">
          <!-- 开发人员逃生口：自定义模板代码（走旧 free-code，仅 JSON 编辑器） -->
          <div class="mb-6px flex items-center gap-8px">
            <el-switch v-model="useCustomCode" :disabled="isView" active-text="自定义模板代码" />
            <span v-if="useCustomCode" class="text-12px text-gray-400">
              手输模板代码，参数只能用 JSON 模式填写
            </span>
          </div>

          <el-input
            v-if="useCustomCode"
            v-model="form.template"
            :disabled="isView"
            placeholder="输入模板代码，如 BUILT_IN_STATUS_IN"
            class="w-full"
            @change="onTemplateChange"
          />
          <el-select
            v-else
            v-model="form.template"
            :disabled="isView"
            class="w-full"
            placeholder="选择内置模板"
            filterable
            @change="onTemplateChange"
          >
            <el-option-group
              v-for="g in groupedTemplates"
              :key="g.label"
              :label="g.label"
            >
              <el-option v-for="t in g.options" :key="t.code" :label="t.displayName" :value="t.code">
                <span>{{ t.displayName }}</span>
                <span class="ml-8px text-11px text-gray-400">{{ t.code }}</span>
              </el-option>
            </el-option-group>
          </el-select>
        </div>
      </el-form-item>

      <!-- 选中模板后展示业务说明 + 需要的槽位 -->
      <el-form-item v-if="selectedMeta" label="模板说明">
        <el-alert :title="selectedMeta.businessDescription" type="info" :closable="false" class="text-12px">
          <template v-if="selectedMeta.requiredSlots.length" #default>
            <div class="mt-4px">
              <span class="text-gray-400">需要资源已配置槽位：</span>
              <el-tag
                v-for="s in selectedMeta.requiredSlots"
                :key="s"
                size="small"
                class="ml-4px"
              >
                {{ s }}
              </el-tag>
            </div>
          </template>
        </el-alert>
      </el-form-item>

      <el-form-item label="模板参数" prop="params">
        <RuleParamsEditor
          :key="editorKey"
          ref="paramsEditorRef"
          v-model="form.params"
          :template="form.template"
          :meta="meta"
          :disabled="isView"
        />
      </el-form-item>

      <el-form-item label="规则描述">
        <el-input
          v-model="form.description"
          :disabled="isView"
          type="textarea"
          :rows="2"
          placeholder="展示给管理员，帮助选择规则时判断用途"
        />
      </el-form-item>

      <el-form-item label="状态">
        <el-radio-group v-model="form.status" :disabled="isView">
          <el-radio :value="0">启用</el-radio>
          <el-radio :value="1">停用</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button v-if="!isView" :loading="saving" type="primary" @click="submitForm">
        确 定
      </el-button>
      <el-button @click="dialogVisible = false">{{ isView ? '关 闭' : '取 消' }}</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import * as GrantApi from '@/api/system/grant'
import type { RuleVO } from '@/api/system/grant'
import RuleParamsEditor from './components/RuleParamsEditor.vue'
import { useRuleTemplateMeta } from './useRuleTemplateMeta'
import { isKnownTemplate } from './components/ruleParams'

defineOptions({ name: 'SystemRuleForm' })

const emit = defineEmits(['success'])
const message = useMessage()
const { meta, load, groupedTemplates } = useRuleTemplateMeta()

const dialogVisible = ref(false)
const loading = ref(false)
const saving = ref(false)
const isEdit = ref(false)
// 内置规则只读：只能查看不能编辑（后端 updateRule 同样拒绝，见 RULE_BUILT_IN_UNEDITABLE）
const isView = ref(false)
const formTitle = computed(() =>
  isView.value ? '查看规则' : isEdit.value ? '编辑规则' : '新增规则'
)

// params 在表单里恒为 string（RuleVO.params 是可选的，这里收紧以免 v-model 出现 undefined）
type RuleFormModel = Omit<RuleVO, 'id' | 'params'> & { id?: number; params: string }
const defaultForm = (): RuleFormModel => ({
  name: '',
  template: '',
  params: '',
  description: '',
  status: 0
})
const form = ref<RuleFormModel>(defaultForm())
const formRef = ref()
const paramsEditorRef = ref()

// 自定义模板代码开关 + 编辑器重挂 key（open/切模板时强制重建向导态）
const useCustomCode = ref(false)
const editorKey = ref(0)
let prevTemplate = ''

const selectedMeta = computed(() =>
  meta.value.templates.find((t) => t.code === form.value.template)
)

const rules = {
  name: [{ required: true, message: '规则名称不能为空', trigger: 'blur' }],
  template: [{ required: true, message: '规则模板不能为空', trigger: 'change' }],
  params: [
    {
      validator: (_rule: any, _value: any, callback: (e?: Error) => void) => {
        const err = paramsEditorRef.value?.validate?.()
        callback(err ? new Error(err) : undefined)
      },
      trigger: 'change'
    }
  ]
}

/** 切换模板：若已填参数则先确认，避免误清空 */
const onTemplateChange = async () => {
  const next = form.value.template
  if (prevTemplate && next !== prevTemplate && form.value.params && form.value.params.trim()) {
    try {
      await message.confirm('切换模板将清空已填写的参数，是否继续？')
    } catch {
      // 取消：回滚模板选择
      form.value.template = prevTemplate
      return
    }
    form.value.params = ''
  }
  prevTemplate = next
  // 非自定义代码但选了未知 code（罕见），或开自定义时，编辑器会自动降级 JSON
  editorKey.value++
}

const open = async (row?: RuleVO) => {
  dialogVisible.value = true
  loading.value = true
  isEdit.value = !!row
  isView.value = !!row?.builtIn
  form.value = row ? { ...row, params: row.params ?? '' } : defaultForm()
  useCustomCode.value = !!row?.template && !isKnownTemplate(row.template)
  prevTemplate = form.value.template
  editorKey.value++
  try {
    await load()
  } catch {
    message.warning('规则模板元数据加载失败，参数将只能用 JSON 模式编辑')
  } finally {
    loading.value = false
  }
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
