/**
 * 相对日期默认值
 *
 * 日期字段的默认值常常不是一个固定日期，而是「今天」「本月初」「7 天后」。
 * 存固定日期不行 —— 那个日期在表单发布的第二天就过期了；
 * 让用户每次手改也不行 —— 那正是默认值要省掉的动作。
 *
 * 所以默认值存的是**语义**（token），运行时才解析成具体日期。
 *
 * ## 为什么不做成公式
 *
 * 公式引擎求值的是数值与字符串，加一套日期运算意味着要定义日期类型、
 * 日期字面量、时区语义，双端还要保持一致。而这里要表达的只有十几种常用相对日期，
 * 用枚举 + 一个偏移量就够了。
 *
 * ## 时区
 *
 * 一律按浏览器本地时区算。用户看到的「今天」就是他日历上的今天 ——
 * 换成 UTC 会让东八区用户在早上 8 点前看到昨天。
 * 服务端不重算这个默认值（它只是个默认值，用户可以改），所以不存在双端不一致。
 */

/** 相对日期的语义 */
export type RelativeDateToken =
  /** 今天 */
  | 'TODAY'
  /** 昨天 */
  | 'YESTERDAY'
  /** 明天 */
  | 'TOMORROW'
  /** 本周一 */
  | 'WEEK_START'
  /** 本周日 */
  | 'WEEK_END'
  /** 本月第一天 */
  | 'MONTH_START'
  /** 本月最后一天 */
  | 'MONTH_END'
  /** 上月第一天 */
  | 'LAST_MONTH_START'
  /** 上月最后一天 */
  | 'LAST_MONTH_END'
  /** 本季度第一天 */
  | 'QUARTER_START'
  /** 本年第一天 */
  | 'YEAR_START'
  /** 本年最后一天 */
  | 'YEAR_END'
  /** 相对今天偏移 N 天，N 由 offset 给出（可为负） */
  | 'OFFSET_DAYS'
  /** 相对今天偏移 N 个月 */
  | 'OFFSET_MONTHS'

/** 设计器下拉框用的清单。顺序即展示顺序 */
export const RELATIVE_DATE_OPTIONS: Array<{ value: RelativeDateToken; label: string }> = [
  { value: 'TODAY', label: '今天' },
  { value: 'YESTERDAY', label: '昨天' },
  { value: 'TOMORROW', label: '明天' },
  { value: 'WEEK_START', label: '本周一' },
  { value: 'WEEK_END', label: '本周日' },
  { value: 'MONTH_START', label: '本月初' },
  { value: 'MONTH_END', label: '本月末' },
  { value: 'LAST_MONTH_START', label: '上月初' },
  { value: 'LAST_MONTH_END', label: '上月末' },
  { value: 'QUARTER_START', label: '本季度初' },
  { value: 'YEAR_START', label: '本年初' },
  { value: 'YEAR_END', label: '本年末' },
  { value: 'OFFSET_DAYS', label: 'N 天后（负数为前）' },
  { value: 'OFFSET_MONTHS', label: 'N 个月后（负数为前）' }
]

/** 字段上的相对日期配置，存在 props.relativeDefault 里 */
export interface RelativeDateConfig {
  token?: RelativeDateToken | string
  /** OFFSET_DAYS / OFFSET_MONTHS 的偏移量，可为负 */
  offset?: number
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** 按本地时区格式化成 yyyy-MM-dd */
export const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** 按本地时区格式化成 yyyy-MM-dd HH:mm:ss */
export const formatLocalDateTime = (date: Date): string =>
  `${formatLocalDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`

/**
 * 解析相对日期
 *
 * @param config 字段上的配置
 * @param now    「现在」。显式传入而不是在函数里取 new Date() ——
 *               这样跨月、跨年这些边界情况能被测试稳定复现，
 *               否则用例只在某些日子里才走到那条分支
 * @returns 解析出的日期；配置无效返回 undefined（调用方保持字段为空）
 */
export const resolveRelativeDate = (
  config: RelativeDateConfig | undefined | null,
  now: Date
): Date | undefined => {
  const token = config?.token
  if (!token) return undefined
  // 从当天零点起算：默认值给的是「哪一天」，带上时分秒会让同一个默认值
  // 在上午和下午存进去的内容不同
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const offset = Number(config?.offset ?? 0)

  switch (String(token).toUpperCase()) {
    case 'TODAY':
      return base
    case 'YESTERDAY':
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1)
    case 'TOMORROW':
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1)
    case 'WEEK_START':
      // getDay() 里周日是 0。中国习惯以周一为一周之始，所以周日要回退 6 天
      // 而不是 0 天 —— 否则「本周一」在周日会算成当天
      return new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() - ((base.getDay() + 6) % 7)
      )
    case 'WEEK_END':
      return new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() - ((base.getDay() + 6) % 7) + 6
      )
    case 'MONTH_START':
      return new Date(base.getFullYear(), base.getMonth(), 1)
    case 'MONTH_END':
      // 下个月的第 0 天 = 本月最后一天。这样不需要判断闰年与月份天数
      return new Date(base.getFullYear(), base.getMonth() + 1, 0)
    case 'LAST_MONTH_START':
      return new Date(base.getFullYear(), base.getMonth() - 1, 1)
    case 'LAST_MONTH_END':
      return new Date(base.getFullYear(), base.getMonth(), 0)
    case 'QUARTER_START':
      return new Date(base.getFullYear(), Math.floor(base.getMonth() / 3) * 3, 1)
    case 'YEAR_START':
      return new Date(base.getFullYear(), 0, 1)
    case 'YEAR_END':
      return new Date(base.getFullYear(), 11, 31)
    case 'OFFSET_DAYS':
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset)
    case 'OFFSET_MONTHS':
      // ⚠️ 用 Date 的月份溢出规则：3 月 31 日加 1 个月会得到 5 月 1 日
      // （4 月没有 31 日）。这是 JS 的既有行为，不在这里"修正"成 4 月 30 日 ——
      // 任何一种修正都是我们自己编的规则，而用户对它没有预期
      return new Date(base.getFullYear(), base.getMonth() + offset, base.getDate())
    default:
      // 认不出来的 token 返回 undefined，字段保持为空。
      // 不抛异常也不回退到今天：回退会让一个拼错的配置看起来在正常工作
      return undefined
  }
}

/**
 * 解析成字符串，直接可以塞进表单数据
 *
 * @param withTime 日期时间控件传 true。日期控件传 false ——
 *                 多出来的 00:00:00 会让日期控件显示成一个带时间的值
 */
export const resolveRelativeDateText = (
  config: RelativeDateConfig | undefined | null,
  now: Date,
  withTime = false
): string | undefined => {
  const date = resolveRelativeDate(config, now)
  if (!date) return undefined
  return withTime ? formatLocalDateTime(date) : formatLocalDate(date)
}
