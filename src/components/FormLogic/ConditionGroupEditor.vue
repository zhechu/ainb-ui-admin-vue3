<template>
  <div class="condition-group">
    <div class="group-head">
      <el-radio-group v-model="logic" size="small">
        <el-radio-button value="AND">同时满足</el-radio-button>
        <el-radio-button value="OR">满足任一</el-radio-button>
      </el-radio-group>
      <div>
        <el-button link type="primary" size="small" @click="addCondition">
          <Icon icon="ep:plus" class="mr-3px" />
          条件
        </el-button>
        <el-button link type="primary" size="small" @click="addGroup">
          <Icon icon="ep:plus" class="mr-3px" />
          条件组
        </el-button>
      </div>
    </div>

    <div v-if="items.length === 0" class="group-empty">
      没有条件时视为「恒满足」，动作会无条件执行
    </div>

    <div v-for="(item, idx) in items" :key="idx" class="condition-row">
      <!-- 嵌套组 -->
      <template v-if="isGroup(item)">
        <div class="nested-group">
          <ConditionGroupEditor
            :model-value="item"
            :field-options="fieldOptions"
            @update:model-value="(v) => replaceItem(idx, v)"
          />
        </div>
        <el-button link type="danger" size="small" @click="removeItem(idx)">
          <Icon icon="ep:delete" />
        </el-button>
      </template>

      <!-- 单个条件 -->
      <template v-else>
        <el-select
          :model-value="item.field"
          placeholder="选择字段"
          filterable
          size="small"
          class="cond-field"
          @update:model-value="(v) => patchItem(idx, { field: v })"
        >
          <el-option v-for="opt in fieldOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>

        <el-select
          :model-value="item.operator"
          placeholder="条件"
          size="small"
          class="cond-operator"
          @update:model-value="(v) => onOperatorChange(idx, v)"
        >
          <el-option v-for="op in OPERATORS" :key="op.value" :label="op.label" :value="op.value" />
        </el-select>

        <!-- 取值来源。EMPTY/NOT_EMPTY 不需要右值，整段隐藏 -->
        <template v-if="needsValue(item.operator)">
          <el-select
            :model-value="item.valueType || 'CONST'"
            size="small"
            class="cond-value-type"
            @update:model-value="(v) => patchItem(idx, { valueType: v, value: undefined })"
          >
            <el-option label="固定值" value="CONST" />
            <el-option label="取字段" value="FIELD" />
          </el-select>

          <!-- 取字段：右值是另一个字段名 -->
          <el-select
            v-if="item.valueType === 'FIELD'"
            :model-value="item.value"
            placeholder="选择字段"
            filterable
            size="small"
            class="cond-value"
            @update:model-value="(v) => patchItem(idx, { value: v })"
          >
            <el-option v-for="opt in fieldOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>

          <!-- 多值操作符：IN / NOT_IN / BETWEEN 用可输入多项的选择器 -->
          <el-select
            v-else-if="isMultiValue(item.operator)"
            :model-value="toArray(item.value)"
            multiple
            filterable
            allow-create
            default-first-option
            :placeholder="item.operator === 'BETWEEN' ? '依次填下限、上限' : '输入后回车，可多个'"
            size="small"
            class="cond-value"
            @update:model-value="(v) => patchItem(idx, { value: v })"
          />

          <!-- 单值 -->
          <el-input
            v-else
            :model-value="item.value"
            placeholder="输入比较值"
            size="small"
            class="cond-value"
            @update:model-value="(v) => patchItem(idx, { value: v })"
          />
        </template>
        <div v-else class="value-placeholder">无需填值</div>

        <el-button link type="danger" size="small" @click="removeItem(idx)">
          <Icon icon="ep:delete" />
        </el-button>
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { ConditionGroup, ConditionNode } from './types'

defineOptions({ name: 'ConditionGroupEditor' })

/**
 * 条件组编辑器（可递归嵌套）
 *
 * 操作符清单与语义必须与求值器一致 —— 这里能配出来的，求值器就得能算；
 * 反之算得出来但这里配不出来，那个操作符等于不存在。
 */
defineProps<{
  fieldOptions: Array<{ label: string; value: string }>
}>()

const model = defineModel<ConditionGroup | null | undefined>()

