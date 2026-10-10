<script lang="ts" setup>
import { checkPermi } from '@/utils/permission'

defineOptions({ name: 'StatusSwitch' })

const props = withDefaults(
  defineProps<{
    /**
     * 单向：只表达「服务端已生效的状态」，组件永远不会自己改它。
     * 点击后 EP 的开关视觉由 checked = modelValue 驱动，prop 不变 → 动画回弹原位，
     * 这正是「服务端确认前不改本地状态」的可见表达；取消确认时也不需要回滚任何东西。
     */
    modelValue: boolean
    /**
     * 不传 / 空数组 = 不门控（与 TableActions 同一口径）。
     *
     * ⚠️ 做成 prop 而不是让页面写 v-hasPermi 挂在开关上：那个指令会把整个开关从 DOM 删掉，
     * 用户连当前状态都读不到。语义差别是——操作列按钮无权限 = 隐藏；
     * 状态开关无权限 = 可见但不可操作（状态是要读的信息，不是动作）。
     */
    permission?: string[]
    /** 额外禁用条件，与权限门控取或 */
    disabled?: boolean
    /** 按行 loading：页面传 statusLoadingId === row.id */
    loading?: boolean
    activeText?: string
    inactiveText?: string
    /**
     * 内嵌文字要占位：两个汉字在 12px 下是 24px，加上圆形按钮与右内边距，
     * EP 默认的 40 会截字。实测 48 时文字框只剩 2px 余量（右缘约 1px），52 留 6px。
     */
    width?: number
  }>(),
  {
    disabled: false,
    loading: false,
    activeText: '启用',
    inactiveText: '禁用',
    width: 52
  }
)

// ❗ 只有 change，刻意没有 update:modelValue —— 这样页面写不出 v-model，
//    「乐观更新」这个误用被 API 本身挡住，而不是靠注释劝阻。
// 二次确认也刻意留在页面：确认文案是领域事实（要引用具体的服务端行为才核得动），
// 而「只在往禁用方向确认」这种非对称策略塞进组件就得长出 confirmOn / confirmMessage 回调 DSL。
const emit = defineEmits<{ (e: 'change', next: boolean): void }>()

const permitted = computed(
  () => !props.permission || props.permission.length === 0 || checkPermi(props.permission)
)
</script>

<template>
  <el-switch
    class="status-switch"
    :model-value="modelValue"
    inline-prompt
    :active-text="activeText"
    :inactive-text="inactiveText"
    :width="width"
    :loading="loading"
    :disabled="!permitted || disabled"
    @change="(val: boolean | string | number) => emit('change', !!val)"
  />
</template>

<style lang="scss" scoped>
/*
  on 色统一 success，且刻意不给 prop：本 fork 已用 success 表达「启用/生效」多处
  （AI 模型列表的启用按钮、agent 配置的状态 tag、权限资源页的 ALLOW），给了 prop 就会再漂一次。
*/
.status-switch {
  --el-switch-on-color: var(--el-color-success);
}
</style>
