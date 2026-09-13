import { describe, expect, it } from 'vitest'

import {
  buildHeaderRows,
  buildListPrintHtml,
  leafCountOf,
  type ListPrintModel,
  type PrintHeaderItem
} from './listPrint'

const plainHeader = [['A', 'B'].map((label) => ({ label }))]

const model = (over: Partial<ListPrintModel> = {}): ListPrintModel => ({
  title: '项目台账',
  headerRows: plainHeader,
  rows: [],
  ...over
})

describe('表头摊平', () => {
  it('没有分组时只有一行', () => {
    const items: PrintHeaderItem[] = [
      { type: 'plain', label: '编号' },
      { type: 'plain', label: '名称' }
    ]
    expect(buildHeaderRows(items)).toEqual([[{ label: '编号' }, { label: '名称' }]])
  })

  it('有分组时两行：分组横跨成员数，独立列纵向贯通', () => {
    // 不给独立列 rowspan 的话，它的标题会挤在第一行、第二行对应位置空一格，
    // 表头看起来像缺了一块
    const items: PrintHeaderItem[] = [
      { type: 'plain', label: '编号' },
      { type: 'group', label: '金额', children: ['计划', '实际'] },
      { type: 'plain', label: '备注' }
    ]
    expect(buildHeaderRows(items)).toEqual([
      [{ label: '编号', rowspan: 2 }, { label: '金额', colspan: 2 }, { label: '备注', rowspan: 2 }],
      [{ label: '计划' }, { label: '实际' }]
    ])
  })

  it('叶子列数按 colspan 累加，不是按第一行的格数', () => {
    const rows = buildHeaderRows([
      { type: 'plain', label: '编号' },
      { type: 'group', label: '金额', children: ['计划', '实际', '差额'] }
    ])
    expect(rows[0]).toHaveLength(2)
    expect(leafCountOf(rows)).toBe(4)
  })
})

describe('生成 HTML', () => {
  it('标题、表头、数据行都在', () => {
    const html = buildListPrintHtml(
      model({ rows: [{ cells: [{ text: 'XM001' }, { text: '中台项目' }] }] })
    )
    expect(html).toContain('项目台账')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<td>XM001</td>')
  })

  it('两级表头产出两行 thead', () => {
    const headerRows = buildHeaderRows([
      { type: 'plain', label: '编号' },
      { type: 'group', label: '金额', children: ['计划', '实际'] }
    ])
    const html = buildListPrintHtml(model({ headerRows }))
    expect(html).toContain('rowspan="2"')
    expect(html).toContain('colspan="2"')
    expect((html.match(/<tr>/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('合并单元格：rowspan 大于 1 的写出属性，等于 0 的整格不输出', () => {
    // ⚠️ 不能写成 rowspan="0" —— 在 HTML 里那表示「跨到本组结尾」，
    // 与这里「被上面的格子吃掉」的语义正好相反
    const html = buildListPrintHtml(
      model({
        rows: [
          { cells: [{ text: '软件', rowspan: 2 }, { text: 'A' }] },
          { cells: [{ text: '软件', rowspan: 0 }, { text: 'B' }] }
        ]
      })
    )
    expect(html).toContain('rowspan="2"')
    expect(html).not.toContain('rowspan="0"')
    // 第二行只剩一个格子
    expect(html).toContain('<tr><td>B</td></tr>')
  })

  it('rowspan 为 1 时不写属性，省得 HTML 里全是噪音', () => {
    const html = buildListPrintHtml(model({ rows: [{ cells: [{ text: 'x', rowspan: 1 }] }] }))
    expect(html).not.toContain('rowspan')
  })

  it('分组行整行合成一格，colspan 等于叶子列数', () => {
    const headerRows = buildHeaderRows([
      { type: 'plain', label: '编号' },
      { type: 'group', label: '金额', children: ['计划', '实际'] }
    ])
    const html = buildListPrintHtml(
      model({ headerRows, rows: [{ group: '软件开发（12 条）' }] })
    )
    expect(html).toContain('colspan="3"')
    expect(html).toContain('软件开发（12 条）')
    expect(html).toContain('class="group"')
  })

  it('合计行进 tfoot', () => {
    const html = buildListPrintHtml(model({ summary: ['合计', '1,234.00'] }))
    expect(html).toContain('<tfoot>')
    expect(html).toContain('1,234.00')
  })

  it('不传合计时没有 tfoot', () => {
    expect(buildListPrintHtml(model())).not.toContain('<tfoot>')
  })

  it('右对齐写成内联样式 —— 打印文档不带外面那套样式表', () => {
    const html = buildListPrintHtml(
      model({ rows: [{ cells: [{ text: '1.00', align: 'right' }] }] })
    )
    expect(html).toContain('style="text-align:right"')
  })

  it('左对齐不写样式，默认就是左', () => {
    const html = buildListPrintHtml(model({ rows: [{ cells: [{ text: 'x', align: 'left' }] }] }))
    expect(html).not.toContain('text-align')
  })

  it('脚注印在表格下方', () => {
    const html = buildListPrintHtml(model({ footnote: '本次打印 30 条 / 共 60 条' }))
    expect(html).toContain('本次打印 30 条 / 共 60 条')
  })
})

describe('转义', () => {
  it('单元格里的标签被转义，撑不破表格结构', () => {
    // 值来自库里的字段，不比用户输入更可信
    const html = buildListPrintHtml(
      model({ rows: [{ cells: [{ text: '</td><script>alert(1)</script>' }] }] })
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;/td&gt;')
  })

  it('标题、分组行、合计、脚注一样要转义', () => {
    const html = buildListPrintHtml(
      model({
        title: '<b>台账</b>',
        rows: [{ group: '<i>组</i>' }],
        summary: ['<u>合计</u>'],
        footnote: '<s>脚注</s>'
      })
    )
    expect(html).not.toMatch(/<b>|<i>|<u>|<s>/)
  })
})
