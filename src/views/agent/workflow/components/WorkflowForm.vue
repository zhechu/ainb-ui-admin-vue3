<!--
  流程编排「新增 / 编辑元信息」页内面板 —— AI助手 流程编排优化 / Req 2（新增与设计分开）
  2026-09-29 由 640px 弹窗改为页内面板，与工具管理（views/agent/tooldef）同一套范式。

  🔴 为什么页内：这个表单最坏情况（webhook + 内联经典案例卡）有十来项，每项还带 1~3 行说明，
     640px 弹窗里必须滚动，管理员看不见「上面填了什么、下面要填什么」。页内面板随页面自然滚动，
     经典案例卡也能完整摊开。面板与列表是同级的条件渲染，URL 不变、不加路由。

  仿 views/agent/tooldef/components/ToolDefForm.vue 的 open()/submitForm/emit('success'|'cancel') 约定。
  · 新增：收集 名称 + 编码 + 触发方式 + 模板起步（经典案例/空白/复制已有）→ buildStarterDsl 产合法 DSL → createDef 建草稿，
    emit('success', id, true) 让列表页跳整页设计器（设计归设计器，本面板只管元信息）。
    🔴 **S5-f 起「复制已有」不再由本面板建流程**（修 G11）：选中它之后面板只剩「复制来源」一格，
    点「下一步」把用户交给 `WorkflowCopyDialog` —— 复制品的 DSL 只能由服务端 `/copy` 从源定义读出来再改写，
    前端深拷一份就是 G11 的形状（建表名/表单 code/BPM key/webhook path 会与源流程抢同一份不可逆资源，而发布期一个都不报）。
    明细见 `isCopy` 与 `submitForm` 的注释。
    Req 3：面板内联展示「当前触发方式的经典案例」（场景/走向/触发怎么填/要点 + 起步 DSL），
    选「经典案例」模板时建出来的就是它；全部五种见列表页工具栏的「触发案例」按钮。
  · 编辑：只改元信息 + 触发方式（编码只读），画布节点原样保留——getDef 取完整 DSL 后 injectTrigger 只换 trigger 块，
    emit('success', id, false) 仅刷新列表（不跳设计器，那是「设计」按钮的事）。

  🔴 触发方式写进 DSL 的 trigger 块（后端 WorkflowTriggerExtractor 只认它，且 createDef/updateDef 落库前 fail-close 校验）。
  深层格式（cron 合法性 / webhook path 字符集）由后端权威校验，报错文案经 axios 拦截器直接 toast 给用户。
