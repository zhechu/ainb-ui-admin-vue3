import { getAccessToken, getTenantId } from '@/utils/auth'

/**
 * 带元信息的 Excel 导出结果
 *
 * 下面三个字段全部来自响应头（`X-Export-Truncated` / `X-Export-Max-Rows` /
 * `X-Export-Total`），服务端只在**真的截断了**的时候才发这三个头，
 * 所以「没有头」= 「文件是完整的」，不是「后端忘了发」。
 *
 * 🔴 这三个头能读到，前提是后端 `EnlevWebAutoConfiguration#corsFilterBean`
 * 把它们列进了 `setExposedHeaders` —— CORS 只把 6 个安全头交给 JS，其余一律隐藏、
 * 不报错、也没有日志。改那边之前先读它的注释。
 */
export interface ExportResult {
  blob: Blob
  /** 这次导出被上限截断了 */
  truncated: boolean
  /** 服务端生效的上限，仅 truncated 时有值 */
  maxRows?: number
  /** 实际总条数，仅 truncated 时有值 */
  total?: number
}

/**
 * 发一次导出请求，拿回**完整响应**（Blob + 元信息头）
 *
 * ## 🔴 为什么不用 `request.download`
 *
 * 那个封装最终只把 Blob 交出来（响应拦截器对 blob 直接 `return response.data`），
 * **响应头拿不到** —— 而「这次导出有没有被上限截断」正是走响应头传的。
 * 用它的话前端永远不知道文件是不是完整的，只能默默存下一个少了一半的表。
 *
 * 也**没有**去改 `request.download` 的返回形态：那个函数被所有模块的导出在用，
 * 改它要一并回归全部导出路径，收益与风险不成比例。所以另开这一个函数，
 * 需要元信息的导出走它，不需要的继续走 `request.download`。
 *
 * ## 🔴 成功与否看头两个字节，不看 Content-Type
 *
 * xlsx 是 zip，必然以 `PK`（0x50 0x4b）开头。而 `ExcelUtils.write` 是**先写流后设头**的，
 * 成功的导出在浏览器这边根本没有 Content-Type —— 按 Content-Type 判会把成功的文件当成错误。
 *
 * 反过来，失败时服务端返回的是本仓统一的 `{"code":…,"msg":"…"}` JSON（HTTP 状态码恒为 200），
 * 前两个字节是 `{`。这一段必须读出来当报错文案抛出：
 * 静默 `catch {}` 的表现是「点了导出什么都没发生」，用户不会想到去看控制台。
 *
 * @param path 接口路径，与 `request.*` 的 `url` 同一口径（不含 base，例 `/qlzg/project/export-excel`）
 * @param params 查询参数，由调用方拼好（含分页条件与范围）
 */
export const exportExcelWithMeta = async (
  path: string,
  params: Record<string, any>
): Promise<ExportResult> => {
  const axios = (await import('axios')).default
  const baseUrl = import.meta.env.VITE_BASE_URL + import.meta.env.VITE_API_URL

  const res = await axios.get(`${baseUrl}${path}`, {
    params,
    responseType: 'blob',
    headers: {
      Authorization: 'Bearer ' + getAccessToken(),
      'tenant-id': getTenantId() || ''
    }
  })

  const magic = new Uint8Array(await res.data.slice(0, 2).arrayBuffer())
  if (!(magic[0] === 0x50 && magic[1] === 0x4b)) {
    const text = await new Response(res.data).text()
    let msg = ''
    try {
      msg = JSON.parse(text)?.msg || ''
    } catch {
      msg = text.slice(0, 200)
    }
    throw new Error(msg || '导出失败')
  }

  return {
    blob: res.data,
    truncated: String(res.headers['x-export-truncated'] || '') === 'true',
    maxRows: Number(res.headers['x-export-max-rows']) || undefined,
    total: Number(res.headers['x-export-total']) || undefined
  }
}

/**
 * 把范围与截断标记拼进文件名
 *
 * 几个导出文件混在下载目录里要能分出谁是谁 —— 而**截断标记必须在文件名里**：
 * 弹窗关了就没人记得那句 warning，文件名是唯一还留着的信息。
 *
 * @param base 台账名，例「项目台账」
 * @param currentPage 是不是导的当前页
 * @param pageNo 当前页码，仅 currentPage 时用得上
 * @param truncated 服务端说这次被截断了
 * @param maxRows 服务端生效的上限
 */
export const buildExportFilename = (
  base: string,
  currentPage: boolean,
  pageNo: number,
  truncated: boolean,
  maxRows?: number
): string => {
  const suffix = [
    currentPage ? `第${pageNo}页` : '',
    truncated && maxRows ? `前${maxRows}条` : ''
  ]
    .filter(Boolean)
    .map((part) => `(${part})`)
    .join('')
  return `${base}${suffix}.xlsx`
}
