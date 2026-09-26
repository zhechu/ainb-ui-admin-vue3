<template>
  <!--
    🔴 球与抽屉必须<b>一起</b>受 v-if 控制，不能只藏球。
    只藏球的话，抽屉里的 AssistantChat 仍然挂在 DOM 上 ——
    于是在助手独立页上，页面里一个对话组件、浮层里还有一个，
    两边各自持有一条 SSE 连接与一个打字机定时器。
    实测踩到：跳到助手页后界面上出现了两份「我是平台助手」。
  -->
  <div v-if="visible">
    <div
      class="agent-dock-ball"
      :title="'AI 助手（' + triggerHint + '）'"
      data-testid="agent-dock-ball"
      @click="handleOpen"
    >
      <Icon icon="ep:magic-stick" :size="22" color="#fff" />
    </div>

    <el-drawer
      v-model="drawerVisible"
      :size="drawerSize"
      :with-header="false"
      direction="rtl"
      class="agent-dock-drawer"
    >
      <div class="flex flex-col h-full">
        <!-- 头部：对话视图与历史视图各一套按钮 -->
        <div
          class="flex items-center justify-between px-16px py-12px border-b border-[var(--el-border-color-lighter)] border-b-solid"
        >
          <div class="flex items-center min-w-0">
            <template v-if="view === 'chat'">
              <Icon icon="ep:magic-stick" :size="18" class="text-[var(--el-color-primary)]" />
              <span class="ml-8px text-15px font-medium">AI 助手</span>
            </template>
            <template v-else>
              <el-button link data-testid="agent-dock-history-back" @click="view = 'chat'">
                <Icon icon="ep:arrow-left" :size="16" />
              </el-button>
              <span class="ml-4px text-15px font-medium">历史会话</span>
            </template>
          </div>
          <div class="flex items-center">
            <el-tooltip content="新对话" placement="bottom">
              <el-button link data-testid="agent-dock-new" @click="handleNewChat">
                <Icon icon="ep:plus" :size="16" />
              </el-button>
            </el-tooltip>
            <el-tooltip v-if="view === 'chat'" content="历史会话" placement="bottom">
              <el-button link data-testid="agent-dock-history" @click="openHistory">
                <Icon icon="ep:clock" :size="16" />
              </el-button>
            </el-tooltip>
            <el-tooltip
              v-if="view === 'chat'"
              content="在完整页面中打开"
              placement="bottom"
            >
              <el-button link data-testid="agent-dock-expand" @click="handleExpand">
                <Icon icon="ep:full-screen" :size="16" />
              </el-button>
            </el-tooltip>
            <el-tooltip content="收起" placement="bottom">
              <el-button link data-testid="agent-dock-close" @click="drawerVisible = false">
                <Icon icon="ep:close" :size="16" />
              </el-button>
            </el-tooltip>
          </div>
        </div>

        <!--
          对话区：与独立页共用同一个组件。
          🔴 切到历史视图时用 v-show 藏起来，不能 v-if 摘掉 ——
          摘掉就等于销毁组件，正在跑的那条 SSE 会被 onBeforeUnmount 掐断，
          用户「翻个历史」的代价是回答生成到一半没了
        -->
        <AssistantChat
          v-if="loaded"
          v-show="view === 'chat'"
          ref="chatRef"
          v-model:conversation-id="conversationId"
          :agent-def-id="activeAgentDefId"
          compact
          offer-resume
          class="flex-1 min-h-0"
          @conversation-updated="handleConversationUpdated"
        />

        <!-- 历史会话：复用独立页那份列表组件，不另写一套 -->
        <div v-show="view === 'list'" class="flex-1 min-h-0">
          <ConversationList
            compact
            :list="conversationList"
            :loading="listLoading"
            :active-id="conversationId"
            @create="handleNewChat"
            @select="handleSelectConversation"
            @rename="handleRename"
            @pin="handlePin"
            @delete="handleDelete"
          />
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { checkPermi } from '@/utils/permission'
import { useAppStore } from '@/store/modules/app'
import { AgentAssistantApi } from '@/api/agent/assistant'
import type { AgentConversationVO } from '@/api/agent/assistant'
import AssistantChat from '@/views/agent/assistant/components/AssistantChat.vue'
import ConversationList from '@/views/agent/assistant/components/ConversationList.vue'
import { useLastConversation } from '@/views/agent/assistant/useLastConversation'

