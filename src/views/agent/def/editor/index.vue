<!--
  Agent 定义设计器（整页）—— AI助手 UX 修复 / 问题3

  仿流程编排设计器（AgentWorkflowEditor）的隐藏路由整页编辑：/agent-def/editor?id=xxx[&mode=view]。
  替代旧「760px 单列平铺弹窗」：URL 可刷新可分享、浏览器后退回列表、编辑空间充足、双列卡片重排版。

  - 无 id → 新建态：空表单，code 可编辑；保存走 createDef，成功后 router.replace 带上 id（防刷新重复新建）。
  - 有 id → 编辑/查看态：getDef 回填。mode=view 强制只读；否则非 DRAFT 只读（后端 updateDef 只对草稿生效）。
  - 顶栏：返回（未保存改动 confirm）/ 标题 / 状态 tag / 保存草稿 / 保存并发布。
  - 主体：左列（基本信息 + 人设 + 描述备注）+ 右列（模型 / 知识库 / 工具）双列卡片，窄屏自动堆叠。
  - 表单字段/规则/下拉数据源/工具 CSV⇄数组适配器 均由旧 AgentDefFormDialog 原样迁移。
-->
<template>
  <div class="agent-editor-page">
    <!-- 顶栏 -->
    <header class="editor-header flex items-center gap-10px px-16px py-10px">
      <el-button circle title="返回列表" @click="handleBack">
        <Icon icon="ep:arrow-left" />
      </el-button>
      <div class="flex items-center gap-8px flex-1 min-w-0">
        <span class="text-16px font-600 truncate">{{ pageTitle }}</span>
        <el-tag v-if="isEdit" :type="statusTagType">{{ statusLabel }}</el-tag>
        <el-tag v-else type="info">新建</el-tag>
        <span v-if="readonly" class="text-12px text-[var(--el-color-warning)] flex-shrink-0">只读</span>
      </div>
      <div class="flex items-center gap-8px flex-shrink-0">
        <el-button
          :loading="savingAction === 'save'"
          :disabled="readonly || (saving && savingAction !== 'save')"
          @click="handleSave('save')"
        >
          <Icon icon="ep:finished" class="mr-4px" />保存草稿
        </el-button>
        <el-button
          type="primary"
          :loading="savingAction === 'publish'"
          :disabled="readonly || (saving && savingAction !== 'publish')"
          v-hasPermi="['agent:def:publish']"
          @click="handleSave('publish')"
        >
          <Icon icon="ep:promotion" class="mr-4px" />保存并发布
        </el-button>
      </div>
    </header>

    <!-- 主体 -->
    <div class="editor-body" v-loading="loading">
      <div class="editor-content">
        <el-alert
          v-if="readonly && isEdit && status !== 'DRAFT'"
          type="warning"
          :closable="false"
          show-icon
          class="mb-16px"
          title="该 Agent 已发布或已停用，不可编辑（仅草稿可改）。如需调整，请返回列表页新建一个 Agent。"
        />

        <el-form
          ref="formRef"
          :model="formData"
          :rules="formRules"
          label-position="top"
          :disabled="readonly"
        >
          <div class="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-16px items-start">
            <!-- 左列：基本信息 + 人设 + 描述备注 -->
            <div class="flex flex-col gap-16px min-w-0">
              <el-card shadow="never">
                <template #header><span class="card-title">基本信息</span></template>
                <el-form-item label="名称" prop="name">
                  <el-input
                    v-model="formData.name"
                    placeholder="请输入名称，如「订单客服」"
                    @input="markDirty"
                  />
                </el-form-item>
                <el-form-item label="编码" prop="code" class="!mb-0">
                  <el-input
                    v-model="formData.code"
                    :disabled="isEdit || readonly"
                    placeholder="小写字母开头，仅含小写字母/数字/下划线，如 order_assistant"
                    @input="markDirty"
                  />
                  <div v-if="isEdit" class="form-hint mt-4px">
                    编码不可修改（改编码等于换一个 Agent）；要改已发布 Agent 请基于它新建一个版本。
                  </div>
                </el-form-item>
              </el-card>

              <el-card shadow="never">
                <template #header><span class="card-title">人设（系统提示词）</span></template>
                <div class="form-hint mb-8px">
                  人设即 Agent 的系统提示词：定义它的身份、职责、语气与边界。
                </div>
                <el-form-item prop="persona" class="!mb-0">
                  <el-input
                    v-model="formData.persona"
                    type="textarea"
                    :rows="16"
                    maxlength="8000"
                    show-word-limit
                    data-testid="agent-persona"
                    placeholder="例：你是一名耐心、专业的订单客服。职责：解答订单状态、物流、退换货问题。语气：友好简洁。边界：涉及退款金额争议时，说明规则并引导用户联系人工客服。"
                    @input="markDirty"
                  />
                </el-form-item>
              </el-card>

              <el-card shadow="never">
                <template #header><span class="card-title">描述</span></template>
                <el-form-item prop="description" class="!mb-0">
                  <el-input
                    v-model="formData.description"
                    type="textarea"
                    :rows="2"
                    maxlength="500"
                    show-word-limit
                    placeholder="选填"
                    @input="markDirty"
                  />
                </el-form-item>
              </el-card>
            </div>

            <!-- 右列：模型 / 知识库 / 工具 -->
            <div class="flex flex-col gap-16px min-w-0">
              <el-card shadow="never">
                <template #header><span class="card-title">模型</span></template>
                <div class="form-hint mb-8px">
                  该 Agent 每轮问答固定用哪个模型；留空=用平台动态默认模型（不可用时自动切换下一个）。
                </div>
                <el-form-item prop="modelId" class="!mb-0">
                  <el-select
                    v-model="formData.modelId"
                    clearable
                    filterable
                    placeholder="默认（动态选择）"
                    class="w-full"
                    @change="markDirty"
                  >
                    <el-option v-for="m in modelList" :key="m.id" :label="m.name" :value="m.id">
                      <span>{{ m.name }}</span>
                      <span class="text-12px text-[var(--el-text-color-secondary)] ml-8px">{{ m.model }}</span>
                    </el-option>
                  </el-select>
                </el-form-item>
              </el-card>

              <el-card shadow="never">
                <template #header><span class="card-title">知识库</span></template>
                <div class="form-hint mb-8px">
                  该 Agent 的专属知识库；绑定后聊天会从中检索并把命中片段作为「参考资料」注入回答。留空=不检索（仅凭人设作答）。
                </div>
                <el-form-item prop="knowledgeId" class="!mb-0">
                  <el-select
                    v-model="formData.knowledgeId"
                    clearable
                    filterable
                    placeholder="不绑定（无知识库检索）"
                    class="w-full"
                    @change="markDirty"
                  >
                    <el-option v-for="k in knowledgeList" :key="k.id" :label="k.name" :value="k.id" />
                  </el-select>
                </el-form-item>
              </el-card>

              <el-card shadow="never">
                <template #header><span class="card-title">工具（只读）</span></template>
                <div class="form-hint mb-8px">
                  绑定后该 Agent 聊天时会先「思考→调工具查现状→再思考」直到给出结论，而非凭空作答。
                  <b>仅可绑定只读工具</b>（写操作须走 Plan 确认或工作流 tool 节点）；留空=直连问答。
                </div>
                <el-form-item prop="toolKeys" class="!mb-0">
                  <el-select
                    v-model="selectedTools"
                    multiple
                    clearable
                    filterable
                    collapse-tags
                    collapse-tags-tooltip
                    placeholder="不绑定（直连问答，无工具调查）"
                    class="w-full"
                    @change="markDirty"
                  >
                    <el-option v-for="t in toolList" :key="t.name" :label="t.name" :value="t.name">
                      <span>{{ t.name }}</span>
                      <span class="text-12px text-[var(--el-text-color-secondary)] ml-8px">{{ t.description }}</span>
                    </el-option>
                  </el-select>
                </el-form-item>
              </el-card>
            </div>
          </div>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { AgentDefApi, type AgentDefSaveVO } from '@/api/agent/def'
