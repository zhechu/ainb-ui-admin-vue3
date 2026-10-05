<template>
  <div ref="chatRootRef" class="flex flex-col min-w-0 h-full">
    <!-- 滚动区与「回到底部」按钮同处一个相对定位容器，按钮才能贴着滚动区底部，
         而不是去猜输入区有多高（compact 与非 compact 的输入区高度不一样） -->
    <div class="relative flex-1 min-h-0">
      <el-scrollbar
        ref="scrollbarRef"
        class="h-full"
        data-testid="assistant-scroll"
        :class="compact ? 'px-14px' : 'px-24px'"
        @scroll="handleScroll"
      >
        <!-- 空态：给引导问题（对标简道云的「预设高频引导问题」） -->
        <div
          v-if="messageList.length === 0"
          class="flex flex-col items-center"
          :class="compact ? 'pt-40px' : 'pt-80px'"
        >
          <Icon
            icon="ep:magic-stick"
            :size="compact ? 36 : 48"
            class="text-[var(--el-color-primary)]"
          />
          <div class="mt-16px font-medium" :class="compact ? 'text-16px' : 'text-18px'">
            {{ activeAgentInfo.title }}
          </div>
          <div class="mt-8px text-14px text-[var(--el-text-color-secondary)] text-center px-16px">
            {{ activeAgentInfo.subtitle }}
          </div>
          <!-- 「继续上次对话」：只在悬浮窗（offerResume）里出现。独立页左边就是完整列表，
               再叠一个恢复入口是冗余。用 el-button 而不是 el-tag —— e2e 靠 .el-tag__content
               定位引导问题与建议，混进去会撞 strict mode -->
          <el-button
            v-if="offerResume && resumeTarget"
            data-testid="assistant-resume"
            class="mt-16px max-w-90%"
            @click="handleResume"
          >
            <Icon icon="ep:refresh-left" class="mr-4px flex-shrink-0" />
            <el-tooltip :content="`继续上次对话：${resumeTarget.title}`" placement="top">
              <span class="truncate">继续上次对话：{{ resumeTarget.title }}</span>
            </el-tooltip>
          </el-button>
          <div class="flex flex-wrap gap-10px mt-24px justify-center max-w-560px" v-if="!effectiveAgentDefId">
            <el-tag
              v-for="(q, i) in GUIDE_QUESTIONS"
              :key="i"
              class="cursor-pointer !px-14px !py-18px"
              type="info"
              effect="plain"
              round
              @click="handleSend(q)"
            >
              {{ q }}
            </el-tag>
          </div>
        </div>

        <!-- 消息列表 -->
        <div v-for="(item, index) in messageList" :key="index" class="py-16px">
          <!-- 用户：靠右 -->
          <div v-if="item.role === 'user'" class="flex flex-row-reverse">
            <el-avatar class="flex-shrink-0 ml-12px" :size="34">
              <Icon icon="ep:user" />
            </el-avatar>
            <div
              class="max-w-70% px-14px py-10px rounded-10px bg-[var(--el-color-primary-light-9)] whitespace-pre-wrap break-words"
            >
              {{ item.content }}
            </div>
          </div>

          <!-- 助手：靠左 -->
          <div v-else class="flex group">
            <el-avatar class="flex-shrink-0 mr-12px bg-[var(--el-color-primary)]" :size="34">
              <Icon icon="ep:magic-stick" />
            </el-avatar>
            <div class="flex-1 min-w-0">
              <!-- Workflow 草稿卡片（生成中 / 待确认 / 已发布可运行 / 已结束） -->
              <WorkflowDraftCard
                v-if="item.cardStatus"
                :status="item.cardStatus"
                :planning-text="item.planningText"
                :summary="item.summary || item.content"
                :warnings="item.warnings"
                :rounds="item.rounds"
                :nodes="item.nodes"
                :edges-text="item.edgesText"
                :def-status="item.defStatus"
                :running="item.running"
                :run-progress="item.runProgress"
                :run-result="item.runResult"
                :run-error="item.runError"
                :confirmable="!!item.hitl"
                :manifest="item.manifest"
                @confirm="() => handleConfirmWorkflow(item)"
                @cancel="() => handleCancelWorkflow(item)"
              />

              <!-- HITL 确认卡片（增量13）：流程走到人工闸口，就在聊天里问「同意/拒绝」，
                   不再把用户支去「工作流执行历史」里恢复。三态由 item.hitl 承载：
                   待确认（decided=null）→ 续跑中（running）→ 已处理（decided 有值）。
                   🔴 用独立 v-if 而不是 v-else-if：草稿卡「运行」撞闸口时（2026-09-29 修的死路），
                      同一条消息上草稿卡与确认卡要<b>同时</b>在 —— 上面看跑到哪了、下面做决定。 -->
              <HitlConfirmCard
                v-if="item.hitl"
                :content="item.hitl.content"
                :node-id="item.hitl.nodeId"
                :node-name="item.hitl.nodeName"
                :manifest="item.hitl.manifest"
                :manifest-loading="item.hitl.manifestLoading"
                :manifest-error="item.hitl.manifestError"
                :running="item.hitl.running"
                :decided="item.hitl.decided"
                :error="item.hitl.error"
                @decide="(approved) => handleHitlDecision(item, approved)"
              />

              <!-- 普通问答气泡 -->
              <template v-if="!item.cardStatus && !item.hitl">
                <div
                  class="px-14px py-10px rounded-10px bg-[var(--el-fill-color-light)] break-words"
                >
                  <MessageReasoning
                    :reasoning-content="item.reasoningContent || ''"
                    :content="item.content || ''"
                    auto-collapse-on-answer
                  />
                  <!-- 还没吐出第一个字时给个占位，否则界面看起来像卡住了 -->
                  <MessageLoadingDots v-if="!item.content && item.status === 'STREAMING'" />
                  <!-- data-testid 是给 e2e 用的：思维链内部也渲染 MarkdownView，
                       不加标记的话断言会命中思维链 —— 模型「想过」就算通过，
                       哪怕最终一个字都没答出来 -->
                  <MarkdownView v-else data-testid="assistant-answer" :content="item.content" />

                  <el-alert
                    v-if="item.status === 'ERROR'"
                    :title="item.errorMsg"
                    type="error"
                    :closable="false"
                    class="mt-8px"
                  />

                  <!-- 引用出处：复用 ai/chat 的知识引用组件 -->
                  <MessageKnowledge v-if="item.references?.length" :segments="item.references" />
                </div>
                <!-- 整段复制。MarkdownView 自带的复制只覆盖代码块，答案正文复制不出来 -->
                <div
                  v-if="item.status === 'SUCCESS' && item.content"
                  class="mt-4px opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <el-button
                    link
                    size="small"
                    data-testid="assistant-copy"
                    @click="handleCopy(item.content)"
                  >
                    <Icon icon="ep:document-copy" class="mr-2px" /> 复制
                  </el-button>
                </div>
              </template>

              <!-- 对话后建议：只在最后一条上显示，历史消息的建议已经过期了 -->
              <SuggestionBar
                v-if="index === messageList.length - 1 && !streaming && !item.cardStatus && !item.hitl"
                :suggestions="item.suggestions"
                @select="handleSuggestion"
              />
            </div>
          </div>
        </div>
      </el-scrollbar>

      <!-- 回到底部：用户往上翻看历史时不要把他拽回去，给个显式入口 -->
      <div
        v-if="showBackToBottom"
        class="absolute bottom-12px left-1/2 -translate-x-1/2 z-10"
      >
        <el-button circle size="small" data-testid="scroll-to-bottom" @click="handleBackToBottom">
          <Icon icon="ep:arrow-down-bold" />
        </el-button>
      </div>
    </div>

    <!-- 输入区 -->
    <div
      class="relative flex-shrink-0 border-t border-[var(--el-border-color-lighter)] border-t-solid"
      :class="compact ? 'px-14px py-12px' : 'px-24px py-16px'"
    >
      <!--
        上缘拖拽把手：往上拖把输入框拉高（2026-09-29 二轮：贴长提示词时不用滚着看）。
        🔴 放在输入区顶边而不是用 textarea 原生 resize 角：原生角标在右下角、只有 10px 见方，
           而且横向也能拖（会把输入框拖得比发送行还宽）；顶边一条整宽热区更符合「往上拉高」的直觉。
      -->
      <div
        class="agent-input-resize"
        data-testid="chat-input-resize"
        title="拖拽调整输入框高度"
        @mousedown.prevent="startInputResize"
        @dblclick="resetInputHeight"
      ></div>
      <div
        ref="inputWrapRef"
        class="agent-input-wrap"
        :style="inputHeight ? { height: `${inputHeight}px` } : undefined"
      >
        <el-input
          ref="inputRef"
          v-model="inputText"
          type="textarea"
          :rows="compact ? 2 : 3"
          resize="none"
          :maxlength="INPUT_MAX_LENGTH"
          show-word-limit
          placeholder="问点什么吧，Enter 发送 / Shift+Enter 换行"
          @keydown.enter="handleEnter"
        />
      </div>
      <!-- 需求8：Agent 选择器与发送按钮同处一行（原来独占一行、白占 40px 竖向空间）。
           🔴 会话一旦建立（innerConversationId 有值）就锁定：D4「创建时定、之后以会话为准」，
           防一轮对话中途换 Agent 导致历史里混两套人设。新建对话（未落库）时可自由选。
           compact（悬浮球）下收窄但不隐藏，否则悬浮球无法选 Agent。 -->
      <div class="flex items-center gap-8px mt-10px">
        <!-- 需求7：提示词模板。放在最左边——它是「往输入框里放字」的动作，与右侧的「发出去」相对。
             🔴 用 popover 而不是 el-select：模板项要显示名称+说明两行，select 的选项行装不下，
             而只显示名称的话用户分不清两条相似的模板该选哪条。 -->
        <el-popover
          :visible="templatePopoverVisible"
          placement="top-start"
          :width="compact ? 300 : 420"
          trigger="click"
          popper-class="agent-tpl-popover"
        >
          <template #reference>
            <el-button
              data-testid="template-picker"
              :size="compact ? 'small' : 'default'"
              :disabled="streaming"
              @click="openTemplatePopover"
            >
              <Icon icon="ep:collection" class="mr-4px" /> 模板
            </el-button>
          </template>
          <div v-loading="templateLoading || caseLoading" class="agent-tpl-body">
            <!--
              S7：模板 / 示例 两个页签。
              🔴 为什么是页签而不是把示例挂在每条模板下面：这个 popover 只有 300~420px 宽、
                 40 条模板已经要滚六七屏，再给每条塞一行可展开的示例，找一条模板的成本翻倍。
                 页签把「我想问点什么」（模板）和「别人是怎么问的」（示例）分成两个动作，
                 各自都能一屏扫完。分组标题仍用模板名，两者的对应关系没丢。
            -->
            <el-radio-group v-model="tplTab" size="small" class="mb-8px w-full" @change="onTplTabChange">
              <el-radio-button value="template" class="flex-1">模板</el-radio-button>
              <el-radio-button value="case" class="flex-1" data-testid="tpl-tab-case">示例</el-radio-button>
            </el-radio-group>
            <el-input
              v-model="templateKeyword"
              size="small"
              clearable
              :placeholder="tplTab === 'template' ? '搜名称 / 正文 / 分类' : '搜标题 / 正文 / 所属模板'"
              class="mb-8px"
            >
              <template #prefix>
                <Icon icon="ep:search" />
              </template>
            </el-input>
            <!--
              🔴 Req5：模板从 6 条扩到 40 条（10 个分类），320px 的窗口要滚六七屏才翻得完，
                 「点开模板看看平台能干什么」这个用途就废了。改成跟视口走：够高就多显示，
                 小屏（悬浮球抽屉）也不会顶出屏幕。空间不够时 popper 会自己翻到下方，不用管。
            -->
            <el-scrollbar max-height="min(56vh, 520px)">
              <!-- ==================== 模板页签 ==================== -->
              <template v-if="tplTab === 'template'">
                <div v-if="!groupedTemplates.length" class="agent-tpl-empty">
                  {{ templateList.length ? '没有匹配的模板' : '还没有可用的模板，管理员可在「提示词模板」页新建' }}
                </div>
                <div v-for="g in groupedTemplates" :key="g.category" class="agent-tpl-group">
                  <div class="agent-tpl-group-title">{{ g.category }}</div>
                  <div
                    v-for="t in g.items"
                    :key="t.id"
                    class="agent-tpl-item"
                    data-testid="tpl-item"
                    @click="applyTemplate(t)"
                  >
                    <div class="agent-tpl-item-name">{{ t.name }}</div>
                    <div v-if="t.description" class="agent-tpl-item-desc">{{ t.description }}</div>
                  </div>
                </div>
              </template>
              <!-- ==================== 示例页签 ==================== -->
              <template v-else>
                <div v-if="!groupedCases.length" class="agent-tpl-empty">
                  {{ caseList.length ? '没有匹配的示例' : '还没有可用的示例，管理员可在「提示词模板」页展开某条模板维护' }}
                </div>
                <div v-for="g in groupedCases" :key="g.templateId" class="agent-tpl-group">
                  <div class="agent-tpl-group-title">{{ g.templateName }}</div>
                  <div
                    v-for="c in g.items"
                    :key="c.id"
                    class="agent-tpl-item"
                    data-testid="case-item"
                    :data-case-id="c.id"
                    @click="applyCase(c)"
                  >
                    <div class="agent-tpl-item-name">{{ c.title }}</div>
                    <!-- 🔴 摘要只显示第一行：完整正文点进去就在输入框里了，
                         这里全展开会把 40 条示例变成一篇没法扫读的文章 -->
                    <div class="agent-tpl-item-desc">{{ firstLineOf(c.content) }}</div>
                  </div>
                </div>
              </template>
            </el-scrollbar>
            <div class="agent-tpl-foot">
              {{
                tplTab === 'template'
                  ? '点一条模板即插入到输入框，占位符替换后再发送'
                  : '点一条示例即插入到输入框，正文已填好，可以直接发'
              }}
            </div>
          </div>
        </el-popover>
        <span class="text-12px text-[var(--el-text-color-secondary)] flex-shrink-0">Agent</span>
        <el-select
          v-model="agentSelectorModel"
          data-testid="agent-picker"
          :disabled="isAgentLocked"
          :size="compact ? 'small' : 'default'"
          :class="compact ? 'w-120px' : 'w-180px'"
          class="flex-shrink-0"
          placeholder="默认平台助手"
        >
          <el-option label="默认平台助手" :value="0" />
          <el-option v-for="a in agentDefList" :key="a.id" :label="a.name" :value="a.id" />
        </el-select>
        <el-tooltip
          v-if="isAgentLocked"
          content="会话已绑定 Agent，不可中途更换；点「新对话」可重新选择"
          placement="top"
        >
          <Icon icon="ep:lock" class="text-[var(--el-text-color-secondary)] flex-shrink-0" />
        </el-tooltip>
        <!-- 这句提示原来单独占一行。flex-1 + truncate 让它把按钮顶到最右，
             窄屏（悬浮球）下先被截断而不是把「发送」挤出去；compact 下直接不显示文字，
             但仍保留这个占位元素，否则按钮会贴到选择器右边 -->
        <span class="flex-1 min-w-0 truncate text-12px text-[var(--el-text-color-secondary)]">
          {{ compact ? '' : agentHint }}
        </span>
        <div class="flex-shrink-0">
          <el-button v-if="streaming" :size="compact ? 'small' : 'default'" @click="handleStop">
            <Icon icon="ep:video-pause" class="mr-4px" /> 停止
          </el-button>
          <el-button
            v-else
            type="primary"
            :size="compact ? 'small' : 'default'"
            :disabled="!inputText.trim()"
            @click="handleSend()"
          >
            <Icon icon="ep:promotion" class="mr-4px" /> 发送
          </el-button>
        </div>
      </div>
    </div>

    <!-- S4b：「确认并运行」被发布闸门拦下时，逐条列出要改什么。
         🔴 挂在根节点下而不是卡片里：卡片在 v-for 内，一次只会有一条流程在确认，
            挂一份全局的比每条消息各挂一个对话框省得多，且 el-dialog 本来就 append-to-body。 -->
    <PublishGateDialog ref="gateRef" @design="goDesignFromGate" />
  </div>
