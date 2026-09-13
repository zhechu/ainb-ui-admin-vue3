import { describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/dict', () => ({
  getDictLabel: (dictType: string, value: any) =>
    dictType === 'order_status' && String(value) === '1' ? '已完成' : String(value)
}))

vi.mock('@/utils/formatTime', () => ({
  formatDate: (value: any, pattern: string) => `${value}|${pattern}`
}))

import {
  CELL_FORMATTERS,
  cellRenderKind,
  EMPTY_CELL,
  formatCellText,
  formatSummaryValue,
  isEmptyCellValue,
  parseCellFiles,
  resolveCellLink,
  tagTypeOf
} from './listCell'

describe('渲染分支', () => {
  it('四种非文本格式化各自成一类，其余都是文本', () => {
    expect(cellRenderKind({ type: 'TAG' })).toBe('TAG')
    expect(cellRenderKind({ type: 'LINK' })).toBe('LINK')
    expect(cellRenderKind({ type: 'IMAGE' })).toBe('IMAGE')
    expect(cellRenderKind({ type: 'FILE' })).toBe('FILE')
    expect(cellRenderKind({ type: 'DICT' })).toBe('TEXT')
    expect(cellRenderKind(undefined)).toBe('TEXT')
  })

  it('清单里每一项都能被分支函数认出来', () => {
    CELL_FORMATTERS.forEach(({ value }) => {
      expect(() => cellRenderKind({ type: value })).not.toThrow()
    })
  })
})

describe('文本格式化', () => {
  it('空值统一显示占位符', () => {
    expect(formatCellText(null, { type: 'DICT' })).toBe(EMPTY_CELL)
    expect(formatCellText(undefined, undefined)).toBe(EMPTY_CELL)
    expect(formatCellText('', { type: 'NUMBER' })).toBe(EMPTY_CELL)
  })

  it('数字 0 不是空值', () => {
    // 0 被当空会让「数量 0」的行显示成 -，看起来像没数据
    expect(isEmptyCellValue(0)).toBe(false)
    expect(formatCellText(0, { type: 'NUMBER', precision: 2 })).toBe('0.00')
  })

  it('字典与标签取同一份翻译文案', () => {
    // 两处各写一遍会出现「列表翻译了、标签上还是编码」
    expect(formatCellText('1', { type: 'DICT', dictType: 'order_status' })).toBe('已完成')
    expect(formatCellText('1', { type: 'TAG', dictType: 'order_status' })).toBe('已完成')
  })

  it('没配字典类型时原样显示，不显示成空', () => {
    expect(formatCellText('1', { type: 'DICT' })).toBe('1')
  })

  it('数字按精度与千分位格式化', () => {
    expect(formatCellText(1234.567, { type: 'NUMBER', precision: 2 })).toBe('1234.57')
    expect(formatCellText(1234.567, { type: 'NUMBER', precision: 2, thousands: true })).toBe(
      '1,234.57'
    )
  })

  it('非数字走数字格式化时原样返回，不返回 NaN', () => {
    expect(formatCellText('abc', { type: 'NUMBER' })).toBe('abc')
  })

  it('百分比默认按库里存小数换算', () => {
    expect(formatCellText(0.1523, { type: 'PERCENT' })).toBe('15.23%')
    expect(formatCellText(0.1523, { type: 'PERCENT', precision: 0 })).toBe('15%')
  })

  it('百分比可声明库里已经是百分数', () => {
    expect(formatCellText(15.23, { type: 'PERCENT', alreadyScaled: true })).toBe('15.23%')
  })

  it('布尔值的四种真值写法都认', () => {
    ;[true, 1, '1'].forEach((v) => expect(formatCellText(v, { type: 'BOOLEAN' })).toBe('是'))
    expect(formatCellText(0, { type: 'BOOLEAN' })).toBe('否')
    expect(formatCellText('0', { type: 'BOOLEAN' })).toBe('否')
  })
})

describe('标签颜色', () => {
  it('同一个值每次都得到同一个颜色', () => {
    // 翻页时同一状态变色，看起来像数据变了
    const first = tagTypeOf('APPROVED', {})
    expect(tagTypeOf('APPROVED', {})).toBe(first)
    expect(tagTypeOf('APPROVED', {})).toBe(first)
  })

  it('用户配了映射时优先用映射', () => {
    expect(tagTypeOf('1', { tagTypes: { '1': 'success' } })).toBe('success')
  })

  it('映射里配了非法类型时回落到自动配色，而不是渲染出坏标签', () => {
    expect(tagTypeOf('1', { tagTypes: { '1': 'rainbow' } })).not.toBe('rainbow')
  })
})

