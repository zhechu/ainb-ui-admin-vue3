import { describe, it, expect } from 'vitest'
import type { RuleTemplateMetaVO } from '@/api/system/grant'
import {
  TPL,
  MAX_TREE_DEPTH,
  serializeParams,
  parseParams,
  validateState,
  describeState,
  describeNode,
  summarizeParams,
  countConditions,
  emptyState,
  type ConditionNodeModel,
  type WizardState
} from './ruleParams'

// 最小元数据夹具，形状与后端 /system/rule/template-meta 一致
const meta: RuleTemplateMetaVO = {
  templates: [
    { code: TPL.OWNER_ONLY, displayName: '仅自己的数据', group: 'basic', businessDescription: '', requiredSlots: ['owner'], paramSpecs: [] },
    { code: TPL.STATUS_IN, displayName: '指定状态可见', group: 'basic', businessDescription: '', requiredSlots: ['status'], paramSpecs: [{ key: 'allowedStatuses', kind: 'STATUS_LIST', label: '允许的状态值', required: true, valueType: 'number' }] },
    { code: TPL.DEPT_IN, displayName: '指定部门数据', group: 'basic', businessDescription: '', requiredSlots: ['dept'], paramSpecs: [{ key: 'deptIds', kind: 'DEPT_MULTI', label: '指定部门', required: true, valueType: 'number' }] },
    { code: TPL.FIELD_EQUALS, displayName: '指定字段等于', group: 'basic', businessDescription: '', requiredSlots: [], paramSpecs: [{ key: 'field', kind: 'SLOT', label: '字段', required: true }, { key: 'value', kind: 'TEXT', label: '字段值', required: true }] },
    { code: TPL.CUSTOM_TREE, displayName: '自定义条件树', group: 'advanced', businessDescription: '', requiredSlots: [], paramSpecs: [{ key: 'conditionTree', kind: 'CONDITION_TREE', label: '条件树', required: true }] }
  ],
  slots: [
    { slot: 'owner', description: '记录归属人' },
    { slot: 'dept', description: '归属部门' },
    { slot: 'status', description: '状态' }
  ],
  operators: [
    { code: 'EQ', label: '等于', unary: false, multiValue: false },
    { code: 'IN', label: '属于（IN）', unary: false, multiValue: true },
    { code: 'IS_NULL', label: '为空', unary: true, multiValue: false }
  ],
  variables: [
    { name: 'currentUserId', label: '当前用户', collection: false },
    { name: 'currentDeptAndChildren', label: '当前部门及下级', collection: true }
  ]
}

describe('ruleParams 序列化/解析往返', () => {
  it('STATUS_IN：数字串转 number，文本保留，往返一致', () => {
    const state: WizardState = { template: TPL.STATUS_IN, allowedStatuses: ['1', '2', '归档'] }
    const json = serializeParams(state)
    expect(json).toBe('{"allowedStatuses":[1,2,"归档"]}')
    const parsed = parseParams(TPL.STATUS_IN, json)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect((parsed.state as any).allowedStatuses).toEqual(['1', '2', '归档'])
    }
  })

  it('STATUS_IN：空数组序列化为空串，空串解析回空状态', () => {
    expect(serializeParams({ template: TPL.STATUS_IN, allowedStatuses: [] })).toBe('')
    const parsed = parseParams(TPL.STATUS_IN, '')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect((parsed.state as any).allowedStatuses).toEqual([])
  })

  it('DEPT_IN：往返一致', () => {
    const json = serializeParams({ template: TPL.DEPT_IN, deptIds: [100, 101] })
    expect(json).toBe('{"deptIds":[100,101]}')
    const parsed = parseParams(TPL.DEPT_IN, json)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect((parsed.state as any).deptIds).toEqual([100, 101])
  })

  it('FIELD_EQUALS：value 恒为字符串，数字值解析后转字符串', () => {
    const json = serializeParams({ template: TPL.FIELD_EQUALS, field: 'owner', value: '1' })
    expect(json).toBe('{"field":"owner","value":"1"}')
    const parsed = parseParams(TPL.FIELD_EQUALS, '{"field":"owner","value":5}')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect((parsed.state as any).field).toBe('owner')
      expect((parsed.state as any).value).toBe('5')
    }
  })

  it('CUSTOM_TREE：嵌套条件树往返一致', () => {
    const tree: ConditionNodeModel = {
      type: 'GROUP',
      logic: 'OR',
      children: [
        { type: 'CONDITION', slot: 'owner', operator: 'EQ', value: ':currentUserId' },
        { type: 'GROUP', logic: 'AND', children: [{ type: 'CONDITION', slot: 'status', operator: 'IS_NULL' }] }
      ]
    }
    const json = serializeParams({ template: TPL.CUSTOM_TREE, conditionTree: tree })
    const parsed = parseParams(TPL.CUSTOM_TREE, json)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect((parsed.state as any).conditionTree).toEqual(tree)
    expect(countConditions(tree)).toBe(2)
  })

  it('无参数模板忽略已存 params', () => {
    const parsed = parseParams(TPL.OWNER_ONLY, '{"junk":1}')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.state).toEqual({ template: TPL.OWNER_ONLY })
  })
})

