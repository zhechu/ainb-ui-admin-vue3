<template>
  <div class="logic-entry">
    <el-badge :value="problems.length" :hidden="problems.length === 0" type="danger">
      <el-button class="w-full" @click="handleOpen">
        <Icon icon="ep:set-up" class="mr-4px" />
        逻辑与扩展
      </el-button>
    </el-badge>
    <div v-if="problems.length > 0" class="logic-entry__hint">
      {{ problems.length }} 项配置有问题，保存前需要处理
    </div>
    <div v-else class="logic-entry__hint logic-entry__hint--normal">
      联动规则、跨字段校验、扩展方式
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 表单配置面板里的「逻辑与扩展」入口
 *
 * 这三项配置（联动规则 / 跨字段校验 / 扩展方式）原先是向导里的独立一步。
 * 独立成步的代价是：配联动时看不到自己刚设计的表单，只能靠记。
 * 改成从设计器的表单配置面板里开弹窗后，右边就是画布，上下文不丢。
 *
 * <h3>为什么按钮要带角标</h3>
 *
 * 「联动规则引用了已删字段」这类问题原先是敞开显示的一条内联告警。
 * 塞进弹窗后它会被藏在两次点击后面 —— 那等于把一条有效告警变成静默失效。
 * 所以问题数要冒到按钮上。
 *
 * 真正的拦截在保存/发布路径上（见 editor/index.vue 与后端
 * FormDesignPublishValidator#validateLogicRuleFields），角标只是提前告知。
 *
 * <h3>props 用 getter 而不是值</h3>
 *
 * 本组件是被 form-create 当作一条属性面板规则渲染的，而那条规则在面板建立时
 * 只构造一次。直接传数组的话，之后表单字段变了角标不会更新。
 * 传 getter 则每次求值都重新读一遍响应式源，角标跟着变。
 */
defineOptions({ name: 'LogicEntryButton' })

const props = defineProps<{
  /** 取当前的问题清单。传 getter 而非值，见上 */
  getProblems?: () => string[]
  /** 打开弹窗 */
  onOpen?: () => void
}>()

const problems = computed(() => props.getProblems?.() ?? [])

const handleOpen = () => props.onOpen?.()
</script>

<style lang="scss" scoped>
.logic-entry {
  padding: 4px 0 8px;

  :deep(.el-badge) {
    display: block;
  }

  &__hint {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-color-danger);

    &--normal {
      color: var(--el-text-color-secondary);
    }
  }
}
</style>
