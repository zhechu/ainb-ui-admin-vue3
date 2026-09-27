<!--
  Workflow 定义 新建/编辑表单（增量8 / P4 第二刀）

  把第一刀已交付但「无前端调用方」的后端 create/update 端点接起来：
  编排者可在此新建一份草稿定义、或修改已有草稿（code 只读），并借助 CodeEditor(Monaco) 编辑 DSL JSON。

  🔴 有界：这是「JSON 原文 + 校验 + 只读预览」的表单，不是拖拽式可视化编辑器（节点配置面板/连线拖拽是 P4 后续刀）。
  🔴 保存是「软门禁」：草稿允许不完整（WIP），但保存前会自动跑一次后端双层校验；有阻断错误时二次确认才落库，
     避免手滑存坏。是否发布是列表页的独立动作（publishDef），发布前可再次校验。
  🔴 仅 DRAFT 可编辑：非草稿行不会在列表页出现「编辑」入口，后端 updateDef 也会对非 DRAFT 抛 WORKFLOW_DEF_NOT_DRAFT。
  🔴 预览复用只读画布 WorkflowCanvasDialog.openDsl：渲染当前「未保存」的 DSL，与查看已存流程同一套布局逻辑。
-->
<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="900px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="88px" v-loading="loading">
      <el-form-item label="流程编码" prop="code">
        <el-input
          v-model="formData.code"
          :disabled="isEdit"
          placeholder="小写字母开头，仅含小写字母/数字/下划线，如 wf_order_follow"
        />
        <div v-if="isEdit" class="text-12px text-[var(--el-text-color-secondary)] mt-2px leading-16px">
          编码不可修改（改编码等于换一条流程）；DSL 内的 id 建议与之保持一致。
        </div>
      </el-form-item>
      <el-form-item label="流程名称" prop="name">
        <el-input v-model="formData.name" placeholder="请输入流程名称" />
      </el-form-item>
      <el-form-item label="描述" prop="description">
        <el-input v-model="formData.description" type="textarea" :rows="2" placeholder="选填" maxlength="500" show-word-limit />
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="formData.remark" type="textarea" :rows="2" placeholder="选填" maxlength="500" show-word-limit />
      </el-form-item>
      <el-form-item label="DSL" prop="dsl">
        <div class="w-full">
          <div class="flex items-center justify-between mb-6px w-full">
            <span class="text-12px text-[var(--el-text-color-secondary)]">
              Workflow DSL v1 JSON 原文。保存前会自动校验，也可随时手动「校验」或「预览画布」。
            </span>
            <div class="flex-shrink-0">
              <el-button size="small" @click="handleValidate" :loading="validating">
                <Icon icon="ep:circle-check" class="mr-4px" />校验DSL
              </el-button>
              <el-button size="small" @click="handlePreview">
                <Icon icon="ep:view" class="mr-4px" />预览画布
              </el-button>
              <el-button size="small" type="primary" plain @click="handleVisualEdit">
                <Icon icon="ep:edit" class="mr-4px" />可视化编辑
              </el-button>
            </div>
          </div>
          <CodeEditor
            v-model="formData.dsl"
            language="json"
            height="340px"
            :placeholder="DSL_PLACEHOLDER"
          />
          <!-- 校验结果（结构化 errors/warnings，直接展示后端返回的「怎么改」文案） -->
          <div v-if="validateResult" class="mt-8px w-full">
            <el-alert
              v-if="validateResult.passed && !validateResult.warnings.length"
              title="校验通过：结构合法，可作为可执行流程发布"
              type="success"
              :closable="false"
              show-icon
            />
            <template v-else>
              <el-alert
                v-if="validateResult.errors.length"
                type="error"
                :closable="false"
                show-icon
                class="mb-6px"
              >
                <template #title>校验未通过：{{ validateResult.errors.length }} 个必须修正的错误</template>
                <ul class="pl-18px mb-0 mt-2px">
                  <li v-for="(e, i) in validateResult.errors" :key="i" class="text-12px leading-20px">{{ e }}</li>
                </ul>
              </el-alert>
              <el-alert v-if="validateResult.warnings.length" type="warning" :closable="false" show-icon>
                <template #title>
                  {{ validateResult.errors.length ? '另有' : '校验通过，但有' }}
                  {{ validateResult.warnings.length }} 条建议调整（不阻断保存）
                </template>
                <ul class="pl-18px mb-0 mt-2px">
                  <li v-for="(w, i) in validateResult.warnings" :key="i" class="text-12px leading-20px">{{ w }}</li>
                </ul>
              </el-alert>
            </template>
          </div>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSubmit" :loading="submitting">保存草稿</el-button>
    </template>

    <!-- 预览画布：复用只读画布，渲染当前未保存的 DSL -->
    <WorkflowCanvasDialog ref="canvasRef" />

    <!-- 可视化编辑：把当前未保存的 DSL 交给可交互画布，编辑后 apply 回写 formData.dsl -->
    <WorkflowEditorDialog ref="editorRef" @apply="onEditorApply" />
  </el-dialog>