-->
<template>
  <ContentWrap>
    <div class="panel-header mb-15px flex items-center justify-between">
      <div class="flex items-center">
        <el-button link @click="handleCancel">
          <Icon icon="ep:arrow-left" class="mr-5px" /> 返回
        </el-button>
        <span class="panel-title ml-8px">{{ panelTitle }}</span>
      </div>
      <div class="flex items-center">
        <el-button @click="handleCancel">取 消</el-button>
        <!--
          🔴 复制档的按钮文案换成「下一步」：它**不建流程**，只是把用户交给复制对话框。
          还叫「确 定」的话，点完弹出一个还要再填一次的对话框，看起来就像第一次点击失败了。
        -->
        <el-button type="primary" :loading="formLoading" data-testid="form-submit" @click="submitForm">
          {{ isCopy ? '下一步：填新编码' : '确 定' }}
        </el-button>
      </div>
    </div>

    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="100px"
      class="max-w-760px mx-auto"
    >
      <!--
        🔴 S5-f：选「复制已有」时这两格**整块不渲染**，而不是留着让它被忽略。
        复制走服务端 /copy，新编码与新名称由复制对话框问（那里还带实时查重）；
        面板上再摆一份同名的格子，就是「填了不生效」——本平台头号缺陷形态。
      -->
      <template v-if="!isCopy">
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
      </template>

      <!-- 模板起步：仅新增时出现 -->
      <el-form-item v-if="!isUpdate" label="起步模板" prop="template">
        <el-radio-group v-model="formData.template">
          <el-radio value="case">经典案例</el-radio>
          <el-radio value="blank">空白</el-radio>
          <el-radio value="copy">复制已有</el-radio>
        </el-radio-group>
        <div class="form-tip">
          经典案例：按下面选的触发方式生成一份完整可跑的流程（推荐，开箱可过体检）；空白：空画布从零开始；复制已有：以现有流程为起点。
        </div>
      </el-form-item>
      <el-form-item v-if="isCopy" label="复制来源" prop="copySourceId">
        <el-select
          v-model="formData.copySourceId"
          filterable
          clearable
          class="w-full"
          placeholder="选择一条现有流程作为起点"
          data-testid="copy-source-select"
        >
          <el-option
            v-for="item in copyOptions"
            :key="item.id"
            :label="`${item.name || item.code}（v${item.version}）`"
            :value="item.id"
          />
        </el-select>
        <div class="form-tip">
          点「下一步：填新编码」进入复制对话框：在那里填新编码 / 新名称（带实时查重），复制完成会逐格列出
          服务端替你改写了哪些会撞车的配置。描述沿用源流程。
        </div>
      </el-form-item>

      <!--
        🔴 S5-f：以下到「描述」为止的每一项都带 `!isCopy` 闸门（共 7 处，改动时一起改）。
        复制走服务端 /copy，触发方式**原样从源流程带走**（webhook path 与 webhook secret 会被改写并逐格回显，
        cron 与 form_event.formCode 刻意不改但照样回显，见 WorkflowCopyRewriter#rewriteTrigger）；
        描述沿用源流程。留着这些格子就等于让人填一份**不会被使用**的配置。
      -->
      <el-form-item v-if="!isCopy" label="触发方式" prop="triggerType">
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

      <!-- chat：绑定 Agent（选填）。Req 1：手填 code 改下拉——手填既容易打错字，也让人不知道有哪些可填 -->
      <el-form-item v-if="!isCopy && formData.triggerType === 'chat'" label="驱动 Agent" prop="agentId">
        <el-select
          v-model="formData.agentId"
          class="w-full"
          filterable
          clearable
          allow-create
          default-first-option
          :loading="agentLoading"
          placeholder="选择已发布的智能体；留空 = 仅手动运行"
        >
          <el-option v-for="item in agentOptions" :key="item.code" :label="item.label" :value="item.code" />
        </el-select>
        <div class="form-tip">
          只列「已发布」的智能体——草稿/停用在对话入口本就选不到，绑了也不会生效。找不到目标请先到「智能体管理」发布它。
        </div>
      </el-form-item>

      <!-- form_event：表单编码 + 事件类型（必填） -->
      <template v-if="!isCopy && formData.triggerType === 'form_event'">
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
      <el-form-item v-if="!isCopy && formData.triggerType === 'schedule'" label="Cron 表达式" prop="cron">
        <el-input v-model="formData.cron" clearable placeholder="Spring 6 段格式，例如 0 0 2 * * ?（每天 2 点）" />
      </el-form-item>

      <!-- webhook：path + authType + secret -->
      <template v-if="!isCopy && formData.triggerType === 'webhook'">
        <el-form-item label="入站 Path" prop="path">
          <el-input v-model="formData.path" clearable placeholder="字母/数字/下划线/连字符，1~64 位，例如 order_hook" />
          <div class="form-tip">发布后入站地址为 POST /admin-api/agent/webhook/{path}。</div>
        </el-form-item>
        <el-form-item label="鉴权方式" prop="authType">
          <el-select v-model="formData.authType" class="w-full">
            <el-option label="HMAC-SHA256 签名" value="hmac" />
            <el-option label="静态令牌 Token" value="token" />
          </el-select>
          <!--
            🔴 这里原来还有第三项「无（仅靠不可猜的 path）」，已删除：那句 label 是假话。
            path 是作者手填的一格，平台不生成随机串，而且它会进日志、进前端 URL、进浏览器历史与代理缓存；
            而免签的 hook 会以**发布者身份**把请求体一路灌进 state → prompt → BPM formVars。
            后端两处同族拦截：WorkflowTriggerExtractor（落库前拒）、AgentWebhookTriggerServiceImpl（入站一律拒）。
          -->
          <div class="form-tip">
            入站接口免登录，故必须验签：hmac 校验请求头 X-Webhook-Signature（对原始请求体做 HMAC-SHA256
            的十六进制串，可带 sha256= 前缀）；token 校验 X-Webhook-Token 与密钥是否一致。
          </div>
        </el-form-item>
        <el-form-item label="验签密钥" prop="secret">
          <el-input v-model="formData.secret" clearable placeholder="必填：调用方据此签名 / 携带令牌" show-password />
        </el-form-item>
      </template>

      <!--
        Req 3：当前触发方式的经典案例，内联展示在表单里。改页内面板后有整页高度可用，
        起步 DSL 折叠展开也不会再把表单挤到要滚动。全部五种见列表页工具栏的「触发案例」按钮。
      -->
      <el-form-item v-if="currentCase && !isCopy" label="经典案例" class="!mb-8px">
        <div class="case-box" data-testid="trigger-case-inline">
          <TriggerCaseView :case-data="currentCase" :show-dsl="!isUpdate" />
          <div class="form-tip case-box__foot">
            全部五种触发方式的案例见列表页右上角「触发案例」按钮。
          </div>
        </div>
      </el-form-item>

      <el-form-item v-if="!isCopy" label="描述" prop="description">
        <el-input
          v-model="formData.description"
          type="textarea"
          :rows="2"
          maxlength="500"
          show-word-limit
          placeholder="选填，写清这条流程解决什么问题、由什么触发"
        />
      </el-form-item>
    </el-form>

    <!--
      🔴 S5-f：复制的**唯一**实现是这个对话框（列表页操作列、设计器只读 banner 各自托管的也是同一个组件）。
      面板不再自己调 /copy —— 那样就得把 `rewritten[]` 清单再渲染一遍，而同一个语义写两份必然漂（D7）；
      更要紧的是 /copy 全程不跑 validateDsl，那份清单是「复制品可能压根发不出去」的唯一信号，少一处宿主就少一处能看见。
      ⚠️ 本面板与列表是**同级条件渲染**（列表页 `v-else-if="viewMode === 'form'"`）：面板在显示时，
         列表页托管的那份对话框**不在 DOM 里** ⟹ 这里必须自带一份，不能指望复用宿主的 ref。
    -->
    <WorkflowCopyDialog ref="copyRef" @success="onCopied" @design="onCopyDesign" />
  </ContentWrap>
