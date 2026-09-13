/**
 * 打印模板的测试
 *
 * 这些用例守两件事：
 *
 * 1. **值一定被 HTML 转义**。模板由设计者写、值由填表人填，值里带 `<script>`
 *    在打印预览里就会执行 —— 与自定义按钮的跳转地址同一个道理。
 *    转义漏一个字符就是一个洞，所以五个字符各钉一条
 * 2. **占位符的识别与服务端一致**。`PrintTemplateTest` 是同一批边界的另一半，
 *    两边不一致的表现是「设计器说没问题、发布被拒」或反过来
 *
 * ⚠️ `printHtml` 本身测不了：单测跑在 node 环境，没有 DOM。它的行为
 * （iframe 加载完再打印、打印完回收）必须在真实浏览器里看 ——
 * 这正是交接文档里那条「单测全绿不等于功能生效」。
 */
import { describe, expect, it } from 'vitest'
import {
  buildPrintDocument,
  collectTemplateFields,
  collectLoopFields,
  collectStrayMarks,
  escapeHtml,
  expandLoops,
  resolvePrintHtml
} from './printTemplate'

describe('escapeHtml', () => {
  it('五个字符都转', () => {
    expect(escapeHtml('&')).toBe('&amp;')
    expect(escapeHtml('<')).toBe('&lt;')
    expect(escapeHtml('>')).toBe('&gt;')
    expect(escapeHtml('"')).toBe('&quot;')
    expect(escapeHtml("'")).toBe('&#39;')
  })

  it('& 先转，不会把 &lt; 二次转义成 &amp;lt;', () => {
    // 顺序反了的话，`<` 先变成 `&lt;`，紧接着 `&` 的替换把它变成 `&amp;lt;`，
    // 印出来是字面量的「&lt;」
    expect(escapeHtml('<a>')).toBe('&lt;a&gt;')
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;')
  })

  it('普通文本原样保留', () => {
    expect(escapeHtml('出库单 A001 金额 1,234.56')).toBe('出库单 A001 金额 1,234.56')
  })
})

describe('resolvePrintHtml', () => {
  it('把 {字段} 换成记录里的值', () => {
    expect(resolvePrintHtml('<p>单号：{bill_no}</p>', { bill_no: 'CK20260910001' })).toBe(
      '<p>单号：CK20260910001</p>'
    )
  })

  it('值里的脚本被转义，不会在打印预览里执行', () => {
    const html = resolvePrintHtml('<td>{remark}</td>', {
      remark: '<script>alert(1)</script>'
    })
    expect(html).toBe('<td>&lt;script&gt;alert(1)&lt;/script&gt;</td>')
    expect(html).not.toContain('<script>')
  })

  it('属性位置上的占位符：带引号的值撑不破属性', () => {
    // 不转引号的话，remark 填 `" onclick="alert(1)` 就能闭合 title 属性
    // 并插进一个事件处理器
    const html = resolvePrintHtml('<td title="{remark}">x</td>', {
      remark: '" onclick="alert(1)'
    })
    expect(html).toBe('<td title="&quot; onclick=&quot;alert(1)">x</td>')
    expect(html).not.toContain('onclick="alert')
  })

  it('不做 URL 编码 —— 中文与空格原样印出来', () => {
    // 超链接那边传的是 encodeURIComponent，照抄过来会让「上海 分公司」
    // 变成 %E4%B8%8A%E6%B5%B7%20%E5%88%86%E5%85%AC%E5%8F%B8
    expect(resolvePrintHtml('{customer}', { customer: '上海 分公司' })).toBe('上海 分公司')
  })

  it('取不到值的占位符换成空串', () => {
    expect(resolvePrintHtml('<p>{missing}</p>', {})).toBe('<p></p>')
    expect(resolvePrintHtml('<p>{a}</p>', null)).toBe('<p></p>')
  })

  it('0 与 false 要印出来，不能当成空', () => {
    expect(resolvePrintHtml('{n}|{b}', { n: 0, b: false })).toBe('0|false')
  })

  it('模板为空返回空串', () => {
    expect(resolvePrintHtml('', { a: 1 })).toBe('')
    expect(resolvePrintHtml(null, { a: 1 })).toBe('')
  })
})

describe('collectTemplateFields', () => {
  it('按出现顺序去重', () => {
    expect(
      collectTemplateFields('<p>{bill_no}</p><p>{customer}</p><p>{bill_no}</p>')
    ).toEqual(['bill_no', 'customer'])
  })

  it('花括号里的空白被去掉 —— 与服务端的 trim 一致', () => {
    expect(collectTemplateFields('{ amount }')).toEqual(['amount'])
  })

  it('空花括号不算一次字段引用', () => {
    expect(collectTemplateFields('{}{   }')).toEqual([])
  })

  it('没有占位符或模板为空时返回空数组', () => {
    expect(collectTemplateFields('<h1>出库单</h1>')).toEqual([])
    expect(collectTemplateFields('')).toEqual([])
    expect(collectTemplateFields(null)).toEqual([])
  })
})

describe('buildPrintDocument', () => {
  it('标题也要转义 —— 表单名是用户填的', () => {
    const doc = buildPrintDocument('<p>x</p>', '<script>alert(1)</script>')
    expect(doc).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>')
  })

  it('正文原样放进 body（它已经在插值那一步转义过了）', () => {
    expect(buildPrintDocument('<table><tr><td>1</td></tr></table>', '出库单')).toContain(
      '<body><table><tr><td>1</td></tr></table></body>'
    )
  })

  it('带上页边距与「表格行不跨页」', () => {
    const doc = buildPrintDocument('', '打印')
    expect(doc).toContain('@page')
    expect(doc).toContain('page-break-inside: avoid')
  })
})

