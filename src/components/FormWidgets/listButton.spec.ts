import { describe, expect, it } from 'vitest'
import {
  BUILTIN_BUTTONS,
  builtinOf,
  DEFAULT_MAX_INLINE_BUTTONS,
  defaultButtons,
  needsSelection,
  normalizeButtons,
  normalizeMaxInline,
  positionOf,
  splitInlineButtons,
  visibleButtons
} from './listButton'

const keysOf = (list: Array<{ key: string }>) => list.map((b) => b.key)
const shownKeys = (list: Array<{ key: string; show: boolean }>) =>
  list.filter((b) => b.show).map((b) => b.key)

describe('内置按钮定义', () => {
  it('每个 key 都是唯一的', () => {
    const keys = keysOf(BUILTIN_BUTTONS)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('位置只有工具栏与行内两种', () => {
    BUILTIN_BUTTONS.forEach((b) => expect(['toolbar', 'row']).toContain(b.position))
  })

  it('按 key 能查回定义', () => {
    expect(builtinOf('edit')?.label).toBe('编辑')
    expect(builtinOf('不存在')).toBeUndefined()
    expect(positionOf('create')).toBe('toolbar')
    expect(positionOf('edit')).toBe('row')
  })
})

describe('旧配置兼容', () => {
  it('旧的字符串数组能读上来，出现过的就是显示', () => {
    // 尾巴上的 changeLog / print 是刻意补上的，理由见下面那条用例
    const result = normalizeButtons(['edit', 'detail', 'delete'])
    expect(shownKeys(result)).toEqual(['edit', 'detail', 'delete', 'changeLog', 'print'])
  })

  it('⚠️ 旧配置读上来后一定包含全部内置按钮', () => {
    // 少一项会让它在设计器里整个消失，用户再也配不回来
    const result = normalizeButtons(['edit'])
    expect(new Set(keysOf(result))).toEqual(new Set(keysOf(BUILTIN_BUTTONS)))
  })

  it('⚠️ 旧配置里没有的新按钮补成不显示，不能自己冒出来', () => {
    // 往后新增内置按钮时，不能让它自动出现在所有已发布表单上
    const result = normalizeButtons(['edit', 'detail', 'delete'])
    expect(result.find((b) => b.key === 'batchDelete')?.show).toBe(false)
    expect(result.find((b) => b.key === 'batchPrint')?.show).toBe(false)
  })

  it('⚠️ 「变更记录」与「打印」缺省要补成显示，不能跟着一起消失', () => {
    // 这两个改造前写死在模板里，显不显示只看各自的开关，从来没进过 buttons 数组。
    // 按「没提到就是关掉了」处理，会让所有已发布表单的这两个入口一起消失 ——
    // 而变更日志与打印模板明明还配着。这个回归是全量 e2e 抓到的
    const result = normalizeButtons(['edit', 'detail'])
    expect(result.find((b) => b.key === 'changeLog')?.show).toBe(true)
    expect(result.find((b) => b.key === 'print')?.show).toBe(true)
  })

  it('显式配成不显示时，「变更记录」与「打印」要听配置的', () => {
    const result = normalizeButtons([
      { key: 'edit', label: '编辑', show: true },
      { key: 'print', label: '打印', show: false }
    ])
    expect(result.find((b) => b.key === 'print')?.show).toBe(false)
  })

  it('旧配置里的 create / export 照样读得出来', () => {
    const result = normalizeButtons(['create', 'export', 'edit'])
    expect(shownKeys(result)).toEqual(['create', 'export', 'edit', 'changeLog', 'print'])
  })

  it('完全没配过时用出厂默认', () => {
    expect(shownKeys(normalizeButtons(undefined))).toEqual(shownKeys(defaultButtons()))
    expect(shownKeys(normalizeButtons([]))).toEqual(shownKeys(defaultButtons()))
  })
})

describe('新配置读写', () => {
  it('保持配置里的顺序，不按出厂顺序重排', () => {
    // 「删除」放在「编辑」左边会明显提高误点率，顺序是用户的决定
    const result = normalizeButtons([
      { key: 'delete', label: '作废', show: true },
      { key: 'edit', label: '编辑', show: true }
    ])
    expect(keysOf(result).slice(0, 2)).toEqual(['delete', 'edit'])
  })

  it('改过的文案保留下来', () => {
    const result = normalizeButtons([{ key: 'delete', label: '作废', show: true }])
    expect(result.find((b) => b.key === 'delete')?.label).toBe('作废')
  })

  it('文案被清空时回落到出厂文案，而不是渲染没有字的按钮', () => {
    const result = normalizeButtons([{ key: 'delete', label: '', show: true }])
    expect(result.find((b) => b.key === 'delete')?.label).toBe('删除')
  })

  it('show 只有显式 false 才算隐藏，缺省当显示', () => {
    const result = normalizeButtons([{ key: 'edit', label: '编辑' }])
    expect(result.find((b) => b.key === 'edit')?.show).toBe(true)
  })

  it('认不出的 key 丢掉，不渲染点了没反应的按钮', () => {
    const result = normalizeButtons([{ key: 'teleport', label: '瞬移', show: true }])
    expect(keysOf(result)).not.toContain('teleport')
  })

  it('重复的 key 只保留第一次出现的那个', () => {
    const result = normalizeButtons([
      { key: 'edit', label: '编辑A', show: true },
      { key: 'edit', label: '编辑B', show: true }
    ])
    expect(result.filter((b) => b.key === 'edit')).toHaveLength(1)
    expect(result.find((b) => b.key === 'edit')?.label).toBe('编辑A')
  })
})

describe('按位置取按钮', () => {
  it('只取显示的，且按配置顺序', () => {
    const buttons = normalizeButtons([
      { key: 'delete', label: '作废', show: true },
      { key: 'edit', label: '编辑', show: true },
      { key: 'detail', label: '详情', show: false },
      { key: 'create', label: '新增', show: true }
    ])
    // 用户明确配过的排在前面，补进来的 changeLog / print 跟在后面
    expect(keysOf(visibleButtons(buttons, 'row'))).toEqual([
      'delete',
      'edit',
      'changeLog',
      'print'
    ])
    expect(keysOf(visibleButtons(buttons, 'toolbar'))).toEqual(['create'])
  })
})

describe('多选列', () => {
  it('勾了批量删除才需要多选列', () => {
    expect(needsSelection(normalizeButtons(['edit']))).toBe(false)
    expect(
      needsSelection(normalizeButtons([{ key: 'batchDelete', label: '批量删除', show: true }]))
    ).toBe(true)
  })

  it('批量删除配成不显示时不需要多选列', () => {
    expect(
      needsSelection(normalizeButtons([{ key: 'batchDelete', label: '批量删除', show: false }]))
    ).toBe(false)
  })

  it('批量打印同样需要多选列', () => {
    expect(
      needsSelection(normalizeButtons([{ key: 'batchPrint', label: '批量打印', show: true }]))
    ).toBe(true)
  })
})

describe('行内按钮的折叠', () => {
  const make = (count: number) => Array.from({ length: count }, (_, i) => ({ key: `b${i}` }))

  it('阈值缺失或非法时回落到出厂值 —— 不折叠不是安全的默认', () => {
    expect(normalizeMaxInline(undefined)).toBe(DEFAULT_MAX_INLINE_BUTTONS)
    expect(normalizeMaxInline(0)).toBe(DEFAULT_MAX_INLINE_BUTTONS)
    expect(normalizeMaxInline(-1)).toBe(DEFAULT_MAX_INLINE_BUTTONS)
    expect(normalizeMaxInline('abc')).toBe(DEFAULT_MAX_INLINE_BUTTONS)
    expect(normalizeMaxInline('5')).toBe(5)
    expect(normalizeMaxInline(4.7)).toBe(4)
  })

  it('没超过阈值就全部直接显示', () => {
    const { inline, folded } = splitInlineButtons(make(3), 3)
    expect(inline).toHaveLength(3)
    expect(folded).toHaveLength(0)
  })

  it('⚠️ 只多出一个时不折叠 —— 「三个按钮 + 一个下拉」比四个按钮还宽，还多一次点击', () => {
    const { inline, folded } = splitInlineButtons(make(4), 3)
    expect(inline).toHaveLength(4)
    expect(folded).toHaveLength(0)
  })

  it('真的省下位置时才折：五个按钮、阈值三 → 三个 + 两个进下拉', () => {
    const { inline, folded } = splitInlineButtons(make(5), 3)
    expect(inline.map((b) => b.key)).toEqual(['b0', 'b1', 'b2'])
    expect(folded.map((b) => b.key)).toEqual(['b3', 'b4'])
  })

  it('折叠不会让任何按钮消失，顺序也不变', () => {
    const buttons = make(7)
    const { inline, folded } = splitInlineButtons(buttons, 2)
    expect([...inline, ...folded].map((b) => b.key)).toEqual(buttons.map((b) => b.key))
  })

  it('出厂阈值正好容得下内置的三个行按钮，不会凭空多出一个「更多」', () => {
    const rowButtons = defaultButtons().filter(
      (b) => b.show && positionOf(b.key) === 'row' && !builtinOf(b.key)?.gated
    )
    expect(splitInlineButtons(rowButtons, undefined).folded).toHaveLength(0)
  })
})
