<template>
  <div class="flex flex-col min-w-0 h-full">
    <!-- Agent 选择器：增量10（slice-2）——选中一个已发布 Agent，它的人设即成系统提示词、
         绑定模型即固定问答模型。🔴 会话一旦建立（innerConversationId 有值）就锁定：
         D4「创建时定、之后以会话为准」，防一轮对话中途换 Agent 导致历史里混两套人设。
         新建对话（未落库）时可自由选。compact（悬浮球）下收窄但不隐藏，否则悬浮球无法选 Agent。 -->
    <div
      class="flex items-center gap-8px border-b border-[var(--el-border-color-lighter)] border-b-solid flex-shrink-0"
      :class="compact ? 'px-14px py-8px' : 'px-24px py-10px'"
    >
      <span class="text-13px text-[var(--el-text-color-secondary)] flex-shrink-0">Agent</span>
      <el-select
        v-model="agentSelectorModel"
        data-testid="agent-picker"
        :disabled="isAgentLocked"
        :size="compact ? 'small' : 'default'"
        :class="compact ? 'w-130px' : 'w-220px'"
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
    </div>

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
            <span class="truncate">继续上次对话：{{ resumeTarget.title }}</span>
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
                :nodes="item.nodes"
                :def-status="item.defStatus"
                :running="item.running"
                :run-progress="item.runProgress"
                :run-result="item.runResult"
                :run-error="item.runError"
                @confirm="() => handleConfirmWorkflow(item)"
                @cancel="() => handleCancelWorkflow(item)"
              />

              <!-- HITL 确认卡片（增量13）：流程走到人工闸口，就在聊天里问「同意/拒绝」，
                   不再把用户支去「工作流执行历史」里恢复。三态由 item.hitl 承载：
                   待确认（decided=null）→ 续跑中（running）→ 已处理（decided 有值） -->
              <HitlConfirmCard
                v-else-if="item.hitl"
                :content="item.hitl.content"
                :node-id="item.hitl.nodeId"
                :running="item.hitl.running"
                :decided="item.hitl.decided"
                :error="item.hitl.error"
                @decide="(approved) => handleHitlDecision(item, approved)"
              />

              <!-- 普通问答气泡 -->
              <template v-else>
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
      class="border-t border-[var(--el-border-color-lighter)] border-t-solid"
      :class="compact ? 'px-14px py-12px' : 'px-24px py-16px'"
    >
      <el-input
        ref="inputRef"
        v-model="inputText"
        type="textarea"
        :rows="compact ? 2 : 3"
        resize="none"
        maxlength="2000"
        show-word-limit
        placeholder="问点什么吧，Enter 发送 / Shift+Enter 换行"
        @keydown.enter="handleEnter"
      />
      <div class="flex justify-between items-center mt-10px">
        <span v-if="!compact" class="text-12px text-[var(--el-text-color-secondary)]">
          {{ effectiveAgentDefId ? '回答由所选 Agent 的人设驱动' : '回答依据平台手册，若手册未覆盖会如实说明' }}
        </span>
        <span v-else></span>
        <div>
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
import { AgentPlannerApi } from '@/api/agent/planner'
import type { AgentWorkflowDraftVO, WorkflowNodePreview } from '@/api/agent/planner'
import { AgentWorkflowApi } from '@/api/agent/workflow'
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
    agentDefList.value = page?.list ?? []
  } catch {
    agentDefList.value = [] // 拉不到目录不阻断对话：仍可走默认平台助手
  }
}
onMounted(loadAgentDefs)

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

/** 中断控制器：用户点「停止」或切换会话时要能真的把连接掐掉 */
let abortController: AbortController | null = null

/**
 * 打字机缓冲
 *
 * 🔴 不把 SSE 收到的增量<b>直接</b>写进界面。
 * 厂商回包是一阵一阵的（几十字一坨），直接渲染会看到文字一块一块地蹦，
 * 比不做流式还难看。这里改成「收进缓冲区 + 定时匀速吐出」，
 * 并按积压量动态调速 —— 做法与 ai/chat 的 textRoll 一致（index.vue:581-591）。
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
 * 从 DSL 原文抠出只读节点预览
 *
 * DSL 是一整份 WorkflowDefDTO JSON，卡片只需要 nodes[] 的 {id,type,name}。
 * 解析失败（草稿 dsl 异常）返回空数组，卡片显示「未能解析出节点预览」而不是崩掉。
 */
