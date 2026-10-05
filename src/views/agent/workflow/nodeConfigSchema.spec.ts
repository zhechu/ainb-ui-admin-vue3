import { describe, expect, it } from 'vitest'
import { NODE_TYPE_OPTIONS, defaultConfig } from './editorModel'
import {
  NODE_CONFIG_SCHEMA,
  WAIT_TYPE,
  fieldsFor,
  isFieldVisible,
  jsonHintFor,
  type ConfigField
} from './nodeConfigSchema'

/**
 * nodeConfigSchema 纯逻辑单测（增量16A / P4 编辑器第二子刀：结构化节点配置面板）
 *
 * 钉住面板 schema 的命门：① NODE_TYPE_OPTIONS 里每种可拖入类型都有 schema（拖出来的节点不会只剩裸 JSON；
 * 该列表由 nodeSummary 的 NODE_TYPE_META 派生，故这里**不写死数量** —— 头注曾写「8 种」而真实是 13 种）；
 * ② 字段键唯一、
 * kind 合法、select 必有选项来源；③ 字段键逐字对齐后端执行器读取的 config 键（抽查关键类型）；
 * ④ showIf 条件显隐正确（wait 按 waitType 分支）；⑤ 认不出的类型 fail-soft 返回空；
 * ⑥ 面板 hint 不许承诺运行期不会发生的事（hint 是用户唯一看得到的说明书，会被照做）；
 * ⑦ wait 的 waitType 取值全集逐字对齐后端 `WaitTypeEnum`，且 showIf / 预填值都指得到真实选项（缺陷 E2）。
 * 全是纯函数，不碰 Vue。
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
    const kinds = new Set(['text', 'textarea', 'number', 'select', 'switch', 'tags', 'kv'])
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

  /**
   * 🔴 waitType 的取值全集（缺陷 E2）
   *
   * 后端权威是 Java 的 `WaitTypeEnum`，前端这一份是**副本**：两仓之间没有代码生成，
   * 改了一边另一边不会编译失败，只会静默地继续教旧取值。这一条就是那个「改了一边」的报警。
   *
   * 四条断言各挡一种死法：
   * ① 取值逐字对不上后端 ⟹ 用户选出来的东西发布时被拒；
   * ② `showIf.equals` 指向一个面板上选不出来的值 ⟹ 选了那一档、字段永远不显示，
   *    既填不了也没有任何报错（与本模块最常见的「配置保存成功但不生效且无提示」同一种死法）；
   * ③ 某一档一个字段都不跟 ⟹ 选了之后面板是空的，用户不知道该填什么；
   * ④ 新建节点预填的那一档选不出来 ⟹ 拖出来就是个配不了的节点。
   */
  it('waitType 的选项值逐字对齐后端支持的两档，且 showIf / 预填值都指得到真实选项', () => {
    // ① 逐字钉住常量本身：它是全前端唯一那份副本
    expect(Object.values(WAIT_TYPE)).toEqual(['duration', 'event'])

    const fields = fieldsFor('wait')
    const waitType = fields.find((f) => f.key === 'waitType')!
    const optionValues = (waitType.options ?? []).map((o) => String(o.value))
    expect(optionValues, '面板上摆出来的选项必须恰好是后端支持的那两档（多一档就是教人去踩编译器会拒的坑）').toEqual([
      WAIT_TYPE.DURATION,
      WAIT_TYPE.EVENT
    ])

    // ② showIf 指得到
    for (const f of fields) {
      if (f.showIf?.key === 'waitType') {
        expect(optionValues, `${f.key} 的 showIf 指向了一个面板上选不出来的值`).toContain(String(f.showIf.equals))
      }
    }
    // ③ 每一档都至少带出一格
    for (const v of optionValues) {
      const shown = fields.filter((f) => f.showIf?.key === 'waitType' && String(f.showIf.equals) === v)
      expect(shown.length, `选了「${v}」之后至少要显示出它自己那一格`).toBeGreaterThan(0)
    }
    // ④ 预填值选得出来
    expect(optionValues, 'editorModel 给新建 wait 节点预填的那一档，必须是面板上选得出来的').toContain(
      String(defaultConfig('wait').waitType)
    )
  })

  it('jsonHintFor：结构化覆盖后仅 condition.rule 的嵌套条件组保留 JSON 提示', () => {
    // args/choices/formVars 已有 kv/tags 结构化编辑器，parallel.branches 有可视化面板 → 不再提示走 JSON
    expect(jsonHintFor('tool')).toBe('')
    expect(jsonHintFor('condition.llm')).toBe('')
    expect(jsonHintFor('hitl.bpm_approval')).toBe('')
    expect(jsonHintFor('parallel')).toBe('')
    // condition.rule 仅剩「嵌套 AND/OR 复杂条件」建议走开发者模式的 JSON
    expect(jsonHintFor('condition.rule')).toContain('开发者模式')
    // llm / hitl.confirm 无复杂嵌套键 → 无提示
    expect(jsonHintFor('llm')).toBe('')
    expect(jsonHintFor('hitl.confirm')).toBe('')
  })

  it('3 种合成子图类型（agent_loop/iteration/sub_workflow）字段键对齐后端 GraphBuilder', () => {
    const keysOf = (t: string) => fieldsFor(t).map((f) => f.key)
    expect(keysOf('agent_loop')).toEqual(expect.arrayContaining(['goal', 'tools', 'maxSteps', 'outputVar']))
    expect(keysOf('iteration')).toEqual(expect.arrayContaining(['itemsVar', 'itemVar', 'body']))
    expect(keysOf('sub_workflow')).toEqual(expect.arrayContaining(['workflowId', 'version']))
    // tool.args / condition.llm.choices / hitl.bpm_approval.formVars 已结构化
    expect(fieldsFor('tool').find((f) => f.key === 'args')?.kind).toBe('kv')
    expect(fieldsFor('condition.llm').find((f) => f.key === 'choices')?.kind).toBe('tags')
    expect(fieldsFor('hitl.bpm_approval').find((f) => f.key === 'formVars')?.kind).toBe('kv')
    // sub_workflow.workflowId 的 select 走已发布流程目录
    expect(fieldsFor('sub_workflow').find((f) => f.key === 'workflowId')?.optionsFrom).toBe('workflow')
  })

  it('fieldsFor/jsonHintFor：认不出的类型 fail-soft 返回空', () => {
    expect(fieldsFor('nonexistent.type')).toEqual([])
    expect(fieldsFor(undefined)).toEqual([])
    expect(fieldsFor(null)).toEqual([])
    expect(jsonHintFor('nonexistent.type')).toBe('')
    expect(jsonHintFor(undefined)).toBe('')
  })

  /**
   * 🔴 面板 hint 是用户唯一看得到的那份说明书（WorkflowPropertyPanel.vue 渲染的就是这里的 f.hint，
   *    **不是** editor/nodeIoContract.ts 里那份 —— 那份的 InPort.hint 在前端根本没有消费者）。
   *    所以「hint 承诺了运行期不会发生的事」是会被用户照做的，不是无害的文案瑕疵。
   *
   * formVars 的旧 hint 写着「值支持 {{$.变量}} 引用前序结果」，而后端 resolveConfig 用 configMap 原样取、
   * createApproval 原样 setVariables 交给 Flowable，压根不过 StateTemplateResolver ⟹ 用户按提示写占位符，
   * 审批表单里收到的就是字面串 {{$.xxx}}，全程无报错。
   *
   * 🔴 先肯定再否定：只有 tool.args 那条「确实支持」的断言先立住，formVars 那条「不支持」才有意义 ——
   *    否则把两条 hint 一起改成什么都别说，否定式断言照样全绿。
   */
  it('面板 hint 不许承诺运行期不会发生的模板替换（args 支持 / formVars 不支持）', () => {
    const argsHint = fieldsFor('tool').find((f) => f.key === 'args')?.hint ?? ''
    expect(argsHint, 'args 的顶层字符串值确实走 StateTemplateResolver，hint 要说清支持').toContain('{{$.变量}}')
    expect(argsHint, 'args 只解析顶层字符串值，不交代这点用户会把它嵌进对象里').toContain('嵌在对象/数组里的不替换')

    const formVarsHint = fieldsFor('hitl.bpm_approval').find((f) => f.key === 'formVars')?.hint ?? ''
    expect(formVarsHint, 'formVars 必须明说占位符不生效，不能只是「不提」').toContain('不会被替换')
    expect(formVarsHint, 'formVars 的值原样进审批流程，不许再承诺支持引用').not.toContain('支持 {{$.变量}}')
  })

  /**
   * 🔴 iteration.itemVar 的 hint 是同一类缺陷的第二个实例，且比 formVars 更隐蔽：
   *    它教作者引用一个**字面名叫 itemVar 的键**，而运行期当前项写在作者自己填的那个名字下
   *    （IterationGraphBuilder 用 configStr("itemVar") 取到名字、再 delta.put 那个名字）。
   *    照旧 hint 写 ⟹ 取到空值，且**全程零报错**（模板解析不出来就是空串）。
   *
   * 旧文案：placeholder「每项写入的变量名，缺省 item」+ hint「循环体节点用 {{$.itemVar}} 取当前项。」
   *    —— 同一条错话在两个仓里有四份副本（本文件、editor/nodeIoContract.ts 的镜像 hint、
   *    后端 NodeIoContract 的 hint、UntrustedInputTracer 的注释），#97 一并改掉。
   */
  it('面板 hint 不许教作者引用「字段键名」本身（iteration.itemVar 是写入目标，不是读取来源）', () => {
    const itemVar = fieldsFor('iteration').find((f) => f.key === 'itemVar')!
    // 肯定：必须说清「引用的是你自己填的那个名」，并交代必填（后端缺它直接编译失败）
    expect(itemVar.hint, 'hint 要点明引用的是作者填的名字，不是键名 itemVar').toContain('{{$.这里填的名字}}')
    expect(itemVar.hint, '后端 IterationGraphBuilder 缺 itemVar 直接编译失败，hint 不许让它看着可选').toContain(
      '必填'
    )
    // 🔴 否定：这一条就是「四份副本都清干净了吗」的强制点 —— 把任何一份改回旧文案都会红
    expect(itemVar.hint, '不许再教作者引用字面的 itemVar 键').not.toContain('{{$.itemVar}}')
    expect(itemVar.placeholder ?? '', 'placeholder 同理').not.toContain('{{$.itemVar}}')

    // 🔴 hint 里点名的「预填值」必须与 defaultConfig 的真实预填一致，不许两头各写一个字面量。
    //    改了 defaultConfig 的预填而忘了改 hint，这条会红（反之亦然）——
    //    否则「保持预填值时就是 {{$.item}}」会变成一句指向不存在缺省的假话。
    expect(itemVar.hint).toContain(`{{$.${defaultConfig('iteration').itemVar}}}`)
    // placeholder 也不许再承诺「缺省」：后端没有这个缺省，有的只是前端拖出节点时的预填
    expect(itemVar.placeholder ?? '').toContain('预填')
    expect(itemVar.placeholder ?? '').not.toContain('缺省')
  })
})
