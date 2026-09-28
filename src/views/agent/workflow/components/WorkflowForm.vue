<!--
  流程编排「新增 / 编辑元信息」弹窗 —— AI助手 流程编排优化 / Req 2（新增与设计分开）

  仿 views/infra/portal/PortalForm.vue 的 open(type,row?)/submitForm/emit('success') 约定。
  · 新增：收集 名称 + 编码 + 触发方式 + 模板起步（空白/示例/复制已有）→ buildStarterDsl 产合法 DSL → createDef 建草稿，
    emit('success', id, true) 让列表页跳整页设计器（设计归设计器，弹窗只管元信息）。
  · 编辑：只改元信息 + 触发方式（编码只读），画布节点原样保留——getDef 取完整 DSL 后 injectTrigger 只换 trigger 块，
    emit('success', id, false) 仅刷新列表（不跳设计器，那是「设计」按钮的事）。

  🔴 触发方式写进 DSL 的 trigger 块（后端 WorkflowTriggerExtractor 只认它，且 createDef/updateDef 落库前 fail-close 校验）。
  深层格式（cron 合法性 / webhook path 字符集）由后端权威校验，报错文案经 axios 拦截器直接 toast 给用户。
-->
<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="640px">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="96px"
    >
      <el-form-item label="流程名称" prop="name">
        <el-input v-model="formData.name" clearable placeholder="请输入流程名称" />
      </el-form-item>
      <el-form-item label="流程编码" prop="code">
        <el-input
          v-model="formData.code"
          :disabled="isUpdate"
          clearable
          placeholder="小写字母开头，仅含小写字母/数字/下划线，2~64 位"
        />
        <div class="form-tip">编码是流程的稳定标识，创建后不可修改。</div>
      </el-form-item>

      <!-- 模板起步：仅新增时出现 -->
      <el-form-item v-if="!isUpdate" label="起步模板" prop="template">
        <el-radio-group v-model="formData.template">
          <el-radio value="blank">空白</el-radio>
          <el-radio value="sample">示例骨架</el-radio>
          <el-radio value="copy">复制已有</el-radio>
        </el-radio-group>
        <div class="form-tip">
          空白：空画布从零开始；示例骨架：带一个只读工具演示节点、开箱可过体检；复制已有：以现有流程为起点。
        </div>
      </el-form-item>
      <el-form-item v-if="!isUpdate && formData.template === 'copy'" label="复制来源" prop="copySourceId">
        <el-select
          v-model="formData.copySourceId"
          filterable
          clearable
          class="w-full"
          placeholder="选择一条现有流程作为起点"
        >
          <el-option
            v-for="item in copyOptions"
            :key="item.id"
            :label="`${item.name || item.code}（v${item.version}）`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="触发方式" prop="triggerType">
        <el-select v-model="formData.triggerType" class="w-full" placeholder="请选择触发方式">
          <el-option
            v-for="item in TRIGGER_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <div class="form-tip">{{ triggerHint }}</div>
      </el-form-item>

      <!-- chat：绑定 Agent（选填） -->
      <el-form-item v-if="formData.triggerType === 'chat'" label="驱动 Agent" prop="agentId">
        <el-input v-model="formData.agentId" clearable placeholder="填已发布 Agent 的编码 code，留空=仅手动运行" />
      </el-form-item>

      <!-- form_event：表单编码 + 事件类型（必填） -->
      <template v-if="formData.triggerType === 'form_event'">
        <el-form-item label="表单编码" prop="formCode">
          <el-input v-model="formData.formCode" clearable placeholder="监听哪个表单的数据变更，填表单编码" />
        </el-form-item>
        <el-form-item label="事件类型" prop="eventType">
          <el-select v-model="formData.eventType" class="w-full" placeholder="请选择事件类型">
            <el-option label="新增时（create）" value="create" />
            <el-option label="修改时（update）" value="update" />
            <el-option label="删除时（delete）" value="delete" />
          </el-select>
        </el-form-item>
      </template>

      <!-- schedule：cron（必填） -->
      <el-form-item v-if="formData.triggerType === 'schedule'" label="Cron 表达式" prop="cron">
        <el-input v-model="formData.cron" clearable placeholder="Spring 6 段格式，例如 0 0 2 * * ?（每天 2 点）" />
      </el-form-item>

      <!-- webhook：path + authType + secret -->
      <template v-if="formData.triggerType === 'webhook'">
        <el-form-item label="入站 Path" prop="path">
          <el-input v-model="formData.path" clearable placeholder="字母/数字/下划线/连字符，1~64 位，例如 order_hook" />
          <div class="form-tip">发布后入站地址为 POST /admin-api/agent/webhook/{path}。</div>
        </el-form-item>
        <el-form-item label="鉴权方式" prop="authType">
          <el-select v-model="formData.authType" class="w-full">
            <el-option label="无（仅靠不可猜的 path）" value="none" />
            <el-option label="HMAC-SHA256 签名" value="hmac" />
            <el-option label="静态令牌 Token" value="token" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="formData.authType !== 'none'" label="验签密钥" prop="secret">
          <el-input v-model="formData.secret" clearable placeholder="hmac/token 模式必填的密钥" show-password />
        </el-form-item>
      </template>

      <el-form-item label="描述" prop="description">
        <el-input
          v-model="formData.description"
          type="textarea"
          :rows="2"
          maxlength="500"
          show-word-limit
          placeholder="选填"
        />
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input
          v-model="formData.remark"
          type="textarea"
          :rows="2"
          maxlength="500"
          show-word-limit
          placeholder="选填"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确定</el-button>
      <el-button @click="dialogVisible = false">取消</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import { AgentWorkflowApi, type AgentWorkflowDefVO } from '@/api/agent/workflow'
