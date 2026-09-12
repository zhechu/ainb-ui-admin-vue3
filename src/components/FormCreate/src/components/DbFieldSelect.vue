<template>
  <div class="db-field-select">
    <!-- 树形选择：按表分组，表节点只做分组不可选 -->
    <el-tree-select
      v-if="!customMode"
      v-model="inner"
      check-strictly
      clearable
      :data="treeData"
      :default-expand-all="treeData.length <= 2"
      :disabled="readonly"
      :expand-on-click-node="false"
      filterable
      :filter-node-method="filterNode"
      node-key="value"
      :placeholder="placeholder || '选择数据库字段'"
      :props="{ label: 'label', children: 'children', disabled: 'disabled' }"
      @change="handleChange"
    />

    <!-- 自定义模式：不对应任何物理列的字段（或历史遗留的自定义命名）走这里 -->
    <el-input
      v-else
      v-model="inner"
      :disabled="readonly"
      placeholder="输入自定义字段名"
      @blur="handleChange(inner)"
      @keyup.enter="handleChange(inner)"
    />

    <el-button
      v-if="!readonly"
      class="db-field-select__toggle"
      link
      size="small"
      :title="customMode ? '改为从数据库字段中选择' : '改为手工输入自定义字段名'"
      @click="customMode = !customMode"
    >
      <Icon :icon="customMode ? 'ep:list' : 'ep:edit-pen'" />
    </el-button>
  </div>
</template>

<script lang="ts" setup>
/**
 * 数据库字段选择器（表单设计器「字段ID」属性用）
 *
 * <h3>为什么是树而不是平铺列表</h3>
 * 主表动辄几十列，再加上几张副表，铺成一条长列表既看不出某一列属于哪张表，
 * 也没法把不关心的表折叠掉。按表分成两层，配合搜索才好用。
 * 表节点设为 disabled，只做分组，不能被选中。
 *
 * <h3>为什么还留着自定义输入</h3>
 * el-tree-select 不支持 allow-create。而字段名不总是等于列名：
 * 用户可能想叫 customerName 而列叫 name，历史表单里也可能已经存在这类命名。
 * 只给树的话，这些字段一打开就显示不出来，改一下还会被清空。
 * 所以保留一个切换开关，并且【当前值不在树里时自动进入自定义模式】。
 *
 * <h3>为什么不能简单换成一个选择控件了事</h3>
 * 设计器自带的 FieldInput 并不只是个输入框，它还带三重校验：字段名非空、
 * 必须以字母开头、同作用域内不能重名。其中【重名】最要紧 —— form-create 按 field
 * 取值，两个控件同名会直接把彼此的值覆盖掉，界面上毫无提示。
 * 这三条在两种模式下都原样保留。
 */
import { computed, inject, ref, watch } from 'vue'

defineOptions({ name: 'DbFieldSelect' })

/** 用项目统一的消息 hook：ElMessage 不在自动导入清单里，直接用会运行时报未定义 */
const message = useMessage()

