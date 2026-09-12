/**
 * 子表虚拟滚动
 *
 * 明细行数多时，只渲染可视区附近的行。
 *
 * ## 为什么不直接用现成的虚拟列表组件
 *
 * 子表的每一行是一组表单控件（输入框、下拉、日期选择器），不是纯展示的单元格。
 * 通用虚拟列表假设行高一致且内容无状态，而这里：
 * - 行高会因为校验错误提示的出现而变化
 * - 控件有焦点状态，被回收再复用会导致光标跳走
 *
 * 所以这里只做「算出该渲染哪些行」这一件事，渲染仍由子表自己负责，
 * 且**正在编辑的行永远不会被移出渲染范围** —— 那会让用户打字打到一半失去焦点。
 *
 * ## 何时启用
 *
 * 行数低于阈值时完全不介入（返回全部行）。虚拟滚动本身有开销，
 * 十几行的明细用它反而更慢，而且会引入不必要的滚动行为变化。
 */

/** 启用虚拟滚动的行数阈值。低于它时不介入 */
export const VIRTUAL_SCROLL_THRESHOLD = 50

/** 可视区上下额外渲染的行数，避免快速滚动时露白 */
const OVERSCAN = 5

export interface VirtualRange {
  /** 起始行下标（含） */
  start: number
  /** 结束行下标（不含） */
  end: number
  /** 顶部占位高度，撑住滚动条 */
  paddingTop: number
  /** 底部占位高度 */
  paddingBottom: number
  /** 是否真的启用了虚拟滚动 */
  enabled: boolean
}

/**
 * 计算当前该渲染的行区间
 *
 * @param total       总行数
 * @param rowHeight   单行高度（像素）
 * @param scrollTop   滚动位置
 * @param viewportH   可视区高度
 * @param keepRows    必须保留在渲染范围内的行下标（正在编辑的行）
 */
export const calculateVirtualRange = (
  total: number,
  rowHeight: number,
  scrollTop: number,
  viewportH: number,
  keepRows: number[] = []
): VirtualRange => {
  // 行数不多时不介入：虚拟滚动本身有开销，十几行用它反而更慢
  if (total < VIRTUAL_SCROLL_THRESHOLD || rowHeight <= 0 || viewportH <= 0) {
    return { start: 0, end: total, paddingTop: 0, paddingBottom: 0, enabled: false }
  }

  let start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
  let end = Math.min(total, Math.ceil((scrollTop + viewportH) / rowHeight) + OVERSCAN)

  // 正在编辑的行必须留在范围内 —— 被移出会让控件卸载，用户打字打到一半失去焦点。
  // 这里是把区间撑大而不是另外插一段：另插会让 padding 计算变复杂，
  // 而正在编辑的行通常就在可视区附近，撑大几行的代价可以忽略
  for (const row of keepRows) {
    if (row < 0 || row >= total) continue
    start = Math.min(start, row)
    end = Math.max(end, row + 1)
  }

  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (total - end) * rowHeight),
    enabled: true
  }
}

/**
 * 取出该渲染的行，并带上它们的真实下标
 *
 * 带下标是必要的：渲染出来的是一个切片，组件里拿到的循环下标是切片内的位置，
 * 直接用它当行号会算错 —— 第 51 行会显示成第 1 行，删除某行也会删错。
 */
export const sliceRows = <T>(
  rows: T[],
  range: VirtualRange
): Array<{ row: T; index: number }> => {
  const result: Array<{ row: T; index: number }> = []
  for (let i = range.start; i < range.end && i < rows.length; i++) {
    result.push({ row: rows[i], index: i })
  }
  return result
}
