import { describe, expect, it } from 'vitest'
import {
  buttonsAt,
  isButtonVisible,
  parseCustomButtons,
  resolveButtonUrl,
  type CustomButton
} from './customButton'

/**
 * 自定义按钮的纯逻辑测试
 *
 * 组件那一半（三个位置真的渲染出来、点了真的跳转）由 e2e 守。
 * 这里守两件能纯函数化、又最容易出安全问题的事：
 * 可见条件的求值，以及跳转地址的协议白名单。
 */
describe('自定义按钮', () => {
  const button = (patch: Partial<CustomButton> = {}): CustomButton => ({
    key: 'go',
    label: '查看报表',
    position: 'ROW',
    action: { type: 'NAVIGATE', url: '/report' },
    ...patch
  })

  describe('parseCustomButtons', () => {
    it('解析数组', () => {
      expect(parseCustomButtons(JSON.stringify([button()]))).toHaveLength(1)
    })

    it('空值与坏 JSON 一律返回空数组', () => {
      // 一份坏掉的配置不该让整个列表页打不开
      expect(parseCustomButtons(undefined)).toEqual([])
      expect(parseCustomButtons('')).toEqual([])
      expect(parseCustomButtons('这不是JSON')).toEqual([])
      // 不是数组也不行（手改配置时写成了对象）
      expect(parseCustomButtons('{"key":"go"}')).toEqual([])
    })
  })

  describe('buttonsAt', () => {
    it('按位置分发', () => {
      const buttons = [
        button({ key: 'a', position: 'TOOLBAR' }),
        button({ key: 'b', position: 'ROW' }),
        button({ key: 'c', position: 'DETAIL' })
      ]
      expect(buttonsAt(buttons, 'TOOLBAR').map((b) => b.key)).toEqual(['a'])
      expect(buttonsAt(buttons, 'ROW').map((b) => b.key)).toEqual(['b'])
      expect(buttonsAt(buttons, 'DETAIL').map((b) => b.key)).toEqual(['c'])
    })
  })

  describe('isButtonVisible', () => {
    const conditional = button({
      visibleWhen: { logic: 'AND', items: [{ field: 'status', operator: 'EQ', value: 'done' }] }
    })

    it('没配条件时始终可见', () => {
      expect(isButtonVisible(button(), { status: 'draft' })).toBe(true)
    })

    it('条件满足时可见、不满足时隐藏', () => {
      expect(isButtonVisible(conditional, { status: 'done' })).toBe(true)
      expect(isButtonVisible(conditional, { status: 'draft' })).toBe(false)
    })

    it('⚠️ 没有当前记录时（工具栏）忽略条件，而不是判成不可见', () => {
      // 判成不可见的话，用户配了一条对工具栏无意义的条件之后按钮就消失了，
      // 而他不会想到是这个原因 —— 那是一次「配了就坏掉」
      expect(isButtonVisible(conditional, undefined)).toBe(true)
    })
  })

  describe('resolveButtonUrl', () => {
    it('按当前行插值', () => {
      const btn = button({ action: { type: 'NAVIGATE', url: '/report?no={order_no}' } })
      expect(resolveButtonUrl(btn, { order_no: 'SO-1' })).toBe('/report?no=SO-1')
    })

    it('字段值做 URL 编码', () => {
      // 字段值里出现 & # 空格是常态，不编码会把地址截断
      const btn = button({ action: { type: 'NAVIGATE', url: '/report?q={name}' } })
      expect(resolveButtonUrl(btn, { name: 'a&b c' })).toBe('/report?q=a%26b%20c')
    })

    it('⚠️ javascript: 协议一律拒绝', () => {
      const btn = button({ action: { type: 'NAVIGATE', url: 'javascript:alert(1)' } })
      expect(resolveButtonUrl(btn, {})).toBe('')
    })

    it('⚠️ 字段值里带 javascript: 时被白名单挡下', () => {
      // 整条地址就是一个占位符（`{redirect}`）时，含义是「地址整个存在这个字段里」，
      // 插值【不】编码 —— 编了的话 https://a/b 会变成 https%3A%2F%2Fa%2Fb，
      // 浏览器当成相对路径，按钮点下去跳到当前站点下一个不存在的页面。
      //
      // 挡住注入的是协议白名单：它拿到的是字段值原文，`javascript:` 一眼就被拒。
      // 这条用例钉住「不编码不等于放宽安全」—— 哪天白名单被改松，这里会立刻失败
      const btn = button({ action: { type: 'NAVIGATE', url: '{redirect}' } })
      expect(resolveButtonUrl(btn, { redirect: 'javascript:alert(1)' })).toBe('')
      expect(resolveButtonUrl(btn, { redirect: 'https://example.com/a?b=1' })).toBe(
        'https://example.com/a?b=1'
      )
    })

    it('⚠️ 占位符只是地址一段时仍然编码 —— 那时字段值是参数，不是地址', () => {
      // 这一支的注入路径是被【编码】挡住的：`{proto}` 拼在别的字符前面，
      // 编码后冒号变成 %3A，拼不出协议。去掉这里的编码，白名单不会替它兜住
      const btn = button({ action: { type: 'NAVIGATE', url: '{proto}alert(1)' } })
      expect(resolveButtonUrl(btn, { proto: 'javascript:' })).toBe('javascript%3Aalert(1)')
    })

    it('地址为空时返回空串', () => {
      expect(resolveButtonUrl(button({ action: { type: 'NAVIGATE' } }), {})).toBe('')
    })
  })
})