</template>

<script lang="ts" setup>
import { CodeEditor } from '@/components/CodeEditor'
import {
  AgentWorkflowApi,
  type AgentWorkflowDefSaveVO,
  type AgentWorkflowDefVO,
  type AgentWorkflowDefValidateVO
} from '@/api/agent/workflow'
import WorkflowCanvasDialog from './WorkflowCanvasDialog.vue'
import WorkflowEditorDialog from './WorkflowEditorDialog.vue'

defineOptions({ name: 'WorkflowDefFormDialog' })

const emit = defineEmits(['success'])
const message = useMessage()

const visible = ref(false)
const loading = ref(false)
const validating = ref(false)
const submitting = ref(false)
const isEdit = ref(false)
const formRef = ref()
const canvasRef = ref()
const editorRef = ref()
const validateResult = ref<AgentWorkflowDefValidateVO>()

const DSL_PLACEHOLDER = '{\n  "id": "wf_demo",\n  "nodes": [ ... ],\n  "edges": [ ... ]\n}'

/**
 * 新建时的最小骨架：START→tool→END，开箱即可通过双层校验，降低「从零手写 JSON」的门槛。
 * 🔴 tool 节点用只读工具 data_interface_list（已注册）+ 声明好 outputVar 对应的变量，
 * 这样深层干跑（buildStateGraph）能建图成功、且不产 warning——用户点「校验DSL」直接看到「校验通过」。
 * trigger 用 trigger.chat（与既有已发布定义同构），createDef 落库时 WorkflowTriggerExtractor 能正常投影。
 *
 * 🔴 增量12 / slice-3c——「工作流驱动的 Agent」两个约定（接线 DSL 预留的 trigger.chat）：
 *  ① trigger.chat.config.agentId：填要驱动的 Agent 的<b>编码 code</b>（非数字 id）。发布后，用户在该 Agent 的
 *     聊天窗口每发一句话，都会把这句话写进 input 变量、跑一遍本流程，而不是走直连大模型。
 *     <b>留空 = 仅手动运行</b>（不绑定任何 Agent，与既有行为一致）。
 *  ② output 变量：流程跑完后，聊天回复取 state 里的 `output`（约定键，与固定的输入键 `input` 对称）。
 *     想让 Agent 在聊天里回什么，就把最终文本写进 `output`（例如再加一个 llm/模板节点，outputVar 指向 output）。
 *     没写 output 不会报错，聊天里会回落一句「流程已执行完成，但未产出文本回复」的提示。
 *
 * 🔴 增量14c / P6——webhook 触发器（外部系统 HTTP 回调拉起流程）。要用它，把上面的 trigger 换成：
 *     trigger: { type: 'trigger.webhook', config: { path: 'order_hook', authType: 'hmac', secret: '<随机密钥>' } }
 *  ① path：入站 URL 的键，只能是字母/数字/下划线/连字符（1~64 位、不含斜杠或点）。发布后入站地址为
 *     POST /admin-api/agent/webhook/{path}，调用方须带标准 `tenant-id` 头定位租户。
 *  ② authType：none（仅靠不可猜的 path）/ hmac（对原始请求体算 HMAC-SHA256）/ token（静态令牌）。缺省 none。
 *     选 hmac/token 时 secret 必填——发布时会校验，缺失直接拒发布。
 *  ③ 调用方所带的头：hmac → `X-Webhook-Signature: <对请求体的 HMAC-SHA256 十六进制，可带 sha256= 前缀>`；
 *     token → `X-Webhook-Token: <令牌>`。验签 fail-close：缺失或不符一律拒。
 *  ④ 请求体建议为 JSON 对象，其字段即工作流 `input` 变量的键（作者用 `input.字段名` 取）；非 JSON 体则包进 `input.raw`。
 *  注意：secret 会随 DSL 一起版本化、并对持有「流程编排」查看权者可见——如需更强的密钥托管（独立密钥库、轮换），记后续。
 */
const DEFAULT_DSL = JSON.stringify(
  {
    dslVersion: '1.0',
    id: 'wf_demo',
    name: '示例流程',
    description: '请按需修改节点与连线',
    // agentId 留空=仅手动运行；填某个已发布 Agent 的 code，则该 Agent 的聊天由本流程驱动（见上方注释①）
    trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: '' } },
    variables: [
      { key: 'input', type: 'string', merge: 'replace', required: false },
      { key: 'listOut', type: 'object', merge: 'replace' },
      // 聊天回复约定键：把流程最终要回给用户的文本写进 output（见上方注释②）
      { key: 'output', type: 'string', merge: 'replace' }
    ],
    nodes: [
      {
        id: 'step_1',
        type: 'tool',
        name: '示例工具节点',
        config: { toolId: 'data_interface_list', args: { keyword: 'demo', limit: 10 }, outputVar: 'listOut' }
      }
    ],
    edges: [
      { from: 'START', to: 'step_1' },
      { from: 'step_1', to: 'END' }
    ],
    settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
  },
  null,
  2
)

