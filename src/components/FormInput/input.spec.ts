/**
 * 输入类增强的单元测试
 *
 * 相对日期与金额大写都是「一眼看着简单、边界全在细节里」的东西：
 * 周日算不算本周、3 月 31 日加一个月是几号、「壹元零伍分」的那个零。
 * 这些用例钉的就是这些边界。
 */

import { describe, expect, it } from 'vitest'
import { formatThousands, toChineseAmount } from './amount'
import {
  formatLocalDate,
  resolveRelativeDate,
  resolveRelativeDateText,
  RELATIVE_DATE_OPTIONS
} from './relativeDate'
import {
  applyThousandsFormat,
  buildAmountSuffix,
  collectAmountDisplayFields,
  resolveRelativeDefaults
} from './index'

/** 固定「现在」：2026-09-09 是星期三 */
const NOW = new Date(2026, 8, 9, 15, 30, 45)

const resolve = (token: string, offset?: number) =>
  formatLocalDate(resolveRelativeDate({ token, offset }, NOW)!)

describe('相对日期', () => {
  it('今天/昨天/明天', () => {
    expect(resolve('TODAY')).toBe('2026-09-09')
    expect(resolve('YESTERDAY')).toBe('2026-09-08')
    expect(resolve('TOMORROW')).toBe('2026-09-10')
  })

  it('⚠️ 本周以周一为始，周日算上一周 —— getDay() 里周日是 0，直接用会算成当天', () => {
    // 2026-09-09 是周三 → 本周一是 09-07，本周日是 09-13
    expect(resolve('WEEK_START')).toBe('2026-09-07')
    expect(resolve('WEEK_END')).toBe('2026-09-13')

    // 2026-09-13 是周日 → 本周一仍应是 09-07
    const sunday = new Date(2026, 8, 13)
    expect(formatLocalDate(resolveRelativeDate({ token: 'WEEK_START' }, sunday)!)).toBe('2026-09-07')
  })

  it('本月初/本月末 —— 月末用「下月第 0 天」算，不需要判断闰年', () => {
    expect(resolve('MONTH_START')).toBe('2026-09-01')
    expect(resolve('MONTH_END')).toBe('2026-09-30')

    // 2 月：2026 不是闰年 → 28 天
    const feb = new Date(2026, 1, 15)
    expect(formatLocalDate(resolveRelativeDate({ token: 'MONTH_END' }, feb)!)).toBe('2026-02-28')
    // 2028 是闰年 → 29 天
    const febLeap = new Date(2028, 1, 15)
    expect(formatLocalDate(resolveRelativeDate({ token: 'MONTH_END' }, febLeap)!)).toBe('2028-02-29')
  })

  it('上月初/上月末，跨年也要对', () => {
    expect(resolve('LAST_MONTH_START')).toBe('2026-08-01')
    expect(resolve('LAST_MONTH_END')).toBe('2026-08-31')

    const january = new Date(2026, 0, 10)
    expect(formatLocalDate(resolveRelativeDate({ token: 'LAST_MONTH_START' }, january)!)).toBe(
      '2025-12-01'
    )
    expect(formatLocalDate(resolveRelativeDate({ token: 'LAST_MONTH_END' }, january)!)).toBe(
      '2025-12-31'
    )
  })

  it('本季度初/本年初/本年末', () => {
    expect(resolve('QUARTER_START')).toBe('2026-07-01')
    expect(resolve('YEAR_START')).toBe('2026-01-01')
    expect(resolve('YEAR_END')).toBe('2026-12-31')
    // 1 月属于第一季度
    expect(
      formatLocalDate(resolveRelativeDate({ token: 'QUARTER_START' }, new Date(2026, 0, 20))!)
    ).toBe('2026-01-01')
  })

  it('偏移天数，跨月与负数', () => {
    expect(resolve('OFFSET_DAYS', 7)).toBe('2026-09-16')
    expect(resolve('OFFSET_DAYS', -10)).toBe('2026-08-30')
    expect(resolve('OFFSET_DAYS', 30)).toBe('2026-10-09')
    expect(resolve('OFFSET_DAYS', 0)).toBe('2026-09-09')
  })

  it('⚠️ 偏移月份沿用 JS 的溢出规则 —— 3 月 31 日加一个月是 5 月 1 日', () => {
    const mar31 = new Date(2026, 2, 31)
    // 4 月没有 31 日，JS 溢出到 5 月 1 日。不"修正"成 4 月 30 日 ——
    // 任何一种修正都是我们自己编的规则，用户对它没有预期
    expect(formatLocalDate(resolveRelativeDate({ token: 'OFFSET_MONTHS', offset: 1 }, mar31)!)).toBe(
      '2026-05-01'
    )
    expect(resolve('OFFSET_MONTHS', 3)).toBe('2026-12-09')
    expect(resolve('OFFSET_MONTHS', -9)).toBe('2025-12-09')
  })

  it('⚠️ 从当天零点起算 —— 带上时分秒会让同一个默认值在上午和下午存进去的内容不同', () => {
    const morning = new Date(2026, 8, 9, 1, 0, 0)
    const evening = new Date(2026, 8, 9, 23, 59, 59)
    expect(resolveRelativeDate({ token: 'TODAY' }, morning)!.getTime()).toBe(
      resolveRelativeDate({ token: 'TODAY' }, evening)!.getTime()
    )
  })

  it('认不出来的 token 返回 undefined，而不是回退到今天', () => {
    expect(resolveRelativeDate({ token: 'NOT_A_TOKEN' }, NOW)).toBeUndefined()
    expect(resolveRelativeDate({}, NOW)).toBeUndefined()
    expect(resolveRelativeDate(null, NOW)).toBeUndefined()
  })

  it('日期时间控件才带时分秒 —— 多出来的 00:00:00 会让日期控件显示成带时间的值', () => {
    expect(resolveRelativeDateText({ token: 'TODAY' }, NOW)).toBe('2026-09-09')
    expect(resolveRelativeDateText({ token: 'TODAY' }, NOW, true)).toBe('2026-09-09 00:00:00')
  })

  it('每个下拉选项都能解析出日期 —— 清单与实现不同步会让某一项静默失效', () => {
    for (const option of RELATIVE_DATE_OPTIONS) {
      expect(
        resolveRelativeDate({ token: option.value, offset: 1 }, NOW),
        `${option.label}(${option.value}) 解析不出日期`
      ).toBeTruthy()
    }
  })
})

