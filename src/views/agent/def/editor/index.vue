<!--
  Agent 定义设计器（整页）—— AI助手 UX 修复 / 问题3

  仿流程编排设计器（AgentWorkflowEditor）的隐藏路由整页编辑：/agent-def/editor?id=xxx[&mode=view]。
  替代旧「760px 单列平铺弹窗」：URL 可刷新可分享、浏览器后退回列表、编辑空间充足、双列卡片重排版。

  - 无 id → 新建态：空表单，code 可编辑；保存走 createDef，成功后 router.replace 带上 id（防刷新重复新建）。
  - 有 id → 编辑/查看态：getDef 回填。mode=view 强制只读；否则非 DRAFT 只读（就地改仅限草稿，见下）。
  - 顶栏：返回（未保存改动 confirm）/ 标题 / 状态 tag / 保存草稿 / 保存并发布。
  - 主体：左列（基本信息 + 人设 + 描述备注）+ 右列（模型 / 知识库 / 工具）双列卡片，窄屏自动堆叠。
  - 表单字段/规则/下拉数据源/工具 CSV⇄数组适配器 均由旧 AgentDefFormDialog 原样迁移。

  🔴 需求11：已发布/已停用行<b>不会</b>走到「就地改」——列表页点「编辑」时会先 deriveDef 派生一个新草稿，
     再带新 id 跳进来，所以到这里的一律是 DRAFT（或内置行）。本页只负责在只读态把话说明白。
  🔴 需求10：系统内置行（默认平台助手）虽为 PUBLISHED 但可就地改，且只有「名称/人设/描述」三项——
     模型/知识库/工具在「未选 Agent」这条路上不被读取，渲染出来就是「配了但不生效」。见 builtin ref。
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
        <el-tag v-if="builtin" type="danger" effect="plain">系统内置</el-tag>
        <span v-if="readonly" class="text-12px text-[var(--el-color-warning)] flex-shrink-0">只读</span>
      </div>
      <div class="flex items-center gap-8px flex-shrink-0">
        <el-button
          :loading="savingAction === 'save'"
          :disabled="readonly || (saving && savingAction !== 'save')"
          @click="handleSave('save')"
        >
          <Icon icon="ep:finished" class="mr-4px" />{{ builtin ? '保存' : '保存草稿' }}
        </el-button>
        <!-- 内置行恒为 PUBLISHED 且不可翻状态，「保存并发布」对它没有意义（点了只是幂等空转），故不渲染 -->
        <el-button
          v-if="!builtin"
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
          v-if="builtin"
          type="info"
          :closable="false"
          show-icon
          class="mb-16px"
          title="这是系统内置的「默认平台助手」：聊天入口未选择智能体时用的就是它。"
          description="可就地修改名称、人设与描述，保存后对下一句对话立即生效。它固定检索平台使用手册、回答标注出处并给出追问建议，因此没有模型/知识库/工具绑定项——那三项在「未选 Agent」这条路上不会被读取，放出来就是「配了但不生效」。它也不可删除、停用或派生新版本。"
        />
        <el-alert
          v-else-if="readonly && isEdit && status !== 'DRAFT'"
          type="warning"
          :closable="false"
          show-icon
          class="mb-16px"
          :title="
            status === 'DISABLED'
              ? '该 Agent 已停用，不可就地编辑（历史版本是不可变快照）。要改配置请回列表页点「编辑」派生一个新草稿版本，或用「复制」另建一个 Agent；若配置无需改动，回列表页点「重新发布」即可原样放回线上。'
              : '该 Agent 已发布，不可就地编辑（历史版本是不可变快照）。请回列表页点「编辑」派生一个新草稿版本，或用「复制」另建一个 Agent。'
          "
        />

        <el-form
          ref="formRef"
          :model="formData"
          :rules="formRules"
          label-position="top"
          :disabled="readonly"
        >
          <!-- 🔴 内置行只有一列：右列三张卡对它不渲染，栅格也就不必留那 360px 空位 -->
          <div
            class="grid gap-16px items-start"
            :class="builtin ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[1fr_360px]'"
          >
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
                  <div v-if="builtin" class="form-hint mt-4px">
                    编码 {{ formData.code }} 是系统保留值，新建/复制时不可占用。
                  </div>
                  <div v-else-if="isEdit" class="form-hint mt-4px">
                    编码不可修改（改编码等于换一个 Agent）；要改已发布 Agent 请基于它派生一个新版本。
                  </div>
                </el-form-item>
              </el-card>

              <el-card shadow="never">
                <template #header><span class="card-title">人设（系统提示词）</span></template>
                <div class="form-hint mb-8px">
                  {{
                    builtin
                      ? '这里就是默认平台助手的系统提示词。改动即刻影响所有「未选 Agent」的对话，请谨慎；若清空，后端会回落到代码里的出厂提示词。'
                      : '人设即 Agent 的系统提示词：定义它的身份、职责、语气与边界。'
                  }}
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

            <!-- 右列：模型 / 知识库 / 工具（内置行不渲染，见上方 el-alert） -->
            <div v-if="!builtin" class="flex flex-col gap-16px min-w-0">
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
                  候选里既有平台内置工具，也有你在「工具管理」页登记的自定义工具；
                  已被停用、或来源暂不可执行的行是灰的、挑不动，鼠标停在上面会说原因（D4-25）。
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
                    <!-- label 用「中文名（机器键）」：filterable 输中文、输英文键都能搜到（重构 S1 / L1） -->
                    <el-option
                      v-for="t in toolList"
                      :key="t.name"
                      :label="keyedLabel(t.name, t.displayName)"
                      :value="t.name"
                      :disabled="!!toolBlockReason(t)"
                      :title="toolBlockReason(t) ? disabledToolTitle(t) : undefined"
                    >
                      <span>{{ keyedLabel(t.name, t.displayName) }}</span>
                      <span class="text-12px text-[var(--el-text-color-secondary)] ml-8px">{{ t.description }}</span>
                      <span
                        v-if="toolBlockReason(t)"
                        class="float-right text-12px text-[var(--el-text-color-danger)] ml-12px"
                        data-testid="tool-option-block"
                        >{{ toolBlockReason(t) }}</span
                      >
                    </el-option>
                    <!-- 🔴 G7：目录加载失败时这里会是空的，必须说清原因而不是留一个空列表 -->
                    <template #empty>
                      <div
                        class="p-8px text-12px text-[var(--el-text-color-secondary)]"
                        data-testid="tool-catalog-empty-hint"
                      >
                        {{ toolLoadError || '没有可绑定的只读工具' }}
                      </div>
                    </template>
                  </el-select>
                  <!--
                    🔴 D4-25：绑了个已停用的工具，保存和发布**都不拦**（后端 validateToolKeys 不看 enabled），
                       要到用户真去聊天、模型调这个工具时才被安全网关拒。而折叠标签上只剩一个中文名，
                       不点开下拉根本看不出它已被停用 —— 正是本模块头号缺陷「配了不生效且无提示」。
                       故就地报警，并把两条出路（解绑 / 去工具管理重新启用）写进同一句里。
                  -->
                  <div
                    v-if="disabledBoundWarning"
                    class="mt-4px text-12px text-[var(--el-color-danger)] leading-18px"
                    data-testid="tool-disabled-warning"
                  >
                    {{ disabledBoundWarning }}
                  </div>
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
import { getToolList, toolSourceLabel, type AgentToolVO } from '@/api/agent/config'
import { keyedLabel } from '@/views/agent/workflow/nameCatalog'

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
/**
 * 是否系统内置行（需求10，即「默认平台助手」）
 *
 * 🔴 它虽为 PUBLISHED 却<b>可编辑</b>——readonly 计算里必须显式排除，否则一进页面就是只读，
 *    「在线维护平台助手人设」这个需求等于没做。同时它只认 name/persona/description 三列，
 *    故右列三张卡不渲染（见模板）。
 */
