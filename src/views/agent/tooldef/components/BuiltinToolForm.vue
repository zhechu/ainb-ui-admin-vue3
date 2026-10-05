<!--
  内置（已注册）工具在线维护面板（2026-09-29 由弹窗改页内：字段多，弹窗里要滚动，看不清全貌）

  🔴 维护的是 @AgentTool 代码工具的「运维旋钮」：展示名/说明/分组/风险/权限/启用/参数说明。
     执行体与默认值仍在代码里，故这里【不能新建/删除工具】，只能覆盖已有工具的字段。
     覆盖按【当前租户】生效，无需重启。

  🔴 但「立即生效」对各旋钮的**分量完全不同**，别一视同仁（2026-10-05 实测口径，台账 D4-22）：
     - 启用 / 所需权限：**真生效**。AgentSecurityGateway#checkTool 读的就是覆盖后的
       isEnabled() 与权限串，改完 AI 的调用当场被放行或拦下。
     - 风险等级：只改**界面上的标注**。迭代三之后运行期各道闸（V3/V11 只读校验、Planner 工具目录
       分桶、agent_loop 只读限制、沙箱 mock 判定、发布判定、变更清单）读的**全是代码【声明】的
       风险等级（getDeclaredRisk()）**，一行在线维护改不动它们。本文件这里曾写过
       「网关放行、是否需用户确认、LLM 提示词全部跟随」——【那半句已经不成立，别照着它推理】。
     - 展示名/说明/分组/参数说明：纯展示与提示词文案，无安全含义。

  🔴 每个字段都用帮助行显示【代码默认值】，让管理员看清「自己正在覆盖什么」。
     「恢复默认」在列表页操作（删覆盖行、退回代码声明），本面板只管覆盖。

  🔴 安全取舍（产品决策，迭代四 §11 A-Ⅲ）：允许调低风险、删少权限（放松），走**保留 + 审计 + 二次确认**。
     放松时先弹框把两类代价**分别**讲清（删权限=立即生效的真放松；降风险=只改标注、且会让界面与
     校验互相矛盾），点头之后才带 confirmRelax=true 提交；后端在同一事务里往
     agent_tool_override_audit 落一行（操作人 + 前后值 + 本面板填的备注）。
     未确认的放松后端直接拒（1_041_009_001），且【覆盖行与审计行都不落】。
     —— 弹框讲不清代价就只是个「确定吗？」，几次之后管理员会不看就点，二次确认当场失去意义。
