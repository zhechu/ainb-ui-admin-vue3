<!--
  模板参数双模式编辑器（容器）。

  唯一真相是 modelValue（params JSON 字符串）：
    - 向导模式：按模板分发子编辑器，子编辑器变更 → serializeParams → emit；
    - JSON 模式：textarea 直接双向绑 modelValue（保留开发人员的快速手填路径）。

  同步协议：
    - 进入向导前先 parseParams(modelValue)，失败则【留在 JSON 模式并告警，绝不销毁文本】；
    - 模板切换由父组件（RuleForm）负责确认后重置 params，本组件 watch(template) 重建向导态；
    - meta 未加载/加载失败（templates 为空）或模板是自定义 code → 降级为「仅 JSON 模式」。

  expose validate()：供 RuleForm 提交前校验，返回错误文案或 null。
-->
<template>
  <div class="rule-params-editor">
    <!-- 只读模式（内置规则查看）：不渲染任何可编辑控件，只给白话说明 + 原始 JSON -->
    <el-alert
      v-if="disabled"
      type="info"
      :closable="false"
      class="text-12px"
      :title="readonlyPreview"
    >
      <template #default>
        <div class="mt-4px break-all text-gray-500">原始参数：{{ modelValue || '（空）' }}</div>
      </template>
    </el-alert>

    <template v-else>
      <!-- 模式切换 -->
      <div class="mode-bar">
        <el-radio-group v-model="mode" size="small" @change="onModeChange">
          <el-radio-button value="wizard" :disabled="!wizardAvailable">向导模式</el-radio-button>
          <el-radio-button value="json">JSON 模式</el-radio-button>
        </el-radio-group>
        <span v-if="!wizardAvailable" class="mode-hint">
          {{ wizardUnavailableReason }}
        </span>
      </div>

      <!-- 向导模式 -->
      <div v-if="mode === 'wizard'" class="mode-body">
      <!-- 无参数模板：只展示业务说明 -->
      <el-alert
        v-if="!isParam"
        type="info"
        :closable="false"
        class="text-12px"
        :title="tplMeta?.businessDescription || '该模板无需参数'"
      >
        <template v-if="requiredSlots.length" #default>
          <div class="mt-4px">
            <span class="text-gray-400">需要资源已配置槽位：</span>
            <el-tag v-for="s in requiredSlots" :key="s" size="small" class="ml-4px">{{ s }}</el-tag>
          </div>
        </template>
      </el-alert>

      <!-- 有参数模板：按模板分发子编辑器 -->
      <template v-else>
        <StatusListParam
          v-if="template === TPL.STATUS_IN"
          :model-value="allowedStatuses"
          @update:model-value="(v) => onWizardPatch({ allowedStatuses: v })"
        />
        <DeptIdsParam
          v-else-if="template === TPL.DEPT_IN"
          :model-value="deptIds"
          @update:model-value="(v) => onWizardPatch({ deptIds: v })"
        />
        <FieldEqualsParam
          v-else-if="template === TPL.FIELD_EQUALS"
          :model-value="fieldModel"
          :slots="meta.slots"
          @update:model-value="(v) => onWizardPatch(v)"
        />
        <ConditionTreeBuilder
          v-else-if="template === TPL.CUSTOM_TREE"
          :model-value="conditionTree"
          :meta="meta"
          @update:model-value="(v) => onWizardPatch({ conditionTree: v })"
        />
      </template>
    </div>

    <!-- JSON 模式 -->
      <div v-else class="mode-body">
        <el-input
          :model-value="modelValue"
          type="textarea"
          :rows="6"
          placeholder='JSON 格式，如 {"allowedStatuses":[1,2,3]}；无参数模板留空即可'
          @update:model-value="(v: string) => emit('update:modelValue', v)"
        />
      </div>
    </template>

    <!-- 底部：白话预览 + 校验红字（只读模式已在上方展示，不重复） -->
    <el-alert
      v-if="!disabled && validationError"
      type="error"
      :closable="false"
      class="mt-8px text-12px"
      :title="validationError"
    />
    <el-alert
      v-else-if="!disabled && previewText"
      type="success"
      :closable="false"
      class="mt-8px text-12px"
      :title="previewText"
    />
  </div>
</template>

<script lang="ts" setup>
import type { RuleTemplateMetaVO } from '@/api/system/grant'
import StatusListParam from './StatusListParam.vue'
import DeptIdsParam from './DeptIdsParam.vue'
import FieldEqualsParam from './FieldEqualsParam.vue'
import ConditionTreeBuilder from './ConditionTreeBuilder.vue'
import {
  TPL,
  emptyState,
  serializeParams,
  parseParams,
  validateState,
  describeState,
  isKnownTemplate,
  isParamTemplate,
  type WizardState,
  type ConditionNodeModel
} from './ruleParams'

defineOptions({ name: 'RuleParamsEditor' })

