import { describe, expect, it, vi } from 'vitest'

const resolved: Array<{ field: string; deptValue: any }> = []
let failFields: string[] = []

vi.mock('./optionSource', () => ({
  collectRemoteOptionTasks: (rules: any[]) =>
    rules
      .filter((r) => r?.props?.dataSource?.interfaceCode)
      .map((rule) => ({
        rule,
        source: rule.props.dataSource,
        target: { path: 'options', tree: false, valueKey: 'value' },
        dependsOn: (rule.props.dataSource.params ?? [])
          .filter((p: any) => p.sourceType === 'formField' && p.field)
          .map((p: any) => p.field)
      })),
  resolveRemoteOptionTask: async (task: any, getFormValue: any) => {
    if (failFields.includes(task.rule.field)) {
      throw new Error('接口挂了')
    }
    resolved.push({ field: task.rule.field, deptValue: getFormValue?.('dept') })
  }
}))

import { createRemoteOptionRuntime } from './remoteOptionRuntime'

const ruleWithParam = (field: string, dependsOnField: string) => ({
  field,
  props: {
    dataSource: {
      interfaceCode: 'emp',
      params: [{ name: 'deptCode', sourceType: 'formField', field: dependsOnField }]
    }
  }
})

const ruleNoParam = (field: string) => ({
  field,
  props: { dataSource: { interfaceCode: 'dept' } }
})

const setup = (rules: any[], values: Record<string, any> = { dept: 'D01' }) => {
  resolved.length = 0
  failFields = []
  return createRemoteOptionRuntime(rules, (f) => values[f])
}

describe('依赖字段的收集', () => {
  it('只收集有入参依赖的任务的字段', () => {
    const runtime = setup([ruleNoParam('dept'), ruleWithParam('user', 'dept')])
    expect(runtime.dependentFields).toEqual(['dept'])
  })

  it('多个任务依赖同一个字段时不重复', () => {
    const runtime = setup([ruleWithParam('user', 'dept'), ruleWithParam('leader', 'dept')])
    expect(runtime.dependentFields).toEqual(['dept'])
  })

  it('没有任何数据接口来源时是空的', () => {
    expect(setup([{ field: 'a' }]).dependentFields).toEqual([])
    expect(setup([]).dependentFields).toEqual([])
  })
})

describe('打开表单时的重解析', () => {
  it('⚠️ 重解析时带上当前表单值', async () => {
    // 加载那一次没有传表单值，绑了字段的入参永远是空的 ——
    // 接口按空值查、返回空列表，下拉从头到尾一个选项都没有
    const runtime = setup([ruleWithParam('user', 'dept')], { dept: 'D02' })
    await runtime.resolveDependent()
    expect(resolved).toEqual([{ field: 'user', deptValue: 'D02' }])
  })

  it('没有依赖的任务不重复解析 —— 它们在加载时已经解析过了', async () => {
    const runtime = setup([ruleNoParam('dept'), ruleWithParam('user', 'dept')])
    await runtime.resolveDependent()
    expect(resolved.map((r) => r.field)).toEqual(['user'])
  })
})

describe('依赖变更时的重取', () => {
  it('只重取依赖了变更字段的那些任务', async () => {
    const runtime = setup([
      ruleWithParam('user', 'dept'),
      ruleWithParam('city', 'province')
    ])
    const refreshed = await runtime.refreshByFields(['dept'])
    expect(refreshed).toEqual(['user'])
    expect(resolved.map((r) => r.field)).toEqual(['user'])
  })

  it('变更的字段没有任何任务依赖时什么都不做', async () => {
    const runtime = setup([ruleWithParam('user', 'dept')])
    expect(await runtime.refreshByFields(['remark'])).toEqual([])
    expect(resolved).toEqual([])
  })

  it('返回被重取的字段名，供调用方清掉已选值', async () => {
    // 换了部门，原来选的人多半不在新部门里。留着会存进一条
    // 「部门是市场部、人员是研发部某人」的数据，而且不报错
    const runtime = setup([ruleWithParam('user', 'dept'), ruleWithParam('leader', 'dept')])
    const refreshed = await runtime.refreshByFields(['dept'])
    expect(refreshed.sort()).toEqual(['leader', 'user'])
  })
})

describe('容错', () => {
  it('⚠️ 单个接口失败不连坐其它任务', async () => {
    // 一个接口挂了不该让整张表单的下拉全空
    const runtime = setup([ruleWithParam('user', 'dept'), ruleWithParam('leader', 'dept')])
    failFields = ['user']
    const refreshed = await runtime.refreshByFields(['dept'])
    expect(refreshed).toEqual(['leader'])
  })

  it('全部失败时不抛异常', async () => {
    const runtime = setup([ruleWithParam('user', 'dept')])
    failFields = ['user']
    await expect(runtime.refreshByFields(['dept'])).resolves.toEqual([])
  })
})
