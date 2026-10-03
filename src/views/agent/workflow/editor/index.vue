<!--
  流程编排设计器（整页）—— 增量8 / P4，Phase C 重构

  仿门户设计器（InfraPortalEditor）：固定顶栏 + 三栏主体（左节点目录 / 中画布 / 右属性面板）。
  替代旧「顶栏 + 折叠基本信息 + 内嵌 1515 行巨型画布」：
    - 事实源 dslObject 由本页持有，三栏拆分为 WorkflowPalette / WorkflowDesigner / WorkflowPropertyPanel，
      共享一份 useWorkflowEditor 上下文（editorModel/layout/nodeConfigSchema/nodeSummary 纯模块逐字节复用）；
    - 顶栏加撤销/重做（editorHistory 快照栈）+ 重新布局；描述移入右栏「流程信息」，让画布吃满高度；
    - Req 2：新增走列表弹窗建草稿后带 id 进来，本页无有效 id 直接回列表（不再凭空新建）。

  🔴 撤销/重做：本页 watch(dslObject,{deep}) 捕获「就地突变」自动入栈；undo/redo 用 cloneDeep 整体换引用，
     换引用会触发 useWorkflowEditor 的 ref-watch 重算画布，historyApplying 期间不再入栈。

  🔴 需求5：左右两栏默认<b>收缩</b>，靠 .wf-rail 竖条展开/收起，选中节点或连线时右栏自动展开
     （属性面板是配置节点的唯一入口，收起着点节点却没反应会被当成「坏了」）。见 leftCollapsed / rightCollapsed。
