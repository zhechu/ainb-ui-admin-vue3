<!-- 会话列表 -->
<template>
  <div class="flex flex-col h-full">
    <!-- 紧凑模式（悬浮窗）下不给大按钮：新建入口在抽屉头部，这里再放一个会挤掉列表高度 -->
    <div v-if="!compact" class="p-12px">
      <el-button type="primary" class="w-full" @click="emit('create')">
        <Icon icon="ep:plus" class="mr-5px" /> 新建对话
      </el-button>
    </div>
    <el-scrollbar v-loading="loading" class="flex-1">
      <div v-for="group in groups" :key="group.label" class="mb-4px">
        <div
          class="py-6px text-12px text-[var(--el-text-color-secondary)]"
          :class="compact ? 'px-14px' : 'px-16px'"
        >
          {{ group.label }}
        </div>
        <div
          v-for="item in group.items"
          :key="item.id"
          class="mb-6px p-10px rounded-8px cursor-pointer transition-all group"
          :class="[
            compact ? 'mx-8px' : 'mx-12px',
            item.id === activeId
              ? 'bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]'
              : 'hover:bg-[var(--el-fill-color-light)]'
          ]"
          :data-conversation-id="item.id"
          :data-active="item.id === activeId ? 'true' : undefined"
          @click="emit('select', item.id)"
        >
          <div class="flex items-center justify-between">
            <!-- 标题过长会被 truncate 截断，hover 用 tooltip 补全完整标题（历史会话可读性） -->
            <el-tooltip :content="item.title" placement="top" :disabled="!item.title">
              <span class="truncate text-14px flex items-center gap-4px min-w-0">
                <Icon v-if="item.pinned" icon="ep:top" :size="13" />
                {{ item.title }}
              </span>
            </el-tooltip>
            <el-dropdown trigger="click" @command="(cmd) => onCommand(cmd, item)">
              <Icon
                icon="ep:more-filled"
                :size="14"
                class="opacity-0 group-hover:opacity-100 transition-opacity"
                @click.stop
              />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename">
                    <Icon icon="ep:edit" class="mr-5px" /> 重命名
                  </el-dropdown-item>
                  <el-dropdown-item command="pin">
                    <Icon icon="ep:top" class="mr-5px" />
                    {{ item.pinned ? '取消置顶' : '置顶' }}
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    <Icon icon="ep:delete" class="mr-5px" /> 删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <div class="text-12px text-[var(--el-text-color-secondary)] mt-4px">
            {{ formatDate(item.lastActiveTime) }}
          </div>
        </div>
      </div>
      <el-empty v-if="list.length === 0" description="还没有对话" :image-size="60" />
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import { formatDate } from '@/utils/formatTime'
import type { AgentConversationVO } from '@/api/agent/assistant'

const props = defineProps<{
  list: AgentConversationVO[]
  activeId?: number
  /** 紧凑模式：悬浮窗里空间有限，收窄留白、不渲染「新建对话」大按钮 */
  compact?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'select', id: number): void
  (e: 'rename', item: AgentConversationVO): void
  (e: 'pin', item: AgentConversationVO): void
  (e: 'delete', item: AgentConversationVO): void
}>()

/**
 * 按时间分组
 *
 * 分组依据是 lastActiveTime 而不是 createTime：用户找会话时想的是
 * 「我昨天问过的那个」，不是「我三天前建的那个」。
 * 分档比 ai/chat 那套（今天/一天前/三天前/七天前/三十天前）更粗 ——
 * 助手会话的量级远小于 AI 聊天，五档已经够定位，档位太细反而每档只有一两条，
 * 看上去像一堆孤立的小标题。
 */
const groups = computed(() => {
  const todayStart = dayjs().startOf('day')
  const buckets: { label: string; items: AgentConversationVO[] }[] = [
    { label: '置顶', items: [] },
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '7 天内', items: [] },
    { label: '更早', items: [] }
  ]
  for (const item of props.list) {
    if (item.pinned) {
      buckets[0].items.push(item)
      continue
    }
    const time = dayjs(item.lastActiveTime ?? item.createTime)
    if (!time.isValid() || !time.isBefore(todayStart)) {
      buckets[1].items.push(item)
    } else if (time.isAfter(todayStart.subtract(1, 'day'))) {
      buckets[2].items.push(item)
    } else if (time.isAfter(todayStart.subtract(7, 'day'))) {
      buckets[3].items.push(item)
    } else {
      buckets[4].items.push(item)
    }
  }
  return buckets.filter((bucket) => bucket.items.length > 0)
})

const onCommand = (command: string, item: AgentConversationVO) => {
  emit(command as any, item)
}
</script>