</template>

<script lang="ts" setup>
import { AgentWorkflowApi, type AgentWorkflowDefVO } from '@/api/agent/workflow'
import { AgentDefApi } from '@/api/agent/def'
import { CODE_PATTERN } from '../editor/defaults'
import {
  buildStarterDsl,
  injectTrigger,
  type StarterTemplate,
  type WorkflowTriggerMeta,
  type WorkflowTriggerType
} from '../editor/starterDsl'
import { TRIGGER_CASE_ORDER, triggerCaseOf, TRIGGER_TYPE_LABELS } from '../editor/triggerCases'
import TriggerCaseView from '../editor/components/TriggerCaseView.vue'
import WorkflowCopyDialog from './WorkflowCopyDialog.vue'

defineOptions({ name: 'AgentWorkflowForm' })

const message = useMessage()
const formLoading = ref(false)
const formType = ref<'create' | 'update'>('create')
const formRef = ref()

const isUpdate = computed(() => formType.value === 'update')
const panelTitle = computed(() => (isUpdate.value ? '编辑流程信息' : '新增流程'))

/** 触发方式下拉：中文名单一来源在 triggerCases.ts（列表页与案例弹窗共用同一份，不会各叫各的） */
const TRIGGER_OPTIONS: { value: WorkflowTriggerType; label: string }[] = TRIGGER_CASE_ORDER.map((value) => ({
  value,
  label: TRIGGER_TYPE_LABELS[value]
}))

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
}

const defaultFormData = (): WorkflowFormData => ({
  id: undefined,
  name: '',
  code: '',
  // 默认「经典案例」：新用户建出来的第一条流程就是完整可跑、能过体检的，而不是一张空画布
  template: 'case',
  copySourceId: undefined,
  triggerType: 'chat',
  agentId: '',
  formCode: '',
  eventType: 'create',
  cron: '',
  path: '',
  // 🔴 缺省 hmac（原来缺省 'none' 不鉴权，该档已从平台删除，见模板里那段注释）
  authType: 'hmac',
  secret: '',
  description: ''
})
const formData = ref<WorkflowFormData>(defaultFormData())