import { CODE_PATTERN } from '../editor/defaults'
import {
  buildStarterDsl,
  injectTrigger,
  type StarterTemplate,
  type WorkflowTriggerMeta,
  type WorkflowTriggerType
} from '../editor/starterDsl'

defineOptions({ name: 'AgentWorkflowForm' })

const message = useMessage()
const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref<'create' | 'update'>('create')
const formRef = ref()

const isUpdate = computed(() => formType.value === 'update')

const TRIGGER_OPTIONS: { value: WorkflowTriggerType; label: string }[] = [
  { value: 'none', label: '无（仅手动 / 接口运行）' },
  { value: 'chat', label: '对话驱动 Agent' },
  { value: 'form_event', label: '表单事件' },
  { value: 'schedule', label: '定时' },
  { value: 'webhook', label: 'Webhook' }
]

interface WorkflowFormData {
  id?: number
  name: string
  code: string
  template: StarterTemplate
  copySourceId?: number
  triggerType: WorkflowTriggerType
  agentId: string
  formCode: string
  eventType: string
  cron: string
  path: string
  authType: string
  secret: string
  description: string
  remark: string
}

const defaultFormData = (): WorkflowFormData => ({
  id: undefined,
  name: '',
  code: '',
  template: 'sample',
  copySourceId: undefined,
  triggerType: 'chat',
  agentId: '',
  formCode: '',
  eventType: 'create',
  cron: '',
  path: '',
  authType: 'none',
  secret: '',
  description: '',
  remark: ''
})
const formData = ref<WorkflowFormData>(defaultFormData())

/** 编辑态：缓存既有完整 DSL（列表分页不带 dsl），提交时只换 trigger 块、保留画布节点 */
const existingDsl = ref('')
/** 复制来源候选（新增 + copy 模板时用） */
const copyOptions = ref<AgentWorkflowDefVO[]>([])

const triggerHint = computed(() => {
  switch (formData.value.triggerType) {
    case 'chat':
      return '用户在绑定 Agent 的聊天窗口每发一句话，就跑一遍本流程；留空则仅手动运行。'
    case 'form_event':
      return '指定表单发生新增/修改/删除时自动触发本流程。'
    case 'schedule':
      return '按 Cron 定时自动触发（Spring 6 段格式，不支持 Quartz 的 ?/L/W/#）。'
    case 'webhook':
      return '外部系统 POST 入站地址即可触发本流程。'
    default:
      return '不配置触发器，只能手动运行或由接口调用触发。'
  }
})

const validateTrigger = (_rule: any, _value: any, callback: (err?: Error) => void) => {
  const d = formData.value
  if (d.triggerType === 'form_event') {
    if (!d.formCode?.trim()) return callback(new Error('请填写表单编码'))
    if (!d.eventType) return callback(new Error('请选择事件类型'))
  }
  if (d.triggerType === 'schedule' && !d.cron?.trim()) {
    return callback(new Error('请填写 Cron 表达式'))
  }
  if (d.triggerType === 'webhook') {
    if (!d.path?.trim()) return callback(new Error('请填写入站 Path'))
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(d.path.trim())) {
      return callback(new Error('Path 只能是字母/数字/下划线/连字符（1~64 位，不含斜杠或点）'))
    }
    if (d.authType !== 'none' && !d.secret?.trim()) {
      return callback(new Error('hmac/token 模式必须填写验签密钥'))
    }
  }
  callback()
}

const validateCopySource = (_rule: any, _value: any, callback: (err?: Error) => void) => {
  if (!isUpdate.value && formData.value.template === 'copy' && !formData.value.copySourceId) {
    return callback(new Error('请选择一条要复制的流程'))
  }
  callback()
}

