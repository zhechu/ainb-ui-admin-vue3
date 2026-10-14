/**
 * 列表单元格的展示形态
 *
 * ## 为什么要拆出「文本」与「非文本」两类
 *
 * 列格式化原本只有六种，全部产出一个字符串，所以运行时直接把结果插值进单元格。
 * 但图片、附件、超链接、标签这四种要渲染成元素而不是文字 ——
 * 继续走插值的话，图片列显示的是一串 JSON，附件列显示的是一串 URL。
 *
 * 这里把「算出显示什么」与「渲染成什么」分开：本模块只做纯计算（可单测），
 * `ListCell.vue` 按 `cellRenderKind` 选渲染分支。
 */
import { getDictLabel } from '@/utils/dict'
import { formatDate } from '@/utils/formatTime'
import { isSafeLinkUrl } from './linkUrl'
import {
  BOOLEAN_TEXT,
  CELL_FORMAT_CONTRACTS,
  EMPTY_CELL as CONTRACT_EMPTY_CELL,
  NUMBER_FORMAT,
  isTruthyCellValue,
  type CellFormatterType
} from './contracts/cellFormat'

export type { CellFormatterType }

/**
 * 设计器下拉用的清单
 *
 * ⚠️ 从契约生成，不在这里硬编码 —— 导出那一侧要认识同一批格式化，
 * 两边各维护一份清单的话，前端加了一种、后端不知道，
 * 表现是「列表显示正常、导出是原始值」。
 */
export const CELL_FORMATTERS: Array<{ value: CellFormatterType; label: string }> =
  CELL_FORMAT_CONTRACTS.map((c) => ({ value: c.type, label: c.label }))

/** 渲染分支 */
export type CellRenderKind = 'TEXT' | 'TAG' | 'LINK' | 'IMAGE' | 'FILE'

export const cellRenderKind = (formatter: any): CellRenderKind => {
  switch (formatter?.type) {
    case 'TAG':
      return 'TAG'
    case 'LINK':
      return 'LINK'
    case 'IMAGE':
      return 'IMAGE'
    case 'FILE':
      return 'FILE'
    default:
      return 'TEXT'
  }
}

/** 空值的统一占位。来自契约 —— 后端导出也要知道它 */
export const EMPTY_CELL = CONTRACT_EMPTY_CELL

export const isEmptyCellValue = (value: any): boolean =>
  value === null || value === undefined || value === ''

/**
 * 文本类格式化
 *
 * 标签类型也走这里取显示文案 —— 标签上印的就是字典翻译后的文字，
 * 两处各写一遍会出现「列表里翻译了、标签上还是编码」。
 */
export const formatCellText = (value: any, formatter: any): string => {
  if (isEmptyCellValue(value)) return EMPTY_CELL
  const type = formatter?.type
  if (!type || type === 'NONE') return String(value)

  switch (type) {
    case 'DICT':
    case 'TAG':
      return formatter.dictType ? getDictLabel(formatter.dictType, value) : String(value)
    case 'DATE':
      return formatDate(value, 'YYYY-MM-DD')
    case 'DATETIME':
      return formatDate(value, 'YYYY-MM-DD HH:mm:ss')
    case 'NUMBER':
      return formatNumber(value, formatter)
    case 'PERCENT': {
      const num = Number(value)
      if (Number.isNaN(num)) return String(value)
      // 库里存的是小数（0.15）还是已经乘过 100 的数（15），
      // 两种约定都存在，交给配置决定，默认按「库里存小数」
      const scaled = formatter.alreadyScaled ? num : num * 100
      return `${scaled.toFixed(formatter.precision ?? NUMBER_FORMAT.defaultPrecision)}%`
    }
    case 'BOOLEAN':
      // 判真规则与「是/否」的文案都来自契约，与后端导出共用一份声明
      return isTruthyCellValue(value) ? BOOLEAN_TEXT.trueText : BOOLEAN_TEXT.falseText
    default:
      return String(value)
  }
}

/** 数字格式化。千分位与小数位共用一套，避免「显示 1,234.57 但合计是 1234.5」 */
const formatNumber = (value: any, formatter: any): string => {
  const num = Number(value)
  if (Number.isNaN(num)) return String(value)
  const precision = formatter.precision ?? NUMBER_FORMAT.defaultPrecision
  const fixed = num.toFixed(precision)
  if (!formatter.thousands) return fixed
  return Number(fixed).toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  })
}

