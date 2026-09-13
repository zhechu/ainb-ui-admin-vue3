import { describe, expect, it, vi } from 'vitest'

// listCell 会 import 字典与时间工具，它们依赖运行时环境；这里只用到
// isEmptyCellValue 一个纯函数，把依赖挡掉
vi.mock('@/utils/dict', () => ({ getDictLabel: (_t: string, v: any) => String(v) }))
vi.mock('@/utils/formatTime', () => ({ formatDate: (v: any) => String(v) }))

import { attachMergeSpans, computeMergeSpans, MERGE_SPAN_KEY, mergeSpanOf } from './cellMerge'

/** 把结果压成「每行每列的 span」的紧凑写法，断言起来一眼能看懂 */
const spansOf = (rows: any[], props: string[]) =>
  computeMergeSpans(rows, props).map((map) => props.map((p) => map[p]))

describe('单列合并', () => {
  it('相邻同值合并成一格，段首带 rowspan、其余行为 0', () => {
    const rows = [{ t: 'A' }, { t: 'A' }, { t: 'A' }, { t: 'B' }, { t: 'B' }]
    expect(spansOf(rows, ['t'])).toEqual([[3], [0], [0], [2], [0]])
  })

  it('同值但不相邻，不合并', () => {
    // 合并的是相邻单元格。不相邻的同值要合并就得改变行的位置，那是排序的事
    const rows = [{ t: 'A' }, { t: 'B' }, { t: 'A' }]
    expect(spansOf(rows, ['t'])).toEqual([[1], [1], [1]])
  })

  it('全部同值时合成一整格', () => {
    const rows = [{ t: 'A' }, { t: 'A' }, { t: 'A' }]
    expect(spansOf(rows, ['t'])).toEqual([[3], [0], [0]])
  })

  it('单行与空数组都不出错', () => {
    expect(spansOf([{ t: 'A' }], ['t'])).toEqual([[1]])
    expect(computeMergeSpans([], ['t'])).toEqual([])
  })

  it('没有合并列时每行都是空映射', () => {
    expect(computeMergeSpans([{ t: 'A' }, { t: 'A' }], [])).toEqual([{}, {}])
  })

  it('数字与字符串的同值按显示值比，不因类型不同而分段', () => {
    // 列表数据来自接口，同一列在不同记录上可能一个是 1、一个是 '1'
    expect(spansOf([{ t: 1 }, { t: '1' }], ['t'])).toEqual([[2], [0]])
  })
})

describe('空值', () => {
  it('连续空值不合并，各自成一格', () => {
    // 并成一个跨多行的 `-` 大格，看着像渲染坏了
    const rows = [{ t: null }, { t: null }, { t: '' }, { t: undefined }]
    expect(spansOf(rows, ['t'])).toEqual([[1], [1], [1], [1]])
  })

  it('空值把前后两段同值的行隔开，不会粘起来', () => {
    const rows = [{ t: 'A' }, { t: null }, { t: 'A' }]
    expect(spansOf(rows, ['t'])).toEqual([[1], [1], [1]])
  })

  it('数字 0 不是空值，照常参与合并', () => {
    expect(spansOf([{ t: 0 }, { t: 0 }], ['t'])).toEqual([[2], [0]])
  })
})

describe('级联合并', () => {
  it('前一列换段时，后一列必须跟着换段', () => {
    // 不级联的话，「测试」会跨过软件与集成两个类型 —— 单元格是齐的，语义是错的
    const rows = [
      { t: '软件', p: '开发' },
      { t: '软件', p: '测试' },
      { t: '集成', p: '测试' }
    ]
    expect(spansOf(rows, ['t', 'p'])).toEqual([
      [2, 1],
      [0, 1],
      [1, 1]
    ])
  })

  it('前两列都同值时，第三列才继续合并', () => {
    const rows = [
      { t: 'A', p: 'X', o: '张' },
      { t: 'A', p: 'X', o: '张' },
      { t: 'A', p: 'Y', o: '张' }
    ]
    expect(spansOf(rows, ['t', 'p', 'o'])).toEqual([
      [3, 2, 2],
      [0, 0, 0],
      [0, 1, 1]
    ])
  })

  it('第一列一直同值时，后面的列各自按自己的段合并', () => {
    const rows = [
      { t: 'A', p: 'X' },
      { t: 'A', p: 'X' },
      { t: 'A', p: 'Y' },
      { t: 'A', p: 'Y' }
    ]
    expect(spansOf(rows, ['t', 'p'])).toEqual([
      [4, 2],
      [0, 0],
      [0, 2],
      [0, 0]
    ])
  })

  it('顺序决定级联方向：调换两列的顺序结果不同', () => {
    const rows = [
      { t: 'A', p: 'X' },
      { t: 'B', p: 'X' }
    ]
    // t 在前：t 换段打断 p，p 不合并
    expect(spansOf(rows, ['t', 'p'])).toEqual([
      [1, 1],
      [1, 1]
    ])
    // p 在前：p 先合并两行，t 各自成段
    expect(spansOf(rows, ['p', 't'])).toEqual([
      [2, 1],
      [0, 1]
    ])
  })

  it('前一列出现空值时，后一列也从这一行重新起段', () => {
    const rows = [
      { t: 'A', p: 'X' },
      { t: null, p: 'X' },
      { t: 'A', p: 'X' }
    ]
    const spans = spansOf(rows, ['t', 'p'])
    expect(spans[0]).toEqual([1, 1])
    expect(spans[1]).toEqual([1, 1])
    expect(spans[2]).toEqual([1, 1])
  })
})

describe('挂到行上', () => {
  it('返回新对象，不改原数组', () => {
    const rows = [{ t: 'A' }, { t: 'A' }]
    const result = attachMergeSpans(rows, ['t'])
    expect(rows[0]).not.toHaveProperty(MERGE_SPAN_KEY)
    expect(result[0][MERGE_SPAN_KEY]).toEqual({ t: 2 })
    expect(result[1][MERGE_SPAN_KEY]).toEqual({ t: 0 })
  })

  it('没有合并列时原样返回，不做无谓的拷贝', () => {
    const rows = [{ t: 'A' }]
    expect(attachMergeSpans(rows, [])).toBe(rows)
  })
})

describe('取 rowspan', () => {
  it('取不到时返回 1，而不是 0', () => {
    // 0 会让这一格整个消失；「取不到」只说明这列没开合并
    expect(mergeSpanOf({}, 'x')).toBe(1)
    expect(mergeSpanOf(undefined, 'x')).toBe(1)
    expect(mergeSpanOf({ [MERGE_SPAN_KEY]: {} }, 'x')).toBe(1)
    expect(mergeSpanOf({ [MERGE_SPAN_KEY]: { x: 3 } }, undefined)).toBe(1)
  })

  it('取得到时如实返回，含 0', () => {
    expect(mergeSpanOf({ [MERGE_SPAN_KEY]: { x: 3 } }, 'x')).toBe(3)
    expect(mergeSpanOf({ [MERGE_SPAN_KEY]: { x: 0 } }, 'x')).toBe(0)
  })
})
