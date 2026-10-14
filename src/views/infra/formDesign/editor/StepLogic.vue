<template>
  <div class="step-logic">
    <el-alert
      title="配置字段之间的联动，以及表单的业务逻辑扩展方式。联动规则会在提交时由服务端复算，前端绕不过去。"
      type="info"
      :closable="false"
      class="mb-12px"
    />

    <el-alert
      v-if="invalidRefs.length > 0"
      type="warning"
      :closable="false"
      class="mb-12px"
      :title="`联动规则引用了已不存在的字段：${invalidRefs.join('、')}。这些规则不会生效，请修改或删除`"
    />

    <el-tabs v-model="activeTab">
      <el-tab-pane label="联动规则" name="logic">
        <LogicRuleEditor ref="logicEditorRef" v-model="logicRules" :field-options="fieldOptions" />
      </el-tab-pane>
      <el-tab-pane label="跨字段校验" name="validate">
        <CrossFieldRuleEditor
          ref="crossFieldEditorRef"
          v-model="crossFieldRules"
          :field-options="fieldOptions"
        />
      </el-tab-pane>
      <el-tab-pane label="扩展方式" name="extension">
        <FormScriptEditor
          ref="scriptEditorRef"
          v-model:extension-mode="extensionMode"
          v-model:timeout-action="timeoutAction"
          v-model:scripts="scripts"
          :form-code="modelData.code"
          :has-server-extension="modelData.hasServerExtension"
          :server-extension-names="modelData.serverExtensionNames"
          :field-options="fieldOptions"
        />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script lang="ts" setup>
import LogicRuleEditor from '@/components/FormLogic/LogicRuleEditor.vue'
import CrossFieldRuleEditor from '@/components/FormValidation/CrossFieldRuleEditor.vue'
import type { CrossFieldRule } from '@/components/FormValidation/types'
import FormScriptEditor from '@/components/FormScript/FormScriptEditor.vue'
import type { LogicRule } from '@/components/FormLogic/types'
import { detectCycles } from '@/components/FormLogic/cycleDetect'
import { parseFormFields } from '@/components/FormCreate/src/utils'
import { checkFormulaFieldAssignment } from '@/components/FormScript/staticCheck'

defineOptions({ name: 'FormDesignStepLogic' })

/**
 * 「逻辑与扩展」步骤
 *
 * 联动规则与扩展方式放在同一步：两者都是「表单的行为」，
 * 而且用户在配联动时经常会发现「这条声明式表达不了」，此时切一个页签就能改用脚本。
 */
const props = defineProps<{
  /** 表单字段规则，用于给规则编辑器提供字段下拉 */
  formFields: Record<string, any>[]
}>()

const modelData = defineModel<any>({ required: true })

const message = useMessage()
const activeTab = ref('logic')
const logicEditorRef = ref()
const scriptEditorRef = ref()
const crossFieldEditorRef = ref()

/**
 * 可选字段
 *
 * 复用 parseFormFields —— 它已经处理了布局容器递归与子表层级 key，
 * 这里再写一遍解析必然会漂移
 */
const fieldOptions = computed(() => {
  const collected: Array<Record<string, any>> = []
  for (const rule of props.formFields ?? []) {
    parseFormFields(rule, collected)
  }
  return collected
    .filter((f) => f.field)
    .map((f) => ({ label: `${f.title || f.field}（${f.field}）`, value: f.field }))
})

// ==================== 与 modelData 的双向绑定 ====================
//
// 用 computed 而不是在 onMounted 里拷一份到本地 ref：
// 步骤组件是 v-show 常驻的，拷贝会在用户来回切步骤时与外层状态脱节

const logicRules = computed<LogicRule[]>({
  get: () => parseJson(modelData.value.logicRules, []),
  set: (v) => {
    modelData.value.logicRules = v.length > 0 ? JSON.stringify(v) : null
  }
})

const crossFieldRules = computed<CrossFieldRule[]>({
  get: () => parseJson(modelData.value.validateRules, []),
  set: (v) => {
    modelData.value.validateRules = v.length > 0 ? JSON.stringify(v) : null
  }
})

const scripts = computed<Record<string, string>>({
  get: () => parseJson(modelData.value.formScript, {}),
  set: (v) => {
    const hasContent = Object.values(v).some((s) => s && s.trim())
    modelData.value.formScript = hasContent ? JSON.stringify(v) : null
  }
})