-->
<template>
  <ContentWrap>
    <div class="panel-header mb-15px flex items-center justify-between">
      <div class="flex items-center">
        <el-button link @click="handleCancel">
          <Icon icon="ep:arrow-left" class="mr-5px" /> 返回
        </el-button>
        <span class="panel-title ml-8px">维护内置工具 · {{ toolName }}</span>
        <el-tag v-if="row?.overridden" type="warning" size="small" class="ml-8px">维护中</el-tag>
      </div>
      <div class="flex items-center">
        <el-button @click="handleCancel">取 消</el-button>
        <el-button type="primary" :loading="formLoading" @click="submitForm">保存并生效</el-button>
      </div>
    </div>

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      class="mb-16px"
      title="覆盖只作用于当前租户、无需重启，但各字段的分量不一样"
    >
      <div class="text-12px leading-18px">
        <b>启用</b>与<b>所需权限</b>是真闸：安全网关读的就是这两个值，改完 AI 的调用当场被放行或拦下。<br />
        <b>风险等级</b>只改界面上的标注：运行期各道闸（只读校验、发布判定、沙箱 mock 等）读的是代码
        <b>声明</b>的风险等级，所以调低风险<b>不会</b>让工具绕过发布判定、只读校验或沙箱 mock，
        只会让设计器与工具清单从此把它标成「无需确认」，而校验仍按声明值拒它。<br />
        调低风险或删少权限属于「安全放松」：保存前会弹框讲清代价，确认后落一行审计（操作人 + 前后值 + 备注）。
        如需退回代码默认，请在列表点「恢复默认」。
      </div>
    </el-alert>

    <el-form ref="formRef" :model="form" :rules="formRules" label-width="120px" class="max-w-820px">
      <el-form-item label="工具名">
        <el-input :model-value="toolName" disabled />
        <div class="form-tip">工具名是代码里的身份（模型按它调用），不可修改。</div>
      </el-form-item>
      <el-form-item label="展示名" prop="displayName">
        <el-input v-model="form.displayName" :placeholder="`留空=用代码默认（${declaredDisplayName}）`" />
        <div class="form-tip">代码默认：{{ declaredDisplayName }}；给人看的中文名，模型提示词里不用它。</div>
      </el-form-item>
      <el-form-item label="工具说明" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          placeholder="会进模型提示词与设计器；留空=覆盖为空说明"
        />
        <div class="form-tip">代码默认：{{ declared.description || '（空）' }}</div>
      </el-form-item>
      <el-form-item label="分组" prop="groupName">
        <el-select
          v-model="form.groupName"
          placeholder="管理页归类用，可下拉选也可自己输入"
          filterable
          allow-create
          default-first-option
          clearable
          class="!w-full"
        >
          <el-option v-for="g in GROUP_OPTIONS" :key="g" :label="g" :value="g" />
        </el-select>
        <div class="form-tip">代码默认：{{ declared.groupName || '（无分组）' }}</div>
      </el-form-item>
      <el-form-item label="风险等级" prop="riskLevel">
        <el-select v-model="form.riskLevel" placeholder="请选择风险等级" class="!w-full">
          <el-option v-for="r in RISK_OPTIONS" :key="r.value" :label="r.label" :value="r.value">
            <span class="float-left">{{ r.label }}</span>
            <span class="float-right text-12px text-[var(--el-text-color-secondary)] ml-12px">{{ r.hint }}</span>
          </el-option>
        </el-select>
        <div class="form-tip" :class="{ 'text-[var(--el-color-danger)]': isRiskRelaxed }">
          代码默认：{{ riskLabel(declared.riskLevel) }}（{{ declared.requireConfirmHint }}）
          <span v-if="isRiskRelaxed">
            · ⚠️ 低于代码默认（安全放松）：只改界面标注，运行期各道闸仍按【声明】风险等级判定
          </span>
        </div>
      </el-form-item>
      <el-form-item label="所需权限" prop="permissions">
        <el-input v-model="form.permissions" placeholder="逗号分隔的权限串；留空=调用只需登录" />
        <div class="form-tip" :class="{ 'text-[var(--el-color-danger)]': isPermissionRelaxed }">
          代码默认：{{ declared.permissions || '（无需权限）' }}
          <span v-if="isPermissionRelaxed">
            · ⚠️ 少了 {{ missingPermissions.join('、') }}（安全放松）：网关读的就是这份值，
            <b>立即生效</b>
          </span>
        </div>
      </el-form-item>
      <el-form-item label="参数说明" prop="paramsSchema">
        <el-input
          v-model="form.paramsSchema"
          type="textarea"
          :rows="3"
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

    <!--
      安全放松的二次确认框（迭代四 §11 A-Ⅲ：保留 + 审计 + 二次确认）

      🔴 为什么不用 message.confirm 一句话了事：那只能给出「确定吗？」，而这里的全部价值在于
         把两类放松**分别**的代价摊开给人看 —— 删权限是立即生效的真放松，降风险只改界面标注。
         混成一句「这会放松安全约束，确定吗」，管理员点几次之后就条件反射式确认了。
      🔴 为什么不用 dangerouslyUseHTMLString：正文里的权限串来自后端回显，拼 HTML 就得自己转义，
         转漏一处就是一个存储型 XSS 落在管理页上。用模板绑定天然没这个问题。
    -->
    <el-dialog
      v-model="relaxDialogVisible"
      title="本次维护会放松安全约束"
      width="640px"
      :close-on-click-modal="false"
      append-to-body
    >
      <div class="text-13px leading-20px">
        <div v-if="isRiskRelaxed" class="relax-block">
          <div class="relax-title">
            风险等级：{{ riskLabel(declared.riskLevel) }} → {{ riskLabel(form.riskLevel) }}
          </div>
          <div class="relax-body">
            这一改<b>只改界面上的标注</b>。运行期各道闸（只读校验、Planner 工具目录、agent_loop
            只读限制、沙箱 mock、发布判定、变更清单）读的都是代码<b>声明</b>的风险等级，
            一行在线维护改不动它们。<br />
            所以它<b>不会</b>让这个工具绕过发布判定或沙箱 mock；真会发生的是设计器与工具清单从此把它
            标成「无需确认」，而校验仍按声明值拒它 —— <b>界面与校验会就此互相矛盾</b>，
            用户照着界面的标注编排，会在发布时才被撞回来。
          </div>
        </div>

        <div v-if="isPermissionRelaxed" class="relax-block">
          <div class="relax-title">
            所需权限：{{ declared.permissions }} → {{ form.permissions.trim() || '（空 = 调用只需登录）' }}
          </div>
          <div class="relax-body">
            少了：<b>{{ missingPermissions.join('、') }}</b><br />
            这一改<b>立即生效</b>。安全网关逐个 AND 判定时读的就是这份维护后的权限串，
            所以<b>没有上述权限点的用户，其 AI 从此也能调用这个工具</b> ——
            界面上的按钮仍受权限点约束，AI 这条路不再受。
          </div>
        </div>

        <div class="relax-audit">
          确认后会在审计表落一行：操作人、上面这些前后值，以及你在「备注」里填的理由
          <template v-if="!form.remark.trim()">
            —— <b>当前备注为空，审计行里将没有理由，事后查不出为什么放松</b>
          </template>
          。系统不禁止放松，只要求你表态。
        </div>
      </div>
      <template #footer>
        <el-button @click="relaxDialogVisible = false">再看看</el-button>
        <el-button type="danger" :loading="formLoading" @click="confirmRelaxAndSave">
          我已知晓上述后果，确认放松并保存
        </el-button>
      </template>
    </el-dialog>
  </ContentWrap>
