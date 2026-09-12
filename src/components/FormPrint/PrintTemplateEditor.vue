<template>
  <div class="print-template-editor">
    <el-alert type="info" :closable="false" class="mb-12px">
      <template #title>
        用 <code>{字段}</code> 写占位符，打印时换成这条记录的值。占位符与超链接、条码、
        自定义按钮用的是同一套语法。<strong>右侧点一下即可插入</strong>——
        手打的话，一旦被编辑器的加粗、变色撕成两截（如
        <code>{n&lt;b&gt;o&lt;/b&gt;}</code>），它会原样印在单据上。
      </template>
    </el-alert>

    <!--
      引用了不存在的字段：这是本模块最典型的那类「配了但不生效，且不报错」——
      印出来只是一片空白。发布校验会拦一次，这里是即时反馈
    -->
    <el-alert
      v-if="invalidFields.length > 0"
      type="warning"
      :closable="false"
      class="mb-12px"
      :title="`模板引用了取不到值的字段：${invalidFields.join('、')}。这些位置会印成空白，且不会报错。发布时会被拦下`"
    />

    <div class="flex gap-12px items-start">
      <div class="flex-1 min-w-0">
        <Editor ref="editorRef" v-model="template" height="460px" />
      </div>

      <div class="w-240px flex-shrink-0">
        <div class="field-panel-title">点击插入占位符</div>
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索字段"
          size="small"
          class="mb-8px"
        />
        <el-scrollbar height="420px">
          <div v-if="filteredFields.length === 0" class="field-panel-empty">
            没有可用字段。请先在「表单设计」步骤放上控件，或在「数据绑定」里配好字段映射。
          </div>
          <div
            v-for="field in filteredFields"
            :key="field.key"
            class="field-panel-item"
            :title="`插入 ${placeholderOf(field.field)}`"
            @click="insertField(field.field)"
          >
            <div class="field-panel-item-title">{{ field.title }}</div>
            <div class="field-panel-item-code">{{ placeholderOf(field.field) }}</div>
          </div>
        </el-scrollbar>
      </div>
    </div>

    <div class="form-tip mt-8px">
      <strong>印不出来的两类东西</strong>：子表明细（它是多行数据，插进一个位置只能得到
      一串 <code>[object Object]</code>，发布会拦）；条码/二维码（<code>{字段}</code>
      是文本替换，印出来是那串数字本身而不是条码图形）。
      富文本字段印出来是它的 HTML 原文 —— 值一律做转义，否则记录里的
      <code>&lt;script&gt;</code> 会在打印预览里执行。
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 打印模板编辑器
 *
 * ## 为什么是「再建一套」而不是复用 bpm 的
 *
 * 设计方案 §6.6 写的是「表单属性绑定打印模板 ID」，暗示 bpm 已经有一个打印模板模块。
 * 摸下来不是这样：bpm 那边没有表、没有服务、没有接口，模板是一段 HTML 直接存在
 * 流程模型的 `printTemplateSetting` 里；编辑器（wangEditor 的 mention 插件）
 * 与渲染（bpm 专有的 `getProcessInstancePrintData`）两端都和流程语义绑死。
 *
 * ## 占位符用 `{字段}`，所以不需要 mention 插件
 *
 * bpm 的占位符是 wangEditor 的 mention 节点，要给编辑器写插件。本模块已经有三处
 * 在用 `{字段}`（超链接、条码、自定义按钮），复用它省掉了插件，也省掉了让用户
 * 在两种写法之间猜 —— 猜错的表现是「占位符原样印在单据上」，没有任何报错。
 *
 * 代价是占位符只是一段文本，可能被编辑器的富文本操作撕成两截。所以字段清单做成
 * 点击插入，而不是只给一份说明让人手打。
 */
import { Editor } from '@/components/Editor'
import type { EditorExpose } from '@/components/Editor'
import { collectTemplateFields } from '@/components/FormWidgets/printTemplate'

defineOptions({ name: 'PrintTemplateEditor' })

const props = defineProps<{
  /**
   * 可插入的字段
   *
   * 由调用方给，而不是本组件自己从表单规则里解析：能印出来的键取决于
   * 运行时那条 SELECT 查了哪些列（表单字段 + 主键 + 审计列 + 关联/副表列），
   * 那份知识在「列表设计」步骤里已经有了（`mainFields`），
   * 再解析一遍必然与它漂移 —— 而漂移的表现是「清单里有、印出来是空的」。
   */
  fields: Array<{ key: string; field: string; title: string }>
}>()

const template = defineModel<string | undefined>({ required: true })

const editorRef = ref<EditorExpose>()
const keyword = ref('')

/**
 * 字段名 → 占位符文本
 *
 * ⚠️ 必须在 script 里拼，不能写成模板里的 `{{ `{${field.field}}` }}` ——
 * Vue 的模板编译器在插值里遇到第一个 `}` 就认为插值结束，
 * 报的是 `Error parsing JavaScript expression: Unexpected token, expected "}"`，
 * 而且是**编译期**错误：整个设计器页面白屏，不只是这一个页签。
 * 这个坑是 e2e 抓到的。
 */
const placeholderOf = (field: string) => `{${field}}`

const filteredFields = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.fields
  return props.fields.filter(
    (f) => f.field.toLowerCase().includes(kw) || (f.title ?? '').toLowerCase().includes(kw)
  )
})

/**
 * 模板里引用了、但清单里没有的字段
 *
 * 与服务端 `PrintTemplate.collectFields` 用同一条正则（`collectTemplateFields`
 * 是那一份的前端副本），两处必须一致 —— 不一致的表现是「这里说没问题、发布被拒」，
 * 或者反过来发布通过而单据上一片空白。
 */
const invalidFields = computed(() => {
  const known = new Set(props.fields.map((f) => f.field))
  return collectTemplateFields(template.value).filter((f) => !known.has(f))
})

/**
 * 在光标处插入一个占位符
 *
 * 用编辑器的 `insertText` 而不是往 v-model 的字符串上拼：拼字符串只能追加到末尾，
 * 而用户想插的位置是他刚点的那一格。
 *
 * ⚠️ 两条分支都必须有。点字段按钮会让编辑器失焦，`restoreSelection()` 把光标放回去；
 * 但编辑器从没被点过时它根本没有选区，那时候 `insertText` 会静默什么都不做 ——
 * 表现是「刚打开模板页，点字段没反应，点一下正文再点就好了」，
 * 而用户不会发现这个前提。`focus(true)` 把光标落到末尾。
 */
const insertField = async (field: string) => {
  const editor = await editorRef.value?.getEditorRef()
  if (!editor) return
  if (editor.selection) {
    editor.restoreSelection()
  } else {
    editor.focus(true)
  }
  editor.insertText(`{${field}}`)
}
</script>

<style lang="scss" scoped>
.field-panel-title {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: bold;
  color: var(--el-text-color-primary);
}

.field-panel-empty {
  padding: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.field-panel-item {
  padding: 6px 8px;
  cursor: pointer;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  margin-bottom: 6px;

  &:hover {
    border-color: var(--el-color-primary);
    background-color: var(--el-color-primary-light-9);
  }
}

.field-panel-item-title {
  font-size: 13px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-panel-item-code {
  font-family: monospace;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.form-tip {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
</style>
