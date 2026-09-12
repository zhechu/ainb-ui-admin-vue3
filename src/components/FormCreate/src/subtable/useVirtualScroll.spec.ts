/**
 * 子表虚拟滚动的单元测试
 *
 * 重点守两件事：
 * 1. 行数不多时不介入 —— 虚拟滚动本身有开销
 * 2. 正在编辑的行永远在渲染范围内 —— 被移出会让用户打字打到一半失去焦点
 */
import { describe, expect, it } from 'vitest'
import {
  VIRTUAL_SCROLL_THRESHOLD,
  calculateVirtualRange,
  sliceRows
} from './useVirtualScroll'

describe('虚拟滚动区间计算', () => {
  it('⚠️ 行数低于阈值时完全不介入，返回全部行', () => {
    const r = calculateVirtualRange(10, 40, 0, 400)
    expect(r.enabled).toBe(false)
    expect(r.start).toBe(0)
    expect(r.end).toBe(10)
    expect(r.paddingTop).toBe(0)
  })

  it('超过阈值时启用，只渲染可视区附近', () => {
    const total = 1000
    const r = calculateVirtualRange(total, 40, 0, 400)
    expect(r.enabled).toBe(true)
    expect(r.start).toBe(0)
    // 可视区 10 行 + overscan
    expect(r.end).toBeLessThan(30)
    expect(r.end).toBeGreaterThan(10)
  })

  it('滚动到中间时区间跟着移动，上下都留 overscan', () => {
    const r = calculateVirtualRange(1000, 40, 4000, 400)
    // 4000/40 = 第 100 行，减 overscan
    expect(r.start).toBeLessThan(100)
    expect(r.start).toBeGreaterThan(90)
    expect(r.paddingTop).toBe(r.start * 40)
  })

  it('占位高度撑住滚动条：上下 padding 加已渲染行高等于总高', () => {
    const total = 500
    const rowHeight = 40
    const r = calculateVirtualRange(total, rowHeight, 2000, 400)
    const rendered = (r.end - r.start) * rowHeight
    expect(r.paddingTop + rendered + r.paddingBottom).toBe(total * rowHeight)
  })

  it('⚠️ 正在编辑的行必须留在渲染范围内', () => {
    // 滚到很靠后的位置，但第 3 行正在编辑
    const r = calculateVirtualRange(1000, 40, 20000, 400, [3])
    expect(r.start, '被移出渲染范围会让控件卸载，用户打字打到一半失去焦点').toBeLessThanOrEqual(3)
    expect(r.end).toBeGreaterThan(3)
  })

  it('编辑行在末尾时同样保留', () => {
    const r = calculateVirtualRange(1000, 40, 0, 400, [999])
    expect(r.end).toBe(1000)
  })

  it('越界的编辑行下标被忽略，不产生非法区间', () => {
    const r = calculateVirtualRange(1000, 40, 0, 400, [-1, 5000])
    expect(r.start).toBeGreaterThanOrEqual(0)
    expect(r.end).toBeLessThanOrEqual(1000)
  })

  it('行高或视口高度为 0 时不介入，避免除零', () => {
    expect(calculateVirtualRange(1000, 0, 0, 400).enabled).toBe(false)
    expect(calculateVirtualRange(1000, 40, 0, 0).enabled).toBe(false)
  })

  it('阈值是导出的常量，便于调用方判断', () => {
    expect(VIRTUAL_SCROLL_THRESHOLD).toBeGreaterThan(0)
  })
})

describe('切片带真实下标', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ v: i }))

  it('⚠️ 带上真实下标 —— 用切片内的循环下标会算错行号', () => {
    const range = { start: 50, end: 55, paddingTop: 0, paddingBottom: 0, enabled: true }
    const sliced = sliceRows(rows, range)
    expect(sliced).toHaveLength(5)
    expect(sliced[0].index, '第 51 行不能显示成第 1 行，删除时也会删错').toBe(50)
    expect(sliced[0].row.v).toBe(50)
  })

  it('区间超出数组长度时安全截断', () => {
    const range = { start: 95, end: 200, paddingTop: 0, paddingBottom: 0, enabled: true }
    expect(sliceRows(rows, range)).toHaveLength(5)
  })
})
