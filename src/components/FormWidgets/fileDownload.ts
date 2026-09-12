/**
 * 附件下载
 *
 * ## 为什么不是一个 `<a download>` 就完了
 *
 * `download` 属性只对**同源**地址生效。文件服务通常是另一个域名
 * （MinIO、OSS、或独立的文件网关），浏览器会把 `download` 静默忽略，
 * 行为退回成「导航到这个地址」—— 对 txt / 图片 / pdf 就是在新窗口里打开，
 * 对 docx / xlsx 才碰巧是下载。表现正是「点附件弹出一个新窗口显示内容」。
 *
 * 所以这里先把文件取成 blob 再存：blob 地址一定是同源的，`download` 必然生效，
 * 而且能带上我们自己的文件名（而不是 URL 末段那串哈希）。
 *
 * ## 取不到时为什么退回打开而不是报错
 *
 * 文件服务可能没开跨域（fetch 会被 CORS 拦掉）。那种情况下能做的只有导航，
 * 而导航至少让用户拿得到文件 —— 比弹一句「下载失败」有用。
 */

/**
 * 下载一个远程文件
 *
 * @param url      文件地址
 * @param fileName 保存时用的文件名。留空时从地址末段取
 */
export const downloadFileByUrl = async (url: string, fileName?: string): Promise<void> => {
  if (!url) return
  const name = fileName || fileNameFromUrl(url)
  try {
    const response = await fetch(url, { credentials: 'omit' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    triggerDownload(objectUrl, name)
    // 立刻回收会让部分浏览器来不及读，挪到下一轮事件循环
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  } catch (e) {
    // 多半是文件服务没开跨域。退回导航 —— 用户至少拿得到文件
    console.warn('[fileDownload] 取文件失败，退回直接打开', url, e)
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

const triggerDownload = (href: string, fileName: string) => {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

/** 从地址末段取文件名。中文名在地址里是百分号编码的，要解回来 */
export const fileNameFromUrl = (url: string): string => {
  const segment = url.split('?')[0].split('/').filter(Boolean).pop()
  if (!segment) return '附件'
  try {
    return decodeURIComponent(segment)
  } catch {
    // 地址里有裸 % 时 decodeURIComponent 会抛，原样返回比丢掉文件名好
    return segment
  }
}
