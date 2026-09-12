/**
 * 列表查询项的控件类型
 *
 * ## 为什么需要这一层
 *
 * 查询区曾经只有一个 `el-input` 分支 —— 不管字段是下拉、日期还是数字，
 * 查询时都渲染成文本框。后果是用户要**手打字典编码**才能按状态筛选
 * （界面上显示「已完成」，但查询框里必须输入 `3`），日期要手打 `2026-09-11`
 * 这样的字符串，格式差一点就查不出东西且不报错。
 *
 * 现在查询项自带 `widget`，运行时按它选渲染分支。
 *
 * ## 为什么 widget 在设计期就固化进 listConf
 *
 * 推断需要读规则树（要知道某字段是 select 还是 datePicker、绑了哪个字典）。
 * 让运行时自己再推断一遍，就会有两套推断逻辑，改了一边忘了另一边时，
 * 表现是「设计器里预览正常、发布出去变文本框」——本模块反复在避免这类漂移。
 * 所以推断只在设计期做一次，结果写进配置。
 */

/** 查询控件类型 */
export type SearchWidgetType =
  | 'TEXT'
  | 'SELECT'
  | 'DATE'
  | 'DATE_RANGE'
  | 'NUMBER'
  | 'NUMBER_RANGE'
  | 'SWITCH'

/** 查询控件清单，供设计器下拉使用 */
export const SEARCH_WIDGETS: Array<{ value: SearchWidgetType; label: string }> = [
  { value: 'TEXT', label: '文本框' },
  { value: 'SELECT', label: '下拉选择' },
  { value: 'DATE', label: '日期' },
  { value: 'DATE_RANGE', label: '日期区间' },
  { value: 'NUMBER', label: '数字' },
  { value: 'NUMBER_RANGE', label: '数字区间' },
  { value: 'SWITCH', label: '是 / 否' }
]

/**
 * 操作符清单
 *
 * 与后端 OperatorEnum 一一对应。设计器此前只暴露了其中 5 个，
 * 而后端 13 个全都实现了 —— 属于「后端做了但没入口」。
 */
export const SEARCH_OPERATORS: Array<{ value: string; label: string }> = [
  { value: 'EQ', label: '等于' },
  { value: 'NE', label: '不等于' },
  { value: 'GT', label: '大于' },
  { value: 'GE', label: '大于等于' },
  { value: 'LT', label: '小于' },
  { value: 'LE', label: '小于等于' },
  { value: 'LIKE', label: '包含' },
  { value: 'LEFT_LIKE', label: '左包含' },
  { value: 'RIGHT_LIKE', label: '右包含' },
  { value: 'IN', label: '在范围内' },
  { value: 'BETWEEN', label: '区间' },
  { value: 'IS_NULL', label: '为空' },
  { value: 'IS_NOT_NULL', label: '不为空' }
]

/**
 * 区间型控件：操作符被控件本身决定，不让用户再选
 *
 * 「日期区间 + 等于」是配得出来但永远查不到东西的组合，
 * 与其让用户配错再去排查，不如不给他配错的机会。
 */
const RANGE_WIDGETS: SearchWidgetType[] = ['DATE_RANGE', 'NUMBER_RANGE']

export const isRangeWidget = (widget?: SearchWidgetType): boolean =>
  !!widget && RANGE_WIDGETS.includes(widget)

/**
 * 每种控件允许的操作符
 *
 * 按「这个组合查得出东西吗」来划，而不是按后端支不支持划。
 * 例如日期不给 LIKE：后端执行得了，但对 datetime 列做字符串匹配的结果
 * 取决于驱动怎么转字符串，属于能配、能跑、结果不可预期。
 */
const OPERATORS_BY_WIDGET: Record<SearchWidgetType, string[]> = {
  // 文本也留着 BETWEEN：编号区间（A001 ~ A999）是真实用法，
  // 而且这是查询区改造前唯一的区间形态，旧配置要能原样读上来
  TEXT: ['LIKE', 'EQ', 'NE', 'LEFT_LIKE', 'RIGHT_LIKE', 'BETWEEN', 'IS_NULL', 'IS_NOT_NULL'],
  SELECT: ['EQ', 'NE', 'IN', 'IS_NULL', 'IS_NOT_NULL'],
  DATE: ['EQ', 'GE', 'LE', 'GT', 'LT', 'IS_NULL', 'IS_NOT_NULL'],
  DATE_RANGE: ['BETWEEN'],
  NUMBER: ['EQ', 'NE', 'GE', 'LE', 'GT', 'LT', 'IS_NULL', 'IS_NOT_NULL'],
  NUMBER_RANGE: ['BETWEEN'],
  SWITCH: ['EQ', 'NE']
}

