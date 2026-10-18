import { describe, expect, it, vi } from 'vitest'
import { applyPlainTextToggle, type PlainTextContext } from './plainText'

/**
 * 「查看明文」按钮的挂载逻辑
 *
 * 这个按钮的全部意义就是绕过脱敏，所以本文件守的不是「按钮长得对」，
 * 而是「不该出现的时候它真的不出现」。按钮本身由 form-create 渲染，
 * 组件那一半不在这里。
 */
describe('查看明文按钮', () => {
  const FLAG = '__plainTextToggle'

  /** 一个配了脱敏的主表字段 */
  const maskedField = () => ({
    field: 'mobile',
    props: { maskRule: 'MOBILE' },
    children: []
  })

  const ctx = (patch: Partial<PlainTextContext> = {}): PlainTextContext => ({
    pk: () => 1,
    fetch: vi.fn().mockResolvedValue('13900001111'),
    setValue: vi.fn(),
    notify: vi.fn(),
    ...patch
  })

  const togglesOf = (rule: any) => (rule.children ?? []).filter((c: any) => c?.[FLAG])

  it('配了脱敏的字段挂上按钮', () => {
    const rule = maskedField()
    applyPlainTextToggle([rule], ctx())
    expect(togglesOf(rule)).toHaveLength(1)
    expect(togglesOf(rule)[0].props.title).toBe('查看明文')
  })

  it('没配脱敏的字段不挂 —— 否则就成了任意列的明文读取口', () => {
    const rule = { field: 'name', props: {}, children: [] }
    applyPlainTextToggle([rule], ctx())
    expect(togglesOf(rule)).toHaveLength(0)
  })

  it('ctx 不传时不挂（新增态、详情态）', () => {
    const rule = maskedField()
    applyPlainTextToggle([rule])
    expect(togglesOf(rule)).toHaveLength(0)
  })

  describe('view-plain 权限门', () => {
    it('🔴 permitted 返回 false 时按钮不挂', () => {
      const rule = maskedField()
      applyPlainTextToggle([rule], ctx({ permitted: () => false }))
      expect(togglesOf(rule)).toHaveLength(0)
    })

    it('permitted 返回 true 时照常挂', () => {
      const rule = maskedField()
      applyPlainTextToggle([rule], ctx({ permitted: () => true }))
      expect(togglesOf(rule)).toHaveLength(1)
    })

    it('🔴 权限被收回后重新应用，上一次挂的按钮要被清掉', () => {
      // 这是「隐藏」而不是「点了报 403」的全部意义所在：权限会在会话中途变
      // （切角色、被收回授权后刷新配置），只在入口 return 会把旧按钮留在树上，
      // 于是界面上还看得见、点下去才吃一个 403 —— 比一开始就不给看更让人困惑
      const rule = maskedField()
      applyPlainTextToggle([rule], ctx({ permitted: () => true }))
      expect(togglesOf(rule)).toHaveLength(1)

      applyPlainTextToggle([rule], ctx({ permitted: () => false }))
      expect(togglesOf(rule)).toHaveLength(0)
    })

    it('无权限时仍要往下递归，藏在栅格里的旧按钮同样清掉', () => {
      const inner = maskedField()
      const grid = { children: [inner] }
      applyPlainTextToggle([grid], ctx({ permitted: () => true }))
      expect(togglesOf(inner)).toHaveLength(1)

      applyPlainTextToggle([grid], ctx({ permitted: () => false }))
      expect(togglesOf(inner)).toHaveLength(0)
    })
  })

  it('子表内部的脱敏字段不挂 —— 服务端没开这个口子', () => {
    // 子表明细的明文查看要带「哪一行明细」，接口形状完全不同，两侧都刻意不开
    const subField = maskedField()
    const subTable = { field: 'items', props: {}, children: [], value: [[subField]] }
    applyPlainTextToggle([subTable], ctx())
    expect(togglesOf(subField)).toHaveLength(0)
  })

  it('重复应用不会叠出两个按钮', () => {
    const rule = maskedField()
    applyPlainTextToggle([rule], ctx())
    applyPlainTextToggle([rule], ctx())
    expect(togglesOf(rule)).toHaveLength(1)
  })

  it('点按钮时没有主键则直接说明，不发必然失败的请求', async () => {
    const rule = maskedField()
    const fetch = vi.fn()
    const notify = vi.fn()
    applyPlainTextToggle([rule], ctx({ pk: () => undefined, fetch, notify }))

    await togglesOf(rule)[0].on.click()

    expect(fetch).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('error', '这条数据还没保存，没有可查看的原值')
  })

  it('取到明文后写回表单', async () => {
    const rule = maskedField()
    const setValue = vi.fn()
    applyPlainTextToggle([rule], ctx({ setValue }))

    await togglesOf(rule)[0].on.click()

    expect(setValue).toHaveBeenCalledWith('mobile', '13900001111')
  })

  it('🔴 fetch 收到的是刚判过非空的那个主键，调用方不必自己再读一遍全局状态', async () => {
    // 钉住这个参数是因为 `getPlainField` 的 id 是必填的 `string | number`，
    // 而 render/index.vue 那边的 currentPk 是 `string | number | undefined`：
    // 窄化只发生在本模块里。哪天把 pk 参数删掉，调用方就只能 `as` 硬压，ts:check 当场红。
    const rule = maskedField()
    const fetch = vi.fn().mockResolvedValue('13900001111')
    applyPlainTextToggle([rule], ctx({ pk: () => 42, fetch }))

    await togglesOf(rule)[0].on.click()

    expect(fetch).toHaveBeenCalledWith('mobile', 42)
  })
})
