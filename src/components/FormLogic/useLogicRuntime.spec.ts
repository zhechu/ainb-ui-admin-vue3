/**
 * 联动运行时的单元测试
 *
 * 守的是「求值结果被正确地应用到表单上」这一段 —— 求值本身由
 * evaluator.spec.ts 与共享用例集覆盖，这里不重复。
 *
 * 重点在三件容易做错的事：
 * - 隐藏用 hidden 而不是 display（display 的隐藏字段仍参与校验，会让表单永远提交不了）
 * - 只对变化过的字段调 api（hidden/disabled 内部会刷新整表）
 * - 换记录时要清掉「已应用」记录，否则界面停留在上一条的样子
 */

import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { collectBaseState, useLogicRuntime } from './useLogicRuntime'
import type { LogicRule } from './types'

/** 假的 form-create api，记录所有调用 */
const createFakeApi = () => {
  const calls: Array<{ method: string; args: any[] }> = []
  const record = (method: string) => (...args: any[]) => calls.push({ method, args })
  return {
    calls,
    hidden: record('hidden'),
    disabled: record('disabled'),
    updateRule: record('updateRule'),
    setValue: record('setValue'),
    callsOf: (method: string) => calls.filter((c) => c.method === method)
  }
}

/** 「金额大于 100 时显示并要求填写原因」 */
const RULE_SHOW_REASON: LogicRule = {
  id: 'r1',
  trigger: 'CHANGE',
  when: { logic: 'AND', items: [{ field: 'amount', operator: 'GT', value: 100 }] },
  then: [
    { type: 'SHOW', target: 'reason' },
    { type: 'REQUIRE', target: 'reason' }
  ],
  otherwise: [
    { type: 'HIDE', target: 'reason' },
    { type: 'OPTIONAL', target: 'reason' }
  ]
}

const setup = (rules: LogicRule[], data: Record<string, any> = {}) => {
  const api = createFakeApi()
  const formData = ref<Record<string, any>>(data)
  const formRule = ref<any[]>([
    { type: 'inputNumber', field: 'amount' },
    { type: 'input', field: 'reason' }
  ])
  const runtime = useLogicRuntime({
    rules: () => rules,
    formRule: () => formRule.value,
    formData: () => formData.value,
    api: () => api
  })
  return { api, formData, formRule, runtime }
}

describe('取字段基础状态', () => {
  it('required 取自 $required，与服务端取法一致', () => {
    const state = collectBaseState([
      { field: 'a', $required: true },
      { field: 'b' },
      { type: 'col', children: [{ field: 'c', $required: true }] },
      { type: 'group', field: 'items', props: { rule: [{ field: 'd' }] } }
    ])
    expect(state.a.required).toBe(true)
    expect(state.b.required).toBe(false)
    // 布局容器与子表内部的字段都要收到 —— 漏掉就等于那部分字段没有基础状态
    expect(state.c.required).toBe(true)
    expect(state.d).toBeTruthy()
    // 默认可见可编辑
    expect(state.a.visible).toBe(true)
    expect(state.a.editable).toBe(true)
  })
})