-->
<template>
  <div class="wf-editor" v-loading="loading">
    <!-- 顶栏 -->
    <header class="wf-editor__header">
      <div class="wf-editor__identity">
        <el-button circle title="返回列表" @click="handleBack">
          <Icon icon="ep:arrow-left" />
        </el-button>
        <div class="wf-editor__meta">
          <el-input
            v-model="formData.name"
            class="wf-editor__name"
            placeholder="流程名称"
            :disabled="readonly"
            @input="markDirty"
          />
          <el-input v-model="formData.code" class="wf-editor__code" placeholder="流程编码" disabled />
          <el-tag :type="statusTagType">{{ statusLabel }}</el-tag>
          <span v-if="readonly" class="wf-editor__ro">只读</span>
        </div>
      </div>
      <div class="wf-editor__actions">
        <!--
          Req4：画布工具条整行取消，缩放与开发者模式搬到这里，和撤销/重做同一行。
          🔴 缩放 API 靠 useVueFlow(editor.flowId) 拿：Vue Flow 的 store 以 id 为键全局注入，
             父页与 Designer 传同一个 flowId 就是同一份 store，所以顶栏按钮能驱动子组件里的画布。
        -->
        <div class="wf-editor__history">
          <el-tooltip content="撤销 (回退上一步)" placement="bottom">
            <el-button circle :disabled="!canUndo || saving" aria-label="撤销" @click="handleUndo">
              <Icon icon="ep:refresh-left" />
            </el-button>
          </el-tooltip>
          <el-tooltip content="重做 (恢复撤销的一步)" placement="bottom">
            <el-button circle :disabled="!canRedo || saving" aria-label="重做" @click="handleRedo">
              <Icon icon="ep:refresh-right" />
            </el-button>
          </el-tooltip>
          <el-divider direction="vertical" class="wf-editor__sep" />
          <el-tooltip content="重新布局 (自动分层排列节点)" placement="bottom">
            <el-button circle :disabled="readonly || saving" aria-label="重新布局" @click="handleRelayout">
              <Icon icon="ep:share" />
            </el-button>
          </el-tooltip>
          <el-tooltip content="放大画布" placement="bottom">
            <el-button circle :disabled="!canvasReady" aria-label="放大" @click="zoomIn()">
              <Icon icon="ep:zoom-in" />
            </el-button>
          </el-tooltip>
          <el-tooltip content="缩小画布" placement="bottom">
            <el-button circle :disabled="!canvasReady" aria-label="缩小" @click="zoomOut()">
              <Icon icon="ep:zoom-out" />
            </el-button>
          </el-tooltip>
          <el-tooltip content="适配画布 (让全部节点正好显示在可视区)" placement="bottom">
            <el-button circle :disabled="!canvasReady" aria-label="适配画布" @click="fitView({ padding: 0.2 })">
              <Icon icon="ep:full-screen" />
            </el-button>
          </el-tooltip>
          <el-divider direction="vertical" class="wf-editor__sep" />
          <el-tooltip placement="bottom" :show-after="300">
            <template #content>
              开发者模式：在画布下方展开「流程 JSON（事实源）」，可直接改 JSON 并应用到画布
            </template>
            <div class="wf-editor__dev">
              <span class="wf-editor__dev-label">开发者</span>
              <el-switch v-model="devMode" size="small" data-testid="dev-mode-switch" />
            </div>
          </el-tooltip>
        </div>
        <el-button
          v-hasPermi="['agent:workflow:run']"
          :disabled="!canvasReady || saving"
          @click="sandboxVisible = true"
        >
          <Icon icon="ep:cpu" class="mr-4px" />沙箱测试
        </el-button>
        <el-button :disabled="readonly" :loading="validating" @click="handleValidate">
          <Icon icon="ep:circle-check" class="mr-4px" />体检
        </el-button>
        <el-button
          :loading="savingAction === 'save'"
          :disabled="readonly || (saving && savingAction !== 'save')"
          @click="handleSave('save')"
        >
          <Icon icon="ep:finished" class="mr-4px" />保存草稿
        </el-button>
        <el-button
          type="primary"
          v-hasPermi="['agent:workflow:publish']"
          :loading="savingAction === 'publish'"
          :disabled="readonly || (saving && savingAction !== 'publish')"
          @click="handleSave('publish')"
        >
          <Icon icon="ep:promotion" class="mr-4px" />保存并发布
        </el-button>
        <el-button :disabled="saving" @click="handleBack">
          <Icon icon="ep:close" class="mr-4px" />关闭
        </el-button>
      </div>
    </header>

    <!--
      🔴 G7（重构 S1）：名称目录加载失败的显式告警。

      原来 `loadCatalogs` 里是 `.catch(() => [])`：403 被吞成空数组，用户看到的是一个空下拉 + 零提示，
      只能靠 allow-create 手打英文工具名 —— 这正是本平台头号缺陷形态「配了不生效且无提示」。
      现在目录改走 `agent:workflow:query`（设计器本来就有的权限），失败面小得多，但**仍然必须可见**。
    -->
    <div v-if="catalogError" class="wf-editor__validate">
      <el-alert type="warning" :closable="false" show-icon data-testid="catalog-error-alert">
        <template #title>{{ catalogError }}</template>
        画布摘要与工具下拉会退回显示英文标识（如 datamodel_create），流程本身不受影响。
        <el-button link type="primary" size="small" @click="loadCatalogs">重试</el-button>
      </el-alert>
    </div>

    <!-- 体检结果（结构化 errors/warnings，直接展示后端返回的「怎么改」文案） -->
    <div v-if="validateResult" class="wf-editor__validate">
      <el-alert
        v-if="validateResult.passed && !validateResult.warnings.length"
        title="体检通过：这条流程结构完整，可以发布运行"
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
          <template #title>还有 {{ validateResult.errors.length }} 处必须修正</template>
          <ul class="wf-editor__validate-list">
            <li v-for="(e, i) in validateResult.errors" :key="i">{{ e }}</li>
          </ul>
        </el-alert>
        <el-alert v-if="validateResult.warnings.length" type="warning" :closable="false" show-icon>
          <template #title>
            {{ validateResult.errors.length ? '另有' : '体检通过，另有' }}
            {{ validateResult.warnings.length }} 条优化建议（不影响保存）
          </template>
          <ul class="wf-editor__validate-list">
            <li v-for="(w, i) in validateResult.warnings" :key="i">{{ w }}</li>
          </ul>
        </el-alert>
      </template>

      <!--
        影响面（S3）：体检说的是「这条 DSL 合不合法」，影响面说的是「跑起来平台上会多出/改掉什么」。
        🔴 不发第二个请求：S2-f 起 `/validate` 的响应本身就附带 manifest（附带版，可能为 null），
           作者点完「体检」紧接着就能看见，不必再找一个按钮。
        🔴 用 collapsible：展开后可能几十行，会把下面的画布顶出视野；含不可逆动作或干跑不通过时
           组件内部会强制展开（口径与聊天草稿卡一致，都收在 ChangeManifestCard 里，不各写一套）。
        🔴 方案 §L1153 原写「设计器右侧新增 tab，与沙箱面板并列」—— 实测那个位置不存在：
           沙箱是一个**非模态 drawer**（本文件 :257-272），右侧属性面板里也没有 el-tabs。
           故落在体检结果区，不按原文那个不存在的位置做（此偏差已回写方案）。
      -->
      <ChangeManifestCard
        data-testid="designer-manifest"
        :manifest="validateResult.manifest"
        :error="validateResult.manifest ? '' : '体检时未能生成变更清单'"
        collapsible
        class="mt-8px"
      />
    </div>

    <!--
      主体：三栏（左目录 / 中画布 / 右属性面板）

      🔴 需求5：左右两栏默认<b>收缩</b>，把宽度让给画布。侧栏之间那条 .wf-rail 竖条既是分隔条也是开关，
         所以它始终渲染（收起态变宽并显示竖排标题，让人知道那边藏着什么）。
         刻意不把按钮塞进子组件的标题栏：属性面板有「选中节点 / 选中连线 / 未选中」三个分支、各自带标题，
         没有一个稳定位置能放这个按钮。
    -->
    <div class="wf-editor__body">
      <WorkflowPalette v-if="canvasReady && !readonly && !leftCollapsed" :editor="editor" />
      <button
        v-if="canvasReady && !readonly"
        type="button"
        class="wf-rail"
        :class="{ 'wf-rail--collapsed': leftCollapsed }"
        :aria-label="leftCollapsed ? '展开节点目录' : '收起节点目录'"
        :title="leftCollapsed ? '展开节点目录' : '收起节点目录'"
        data-testid="rail-left"
        @click="leftCollapsed = !leftCollapsed"
      >
        <Icon :icon="leftCollapsed ? 'ep:arrow-right' : 'ep:arrow-left'" />
        <span v-if="leftCollapsed" class="wf-rail__label">节点目录</span>
      </button>

      <main class="wf-editor__main">
        <WorkflowDesigner
          v-if="canvasReady"
          :editor="editor"
          :readonly="readonly"
          :sandbox-overlay="sandboxOverlay"
        />
        <el-empty
          v-else
          class="wf-editor__broken"
          description="这条流程的配置数据损坏，无法打开画布编辑"
        />
      </main>

      <button
        v-if="canvasReady"
        type="button"
        class="wf-rail wf-rail--right"
        :class="{ 'wf-rail--collapsed': rightCollapsed }"
        :aria-label="rightCollapsed ? '展开属性配置' : '收起属性配置'"
        :title="rightCollapsed ? '展开属性配置' : '收起属性配置'"
        data-testid="rail-right"
        @click="rightCollapsed = !rightCollapsed"
      >
        <Icon :icon="rightCollapsed ? 'ep:arrow-left' : 'ep:arrow-right'" />
        <span v-if="rightCollapsed" class="wf-rail__label">属性配置</span>
      </button>
      <WorkflowPropertyPanel
        v-if="canvasReady && !rightCollapsed"
        v-model:description="formData.description"
        :editor="editor"
        :readonly="readonly"
      />
    </div>

    <!-- 条件分支可视化选择弹窗（单实例，跨中/右栏共用 editor 的路由弹窗状态） -->
    <el-dialog
      v-model="routeDialogVisible"
      title="选择分支"
      width="420px"
      append-to-body
      :close-on-click-modal="false"
      data-testid="route-picker-dialog"
      @close="cancelRouteDialog"
    >
      <div class="wf-editor__route-tip">
        这条连线代表哪个分支？选中后流程会在这个条件下走向对应分支。
      </div>
      <el-radio-group v-model="routeDialogSelected" class="wf-editor__route-group">
        <el-radio v-for="c in routeDialogCandidates" :key="c" :value="c" border class="!mr-0">
          {{ routeTargetName(c) }}
        </el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="cancelRouteDialog">取消</el-button>
        <el-button type="primary" :disabled="!routeDialogSelected.trim()" @click="confirmRouteDialog">
          确定
        </el-button>
      </template>
    </el-dialog>

    <!--
      沙箱测试抽屉（Req4b）：非模态（modal=false），从右侧浮出，画布仍可见 —— 边跑边看节点被逐个染色。
      面板 v-if 挂载：每次打开都是全新状态（重建输入表单与时间线）；关闭即销毁，顺带 abort 掉在跑的 SSE。
    -->
    <el-drawer
      v-model="sandboxVisible"
      title="沙箱测试"
      direction="rtl"
      size="460px"
      :modal="false"
      :append-to-body="true"
      data-testid="sandbox-drawer"
      @closed="sandboxOverlay = {}"
    >
      <SandboxPanel
        v-if="sandboxVisible"
        :dsl="dslObject"
        @overlay="sandboxOverlay = $event"
      />
    </el-drawer>
  </div>
