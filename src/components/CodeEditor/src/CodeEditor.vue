<template>
  <div ref="editorContainer" class="code-editor"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useVModel } from '@vueuse/core'
import monaco from '@/utils/monaco'
import type * as Monaco from 'monaco-editor'

defineOptions({ name: 'CodeEditor' })

interface CodeEditorProps {
  modelValue: string
  /**
   * 语言。取值必须是 Monaco 的语言 ID
   *
   * xml 与 plaintext 是给「数据接口」的请求体编辑器用的（JSON / XML / raw 三种体裁）。
   * 注意 raw 对应的 ID 是 plaintext 而不是 text —— Monaco 没有 text 这个语言，
   * 传 text 拿不到任何高亮，也不会报错，属于静默失效。
   */
  language?: 'sql' | 'javascript' | 'json' | 'xml' | 'plaintext'
  theme?: 'light' | 'dark'
  readonly?: boolean
  height?: string
  placeholder?: string
  /** 最小行数，启用动态高度时有效 */
  minLines?: number
  /** 最大行数，启用动态高度时有效 */
  maxLines?: number
  /** SQL 自动补全的表和字段信息 */
  sqlSchema?: SqlSchemaInfo
  /** JavaScript 自动补全的上下文（表单字段 + 可用 API） */
  jsContext?: JsContextInfo
}

export interface SqlSchemaInfo {
  tables: Array<{
    name: string
    comment?: string
    columns: Array<{
      name: string
      comment?: string
      type?: string
    }>
  }>
}

/**
 * JavaScript 补全上下文
 *
 * 给「表单脚本」这类跑在受控沙箱里的代码用：沙箱里能拿到的东西是一份白名单，
 * 而 Monaco 内置的 JS 补全只知道语言标准库，提示不出 `formData`、`setFieldValue`
 * 这些注入进来的名字，也不知道这张表单有哪些字段。
 */
export interface JsContextInfo {
  /** 表单字段。补全时会同时给出 `字段名` 与 `formData.字段名` 两种形态 */
  fields: Array<{ name: string; title?: string }>
  /** 沙箱注入的 API */
  apis: Array<{
    name: string
    /** 右侧灰字，通常写签名 */
    detail?: string
    /** 展开的说明 */
    doc?: string
    /** 实际插入的文本，默认与 name 相同。用它可以插成 `setFieldValue('', )` 这种带括号的形态 */
    insert?: string
  }>
}

const props = withDefaults(defineProps<CodeEditorProps>(), {
  modelValue: '',
  language: 'sql',
  theme: 'light',
  readonly: false,
  height: '200px',
  placeholder: '',
  minLines: 0,
  maxLines: 0
})

const emit = defineEmits(['update:modelValue', 'change'])
const value = useVModel(props, 'modelValue', emit) as Ref<string>

const editorContainer = ref<HTMLElement>()
let editor: Monaco.editor.IStandaloneCodeEditor | null = null
let completionProvider: Monaco.IDisposable | null = null

