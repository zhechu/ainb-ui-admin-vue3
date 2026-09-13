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
        </el-tab-pane>

        <!--
          编辑器放在 el-tabs 外层而不是每个 tab-pane 里：Monaco 的补全提供器是
          按语言全局注册的，四个 pane 各开一个实例会互相顶掉补全数据。
          切页签只换内容，实例始终只有一个。
        -->
        <div class="hook-desc">{{ currentHook.desc }}</div>

        <div ref="layoutRef" class="script-layout" :style="{ height: layoutHeight }">
          <div class="script-main">
            <CodeEditor
              ref="codeEditorRef"
              v-model="currentScript"
              language="javascript"
              :js-context="jsContext"
              :height="editorHeight"
              :placeholder="currentHook.placeholder"
              @change="handleScriptChange"
            />

            <!-- 静态检查结果 -->
            <div v-if="issuesOf(activeHook).length > 0" class="issue-list">
              <div class="issue-title">
                <Icon icon="ep:warning-filled" class="mr-4px" />
                以下写法不被允许，保存会被拒绝
              </div>
              <div v-for="(issue, idx) in issuesOf(activeHook)" :key="idx" class="issue-item">
                <span class="issue-line">第 {{ issue.line }} 行</span>
                <code class="issue-pattern">{{ issue.pattern }}</code>
                <span class="issue-reason">{{ issue.reason }}</span>
                <div v-if="issue.lineText" class="issue-code">{{ issue.lineText }}</div>
              </div>
            </div>
          </div>

          <!--
            右侧速查区。点一下就插到光标处 ——
            字段名靠记或者来回切步骤查，是这个编辑器最耗时的一件事
          -->
          <div class="script-aside">
            <el-tabs v-model="asideTab" class="aside-tabs">
              <el-tab-pane :label="`字段 (${fieldItems.length})`" name="fields">
                <el-input
                  v-model="fieldKeyword"
                  size="small"
                  clearable
                  placeholder="搜字段名或标题"
                  class="mb-6px"
                />
                <div v-if="filteredFields.length === 0" class="aside-empty">
                  {{ fieldItems.length === 0 ? '表单里还没有字段' : '没有匹配的字段' }}
                </div>
                <div
                  v-for="f in filteredFields"
                  :key="f.name"
                  class="aside-item"
                  :title="`点击插入 formData.${f.name}`"
                  @click="insert(`formData.${f.name}`)"
                >
                  <div class="aside-item-name">{{ f.name }}</div>
                  <div v-if="f.title" class="aside-item-desc">{{ f.title }}</div>
                </div>
              </el-tab-pane>

              <el-tab-pane label="接口" name="apis">
                <div
                  v-for="api in API_ITEMS"
                  :key="api.name"
                  class="aside-item"
                  :title="`点击插入 ${api.insert ?? api.name}`"
                  @click="insert(api.insert ?? api.name)"
                >
                  <div class="aside-item-name">{{ api.name }}</div>
                  <div class="aside-item-desc">{{ api.doc }}</div>
                </div>
              </el-tab-pane>
            </el-tabs>
          </div>
        </div>
      </el-tabs>
    </template>

    <div v-else class="mode-hint">只使用声明式联动规则，不启用额外的扩展方式。</div>
  </div>
</template>

<script lang="ts" setup>
import { checkScript, type ScriptCheckIssue } from './staticCheck'
import { CodeEditor } from '@/components/CodeEditor'

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
  /** 可用字段，供速查面板与代码补全使用 */
  fieldOptions?: Array<{ label: string; value: string }>
}>()

const extensionMode = defineModel<number>('extensionMode', { default: 1 })
const timeoutAction = defineModel<number>('timeoutAction', { default: 1 })
/** 脚本内容：钩子名 → 脚本文本 */
const scripts = defineModel<Record<string, string>>('scripts', { default: () => ({}) })

/**
 * 脚本的本地副本
 *
 * ⚠️ 不能直接 v-model="scripts[hook.key]"。上游 StepLogic 把 scripts 做成了
 * 「get 时 JSON.parse、set 时 JSON.stringify」的 computed，就地改对象的某个键
 * **不会触发 setter**，写的脚本便回不到 modelData.formScript —— 保存后全丢。
 * 所以改动经本地副本承接，再由 emitScripts() 整体赋值写回。
 */
