import { describe, expect, it } from 'vitest'
import { EXECUTION_HISTORY_ROUTE, executionResumeHint } from './resumeRoute'

/**
 * 「连接断了也要把执行编号留在页面上」的文案不变量（台账 B3-8）
 *
 * 🔴 这类断言值得写，是因为它守的失效形态**很安静**：给提示句换个说法、或者在某条路径上
 * 忘了带编号，编译通过、页面也「看着有报错」，只有真断连一次才发现用户手里什么凭据都没有 ——
 * 而断连本来就不好造，于是这个缺陷能活很久（它确实活了：三处 `throw err` 从增量13 起就只留一句
 * 「连接中断，请重试」）。
 *
 * ⚠️ 本 spec 只管**文案**这一层。「三处调用点都真的调了本函数」「卡片那行真的渲染了编号」
 * 属于组件行为，由 e2e / 浏览器实测守（方案 §8 的③行为层），这里替代不了。
 */
describe('resumeRoute', () => {
  describe('菜单路径必须是侧栏里真能点到的名字', () => {
    it('逐字含「流程编排」与「执行历史」', () => {
      // 🔴 钉这两个名字：写成「工作流定义」「流程执行」都是把人支去一个找不到的地方。
      //    2026-09-29 就造过这个死路（卡片提示「可在「流程执行」页恢复」，那个页压根不存在）。
      expect(EXECUTION_HISTORY_ROUTE).toContain('流程编排')
      expect(EXECUTION_HISTORY_ROUTE).toContain('执行历史')
    })

    it('不含那两个曾经骗过人的假名字', () => {
      expect(EXECUTION_HISTORY_ROUTE).not.toContain('工作流定义')
      expect(EXECUTION_HISTORY_ROUTE).not.toContain('流程执行页')
    })
  })

  describe('拿不到编号就不提示', () => {
    it.each([
      ['null', null],
      ['undefined', undefined]
    ])('executionId 为 %s → 空串', (_label, id) => {
      expect(executionResumeHint(id)).toBe('')
    })

    it('🔴 空串而不是「一句没有编号的提示」', () => {
      // 反向对照：若这里退化成一句固定文案，用户到了抽屉里认不出是哪一条
      // （同一个定义可能跑过几十次，列表按时间倒序，断连那次未必在第一行），
      // 那句提示就从「出路」变成「又一个死路」。
      expect(executionResumeHint(null)).toBe('')
      expect(executionResumeHint(null).length).toBe(0)
    })
  })

  describe('拿到编号就必须把编号印出来', () => {
    it('含 #编号、含菜单路径', () => {
      const hint = executionResumeHint(123456)
      expect(hint).toContain('#123456')
      expect(hint).toContain(EXECUTION_HISTORY_ROUTE)
    })

    it('🔴 提示指向「先看状态，仍挂起才恢复」，不打包票说点一下就能恢复', () => {
      // 恢复按钮只在 INTERRUPTED 行出现；其余状态调 resume 后端直接抛 STATE_INVALID。
      // 断连后前端无从知道那条执行现在是什么状态，故文案必须留这个余地。
      const hint = executionResumeHint(9)
      expect(hint).toContain('状态')
      expect(hint).toContain('等待确认')
      expect(hint).not.toContain('点击即可恢复')
    })

    it('大编号不被截断、不加千分位（要能原样复制去搜）', () => {
      const id = 1934567890123456789
      expect(executionResumeHint(id)).toContain(`#${id}`)
      expect(executionResumeHint(id)).not.toContain(',')
    })
  })

  describe('两条不同的执行不会共用同一句提示', () => {
    it('编号不同 → 文案不同', () => {
      // 🔴 这条是「保留 executionId」的下限：若提示句把编号抹平（例如只说「本次已产生执行」），
      //    两条断连的报错长得一模一样，用户就分不清哪句对应哪条执行，等于没保留。
      const a = executionResumeHint(1001)
      const b = executionResumeHint(1002)
      expect(a).not.toBe('')
      expect(b).not.toBe('')
      expect(a).not.toBe(b)
    })

    it('编号 0 也照实印出来（不用 !id 这种把 0 吞掉的判法）', () => {
      // ⚠️ 后端不会真发 0，但 `== null` 与 `!id` 的差别正是这里：
      //    写成 `!executionId` 的话，任何假值都会静默退化成「不提示」，而那种失效没有报错。
      expect(executionResumeHint(0)).toContain('#0')
    })
  })
})