</template>

<script lang="ts" setup>
import { cloneDeep } from 'lodash-es'
import { useVueFlow } from '@vue-flow/core'
import {
  AgentWorkflowApi,
  type AgentWorkflowDefSaveVO,
  type AgentWorkflowDefValidateVO
} from '@/api/agent/workflow'
import type { EditorDsl } from '../editorModel'
import WorkflowPalette from './components/WorkflowPalette.vue'
import WorkflowDesigner from './components/WorkflowDesigner.vue'
import WorkflowPropertyPanel from './components/WorkflowPropertyPanel.vue'
import ChangeManifestCard from '../components/ChangeManifestCard.vue'
import SandboxPanel from './components/SandboxPanel.vue'
import { useWorkflowEditor } from './useWorkflowEditor'
import { createHistory } from './editorHistory'
import type { SandboxOverlayCell } from './sandboxModel'

defineOptions({ name: 'AgentWorkflowEditor' })

const message = useMessage()
const route = useRoute()
const { push, replace } = useRouter()

const loading = ref(false)
const validating = ref(false)
const saving = ref(false)
const savingAction = ref<'' | 'save' | 'publish'>('')
const dirty = ref(false)

const isEdit = ref(false)
const readonly = ref(false)
const status = ref('DRAFT')

const validateResult = ref<AgentWorkflowDefValidateVO>()