describe('ruleParams 解析失败路径', () => {
  it('非法 JSON → ok:false', () => {
    expect(parseParams(TPL.STATUS_IN, '{bad json').ok).toBe(false)
  })
  it('未知模板代码 → ok:false（强制 JSON 模式）', () => {
    expect(parseParams('MY_CUSTOM', '{}').ok).toBe(false)
  })
  it('STATUS_IN 缺少数组 → ok:false', () => {
    expect(parseParams(TPL.STATUS_IN, '{"foo":1}').ok).toBe(false)
  })
  it('DEPT_IN 含非数字 → ok:false', () => {
    expect(parseParams(TPL.DEPT_IN, '{"deptIds":["a"]}').ok).toBe(false)
  })
  it('超过最大深度的条件树 → ok:false', () => {
    let node: ConditionNodeModel = { type: 'CONDITION', slot: 'owner', operator: 'EQ', value: '1' }
    for (let i = 0; i < MAX_TREE_DEPTH + 1; i++) {
      node = { type: 'GROUP', logic: 'AND', children: [node] }
    }
    expect(parseParams(TPL.CUSTOM_TREE, JSON.stringify({ conditionTree: node })).ok).toBe(false)
  })
})

describe('ruleParams 校验', () => {
  it('必填项为空一律拦截', () => {
    expect(validateState({ template: TPL.STATUS_IN, allowedStatuses: [] }, meta)).toBeTruthy()
    expect(validateState({ template: TPL.DEPT_IN, deptIds: [] }, meta)).toBeTruthy()
    expect(validateState({ template: TPL.FIELD_EQUALS, field: 'owner', value: '  ' }, meta)).toBeTruthy()
    expect(validateState({ template: TPL.CUSTOM_TREE, conditionTree: { type: 'GROUP', logic: 'AND', children: [] } }, meta)).toBeTruthy()
  })
  it('无参数模板恒通过', () => {
    expect(validateState({ template: TPL.OWNER_ONLY }, meta)).toBeNull()
  })
  it('IN 的值必须是集合变量：字面量报错、集合变量通过', () => {
    const literal: WizardState = {
      template: TPL.CUSTOM_TREE,
      conditionTree: { type: 'GROUP', logic: 'AND', children: [{ type: 'CONDITION', slot: 'dept', operator: 'IN', value: '100' }] }
    }
    expect(validateState(literal, meta)).toBeTruthy()
    const withVar: WizardState = {
      template: TPL.CUSTOM_TREE,
      conditionTree: { type: 'GROUP', logic: 'AND', children: [{ type: 'CONDITION', slot: 'dept', operator: 'IN', value: ':currentDeptAndChildren' }] }
    }
    expect(validateState(withVar, meta)).toBeNull()
  })
  it('一元操作符无需值', () => {
    const unary: WizardState = {
      template: TPL.CUSTOM_TREE,
      conditionTree: { type: 'GROUP', logic: 'AND', children: [{ type: 'CONDITION', slot: 'status', operator: 'IS_NULL' }] }
    }
    expect(validateState(unary, meta)).toBeNull()
  })
})

describe('ruleParams 白话预览与摘要', () => {
  it('describeState 各模板', () => {
    expect(describeState({ template: TPL.STATUS_IN, allowedStatuses: ['1', '2'] }, meta)).toContain('状态属于 [1, 2]')
    expect(describeState({ template: TPL.DEPT_IN, deptIds: [1, 2, 3] }, meta)).toContain('3 个部门')
    expect(describeState({ template: TPL.FIELD_EQUALS, field: 'owner', value: '1' }, meta)).toContain('等于 "1"')
    expect(describeState({ template: TPL.OWNER_ONLY }, meta)).toContain('无需参数')
  })
  it('describeNode 递归拼接 AND/OR', () => {
    const tree: ConditionNodeModel = {
      type: 'GROUP',
      logic: 'OR',
      children: [
        { type: 'CONDITION', slot: 'owner', operator: 'EQ', value: ':currentUserId' },
        { type: 'CONDITION', slot: 'status', operator: 'EQ', value: '1' }
      ]
    }
    const text = describeNode(tree, meta)
    expect(text).toContain('或者')
    expect(text).toContain('当前用户')
  })
  it('summarizeParams 各模板', () => {
    expect(summarizeParams(TPL.OWNER_ONLY, undefined, meta)).toBe('无参数')
    expect(summarizeParams(TPL.STATUS_IN, '{"allowedStatuses":[1,2]}', meta)).toBe('允许状态：1, 2')
    expect(summarizeParams(TPL.DEPT_IN, '{"deptIds":[1,2,3]}', meta)).toBe('指定部门 ×3')
    expect(summarizeParams(TPL.FIELD_EQUALS, '{"field":"owner","value":"1"}', meta)).toBe('owner = 1')
    expect(summarizeParams(TPL.STATUS_IN, '{bad', meta)).toBe('{bad')
  })
  it('emptyState 给出各模板默认值', () => {
    expect(emptyState(TPL.STATUS_IN)).toEqual({ template: TPL.STATUS_IN, allowedStatuses: [] })
    expect(emptyState(TPL.CUSTOM_TREE)).toEqual({ template: TPL.CUSTOM_TREE, conditionTree: { type: 'GROUP', logic: 'AND', children: [] } })
    expect(emptyState(TPL.OWNER_ONLY)).toEqual({ template: TPL.OWNER_ONLY })
  })
})
