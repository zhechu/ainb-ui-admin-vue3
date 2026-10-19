const OPENABLE_PROTOCOLS = new Set(['http:', 'https:', 'blob:'])

/** 判断 URL 是否允许在新窗口打开 */
export function isOpenableUrl(url?: string | null): boolean {
  if (!url) {
    return false
  }
  try {
    const parsed = new URL(url, window.location.origin)
    return OPENABLE_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

/** 安全打开 URL */
export function openSafeUrl(url?: string | null): void {
  if (!url || !isOpenableUrl(url)) {
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * 手册站主机白名单。与后端 `enlev.agent.doc.base-url`（`AgentDocProperties#baseUrl`）
 * 是同一个事实的两份拷贝，改一边必须改另一边。
 *
 * 🔴 刻意**不**做成「前端向后端读这个配置」：这道校验的意义恰恰是「后端/库被污染时前端不跟着放开」，
 * 读后端配置等于把闸门交给要防的那一方。
 */
const MANUAL_DOC_HOSTS = new Set(['doc.enlev.cn'])

/** 本地开发时手册站跑在 localhost 的 http 上，故仅 DEV 构建额外放行 */
const DEV_DOC_HOSTS = new Set(['localhost', '127.0.0.1'])

/**
 * 是否为可信的手册站文档链接 —— 只有它返回 true 才允许渲染成 `<a href>`
 *
 * 比 `isOpenableUrl` 严两档，两档都是必需的：
 * ① **不给 base**（`new URL(url)` 而非 `new URL(url, origin)`）⟹ 相对地址一律不算，
 *    免得 `//evil.com/x` 这种被拼成同源；
 * ② **主机白名单**，不只是协议白名单 ⟹ 挡住开放重定向与钓鱼（`isOpenableUrl` 会放行任意 https 站）。
 */
export function isManualDocUrl(url?: string | null): boolean {
  if (!url) {
    return false
  }
  try {
    const parsed = new URL(url)
    if (import.meta.env.DEV && DEV_DOC_HOSTS.has(parsed.hostname)) {
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    }
    return parsed.protocol === 'https:' && MANUAL_DOC_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}
