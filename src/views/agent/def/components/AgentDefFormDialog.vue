<!--
  Agent 定义 新建/编辑/查看表单（P5 Agent Builder 第一刀）

  业务人员在此定义一个 Agent 的身份：编码、名称、人设（系统提示词）、描述、备注。
  人设是一段自由散文（无结构可校），故用普通多行文本框，不像 workflow 那样上 Monaco + DSL 校验。

  🔴 三种模式：create（新建，落草稿）/ edit（改草稿，code 只读）/ view（只读查看，全字段禁用）。
     view 让已发布/已停用行也能看人设——编辑只对 DRAFT 开放（后端 updateDef 对非草稿抛 AGENT_DEF_NOT_DRAFT）。
  🔴 增量10（slice-2）：人设与绑定模型已接入对话流——发布后在聊天入口选中该 Agent，
     persona 即成系统提示词、modelId 即固定问答模型（留空则用平台动态默认）。
  🔴 增量11（slice-3a）：知识库绑定已接入——绑定后该 Agent 聊天时从其专属 KB 检索并注入「参考资料」；
     留空=不检索（仅凭人设作答）。下拉复用 KnowledgeApi.getSimpleKnowledgeList（只列启用的库）。
  🔴 增量12（slice-3b）：只读工具绑定已接入——绑定后该 Agent 聊天时跑「思考→调只读工具→观察→再思考」ReAct 循环；
     留空=直连问答。下拉复用 config getToolList 并前端过滤只读工具（requireConfirm===false），与后端发布期校验同口径。
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
      <el-form-item label="模型" prop="modelId">
        <div class="w-full">
          <div class="text-12px text-[var(--el-text-color-secondary)] mb-6px leading-16px">
            该 Agent 每轮问答固定用哪个模型；留空=用平台动态默认模型（不可用时自动切换下一个）。
          </div>
          <el-select
            v-model="formData.modelId"
            :disabled="isView"
            clearable
            filterable
            placeholder="默认（动态选择）"
            class="w-full"
          >
            <el-option
              v-for="m in modelList"
              :key="m.id"
              :label="m.name"
              :value="m.id"
            >
              <span>{{ m.name }}</span>
              <span class="text-12px text-[var(--el-text-color-secondary)] ml-8px">{{ m.model }}</span>
            </el-option>
          </el-select>
        </div>
      </el-form-item>
      <el-form-item label="知识库" prop="knowledgeId">
        <div class="w-full">
          <div class="text-12px text-[var(--el-text-color-secondary)] mb-6px leading-16px">
            该 Agent 的专属知识库；绑定后聊天会从中检索并把命中片段作为「参考资料」注入回答。留空=不检索（仅凭人设作答）。
          </div>
          <el-select
            v-model="formData.knowledgeId"
            :disabled="isView"
            clearable
            filterable
            placeholder="不绑定（无知识库检索）"
            class="w-full"
          >
            <el-option
              v-for="k in knowledgeList"
              :key="k.id"
              :label="k.name"
              :value="k.id"
            />
          </el-select>
        </div>
      </el-form-item>
      <el-form-item label="工具" prop="toolKeys">
        <div class="w-full">
          <div class="text-12px text-[var(--el-text-color-secondary)] mb-6px leading-16px">
            绑定后该 Agent 聊天时会先「思考→调工具查现状→再思考」直到给出结论，而非凭空作答。
            <b>仅可绑定只读工具</b>（写操作须走 Plan 确认或工作流 tool 节点，聊天循环无人工确认故不放行）；留空=直连问答。
          </div>
          <el-select
            v-model="selectedTools"
            :disabled="isView"
            multiple
            clearable
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="不绑定（直连问答，无工具调查）"
            class="w-full"
          >
            <el-option
              v-for="t in toolList"
              :key="t.name"
              :label="t.name"
              :value="t.name"
            >
              <span>{{ t.name }}</span>
              <span class="text-12px text-[var(--el-text-color-secondary)] ml-8px">{{ t.description }}</span>
            </el-option>
          </el-select>
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
import { ModelApi, type ModelVO } from '@/api/ai/model/model'
import { KnowledgeApi, type KnowledgeVO } from '@/api/ai/knowledge/knowledge'
import { getToolList, type AgentToolVO } from '@/api/agent/config'

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

/** 问答模型下拉数据源：CHAT 类型（type=1），后端只回「模型启用 + 密钥启用」的，选了就一定能用 */
const modelList = ref<ModelVO[]>([])
const loadModels = async () => {
  if (modelList.value.length > 0) return // 一次会话内缓存，避免每次开表单都打一次
  try {
    modelList.value = (await ModelApi.getModelSimpleList(1)) || []
  } catch {
    modelList.value = [] // 拉不到不阻断建 Agent：留空即动态默认模型
  }
}

/** 知识库下拉数据源：后端 simple-list 只回启用（ENABLE）的库、只带 id+name、按租户过滤 */
const knowledgeList = ref<KnowledgeVO[]>([])
const loadKnowledge = async () => {
  if (knowledgeList.value.length > 0) return // 一次会话内缓存，避免每次开表单都打一次
  try {
    knowledgeList.value = (await KnowledgeApi.getSimpleKnowledgeList()) || []
  } catch {
    knowledgeList.value = [] // 拉不到不阻断建 Agent：留空即不绑定知识库
  }
}

/**
 * 工具下拉数据源（增量12 / slice-3b）：只列<b>只读</b>工具（requireConfirm===false ⟺ 风险 READ_ONLY）。
 * 后端发布期 validateToolKeys 也只放行只读工具，故这里前端先过滤，业务人员看不到不可绑的写工具（防错配）。
 */
const toolList = ref<AgentToolVO[]>([])
const loadTools = async () => {
  if (toolList.value.length > 0) return // 一次会话内缓存，避免每次开表单都打一次
  try {
    const all = (await getToolList()) || []
    toolList.value = all.filter((t) => !t.requireConfirm)
  } catch {
    toolList.value = [] // 拉不到不阻断建 Agent：留空即不绑定工具（走直连问答）
  }
}

/** 空表单初值（新建时用）。toolKeys 初值为空串=不绑定工具，走直连问答 */
const emptyForm = (): AgentDefSaveVO => ({
  code: '',
  name: '',
  persona: '',
  modelId: undefined,
  knowledgeId: undefined,
  toolKeys: '',
  description: '',
  remark: ''
})
const formData = ref<AgentDefSaveVO>(emptyForm())

/**
 * 工具多选 v-model 适配器：表单存的是逗号分隔串（toolKeys，与后端一一对应），
 * el-select multiple 绑数组。用 computed get/set 在两者间转换，单一真源仍是 formData.toolKeys
 * （避免「开表单解析一次、提交再拼一次」的同步漏写）。
 */
const selectedTools = computed<string[]>({
  get: () => (formData.value.toolKeys ? formData.value.toolKeys.split(',').filter(Boolean) : []),
  set: (val: string[]) => {
    formData.value.toolKeys = val && val.length ? val.join(',') : ''
  }
})

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
  loadModels()
  loadKnowledge()
  loadTools()
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
      modelId: data.modelId ?? undefined,
      knowledgeId: data.knowledgeId ?? undefined,
      toolKeys: data.toolKeys ?? '',
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
