import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 内存版 localStorage
 *
 * ⚠️ 本项目的 vitest 跑在 node 环境（见 vitest.config.ts），没有 DOM ——
 * 这是刻意的：单测只覆盖不依赖浏览器的纯逻辑，要 DOM 的一律走 Playwright。
 * 所以这里自己补一个最小实现，而不是把整套单测改成 jsdom（那会拖慢全部用例，
 * 也与那条分工约定相悖）。
 *
 * 只实现被用到的四个方法。多实现的部分迟早会与真实行为漂移。
 */
const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear()
  }
}
;(globalThis as any).localStorage = memoryStorage()
;(globalThis as any).Storage = { prototype: (globalThis as any).localStorage }

import {
  applyColumnPrefs,
  clearColumnPrefs,
  columnKeyOf,
  columnPrefKey,
  isReorderable,
  readColumnPrefs,
  reorderBlockedReason,
  toColumnPrefs,
  writeColumnPrefs,
  type ColumnPref
} from './columnSetting'

const col = (field: string, over: Record<string, any> = {}) => ({
  field,
  label: field.toUpperCase(),
  ...over
})

/** 合并后的列标识序列，断言起来一眼能看懂 */
const keysOf = (columns: any[]) => columns.map(columnKeyOf)

describe('列标识', () => {
  it('明细列带上子表名，主表与明细的同名列不互相覆盖', () => {
    expect(columnKeyOf({ field: 'amount' })).toBe('amount')
    expect(columnKeyOf({ field: 'amount', subField: 'costs' })).toBe('costs::amount')
  })

  it('存储键带上表单编码与用户，换个人登录看不到上一个人的设置', () => {
    expect(columnPrefKey('demo', 1)).toBe('form-grid-cols:demo:1')
    expect(columnPrefKey('demo', undefined)).toBe('form-grid-cols:demo:anonymous')
  })
})

describe('能不能改位置', () => {
  it('固定列与明细列不能拖，且给出原因', () => {
    expect(reorderBlockedReason(col('a', { fixed: 'left' }))).toContain('固定列')
    expect(reorderBlockedReason(col('a', { subField: 'costs' }))).toContain('明细列')
    expect(isReorderable(col('a', { fixed: 'left' }))).toBe(false)
    expect(isReorderable(col('a', { subField: 'costs' }))).toBe(false)
  })

  it('普通列可以拖', () => {
    expect(reorderBlockedReason(col('a'))).toBe('')
    expect(isReorderable(col('a'))).toBe(true)
  })
})

