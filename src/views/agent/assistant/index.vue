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

defineOptions({ name: 'AgentAssistant' })

const message = useMessage()

const conversationList = ref<AgentConversationVO[]>([])
const activeConversationId = ref<number>()
const chatRef = ref<InstanceType<typeof AssistantChat>>()

/** 加载会话列表 */
const loadConversations = async () => {
  const page = await AgentAssistantApi.getConversationPage({ pageNo: 1, pageSize: 50 })
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

onMounted(loadConversations)
</script>
