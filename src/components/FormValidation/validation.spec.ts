/**
 * 内置正则库与校验规则的单元测试
 *
 * 正则用例来自 `validation-patterns.json` 的 cases 段 —— 后端 JUnit 读的是同一份。
 *
 * 这不是「顺手也测一下」：同一个正则字符串交给 JS 与 Java 两个引擎，未必得到同样的
 * 结果。一旦漂移，用户遇到的是「界面上填好了但提交失败」，或反过来「该拦的没拦住」，
 * 而现象里没有任何线索指向「两侧正则引擎行为不同」。
 */

import { describe, expect, it } from 'vitest'
import patternFile from './validation-patterns.json'
import { BUILTIN_PATTERNS, compilePattern, getBuiltinPattern, testBuiltinPattern } from './patterns'
import {
  checkFieldValue,
  deriveUniqueValidateRule,
  deriveValidateRules,
  toScalarText
} from './fieldRules'
import { evaluateCrossFieldRules, parseCrossFieldRules } from './crossField'
import { applyValidateRules } from './index'
import type { CrossFieldRule, FieldValidationRule } from './types'

interface PatternCase {
  key: string
  value: string
  expected: boolean
}

const cases: PatternCase[] = (patternFile as any).cases ?? []

describe('内置正则库的跨端一致性用例', () => {
  it('用例集不是空的 —— 空用例集会让这一整组测试变成安慰剂', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const item of cases) {
    it(`${item.key}: "${item.value}" 应当${item.expected ? '匹配' : '不匹配'}`, () => {
      const pattern = getBuiltinPattern(item.key)
      expect(pattern, `用例引用了不存在的正则 key：${item.key}`).toBeTruthy()
      const compiled = compilePattern(pattern!.pattern)
      expect(compiled, `${item.key} 的正则编译失败`).toBeTruthy()
      expect(compiled!.test(item.value)).toBe(item.expected)
    })
  }
})

describe('正则库自身的完整性', () => {
  it('⚠️ 每条内置正则都要有用例 —— 没有用例的正则等于没有跨端一致性保障', () => {
    const missing = BUILTIN_PATTERNS.filter(
      (pattern) => !cases.some((item) => item.key.toUpperCase() === pattern.key.toUpperCase())
    ).map((pattern) => pattern.key)
    expect(missing, `这些正则没有任何用例：${missing.join('、')}`).toEqual([])
  })

  it('每条内置正则都能编译，且有展示名与兜底提示', () => {
    for (const pattern of BUILTIN_PATTERNS) {
      expect(compilePattern(pattern.pattern), `${pattern.key} 编译失败`).toBeTruthy()
      expect(pattern.label, `${pattern.key} 缺 label`).toBeTruthy()
      expect(pattern.message, `${pattern.key} 缺 message`).toBeTruthy()
    }
  })

  it('⚠️ 正则必须避开 Java 与 JS 行为不一致的语法', () => {
    for (const pattern of BUILTIN_PATTERNS) {
      // 后顾断言在旧 JS 引擎里直接抛 SyntaxError，表现为整个表单的校验初始化失败
      expect(pattern.pattern.includes('(?<'), `${pattern.key} 用了后顾断言或命名分组`).toBe(false)
      expect(pattern.pattern.includes('\\p{'), `${pattern.key} 用了 Unicode 属性`).toBe(false)
    }
  })

  it('认不出来的 key 一律放过 —— 拦下来会让一次正则库调整使存量表单集体失败', () => {
    expect(getBuiltinPattern('NOT_EXISTS')).toBeUndefined()
    expect(testBuiltinPattern('NOT_EXISTS', '随便什么')).toBe(true)
  })

  it('语法错误的正则返回 null 而不是抛异常', () => {
    expect(compilePattern('^[a-')).toBeNull()
    expect(compilePattern('^[a-z]+$')).toBeTruthy()
  })
})

