/**
 * 金额的展示格式化
 *
 * 两件事：千分位与人民币大写。都只影响**展示**，不影响落库的值 ——
 * 存字符串 "1,234.00" 会让后续所有数值计算与排序都失效
 * （数据库里 varchar 的 "1,234" 排在 "9" 前面）。
 *
 * ## 四舍五入不走浮点
 *
 * 金额的进位必须落在十进制上。`Math.round(0.145 * 100)` 得到的是 **14** 而不是 15
 * —— 因为 0.145 在二进制里是 0.14499999...，乘 100 之后已经小于 14.5。
 * 一分钱的差异在对账时是要查一整天的，所以这里一律用字符串解析进位，
 * 不做任何浮点乘除。
 */

/** 拆开的十进制数值 */
interface DecimalParts {
  negative: boolean
  /** 整数部分，数字串（可能很长，不转成 number） */
  intPart: string
  /** 小数部分，数字串，可能为空 */
  decimals: string
}

/**
 * 按十进制解析数值文本
 *
 * @returns 解析结果；不是普通十进制写法（如科学计数法、含字母）返回 undefined
 */
const parseDecimal = (value: any): DecimalParts | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const text = String(value).trim()
  const matched = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!matched) return undefined
  const intPart = matched[2] ?? ''
  const decimals = matched[3] ?? ''
  // "."、"-" 这种既没有整数也没有小数的写法不算数值
  if (!intPart && !decimals) return undefined
  return { negative: matched[1] === '-', intPart: intPart || '0', decimals }
}

/**
 * 把数字串按指定小数位四舍五入
 *
 * 全程字符串运算：进位靠逐位处理，不经过 Number。
 *
 * @returns [整数部分, 小数部分]
 */
const roundDecimal = (parts: DecimalParts, precision: number): [string, string] => {
  const decimals = parts.decimals
  if (decimals.length <= precision) {
    return [parts.intPart, decimals.padEnd(precision, '0')];
  }
  const kept = decimals.slice(0, precision)
  const roundUp = Number(decimals[precision]) >= 5
  if (!roundUp) {
    return [parts.intPart, kept]
  }
  // 逐位进位。从最低位开始，9 变 0 并继续向上进
  const digits = (parts.intPart + kept).split('')
  let carryIndex = digits.length - 1
  while (carryIndex >= 0) {
    if (digits[carryIndex] === '9') {
      digits[carryIndex] = '0'
      carryIndex--
    } else {
      digits[carryIndex] = String(Number(digits[carryIndex]) + 1)
      break
    }
  }
  // 全是 9 的情况（9.99 → 10.00）：最高位再多一位
  const carried = carryIndex < 0 ? '1' + digits.join('') : digits.join('')
  const intLength = carried.length - precision
  return [carried.slice(0, intLength) || '0', carried.slice(intLength)]
}

/**
 * 千分位
 *
 * @param value     原值。允许 number 或字符串
 * @param precision 小数位数。传 undefined 时保留原有小数位
 * @returns 格式化后的文本；不是数字时原样返回（不猜用户想表达什么）
 */
export const formatThousands = (value: any, precision?: number): string => {
  if (value === null || value === undefined || value === '') return ''
  const parts = parseDecimal(value)
  // 不是数字就原样返回：这里是展示层，把用户输入的内容替换成 "NaN" 或空串
  // 都比原样显示更糟 —— 他会以为自己填的东西丢了
  if (!parts) return String(value).trim()

  const [intPart, decimals] =
    precision === undefined || precision === null
      ? [parts.intPart, parts.decimals]
      : roundDecimal(parts, precision)
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (parts.negative ? '-' : '') + grouped + (decimals ? '.' + decimals : '')
}

// ==================== 人民币大写 ====================

/** 展示体：一二三，易读 */
const PLAIN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const PLAIN_UNITS = ['', '十', '百', '千']
/** 票据体：壹贰叁，不易篡改 */
const FINANCIAL_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const FINANCIAL_UNITS = ['', '拾', '佰', '仟']
/** 节单位：个、万、亿、万亿 */
const SECTION_UNITS = ['', '万', '亿', '万亿']

/**
 * 把一节（最多 4 位）转成大写
 *
 * 「零」的处理是这套算法里唯一麻烦的地方：
 * - 1002 → 壹仟零贰（中间的零要读，且只读一个）
 * - 1200 → 壹仟贰佰（末尾的零不读）
 * - 1020 → 壹仟零贰拾
 */
