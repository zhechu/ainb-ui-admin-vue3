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

/**
 * 长内容类型：不适合放进查询区
 *
 * TEXT/LONG_TEXT 是「整篇文本，EQ 匹配不上」。JSON 更麻烦一层：MySQL 存的是**规范化后**的
 * 文本（写进去 `{"a":1}`，存成 `{"a": 1}`，键间带空格），所以连 LIKE 都会因为空格对不上而
 * 静默搜不到 —— 搜索框照样显示、照样能点、结果永远是空，这正是本项目最典型的那类缺陷。
 * 要按 JSON 里的值检索，正确做法是另建一个具体类型的列把值抽出来（见 docs/数据建模规范.md）。
 */
export const isLongContentType = (columnType: string) =>
  ['TEXT', 'LONG_TEXT', 'JSON'].includes(columnType)

/** 表单里该渲染成什么控件 */
export type FormWidget = 'input' | 'textarea' | 'number' | 'switch' | 'date' | 'datetime'

export const resolveFormWidget = (column: DataModelColumnVO): FormWidget => {
  switch (column.columnType) {
    case 'TEXT':
    case 'LONG_TEXT':
    // JSON 存的是一整篇文档，单行输入框没法看也没法改。
    // 后端 ValueConverter 对 String 是原样透传的，所以这里填的文本就是入库的文本；
    // 合法性由 MySQL 判（前端不校，理由与后端 ValueConverter#toJsonText 那条注释相同）
    case 'JSON':
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
 * TEXT/LONG_TEXT/JSON 到不了这里 —— isQueryable 已经把它们排除了。
 */
export const resolveQueryOperator = (column: DataModelColumnVO): string => {
  if (['STRING', 'TEXT', 'LONG_TEXT'].includes(column.columnType)) {
    return 'LIKE'
  }
  return 'EQ'
}

/** 哪些字段适合放进查询区：系统字段与长内容（含 JSON）排除 */
export const isQueryable = (column: DataModelColumnVO) =>
  !isSystemColumn(column.columnName) && !isLongContentType(column.columnType)

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