</template>

<script lang="ts" setup>
import type { FormInstance, FormRules } from 'element-plus'
import {
  AgentRegisteredToolApi,
  type AgentRegisteredToolUpdateVO,
  type AgentRegisteredToolVO
} from '@/api/agent/tooldef'

defineOptions({ name: 'BuiltinToolForm' })

const emit = defineEmits<{ success: []; cancel: [] }>()
const message = useMessage()

const RISK_OPTIONS = [
  { value: 'READ_ONLY', label: '只读', hint: '只查询、不改数据（无需确认）' },
  { value: 'LOW', label: '低风险', hint: '可逆的小改动' },
  { value: 'MEDIUM', label: '中风险', hint: '会写业务数据' },
  { value: 'HIGH', label: '高风险', hint: '影响面大/较难撤销' },
  { value: 'IRREVERSIBLE', label: '不可逆', hint: '一旦执行无法撤销' }
]
/**
 * 风险等级的严重度升序。
 *
 * 🔴 这是后端 {@code RiskLevel.severity} 的**第三份副本**（前两份是枚举的声明顺序与 severity 字段）。
 *    后端 {@code RiskLevelTest#severityAscendingInDeclarationOrder} 钉住了那两份一致，这一份钉不住，
 *    只能靠「谁改枚举谁同步这里」。真漂移了不会静默放过：两边判据不同向，表现要么是前端弹框而后端
 *    照收（多一次没意义的确认），要么是前端不弹而后端拒（保存失败并带明确错误文案）。
 */
const RISK_ORDER = ['READ_ONLY', 'LOW', 'MEDIUM', 'HIGH', 'IRREVERSIBLE']
const riskLabel = (risk?: string) => RISK_OPTIONS.find((r) => r.value === risk)?.label ?? risk ?? ''

/**
 * 分组下拉选项，与 @AgentTool(groupName=...) 的代码声明保持一致。
 * 🔴 用 filterable + allow-create：既让常见分组一键选中（免得手打出「数据建模」/「数据模型」两种写法），
 *    又不把管理员锁死——分组只是列表归类用的标签，加一个新分组不该改代码。
 */
const GROUP_OPTIONS = [
  '数据建模',
  '表单设计',
  '表单数据',
  '流程审批',
  '数据接口',
  '控件契约',
  '诊断排错',
  '平台手册'
]

const formLoading = ref(false)
const formRef = ref<FormInstance>()
const row = ref<AgentRegisteredToolVO>()
/** 安全放松的二次确认框可见性 */
const relaxDialogVisible = ref(false)

const toolName = computed(() => row.value?.toolName ?? '')
/** 代码声明的展示名；老工具若没声明，回落工具名（与注册表的三级回落一致） */
const declaredDisplayName = computed(() => row.value?.declaredDisplayName || toolName.value)