describe('千分位', () => {
  it('基本分组', () => {
    expect(formatThousands(1234567.89)).toBe('1,234,567.89')
    expect(formatThousands(1000)).toBe('1,000')
    expect(formatThousands(999)).toBe('999')
    expect(formatThousands(-1234567)).toBe('-1,234,567')
  })

  it('指定小数位', () => {
    expect(formatThousands(1234.5, 2)).toBe('1,234.50')
    expect(formatThousands(1234.567, 2)).toBe('1,234.57')
    expect(formatThousands(1234, 0)).toBe('1,234')
  })

  it('⚠️ 不是数字时原样返回 —— 显示 NaN 或空串会让用户以为填的东西丢了', () => {
    expect(formatThousands('abc')).toBe('abc')
    expect(formatThousands('')).toBe('')
    expect(formatThousands(null)).toBe('')
    expect(formatThousands(undefined)).toBe('')
  })
})

describe('人民币大写', () => {
  it('整元', () => {
    expect(toChineseAmount(0)).toBe('零元整')
    expect(toChineseAmount(1)).toBe('壹元整')
    expect(toChineseAmount(10)).toBe('壹拾元整')
    expect(toChineseAmount(100)).toBe('壹佰元整')
    expect(toChineseAmount(1000)).toBe('壹仟元整')
    expect(toChineseAmount(10000)).toBe('壹万元整')
    expect(toChineseAmount(100000000)).toBe('壹亿元整')
  })

  it('⚠️ 中间的零要读且只读一个，末尾的零不读', () => {
    expect(toChineseAmount(1002)).toBe('壹仟零贰元整')
    expect(toChineseAmount(1200)).toBe('壹仟贰佰元整')
    expect(toChineseAmount(1020)).toBe('壹仟零贰拾元整')
    expect(toChineseAmount(100000001)).toBe('壹亿零壹元整')
  })

  it('⚠️ 角为零而分不为零时，那个零必须读 —— 否则「壹元伍分」会被看成「壹元伍角」', () => {
    expect(toChineseAmount(1.05)).toBe('壹元零伍分')
    expect(toChineseAmount(1.5)).toBe('壹元伍角')
    expect(toChineseAmount(1.55)).toBe('壹元伍角伍分')
  })

  it('⚠️ 只到分，三位小数四舍五入，且进位走十进制不走浮点', () => {
    expect(toChineseAmount(1.234)).toBe('壹元贰角叁分')
    expect(toChineseAmount(1.235)).toBe('壹元贰角肆分')
    // 0.145 是这里最要紧的一条：Math.round(0.145 * 100) 得到的是 14 而不是 15
    // （0.145 在二进制里是 0.14499999...）。按十进制进位才是 15 分。
    // 一分钱的差异在对账时是要查一整天的
    expect(toChineseAmount(0.145)).toBe('壹角伍分')
    // 全是 9 的进位：9.99 元 + 半分 → 10 元整
    expect(toChineseAmount(9.995)).toBe('壹拾元整')
  })

  it('⚠️ 不足一元时不写「零元」，与票据填写规范一致', () => {
    expect(toChineseAmount(0.14)).toBe('壹角肆分')
    // 角为零时也不补那个零：0.05 是「伍分」不是「零伍分」
    expect(toChineseAmount(0.05)).toBe('伍分')
    expect(toChineseAmount(0.5)).toBe('伍角')
    // 但金额确实是 0 时仍要写「零元整」，否则大写栏是空的
    expect(toChineseAmount(0)).toBe('零元整')
  })

  it('大额与字符串入参', () => {
    expect(toChineseAmount('1234567.89')).toBe('壹佰贰拾叁万肆仟伍佰陆拾柒元捌角玖分')
    expect(toChineseAmount(12345678)).toBe('壹仟贰佰叁拾肆万伍仟陆佰柒拾捌元整')
    // 中间整节为零
    expect(toChineseAmount(100020000)).toBe('壹亿零贰万元整')
  })

  it('负数与展示体（一二三）', () => {
    expect(toChineseAmount(-1.05)).toBe('负壹元零伍分')
    expect(toChineseAmount(1234, false)).toBe('一千二百三十四元整')
  })

  it('无法转换时返回空串 —— 显示一个错的金额比不显示危险', () => {
    expect(toChineseAmount('abc')).toBe('')
    expect(toChineseAmount('')).toBe('')
    expect(toChineseAmount(null)).toBe('')
    // 超出支持范围
    expect(toChineseAmount(1e15)).toBe('')
  })
})