describe('联动运行时', () => {
  it('⚠️ 隐藏用 hidden 而不是 display —— display 的隐藏字段仍参与校验', () => {
    const { api, runtime } = setup([RULE_SHOW_REASON], { amount: 1 })
    runtime.runOnLoad()

    const hidden = api.callsOf('hidden')
    expect(hidden.length).toBeGreaterThan(0)
    expect(hidden[hidden.length - 1].args).toEqual([true, 'reason'])
    // 没有任何一次调用 display
    expect(api.calls.some((c) => c.method === 'display')).toBe(false)
  })

  it('条件满足时显示并置为必填', () => {
    const { api, runtime } = setup([RULE_SHOW_REASON], { amount: 200 })
    runtime.runOnLoad()

    expect(api.callsOf('hidden').pop()?.args).toEqual([false, 'reason'])
    expect(api.callsOf('updateRule').pop()?.args).toEqual(['reason', { $required: true }])
  })

  it('⚠️ 条件从满足变回不满足时状态要恢复 —— 这是只写 then 不写 otherwise 的经典坑', async () => {
    const { api, formData, runtime } = setup([RULE_SHOW_REASON], { amount: 200 })
    runtime.runOnLoad()
    expect(api.callsOf('hidden').pop()?.args).toEqual([false, 'reason'])

    formData.value = { ...formData.value, amount: 50 }
    await nextTick()
    expect(api.callsOf('hidden').pop()?.args).toEqual([true, 'reason'])
    expect(api.callsOf('updateRule').pop()?.args).toEqual(['reason', { $required: false }])
  })

  it('⚠️ 只对变化过的字段调 api —— hidden/disabled 内部会刷新整表', async () => {
    const { api, formData, runtime } = setup([RULE_SHOW_REASON], { amount: 200 })
    runtime.runOnLoad()
    const countAfterLoad = api.callsOf('hidden').length

    // 改一个与规则无关的字段：不该产生任何新的状态应用
    formData.value = { ...formData.value, note: 'x' }
    await nextTick()
    expect(api.callsOf('hidden').length).toBe(countAfterLoad)

    // 改金额但结论不变（仍然 > 100）：同样不该重复应用
    formData.value = { ...formData.value, amount: 300 }
    await nextTick()
    expect(api.callsOf('hidden').length).toBe(countAfterLoad)
  })

  it('SET_VALUE 走 api.setValue 回写 —— 直接改外层对象 form-create 不一定跟上', () => {
    const rules: LogicRule[] = [
      {
        id: 'r1',
        trigger: 'CHANGE',
        when: { items: [{ field: 'type', operator: 'EQ', value: 'A' }] },
        then: [{ type: 'SET_VALUE', target: 'rate', payload: { value: 0.13 } }]
      }
    ]
    const { api, runtime } = setup(rules, { type: 'A' })
    runtime.runOnLoad()
    expect(api.callsOf('setValue').pop()?.args[0]).toEqual({ rate: 0.13 })
  })

  it('值没变时不回写 —— 无条件 setValue 会触发一轮多余的更新', () => {
    const rules: LogicRule[] = [
      {
        id: 'r1',
        trigger: 'CHANGE',
        when: { items: [{ field: 'type', operator: 'EQ', value: 'A' }] },
        then: [{ type: 'SET_VALUE', target: 'rate', payload: { value: 0.13 } }]
      }
    ]
    const { api, runtime } = setup(rules, { type: 'A', rate: 0.13 })
    runtime.runOnLoad()
    expect(api.callsOf('setValue')).toEqual([])
  })

  it('⚠️ 换记录时清掉「已应用」记录，否则界面停留在上一条的样子', () => {
    const { api, formData, runtime } = setup([RULE_SHOW_REASON], { amount: 200 })
    runtime.runOnLoad()
    const before = api.callsOf('hidden').length

    // 换一条记录，金额相同 —— 状态结论一样，但必须重新应用一次，
    // 因为 form-create 的实例是新的（弹窗重开）
    formData.value = { amount: 200 }
    runtime.runOnLoad()
    expect(api.callsOf('hidden').length).toBeGreaterThan(before)
  })

  it('⚠️ 行作用域规则不在前端跑 —— 字段 API 按字段名寻址，寻不到「第 3 行的备注」', () => {
    const rowScoped: LogicRule = { ...RULE_SHOW_REASON, id: 'r2', rowScope: 'items' }
    const { runtime } = setup([rowScoped], { amount: 200 })
    expect(runtime.applicableRules.value).toEqual([])
  })

  it('停用的规则不参与', () => {
    const { runtime } = setup([{ ...RULE_SHOW_REASON, enabled: false }], { amount: 200 })
    expect(runtime.applicableRules.value).toEqual([])
  })

  it('详情态不跑联动 —— 所有字段已置禁用，再改一堆状态是白费', () => {
    const api = createFakeApi()
    const runtime = useLogicRuntime({
      rules: () => [RULE_SHOW_REASON],
      formRule: () => [{ field: 'amount' }, { field: 'reason' }],
      formData: () => ({ amount: 200 }),
      api: () => api,
      enabled: () => false
    })
    runtime.runOnLoad()
    expect(api.calls).toEqual([])
  })

  it('单个字段应用失败不中断整轮 —— 最常见原因是规则引用了已删掉的字段', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const api = {
      hidden: () => {
        throw new Error('字段不存在')
      },
      disabled: () => {},
      updateRule: () => {},
      setValue: () => {}
    }
    const runtime = useLogicRuntime({
      rules: () => [RULE_SHOW_REASON],
      formRule: () => [{ field: 'amount' }, { field: 'reason' }],
      formData: () => ({ amount: 200 }),
      api: () => api
    })
    expect(() => runtime.runOnLoad()).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('没有 api 实例时不报错 —— 表单还没渲染完就可能被调到', () => {
    const runtime = useLogicRuntime({
      rules: () => [RULE_SHOW_REASON],
      formRule: () => [{ field: 'amount' }],
      formData: () => ({ amount: 200 }),
      api: () => undefined
    })
    expect(() => runtime.runOnLoad()).not.toThrow()
  })
})
