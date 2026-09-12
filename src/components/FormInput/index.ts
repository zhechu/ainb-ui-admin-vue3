/**
 * 输入类增强
 *
 * 三样东西，都只影响输入体验与展示，不改变落库的值：
 * - **千分位**：数字输入框显示 1,234,567，编辑时仍是纯数字
 * - **金额大写**：输入框后面跟一行「壹佰贰拾叁万元整」，供核对
 * - **相对日期默认值**：默认值存的是语义（今天 / 本月初 / 7 天后），运行时才解析
 *
 * ## 为什么做成规则树的后置加工，而不是新控件
 *
 * 这三件事挂的都是设计器内核自带的控件（inputNumber、datePicker）。
 * 做成新控件意味着用户要在「数字输入」和「金额输入」之间选，而两者
 * 除了展示毫无区别 —— 已经拖好的表单还得重新拖一遍。
 *
 * 后置加工的代价是要知道内核的两个约定：el-input-number 的 formatter/parser、
 * 以及 form-create 规则的 suffix。两者都是公开 API。
 */

import { formatThousands, toChineseAmount } from './amount'
import { resolveRelativeDateText, type RelativeDateConfig } from './relativeDate'
import { readNestedRules } from '@/components/FormWidgets/contracts'

export * from './amount'
export * from './relativeDate'

/**
 * 相对默认值要不要带时分秒
 *
 * ⚠️ 判据是控件的 `props.type`，不是规则的 `type`：契约里只有一个 `datePicker`
 * 控件，「日期」与「日期时间」的区别在它的 props.type（date / datetime）上。
 * 按规则 type 判断的话，所有日期字段都会被当成纯日期，
 * 日期时间字段的默认值就少了时分秒 —— 而 el-date-picker 对格式不匹配的值
 * 是直接显示空白的，看起来像默认值没生效。
 */
const isDateTimeWidget = (rule: any): boolean =>
  String(rule?.props?.type ?? '').toLowerCase().includes('datetime')

/**
 * 遍历规则树
 *
 * 布局容器走 children，子表控件走契约声明的嵌套路径 —— 这两者不是一回事，
 * 漏掉任一种都等于那一部分表单没有被加工。
 */
const walkRules = (rules: any[] | undefined | null, visit: (rule: any) => void): void => {
  if (!Array.isArray(rules)) return
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    visit(rule)
    walkRules(readNestedRules(rule), visit)
    walkRules(rule.children, visit)
  }
}

/**
 * 支持 formatter / parser 的控件类型
 *
 * ⚠️ **el-input-number 不在其中**：Element Plus 的数字输入框根本没有这两个 prop
 * （el-input 有，el-input-number 没有）。给它挂 formatter 不会报错，
 * 只是完全不生效 —— 典型的「配了但不生效」。
 *
 * 所以数字输入框的千分位改走后缀展示（见 collectAmountDisplayFields）：
 * 输入框里仍是纯数字，格式化后的数值显示在它旁边。
 * 这不如原地格式化好看，但它是真的能用的。
 */
const FORMATTER_CAPABLE_TYPES = new Set(['input'])

/**
 * 给单行输入框装上千分位
 *
 * ⚠️ parser 必须与 formatter 严格互逆。少写 parser 的话，用户一旦聚焦编辑，
 * 输入框里的 "1,234" 会被当成内容原样提交。
 *
 * @param rules 规则树，会被就地修改
 */
export const applyThousandsFormat = (rules: any[] | undefined | null): void => {
  walkRules(rules, (rule) => {
    if (rule.props?.thousands !== true) return
    if (!FORMATTER_CAPABLE_TYPES.has(rule.type)) return
    const precision = typeof rule.props.precision === 'number' ? rule.props.precision : undefined
    rule.props.formatter = (value: any) => formatThousands(value, precision)
    rule.props.parser = (text: any) => String(text ?? '').replace(/,/g, '')
  })
}

/** 一个需要在控件后面显示金额信息的字段 */
export interface AmountDisplayField {
  field: string
  /** 显示千分位数值。只有 formatter 用不上的控件才需要 */
  thousands: boolean
  /** 显示人民币大写 */
  chineseAmount: boolean
  precision?: number
}

/**
 * 收集需要在控件后面显示金额信息的字段
 *
 * 两种情况：
 * - 配了金额大写的字段（任何控件）
 * - 配了千分位、但控件本身不支持 formatter 的字段（数字输入框）
 *
 * 只返回配置，具体怎么显示由调用方决定 —— 文本必须随值变化而更新，
 * 而「怎么订阅值变化」是运行时页面的事（它持有 fApi），不是本模块的事。
 */
export const collectAmountDisplayFields = (
  rules: any[] | undefined | null
): AmountDisplayField[] => {
  const result: AmountDisplayField[] = []
  walkRules(rules, (rule) => {
    if (!rule.field) return
    const chineseAmount = rule.props?.chineseAmount === true
    // 支持 formatter 的控件已经原地格式化了，不必再在后面重复显示一遍
    const thousands = rule.props?.thousands === true && !FORMATTER_CAPABLE_TYPES.has(rule.type)
    if (!chineseAmount && !thousands) return
    result.push({
      field: rule.field,
      thousands,
      chineseAmount,
      precision: typeof rule.props?.precision === 'number' ? rule.props.precision : undefined
    })
  })
  return result
}

/**
 * 构造金额信息的 suffix 规则
 *
 * form-create 的 rule.suffix 本身也是一条规则，渲染在控件之后。
 *
 * @returns suffix 规则；没有可显示的内容时返回 undefined（不显示空块）
 */
export const buildAmountSuffix = (
  config: AmountDisplayField,
  value: any
): Record<string, any> | undefined => {
  const parts: string[] = []
  if (config.thousands) {
    const formatted = formatThousands(value, config.precision)
    // 空值不显示。显示一个孤零零的「0」会让用户以为字段里已经有值了
    if (formatted) parts.push(formatted)
  }
  if (config.chineseAmount) {
    const text = toChineseAmount(value)
    if (text) parts.push(text)
  }
  if (!parts.length) return undefined
  return {
    type: 'div',
    class: 'form-chinese-amount',
    children: [parts.join('　')]
  }
}

/**
 * 解析相对日期默认值
 *
 * @param rules   规则树
 * @param now     「现在」。显式传入以便测试固定时间
 * @param current 当前表单数据。**已经有值的字段不覆盖** ——
 *                编辑一条既有记录时，默认值绝不能盖掉用户存过的日期
 * @returns 需要写入的 字段 → 日期文本
 */
export const resolveRelativeDefaults = (
  rules: any[] | undefined | null,
  now: Date,
  current?: Record<string, any>
): Record<string, string> => {
  const result: Record<string, string> = {}
  walkRules(rules, (rule) => {
    // 两个属性是【平铺】的，不是一个嵌套对象：设计器的属性表单项是
    // 「一个字段 ↔ 一个值」的模型，配一个嵌套对象需要专门做桥接组件，
    // 而这里只有两个标量，不值当
    const config: RelativeDateConfig = {
      token: rule.props?.relativeDefaultToken,
      offset: rule.props?.relativeDefaultOffset
    }
    if (!config.token || !rule.field) return
    const existing = current?.[rule.field]
    // 空串也算没值：清空过的字段与从未填过的字段在这里没有区别
    if (existing !== undefined && existing !== null && existing !== '') return
    const text = resolveRelativeDateText(config, now, isDateTimeWidget(rule))
    if (text) {
      result[rule.field] = text
    }
  })
  return result
}