import { ModelApi, type ModelVO } from '@/api/ai/model/model'
import { KnowledgeApi, type KnowledgeVO } from '@/api/ai/knowledge/knowledge'
import { getToolList, type AgentToolVO } from '@/api/agent/config'

defineOptions({ name: 'AgentDefEditor' })

const message = useMessage()
const route = useRoute()
const { push, replace } = useRouter()

const loading = ref(false)
const saving = ref(false)
const savingAction = ref<'' | 'save' | 'publish'>('')
const dirty = ref(false)

const isEdit = ref(false)
/** mode=view 强制只读（列表页「查看」对任意状态开放） */
const forceView = ref(false)
const status = ref('DRAFT')
const formRef = ref()

/** 空表单初值（新建时用）。toolKeys 初值为空串=不绑定工具，走直连问答 */
const emptyForm = (): AgentDefSaveVO => ({
  code: '',
  name: '',
  persona: '',
  modelId: undefined,
  knowledgeId: undefined,
  toolKeys: '',
  description: ''
})
const formData = ref<AgentDefSaveVO>(emptyForm())

/** 只读：显式查看态，或已保存且非草稿（后端 updateDef 对非草稿抛 AGENT_DEF_NOT_DRAFT） */
const readonly = computed(() => forceView.value || (isEdit.value && status.value !== 'DRAFT'))

/** 问答模型下拉数据源：CHAT 类型（type=1），后端只回「模型启用 + 密钥启用」的 */
const modelList = ref<ModelVO[]>([])
const loadModels = async () => {
  if (modelList.value.length > 0) return
  try {
    modelList.value = (await ModelApi.getModelSimpleList(1)) || []
  } catch {
    modelList.value = []
  }
}