const localScripts = ref<Record<string, string>>({})

watch(
  scripts,
  (value) => {
    localScripts.value = { ...(value ?? {}) }
  },
  { immediate: true, deep: true }
)

const emitScripts = () => {
  scripts.value = { ...localScripts.value }
}

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

const currentHook = computed(
  () => HOOKS.find((h) => h.key === activeHook.value) ?? HOOKS[0]
)

/** 当前页签对应的脚本正文。切页签只换内容，编辑器实例始终只有一个 */
const currentScript = computed<string>({
  get: () => localScripts.value[activeHook.value] ?? '',
  set: (v) => {
    localScripts.value = { ...localScripts.value, [activeHook.value]: v }
  }
})

const codeEditorRef = ref()
const layoutRef = ref<HTMLElement>()

/**
 * 编辑器高度跟着浏览器走
 *
 * 原先按固定行数算（14~30 行），高度与视口无关：屏幕高一点，编辑器下面就空一大片；
 * 屏幕矮一点又会顶出可视区。脚本面板是这一步的主体，理应把剩下的空间都吃掉。
 *
 * 取「本容器距视口顶部的距离」而不是硬编码上方各块的高度 —— 上方的内容是会变的
 * （扩展方式切换、服务端扩展点错配告警出现时会多一条），写死必然对不上。
 */
const BOTTOM_GAP = 24
const MIN_HEIGHT = 240
const layoutHeight = ref(`${MIN_HEIGHT}px`)
const editorHeight = computed(() => layoutHeight.value)

const recalcHeight = () => {
  const el = layoutRef.value
  if (!el) return
  const top = el.getBoundingClientRect().top
  layoutHeight.value = `${Math.max(MIN_HEIGHT, window.innerHeight - top - BOTTOM_GAP)}px`
}

let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  nextTick(recalcHeight)
  window.addEventListener('resize', recalcHeight)
  // 上方内容的高度会变（告警条出现/消失、扩展方式切换），
  // 只监听 window.resize 的话这些情况下高度不会跟着调整
  if (typeof ResizeObserver !== 'undefined' && layoutRef.value?.parentElement) {
    resizeObserver = new ResizeObserver(() => recalcHeight())
    resizeObserver.observe(layoutRef.value.parentElement)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', recalcHeight)
  resizeObserver?.disconnect()
})

// 切到「前端脚本」模式时容器才挂上，要等渲染完再量
watch(extensionMode, () => nextTick(recalcHeight))
const asideTab = ref('fields')
const fieldKeyword = ref('')

/**
 * 可用字段
 *
 * 上游传来的是 `{ label: '金额（amount）', value: 'amount' }`，
 * 这里把标题从 label 里剥出来单独展示 —— 速查面板要的是「字段名 + 它是什么」，
 * 挤在一行里眼睛扫不动。
 */
const fieldItems = computed(() =>
  (props.fieldOptions ?? []).map((opt) => {
    const title = opt.label.replace(new RegExp(`（${opt.value}）$`), '')
    return { name: opt.value, title: title === opt.value ? '' : title }
  })
)

const filteredFields = computed(() => {
  const kw = fieldKeyword.value.trim().toLowerCase()
  if (!kw) return fieldItems.value
  return fieldItems.value.filter(
    (f) => f.name.toLowerCase().includes(kw) || (f.title ?? '').toLowerCase().includes(kw)
  )
})

/**
 * 沙箱注入的 API 清单
 *
 * ⚠️ 必须与 sandbox.ts 的 `SandboxContext` 保持一致。这里多写一个沙箱里没有的名字，
 * 用户照着补全写出来的脚本会在运行时拿到 undefined —— 而沙箱的代理对未白名单标识符
 * 返回的就是 undefined，不会报错，属于静默失效。
 */
