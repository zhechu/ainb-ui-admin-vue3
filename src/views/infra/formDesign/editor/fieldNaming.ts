/**
 * 表单字段名与物理列名的命名约定（与后端 FormFieldNaming 保持一致）
 *
 * 核心是「主表零转换，副表加前缀」：
 *
 * - 主表字段：field 直接等于物理列名。后端 SELECT 不加 AS，
 *   查询结果的 key 天然就是 field，前端按 field 取值即可。
 * - 副表字段：field 为 `yd_<表名>_yd_<列名>`。后端 SELECT 时用
 *   `column AS yd_表名_yd_列名` 还原，这样主副表同名列不会互相覆盖。
 *
 * 分隔符用双标记 `_yd_` 而非单下划线：表名与列名自身可能含下划线
 * （test_customer_ext、tax_no），单下划线无法反向拆分。
 *
 * ⚠️ 修改此文件时必须同步后端 FormFieldNaming.java，两边规则必须一致。
 */

const PREFIX = 'yd_'
const SEPARATOR = '_yd_'

/** 生成副表字段名 */
export const sideField = (table: string, column: string): string =>
  `${PREFIX}${table}${SEPARATOR}${column}`

/** 判断是否为副表字段 */
export const isSideField = (field?: string): boolean => {
  if (!field || !field.startsWith(PREFIX)) return false
  return field.indexOf(SEPARATOR, PREFIX.length) > 0
}

/** 从副表字段名里取出表名。不是副表字段时返回 undefined */
export const extractTable = (field?: string): string | undefined => {
  if (!isSideField(field)) return undefined
  const sepIdx = field!.lastIndexOf(SEPARATOR)
  return field!.substring(PREFIX.length, sepIdx)
}

/** 从副表字段名里取出物理列名。主表字段原样返回（field 就等于列名） */
export const extractColumn = (field?: string): string | undefined => {
  if (!field) return undefined
  if (!isSideField(field)) return field
  const sepIdx = field.lastIndexOf(SEPARATOR)
  return field.substring(sepIdx + SEPARATOR.length)
}

/**
 * 按表生成字段名
 *
 * 主表返回列名本身，副表返回带前缀的名字。
 * 这是「一键生成」与「字段映射」共用的入口，保证两边规则一致。
 */
export const fieldNameOf = (table: string, column: string, mainTable?: string): string =>
  table === mainTable ? column : sideField(table, column)