</template>

<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { AgentAssistantApi } from '@/api/agent/assistant'
import type {
  AgentConversationVO,
  AgentMessageVO,
  AgentSuggestionVO
} from '@/api/agent/assistant'
import { AgentDefApi, type AgentDefVO } from '@/api/agent/def'
import {
  AgentPromptTemplateApi,
  placeholdersOf,
  UNCATEGORIZED,
  type AgentPromptTemplateVO
} from '@/api/agent/promptTemplate'
import {
  AgentPromptTemplateCaseApi,
  type AgentPromptTemplateCaseVO
} from '@/api/agent/promptTemplateCase'
import { AgentPlannerApi } from '@/api/agent/planner'
import type { AgentWorkflowDraftVO } from '@/api/agent/planner'
import { AgentWorkflowApi } from '@/api/agent/workflow'
import {
  buildSummaryNodes,
  flowStepsText,
  type SummaryNode
} from '@/views/agent/workflow/nodeSummary'
import {
  ensureLoaded as ensureNameCatalog,
  nameResolver
} from '@/views/agent/workflow/nameCatalog'
import PublishGateDialog from '@/views/agent/workflow/components/PublishGateDialog.vue'
import { precheckPublish } from '@/views/agent/workflow/publishGate'
import SuggestionBar from './SuggestionBar.vue'
import MessageLoadingDots from './MessageLoadingDots.vue'
import WorkflowDraftCard from './WorkflowDraftCard.vue'
import HitlConfirmCard from './HitlConfirmCard.vue'
import MessageReasoning from '@/views/ai/chat/index/components/message/MessageReasoning.vue'
import MessageKnowledge from '@/views/ai/chat/index/components/message/MessageKnowledge.vue'

/**
 * 助手对话区
 *
 * <h3>为什么要把它从助手页里抽出来</h3>
 * 方案 §12 要求助手有<b>两个入口</b>：独立页面，以及任何页面上都能唤起的全局悬浮窗。
 * 两个入口的对话行为必须完全一样 —— 流式打字机、Workflow 草稿卡、建议、中断，一条都不能差。
 *
 * <p>如果悬浮窗自己再写一份，这些逻辑就会各自漂移。而漂移在这里格外难查：
 * 两边都「能用」，只是某一边的草稿卡不刷新、或者某一边的 SSE 忘了 abort
 * （fetchEventSource 的 onerror 不 throw 就会<b>自动无限重连</b>，
 * 表现是同一个问题被反复提交、反复计费，界面上什么都看不出来）。
 *
 * <p>所以对话区只有一份，在这里；两个入口都用它。
 * 会话列表<b>不</b>在这里 —— 那是外层的事（独立页在左侧，悬浮窗在「历史会话」视图）。
 */
defineOptions({ name: 'AssistantChat' })

const props = defineProps<{
  /** 当前会话编号。为空表示「新对话」，真发第一句话时后端会自动建 */
  conversationId?: number
  /**
   * 当前会话已绑定的 Agent 定义编号（由外层从会话列表的 agentDefId 传入）；空=默认平台助手。
   * 🔴 只在「既有会话」时有意义：会话一旦落库，选择器以它为准并锁定（D4）。
   * 本会话内新建的会话不靠它——那条由 pendingNewAgentDefId 兜住（外层列表刷新有延迟）。
   */
  agentDefId?: number | null
  /** 紧凑模式：悬浮窗里空间有限，缩小留白、少显示几句说明 */
  compact?: boolean
  /**
   * 空态时是否提供「继续上次对话」入口。只有悬浮窗传 true ——
   * 独立页左边就是完整会话列表，不需要这个冗余入口
   */
  offerResume?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:conversationId', id: number | undefined): void
  /** 会话有变化（新建、标题更新）时通知外层刷新列表 */
  (e: 'conversation-updated'): void
}>()

const message = useMessage()
const { copy } = useClipboard({ legacy: true })

/**
 * 引导问题（方案 §10）
 *
 * 用户往往<b>看到东西才知道自己要什么</b>。空白输入框加一个光标，
 * 多数人的第一反应是「我该问什么」然后关掉页面。
 * 这几个问题刻意选的是手册里确实覆盖、且答得出彩的 —— 第一次体验决定他还会不会再来。
 */
const GUIDE_QUESTIONS = [
  '为什么我配的联动不生效',
  '怎么配主子表',
  '字段权限怎么配',
  '表单发布后菜单看不到怎么办'
]

const messageList = ref<any[]>([])
const inputText = ref('')
const streaming = ref(false)
const scrollbarRef = ref()
const inputRef = ref()

