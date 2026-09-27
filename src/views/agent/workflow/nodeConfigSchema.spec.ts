import { describe, expect, it } from 'vitest'
import { NODE_TYPE_OPTIONS } from './editorModel'
import {
  NODE_CONFIG_SCHEMA,
  fieldsFor,
  isFieldVisible,
  jsonHintFor,
  type ConfigField
} from './nodeConfigSchema'

/**
 * nodeConfigSchema 纯逻辑单测（增量16A / P4 编辑器第二子刀：结构化节点配置面板）
 *
 * 钉住面板 schema 的命门：① 8 种可拖入类型都有 schema（拖出来的节点不会只剩裸 JSON）；② 字段键唯一、
 * kind 合法、select 必有选项来源；③ 字段键逐字对齐后端执行器读取的 config 键（抽查关键类型）；
 * ④ showIf 条件显隐正确（wait 按 waitType 分支）；⑤ 认不出的类型 fail-soft 返回空。全是纯函数，不碰 Vue。
 */
describe('nodeConfigSchema', () => {
  it('NODE_TYPE_OPTIONS 里每种类型都有结构化 schema', () => {
    for (const opt of NODE_TYPE_OPTIONS) {
      const fields = fieldsFor(opt.value)
      expect(fields.length, `${opt.value} 应有结构化字段`).toBeGreaterThan(0)
      expect(NODE_CONFIG_SCHEMA[opt.value]).toBe(fields)
    }
  })

  it('字段键唯一、kind 合法、select 必有选项来源（optionsFrom 或 options）', () => {
    const kinds = new Set(['text', 'textarea', 'number', 'select', 'switch'])
    for (const [type, fields] of Object.entries(NODE_CONFIG_SCHEMA)) {
      const keys = fields.map((f) => f.key)
      expect(new Set(keys).size, `${type} 字段键应唯一`).toBe(keys.length)
      for (const f of fields) {
        expect(kinds.has(f.kind), `${type}.${f.key} kind 合法`).toBe(true)
        if (f.kind === 'select') {
          const hasSource = !!f.optionsFrom || (Array.isArray(f.options) && f.options.length > 0)
          expect(hasSource, `${type}.${f.key} select 需有选项来源`).toBe(true)
        }
        // showIf 必须指向同类型里真实存在的字段，否则永远隐藏
        if (f.showIf) {
          expect(keys, `${type}.${f.key} 的 showIf 应指向同类型字段`).toContain(f.showIf.key)
        }
      }
    }
  })

  it('字段键对齐后端执行器读取的 config 键（抽查 tool/llm/knowledge_retrieval/wait/hitl）', () => {
    const keysOf = (t: string) => fieldsFor(t).map((f) => f.key)
    expect(keysOf('tool')).toEqual(expect.arrayContaining(['toolId', 'outputVar']))
    expect(keysOf('llm')).toEqual(
      expect.arrayContaining(['prompt', 'systemPrompt', 'modelId', 'temperature', 'maxTokens', 'outputVar'])
    )
    expect(keysOf('knowledge_retrieval')).toEqual(
      expect.arrayContaining(['knowledgeBaseId', 'queryVar', 'query', 'topK', 'similarityThreshold', 'outputVar'])
    )
    expect(keysOf('hitl.confirm')).toContain('approveVar')
    expect(keysOf('wait')).toEqual(expect.arrayContaining(['waitType', 'duration', 'eventKey']))
    expect(keysOf('parallel')).toContain('join')
  })

  it('isFieldVisible：无 showIf 恒可见；wait 按 waitType 分支显隐', () => {
    const noCond: ConfigField = { key: 'x', label: 'x', kind: 'text' }
    expect(isFieldVisible(noCond, {})).toBe(true)
    expect(isFieldVisible(noCond, null)).toBe(true)

    const duration = fieldsFor('wait').find((f) => f.key === 'duration')!
    const event = fieldsFor('wait').find((f) => f.key === 'eventKey')!
    expect(duration.showIf).toBeTruthy()
    // waitType=duration → 只显 duration
    expect(isFieldVisible(duration, { waitType: 'duration' })).toBe(true)
    expect(isFieldVisible(event, { waitType: 'duration' })).toBe(false)
    // waitType=event → 只显 eventKey
    expect(isFieldVisible(duration, { waitType: 'event' })).toBe(false)
    expect(isFieldVisible(event, { waitType: 'event' })).toBe(true)
    // 未选 waitType → 两个条件字段都隐藏（只剩 waitType 选择器）
    expect(isFieldVisible(duration, {})).toBe(false)
    expect(isFieldVisible(event, {})).toBe(false)
    expect(isFieldVisible(duration, undefined)).toBe(false)
  })

  it('jsonHintFor：复杂嵌套键的类型有 JSON 兜底提示，简单类型无', () => {
    expect(jsonHintFor('tool')).toContain('args')
    expect(jsonHintFor('condition.rule')).toContain('branches')
    expect(jsonHintFor('condition.llm')).toContain('choices')
    expect(jsonHintFor('parallel')).toContain('branches')
    // llm / hitl / wait / knowledge_retrieval 无复杂嵌套键 → 无提示
    expect(jsonHintFor('llm')).toBe('')
    expect(jsonHintFor('hitl.confirm')).toBe('')
  })

  it('fieldsFor/jsonHintFor：认不出的类型 fail-soft 返回空', () => {
    expect(fieldsFor('nonexistent.type')).toEqual([])
    expect(fieldsFor(undefined)).toEqual([])
    expect(fieldsFor(null)).toEqual([])
    expect(jsonHintFor('nonexistent.type')).toBe('')
    expect(jsonHintFor(undefined)).toBe('')
  })
})