/** 代码默认值（声明值），只用于回显「正在覆盖什么」 */
const declared = reactive({
  displayName: '',
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

/** 逗号权限串 → 去空白、【去重】数组。必须去重，理由见 missingPermissions */
const splitPermissions = (raw: string) => {
  const out: string[] = []
  for (const item of raw.split(',')) {
    const p = item.trim()
    if (p && !out.includes(p)) {
      out.push(p)
    }
  }
  return out
}

/**
 * 代码默认里有、而本次提交里没有的权限点。空数组 = 未放松。
 *
 * 🔴 判据必须与后端 {@code AgentToolOverrideServiceImpl#detectRelaxation} 对齐 —— 那边是
 *    {@code !newPermissions.containsAll(declaredPermissions)}，且两边都先去重。差一半就会出两种坏结果：
 *    前端弹框、后端认为没放松 ⟹ 管理员为一次**并未发生**的放松点了头；或前端不弹、后端拒
 *    （1_041_009_001）⟹ 保存失败而界面上看不出为什么。所以这里只写 containsAll 的反面，
 *    不再附加「长度更短」那条：去重之后它是前者的必然推论，写上去只会在有人漏了去重时把判据拽歪
 *    （{@code a,a} → {@code a} 长度变短，但一个权限点都没少）。
 */
const missingPermissions = computed(() => {
  const current = splitPermissions(form.value.permissions)
  return splitPermissions(declared.permissions).filter((p) => !current.includes(p))
})
/** 当前所需权限是否少于代码默认（放松） */
const isPermissionRelaxed = computed(() => missingPermissions.value.length > 0)

/** 打开面板：直接用列表行（已含生效值 + 声明值），无需再请求详情 */
const open = (target: AgentRegisteredToolVO) => {
  row.value = target
  declared.displayName = target.declaredDisplayName ?? ''
  declared.description = target.declaredDescription ?? ''
  declared.groupName = target.declaredGroupName ?? ''
  declared.riskLevel = target.declaredRiskLevel ?? ''
  declared.permissions = target.declaredPermissions ?? ''
  declared.enabled = target.declaredEnabled !== false
  declared.paramsSchema = target.declaredParamsSchema ?? ''
  declared.requireConfirmHint =
    target.declaredRiskLevel && target.declaredRiskLevel !== 'READ_ONLY' ? '需用户确认' : '无需确认'
  // 表单预填【生效值】，让管理员看到当前状态
  form.value = {
    // 🔴 展示名必须和其余六个字段一样预填生效值，不能拿「生效值 === 声明值」判成未维护就清空：
    //    代码声明展示名现在都是中文，未维护时生效值恰好恒等于声明值，那条判断对全部内置工具都成立，
    //    结果是点「维护」进来展示名永远空白。况且保存本表单必然会落一条覆盖行（isOverridden 的语义
    //    就是「有行即已维护，哪怕值与代码相同」），清空展示名根本挡不住覆盖行，只是让管理员看不到当前值。
    //    清空输入框 = 不覆盖、回落代码默认，这条语义由 placeholder 与后端三级回落保证，仍然成立。
    displayName: target.displayName ?? '',
    description: target.description ?? '',
    groupName: target.groupName ?? '',
    riskLevel: target.riskLevel || target.declaredRiskLevel || 'READ_ONLY',
    permissions: target.permissions ?? '',
    enabled: target.enabled !== false,
    paramsSchema: target.paramsSchema ?? '',
    remark: target.remark ?? ''
  }
  nextTick(() => formRef.value?.clearValidate())
  // 🔴 关掉上一个工具遗留的确认框：面板是复用的，不关就会「点开 B 工具、弹的是 A 工具的放松确认」，
  //    而那个框上的「确认」会带着 B 的表单值提交。
  relaxDialogVisible.value = false
}
defineExpose({ open })

const handleCancel = () => emit('cancel')

const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  // 🔴 放松要先表态再提交。后端在未确认时直接拒（1_041_009_001）且【覆盖行与审计行都不落】，
  //    所以这里 return 掉不会留下半个状态；前端这一层的全部作用是把代价讲清楚再让人点头。
  if (isRiskRelaxed.value || isPermissionRelaxed.value) {
    relaxDialogVisible.value = true
    return
  }
  await save(false)
}

/** 二次确认框里点「确认放松」：同一个 save，只是带上 confirmRelax */
const confirmRelaxAndSave = async () => {
  relaxDialogVisible.value = false
  await save(true)
}

const save = async (confirmRelax: boolean) => {
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
    // 🔴 只在真放松时带上这个字段。恒发 true 会让后端那道闸形同虚设 ——
    //    闸的意义是「这次提交的放松是操作人看过代价之后点的头」，而不是「前端说没事」。
    if (confirmRelax) {
      payload.confirmRelax = true
    }
    await AgentRegisteredToolApi.updateRegisteredTool(payload)
    message.success(
      confirmRelax ? '已保存并生效，本次放松已记入审计' : '已保存并立即生效'
    )
    emit('success')
  } finally {
    formLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.panel-title {
  font-size: 15px;
  font-weight: 600;
}

.form-tip {
  font-size: 11px;
  line-height: 16px;
  margin-top: 2px;
  color: var(--el-text-color-placeholder);
}

.relax-block {
  padding: 8px 10px;
  margin-bottom: 10px;
  border-left: 3px solid var(--el-color-danger);
  background-color: var(--el-fill-color-light);
}

.relax-title {
  font-weight: 600;
  margin-bottom: 4px;
}

.relax-body {
  font-size: 12px;
  line-height: 18px;
  color: var(--el-text-color-regular);
}

.relax-audit {
  font-size: 12px;
  line-height: 18px;
  color: var(--el-text-color-secondary);
}
</style>
