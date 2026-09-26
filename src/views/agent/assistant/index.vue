<template>
  <div class="flex h-[calc(100vh-130px)] bg-[var(--el-bg-color)] rounded-8px overflow-hidden">
    <!-- 左：会话列表 -->
    <div class="w-240px border-r border-[var(--el-border-color-lighter)] border-r-solid">
      <ConversationList
        :list="conversationList"
        :active-id="activeConversationId"
        @create="handleCreateConversation"
        @select="handleSelectConversation"
        @rename="handleRename"
        @pin="handlePin"
        @delete="handleDelete"
      />
    </div>

    <!-- 右：对话区。与全局悬浮窗共用同一个组件，行为必须一致 -->
    <AssistantChat
      ref="chatRef"
      v-model:conversation-id="activeConversationId"
      :agent-def-id="activeAgentDefId"
      class="flex-1"
      @conversation-updated="loadConversations"
    />
  </div>
</template>

<script setup lang="ts">
import { AgentAssistantApi } from '@/api/agent/assistant'
import type { AgentConversationVO } from '@/api/agent/assistant'
import ConversationList from './components/ConversationList.vue'
import AssistantChat from './components/AssistantChat.vue'
import { useLastConversation } from './useLastConversation'

defineOptions({ name: 'AgentAssistant' })

const message = useMessage()
const lastConversation = useLastConversation()

const conversationList = ref<AgentConversationVO[]>([])
const activeConversationId = ref<number>()
const chatRef = ref<InstanceType<typeof AssistantChat>>()

/**
 * 当前会话绑定的 Agent 编号，传给对话区锁定选择器（D4/D7）。
 * 从已加载的会话列表里取——列表本就带 agentDefId，无需额外请求。
 */
const activeAgentDefId = computed(
  () => conversationList.value.find((c) => c.id === activeConversationId.value)?.agentDefId ?? null
)

/** 加载会话列表 */
const loadConversations = async () => {
  // pageSize 100：后端把置顶排在前面，正常用量下够用。
  // 下面恢复上次会话时要用这份列表校验「它还在不在」，取太少会把老会话误判成已删除
  const page = await AgentAssistantApi.getConversationPage({ pageNo: 1, pageSize: 100 })
  conversationList.value = page.list
}

const handleSelectConversation = async (id: number) => {
  // 切走会话时必须掐掉连接，否则上一轮的增量会继续写进新会话的消息里
  chatRef.value?.stop()
  activeConversationId.value = id
  await chatRef.value?.loadMessages(id)
}

const handleCreateConversation = () => {
  chatRef.value?.reset()
}

const handleRename = async (item: AgentConversationVO) => {
  try {
    const { value } = await ElMessageBox.prompt('请输入新的标题', '重命名', {
      inputValue: item.title,
      inputValidator: (v: string) => (v && v.trim() ? true : '标题不能为空')
    })
    await AgentAssistantApi.updateConversationTitle(item.id, value.trim())
    message.success('重命名成功')
    await loadConversations()
  } catch {}
}

const handlePin = async (item: AgentConversationVO) => {
  await AgentAssistantApi.updateConversationPinned(item.id, !item.pinned)
  await loadConversations()
}

const handleDelete = async (item: AgentConversationVO) => {
  try {
    await message.delConfirm(`确认删除对话「${item.title}」吗？`)
    await AgentAssistantApi.deleteConversation(item.id)
    message.success('删除成功')
    if (activeConversationId.value === item.id) {
      handleCreateConversation()
    }
    await loadConversations()
  } catch {}
}

/**
 * 记住当前会话，供刷新后与全局悬浮窗接上
 *
 * 悬浮窗和这里是同一个助手的两个入口，用户不会因为换了个入口就该 lose 上下文。
 * 缓存按 userId 分片（见 useLastConversation），换账号不会串。
 */
watch(activeConversationId, (id) => {
  if (!id) {
    lastConversation.clear()
    return
  }
  const title = conversationList.value.find((item) => item.id === id)?.title
  lastConversation.save(id, title)
})

onMounted(async () => {
  await loadConversations()
  // 刷新后接上上次的会话。这里不像悬浮窗那样区分「30 分钟内」——
  // 独立页左边就是完整列表，恢复选中不会让人误以为要问新问题，反而是他期待的
  const last = lastConversation.read()
  if (!last) return
  const stillExists = conversationList.value.some((item) => item.id === last.id)
  if (!stillExists) {
    // 会话已在别处删掉（或老到落在前 100 条之外），记忆作废
    lastConversation.clear()
    return
  }
  activeConversationId.value = last.id
  try {
    await chatRef.value?.loadMessages(last.id)
  } catch {
    lastConversation.clear()
    activeConversationId.value = undefined
  }
})
</script>