const builtin = ref(false)
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

/** 只读：显式查看态，或已保存且非草稿（后端 updateDef 对非草稿抛 AGENT_DEF_NOT_DRAFT）。内置行例外，可就地改 */
const readonly = computed(
  () => forceView.value || (isEdit.value && status.value !== 'DRAFT' && !builtin.value)
)

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

/**
 * 工具下拉数据源：只列只读工具，与后端发布期校验同口径。
 *
 * 🔴 「同口径」这四个字此前是**假的**：这里过滤的是 `requireConfirm`（生效值），而
 * `AgentDefServiceImpl.validateToolKeys` 读的是 `getDeclaredRisk()`（声明值）。
 * 只要管理员在工具管理页把某个写工具降险成只读，它就会出现在这个下拉里、能被选中、能被保存，
 * 然后后端按声明值把它拒掉 —— 错误信息还说得挺清楚，可用户明明是从我们给的下拉里挑的。
 * 故改成过滤 `declaredRequireConfirm`。回落生效值只为兼容未升级的后端（那种形状下维持旧行为）。
 *
 * 🔴 这一页**刻意不换**到名称目录（`/agent/workflow-def/name-catalog`）：那个接口要 `agent:workflow:query`，
 * 而本页的用户持有的是 `agent:def:*`。换过去等于给「编辑平台助手」凭空加一道流程编排权限 ——
 * G7 要修的是「设计器拿不到工具目录」，不是「所有页面都走同一个接口」。
 * 展示名本来就由 `/agent/config/tool-list` 下发（`AgentConfigController` 早就 put 了 displayName），
 * 只是 `AgentToolVO` 此前没声明这个字段，TypeScript 眼里它不存在，页面就只能显示英文键。
 *
 * 🔴 停用的工具**留在列表里、置灰 + 说原因**，不滤掉（D4-25）。三条理由：
 *   ① 滤掉只是把候选藏了，坑还在 —— 存量 `toolKeys` 里已经绑着的那个键不会因此消失；
 *   ② 已选中但不在候选里的值，Element Plus 的 `getOption` 回落成 `{ currentLabel: value }`，
 *      标签会退化成一串裸机器键（值不会丢，但用户再也认不出那是哪个工具）；
 *   ③ `el-option` 的 disabled 是真挑不动（`selectOptionClick` 里 `if (!isDisabled.value)` 直接 return），
 *      不是只画个灰色。与流程设计器 `agent_loop.tools` 的处置同口径（D4-24）。
 * 🔴 这里的 `enabled` 读的是**生效值**，而上面的只读判据读的是**声明值** —— 不是笔误：
 *   风险那几道闸（`AgentDefServiceImpl` / V3 / V11）读 `getDeclaredRisk()`，降险改不动它们；
 *   而安全网关 `AgentSecurityGateway#checkTool` 读的是 `tool.isEnabled()`，即覆盖后的生效值，
 *   「停用」这个维护动作**当次就真生效**。所以判「能不能用」必须按生效值，判「算不算只读」必须按声明值。
 *
 * 🔴 B2 之后这里同时有内置工具与当前租户登记的自定义工具（后端 `AgentToolCatalog` 合流下发，
 *   靠 `source` 区分）。`executable=false` 的行（`source=FORM`/`SCRIPT` 这两个预留位）
 *   **照样留在候选里、置灰 + 说原因**，与停用同一套处置、同样三条理由：滤掉只会让存量绑定
 *   退化成一串裸机器键，而后端 `validateToolKeys` 发布期本来就会拦它（报「来源(x)当前不可执行」），
 *   界面主动指反方向没有意义。
 */