/** 当前触发方式对应的经典案例（Req 3）；认不出的触发方式返回 undefined → 内联卡片整块不渲染 */
const currentCase = computed(() => triggerCaseOf(formData.value.triggerType))

/**
 * 「复制已有」这一档（S5-f）。
 *
 * 🔴 它改变的不是某几格的显隐，而是**这个面板还负不负责建流程**：复制一律交给 `WorkflowCopyDialog`
 *    （它调服务端 `/copy`、做实时查重、并逐格回显 `rewritten[]` 改写清单），面板只负责「从哪条复制」。
 *    所以名称 / 编码 / 触发方式 / 经典案例 / 描述在复制档**全部不渲染** —— 留着就是让人填一份不会被使用的配置，
 *    正是本平台头号缺陷形态「配了不生效且无提示」。
 * 🔴 必须带 `!isUpdate`：编辑态压根不显示「起步模板」单选，`formData.template` 只是 `defaultFormData` 的残留值。
 */
const isCopy = computed(() => !isUpdate.value && formData.value.template === 'copy')

/** 编辑态：缓存既有完整 DSL（列表分页不带 dsl），提交时只换 trigger 块、保留画布节点 */
const existingDsl = ref('')
/** 复制来源候选（新增 + copy 模板时用） */
const copyOptions = ref<AgentWorkflowDefVO[]>([])
/** 「驱动 Agent」下拉候选（Req 1）：已发布智能体，按 code 去重（同 code 多版本只该出现一次） */
const agentOptions = ref<{ code: string; label: string }[]>([])
const agentLoading = ref(false)

/**
 * 拉「已发布」智能体作为驱动 Agent 候选。
 * 🔴 只取 PUBLISHED：草稿/停用在对话入口本就选不到，列出来只会让人绑一个不生效的 Agent。
 * 🔴 需求10：还要剔掉系统内置行（默认平台助手）。chatflow 反查只在「选了 Agent」时才按 agentCode 跑，
 *    未选 Agent 的对话压根不查这张表——把流程绑到 platform_assistant 上，它永远不会被触发。
 * 🔴 fail-soft：拉不到就空列表，下拉仍可 allow-create 手填 code，不该挡住新建流程。
 */
const loadAgentOptions = async () => {
  if (agentOptions.value.length) return
  agentLoading.value = true
  try {
    const data = await AgentDefApi.getDefPage({ pageNo: 1, pageSize: 100, status: 'PUBLISHED' })
    const seen = new Set<string>()
    agentOptions.value = (data.list ?? []).filter((a) => {
      if (a.builtin || !a.code || seen.has(a.code)) return false
      seen.add(a.code)
      return true
    }).map((a) => ({ code: a.code, label: `${a.name || a.code}（${a.code}）` }))
  } catch {
    agentOptions.value = []
  } finally {
    agentLoading.value = false
  }
}

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
    if (!d.secret?.trim()) {
      return callback(new Error('必须填写验签密钥（webhook 已不支持不鉴权）'))
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

/** 收集面板字段 → 触发元信息 */
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
        secret: d.secret.trim()
      }
    default:
      return { type: 'none' }
  }
}

/** 从既有 DSL 的 trigger 块反解出面板字段（编辑态回显当前触发配置） */
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
      // 🔴 存量 DSL 可能写着 authType:'none'（该档已删）或压根没这一格。这里归一到 hmac：
      // 下拉里已经没有 'none' 这一项，不归一的话 el-select 会把裸值当 label 显示，作者看不出自己配错了；
      // 归一后 secret 为空 → validateTrigger 挡住提交，逼作者补上密钥，正是这条流程该走的补救路径
      const auth = String(config.authType ?? '')
        .trim()
        .toLowerCase()
      formData.value.authType = auth === 'token' ? 'token' : 'hmac'
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
  formData.value = defaultFormData()
  existingDsl.value = ''
  listDirty.value = false
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
        description: full.description ?? ''
      }
      applyTriggerFromDsl(existingDsl.value)
    } finally {
      formLoading.value = false
    }
  } else {
    loadCopyOptions()
  }
  // 驱动 Agent 候选两态都拉：默认触发方式就是 chat，且编辑态也要能把已绑 code 显示成「名称（code）」
  loadAgentOptions()
  nextTick(() => formRef.value?.clearValidate())
}
defineExpose({ open })