const parseNodes = (dsl?: string): WorkflowNodePreview[] => {
  if (!dsl) return []
  try {
    const nodes = JSON.parse(dsl)?.nodes
    if (!Array.isArray(nodes)) return []
    return nodes.map((n: any) => ({ id: n.id, type: n.type, name: n.name }))
  } catch {
    return []
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
          msg.nodes = parseNodes(draft.dsl)
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
            running: false,
            // 仍 INTERRUPTED → 刷新后还能接着确认（这是把 execution_id 落库的全部意义）；
            // 已终态 → 只能诚实地说「已处理」：库里没记当时用户点的是同意还是拒绝
            decided: exec.status === 'INTERRUPTED' ? null : 'resolved',
            error: ''
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
        content: data.content || '',
        running: false,
        decided: null as 'approved' | 'rejected' | 'resolved' | null,
        error: ''
      }
      break
    case 'DONE':
      msg.status = 'SUCCESS'
      break
    case 'ERROR':
      msg.status = 'ERROR'
      msg.errorMsg = data.errorMsg || 'AI 助手暂时无法回答'
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
        assistantMessage.status = 'ERROR'
        assistantMessage.errorMsg = payload.msg || '请求失败'
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
        assistantMessage.status = 'ERROR'
        assistantMessage.errorMsg = '连接中断，请重试'
      }
      throw err
    },
    () => {
      streaming.value = false
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
          assistantMessage.status = 'ERROR'
          assistantMessage.errorMsg = 'AI 助手没有返回任何内容，请重试；若反复出现请联系管理员查看服务端日志'
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
        answerMessage.status = 'ERROR'
        answerMessage.errorMsg = payload.msg || '续跑请求被拒绝'
        return
      }
      applyChatEvent(answerMessage, payload.data)
      // 续跑又撞上一个人工闸口（多闸口流程）：WORKFLOW_CONFIRM 会落在 answerMessage 上，
      // 它自己就成了下一张卡片，用户可以在同一段对话里连续确认
      if (payload.data?.type === 'WORKFLOW_CONFIRM') hitl.running = false
    },
    (err) => {
      // 🔴 同 handleSend：必须 throw，否则 fetchEventSource 会无限重连、反复提交 resume
      streaming.value = false
      typewriter.flush()
      hitl.running = false
      if (answerMessage.status === 'STREAMING') {
        answerMessage.status = 'ERROR'
        answerMessage.errorMsg = '连接中断，请重试'
      }
      throw err
    },
    () => {
      streaming.value = false
      hitl.running = false
      if (answerMessage.status === 'STREAMING') {
        // 同 handleSend 的空流判定；确认卡片本身也算产出（连续闸口）
        if (!answerMessage.content && !answerMessage.workflowDefId && !answerMessage.hitl) {
          answerMessage.status = 'ERROR'
          answerMessage.errorMsg =
            '流程恢复后没有返回任何内容，请刷新页面查看执行状态；若反复出现请联系管理员查看服务端日志'
        } else {
          answerMessage.status = 'SUCCESS'
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
    item.nodes = parseNodes(draft.dsl)
    item.defStatus = draft.status
    item.cardStatus = draft.status === 'DRAFT' ? 'pending' : 'published'
    await scrollToBottom()
  } catch (e: any) {
    item.cardStatus = null
    message.error('加载流程草稿失败：' + (e?.message ?? '未知错误'))
  }
}

/**
 * 确认并运行：先发布（DRAFT→PUBLISHED，幂等），再跑既有 run-stream
 *
 * 刻意不复用 hitl 的挂起/恢复 —— 那套绑定「活的执行 + DB checkpoint 线程」，
 * 与聊天里一张轻确认卡不匹配。这里走无状态确认：发布是幂等的纯状态跃迁，运行是一次全新执行。
 */
const handleConfirmWorkflow = async (item: any) => {
  if (!item.workflowCode) return
  try {
    const published = await AgentPlannerApi.publishWorkflow(item.workflowCode)
    item.defStatus = published.status || 'PUBLISHED'
    item.cardStatus = 'published'
  } catch (e: any) {
    message.error('发布失败：' + (e?.message ?? '未知错误'))
    return
  }
  await runWorkflow(item)
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
          case 'NODE':
            // NODE 在节点「完成」时到达，带上 nodeId；从预览里回填可读名
            if (data.nodeId) {
              const preview = (item.nodes ?? []).find((n: any) => n.id === data.nodeId)
              item.runProgress = [...item.runProgress, { nodeId: data.nodeId, name: preview?.name }]
            }
            break
          case 'INTERRUPTED':
            item.runResult = 'interrupted'
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
