/**
 * 模板插值的单元测试
 *
 * 超链接与条码共用这一份。两者对值的处理不同（前者要 URL 编码、后者不能编码），
 * 所以编码方式是参数 —— 这几条用例钉的就是「编码由调用方决定」。
 */

import { describe, expect, it } from 'vitest'
import { interpolateTemplate } from './template'

describe('模板插值', () => {
  it('把 {字段} 换成值', () => {
    expect(interpolateTemplate('订单 {no}', { no: 'A001' })).toBe('订单 A001')
    expect(interpolateTemplate('{a}-{b}', { a: 1, b: 2 })).toBe('1-2')
  })

  it('⚠️ 默认不做任何编码 —— 条码编码之后扫出来的就不是原值了', () => {
    expect(interpolateTemplate('{v}', { v: 'a b&c' })).toBe('a b&c')
  })

  it('编码方式由调用方给 —— 超链接传 encodeURIComponent', () => {
    expect(interpolateTemplate('{v}', { v: 'a b&c' }, encodeURIComponent)).toBe('a%20b%26c')
  })

  it('取不到值的占位符替换成空串，不保留原样', () => {
    expect(interpolateTemplate('/a/{missing}', {})).toBe('/a/')
    expect(interpolateTemplate('{x}', null)).toBe('')
  })

  it('0 与 false 是有效值，照常参与', () => {
    expect(interpolateTemplate('{n}', { n: 0 })).toBe('0')
    expect(interpolateTemplate('{b}', { b: false })).toBe('false')
  })

  it('没有占位符时原样返回', () => {
    expect(interpolateTemplate('固定内容', { a: 1 })).toBe('固定内容')
    expect(interpolateTemplate('', {})).toBe('')
    expect(interpolateTemplate(null, {})).toBe('')
  })
})
