/**
 * 子表增强的运行时接线
 *
 * 把 `useSubTableEnhance` 里的纯函数接到运行时表单上：
 * - **合计行**：在子表控件下方渲染一行合计，随明细变化重算
 * - **行内必填与行数区间**：提交前给出带行号的提示
 *
 * ## 它补的是什么
 *
 * B5 交付了这些纯函数与单测，但**全仓库没有任何调用方** ——
 * 而且设计器里连配置入口都没有。也就是说合计行这件事此前完全不存在，
 * 只有一段能算出正确结果、但没人调用的代码。
 *
 * ## 只做这两件，行复制与虚拟滚动没做
 *
 * 合计行能挂在 form-create 规则的 `suffix` 上（suffix 本身也是一条规则，
 * 渲染在控件之后），校验只需要读数据 —— 两者都能从外部完成。
 *
 * 行复制要在每一行里加按钮、虚拟滚动要接管行的渲染，**这两件必须改子表控件
 * 本身的渲染方式**，也就是做一个自己的子表控件替换内核那个。那是另一个量级的
 * 改动，不在本次接线的范围内。
 */

import {
  calculateSummary,
  validateRequiredCells,
  validateRowCount,
  type SubTableCellError,
  type SubTableSummaryColumn
} from './useSubTableEnhance'
import { readNestedRules, SUB_TABLE_WIDGET_TYPE } from '@/components/FormWidgets/contracts'

/** 从规则树里解析出的一个子表 */
export interface SubTableMeta {
  field: string
  label: string
  /** 行数下限 / 上限，取自内核自带的 min / max 属性 */
  min?: number | null
  max?: number | null
  summaryColumns: SubTableSummaryColumn[]
  /** 明细列，用于行内必填校验 */
  columns: Array<{ field: string; label: string; required?: boolean }>
}

/**
 * 从规则树里收集子表
 *
 * 子表本身可能被放在栅格、标签页里，所以要递归 children。
 * 明细列则挂在契约声明的嵌套路径下。
 */
export const collectSubTables = (rules: any[] | null | undefined): SubTableMeta[] => {
  const result: SubTableMeta[] = []
  const walkColumns = (list: any[] | undefined, meta: SubTableMeta) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      if (item.field) {
        meta.columns.push({
          field: item.field,
          label: item.title || item.field,
          required: item.$required === true
        })
      }
      // 明细列也可能被放在栅格里
      walkColumns(item.children, meta)
    }
  }
  const walk = (list: any[] | null | undefined) => {
    if (!Array.isArray(list)) return
    for (const rule of list) {
      if (!rule || typeof rule !== 'object') continue
      if (rule.type === SUB_TABLE_WIDGET_TYPE && rule.field) {
        const meta: SubTableMeta = {
          field: rule.field,
          label: rule.title || rule.field,
          min: rule.props?.min,
          max: rule.props?.max,
          summaryColumns: Array.isArray(rule.props?.summaryColumns)
            ? rule.props.summaryColumns
            : [],
          columns: []
        }
        walkColumns(readNestedRules(rule), meta)
        result.push(meta)
      }
      walk(rule.children)
    }
  }
  walk(rules)
  return result
}

/**
 * 构造合计行的 suffix 规则
 *
 * @returns suffix 规则；没有配合计列时返回 undefined（不渲染空条）
 */
export const buildSummarySuffix = (
  meta: SubTableMeta,
  rows: Array<Record<string, any>> | undefined
): Record<string, any> | undefined => {
  if (!meta.summaryColumns.length) return undefined
  const values = calculateSummary(rows, meta.summaryColumns)
  const text = meta.summaryColumns
    .map((column) => `${column.label || column.field}：${values[column.field] ?? 0}`)
    .join('　')
  return {
    type: 'div',
    class: 'form-subtable-summary',
    children: [`合计　${text}`]
  }
}

/** 提交前的子表校验结果 */
export interface SubTableCheckResult {
  /** 行数区间不满足的提示 */
  rowCountErrors: string[]
  /** 行内必填缺失，带行号 */
  cellErrors: SubTableCellError[]
}

/**
 * 提交前校验全部子表
 *
 * 前端这份是即时反馈，服务端 `SubTableGuard` 那份才是不可绕过的关口。
 * 两边判「空」的口径必须相同（null / undefined / 空串 / 空数组），
 * 否则会出现「界面上没标红但提交被拒」。
 */
export const checkSubTables = (
  metas: SubTableMeta[],
  formData: Record<string, any> | undefined
): SubTableCheckResult => {
  const rowCountErrors: string[] = []
  const cellErrors: SubTableCellError[] = []
  for (const meta of metas) {
    const raw = formData?.[meta.field]
    const rows = Array.isArray(raw) ? raw : []
    const countError = validateRowCount(meta.label, rows.length, meta.min, meta.max)
    if (countError) rowCountErrors.push(countError)
    cellErrors.push(...validateRequiredCells(meta.field, rows, meta.columns))
  }
  return { rowCountErrors, cellErrors }
}

/**
 * 把校验结果拼成一条给用户看的消息
 *
 * 同一列的多行缺失合并成一条 —— 30 行都没填单价时报 30 条错误，
 * 用户看到的是一屏刷屏，反而找不到重点。这个概括口径与服务端
 * `FormErrorText.rows` 保持一致。
 */
export const toSubTableMessage = (result: SubTableCheckResult): string => {
  const parts = [...result.rowCountErrors]
  // 按「子表 + 列」分组，同组的行号合并
  const grouped = new Map<string, { label: string; sub: string; rows: number[] }>()
  for (const error of result.cellErrors) {
    const key = `${error.subField}::${error.field}`
    const item = grouped.get(key) ?? { label: error.label, sub: error.subField, rows: [] }
    item.rows.push(error.rowNumber)
    grouped.set(key, item)
  }
  for (const item of grouped.values()) {
    const rowsText =
      item.rows.length <= 5
        ? item.rows.join('、')
        : `${item.rows.slice(0, 5).join('、')} 等 ${item.rows.length} 行`
    parts.push(`明细第 ${rowsText} 的「${item.label}」是必填的`)
  }
  return parts.join('；')
}