/**
 * 输入框高度的手动拉伸
 *
 * 原来 textarea 写死 rows=3、resize:none，粘贴一段长提示词进去只能靠内部滚动条来回看，
 * 想边看边改更是没办法 —— 这是「录入提示词」这个主场景上的硬伤。
 * 改成：往上拖输入区顶边把框拉高，双击顶边恢复默认。
 *
 * 🔴 只在用户拖过之后才写 height（inputHeight 为 null 时不加内联样式），
 *    这样默认的 3 行外观、以及 compact 模式的 2 行外观都由 rows 决定，
 *    不会因为写死像素值而在悬浮球/整页两种形态下走形。
 */
const inputWrapRef = ref<HTMLElement>()
const chatRootRef = ref<HTMLElement>()
const inputHeight = ref<number | null>(null)
const MIN_INPUT_HEIGHT = 64
const MAX_INPUT_HEIGHT = 480
/** 拉高输入框时给消息区留的底线：低于这个值，用户就没法「边看回答边补提示词」了 */
const MIN_MESSAGE_AREA = 160

const startInputResize = (e: MouseEvent) => {
  const wrap = inputWrapRef.value
  const startHeight = wrap?.offsetHeight ?? 110
  const startY = e.clientY
  /**
   * 上限按「对话区自己的高度」算，不能按 window.innerHeight 算。
   *
   * 🔴 踩过一次：用 0.6 * innerHeight，在 720 高的窗口里能拖到 432px，
   *    而对话区本身只有约 600px（上面还有导航栏、标签页），扣掉输入区自己的
   *    发送行与内边距（约 85px）之后，消息区只剩 83px —— 输入框是大了，
   *    回答却看不见了，等于把一个滚动问题换成了另一个。
   * 所以这里量的是真实可用的两根尺寸：对话区根高、输入区里除了 textarea 之外的固定开销。
   */
  const rootHeight = chatRootRef.value?.clientHeight ?? window.innerHeight
  const chrome = (wrap?.parentElement?.offsetHeight ?? 0) - startHeight
  const maxHeight = Math.min(
    MAX_INPUT_HEIGHT,
    Math.max(MIN_INPUT_HEIGHT, rootHeight - chrome - MIN_MESSAGE_AREA)
  )
  const onMove = (ev: MouseEvent) => {
    // 往上拖（clientY 变小）= 变高
    const next = startHeight + (startY - ev.clientY)
    inputHeight.value = Math.min(maxHeight, Math.max(MIN_INPUT_HEIGHT, next))
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  // 拖动期间锁定光标与选区，否则鼠标一快就滑出热区、把页面文字刷成选中态
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

const resetInputHeight = () => {
  inputHeight.value = null
}

/**
 * 是否跟随底部滚动
 *
 * 🔴 这是本次最实质的体验修复。打字机每吐一个字就 scrollToBottom 一次，
 * 用户往上翻看早先的回答时会被不停地拽回底部 —— 想看的内容永远停不住。
 * 改成「只有本来就在底部时才跟随」，翻上去就放手，并给一个「回到底部」按钮。
 */
const autoFollow = ref(true)

/** 空态下「继续上次对话」指向的会话 */
const resumeTarget = ref<AgentConversationVO>()

/**
 * 会话编号的内部镜像
 *
 * 不直接改 prop。新会话的编号是在流的 META 事件里才拿到的，
 * 那一刻要同时更新自己和外层 —— 只 emit 不存本地的话，
 * 紧接着的下一条消息还会带着空会话号发出去，于是每句话都新建一个会话。
 */
const innerConversationId = ref<number | undefined>(props.conversationId)
watch(
  () => props.conversationId,
  (val) => {
    innerConversationId.value = val
  }
)

// ==================== Agent 选择（增量10 slice-2）====================

/** 已发布 Agent 目录：作选择器选项 + id→名字映射（D7：会话 RespVO 只带 id，名字前端映射） */
const agentDefList = ref<AgentDefVO[]>([])
const loadAgentDefs = async () => {
  try {
    const page = await AgentDefApi.getDefPage({ pageNo: 1, pageSize: 100, status: 'PUBLISHED' })
    // 🔴 需求10：把系统内置行（默认平台助手）剔出去。它现在也是 PUBLISHED，不剔的话选择器里会出现
    //    两个「默认平台助手」——一个是下面硬编码的 value=0 哨兵项，一个是它的真 id。
    //    用户选中真 id 那个，后端就会按「选了自定义 Agent」路由：检索从平台内置手册切到它并不存在的
    //    知识库、追问建议消失、模型改用绑定值。不报错，只是答得越来越飘 —— 最难查的那类 bug。
    agentDefList.value = (page?.list ?? []).filter((a) => !a.builtin)
  } catch {
    agentDefList.value = [] // 拉不到目录不阻断对话：仍可走默认平台助手
  }
}
onMounted(loadAgentDefs)

// ==================== 提示词模板（需求7）====================

/**
 * 输入框字数上限。模板正文在库里最长可到 8000 字，远超这里，
 * 故插入前必须比一次 —— 见 {@link applyTemplate}。
 * 🔴 与模板里 el-input 的 :maxlength 共用这一个常量：写两处迟早会漂，
 * 漂了的表现是「明明没超上限却插不进去」或「插进去被截断半句」。
 */
const INPUT_MAX_LENGTH = 2000

const templatePopoverVisible = ref(false)
const templateLoading = ref(false)
const templateKeyword = ref('')
const templateList = ref<AgentPromptTemplateVO[]>([])

/**
 * 弹层当前页签：template=模板骨架（要自己填占位符），case=填好的示例（可直接发）
 *
 * <p>S7 加第二个页签，而不是把示例挂在每条模板下面：popover 只有 300~420px 宽、
 * 40 条模板已经要滚六七屏，再给每条塞一行可展开的示例，找一条模板的成本翻倍。
 */
const tplTab = ref<'template' | 'case'>('template')
const caseLoading = ref(false)
const caseList = ref<AgentPromptTemplateCaseVO[]>([])
/** 本次弹层内已经拉过示例：来回切页签不必重复请求 */
const caseLoaded = ref(false)

const loadTemplates = async () => {
  templateLoading.value = true
  try {
    templateList.value = (await AgentPromptTemplateApi.getSimplePromptTemplateList()) ?? []
  } catch {
    // 🔴 静默失败并【保留旧列表】。这个端点用的是 hasAnyPermissions('agent:assistant:use',
    //    'agent:prompt-template:query')，能进这个页的人都有前者，所以走到这一支多半是网络抖动
    //    或后端还没重启（新端点未注册）。两种情况都不该弹错打断对话——模板只是便利品。
    //    刻意不清空：清空后按钮点开是「暂无模板」，用户会以为模板被谁删了。
  } finally {
    templateLoading.value = false
  }
}

onMounted(loadTemplates)

/**
 * 拉「示例」页签的数据。失败处置与 {@link loadTemplates} 同款：静默、且保留旧列表。
 *
 * <p>🔴 懒加载 —— 只在第一次切到「示例」时才请求。绝大多数用户只点模板，
 *    为他们在 onMounted 上多挂一个请求不值当；这两个列表都只有几十行，切过去再拉感知不到延迟。
 */
const loadCases = async () => {
  caseLoading.value = true
  try {
    caseList.value = (await AgentPromptTemplateCaseApi.getSimpleCaseList()) ?? []
    caseLoaded.value = true
  } catch {
    // 同 loadTemplates：这个端点也是 hasAnyPermissions('agent:assistant:use',
    // 'agent:prompt-template:query')，走到这一支多半是网络抖动或后端还没重启（新端点未注册）。
    // 示例只是便利品，不该弹错打断对话；也刻意不清空，清空会被读成「示例被谁删了」
  } finally {
    caseLoading.value = false
  }
}

/** 切页签：清掉上一个页签的搜索词（两个页签的匹配字段不同，留着会看起来像「什么都没搜却空了」） */
const onTplTabChange = () => {
  templateKeyword.value = ''
  if (tplTab.value === 'case' && !caseLoaded.value) loadCases()
}

/**
 * 每次展开都重取一遍
 *
 * <p>🔴 不能只在 onMounted 拉：管理员常在另一个标签页存完模板就切回来点按钮，
 * 缓存着旧列表的表现是「刚存的模板在这里找不到」——他不知道要刷新整页，只会以为没存上。
 * 这张表就几十行，重取的代价可以忽略；加载期间旧列表仍在，不会闪成空白。
 */
const openTemplatePopover = () => {
  templatePopoverVisible.value = true
  templateKeyword.value = ''
  // 🔴 回到「模板」页签并作废示例缓存：按钮上写的就是「模板」，点开却停在上次看的示例会像跳错了地方；
  //    作废缓存则与上面重取模板同一个理由 —— 管理员可能刚在另一页存完示例
  tplTab.value = 'template'
  caseLoaded.value = false
  loadTemplates()
}

/**
 * 按分类分组（组内沿用后端 category + sort + id 的升序）
 * 🔴 分类为空归入「未分类」并排在最后：不这么做的话空分类会插在最前面，
 * 而它其实是「管理员没填」而不是一个真的类别。
 * 🔴 分类之间的先后按「组内最小 sort」重排，不再沿用后端返回的顺序：后端是
 * ORDER BY category,sort，于是分类的先后落在 MySQL 中文排序规则上（按 Unicode 码点，不是拼音），
 * 结果是「表单搭建」这种一眼该排前面的分类会被排到倒数第二，而管理员在「提示词模板」页改「排序」
 * 怎么改都挪不动分类——正是本平台头号缺陷「配了但不生效」的形状。取组内最小值做组序后，
 * 排序号才真的管用：数字小的分类整体靠前，组内仍按 sort 升序。
 */
const groupedTemplates = computed(() => {
  const kw = templateKeyword.value.trim().toLowerCase()
  const filtered = kw
    ? templateList.value.filter(
        (t) =>
          (t.name ?? '').toLowerCase().includes(kw) ||
          (t.content ?? '').toLowerCase().includes(kw) ||
          (t.description ?? '').toLowerCase().includes(kw) ||
          (t.category ?? '').toLowerCase().includes(kw)
      )
    : templateList.value
  const named = new Map<string, AgentPromptTemplateVO[]>()
  let uncategorized: AgentPromptTemplateVO[] = []
  for (const t of filtered) {
    const key = t.category?.trim()
    if (!key) {
      uncategorized.push(t)
      continue
    }
    if (!named.has(key)) named.set(key, [])
    named.get(key)!.push(t)
  }
  const groups = [...named.entries()]
    .map(([category, items]) => ({
      category,
      items,
      order: Math.min(...items.map((i) => i.sort ?? Number.MAX_SAFE_INTEGER))
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ category, items }) => ({ category, items }))
  if (uncategorized.length) groups.push({ category: UNCATEGORIZED, items: uncategorized })
  return groups
})

/**
 * 「示例」页签：按所属模板分组（组内沿用后端 templateId + sort + id 的升序）
 *
 * <p>🔴 组的先后按 {@link templateList} 的顺序出，不自己再排一遍：模板列表已经是
 * 「分类 + 排序」的口径，两个页签的分组顺序一致，用户切过来才不会觉得东西被重新洗过。
 * <p>🔴 在 templateList 里找不到 templateId 的用例整组丢掉。后端 /simple-list 本就只返回
 * 「用例开启**且它的模板也开启**」的行，出现落单只可能是两次请求之间那条模板被下架了 ——
 * 此时显示成「未知模板」比不显示更让人困惑，而且点进去插入的正文对应的是一条已经不再引导的路。
 */
const groupedCases = computed(() => {
  const kw = templateKeyword.value.trim().toLowerCase()
  const nameOf = new Map(templateList.value.map((t) => [t.id, t.name ?? '']))
  const byTemplate = new Map<number, AgentPromptTemplateCaseVO[]>()
  for (const c of caseList.value) {
    const tplName = nameOf.get(c.templateId)
    if (tplName === undefined) continue
    if (kw) {
      const hit =
        (c.title ?? '').toLowerCase().includes(kw) ||
        (c.content ?? '').toLowerCase().includes(kw) ||
        tplName.toLowerCase().includes(kw)
      if (!hit) continue
    }
    if (!byTemplate.has(c.templateId)) byTemplate.set(c.templateId, [])
    byTemplate.get(c.templateId)!.push(c)
  }
  return templateList.value
    .filter((t) => byTemplate.has(t.id))
    .map((t) => ({ templateId: t.id, templateName: t.name, items: byTemplate.get(t.id)! }))
})

/**
 * 示例条目上那行摘要，只取正文的第一个非空行
 *
 * <p>正文常常是多段的，整段塞进一行会被 ellipsis 截成看不出所以然的前二十个字；
 * 完整正文点一下就在输入框里了，这里只需要让人认出「这条像我的场景」。
 */
const firstLineOf = (content?: string): string =>
  (content ?? '').split('\n').find((l) => l.trim())?.trim() ?? ''

/**
 * 把一段文本插入输入框（**不发送**）。模板与示例共用这一条路径。
 *
 * <p>🔴 追加而不是覆盖：用户可能已经打了一半，直接赋值会把他的字吃掉。
 * <p>🔴 插完只聚焦、不发送：模板里的 {{占位符}} 需要用户替换，替他发出去等于让模型
 * 照字面量回答「{{订单号}}」——不报错，只是答非所问，是最难查的那类问题。
 * <p>🔴 共用一个函数而不是两边各写一份：字数上限、追加语义、光标落点这三件事漂了任何一件，
 * 表现都是「模板能插、示例插不进去」这类只在其中一条路径上复现的怪事。
 *
 * @returns 是否真的插进去了（空正文或超上限时返回 false，调用方据此决定要不要接着提示占位符）
 */
const insertIntoInput = (raw: string | undefined, label: string): boolean => {
  const text = raw ?? ''
  if (!text.trim()) {
    message.warning(`这条${label}的正文是空的，请到「提示词模板」里补上`)
    return false
  }
  const current = inputText.value ?? ''
  const merged = current.trim() ? `${current.replace(/\s+$/, '')}\n\n${text}` : text
  if (merged.length > INPUT_MAX_LENGTH) {
    message.warning(
      `插入后会达到 ${merged.length} 字，超过输入框 ${INPUT_MAX_LENGTH} 字上限。` +
        `请先清空输入框，或到「提示词模板」里精简这条${label}`
    )
    return false
  }
  inputText.value = merged
  templatePopoverVisible.value = false
  nextTick(() => {
    const el = inputRef.value?.textarea as HTMLTextAreaElement | undefined
    if (el) {
      el.focus()
      // 光标落到末尾：占位符通常在正文中间，但落末尾比落开头更符合「刚打完字」的直觉
      el.setSelectionRange(el.value.length, el.value.length)
    }
  })
  return true
}

const applyTemplate = (tpl: AgentPromptTemplateVO) => {
  const text = tpl.content ?? ''
  if (!insertIntoInput(text, '模板')) return
  const phs = placeholdersOf(text)
  if (phs.length) {
    const shown = phs.slice(0, 3).join('、')
    message.info(
      `已插入，还有 ${phs.length} 处占位符要替换：${shown}${phs.length > 3 ? ' 等' : ''}`
    )
  }
}

/**
 * 把一条示例的正文插入输入框（不发送）
 *
 * <p>🔴 占位符提示与模板**刻意不同措辞**。示例正文本该是填好的，但里面仍可能合法地出现
 * {{...}}：工作流 DSL 的取值表达式就长这样（{{$.input.tableName}}），一条教用户问 DSL 的示例
 * 必须能把它写出来。所以这里不说「要替换」（对 DSL 示例是错的指控），只说「确认一下」。
 * 反过来也不能干脆不提示：一条没填完的示例被原样发出去，模型会照字面量回答「{{订单号}}」，
 * 不报错、只是答非所问。多一条可以忽略的提示，比这个便宜。
 */
const applyCase = (c: AgentPromptTemplateCaseVO) => {
  const text = c.content ?? ''
  if (!insertIntoInput(text, '示例')) return
  const phs = placeholdersOf(text)
  if (phs.length) {
    message.info(
      `已插入。正文里还有 ${phs.length} 处 {{…}}，发出去前确认一下是该填的值、还是要问的写法`
    )
  }
}

/** 新对话时用户自由选择的 Agent；null=默认平台助手 */
const selectedAgentDefId = ref<number | null>(null)
/**
 * 本会话内「新建对话」时记住的选择。
 * 🔴 为什么需要它：新会话的 id 要到 META 事件才拿得到，那一刻外层列表还没刷新、
 * props.agentDefId 仍是旧值/空。靠它让选择器在「刚发出第一句」后立即锁定到正确的 Agent，
 * 等外层列表刷新后再由 props.agentDefId 接管（两者一致）。
 */
const pendingNewAgentDefId = ref<number | null>(null)

/** 会话一旦落库就锁定选择器（D4：创建时定、之后以会话为准，防中途换人设） */
const isAgentLocked = computed(() => innerConversationId.value != null)

/** 选择器当前生效值：锁定=会话绑定值（props 优先，其次本会话新建时记住的）；未锁定=用户自由选择值 */
const effectiveAgentDefId = computed<number | null>(() => {
  if (isAgentLocked.value) {
    return props.agentDefId ?? pendingNewAgentDefId.value ?? null
  }
  return selectedAgentDefId.value
})

const agentSelectorModel = computed<number>({
  // 0 = 默认平台助手的哨兵值（真实 def id 恒为正；el-option 的 value 不接受 null）
  get: () => effectiveAgentDefId.value ?? 0,
  set: (val) => {
    // 锁定时选择器已 disabled，正常改不动；这里再兜一层，绝不让既有会话被换 Agent
    if (!isAgentLocked.value) selectedAgentDefId.value = val === 0 ? null : val
  }
})

/** 空态标题/副标题随选中 Agent 变化（默认助手 vs 自定义 Agent） */
const activeAgentInfo = computed(() => {
  const def = effectiveAgentDefId.value
    ? agentDefList.value.find((a) => a.id === effectiveAgentDefId.value)
    : undefined
  if (def) {
    return { title: def.name, subtitle: def.description || '已选择该 Agent，其人设将驱动本次对话' }
  }
  return {
    title: '我是平台助手',
    subtitle: '表单设计、数据建模、权限配置的问题都可以问我，回答会标注手册出处'
  }
})

/**
 * 输入区那句「回答依据什么」的提示
 *
 * 独立出来是因为需求8 把它从单独一行挪进了选择器/发送按钮那一行，模板里再写三元就太长了。
 * 默认助手那句刻意带上「若手册未覆盖会如实说明」——它是在替模型的行为兜底预期，
 * 少了这句，用户会把「手册里没有」的老实回答当成助手能力不行。
 */
const agentHint = computed(() =>
  effectiveAgentDefId.value
    ? '回答由所选 Agent 的人设驱动'
    : '回答依据平台手册，若手册未覆盖会如实说明'
)

/** 中断控制器：用户点「停止」或切换会话时要能真的把连接掐掉 */
let abortController: AbortController | null = null

/**
 * 打字机缓冲
 *
 * 🔴 不把 SSE 收到的增量<b>直接</b>写进界面。
 * 厂商回包是一阵一阵的（几十字一坨），直接渲染会看到文字一块一块地蹦，
 * 比不做流式还难看。这里改成「收进缓冲区 + 定时匀速吐出」，
 * 并按积压量动态调速 —— 做法与 ai/chat 的 textRoll 一致（src/views/ai/chat/index/index.vue）。
 */
const typewriter = {
  full: '',
  shown: 0,
  timer: null as any,

  reset() {
    this.full = ''
    this.shown = 0
    this.stop()
  },

  push(text: string) {
    this.full += text
    this.start()
  },

  start() {
    if (this.timer) return
    const tick = () => {
      const pending = this.full.length - this.shown
      if (pending > 0) {
        // 积压越多吐得越快，否则模型早答完了、界面还在慢悠悠地打字
        const step = pending > 60 ? 6 : pending > 20 ? 3 : 1
        this.shown = Math.min(this.full.length, this.shown + step)
        const last = messageList.value[messageList.value.length - 1]
        if (last && last.role === 'assistant') {
          last.content = this.full.slice(0, this.shown)
        }
        // 只有用户本来就在底部时才跟随，否则他正在翻看的内容会被顶走
        if (autoFollow.value) scrollToBottom()
      } else if (!streaming.value) {
        // 流结束且全部吐完，才停
        this.stop()
        return
      }
      this.timer = setTimeout(tick, pending > 60 ? 8 : 24)
    }
    this.timer = setTimeout(tick, 24)
  },

  stop() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  },

  /** 立刻把剩下的全吐出来（出错或中断时用，别让用户盯着半截话） */
  flush() {
    this.stop()
    const last = messageList.value[messageList.value.length - 1]
    if (last && last.role === 'assistant') {
      last.content = this.full
    }
    this.shown = this.full.length
  }
}

const scrollToBottom = async () => {
  await nextTick()
  scrollbarRef.value?.setScrollTop(scrollbarRef.value?.wrapRef?.scrollHeight ?? 0)
}

/**
 * 滚动监听：用「距底部距离」判断是否在跟随，并带滞回
 *
 * 不用 scrollTop 的变化量判断 —— 内容增长（打字机、图片加载）本身就会改变
 * scrollHeight，用变化量会把「内容变长」误判成「用户滚走了」。
 * 滞回（>80 关闭、<40 恢复）避免在临界点上反复横跳。
 */
const handleScroll = ({ scrollTop }: { scrollTop: number }) => {
  const wrap = scrollbarRef.value?.wrapRef
  if (!wrap) return
  const distanceToBottom = wrap.scrollHeight - scrollTop - wrap.clientHeight
  if (distanceToBottom > 80) {
    autoFollow.value = false
  } else if (distanceToBottom < 40) {
    autoFollow.value = true
  }
}

const showBackToBottom = computed(() => !autoFollow.value && messageList.value.length > 0)

const handleBackToBottom = async () => {
  autoFollow.value = true
  await scrollToBottom()
}

/** 复制答案原文（markdown），不是渲染后的纯文本 —— 用户多半要贴进文档 */
const handleCopy = async (content: string) => {
  try {
    await copy(content)
    message.success('已复制到剪贴板')
  } catch {
    message.error('复制失败，请手动选择文本')
  }
}

const focus = () => inputRef.value?.focus()

/**
 * 从 DSL 原文抠出只读节点预览 + 流程走向
 *
 * DSL 是一整份 WorkflowDefDTO JSON。卡片需要 nodes[] 的中文摘要（buildSummaryNodes）与 edges[] 的
 * 走向文本（flowStepsText）—— AI助手 UX 修复前只抠 {id,type,name}，config 里的 prompt/工具/分支全被丢弃，
 * 用户看到的流程等于只有目录没有正文。这里改用 nodeSummary 的公共组装函数，与编辑器/只读画布同源。
 * 解析失败（草稿 dsl 异常）返回空，卡片显示「未能解析出节点预览」而不是崩掉。
 *
 * 🔴 async 是为了先 `await` 名称目录（重构 S1 / L1）：卡片摘要是一次性装配的、不在 computed 里，
 * 目录晚到不会让已渲染的卡片自己刷新 —— 不 await 就等于「首屏那批卡片永久显示 datamodel_create」。
 */
const parseWorkflowPreview = async (
  dsl?: string
): Promise<{ nodes: SummaryNode[]; edgesText: string[] }> => {
  if (!dsl) return { nodes: [], edgesText: [] }
  await ensureNameCatalog()
  try {
    const parsed = JSON.parse(dsl)
    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : []
    const edges = Array.isArray(parsed?.edges) ? parsed.edges : []
    return {
      nodes: buildSummaryNodes(nodes, nameResolver),
      edgesText: flowStepsText(nodes, edges)
    }
  } catch {
    return { nodes: [], edgesText: [] }
  }
}


/**
 * 加载某个会话的消息
 *
 * 🔴 loadSeq 竞态守卫：抽屉里连点两个会话时，先发出的请求可能后返回，
 * 不做守卫的话慢的那次会把快的那次已经渲染好的消息覆盖掉 ——
 * 表现是「点了 A 却显示 B 的内容」，而且只在网络抖动时偶发，极难复现。
 */
let loadSeq = 0
const loadMessages = async (conversationId: number) => {
  const seq = ++loadSeq
  innerConversationId.value = conversationId
  // 载入既有会话：会话绑定以 props.agentDefId 为准，清掉上一次新建对话的临时记忆
  pendingNewAgentDefId.value = null
  const list: AgentMessageVO[] = await AgentAssistantApi.getMessageList(conversationId)
  if (seq !== loadSeq) return
  // 有 workflowDefId 的助手消息需要重建草稿卡片，有 executionId 的需要重建确认卡片
  const rebuilt = await Promise.all(
    list.map(async (item) => {
      const msg: any = { ...item }
      // 🔴 这里曾经写成 (item as any).planId —— 那个 as any 掩盖了一个真缺陷：
      //    后端 RespVO 压根没有该字段，运行时永远是 undefined，if 从来没进去过，
      //    刷新页面后卡片必定退化成一段纯文字。现在 workflowDefId 已在 AgentMessageVO
      //    上声明、后端也真的返回了，不需要 as any。
      if (item.role === 'assistant' && item.workflowDefId) {
        try {
          // 单一装配路径：DSL 正文一律走 workflow-draft GET（直播与刷新共用），不在消息里另存一份
          const draft: AgentWorkflowDraftVO = await AgentPlannerApi.getWorkflowDraft(
            item.workflowDefId
          )
          msg.workflowDefId = draft.defId
          msg.workflowCode = draft.code
          msg.workflowName = draft.name
          const preview = await parseWorkflowPreview(draft.dsl)
          msg.nodes = preview.nodes
          msg.edgesText = preview.edgesText
          // 清单与节点预览同源同批（都在这个响应里），故必须在 cardStatus 之前落好：
          // 卡片一出现就该带着「变更预演」，不能先渲染一张没有清单的卡再补
          msg.manifest = draft.manifest ?? null
          // 摘要优先用消息正文（appendDraftMessage 落库时写进了 content），拿不到再退回草稿名
          msg.summary = item.content || draft.name
          // 卡片状态按定义状态：DRAFT 待确认 / PUBLISHED 已发布可运行 / DISABLED 已结束
          msg.cardStatus =
            draft.status === 'DRAFT'
              ? 'pending'
              : draft.status === 'PUBLISHED'
                ? 'published'
                : 'done'
          msg.defStatus = draft.status
          /**
           * 刷新后重建「草稿卡运行撞闸口」的确认卡片：这条路线的挂起没落 execution_id
           * （聊天路由才落），不补这一查的话，刷新后挂起在对话里<b>一点痕迹都没有</b>，
           * 用户只在执行历史里看到一行等待确认却无处可点（2026-09-29 实测的死路）。
           * 🔴 只认「最新一条」执行：用户若在其后又跑过一次，旧的挂起已是被放弃的分支，
           *    为它重建卡片会把用户带去 resume 一条他早已不要的执行。
           */
          if (!item.executionId && msg.cardStatus !== 'pending') {
            const execPage = await AgentWorkflowApi.getExecutionPage({
              pageNo: 1,
              pageSize: 1,
              workflowDefId: draft.defId
            })
            if (execPage.list?.[0]?.status === 'INTERRUPTED') {
              msg.hitl = {
                executionId: execPage.list[0].id,
                // nodeId 不重建：同聊天路由的理由 —— currentNode 是最后跑完的节点，不是闸口
                content: '流程走到人工确认闸口，已暂停等待您的决定。',
                manifest: null,
                manifestError: '',
                manifestLoading: true,
                running: false,
                decided: null,
                error: ''
              }
              // 🔴 不 await：会话重建是一次 Promise.all，等清单会把整段历史的渲染一起拖住。
              //    卡片自己先转圈，到了再换（fillManifest 内部已接住异常，不会产生未处理拒绝）
              void fillManifest(msg.hitl, execPage.list[0].workflowDefId)
            }
          }
        } catch {
          // 草稿加载失败就当普通消息显示（warnings 本就不可在刷新后恢复，与旧卡一致）
        }
      }
      // 有 executionId 的助手消息需要重建 HITL 确认卡片（增量13）
      if (item.role === 'assistant' && item.executionId) {
        try {
          const exec = await AgentWorkflowApi.getExecution(item.executionId)
          msg.hitl = {
            executionId: item.executionId,
            // nodeId 刻意不重建：VO 上的 currentNode 是<b>最后一个跑完的节点</b>，
            // 而 SAA 是在 hitl 节点<b>之前</b>挂起的，拿它当「卡在哪个节点」会把用户指错地方
            content: item.content || '',
            manifest: null,
            manifestError: '',
            // 仍 INTERRUPTED 才去取清单：已终态的卡片显示「已处理」就够了，
            // 为每条历史消息都查一次清单，会把打开会话变成一串无谓的请求
            manifestLoading: exec.status === 'INTERRUPTED',
            running: false,
            // 仍 INTERRUPTED → 刷新后还能接着确认（这是把 execution_id 落库的全部意义）；
            // 已终态 → 只能诚实地说「已处理」：库里没记当时用户点的是同意还是拒绝
            decided: exec.status === 'INTERRUPTED' ? null : 'resolved',
            error: ''
          }
          if (exec.status === 'INTERRUPTED') {
            /**
             * 🔴 这里取到的是**全流程**清单（不传 fromNodeId ⟹ `scope == null`），
             *    比直播时那份「按闸口裁剪过」的**范围更大**。这是重建路径的固有损失：
             *    nodeId 不重建（上面那条理由）⟹ 没有 fromNodeId ⟹ 裁剪不出来。
             *    宁可给用户看多了，也不能假装看全了 —— 卡片上 `scope` 为 null 时
             *    不显示裁剪记账，用户看到的就是一份没有声称自己完整的清单。
             */
            void fillManifest(msg.hitl, exec.workflowDefId)
          }
        } catch {
          // 查不到执行实例就退化成普通消息，别让整个会话加载失败
        }
      }
      return msg
    })
  )
  // 重建过程里又有新的加载（用户又点了别的会话）—— 这次的结果作废
  if (seq !== loadSeq) return
  messageList.value = rebuilt
  autoFollow.value = true
  await scrollToBottom()
}

/** 清空成「新对话」。刻意不立刻调后端建会话，避免攒一堆空会话 */
const reset = () => {
  if (streaming.value) handleStop()
  innerConversationId.value = undefined
  pendingNewAgentDefId.value = null // 新对话重新自由选择 Agent（selectedAgentDefId 保留上次选择）
  emit('update:conversationId', undefined)
  messageList.value = []
  autoFollow.value = true
}

const handleEnter = (e: KeyboardEvent) => {
  if (e.shiftKey) return // Shift+Enter 换行
  e.preventDefault()
  if (!streaming.value && inputText.value.trim()) {
    handleSend()
  }
}

const handleSuggestion = (suggestion: AgentSuggestionVO) => {
  // 方案 §9.3：点了就直接执行，不是只填进输入框让用户再按一次发送
  handleSend(suggestion.text)
}

/** 取最近一个会话，作为空态里「继续上次对话」的目标 */
const loadResumeTarget = async () => {
  if (!props.offerResume) {
    resumeTarget.value = undefined
    return
  }
  try {
    // 接口按 lastActiveTime 倒序，第一条就是最近用过的
    const page = await AgentAssistantApi.getConversationPage({ pageNo: 1, pageSize: 1 })
    resumeTarget.value = page?.list?.[0]
  } catch {
    // 拉不到就不显示这个入口，空态本身仍然可用，不值得弹错误框
    resumeTarget.value = undefined
  }
}

// 回到空态（首次挂载、点「新对话」、删掉当前会话）时刷新恢复入口；
// 一旦有消息就清掉，免得「继续上次对话」和正在看的会话指的是同一个
watch(
  () => props.offerResume && messageList.value.length === 0,
  (shouldOffer) => {
    if (shouldOffer) loadResumeTarget()
    else resumeTarget.value = undefined
  },
  { immediate: true }
)

const handleResume = async () => {
  const target = resumeTarget.value
  if (!target) return
  try {
    // 先加载，成功了再收起按钮、再把 conversationId 抛给外层
    await loadMessages(target.id)
    resumeTarget.value = undefined
    emit('update:conversationId', target.id)
  } catch {
    // 🔴 会话可能刚被别处删掉、或后端瞬时异常。这里绝不能默默退回空态 ——
    //    用户点了「继续上次对话」却什么都没发生、也没提示，正是最难排查的那类缺陷。
    //    保留 resumeTarget，按钮还在，用户可以直接重试。
    message.error('加载历史对话失败，请稍后重试')
  }
}

/**
 * 标成错误态，并撤掉可能还挂着的规划进度卡片
 *
 * 🔴 这两件事<b>必须一起做</b>，漏掉后一件的表现极具误导性：
 * 错误气泡（{@code el-alert}）在模板里被 {@code v-if="!item.cardStatus"} 挡着，
 * cardStatus 还挂在 {@code 'planning'} 上时它压根不渲染，而 {@code WorkflowDraftCard}
 * 会继续转圈。规划路径失败时就是这个形态 —— 用户盯着一个永远转不完的进度条，
 * 界面上没有一个字告诉他「已经失败了、失败原因是什么」。
 *
 * <p>实测疤：一次建表编排连错 6 轮后，后端抛了 {@code WORKFLOW_PLAN_DSL_GENERATION_FAILED}、
 * {@code agent_message.error_msg} 也如实写进了库，页面上却什么错误都看不到；
 * e2e 断言「模型侧没答」时抓到的是空字符串，只能去翻后端日志才知道真因，
 * 而且第一眼的结论还是错的（以为意图分型没走 BUILD，其实是 Planner 挂了）。
 *
 * <p>MESSAGE(:1241) 与 WORKFLOW_CONFIRM(:1273) 早就各自手写了这两行、并各带一段同款注释，
 * 唯独错误路径漏了 —— 故收成一个函数，让「标错误」与「撤卡片」不可能再被拆开。
 */
const markError = (msg: any, text: string) => {
  msg.status = 'ERROR'
  msg.errorMsg = text
  msg.cardStatus = null
  msg.planningText = ''
}

/**
 * 把一个 SSE 聊天事件应用到目标消息上
 *
 * 🔴 提问（handleSend）与「确认卡片点了同意/拒绝」后的续跑（handleHitlDecision）
 * 是两条<b>不同的 HTTP 请求</b>，但后端回推的是<b>同一套 AgentChatEvent 类型</b>。
 * 早先这里只有一份 switch 写死在 handleSend 里，续跑那份如果复制粘贴，
 * 以后后端每加一种事件都得记得改两处 —— 漏掉的那处表现是「点了同意、卡片消失了，
 * 然后什么都没发生」，而控制台毫无报错。所以抽成一份，两条路径共用。
 */
const applyChatEvent = (msg: any, data: any) => {
  switch (data.type) {
    case 'META':
      // 新建会话时要靠它拿到 conversationId，否则刷新页面就找不回这次对话
      if (data.conversationId && !innerConversationId.value) {
        innerConversationId.value = data.conversationId
        emit('update:conversationId', data.conversationId)
      }
      msg.references = data.references || []
      break
    case 'MESSAGE':
      // 🔴 工作流驱动的 Agent（slice-3c）会先发 PLANNING（节点进度）再发 MESSAGE（最终回复）。
      //    答案开始吐字时必须撤掉进度卡片：cardStatus 若仍是 'planning'，模板会持续渲染
      //    WorkflowDraftCard 而把普通答案气泡（assistant-answer）整个挡掉 ——
      //    表现为「进度停在最后一个节点、答案永远不出现」（浏览器 e2e 实测抓到，单测看不出来）。
      //    直连 LLM 路径不发 PLANNING、BUILD 路径发的是 WORKFLOW_DRAFT（不发 MESSAGE），
      //    故只有「PLANNING→MESSAGE」这一条序列需要这次清理，对既有两条路径无影响。
      if (msg.cardStatus === 'planning') {
        msg.cardStatus = null
        msg.planningText = ''
      }
      typewriter.push(data.content || '')
      break
    case 'REASONING':
      msg.reasoningContent += data.content || ''
      break
    case 'SUGGESTIONS':
      msg.suggestions = data.suggestions || []
      break
    case 'PLANNING':
      // 规划进度：原地替换，不是追加
      msg.cardStatus = 'planning'
      msg.planningText = data.content || '正在规划…'
      break
    case 'WORKFLOW_DRAFT':
      // 产出了 Workflow 草稿：记下 defId/code/name/摘要/警告，DSL 正文另取
      msg.workflowDefId = data.workflowDefId
      msg.workflowCode = data.workflowCode
      msg.workflowName = data.workflowName
      msg.summary = data.summary || ''
      msg.warnings = data.warnings || []
      // 🔴 用 ?? 不用 ||：rounds 最小是 1，写 `|| 0` 会让「刷新后取不到」和「真跑过 0 轮」
      //    变成同一个值，卡片就分不清该不该显示它
      msg.rounds = data.rounds ?? null
      loadWorkflowDraft(msg, data.workflowDefId)
      break
    case 'WORKFLOW_CONFIRM':
      // 🔴 同样必须先撤进度卡片：中断（INTERRUPTED）这一轮<b>不会再有 MESSAGE</b>，
      //    没人来清 cardStatus，模板会一直渲染 WorkflowDraftCard 把确认卡片挡在 v-else-if 之后 ——
      //    表现就是「点了同意没反应，页面卡在一个进度条上」。
      msg.cardStatus = null
      msg.planningText = ''
      // executionId 是续跑的唯一钥匙；落库在 agent_message.execution_id 上，刷新页面据此重建
      msg.hitl = {
        executionId: data.executionId,
        nodeId: data.nodeId,
        // 显示名与进度句「正在执行：xx」同源；后端拿不到名字时回落成 nodeId
        nodeName: data.nodeName,
        content: data.content || '',
        // 🔴 清单搭事件过来，不另调 /manifest：刷新后 nodeId 是不重建的（见下面的注释），
        //    没有 nodeId 就没有 fromNodeId，这份**按闸口裁剪过的**清单将再也拼不出来
        manifest: data.manifest ?? null,
        // 后端 buildManifestOrNull 失败会给 null。null 必须显示成「清单不可用」，
        // 所以这里补一句原因，让卡片知道「取过、没取到」而不是「压根没打算取」
        manifestError: data.manifest ? '' : '后端未能生成变更清单',
        manifestLoading: false,
        running: false,
        decided: null as 'approved' | 'rejected' | 'resolved' | null,
        error: ''
      }
      break
    case 'DONE':
      msg.status = 'SUCCESS'
      break
    case 'ERROR':
      markError(msg, data.errorMsg || 'AI 助手暂时无法回答')
      break
    default:
      // 后端新增了事件类型而前端还没跟上 —— 忽略即可，不要炸掉整个流
      break
  }
}

/** 发送 */
const handleSend = async (text?: string) => {
  const content = (text ?? inputText.value).trim()
  if (!content || streaming.value) return

  // 🔴 agentDefId 只在「新建会话」这一句被后端采纳并落库绑定（D4）；既有会话带了也被忽略。
  //    新会话的 id 要到 META 才回来，故先把本次选择记进 pendingNewAgentDefId，
  //    让选择器在 META 到达、innerConversationId 落定的那一刻立即锁定到正确 Agent。
  const isNewConversation = innerConversationId.value == null
  const agentDefIdToSend = isNewConversation ? selectedAgentDefId.value ?? undefined : undefined
  if (isNewConversation) pendingNewAgentDefId.value = selectedAgentDefId.value

  inputText.value = ''
  messageList.value.push({
    role: 'user',
    content,
    createTime: new Date()
  })
  const assistantMessage = reactive<any>({
    role: 'assistant',
    content: '',
    reasoningContent: '',
    references: [] as any[],
    suggestions: [] as AgentSuggestionVO[],
    status: 'STREAMING',
    errorMsg: '',
    createTime: new Date()
  })
  messageList.value.push(assistantMessage)
  // 自己发的消息，当然要跟着滚到底
  autoFollow.value = true
  await scrollToBottom()

  streaming.value = true
  typewriter.reset()
  abortController = new AbortController()

  await AgentAssistantApi.sendStream(
    innerConversationId.value,
    content,
    agentDefIdToSend,
    abortController,
    (event) => {
      let payload: any
      try {
        payload = JSON.parse(event.data)
      } catch {
        return // 心跳之类的非 JSON 行，忽略
      }
      if (payload.code !== 0) {
        markError(assistantMessage, payload.msg || '请求失败')
        return
      }
      applyChatEvent(assistantMessage, payload.data)
    },
    (err) => {
      // 🔴 必须 throw：fetchEventSource 的 onerror 不抛异常就会<b>自动无限重连</b>，
      // 表现为同一个问题被反复提交、反复计费，而界面上什么都看不出来
      streaming.value = false
      typewriter.flush()
      if (assistantMessage.status === 'STREAMING') {
        markError(assistantMessage, '连接中断，请重试')
      }
      throw err
    },
    () => {
      streaming.value = false
      // 🔴 先把打字机吐完，再置完成态。顺序是硬性的：
      //    「复制」按钮的 v-if 是 status==='SUCCESS'，而它复制的是 item.content —— 也就是打字机
      //    **已吐出的那一半**。不 flush 就置 SUCCESS，用户能在动画还在跑的时候点复制，
      //    拿到一段被静默截断的答案，而界面上看不出任何异常（气泡随后才补完，剪贴板不会）。
      //    另外这条 flush 必须排在下面的空流判定**之前**：那个判定读的是 assistantMessage.content，
      //    而 content 只由打字机写入 —— SSE 已给完内容、动画一格都还没吐时 content 仍是空串，
      //    不先 flush 就会把一次正常回答误判成「AI 助手没有返回任何内容」并盖一条红错。
      typewriter.flush()
      if (assistantMessage.status === 'STREAMING') {
        // 🔴 空流不能算成功。
        //
        // 连接正常关闭、却一个字都没给，这不是「AI 答完了」，而是<b>后端没能答</b>
        // （实测形态：SSE 接口抛异常后全局处理器要写 JSON，而响应头已经是
        // text/event-stream，内容协商失败 → 客户端收到一个空 body，curl 退出码还是 0）。
        // 标成 SUCCESS 的话界面就是一个空气泡，用户只能得出「没反应，又坏了」的结论，
        // 而日志里那句真正的错误没人看得见。
        // 🔴 判空要把「确认卡片」也算产出：中断那一轮后端只回 META + WORKFLOW_CONFIRM + DONE，
        //    既没有 content 也没有 workflowDefId，不加这个条件就会被误判成「后端什么都没答」，
        //    卡片上盖一条红色报错 —— 而流程其实好好地在等用户点「同意」。
        if (!assistantMessage.content && !assistantMessage.workflowDefId && !assistantMessage.hitl) {
          markError(
            assistantMessage,
            'AI 助手没有返回任何内容，请重试；若反复出现请联系管理员查看服务端日志'
          )
        } else {
          assistantMessage.status = 'SUCCESS'
        }
      }
      emit('conversation-updated') // 让外层刷新会话列表，新会话与标题才显示得出来
    }
  )
}

/** 停止 */
const handleStop = () => {
  abortController?.abort()
  abortController = null
  streaming.value = false
  typewriter.flush()
  const last = messageList.value[messageList.value.length - 1]
  if (last && last.status === 'STREAMING') {
    // 同理：中断时如果什么都没产出，别留一个看起来「答完了」的空气泡。
    // 后端收到取消后会落一条 CANCELLED 消息，刷新页面就能看到「本次规划已中断」，
    // 界面上也该说清楚这一轮是被停掉的
    if (!last.content && !last.workflowDefId && !last.hitl) {
      last.status = 'ERROR'
      last.errorMsg = '已停止生成'
    } else {
      last.status = 'SUCCESS'
    }
  }
  // 规划进度中途停掉，卡片状态清除（没产出草稿的话就没有卡片）
  if (last && last.cardStatus === 'planning') {
    last.cardStatus = null
    last.planningText = ''
  }
  // 续跑被停掉时，确认卡片要放开「续跑中」，否则按钮永久 loading、用户只能刷新页面。
  // 执行实例在后端仍处 INTERRUPTED（doOnCancel 只落消息、不改执行状态），刷新即可重建待确认卡片
  messageList.value.forEach((m: any) => {
    if (m?.hitl?.running) {
      m.hitl.running = false
      m.hitl.decided = null
      m.hitl.error = '已停止续跑，可重新确认'
    }
  })
}

// ==================== 聊天内 HITL 确认（增量13） ====================

/**
 * 用户在确认卡片上点了「同意并继续 / 拒绝」
 *
 * <p>为什么续跑要<b>另起一条助手消息</b>，而不是把结果写回卡片那条：
 * 后端也是这样落的库 —— 中断那一轮 settle 一条带 execution_id 的消息（=卡片），
 * 续跑那一轮 settle 一条普通消息（=最终答案）。前端若把答案塞回卡片里，
 * 直播时看到「卡片变成了答案」，刷新后却看到「卡片 + 答案两条」，两边对不上。
 * 这条纪律和 slice-3c 一样：<b>直播渲染 == 刷新渲染</b>。
 */
const handleHitlDecision = async (item: any, approved: boolean) => {
  const hitl = item?.hitl
  // running/decided 双重闸：一次点击就把卡片锁住，防止连点造成并发 resume
  // （后端 casInterruptedToRunning 也会拒第二个，但界面先给反馈比等报错好）
  if (!hitl || hitl.running || hitl.decided) return
  if (!hitl.executionId || !innerConversationId.value) {
    message.error('缺少执行实例或会话信息，请刷新页面后重试')
    return
  }

  hitl.decided = approved ? 'approved' : 'rejected'
  hitl.running = true
  hitl.error = ''

  const answerMessage = reactive<any>({
    role: 'assistant',
    content: '',
    reasoningContent: '',
    references: [] as any[],
    suggestions: [] as AgentSuggestionVO[],
    status: 'STREAMING',
    errorMsg: '',
    createTime: new Date()
  })
  messageList.value.push(answerMessage)
  autoFollow.value = true
  await scrollToBottom()

  streaming.value = true
  typewriter.reset()
  // 复用同一个 abortController：这样「停止」按钮与组件卸载时的 abort 已经覆盖续跑，无需另立一套
  abortController = new AbortController()

  await AgentAssistantApi.resumeWorkflowStream(
    hitl.executionId,
    approved,
    innerConversationId.value,
    abortController,
    (event) => {
      let payload: any
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }
      if (payload.code !== 0) {
        hitl.running = false
        hitl.error = payload.msg || '续跑请求被拒绝'
        markError(answerMessage, payload.msg || '续跑请求被拒绝')
        return
      }
      applyChatEvent(answerMessage, payload.data)
      // 续跑又撞上一个人工闸口（多闸口流程）：WORKFLOW_CONFIRM 会落在 answerMessage 上，
      // 它自己就成了下一张卡片，用户可以在同一段对话里连续确认
      if (payload.data?.type === 'WORKFLOW_CONFIRM') {
        hitl.running = false
        // 草稿卡路线：执行又停在新闸口上，卡片终态要跟着回到「已挂起」
        if (item.cardStatus) item.runResult = 'interrupted'
      }
    },
    (err) => {
      // 🔴 同 handleSend：必须 throw，否则 fetchEventSource 会无限重连、反复提交 resume
      streaming.value = false
      typewriter.flush()
      hitl.running = false
      if (answerMessage.status === 'STREAMING') {
        markError(answerMessage, '连接中断，请重试')
      }
      if (item.cardStatus && !hitl.error) {
        item.runResult = 'error'
        item.runError = '续跑连接中断，请重试'
      }
      throw err
    },
    () => {
      streaming.value = false
      hitl.running = false
      // 同 handleSend：先 flush 再置完成态，理由见那边（「复制」会拿到半截答案 + 空流误判）
      typewriter.flush()
      if (answerMessage.status === 'STREAMING') {
        // 同 handleSend 的空流判定；确认卡片本身也算产出（连续闸口）
        if (!answerMessage.content && !answerMessage.workflowDefId && !answerMessage.hitl) {
          markError(
            answerMessage,
            '流程恢复后没有返回任何内容，请刷新页面查看执行状态；若反复出现请联系管理员查看服务端日志'
          )
        } else {
          answerMessage.status = 'SUCCESS'
        }
      }
      // 草稿卡路线：续跑流结束即执行走到终态（或新闸口，上面已处理），把卡片终态对齐，
      // 否则草稿卡会一直挂着「已挂起」的警告，而流程其实已经跑完了
      if (item.cardStatus && !hitl.error && item.runResult === 'interrupted') {
        if (answerMessage.status === 'ERROR') {
          item.runResult = 'error'
          item.runError = answerMessage.errorMsg
        } else if (!answerMessage.hitl) {
          item.runResult = 'success'
        }
      }
      emit('conversation-updated')
    }
  )
}

