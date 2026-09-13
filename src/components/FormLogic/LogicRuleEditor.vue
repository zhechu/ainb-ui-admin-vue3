<template>
  <div class="logic-rule-editor">
    <div class="editor-header">
      <div>
        <span class="editor-title">联动规则</span>
        <span class="editor-tip">
          条件满足时执行动作。不满足时执行「否则」——不配「否则」的话，条件变回不满足时字段不会恢复
        </span>
      </div>
      <el-button type="primary" plain size="small" :disabled="fieldOptions.length === 0" @click="addRule">
        <Icon icon="ep:plus" class="mr-3px" />
        新增规则
      </el-button>
    </div>

    <el-alert
      v-if="fieldOptions.length === 0"
      title="表单里还没有字段，请先在「表单设计」步骤拖入控件"
      type="info"
      :closable="false"
      class="mb-10px"
    />

    <el-alert
      v-if="cycleWarning"
      :title="cycleWarning"
      type="error"
      :closable="false"
      class="mb-10px"
    />

    <el-empty v-if="rules.length === 0 && fieldOptions.length > 0" description="还没有联动规则" :image-size="60" />

    <el-collapse v-else v-model="expandedRules">
      <el-collapse-item v-for="(rule, ruleIdx) in rules" :key="rule.id" :name="rule.id">
        <template #title>
          <div class="rule-title">
            <el-switch
              v-model="rule.enabled"
              size="small"
              @click.stop
              @change="emitChange"
            />
            <span class="rule-name" :class="{ 'is-disabled': rule.enabled === false }">
              {{ rule.name || `规则 ${ruleIdx + 1}` }}
            </span>
            <el-tag size="small" type="info">{{ triggerLabel(rule.trigger) }}</el-tag>
            <el-button link type="danger" size="small" @click.stop="removeRule(ruleIdx)">
              <Icon icon="ep:delete" />
            </el-button>
          </div>
        </template>

        <div class="rule-body">
          <el-form label-width="80px" size="small">
            <el-form-item label="规则名称">
              <el-input
                v-model="rule.name"
                placeholder="给规则起个名字，便于日后维护"
                @change="emitChange"
              />
            </el-form-item>
            <el-form-item label="触发时机">
              <el-radio-group v-model="rule.trigger" @change="emitChange">
                <el-radio-button value="LOAD">表单加载</el-radio-button>
                <el-radio-button value="CHANGE">字段变化</el-radio-button>
                <el-radio-button value="SUBMIT">提交前</el-radio-button>
              </el-radio-group>
              <div class="form-tip">
                只有「提交前」的规则会在服务端复算。需要服务端兜住的必填与只读约束，请配成「提交前」
              </div>
            </el-form-item>
          </el-form>

          <el-divider content-position="left">当满足以下条件</el-divider>
          <ConditionGroupEditor
            :model-value="rule.when"
            :field-options="fieldOptions"
            @update:model-value="(v) => patchRule(ruleIdx, { when: v })"
          />

          <el-divider content-position="left">执行动作</el-divider>
          <ActionListEditor
            :model-value="rule.then"
            :field-options="fieldOptions"
            @update:model-value="(v) => patchRule(ruleIdx, { then: v })"
          />

          <el-divider content-position="left">
            否则
            <el-tooltip
              content="条件从满足变回不满足时执行。不配的话字段会停留在上一次被设置的状态"
              placement="top"
            >
              <Icon icon="ep:question-filled" class="ml-4px text-14px" />
            </el-tooltip>
          </el-divider>
          <ActionListEditor
            :model-value="rule.otherwise"
            :field-options="fieldOptions"
            @update:model-value="(v) => patchRule(ruleIdx, { otherwise: v })"
          />
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script lang="ts" setup>
import ConditionGroupEditor from './ConditionGroupEditor.vue'
import ActionListEditor from './ActionListEditor.vue'
import type { LogicRule } from './types'
import { detectCycles } from './cycleDetect'
import { findInvalidFieldRefs } from './invalidFieldRefs'

defineOptions({ name: 'LogicRuleEditor' })

/**
 * 联动规则编辑器
 *
 * 用可视化条件构造器而不是让用户写表达式：规则要能被静态检查、被服务端复算，
 * 表达式字符串两样都做不到。
 */
const props = defineProps<{
  /** 可选字段：{ label, value } */
  fieldOptions: Array<{ label: string; value: string }>
}>()

const model = defineModel<LogicRule[]>({ default: () => [] })

const rules = ref<LogicRule[]>([])