const extensionMode = computed<number>({
  get: () => modelData.value.extensionMode ?? 1,
  set: (v) => (modelData.value.extensionMode = v)
})

const timeoutAction = computed<number>({
  get: () => modelData.value.submitHookTimeoutAction ?? 1,
  set: (v) => (modelData.value.submitHookTimeoutAction = v)
})

/** 解析失败返回兜底值，不让一段坏 JSON 把整个步骤打不开 */
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const invalidRefs = computed(() => logicEditorRef.value?.invalidFieldRefs ?? [])

/**
 * 表单里的公式字段
 *
 * 公式字段的值由服务端权威重算，脚本对它们的赋值会被无声覆盖 ——
 * 不在保存时拦住，实施期必然出现「脚本里改了值，保存后又变回去」这类查不明白的问题
 */
const formulaFields = computed(() => {
  const collected: Array<Record<string, any>> = []
  for (const rule of props.formFields ?? []) {
    parseFormFields(rule, collected)
  }
  return collected.filter((f) => f.type === 'Formula' && f.field).map((f) => f.field as string)
})

/**
 * 收集产物
 *
 * 条件组、动作列表这些改一下就即时写回了；但规则名与脚本正文是
 * 失焦（@change）才写回的 —— 用户在输入框里打完字直接点保存时，
 * 这里必须主动 flush 一次，否则最后一次输入会丢
 */
const collect = () => {
  logicEditorRef.value?.flush?.()
  crossFieldEditorRef.value?.flush?.()
  scriptEditorRef.value?.flush?.()
}

/**
 * 校验
 *
 * 两件事在保存前必须拦住：环形赋值、脚本静态检查未通过。
 * 后端发布校验还会各拦一次 —— 这里是即时反馈，那里是不可绕过的关口
 */
const validate = async () => {
  // 与 StepFormDesign.validate 一致：先收一次，保证校验与写回看到的是同一份内容
  collect()
  // 引用了已删字段的联动规则：运行时被静默跳过，界面上看不出任何异常。
  // 这条原先只有一个内联告警、不参与 validate()，而后端发布校验也不查联动的
  // 字段存在性（只查环形赋值）—— 也就是说从保存到发布全程没有一道关卡拦得住。
  // 跨字段校验那边后端是查的（FORM_DESIGN_VALIDATE_RULE_FIELD_NOT_EXISTS），
  // 两者不对称，这里连同后端一起补齐
  if (invalidRefs.value.length > 0) {
    activeTab.value = 'logic'
    message.error(`联动规则引用了已不存在的字段：${invalidRefs.value.join('、')}，请修改或删除`)
    throw new Error('logic invalid field ref')
  }
  const cycles = detectCycles(logicRules.value)
  if (cycles.length > 0) {
    activeTab.value = 'logic'
    message.error(`联动规则存在环形赋值：${cycles.join('；')}`)
    throw new Error('logic cycle')
  }
  // 配置不完整的跨字段规则在运行时是「跳过」，不在保存前提示，
  // 用户会以为它在生效。后端发布校验也会拦一次，这里是即时反馈
  const incomplete = crossFieldEditorRef.value?.incompleteRules ?? []
  if (incomplete.length > 0) {
    activeTab.value = 'validate'
    message.error(`跨字段校验规则缺少校验条件或错误提示：${incomplete.join('、')}`)
    throw new Error('cross field rule incomplete')
  }
  if (extensionMode.value === 1 && scriptEditorRef.value?.hasIssues?.()) {
    activeTab.value = 'extension'
    message.error(`脚本静态检查未通过：${scriptEditorRef.value.allIssues().join('；')}`)
    throw new Error('script check failed')
  }
  // 脚本给公式字段赋值：保存阶段就拦住，而不是等运行时被服务端无声覆盖
  if (extensionMode.value === 1 && formulaFields.value.length > 0) {
    const conflicts = Object.entries(scripts.value).flatMap(([hook, source]) =>
      checkFormulaFieldAssignment(source, formulaFields.value).map(
        (i) => `${hook} 第 ${i.line} 行：${i.reason}`
      )
    )
    if (conflicts.length > 0) {
      activeTab.value = 'extension'
      message.error(conflicts.join('；'))
      throw new Error('script assigns formula field')
    }
  }
}

defineExpose({ collect, validate })
</script>

<style lang="scss" scoped>
.step-logic {
  max-width: 1000px;
  margin: 0 auto;
}
</style>