describe('规则树后置加工', () => {
  it('千分位：给单行输入框装上 formatter 与 parser，且两者严格互逆', () => {
    const tree: any[] = [
      { type: 'input', field: 'amount', props: { thousands: true, precision: 2 } },
      { type: 'input', field: 'qty', props: {} }
    ]
    applyThousandsFormat(tree)

    expect(tree[0].props.formatter(1234567.5)).toBe('1,234,567.50')
    // ⚠️ parser 必须能把 formatter 的产物还原：少了它，用户一聚焦编辑，
    // "1,234" 会被原样当成内容提交
    expect(tree[0].props.parser('1,234,567.50')).toBe('1234567.50')
    // 没开千分位的字段不动
    expect(tree[1].props.formatter).toBeUndefined()
  })

  it('⚠️ 数字输入框不挂 formatter —— el-input-number 根本没有这个 prop', () => {
    // 挂上去不会报错，只是完全不生效。这类「配了但不生效」比没有功能更糟，
    // 所以改走后缀展示（见下一条用例）
    const tree: any[] = [{ type: 'inputNumber', field: 'amount', props: { thousands: true } }]
    applyThousandsFormat(tree)
    expect(tree[0].props.formatter).toBeUndefined()
  })

  it('千分位：递归处理布局容器与子表', () => {
    const tree: any[] = [
      {
        type: 'col',
        children: [{ type: 'input', field: 'a', props: { thousands: true } }]
      },
      {
        type: 'group',
        field: 'items',
        props: { rule: [{ type: 'input', field: 'b', props: { thousands: true } }] }
      }
    ]
    applyThousandsFormat(tree)
    expect(tree[0].children[0].props.formatter).toBeTypeOf('function')
    expect(tree[1].props.rule[0].props.formatter).toBeTypeOf('function')
  })

  it('后缀展示：收集需要显示金额信息的字段', () => {
    const tree: any[] = [
      { type: 'inputNumber', field: 'total', props: { chineseAmount: true } },
      // 数字输入框的千分位走后缀
      { type: 'inputNumber', field: 'amount', props: { thousands: true } },
      // 单行输入框的千分位已经原地格式化了，不该再在后面重复显示一遍
      { type: 'input', field: 'text', props: { thousands: true } },
      { type: 'inputNumber', field: 'qty', props: {} }
    ]
    const fields = collectAmountDisplayFields(tree)
    expect(fields.map((f) => f.field)).toEqual(['total', 'amount'])
    expect(fields[0]).toMatchObject({ chineseAmount: true, thousands: false })
    expect(fields[1]).toMatchObject({ chineseAmount: false, thousands: true })
  })

  it('后缀展示：按配置拼出千分位与大写', () => {
    const both = buildAmountSuffix(
      { field: 'a', thousands: true, chineseAmount: true, precision: 2 },
      1234
    )
    expect(both?.children?.[0]).toBe('1,234.00　壹仟贰佰叁拾肆元整')

    const onlyChinese = buildAmountSuffix({ field: 'a', thousands: false, chineseAmount: true }, 1234)
    expect(onlyChinese?.children).toEqual(['壹仟贰佰叁拾肆元整'])

    // 空值与非数字不显示，而不是显示一个空块或孤零零的 0
    expect(buildAmountSuffix({ field: 'a', thousands: true, chineseAmount: true }, '')).toBeUndefined()
    expect(buildAmountSuffix({ field: 'a', thousands: true, chineseAmount: true }, 'abc')?.children)
      .toEqual(['abc'])
  })

  it('⚠️ 相对日期默认值：带不带时分秒看 props.type，不是规则的 type', () => {
    // 契约里只有一个 datePicker 控件，「日期」与「日期时间」的区别在 props.type 上。
    // 判错的表现是 el-date-picker 显示空白 —— 看起来像默认值没生效
    const tree: any[] = [
      {
        type: 'datePicker',
        field: 'day',
        props: { type: 'date', relativeDefaultToken: 'TODAY' }
      },
      {
        type: 'datePicker',
        field: 'moment',
        props: { type: 'datetime', relativeDefaultToken: 'TODAY' }
      }
    ]
    const values = resolveRelativeDefaults(tree, NOW)
    expect(values.day).toBe('2026-09-09')
    expect(values.moment).toBe('2026-09-09 00:00:00')
  })

  it('⚠️ 已经有值的字段不覆盖 —— 编辑既有记录时默认值绝不能盖掉用户存过的日期', () => {
    const tree: any[] = [
      { type: 'datePicker', field: 'day', props: { relativeDefaultToken: 'TODAY' } }
    ]
    expect(resolveRelativeDefaults(tree, NOW, { day: '2020-01-01' })).toEqual({})
    // 空串与 null 都算没值：清空过的字段与从未填过的字段在这里没有区别
    expect(resolveRelativeDefaults(tree, NOW, { day: '' }).day).toBe('2026-09-09')
    expect(resolveRelativeDefaults(tree, NOW, { day: null }).day).toBe('2026-09-09')
  })

  it('没配相对默认值的字段不产出任何值', () => {
    const tree: any[] = [{ type: 'datePicker', field: 'day', props: {} }]
    expect(resolveRelativeDefaults(tree, NOW)).toEqual({})
  })
})
