<template>
  <div class="action-list">
    <div v-if="actions.length === 0" class="list-empty">还没有动作</div>

    <div v-for="(action, idx) in actions" :key="idx" class="action-row">
      <el-select
        :model-value="action.type"
        placeholder="动作"
        size="small"
        class="w-140px"
        @update:model-value="(v) => patch(idx, { type: v, payload: undefined })"
      >
        <el-option-group v-for="group in ACTION_GROUPS" :key="group.label" :label="group.label">
          <el-option v-for="a in group.items" :key="a.value" :label="a.label" :value="a.value" />
        </el-option-group>
      </el-select>

      <el-select
        :model-value="action.target"
        placeholder="目标字段"
        filterable
        size="small"
        class="w-180px"
        @update:model-value="(v) => patch(idx, { target: v })"
      >
        <el-option v-for="opt in fieldOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>

      <!-- 只有赋值动作需要填值 -->
      <el-input
        v-if="action.type === 'SET_VALUE'"
        :model-value="action.payload?.value"
        placeholder="要赋的值"
        size="small"
        class="flex-1"
        @update:model-value="(v) => patch(idx, { payload: { value: v } })"
      />
      <div v-else class="value-placeholder">
        {{ action.type === 'CLEAR_VALUE' ? '清空该字段的值' : '无需填值' }}
      </div>

      <el-button link type="danger" size="small" @click="remove(idx)">
        <Icon icon="ep:delete" />
      </el-button>
    </div>

    <el-button link type="primary" size="small" @click="add">
      <Icon icon="ep:plus" class="mr-3px" />
      添加动作
    </el-button>
  </div>
</template>

<script lang="ts" setup>
import type { LogicAction } from './types'

defineOptions({ name: 'ActionListEditor' })

/**
 * 动作列表编辑器
 *
 * 动作清单与求值器的 KNOWN_ACTIONS 一一对应。分组是为了让用户一眼看出
 * 「哪些是改状态的、哪些是改数据的」—— 只有后者会参与环形赋值。
 */
defineProps<{
  fieldOptions: Array<{ label: string; value: string }>
}>()

const model = defineModel<LogicAction[] | undefined>()

const ACTION_GROUPS = [
  {
    label: '显示与可用',
    items: [
      { value: 'SHOW', label: '显示' },
      { value: 'HIDE', label: '隐藏' },
      { value: 'ENABLE', label: '启用' },
      { value: 'DISABLE', label: '禁用' },
      { value: 'READONLY', label: '置为只读' },
      { value: 'EDITABLE', label: '置为可编辑' }
    ]
  },
  {
    label: '必填',
    items: [
      { value: 'REQUIRE', label: '置为必填' },
      { value: 'OPTIONAL', label: '置为非必填' }
    ]
  },
  {
    label: '改数据',
    items: [
      { value: 'SET_VALUE', label: '赋值' },
      { value: 'CLEAR_VALUE', label: '清空值' }
    ]
  }
]

const actions = computed<LogicAction[]>(() => model.value ?? [])

const write = (next: LogicAction[]) => {
  model.value = next
}

const add = () => write([...actions.value, { type: 'SHOW', target: '' }])

const remove = (index: number) => {
  const next = [...actions.value]
  next.splice(index, 1)
  write(next)
}

const patch = (index: number, p: Partial<LogicAction>) => {
  const next = [...actions.value]
  next[index] = { ...next[index], ...p }
  write(next)
}
</script>

<style lang="scss" scoped>
.action-list {
  padding: 10px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.list-empty {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.action-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.value-placeholder {
  flex: 1;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
</style>
