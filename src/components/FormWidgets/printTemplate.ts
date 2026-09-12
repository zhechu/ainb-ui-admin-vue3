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
 * 把模板与一条记录合成可打印的 HTML
 *
 * @param template 模板 HTML
 * @param data     一条记录。⚠️ 要用取详情接口的返回值，不要用列表行 ——
 *                 列表只查了配置的那几列，缺的字段会印成空白
 * @returns 插值后的 HTML；模板为空时返回空串
 */
export const resolvePrintHtml = (
  template: string | undefined | null,
  data: Record<string, any> | undefined | null
): string => interpolateTemplate(template, data, escapeHtml)

/**
 * 找出模板引用的字段
 *
 * 给设计器做即时提示用（「模板引用了已不存在的字段」）。发布校验里有一份等价实现
 * （`PrintTemplate.collectFields`），⚠️ 两处的正则必须一致 —— 不一致的表现是
 * 「设计器说没问题、发布被拒」，或者反过来发布通过而单据上一片空白。
 */
export const collectTemplateFields = (template: string | undefined | null): string[] => {
  if (!template) return []
  const fields: string[] = []
  for (const match of String(template).matchAll(/\{([^{}]+)\}/g)) {
    const field = match[1].trim()
    if (field && !fields.includes(field)) {
      fields.push(field)
    }
  }
  return fields
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
 * @param html  已插值并转义好的 HTML
 * @param title 文档标题
 */
export const printHtml = (html: string, title = '打印'): void => {
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
  iframe.srcdoc = buildPrintDocument(html, title)
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
export const buildPrintDocument = (html: string, title: string): string => `<!DOCTYPE html>
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
</style>
</head>
<body>${html}</body>
</html>`
