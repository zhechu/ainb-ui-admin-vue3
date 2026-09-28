import { describe, expect, it } from 'vitest'
import { createHistory } from './editorHistory'

/**
 * editorHistory 纯逻辑单测（增量8 / P4，Phase C）
 *
 * 撤销/重做是设计器核心手感，且这段是「纯状态机」最适合单测：覆盖 初始无可撤、push 去重、
 * undo/redo 往返、新编辑清空重做链、栈上限丢最旧、cloneDeep 隔离（改返回值不污染栈）。
 */
describe('createHistory', () => {
  const state = (n: number) => ({ n })

  it('reset 后只有当前态：不可撤销、不可重做', () => {
    const h = createHistory<{ n: number }>()
    h.reset(state(0))
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
    expect(h.depth()).toBe(1)
  })

  it('push 一次后可撤销，undo 返回上一个状态', () => {
    const h = createHistory<{ n: number }>()
    h.reset(state(0))
    h.push(state(1))
    expect(h.canUndo()).toBe(true)
    expect(h.undo()).toEqual(state(0))
    expect(h.canUndo()).toBe(false)
  })

  it('undo 后可 redo，redo 回到被撤销的状态', () => {
    const h = createHistory<{ n: number }>()
    h.reset(state(0))
    h.push(state(1))
    h.push(state(2))
    expect(h.undo()).toEqual(state(1))
    expect(h.canRedo()).toBe(true)
    expect(h.redo()).toEqual(state(2))
    expect(h.canRedo()).toBe(false)
  })

  it('与栈顶等价的 push 被去重（不增栈深）', () => {
    const h = createHistory<{ n: number }>()
    h.reset(state(0))
    h.push(state(1))
    h.push(state(1))
    h.push({ n: 1 })
    expect(h.depth()).toBe(2)
  })

  it('新 push 清空重做链（撤销后编辑，原重做分支作废）', () => {
    const h = createHistory<{ n: number }>()
    h.reset(state(0))
    h.push(state(1))
    h.push(state(2))
    h.undo() // 回到 1，future=[2]
    expect(h.canRedo()).toBe(true)
    h.push(state(9)) // 新编辑
    expect(h.canRedo()).toBe(false)
    expect(h.undo()).toEqual(state(1))
  })

  it('越过起点继续 undo 返回 undefined（不越界）', () => {
    const h = createHistory<{ n: number }>()
    h.reset(state(0))
    expect(h.undo()).toBeUndefined()
    expect(h.undo()).toBeUndefined()
  })

  it('无重做内容时 redo 返回 undefined', () => {
    const h = createHistory<{ n: number }>()
    h.reset(state(0))
    expect(h.redo()).toBeUndefined()
  })

  it('栈超上限丢最旧（limit 生效，canUndo 仍真）', () => {
    const h = createHistory<{ n: number }>({ limit: 3 })
    h.reset(state(0))
    h.push(state(1))
    h.push(state(2))
    h.push(state(3)) // 触发 shift，past=[1,2,3]
    expect(h.depth()).toBe(3)
    // 最旧的 0 已丢：一路撤到底停在 1
    expect(h.undo()).toEqual(state(2))
    expect(h.undo()).toEqual(state(1))
    expect(h.canUndo()).toBe(false)
  })

  it('返回值是深拷贝：改它不污染栈内快照', () => {
    const h = createHistory<{ n: number; list: number[] }>()
    h.reset({ n: 0, list: [1] })
    h.push({ n: 1, list: [2] })
    const undone = h.undo()!
    undone.list.push(999)
    undone.n = 123
    // 再 redo 拿回的仍是当初入栈的值，未被上面改动污染
    expect(h.redo()).toEqual({ n: 1, list: [2] })
  })

  it('入栈的对象后续被就地改动也不影响已存快照（push 时 clone）', () => {
    const h = createHistory<{ n: number }>()
    const live = state(0)
    h.reset(live)
    live.n = 5 // reset 存的是 clone(0)，改 live 不该动栈
    h.push(live) // 现在 push 的是 clone(5)
    expect(h.undo()).toEqual(state(0))
  })

  it('自定义 equals 生效', () => {
    const h = createHistory<{ n: number }>({ equals: () => true }) // 视一切为等价
    h.reset(state(0))
    h.push(state(1))
    expect(h.depth()).toBe(1) // 全被去重
    expect(h.canUndo()).toBe(false)
  })

  it('clear 清空历史', () => {
    const h = createHistory<{ n: number }>()
    h.reset(state(0))
    h.push(state(1))
    h.clear()
    expect(h.depth()).toBe(0)
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
  })
})
