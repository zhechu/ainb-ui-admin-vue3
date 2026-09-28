<!--
  内置（已注册）工具在线维护弹窗（2026-09-28 增量）

  🔴 维护的是 22 个 @AgentTool 代码工具的「运维旋钮」：展示名/说明/分组/风险/权限/启用/参数说明。
     执行体与默认值仍在代码里，故这里【不能新建/删除工具】，只能覆盖已有工具的字段。
     改完【立即生效、无需重启】（网关放行、是否需用户确认、LLM 提示词全部跟随），按【当前租户】生效。

  🔴 每个字段都用 placeholder / 帮助行显示【代码默认值】，让管理员看清「自己正在覆盖什么」。
     「恢复默认」在列表页操作（删覆盖行、退回代码声明），本弹窗只管覆盖。

  🔴 安全取舍（产品决策）：允许调低风险、删空权限（放松）。放松不拦截，但后端 log.warn 留操作人 + 前后值痕迹。
     弹窗顶部 el-alert 明确提示这一点，避免管理员误以为「随便改没有后果」。
-->
<template>
  <el-dialog
    v-model="dialogVisible"
    :title="`维护内置工具 · ${toolName}`"
    width="720px"
    append-to-body
    :close-on-click-modal="false"
    @close="onClosed"
  >
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      class="mb-16px"
      title="覆盖立即生效、无需重启，且只作用于当前租户"
    >
      <div class="text-12px leading-18px">
        调低风险或删空权限属于「安全放松」：例如把不可逆的建表工具降为只读后，它将<b>不再需要用户确认</b>即可被 AI 调用。
        系统不拦截此类操作，但会记录操作人与前后值以备审计。如需退回代码默认，请在列表点「恢复默认」。
      </div>
    </el-alert>

    <el-form ref="formRef" v-loading="formLoading" :model="form" :rules="formRules" label-width="120px">
      <el-form-item label="工具名">
        <el-input :model-value="toolName" disabled />
        <div class="form-tip">工具名是代码里的身份，不可修改。</div>
      </el-form-item>
      <el-form-item label="展示名" prop="displayName">
        <el-input v-model="form.displayName" :placeholder="`留空=用工具名（${toolName}）`" />
        <div class="form-tip">代码默认：{{ toolName }}</div>
      </el-form-item>
      <el-form-item label="工具说明" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="2"
          placeholder="会进模型提示词与设计器；留空=覆盖为空说明"
        />
        <div class="form-tip">代码默认：{{ declared.description || '（空）' }}</div>
      </el-form-item>
      <el-form-item label="分组" prop="groupName">
        <el-input v-model="form.groupName" placeholder="管理页归类用，如 数据建模" />
        <div class="form-tip">代码默认：{{ declared.groupName || '（无分组）' }}</div>
      </el-form-item>
      <el-form-item label="风险等级" prop="riskLevel">
        <el-select v-model="form.riskLevel" placeholder="请选择风险等级" class="w-full">
          <el-option v-for="r in RISK_OPTIONS" :key="r.value" :label="r.label" :value="r.value">
            <span class="float-left">{{ r.label }}</span>
            <span class="float-right text-12px text-[var(--el-text-color-secondary)] ml-12px">{{ r.hint }}</span>
          </el-option>
        </el-select>
        <div class="form-tip" :class="{ 'text-[var(--el-color-danger)]': isRiskRelaxed }">
          代码默认：{{ riskLabel(declared.riskLevel) }}（{{ declared.requireConfirmHint }}）
          <span v-if="isRiskRelaxed"> · ⚠️ 当前选择低于代码默认，将放松安全约束</span>
        </div>
      </el-form-item>
      <el-form-item label="所需权限" prop="permissions">
        <el-input v-model="form.permissions" placeholder="逗号分隔的权限串；留空=调用只需登录" />
        <div class="form-tip" :class="{ 'text-[var(--el-color-danger)]': isPermissionRelaxed }">
          代码默认：{{ declared.permissions || '（无需权限）' }}
          <span v-if="isPermissionRelaxed"> · ⚠️ 当前所需权限少于代码默认，将放松安全约束</span>
        </div>
      </el-form-item>
      <el-form-item label="参数说明" prop="paramsSchema">
        <el-input
          v-model="form.paramsSchema"
          type="textarea"
          :rows="2"
          placeholder="自由文本，说明有哪些入参（进模型提示词）；留空=覆盖为空"
        />
        <div class="form-tip">代码默认：{{ declared.paramsSchema || '（空）' }}</div>
      </el-form-item>
      <el-form-item label="启用" prop="enabled">
        <el-switch v-model="form.enabled" />
        <div class="form-tip">代码默认：{{ declared.enabled ? '启用' : '停用' }}；停用后网关直接拒绝调用该工具。</div>
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="选填，记录为何这样维护" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="formLoading" @click="dialogVisible = false">取 消</el-button>
      <el-button type="primary" :loading="formLoading" @click="submitForm">保存并生效</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import type { FormInstance, FormRules } from 'element-plus'
