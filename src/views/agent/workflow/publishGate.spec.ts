import { describe, expect, it } from 'vitest'
import type { AgentWorkflowDefValidateVO } from '@/api/agent/workflow'
import { decidePublishGate, precheckPublish } from './publishGate'

/**
 * publishGate 纯逻辑单测（重构 S4b / 前端半边）
 *
 * 钉住四条「写反了就出事」的判定：
 * ① warning 不阻断（存量 20+ 行带 warning，判反了它们一夜之间全发不出去）；
 * ② 预检自己坏了要降级成照发，不能变成一道没人授权过的新闸门（403 是权限问题，与流程合法性无关）；
 * ③ passed 与 errors 自相矛盾时 fail-close（闸门在自相矛盾时放行比误拦一次坏得多）；
 * ④ block 永远至少有一条文字 —— 空对话框就是「点了发布、什么都没发生且无提示」，平台头号缺陷。
 */
describe('publishGate', () => {
  const vo = (over: Partial<AgentWorkflowDefValidateVO>): AgentWorkflowDefValidateVO => ({
    passed: true,
    errors: [],
    warnings: [],
    ...over
  })

  describe('decidePublishGate', () => {
    it('干净通过 → publish，不带 warnings', () => {
      expect(decidePublishGate(vo({}))).toEqual({ action: 'publish', warnings: [] })
    })

    it('① 只有 warning → 照样 publish，且 warnings 原样带出', () => {
      const v = decidePublishGate(
        vo({ warnings: ['widget 大小写会被静默改写：Input → input', 'tool.args 的嵌套占位符不会被解析'] })
      )
      expect(v.action).toBe('publish')
      expect(v).toHaveProperty('warnings.length', 2)
    })

    it('有 error → block，errors 原文原序、一条不少', () => {
      const errors = ['表名 order_info 不合法，应改为 biz_order_info', '节点 n3 的 outputVar 未声明']
      const v = decidePublishGate(vo({ passed: false, errors }))
      expect(v.action).toBe('block')
      expect(v).toHaveProperty('errors', errors)
      // 🔴 逐条列出的前提是「不被折叠成条数」：这里必须是原文，不能是 '还有 2 处需要修正'
      expect((v as any).errors[0]).toContain('应改为 biz_order_info')
    })

    it('④ passed=false 但 errors 为空 → block，且给一条兜底文字而不是空对话框', () => {
      const v = decidePublishGate(vo({ passed: false, errors: [] }))
      expect(v.action).toBe('block')
      expect((v as any).errors).toHaveLength(1)
      expect((v as any).errors[0]).toContain('没有返回具体的错误项')
    })

    it('③ passed=true 但 errors 非空（自相矛盾）→ fail-close 拦下', () => {
      const v = decidePublishGate(vo({ passed: true, errors: ['节点 x 不可达'] }))
      expect(v.action).toBe('block')
      expect((v as any).errors).toEqual(['节点 x 不可达'])
    })

    it('结果为 null / undefined → publish-blind（预检没跑成，不是流程有问题）', () => {
      expect(decidePublishGate(null).action).toBe('publish-blind')
      expect(decidePublishGate(undefined).action).toBe('publish-blind')
    })

    it('errors/warnings 不是数组（线上响应被截断）→ 当空数组处理，不抛', () => {
      const broken = { passed: true, errors: undefined, warnings: undefined } as any
      expect(decidePublishGate(broken)).toEqual({ action: 'publish', warnings: [] })
    })
  })

  describe('precheckPublish', () => {
    it('正常路径：把取到的 dsl 原样交给 /validate，并回传判定', async () => {
      let seen = ''
      const v = await precheckPublish(
        async () => '{"id":"wf_x"}',
        async (dsl) => {
          seen = dsl
          return vo({ passed: false, errors: ['wait 节点未声明唤醒方'] })
        }
      )
      // 🔴 这条断言守的是「别拿空串去预检」：那样后端只会回一条 JSON 解析错，
      //    看着像流程写坏了，其实是前端没把 dsl 传过去
      expect(seen).toBe('{"id":"wf_x"}')
      expect(v.action).toBe('block')
    })

    it('② loadDsl 抛错 → publish-blind，不把「这一层坏了」说成「流程不合法」', async () => {
      const v = await precheckPublish(
        async () => {
          throw new Error('403')
        },
        async () => vo({})
      )
      expect(v.action).toBe('publish-blind')
    })

    it('② /validate 抛错（403 / 网络）→ publish-blind，reason 说清是预检没跑成', async () => {
      const v = await precheckPublish(
        async () => '{"id":"wf_x"}',
        async () => {
          throw new Error('403')
        }
      )
      expect(v.action).toBe('publish-blind')
      expect((v as any).reason).toContain('体检接口没有响应')
    })

    it('④ dsl 为空 / 纯空白 → block（本地就能判定，不必盲发一次再被读不到地拒回来）', async () => {
      for (const blank of ['', '   ', null, undefined]) {
        const v = await precheckPublish(async () => blank as any, async () => vo({}))
        expect(v.action).toBe('block')
        expect((v as any).errors[0]).toContain('流程内容为空')
      }
    })
  })
})