describe('字段格式校验', () => {
  const mobileRule: FieldValidationRule[] = [{ type: 'BUILTIN', patternKey: 'MOBILE' }]

  it('格式不对时报错，格式正确时放过', () => {
    expect(checkFieldValue(mobileRule, 'abc')).toBe('请输入 11 位手机号')
    expect(checkFieldValue(mobileRule, '13812345678')).toBeUndefined()
  })

  it('⚠️ 空值不校验格式 —— 否则「非必填 + 有格式」的字段永远填不了空', () => {
    expect(checkFieldValue(mobileRule, '')).toBeUndefined()
    expect(checkFieldValue(mobileRule, null)).toBeUndefined()
    expect(checkFieldValue(mobileRule, undefined)).toBeUndefined()
  })

  it('数值型的值按字符串校验 —— 表单里的数字常常是 String，也常常是 Number', () => {
    const rule: FieldValidationRule[] = [{ type: 'BUILTIN', patternKey: 'POSITIVE_INTEGER' }]
    expect(checkFieldValue(rule, 12)).toBeUndefined()
    expect(checkFieldValue(rule, '12')).toBeUndefined()
    expect(checkFieldValue(rule, 0)).toBeTruthy()
  })

  it('⚠️ 非标量值跳过格式校验 —— 对数组做正则匹配得先编一套拼接语义', () => {
    expect(toScalarText(['a', 'b'])).toBeUndefined()
    expect(toScalarText({ a: 1 })).toBeUndefined()
    expect(checkFieldValue(mobileRule, ['abc'])).toBeUndefined()
  })

  it('自定义正则与自定义提示', () => {
    const rule: FieldValidationRule[] = [
      { type: 'REGEX', pattern: '^AB[0-9]{4}$', message: '必须是 AB 开头加 4 位数字' }
    ]
    expect(checkFieldValue(rule, 'XX1234')).toBe('必须是 AB 开头加 4 位数字')
    expect(checkFieldValue(rule, 'AB1234')).toBeUndefined()
  })

  it('⚠️ 正则语法错误时放过 —— 用户配错了正则，不该表现为他的输入被拒绝', () => {
    expect(checkFieldValue([{ type: 'REGEX', pattern: '^[a-' }], '随便什么')).toBeUndefined()
  })

  it('多条规则逐条校验，只报第一条不通过的', () => {
    const rules: FieldValidationRule[] = [
      { type: 'REGEX', pattern: '^[0-9]+$', message: '只能是数字' },
      { type: 'REGEX', pattern: '^.{6}$', message: '必须是 6 位' }
    ]
    expect(checkFieldValue(rules, 'abc')).toBe('只能是数字')
    expect(checkFieldValue(rules, '123')).toBe('必须是 6 位')
    expect(checkFieldValue(rules, '123456')).toBeUndefined()
  })

  it('停用的规则与配置不完整的规则都跳过', () => {
    expect(checkFieldValue([{ type: 'REGEX', pattern: '^[0-9]+$', enabled: false }], 'abc'))
      .toBeUndefined()
    // 选了内置库却没选具体哪条
    expect(checkFieldValue([{ type: 'BUILTIN' }], 'abc')).toBeUndefined()
  })

  it('缺 type 时按有没有 patternKey 推断 —— 少写一个字段不该让规则失效', () => {
    expect(checkFieldValue([{ patternKey: 'MOBILE' }], 'abc')).toBeTruthy()
    expect(checkFieldValue([{ pattern: '^[0-9]+$' }], 'abc')).toBeTruthy()
  })
})

