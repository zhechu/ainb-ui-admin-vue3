/**
 * 前端脚本运行时的单元测试
 *
 * 沙箱本身（屏蔽全局、超时、异常隔离）由 sandbox.spec.ts 覆盖，这里只测接线：
 * 什么时候执行、上下文里给了什么、钩子的返回值怎么影响提交。
 *
 * 最要紧的一条是**扩展模式互斥** —— extension_mode 的默认值就是「前端脚本」，
 * 接错的话要么默认模式下脚本不执行（补这一层之前就是这样），
 * 要么服务端扩展点模式下脚本也在跑，两边同时改数据。
 */

import { describe, expect, it, vi } from 'vitest'
import { useScriptRuntime } from './useScriptRuntime'

const createFakeApi = () => {
  const calls: Array<{ method: string; args: any[] }> = []
  const record = (method: string) => (...args: any[]) => calls.push({ method, args })
  return {
    calls,
    setValue: record('setValue'),
    hidden: record('hidden'),
    disabled: record('disabled'),
    updateRule: record('updateRule'),
    callsOf: (method: string) => calls.filter((c) => c.method === method)
  }
}

const createFakeMessage = () => {
  const shown: string[] = []
  return {
    shown,
    success: (t: string) => shown.push(`success:${t}`),
    warning: (t: string) => shown.push(`warning:${t}`),
    error: (t: string) => shown.push(`error:${t}`),
    confirm: vi.fn(() => Promise.resolve(true))
  }
}

const setup = (
  scripts: Record<string, string>,
  opts: { mode?: number; timeoutAction?: number; data?: Record<string, any> } = {}
) => {
  const api = createFakeApi()
  const message = createFakeMessage()
  const data = opts.data ?? { amount: 100 }
  const runtime = useScriptRuntime({
    scripts: () => scripts,
    extensionMode: () => opts.mode ?? 1,
    timeoutAction: () => opts.timeoutAction ?? 1,
    formData: () => data,
    api: () => api,
    message
  })
  return { api, message, data, runtime }
}

describe('扩展模式互斥', () => {
  it('⚠️ 只有「前端脚本」模式才执行 —— 这是与服务端扩展点互斥的唯一开关', () => {
    const script = { onLoad: "setVisible('reason', false)" }

    const enabled = setup(script, { mode: 1 })
    enabled.runtime.runOnLoad()
    expect(enabled.api.callsOf('hidden')).toHaveLength(1)

    // 模式 2 = 服务端扩展点：脚本一律不跑，否则两边同时改数据，
    // 「这个字段到底是谁改的」无从追查
    const serverMode = setup(script, { mode: 2 })
    serverMode.runtime.runOnLoad()
    expect(serverMode.api.calls).toEqual([])

    // 模式 0 = 无
    const none = setup(script, { mode: 0 })
    none.runtime.runOnLoad()
    expect(none.api.calls).toEqual([])
  })
})

