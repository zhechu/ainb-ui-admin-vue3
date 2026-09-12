<template>
  <el-link type="primary" :underline="false" class="collapse-toggle" @click="toggle">
    {{ collapsed ? '展开' : '收起' }}
    <Icon :icon="collapsed ? 'ep:arrow-down' : 'ep:arrow-up'" class="ml-2px" />
  </el-link>
</template>

<script lang="ts" setup>
/**
 * 分组标题的折叠开关（运行时）
 *
 * 挂在标题规则的 `suffix` 上渲染，点一下折叠/展开这个标题管辖的那批控件。
 *
 * ## 状态归页面管，不归自己管
 *
 * 折叠要把控件从规则树里摘掉（标为隐藏的话，联动的 SHOW 能把它重新显示出来），
 * 而规则树在渲染页手里。所以本组件只负责「告诉页面用户点了」——
 * 通过 provide/inject 拿到页面提供的开关函数。
 *
 * 为什么不用 form-create 的 api：suffix 规则渲染出来的组件能不能拿到
 * `formCreateInject` 并不确定，而 provide/inject 是 Vue 自己的机制，
 * 只要组件在页面的组件树里就一定通 —— 不依赖 form-create 的内部约定。
 */
import { COLLAPSE_CONTROL, type CollapseControl } from '@/components/FormWidgets/collapseInject'

defineOptions({ name: 'CollapseToggle' })

const props = defineProps<{
  /** 分组标识，即标题控件的 field */
  groupKey?: string
}>()

/**
 * 页面注入的折叠控制
 *
 * 取不到时（比如在设计器预览里渲染）整个开关按「不可用」处理：
 * 显示成收起状态、点了没反应，好过报错把表单渲染打断
 */
const control = inject<CollapseControl | undefined>(COLLAPSE_CONTROL, undefined)

const collapsed = computed(() => (props.groupKey ? control?.isCollapsed(props.groupKey) : false))

const toggle = () => {
  if (props.groupKey) control?.toggle(props.groupKey)
}
</script>

<style lang="scss" scoped>
.collapse-toggle {
  margin-left: 12px;
  font-size: 13px;
  font-weight: normal;
}
</style>