// ==================== Workflow 草稿卡片相关 ====================

/**
 * 加载草稿 DSL 并切换卡片到「待确认」
 *
 * SSE 的 WORKFLOW_DRAFT 事件只带 defId/code/name/摘要/警告，<b>不带 DSL 正文</b>。
 * 节点预览所需的 dsl 无论直播还是刷新都走 workflow-draft GET —— 单一装配路径，
 * 避免「流里塞一份、刷新查一份」两条组装逻辑漂移（理由见 EventType.WORKFLOW_DRAFT 注释）。
 */
const loadWorkflowDraft = async (item: any, defId: number) => {
  if (!defId) return
  try {
    const draft: AgentWorkflowDraftVO = await AgentPlannerApi.getWorkflowDraft(defId)
    const preview = await parseWorkflowPreview(draft.dsl)
    item.nodes = preview.nodes
    item.edgesText = preview.edgesText
    // 🔴 清单只在 workflow-draft 这一个响应里组装（S2-f 的「单一装配路径」），
    //    WORKFLOW_DRAFT 事件里刻意不塞第二份 —— 两份副本迟早会漂
    item.manifest = draft.manifest ?? null
    item.defStatus = draft.status
    item.cardStatus = draft.status === 'DRAFT' ? 'pending' : 'published'
    await scrollToBottom()
  } catch (e: any) {
    item.cardStatus = null
    message.error('加载流程草稿失败：' + (e?.message ?? '未知错误'))
  }
}

