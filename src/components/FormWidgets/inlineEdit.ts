/**
 * 列表行内编辑
 *
 * ## 保存语义：逐行
 *
 * 每行一个「保存」按钮，只提交这一行，走的是与弹窗编辑**同一条**提交流水线
 * （`PUT /{code}/update`）。所以联动复校验、公式重算、格式校验、乐观并发锁
 * 全都照常生效，服务端一行代码都不用改。
 *
 * 整表批量保存看起来更省事，但一行校验失败时整批怎么办没有好答案 ——
 * 全部回滚会让用户丢掉其余几行改对的内容，部分提交又会留下中间状态。
 *
 * ## ⚠️ 进入编辑态时就要把整条记录读回来
 *
 * 两个原因，缺一不可：
 *
 * 1. **列表行只有配出来的那几列**。直接拿列表行去提交，没配成列的字段全是
 *    undefined，服务端那条流水线会把它们当成「清空」——用户改了个价格，
 *    顺手把备注、附件全抹了。
 * 2. **乐观锁的版本号必须在开始编辑的那一刻取**。如果等到点保存时才读，
 *    读回来的版本必然是最新的，冲突永远检测不到 —— 锁形同虚设。
 */

/** 行内编辑支持的控件 */
export type InlineEditWidget = 'TEXT' | 'NUMBER' | 'SELECT' | 'DATE' | 'DATETIME' | 'SWITCH'

/**
 * 这一列能不能行内编辑
 *
 * 挡掉的三类都有具体理由，不是保守：
 * - **明细列**：一条主记录被摊平成多行，改其中一行的主表值语义不明确
 * - **图片 / 附件 / 超链接**：要专门的编辑器，且单元格宽度放不下
 * - **没绑字段的列**：没有可提交的目标
 */
export const isInlineEditable = (col: any): boolean => {
  if (!col?.field) return false
  if (col.subField) return false
  const type = col.formatter?.type
  return type !== 'IMAGE' && type !== 'FILE' && type !== 'LINK'
}

/**
 * 这一列在编辑态渲染成什么
 *
 * 判据是列已有的格式化配置 —— 它本来就是按控件类型推断出来的，
 * 再引一套推断逻辑就会出现「列表里显示成字典、编辑时却是文本框」。
 */
export const inlineEditWidgetOf = (
  col: any
): { widget: InlineEditWidget; dictType?: string } => {
  const formatter = col?.formatter
  switch (formatter?.type) {
    case 'DICT':
    case 'TAG':
      // 没配字典类型时回落到文本框：下拉没有选项可渲染，
      // 给一个永远空的下拉比给文本框更糟
      return formatter.dictType
        ? { widget: 'SELECT', dictType: formatter.dictType }
        : { widget: 'TEXT' }
    case 'NUMBER':
    case 'PERCENT':
      return { widget: 'NUMBER' }
    case 'DATE':
      return { widget: 'DATE' }
    case 'DATETIME':
      return { widget: 'DATETIME' }
    case 'BOOLEAN':
      return { widget: 'SWITCH' }
    default:
      return { widget: 'TEXT' }
  }
}

/** 日期控件的落库格式，与服务端解析的格式一致 */
export const dateValueFormat = (widget: InlineEditWidget): string =>
  widget === 'DATETIME' ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'

/** 实际参与行内编辑的列 */
export const editableColumns = (columns: any[]): any[] =>
  (columns ?? []).filter((col) => col?.inlineEditable && isInlineEditable(col))

/**
 * 进入编辑态时的初始值
 *
 * 取自**完整记录**而不是列表行，理由见文件头。
 * 只挑可编辑列：把整条记录都塞进编辑态，用户改一列会让其余列
 * 也跟着走一遍「被编辑过」的路径，没有必要。
 */
export const pickEditableValues = (
  fullRecord: Record<string, any>,
  columns: any[]
): Record<string, any> => {
  const values: Record<string, any> = {}
  for (const col of editableColumns(columns)) {
    values[col.field] = fullRecord?.[col.field]
  }
  return values
}

/**
 * 拼出要提交的整条记录
 *
 * 以完整记录打底、编辑值覆盖。**不能**只提交编辑过的那几个字段：
 * 服务端的提交流水线看到的是一份完整数据，缺字段等于把它们清空。
 */
export const buildSubmitPayload = (
  fullRecord: Record<string, any>,
  edits: Record<string, any>
): Record<string, any> => ({ ...(fullRecord ?? {}), ...(edits ?? {}) })

/**
 * 有没有真的改动过
 *
 * 没改动就直接退出编辑态、不发请求 —— 空提交一样会推高乐观锁版本号
 * 并写一条变更日志，让「谁在什么时候改了什么」的记录里混进一堆噪音。
 *
 * 用宽松相等比较：下拉的值从库里读出来可能是数字 1，
 * 而选项的值是字符串 '1'，严格相等会把「没改」判成「改了」。
 */
export const hasChanges = (
  original: Record<string, any>,
  edits: Record<string, any>
): boolean =>
  Object.keys(edits ?? {}).some((key) => {
    const before = original?.[key]
    const after = edits[key]
    if (before === null || before === undefined || before === '') {
      return !(after === null || after === undefined || after === '')
    }
    // eslint-disable-next-line eqeqeq
    return before != after
  })