const formData = ref<AgentWorkflowDefSaveVO>({
  id: undefined,
  code: '',
  name: '',
  dsl: '',
  description: ''
})

/** 画布事实源：解析后的 DSL 对象（canvasReady=false 表示 DSL 非法 JSON，画布不渲染） */
const dslObject = ref<EditorDsl>({ nodes: [], edges: [] })
const canvasReady = ref(false)

/** 沙箱测试抽屉可见性 + 运行时高亮覆盖层（nodeId → 状态格）。关闭抽屉时清空覆盖层 */
const sandboxVisible = ref(false)
const sandboxOverlay = ref<Record<string, SandboxOverlayCell>>({})

const markDirty = () => {
  dirty.value = true
}

/** 共享编辑上下文：三栏都吃这一份（页面持有 dslObject 作唯一事实源） */
const editor = useWorkflowEditor(dslObject, { readonly, onChange: markDirty })
// 路由弹窗状态跨中/右栏共用，解构到页面在单一 el-dialog 里渲染
const {
  routeDialogVisible,
  routeDialogCandidates,
  routeDialogSelected,
  confirmRouteDialog,
  cancelRouteDialog,
  routeTargetName,
  // Req4：开发者模式开关（localStorage 持久化）从画布工具条搬到了顶栏
  devMode,
  // G7（重构 S1）：名称目录加载失败必须在页面上留痕，重试直接重跑 loadCatalogs
  catalogError,
  loadCatalogs
} = editor