/**
 * 反查一份变更清单塞进确认卡（S3）：直播时清单搭 WORKFLOW_CONFIRM 事件过来，
 * 但**刷新重建**与**草稿卡运行撞闸口**这两条路拿不到那个事件，只能自己查一次。
 *
 * 🔴 为什么必须按 `workflowDefId` 查、而不能用手头的草稿 defId：
 *    `run-stream` 是按 code 跑的，后端选的是**已发布/主版本**，草稿可能根本不是那一版。
 *    拿草稿 DSL 生成清单 = 给审批人看一份「不会发生的事」，比不给清单更坏。
 * 🔴 `nodeId` 有就传（得到按闸口裁剪过的清单），没有就**别传**（`scope == null` 的全流程清单）。
 *    绝不传 `"START"`：裁定⑭ 认定那是「理由错误的正确答案」，S4a 会把它改成显式报错。
 * 🔴 走的是**严格版** `/manifest`：生成不出来会抛，这里接住落成 manifestError，
 *    卡片据此显示「清单不可用」—— 不能显示成「本次没有变更」。
 */
const fillManifest = async (hitl: any, defId?: number | null, nodeId?: string | null) => {
  if (!hitl || !defId) return
  hitl.manifestLoading = true
  try {
    hitl.manifest = await AgentWorkflowApi.getManifest({
      id: defId,
      ...(nodeId ? { fromNodeId: nodeId } : {})
    })
    hitl.manifestError = ''
  } catch (e: any) {
    hitl.manifest = null
    hitl.manifestError = e?.msg ?? e?.message ?? '查询失败'
  } finally {
    hitl.manifestLoading = false
  }
}