describe('派生内核的 validate 条目', () => {
  it('没有可用规则时不产出条目 —— 空的 validator 会让内核每次输入都白跑一趟', () => {
    expect(deriveValidateRules(undefined)).toEqual([])
    expect(deriveValidateRules([])).toEqual([])
    expect(deriveValidateRules([{ type: 'BUILTIN' }])).toEqual([])
  })

  it('多条规则合成一条 validator —— 内核会展示全部错误，而我们的语义是只报第一条', () => {
    const derived = deriveValidateRules([
      { type: 'BUILTIN', patternKey: 'MOBILE' },
      { type: 'REGEX', pattern: '^138' }
    ])
    expect(derived).toHaveLength(1)
    expect(derived[0].trigger).toContain('blur')
  })

  it('派生出的 validator 行为与 checkFieldValue 一致', () => {
    const derived = deriveValidateRules([{ type: 'BUILTIN', patternKey: 'MOBILE' }])
    let error: Error | undefined
    derived[0].validator({}, 'abc', (e) => (error = e))
    expect(error?.message).toBe('请输入 11 位手机号')

    error = undefined
    derived[0].validator({}, '13812345678', (e) => (error = e))
    expect(error).toBeUndefined()
  })

  it('写入规则树时递归处理布局容器与子表，且重复调用不会堆叠', () => {
    const tree: any[] = [
      {
        type: 'col',
        children: [
          {
            type: 'input',
            field: 'phone',
            props: { validateRules: [{ type: 'BUILTIN', patternKey: 'MOBILE' }] }
          }
        ]
      },
      {
        type: 'group',
        field: 'items',
        props: {
          rule: [
            {
              type: 'input',
              field: 'mobile',
              props: { validateRules: [{ type: 'BUILTIN', patternKey: 'MOBILE' }] }
            }
          ]
        }
      }
    ]
    applyValidateRules(tree)
    expect(tree[0].children[0].validate).toHaveLength(1)
    expect(tree[1].props.rule[0].validate).toHaveLength(1)

    // 再来一次：上一次派生的先被清掉，不会变成两条
    applyValidateRules(tree)
    expect(tree[0].children[0].validate).toHaveLength(1)
  })

  it('保留用户/内核已有的 validate 条目', () => {
    const tree: any[] = [
      {
        type: 'input',
        field: 'phone',
        validate: [{ required: true, message: '必填' }],
        props: { validateRules: [{ type: 'BUILTIN', patternKey: 'MOBILE' }] }
      }
    ]
    applyValidateRules(tree)
    expect(tree[0].validate).toHaveLength(2)
    expect(tree[0].validate[0].required).toBe(true)
  })
})

describe('唯一性校验', () => {
  const context = (available: boolean) => ({
    check: () => Promise.resolve(available)
  })

  const runValidator = (rule: any, value: any): Promise<Error | undefined> =>
    new Promise((resolve) => rule.validator({}, value, resolve))

  it('值已被占用时报错，可用时放过', async () => {
    const taken = deriveUniqueValidateRule('mobile', context(false))
    expect(await runValidator(taken[0], '13812345678')).toBeInstanceOf(Error)

    const free = deriveUniqueValidateRule('mobile', context(true))
    expect(await runValidator(free[0], '13812345678')).toBeUndefined()
  })

  it('空值不发请求 —— 没填的字段谈不上重复', async () => {
    let called = false
    const rules = deriveUniqueValidateRule('mobile', {
      check: () => {
        called = true
        return Promise.resolve(false)
      }
    })
    expect(await runValidator(rules[0], '')).toBeUndefined()
    expect(await runValidator(rules[0], null)).toBeUndefined()
    expect(called, '空值不该触发查重请求').toBe(false)
  })

  it('⚠️ 请求失败时放过 —— 网络抖动不该让用户怎么改都提交不了', async () => {
    const rules = deriveUniqueValidateRule('mobile', {
      check: () => Promise.reject(new Error('网络错误'))
    })
    expect(await runValidator(rules[0], '13812345678')).toBeUndefined()
  })

  it('只挂 blur —— change 会在输入过程中每敲一个字符都查一次库', () => {
    const rules = deriveUniqueValidateRule('mobile', context(true))
    expect(rules[0].trigger).toEqual(['blur'])
  })

  it('没有上下文时不产出条目 —— 设计器预览里不该发查重请求', () => {
    expect(deriveUniqueValidateRule('mobile', undefined)).toEqual([])
  })

  it('写入规则树时挂在配了 uniqueCheck 的字段上', () => {
    const tree: any[] = [
      { type: 'input', field: 'mobile', props: { uniqueCheck: true } },
      { type: 'input', field: 'name', props: {} }
    ]
    applyValidateRules(tree, context(true))
    expect(tree[0].validate).toHaveLength(1)
    expect(tree[1].validate).toBeUndefined()
  })
})