const formRules = reactive({
  name: [{ required: true, message: '流程名称不能为空', trigger: 'blur' }],
  code: [
    { required: true, message: '流程编码不能为空', trigger: 'blur' },
    { pattern: CODE_PATTERN, message: '编码需小写字母开头，仅含小写字母/数字/下划线，2~64 位', trigger: 'blur' }
  ],
  triggerType: [{ validator: validateTrigger, trigger: 'change' }],
  copySourceId: [{ validator: validateCopySource, trigger: 'change' }]
})

/** 收集弹窗字段 → 触发元信息 */
const collectTrigger = (): WorkflowTriggerMeta => {
  const d = formData.value
  switch (d.triggerType) {
    case 'chat':
      return { type: 'chat', agentId: d.agentId.trim() }
    case 'form_event':
      return { type: 'form_event', formCode: d.formCode.trim(), eventType: d.eventType }
    case 'schedule':
      return { type: 'schedule', cron: d.cron.trim() }
    case 'webhook':
      return {
        type: 'webhook',
        path: d.path.trim(),
        authType: d.authType,
        secret: d.authType === 'none' ? undefined : d.secret.trim()
      }
    default:
      return { type: 'none' }
  }
}

/** 从既有 DSL 的 trigger 块反解出弹窗字段（编辑态回显当前触发配置） */
const applyTriggerFromDsl = (dslText: string) => {
  try {
    const trigger = JSON.parse(dslText)?.trigger
    if (!trigger || typeof trigger.type !== 'string') {
      formData.value.triggerType = 'none'
      return
    }
    const short = trigger.type.replace(/^trigger\./, '') as WorkflowTriggerType
    const config = trigger.config || {}
    formData.value.triggerType = short
    if (short === 'chat') formData.value.agentId = config.agentId ?? ''
    if (short === 'form_event') {
      formData.value.formCode = config.formCode ?? ''
      formData.value.eventType = config.eventType ?? 'create'
    }
    if (short === 'schedule') formData.value.cron = config.cron ?? ''
    if (short === 'webhook') {
      formData.value.path = config.path ?? ''
      formData.value.authType = config.authType ?? 'none'
      formData.value.secret = config.secret ?? ''
    }
  } catch {
    formData.value.triggerType = 'none'
  }
}

const loadCopyOptions = async () => {
  if (copyOptions.value.length) return
  const data = await AgentWorkflowApi.getDefPage({ pageNo: 1, pageSize: 100 })
  copyOptions.value = data.list || []
}

const open = async (type: 'create' | 'update', row?: AgentWorkflowDefVO) => {
  formType.value = type
  dialogTitle.value = type === 'create' ? '新增流程' : '编辑流程信息'
  formData.value = defaultFormData()
  existingDsl.value = ''
  if (type === 'update' && row) {
    formLoading.value = true
    try {
      // 列表分页不带 dsl，取完整定义才能既回显触发配置、又在提交时保留画布节点
      const full = await AgentWorkflowApi.getDef(row.id)
      existingDsl.value = full.dsl || ''
      formData.value = {
        ...defaultFormData(),
        id: full.id,
        name: full.name,
        code: full.code,
        description: full.description ?? '',
        remark: full.remark ?? ''
      }
      applyTriggerFromDsl(existingDsl.value)
    } finally {
      formLoading.value = false
    }
  } else {
    loadCopyOptions()
  }
  dialogVisible.value = true
  nextTick(() => formRef.value?.clearValidate())
}
defineExpose({ open })

const emit = defineEmits<{ success: [id: number | undefined, isCreate: boolean] }>()

const submitForm = async () => {
  if (!(await formRef.value?.validate())) return
  formLoading.value = true
  try {
    const d = formData.value
    const trigger = collectTrigger()
    if (isUpdate.value) {
      // 编辑：只换 trigger 块，保留既有画布节点（existingDsl 来自 getDef 的完整 DSL）
      const dsl = injectTrigger(existingDsl.value, trigger)
      await AgentWorkflowApi.updateDef({
        id: d.id,
        code: d.code,
        name: d.name,
        dsl,
        description: d.description,
        remark: d.remark
      })
      message.success('保存成功')
      dialogVisible.value = false
      emit('success', d.id, false)
      return
    }

    // 新增：按模板 + 触发方式构造起步 DSL
    let copyDsl: string | undefined
    if (d.template === 'copy' && d.copySourceId) {
      const src = await AgentWorkflowApi.getDef(d.copySourceId)
      copyDsl = src.dsl || undefined
    }
    const starterDsl = buildStarterDsl(d.template, {
      code: d.code,
      name: d.name,
      description: d.description,
      trigger,
      copyDsl
    })
    const id = await AgentWorkflowApi.createDef({
      code: d.code,
      name: d.name,
      dsl: starterDsl,
      description: d.description,
      remark: d.remark
    })
    message.success('新建成功（草稿）')
    dialogVisible.value = false
    emit('success', id, true)
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