/** 只有 executionId 时的入口：先查出**实际在跑的那一版**，再取清单 */
const fillManifestByExecution = async (
  hitl: any,
  executionId?: number | null,
  nodeId?: string | null
) => {
  if (!hitl || !executionId) return
  try {
    const exec = await AgentWorkflowApi.getExecution(executionId)
    await fillManifest(hitl, exec?.workflowDefId, nodeId)
  } catch (e: any) {
    hitl.manifest = null
    hitl.manifestError = e?.msg ?? e?.message ?? '查询失败'
  }
}

/** 🔴 S4b 发布闸门的界面出口：聊天里只有一份，挂在根节点下（见模板注释） */
const { push } = useRouter()
const gateRef = ref()
/** 被拦下的那条草稿的 defId，供「去设计器修改」跳转用；设计器认的是 query.id */
const gateDefId = ref<number>()

/**
 * 确认并运行：先体检、再发布（DRAFT→PUBLISHED，幂等），最后跑既有 run-stream
 *
 * 刻意不复用 hitl 的挂起/恢复 —— 那套绑定「活的执行 + DB checkpoint 线程」，
 * 与聊天里一张轻确认卡不匹配。这里走无状态确认：发布是幂等的纯状态跃迁，运行是一次全新执行。
 */
const handleConfirmWorkflow = async (item: any) => {
  if (!item.workflowCode) return
  // 🔴 发布前先自己体一遍（S4b）。C2 之后后端那句拒绝文案**能到这里了**（下面 catch 就把它拼了进去），
  //    但预检依旧不是「少一次往返」的优化：那句话是七八条修正项用「；」拼成的一长串，
  //    拦截器只会把它塞进一个 4.5 秒自动消失的通知标题，用户读不完它就没了，
  //    而这条路径上的草稿恰恰是 LLM 一次生成的、最可能不过体检的那种。
  //    这个预检因此是这条路径唯一能把「改哪儿」**逐条、且停在那儿**说给人听的通道。
  // ⚠️ 但 /validate 要 agent:workflow:query，那是这条路径今天没有的一个权限要求，
  //    403 时按 publish-blind 降级照发（见 publishGate.ts），修 #70 时两个权限要一起给。
  const verdict = await precheckPublish(
    async () => {
      // 🔴 抛而不是返回 null：defId 缺失时我们**不知道** DSL 是空的，
      //    返回 null 会被判成「流程内容为空」—— 一句错的诊断比一句「没体成」更难查。
      //    抛出去 ⟹ publish-blind ⟹ 照发，让后端闸门去做唯一的真判据。
      if (!item.workflowDefId) throw new Error('missing workflowDefId')
      return (await AgentPlannerApi.getWorkflowDraft(item.workflowDefId)).dsl
    },
    // 🔴 带上草稿卡那条定义的 id（台账 #81）：后端按它数执行史，给**已落地的撞车**降一档。
    //    这条路径上的草稿是 LLM 一次生成的、通常还没跑过 ⟹ 拿到 0 次 ⟹ 一档都不降，正是该有的行为；
    //    而「确认并运行」之后再次点它时，它已经真跑过了，那时降档才开始起作用。
    (dsl) => AgentWorkflowApi.validateDsl(dsl, item.workflowDefId)
  )
  if (verdict.action === 'block') {
    gateDefId.value = item.workflowDefId
    gateRef.value?.open(verdict.errors, verdict.warnings)
    return
  }
  if (verdict.action === 'publish-blind') {
    message.warning(`${verdict.reason}，将直接尝试发布`)
  }
  try {
    const published = await AgentPlannerApi.publishWorkflow(item.workflowCode)
    item.defStatus = published.status || 'PUBLISHED'
    item.cardStatus = 'published'
  } catch (e: any) {
    // 🔴 现在把 `e.message` 拼回来了（C2 已修：拦截器 reject 的是 Error(msg)，不再是字面量 'error'）。
    //    但**只有真因还不够** —— 聊天卡这里没有逐条清单的落点：闸门拒了而预检没拦住，
    //    多半是预检自己没体成（上面那句 warning 已经说过），或者是预检与发布之间有人改了库，
    //    两种都得去列表页那套完整体检里才看得清。所以真因后面仍然要给一条走得通的路。
    const reason = e?.message ? `：${e.message}` : ''
    message.error(
      `发布被后端拒绝${reason}。请到「流程编排」列表页找到这条流程，点「设计」→「体检」查看逐条原因。`
    )
    return
  }
  await runWorkflow(item)
}