const sectionToChinese = (section: number, financial: boolean): string => {
  const digits = financial ? FINANCIAL_DIGITS : PLAIN_DIGITS
  const units = financial ? FINANCIAL_UNITS : PLAIN_UNITS
  let result = ''
  let zeroPending = false
  let unitIndex = 0
  let rest = section
  while (rest > 0) {
    const digit = rest % 10
    if (digit === 0) {
      // 末尾的零不读，中间的零攒着，等遇到非零数字时读一个
      zeroPending = result.length > 0
    } else {
      result = digits[digit] + units[unitIndex] + (zeroPending ? digits[0] : '') + result
      zeroPending = false
    }
    rest = Math.floor(rest / 10)
    unitIndex++
  }
  return result
}

/**
 * 整数部分转大写
 *
 * 按 4 位一节切分，节与节之间的零也要读，但**只在后面还有非零内容时才读**：
 * - 100000001 → 壹亿零壹（中间整节为零）
 * - 10000     → 壹万（末尾整节为零，不读）
 *
 * 这两条的区别是这个函数存在的全部理由 —— 无条件补零会得到「壹万零元」。
 */
const integerToChinese = (value: string, financial: boolean): string => {
  const digits = financial ? FINANCIAL_DIGITS : PLAIN_DIGITS
  // 按 4 位一节从低位切
  const sections: number[] = []
  let rest = value.replace(/^0+/, '') || '0'
  if (rest === '0') return digits[0]
  while (rest.length > 0) {
    const start = Math.max(0, rest.length - 4)
    sections.push(Number(rest.slice(start)))
    rest = rest.slice(0, start)
  }

  let result = ''
  // 「下一段非零内容前要补一个零」。攒着而不是立刻输出，
  // 是因为末尾的零不读 —— 攒到最后没有非零内容，它就自然被丢掉了
  let zeroPending = false
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i]
    if (section === 0) {
      if (result) zeroPending = true
      continue
    }
    // 本节不足 4 位而前面还有更高的节：中间缺的那几位是零，要读一个
    if (result && section < 1000) {
      zeroPending = true
    }
    if (zeroPending) {
      result += digits[0]
      zeroPending = false
    }
    result += sectionToChinese(section, financial) + SECTION_UNITS[i]
  }
  return result
}

/** 大写支持的最大整数位数。超过 13 位（万亿）就不是「金额」而是别的什么了 */
const MAX_INT_DIGITS = 13

/**
 * 人民币大写
 *
 * @param value      金额，允许 number 或字符串
 * @param financial  true 用壹贰叁（票据），false 用一二三（展示）。默认 true
 * @returns 大写文本；无法转换时返回空串（调用方不展示）
 *
 * ## 只到分
 *
 * 人民币的最小单位是分，三位以上的小数四舍五入到分 ——
 * 「壹元贰角叁分肆」不是任何人认识的写法。进位走十进制，见文件头的说明。
 *
 * ## 不足一元时不写「零元」
 *
 * 0.14 写作「壹角肆分」而不是「零元壹角肆分」，与票据填写规范一致。
 */
export const toChineseAmount = (value: any, financial = true): string => {
  const parts = parseDecimal(value)
  if (!parts) return ''
  const [intText, decimals] = roundDecimal(parts, 2)
  if (intText.replace(/^0+/, '').length > MAX_INT_DIGITS) {
    // 不截断也不抛异常：返回空串让界面不显示大写，比显示一个错的金额安全
    return ''
  }

  const digits = financial ? FINANCIAL_DIGITS : PLAIN_DIGITS
  const yuanIsZero = intText.replace(/^0+/, '') === ''
  const jiao = Number(decimals[0] ?? '0')
  const fen = Number(decimals[1] ?? '0')

  let result = ''
  // 不足一元且有角分时省掉「零元」；整数为零且角分也为零时仍要写「零元整」
  if (!yuanIsZero || (jiao === 0 && fen === 0)) {
    result = integerToChinese(intText, financial) + '元'
  }
  if (jiao === 0 && fen === 0) {
    result += '整'
  } else {
    if (jiao > 0) {
      result += digits[jiao] + '角'
    } else if (result) {
      // 「壹元零伍分」：角为零而分不为零时那个零必须读，
      // 否则「壹元伍分」会被看成「壹元伍角」。
      // 但「元」本身被省掉时不补（0.05 是「伍分」不是「零伍分」）
      result += digits[0]
    }
    if (fen > 0) {
      result += digits[fen] + '分'
    }
  }
  return (parts.negative ? '负' : '') + result
}