/** 知识库下拉数据源：simple-list 只回启用（ENABLE）的库、只带 id+name、按租户过滤 */
const knowledgeList = ref<KnowledgeVO[]>([])
const loadKnowledge = async () => {
  if (knowledgeList.value.length > 0) return
  try {
    knowledgeList.value = (await KnowledgeApi.getSimpleKnowledgeList()) || []
  } catch {
    knowledgeList.value = []
  }
}

/** 工具下拉数据源：只列只读工具（requireConfirm===false），与后端发布期校验同口径 */
const toolList = ref<AgentToolVO[]>([])
const loadTools = async () => {
  if (toolList.value.length > 0) return
  try {
    const all = (await getToolList()) || []
    toolList.value = all.filter((t) => !t.requireConfirm)
  } catch {
    toolList.value = []
  }
}

/**
 * 工具多选 v-model 适配器：表单存逗号分隔串（toolKeys，与后端一一对应），el-select multiple 绑数组。
 * 用 computed get/set 在两者间转换，单一真源仍是 formData.toolKeys。
 */
const selectedTools = computed<string[]>({
  get: () => (formData.value.toolKeys ? formData.value.toolKeys.split(',').filter(Boolean) : []),
  set: (val: string[]) => {
    formData.value.toolKeys = val && val.length ? val.join(',') : ''
  }
})

const formRules = reactive({
  code: [
    { required: true, message: '编码不能为空', trigger: 'blur' },
    {
      pattern: /^[a-z][a-z0-9_]{1,63}$/,
      message: '小写字母开头，仅含小写字母/数字/下划线，长度 2~64',
      trigger: 'blur'
    }
  ],
  name: [{ required: true, message: '名称不能为空', trigger: 'blur' }],
  persona: [{ required: true, message: '人设不能为空', trigger: 'blur' }]
})

const statusLabel = computed(() =>
  status.value === 'PUBLISHED' ? '已发布' : status.value === 'DISABLED' ? '已停用' : '草稿'
)
const statusTagType = computed<'info' | 'success' | 'warning'>(() =>
  status.value === 'PUBLISHED' ? 'success' : status.value === 'DISABLED' ? 'warning' : 'info'
)
const pageTitle = computed(() =>
  isEdit.value ? formData.value.name || '智能体' : '新建智能体'
)

const markDirty = () => {
  dirty.value = true
}

const initCreate = () => {
  isEdit.value = false
  status.value = 'DRAFT'
  formData.value = emptyForm()
  dirty.value = false
}

const loadDef = async (id: number) => {
  loading.value = true
  try {
    const data = await AgentDefApi.getDef(id)
    isEdit.value = true
    status.value = data.status ?? 'DRAFT'
    formData.value = {
      id: data.id,
      code: data.code,
      name: data.name,
      persona: data.persona ?? '',
      modelId: data.modelId ?? undefined,
      knowledgeId: data.knowledgeId ?? undefined,
      toolKeys: data.toolKeys ?? '',
      description: data.description ?? ''
    }
    dirty.value = false
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadModels()
  loadKnowledge()
  loadTools()
  forceView.value = route.query.mode === 'view'
  const id = Number(route.query.id)
  if (route.query.id && Number.isFinite(id) && id > 0) {
    loadDef(id)
  } else {
    initCreate()
  }
})

/**
 * 保存：表单校验 → create/update。
 * 🔴 先记住本次是不是「新建」：createDef 成功后会把 isEdit 翻成 true（URL 补 id、后续保存转 update），
 *    若等到提示时再看 isEdit 就永远是 true，「新建成功」分支成了死代码。
 * publish 时保存成功后再发布（发布要求草稿完整，故先过字段校验）。
 */
const handleSave = async (action: 'save' | 'publish') => {
  try {
    await formRef.value.validate()
  } catch {
    return // 字段级校验未过，错误已内联展示
  }
  saving.value = true
  savingAction.value = action
  try {
    const payload: AgentDefSaveVO = { ...formData.value }
    const wasCreate = !isEdit.value
    let id = payload.id
    if (isEdit.value && id) {
      await AgentDefApi.updateDef(payload)
    } else {
      id = await AgentDefApi.createDef(payload)
      isEdit.value = true
      formData.value.id = id
      status.value = 'DRAFT'
      replace({ name: 'AgentDefEditor', query: { id: String(id) } })
    }
    dirty.value = false

    if (action === 'publish' && id) {
      await AgentDefApi.publishDef(id)
      status.value = 'PUBLISHED'
      message.success('已保存并发布')
    } else {
      message.success(wasCreate ? '新建成功（草稿）' : '保存成功')
    }
  } finally {
    saving.value = false
    savingAction.value = ''
  }
}

const handleBack = async () => {
  if (dirty.value) {
    try {
      await message.confirm('有未保存的改动，确认离开吗？')
    } catch {
      return
    }
  }
  push({ path: '/agent/def' })
}
</script>

<style scoped>
.agent-editor-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 84px);
  background: var(--el-bg-color-page);
}
.editor-header {
  flex-shrink: 0;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
}
.editor-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.editor-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
}
.form-hint {
  font-size: 12px;
  line-height: 16px;
  color: var(--el-text-color-secondary);
}
</style>