// Req4：画布缩放。store 以 flowId 为键，与 Designer 里的 useVueFlow(flowId) 是同一份
const { zoomIn, zoomOut, fitView } = useVueFlow(editor.flowId)

// ---------- 需求5：左右侧栏默认收起，把宽度让给画布 ----------
const leftCollapsed = ref(true)
const rightCollapsed = ref(true)

/**
 * 选中节点 / 连线时自动展开右栏。
 *
 * 🔴 这条自动展开是「默认收起」能成立的前提：属性面板是配置节点的<b>唯一</b>入口
 *    （画布上没有第二个抽屉或弹窗能干这事）。若点中一个节点而右边什么都不弹，
 *    用户的合理结论是「设计器坏了」或「这个节点不可配置」，而不是「哦，我要先去点右边那条竖杆」。
 *
 * 🔴 只自动展开、绝不自动收起：用户可能刚手动收起右栏好把整张图看全，此时若因为「取消选中」
 *    就替他收起、又因为「选中」替他展开，侧栏会跟着每一次点击来回抽动。手动收起表达的意图
 *    应当被尊重，直到下一次真的出现「有新东西要配」。
 */
watch(
  [() => editor.selectedNodeId.value, () => editor.selectedEdge.value],
  ([nodeId, edge]) => {
    if (nodeId || edge) {
      rightCollapsed.value = false
    }
  }
)

// ---------- 撤销 / 重做（editorHistory 快照栈 + deep watch 捕获就地突变） ----------
const history = createHistory<EditorDsl>()
const canUndo = ref(false)
const canRedo = ref(false)
const historyReady = ref(false)
const historyApplying = ref(false)
const syncHistoryFlags = () => {
  canUndo.value = history.canUndo()
  canRedo.value = history.canRedo()
}

watch(
  dslObject,
  () => {
    if (!historyReady.value || historyApplying.value) return
    history.push(dslObject.value)
    syncHistoryFlags()
  },
  { deep: true, flush: 'post' }
)

const applySnapshot = (snap: EditorDsl) => {
  historyApplying.value = true
  dslObject.value = cloneDeep(snap)
  // 换引用会触发 useWorkflowEditor 的 ref-watch 重算画布；待其跑完再解锁，避免把这次替换又当新编辑入栈
  nextTick(() => {
    historyApplying.value = false
  })
}
const handleUndo = () => {
  const s = history.undo()
  if (!s) return
  applySnapshot(s)
  syncHistoryFlags()
  markDirty()
}
const handleRedo = () => {
  const s = history.redo()
  if (!s) return
  applySnapshot(s)
  syncHistoryFlags()
  markDirty()
}
// 重新布局后顺手适配视野：自动分层可能把节点摊得比原来宽/高，不适配的话右边一截会跑到可视区外。
// 等 DOM 更新且 VueFlow 量到新尺寸再 fitView，setTimeout 比 nextTick 稳（同 Designer 里 devMode 的处理）。
const handleRelayout = () => {
  editor.relayout()
  setTimeout(() => fitView({ padding: 0.2 }), 150)
}
const resetHistory = () => {
  history.reset(cloneDeep(dslObject.value))
  historyReady.value = true
  syncHistoryFlags()
}

// 描述经右栏 v-model 回写 formData，这里监听标脏
watch(() => formData.value.description, markDirty)

const statusLabel = computed(() =>
  status.value === 'PUBLISHED' ? '已发布' : status.value === 'DISABLED' ? '已停用' : '草稿'
)
const statusTagType = computed<'info' | 'success' | 'warning'>(() =>
  status.value === 'PUBLISHED' ? 'success' : status.value === 'DISABLED' ? 'warning' : 'info'
)

/** 把 DSL 原文解析进画布事实源；非法 JSON 返回 false（画布降级为 empty） */
const loadDslText = (text: string): boolean => {
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    dslObject.value = parsed
    canvasReady.value = true
    return true
  } catch {
    canvasReady.value = false
    return false
  }
}

