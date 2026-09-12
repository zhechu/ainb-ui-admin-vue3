<template>
  <FormulaEditor
    v-model:expression="expression"
    v-model:ast="ast"
    v-model:precision="precision"
    v-model:rounding="rounding"
    v-model:thousands="thousands"
    :field-options="fieldOptions"
  />
</template>

<script lang="ts" setup>
import FormulaEditor from '@/components/FormFormula/FormulaEditor.vue'
import { collectFormFieldOptions } from '@/components/FormCreate/src/utils'
import { SUB_TABLE_WIDGET_TYPE } from '@/components/FormWidgets/contracts'

defineOptions({ name: 'FormulaEditorField' })

/**
 * 属性面板里的公式编辑器桥接组件
 *
 * 设计器的属性表单项是「一个字段 ↔ 一个值」的模型，而公式需要同时维护
 * 表达式、AST、精度、舍入、千分位五个属性。所以这里做一个桥：
 * 对设计器表现为一个表单项，内部直接读写 activeRule.props 上的五个键。
 *
 * 拆成五个独立表单项也能工作，但用户改表达式时看不到精度设置、
 * 改精度时看不到表达式，配一个公式要来回滚动。
 */
const props = defineProps<{
  /** 设计器注入：当前正在配置的规则 */
  formCreateInject?: any
}>()

/** 当前控件的 props 对象。直接改它，设计器会自己收集 */
const rule = computed(() => props.formCreateInject?.rule ?? {})
const ruleProps = computed(() => {
  if (!rule.value.props) rule.value.props = {}
  return rule.value.props
})

const makeModel = <T,>(key: string, fallback: T) =>
  computed<T>({
    get: () => ruleProps.value[key] ?? fallback,
    set: (v) => (ruleProps.value[key] = v)
  })

const expression = makeModel<string>('expression', '')
const ast = makeModel<any>('ast', null)
const precision = makeModel<number>('precision', 2)
const rounding = makeModel<string>('rounding', 'HALF_UP')
const thousands = makeModel<boolean>('thousands', false)

/**
 * 可引用的字段
 *
 * 除了普通字段，还要把子表内部字段以「子表.字段」的形式列出来 ——
 * 聚合函数的参数只能是它们，不列出来用户就得手打，打错了才在解析时报错。
 */
const fieldOptions = computed(() => {
  const designer = props.formCreateInject?.designer
  const currentField = rule.value.field
  // 普通字段
  const options = collectFormFieldOptions(
    designer ? { value: designer } : undefined,
    currentField
  )

  // 子表内部字段
  const subOptions: Array<{ label: string; value: string }> = []
  const walk = (rules: any[]) => {
    if (!Array.isArray(rules)) return
    for (const r of rules) {
      if (!r || typeof r !== 'object') continue
      if (r.type === SUB_TABLE_WIDGET_TYPE && Array.isArray(r.props?.rule) && r.field) {
        for (const inner of r.props.rule) {
          if (inner?.field) {
            subOptions.push({
              label: `${r.title || r.field}.${inner.title || inner.field}`,
              value: `${r.field}.${inner.field}`
            })
          }
        }
      }
      walk(r.children)
      walk(r.props?.rule)
    }
  }
  try {
    walk(designer?.getRule?.() ?? [])
  } catch {
    // 取不到就只给普通字段，用户仍可手写子表字段引用
  }
  return [...options, ...subOptions]
})
</script>