describe('跨字段校验', () => {
  const dateRange: CrossFieldRule[] = [
    {
      id: 'r1',
      name: '日期区间',
      must: {
        logic: 'AND',
        items: [{ field: 'endDate', operator: 'GE', valueType: 'FIELD', value: 'startDate' }]
      },
      message: '结束日期不能早于开始日期'
    }
  ]

  it('结束日期早于开始日期被拦下 —— 靠的是文本字典序比较', () => {
    const violations = evaluateCrossFieldRules(dateRange, {
      startDate: '2026-09-10',
      endDate: '2026-09-01'
    })
    expect(violations).toHaveLength(1)
    expect(violations[0].message).toBe('结束日期不能早于开始日期')
  })

  it('日期正常时放过，相等也算通过', () => {
    expect(
      evaluateCrossFieldRules(dateRange, { startDate: '2026-09-01', endDate: '2026-09-10' })
    ).toEqual([])
    expect(
      evaluateCrossFieldRules(dateRange, { startDate: '2026-09-01', endDate: '2026-09-01' })
    ).toEqual([])
  })

  it('⚠️ 结束日期还没填时不拦 —— 否则表单填一半就开始报错', () => {
    expect(evaluateCrossFieldRules(dateRange, { startDate: '2026-09-01', endDate: '' })).toEqual([])
    expect(evaluateCrossFieldRules(dateRange, { startDate: '2026-09-01' })).toEqual([])
    // 右值那个字段还没填也一样
    expect(evaluateCrossFieldRules(dateRange, { startDate: '', endDate: '2026-09-01' })).toEqual([])
  })

  it('EMPTY / NOT_EMPTY 不受「操作数为空就跳过」影响 —— 它们问的就是「空不空」', () => {
    const rules: CrossFieldRule[] = [
      {
        id: 'r1',
        must: { items: [{ field: 'taxNo', operator: 'NOT_EMPTY' }] },
        message: '税号必填'
      }
    ]
    expect(evaluateCrossFieldRules(rules, { taxNo: '' })).toHaveLength(1)
    expect(evaluateCrossFieldRules(rules, {})).toHaveLength(1)
    expect(evaluateCrossFieldRules(rules, { taxNo: 'T9' })).toEqual([])
  })

  it('A 填了则 B 必填', () => {
    const rules: CrossFieldRule[] = [
      {
        id: 'r1',
        when: { items: [{ field: 'invoiceNo', operator: 'NOT_EMPTY' }] },
        must: { items: [{ field: 'taxNo', operator: 'NOT_EMPTY' }] },
        message: '填写发票号后，税号必填'
      }
    ]
    expect(evaluateCrossFieldRules(rules, { invoiceNo: '', taxNo: '' })).toEqual([])
    expect(evaluateCrossFieldRules(rules, { invoiceNo: 'A001', taxNo: '' })).toHaveLength(1)
    expect(evaluateCrossFieldRules(rules, { invoiceNo: 'A001', taxNo: 'T9' })).toEqual([])
  })

  it('A 与 B 不能同时为空', () => {
    const rules: CrossFieldRule[] = [
      {
        id: 'r1',
        when: { items: [{ field: 'mobile', operator: 'EMPTY' }] },
        must: { items: [{ field: 'email', operator: 'NOT_EMPTY' }] },
        message: '手机号与邮箱至少填一个'
      }
    ]
    expect(evaluateCrossFieldRules(rules, { mobile: '', email: '' })).toHaveLength(1)
    expect(evaluateCrossFieldRules(rules, { mobile: '138', email: '' })).toEqual([])
    expect(evaluateCrossFieldRules(rules, { mobile: '', email: 'a@b.c' })).toEqual([])
  })

  it('停用的规则与配置不完整的规则都跳过', () => {
    expect(
      evaluateCrossFieldRules(
        [{ id: 'r1', enabled: false, must: { items: [{ field: 'a', operator: 'NOT_EMPTY' }] }, message: 'x' }],
        { a: '' }
      )
    ).toEqual([])
    // 没有 must
    expect(evaluateCrossFieldRules([{ id: 'r1', message: 'x' }], { a: '' })).toEqual([])
    // 没有 message
    expect(
      evaluateCrossFieldRules(
        [{ id: 'r1', must: { items: [{ field: 'a', operator: 'NOT_EMPTY' }] } }],
        { a: '' }
      )
    ).toEqual([])
  })

  it('⚠️ 规则 JSON 坏掉时返回空数组，而不是让整张表单打不开', () => {
    expect(parseCrossFieldRules('{不是数组')).toEqual([])
    expect(parseCrossFieldRules(null)).toEqual([])
    expect(parseCrossFieldRules('[{"id":"r1"}]')).toHaveLength(1)
  })
})