// 初始化编辑器
const initEditor = () => {
  if (!editorContainer.value) return

  const useDynamicHeight = props.minLines > 0 && props.maxLines > 0
  const lineHeight = 19 // Monaco 默认行高
  const minHeight = useDynamicHeight ? props.minLines * lineHeight : undefined
  const maxHeight = useDynamicHeight ? props.maxLines * lineHeight : undefined

  // 设置容器初始高度
  if (useDynamicHeight && editorContainer.value) {
    editorContainer.value.style.height = `${minHeight}px`
  } else if (editorContainer.value) {
    // ⚠️ 固定高度模式也必须把 height 落到容器上。
    // Monaco 撑不出自己的高度 —— 容器不给高度它就渲染成一条几像素的缝：
    // 元素「可见」、点得中、键盘也能写进去，但用户看到的是一条线，等于不能用。
    // 这个 prop 曾经声明了却没人应用，直到有人不传 minLines/maxLines 才暴露出来
    editorContainer.value.style.height = props.height
  }

  // 创建编辑器实例
  editor = monaco.editor.create(editorContainer.value, {
    value: props.modelValue || '',
    language: props.language,
    theme: props.theme === 'dark' ? 'vs-dark' : 'vs',
    readOnly: props.readonly,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineNumbers: 'on',
    roundedSelection: false,
    scrollbar: {
      vertical: 'auto',
      horizontal: 'auto',
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8
    },
    wordWrap: 'on',
    tabSize: 2,
    insertSpaces: true,
    folding: true,
    // 动态高度模式下初始高度
    ...(useDynamicHeight ? {
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false
    } : {})
  })

  // 监听内容变化
  editor.onDidChangeModelContent(() => {
    const newValue = editor!.getValue()
    if (newValue !== value.value) {
      value.value = newValue
      emit('change', newValue)
    }

    // 动态高度调整
    if (useDynamicHeight) {
      updateDynamicHeight(lineHeight, minHeight!, maxHeight!)
    }
  })

  // 注册 SQL 自动补全
  if (props.language === 'sql' && props.sqlSchema) {
    registerSqlCompletion(props.sqlSchema)
  }

  // 注册 JavaScript 自动补全
  if (props.language === 'javascript' && props.jsContext) {
    registerJsCompletion(props.jsContext)
  }

  // 初始化时设置高度（无论是否有内容）
  if (useDynamicHeight) {
    nextTick(() => {
      updateDynamicHeight(lineHeight, minHeight!, maxHeight!)
    })
  }
}

/**
 * 动态调整编辑器高度
 */
const updateDynamicHeight = (lineHeight: number, minHeight: number, maxHeight: number) => {
  if (!editor || !editorContainer.value) return

  const model = editor.getModel()
  if (!model) return

  const lineCount = model.getLineCount()
  const contentHeight = lineCount * lineHeight + 10 // 10px padding
  const targetHeight = Math.max(minHeight, Math.min(contentHeight, maxHeight))

  editorContainer.value.style.height = `${targetHeight}px`
  editor.layout()
}

/**
 * 注册 SQL 自动补全提供器
 */
const registerSqlCompletion = (schema: SqlSchemaInfo) => {
  if (completionProvider) {
    completionProvider.dispose()
  }

  completionProvider = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }

      const textBeforeCursor = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })

      // 检查是否在输入表名后的点号（table.）
      const tableMatch = textBeforeCursor.match(/(\w+)\.$/i)
      if (tableMatch) {
        const tableName = tableMatch[1]
        const table = schema.tables.find(
          t => t.name.toLowerCase() === tableName.toLowerCase()
        )
        if (table) {
          // 提供字段补全
          return {
            suggestions: table.columns.map(col => ({
              label: col.name,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: col.type || '',
              documentation: col.comment || '',
              insertText: col.name,
              range
            }))
          }
        }
      }

      // 默认提供表名补全
      const suggestions: monaco.languages.CompletionItem[] = []

      // SQL 关键字
      const keywords = [
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY',
        'INSERT INTO', 'UPDATE', 'DELETE FROM', 'SET', 'VALUES',
        'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
        'LIMIT', 'OFFSET', 'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN'
      ]

      keywords.forEach(kw => {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range
        })
      })

      // 表名补全
      schema.tables.forEach(table => {
        suggestions.push({
          label: table.name,
          kind: monaco.languages.CompletionItemKind.Class,
          detail: '表',
          documentation: table.comment || '',
          insertText: table.name,
          range
        })

        // 同时提供 表名.字段名 的补全
        table.columns.forEach(col => {
          suggestions.push({
            label: `${table.name}.${col.name}`,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: col.type || '',
            documentation: `${table.comment || table.name} - ${col.comment || col.name}`,
            insertText: `${table.name}.${col.name}`,
            range
          })
        })
      })

      return { suggestions }
    }
  })
}

/**
 * 注册 JavaScript 自动补全提供器
 *
 * ⚠️ Monaco 的 completionItemProvider 是**按语言全局注册**的，不绑定某个编辑器实例。
 * 所以同一页面挂多个 JS 编辑器时，后挂的会把前面那份补全数据顶掉。
 * 表单脚本编辑器因此只用一个实例、切页签换内容，而不是四个钩子各开一个。
 */
