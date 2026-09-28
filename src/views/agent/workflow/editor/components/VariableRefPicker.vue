<!--
  变量引用选择器（Phase E / Req5：类型化端口「点选上游产出」）

  给属性面板里「可引用上游」的输入字段挂一个小入口：点开列出本节点<b>上游可达</b>的产出变量
  （带类型色点 + 变量名 + 类型 + 来自哪个节点），点一下就把引用写进字段——非技术人员不用手打 {{$.var}}。

  🔴 写成什么形态由 `form` 决定，逐字对齐后端取值方式（见 nodeIoContract.referenceForm）：
     bare（queryVar/itemsVar 等）→ 写裸变量名；template（prompt/query/args 等）→ 写 {{$.var}} 模板。
  🔴 纯展示 + emit，不持有 DSL；插入语义（replace/append）由父级按字段类型决定（textarea 用 append 便于混排）。
-->
<template>
  <div class="vref">
    <el-popover
      v-if="upstream.length"
      v-model:visible="visible"
      placement="bottom-start"
      :width="280"
      trigger="click"
      popper-class="vref__pop"
    >
      <template #reference>
        <el-button
          v-if="!readonly"
          size="small"
          text
          type="primary"
          class="vref__trigger"
          data-testid="vref-trigger"
        >
          <Icon icon="ep:plus" class="mr-2px" />引用上游变量
        </el-button>
      </template>
      <div class="vref__list">
        <div class="vref__list-title">点选要引用的上游产出：</div>
        <el-scrollbar max-height="240px">
          <div
            v-for="v in upstream"
            :key="`${v.nodeId}.${v.varName}`"
            class="vref__item"
            :class="{ 'vref__item--active': isCurrent(v) }"
            @click="pick(v)"
          >
            <span class="vref__dot" :style="{ background: dataTypeColor(v.dataType) }"></span>
            <span class="vref__var">{{ v.varName }}</span>
            <el-tag size="small" effect="plain" class="vref__type">{{ v.dataTypeLabel }}</el-tag>
            <span class="vref__from">来自：{{ v.nodeName }}</span>
          </div>
        </el-scrollbar>
      </div>
    </el-popover>

    <span v-else-if="!readonly" class="vref__empty">
      暂无可引用的上游产出——先把会产出数据的节点连到本节点前面。
    </span>

    <!-- 当前值已指向某上游变量时，给个可读的回显标签 -->
    <el-tag
      v-if="currentMatch"
      size="small"
      type="success"
      effect="light"
      class="vref__current"
      data-testid="vref-current"
    >
      已引用：{{ currentMatch.varName }}（{{ currentMatch.dataTypeLabel }}）
    </el-tag>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { dataTypeColor } from '../nodeIoContract'
import { buildReference, parseReference, type UpstreamVar } from '../ioReference'

defineOptions({ name: 'VariableRefPicker' })

const props = withDefaults(
  defineProps<{
    /** 本节点上游可达的产出变量（computeUpstreamOutputs 的结果） */
    upstream: UpstreamVar[]
    /** 写引用的形态：bare=裸变量名（queryVar/itemsVar），template={{$.var}} 模板（prompt/query/args） */
    form: 'bare' | 'template'
    /** 字段当前值（用于回显「已引用」与 append 拼接） */
    modelValue?: any
    /** template 形态下的插入方式：replace=整体替换，append=追加到末尾（textarea 混排用） */
    insertMode?: 'replace' | 'append'
    readonly?: boolean
  }>(),
  { modelValue: '', insertMode: 'replace', readonly: false }
)

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const visible = ref(false)

/** 依据 form 造出「点选某上游变量」要写进字段的值 */
const valueFor = (v: UpstreamVar): string => {
  const refStr = props.form === 'bare' ? v.varName : buildReference(v.varName)
  if (props.form === 'template' && props.insertMode === 'append') {
    const cur = props.modelValue == null ? '' : String(props.modelValue)
    return cur ? `${cur}${refStr}` : refStr
  }
  return refStr
}

const pick = (v: UpstreamVar) => {
  if (props.readonly) return
  emit('update:modelValue', valueFor(v))
  visible.value = false
}

/** 当前字段值是否正好指向某上游变量（bare 比裸名；template 比「整段就是一个 {{$.var}}」） */
const currentMatch = computed<UpstreamVar | undefined>(() => {
  const val = props.modelValue
  if (val == null || val === '') return undefined
  if (props.form === 'bare') {
    return props.upstream.find((v) => v.varName === String(val).trim())
  }
  const parsed = parseReference(val)
  if (!parsed) return undefined
  return props.upstream.find((v) => v.varName === parsed.root)
})

const isCurrent = (v: UpstreamVar): boolean => currentMatch.value?.varName === v.varName
</script>

<style lang="scss" scoped>
.vref {
  display: flex;
  margin-top: 2px;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.vref__trigger {
  padding: 0 4px;
  height: 22px;
  font-size: 12px;
}

.vref__empty {
  font-size: 11px;
  line-height: 16px;
  color: var(--el-text-color-placeholder);
}

.vref__current {
  font-size: 11px;
}

.vref__list-title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.vref__item {
  display: flex;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  align-items: center;
  gap: 6px;

  &:hover {
    background: var(--el-fill-color-light);
  }
}

.vref__item--active {
  background: var(--el-color-primary-light-9);
}

.vref__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.vref__var {
  font-size: 12px;
  font-weight: 600;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.vref__type {
  flex-shrink: 0;
}

.vref__from {
  margin-left: auto;
  overflow: hidden;
  max-width: 110px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
