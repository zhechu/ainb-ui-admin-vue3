/**
 * 列格式化契约 —— 前端访问层
 *
 * 契约的规范副本在后端
 * `yudao-module-infra/src/main/resources/form-design/cell-format-contracts.json`，
 * 本目录下的 JSON 是构建期副本。两份是否一致由
 * `tests/e2e/cell-format-contract-sync.spec.ts` 守着。
 *
 * ## 这份契约存在的理由
 *
 * 列表的格式化在前端（`listCell.ts`），导出在后端。「照列表导出」意味着
 * 后端要再实现一遍同样的规则 —— 两份实现必然漂移，而漂移的表现是：
 * 前端改了某种格式化的行为，导出那边不知道，于是**列表显示正常、导出是另一套**。
 *
 * 所以规则抽成一份声明，两端各自实现、共用同一份常量。
 *
 * ## 两端各用哪一部分
 *
 * | 部分 | 前端 | 后端 |
 * |---|---|---|
 * | `formatters[].type/label` | 设计器下拉 | 认识哪些格式化 |
 * | `emptyCell` | 空值占位 | —（Excel 里空就是空） |
 * | `booleanText` | 显示「是/否」 | 导出「是/否」 |
 * | `numberFormat.defaultPrecision` | 没配 precision 时的小数位 | 同 |
 * | `numberFormat.*` 其余 | — | 拼 Excel 的 numFmt |
 * | `formatters[].export` | — | 导出模式 |
 * | `rowKinds` | — | 合计行标记 / 导入时识别 |
 *
 * 前端用不到的部分不代表可以不管：**它们是同一份声明的一部分**，
 * 一致性测试会整份比对。
 *
 * ⚠️ 改契约时必须同时改两份文件。
 */
import contractFile from './cell-format-contracts.json'

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

export interface CellFormatExportRule {
  mode: 'TEXT' | 'VALUE_WITH_FMT'
  source?: 'RAW' | 'DICT_LABEL' | 'BOOLEAN_TEXT' | 'FILE_URL'
  valueKind?: 'DATE' | 'DATETIME' | 'NUMBER'
  numFmt?: string
  numFmtFrom?: string
  numFmtSuffix?: string
  divideBy100WhenAlreadyScaled?: boolean
  fillByDictColor?: boolean
  /** 为 false 表示故意不跟随列表的显示形态，理由在契约文件头 */
  followsList?: boolean
}

export interface CellFormatContract {
  type: CellFormatterType
  label: string
  export: CellFormatExportRule
}

const file = contractFile as any

/** 全部格式化，顺序即设计器下拉的顺序 */
export const CELL_FORMAT_CONTRACTS: CellFormatContract[] = file.formatters

const BY_TYPE = new Map<string, CellFormatContract>(
  CELL_FORMAT_CONTRACTS.map((c) => [c.type, c])
)

/**
 * 取一种格式化的契约
 *
 * 认不出的一律回落到 NONE —— 与后端 `CellFormatContractRegistry#get` 一致。
 * 抛错的话，一个历史配置会让整张列表渲染不出来。
 */
export const cellFormatOf = (type: string | undefined | null): CellFormatContract =>
  BY_TYPE.get(String(type)) ?? (BY_TYPE.get('NONE') as CellFormatContract)

/** 空值的统一占位 */
export const EMPTY_CELL: string = file.emptyCell

/** 布尔的显示文案与判真规则 */
export const BOOLEAN_TEXT: {
  trueText: string
  falseText: string
  trueValues: any[]
} = file.booleanText

/** 数字格式的拼装规则 */
export const NUMBER_FORMAT: {
  integer: string
  integerThousands: string
  decimalSeparator: string
  decimalDigit: string
  defaultPrecision: number
} = file.numberFormat

/** 「视图产物」行的标记。前端暂时用不到，导出与导入侧在用 */
export const ROW_KINDS: {
  summaryLabel: string
  groupLabelPrefix: string
  skipOnImport: boolean
} = file.rowKinds

export const CELL_FORMAT_CONTRACT_VERSION: number = file.contractVersion

/**
 * 值算不算「真」
 *
 * 判据来自契约，与后端 `CellFormatContractRegistry#isTruthy` 是同一份声明。
 * 原先这里是写死的 `value === true || value === 1 || value === '1'`，
 * 后端要照着抄一遍 —— 抄的那一刻就开始漂了。
 */
export const isTruthyCellValue = (value: any): boolean =>
  BOOLEAN_TEXT.trueValues.some((candidate) => candidate === value)
