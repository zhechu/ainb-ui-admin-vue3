<template>
  <!-- 居中弹窗：字段不多时最省事，不离开列表上下文 -->
  <Dialog v-if="mode === 'DIALOG'" v-model="visible" :title="title" :width="dialogWidth">
    <slot></slot>
    <template #footer>
      <slot name="footer"></slot>
    </template>
  </Dialog>

  <!-- 右侧抽屉：比弹窗高，适合字段多但每个都窄的表单 -->
  <el-drawer
    v-else-if="mode === 'DRAWER'"
    v-model="visible"
    :size="drawerWidth"
    :title="title"
    destroy-on-close
  >
    <slot></slot>
    <!--
      el-drawer 的 footer 插槽在 Element Plus 2.3 之后才有，
      这个版本里有，但它不自带分隔线，补一条与弹窗保持一致
    -->
    <template #footer>
      <div class="panel-footer">
        <slot name="footer"></slot>
      </div>
    </template>
  </el-drawer>

  <!--
    页内显示：表单整块铺在页面上，列表由父组件让位

    字段一多，弹窗里那点高度就得一直滚，而滚动条一出现，「确定」按钮
    又跟着被压在视口外面。页内模式把整页给表单，按钮固定在底部。
  -->
  <div v-else-if="visible" class="inline-panel">
    <div class="inline-panel-header">
      <el-button link @click="close">
        <Icon class="mr-3px" icon="ep:arrow-left" />
        返回列表
      </el-button>
      <span class="inline-panel-title">{{ title }}</span>
    </div>

    <div class="inline-panel-body">
      <slot></slot>
    </div>

    <div class="inline-panel-footer">
      <slot name="footer"></slot>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 表单容器：按配置把同一份表单放进弹窗 / 抽屉 / 页内
 *
 * 做成「壳」而不是把表单内容搬进来：表单体那部分要用到十几个运行时状态
 * （表单值、fApi、规则树、详情页签、变更记录、关联数据、自定义按钮…），
 * 搬进来就得把它们全拆成 props，接口宽得没法维护，而且每加一个特性
 * 两边都要改。壳只管「装在哪里」，内容仍留在父组件里通过插槽传进来。
 */
import type { FormViewMode } from '@/components/FormWidgets/formViewMode'

defineOptions({ name: 'FormDesignFormContainer' })

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title?: string
    mode?: FormViewMode
  }>(),
  {
    title: '',
    mode: 'DIALOG'
  }
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const close = () => {
  visible.value = false
}

/** 弹窗宽度。比原来的 800 宽一点，两列布局的表单不至于挤 */
const dialogWidth = '900px'
/** 抽屉宽度。再宽就把列表整个盖住了，不如直接用页内模式 */
const drawerWidth = '720px'
</script>

<style lang="scss" scoped>
.panel-footer {
  text-align: right;
}

.inline-panel {
  display: flex;
  flex-direction: column;
  /*
    占满内容区

    56px 是头部导航，另外 32px 留给 app-main 的上下内边距。
    不给固定高度的话，底部按钮条会跟着内容一起被顶到页面下方，
    表单一长就得滚到最底下才能点「确定」—— 正是页内模式要解决的那个问题
  */
  height: calc(100vh - 88px);
  background-color: var(--el-bg-color);
  border-radius: 4px;
  overflow: hidden;
}

.inline-panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 50px;
  flex-shrink: 0;
  padding: 0 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.inline-panel-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.inline-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
}

.inline-panel-footer {
  flex-shrink: 0;
  padding: 12px 16px;
  text-align: right;
  border-top: 1px solid var(--el-border-color-lighter);
  background-color: var(--el-bg-color);
}
</style>