/** 当前 DSL 原文：优先取画布（含坐标写回），画布不可用时退回表单字段 */
const currentDslText = (): string => {
  if (canvasReady.value) {
    const text = editor.getDslText()
    formData.value.dsl = text
    return text
  }
  return formData.value.dsl
}

const loadDef = async (id: number) => {
  loading.value = true
  historyReady.value = false // 载入期间不记历史
  try {
    const data = await AgentWorkflowApi.getDef(id)
    isEdit.value = true
    status.value = data.status ?? 'DRAFT'
    // 仅 DRAFT 可编辑（后端 updateDef 对非草稿抛 WORKFLOW_DEF_NOT_DRAFT）；其余状态只读展示
    readonly.value = status.value !== 'DRAFT'
    formData.value = {
      id: data.id,
      code: data.code,
      name: data.name,
      dsl: data.dsl ?? '',
      description: data.description ?? ''
    }
    if (!loadDslText(formData.value.dsl || '{}')) {
      message.error('这条流程的配置数据损坏，无法打开画布编辑')
    }
    // 等 description 的 watch 因整体赋值触发、标脏一次后，再把 dirty 归零
    await nextTick()
    dirty.value = false
    resetHistory()
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  const id = Number(route.query.id)
  if (route.query.id && Number.isFinite(id) && id > 0) {
    loadDef(id)
  } else {
    // Req 2：新增走列表弹窗建草稿后带 id 进来；设计器不再凭空新建，无有效 id 直接回列表
    message.warning('缺少流程标识，请从列表页「新增」或「设计」进入')
    replace({ path: '/ai/agent/workflow' })
  }
})

/** 调后端双层校验并落到 validateResult；返回结果对象（DSL 为空则提示并返回 null）。不弹 toast */
const runValidate = async (): Promise<AgentWorkflowDefValidateVO | null> => {
  const dsl = currentDslText()
  if (!dsl?.trim()) {
    message.warning('流程内容为空，无法体检')
    return null
  }
  validating.value = true
  try {
    // 🔴 带上当前这条定义的 id（台账 #81）：后端按它数「本 code 名下真跑过几次」，
    //    据此给**已落地的撞车**降一档（表名被占用的正是它自己早先建的那张表）。
    //    体检的是画布上这份**未保存**的 dsl，身份取的却是库里那一行 —— 两者刻意不同源，
    //    这正是 /validate 的 id 与 /manifest 的 id 语义不同的地方（见 api 里的注释）。
    //    设计器只会带着有效 id 进来（onMounted 里无 id 直接回列表），故这里不必再判空。
    const res = await AgentWorkflowApi.validateDsl(dsl, formData.value.id)
    validateResult.value = res
    return res
  } finally {
    validating.value = false
  }
}

const handleValidate = async () => {
  const res = await runValidate()
  if (!res) return
  if (res.passed) {
    // 🔴 「体检通过」说的是 DSL 结构合法，且此时干跑被拒条数恒为 0：
    //    WorkflowDslValidator.foldDryRunRejections 无条件把每条 REJECTED 折进 errors，
    //    ⟹「passed 为真 且 dryRunRejected>0」不可达。原先这里那个 warning 分支是
    //    S4a-c 之后留下的死代码（#86 路径 A 裁定：删，不复活）。
    //    干跑被拒时 passed 必为 false，用户看到的是下面的 error toast + 卡片里的红色明细。
    if (res.warnings.length) {
      message.warning(`体检通过，但有 ${res.warnings.length} 条建议调整`)
    } else {
      message.success('体检通过，没有发现问题')
    }
  } else {
    message.error(`体检未通过：还有 ${res.errors.length} 处需要修正`)
  }
}

/** 顶栏字段级校验（无 el-form rules，手动查）：返回错误文案，通过返回 '' */
const validateForm = (): string => {
  if (!formData.value.name?.trim()) return '请填写流程名称'
  if (!currentDslText()?.trim()) return '流程内容为空，请先在画布上添加节点'
  return ''
}

/**
 * 保存（软门禁）：字段校验 → 后端双层校验（有阻断错误二次确认可存草稿）→ update/create。
 * publish=true 时保存成功后再发布（发布要求校验通过，故有 error 直接拦下不进发布）。
 */
