<template>
  <div class="org-picker">
    <el-select
      v-model="selectedKeys"
      :placeholder="placeholder"
      :multiple="multiple"
      :multiple-limit="maxCount || 0"
      :disabled="disabled"
      clearable
      filterable
      :loading="loading"
      class="w-1/1"
      @change="onChange"
    >
      <el-option-group v-for="group in groupedOptions" :key="group.type" :label="group.label">
        <el-option
          v-for="opt in group.items"
          :key="opt.key"
          :label="opt.name"
          :value="opt.key"
        >
          <span>{{ opt.name }}</span>
          <span class="option-type">{{ group.label }}</span>
        </el-option>
      </el-option-group>
      <!--
        兜底选项：值指向的那条记录不在候选里

        候选只包含「属性面板勾了的类型」里当前还存在的记录。用户被停用、
        部门被删掉、或者这张表单当初勾过部门后来又取消了 —— 这几种情况下
        el-select 找不到匹配的 option，会把**原始的 key**（`dept:103`）直接
        印在框里。那串东西对用户没有任何意义，还看不出是「数据没了」
        还是「控件坏了」。补一个说明性的选项，把话说清楚。
      -->
      <el-option
        v-for="key in orphanKeys"
        :key="key"
        :label="orphanLabel(key)"
        :value="key"
        disabled
      />
    </el-select>
  </div>
</template>

<script lang="ts" setup>
import * as UserApi from '@/api/system/user'
import * as DeptApi from '@/api/system/dept'
import * as PostApi from '@/api/system/post'
import * as RoleApi from '@/api/system/role'

defineOptions({ name: 'OrgPicker' })

/**
 * 组织选择器
 *
 * 合并了用户 / 部门 / 岗位 / 角色四类选择（用户组暂缺对应接口，留在类型清单里待接）。
 * 对标产品把它们拆成 6 个独立控件 —— 从「选用户」改成「选用户或部门」意味着换控件、
 * 重配一遍；这里只是在属性面板多勾一个类型。
 *
 * ## 值契约
 *
 * 单选 `{type, id}`，多选 `[{type, id}]`。内部用 `type:id` 的字符串做选项 key，
 * 因为不同类型之间 id 会重复 —— 用户 1 和部门 1 是两个东西，
 * 只用 id 做 key 会让它们互相覆盖。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: any
    /** 可选的主体类型 */
    types?: Array<'user' | 'dept' | 'post' | 'role'>
    /**
     * `types` 的兼容别名
     *
     * ⚠️ 不是设计器会产出的键。设计器的属性面板写的一直是 `types`，
     * 但控件的说法是「可选主体类型」，手写规则 JSON 的人很容易照着写成
     * `subjectTypes` —— 而写错的后果是**静默退回只能选用户**：
     * 控件照常渲染、下拉里也有东西，只是部门/岗位/角色一个都不出现，
     * 已经存进去的部门值也回显不出来。这种「配了但不生效且不报错」的失败
     * 最难查，所以这里认掉它并在控制台说清楚该改成什么。
     */
    subjectTypes?: Array<'user' | 'dept' | 'post' | 'role'>
    multiple?: boolean
    /** 多选时的数量上限，0 表示不限 */
    maxCount?: number
    disabled?: boolean
    placeholder?: string
  }>(),
  {
    types: undefined,
    subjectTypes: undefined,
    multiple: false,
    maxCount: 0,
    placeholder: '请选择'
  }
)

/**
 * 实际生效的可选类型
 *
 * 两个键都没给时才回落到「只选用户」——把默认值放在这里而不是 withDefaults 上，
 * 是为了能分辨「用户没配」与「用户配了别名」这两种情况。
 */
const effectiveTypes = computed<string[]>(() => {
  if (props.types?.length) return props.types
  if (props.subjectTypes?.length) {
    console.warn(
      '[OrgPicker] 规则里写的是 props.subjectTypes，正确的键是 props.types —— ' +
        '本次已按 subjectTypes 生效，但建议改过来，免得以后这个兼容分支被移除时突然只剩「用户」可选'
    )
    return props.subjectTypes
  }
  return ['user']
})

const emit = defineEmits<{
  'update:modelValue': [value: any]
  change: [value: any]
}>()

interface OrgOption {
  /** type:id，选项的唯一键 */
  key: string
  type: string
  id: any
  name: string
}

const TYPE_LABELS: Record<string, string> = {
  user: '用户',
  dept: '部门',
  post: '岗位',
  role: '角色'
}

const options = ref<OrgOption[]>([])
const loading = ref(false)

const groupedOptions = computed(() =>
  effectiveTypes.value.map((type) => ({
    type,
    label: TYPE_LABELS[type] ?? type,
    items: options.value.filter((o) => o.type === type)
  }))
)

