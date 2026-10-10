import { describe, expect, it } from 'vitest'
import {
  resolveRowValue,
  resolveVisibleButtons,
  splitButtons,
  type TableActionButton
} from './actions'

const keysOf = (list: Array<{ key: string }>) => list.map((button) => button.key)

/** 只放通 allow 里列出的权限串，用来替代组件里注入的 checkPermi */
const canOf =
  (...allow: string[]) =>
  (permission: string[]) =>
    permission.some((one) => allow.includes(one))

const button = (key: string, extra: Partial<TableActionButton> = {}): TableActionButton => ({
  key,
  label: key,
  onClick: () => {},
  ...extra
})

describe('resolveVisibleButtons', () => {
  it('权限命中才显示', () => {
    const buttons = [
      button('update', { permission: ['ai:model:update'] }),
      button('delete', { permission: ['ai:model:delete'] })
    ]
    expect(keysOf(resolveVisibleButtons(buttons, {}, canOf('ai:model:update')))).toEqual(['update'])
  })

  it('权限串任一命中即显示', () => {
    const buttons = [button('edit', { permission: ['a:edit', 'b:edit'] })]
    expect(keysOf(resolveVisibleButtons(buttons, {}, canOf('b:edit')))).toEqual(['edit'])
  })

  it('不传 permission = 不门控', () => {
    const buttons = [button('detail')]
    expect(keysOf(resolveVisibleButtons(buttons, {}, canOf()))).toEqual(['detail'])
  })

  it('permission 为空数组 = 不门控，而不是谁都不能看', () => {
    // checkPermi([]) 对超管 true、对普通用户 false，语义不稳定，所以组件层直接跳过
    const buttons = [button('detail', { permission: [] })]
    expect(keysOf(resolveVisibleButtons(buttons, {}, canOf()))).toEqual(['detail'])
  })

  it('show 返回 false 就隐藏，即使权限命中', () => {
    const buttons = [button('unpublish', { show: (row: any) => !!row.menuId }), button('copy')]
    expect(keysOf(resolveVisibleButtons(buttons, { menuId: 0 }, canOf()))).toEqual(['copy'])
    expect(keysOf(resolveVisibleButtons(buttons, { menuId: 9 }, canOf()))).toEqual([
      'unpublish',
      'copy'
    ])
  })

  it('权限与 show 同时生效时是两个条件相与', () => {
    const buttons = [button('x', { permission: ['a'], show: (row: any) => row.ok === true })]
    expect(keysOf(resolveVisibleButtons(buttons, { ok: true }, canOf('a')))).toEqual(['x'])
    expect(keysOf(resolveVisibleButtons(buttons, { ok: false }, canOf('a')))).toEqual([])
    expect(keysOf(resolveVisibleButtons(buttons, { ok: true }, canOf()))).toEqual([])
  })

  it('全部被滤掉时返回空数组，由组件渲染占位符', () => {
    const buttons = [button('delete', { permission: ['a:delete'] })]
    expect(resolveVisibleButtons(buttons, {}, canOf())).toEqual([])
  })

  it('保持声明顺序，折叠边界因此是稳定的', () => {
    const buttons = [button('a'), button('b'), button('c'), button('d')]
    expect(keysOf(resolveVisibleButtons(buttons, {}, canOf()))).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('resolveRowValue', () => {
  it('未传时用 fallback', () => {
    expect(resolveRowValue(undefined, {}, false)).toBe(false)
    expect(resolveRowValue(undefined, {}, 'primary')).toBe('primary')
  })

  it('常量原样返回', () => {
    expect(resolveRowValue(true, {}, false)).toBe(true)
    expect(resolveRowValue('danger', {}, 'primary')).toBe('danger')
  })

  it('函数拿行数据现算', () => {
    const loading = (row: any) => row.id === 7
    expect(resolveRowValue(loading, { id: 7 }, false)).toBe(true)
    expect(resolveRowValue(loading, { id: 8 }, false)).toBe(false)
  })

  it('label 也能是函数，用来表达同一位置按行改文案', () => {
    const label = (row: any) => (row.editable ? '设计' : '查看设计')
    expect(resolveRowValue(label, { editable: true }, '')).toBe('设计')
    expect(resolveRowValue(label, { editable: false }, '')).toBe('查看设计')
  })

  it('函数返回假值时不会被 fallback 顶掉', () => {
    expect(resolveRowValue(() => false, {}, true)).toBe(false)
  })
})

describe('splitButtons', () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map((key) => button(key))

  it('正好等于阈值不折叠', () => {
    expect(splitButtons(five.slice(0, 3), 3)).toEqual({
      inline: five.slice(0, 3),
      folded: []
    })
  })

  it('少于阈值不折叠', () => {
    const two = five.slice(0, 2)
    expect(splitButtons(two, 3)).toEqual({ inline: two, folded: [] })
  })

  it('超过阈值就折：4 个 = 3 行内 + 1 更多', () => {
    const { inline, folded } = splitButtons(five.slice(0, 4), 3)
    expect(keysOf(inline)).toEqual(['a', 'b', 'c'])
    expect(keysOf(folded)).toEqual(['d'])
  })

  it('超过阈值就折：5 个 = 3 行内 + 2 更多', () => {
    const { inline, folded } = splitButtons(five, 3)
    expect(keysOf(inline)).toEqual(['a', 'b', 'c'])
    expect(keysOf(folded)).toEqual(['d', 'e'])
  })

  it('空列表不折叠也不产出下拉', () => {
    expect(splitButtons([], 3)).toEqual({ inline: [], folded: [] })
  })

  it('不改传入的数组', () => {
    const source = five.slice(0, 2)
    const { inline } = splitButtons(source, 3)
    inline.push(button('x'))
    expect(source).toHaveLength(2)
  })
})
