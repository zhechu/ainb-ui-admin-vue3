<template>
  <div class="flex flex-col min-w-0 h-full">
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
            我是平台助手
          </div>
          <div class="mt-8px text-14px text-[var(--el-text-color-secondary)] text-center px-16px">
            表单设计、数据建模、权限配置的问题都可以问我，回答会标注手册出处
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
          <div class="flex flex-wrap gap-10px mt-24px justify-center max-w-560px">
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
              <!-- Plan 卡片（正在规划 / 待确认 / 执行完毕） -->
              <PlanCard
                v-if="item.planCardStatus"
                :status="item.planCardStatus"
                :planning-text="item.planningText"
                :summary="item.planSummary"
                :steps="item.planSteps"
                :warnings="item.planWarnings"
                :expire-time="item.planExpireTime"
                :executing="item.planExecuting"
                :execute-result="item.planExecuteResult"
                :plan-status="item.planStatus"
                @execute="() => handleExecutePlan(item)"
                @cancel="() => handleCancelPlan(item)"
                @selection-change="(ids) => handlePlanSelectionChange(item, ids)"
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
                v-if="index === messageList.length - 1 && !streaming && !item.planCardStatus"
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
          回答依据平台手册，若手册未覆盖会如实说明
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
import { AgentPlanApi } from '@/api/agent/plan'
import type { AgentPlanExecuteResultVO } from '@/api/agent/plan'
import SuggestionBar from './SuggestionBar.vue'
import MessageLoadingDots from './MessageLoadingDots.vue'
import PlanCard from './PlanCard.vue'
import MessageReasoning from '@/views/ai/chat/index/components/message/MessageReasoning.vue'
import MessageKnowledge from '@/views/ai/chat/index/components/message/MessageKnowledge.vue'

/**
 * 助手对话区
 *
 * <h3>为什么要把它从助手页里抽出来</h3>
 * 方案 §12 要求助手有<b>两个入口</b>：独立页面，以及任何页面上都能唤起的全局悬浮窗。
 * 两个入口的对话行为必须完全一样 —— 流式打字机、Plan 卡片、建议、中断，一条都不能差。
 *
 * <p>如果悬浮窗自己再写一份，这些逻辑就会各自漂移。而漂移在这里格外难查：
 * 两边都「能用」，只是某一边的 Plan 卡片不刷新、或者某一边的 SSE 忘了 abort
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
  const list: AgentMessageVO[] = await AgentAssistantApi.getMessageList(conversationId)
  if (seq !== loadSeq) return
  // 有 planId 的助手消息需要恢复卡片状态
  const rebuilt = await Promise.all(
    list.map(async (item) => {
      const msg: any = { ...item }
      // 🔴 这里曾经写成 (item as any).planId —— 那个 as any 掩盖了一个真缺陷：
      //    后端 AgentMessageRespVO 压根没有 planId 字段，运行时永远是 undefined，
      //    于是这个 if 从来没进去过，刷新页面后方案卡片必定退化成一段纯文字。
      //    现在 planId 已经在 AgentMessageVO 上声明、后端也真的返回了，不需要 as any
      if (item.role === 'assistant' && item.planId) {
        try {
          const plan: any = await AgentPlanApi.getPlan(item.planId)
          msg.planId = plan.id
          msg.planCardStatus = 'done'
          msg.planSummary = plan.summary
          msg.planSteps = plan.steps
          msg.planStatus = plan.status
          msg.planExpireTime = plan.expireTime
          // 如果状态仍是 PENDING_CONFIRM（会话里程序崩了没执行完），恢复成 pending 可重试
          if (plan.status === 'PENDING_CONFIRM') {
            msg.planCardStatus = 'pending'
          }
        } catch {
          // 计划加载失败就当普通消息显示
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

/** 发送 */
const handleSend = async (text?: string) => {
  const content = (text ?? inputText.value).trim()
  if (!content || streaming.value) return

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
      const data = payload.data
      switch (data.type) {
        case 'META':
          // 新建会话时要靠它拿到 conversationId，否则刷新页面就找不回这次对话
          if (data.conversationId) {
            innerConversationId.value = data.conversationId
            emit('update:conversationId', data.conversationId)
          }
          assistantMessage.references = data.references || []
          break
        case 'MESSAGE':
          typewriter.push(data.content || '')
          break
        case 'REASONING':
          assistantMessage.reasoningContent += data.content || ''
          break
        case 'SUGGESTIONS':
          assistantMessage.suggestions = data.suggestions || []
          break
        case 'PLANNING':
          // 规划进度：原地替换，不是追加
          assistantMessage.planCardStatus = 'planning'
          assistantMessage.planningText = data.content || '正在规划…'
          break
        case 'PLAN':
          // 产出了计划卡片：加载完整步骤
          assistantMessage.planSummary = data.summary || ''
          assistantMessage.planWarnings = data.warnings || []
          assistantMessage.planId = data.planId
          loadPlanSteps(assistantMessage, data.planId)
          break
        case 'DONE':
          assistantMessage.status = 'SUCCESS'
          break
        case 'ERROR':
          assistantMessage.status = 'ERROR'
          assistantMessage.errorMsg = data.errorMsg || 'AI 助手暂时无法回答'
          break
        default:
          // 后端新增了事件类型而前端还没跟上 —— 忽略即可，不要炸掉整个流
          break
      }
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
        if (!assistantMessage.content && !assistantMessage.planId) {
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
    if (!last.content && !last.planId) {
      last.status = 'ERROR'
      last.errorMsg = '已停止生成'
    } else {
      last.status = 'SUCCESS'
    }
  }
  // 规划进度中途停掉，卡片状态清除（没产出计划的话就没有卡片）
  if (last && last.planCardStatus === 'planning') {
    last.planCardStatus = null
    last.planningText = ''
  }
}

