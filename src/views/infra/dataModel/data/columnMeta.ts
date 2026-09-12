import type { DataModelColumnVO } from '@/api/infra/dataModel'

/**
 * 字段元信息工具
 *
 * 列表页与表单页都要按字段类型决定「渲染什么控件、用什么查询操作符」，
 * 这些判断集中在这里，避免两处各写一份而出现不一致。
 */

/** 系统字段：由框架维护，不该让用户在表单里手填 */
export const SYSTEM_COLUMNS = [
  'id',
  'creator',
  'create_time',
  'updater',
  'update_time',
  'deleted',
  'tenant_id'
]

/** 列表默认不展示的字段：展示价值低，占屏幕宽度 */
export const HIDDEN_IN_LIST = ['deleted', 'tenant_id', 'updater', 'update_time']

export const isSystemColumn = (columnName: string) =>
  SYSTEM_COLUMNS.includes(columnName?.toLowerCase())

export const isNumberType = (columnType: string) =>
  ['INT', 'LONG', 'DECIMAL'].includes(columnType)

export const isDateType = (columnType: string) => ['DATE', 'DATETIME'].includes(columnType)

export const isTextAreaType = (columnType: string) => ['TEXT', 'LONG_TEXT'].includes(columnType)

/** 表单里该渲染成什么控件 */
export type FormWidget = 'input' | 'textarea' | 'number' | 'switch' | 'date' | 'datetime'

export const resolveFormWidget = (column: DataModelColumnVO): FormWidget => {
  switch (column.columnType) {
    case 'TEXT':
    case 'LONG_TEXT':
      return 'textarea'
    case 'INT':
    case 'LONG':
    case 'DECIMAL':
      return 'number'
    case 'BOOLEAN':
      return 'switch'
    case 'DATE':
      return 'date'
    case 'DATETIME':
      return 'datetime'
    default:
      return 'input'
  }
}

/**
 * 查询区该用什么操作符
 *
 * 字符串用 LIKE（模糊匹配更符合直觉），其余用 EQ。
 * 数字与日期的区间查询留待后续，当前先保证够用。
 */
export const resolveQueryOperator = (column: DataModelColumnVO): string => {
  if (['STRING', 'TEXT', 'LONG_TEXT'].includes(column.columnType)) {
    return 'LIKE'
  }
  return 'EQ'
}

/** 哪些字段适合放进查询区：系统字段与长文本排除 */
export const isQueryable = (column: DataModelColumnVO) =>
  !isSystemColumn(column.columnName) && !isTextAreaType(column.columnType)

/** 哪些字段适合在列表里展示 */
export const isVisibleInList = (column: DataModelColumnVO) =>
  !HIDDEN_IN_LIST.includes(column.columnName?.toLowerCase())

/** 哪些字段需要用户在表单里填写：系统字段全部排除（含自增主键） */
export const isEditable = (column: DataModelColumnVO) => !isSystemColumn(column.columnName)

/**
 * 单元格显示值
 *
 * 后端返回的时间是毫秒时间戳（Jackson 默认行为），布尔是 true/false，
 * 都需要转成人能看的形式。
 */
export const formatCellValue = (value: any, column: DataModelColumnVO): string => {
  if (value === null || value === undefined) {
    return ''
  }
  if (column.columnType === 'BOOLEAN') {
    return value === true || value === 1 || value === '1' ? '是' : '否'
  }
  if (isDateType(column.columnType) && typeof value === 'number') {
    const date = new Date(value)
    const pad = (n: number) => String(n).padStart(2, '0')
    const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    if (column.columnType === 'DATE') {
      return ymd
    }
    return `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
  return String(value)
}
