/**
 * 列表的同值单元格合并
 *
 * 相邻几行在某一列上取值相同时，把这几格合并成一格（`rowspan`）。
 * 典型场景是按类型/阶段排序后的台账：同一个类型不必在每一行上重复印一遍。
 *
 * ## 为什么预计算，而不是在 span-method 里现算
 *
 * 直觉写法是在每个单元格的合并回调里往下找「还有几行和我一样」，找到为止。
 * 那是 O(行数 × 列数 × 段长) —— 一页 50 行、3 个合并列、平均段长 10，
 * 就是 1500 次比较，而且**每次重渲染都重来一遍**（滚动、hover、排序都会触发）。
 *
 * 这里改成一次线性扫描算出每行每列的 rowspan，合并回调只做查表。
 *
 * ## 级联合并：这是与「每列各合各的」的关键差别
 *
 * 三列都开了合并时，如果每列独立判断「和上一行是否同值」，会出现这种错位：
 *
 * ```
 * 类型      阶段        负责人
 * ┌─────┐  ┌───────┐  ┌──────┐
 * │软件  │  │ 开发   │  │ 张伟  │      ← 软件/开发/张伟
 * │     │  ├───────┤  │      │
 * │     │  │ 测试   │  │      │      ← 软件/测试/张伟
 * └─────┘  ├───────┤  │      │
 * ┌─────┐  │ 测试   │  │      │      ← 集成/测试/张伟  ⚠️
 * │集成  │  └───────┘  └──────┘
 * ```
 *
 * 「测试」那一格跨过了软件与集成两个类型，「张伟」更是跨了三段 ——
 * 单元格边界是对齐的，语义却是错的：看上去像「集成类型下也有这个测试阶段」。
 * 而这种错误极难被发现，因为表格看起来非常整齐。
 *
 * 所以第 k 列只有在**它前面所有合并列都还在同一段内**时才继续合并。
 * 前面任何一列换了段，后面的列一律从这一行重新起段。
 *
 * ## 空值不合并
 *
 * 连续的空值会被并成一个跨十几行的 `-` 大格，看着像渲染坏了。
 * 空值一律自成一段（span = 1），并且**打断级联** —— 空值本身没有「相同」的语义，
 * 拿它当分组依据会把两段不相干的数据粘起来。
 *
 * ## 只在当前页内合并
 *
 * 传进来的就是当前页的行。跨页合并没有确定语义（上一页的最后一行与
 * 下一页的第一行同值，那一格该画在哪一页？），也做不到 —— 两页是两次渲染。
 */
import { isEmptyCellValue } from './listCell'

/** 行上挂合并结果的键。与 el-table 的行数据共存，不会与业务字段撞名 */
export const MERGE_SPAN_KEY = '__mergeSpan'

/** 一行上「列 → rowspan」的映射。0 表示这一格被上面的格子吃掉了，不渲染 */
export type MergeSpanMap = Record<string, number>

/**
 * 算出每一行每个合并列的 rowspan
 *
 * @param rows  当前页的行，顺序就是渲染顺序
 * @param props 参与合并的列在行数据上的取值键，**顺序即级联优先级** ——
 *              前面的列换段会打断后面的列
 * @returns 与 rows 等长的数组，第 i 项是第 i 行的「列 → rowspan」
 */
export const computeMergeSpans = (rows: any[], props: string[]): MergeSpanMap[] => {
  const spans: MergeSpanMap[] = rows.map(() => ({}))
  if (rows.length === 0 || props.length === 0) return spans

  // 每一列当前这一段的起始行号。-1 表示还没开段（上一行是空值）
  const groupStart: number[] = props.map(() => -1)

  rows.forEach((row, index) => {
    // 只要有一个更靠前的列在这一行换了段，后面的列一律跟着换段
    let cascadeBroken = false

    props.forEach((prop, k) => {
      const value = row?.[prop]
      const start = groupStart[k]

      // 空值自成一段，并打断后面所有列的级联
      if (isEmptyCellValue(value)) {
        spans[index][prop] = 1
        groupStart[k] = -1
        cascadeBroken = true
        return
      }

      const sameAsGroup =
        !cascadeBroken && start >= 0 && !isEmptyCellValue(rows[start]?.[prop]) &&
        String(rows[start][prop]) === String(value)

      if (sameAsGroup) {
        // 并进上一段：本行不渲染，段首的 rowspan 加一
        spans[index][prop] = 0
        spans[start][prop] = (spans[start][prop] ?? 1) + 1
        return
      }

      // 换段：本行成为新段的段首
      spans[index][prop] = 1
      groupStart[k] = index
      cascadeBroken = true
    })
  })

  return spans
}

/**
 * 把合并结果挂到行上
 *
 * 返回的是**浅拷贝**的新行，不改原数组 —— 原数组是接口返回值，
 * 别处（合计、导出、打印）还要按原样用。
 */
export const attachMergeSpans = (rows: any[], props: string[]): any[] => {
  if (props.length === 0) return rows
  const spans = computeMergeSpans(rows, props)
  return rows.map((row, index) => ({ ...row, [MERGE_SPAN_KEY]: spans[index] }))
}

/**
 * 从行上取某一列的 rowspan
 *
 * 取不到时返回 1（正常渲染一格）而不是 0 —— 0 会让这一格整个消失，
 * 而「取不到」只说明这一列没开合并，不该影响它的渲染。
 */
export const mergeSpanOf = (row: any, prop: string | undefined): number => {
  if (!prop) return 1
  const map = row?.[MERGE_SPAN_KEY] as MergeSpanMap | undefined
  const span = map?.[prop]
  return span === undefined ? 1 : span
}