/**
 * 全局悬浮助手入口（方案 §12）
 *
 * <h3>为什么要有它，而不是只留独立页面</h3>
 * 助手最常被需要的时刻，恰恰是用户<b>正卡在某个页面上</b>的时候 ——
 * 「我这个联动为什么不生效」是对着表单设计器问的。
 * 让他先离开当前页、再进助手页、问完再找回来，多数人不会这么做。
 *
 * <h3>三个刻意的取舍</h3>
 * <ol>
 *   <li><b>对话区不重写</b>：直接复用 {@link AssistantChat}。悬浮窗自己写一份的话，
 *       流式、Plan 卡片、中断这些逻辑会各自漂移，而且两边都「能用」，极难发现</li>
 *   <li><b>历史会话是抽屉里的一个视图，不是独立页的专利</b>：会话本来就全量落在后端，
 *       但「关掉抽屉就再也找不回刚才那句」的体验，等于逼用户为了翻历史离开当前页面 ——
 *       那正是这个悬浮球要消除的动作。列表复用独立页那份 ConversationList，
 *       重命名 / 置顶 / 删除的语义也与独立页逐条对齐，不做第二套</li>
 *   <li><b>抽屉内容懒加载、且加载后不卸载</b>：没点开之前不挂载 AssistantChat，
 *       否则每个页面都会白白初始化一遍；点开之后不再卸载，
 *       这样关掉再打开还在同一个会话里，正在生成的回答也不会断</li>
 * </ol>
 *
 * <h3>🔴 助手页上不显示这个球</h3>
 * 同一个页面出现两个入口，用户会以为是两个不同的东西；
 * 更实际的问题是两边各有一条 SSE 连接，同一个问题可能被提交两次。
 */
defineOptions({ name: 'AgentDock' })

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const message = useMessage()
const lastConversation = useLastConversation()

const drawerVisible = ref(false)
/** 抽屉内容是否已挂载过。用它做懒加载，关掉之后不再卸载，免得每次打开都重新拉消息 */
const loaded = ref(false)
/** 抽屉里当前显示的是对话还是历史列表 */
const view = ref<'chat' | 'list'>('chat')
const conversationId = ref<number>()
const chatRef = ref<InstanceType<typeof AssistantChat>>()
const conversationList = ref<AgentConversationVO[]>([])
const listLoading = ref(false)
/** 正在恢复上次会话，避免与用户手点会话抢同一份 messageList */
const restoring = ref(false)

/**
 * 当前会话绑定的 Agent 编号，传给对话区锁定选择器（D4/D7）。
 * 🔴 依赖 conversationList 已加载：抽屉的列表原本只在「历史视图」才拉，
 * 故 handleOpen 里补一次 refreshList，让「恢复上次会话」也能解析出绑定的 Agent。
 */
const activeAgentDefId = computed(
  () => conversationList.value.find((c) => c.id === conversationId.value)?.agentDefId ?? null
)

const triggerHint = '点击唤起'

/** 手机上 480px 会超出屏宽，抽屉直接铺满 */
const drawerSize = computed(() => (appStore.getMobile ? '100%' : 480))

/** 当前是不是助手独立页 */
const inAssistantPage = computed(
  () => route.name === 'AgentAssistant' || route.path.startsWith('/agent/assistant')
)

/**
 * 是否显示悬浮球
 *
 * 权限判定与菜单用的是同一个权限点。没有它的用户点开也只会收到
 * 「您没有执行该操作的权限」，不如不显示
 */
const visible = computed(() => !inAssistantPage.value && checkPermi(['agent:assistant:use']))

const handleOpen = async () => {
  loaded.value = true
  view.value = 'chat'
  drawerVisible.value = true
  // 等 AssistantChat 真的挂上再判断它是不是空的，否则首次打开时 chatRef 还是 undefined，
  // 会被误当成「已经有内容」而跳过恢复
  await nextTick()
  await ensureRestored()
  // 拉一次会话列表：既让历史视图有数据，也让 activeAgentDefId 能解析出恢复会话绑定的 Agent
  await refreshList()
  chatRef.value?.focus()
}

/**
 * 打开抽屉时接上「刚才那次对话」
 *
 * 优先级：内存里已有的会话（抽屉不卸载，它最准）> 30 分钟内的本地记忆 > 什么都不做。
 * 最后一种情况落在空态，由 AssistantChat 的 offerResume 给一个显式的
 * 「继续上次对话」按钮 —— <b>不</b>无条件静默恢复：隔天打开助手的人多半是来问新问题的，
 * 把他扔回昨天那个会话，他得先退出来才敢提问。
 */
