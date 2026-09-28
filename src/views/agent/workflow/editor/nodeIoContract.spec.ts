import { describe, expect, it } from 'vitest'
import { NODE_TYPE_META } from '../nodeSummary'
import {
  NODE_IO_CONTRACTS,
  allContracts,
  contractOf,
  ioContractTypes,
  dataTypeLabel,
  dataTypeColor,
  canReference,
  referenceForm,
  resolveOutVarName,
  resolvedOutputsOf,
  type IoDataType,
  type IoMode
} from './nodeIoContract'

/**
 * nodeIoContract 纯逻辑单测（Phase E / Req5：类型化端口契约的前端镜像）
 *
 * 🔴 钉两件事：① 与后端 NodeIoContract 逐字同构（13 类型齐全、端口合法、抽查关键类型）；② 端口 → 变量名解析
 *    与后端 blankToDefault 同口径。全是纯数据 + 纯函数，不碰 Vue。
 */
describe('nodeIoContract', () => {
  const LEGAL_TYPES = Object.keys(NODE_TYPE_META) // 13 种权威类型

  it('覆盖全部 13 种合法节点类型（与 NODE_TYPE_META 一一对应）', () => {
    expect(ioContractTypes().length).toBe(LEGAL_TYPES.length)
    for (const t of LEGAL_TYPES) {
      expect(NODE_IO_CONTRACTS[t], `${t} 应有 I/O 契约`).toBeTruthy()
    }
    expect(new Set(ioContractTypes()).size).toBe(LEGAL_TYPES.length)
  })

  it('每份契约结构合法：type/label/group 非空，端口字段完整，dataType/mode 取值合法', () => {
    const dataTypes = new Set<string>(['string', 'number', 'boolean', 'object', 'array'])
    const modes = new Set<string>(['literal', 'reference', 'both'])
    for (const c of allContracts()) {
      expect(c.type).toBeTruthy()
      expect(c.label).toBeTruthy()
      expect(c.group).toBeTruthy()
      expect(Array.isArray(c.inputs)).toBe(true)
      expect(Array.isArray(c.outputs)).toBe(true)
      for (const ip of c.inputs) {
        expect(ip.key, `${c.type} 输入端口需有 key`).toBeTruthy()
        expect(dataTypes.has(ip.dataType), `${c.type}.${ip.key} dataType 合法`).toBe(true)
        expect(modes.has(ip.mode), `${c.type}.${ip.key} mode 合法`).toBe(true)
        expect(typeof ip.required).toBe('boolean')
        expect(ip.group).toBeTruthy()
        expect(typeof ip.hint).toBe('string')
      }
      for (const op of c.outputs) {
        expect(dataTypes.has(op.dataType), `${c.type} 输出端口 dataType 合法`).toBe(true)
        expect(op.label, `${c.type} 输出端口需有 label`).toBeTruthy()
        // configKey 为 null 时必须有 defaultName（否则解析不出变量名）
        if (op.configKey === null) {
          expect(op.defaultName, `${c.type} 无 configKey 的输出端口需有 defaultName`).toBeTruthy()
        }
      }
    }
  })

  it('contractOf 查得到已登记类型、查不到返回 undefined', () => {
    expect(contractOf('tool')?.label).toBe('工具')
    expect(contractOf('llm')?.label).toBe('大模型')
    expect(contractOf('magic_node')).toBeUndefined()
    expect(contractOf(undefined)).toBeUndefined()
    expect(contractOf(null)).toBeUndefined()
  })

  it('抽查关键类型的输出端口（对齐后端 NodeIoContractTest）', () => {
    // tool → outputVar（object，无默认名）
    const toolOut = contractOf('tool')!.outputs
    expect(toolOut).toHaveLength(1)
    expect(toolOut[0].configKey).toBe('outputVar')
    expect(toolOut[0].defaultName).toBeNull()
    expect(toolOut[0].dataType).toBe('object')

    // knowledge_retrieval → outputVar(默认 retrieved, array) + citationsVar(array)
    const krOut = contractOf('knowledge_retrieval')!.outputs
    expect(krOut).toHaveLength(2)
    expect(krOut[0].configKey).toBe('outputVar')
    expect(krOut[0].defaultName).toBe('retrieved')
    expect(krOut[0].dataType).toBe('array')
    expect(krOut[1].configKey).toBe('citationsVar')
    expect(krOut[1].dataType).toBe('array')

    // hitl.confirm → approveVar（boolean，默认 hitl_approved）
    const hc = contractOf('hitl.confirm')!.outputs
    expect(hc).toHaveLength(1)
    expect(hc[0].configKey).toBe('approveVar')
    expect(hc[0].defaultName).toBe('hitl_approved')
    expect(hc[0].dataType).toBe('boolean')

    // hitl.bpm_approval → approveVar(boolean) + statusVar(number)
    const bpm = contractOf('hitl.bpm_approval')!.outputs
    expect(bpm).toHaveLength(2)
    expect(bpm.map((o) => o.configKey)).toEqual(['approveVar', 'statusVar'])
    expect(bpm[0].dataType).toBe('boolean')
    expect(bpm[1].dataType).toBe('number')
  })

  it('控制流节点无数据输出端口（condition.rule/parallel/iteration/wait/sub_workflow）', () => {
    for (const t of ['condition.rule', 'parallel', 'iteration', 'wait', 'sub_workflow']) {
      expect(contractOf(t)!.outputs, `${t} 应无输出端口`).toHaveLength(0)
    }
    // condition.llm 有输出（模型选中的分支）
    expect(contractOf('condition.llm')!.outputs).toHaveLength(1)
  })

  it('输入端口 key 逐字对齐 nodeConfigSchema 的 config 键（抽查）', () => {
    const llmKeys = contractOf('llm')!.inputs.map((i) => i.key)
    expect(llmKeys).toEqual(['prompt', 'systemPrompt', 'modelId', 'temperature', 'maxTokens'])
    const krKeys = contractOf('knowledge_retrieval')!.inputs.map((i) => i.key)
    expect(krKeys).toContain('knowledgeBaseId')
    expect(krKeys).toContain('queryVar')
    expect(krKeys).toContain('similarityThreshold')
  })

  it('resolveOutVarName：优先取 config 值，空则回落 defaultName，仍空则空串（对齐后端 blankToDefault）', () => {
    const outVar = contractOf('tool')!.outputs[0]
    // tool.outputVar 无默认名：未配置 → 空串（= 未命名，不产出可引用变量）
    expect(resolveOutVarName({ id: 'a', type: 'tool', config: {} }, outVar)).toBe('')
    expect(resolveOutVarName({ id: 'a', type: 'tool', config: { outputVar: '  ' } }, outVar)).toBe('')
    expect(resolveOutVarName({ id: 'a', type: 'tool', config: { outputVar: 'res' } }, outVar)).toBe('res')
    // hitl.confirm.approveVar 有默认名：未配置 → 默认 hitl_approved
    const approve = contractOf('hitl.confirm')!.outputs[0]
    expect(resolveOutVarName({ id: 'h', type: 'hitl.confirm', config: {} }, approve)).toBe('hitl_approved')
    expect(resolveOutVarName({ id: 'h', type: 'hitl.confirm', config: { approveVar: 'ok' } }, approve)).toBe('ok')
    // configKey 为 null 的端口：恒用 defaultName（忽略 config）
    expect(resolveOutVarName({ id: 'x', type: 'tool', config: { anything: 'y' } }, outVar)).toBe('')
  })

  it('resolvedOutputsOf：过滤未命名端口，返回已解析变量名 + 类型', () => {
    // tool 未配 outputVar → 无产出
    expect(resolvedOutputsOf({ id: 'a', type: 'tool', config: {} })).toHaveLength(0)
    // tool 配了 outputVar → 一个产出
    const r = resolvedOutputsOf({ id: 'a', type: 'tool', config: { outputVar: 'out' } })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ varName: 'out', dataType: 'object', configKey: 'outputVar' })
    // hitl.confirm 无 config → 默认产出 hitl_approved
    const h = resolvedOutputsOf({ id: 'h', type: 'hitl.confirm', config: {} })
    expect(h).toHaveLength(1)
    expect(h[0].varName).toBe('hitl_approved')
    // 控制流节点无产出
    expect(resolvedOutputsOf({ id: 'p', type: 'parallel', config: {} })).toHaveLength(0)
    // 未知类型 fail-soft
    expect(resolvedOutputsOf({ id: 'z', type: 'magic', config: {} })).toHaveLength(0)
  })

  it('canReference：reference / both 可引用，literal 不可', () => {
    const krInputs = contractOf('knowledge_retrieval')!.inputs
    const queryVar = krInputs.find((i) => i.key === 'queryVar')!
    const query = krInputs.find((i) => i.key === 'query')!
    const kbId = krInputs.find((i) => i.key === 'knowledgeBaseId')!
    expect(canReference(queryVar)).toBe(true) // reference
    expect(canReference(query)).toBe(true) // both
    expect(canReference(kbId)).toBe(false) // literal
  })

  it('referenceForm：reference→裸变量名，both→{{$.var}}模板，literal→不引用（对齐后端取值方式）', () => {
    const krInputs = contractOf('knowledge_retrieval')!.inputs
    // queryVar 后端 ctx.getString(queryVar) 直取裸键 → bare
    expect(referenceForm(krInputs.find((i) => i.key === 'queryVar'))).toBe('bare')
    // query 后端走模板解析 → template
    expect(referenceForm(krInputs.find((i) => i.key === 'query'))).toBe('template')
    // knowledgeBaseId 只填字面量 → none
    expect(referenceForm(krInputs.find((i) => i.key === 'knowledgeBaseId'))).toBe('none')
    // iteration.itemsVar 后端 state.value(itemsVar) 直取裸键 → bare
    expect(referenceForm(contractOf('iteration')!.inputs.find((i) => i.key === 'itemsVar'))).toBe('bare')
    // llm.prompt / tool.args → template
    expect(referenceForm(contractOf('llm')!.inputs.find((i) => i.key === 'prompt'))).toBe('template')
    expect(referenceForm(contractOf('tool')!.inputs.find((i) => i.key === 'args'))).toBe('template')
    // 未知端口 → none
    expect(referenceForm(undefined)).toBe('none')
  })

  it('dataTypeLabel / dataTypeColor 覆盖全部类型', () => {
    const types: IoDataType[] = ['string', 'number', 'boolean', 'object', 'array']
    for (const t of types) {
      expect(dataTypeLabel(t)).toBeTruthy()
      expect(dataTypeColor(t)).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
    // 未知类型兜底
    expect(dataTypeLabel('weird' as IoDataType)).toBe('值')
    expect(dataTypeColor('weird' as IoDataType)).toBe('#909399')
  })

  it('mode 常量取值稳定（防止拼写漂移）', () => {
    const modes = new Set<IoMode>()
    for (const c of allContracts()) for (const ip of c.inputs) modes.add(ip.mode)
    expect([...modes].sort()).toEqual(['both', 'literal', 'reference'])
  })
})
