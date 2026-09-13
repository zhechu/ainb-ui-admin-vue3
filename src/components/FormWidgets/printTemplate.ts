/**
 * 打印模板
 *
 * 设计方案 §6.6 把这一项写成「表单属性绑定打印模板 ID」，暗示 bpm 已经有一个打印模板
 * 模块可以复用。摸下来不是这样：bpm 那边没有表、没有服务、没有接口，模板就是一段
 * HTML 存在流程模型里，编辑器（wangEditor 的 mention 节点）与渲染（bpm 专有的取数接口）
 * 两端都和流程语义绑死。所以本模块是「再建一套」，不是「绑一下」。
 *
 * ## 占位符用 `{字段}`
 *
 * 不照抄 bpm 的 mention 节点：本模块已经有三处在用 `{字段}`（超链接、条码、
 * 自定义按钮的跳转地址），再引入第二套语法用户会在两种写法之间猜 —— 而猜错的表现是
 * 「占位符原样印在单据上」，没有任何报错。复用同一套语法的副产品是插值直接用
 * `interpolateTemplate`，不必给编辑器写 mention 插件。
 *
 * ## ⚠️ 插值必须做 HTML 转义，不能不传、更不能照抄超链接的 URL 编码
 *
 * `interpolateTemplate` 的第三个参数是编码器，超链接那边传的是 `encodeURIComponent`。
 * 打印模板这里两者都不行：
 *
 * - **不转义**：某条记录的备注里写了 `<script>…`，打印预览时它就在页面上执行了。
 *   值来自库里的字段，不比用户输入更可信 —— 与自定义按钮的跳转地址同一个道理
 * - **用 URL 编码**：正常的中文和空格会变成 `%E4%B8%AD` 印在单据上
 *
 * 注意这与服务端的清洗是两段互补的防线，缺任何一段都有洞：
 * `RichContentGuard` 清洗的是**模板**（设计者写的 HTML），这里转义的是**值**
 * （填表人填的数据）。
 *
 * ## 不支持的：条码 / 二维码与子表明细
 *
 * `{字段}` 是文本替换，印出来的是字段的值本身。条码控件的值是一串数字，
 * 模板里写 `{barcode_no}` 得到的是那串数字而不是条码图形 —— 要印成条码得再引入一套
 * 形如 `{barcode:字段}` 的语法，而那正是上面说的「第二套语法」。
 * 子表明细同理：它是多行数据，插进模板的一个位置只能得到 `[object Object]`，
 * 发布校验会拦住这种占位符。两件都记在交接文档里，需要时另做。
 *
 * 富文本字段也会被当成普通文本转义 —— 印出来是它的 HTML 原文而不是排版后的样子。
 * 这是转义那条取舍的必然结果，不做例外：「哪些字段的值可以原样当 HTML 用」
 * 一旦开了口子，判据就落在字段类型上，而字段类型是设计者随时能改的。
 */
import { interpolateTemplate } from './template'

/**
 * HTML 转义
 *
 * 五个字符都要转，少一个就是一个洞：
 *
 * - `&` 必须**第一个**转，否则后面几步产出的 `&lt;` 会被再转一次变成 `&amp;lt;`
 * - `<` `>` 是标签边界，挡住 `<script>` 与 `</td>` 这类把模板结构撑破的值
 * - `"` `'` 是属性边界。占位符可能出现在属性里（`<td title="{remark}">`），
 *   不转的话一个带引号的值就能闭合属性并插进一个 `onclick`
 */
export const escapeHtml = (value: string): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * 子表明细的行标记
 *
 * 把 `{#子表字段}` 放进**要重复的那一行**的任意一个单元格里，这一整行就按明细行数重复，
 * 行内的 `{列}` 取当前明细行的值。标记本身不会印出来。
 *
 * ```html
 * <tr><td>{#costs}{cost_item}</td><td>{cost_qty}</td></tr>
 * ```
 *
 * ## ⚠️ 为什么不是 `{#costs}…{/costs}` 这种成对的写法
 *
 * 一开始就是成对的，标记写在 `</tr>` 与 `<tr>` 之间。它在**字符串层面**完全正常，
 * 打印也印得对 —— 但只要在设计器里打开一次模板再存回去就废了：
 *
 * HTML 的 **foster parenting** 规则规定，`<table>` 里不在单元格内的文本节点
 * 要被整段挪到表格**前面**。于是富文本编辑器读进来再吐出去之后，两个标记
 * 挨在一起跑到了表格外，中间什么都不剩，而明细行落在了循环之外。
 * 现象是「模板没动过，打开保存一下，明细就印不出来了」—— 没有任何报错。
 *
 * 标记放进单元格里则不受这条规则影响。而且单标记天然没有「前后对不上」
 * 与「少写一半」这两类错误可犯。
 *
 * ## 正则只认标记本身，行边界靠扫描
 *
 * 用正则一次匹配整行（`<tr[^>]*>[\s\S]*?</tr>`）在嵌套表格上会错，
 * 所以行边界用「从标记往两边找最近的 `<tr` 与 `</tr>`」来定，与嵌套无关。
 *
 * ⚠️ 必须与服务端 `PrintTemplate.ROW_MARK` 保持一致。两边不一致的表现是
 * 「设计器说没问题、发布被拒」，或者反过来发布通过而单据上一片空白。
 */