describe('附件与图片值解析', () => {
  it('标准对象数组形态', () => {
    expect(parseCellFiles([{ name: '合同.pdf', url: '/f/a.pdf' }])).toEqual([
      { name: '合同.pdf', url: '/f/a.pdf' }
    ])
  })

  it('库里存的 JSON 字符串', () => {
    expect(parseCellFiles('[{"name":"图.png","url":"/f/b.png"}]')).toEqual([
      { name: '图.png', url: '/f/b.png' }
    ])
  })

  it('裸 URL 字符串（单图、签名的落库形态）', () => {
    expect(parseCellFiles('/f/sign.png')).toEqual([{ name: 'sign.png', url: '/f/sign.png' }])
  })

  it('对象里没有 name 时从 URL 末段取文件名', () => {
    expect(parseCellFiles([{ url: '/f/2026/c.docx' }])).toEqual([
      { name: 'c.docx', url: '/f/2026/c.docx' }
    ])
  })

  it('URL 带查询串时文件名不把查询串算进去', () => {
    expect(parseCellFiles('/f/d.png?v=2')[0].name).toBe('d.png')
  })

  it('坏 JSON 返回空数组而不是抛异常', () => {
    // 一列坏数据不该让整张列表白屏
    expect(parseCellFiles('[{bad json')).toEqual([])
  })

  it('空值返回空数组', () => {
    expect(parseCellFiles(null)).toEqual([])
    expect(parseCellFiles('')).toEqual([])
  })

  it('数组里混入坏元素时只丢那一个', () => {
    expect(parseCellFiles([{ url: '/f/a.png' }, 42, null])).toEqual([
      { name: 'a.png', url: '/f/a.png' }
    ])
  })
})

describe('超链接', () => {
  it('安全地址渲染成链接', () => {
    expect(resolveCellLink('https://example.com/a', {})).toEqual({
      url: 'https://example.com/a',
      text: 'https://example.com/a'
    })
  })

  it('可以配置固定的链接文案', () => {
    expect(resolveCellLink('https://example.com/a', { linkText: '查看' }).text).toBe('查看')
  })

  it('不安全地址降级成纯文本，不给出 url', () => {
    // 渲染成点不动的链接比直接显示文字更费解
    expect(resolveCellLink('javascript:alert(1)', {}).url).toBeUndefined()
  })
})

describe('合计行的显示值', () => {
  it('跟随列的数字格式化，与数据行同一个样子', () => {
    // 缺陷：合计行原本一律 toFixed(2)，列配了「0 位小数 + 千分位」时
    // 数据行显示 1,234、合计行显示 1234.00，看着像两套数
    const formatter = { type: 'NUMBER', precision: 0, thousands: true }
    expect(formatCellText(1234, formatter)).toBe('1,234')
    expect(formatSummaryValue(1234, formatter)).toBe('1,234')
  })

  it('小数位与千分位都照列配的来', () => {
    expect(formatSummaryValue(1234567.891, { type: 'NUMBER', precision: 2, thousands: true })).toBe(
      '1,234,567.89'
    )
    expect(formatSummaryValue(1234567.891, { type: 'NUMBER', precision: 3 })).toBe('1234567.891')
  })

  it('没配格式化时输出裸数字，不硬补两位小数', () => {
    expect(formatSummaryValue(1234, undefined)).toBe('1234')
    expect(formatSummaryValue(15.5, { type: 'NONE' })).toBe('15.5')
  })

  it('抹掉浮点累加的尾巴', () => {
    // 0.1 + 0.2 = 0.30000000000000004，原样印在合计行上比少两位小数更难解释
    expect(formatSummaryValue(0.1 + 0.2, undefined)).toBe('0.3')
    expect(formatSummaryValue(0.1 + 0.2, { type: 'NUMBER', precision: 2 })).toBe('0.30')
  })

  it('百分比列照 PERCENT 印出来，不悄悄换一种显示', () => {
    // 百分比相加在业务上没意义，但配错了就该看着像配错了
    expect(formatSummaryValue(1.5, { type: 'PERCENT', precision: 1 })).toBe('150.0%')
  })

  it('合计是 0 时显示 0 而不是占位符', () => {
    // 走 formatCellText 的分支要确认 0 没被当成空值
    expect(formatSummaryValue(0, { type: 'NUMBER', precision: 2 })).toBe('0.00')
    expect(formatSummaryValue(0, undefined)).toBe('0')
  })
})
