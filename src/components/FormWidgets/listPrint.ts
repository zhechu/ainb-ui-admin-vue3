/**
 * 列表打印：把当前看到的表格原样印出来
 *
 * 与**单据打印**（`printTemplate.ts`）是两件事：
 * 单据打印是「一条记录一页，按设计好的版式排」，列表打印是「这张表长什么样就印什么样」。
 * 两者的按钮、入口、配置都分开。
 *
 * ## 所见即所得，指的是这几件具体的事
 *
 * 常见的做法是把数据丢给一个通用的 JSON→表格打印库，按扁平的列清单印一遍。
 * 那样印出来的东西与屏幕上的表格**不是一回事**：
 *
 * - 分组表头没了 —— 两级表头被拍平成一行，「计划金额」与「实际金额」失去归属
 * - 合并单元格没了 —— 本来跨五行的「软件开发」变成重复五遍
 * - 分组行没了 —— 分组标题与组内小计整个消失
 * - 合计行没了 —— 最该印在纸上的那一行反而不见了
 *
 * 这四件事恰恰是用户为什么要打印这张表 —— 他要的是这张**报表**，不是这批数据。
 * 所以这里从渲染用的同一套结构出发，把 rowspan / colspan / 分组行 / 合计行
 * 一并落进 HTML。
 *
 * ## 为什么产出字符串而不是直接操作 DOM
 *
 * 直接克隆页面上的 `<table>` 看似省事，但会把 el-table 的固定列
 * （同一份数据渲染两遍）、虚拟滚动、排序图标、操作按钮一起复制进去 ——
 * 印出来的纸上会出现两遍相同的前两列，还带着「编辑 / 删除」两个按钮。
 * 从数据重新生成反而更可控，也能单测。
 */
import { escapeHtml } from './printTemplate'

export type PrintAlign = 'left' | 'center' | 'right'

/** 表头单元格 */
export interface PrintHeaderCell {
  label: string
  colspan?: number
  rowspan?: number
}

/** 数据单元格。rowspan 为 0 表示被上面的格子吃掉了，不渲染 */
export interface PrintCell {
  text: string
  align?: PrintAlign
  rowspan?: number
}

/** 数据行。分组行只有 group 一个字段，整行合成一格 */
export interface PrintRow {
  cells?: PrintCell[]
  group?: string
}

export interface ListPrintModel {
  title: string
  /** 表头，一行或两行（有分组表头时两行） */
  headerRows: PrintHeaderCell[][]
  rows: PrintRow[]
  /** 合计行的各格文本，长度与叶子列数一致。不打印合计时不传 */
  summary?: string[]
  /** 印在表格下方的说明，比如「本次打印 30 条 / 共 60 条」 */
  footnote?: string
}

/** 设计期的表头结构，与运行时的 renderColumns 同形 */
export type PrintHeaderItem =
  | { type: 'plain'; label: string }
  | { type: 'group'; label: string; children: string[] }

/**
 * 把表头结构摊成「要打印的表头行」
 *
 * 没有分组时只有一行。有分组时两行：
 * 分组占第一行并 `colspan` 到它的成员数，不在分组里的列占第一行并 `rowspan=2`
 * 纵向贯通两行 —— 不给 rowspan 的话，那些列的标题会挤在第一行、
 * 第二行对应位置空一格，表头看起来像缺了一块。
 */
export const buildHeaderRows = (items: PrintHeaderItem[]): PrintHeaderCell[][] => {
  const hasGroup = items.some((item) => item.type === 'group')
  if (!hasGroup) {
    return [items.map((item) => ({ label: item.label }))]
  }

  const top: PrintHeaderCell[] = []
  const bottom: PrintHeaderCell[] = []
  items.forEach((item) => {
    if (item.type === 'group') {
      top.push({ label: item.label, colspan: item.children.length })
      item.children.forEach((label) => bottom.push({ label }))
    } else {
      top.push({ label: item.label, rowspan: 2 })
    }
  })
  return [top, bottom]
}

/** 叶子列数 —— 分组行的 colspan 与合计行的格数都按它来 */
export const leafCountOf = (headerRows: PrintHeaderCell[][]): number =>
  headerRows[0].reduce((sum, cell) => sum + (cell.colspan ?? 1), 0)

/**
 * 生成可打印的 HTML
 *
 * ⚠️ 每一处文本都要转义。值来自库里的字段，不比用户输入更可信 ——
 * 某条记录的备注里写了 `</td><script>`，不转义的话会把整张表的结构撑破。
 * 这与单据打印那边是同一条规矩（见 printTemplate.ts）。
 */
export const buildListPrintHtml = (model: ListPrintModel): string => {
  const leafCount = leafCountOf(model.headerRows)

  const thead = model.headerRows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<th${attr('colspan', cell.colspan)}${attr('rowspan', cell.rowspan)}>` +
              `${escapeHtml(cell.label)}</th>`
          )
          .join('')}</tr>`
    )
    .join('')

  const tbody = model.rows
    .map((row) => {
      if (row.group !== undefined) {
        // 分组行：整行一格，加底色好与数据行分开
        return (
          `<tr class="group"><td colspan="${leafCount}">` +
          `${escapeHtml(row.group)}</td></tr>`
        )
      }
      const cells = (row.cells ?? [])
        // rowspan 为 0 的格子被上面的格子吃掉了，根本不该出现在 HTML 里 ——
        // 写成 rowspan="0" 在 HTML 里的含义是「跨到本组结尾」，与这里的语义相反
        .filter((cell) => cell.rowspan !== 0)
        .map(
          (cell) =>
            `<td${attr('rowspan', cell.rowspan && cell.rowspan > 1 ? cell.rowspan : undefined)}` +
            `${alignStyle(cell.align)}>${escapeHtml(cell.text)}</td>`
        )
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  const tfoot = model.summary
    ? `<tfoot><tr>${model.summary
        .map((text) => `<td>${escapeHtml(text)}</td>`)
        .join('')}</tr></tfoot>`
    : ''

  const footnote = model.footnote
    ? `<p class="footnote">${escapeHtml(model.footnote)}</p>`
    : ''

  return (
    `<h2 class="list-print-title">${escapeHtml(model.title)}</h2>` +
    `<table class="list-print"><thead>${thead}</thead><tbody>${tbody}</tbody>${tfoot}</table>` +
    footnote
  )
}

const attr = (name: string, value: number | undefined): string =>
  value === undefined || value === 1 ? '' : ` ${name}="${value}"`

/**
 * 对齐
 *
 * 用内联 style 而不是 class：打印文档是独立的一份 HTML，
 * 外面那套样式表不会跟过去（见 printTemplate 的 buildPrintDocument）。
 */
const alignStyle = (align: PrintAlign | undefined): string =>
  !align || align === 'left' ? '' : ` style="text-align:${align}"`

/** 打印文档里附加的表格样式，交给 printHtml 拼进去 */
export const LIST_PRINT_STYLE = `
  .list-print-title { font-size: 16px; text-align: center; margin: 0 0 10px; }
  table.list-print { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.list-print th, table.list-print td { border: 1px solid #888; padding: 4px 6px; }
  table.list-print th { background: #f0f0f0; text-align: center; }
  table.list-print tr.group > td { background: #f6f6f6; font-weight: 600; }
  table.list-print tfoot td { background: #f0f0f0; font-weight: 600; }
  .footnote { margin-top: 8px; font-size: 11px; color: #555; }
`
