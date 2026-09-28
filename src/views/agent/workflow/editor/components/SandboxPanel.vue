<!--
  沙箱测试面板（Req4b / coze 式沙箱试跑）—— 设计器右侧非模态抽屉的内容

  职责：收测试输入（据 DSL variables 自动生成表单，非技术人员友好）→ 真跑当前草稿 DSL（流式）→
        逐节点时间线（等待/执行中/成功/已模拟写操作/失败/已中断/未执行）+ 输入输出快照 + 最终产出。
  纪律（如实告知用户）：真调大模型消耗 token；写/不可逆工具被 mock（无副作用）；不落库不计配额；命中人工闸口即停。

  🔴 画布高亮：每折叠一个事件就 emit('overlay', buildSandboxOverlay(run))，父页把它下发给 WorkflowDesigner 染节点边框。
  🔴 事件流解析与 AssistantChat 同源：JSON.parse(event.data) → CommonResult → payload.data 才是 WorkflowEvent；
     onerror 必须 throw，否则 fetchEventSource 会无限重连、反复真跑大模型计费。
-->
<template>
  <div class="sbx">
    <!-- 顶部纪律提示：真花钱、写操作已 mock -->
    <el-alert type="warning" :closable="false" show-icon class="sbx__notice">
      <template #title>沙箱会真实调用大模型（消耗 token）</template>
      <div class="sbx__notice-body">
        写操作、不可逆操作已被自动模拟（mock），不会产生真实副作用；试跑不落库、不计入执行历史。
      </div>
    </el-alert>

    <!-- 测试输入 -->
    <section class="sbx__sec">
      <div class="sbx__sec-head">
        <span class="sbx__sec-title">测试输入</span>
        <el-tooltip
          content="表单模式按流程声明的输入变量逐个填；高级模式直接编辑 JSON"
          placement="top"
        >
          <div class="sbx__adv">
            <span>高级(JSON)</span>
            <el-switch v-model="advanced" size="small" @change="onToggleAdvanced" />
          </div>
        </el-tooltip>
      </div>

      <!-- 表单模式 -->
      <template v-if="!advanced">
        <el-form v-if="fields.length" label-position="top" class="sbx__form" @submit.prevent>
          <el-form-item v-for="f in fields" :key="f.key" class="sbx__field">
            <template #label>
              <span class="sbx__field-label">
                {{ f.key }}
                <span v-if="f.required" class="sbx__req">*</span>
                <span class="sbx__field-hint">{{ f.hint }}</span>
              </span>
            </template>
            <el-select
              v-if="f.type === 'boolean'"
              v-model="f.value"
              placeholder="请选择"
              clearable
              class="w-full"
            >
              <el-option label="是 (true)" value="true" />
              <el-option label="否 (false)" value="false" />
            </el-select>
            <el-input
              v-else-if="f.type === 'object' || f.type === 'array'"
              v-model="f.value"
              type="textarea"
              :rows="2"
              :placeholder="f.type === 'array' ? '如 [1,2,3]' : '如 {&quot;a&quot;:1}'"
              spellcheck="false"
            />
            <el-input
              v-else
              v-model="f.value"
              :placeholder="f.type === 'number' ? '如 100' : '请输入'"
              clearable
            />
          </el-form-item>
        </el-form>
        <el-empty v-else :image-size="60" description="这条流程没有声明输入变量，可直接运行" />
      </template>

      <!-- 高级 JSON 模式 -->
      <template v-else>
        <el-input
          v-model="jsonText"
          type="textarea"
          :rows="6"
          class="sbx__json"
          spellcheck="false"
          placeholder="{&quot;input&quot;:&quot;你好&quot;}"
        />
        <div v-if="jsonError" class="sbx__err">{{ jsonError }}</div>
      </template>
    </section>

    <!-- 运行条 -->
    <div class="sbx__runbar">
      <el-button
        type="primary"
        :loading="running"
        :disabled="!canRun"
        v-hasPermi="['agent:workflow:run']"
        @click="handleRun"
      >
        <Icon icon="ep:video-play" class="mr-4px" />{{ running ? '试跑中…' : '运行沙箱' }}
      </el-button>
      <el-button v-if="running" @click="handleStop">
        <Icon icon="ep:video-pause" class="mr-4px" />停止
      </el-button>
      <span v-if="run.durationMs != null" class="sbx__dur">
        耗时 {{ (run.durationMs / 1000).toFixed(1) }}s
      </span>
    </div>

    <!-- 连接/启动错误（非节点级） -->
    <el-alert
      v-if="runError"
      type="error"
      :closable="false"
      show-icon
      :title="runError"
      class="sbx__banner"
    />

    <!-- 命中人工闸口 banner -->
    <el-alert
      v-if="run.status === 'interrupted'"
      type="warning"
      :closable="false"
      show-icon
      class="sbx__banner"
    >
      <template #title>沙箱在「{{ interruptNodeName }}」处停止</template>
      <div class="sbx__notice-body">
        这是人工确认 / 等待节点，需要真人在聊天里点「同意 / 拒绝」才能继续；沙箱试跑不支持在此续跑。
      </div>
    </el-alert>

    <!-- 有写操作被 mock 的提示 -->
    <el-alert
      v-if="run.anyMocked"
      type="info"
      :closable="false"
      show-icon
      title="本次有写操作被模拟（mock），未产生真实副作用"
      class="sbx__banner"
    />

    <!-- 逐节点时间线 -->
    <section v-if="run.rows.length" class="sbx__sec">
      <div class="sbx__sec-head">
        <span class="sbx__sec-title">执行过程</span>
        <span class="sbx__count">
          {{ run.completedCount }}/{{ run.rows.length }} 个节点完成
        </span>
      </div>
      <div class="sbx__timeline">
        <div
          v-for="row in run.rows"
          :key="row.nodeId"
          class="sbx__row"
          :class="{ 'sbx__row--open': expanded === row.nodeId }"
          @click="toggleRow(row.nodeId)"
        >
          <span class="sbx__dot" :style="{ background: meta(row.status).color }"></span>
          <div class="sbx__row-main">
            <div class="sbx__row-line">
              <span class="sbx__row-name">{{ row.name }}</span>
              <el-tag size="small" :type="meta(row.status).tagType" effect="light">
                {{ meta(row.status).label }}
              </el-tag>
              <span v-if="row.durationMs != null" class="sbx__row-dur">{{ row.durationMs }}ms</span>
            </div>
            <div class="sbx__row-type">{{ row.typeLabel }}</div>
          </div>
          <Icon icon="ep:arrow-right" class="sbx__row-caret" />

          <!-- 展开详情 -->
          <div v-if="expanded === row.nodeId" class="sbx__detail" @click.stop>
            <div v-if="row.errorMsg" class="sbx__detail-err">{{ row.errorMsg }}</div>
            <div class="sbx__detail-block">
              <div class="sbx__detail-label">输入（该节点运行前看到的数据）</div>
              <pre class="sbx__pre">{{ render(row.input) || '（无）' }}</pre>
            </div>
            <div class="sbx__detail-block">
              <div class="sbx__detail-label">
                输出（该节点新增/变更的数据）
                <el-tag v-if="row.mocked" size="small" type="warning" effect="plain">写操作已模拟</el-tag>
              </div>
              <pre class="sbx__pre">{{ render(row.output) || '（无）' }}</pre>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 最终产出 -->
    <section v-if="run.finalState" class="sbx__sec">
      <div class="sbx__sec-head">
        <span class="sbx__sec-title">最终产出</span>
      </div>
      <div class="sbx__detail-label">流程回复（output 变量）</div>
      <pre class="sbx__pre sbx__pre--final">{{ render(finalOutput) }}</pre>
    </section>
  </div>
