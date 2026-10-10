<template>
  <Dialog
    :title="dialogTitle"
    v-model="dialogVisible"
    width="760px"
    :scroll="true"
    max-height="540px"
  >
    <!-- 测试中 -->
    <div v-if="testing" class="flex flex-col items-center gap-10px py-24px">
      <Icon icon="ep:loading" :size="26" class="is-loading text-[var(--el-color-primary)]" />
      <span class="text-14px"
        >测试中…（已耗时 {{ elapsed }} 秒，最多等 {{ timeoutSeconds }} 秒）</span
      >
      <span class="text-12px text-[var(--el-text-color-secondary)]">
        正在向厂商发一次真实的最小对话请求，会消耗少量 token
      </span>
    </div>

    <!-- 结果 -->
    <div v-else-if="result" class="flex flex-col gap-12px">
      <el-alert
        v-if="result.success"
        type="success"
        :closable="false"
        show-icon
        :title="`模型可用${durationText}`"
      />
      <el-alert
        v-else-if="result.timedOut"
        type="warning"
        :closable="false"
        show-icon
        title="测试超时"
        :description="result.errorMsg"
      />
      <el-alert
        v-else
        type="error"
        :closable="false"
        show-icon
        :title="`模型不可用${durationText}`"
      />

      <!-- 厂商原文：逐字展示，不做任何加工，也不在前端二次截断。
           超时除外：那时 errorMsg 是本系统自己写的超时说明，不是厂商说的话，
           挂在「厂商原始响应」标题下等于把我们的话冒充成厂商原文 -->
      <div v-if="!result.success && !result.timedOut && result.errorMsg">
        <div class="mte__label">厂商原始响应（逐字）</div>
        <pre class="mte__pre">{{ result.errorMsg }}</pre>
      </div>

      <!-- 成功时的回复片段与 token 用量 -->
      <div v-if="result.success">
        <div class="mte__label">
          回复片段
          <span v-if="tokenText" class="mte__tokens">{{ tokenText }}</span>
        </div>
        <pre class="mte__pre">{{ result.reply }}</pre>
      </div>

      <!-- 事实表：multiModel 与两个 status 正是排查 url error 时最需要的三格 -->
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="所属平台">{{ result.platform || '-' }}</el-descriptions-item>
        <el-descriptions-item label="模型标识">{{ result.model || '-' }}</el-descriptions-item>
        <el-descriptions-item label="端点路由">{{ multiModelText }}</el-descriptions-item>
        <!-- A3：思考模式是配置驱动的第三档判定，不回显就只能靠猜「改了配置到底生效没有」 -->
        <el-descriptions-item label="思考模式">{{ thinkingText }}</el-descriptions-item>
        <el-descriptions-item label="耗时">
          {{ result.durationMs != null ? `${(result.durationMs / 1000).toFixed(1)}s` : '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="模型状态">
          <dict-tag
            v-if="result.modelStatus != null"
            :type="DICT_TYPE.COMMON_STATUS"
            :value="result.modelStatus"
          />
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="密钥状态">
          <dict-tag
            v-if="result.keyStatus != null"
            :type="DICT_TYPE.COMMON_STATUS"
            :value="result.keyStatus"
          />
          <span v-else>-</span>
        </el-descriptions-item>
      </el-descriptions>

      <!-- 只有失败时才解释分型：成功时这几句是噪音 -->
      <div v-if="!result.success && failureReasonText" class="mte__hint">
        分型（本系统的判断，不是厂商的说法）：{{ failureReasonText }}
      </div>
    </div>

    <!-- 兜底：既不在测、也没有结果（请求本身被 axios 拦截器抛掉了） -->
    <el-alert
      v-else-if="requestError"
      type="error"
      :closable="false"
      show-icon
      title="测试请求未能完成"
      :description="requestError"
    />

    <template #footer>
      <div class="flex items-center justify-end gap-8px">
        <span class="text-12px text-[var(--el-text-color-secondary)]">超时</span>
        <el-input-number
          v-model="timeoutSeconds"
          :min="5"
          :max="120"
          :step="5"
          size="small"
          class="!w-110px"
          :disabled="testing"
        />
        <span class="text-12px text-[var(--el-text-color-secondary)]">秒</span>
        <el-button type="primary" :loading="testing" @click="runTest">
          {{ result || requestError ? '重新测试' : '开始测试' }}
        </el-button>
        <el-button @click="dialogVisible = false">关 闭</el-button>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ModelApi, ModelTestVO, ModelVO } from '@/api/ai/model/model'
import { DICT_TYPE } from '@/utils/dict'

/**
 * AI 模型可用性测试弹窗
 *
 * 请求由本组件发起（而不是列表页的行按钮），为的是能在弹窗里显示「已耗时 N 秒」——
 * 让行按钮干转 30 秒，管理员分不清是慢还是挂了。
 */
defineOptions({ name: 'ModelTestDialog' })

/** testing 状态往外抛，让列表页解开对应行按钮的 loading */
const emit = defineEmits<{ testing: [boolean] }>()

const dialogVisible = ref(false)
const testing = ref(false)
const elapsed = ref(0)
const timeoutSeconds = ref(30)
const result = ref<ModelTestVO>()
const requestError = ref('')
const currentModel = ref<ModelVO>()
let timer: ReturnType<typeof setInterval> | undefined

const dialogTitle = computed(() =>
  currentModel.value ? `模型可用性测试 - ${currentModel.value.name}` : '模型可用性测试'
)

const durationText = computed(() => {
  const ms = result.value?.durationMs
  return ms != null ? `（耗时 ${(ms / 1000).toFixed(1)}s）` : ''
})

const tokenText = computed(() => {
  const { promptTokens, completionTokens } = result.value || {}
  if (promptTokens == null && completionTokens == null) {
    return ''
  }
  return `token：输入 ${promptTokens ?? '-'} / 输出 ${completionTokens ?? '-'}`
})

const multiModelText = computed(() => {
  // null 与 false 必须分开：false 是「已确认走文本端点」，null 是「这个平台没有端点分档」。
  // 把 null 显示成 false，等于替厂商编了一个它没说过的结论
  const value = result.value?.multiModel
  if (value === null || value === undefined) {
    return '不适用（非通义平台）'
  }
  return value ? '多模态端点' : '文本端点'
})

const thinkingText = computed(() => {
  // 同 multiModelText 的口径：null 是「这个平台没有思考模式这档」，不能显示成「关」
  const value = result.value?.enableThinking
  if (value === null || value === undefined) {
    return '不适用（非通义平台）'
  }
  return value ? '开' : '关'
})

const failureReasonText = computed(() => {
  if (result.value?.failureReason === 'QUOTA') {
    return '额度类（QUOTA）：生产链遇到它时判本次调用失败、不切换候选，并冷却 30 分钟'
  }
  if (result.value?.failureReason === 'CONFIG') {
    return (
      '配置类（CONFIG）：生产链遇到它时会切到下一个候选，并对本模型冷却 30 分钟；' +
      '改好配置或禁用再启用一次即可立刻解除冷却'
    )
  }
  if (result.value?.failureReason === 'TRANSIENT') {
    return '瞬时类（TRANSIENT）：生产链遇到它时会切到下一个候选，并对本模型冷却 60 秒'
  }
  return ''
})

const stopTimer = () => {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}

/** 打开弹窗：立即测一次，不让管理员再点一下「开始测试」 */
const open = (model: ModelVO) => {
  currentModel.value = model
  result.value = undefined
  requestError.value = ''
  elapsed.value = 0
  dialogVisible.value = true
  runTest()
}
defineExpose({ open })

const runTest = async () => {
  if (!currentModel.value || testing.value) {
    return
  }
  testing.value = true
  emit('testing', true)
  result.value = undefined
  requestError.value = ''
  elapsed.value = 0
  stopTimer()
  timer = setInterval(() => elapsed.value++, 1000)
  try {
    // 后端失败时不抛异常，而是回 success=false + 明细，所以这里拿到的就是结论本身
    result.value = await ModelApi.testModel(currentModel.value.id, timeoutSeconds.value)
  } catch (error: any) {
    // 走到这里说明连结构化结论都没拿到（网络断了、或前端超时早于后端硬超时）
    requestError.value = error?.message || String(error)
  } finally {
    stopTimer()
    testing.value = false
    emit('testing', false)
  }
}

// 关弹窗时若还在测，行按钮的 loading 必须解开 —— 否则那一行会一直转下去
watch(dialogVisible, (visible) => {
  if (!visible) {
    stopTimer()
    if (testing.value) {
      testing.value = false
      emit('testing', false)
    }
  }
})

onUnmounted(stopTimer)
</script>

<style lang="scss" scoped>
.mte__label {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.mte__tokens {
  margin-left: 8px;
}

.mte__pre {
  max-height: 180px;
  padding: 8px 10px;
  margin: 0;
  overflow: auto;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  word-break: break-all;
  white-space: pre-wrap;
  background-color: var(--el-fill-color-light);
  border-radius: 4px;
  user-select: text;
}

.mte__hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
