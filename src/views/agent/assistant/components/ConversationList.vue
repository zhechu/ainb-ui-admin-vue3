<!-- 会话列表 -->
<template>
  <div class="flex flex-col h-full">
    <div class="p-12px">
      <el-button type="primary" class="w-full" @click="emit('create')">
        <Icon icon="ep:plus" class="mr-5px" /> 新建对话
      </el-button>
    </div>
    <el-scrollbar class="flex-1">
      <div
        v-for="item in list"
        :key="item.id"
        class="mx-12px mb-6px p-10px rounded-8px cursor-pointer transition-all group"
        :class="
          item.id === activeId
            ? 'bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]'
            : 'hover:bg-[var(--el-fill-color-light)]'
        "
        @click="emit('select', item.id)"
      >
        <div class="flex items-center justify-between">
          <span class="truncate text-14px flex items-center gap-4px">
            <Icon v-if="item.pinned" icon="ep:top" :size="13" />
            {{ item.title }}
          </span>
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
      <el-empty v-if="list.length === 0" description="还没有对话" :image-size="60" />
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { formatDate } from '@/utils/formatTime'
import type { AgentConversationVO } from '@/api/agent/assistant'

defineProps<{
  list: AgentConversationVO[]
  activeId?: number
}>()

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'select', id: number): void
  (e: 'rename', item: AgentConversationVO): void
  (e: 'pin', item: AgentConversationVO): void
  (e: 'delete', item: AgentConversationVO): void
}>()

const onCommand = (command: string, item: AgentConversationVO) => {
  emit(command as any, item)
}
</script>