describe('上下文 API', () => {
  it('setVisible 走 hidden 而不是 display —— 与联动运行时保持一致', () => {
    const { api, runtime } = setup({ onLoad: "setVisible('reason', false)" })
    runtime.runOnLoad()
    expect(api.callsOf('hidden')[0].args).toEqual([true, 'reason'])
    expect(api.calls.some((c) => c.method === 'display')).toBe(false)
  })

  it('setRequired / setDisabled / setFieldValue', () => {
    const { api, runtime } = setup({
      onLoad: "setRequired('reason', true); setDisabled('code', true); setFieldValue('rate', 0.13)"
    })
    runtime.runOnLoad()
    expect(api.callsOf('updateRule')[0].args).toEqual(['reason', { $required: true }])
    expect(api.callsOf('disabled')[0].args).toEqual([true, 'code'])
    expect(api.callsOf('setValue')[0].args).toEqual([{ rate: 0.13 }])
  })

  it('formData 是快照 —— 脚本直接改它不该影响表单', () => {
    const { data, runtime } = setup({ onLoad: 'formData.amount = 999' })
    runtime.runOnLoad()
    expect(data.amount, '脚本改的是副本，真实数据不该被改到').toBe(100)
  })

  it('getFieldValue 读的是实时数据', () => {
    const { api, runtime } = setup({
      onLoad: "if (getFieldValue('amount') === 100) { setVisible('x', false) }"
    })
    runtime.runOnLoad()
    expect(api.callsOf('hidden')).toHaveLength(1)
  })

  it('message 与 utils 可用', () => {
    const { message, api, runtime } = setup({
      onLoad: "message.success('好了'); setFieldValue('id', utils.uuid())"
    })
    runtime.runOnLoad()
    expect(message.shown).toEqual(['success:好了'])
    expect(api.callsOf('setValue')[0].args[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('onFieldChange', () => {
  it('changedField 以裸标识符注入', () => {
    const { api, runtime } = setup({
      onFieldChange: "if (changedField === 'amount') { setRequired('reason', true) }"
    })
    runtime.runOnFieldChange('amount')
    expect(api.callsOf('updateRule')).toHaveLength(1)

    runtime.runOnFieldChange('other')
    expect(api.callsOf('updateRule')).toHaveLength(1)
  })

  it('没配这个钩子时直接返回 —— 每次输入都会走到这里，不该白构造一次上下文', () => {
    const { api, runtime } = setup({})
    runtime.runOnFieldChange('amount')
    expect(api.calls).toEqual([])
  })
})

describe('beforeSubmit', () => {
  it('返回 false 阻断提交，返回 true 放行', async () => {
    const blocked = setup({ beforeSubmit: 'return false' })
    expect(await blocked.runtime.runBeforeSubmit()).toBe(false)

    const passed = setup({ beforeSubmit: 'return true' })
    expect(await passed.runtime.runBeforeSubmit()).toBe(true)
  })

  it('没配脚本或不是脚本模式时一律放行', async () => {
    expect(await setup({}).runtime.runBeforeSubmit()).toBe(true)
    expect(await setup({ beforeSubmit: 'return false' }, { mode: 2 }).runtime.runBeforeSubmit())
      .toBe(true)
  })

  it('⚠️ 脚本出错按阻断处理 —— 校验本身崩了却放行，等于把校验当不存在', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { runtime } = setup({ beforeSubmit: "throw new Error('校验失败')" })
    expect(await runtime.runBeforeSubmit()).toBe(false)
    error.mockRestore()
  })

  it('message.confirm 点取消时返回 false，而不是抛出未捕获的 rejection', async () => {
    const { message, runtime } = setup({ beforeSubmit: "return message.confirm('确认？')" })
    message.confirm.mockReturnValueOnce(Promise.reject(new Error('cancel')))
    expect(await runtime.runBeforeSubmit()).toBe(false)

    message.confirm.mockReturnValueOnce(Promise.resolve(true))
    expect(await runtime.runBeforeSubmit()).toBe(true)
  })
})

describe('afterSubmit 与异常隔离', () => {
  it('afterSubmit 正常执行', () => {
    const { message, runtime } = setup({ afterSubmit: "message.success('提交成功')" })
    runtime.runAfterSubmit()
    expect(message.shown).toEqual(['success:提交成功'])
  })

  it('⚠️ 非提交钩子出错只记日志，不中断填表 —— 一个写错的脚本不该让整张表单打不开', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { runtime } = setup({
      onLoad: "throw new Error('boom')",
      onFieldChange: "throw new Error('boom')",
      afterSubmit: "throw new Error('boom')"
    })
    expect(() => runtime.runOnLoad()).not.toThrow()
    expect(() => runtime.runOnFieldChange('a')).not.toThrow()
    expect(() => runtime.runAfterSubmit()).not.toThrow()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('沙箱屏蔽仍然生效 —— 脚本里的 window 是 undefined', () => {
    const { api, runtime } = setup({
      onLoad: "if (typeof window === 'undefined') { setVisible('ok', false) }"
    })
    runtime.runOnLoad()
    expect(api.callsOf('hidden')).toHaveLength(1)
  })
})
