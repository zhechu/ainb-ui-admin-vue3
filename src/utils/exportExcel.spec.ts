import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `@/utils/exportExcel` 的单元测试
 *
 * ## 🔴 为什么给一个「发请求 + 存文件」的函数写单测
 * 因为它身上那两件事都**坏了不报错**：
 *
 * 1. **成功与否看头两个字节，不看 Content-Type。** `ExcelUtils.write` 是先写流后设头的，
 *    成功的导出在浏览器这边根本没有 Content-Type；而失败时返回的是本仓统一的
 *    `{"code":…,"msg":"…"}`（HTTP 状态码恒为 200）。判据选错任一边，
 *    表现都是「点了导出什么都没发生」或「存下来一个打不开的 xlsx」，
 *    两种都不会在控制台留一行错。
 *
 * 2. **三个元信息头能不能读到，取决于后端 CORS 的 `setExposedHeaders`。**
 *    CORS 只把 6 个安全头交给 JS，其余一律隐藏、不报错、也没有日志 ——
 *    这一条**已经真实坏过一次**：`corsFilterBean` 从来没调过 `setExposedHeaders`，
 *    于是 `truncated` 恒为 false，「只导出了前 20000 条」那句警告从未出现过，
 *    用户拿到少半截的台账而界面说「导出成功」。
 *
 * 这两条都只能在**读到响应之后**才分得出对错，所以必须在这里钉住。
 */

vi.mock('@/utils/auth', () => ({
  getAccessToken: () => 'test-token',
  getTenantId: () => 1
}))

const mockAxiosGet = vi.fn()
vi.mock('axios', () => ({
  default: {
    get: (...args: any[]) => mockAxiosGet(...args)
  }
}))

import { buildExportFilename, exportExcelWithMeta } from '@/utils/exportExcel'

/** xlsx 是 zip，必然以 PK（0x50 0x4b）开头 */
const xlsxBody = (filler = 'rest-of-the-zip') =>
  new Blob([new Uint8Array([0x50, 0x4b]), filler], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })

/** 失败时服务端返回的东西：HTTP 200 + 一段 JSON */
const jsonBody = (msg: string, code = 500) =>
  new Blob([JSON.stringify({ code, msg, data: null })], { type: 'application/json' })

const mockResponse = (data: Blob, headers: Record<string, string> = {}) => {
  mockAxiosGet.mockResolvedValueOnce({ data, headers })
}

beforeEach(() => {
  mockAxiosGet.mockReset()
})

describe('buildExportFilename', () => {
  it('导全部、没截断：只有台账名', () => {
    expect(buildExportFilename('项目台账', false, 7, false)).toBe('项目台账.xlsx')
  })

  it('导当前页：文件名里带上页码', () => {
    expect(buildExportFilename('项目台账', true, 7, false)).toBe('项目台账(第7页).xlsx')
  })

  it('🔴 截断标记必须进文件名——弹窗关了就没人记得那句 warning，文件名是唯一还留着的信息', () => {
    expect(buildExportFilename('委托方台账', false, 1, true, 20000)).toBe(
      '委托方台账(前20000条).xlsx'
    )
  })

  it('当前页 + 截断：两个标记都在，且页码在前', () => {
    expect(buildExportFilename('资料台账', true, 3, true, 20000)).toBe(
      '资料台账(第3页)(前20000条).xlsx'
    )
  })

  it('🔴 truncated 为真但 maxRows 没给：不拼一个「前undefined条」出来', () => {
    expect(buildExportFilename('标的台账', false, 1, true, undefined)).toBe('标的台账.xlsx')
  })
})

describe('exportExcelWithMeta', () => {
  it('成功：交出 Blob，并把三个元信息头读出来', async () => {
    const body = xlsxBody()
    mockResponse(body, {
      'x-export-truncated': 'true',
      'x-export-max-rows': '20000',
      'x-export-total': '31000'
    })

    const result = await exportExcelWithMeta('/qlzg/project/export-excel', { pageNo: 1 })

    expect(result.blob).toBe(body)
    expect(result.truncated).toBe(true)
    expect(result.maxRows).toBe(20000)
    expect(result.total).toBe(31000)
  })

  it('🔴 三个头一个都没有 = 文件是完整的，不是「后端忘了发」', async () => {
    mockResponse(xlsxBody(), {})

    const result = await exportExcelWithMeta('/qlzg/client/export-excel', {})

    expect(result.truncated).toBe(false)
    expect(result.maxRows).toBeUndefined()
    expect(result.total).toBeUndefined()
  })

  it('请求带上 token、租户号与 blob 响应类型', async () => {
    mockResponse(xlsxBody(), {})

    await exportExcelWithMeta('/qlzg/subject/export-excel', { projectId: 9 })

    const [url, config] = mockAxiosGet.mock.calls[0]
    expect(url).toContain('/qlzg/subject/export-excel')
    expect(config.responseType).toBe('blob')
    expect(config.headers.Authorization).toBe('Bearer test-token')
    expect(config.headers['tenant-id']).toBe(1)
    expect(config.params).toEqual({ projectId: 9 })
  })

  it('🔴 失败时把服务端的 msg 抛出来，不能静默吞掉', async () => {
    mockResponse(jsonBody('评估项目不存在'), {})

    await expect(exportExcelWithMeta('/qlzg/project/export-excel', {})).rejects.toThrow(
      '评估项目不存在'
    )
  })

  it('没有 Content-Type 也算成功——判据是头两个字节', async () => {
    // ExcelUtils.write 先写流后设头，成功的导出在浏览器这边根本没有 Content-Type
    const body = new Blob([new Uint8Array([0x50, 0x4b]), 'zip-bytes'])
    mockResponse(body, {})

    const result = await exportExcelWithMeta('/qlzg/material/export-excel', {})

    expect(result.blob).toBe(body)
    expect(result.truncated).toBe(false)
  })

  it('返回的不是 xlsx 也不是 JSON：截一段原文带出去，总比只说「导出失败」有线索', async () => {
    mockResponse(new Blob(['<html>502 Bad Gateway</html>']), {})

    await expect(exportExcelWithMeta('/qlzg/project/export-excel', {})).rejects.toThrow(
      '<html>502 Bad Gateway</html>'
    )
  })

  it('JSON 里没有 msg：退回通用文案，不抛一个 undefined 出去', async () => {
    mockResponse(jsonBody(''), {})

    await expect(exportExcelWithMeta('/qlzg/project/export-excel', {})).rejects.toThrow('导出失败')
  })

  it('空响应体：当成失败，不去解一个空的 JSON', async () => {
    mockResponse(new Blob([]), {})

    await expect(exportExcelWithMeta('/qlzg/project/export-excel', {})).rejects.toThrow('导出失败')
  })
})