</template>

<script lang="ts" setup>
import { AgentWorkflowApi, type WorkflowEventVO } from '@/api/agent/workflow'
import type { EditorDsl } from '../../editorModel'
import {
  buildSandboxInputFields,
  buildSandboxOverlay,
  collectSandboxInput,
  createSandboxRun,
  parseSandboxInputText,
  reduceSandboxEvent,
  renderSandboxValue,
  sandboxStatusMeta,
  type SandboxInputField,
  type SandboxNodeStatus,
  type SandboxOverlayCell,
  type SandboxRun
} from '../sandboxModel'

defineOptions({ name: 'WorkflowSandboxPanel' })

const props = defineProps<{ dsl: EditorDsl }>()
const emit = defineEmits<{
  (e: 'overlay', value: Record<string, SandboxOverlayCell>): void
}>()

const message = useMessage()

type FieldWithValue = SandboxInputField & { value: string }

const advanced = ref(false)
const fields = ref<FieldWithValue[]>(
  buildSandboxInputFields(props.dsl).map((f) => ({ ...f, value: f.initial }))
)
const jsonText = ref('{}')
const jsonError = ref('')

const run = ref<SandboxRun>(createSandboxRun(props.dsl))
const running = ref(false)
const runError = ref('')
const expanded = ref<string | null>(null)
let ctrl: AbortController | null = null

const canRun = computed(() => (props.dsl.nodes ?? []).length > 0)
const meta = (status: SandboxNodeStatus) => sandboxStatusMeta(status)
const render = (v: any) => renderSandboxValue(v)

const interruptNodeName = computed(
  () => run.value.rows.find((r) => r.nodeId === run.value.interruptNodeId)?.name ?? '人工节点'
)
const finalOutput = computed(() => {
  const fs = run.value.finalState
  if (!fs) return ''
  return 'output' in fs ? fs.output : fs
})

const isTerminal = (status: string) =>
  status === 'done' || status === 'failed' || status === 'interrupted'

const emitOverlay = () => emit('overlay', buildSandboxOverlay(run.value))

const toggleRow = (nodeId: string) => {
  expanded.value = expanded.value === nodeId ? null : nodeId
}

