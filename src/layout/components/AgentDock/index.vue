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
      :size="480"
      :with-header="false"
      direction="rtl"
      class="agent-dock-drawer"
    >
      <div class="flex flex-col h-full">
        <!-- 头部 -->
        <div
          class="flex items-center justify-between px-16px py-12px border-b border-[var(--el-border-color-lighter)] border-b-solid"
        >
          <div class="flex items-center">
            <Icon icon="ep:magic-stick" :size="18" class="text-[var(--el-color-primary)]" />
            <span class="ml-8px text-15px font-medium">AI 助手</span>
          </div>
          <div class="flex items-center">
            <el-tooltip content="新对话" placement="bottom">
              <el-button link data-testid="agent-dock-new" @click="handleNewChat">
                <Icon icon="ep:plus" :size="16" />
              </el-button>
            </el-tooltip>
            <el-tooltip content="在完整页面中打开（可管理历史会话）" placement="bottom">
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

        <!-- 对话区：与独立页共用同一个组件 -->
        <AssistantChat
          v-if="loaded"
          ref="chatRef"
          v-model:conversation-id="conversationId"
          compact
          class="flex-1 min-h-0"
        />
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { checkPermi } from '@/utils/permission'
import AssistantChat from '@/views/agent/assistant/components/AssistantChat.vue'

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
 *   <li><b>悬浮窗里没有会话列表</b>：它是「随手问一句」的场景，不是「管理历史」的场景。
 *       要翻历史就点右上角展开到完整页面</li>
 *   <li><b>抽屉内容懒加载</b>：没点开之前不挂载 AssistantChat。
 *       否则每个页面都会白白初始化一遍对话组件</li>
 * </ol>
 *
 * <h3>🔴 助手页上不显示这个球</h3>
 * 同一个页面出现两个入口，用户会以为是两个不同的东西；
 * 更实际的问题是两边各有一条 SSE 连接，同一个问题可能被提交两次。
 */
defineOptions({ name: 'AgentDock' })

const route = useRoute()
const router = useRouter()

const drawerVisible = ref(false)
/** 抽屉内容是否已挂载过。用它做懒加载，关掉之后不再卸载，免得每次打开都重新拉消息 */
const loaded = ref(false)
const conversationId = ref<number>()
const chatRef = ref<InstanceType<typeof AssistantChat>>()

const triggerHint = '点击唤起'

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

const handleOpen = () => {
  loaded.value = true
  drawerVisible.value = true
}

const handleNewChat = () => {
  chatRef.value?.reset()
}

const handleExpand = () => {
  drawerVisible.value = false
  router.push({ path: '/agent/assistant' })
}

// 进助手页时把开合状态复位。
// 整块已经被 v-if 摘掉了，但 drawerVisible 这个 ref 还留在本组件里 ——
// 不复位的话，等用户从助手页再回到任意业务页，抽屉会自己弹开
watch(inAssistantPage, (val) => {
  if (val) {
    drawerVisible.value = false
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