const handleSave = async (action: 'save' | 'publish') => {
  const fieldErr = validateForm()
  if (fieldErr) {
    message.warning(fieldErr)
    return
  }
  const res = await runValidate()
  if (!res) return
  if (!res.passed) {
    if (action === 'publish') {
      message.error(`还有 ${res.errors.length} 处需要修正，暂时无法发布；请改好后再试（也可以先保存草稿）`)
      return
    }
    try {
      await message.confirm(
        `这条流程还有 ${res.errors.length} 处需要修正，仍要先保存为草稿吗？草稿还不能运行，可以稍后改好再发布。`
      )
    } catch {
      return
    }
  }

  saving.value = true
  savingAction.value = action
  try {
    const payload: AgentWorkflowDefSaveVO = { ...formData.value, dsl: currentDslText() }
    const wasCreate = !isEdit.value
    let id = payload.id
    if (isEdit.value && id) {
      await AgentWorkflowApi.updateDef(payload)
    } else {
      id = await AgentWorkflowApi.createDef(payload)
      isEdit.value = true
      formData.value.id = id
      status.value = 'DRAFT'
      readonly.value = false
      replace({ name: 'AgentWorkflowEditor', query: { id: String(id) } })
    }
    dirty.value = false

    if (action === 'publish' && id) {
      await AgentWorkflowApi.publishDef(id)
      status.value = 'PUBLISHED'
      readonly.value = true // 已发布不可再改（要改走版本回滚生成新草稿）
      message.success('已保存并发布')
    } else {
      message.success(wasCreate ? '新建成功（草稿）' : '保存成功')
    }
    validateResult.value = undefined
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
  push({ path: '/ai/agent/workflow' })
}
</script>

<style lang="scss">
/*
  Req4：流程设计器的字号 / 字族令牌。
  🔴 之前各处字号是硬编码的 10/11/12/13/14/15px 混着来，同类信息（节点名、字段标签、提示语）在不同面板里
     大小不一，看着就"参差不齐"。收敛成 4 档 + 一个等宽字族后，改一处即全局生效。
  🔴 挂在 :root 而不是 .wf-editor 上，是因为设计器里有三处 append-to-body 的浮层（沙箱抽屉、JSON 放大弹窗、
     分支选择弹窗）——它们被 teleport 到 body 下，挂在 .wf-editor 上的变量继承不过去，那些面板就会退回浏览器
     默认 16px。命名带 --wf- 前缀，不会与 Element / 全站变量撞。
  这块刻意不 scoped：scoped 的 :root 会被编译成 :root[data-v-xxx]，永远匹配不上。
*/
:root {
  --wf-fs-xs: 11px;
  --wf-fs-sm: 12px;
  --wf-fs-md: 13px;
  --wf-fs-lg: 15px;
  --wf-mono: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, 'Courier New', monospace;
  --wf-lh: 1.6;
}
</style>

<style lang="scss" scoped>
.wf-editor {
  display: flex;
  height: calc(100vh - var(--top-tool-height) - var(--tags-view-height) - var(--app-content-padding) * 2);
  min-height: 640px;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-bg-color-page);
}

.wf-editor__header {
  display: flex;
  min-height: 52px;
  padding: 6px 14px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
  align-items: center;
  gap: 12px;
  row-gap: 6px;
  justify-content: space-between;
  flex-shrink: 0;
  /*
   * 🔴 Req4 把缩放/开发者模式搬上顶栏后，动作区在 1280px 下约 1000px 宽。
   *   若顶栏不许换行，flex 会把身份区（名称/编码输入框）压到 0 宽——输入框肉眼直接消失，
   *   而 toHaveValue 这类断言不要求可见，会静默放过。所以这里允许换行，并给身份区一个
   *   不可压缩的下限：窄屏时动作区整体掉到第二行，而不是吃掉输入框。
   */
  flex-wrap: wrap;
}

.wf-editor__identity,
.wf-editor__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wf-editor__identity {
  min-width: 480px;
  flex: 1 1 480px;
}

