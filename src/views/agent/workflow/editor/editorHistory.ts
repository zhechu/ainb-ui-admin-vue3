import { cloneDeep } from 'lodash-es'

/**
 * 通用「快照栈」撤销/重做（增量8 / P4，Phase C）
 *
 * 从门户设计器（views/infra/portal/editor/index.vue）的 historyPast/historyFuture 快照栈抽出的纯逻辑，
 * 刻意不依赖 Vue 响应式——这样能被 vitest 直接单测，也方便任何「整份状态可 cloneDeep」的场景复用。
 *
 * 语义（与门户逐条对齐，保证撤销/重做手感一致）：
 * - `past` 栈顶永远是「当前状态」；`reset(s)` 用它初始化（故 canUndo 要 past.length>1，只有当前态时无可撤）。
 * - `push(s)`：与栈顶等价（默认 JSON 深比较）则丢弃，避免连续同值刷栈；否则入栈并清空 future（新编辑断掉重做链）。
 * - `undo()`：把当前态弹到 future，返回新的栈顶（上一个状态）；无可撤返回 undefined。
 * - `redo()`：从 future 弹回 past，返回它；无可重做返回 undefined。
 * - 所有入栈/出栈都 cloneDeep，杜绝「栈里存的是同一份被就地改动的引用」导致撤销失效。
 *
 * 调用方（设计器页面）负责：把状态变更 `push` 进来、拿到 undo/redo 返回值后整体替换事实源。
 */
export interface EditorHistory<T> {
  /** 用一份快照初始化（载入/新建/重置后调一次）；清空重做链 */
  reset(snapshot: T): void
  /** 记录一次新状态；与栈顶等价则忽略（去重） */
  push(snapshot: T): void
  /** 撤销：返回上一个状态快照；无可撤返回 undefined */
  undo(): T | undefined
  /** 重做：返回下一个状态快照；无可重做返回 undefined */
  redo(): T | undefined
  canUndo(): boolean
  canRedo(): boolean
  /** 清空全部历史（不保留当前态）；一般在卸载/异常重置时用 */
  clear(): void
  /** 当前 past 栈深（含当前态），主要给调试/测试断言用 */
  depth(): number
}

export interface CreateHistoryOptions<T> {
  /** past 栈上限，超出丢最旧的（防长会话内存膨胀）。默认 100，与门户一致 */
  limit?: number
  /** 去重比较：返回 true 视为「与栈顶等价」不入栈。默认 JSON 深比较 */
  equals?: (a: T, b: T) => boolean
}

export function createHistory<T>(options: CreateHistoryOptions<T> = {}): EditorHistory<T> {
  const limit = options.limit ?? 100
  const equals = options.equals ?? ((a: T, b: T) => JSON.stringify(a) === JSON.stringify(b))

  let past: T[] = []
  let future: T[] = []

  return {
    reset(snapshot: T) {
      past = [cloneDeep(snapshot)]
      future = []
    },
    push(snapshot: T) {
      const top = past[past.length - 1]
      // 空栈时直接入（reset 之前的兜底，正常流程 reset 会先塞当前态）
      if (top !== undefined && equals(top, snapshot)) return
      past.push(cloneDeep(snapshot))
      if (past.length > limit) past.shift()
      // 新编辑发生后，原本的重做分支作废（与门户一致）
      future = []
    },
    undo() {
      if (past.length <= 1) return undefined
      const current = past.pop() as T
      future.push(current)
      return cloneDeep(past[past.length - 1])
    },
    redo() {
      if (!future.length) return undefined
      const next = future.pop() as T
      past.push(next)
      return cloneDeep(next)
    },
    canUndo() {
      return past.length > 1
    },
    canRedo() {
      return future.length > 0
    },
    clear() {
      past = []
      future = []
    },
    depth() {
      return past.length
    }
  }
}