// ==================== Plan 卡片相关 ====================

/**
 * 加载完整的 Plan 步骤并切换卡片状态
 *
 * SSE 只带 planId 和摘要。步骤必须另取，理由见 AgentAssistantService.EventType.PLAN 的注释：
 * 刷新页面之后前端照样要靠 /agent/plan/get 重建卡片，那条路径无论如何都得存在。
 * 在流里再塞一份完整步骤等于维护两条组装逻辑，迟早不一致。
 */
const loadPlanSteps = async (item: any, planId: number) => {
  try {
    const plan: any = await AgentPlanApi.getPlan(planId)
    item.planCardStatus = 'pending'
    item.planSteps = plan.steps
    item.planExpireTime = plan.expireTime
    item.planStatus = plan.status
    await scrollToBottom()
  } catch (e: any) {
    item.planCardStatus = null
    message.error('加载变更计划失败：' + (e?.message ?? '未知错误'))
  }
}

/** 勾选变化 → 持久化到后端 */
const handlePlanSelectionChange = async (item: any, selectedIds: number[]) => {
  if (!item.planId) return
  try {
    await AgentPlanApi.updateSelected(item.planId, selectedIds)
  } catch {
    // 静默失败：下次加载时步骤状态会从库里来，不影响最终执行
  }
}

/** 确认执行 */
const handleExecutePlan = async (item: any) => {
  if (!item.planId) return
  item.planExecuting = true
  try {
    const result: AgentPlanExecuteResultVO = await AgentPlanApi.execute(item.planId)
    item.planExecuteResult = result
    // 刷一次计划拿最新的步骤状态
    const plan: any = await AgentPlanApi.getPlan(item.planId)
    item.planSteps = plan.steps
    item.planStatus = plan.status
    item.planCardStatus = 'done'
    if (result.failedCount > 0) {
      message.warning(`执行完成：${result.successCount} 步成功，${result.failedCount} 步失败`)
    } else {
      message.success(`执行完成，全部 ${result.successCount} 步成功`)
    }
    emit('conversation-updated')
  } catch (e: any) {
    message.error('执行失败：' + (e?.message ?? '未知错误'))
  } finally {
    item.planExecuting = false
  }
}

/** 取消计划 */
const handleCancelPlan = async (item: any) => {
  if (!item.planId) return
  try {
    await AgentPlanApi.cancel(item.planId)
    item.planCardStatus = 'done'
    item.planStatus = 'CANCELLED'
    item.planExecuteResult = {
      planId: item.planId,
      status: 'CANCELLED',
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      steps: []
    }
  } catch (e: any) {
    message.error('取消失败：' + (e?.message ?? '未知错误'))
  }
}

onBeforeUnmount(() => {
  // 组件销毁时掐掉连接与定时器，否则会留下一条跑着的 SSE 和一个空转的 timer。
  // 悬浮窗尤其要紧：它随时可能被关掉，而抽屉关闭就是销毁
  abortController?.abort()
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