/** 切到高级模式：用当前表单值填 JSON；切回：尝试把 JSON 回填表单 */
const onToggleAdvanced = (val: any) => {
  if (val) {
    jsonText.value = JSON.stringify(collectSandboxInput(fields.value), null, 2)
    jsonError.value = ''
  } else {
    const r = parseSandboxInputText(jsonText.value)
    if (r.ok) {
      for (const f of fields.value) {
        const v = r.value[f.key]
        f.value = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
      }
      jsonError.value = ''
    } else {
      jsonError.value = r.error
      advanced.value = true // 解析失败不让切回，留在高级模式让用户改
    }
  }
}

/** 汇总当前输入：返回 null 表示有校验错误、不发起运行 */
const resolveInput = (): Record<string, any> | null => {
  jsonError.value = ''
  if (advanced.value) {
    const r = parseSandboxInputText(jsonText.value)
    if (!r.ok) {
      jsonError.value = r.error
      return null
    }
    return r.value
  }
  const missing = fields.value.find((f) => f.required && !String(f.value ?? '').trim())
  if (missing) {
    message.warning(`请填写必填的测试输入「${missing.key}」`)
    return null
  }
  return collectSandboxInput(fields.value)
}

const handleRun = async () => {
  if (running.value) return
  const input = resolveInput()
  if (input === null) return

  // 每轮重置：重建行（全 wait）、清错误、清展开
  run.value = createSandboxRun(props.dsl, input)
  runError.value = ''
  expanded.value = null
  emitOverlay()

  running.value = true
  ctrl = new AbortController()
  const finish = () => {
    running.value = false
  }

  try {
    await AgentWorkflowApi.runSandboxStream(
      JSON.stringify(props.dsl),
      input,
      ctrl,
      // onMessage
      (event: any) => {
        let payload: any
        try {
          payload = JSON.parse(event.data)
        } catch {
          return // 心跳等非 JSON 行
        }
        if (payload.code !== 0) {
          runError.value = payload.msg || '沙箱启动失败'
          run.value.status = 'failed'
          run.value.error = runError.value
          emitOverlay()
          return
        }
        const data = payload.data as WorkflowEventVO
        reduceSandboxEvent(run.value, data)
        emitOverlay()
        // 失败节点自动展开，省得用户再去点
        if (data.type === 'ERROR') {
          const failed = run.value.rows.find((r) => r.status === 'fail')
          if (failed) expanded.value = failed.nodeId
        }
      },
      // onError：🔴 必须 throw，否则 fetchEventSource 会无限重连、反复真跑大模型计费
      (err: any) => {
        if (!isTerminal(run.value.status) && !ctrl?.signal.aborted) {
          runError.value = '连接中断，请重试'
        }
        finish()
        throw err
      },
      // onClose：服务端正常关流（DONE/ERROR/INTERRUPTED 后 sink 完成）
      () => {
        finish()
      }
    )
  } catch (e: any) {
    finish()
    if (!ctrl?.signal.aborted && !runError.value) {
      runError.value = e?.message || '沙箱运行失败'
    }
  }
}

const handleStop = () => {
  ctrl?.abort()
  running.value = false
}

onBeforeUnmount(() => {
  // 关抽屉即销毁：掐掉 SSE，否则它在后台继续真跑、继续计费
  ctrl?.abort()
})
</script>

<style lang="scss" scoped>
.sbx {
  display: flex;
  height: 100%;
  padding: 12px 14px;
  overflow-y: auto;
  flex-direction: column;
  gap: 12px;
}

.sbx__notice-body {
  margin-top: 2px;
  font-size: 12px;
  line-height: 18px;
}

.sbx__sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sbx__sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sbx__sec-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.sbx__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sbx__adv {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sbx__form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.sbx__field-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.sbx__req {
  color: var(--el-color-danger);
}

.sbx__field-hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--el-text-color-placeholder);
}

.sbx__json :deep(textarea) {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
  font-size: 12px;
}

.sbx__err {
  font-size: 12px;
  color: var(--el-color-danger);
}

.sbx__runbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sbx__dur {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sbx__banner {
  padding: 8px 12px;
}

.sbx__timeline {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sbx__row {
  position: relative;
  padding: 8px 10px;
  cursor: pointer;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
  transition: border-color 0.2s;
}

.sbx__row:hover {
  border-color: var(--el-border-color);
}

.sbx__row--open {
  border-color: var(--el-color-primary-light-5);
}

.sbx__dot {
  position: absolute;
  top: 13px;
  left: -1px;
  width: 4px;
  height: 20px;
  border-radius: 0 3px 3px 0;
}

.sbx__row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sbx__row-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sbx__row-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sbx__row-dur {
  margin-left: auto;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.sbx__row-type {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.sbx__row-caret {
  position: absolute;
  top: 10px;
  right: 8px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.sbx__row--open .sbx__row-caret {
  transform: rotate(90deg);
}

.sbx__detail {
  margin-top: 8px;
  padding-top: 8px;
  cursor: default;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.sbx__detail-block {
  margin-top: 6px;
}

.sbx__detail-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.sbx__detail-err {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--el-color-danger);
}

.sbx__pre {
  max-height: 200px;
  padding: 6px 8px;
  margin: 0;
  overflow: auto;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
}

.sbx__pre--final {
  max-height: 300px;
}
</style>
