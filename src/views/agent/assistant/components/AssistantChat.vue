<template>
  <div class="flex flex-col min-w-0 h-full">
    <el-scrollbar ref="scrollbarRef" class="flex-1" :class="compact ? 'px-14px' : 'px-24px'">
      <!-- 空态：给引导问题（对标简道云的「预设高频引导问题」） -->
      <div v-if="messageList.length === 0" class="flex flex-col items-center"
           :class="compact ? 'pt-40px' : 'pt-80px'">
        <Icon icon="ep:magic-stick" :size="compact ? 36 : 48"
              class="text-[var(--el-color-primary)]" />
        <div class="mt-16px font-medium" :class="compact ? 'text-16px' : 'text-18px'">
          我是平台助手
        </div>
        <div class="mt-8px text-14px text-[var(--el-text-color-secondary)] text-center px-16px">
          表单设计、数据建模、权限配置的问题都可以问我，回答会标注手册出处
        </div>
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
        <div v-else class="flex">
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
              <div class="px-14px py-10px rounded-10px bg-[var(--el-fill-color-light)] break-words">
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

    <!-- 输入区 -->
    <div
      class="border-t border-[var(--el-border-color-lighter)] border-t-solid"
      :class="compact ? 'px-14px py-12px' : 'px-24px py-16px'"
    >
      <el-input
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
import { AgentAssistantApi } from '@/api/agent/assistant'
import type { AgentMessageVO, AgentSuggestionVO } from '@/api/agent/assistant'
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
 * 会话列表<b>不</b>在这里 —— 悬浮窗里没有它，那是外层的事。
 */
defineOptions({ name: 'AssistantChat' })

const props = defineProps<{
  /** 当前会话编号。为空表示「新对话」，真发第一句话时后端会自动建 */
  conversationId?: number
  /** 紧凑模式：悬浮窗里空间有限，缩小留白、少显示几句说明 */
  compact?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:conversationId', id: number | undefined): void
  /** 会话有变化（新建、标题更新）时通知外层刷新列表 */
  (e: 'conversation-updated'): void
}>()

const message = useMessage()

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
        scrollToBottom()
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

/** 加载某个会话的消息 */
const loadMessages = async (conversationId: number) => {
  innerConversationId.value = conversationId
  const list: AgentMessageVO[] = await AgentAssistantApi.getMessageList(conversationId)
  // 有 planId 的助手消息需要恢复卡片状态
  const rebuilt = await Promise.all(
    list.map(async (item) => {
      const msg: any = { ...item }
      if (item.role === 'assistant' && (item as any).planId) {
        try {
          const plan: any = await AgentPlanApi.getPlan((item as any).planId)
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
  messageList.value = rebuilt
  await scrollToBottom()
}

/** 清空成「新对话」。刻意不立刻调后端建会话，避免攒一堆空会话 */
const reset = () => {
  if (streaming.value) handleStop()
  innerConversationId.value = undefined
  emit('update:conversationId', undefined)
  messageList.value = []
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
        assistantMessage.status = 'SUCCESS'
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
    last.status = 'SUCCESS'
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

defineExpose({ loadMessages, reset, stop: handleStop, streaming })
</script>