const ROW_MARK = /\{#([^{}/#]+)\}/g

/** 一处行标记：它自己的位置，以及它所在那一行的范围 */
interface RowMark {
  field: string
  /** 标记在模板里的起止 */
  markStart: number
  markEnd: number
  /** 所在 `<tr>` 的起止；不在任何行里时为 -1 */
  rowStart: number
  rowEnd: number
}

/** 找出模板里的全部行标记，按出现顺序 */
const findRowMarks = (template: string): RowMark[] => {
  const marks: RowMark[] = []
  for (const match of template.matchAll(ROW_MARK)) {
    const markStart = match.index ?? 0
    const markEnd = markStart + match[0].length
    const rowStart = template.lastIndexOf('<tr', markStart)
    const closeAt = template.indexOf('</tr>', markEnd)
    const rowEnd = closeAt === -1 ? -1 : closeAt + '</tr>'.length
    // 标记前面有 `<tr`、后面有 `</tr>`，且这一行没有在标记之前就结束 ——
    // 少了最后这一条的话，写在表格**后面**的标记会把上一行错认成自己所在的行
    const inRow =
      rowStart !== -1 &&
      rowEnd !== -1 &&
      template.indexOf('</tr>', rowStart) >= markEnd
    marks.push({
      field: match[1].trim(),
      markStart,
      markEnd,
      rowStart: inRow ? rowStart : -1,
      rowEnd: inRow ? rowEnd : -1
    })
  }
  return marks
}

/**
 * 展开模板里的明细行
 *
 * @param template 模板 HTML
 * @param data     一条记录，子表字段的值是对象数组
 * @returns 展开后的模板（此时主表字段还没插值）
 *
 * 子表没有数据时**整行去掉**，而不是留一行空格子 —— 留空行的话，
 * 一张没有明细的单据上会印出一行空白格，看起来像数据丢了。
 */
export const expandLoops = (
  template: string,
  data: Record<string, any> | undefined | null
): string => {
  const marks = findRowMarks(template)
  if (marks.length === 0) return template

  // 从后往前替换，这样前面那些标记的下标不会被已完成的替换挪动
  let result = template
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]
    // 不在表格行里的标记原样留着 —— 发布校验会把它拦下来并说明原因，
    // 这里悄悄删掉的话，用户会以为标记生效了
    if (mark.rowStart === -1) continue

    const rowHtml =
      result.slice(mark.rowStart, mark.markStart) + result.slice(mark.markEnd, mark.rowEnd)
    const rows = data?.[mark.field]
    const expanded = !Array.isArray(rows)
      ? ''
      : rows
          // 行内的占位符在这里就地插值并转义 —— 留到外层统一插值的话，
          // 外层只认得主表数据，明细的列名在它那里取不到值
          .map((row) => interpolateTemplate(rowHtml, row as Record<string, any>, escapeHtml))
          .join('')
    result = result.slice(0, mark.rowStart) + expanded + result.slice(mark.rowEnd)
  }
  return result
}

/**
 * 把模板与一条记录合成可打印的 HTML
 *
 * @param template 模板 HTML
 * @param data     一条记录。⚠️ 要用取详情接口的返回值，不要用列表行 ——
 *                 列表只查了配置的那几列，缺的字段会印成空白；
 *                 子表明细也只有详情接口才带回来
 * @returns 插值后的 HTML；模板为空时返回空串
 */
export const resolvePrintHtml = (
  template: string | undefined | null,
  data: Record<string, any> | undefined | null
): string => {
  if (!template) return ''
  // 先展开循环，再插主表字段。顺序不能反，理由见 LOOP 上面那段
  return interpolateTemplate(expandLoops(String(template), data), data, escapeHtml)
}

/**
 * 找出模板引用的**主表**字段
 *
 * 明细行整行排除在外 —— 行内的 `{列}` 是明细表的列，不是主表字段。
 * 混在一起收集的话，设计器会报「模板引用了不存在的字段 cost_item」，
 * 而它其实完全正常。一次「配对了却说有问题」比漏报更让人无所适从。
 *
 * ⚠️ 服务端 `PrintTemplate.collectFields` 按同样的规则分开收集，两处必须一致 ——
 * 不一致的表现是「设计器说没问题、发布被拒」，或者反过来发布通过而单据上一片空白。
 */
export const collectTemplateFields = (template: string | undefined | null): string[] => {
  if (!template) return []
  const fields: string[] = []
  for (const match of stripDetailRows(String(template)).matchAll(/\{([^{}]+)\}/g)) {
    const field = match[1].trim()
    // 行标记自己（`#子表`）不是字段引用
    if (field && !field.startsWith('#') && !fields.includes(field)) {
      fields.push(field)
    }
  }
  return fields
}

