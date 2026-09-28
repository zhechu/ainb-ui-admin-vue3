<!--
  用户自定义工具 新增/编辑/查看弹窗（AI助手 问题2）

  🔴 不让管理员裸写 config JSON：HTTP 定义拆成结构化子表单（方法/地址/超时/请求头/Query/请求体/鉴权），
     提交时序列化成后端要的 config 字符串。请求头/Query 复用工作流的 KeyValueEditor。

  🔴 凭据脱敏闭环：编辑时 getToolDef 返回的 config 里 bearerToken/basicPassword/apiKeyValue 是掩码 `******`。
     载入时把等于掩码的凭据清空、记为「已配置」，输入框 placeholder 提示「已配置（留空则不修改）」；
     提交时这些键留空则省略，由后端 updateToolDef 回填旧值——绝不把掩码原样回存（否则密钥被写成 ******）。

  🔴 只发送当前鉴权方式对应的凭据键：切换 authType 后旧方式的凭据不再带上（后端回填是逐键的，
     残留的旧凭据对当前 authType 无效、也无害）。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="dialogTitle"
    width="720px"
    append-to-body
    :close-on-click-modal="false"
    @close="onClosed"
  >
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="form"
      :rules="formRules"
      :disabled="isView"
      label-width="120px"
    >
      <el-divider content-position="left">基本信息</el-divider>
      <el-form-item label="展示名" prop="displayName">
        <el-input v-model="form.displayName" placeholder="如：健康探测" />
      </el-form-item>
      <el-form-item label="工具键" prop="toolKey">
        <el-input
          v-model="form.toolKey"
          :disabled="isView || isEdit"
          placeholder="小写字母开头，仅含小写字母/数字/下划线，如 health_ping"
        />
        <div v-if="isEdit" class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mt-2px">
          工具键创建后不可修改（改键等于换一个工具）。
        </div>
      </el-form-item>
      <el-form-item label="工具说明" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="2"
          placeholder="会进模型提示词与设计器，说清这个工具做什么、什么时候用"
        />
      </el-form-item>
      <el-form-item label="分组" prop="groupName">
        <el-input v-model="form.groupName" placeholder="设计器归类用，如 monitor" />
      </el-form-item>
      <el-form-item label="风险等级" prop="riskLevel">
        <el-select v-model="form.riskLevel" placeholder="请选择风险等级" class="w-full">
          <el-option
            v-for="r in RISK_OPTIONS"
            :key="r.value"
            :label="r.label"
            :value="r.value"
          >
            <span class="float-left">{{ r.label }}</span>
            <span class="float-right text-12px text-[var(--el-text-color-secondary)] ml-12px">{{ r.hint }}</span>
          </el-option>
        </el-select>
      </el-form-item>
      <el-form-item label="所需权限" prop="permissions">
        <el-input v-model="form.permissions" placeholder="逗号分隔的权限串，留空=登录即可调用" />
      </el-form-item>
      <el-form-item label="参数说明" prop="paramsSchema">
        <el-input
          v-model="form.paramsSchema"
          type="textarea"
          :rows="2"
          placeholder="自由文本，说明有哪些入参（进模型提示词）"
        />
      </el-form-item>
      <el-form-item label="启用" prop="enabled">
        <el-switch v-model="form.enabled" />
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="选填" />
      </el-form-item>

      <el-divider content-position="left">HTTP 配置</el-divider>
      <el-form-item label="请求方法" prop="method">
        <el-select v-model="form.method" class="w-full">
          <el-option v-for="m in METHODS" :key="m" :label="m" :value="m" />
        </el-select>
      </el-form-item>
      <el-form-item label="请求地址" prop="url">
        <el-input v-model="form.url" placeholder="如 https://api.example.com/orders，可用 {{参数名}} 占位" />
      </el-form-item>
      <el-form-item label="超时（毫秒）" prop="timeoutMs">
        <el-input-number v-model="form.timeoutMs" :min="1" :max="30000" :step="100" controls-position="right" />
        <span class="text-11px text-[var(--el-text-color-placeholder)] ml-8px">缺省 5000，上限受后端约束</span>
      </el-form-item>
      <el-form-item label="请求头">
        <KeyValueEditor v-model="form.headers" value-placeholder="值，可用 {{参数名}} 占位" />
      </el-form-item>
      <el-form-item label="Query 参数">
        <KeyValueEditor v-model="form.query" value-placeholder="值，可用 {{参数名}} 占位" />
      </el-form-item>
      <el-form-item v-if="isWriteMethod" label="请求体模板" prop="bodyTemplate">
        <el-input
          v-model="form.bodyTemplate"
          type="textarea"
          :rows="3"
          :placeholder="BODY_PLACEHOLDER"
        />
      </el-form-item>

      <el-form-item label="鉴权方式" prop="authType">
        <el-select v-model="form.authType" class="w-full">
          <el-option label="无（NONE）" value="NONE" />
          <el-option label="Bearer Token" value="BEARER" />
          <el-option label="HTTP Basic" value="BASIC" />
          <el-option label="API Key（自定义头）" value="API_KEY" />
        </el-select>
      </el-form-item>
      <template v-if="form.authType === 'BEARER'">
        <el-form-item label="Bearer Token" prop="bearerToken">
          <el-input
            v-model="form.bearerToken"
            type="password"
            show-password
            :placeholder="credConfigured.bearerToken ? '已配置（留空则不修改）' : '请输入 Token'"
          />
        </el-form-item>
      </template>
      <template v-else-if="form.authType === 'BASIC'">
        <el-form-item label="用户名" prop="basicUsername">
          <el-input v-model="form.basicUsername" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" prop="basicPassword">
          <el-input
            v-model="form.basicPassword"
            type="password"
            show-password
            :placeholder="credConfigured.basicPassword ? '已配置（留空则不修改）' : '请输入密码'"
          />
        </el-form-item>
      </template>
      <template v-else-if="form.authType === 'API_KEY'">
        <el-form-item label="Header 名" prop="apiKeyHeader">
          <el-input v-model="form.apiKeyHeader" placeholder="缺省 X-API-Key" />
        </el-form-item>
        <el-form-item label="Key 值" prop="apiKeyValue">
          <el-input
            v-model="form.apiKeyValue"
            type="password"
            show-password
            :placeholder="credConfigured.apiKeyValue ? '已配置（留空则不修改）' : '请输入 API Key'"
          />
        </el-form-item>
      </template>
    </el-form>
    <template #footer>
      <el-button :disabled="formLoading" @click="dialogVisible = false">取 消</el-button>
      <el-button v-if="!isView" type="primary" :loading="formLoading" @click="submitForm">确 定</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import type { FormInstance, FormRules } from 'element-plus'