import {
  AgentRegisteredToolApi,
  type AgentRegisteredToolUpdateVO,
  type AgentRegisteredToolVO
} from '@/api/agent/tooldef'

defineOptions({ name: 'BuiltinToolFormDialog' })

const emit = defineEmits<{ success: [] }>()
const message = useMessage()

const RISK_OPTIONS = [
  { value: 'READ_ONLY', label: '只读', hint: '只查询、不改数据（无需确认）' },
  { value: 'LOW', label: '低风险', hint: '可逆的小改动' },
  { value: 'MEDIUM', label: '中风险', hint: '会写业务数据' },
  { value: 'HIGH', label: '高风险', hint: '影响面大/较难撤销' },
  { value: 'IRREVERSIBLE', label: '不可逆', hint: '一旦执行无法撤销' }
]
const RISK_ORDER = ['READ_ONLY', 'LOW', 'MEDIUM', 'HIGH', 'IRREVERSIBLE']
const riskLabel = (risk?: string) => RISK_OPTIONS.find((r) => r.value === risk)?.label ?? risk ?? ''

const dialogVisible = ref(false)
const formLoading = ref(false)
const formRef = ref<FormInstance>()

const toolName = ref('')
/** 代码默认值（声明值），只用于回显「正在覆盖什么」 */
const declared = reactive({
  description: '',
  groupName: '',
  riskLevel: '',
  permissions: '',
  enabled: true,
  paramsSchema: '',
  requireConfirmHint: ''
})

interface BuiltinForm {
  displayName: string
  description: string
  groupName: string
  riskLevel: string
  permissions: string
  enabled: boolean
  paramsSchema: string
  remark: string
}
const defaultForm = (): BuiltinForm => ({
  displayName: '',
  description: '',
  groupName: '',
  riskLevel: 'READ_ONLY',
  permissions: '',
  enabled: true,
  paramsSchema: '',
  remark: ''
})
const form = ref<BuiltinForm>(defaultForm())

const formRules = reactive<FormRules>({
  riskLevel: [{ required: true, message: '请选择风险等级', trigger: 'change' }]
})

/** 当前选择的风险是否低于代码默认（放松） */
const isRiskRelaxed = computed(() => {
  const cur = RISK_ORDER.indexOf(form.value.riskLevel)
  const dec = RISK_ORDER.indexOf(declared.riskLevel)
  return cur >= 0 && dec >= 0 && cur < dec
})
/** 当前所需权限是否少于代码默认（放松）：把逗号串拆成集合比较 */
const isPermissionRelaxed = computed(() => {
  const split = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  const cur = split(form.value.permissions)
  const dec = split(declared.permissions)
  return cur.length < dec.length || !dec.every((p) => cur.includes(p))
})

/** 打开弹窗：直接用列表行（已含生效值 + 声明值），无需再请求详情 */
const open = (row: AgentRegisteredToolVO) => {
  dialogVisible.value = true
  toolName.value = row.toolName
  declared.description = row.declaredDescription ?? ''
  declared.groupName = row.declaredGroupName ?? ''
  declared.riskLevel = row.declaredRiskLevel ?? ''
  declared.permissions = row.declaredPermissions ?? ''
  declared.enabled = row.declaredEnabled !== false
  declared.paramsSchema = row.declaredParamsSchema ?? ''
  declared.requireConfirmHint =
    row.declaredRiskLevel && row.declaredRiskLevel !== 'READ_ONLY' ? '需用户确认' : '无需确认'
  // 表单预填【生效值】，让管理员看到当前状态
  form.value = {
    displayName: row.displayName === row.toolName ? '' : (row.displayName ?? ''),
    description: row.description ?? '',
    groupName: row.groupName ?? '',
    riskLevel: row.riskLevel || row.declaredRiskLevel || 'READ_ONLY',
    permissions: row.permissions ?? '',
    enabled: row.enabled !== false,
    paramsSchema: row.paramsSchema ?? '',
    remark: row.remark ?? ''
  }
}
defineExpose({ open })

const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  formLoading.value = true
  try {
    const payload: AgentRegisteredToolUpdateVO = {
      toolName: toolName.value,
      displayName: form.value.displayName.trim(),
      description: form.value.description,
      groupName: form.value.groupName.trim(),
      riskLevel: form.value.riskLevel,
      permissions: form.value.permissions.trim(),
      enabled: form.value.enabled,
      paramsSchema: form.value.paramsSchema,
      remark: form.value.remark
    }
    await AgentRegisteredToolApi.updateRegisteredTool(payload)
    message.success('已保存并立即生效')
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

<style lang="scss" scoped>
.form-tip {
  font-size: 11px;
  line-height: 16px;
  margin-top: 2px;
  color: var(--el-text-color-placeholder);
}
</style>
