<template>
  <div v-if="text" class="field-hint">{{ text }}</div>
</template>

<script lang="ts" setup>
/**
 * 表单项下面那行灰色说明
 *
 * <h3>为什么要抽成一个组件，而不是每处写一个 span</h3>
 * 本仓既有的写法是行内一个
 * {@code <span class="ml-8px text-12px text-[var(--el-text-color-secondary)]">}。
 * 那种写法适合「一句话、跟在控件右边」。扩展字段这一页的说明**都在控件下面**、
 * 而且是两三行，行内写十几遍的结果是每处的 class 都会漂一点
 * （有的漏了 {@code leading}、有的用了 {@code text-13px}），
 * 于是同一个弹窗里出现三种灰度与两种行距 —— 那不影响功能，但会让人以为它们是三种东西。
 *
 * <h3>🔴 空文本时**整个 div 都不渲染**</h3>
 * 留一个空 div 会撑出一段空白（它带 margin），表现是「这一项下面莫名其妙多了一截」。
 * 而 {@code FieldDefForm.vue} 里确实有几处说明是条件性的（编辑态才有那句话），
 * 所以这不是防御性代码。
 */
defineOptions({ name: 'QlzgFieldHint' })

defineProps<{ text?: string }>()
</script>

<style lang="scss" scoped>
.field-hint {
  width: 100%;
  font-size: 12px;
  line-height: 18px;
  color: var(--el-text-color-secondary);
}
</style>