const goDesignFromGate = () => {
  if (gateDefId.value) {
    push({ name: 'AgentWorkflowEditor', query: { id: String(gateDefId.value) } })
  }
}

/**
 * 运行已发布的流程，把 WorkflowEvent 流渲染成卡片上的节点进度与终态
 *
 * 返回 Promise：fetchEventSource 本身不返回完成时机，这里手动包一层，
 * 让 handleConfirmWorkflow 能 await 到「运行结束」再收尾。
 */
const runWorkflow = (item: any): Promise<void> => {
  return new Promise<void>((resolve) => {
    item.running = true
    item.runProgress = []
    item.runResult = null
    item.runError = ''
    const ctrl = new AbortController()
    item.runAbort = ctrl
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      item.running = false
      item.runAbort = null
      item.cardStatus = 'done'
      resolve()
    }
    AgentPlannerApi.runWorkflowStream(
      item.workflowCode,
      {},
      ctrl,
      (event) => {
        let payload: any
        try {
          payload = JSON.parse(event.data)
        } catch {
          return
        }
        if (payload.code !== 0) {
          item.runResult = 'error'
          item.runError = payload.msg || '运行失败'
          return
        }
        const data = payload.data
        switch (data.type) {
          case 'META':
            // 执行实例编号在 META 里下发；INTERRUPTED 事件只带 nodeId，确认卡片两样都要
            item.runExecutionId = data.executionId
            break
          case 'NODE':
            // NODE 在节点「完成」时到达，带上 nodeId；从预览里回填可读名
            if (data.nodeId) {
              const preview = (item.nodes ?? []).find((n: any) => n.id === data.nodeId)
              item.runProgress = [...item.runProgress, { nodeId: data.nodeId, name: preview?.name }]
            }
            break
          case 'INTERRUPTED':
            item.runResult = 'interrupted'
            /**
             * 🔴 2026-09-29 修的死路：这里原来只置 runResult='interrupted'，界面上剩一句
             * 「可在「流程执行」页恢复」—— 而那个页根本不存在，执行历史抽屉也是只读的，
             * 用户拿着一条 INTERRUPTED 执行无处可点（实测见会话#242 设备管理流程）。
             * 聊天路由撞闸口会发 WORKFLOW_CONFIRM 落一张确认卡，这条「草稿卡运行」路由
             * 没有那一落，于是就地补上同一张卡：executionId 取自 META、nodeId 取自本事件。
             */
            if (data.executionId ?? item.runExecutionId) {
              item.hitl = {
                executionId: data.executionId ?? item.runExecutionId,
                nodeId: data.nodeId,
                content: '流程走到人工确认闸口，已暂停等待您的决定。',
                manifest: null,
                manifestError: '',
                manifestLoading: true,
                running: false,
                decided: null,
                error: ''
              }
              /**
               * 🔴 这条路由的事件是 planner 的 `WorkflowEvent`，不是助手那条 `AgentChatEvent`，
               *    后端不会在 INTERRUPTED 里塞清单，只能前端自己查。
               *    走 fillManifestByExecution 而不是直接用手头的 `item.workflowDefId`：
               *    run-stream 按 code 跑，后端选的是已发布/主版本，草稿不一定是那一版。
               *    nodeId 这条路是**活的**，所以能拿到与直播同等口径的裁剪清单。
               */
              void fillManifestByExecution(
                item.hitl,
                data.executionId ?? item.runExecutionId,
                data.nodeId
              )
            }
            break
          case 'DONE':
            item.runResult = 'success'
            break
          case 'ERROR':
            item.runResult = 'error'
            item.runError = data.errorMsg || '运行失败'
            break
          default:
            break
        }
      },
      (err) => {
        // 🔴 必须 throw：onerror 不抛异常 fetchEventSource 就会自动无限重连，反复计费
        if (!item.runResult) {
          item.runResult = 'error'
          item.runError = '连接中断，请重试'
        }
        finish()
        throw err
      },
      () => {
        finish()
      }
    )
  })
}