/**
 * 已选中、但在候选里找不到对应记录的 key
 *
 * 这一份不是为了好看：没有它，el-select 会把 `dept:103` 这样的原始 key
 * 原样印在输入框里（见模板里那段兜底选项的说明）。
 */
const orphanKeys = computed<string[]>(() => {
  const selected = props.multiple
    ? Array.isArray(selectedKeys.value)
      ? selectedKeys.value
      : []
    : selectedKeys.value
      ? [selectedKeys.value]
      : []
  const known = new Set(options.value.map((o) => o.key))
  return selected.filter((key: string) => key && !known.has(key))
})

/** 说清楚是哪一类的哪一条查不到了，而不是印一串 `dept:103` */
const orphanLabel = (key: string): string => {
  const idx = String(key).indexOf(':')
  const type = idx < 0 ? '' : String(key).slice(0, idx)
  const id = idx < 0 ? key : String(key).slice(idx + 1)
  const label = TYPE_LABELS[type]
  // 类型没在「可选类型」里勾上时，说法要与「记录被删了」区分开 ——
  // 两者的处理方式完全不同：前者去改配置，后者去改数据
  const reason = label && !effectiveTypes.value.includes(type) ? '该类型未开放选择' : '已不存在'
  return `${label ?? type}（${id}）· ${reason}`
}

/** 把 modelValue 转成内部的 key 列表 */
const toKeys = (value: any): any => {
  const one = (v: any) => (v && typeof v === 'object' ? `${v.type}:${v.id}` : v)
  if (props.multiple) {
    return Array.isArray(value) ? value.map(one).filter(Boolean) : []
  }
  return value ? one(value) : undefined
}

/** 把内部 key 列表转回 {type,id} 契约 */
const fromKeys = (keys: any): any => {
  const one = (k: string) => {
    const idx = String(k).indexOf(':')
    if (idx < 0) return null
    return { type: String(k).slice(0, idx), id: String(k).slice(idx + 1) }
  }
  if (props.multiple) {
    return (Array.isArray(keys) ? keys : []).map(one).filter(Boolean)
  }
  return keys ? one(keys) : undefined
}

const selectedKeys = ref<any>(toKeys(props.modelValue))

watch(
  () => props.modelValue,
  (v) => (selectedKeys.value = toKeys(v))
)

const onChange = (keys: any) => {
  const value = fromKeys(keys)
  emit('update:modelValue', value)
  emit('change', value)
}

/**
 * 拉取各类型的可选项
 *
 * 只拉属性面板勾选的类型 —— 一个只选用户的控件没有理由把角色、岗位全拉一遍。
 * 任一类型拉失败只影响它自己，其余照常可选
 */
const loadOptions = async () => {
  loading.value = true
  const result: OrgOption[] = []
  const tasks = effectiveTypes.value.map(async (type) => {
    try {
      if (type === 'user') {
        const rows = await UserApi.getSimpleUserList()
        rows.forEach((r: any) =>
          result.push({ key: `user:${r.id}`, type, id: r.id, name: r.nickname })
        )
      } else if (type === 'dept') {
        const rows = await DeptApi.getSimpleDeptList()
        rows.forEach((r: any) => result.push({ key: `dept:${r.id}`, type, id: r.id, name: r.name }))
      } else if (type === 'post') {
        const rows = await PostApi.getSimplePostList()
        rows.forEach((r: any) => result.push({ key: `post:${r.id}`, type, id: r.id, name: r.name }))
      } else if (type === 'role') {
        const rows = await RoleApi.getSimpleRoleList()
        rows.forEach((r: any) => result.push({ key: `role:${r.id}`, type, id: r.id, name: r.name }))
      }
    } catch (e) {
      // 单个类型拉失败不影响其余 —— 让用户至少能选到能选的那些
      console.error(`[OrgPicker] 拉取${TYPE_LABELS[type] ?? type}列表失败`, e)
    }
  })
  await Promise.all(tasks)
  options.value = result
  loading.value = false
}

watch(effectiveTypes, loadOptions, { deep: true })
onMounted(loadOptions)
</script>

<style lang="scss" scoped>
/*
  ⚠️ 这个宽度不能省

  `.el-form-item__content` 是 flex 容器。里面那个 el-select 自带 `width:100%`，
  作为 flex 子项它会按容器宽度算出 100%，所以别的下拉都是满宽的。
  而这里外面还套了一层 `.org-picker` —— 它没有宽度，作为 flex 子项按内容取宽，
  内容（el-select）的 100% 又反过来取自它，这个循环的解是「塌到最小」。
  实测只剩 44px：刚好一个下拉箭头的宽度，没选值时看着像个空按钮，
  选了值也只露得出两三个字，很容易被当成「回显不出来」。
*/
.org-picker {
  width: 100%;
}

.option-type {
  float: right;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
