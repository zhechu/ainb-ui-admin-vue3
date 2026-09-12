/**
 * 模板插值
 *
 * 把 `{字段}` 换成表单数据里的值。超链接与条码都要用，但对值的处理不同：
 * 超链接要 URL 编码（字段值里有 `&` 会把地址截断），条码不能编码
 * （编码之后扫出来的就不是原值了）。所以编码方式由调用方给。
 */

/**
 * @param template  模板串
 * @param data      表单数据
 * @param transform 对取到的值做的处理，默认原样转字符串
 * @returns 替换后的字符串
 *
 * 取不到值的占位符替换成空串而不是保留原样 —— 保留会让结果里出现一个
 * 字面量的 `{customer_id}`，用户更难看出是没填字段。
 */
export const interpolateTemplate = (
  template: string | undefined | null,
  data: Record<string, any> | undefined | null,
  transform: (value: string) => string = (value) => value
): string => {
  if (!template) return ''
  return String(template).replace(/\{([^{}]+)\}/g, (_match, field: string) => {
    const value = data?.[String(field).trim()]
    if (value === null || value === undefined) return ''
    return transform(String(value))
  })
}