const emit = defineEmits<{ success: [id: number | undefined, isCreate: boolean]; cancel: [] }>()

/** 复制对话框（S5-f）：面板自带一份，理由见模板尾部那段注释 */
const copyRef = ref()
/**
 * 复制已落库、但用户还没决定去不去设计器。
 *
 * 🔴 这一格是必需的：宿主的 `backToList`（列表页「返回/取消」的处理器）**故意不重新拉数据**，
 *    因为在本刀之前「面板取消 = 库里什么都没变」成立；而复制确实往库里加了一行草稿。
 *    不记这一笔，用户读完清单点「返回」看到的还是旧列表 —— 刚复制出来的那条不在里面，
 *    形状上等同于「复制没成功」，而这正是本平台头号缺陷形态。
 */
const listDirty = ref(false)
const onCopied = () => {
  listDirty.value = true
}
/** 「去设计器完善」：与新增成功同一条出路（宿主收起面板 + 刷新列表 + 跳整页设计器） */
const onCopyDesign = (id: number) => emit('success', id, true)

const handleCancel = () => {
  // 复制过就走 success 分支：它同样收起面板，但**会**重新拉一次列表（见 listDirty 的注释）。
  // 🔴 不能在对话框 emit success 的当下就发出去：那会立刻卸载本面板，把还挂在它下面的对话框
  //    连同那份**取不回来第二次**的改写清单一起销毁。
  if (listDirty.value) {
    emit('success', undefined, false)
    return
  }
  emit('cancel')
}

const submitForm = async () => {
  if (!(await formRef.value?.validate())) return
  const d = formData.value
  const template = d.template

  // 🔴 S5-f 复制档：面板到此为止，剩下的（新编码/新名称/实时查重/调 /copy/回显改写清单）全在复制对话框里。
  //    · 刻意放在 validate **之后**：「复制来源」那格的必填红字要靠 validate 才显示得出来；
  //    · 刻意**不进** formLoading：这一步一个请求都不发，转圈会让人以为正在建流程；
  //    · 刻意用 `template === 'copy'` 而不是 `isCopy`：这样 TS 才能把下面 buildStarterDsl 的入参
  //      收窄成 BuildableTemplate —— 那条类型就是 G11 前端半边的编译期强制点，绕过去等于把它删了。
  //      （编辑态不需要额外排除：那里 template 恒为 defaultFormData 的 'case'。）
  if (template === 'copy') {
    const src = copyOptions.value.find((o) => o.id === d.copySourceId)
    if (!src) return
    copyRef.value?.open({ id: src.id, code: src.code, name: src.name })
    return
  }

  formLoading.value = true
  try {
    const trigger = collectTrigger()
    if (isUpdate.value) {
      // 编辑：只换 trigger 块，保留既有画布节点（existingDsl 来自 getDef 的完整 DSL）
      const dsl = injectTrigger(existingDsl.value, trigger)
      await AgentWorkflowApi.updateDef({
        id: d.id,
        code: d.code,
        name: d.name,
        dsl,
        description: d.description
      })
      message.success('保存成功')
      emit('success', d.id, false)
      return
    }

    // 新增：按模板 + 触发方式构造起步 DSL（🔴 只剩 blank/case 两档；复制走服务端 /copy，见 starterDsl.ts）
    const starterDsl = buildStarterDsl(template, {
      code: d.code,
      name: d.name,
      description: d.description,
      trigger
    })
    const id = await AgentWorkflowApi.createDef({
      code: d.code,
      name: d.name,
      dsl: starterDsl,
      description: d.description
    })
    message.success('新建成功（草稿）')
    emit('success', id, true)
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
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

/* 经典案例内联卡：与表单控件同宽，浅底 + 细边把它和输入项区分开，别让人误以为是必填字段 */
.case-box {
  width: 100%;
  padding: 10px 12px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.case-box__foot {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
}
</style>