.wf-editor__actions {
  flex: 0 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.wf-editor__history {
  display: flex;
  align-items: center;
  gap: 4px;

  :deep(.el-button) {
    margin-left: 0;
  }
}

.wf-editor__sep {
  height: 20px;
  margin: 0 4px;
}

.wf-editor__dev {
  display: flex;
  padding: 0 4px;
  align-items: center;
  gap: 6px;
}

.wf-editor__dev-label {
  font-size: var(--wf-fs-sm, 12px);
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.wf-editor__meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.wf-editor__name {
  width: 200px;
}

.wf-editor__code {
  width: 170px;
}

.wf-editor__name :deep(.el-input__wrapper),
.wf-editor__code :deep(.el-input__wrapper) {
  padding: 0;
  box-shadow: none;
}

.wf-editor__name :deep(input) {
  font-size: var(--wf-fs-lg, 15px);
  // 650 是非法字重（浏览器会就近取 700），与全站标题的 600 不一致，故统一到 600
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.wf-editor__code :deep(input) {
  font-size: var(--wf-fs-sm, 12px);
  font-family: var(--wf-mono, monospace);
  color: var(--el-text-color-secondary);
}

.wf-editor__ro {
  font-size: var(--wf-fs-sm, 12px);
  color: var(--el-color-warning);
}

.wf-editor__validate {
  padding: 8px 14px 0;
  flex-shrink: 0;
}

.wf-editor__validate-list {
  margin: 2px 0 0;
  padding-left: 18px;

  li {
    font-size: var(--wf-fs-sm, 12px);
    line-height: 20px;
  }
}

.wf-editor__body {
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.wf-editor__main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
}

/*
  侧栏收起/展开竖条（需求5）。
  🔴 由 flex 布局接管宽度分配后，这里不再需要「右栏 348px」的副本——
     此前 grid-template-columns 里写死一份、.wf-panel 里写死一份，两处必须同步改，漏一处就会
     出现「面板宽度和留白对不上」的错位。现在宽度只由各侧栏自己声明。
*/
.wf-rail {
  display: flex;
  width: 16px;
  flex-shrink: 0;
  flex-direction: column;
  padding: 8px 0;
  border: 0;
  /*
    用底色而不是边框来标出这条把手：左栏 .wf-palette 自带 border-right、右栏 .wf-panel 自带 border-left，
    把手再加一道边框就成了「两条紧挨着的竖线」，看着像渲染错位。
  */
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  align-items: center;
  gap: 6px;
  transition: background 0.15s;

  &:hover {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }
}

.wf-rail--collapsed {
  width: 26px;
}

.wf-rail__label {
  font-size: var(--wf-fs-xs, 12px);
  line-height: 16px;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
}

.wf-editor__broken {
  flex: 1;
}

.wf-editor__route-tip {
  margin-bottom: 10px;
  font-size: var(--wf-fs-md, 13px);
  line-height: 20px;
  color: var(--el-text-color-regular);
}

.wf-editor__route-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

/*
 * 🔴 Req4 两侧栏各加宽了（左 168→186、右 320→348，合计吃掉画布 46px），这个断点【刻意没有跟着抬高】：
 *   右栏是配置节点属性的唯一入口（画布上没有第二个抽屉/弹窗能做这件事），一旦隐藏就等于
 *   1100–1160px 这一段的用户只能看图不能改，功能损失比画布窄 46px 严重得多。
 *   所以宁可让最窄一档的画布从 372px 缩到 326px，也要保住属性面板可用。
 */
@media (width <= 1100px) {
  .wf-panel {
    display: none;
  }

  /*
    🔴 竖条必须跟着一起藏：它是「展开右栏」的唯一开关，而右栏在这一档被 display:none 掉了，
       留着就是一个点了没反应的死按钮——比没有按钮更让人怀疑页面坏了。
       此时右栏的配置能力整体不可用（与改动前的行为一致），要配置请把窗口拉宽到 1100px 以上。
  */
  .wf-rail--right {
    display: none;
  }
}
</style>
