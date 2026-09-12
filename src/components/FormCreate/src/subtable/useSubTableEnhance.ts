/**
 * 子表增强
 *
 * 给设计器内核的子表控件补上三件它没有的能力：合计行、行复制、校验错误定位。
 *
 * ## 为什么做成外挂的 hook 而不是改内核控件
 *
 * 内核的子表控件（group）是第三方组件，改它意味着每次升级都要重新打补丁。
 * 这三件事都能从外部完成：合计只需读表单数据，行复制只需改数组，
 * 校验定位只需知道「哪一行哪一列错了」。所以挂在外面。
 */
import type { FormulaNode } from '@/components/FormFormula/parser'
import { parseFormula } from '@/components/FormFormula/parser'
import { evaluateFormula } from '@/components/FormFormula/evaluator'

/** 子表的一列合计配置 */
export interface SubTableSummaryColumn {
  /** 明细里的字段 */
  field: string
  /** 列标题，用于展示 */
  label: string
  /** 合计方式 */
  method: 'SUM' | 'AVG' | 'COUNT' | 'MAX' | 'MIN'
  /** 保留小数位 */
  precision?: number
}

/** 一条行内校验错误 */
export interface SubTableCellError {
  /** 子表控件字段 */
  subField: string
  /** 行号，从 1 开始 —— 与界面显示一致，不是数组下标 */
  rowNumber: number
  /** 明细列字段 */
  field: string
  /** 列标题 */
  label: string
  message: string
}

/**
 * 计算一个子表的合计行
 *
 * 复用公式求值器而不是自己写一遍加总：这样「空值怎么算、精度怎么收敛」
 * 与公式字段完全一致。否则同一份明细，公式字段算出的合计与合计行显示的
 * 可能差一分钱，而用户会认为是系统算错了。
 *
 * @param rows    明细行
 * @param columns 要合计的列
 * @returns 字段 → 合计值
 */
export const calculateSummary = (
  rows: Array<Record<string, any>> | null | undefined,
  columns: SubTableSummaryColumn[]
): Record<string, any> => {
  const result: Record<string, any> = {}
  if (!columns || columns.length === 0) return result

  // 造一份符合公式求值器输入格式的数据：{ __rows__: [...] }
  const data = { __rows__: Array.isArray(rows) ? rows : [] }

  for (const column of columns) {
    const ast: FormulaNode = {
      type: 'call',
      name: column.method,
      args: [{ type: 'subfield', sub: '__rows__', field: column.field }]
    }
    result[column.field] = evaluateFormula(ast, data, column.precision ?? 2, 'HALF_UP')
  }
  return result
}

/**
 * 复制一行
 *
 * 深拷贝而不是浅拷贝：明细行里可能有数组值（多选、上传），浅拷贝会让两行
 * 共用同一个数组 —— 改其中一行的多选，另一行跟着变。
 *
 * 主键字段要清掉：复制出来的是新行，带着原行的主键会让保存时被当成
 * 「更新原行」，结果是原行被改、新行没有。
 *
 * @param row       被复制的行
 * @param pkFields  主键字段名（通常是 id）
 */
export const duplicateRow = (
  row: Record<string, any>,
  pkFields: string[] = ['id']
): Record<string, any> => {
  const copy = JSON.parse(JSON.stringify(row ?? {}))
  for (const pk of pkFields) {
    delete copy[pk]
  }
  return copy
}

/**
 * 校验一个子表的行内必填，产出带行号的错误清单
 *
 * 与后端 SubTableGuard 的规则保持一致 —— 前端这份是即时反馈，
 * 后端那份是不可绕过的关口。两边判「空」的口径必须相同，
 * 否则会出现「界面上没标红但提交被拒」。
 *
 * @param subField 子表控件字段
 * @param rows     明细行
 * @param columns  列定义
 */
export const validateRequiredCells = (
  subField: string,
  rows: Array<Record<string, any>> | null | undefined,
  columns: Array<{ field: string; label: string; required?: boolean }>
): SubTableCellError[] => {
  const errors: SubTableCellError[] = []
  const list = Array.isArray(rows) ? rows : []

  for (let i = 0; i < list.length; i++) {
    for (const column of columns) {
      if (!column.required) continue
      const value = list[i]?.[column.field]
      // 判空口径与后端一致：null / undefined / 空串 / 空数组
      const empty =
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      if (empty) {
        errors.push({
          subField,
          rowNumber: i + 1,
          field: column.field,
          label: column.label,
          message: `第 ${i + 1} 行的「${column.label}」是必填的`
        })
      }
    }
  }
  return errors
}

/**
 * 校验行数区间
 *
 * @returns 错误消息；通过返回 null
 */
export const validateRowCount = (
  label: string,
  rowCount: number,
  min?: number | null,
  max?: number | null
): string | null => {
  if (min && min > 0 && rowCount < min) {
    return `「${label}」至少需要 ${min} 行明细，当前 ${rowCount} 行`
  }
  if (max && max > 0 && rowCount > max) {
    return `「${label}」最多 ${max} 行明细，当前 ${rowCount} 行`
  }
  return null
}

/**
 * 从合计配置的表达式解析出列
 *
 * 允许用户直接写「SUM(金额)」这样的简写，而不必手工填字段名与方式。
 * 解析失败返回 null，调用方保留用户原来的手工配置。
 */
export const parseSummaryExpression = (
  expression: string,
  subField: string
): SubTableSummaryColumn | null => {
  // 借用公式解析器识别函数与字段，避免自己写一套残缺的解析
  const result = parseFormula(expression.replace(/\{?([\w$]+)\}?/g, `{${subField}.$1}`))
  if (!result.ok || !result.ast || result.ast.type !== 'call') return null
  const call = result.ast
  const arg = call.args?.[0]
  if (!arg || arg.type !== 'subfield') return null
  const method = (call.name ?? '').toUpperCase()
  if (!['SUM', 'AVG', 'COUNT', 'MAX', 'MIN'].includes(method)) return null
  return {
    field: arg.field as string,
    label: arg.field as string,
    method: method as SubTableSummaryColumn['method']
  }
}
