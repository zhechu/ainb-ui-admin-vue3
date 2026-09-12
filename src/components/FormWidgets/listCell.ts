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

/** 列格式化类型 */
export type CellFormatterType =
  | 'NONE'
  | 'DICT'
  | 'DATE'
  | 'DATETIME'
  | 'NUMBER'
  | 'PERCENT'
  | 'BOOLEAN'
  | 'TAG'
  | 'LINK'
  | 'IMAGE'
  | 'FILE'

/** 设计器下拉用的清单 */
export const CELL_FORMATTERS: Array<{ value: CellFormatterType; label: string }> = [
  { value: 'NONE', label: '无格式化' },
  { value: 'DICT', label: '字典翻译' },
  { value: 'DATE', label: '日期' },
  { value: 'DATETIME', label: '日期时间' },
  { value: 'NUMBER', label: '数字' },
  { value: 'PERCENT', label: '百分比' },
  { value: 'BOOLEAN', label: '布尔值' },
  { value: 'TAG', label: '标签' },
  { value: 'LINK', label: '超链接' },
  { value: 'IMAGE', label: '图片' },
  { value: 'FILE', label: '附件' }
]

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

/** 空值的统一占位 */
export const EMPTY_CELL = '-'

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
      return `${scaled.toFixed(formatter.precision ?? 2)}%`
    }
    case 'BOOLEAN':
      return value === true || value === 1 || value === '1' ? '是' : '否'
    default:
      return String(value)
  }
}

/** 数字格式化。千分位与小数位共用一套，避免「显示 1,234.57 但合计是 1234.5」 */
const formatNumber = (value: any, formatter: any): string => {
  const num = Number(value)
  if (Number.isNaN(num)) return String(value)
  const precision = formatter.precision ?? 2
  const fixed = num.toFixed(precision)
  if (!formatter.thousands) return fixed
  return Number(fixed).toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  })
}

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
