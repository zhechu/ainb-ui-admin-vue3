<template>
  <div class="cross-field-editor">
    <el-alert type="info" :closable="false" class="mb-12px">
      <template #title>
        跨字段校验用来表达「几个字段之间的关系」：结束日期不能早于开始日期、
        填了发票号就必须填税号、手机号与邮箱至少填一个。
        <br />
        语义是「<b>当</b>前置条件满足时，<b>必须</b>满足校验条件」。
        提交时服务端会用同一份规则再校验一遍。
      </template>
    </el-alert>

    <div v-if="rules.length === 0" class="empty">
      还没有跨字段校验规则。单个字段自己的格式（手机号、金额）不在这里配 ——
      那是控件属性面板上的「格式校验」。
    </div>

    <el-card v-for="(rule, index) in rules" :key="rule.id" shadow="never" class="rule-card">
      <template #header>
        <div class="rule-header">
          <el-input
            v-model="rule.name"
            placeholder="规则名称，如「日期区间」"
            size="small"
            class="w-240px"
            @change="emitChange"
          />
          <div class="rule-header-right">
            <el-switch
              v-model="rule.enabled"
              size="small"
              active-text="启用"
              inline-prompt
              @change="emitChange"
            />
            <el-button link type="danger" size="small" @click="removeRule(index)">
              <Icon icon="ep:delete" class="mr-3px" />
              删除
            </el-button>
          </div>
        </div>
      </template>

      <div class="rule-section">
        <div class="section-title">
          当（前置条件）
          <span class="section-hint">留空表示这条约束永远检查</span>
        </div>
        <ConditionGroupEditor
          :model-value="rule.when"
          :field-options="fieldOptions"
          @update:model-value="(v) => patchRule(index, { when: v })"
        />
      </div>

      <div class="rule-section">
        <div class="section-title">
          必须满足
          <span class="section-hint">
            不满足就拒绝提交。用「大于等于 + 右值取字段」表达「结束日期 ≥ 开始日期」
          </span>
        </div>
        <ConditionGroupEditor
          :model-value="rule.must"
          :field-options="fieldOptions"
          @update:model-value="(v) => patchRule(index, { must: v })"
        />
        <div v-if="!rule.must?.items?.length" class="section-error">
          没有校验条件，这条规则恒定通过。发布时会被拦下
        </div>
      </div>

      <div class="rule-section">
        <div class="section-title">错误提示</div>
        <el-input
          v-model="rule.message"
          placeholder="校验不通过时给用户看的话，如「结束日期不能早于开始日期」"
          size="small"
          @change="emitChange"
        />
        <div v-if="!rule.message" class="section-error">
          必须填。系统自动生成的提示（「字段 A 与字段 B 的关系不满足」）用户看不懂 ——
          只有配规则的人知道这条约束想表达什么
        </div>
      </div>
    </el-card>

    <el-button type="primary" plain size="small" @click="addRule">
      <Icon icon="ep:plus" class="mr-3px" />
      添加跨字段规则
    </el-button>
  </div>
</template>

<script lang="ts" setup>
/**
 * 跨字段校验规则的编辑器
 *
 * 两个条件组直接复用联动规则的 ConditionGroupEditor —— 条件模型完全一样
 * （嵌套组、AND/OR、右值可取另一个字段）。为校验再做一套条件编辑器，
 * 用户就要学两种界面，而它们表达的是同一件事。
 */
import ConditionGroupEditor from '@/components/FormLogic/ConditionGroupEditor.vue'
import type { CrossFieldRule } from '@/components/FormValidation/types'
import type { ConditionGroup } from '@/components/FormLogic/types'
import { generateUUID } from '@/utils'

defineOptions({ name: 'CrossFieldRuleEditor' })

defineProps<{
  fieldOptions: Array<{ label: string; value: string }>
}>()

const model = defineModel<CrossFieldRule[]>({ default: () => [] })

/**
 * 本地副本
 *
 * 与 LogicRuleEditor 一致：本地改 + emit，不直接改 props 里的数组。
 * 直接改虽然能工作（引用相同），但行为就依赖上游怎么传值了。
 */
const rules = ref<CrossFieldRule[]>([])

/**
 * 自身 emit 引发的回灌要跳过
 *
 * 「必须满足」里的条件值输入框每按一个键就 emit 一次，emit 后 model 变化会触发
 * 下面的 watch 重建整个 rules 数组，正在输入的那个框被连带重建、值被打回 ——
 * 表现为条件值那一格怎么都填不进去。只有外部真的换了一份规则时才需要回灌。
 */
let suppressWatch = false

watch(
  model,
  (value) => {
    if (suppressWatch) return
    rules.value = (value ?? []).map((rule) => ({
      ...rule,
      // 缺省视为启用。不补上的话开关会显示为「关」，而它实际是生效的
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

const patchRule = (index: number, patch: Partial<CrossFieldRule>) => {
  rules.value[index] = { ...rules.value[index], ...patch }
  emitChange()
}

const addRule = () => {
  rules.value.push({
    id: generateUUID(),
    name: '',
    enabled: true,
    // when 留空 = 恒真，这是最常用的形态（日期区间不需要前置条件）
    when: null,
    must: { logic: 'AND', items: [] } as ConditionGroup,
    message: ''
  })
  emitChange()
}

const removeRule = (index: number) => {
  rules.value.splice(index, 1)
  emitChange()
}

/**
 * 配置不完整的规则
 *
 * 运行时对它们是「跳过」（一条没配完的校验恒定拦住提交，用户不知道该改什么），
 * 所以必须在保存前提示 —— 否则用户以为配好了。
 */
const incompleteRules = computed(() =>
  rules.value
    .filter((rule) => rule.enabled !== false)
    .filter((rule) => !rule.must?.items?.length || !rule.message)
    .map((rule) => rule.name || rule.id)
)

defineExpose({ incompleteRules, flush: emitChange })
</script>

<style lang="scss" scoped>
.cross-field-editor {
  .empty {
    padding: 16px 0;
    font-size: 13px;
    line-height: 1.7;
    color: var(--el-text-color-secondary);
  }

  .rule-card {
    margin-bottom: 12px;
  }

  .rule-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .rule-header-right {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .rule-section {
    margin-bottom: 16px;
  }

  .section-title {
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 500;
  }

  .section-hint {
    margin-left: 8px;
    font-size: 12px;
    font-weight: normal;
    color: var(--el-text-color-secondary);
  }

  .section-error {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-color-danger);
  }
}
</style>
