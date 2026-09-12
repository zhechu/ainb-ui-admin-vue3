/**
 * 表单呈现方式的单元测试
 *
 * 最要紧的一条：存量表单的 listConf 里没有 formViewMode 这个键，
 * 解析结果必须回落到居中弹窗 —— 那是改造前的唯一行为。
 * 回落错了，所有已发布的表单会在一次升级后集体换一种打开方式。
 */

import { describe, expect, it } from 'vitest'
import { FORM_VIEW_MODES, parseFormViewMode } from './formViewMode'

describe('parseFormViewMode', () => {
  it('⚠️ 存量配置没有这个键时回落到居中弹窗', () => {
    expect(parseFormViewMode(undefined)).toBe('DIALOG')
    expect(parseFormViewMode(null)).toBe('DIALOG')
    expect(parseFormViewMode('')).toBe('DIALOG')
  })

  it('认得出三种合法模式', () => {
    expect(parseFormViewMode('DIALOG')).toBe('DIALOG')
    expect(parseFormViewMode('DRAWER')).toBe('DRAWER')
    expect(parseFormViewMode('INLINE')).toBe('INLINE')
  })

  it('⚠️ 认不出的值也回落到居中弹窗，而不是原样透传', () => {
    // 透传的话，运行时那三个 v-if 会全都不成立，表单点开是一片空白，
    // 且不报错 —— 比换一种打开方式难查得多
    expect(parseFormViewMode('FULLSCREEN')).toBe('DIALOG')
    expect(parseFormViewMode('dialog')).toBe('DIALOG')
    expect(parseFormViewMode(123)).toBe('DIALOG')
    expect(parseFormViewMode({ mode: 'INLINE' })).toBe('DIALOG')
  })
})

describe('FORM_VIEW_MODES', () => {
  it('选项表与解析器认的是同一批值', () => {
    FORM_VIEW_MODES.forEach((mode) => {
      expect(parseFormViewMode(mode.value)).toBe(mode.value)
    })
  })

  it('每个选项都有中文名与说明，设计器直接拿去渲染', () => {
    expect(FORM_VIEW_MODES).toHaveLength(3)
    FORM_VIEW_MODES.forEach((mode) => {
      expect(mode.label).toBeTruthy()
      expect(mode.desc).toBeTruthy()
    })
  })

  it('默认值排在第一个，用户不改时选中的就是它', () => {
    expect(FORM_VIEW_MODES[0].value).toBe('DIALOG')
  })
})
