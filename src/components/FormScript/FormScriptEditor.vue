<template>
  <div class="form-script-editor">
    <!-- 扩展模式：互斥三选一 -->
    <el-form label-width="90px" size="small" class="mb-12px">
      <el-form-item label="扩展方式">
        <el-radio-group v-model="extensionMode">
          <el-radio-button :value="0">无</el-radio-button>
          <el-radio-button :value="1">前端脚本</el-radio-button>
          <el-radio-button :value="2">服务端扩展点</el-radio-button>
        </el-radio-group>
        <div class="form-tip">
          声明式联动规则始终生效；这里选的是它之外的扩展方式，两者互斥，同一表单只有一种执行。
          切换模式不会删除另一种的配置，只是不执行 —— 可以来回切着对比。
        </div>
      </el-form-item>
    </el-form>

    <!-- 第二道模式错配告警：有服务端扩展点实现，但模式不是它 -->
    <el-alert
      v-if="showMismatchWarning"
      type="warning"
      :closable="false"
      class="mb-12px"
      show-icon
    >
      <template #title>
        这张表单有服务端扩展点实现（{{ serverExtensionNames.join('、') }}），但当前扩展方式不是「服务端扩展点」，它们不会被执行
      </template>
      <template #default>
        <el-button type="primary" size="small" class="mt-6px" @click="extensionMode = 2">
          切换为服务端扩展点
        </el-button>
      </template>
    </el-alert>

    <!-- 服务端扩展点模式 -->
    <template v-if="extensionMode === 2">
      <el-alert v-if="!hasServerExtension" type="error" :closable="false" show-icon class="mb-12px">
        <template #title>
          还没有找到 formCode 为「{{ formCode }}」的 FormDesignExtension 实现，发布时会被拒绝
        </template>
      </el-alert>
      <el-alert v-else type="success" :closable="false" show-icon class="mb-12px">
        <template #title>
          已接入服务端扩展点：{{ serverExtensionNames.join('、') }}
        </template>
      </el-alert>
      <div class="mode-hint">
        服务端扩展点在后端 Java 代码里实现，不在这里编辑。
        实现 <code>FormDesignExtension</code> 接口、让 <code>formCode()</code> 返回
        <code>{{ formCode }}</code>，并注册为 Spring Bean 即可。
      </div>
    </template>

    <!-- 前端脚本模式 -->
    <template v-else-if="extensionMode === 1">
      <el-alert type="info" :closable="false" class="mb-12px">
        <template #title>
          脚本在受限沙箱里执行：<b>没有任何后端调用能力</b>，也取不到 window、fetch 等全局对象。
          需要查库、调外部系统的逻辑请改用「服务端扩展点」。
        </template>
      </el-alert>

      <el-form label-width="90px" size="small" class="mb-12px">
        <el-form-item label="提交钩子超时">
          <el-radio-group v-model="timeoutAction">
            <el-radio-button :value="1">阻断提交</el-radio-button>
            <el-radio-button :value="2">放行</el-radio-button>
          </el-radio-group>
          <div class="form-tip">
            beforeSubmit 超过 10 秒未完成时的处理。默认阻断 ——
            超时意味着校验没跑完，放行等于静默跳过校验
          </div>
        </el-form-item>
      </el-form>

      <el-tabs v-model="activeHook" type="border-card">
        <el-tab-pane v-for="hook in HOOKS" :key="hook.key" :name="hook.key">
          <template #label>
            <span>
              {{ hook.label }}
              <el-badge v-if="issueCountOf(hook.key) > 0" :value="issueCountOf(hook.key)" type="danger" />
            </span>
          </template>

          <div class="hook-desc">{{ hook.desc }}</div>

          <el-input
            v-model="scripts[hook.key]"
            type="textarea"
            :rows="12"
            :placeholder="hook.placeholder"
            class="script-input"
            @input="runCheck"
          />

          <!-- 静态检查结果 -->
          <div v-if="issuesOf(hook.key).length > 0" class="issue-list">
            <div class="issue-title">
              <Icon icon="ep:warning-filled" class="mr-4px" />
              以下写法不被允许，保存会被拒绝
            </div>
            <div v-for="(issue, idx) in issuesOf(hook.key)" :key="idx" class="issue-item">
              <span class="issue-line">第 {{ issue.line }} 行</span>
              <code class="issue-pattern">{{ issue.pattern }}</code>
              <span class="issue-reason">{{ issue.reason }}</span>
              <div v-if="issue.lineText" class="issue-code">{{ issue.lineText }}</div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>

      <div class="api-hint">
        <div class="api-hint-title">可用的上下文（直接当变量用，无需声明）</div>
        <code>
          formData · setFieldValue(field, v) · getFieldValue(field) · setVisible(field, bool) ·
          setRequired(field, bool) · setDisabled(field, bool) ·
          message.success/warning/error/confirm · utils.formatDate/formatMoney/uuid
        </code>
      </div>
    </template>

    <div v-else class="mode-hint">只使用声明式联动规则，不启用额外的扩展方式。</div>
  </div>