const ensureRestored = async () => {
  if (restoring.value) return
  if (conversationId.value || !chatRef.value?.isEmpty) return
  const last = lastConversation.read()
  if (!last?.fresh) return
  restoring.value = true
  try {
    conversationId.value = last.id
    await chatRef.value?.loadMessages(last.id)
  } catch {
    // 会话可能已经在别处被删了。清掉记忆退回空态即可，不值得弹一个错误框
    lastConversation.clear()
    conversationId.value = undefined
    chatRef.value?.reset()
  } finally {
    restoring.value = false
  }
}

/**
 * 拉会话列表
 *
 * 每次进入历史视图都重拉：抽屉长期不卸载，缓存一份列表的话，
 * 用户在独立页删掉的会话在这里还赖着，点进去就是 404 式的空白。
 * pageSize 100 —— 后端把置顶排在前面，正常用量下足够；
 * 这是「置顶会话被分页挤掉」的缓解而非根治，真要根治得让后端把置顶单独返回。
 */
const refreshList = async () => {
  listLoading.value = true
  try {
    const page = await AgentAssistantApi.getConversationPage({ pageNo: 1, pageSize: 100 })
    conversationList.value = page?.list ?? []
    // 标题是后端在首问之后才生成的，这里顺手把本地记忆里的标题补全
    const current = conversationList.value.find((item) => item.id === conversationId.value)
    if (current) lastConversation.save(current.id, current.title)
  } finally {
    listLoading.value = false
  }
}

const openHistory = async () => {
  view.value = 'list'
  await refreshList()
}

const handleConversationUpdated = () => {
  // 新会话与自动生成的标题要靠这次刷新才看得到
  refreshList()
}

const handleNewChat = () => {
  chatRef.value?.reset()
  view.value = 'chat'
}

const handleSelectConversation = async (id: number) => {
  // 切走会话时必须掐掉连接，否则上一轮的增量会继续写进新会话的消息里
  chatRef.value?.stop()
  conversationId.value = id
  view.value = 'chat'
  await chatRef.value?.loadMessages(id)
}

const handleRename = async (item: AgentConversationVO) => {
  try {
    const { value } = await ElMessageBox.prompt('请输入新的标题', '重命名', {
      inputValue: item.title,
      inputValidator: (v: string) => (v && v.trim() ? true : '标题不能为空')
    })
    await AgentAssistantApi.updateConversationTitle(item.id, value.trim())
    message.success('重命名成功')
    await refreshList()
  } catch {}
}

const handlePin = async (item: AgentConversationVO) => {
  await AgentAssistantApi.updateConversationPinned(item.id, !item.pinned)
  await refreshList()
}

const handleDelete = async (item: AgentConversationVO) => {
  try {
    await message.delConfirm(`确认删除对话「${item.title}」吗？`)
    await AgentAssistantApi.deleteConversation(item.id)
    message.success('删除成功')
    if (conversationId.value === item.id) {
      // 删的正是当前会话：清空对话区，但<b>留在列表里</b> ——
      // 用户是在管理历史，把他甩回对话视图等于打断他接着删下一条
      chatRef.value?.reset()
    }
    await refreshList()
  } catch {}
}

const handleExpand = () => {
  drawerVisible.value = false
  // 独立页读的是同一份本地记忆，当前会话已经由下面的 watch 写进去了，
  // 所以跳过去会自动接上同一句对话
  router.push({ path: '/agent/assistant' })
}

// 会话一变就记下来。刷新页面、关掉抽屉再打开、跳到独立页，都靠它接上
watch(conversationId, (id) => {
  if (!id) {
    lastConversation.clear()
    return
  }
  const title = conversationList.value.find((item) => item.id === id)?.title
  lastConversation.save(id, title)
})

// 进助手页时把开合状态复位。
// 整块已经被 v-if 摘掉了，但 drawerVisible 这个 ref 还留在本组件里 ——
// 不复位的话，等用户从助手页再回到任意业务页，抽屉会自己弹开
watch(inAssistantPage, (val) => {
  if (val) {
    drawerVisible.value = false
    view.value = 'chat'
  }
})
</script>

<style lang="scss" scoped>
.agent-dock-ball {
  position: fixed;
  right: 24px;
  bottom: 96px; // 让开 Backtop（它在 bottom 40 左右）
  z-index: 2000;
  display: flex;
  width: 44px;
  height: 44px;
  cursor: pointer;
  background: var(--el-color-primary);
  border-radius: 50%;
  box-shadow: 0 4px 12px rgb(0 0 0 / 18%);
  align-items: center;
  justify-content: center;
  transition: transform 0.2s;

  &:hover {
    transform: scale(1.08);
  }
}

// 抽屉内容区默认有 padding，对话区要占满
:deep(.el-drawer__body) {
  padding: 0;
  overflow: hidden;
}
</style>
