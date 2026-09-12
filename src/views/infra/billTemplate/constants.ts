/**
 * 单据模板的前端常量
 *
 * 这里只放「取值集合与文案」，不放任何拼号或周期解析逻辑 ——
 * 那些规则一律由后端负责，前端通过 preview 接口与 resetCycleActual 字段拿结果。
 */

/** 生成方式 */
export const GEN_TYPE = {
  /** 时间流水。唯一会消耗流水计数的方式 */
  TIME: 1,
  /** 随机数编号 */
  RANDOM: 2,
  /** UUID */
  UUID: 3
} as const

export const GEN_TYPE_OPTIONS = [
  { label: '时间流水', value: GEN_TYPE.TIME },
  { label: '随机数编号', value: GEN_TYPE.RANDOM },
  { label: 'UUID', value: GEN_TYPE.UUID }
]

/** 不含日期段的标记，与后端 BillDateFormats.NONE 对应 */
export const DATE_FORMAT_NONE = 'NONE'

/**
 * 日期格式白名单
 *
 * 直接用 Java 的 pattern 字面量，前后端共用同一套取值，中间不做格式转换 ——
 * 转换表是最容易漏改的地方，新增一种粒度就得记得两边都加。
 */
export const DATE_FORMAT_OPTIONS = [
  { label: '不含日期', value: DATE_FORMAT_NONE },
  { label: '年（2026）', value: 'yyyy' },
  { label: '年月（202609）', value: 'yyyyMM' },
  { label: '年月日（20260906）', value: 'yyyyMMdd' },
  { label: '到时（2026090614）', value: 'yyyyMMddHH' },
  { label: '到分（202609061430）', value: 'yyyyMMddHHmm' },
  { label: '到秒（20260906143045）', value: 'yyyyMMddHHmmss' },
  { label: '到毫秒（20260906143045123）', value: 'yyyyMMddHHmmssSSS' }
]

/** 重置周期 */
export const RESET_CYCLE_OPTIONS = [
  { label: '跟随日期格式', value: 'AUTO' },
  { label: '不重置', value: 'NONE' },
  { label: '按天重置', value: 'DAY' },
  { label: '按月重置', value: 'MONTH' },
  { label: '按年重置', value: 'YEAR' }
]

/** 随机位数 */
export const RANDOM_DIGIT_OPTIONS = [
  { label: '16 位', value: 16 },
  { label: '32 位', value: 32 }
]

/** 随机类型 */
export const RANDOM_TYPE_OPTIONS = [
  { label: '纯数字', value: 1 },
  { label: '字母 + 数字', value: 2 }
]
