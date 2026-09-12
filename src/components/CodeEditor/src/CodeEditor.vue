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