/** 某控件可用的操作符清单（带中文名，供下拉直接渲染） */
export const operatorsFor = (
  widget?: SearchWidgetType
): Array<{ value: string; label: string }> => {
  const allowed = OPERATORS_BY_WIDGET[widget ?? 'TEXT'] ?? OPERATORS_BY_WIDGET.TEXT
  return allowed
    .map((value) => SEARCH_OPERATORS.find((op) => op.value === value))
    .filter((op): op is { value: string; label: string } => !!op)
}

/**
 * 当前操作符在该控件下是否还成立，不成立时给一个默认值
 *
 * 用户换控件类型时调用。直接把操作符清空会让「换一下控件类型，
 * 查询项就查不动了」——清单第一项是这个控件最常用的那个，直接顶上。
 */
export const coerceOperator = (widget: SearchWidgetType, operator?: string): string => {
  const allowed = operatorsFor(widget)
  if (operator && allowed.some((op) => op.value === operator)) return operator
  return allowed[0]?.value ?? 'EQ'
}

/** 不需要填值的操作符：为空 / 不为空 */
export const isValuelessOperator = (operator?: string): boolean =>
  operator === 'IS_NULL' || operator === 'IS_NOT_NULL'

/** 区间控件对应的单值控件 */
const SINGLE_VARIANT: Partial<Record<SearchWidgetType, SearchWidgetType>> = {
  DATE_RANGE: 'DATE',
  NUMBER_RANGE: 'NUMBER'
}

/**
 * 把区间控件降级成单值控件
 *
 * 只在读旧配置时用。查询区改造前，查询项只有 `{field, label, operator}`，
 * 没有 widget。推断出来的日期字段默认是区间，但旧配置里那一项的操作符
 * 可能是「等于」——直接套区间会把一个查“等于某天”的查询项
 * 悄悄变成查一段时间，已发布表单的查询结果会变。
 */
export const toSingleVariant = (widget: SearchWidgetType): SearchWidgetType =>
  SINGLE_VARIANT[widget] ?? widget

/**
 * 给旧查询项补上 widget
 *
 * 原则是**保住原有语义**：先按字段控件推断，若推断结果是区间控件
 * 但旧配置的操作符不是 BETWEEN，就降级成单值控件。
 *
 * @param rule 该字段在规则树里的控件定义，取不到传 undefined
 */
export const backfillSearchWidget = (
  item: { operator?: string },
  rule: any
): { widget: SearchWidgetType; dictType?: string; operator: string } => {
  const { widget, dictType } = inferSearchWidget(rule)
  const finalWidget =
    isRangeWidget(widget) && item.operator && item.operator !== 'BETWEEN'
      ? toSingleVariant(widget)
      : widget
  return { widget: finalWidget, dictType, operator: coerceOperator(finalWidget, item.operator) }
}

/**
 * 从表单控件规则推断查询控件与字典类型
 *
 * 推断不出来时一律回落到文本框 —— 文本框对任何列都能查出点东西，
 * 而猜错成日期区间会让这个查询项直接不可用。
 */
export const inferSearchWidget = (
  rule: any
): { widget: SearchWidgetType; dictType?: string } => {
  if (!rule) return { widget: 'TEXT' }

  const type = rule.type
  const ruleProps = rule.props ?? {}

  if (['select', 'radio', 'checkbox'].includes(type)) {
    // 字典类型的三个来源与列格式化推断保持一致，少一处就会出现
    // 「列显示成中文、查询下拉却是空的」
    const dictType = rule.dictType || rule.__config__?.dictType || ruleProps.dictType
    return { widget: 'SELECT', dictType: dictType || undefined }
  }

  if (type === 'datePicker') {
    // 日期默认给区间：按日期查记录，十有八九是查一段时间内的，
    // 而「等于某一天」对 datetime 列几乎永远查不到（时分秒对不上）
    return { widget: 'DATE_RANGE' }
  }

  if (type === 'inputNumber') {
    return { widget: 'NUMBER_RANGE' }
  }

  if (type === 'switch') {
    return { widget: 'SWITCH' }
  }

  return { widget: 'TEXT' }
}
