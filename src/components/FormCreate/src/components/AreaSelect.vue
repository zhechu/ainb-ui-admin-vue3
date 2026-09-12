<!-- 省市区选择器 (Element Plus 版本 - Vue3) -->
<template>
  <el-cascader
    v-model="selectedValue"
    class="w-full"
    :options="areaTree"
    :props="cascaderProps"
    :disabled="disabled"
    :placeholder="placeholder"
    :clearable="clearable"
    :show-all-levels="showAllLevels"
    :separator="separator"
    :loading="loading"
    @change="handleChange"
  />
</template>

<script lang="ts" setup>
import { onMounted, ref, watch } from 'vue'
import { getAreaTree } from '@/api/system/area'
import { AreaLevelEnum } from '@/utils/constants'

defineOptions({ name: 'AreaSelect' })

interface AreaVO {
  id: number
  name: string
  code: string
  parentId?: number
  sort?: number
  status?: number
  children?: AreaVO[]
}

interface Props {
  modelValue?: number[] | string[]
  level?: (typeof AreaLevelEnum)[keyof typeof AreaLevelEnum]
  disabled?: boolean
  placeholder?: string
  clearable?: boolean
  showAllLevels?: boolean
  separator?: string
  formCreateInject?: any
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: undefined,
  level: AreaLevelEnum.DISTRICT,
  disabled: false,
  placeholder: '请选择省市区',
  clearable: true,
  showAllLevels: true,
  separator: '/'
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: number[] | string[] | undefined): void
}>()

const cascaderProps = {
  label: 'name',
  value: 'id',
  children: 'children',
  checkStrictly: true, // 允许选择任意级别
  emitPath: true // 返回完整路径
} // Element Plus Cascader 的 props 配置

const areaTree = ref<AreaVO[]>([]) // 地区树形数据
const selectedValue = ref<number[] | undefined>() // 当前选中值
const loading = ref(false) // 加载状态

/** 加载地区树形数据 */
async function loadAreaTree(): Promise<void> {
  try {
    loading.value = true
    const data = await getAreaTree()
    // 根据 level 限制层级
    areaTree.value = filterTreeByLevel(data || [], props.level)
  } catch (error) {
    console.warn('[AreaSelect] 加载地区数据失败:', error)
    areaTree.value = []
  } finally {
    loading.value = false
  }
}

/** 根据层级过滤树形数据 */
function filterTreeByLevel(tree: AreaVO[], maxLevel: number): AreaVO[] {
  if (maxLevel <= 0) {
    return []
  }
  return tree.map((node) => {
    const newNode = { ...node }
    // 如果当前是最后一层，移除 children
    if (maxLevel === 1) {
      delete newNode.children
    } else if (node.children && node.children.length > 0) {
      // 递归处理子节点
      newNode.children = filterTreeByLevel(node.children, maxLevel - 1)
    }
    return newNode
  })
}

/** 处理选中值变化 */
function handleChange(value: number[] | undefined): void {
  if (value === undefined || value === null) {
    emit('update:modelValue', undefined)
    return
  }
  emit('update:modelValue', value)
}

/**
 * 同步 modelValue 到内部选中值
 *
 * ## 为什么要做这么多归一
 *
 * 落库的列是 VARCHAR，而级联选择器 emit 出来的是数字数组（`props.value` 是 `id`）。
 * 一趟「提交 → 落库 → 读回来」之后，值会变成下面这些形态里的任意一种：
 *
 * - `["310000","310100"]` —— 数组还在，元素被 JSON 序列化成了字符串
 * - `'["310000","310100"]'` —— 整个数组落成一段 JSON 文本
 * - `'310000,310100'` —— 早期数据里的逗号分隔形态
 *
 * 原先这里只认「已经是数组」这一种，其余一律包成 `[原值]`。而即使认出了数组，
 * 元素是字符串的 `"310000"` 也对不上选项里数字的 `310000`（级联选择器按
 * 严格相等匹配）—— 表现正是**编辑时明明选过省市区，再打开却是空的**，
 * 而且不报任何错。
 *
 * 所以这里把三种形态一律拉平成数字数组。转不成数字的元素直接丢掉：
 * 留着它会让整条路径匹配失败，丢掉至少还能回显出能对上的那几级。
 */
function syncSelectedValue(): void {
  const newValue: unknown = props.modelValue
  if (newValue === undefined || newValue === null || newValue === '') {
    selectedValue.value = undefined
    return
  }

  const path = toIdPath(newValue)
  selectedValue.value = path.length > 0 ? path : undefined
}

/** 把各种落库形态拉平成级联选择器要的数字路径 */
function toIdPath(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(toAreaId).filter((id): id is number => id !== undefined)
  }
  if (typeof value === 'number') {
    return [value]
  }
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    // 整个数组落成一段 JSON 文本
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) return toIdPath(parsed)
      } catch {
        // 坏掉的 JSON 按分隔串再试一次，不直接放弃
      }
    }
    return text
      .split(',')
      .map(toAreaId)
      .filter((id): id is number => id !== undefined)
  }
  return []
}

/** 单个节点值 → 数字 id。转不出来时返回 undefined，由调用方丢掉 */
function toAreaId(item: unknown): number | undefined {
  if (typeof item === 'number') return Number.isFinite(item) ? item : undefined
  if (typeof item === 'string') {
    const trimmed = item.trim()
    if (!trimmed) return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** 监听 modelValue 变化 */
watch(() => props.modelValue, syncSelectedValue, { immediate: true })

/** 组件挂载时加载数据 */
onMounted(async () => {
  await loadAreaTree()
})
</script>
