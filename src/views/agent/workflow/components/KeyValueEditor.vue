<!--
  键值对编辑器（AI助手 UX 修复 / 问题4-④ 结构化 config）

  用于 tool.args、hitl.bpm_approval.formVars 这类「参数名 → 值」的 config 对象：
  此前只能写裸 JSON（业务人员门槛高、易写坏引号），改成逐行「键 + 值 + 删除」的表格输入。

  🔴 值是字符串输入框；未触碰的行保留原始值类型（数字/布尔/嵌套对象原样回写），
     编辑过的行值转为字符串——后端模板解析（{{$.var}}）与类型强转（eq 数值感知）都能接受字符串，
     真需要非字符串字面量时用底部 DSL JSON 兜底。
  🔴 v-model 传的是节点 config 里的真实对象引用，但本组件采用「整体替换」式更新（emit 新对象），
     故父级用 v-model 绑定 selConfig[key] 即可正确写回 DSL。
-->
<template>
  <div class="w-full">
    <div v-for="(row, i) in rows" :key="i" class="flex items-center gap-4px mb-4px">
      <el-input
        v-model="row.key"
        placeholder="参数名"
        size="small"
        class="flex-1"
        @input="onRowInput(row)"
      />
      <el-input
        v-model="row.text"
        :placeholder="valuePlaceholder"
        size="small"
        class="flex-1"
        @input="onRowInput(row)"
      />
      <el-button
        size="small"
        type="danger"
        plain
        circle
        title="删除此行"
        :disabled="rows.length <= 1 && !row.key && !row.touched"
        @click="removeRow(i)"
      >
        <Icon icon="ep:delete" />
      </el-button>
    </div>
    <el-button size="small" text type="primary" @click="addRow">
      <Icon icon="ep:plus" class="mr-2px" />添加参数
    </el-button>
  </div>
</template>

<script lang="ts" setup>
defineOptions({ name: 'KeyValueEditor' })

const props = withDefaults(
  defineProps<{
    modelValue?: Record<string, any> | null
    valuePlaceholder?: string
  }>(),
  { modelValue: () => ({}), valuePlaceholder: '值，支持 {{$.变量}} 模板' }
)
const emit = defineEmits<{ (e: 'update:modelValue', v: Record<string, any>): void }>()

interface Row {
  key: string
  text: string
  /** 未被编辑过且原值不是字符串时，回写保留原始值（不因渲染丢失数字/布尔/嵌套对象） */
  raw?: any
  touched?: boolean
}

const toText = (v: any): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const buildRows = (obj: Record<string, any> | null | undefined): Row[] => {
  const entries = Object.entries(obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {})
  const rows: Row[] = entries.map(([key, v]) => ({ key, text: toText(v), raw: v }))
  // 恒留一行空行方便输入
  rows.push({ key: '', text: '' })
  return rows
}

const rows = ref<Row[]>(buildRows(props.modelValue))

watch(
  () => props.modelValue,
  (v) => {
    rows.value = buildRows(v)
  }
)

/** 只把被编辑的那一行标记为 touched（其余行保留原始值类型），再整体回写 */
const onRowInput = (row: Row) => {
  row.touched = true
  flush()
}

const flush = () => {
  const out: Record<string, any> = {}
  for (const r of rows.value) {
    const k = r.key.trim()
    if (!k) continue
    // 未编辑过的行还原原始值类型；编辑过/新增的行按字符串写回
    out[k] = !r.touched && r.raw !== undefined && typeof r.raw !== 'string' ? r.raw : r.text
  }
  emit('update:modelValue', out)
  // 末尾没有空行就补一行（删行/填满后保持可继续输入）
  const last = rows.value[rows.value.length - 1]
  if (!last || last.key || last.text) rows.value.push({ key: '', text: '' })
  // 清掉多余的空行（只保留末尾一行）
  rows.value = rows.value.filter(
    (r, i) => r.key.trim() || r.text || i === rows.value.length - 1
  )
}

const addRow = () => {
  rows.value.push({ key: '', text: '' })
}

const removeRow = (i: number) => {
  rows.value.splice(i, 1)
  flush()
}
</script>
