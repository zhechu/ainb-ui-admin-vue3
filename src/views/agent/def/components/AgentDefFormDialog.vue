<!--
  Agent 定义 新建/编辑/查看表单（P5 Agent Builder 第一刀）

  业务人员在此定义一个 Agent 的身份：编码、名称、人设（系统提示词）、描述、备注。
  人设是一段自由散文（无结构可校），故用普通多行文本框，不像 workflow 那样上 Monaco + DSL 校验。

  🔴 三种模式：create（新建，落草稿）/ edit（改草稿，code 只读）/ view（只读查看，全字段禁用）。
     view 让已发布/已停用行也能看人设——编辑只对 DRAFT 开放（后端 updateDef 对非草稿抛 AGENT_DEF_NOT_DRAFT）。
  🔴 有界：本刀只落库与展示人设，尚无「按此 Agent 对话」的运行期消费方（slice-2 接入聊天入口路由）。
-->
<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="760px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="88px" v-loading="loading">
      <el-form-item label="Agent 编码" prop="code">
        <el-input
          v-model="formData.code"
          :disabled="!isCreate"
          placeholder="小写字母开头，仅含小写字母/数字/下划线，如 order_assistant"
        />
        <div v-if="!isCreate" class="text-12px text-[var(--el-text-color-secondary)] mt-2px leading-16px">
          编码不可修改（改编码等于换一个 Agent）；要改已发布 Agent 请基于它新建一个版本。
        </div>
      </el-form-item>
      <el-form-item label="名称" prop="name">
        <el-input v-model="formData.name" :disabled="isView" placeholder="请输入名称，如「订单客服」" />
      </el-form-item>
      <el-form-item label="人设" prop="persona">
        <div class="w-full">
          <div class="text-12px text-[var(--el-text-color-secondary)] mb-6px leading-16px">
            人设即 Agent 的系统提示词：定义它的身份、职责、语气与边界。
          </div>
          <el-input
            v-model="formData.persona"
            :disabled="isView"
            type="textarea"
            :rows="10"
            maxlength="8000"
            show-word-limit
            placeholder="例：你是一名耐心、专业的订单客服。职责：解答订单状态、物流、退换货问题。语气：友好简洁。边界：涉及退款金额争议时，说明规则并引导用户联系人工客服。"
          />
        </div>
      </el-form-item>
      <el-form-item label="描述" prop="description">
        <el-input
          v-model="formData.description"
          :disabled="isView"
          type="textarea"
          :rows="2"
          placeholder="选填"
          maxlength="500"
          show-word-limit
        />
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input
          v-model="formData.remark"
          :disabled="isView"
          type="textarea"
          :rows="2"
          placeholder="选填"
          maxlength="500"
          show-word-limit
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ isView ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!isView" type="primary" @click="handleSubmit" :loading="submitting">
        保存草稿
      </el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { AgentDefApi, type AgentDefSaveVO, type AgentDefVO } from '@/api/agent/def'

defineOptions({ name: 'AgentDefFormDialog' })

const emit = defineEmits(['success'])
const message = useMessage()

const visible = ref(false)
const loading = ref(false)
const submitting = ref(false)
const mode = ref<'create' | 'edit' | 'view'>('create')
const formRef = ref()

const isCreate = computed(() => mode.value === 'create')
const isEdit = computed(() => mode.value === 'edit')
const isView = computed(() => mode.value === 'view')

const emptyForm = (): AgentDefSaveVO => ({
  code: '',
  name: '',
  persona: '',
  description: '',
  remark: ''
})
const formData = ref<AgentDefSaveVO>(emptyForm())

const formRules = reactive({
  code: [
    { required: true, message: 'Agent 编码不能为空', trigger: 'blur' },
    {
      pattern: /^[a-z][a-z0-9_]{1,63}$/,
      message: '小写字母开头，仅含小写字母/数字/下划线，长度 2~64',
      trigger: 'blur'
    }
  ],
  name: [{ required: true, message: '名称不能为空', trigger: 'blur' }],
  persona: [{ required: true, message: '人设不能为空', trigger: 'blur' }]
})

const dialogTitle = computed(() => {
  if (isView.value) return 'Agent 定义详情'
  return isEdit.value ? '编辑 Agent 定义（草稿）' : '新建 Agent 定义'
})

/**
 * 打开表单
 * @param mode create=新建（空表单）；edit=编辑草稿；view=只读查看。edit/view 都按 id 拉完整 persona
 *             （列表分页不带 persona 正文）
 * @param row  edit/view 时的列表行（只用其 id）
 */
const open = async (openMode: 'create' | 'edit' | 'view', row?: AgentDefVO) => {
  mode.value = openMode
  visible.value = true
  if (openMode === 'create') {
    formData.value = emptyForm()
    return
  }
  loading.value = true
  try {
    const data = await AgentDefApi.getDef(row!.id)
    formData.value = {
      id: data.id,
      code: data.code,
      name: data.name,
      persona: data.persona ?? '',
      description: data.description ?? '',
      remark: data.remark ?? ''
    }
  } finally {
    loading.value = false
  }
}

/** 保存：表单校验 → create/update（草稿允许不完整，但字段级校验必须过） */
const handleSubmit = async () => {
  try {
    await formRef.value.validate()
  } catch {
    return // 字段级校验未过，错误已内联展示
  }
  submitting.value = true
  try {
    if (isEdit.value) {
      await AgentDefApi.updateDef(formData.value)
      message.success('修改成功')
    } else {
      await AgentDefApi.createDef(formData.value)
      message.success('新建成功（草稿）')
    }
    visible.value = false
    emit('success')
  } finally {
    submitting.value = false
  }
}

defineExpose({ open })
</script>
