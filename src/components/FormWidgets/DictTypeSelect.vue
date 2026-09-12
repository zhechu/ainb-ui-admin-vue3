<template>
  <el-tree-select
    :model-value="modelValue"
    :data="treeData"
    :props="treeProps"
    :placeholder="placeholder"
    :size="size"
    :loading="loading"
    check-strictly
    clearable
    filterable
    :filter-node-method="filterNode"
    node-key="value"
    @update:model-value="(value) => emit('update:modelValue', (value as string) || undefined)"
  >
    <template #default="{ data }">
      <span>{{ data.name }}</span>
      <span v-if="!data.disabled" class="dict-type-code">{{ data.value }}</span>
    </template>
  </el-tree-select>
</template>

<script lang="ts" setup>
/**
 * 字典类型选择器（树形）
 *
 * ## 为什么不是一个普通下拉
 *
 * 字典类型本身是树形的（`system_dict_type` 上有 `parent_id` 与 `node_type`，
 * 分组节点只用来归拢、不挂字典数据）。用平铺下拉展示时，
 * 「订单状态」与「客户等级」会与它们的分组节点并排成兄弟，顺序还是乱的 ——
 * 字典一多就只能靠搜索去猜，而这正是分组存在的理由。
 *
 * ## 为什么显示的是名称不是编码
 *
 * 原先各处配字典类型时下拉里印的是 `system_user_sex` 这样的编码。
 * 编码是给程序看的，配置的人认的是「用户性别」——
 * 让人对着一串拼音缩写去猜自己要的是哪一个，是把内部标识泄露到了界面上。
 * 这里主文案是名称，编码降级成右侧的浅色附注（搜索时两者都能命中）。
 *
 * ## 分组节点不可选
 *
 * 分组节点挂不了字典数据，选中它等于配了一个永远查不到选项的字典类型 ——
 * 那是「配了但不生效」，所以在选择阶段就禁掉，而不是等运行时渲染成空下拉。
 */
import * as DictTypeApi from '@/api/system/dict/dict.type'
import { DictTypeNodeEnum } from '@/api/system/dict/dict.type'
import { CommonStatusEnum } from '@/utils/constants'
import { handleTree } from '@/utils/tree'

defineOptions({ name: 'DictTypeSelect' })

withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    size?: 'large' | 'default' | 'small'
  }>(),
  { placeholder: '选择数据字典', size: 'default' }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | undefined): void
}>()

interface DictTypeNode {
  id: number
  parentId: number
  name: string
  /** 选中后写回配置的值就是字典编码 */
  value: string
  /** el-tree-select 的回显文案 */
  label: string
  disabled: boolean
  children?: DictTypeNode[]
}

const loading = ref(false)
const treeData = ref<DictTypeNode[]>([])

/**
 * el-tree-select 的字段映射
 *
 * 断言成 any：`value` 这个键 el-tree-select 是支持的（它转给内部的 select），
 * 但 Element Plus 的 TreeOptionProps 类型里没有声明它。
 * 项目里别处（DictTypeForm、DictDataForm）也是同一个写法。
 */
const treeProps = {
  label: 'label',
  value: 'value',
  children: 'children',
  disabled: 'disabled'
} as any

/**
 * 拉字典类型并组装成树
 *
 * 禁用的字典一并排除：它查不出任何字典项，配上去与没配一样，
 * 而界面上看不出区别（都是一个空下拉）。
 */
const loadTree = async () => {
  loading.value = true
  try {
    const list = await DictTypeApi.getSimpleDictTypeList()
    const nodes: DictTypeNode[] = (list ?? [])
      .filter((item) => item.status === CommonStatusEnum.ENABLE)
      .map((item) => ({
        id: item.id as number,
        parentId: item.parentId ?? 0,
        name: item.name,
        value: item.type,
        // 分组节点只印名称 —— 它的编码不能被选中，印出来只会让人以为能选
        label: item.nodeType === DictTypeNodeEnum.GROUP ? item.name : `${item.name}（${item.type}）`,
        disabled: item.nodeType === DictTypeNodeEnum.GROUP
      }))
    treeData.value = handleTree(nodes, 'id', 'parentId') as DictTypeNode[]
  } catch (e) {
    // 拉不到就给空树，不抛出去打断整个配置面板
    console.error('[DictTypeSelect] 拉取字典类型失败', e)
    treeData.value = []
  } finally {
    loading.value = false
  }
}

/** 名称与编码都参与过滤：中文名想不起来时按编码找更快 */
const filterNode = (keyword: string, data: DictTypeNode) => {
  if (!keyword) return true
  const lower = keyword.toLowerCase()
  return (
    (data.name ?? '').toLowerCase().includes(lower) ||
    (data.value ?? '').toLowerCase().includes(lower)
  )
}

onMounted(loadTree)
</script>

<style lang="scss" scoped>
.dict-type-code {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