import {
  AgentToolDefApi,
  type AgentToolDefSaveVO,
  type HttpToolConfigVO
} from '@/api/agent/tooldef'
import KeyValueEditor from '@/views/agent/workflow/components/KeyValueEditor.vue'

defineOptions({ name: 'ToolDefFormDialog' })

const emit = defineEmits<{ success: [] }>()

const message = useMessage()

/** 与后端 HttpToolConfig.REDACTED_MASK 逐字一致：读接口把凭据明文替换成它 */
const REDACTED_MASK = '******'
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD']
const WRITE_METHODS = ['POST', 'PUT', 'DELETE']
const TOOL_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/
/** 请求体模板占位（含双花括号模板示例，写进 script 常量避免与模板属性引号冲突） */
const BODY_PLACEHOLDER = '仅 POST/PUT/DELETE 生效，如 {"id":"{{orderId}}"}'

const RISK_OPTIONS = [
  { value: 'READ_ONLY', label: '只读', hint: '只查询、不改数据' },
  { value: 'LOW', label: '低风险', hint: '可逆的小改动' },
  { value: 'MEDIUM', label: '中风险', hint: '会写业务数据' },
  { value: 'HIGH', label: '高风险', hint: '影响面大/较难撤销' },
  { value: 'IRREVERSIBLE', label: '不可逆', hint: '一旦执行无法撤销' }
]