</template>

<script lang="ts" setup>
import { checkScript, type ScriptCheckIssue } from './staticCheck'

defineOptions({ name: 'FormScriptEditor' })

/**
 * 前端脚本编辑器
 *
 * 静态检查的结果直接显示在编辑框下面并带行号 —— 保存时才报错的话，
 * 用户得自己回来找是哪一行。
 */
const props = defineProps<{
  /** 表单编码，用于服务端扩展点的提示文案 */
  formCode?: string
  /** 该表单是否存在服务端扩展点实现 */
  hasServerExtension?: boolean
  /** 服务端扩展点实现类名 */
  serverExtensionNames?: string[]
}>()

const extensionMode = defineModel<number>('extensionMode', { default: 1 })
const timeoutAction = defineModel<number>('timeoutAction', { default: 1 })
/** 脚本内容：钩子名 → 脚本文本 */
const scripts = defineModel<Record<string, string>>('scripts', { default: () => ({}) })

const serverExtensionNames = computed(() => props.serverExtensionNames ?? [])
const hasServerExtension = computed(() => !!props.hasServerExtension)

/**
 * 第二道模式错配告警的触发条件
 *
 * 有实现、但模式不是服务端扩展点。这是默认模式为「前端脚本」带来的陷阱：
 * 开发者写好扩展点部署上去，因为表单没切模式而静默不执行、且不报错
 */
const showMismatchWarning = computed(() => hasServerExtension.value && extensionMode.value !== 2)

const HOOKS = [
  {
    key: 'onLoad',
    label: '表单加载',
    desc: '表单打开、数据填充完成后执行一次。适合做初始的显隐与提示。',
    placeholder: "if (formData.type === 'A') {\n  setVisible('detail', true)\n}"
  },
  {
    key: 'onFieldChange',
    label: '字段变化',
    desc: '任一字段的值发生变化时执行。changedField 是变化的字段名。',
    placeholder: "if (changedField === 'amount' && formData.amount > 10000) {\n  setRequired('reason', true)\n}"
  },
  {
    key: 'beforeSubmit',
    label: '提交前',
    desc: '提交前执行。返回 false 或 reject 会阻断提交；可以用 message.confirm 做二次确认。',
    placeholder:
      "if (formData.amount > 100000) {\n  return message.confirm('金额较大，确认提交？')\n}\nreturn true"
  },
  {
    key: 'afterSubmit',
    label: '提交后',
    desc: '提交成功后执行。适合做提示。',
    placeholder: "message.success('提交成功')"
  }
] as const

const activeHook = ref<string>(HOOKS[0].key)

/** 各钩子的静态检查结果 */
const issues = ref<Record<string, ScriptCheckIssue[]>>({})

const runCheck = () => {
  const next: Record<string, ScriptCheckIssue[]> = {}
  for (const hook of HOOKS) {
    const result = checkScript(scripts.value[hook.key])
    if (!result.passed) next[hook.key] = result.issues
  }
  issues.value = next
}

const issuesOf = (hook: string) => issues.value[hook] ?? []
const issueCountOf = (hook: string) => issuesOf(hook).length

/** 是否有任何静态检查问题。父组件保存前调它 */
const hasIssues = () => Object.keys(issues.value).length > 0

/** 全部问题的扁平清单，供保存时汇总提示 */
const allIssues = () =>
  Object.entries(issues.value).flatMap(([hook, list]) =>
    list.map((i) => `${hook} 第 ${i.line} 行：${i.pattern} —— ${i.reason}`)
  )

watch(() => scripts.value, runCheck, { deep: true, immediate: true })

defineExpose({ hasIssues, allIssues, runCheck })
</script>

<style lang="scss" scoped>
.form-tip {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.mode-hint {
  padding: 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-lighter);
  border-radius: 4px;

  code {
    padding: 1px 5px;
    background: var(--el-fill-color);
    border-radius: 3px;
  }
}

.hook-desc {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.script-input :deep(.el-textarea__inner) {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.issue-list {
  padding: 10px;
  margin-top: 10px;
  background: var(--el-color-danger-light-9);
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: 4px;
}

.issue-title {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-danger);
}

.issue-item {
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.6;

  &:last-child {
    margin-bottom: 0;
  }
}

.issue-line {
  margin-right: 6px;
  font-weight: 600;
}

.issue-pattern {
  padding: 1px 5px;
  margin-right: 6px;
  background: var(--el-fill-color);
  border-radius: 3px;
}

.issue-reason {
  color: var(--el-text-color-regular);
}

.issue-code {
  padding: 4px 8px;
  margin-top: 4px;
  font-family: Consolas, Monaco, monospace;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border-radius: 3px;
}

.api-hint {
  padding: 10px;
  margin-top: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;

  code {
    font-size: 12px;
    line-height: 1.8;
    color: var(--el-text-color-regular);
    word-break: break-all;
  }
}

.api-hint-title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
}
</style>
