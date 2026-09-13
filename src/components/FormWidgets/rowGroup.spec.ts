import { describe, expect, it } from 'vitest'

import {
  buildGroupedRows,
  GROUP_ROW_FLAG,
  initialCollapsedKeys,
  isGroupRow,
  isRowGroupUsable,
  toggleGroupKey,
  type RowGroupConfig
} from './rowGroup'

const CONF: RowGroupConfig = { enabled: true, field: 't', summaryFields: ['amount'] }
/** 标题就是原值加个前缀，便于断言「标题来自格式化、分组来自原值」 */
const labelOf = (value: any) => (value === null || value === undefined || value === '' ? '-' : `【${value}】`)

const build = (rows: any[], conf = CONF, collapsed = new Set<string>()) =>
  buildGroupedRows(rows, conf, labelOf, collapsed)

describe('配置可用性', () => {
  it('没开、或开了但没配分组字段，都当作没开', () => {
    expect(isRowGroupUsable(undefined)).toBe(false)
    expect(isRowGroupUsable({ enabled: false, field: 't' })).toBe(false)
    expect(isRowGroupUsable({ enabled: true, field: '' })).toBe(false)
    expect(isRowGroupUsable({ enabled: true, field: 't' })).toBe(true)
  })
})

describe('分组编排', () => {
  it('每组前插一个分组行，数据行原样跟在后面', () => {
    const rows = [
      { t: 'A', amount: 10 },
      { t: 'A', amount: 20 },
      { t: 'B', amount: 5 }
    ]
    const result = build(rows)
    expect(result).toHaveLength(5)
    expect(isGroupRow(result[0])).toBe(true)
    expect(result[0].__groupLabel).toBe('【A】')
    expect(result[0].__groupCount).toBe(2)
    // 数据行是**原对象**，没有被包一层，也没有被塞进谁的 children
    expect(result[1]).toBe(rows[0])
    expect(result[2]).toBe(rows[1])
    expect(isGroupRow(result[3])).toBe(true)
    expect(result[4]).toBe(rows[2])
  })

  it('组的先后是它在数据里第一次出现的先后，不按标题排序', () => {
    // 按标题排序会让「列表按金额降序排」这类配置失去意义
    const rows = [{ t: 'B' }, { t: 'A' }, { t: 'B' }]
    const labels = build(rows).filter(isGroupRow).map((g) => g.__groupLabel)
    expect(labels).toEqual(['【B】', '【A】'])
  })

  it('同值不相邻也能归到一组 —— 分组不依赖排序', () => {
    // 与同值合并刚好相反：那边合并的是相邻单元格，这边是按值归并
    const rows = [{ t: 'A' }, { t: 'B' }, { t: 'A' }]
    const result = build(rows)
    const first = result.filter(isGroupRow)[0]
    expect(first.__groupCount).toBe(2)
    expect(result).toHaveLength(5)
  })

  it('按原始值分组，标题只是显示 —— 两个编码翻译成同名也不会并成一组', () => {
    const rows = [{ t: 'OLD' }, { t: 'NEW' }]
    const sameLabel = () => '软件开发'
    const groups = buildGroupedRows(rows, CONF, sameLabel, new Set()).filter(isGroupRow)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.__groupKey)).toEqual(['OLD', 'NEW'])
  })

  it('空值统一归一组，不会分出三个标题都是 - 的组', () => {
    const rows = [{ t: null }, { t: undefined }, { t: '' }]
    const groups = build(rows).filter(isGroupRow)
    expect(groups).toHaveLength(1)
    expect(groups[0].__groupCount).toBe(3)
    expect(groups[0].__groupLabel).toBe('-')
  })

  it('空数组不出错', () => {
    expect(build([])).toEqual([])
  })
})

describe('组内小计', () => {
  it('按配的字段逐组累加', () => {
    const rows = [
      { t: 'A', amount: 10 },
      { t: 'A', amount: 20.5 },
      { t: 'B', amount: 5 }
    ]
    const groups = build(rows).filter(isGroupRow)
    expect(groups[0].__groupSums.amount).toBe(30.5)
    expect(groups[1].__groupSums.amount).toBe(5)
  })

  it('整列都是非数值时不给小计，而不是给一个 0', () => {
    // 给 0 会让人以为「算出来就是 0」，而实际上是这列根本合不出来
    const rows = [{ t: 'A', amount: '未填' }]
    expect(build(rows).filter(isGroupRow)[0].__groupSums).toEqual({})
  })

  it('部分行非数值时只累加数值的那些', () => {
    const rows = [
      { t: 'A', amount: 10 },
      { t: 'A', amount: null },
      { t: 'A', amount: 5 }
    ]
    // null 转 Number 是 0 而不是 NaN，所以它会被算进去 —— 这是对的，
    // 「没填金额」在合计里当 0 是业务上的常识
    expect(build(rows).filter(isGroupRow)[0].__groupSums.amount).toBe(15)
  })

  it('没配小计字段时小计是空对象', () => {
    const rows = [{ t: 'A', amount: 10 }]
    const conf: RowGroupConfig = { enabled: true, field: 't' }
    expect(buildGroupedRows(rows, conf, labelOf, new Set())[0].__groupSums).toEqual({})
  })
})

describe('折叠', () => {
  it('折叠的组只留分组行，数据行不输出', () => {
    const rows = [{ t: 'A' }, { t: 'A' }, { t: 'B' }]
    const result = build(rows, CONF, new Set(['A']))
    expect(result).toHaveLength(3)
    expect(result[0].__groupCollapsed).toBe(true)
    // 折叠了也要照样显示条数与小计 —— 否则折起来就看不见这组有多少了
    expect(result[0].__groupCount).toBe(2)
    expect(isGroupRow(result[1])).toBe(true)
    expect(result[2]).toBe(rows[2])
  })

  it('默认折叠会把当前页出现的每个组都折上', () => {
    const rows = [{ t: 'A' }, { t: 'B' }]
    const keys = initialCollapsedKeys(rows, { enabled: true, field: 't', defaultExpand: 'NONE' })
    expect(keys).toEqual(new Set(['A', 'B']))
  })

  it('默认展开时初始集合是空的', () => {
    const rows = [{ t: 'A' }]
    expect(initialCollapsedKeys(rows, { enabled: true, field: 't', defaultExpand: 'ALL' }).size).toBe(0)
    expect(initialCollapsedKeys(rows, { enabled: true, field: 't' }).size).toBe(0)
  })

  it('切换返回新集合，不改原集合', () => {
    const keys = new Set(['A'])
    const next = toggleGroupKey(keys, 'B')
    expect(keys).toEqual(new Set(['A']))
    expect(next).toEqual(new Set(['A', 'B']))
    expect(toggleGroupKey(next, 'A')).toEqual(new Set(['B']))
  })
})

describe('分组行的识别', () => {
  it('只有带标记的才是分组行', () => {
    expect(isGroupRow({ [GROUP_ROW_FLAG]: true })).toBe(true)
    expect(isGroupRow({ t: 'A' })).toBe(false)
    expect(isGroupRow(undefined)).toBe(false)
    expect(isGroupRow(null)).toBe(false)
  })
})