describe('合并设计列与用户偏好', () => {
  const design = [col('a'), col('b'), col('c')]

  it('没有偏好时原样返回，全部可见', () => {
    const result = applyColumnPrefs(design, [])
    expect(keysOf(result)).toEqual(['a', 'b', 'c'])
    expect(result.every((c) => !c.__hidden)).toBe(true)
  })

  it('按偏好里的顺序重排', () => {
    const prefs: ColumnPref[] = [{ field: 'c' }, { field: 'a' }, { field: 'b' }]
    expect(keysOf(applyColumnPrefs(design, prefs))).toEqual(['c', 'a', 'b'])
  })

  it('隐藏与宽度都应用到列上', () => {
    const prefs: ColumnPref[] = [
      { field: 'a', hidden: true },
      { field: 'b', width: 300 },
      { field: 'c' }
    ]
    const result = applyColumnPrefs(design, prefs)
    expect(result[0].__hidden).toBe(true)
    expect(result[1].width).toBe(300)
    expect(result[2].__hidden).toBe(false)
  })

  it('⚠️ 设计里新增的列默认显示，而不是默认隐藏', () => {
    // 默认隐藏的话，设计者新加的列所有老用户都看不见，
    // 而他们不会想到去列设置里找
    const prefs: ColumnPref[] = [{ field: 'a' }, { field: 'c' }]
    const withNew = [col('a'), col('b'), col('c')]
    const result = applyColumnPrefs(withNew, prefs)
    expect(keysOf(result)).toContain('b')
    expect(result.find((c) => c.field === 'b').__hidden).toBe(false)
  })

  it('⚠️ 新增的列落在设计期的相对位置，不是一律堆到末尾', () => {
    // 设计者在第二列插了一列，用户却在最后一列看到它 —— 很难解释
    const prefs: ColumnPref[] = [{ field: 'a' }, { field: 'c' }]
    const result = applyColumnPrefs([col('a'), col('b'), col('c')], prefs)
    expect(keysOf(result)).toEqual(['a', 'b', 'c'])
  })

  it('偏好里有、设计里已经没有的列直接丢弃', () => {
    const prefs: ColumnPref[] = [{ field: 'a' }, { field: 'gone' }, { field: 'b' }]
    expect(keysOf(applyColumnPrefs([col('a'), col('b')], prefs))).toEqual(['a', 'b'])
  })

  it('一列都不会丢：偏好再乱，设计里的列全都在结果里', () => {
    const prefs: ColumnPref[] = [{ field: 'gone1' }, { field: 'gone2' }]
    expect(keysOf(applyColumnPrefs(design, prefs)).sort()).toEqual(['a', 'b', 'c'])
  })

  it('不改入参', () => {
    const source = [col('a')]
    applyColumnPrefs(source, [{ field: 'a', hidden: true }])
    expect(source[0]).not.toHaveProperty('__hidden')
  })

  it('明细列按复合键匹配，不会与同名的主表列串', () => {
    const columns = [col('amount'), col('amount', { subField: 'costs' })]
    const prefs: ColumnPref[] = [
      { field: 'amount', hidden: true },
      { field: 'amount', subField: 'costs' }
    ]
    const result = applyColumnPrefs(columns, prefs)
    expect(result.find((c) => !c.subField).__hidden).toBe(true)
    expect(result.find((c) => c.subField).__hidden).toBe(false)
  })
})

describe('反推偏好', () => {
  it('只存有值的项，省得本地缓存里全是 false 和 undefined', () => {
    expect(toColumnPrefs([col('a'), col('b', { __hidden: true, width: 200 })])).toEqual([
      { field: 'a' },
      { field: 'b', hidden: true, width: 200 }
    ])
  })

  it('明细列带上子表名', () => {
    expect(toColumnPrefs([col('amount', { subField: 'costs' })])).toEqual([
      { field: 'amount', subField: 'costs' }
    ])
  })

  it('存再读能还原', () => {
    const columns = [col('a', { __hidden: true }), col('b', { width: 180 })]
    const key = 'test-roundtrip'
    writeColumnPrefs(key, toColumnPrefs(columns))
    const result = applyColumnPrefs([col('a'), col('b')], readColumnPrefs(key))
    expect(result[0].__hidden).toBe(true)
    expect(result[1].width).toBe(180)
  })
})

describe('本地存储', () => {
  beforeEach(() => localStorage.clear())

  it('没存过时返回空数组', () => {
    expect(readColumnPrefs('nothing')).toEqual([])
  })

  it('⚠️ 坏掉的缓存当作没有偏好，不能让整张列表打不开', () => {
    localStorage.setItem('bad', '{不是 JSON')
    expect(readColumnPrefs('bad')).toEqual([])
    localStorage.setItem('bad2', '"是 JSON 但不是数组"')
    expect(readColumnPrefs('bad2')).toEqual([])
    localStorage.setItem('bad3', '[{"nope":1},{"field":"a"}]')
    expect(readColumnPrefs('bad3')).toEqual([{ field: 'a' }])
  })

  it('写失败时不抛异常 —— 它不是功能的必要条件', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => writeColumnPrefs('k', [{ field: 'a' }])).not.toThrow()
    spy.mockRestore()
  })

  it('清掉之后回到没有偏好的状态', () => {
    writeColumnPrefs('k', [{ field: 'a', hidden: true }])
    clearColumnPrefs('k')
    expect(readColumnPrefs('k')).toEqual([])
  })
})
