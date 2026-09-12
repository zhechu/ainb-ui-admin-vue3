<template>
  <div class="inline-rule-editor">
    <!-- 前缀段 -->
    <div class="section">
      <div class="section-title">
        <span>前缀</span>
        <el-button link type="primary" size="small" @click="addSegment('prefixSegments')">
          <Icon icon="ep:plus" class="mr-2px" /> 添加
        </el-button>
      </div>
      <SegmentList
        :segments="config.prefixSegments"
        :field-options="fieldOptions"
        @remove="(i) => removeSegment('prefixSegments', i)"
        @move="(from, to) => moveSegment('prefixSegments', from, to)"
        @change="emitChange"
      />
    </div>

    <!-- 生成方式 -->
    <div class="section">
      <div class="section-title"><span>主体</span></div>
      <el-select v-model="config.genType" size="small" class="w-full mb-6px" @change="emitChange">
        <el-option
          v-for="item in GEN_TYPE_OPTIONS"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>

      <template v-if="config.genType === GEN_TYPE.TIME">
        <el-select
          v-model="config.dateFormat"
          size="small"
          class="w-full mb-6px"
          @change="emitChange"
        >
          <el-option
            v-for="item in DATE_FORMAT_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <div class="row">
          <span class="row-label">位数</span>
          <el-input-number
            v-model="config.digit"
            :min="1"
            :max="9"
            :precision="0"
            size="small"
            controls-position="right"
            @change="emitChange"
          />
        </div>
        <div class="row">
          <span class="row-label">起始</span>
          <el-input-number
            v-model="config.startNumber"
            :min="0"
            :precision="0"
            size="small"
            controls-position="right"
            @change="emitChange"
          />
        </div>
        <div class="row">
          <span class="row-label">步长</span>
          <el-input-number
            v-model="config.step"
            :min="1"
            :precision="0"
            size="small"
            controls-position="right"
            @change="emitChange"
          />
        </div>
        <div class="row">
          <span class="row-label">重置</span>
          <el-select v-model="config.resetCycle" size="small" @change="emitChange">
            <el-option
              v-for="item in RESET_CYCLE_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </div>
        <div class="row">
          <span class="row-label">分组</span>
          <el-switch v-model="config.groupByPrefix" size="small" @change="emitChange" />
          <el-tooltip placement="top">
            <template #content>
              开启后按前缀分别计数。前缀取自客户编号这类字段时，<br />
              每个客户各自从 1 开始，而不是全局一个计数器。
            </template>
            <Icon icon="ep:question-filled" class="ml-4px text-gray-400" />
          </el-tooltip>
        </div>
      </template>

      <template v-if="config.genType === GEN_TYPE.RANDOM">
        <div class="row">
          <span class="row-label">位数</span>
          <el-select v-model="config.randomDigit" size="small" @change="emitChange">
            <el-option
              v-for="item in RANDOM_DIGIT_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </div>
        <div class="row">
          <span class="row-label">类型</span>
          <el-select v-model="config.randomType" size="small" @change="emitChange">
            <el-option
              v-for="item in RANDOM_TYPE_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </div>
      </template>
    </div>

    <!-- 后缀段 -->
    <div class="section">
      <div class="section-title">
        <span>后缀</span>
        <el-button link type="primary" size="small" @click="addSegment('suffixSegments')">
          <Icon icon="ep:plus" class="mr-2px" /> 添加
        </el-button>
      </div>
      <SegmentList
        :segments="config.suffixSegments"
        :field-options="fieldOptions"
        @remove="(i) => removeSegment('suffixSegments', i)"
        @move="(from, to) => moveSegment('suffixSegments', from, to)"
        @change="emitChange"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { cloneDeep } from 'lodash-es'
import SegmentList from './BillInlineRuleSegmentList.vue'
import {
  GEN_TYPE,
  GEN_TYPE_OPTIONS,
  DATE_FORMAT_OPTIONS,
  RESET_CYCLE_OPTIONS,
  RANDOM_DIGIT_OPTIONS,
  RANDOM_TYPE_OPTIONS
} from '@/views/infra/billTemplate/constants'

/**
 * 内联单据规则编辑器
 *
 * 渲染在表单设计器的属性面板里 —— 属性面板本身就是一个 form-create 表单，
 * 规则里的 type 会走 Vue 的组件解析，因此全局注册的组件可以直接当作属性编辑器用。
 *
 * 编辑的是整个 ruleConfig 对象，而不是把它拆成一堆平铺的 props 字段。
 * 拆开的话，嵌套路径（ruleConfig.prefixSegments[0].value）在 form-create 的
 * 字段体系里没法表达，段列表这种动态结构更是无从下手。
 */
defineOptions({ name: 'BillInlineRuleEditor' })

const props = defineProps({
  /** form-create 通过 v-model 注入，值是整个 ruleConfig 对象 */
  modelValue: {
    type: Object,
    default: () => ({})
  },
  /**
   * 可被引用的表单字段
   *
   * 由 useBillFieldRule 在打开属性面板时从设计器里取出后传入 ——
   * 组件自身拿不到设计器实例。
   */
  fieldOptions: {
    type: Array as PropType<Array<{ label: string; value: string }>>,
    default: () => []
  }
})

const emit = defineEmits(['update:modelValue'])

const defaultConfig = () => ({
  prefixSegments: [],
  suffixSegments: [],
  genType: GEN_TYPE.TIME,
  dateFormat: 'yyyyMMdd',
  digit: 4,
  startNumber: 1,
  step: 1,
  resetCycle: 'AUTO',
  // 内联模式默认按前缀分组，与后端 InlineRuleConfig.groupByPrefixOrDefault() 一致
  groupByPrefix: true,
  randomDigit: 16,
  randomType: 1
})

/** 本地副本。直接改 props.modelValue 会绕过 v-model，设计器那边收不到变更 */
const config = ref<any>({ ...defaultConfig(), ...cloneDeep(props.modelValue || {}) })

// 切换选中的控件时，属性面板复用同一个组件实例，必须跟着换数据
watch(
  () => props.modelValue,
  (val) => {
    config.value = { ...defaultConfig(), ...cloneDeep(val || {}) }
  }
)

const emitChange = () => {
  emit('update:modelValue', cloneDeep(config.value))
}

const addSegment = (key: 'prefixSegments' | 'suffixSegments') => {
  if (!Array.isArray(config.value[key])) {
    config.value[key] = []
  }
  // 默认给常量：新增一段时用户多半是想敲一个固定前缀
  config.value[key].push({ sourceType: 2, value: '' })
  emitChange()
}

const removeSegment = (key: 'prefixSegments' | 'suffixSegments', index: number) => {
  config.value[key].splice(index, 1)
  emitChange()
}

const moveSegment = (key: 'prefixSegments' | 'suffixSegments', from: number, to: number) => {
  const list = config.value[key]
  if (to < 0 || to >= list.length) return
  const [item] = list.splice(from, 1)
  list.splice(to, 0, item)
  emitChange()
}
</script>

<style lang="scss" scoped>
.inline-rule-editor {
  width: 100%;
}

.section {
  padding: 8px;
  margin-bottom: 8px;
  background-color: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.row {
  display: flex;
  align-items: center;
  margin-bottom: 6px;

  &:last-child {
    margin-bottom: 0;
  }
}

.row-label {
  flex-shrink: 0;
  width: 40px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