/** 取消：本地消除卡片即可。DRAFT 定义留存无害（同旧 plan 留 DRAFT），无停用端点，7b 不新增 */
const handleCancelWorkflow = (item: any) => {
  item.cardStatus = 'done'
  item.defStatus = 'CANCELLED'
  item.runResult = null
}

onBeforeUnmount(() => {
  // 组件销毁时掐掉连接与定时器，否则会留下一条跑着的 SSE 和一个空转的 timer。
  // 悬浮窗尤其要紧：它随时可能被关掉，而抽屉关闭就是销毁
  abortController?.abort()
  // 正在运行的 workflow run-stream 也要掐掉，否则抽屉关了它还在后台跑、还在往已销毁的卡片写状态
  messageList.value.forEach((m: any) => m?.runAbort?.abort?.())
  typewriter.stop()
})

defineExpose({
  loadMessages,
  reset,
  stop: handleStop,
  streaming,
  focus,
  isEmpty: computed(() => messageList.value.length === 0)
})
</script>

<style lang="scss" scoped>
/* 模板下拉的内容。popover 会被 teleport 到 body，但这些元素是在本组件模板里声明的，
   带 data-v 属性，故 scoped 规则照样命中；只有 popper 外壳（.agent-tpl-popover）不带，
   所以下面不去 styling 外壳本身。 */
.agent-tpl-body {
  min-height: 60px;
}

.agent-tpl-group + .agent-tpl-group {
  margin-top: 10px;
}

.agent-tpl-group-title {
  padding: 2px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.agent-tpl-item {
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;

  &:hover {
    background: var(--el-fill-color-light);
  }
}

.agent-tpl-item-name {
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-primary);
}

.agent-tpl-item-desc {
  margin-top: 2px;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-tpl-empty {
  padding: 16px 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.agent-tpl-foot {
  padding-top: 8px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  border-top: 1px solid var(--el-border-color-lighter);
}

/* 输入区顶边的拖拽热区：整宽 6px 压在分割线上（top:-3px 让它骑跨 border），
   hover 亮起一道主色提示「这里能拖」。 */
.agent-input-resize {
  position: absolute;
  top: -3px;
  right: 0;
  left: 0;
  z-index: 1;
  height: 6px;
  cursor: row-resize;

  &:hover {
    background: var(--el-color-primary-light-5);
  }
}

/* 拖高之后让 textarea 跟着撑满外层。外层默认没有 height（由 rows 决定），
   百分比对 auto 会退化成 auto，所以默认的 3 行外观不受影响。 */
.agent-input-wrap {
  :deep(.el-textarea),
  :deep(.el-textarea__inner) {
    height: 100%;
  }
}
</style>