const registerJsCompletion = (context: JsContextInfo) => {
  if (completionProvider) {
    completionProvider.dispose()
  }

  completionProvider = monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['.'],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }

      const textBeforeCursor = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })

      // 打了 `formData.` 之后只提字段名，不要再把 API 混进来
      if (/\bformData\.\w*$/.test(textBeforeCursor)) {
        return {
          suggestions: context.fields.map((f) => ({
            label: f.name,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: f.title || '',
            documentation: f.title ? `表单字段：${f.title}` : '表单字段',
            insertText: f.name,
            range
          }))
        }
      }

      const suggestions: monaco.languages.CompletionItem[] = []

      // 沙箱注入的 API 排在最前：它们是这段脚本真正能用的东西，
      // 而 Monaco 内置的 JS 标准库补全会跟在后面
      context.apis.forEach((api) => {
        suggestions.push({
          label: api.name,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: api.detail || '',
          documentation: api.doc || '',
          insertText: api.insert ?? api.name,
          // 排序键前缀 0，保证沉不下去
          sortText: `0_${api.name}`,
          range
        })
      })

      // 字段以 formData.xxx 的完整形态给出 —— 直接给裸字段名会让人以为
      // 脚本里可以直接写 `amount`，而沙箱里并没有这个变量
      context.fields.forEach((f) => {
        suggestions.push({
          label: `formData.${f.name}`,
          kind: monaco.languages.CompletionItemKind.Field,
          detail: f.title || '',
          documentation: f.title ? `表单字段：${f.title}` : '表单字段',
          insertText: `formData.${f.name}`,
          sortText: `1_${f.name}`,
          range
        })
      })

      return { suggestions }
    }
  })
}

// 销毁编辑器
const destroyEditor = () => {
  if (completionProvider) {
    completionProvider.dispose()
    completionProvider = null
  }
  if (editor) {
    editor.dispose()
    editor = null
  }
}

// 监听外部值变化
watch(() => props.modelValue, (newValue) => {
  if (editor && newValue !== editor.getValue()) {
    editor.setValue(newValue || '')
  }
})

// 监听 SQL Schema 变化，重新注册补全
watch(() => props.sqlSchema, (newSchema) => {
  if (props.language === 'sql' && newSchema) {
    registerSqlCompletion(newSchema)
  }
}, { deep: true })

// 监听 JS 上下文变化，重新注册补全。
// 表单字段是用户在上一步现改的，不跟着变的话补全提示的是旧字段
watch(() => props.jsContext, (newContext) => {
  if (props.language === 'javascript' && newContext) {
    registerJsCompletion(newContext)
  }
}, { deep: true })

/**
 * 固定高度模式下，height 变了要跟着改
 *
 * 高度可能是调用方按视口算出来的（窗口一缩放就变）。只在 initEditor 里设一次的话，
 * 编辑器会停在初始高度 —— 窗口拉大后下面空一片，拉小后又超出屏幕。
 * Monaco 开着 automaticLayout，容器改了它会自己重排，但仍显式调一次 layout 更稳妥。
 */
watch(
  () => props.height,
  (h) => {
    const useDynamicHeight = props.minLines > 0 && props.maxLines > 0
    if (useDynamicHeight || !editorContainer.value || !h) return
    editorContainer.value.style.height = h
    editor?.layout()
  }
)

onMounted(() => {
  initEditor()
})

onBeforeUnmount(() => {
  destroyEditor()
})

// 暴露插入文本方法，供父组件调用
defineExpose({
  insertText: (text: string) => {
    if (!editor) return
    const selection = editor.getSelection()
    const range = selection || {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1
    }
    editor.executeEdits('', [{
      range,
      text,
      forceMoveMarkers: true
    }])
    editor.focus()
  }
})
</script>

<style scoped>
.code-editor {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  overflow: hidden;
}
</style>