/**
 * 合计行的显示值
 *
 * 合计行原本一律 `toFixed(2)`，不读列自己的格式化配置 —— 列配了「0 位小数 + 千分位」时，
 * 数据行显示 `1,234`、合计行显示 `1234.00`，同一列上下看起来像两套数，
 * 而用户第一反应是「合计算错了」。
 *
 * 数值类格式化（NUMBER / PERCENT）直接复用 `formatCellText`，与数据行走同一条路径 ——
 * 两处各写一遍格式化必然漂移，这正是本项目反复在收口的那类问题。
 *
 * ⚠️ PERCENT 的合计在业务上没有意义（百分比相加得不到百分比），这里仍按 PERCENT 印出来，
 * 不悄悄换成别的显示：配错了就该看着像配错了。设计器那边已经有「这列看起来不是数值列」
 * 的提示，要不要拦是那边的事。
 */
export const formatSummaryValue = (sum: number, formatter: any): string => {
  const type = formatter?.type
  if (type === 'NUMBER' || type === 'PERCENT') return formatCellText(sum, formatter)
  // 其余情况（没配格式化，或配的是字典/布尔这类合不出意义的）输出裸数字
  return String(stripFloatNoise(sum))
}

/**
 * 抹掉浮点累加的尾巴
 *
 * `0.1 + 0.2` 累加出来是 `0.30000000000000004`，原样印在合计行上比少两位小数
 * 更难向用户解释。12 位小数足够覆盖金额、数量这类业务数值，又刚好落在
 * IEEE 754 双精度能如实表示的范围内 —— 再多几位反而把误差本身保留下来。
 */
const stripFloatNoise = (value: number): number => Number(value.toFixed(12))

/** el-tag 可用的类型 */
const TAG_TYPES = ['primary', 'success', 'warning', 'danger', 'info'] as const

export type CellTagType = (typeof TAG_TYPES)[number]

/**
 * 标签颜色
 *
 * 优先用用户配的映射；没配时按值算一个稳定的颜色 ——
 * 关键是**同一个值每次都得到同一个颜色**，否则翻页时同一个状态变色，
 * 看起来像是数据变了。用字符和做散列，不引依赖。
 */
export const tagTypeOf = (value: any, formatter: any): CellTagType => {
  const mapped = formatter?.tagTypes?.[String(value)]
  if (mapped && (TAG_TYPES as readonly string[]).includes(mapped)) return mapped as CellTagType
  const key = String(value)
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash + key.charCodeAt(i)) % TAG_TYPES.length
  }
  return TAG_TYPES[hash]
}

/** 附件 / 图片项 */
export interface CellFileItem {
  name: string
  url: string
}

/**
 * 把一个上传类字段的值解析成可渲染的清单
 *
 * 要兼容三种形态，因为落库形态与控件形态并不统一：
 * - 对象数组 `[{name, url}]` —— 服务端补齐元信息后的标准形态
 * - JSON 字符串 —— 多值字段在库里就是一段 JSON 文本，列表查询原样取出
 * - 裸 URL 字符串 —— 单图与签名的落库形态是 scalar
 *
 * 解析不出来时返回空数组而不是抛异常：一列坏数据不该让整张列表白屏。
 */
export const parseCellFiles = (value: any): CellFileItem[] => {
  if (isEmptyCellValue(value)) return []

  let raw = value
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        raw = JSON.parse(trimmed)
      } catch {
        return []
      }
    } else {
      // 裸 URL。逗号分隔是早期数据里出现过的形态，顺手认掉
      return trimmed
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean)
        .map((url) => ({ url, name: fileNameOf(url) }))
    }
  }

  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .map((item): CellFileItem | null => {
      if (typeof item === 'string') return { url: item, name: fileNameOf(item) }
      if (item && typeof item === 'object' && typeof item.url === 'string') {
        return { url: item.url, name: item.name || fileNameOf(item.url) }
      }
      return null
    })
    .filter((item): item is CellFileItem => !!item)
}

/**
 * 从 URL 末段取文件名，取不到时给一个占位而不是空字符串
 *
 * 要解百分号编码：文件服务返回的地址里中文是编码过的，
 * 不解的话附件列显示的是一串 %E4%B8%AD%E6%96%87…… 的乱码。
 */
const fileNameOf = (url: string): string => {
  const segment = url.split('?')[0].split('/').filter(Boolean).pop()
  if (!segment) return '附件'
  try {
    return decodeURIComponent(segment)
  } catch {
    // 地址里有裸 % 时 decodeURIComponent 会抛，原样返回比丢掉文件名好
    return segment
  }
}

/**
 * 超链接的地址与文案
 *
 * 地址不安全时**降级成纯文本**而不是渲染一个点不动的链接 ——
 * 渲染成链接会让用户以为能点，点了没反应比看到一段文字更费解。
 */
export const resolveCellLink = (
  value: any,
  formatter: any
): { url?: string; text: string } => {
  const text = formatter?.linkText || String(value ?? '')
  const url = String(value ?? '')
  return isSafeLinkUrl(url) ? { url, text } : { text }
}