/** 把全部明细行整行挖掉，剩下的才是主表作用域 */
const stripDetailRows = (template: string): string => {
  const marks = findRowMarks(template)
  let result = template
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]
    if (mark.rowStart === -1) continue
    result = result.slice(0, mark.rowStart) + result.slice(mark.rowEnd)
  }
  return result
}

/**
 * 找出模板里的明细行：子表字段 → 该行引用的列
 *
 * 给发布校验与设计器提示用：子表必须真的存在、行内的列必须是那张明细表的列。
 */
export const collectLoopFields = (
  template: string | undefined | null
): Record<string, string[]> => {
  const result: Record<string, string[]> = {}
  if (!template) return result
  const text = String(template)
  for (const mark of findRowMarks(text)) {
    if (mark.rowStart === -1) continue
    const inner = result[mark.field] ?? (result[mark.field] = [])
    const rowHtml =
      text.slice(mark.rowStart, mark.markStart) + text.slice(mark.markEnd, mark.rowEnd)
    for (const one of rowHtml.matchAll(/\{([^{}]+)\}/g)) {
      const column = one[1].trim()
      if (column && !column.startsWith('#') && !inner.includes(column)) inner.push(column)
    }
  }
  return result
}

/**
 * 找出「没放在表格行里」的行标记
 *
 * 值得单独拦，因为它的失败方式同样是【没有失败】：标记会原样印在单据上，
 * 或者（更常见）什么都不发生 —— 设计者只看到明细印不出来，而他会先去怀疑数据。
 *
 * @returns 出问题的子表字段名，按出现顺序去重。都正常时返回空数组
 */
export const collectStrayMarks = (template: string | undefined | null): string[] => {
  if (!template) return []
  const stray: string[] = []
  for (const mark of findRowMarks(String(template))) {
    if (mark.rowStart === -1 && !stray.includes(mark.field)) stray.push(mark.field)
  }
  return stray
}

/**
 * 打印一段 HTML
 *
 * ## 为什么用隐藏 iframe 而不是 window.open
 *
 * `window.open` + `document.write` 有三个具体的麻病：会被弹窗拦截器挡掉（而按钮是
 * 用户点的，被挡了他只会觉得「打印没反应」）、打印完留下一个空白标签页、
 * 以及要自己判断图片什么时候加载完 —— 图片没加载完就调 `print()`，
 * 印出来的单据上是几个空框。
 *
 * iframe 的 `srcdoc` + `load` 事件天然解决第三件：load 在文档与其中的图片都就绪后才触发。
 *
 * ## 只有 iframe 里的内容会进打印流
 *
 * 所以不需要给主页面加一堆 `@media print { .xxx { display: none } }` ——
 * 那种做法要随着页面结构一起维护，漏一个就在单据上印出一段导航栏。
 *
 * @param html       已插值并转义好的 HTML
 * @param title      文档标题
 * @param extraStyle 追加的样式。列表打印要用它带进表格边框那一套 ——
 *                   打印文档是独立的一份 HTML，页面上那套样式表不会跟过去
 */
export const printHtml = (html: string, title = '打印', extraStyle = ''): void => {
  const iframe = document.createElement('iframe')
  // 不能用 display:none —— 那样 iframe 不布局，部分浏览器会印出一张空白页。
  // 挪到视口外并压到 1px 是既不可见、又确实参与布局的做法
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;visibility:hidden;'

  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    iframe.remove()
  }

  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) {
      cleanup()
      return
    }
    // afterprint 在「打印」与「取消」两种收尾上都会触发，是最准的回收时机。
    // 但它并非所有浏览器都可靠，所以再挂一个兜底定时器 —— 漏回收的话，
    // 每点一次打印就往 body 上留一个 iframe，多点几次内存与 DOM 都在涨
    win.onafterprint = cleanup
    win.focus()
    win.print()
    setTimeout(cleanup, 60_000)
  }

  // srcdoc 而不是先 append 再 document.write：write 的时机与 iframe 自身
  // about:blank 的 load 事件会打架，表现为 onload 早于内容写入触发，
  // 于是 print() 印的是一张空白页
  iframe.srcdoc = buildPrintDocument(html, title, extraStyle)
  document.body.appendChild(iframe)
}

/**
 * 包一份完整的打印文档
 *
 * 模板自己带样式（编辑器产出的是内联 style），这里只补两件它不该操心的：
 * 页边距，以及「表格跨页时不要把一行劈成两半」。
 *
 * 导出是为了能单测 —— 单测跑在 node 环境（没有 DOM），`printHtml` 本身测不了，
 * 但它印出去的那份文档是一个纯字符串，可以钉住。
 */
export const buildPrintDocument = (
  html: string,
  title: string,
  extraStyle = ''
): string => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 12mm; }
  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    color: #000;
  }
  /* 编辑器产出的表格默认没有边框，单据上要看得见格子 */
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 6px 8px; }
  img { max-width: 100%; }
  /* 一行被劈到两页上，读的人会以为数据错了 */
  tr, td, th { page-break-inside: avoid; }
${extraStyle}
</style>
</head>
<body>${html}</body>
</html>`