const toolList = ref<AgentToolVO[]>([])
/** 目录加载失败的人话原因；🔴 G7 要求它可见 —— 空下拉 + 零提示就是原来的病 */
const toolLoadError = ref('')
const loadTools = async () => {
  if (toolList.value.length > 0) return
  try {
    const all = (await getToolList()) || []
    toolList.value = all.filter((t) => !(t.declaredRequireConfirm ?? t.requireConfirm))
    toolLoadError.value = ''
  } catch (e: any) {
    toolList.value = []
    // 🔴 真因与后果都要（C2 之后 e.message 终于是后端那句真因了）。原来那句兜底里的
    //    「可能缺少 AI 配置查看权限」是**猜**的 —— 写它的时候压根拿不到真因，现在拿得到就不该再猜；
    //    只在真因也缺失时才退回这个猜测。而「绑定工具将不可用」后端永远不会说，
    //    少了它用户只看到一句孤立报错，分不清下面那个空下拉是坏了还是真的没有工具。
    const cause = e?.message || '可能缺少 AI 配置查看权限'
    toolLoadError.value = `工具目录加载失败（${cause}），绑定工具将不可用`
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

/**
 * 已绑定、但当前被停用的工具（D4-25）。
 *
 * 🔴 目录还没加载完（或加载失败）时返回空 —— 那种形状下我们**不知道**某个键是否停用，
 *    宁可不出这句警告，也不要凭猜测把用户往「解绑」上推（解绑是有代价的动作）。
 * ⚠️ 刻意只覆盖「在候选里且 enabled=false」这一类。已绑定的键若压根不在候选里
 *    （被管理员改成非只读、或工具已从代码里删掉），标签同样会退化成裸机器键，但那两类
 *    后端 `validateToolKeys` 发布期就会拦（分别报「不是只读工具」「未登记」），属于 fail-loud，
 *    与「静默失效」不是一回事，不在本条修复范围内。
 */
const disabledBoundTools = computed<AgentToolVO[]>(() => {
  if (!selectedTools.value.length || !toolList.value.length) return []
  const bound = new Set(selectedTools.value)
  return toolList.value.filter((t) => bound.has(t.name) && !t.enabled)
})

/** 表单里那句就地警告；没有停用工具时为空串（模板据此不渲染） */
const disabledBoundWarning = computed(() => {
  if (!disabledBoundTools.value.length) return ''
  const names = disabledBoundTools.value
    .map((t) => keyedLabel(t.name, t.displayName))
    .join('、')
  return (
    `已绑定的 ${names} 当前被停用。保存和发布都不会拦你，但这个 Agent 每次调用它们都会被安全网关拒绝`
    + '（后端报「AI 助手工具(<工具键>)已被停用」），聊天里只会看到一句失败、看不出是工具被关掉了。'
    + '请把这几个工具从上面的绑定里移除，或到「工具管理」页重新打开它的「启用」开关。'
  )
})

/**
 * 候选行为什么挑不动；挑得动时返回空串（模板据此既不置灰、也不画右侧红字）。
 *
 * 🔴 `executable === false` 必须是**严格等于 false**，不能写成 `!t.executable`：
 *    这个字段是 B2 才下发的，后端没升级时它是 `undefined`，取反会把**整张**下拉一次性灰掉。
 *    那比原来的病更糟 —— 原来是「配了不生效且无提示」，那样就成了「什么都配不了，也不说为什么」。
 *    同一份谨慎上面 `declaredRequireConfirm ?? requireConfirm` 已经用过一次。
 */
const toolBlockReason = (t: AgentToolVO): string => {
  if (!t.enabled) return '已停用'
  if (t.executable === false) return '暂不可执行'
  return ''
}

/** 候选行 title：为什么挑不动，以及出路 */
const disabledToolTitle = (t: AgentToolVO): string => {
  const label = t.displayName || t.name
  if (t.enabled && t.executable === false) {
    return (
      `「${label}」的来源类型（${toolSourceLabel(t.source)}）当前还不能执行，绑上去点发布就会被后端拒`
      + `（报「工具(${t.name})的来源(${t.source})当前不可执行，不能绑定到 Agent」——`
      + '报错里是英文枚举值，与本句说的同一个东西）。'
      + '这类登记项是预留位：请到「工具管理」页把它的来源改成「数据接口」后再绑定。'
    )
  }
  return (
    `「${label}」已被停用，不能再绑定。`
    + '停用来自「工具管理」页的在线维护开关（或代码里本就声明为停用），安全网关读到停用会直接拒绝调用，'
    + `后端报「AI 助手工具(${t.name})已被停用」。`
    + '已经绑着的话请把它移除，或到「工具管理」页重新打开该工具的「启用」开关。'
  )
}

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
  builtin.value = false
  status.value = 'DRAFT'
  formData.value = emptyForm()
  dirty.value = false
}

const loadDef = async (id: number) => {
  loading.value = true
  try {
    const data = await AgentDefApi.getDef(id)
    isEdit.value = true
    builtin.value = data.builtin === true
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

onMounted(async () => {
  forceView.value = route.query.mode === 'view'
  const id = Number(route.query.id)
  if (route.query.id && Number.isFinite(id) && id > 0) {
    await loadDef(id)
  } else {
    initCreate()
  }
  // 🔴 刻意排在 loadDef 之后：内置行不渲染右列三张卡，这三个下拉的数据源对它就是 3 次白跑的跨模块请求
  if (!builtin.value) {
    loadModels()
    loadKnowledge()
    loadTools()
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
    } else if (builtin.value) {
      // 内置行改的是「正在被对话使用」的那份系统提示词，明确告知生效时机，免得用户以为还要发布一次
      message.success('保存成功，下一句对话即生效')
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
  push({ path: '/ai/agent/def' })
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
