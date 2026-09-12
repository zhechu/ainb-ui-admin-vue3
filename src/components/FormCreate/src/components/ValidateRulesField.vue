<template>
  <div>
    <el-form-item label="内容不能重复" class="unique-item">
      <el-switch v-model="uniqueCheck" />
      <div class="unique-hint">
        开启后，填写时会即时检查该内容在系统里是否已存在，提交时服务端再查一次。
        <br />
        <b>它不能替代数据库唯一索引</b>：两个人同时提交同一个值，两次检查都会通过。
        真正需要唯一的列请同时建唯一索引。
      </div>
    </el-form-item>
    <ValidateRulesEditor v-model="validateRules" />
  </div>
</template>

<script lang="ts" setup>
import ValidateRulesEditor from '@/components/FormValidation/ValidateRulesEditor.vue'
import type { FieldValidationRule } from '@/components/FormValidation/types'

defineOptions({ name: 'ValidateRulesField' })

/**
 * 属性面板里的校验配置桥接组件
 *
 * 与 FormulaEditorField 同一套做法：设计器的属性表单项是「一个字段 ↔ 一个值」的模型，
 * 这里对设计器表现为一个表单项，内部直接读写 activeRule.props 上的
 * validateRules 与 uniqueCheck。
 *
 * 为什么不做成普通的 `{ field: 'validateRules' }` 属性项：那需要一个能编辑
 * 「对象数组」的内置控件，设计器没有；而 validateRules 的每一项有四个键、
 * 还要按类型切换可填项，用通用的 JSON 文本框编辑等于让用户手写 JSON。
 *
 * 唯一性开关与格式校验放在同一项里：两者都是「这个字段的内容合不合法」，
 * 用户配的时候会一起考虑。
 */
const props = defineProps<{
  /** 设计器注入：当前正在配置的规则 */
  formCreateInject?: any
}>()

const rule = computed(() => props.formCreateInject?.rule ?? {})

const ensureProps = () => {
  if (!rule.value.props) rule.value.props = {}
  return rule.value.props
}

const validateRules = computed<FieldValidationRule[]>({
  get: () => rule.value.props?.validateRules ?? [],
  set: (value) => {
    // 空数组写成 undefined，避免每个控件的产物里都多一个空 validateRules 键 ——
    // formFields 是逐条序列化后存库的，空键会让每张表单的 JSON 都胖一圈
    ensureProps().validateRules = value.length ? value : undefined
  }
})

const uniqueCheck = computed<boolean>({
  get: () => rule.value.props?.uniqueCheck === true,
  set: (value) => {
    ensureProps().uniqueCheck = value ? true : undefined
  }
})
</script>

<style lang="scss" scoped>
.unique-item {
  margin-bottom: 12px;
}

.unique-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