const emptyForm = (): AgentWorkflowDefSaveVO => ({
  code: '',
  name: '',
  dsl: '',
  description: '',
  remark: ''
})
const formData = ref<AgentWorkflowDefSaveVO>(emptyForm())

const formRules = reactive({
  code: [
    { required: true, message: '流程编码不能为空', trigger: 'blur' },
    {
      pattern: /^[a-z][a-z0-9_]{1,63}$/,
      message: '小写字母开头，仅含小写字母/数字/下划线，长度 2~64',
      trigger: 'blur'
    }
  ],
  name: [{ required: true, message: '流程名称不能为空', trigger: 'blur' }],
  dsl: [{ required: true, message: 'DSL 不能为空', trigger: 'blur' }]
})

const dialogTitle = computed(() => (isEdit.value ? '编辑流程定义（草稿）' : '新建流程定义'))

/**
 * 打开表单
 * @param mode create=新建（给最小骨架 DSL）；edit=编辑（按 id 拉完整定义，code 只读）
 * @param row  编辑时的列表行（只用其 id 去拉完整 dsl，因列表分页不带正文）
 */
const open = async (mode: 'create' | 'edit', row?: AgentWorkflowDefVO) => {
  validateResult.value = undefined
  isEdit.value = mode === 'edit'
  visible.value = true
  if (mode === 'create') {
    formData.value = { ...emptyForm(), dsl: DEFAULT_DSL }
    return
  }
  loading.value = true
  try {
    const data = await AgentWorkflowApi.getDef(row!.id)
    formData.value = {
      id: data.id,
      code: data.code,
      name: data.name,
      dsl: data.dsl ?? '',
      description: data.description ?? '',
      remark: data.remark ?? ''
    }
  } finally {
    loading.value = false
  }
}

/** 调后端双层校验并落到 validateResult；返回结果对象（DSL 为空则提示并返回 null）。不弹 toast */
const runValidate = async (): Promise<AgentWorkflowDefValidateVO | null> => {
  if (!formData.value.dsl?.trim()) {
    message.warning('请先填写 DSL')
    return null
  }
  validating.value = true
  try {
    const res = await AgentWorkflowApi.validateDsl(formData.value.dsl)
    validateResult.value = res
    return res
  } finally {
    validating.value = false
  }
}

/** 「校验DSL」按钮：跑校验 + 明确 toast */
const handleValidate = async () => {
  const res = await runValidate()
  if (!res) return
  if (res.passed) {
    res.warnings.length
      ? message.warning(`校验通过，但有 ${res.warnings.length} 条建议调整`)
      : message.success('校验通过')
  } else {
    message.error(`校验未通过：${res.errors.length} 个错误`)
  }
}

/** 「预览画布」：把当前未保存的 DSL 交给只读画布渲染 */
const handlePreview = () => {
  if (!formData.value.dsl?.trim()) {
    message.warning('请先填写 DSL')
    return
  }
  canvasRef.value.openDsl(formData.value.dsl, {
    code: formData.value.code,
    name: formData.value.name,
    description: formData.value.description,
    status: 'DRAFT'
  } as Partial<AgentWorkflowDefVO>)
}

/** 「可视化编辑」：把当前未保存的 DSL 交给可交互画布（增量14d）。空 DSL 给最小骨架，方便从零拖起 */
const handleVisualEdit = () => {
  editorRef.value.open(formData.value.dsl?.trim() ? formData.value.dsl : DEFAULT_DSL, {
    code: formData.value.code,
    name: formData.value.name
  })
}

/** 可视化编辑器「应用到表单」：回写 DSL 原文，并清掉上一轮校验结果（内容已变，需重新校验） */
const onEditorApply = (dsl: string) => {
  formData.value.dsl = dsl
  validateResult.value = undefined
  message.success('已把画布编辑结果写回 DSL，可继续「校验DSL」或保存')
}

/** 保存：表单校验 → DSL 软门禁（有阻断错误则二次确认可存草稿）→ create/update */
const handleSubmit = async () => {
  try {
    await formRef.value.validate()
  } catch {
    return // 字段级校验未过，错误已内联展示
  }
  const res = await runValidate()
  if (!res) return
  if (!res.passed) {
    try {
      await message.confirm(
        `DSL 存在 ${res.errors.length} 个错误，仍要保存为草稿吗？草稿不可执行，可稍后修正再发布。`
      )
    } catch {
      return // 用户取消保存
    }
  }
  submitting.value = true
  try {
    if (isEdit.value) {
      await AgentWorkflowApi.updateDef(formData.value)
      message.success('修改成功')
    } else {
      await AgentWorkflowApi.createDef(formData.value)
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
