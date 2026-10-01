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
 * 🔴 钉三件事：① 与后端 NodeIoContract 逐字同构（13 类型齐全、端口合法、抽查关键类型、
 *    四个 defaultName 钉死后端执行器常量）；② 端口 → 变量名解析与后端 blankToDefault 同口径；
 *    ③ mode 不许漂（它决定属性面板要不要挂「引用上游变量」选择器，挂错会把对象字段整体换成字符串）。
 *    全是纯数据 + 纯函数，不碰 Vue。
 *
 * ⚠️ 本文件的 InPort.hint 断言只保「这份镜像与后端那份一致」；用户在面板上真正看到的是
 *    nodeConfigSchema.ts 的 hint，那份的强制点在 nodeConfigSchema.spec.ts。
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
    // tool → outputVar（object，默认名 tool_result）
    const toolOut = contractOf('tool')!.outputs
    expect(toolOut).toHaveLength(1)
    expect(toolOut[0].configKey).toBe('outputVar')
    expect(toolOut[0].defaultName).toBe('tool_result')
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

  /**
   * 🔴 defaultName 必须逐字等于后端执行器的兜底常量。
   *
   * 后端那侧写的是「引用执行器常量」，编译器保证两者不分家；前端这侧只能抄字面量，抄就会漂 ——
   * 这四个值就是本文件唯一的强制点。漂过的后果不是「显示不对」那么轻：tool/llm 曾双双写着 null
   * （= 必须用户命名），而运行期一直在兜底，于是 ioReference.producersOf 看不见这两个键，
   * 合法的 {{$.tool_result}} 被 validateReferences 当成「无登记产出」直接跳过可达性校验（静默放行），
   * 后端 WorkflowDslValidator 则反过来把它误报成悬空引用。
   *
   * ⚠️ 对照项同样是断言：condition.llm 与 agent_loop 运行期没有兜底（LlmConditionNodeExecutor 仅在
   *    outputVar 非空时才写；agent_loop 的 outputVar 为空直接编译失败），故必须继续是 null。
   *    别顺手给它们编一个默认名 —— 那会让画布凭空画出一个不存在的产出端口。
   */
  it('四个有默认输出名的类型，defaultName 逐字钉死后端执行器常量', () => {
    expect(contractOf('tool')!.outputs[0].defaultName).toBe('tool_result')
    expect(contractOf('llm')!.outputs[0].defaultName).toBe('llm_output')
    expect(contractOf('script')!.outputs[0].defaultName).toBe('script_result')
    expect(contractOf('knowledge_retrieval')!.outputs[0].defaultName).toBe('retrieved')
    expect(contractOf('condition.llm')!.outputs[0].defaultName, 'condition.llm 无默认输出名：不配就不写').toBeNull()
    expect(contractOf('agent_loop')!.outputs[0].defaultName, 'agent_loop 的 outputVar 必填，没有默认名').toBeNull()
  })

  /**
   * 🔴 formVars 的 mode 是承重结构，不是文案：它决定属性面板要不要给这个字段挂「引用上游变量」选择器。
   *
   * 后端 AgentBpmApprovalService.resolveConfig 用 configMap("formVars") 原样取，createApproval 再原样
   * setVariables 交给 Flowable —— 压根不过 StateTemplateResolver。标成 both 的代价不止「提示骗人」：
   * 选择器 emit 的是字符串，onPickRef 直接整体赋值 ⟹ formVars 这个对象被换成一个串 ⟹ configMap 返回 null
   * ⟹ 用户配的变量全丢，且全程无提示。
   *
   * 🔴 后一条断言是前一条的肯定式对照：断言「不许引用」时，必须同时钉住「同类形状的那个端口确实可以引用」。
   *    否则把 args 和 formVars 一起降成 literal 也能让上一条变绿 —— 那就把真能力也砍了，而测试不会吭声。
   */
  it('formVars 不可引用（值原样进审批流程），而 tool.args 可以（后端真的解析）', () => {
    const formVars = contractOf('hitl.bpm_approval')!.inputs.find((i) => i.key === 'formVars')!
    expect(formVars.mode).toBe('literal')
    expect(formVars.hint).toContain('不会被替换')

    const args = contractOf('tool')!.inputs.find((i) => i.key === 'args')!
    expect(args.mode, 'args 的值确实走 StateTemplateResolver，不许跟着降成 literal').toBe('both')
    expect(args.hint, 'args 的 hint 必须交代「只解析顶层字符串值」，否则用户嵌进对象里以为会替换').toContain(
      '嵌在对象/数组里的不替换'
    )
  })

  /**
   * 🔴 condition.rule 的比较值不过模板解析、变量名只认顶层键 —— hint 必须明说。
   * 这条 hint 曾写反（承诺「条件值可用 {{$.变量}}」），而后端那份也没有强制点，于是漂了很久没人发现。
   */
  it('condition.rule 的 branches hint 钉住「比较值不替换、变量名只认顶层键」', () => {
    const branches = contractOf('condition.rule')!.inputs.find((i) => i.key === 'branches')!
    expect(branches.mode).toBe('literal')
    expect(branches.hint).toContain('比较值按字面量处理')
    expect(branches.hint).toContain('变量名只认顶层键')
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
    // tool.outputVar 有默认名：未配置 → 回落 tool_result（与执行器的兜底同一个键）
    expect(resolveOutVarName({ id: 'a', type: 'tool', config: {} }, outVar)).toBe('tool_result')
    // ⚠️ 纯空白也回落 —— 前端是 blank 口径（先 trim）。后端执行器用的是 NodeDTO.configStr(key, def)，
    //    那是 empty 口径（只判 isEmpty），纯空白会被当成「配了」而写进名为 "  " 的键。
    //    两套口径分岔是真缺陷，但**不要**靠把这里改成不 trim 来「对齐」：那只是把画布也改坏。
    //    修法在后端（统一 configStr 为 blank 口径 + 编译期拒绝纯空白变量名），不在本文件。
    expect(resolveOutVarName({ id: 'a', type: 'tool', config: { outputVar: '  ' } }, outVar)).toBe('tool_result')
    expect(resolveOutVarName({ id: 'a', type: 'tool', config: { outputVar: 'res' } }, outVar)).toBe('res')
    // hitl.confirm.approveVar 有默认名：未配置 → 默认 hitl_approved
    const approve = contractOf('hitl.confirm')!.outputs[0]
    expect(resolveOutVarName({ id: 'h', type: 'hitl.confirm', config: {} }, approve)).toBe('hitl_approved')
    expect(resolveOutVarName({ id: 'h', type: 'hitl.confirm', config: { approveVar: 'ok' } }, approve)).toBe('ok')
    // config 里没有那个键 → 回落 defaultName（不是「config 有别的键就失效」）
    expect(resolveOutVarName({ id: 'x', type: 'tool', config: { anything: 'y' } }, outVar)).toBe('tool_result')
    // 无默认名的端口（citationsVar 可选）：未配置 → 空串（= 未命名，不产出可引用变量）
    const citations = contractOf('knowledge_retrieval')!.outputs[1]
    expect(citations.defaultName).toBeNull()
    expect(resolveOutVarName({ id: 'k', type: 'knowledge_retrieval', config: {} }, citations)).toBe('')
  })

  it('resolvedOutputsOf：过滤未命名端口，返回已解析变量名 + 类型', () => {
    // tool 未配 outputVar → 仍有一个产出（执行器会兜底写 tool_result，画布就该画出这个端口）
    const t = resolvedOutputsOf({ id: 'a', type: 'tool', config: {} })
    expect(t).toHaveLength(1)
    expect(t[0].varName).toBe('tool_result')
    // tool 配了 outputVar → 产出改名
    const r = resolvedOutputsOf({ id: 'a', type: 'tool', config: { outputVar: 'out' } })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ varName: 'out', dataType: 'object', configKey: 'outputVar' })
    // hitl.confirm 无 config → 默认产出 hitl_approved
    const h = resolvedOutputsOf({ id: 'h', type: 'hitl.confirm', config: {} })
    expect(h).toHaveLength(1)
    expect(h[0].varName).toBe('hitl_approved')
    // 无默认名且未配置 → 不产出（knowledge_retrieval 只出 retrieved，citationsVar 未命名被过滤）
    const k = resolvedOutputsOf({ id: 'k', type: 'knowledge_retrieval', config: {} })
    expect(k).toHaveLength(1)
    expect(k[0].varName).toBe('retrieved')
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