describe('子表明细的行标记', () => {
  /** 与设计器「插入明细表格」产出的结构一致 */
  const TPL =
    '<table><thead><tr><th>项目</th><th>金额</th></tr></thead>' +
    '<tbody><tr><td>{#costs}{cost_item}</td><td>{cost_amount}</td></tr></tbody>' +
    '</table>'

  it('整行按明细行数重复，行内取当前明细行的值', () => {
    const html = expandLoops(TPL, {
      costs: [
        { cost_item: '服务器', cost_amount: '54000.00' },
        { cost_item: '差旅', cost_amount: '1850.00' }
      ]
    })
    expect(html).toContain('服务器')
    expect(html).toContain('差旅')
    // 重复的是整个 <tr>，不是某一个单元格
    expect((html.match(/<tr><td>/g) || []).length).toBe(2)
    // 表头那一行不受影响
    expect((html.match(/<th>/g) || []).length).toBe(2)
  })

  it('标记本身不印出来', () => {
    const html = expandLoops(TPL, { costs: [{ cost_item: 'A', cost_amount: '1' }] })
    expect(html).not.toContain('{#costs}')
  })

  it('子表没有数据时整行去掉，而不是留一行空格子', () => {
    // 留空行的话，一张没有明细的单据上会印出一行空白格，看起来像数据丢了
    for (const data of [{ costs: [] }, {}, { costs: 'not-an-array' as any }]) {
      const html = expandLoops(TPL, data)
      expect(html).not.toContain('<tr><td>')
      expect(html).not.toContain('{#costs}')
      // 表头还在 —— 去掉的只是明细行
      expect(html).toContain('<th>项目</th>')
    }
  })

  it('行内的值一样要转义', () => {
    const html = expandLoops(TPL, {
      costs: [{ cost_item: '<script>x</script>', cost_amount: '1' }]
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('两张明细表各自展开，互不干扰', () => {
    const tpl =
      '<table><tbody><tr><td>{#ms}{n}</td></tr></tbody></table>' +
      '<table><tbody><tr><td>{#cost}{c}</td></tr></tbody></table>'
    const html = expandLoops(tpl, { ms: [{ n: 'A' }, { n: 'B' }], cost: [{ c: 'X' }] })
    expect(html).toContain('<td>A</td>')
    expect(html).toContain('<td>B</td>')
    expect(html).toContain('<td>X</td>')
    expect((html.match(/<tr>/g) || []).length).toBe(3)
  })

  it('⚠️ 标记没放在表格行里时原样留着，交给发布校验拦', () => {
    // 悄悄删掉的话，用户会以为标记生效了
    const bad = '<p>{#costs}</p>'
    expect(expandLoops(bad, { costs: [{ a: 1 }] })).toBe(bad)
    expect(collectStrayMarks(bad)).toEqual(['costs'])
  })

  it('放对了位置的标记不算游离', () => {
    expect(collectStrayMarks(TPL)).toEqual([])
    expect(collectStrayMarks(undefined)).toEqual([])
  })

  it('⚠️ 表格后面的游离标记不会把上一行错认成自己所在的行', () => {
    const tpl = '<table><tbody><tr><td>{a}</td></tr></tbody></table><p>{#costs}</p>'
    expect(collectStrayMarks(tpl), '把表格最后一行错当成了标记所在行').toEqual(['costs'])
  })

  it('整条链路：先展开明细行、再插主表字段', () => {
    // 顺序反过来的话，{cost_item} 会先被主表数据插一遍（主表上没有这个字段
    // → 空串），展开时已经无值可取，明细行印出来是一片空白
    const html = resolvePrintHtml('<p>单号 {project_code}</p>' + TPL, {
      project_code: 'XM2026001',
      costs: [{ cost_item: '服务器', cost_amount: '54000.00' }]
    })
    expect(html).toContain('XM2026001')
    expect(html).toContain('服务器')
    expect(html).not.toContain('{cost_item}')
  })
})

describe('收集字段时区分主表与明细行', () => {
  const TPL =
    '<p>{project_code}</p>' +
    '<table><tbody><tr><td>{#costs}{cost_item}</td><td>{cost_amount}</td></tr></tbody></table>' +
    '<p>{owner_name}</p>'

  it('主表字段清单不含明细行里的列，也不含标记本身', () => {
    // 混在一起收集的话，设计器会报「模板引用了不存在的字段 cost_item」，
    // 而它其实完全正常
    expect(collectTemplateFields(TPL)).toEqual(['project_code', 'owner_name'])
  })

  it('明细行的子表与它引用的列单独收集', () => {
    expect(collectLoopFields(TPL)).toEqual({ costs: ['cost_item', 'cost_amount'] })
  })

  it('没有明细行时返回空对象', () => {
    expect(collectLoopFields('<p>{a}{b}</p>')).toEqual({})
    expect(collectLoopFields(undefined)).toEqual({})
  })

  it('同一个子表出现两行时，列合并去重', () => {
    const tpl =
      '<table><tbody><tr><td>{#c}{a}</td></tr><tr><td>{#c}{a}{b}</td></tr></tbody></table>'
    expect(collectLoopFields(tpl)).toEqual({ c: ['a', 'b'] })
  })
})