const dialogVisible = ref(false)
const formLoading = ref(false)
const mode = ref<'create' | 'edit' | 'view'>('create')
const isView = computed(() => mode.value === 'view')
const isEdit = computed(() => mode.value === 'edit')
const dialogTitle = computed(() =>
  mode.value === 'create' ? '新增工具' : mode.value === 'edit' ? '编辑工具' : '查看工具'
)

const formRef = ref<FormInstance>()
const editId = ref<number | undefined>(undefined)

interface ToolForm {
  displayName: string
  toolKey: string
  description: string
  groupName: string
  riskLevel: string
  permissions: string
  enabled: boolean
  paramsSchema: string
  remark: string
  method: string
  url: string
  timeoutMs: number | undefined
  headers: Record<string, string>
  query: Record<string, string>
  bodyTemplate: string
  authType: string
  bearerToken: string
  basicUsername: string
  basicPassword: string
  apiKeyHeader: string
  apiKeyValue: string
}

const defaultForm = (): ToolForm => ({
  displayName: '',
  toolKey: '',
  description: '',
  groupName: '',
  riskLevel: 'READ_ONLY',
  permissions: '',
  enabled: true,
  paramsSchema: '',
  remark: '',
  method: 'GET',
  url: '',
  timeoutMs: 5000,
  headers: {},
  query: {},
  bodyTemplate: '',
  authType: 'NONE',
  bearerToken: '',
  basicUsername: '',
  basicPassword: '',
  apiKeyHeader: '',
  apiKeyValue: ''
})

const form = ref<ToolForm>(defaultForm())
/** 哪些凭据在载入时是掩码（=已配置），提交时留空则省略、由后端回填旧值 */
const credConfigured = reactive({ bearerToken: false, basicPassword: false, apiKeyValue: false })

const isWriteMethod = computed(() => WRITE_METHODS.includes(form.value.method))

const formRules = reactive<FormRules>({
  displayName: [{ required: true, message: '展示名不能为空', trigger: 'blur' }],
  toolKey: [
    { required: true, message: '工具键不能为空', trigger: 'blur' },
    {
      validator: (_r, v, cb) => {
        if (!v) return cb()
        if (!TOOL_KEY_PATTERN.test(v)) {
          return cb(new Error('小写字母开头，仅含小写字母/数字/下划线，长度 2~64'))
        }
        cb()
      },
      trigger: 'blur'
    }
  ],
  riskLevel: [{ required: true, message: '请选择风险等级', trigger: 'change' }],
  url: [{ required: true, message: '请求地址不能为空', trigger: 'blur' }],
  method: [{ required: true, message: '请选择请求方法', trigger: 'change' }],
  authType: [{ required: true, message: '请选择鉴权方式', trigger: 'change' }]
})

