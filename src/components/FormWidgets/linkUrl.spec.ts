/**
 * 超链接地址处理的单元测试
 *
 * 与后端 `LinkUrlGuardTest` 覆盖同一批用例。两处的判定必须一致：
 * 前端这份管即时反馈与运行时渲染，服务端那份在发布时不可绕过。
 * 前端放过而服务端拦下 = 「设计器里看着好好的，一点发布就报错」；
 * 反过来 = 「前端不给点，服务端却存得进去」。
 */

import { describe, expect, it, vi } from 'vitest'
import { interpolateLinkUrl, isSafeLinkUrl, resolveLinkUrl } from './linkUrl'

describe('协议白名单', () => {
  it('白名单内的协议放行', () => {
    expect(isSafeLinkUrl('https://example.com/a?b=1#c')).toBe(true)
    expect(isSafeLinkUrl('http://example.com')).toBe(true)
    expect(isSafeLinkUrl('mailto:a@b.com')).toBe(true)
    expect(isSafeLinkUrl('tel:+8613812345678')).toBe(true)
  })

  it('相对地址、锚点、查询串没有协议，一律放行', () => {
    expect(isSafeLinkUrl('/infra/form-design')).toBe(true)
    expect(isSafeLinkUrl('./detail')).toBe(true)
    expect(isSafeLinkUrl('#anchor')).toBe(true)
    expect(isSafeLinkUrl('?id=1')).toBe(true)
    // 路径里的冒号不是协议：判据是冒号要在第一个 / ? # 之前
    expect(isSafeLinkUrl('/a:b/c')).toBe(true)
  })

  it('⚠️ javascript: 与 data: 被拦下', () => {
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeLinkUrl('vbscript:msgbox(1)')).toBe(false)
    // file: 能探测本机文件系统
    expect(isSafeLinkUrl('file:///etc/passwd')).toBe(false)
  })

  it('⚠️ 大小写、空格、控制字符的变形也要拦 —— 这正是不能用黑名单的原因', () => {
    expect(isSafeLinkUrl('JaVaScRiPt:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('  javascript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('java\tscript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('java\nscript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('java script:alert(1)')).toBe(false)
    // 空字符变形。用 String.fromCharCode 拼，不在源码里直接写控制字符
    expect(isSafeLinkUrl('java' + String.fromCharCode(0) + 'script:alert(1)')).toBe(false)
  })

  it('空地址算安全 —— 那只是没配，不是危险', () => {
    expect(isSafeLinkUrl('')).toBe(true)
    expect(isSafeLinkUrl(null)).toBe(true)
    expect(isSafeLinkUrl(undefined)).toBe(true)
  })
})

describe('字段插值', () => {
  it('把 {字段} 换成表单里的值', () => {
    expect(
      interpolateLinkUrl('https://crm.example.com/customer/{id}', { id: 1024 })
    ).toBe('https://crm.example.com/customer/1024')
  })

  it('多个占位符与重复占位符', () => {
    expect(interpolateLinkUrl('/a/{x}/b/{y}?z={x}', { x: 1, y: 2 })).toBe('/a/1/b/2?z=1')
  })

  it('⚠️ 值要做 URL 编码 —— 字段值里有 & 或空格会把地址截断', () => {
    expect(interpolateLinkUrl('/s?q={kw}', { kw: 'a b&c' })).toBe('/s?q=a%20b%26c')
  })

  it('⚠️ 取不到值时替换成空串，不保留占位符 —— 保留会点开一个 404，更难看出是没填字段', () => {
    expect(interpolateLinkUrl('/a/{missing}', {})).toBe('/a/')
    expect(interpolateLinkUrl('/a/{missing}', null)).toBe('/a/')
    // 空值（0 / false）照常参与，它们是有效值
    expect(interpolateLinkUrl('/a/{n}', { n: 0 })).toBe('/a/0')
  })

  it('没有占位符时原样返回', () => {
    expect(interpolateLinkUrl('https://example.com', { a: 1 })).toBe('https://example.com')
    expect(interpolateLinkUrl('', {})).toBe('')
  })
})

describe('解析最终地址', () => {
  it('安全地址原样返回', () => {
    expect(resolveLinkUrl('https://example.com/{id}', { id: 7 })).toBe('https://example.com/7')
  })

  it('⚠️ 不安全时返回空串，让调用方降级成纯文本', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveLinkUrl('javascript:alert(1)', {})).toBe('')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('⚠️ 插值之后再判协议 —— 否则 {proto}:x 这类模板能把危险协议拼出来', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 插值结果被 encodeURIComponent 编码过，冒号会变成 %3A，拼不出协议；
    // 这条用例钉住「判定发生在插值之后」这个顺序
    expect(resolveLinkUrl('{proto}alert(1)', { proto: 'javascript:' })).toBe(
      'javascript%3Aalert(1)'
    )
    warn.mockRestore()
  })

  it('⚠️ 整条地址来自一个字段时不编码 —— 编了浏览器会当成相对路径', () => {
    // `{homepage}` 的含义是「这条地址整个存在 homepage 字段里」。
    // 编码之后 https://example.com/a 会变成 https%3A%2F%2Fexample.com%2Fa，
    // 链接看着渲染得好好的，点下去跳到当前站点下一个不存在的页面
    expect(resolveLinkUrl('{homepage}', { homepage: 'https://example.com/demo/a?b=1#c' })).toBe(
      'https://example.com/demo/a?b=1#c'
    )
    // 占位符只是地址的一段时照旧编码：值里的 & 空格会把地址截断
    expect(resolveLinkUrl('https://example.com/s?q={kw}', { kw: 'a&b c' })).toBe(
      'https://example.com/s?q=a%26b%20c'
    )
  })

  it('⚠️ 不编码不等于放宽安全：整条来自字段时照样过协议白名单', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveLinkUrl('{u}', { u: 'javascript:alert(1)' })).toBe('')
    expect(resolveLinkUrl('{u}', { u: ' java	script:alert(1)' })).toBe('')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('字段没值时整条地址为空串，而不是留下字面量占位符', () => {
    expect(resolveLinkUrl('{homepage}', {})).toBe('')
  })
})
