<!--
  JSON 代码框（AI助手 流程编排优化 / Req 6）

  设计器里所有「裸 JSON 文本框」的统一替身：Monaco 代码高亮 + 实时格式检查 + 一键格式化。

  🔴 为什么不用 el-input type="textarea" 加个等宽字体糊过去：裸文本框既没有高亮，也不告诉用户
     「哪里写错了」——写错一个逗号，点「应用」才弹一句 JSON 解析失败，用户得自己数行号。
     这里把校验前移到输入时：状态条常驻，出错直接报到「第 X 行第 Y 列」，改对了状态立刻转绿。
  🔴 校验只做「是不是合法 JSON 对象」，不做业务校验（DSL 结构由后端 /validate 双层校验负责）。
     两者分工不同：这里防手滑打错标点，后端防语义不合法。
  🔴 顶层必须是对象：本组件的四个使用方（流程 DSL / 节点 config / 补偿前像 / 沙箱输入）
     后端都按 Map 读取，给数组或标量一律算格式错误，与 applyJson/applyConfig 的既有判据同口径。
-->
<template>
  <div class="jcf">
    <CodeEditor
      v-model="proxy"
      language="json"
      :readonly="readonly"
      :height="height"
      :placeholder="placeholder"
    />
    <div class="jcf__bar">
      <span class="jcf__status" :class="`jcf__status--${check.level}`" :data-testid="testId">
        <Icon :icon="statusIcon" class="jcf__status-icon" />
        {{ check.text }}
      </span>
      <el-button
        v-if="!readonly"
        size="small"
        text
        type="primary"
        :disabled="!check.parsed"
        @click="format"
      >
        格式化
      </el-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import CodeEditor from '@/components/CodeEditor/src/CodeEditor.vue'

defineOptions({ name: 'JsonCodeField' })

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** 编辑器高度（Monaco 不自撑高度，必须显式给；见 CodeEditor 的容器高度说明） */
    height?: string
    readonly?: boolean
    placeholder?: string
    /** 合法时追加在状态条后的摘要，如「3 个节点 / 2 条连线」——让「画布改动同步到 JSON」肉眼可验 */
    summarize?: (parsed: Record<string, any>) => string
    /** 状态条的 data-testid（e2e 定位用） */
    testId?: string
  }>(),
  { height: '180px', readonly: false, placeholder: '', testId: 'json-status' }
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const proxy = computed({
  get: () => props.modelValue ?? '',
  set: (v: string) => emit('update:modelValue', v)
})

/** V8 的 JSON 报错只给字符偏移（"…in JSON at position 123"），换算成行列才好定位 */
const locate = (text: string, message: string): string => {
  const m = /position\s+(\d+)/.exec(message)
  if (!m) return ''
  const offset = Math.min(Number(m[1]), text.length)
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  const col = offset - (before.lastIndexOf('\n') + 1) + 1
  return `第 ${line} 行第 ${col} 列 · `
}

const check = computed<{ level: 'ok' | 'error' | 'empty'; text: string; parsed?: Record<string, any> }>(() => {
  const raw = props.modelValue ?? ''
  if (!raw.trim()) return { level: 'empty', text: '未填写（留空即不设置）' }
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (e: any) {
    const msg = e?.message ?? '格式不合法'
    return { level: 'error', text: `JSON 格式错误：${locate(raw, msg)}${msg}` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { level: 'error', text: 'JSON 格式错误：顶层必须是一个对象（{…}）' }
  }
  const summary = props.summarize ? props.summarize(parsed) : ''
  return { level: 'ok', text: `JSON 格式正确${summary ? ` · ${summary}` : ''}`, parsed }
})

const statusIcon = computed(() =>
  check.value.level === 'error'
    ? 'ep:circle-close'
    : check.value.level === 'empty'
      ? 'ep:remove'
      : 'ep:circle-check'
)

/** 格式化 = 解析后按 2 空格重新序列化；解析不出来时按钮是禁用的，不会把用户内容改坏 */
const format = () => {
  if (!check.value.parsed) return
  emit('update:modelValue', JSON.stringify(check.value.parsed, null, 2))
}
</script>

<style lang="scss" scoped>
.jcf {
  width: 100%;
}

.jcf__bar {
  display: flex;
  margin-top: 4px;
  font-size: var(--wf-fs-sm, 12px);
  line-height: 20px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.jcf__status {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.jcf__status-icon {
  flex-shrink: 0;
}

.jcf__status--ok {
  color: var(--el-color-success);
}

.jcf__status--error {
  color: var(--el-color-danger);
}

.jcf__status--empty {
  color: var(--el-text-color-placeholder);
}
</style>