/** 打开弹窗：无 id=新建；有 id 拉详情并解析 config（脱敏凭据清空 + 标记已配置） */
const open = async (id?: number, m?: 'view' | 'edit') => {
  dialogVisible.value = true
  form.value = defaultForm()
  credConfigured.bearerToken = false
  credConfigured.basicPassword = false
  credConfigured.apiKeyValue = false
  editId.value = id
  if (!id) {
    mode.value = 'create'
    return
  }
  mode.value = m === 'view' ? 'view' : 'edit'
  formLoading.value = true
  try {
    const vo = await AgentToolDefApi.getToolDef(id)
    let cfg: HttpToolConfigVO = {}
    try {
      cfg = vo.config ? (JSON.parse(vo.config) as HttpToolConfigVO) : {}
    } catch {
      cfg = {}
    }
    form.value = {
      ...defaultForm(),
      displayName: vo.displayName ?? '',
      toolKey: vo.toolKey ?? '',
      description: vo.description ?? '',
      groupName: vo.groupName ?? '',
      riskLevel: vo.riskLevel ?? 'READ_ONLY',
      permissions: vo.permissions ?? '',
      enabled: vo.enabled !== false,
      paramsSchema: vo.paramsSchema ?? '',
      remark: vo.remark ?? '',
      method: (cfg.method ?? 'GET').toUpperCase(),
      url: cfg.url ?? '',
      timeoutMs: cfg.timeoutMs ?? 5000,
      headers: cfg.headers ?? {},
      query: cfg.query ?? {},
      bodyTemplate: cfg.bodyTemplate ?? '',
      authType: (cfg.authType ?? 'NONE').toUpperCase(),
      basicUsername: cfg.basicUsername ?? '',
      apiKeyHeader: cfg.apiKeyHeader ?? ''
    }
    // 凭据：等于掩码 → 清空并标记「已配置」；否则（理论上前端拿不到明文）按原值填
    applyCred('bearerToken', cfg.bearerToken)
    applyCred('basicPassword', cfg.basicPassword)
    applyCred('apiKeyValue', cfg.apiKeyValue)
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

const applyCred = (key: 'bearerToken' | 'basicPassword' | 'apiKeyValue', val?: string) => {
  if (val === REDACTED_MASK) {
    form.value[key] = ''
    credConfigured[key] = true
  } else {
    form.value[key] = val ?? ''
    credConfigured[key] = false
  }
}

/** 组装 config：只带当前鉴权方式对应的凭据；留空且已配置的凭据键省略（后端回填） */
const buildConfig = (): string => {
  const cfg: Record<string, any> = {
    method: form.value.method,
    url: form.value.url,
    headers: form.value.headers ?? {},
    query: form.value.query ?? {},
    timeoutMs: form.value.timeoutMs,
    authType: form.value.authType
  }
  if (WRITE_METHODS.includes(form.value.method) && form.value.bodyTemplate) {
    cfg.bodyTemplate = form.value.bodyTemplate
  }
  if (form.value.authType === 'BEARER' && form.value.bearerToken) {
    cfg.bearerToken = form.value.bearerToken
  } else if (form.value.authType === 'BASIC') {
    if (form.value.basicUsername) cfg.basicUsername = form.value.basicUsername
    if (form.value.basicPassword) cfg.basicPassword = form.value.basicPassword
  } else if (form.value.authType === 'API_KEY') {
    if (form.value.apiKeyHeader) cfg.apiKeyHeader = form.value.apiKeyHeader
    if (form.value.apiKeyValue) cfg.apiKeyValue = form.value.apiKeyValue
  }
  return JSON.stringify(cfg)
}

/** 提交前的凭据完整性校验（非掩码已配置、又没重填 → 拦下，避免后端回填也救不回的空凭据） */
const validateCreds = (): string => {
  const a = form.value.authType
  if (a === 'BEARER' && !form.value.bearerToken && !credConfigured.bearerToken) return '请填写 Bearer Token'
  if (a === 'BASIC') {
    if (!form.value.basicUsername) return '请填写 Basic 用户名'
    if (!form.value.basicPassword && !credConfigured.basicPassword) return '请填写 Basic 密码'
  }
  if (a === 'API_KEY' && !form.value.apiKeyValue && !credConfigured.apiKeyValue) return '请填写 API Key 值'
  return ''
}

const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  const credErr = validateCreds()
  if (credErr) {
    message.warning(credErr)
    return
  }
  formLoading.value = true
  try {
    const payload: AgentToolDefSaveVO = {
      id: editId.value,
      toolKey: form.value.toolKey.trim(),
      displayName: form.value.displayName.trim(),
      description: form.value.description || undefined,
      source: 'HTTP',
      groupName: form.value.groupName || undefined,
      riskLevel: form.value.riskLevel,
      permissions: form.value.permissions || undefined,
      enabled: form.value.enabled,
      config: buildConfig(),
      paramsSchema: form.value.paramsSchema || undefined,
      remark: form.value.remark || undefined
    }
    if (isEdit.value && editId.value) {
      await AgentToolDefApi.updateToolDef(payload)
      message.success('修改成功')
    } else {
      await AgentToolDefApi.createToolDef(payload)
      message.success('新增成功')
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}

const onClosed = () => {
  formRef.value?.clearValidate()
}
</script>