/**
 * 本地副本
 *
 * 与 CrossFieldRuleEditor 一致：本地改 + emit，不直接改 props 里的数组。
 *
 * ⚠️ 这不只是风格问题。上游 StepLogic 把 logicRules 做成了
 * 「get 时 JSON.parse、set 时 JSON.stringify」的 computed，
 * 就地改元素属性（v-model="rule.name"）**不会触发 setter**，
 * 改动就写不回 modelData.logicRules —— 界面上看着改了，保存后全丢。
 * 所以每一处改动都必须经过 emitChange() 做整体赋值。
 */
/**
 * 自身 emit 引发的回灌要跳过
 *
 * 条件值那类输入框是「每按一个键就 emit」的。emit 后 model 变化会触发下面的 watch
 * 重建整个 rules 数组，正在输入的那个框被连带重建、值被打回 —— 表现为「字打不进去」。
 * 只有外部真的换了一份规则（切表单、回显）才需要回灌。
 */
let suppressWatch = false

watch(
  model,
  (value) => {
    if (suppressWatch) return
    rules.value = (value ?? []).map((rule) => ({
      ...rule,
      // 缺省视为启用。与 CrossFieldRuleEditor 的处理一致
      enabled: rule.enabled !== false
    }))
  },
  { immediate: true, deep: true }
)

const emitChange = () => {
  suppressWatch = true
  model.value = rules.value.map((rule) => ({ ...rule }))
  // watch 的 pre flush 先于此执行；这里兜底复位，避免 model 未变化时标志残留
  nextTick(() => {
    suppressWatch = false
  })
}

const patchRule = (index: number, patch: Partial<LogicRule>) => {
  rules.value[index] = { ...rules.value[index], ...patch }
  emitChange()
}

const expandedRules = ref<string[]>([])

const triggerLabel = (trigger?: string) =>
  ({ LOAD: '表单加载', CHANGE: '字段变化', SUBMIT: '提交前' })[trigger ?? 'CHANGE'] ?? '字段变化'

/**
 * 环形赋值提示
 *
 * 前端先报一次，不必等到发布才知道。发布校验那边还会再拦一次 ——
 * 前端这份是即时反馈，后端那份是不可绕过的关口
 */
const cycleWarning = computed(() => {
  const cycles = detectCycles(rules.value)
  if (cycles.length === 0) return ''
  return `联动规则存在环形赋值：${cycles.join('；')}。这会让规则反复互相触发而算不出稳定结果，发布时会被拒绝`
})

let seq = 0
const nextRuleId = () => `rule_${Date.now()}_${seq++}`

const addRule = () => {
  const rule: LogicRule = {
    id: nextRuleId(),
    name: '',
    enabled: true,
    trigger: 'CHANGE',
    when: { logic: 'AND', items: [] },
    then: [],
    otherwise: []
  }
  rules.value = [...rules.value, rule]
  emitChange()
  // 新增后自动展开，否则用户点了「新增规则」看不到任何变化
  expandedRules.value = [...expandedRules.value, rule.id]
}

const removeRule = async (index: number) => {
  await ElMessageBox.confirm('确定删除这条规则吗？', '提示', { type: 'warning' })
  const next = [...rules.value]
  next.splice(index, 1)
  rules.value = next
  emitChange()
}

/**
 * 规则里引用了、但表单上已不存在的字段
 *
 * 判断逻辑抽在 invalidFieldRefs.ts 里（纯函数 + 单测），这里只做展示。
 * 抽出去的原因是保存/发布前也要拦同一件事，而那时本编辑器可能根本没被打开过 ——
 * 依赖组件 ref 的写法会让校验静默通过。
 *
 * 这里只报告、不自动改规则：自动改可能删掉用户还想留的配置。
 */
const invalidFieldRefs = computed(() =>
  findInvalidFieldRefs(rules.value, props.fieldOptions.map((o) => o.value))
)

/**
 * 暴露给上层保存流程
 *
 * flush：规则名用 @change 写回（避免边打字边重建数组），
 * 但用户可能在焦点还在输入框时就触发保存 —— 保存前主动收一次才不会丢最后一次输入
 */
defineExpose({ invalidFieldRefs, flush: emitChange })
</script>

<style lang="scss" scoped>
.editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.editor-title {
  font-size: 15px;
  font-weight: 600;
}

.editor-tip {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.rule-title {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.rule-name {
  font-weight: 500;

  &.is-disabled {
    color: var(--el-text-color-disabled);
    text-decoration: line-through;
  }
}

.rule-body {
  padding: 0 8px;
}

.form-tip {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
</style>