const props = defineProps<{
  /** params JSON 字符串（唯一真相） */
  modelValue: string
  /** 当前模板 code */
  template: string
  meta: RuleTemplateMetaVO
  /** 只读（内置规则查看）：不渲染可编辑控件 */
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const message = useMessage()

const mode = ref<'wizard' | 'json'>('wizard')
const state = ref<WizardState>(emptyState(props.template))

// 便于模板里安全访问（WizardState 各字段可选，这里给默认值）
const allowedStatuses = computed(() => state.value.allowedStatuses ?? [])
const deptIds = computed(() => state.value.deptIds ?? [])
const fieldModel = computed(() => ({
  field: state.value.field ?? '',
  value: state.value.value ?? ''
}))
const conditionTree = computed<ConditionNodeModel>(
  () => state.value.conditionTree ?? { type: 'GROUP', logic: 'AND', children: [] }
)

const tplMeta = computed(() => props.meta.templates.find((t) => t.code === props.template))
const requiredSlots = computed(() => tplMeta.value?.requiredSlots ?? [])
const isParam = computed(() => isParamTemplate(props.template))

const metaReady = computed(() => props.meta.templates.length > 0)
const wizardAvailable = computed(() => metaReady.value && isKnownTemplate(props.template))
const wizardUnavailableReason = computed(() => {
  if (!metaReady.value) return '元数据未就绪，暂只能用 JSON 模式'
  return '自定义模板代码不支持向导，请用 JSON 模式'
})

/** 用当前 modelValue 重建向导态；解析失败则退回 JSON 模式并告警（不销毁文本） */
function syncFromModel() {
  if (!wizardAvailable.value) {
    mode.value = 'json'
    return
  }
  const parsed = parseParams(props.template, props.modelValue)
  if (!parsed.ok) {
    mode.value = 'json'
    message.warning(`无法进入向导模式：${parsed.error}（已保留 JSON 原文，可手动修正）`)
    return
  }
  state.value = parsed.state
  mode.value = 'wizard'
}

/** 子编辑器变更：合并进 state 并序列化上抛 */
function onWizardPatch(patch: Record<string, any>) {
  state.value = { ...state.value, ...patch } as WizardState
  emit('update:modelValue', serializeParams(state.value))
}

/**
 * 用户手动切模式：切到向导前必须以 modelValue 为真相重新解析。
 * 这样既保证「JSON 模式手改后切回向导能反映改动」，也保证「坏 JSON 切向导时告警并退回 JSON」。
 */
function onModeChange(val: string | number | boolean | undefined) {
  if (val === 'wizard') syncFromModel()
}

// 模板切换：重建向导态（父组件已在切换前确认/重置 params）
watch(
  () => props.template,
  () => {
    state.value = emptyState(props.template)
    syncFromModel()
  },
  { immediate: true }
)

// ===== 预览 & 校验（两种模式都基于「当前真相」计算）=====
/** 取当前应校验的向导态：向导模式用 state，JSON 模式实时解析 modelValue */
function currentStateForCheck(): { state: WizardState | null; parseError: string | null } {
  if (mode.value === 'wizard') return { state: state.value, parseError: null }
  // JSON 模式：无参数/自定义模板不解析
  if (!isParamTemplate(props.template)) {
    // 自定义 code 也可能带参数，但无法向导校验，交给后端；这里只校 JSON 合法性
    if (!props.modelValue || !props.modelValue.trim()) return { state: null, parseError: null }
    try {
      JSON.parse(props.modelValue)
      return { state: null, parseError: null }
    } catch {
      return { state: null, parseError: 'JSON 格式不正确' }
    }
  }
  const parsed = parseParams(props.template, props.modelValue)
  if (!parsed.ok) return { state: null, parseError: parsed.error }
  return { state: parsed.state, parseError: null }
}

const validationError = computed(() => {
  const { state: s, parseError } = currentStateForCheck()
  if (parseError) return parseError
  if (!s) return null
  return validateState(s, props.meta)
})

const previewText = computed(() => {
  const { state: s } = currentStateForCheck()
  if (!s) return ''
  return describeState(s, props.meta)
})

/** 只读模式的白话说明：不依赖当前 mode，直接按 modelValue 解析 */
const readonlyPreview = computed(() => {
  if (!isParamTemplate(props.template)) {
    return tplMeta.value?.businessDescription || '该模板无需参数'
  }
  const parsed = parseParams(props.template, props.modelValue)
  return parsed.ok ? describeState(parsed.state, props.meta) : props.modelValue || '（无参数）'
})

/** 供 RuleForm 提交前调用 */
function validate(): string | null {
  return validationError.value
}

defineExpose({ validate, syncFromModel })
</script>

<style scoped>
.rule-params-editor {
  width: 100%;
}
.mode-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.mode-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.mode-body {
  width: 100%;
}
</style>
