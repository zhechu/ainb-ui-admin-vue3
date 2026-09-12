/**
 * 超链接地址的安全处理
 *
 * 两件事：字段插值、协议白名单。
 *
 * ## 协议白名单不是可选的
 *
 * `javascript:alert(1)` 放进 href，用户一点就执行 —— 而这个地址是**表单设计者**
 * 配的、**填表人**点的，两者往往不是同一个人也不是同一个信任级别。
 * `data:text/html,...` 同理，还能整页替换。
 *
 * 白名单（而不是黑名单）是因为黑名单永远列不全：`JaVaScRiPt:`、
 * 前面塞控制字符、`&#106;avascript:` ……只放行确定安全的那几个协议才收敛。
 *
 * ⚠️ 服务端 `LinkUrlGuard.java` 有一份等价实现，发布时校验一次。
 * 两处都要有：前端这份是即时反馈与运行时兜底，服务端那份不可绕过。
 */

/** 允许的协议。相对地址（/path、./a）不带协议，单独放行 */
import { interpolateTemplate } from './template'

export const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:']

/**
 * 地址是否安全
 *
 * @param url 原始地址（可以是插值后的）
 */
export const isSafeLinkUrl = (url: string | undefined | null): boolean => {
  if (!url) return true
  // 逐字符过滤掉空白与控制字符（码位 <= 0x20）再判断：
  // 制表符版的 `java<TAB>script:`、前面塞空格的 ` javascript:`，浏览器照样
  // 当成 javascript: 执行，不清掉的话下面的前缀判断会被绕过。
  // 不用正则字符类，是因为那要在源码里写转义控制字符 —— 既不好读，
  // 也容易在复制粘贴中被工具改成真正的控制字符
  const cleaned = Array.from(String(url))
    .filter((char) => char.charCodeAt(0) > 0x20)
    .join('')
    .toLowerCase()
  if (!cleaned) return true
  // 没有协议部分的一律放行：相对地址、锚点、查询串都是安全的。
  // 判据是「第一个冒号出现在第一个 / ? # 之前」—— 否则 /a:b 会被误判成协议
  const colon = cleaned.indexOf(':')
  if (colon < 0) return true
  const firstSeparator = Math.min(
    ...['/', '?', '#'].map((c) => {
      const i = cleaned.indexOf(c)
      return i < 0 ? Number.MAX_SAFE_INTEGER : i
    })
  )
  if (colon > firstSeparator) return true
  return ALLOWED_LINK_PROTOCOLS.includes(cleaned.slice(0, colon + 1))
}

/**
 * 模板是否整条就是一个占位符，如 `{homepage}`
 *
 * 这种写法的含义是「这条地址整个存在某个字段里」，与
 * `https://crm.example.com/customer/{id}` 那种「字段只是地址的一段」不是一回事。
 */
const isWholePlaceholder = (template: string): boolean => /^\{[^{}]+\}$/.test(template)

/**
 * 把地址里的 `{字段}` 换成表单数据里的值
 *
 * 例：`https://crm.example.com/customer/{customer_id}`
 *
 * 取不到值的占位符替换成空串而不是保留原样 —— 保留会让地址里出现一个
 * 字面量的 `{customer_id}`，点开是一个 404，用户更难看出是没填字段。
 *
 * <h3>什么时候编码，什么时候不编码</h3>
 *
 * 字段值是地址的**一段**时要编码：值里出现 `&`、`#`、空格是常态，
 * 不编码会把地址截断。
 *
 * 但整条模板就是一个占位符（`{homepage}`）时**不能编码** —— 那时字段值本身
 * 就是一条完整地址，编码会把 `https://example.com/a` 变成
 * `https%3A%2F%2Fexample.com%2Fa`，浏览器当成相对路径，点下去跳到当前站点下的
 * 一个不存在的页面。链接看起来渲染得好好的，点了才发现不对。
 *
 * 不编码不会放宽安全性：结果照样要过 {@link isSafeLinkUrl} 的协议白名单，
 * 字段里塞 `javascript:` 一样会被挡下来。
 */
export const interpolateLinkUrl = (
  template: string | undefined | null,
  data: Record<string, any> | undefined | null
): string => {
  const raw = String(template ?? '').trim()
  if (!raw) return ''
  return isWholePlaceholder(raw)
    ? interpolateTemplate(raw, data)
    : interpolateTemplate(raw, data, encodeURIComponent)
}

/**
 * 解析出最终可用的地址
 *
 * @returns 安全的地址；不安全时返回空串（调用方渲染成不可点击的纯文本）
 */
export const resolveLinkUrl = (
  template: string | undefined | null,
  data: Record<string, any> | undefined | null
): string => {
  const url = interpolateLinkUrl(template, data)
  if (!isSafeLinkUrl(url)) {
    console.warn('[Link] 地址的协议不在白名单内，已按不可点击处理：', url)
    return ''
  }
  return url
}
