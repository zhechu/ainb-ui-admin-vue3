<!--
  表单设计器属性面板里的「数据字典」配置项

  它产出的不是控件属性，而是一份「选项从哪来」的声明（写到 rule.props.dictSource），
  运行时由 applyDictSource 解析成具体的 options / props.options / props.data。
  这样一来，下拉框、单选框、级联、树选择共用同一套字典接入逻辑，
  而不是每种交互形态各做一个「字典 XX 选择器」控件。
-->
<template>
  <div class="dict-source">
    <el-select
      v-model="source.dictType"
      :placeholder="treeMode ? '选择树形字典' : '选择数据字典'"
      class="w-1/1"
      clearable
      filterable
      @change="handleDictTypeChange"
    >
      <el-option v-for="item in candidates" :key="item.type" :label="item.name" :value="item.type!">
        <span>{{ item.name }}</span>
        <span class="ml-8px text-12px op-60">{{ item.type }}</span>
      </el-option>
    </el-select>

    <template v-if="source.dictType">
      <div class="dict-source-item">
        <span class="dict-source-label">字典值类型</span>
        <el-select v-model="source.valueType" class="w-1/1" @change="emitChange">
          <el-option label="字符串" value="str" />
          <el-option label="数字" value="int" />
          <el-option label="布尔值" value="bool" />
        </el-select>
      </div>

      <template v-if="treeDict">
        <div class="dict-source-item">
          <span class="dict-source-label">起始节点</span>
          <el-tree-select
            v-model="source.rootValue"
            :data="dictTree"
            :props="{ label: 'label', value: 'value', children: 'children' }"
            check-strictly
            class="w-1/1"
            clearable
            placeholder="默认取整棵树"
            @change="emitChange"
          />
        </div>
        <div v-if="!treeMode" class="dict-source-item">
          <span class="dict-source-label">层级展开方式</span>
          <el-select v-model="source.flatMode" class="w-1/1" @change="emitChange">
            <el-option label="显示全路径" value="path" />
            <el-option label="按层级缩进" value="indent" />
            <el-option label="只取叶子节点" value="leaf" />
          </el-select>
          <div class="dict-source-tip"> 当前控件不支持层级，树形字典需要先展平成一列 </div>
        </div>
      </template>

      <div class="dict-source-tip dict-source-tip--strong">
        配置后将覆盖上方「选项」的设置，选项由字典实时提供
      </div>
    </template>

    <el-alert
      v-if="lazyWarning"
      :closable="false"
      class="mt-8px"
      show-icon
      title="该字典是懒加载模式，不会下发到前端缓存，无法作为选项数据源"
      type="warning"
    />
  </div>
</template>

<script lang="ts" setup>
import { getDictTree } from '@/utils/dict'
import * as DictTypeApi from '@/api/system/dict/dict.type'
import { DictCacheModeEnum, DictTypeNodeEnum } from '@/api/system/dict/dict.type'
import { CommonStatusEnum } from '@/utils/constants'

defineOptions({ name: 'DictSourceConfig' })

const props = defineProps<{
  modelValue?: Record<string, any>
  /** 当前控件是否支持层级（级联、树选择、树控件） */
  treeMode?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: any): void }>()

const dictTypes = ref<DictTypeApi.DictTypeVO[]>([])
const source = reactive<Record<string, any>>({
  dictType: '',
  valueType: 'str',
  rootValue: undefined,
  flatMode: 'path'
})

/**
 * 可选的字典
 *
 * 分组不挂字典数据，停用的字典不会下发，懒加载的字典不进前端缓存——
 * 这三类都选了也拿不到选项，不如一开始就不出现在列表里。
 * 唯一的例外是「已经选中的那个」：即使它后来变得不可用也要显示出来，
 * 否则用户看到的是一个空下拉框，根本不知道原先配的是什么。
 */
const candidates = computed(() =>
  dictTypes.value.filter(
    (item) =>
      item.type === source.dictType ||
      (item.nodeType !== DictTypeNodeEnum.GROUP &&
        item.status === CommonStatusEnum.ENABLE &&
        item.cacheMode !== DictCacheModeEnum.LAZY &&
        // 层级类控件只列树形字典：把平铺字典配上去，级联器永远只有一层
        (!props.treeMode || item.treeEnable === 1))
  )
)

const selected = computed(() => dictTypes.value.find((item) => item.type === source.dictType))
const treeDict = computed(() => selected.value?.treeEnable === 1)
const lazyWarning = computed(() => selected.value?.cacheMode === DictCacheModeEnum.LAZY)
const dictTree = computed(() => (source.dictType ? getDictTree(source.dictType) : []))

const emitChange = () => {
  // dictType 为空表示没启用字典数据源，回传 undefined 而不是空壳对象，
  // 免得表单 JSON 里留下一堆没有意义的 { dictType: '' }
  emit('update:modelValue', source.dictType ? { ...toRaw(source) } : undefined)
}

const handleDictTypeChange = () => {
  // 换了字典，原来的起始节点属于旧字典，必须清掉
  source.rootValue = undefined
  emitChange()
}

watch(
  () => props.modelValue,
  (value) => {
    source.dictType = value?.dictType ?? ''
    source.valueType = value?.valueType ?? 'str'
    source.rootValue = value?.rootValue
    source.flatMode = value?.flatMode ?? 'path'
  },
  { immediate: true, deep: true }
)

onMounted(async () => {
  dictTypes.value = await DictTypeApi.getSimpleDictTypeList()
})
</script>

<style lang="scss" scoped>
.dict-source-item {
  margin-top: 8px;
}

.dict-source-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.dict-source-tip {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);

  &--strong {
    margin-top: 8px;
    color: var(--el-color-warning);
  }
}
</style>
