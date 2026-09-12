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
            <el-switch v-model="rule.enabled" size="small" @click.stop />
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
              <el-input v-model="rule.name" placeholder="给规则起个名字，便于日后维护" />
            </el-form-item>
            <el-form-item label="触发时机">
              <el-radio-group v-model="rule.trigger">
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
          <ConditionGroupEditor v-model="rule.when" :field-options="fieldOptions" />

          <el-divider content-position="left">执行动作</el-divider>
          <ActionListEditor v-model="rule.then" :field-options="fieldOptions" />

          <el-divider content-position="left">
            否则
            <el-tooltip
              content="条件从满足变回不满足时执行。不配的话字段会停留在上一次被设置的状态"
              placement="top"
            >
              <Icon icon="ep:question-filled" class="ml-4px text-14px" />
            </el-tooltip>
          </el-divider>
          <ActionListEditor v-model="rule.otherwise" :field-options="fieldOptions" />
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

const rules = defineModel<LogicRule[]>({ default: () => [] })

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
  // 新增后自动展开，否则用户点了「新增规则」看不到任何变化
  expandedRules.value = [...expandedRules.value, rule.id]
}

const removeRule = async (index: number) => {
  await ElMessageBox.confirm('确定删除这条规则吗？', '提示', { type: 'warning' })
  const next = [...rules.value]
  next.splice(index, 1)
  rules.value = next
}

/** 字段被删除后，引用它的规则会失效。这里只提示，不自动改规则 —— 自动改可能删掉用户还想留的配置 */
const invalidFieldRefs = computed(() => {
  const valid = new Set(props.fieldOptions.map((o) => o.value))
  const missing = new Set<string>()
  const walkGroup = (group: any) => {
    for (const item of group?.items ?? []) {
      if (item.logic !== undefined || item.items !== undefined) {
        walkGroup(item)
      } else if (item.field && !valid.has(item.field)) {
        missing.add(item.field)
      }
    }
  }
  for (const rule of rules.value) {
    walkGroup(rule.when)
    for (const action of [...(rule.then ?? []), ...(rule.otherwise ?? [])]) {
      if (action.target && !valid.has(action.target)) missing.add(action.target)
    }
  }
  return [...missing]
})

defineExpose({ invalidFieldRefs })
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