const props = defineProps<{
  modelValue?: string
  /** 可选的物理列，按表分组的两层树。由表单设计步骤按当前编辑控件的归属动态给出 */
  options?: Array<{ value: string; label: string; disabled?: boolean; children?: any[] }>
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

/**
 * 设计器实例
 *
 * 与 FieldInput 走同一个注入点，才能拿到「当前激活控件」与「同作用域的兄弟控件」，
 * 重名校验依赖它。拿不到时降级为只做格式校验，不至于让属性面板整个崩掉。
 */
const designer = inject<any>('designer', null)

const inner = ref(props.modelValue ?? '')
/** 修改前的值，校验不通过时回滚到它 */
const previous = ref(props.modelValue ?? '')
const customMode = ref(false)

const treeData = computed(() => props.options ?? [])

/** 树里所有可选的列（叶子节点）的值 */
const leafValues = computed(() => {
  const values = new Set<string>()
  treeData.value.forEach((node) => {
    ;(node.children ?? []).forEach((leaf: any) => leaf?.value && values.add(leaf.value))
  })
  return values
})

/**
 * 当前值不在树里时自动切到自定义模式
 *
 * 不这么做的话，自定义命名的字段（或换了作用域后列对不上的字段）在树形控件里
 * 会显示成空白，用户会以为字段名丢了，一改还真就被清空了。
 */
const syncMode = () => {
  const value = props.modelValue
  if (value && !leafValues.value.has(value)) {
    customMode.value = true
  }
}

watch(
  () => props.modelValue,
  (v) => {
    inner.value = v ?? ''
    previous.value = v ?? ''
    syncMode()
  },
  { immediate: true }
)

// 作用域切换会换掉整棵树，要重新判定当前值还在不在树里
watch(leafValues, syncMode)

const readonly = computed(() => props.disabled || designer?.setupState?.fieldReadonly)

const t = (key: string, args?: any): string => {
  const fn = designer?.setupState?.t
  return typeof fn === 'function' ? fn(key, args) : key
}

const activeRule = computed(() => designer?.setupState?.activeRule)

/** 搜索：表名与列名都能命中，输入表名时整组保留 */
const filterNode = (keyword: string, data: any) => {
  if (!keyword) return true
  return String(data?.label ?? '')
    .toLowerCase()
    .includes(keyword.toLowerCase())
}

/**
 * 取同作用域内其它控件的字段名
 *
 * 「同作用域」指同一个子表控件内部，或同一层顶层规则 —— 与设计器自带的判定一致：
 * 子表内部的 name 与主表的 name 互不冲突，各存各的。
 */
const siblingFields = (): string[] => {
  const state = designer?.setupState
  if (!state) return []
  let children = state.getSubFormChildren?.(activeRule.value)
  if (!Array.isArray(children) || children.length === 0) {
    children = state.children ?? []
  }
  const list: string[] = []
  const walk = (rules: any[]) => {
    rules?.forEach((rule: any) => {
      if (rule && rule._fc_drag_tag && rule.field) {
        list.push(rule.field)
      } else if (rule?.children) {
        walk(rule.children)
      }
    })
  }
  walk(children)
  return list
}

const fail = (text: string) => {
  message.warning(text)
  inner.value = previous.value
}

/**
 * 校验并提交
 *
 * 三条规则与设计器自带的 FieldInput 保持一致，错误文案也复用它的多语言键，
 * 免得同一种错误在不同入口给出两种说法。
 */
const handleChange = (value: string) => {
  const field = (value || '').replace(/[\s　]/g, '')
  if (!field) {
    return fail(t('computed.fieldEmpty'))
  }
  if (!/^[a-zA-Z]/.test(field)) {
    return fail(t('computed.fieldChar'))
  }
  if (field !== previous.value && siblingFields().filter((f) => f === field).length > 0) {
    return fail(t('computed.fieldExist', { label: field }))
  }
  // form-create 的取值路径以 . 分隔，字段名里带点会被当成嵌套路径
  const normalized = field.replaceAll('.', '_')
  inner.value = normalized
  if (normalized === props.modelValue) {
    return
  }
  const old = props.modelValue
  previous.value = normalized
  emit('update:modelValue', normalized)
  // 通知设计器字段被改名，它据此维护组件联动等对该字段的引用
  designer?.emit?.('changeField', {
    field: normalized,
    oldField: old,
    rule: activeRule.value
  })
}
</script>

<style lang="scss" scoped>
.db-field-select {
  display: flex;
  gap: 4px;
  align-items: center;
  width: 100%;
}

/* 让选择/输入撑满，切换按钮固定在右侧 */
.db-field-select > :first-child {
  flex: 1;
  min-width: 0;
}

.db-field-select__toggle {
  flex-shrink: 0;
}
</style>