const API_ITEMS = [
  { name: 'formData', doc: '表单数据的只读快照', detail: 'Record<string, any>' },
  { name: 'changedField', doc: '本次变化的字段名，仅「字段变化」钩子有值', detail: 'string' },
  {
    name: 'setFieldValue',
    doc: '给字段赋值',
    detail: '(field, value) => void',
    insert: "setFieldValue('', )"
  },
  { name: 'getFieldValue', doc: '读字段值', detail: '(field) => any', insert: "getFieldValue('')" },
  {
    name: 'setVisible',
    doc: '显示或隐藏字段',
    detail: '(field, visible) => void',
    insert: "setVisible('', true)"
  },
  {
    name: 'setRequired',
    doc: '设为必填或非必填',
    detail: '(field, required) => void',
    insert: "setRequired('', true)"
  },
  {
    name: 'setDisabled',
    doc: '禁用或启用字段',
    detail: '(field, disabled) => void',
    insert: "setDisabled('', true)"
  },
  { name: 'message.success', doc: '成功提示', insert: "message.success('')" },
  { name: 'message.warning', doc: '警告提示', insert: "message.warning('')" },
  { name: 'message.error', doc: '错误提示', insert: "message.error('')" },
  {
    name: 'message.confirm',
    doc: '二次确认，返回 Promise<boolean>，「提交前」钩子里常用',
    insert: "message.confirm('')"
  },
  { name: 'utils.formatDate', doc: '格式化日期', insert: "utils.formatDate('')" },
  { name: 'utils.formatMoney', doc: '格式化金额', insert: "utils.formatMoney('')" },
  { name: 'utils.uuid', doc: '生成 uuid', insert: 'utils.uuid()' },
  {
    name: 'callDataInterface',
    doc: '调用已登记的数据接口取数（只读）。返回 Promise，只有「提交前」钩子能 await',
    detail: '(code, args) => Promise<any>',
    insert: "await callDataInterface('', {})"
  }
]

/** 传给 Monaco 的补全上下文 */
const jsContext = computed(() => ({
  fields: fieldItems.value,
  apis: API_ITEMS.map((a) => ({
    name: a.name,
    detail: a.detail ?? '',
    doc: a.doc,
    insert: a.insert
  }))
}))

/** 把文本插到编辑器光标处 */
const insert = (text: string) => {
  codeEditorRef.value?.insertText?.(text)
}

/**
 * 编辑器内容变化
 *
 * CodeEditor 是每次按键就 emit，所以静态检查跟得上；写回 model 也一并做了 ——
 * Monaco 没有「失焦」这个天然节点，再等 change 就可能丢最后一次输入
 */
const handleScriptChange = () => {
  runCheck()
  emitScripts()
}

/** 各钩子的静态检查结果 */
const issues = ref<Record<string, ScriptCheckIssue[]>>({})

const runCheck = () => {
  const next: Record<string, ScriptCheckIssue[]> = {}
  for (const hook of HOOKS) {
    // 读本地副本：静态检查要跟着每次按键走，而写回 model 是失焦才做的
    // 只有 beforeSubmit 编译成 async，别的钩子里写 await 要当场报出来，
    // 否则用户拿到的是一句 Unexpected reserved word，看不出是钩子的限制
    const result = checkScript(localScripts.value[hook.key], {
      allowAwait: hook.key === 'beforeSubmit'
    })
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

watch(() => localScripts.value, runCheck, { deep: true, immediate: true })

defineExpose({ hasIssues, allIssues, runCheck, flush: emitScripts })
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

/*
  左编辑器 + 右速查区

  速查区定宽、编辑器吃掉剩余空间。宽度用 flex 三值而不是 UnoCSS 的 w-XXXpx——
  理由见 tests/e2e/form-design-editor-layout.spec.ts
*/

/*
  高度由 JS 按视口算出来写在行内 style 上（见 recalcHeight）。
  align-items 用 stretch 而不是 flex-start：右侧速查区要跟编辑器一样高，
  否则它停在内容高度，旁边空一条，看着像没对齐
*/
.script-layout {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.script-main {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
}

.script-main :deep(.code-editor) {
  flex: 1 1 auto;
  min-height: 0;
}

.script-aside {
  display: flex;
  flex: 0 0 220px;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.aside-tabs {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
}

/* 列表跟着面板一起长高，长过头就自己滚，不要把整页撑出滚动条 */
.aside-tabs :deep(.el-tabs__content) {
  flex: 1 1 auto;
  min-height: 0;
  padding: 8px;
  overflow-y: auto;
}

.aside-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.aside-empty {
  padding: 12px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.aside-item {
  padding: 5px 6px;
  cursor: pointer;
  border-radius: 3px;

  &:hover {
    background: var(--el-fill-color-light);
  }
}

.aside-item-name {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  color: var(--el-color-primary);
  word-break: break-all;
}

.aside-item-desc {
  margin-top: 1px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
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
