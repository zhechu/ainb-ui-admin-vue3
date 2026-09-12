/**
 * 公式解析器与求值器的测试
 *
 * 求值部分读与后端同一份 formula-cases.json —— 这些用例守的是一件事：
 * 用户看到的合计与入库的合计必须相同。两边算得不一样不会有任何报错，
 * 只会在对账时发现数字对不上，那时已经很难追溯。
 *
 * 解析部分只在前端有（全系统唯一一份 parser），单独覆盖。
 */
import { describe, expect, it } from 'vitest'
import cases from './formula-cases.json'
import { FUNCTION_NAMES, parseFormula } from './parser'
import { evaluateFormula } from './evaluator'

const caseFile = cases as any

describe('公式求值器（跨端共享用例）', () => {
  for (const c of caseFile.cases as any[]) {
    it(c.name, () => {
      const actual = evaluateFormula(c.ast, c.data ?? {}, c.precision, c.rounding)
      if (c.expect === null) {
        expect(actual, `[${c.name}] 期望 null`).toBeNull()
        return
      }
      if (typeof c.expect === 'boolean') {
        expect(actual, `[${c.name}] 布尔结果不符`).toBe(c.expect)
        return
      }
      if (typeof c.expect === 'number') {
        expect(actual, `[${c.name}] 数值不符`).toBeCloseTo(c.expect, 9)
        return
      }
      expect(String(actual), `[${c.name}] 文本结果不符`).toBe(String(c.expect))
    })
  }

  it('求值不修改入参数据', () => {
    const data = { items: [{ price: 1 }] }
    const before = JSON.stringify(data)
    evaluateFormula(
      { type: 'call', name: 'SUM', args: [{ type: 'subfield', sub: 'items', field: 'price' }] },
      data
    )
    expect(JSON.stringify(data)).toBe(before)
  })
})

describe('公式解析器', () => {
  const astOf = (input: string) => {
    const r = parseFormula(input)
    expect(r.ok, `解析失败：${r.error}`).toBe(true)
    return r.ast
  }

  it('四则运算的优先级', () => {
    // 2 + 3 * 4 应当解析成 2 + (3 * 4)
    const ast: any = astOf('2 + 3 * 4')
    expect(ast.op).toBe('+')
    expect(ast.right.op).toBe('*')
    expect(evaluateFormula(ast, {})).toBe(14)
  })

  it('括号改变优先级', () => {
    expect(evaluateFormula(astOf('(2 + 3) * 4'), {})).toBe(20)
  })

  it('字段引用与子表字段引用', () => {
    const r = parseFormula('{amount} + SUM({items.price})')
    expect(r.ok).toBe(true)
    expect(r.fields).toEqual(['amount'])
    expect(r.subFields).toEqual(['items.price'])
    expect(evaluateFormula(r.ast, { amount: 5, items: [{ price: 10 }] })).toBe(15)
  })

  it('比较与逻辑运算', () => {
    expect(evaluateFormula(astOf('{a} > 1 AND {a} < 10'), { a: 5 })).toBe(true)
    expect(evaluateFormula(astOf('{a} > 1 OR {a} > 100'), { a: 0 })).toBe(false)
  })

  it('嵌套函数', () => {
    expect(evaluateFormula(astOf('ROUND(SUM({items.p}) / 3, 2)'), { items: [{ p: 10 }] })).toBe(3.33)
  })

  it('字符串字面量，单双引号都接受', () => {
    expect(evaluateFormula(astOf('CONCAT("a", \'b\')'), {})).toBe('ab')
  })

  it('IF 三目', () => {
    expect(evaluateFormula(astOf('IF({a} > 10, 1, 0)'), { a: 20 })).toBe(1)
  })

  it('空表达式视为无公式，不算错', () => {
    const r = parseFormula('')
    expect(r.ok).toBe(true)
    expect(r.ast).toBeUndefined()
  })

  // ==================== 解析期就该报错的写法 ====================

  const shouldFail: Array<[string, string, string?]> = [
    ['未知函数', 'FOO(1)', '不支持的函数'],
    ['缺右括号', 'ROUND(1', '缺少右括号'],
    ['缺左括号', 'ROUND 1', '要跟左括号'],
    ['字段引用没闭合', '{amount', '右花括号'],
    ['空字段引用', '{}', '空的'],
    ['字段名不合法', '{a-b}', '不合法'],
    ['字符串没闭合', 'CONCAT("abc', '引号'],
    ['参数个数不对', 'SUBSTR("abc", 1)', '需要'],
    ['末尾多余内容', '1 + 2 3', '多余'],
    ['无法识别的字符', '1 & 2', '无法识别'],
    ['数字格式不对', '1.2.3', '数字格式']
  ]

  for (const [label, input, expectMsg] of shouldFail) {
    it(`⚠️ ${label} 在解析期就报错：${input}`, () => {
      const r = parseFormula(input)
      expect(r.ok, `「${input}」应当解析失败`).toBe(false)
      expect(r.error).toBeTruthy()
      // 报错要能定位，否则用户对着一长串公式不知道改哪里
      expect(typeof r.position).toBe('number')
      if (expectMsg) expect(r.error).toContain(expectMsg)
    })
  }

  it('⚠️ 子表字段不能用在聚合函数之外 —— 那里拿到的是整个数组，算不出东西', () => {
    const r = parseFormula('{items.price} + 1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('只能用在聚合函数里')
  })

  it('⚠️ SUM 的参数必须是子表字段，写普通字段要报错而不是静默算成 null', () => {
    const r = parseFormula('SUM({amount})')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('必须是子表字段')
  })

  it('⚠️ 解析器不执行任何脚本：函数名不在白名单里一律拒绝', () => {
    for (const evil of [
      'eval("1")',
      'constructor("return 1")',
      'Function("x")',
      'require("fs")',
      'process()',
      'fetch("/x")'
    ]) {
      const r = parseFormula(evil)
      expect(r.ok, `「${evil}」必须被拒绝`).toBe(false)
    }
  })

  it('函数白名单不为空，且包含聚合与常用数学函数', () => {
    expect(FUNCTION_NAMES.length).toBeGreaterThan(0)
    for (const f of ['SUM', 'AVG', 'COUNT', 'ROUND', 'IF', 'CONCAT']) {
      expect(FUNCTION_NAMES).toContain(f)
    }
  })
})