/** 操作符清单。与 evaluator.ts 的 KNOWN_OPERATORS 一一对应 */
const OPERATORS = [
  { value: 'EQ', label: '等于' },
  { value: 'NE', label: '不等于' },
  { value: 'GT', label: '大于' },
  { value: 'GE', label: '大于等于' },
  { value: 'LT', label: '小于' },
  { value: 'LE', label: '小于等于' },
  { value: 'IN', label: '属于' },
  { value: 'NOT_IN', label: '不属于' },
  { value: 'CONTAINS', label: '包含' },
  { value: 'NOT_CONTAINS', label: '不包含' },
  { value: 'STARTS_WITH', label: '开头是' },
  { value: 'ENDS_WITH', label: '结尾是' },
  { value: 'BETWEEN', label: '介于' },
  { value: 'EMPTY', label: '为空' },
  { value: 'NOT_EMPTY', label: '不为空' }
]

/** 这两个操作符只看左值，不需要右值 */
const needsValue = (operator?: string) => operator !== 'EMPTY' && operator !== 'NOT_EMPTY'

/** 这几个操作符的右值是数组 */
const isMultiValue = (operator?: string) =>
  operator === 'IN' || operator === 'NOT_IN' || operator === 'BETWEEN'

const toArray = (value: any): any[] => (Array.isArray(value) ? value : value == null ? [] : [value])

const isGroup = (node: ConditionNode) => node.logic !== undefined || node.items !== undefined

const items = computed<ConditionNode[]>(() => model.value?.items ?? [])

const logic = computed({
  get: () => model.value?.logic ?? 'AND',
  set: (v) => {
    model.value = { logic: v, items: items.value }
  }
})

const writeItems = (next: ConditionNode[]) => {
  model.value = { logic: logic.value, items: next }
}

const addCondition = () => {
  writeItems([...items.value, { field: '', operator: 'EQ', valueType: 'CONST', value: '' }])
}

const addGroup = () => {
  writeItems([...items.value, { logic: 'AND', items: [] }])
}

const removeItem = (index: number) => {
  const next = [...items.value]
  next.splice(index, 1)
  writeItems(next)
}

const patchItem = (index: number, patch: Partial<ConditionNode>) => {
  const next = [...items.value]
  next[index] = { ...next[index], ...patch }
  writeItems(next)
}

const replaceItem = (index: number, value: any) => {
  const next = [...items.value]
  next[index] = value
  writeItems(next)
}

/**
 * 切换操作符时清掉旧值
 *
 * 从「等于」切到「属于」，旧的单值留着会变成数组里的一个怪元素；
 * 从「属于」切到「为空」，旧数组则完全无意义。统一清掉最不容易出错
 */
const onOperatorChange = (index: number, operator: string) => {
  const prev = items.value[index]
  const prevMulti = isMultiValue(prev.operator)
  const nextMulti = isMultiValue(operator)
  const keepValue = prevMulti === nextMulti && needsValue(operator)
  patchItem(index, { operator, value: keepValue ? prev.value : undefined })
}
</script>

<style lang="scss" scoped>
.condition-group {
  padding: 10px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.group-empty {
  padding: 6px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.condition-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 8px;

  &:last-child {
    margin-bottom: 0;
  }
}

/**
 * 这几档宽度不能靠 UnoCSS 的 w-180px 之类
 *
 * Element Plus 的 `.el-select` 自带 width:100%，与 `.w-180px` 同为单类选择器、
 * 优先级相同，最终谁生效只取决于样式表的加载顺序 —— 实测是 el-select 胜出。
 * 于是三个下拉各自撑成 100%、再被 flex 均分掉整行，右边 flex:1 的比较值输入框
 * 被挤成 0 宽：看得见框、点不进去，条件值根本填不了。
 * 用 flex 的三值写法把宽度钉死，不与任何外部样式争优先级。
 */
.cond-field {
  flex: 0 0 180px;
}

.cond-operator {
  flex: 0 0 130px;
}

.cond-value-type {
  flex: 0 0 100px;
}

.cond-value {
  flex: 1 1 auto;
  min-width: 0;
}

.nested-group {
  flex: 1;
}

.value-placeholder {
  flex: 1;
  font-size: 12px;
  line-height: 24px;
  color: var(--el-text-color-placeholder);
}
</style>
