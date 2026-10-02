import { describe, expect, it } from 'vitest'
import {
  buildStarterDsl,
  buildTriggerBlock,
  injectTrigger,
  type StarterMeta,
  type WorkflowTriggerMeta
} from './starterDsl'

/**
 * starterDsl 纯逻辑单测（AI助手 流程编排优化 / Req 2）
 *
 * 钉死三件事：① 三种模板都产出**合法 JSON**且带 code/name；② trigger 块与后端契约逐字对齐
 * （type 全名 trigger.xxx + 对应 config 键），none 不写块；③ 编辑注入只换 trigger、保留画布节点。
 */
describe('buildTriggerBlock', () => {
  it('chat：写全名 trigger.chat + inputVar/agentId，agentId 缺省为空串', () => {
    expect(buildTriggerBlock({ type: 'chat' })).toEqual({
      type: 'trigger.chat',
      config: { inputVar: 'input', agentId: '' }
    })
    expect(buildTriggerBlock({ type: 'chat', agentId: 'sales_bot' })?.config.agentId).toBe('sales_bot')
  })

  it('form_event：写 formCode + eventType', () => {
    expect(buildTriggerBlock({ type: 'form_event', formCode: 'order', eventType: 'create' })).toEqual({
      type: 'trigger.form_event',
      config: { formCode: 'order', eventType: 'create' }
    })
  })

  it('schedule：写 cron', () => {
    expect(buildTriggerBlock({ type: 'schedule', cron: '0 0 2 * * ?' })).toEqual({
      type: 'trigger.schedule',
      config: { cron: '0 0 2 * * ?' }
    })
  })

  /**
   * 🔴 #72：这条原来叫「webhook：authType 缺省 none、不写 secret；hmac 才带 secret」，
   * 把「缺省即不鉴权」同时写进了**用例标题**和**断言** —— 测试锁死了错误契约，
   * 于是「单测全绿」反而成了修复的阻力。改契约必须连标题一起改，
   * 否则下一个人只会照着旧标题把它改回去。
   */
  it('webhook：authType 缺省 hmac、secret 无条件写（空也写）；不再有「不鉴权」这一档', () => {
    expect(buildTriggerBlock({ type: 'webhook', path: 'order_hook' })).toEqual({
      type: 'trigger.webhook',
      config: { path: 'order_hook', authType: 'hmac', secret: '' }
    })
    expect(
      buildTriggerBlock({ type: 'webhook', path: 'hook', authType: 'hmac', secret: 's3cr3t' })?.config
    ).toEqual({ path: 'hook', authType: 'hmac', secret: 's3cr3t' })
    expect(
      buildTriggerBlock({ type: 'webhook', path: 'hook', authType: 'token', secret: 'tok-1' })?.config
    ).toEqual({ path: 'hook', authType: 'token', secret: 'tok-1' })
  })

  /**
   * 🔴 刻意**不**在前端把 authType:'none' 悄悄改写成 'hmac'：悄悄改写会让作者以为自己配对了，
   * 正是本模块要消灭的「保存成功但落库的不是你以为的那份」。原样交给后端，
   * 由 WorkflowTriggerExtractor 那句 WORKFLOW_TRIGGER_CONFIG_INVALID 做唯一权威口径（避免两份校验漂移）。
   * UI 上这条路径已经走不到（下拉只剩两项、回显时也归一化），本条守的是「别有人日后加个自动改写」。
   */
  it('webhook：authType:"none" 原样写进 DSL，不被前端悄悄改写（交给后端权威拒）', () => {
    expect(
      buildTriggerBlock({ type: 'webhook', path: 'hook', authType: 'none', secret: 's3cr3t' })?.config
    ).toEqual({ path: 'hook', authType: 'none', secret: 's3cr3t' })
  })

  it('none：返回 undefined（不写 trigger 块）', () => {
    expect(buildTriggerBlock({ type: 'none' })).toBeUndefined()
  })
})

describe('buildStarterDsl', () => {
  const meta = (trigger: WorkflowTriggerMeta, over?: Partial<StarterMeta>): StarterMeta => ({
    code: 'wf_new',
    name: '新流程',
    description: '描述',
    trigger,
    ...over
  })

  it('case：产出合法 DSL，含案例节点、START/END 边、trigger 注入', () => {
    const dsl = JSON.parse(buildStarterDsl('case', meta({ type: 'chat', agentId: 'a1' })))
    expect(dsl.id).toBe('wf_new')
    expect(dsl.name).toBe('新流程')
    expect(dsl.trigger.type).toBe('trigger.chat')
    expect(dsl.trigger.config.agentId).toBe('a1')
    expect(dsl.nodes.length).toBeGreaterThan(0)
    expect(dsl.edges.some((e: any) => e.from === 'START')).toBe(true)
    expect(dsl.edges.some((e: any) => e.to === 'END')).toBe(true)
  })

  it('case：图主体随触发方式变（chat 与 webhook 不是同一份）', () => {
    const chat = JSON.parse(buildStarterDsl('case', meta({ type: 'chat' })))
    const hook = JSON.parse(buildStarterDsl('case', meta({ type: 'webhook', path: 'p' })))
    expect(chat.nodes.map((n: any) => n.id)).not.toEqual(hook.nodes.map((n: any) => n.id))
    // webhook 案例带条件分支，chat 案例不带
    expect(hook.edges.some((e: any) => e.type === 'conditional')).toBe(true)
    expect(chat.edges.some((e: any) => e.type === 'conditional')).toBe(false)
  })

  it('blank：nodes/edges 皆空，但保留 input/output 变量（createDef 不做图校验，可建草稿）', () => {
    const dsl = JSON.parse(buildStarterDsl('blank', meta({ type: 'none' })))
    expect(dsl.nodes).toEqual([])
    expect(dsl.edges).toEqual([])
    expect(dsl.variables.map((v: any) => v.key)).toEqual(['input', 'output'])
    expect(dsl.trigger).toBeUndefined()
  })

  it('copy：深拷贝源结构（保留节点），重置 id/name，注入新 trigger', () => {
    const source = JSON.stringify({
      dslVersion: '1.0',
      id: 'wf_old',
      name: '旧流程',
      trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: 'old' } },
      variables: [{ key: 'input', type: 'string', merge: 'replace' }],
      nodes: [{ id: 'n1', type: 'llm', name: '生成', config: { outputVar: 'out' } }],
      edges: [
        { from: 'START', to: 'n1' },
        { from: 'n1', to: 'END' }
      ],
      settings: { recovery: 'forward' }
    })
    const dsl = JSON.parse(
      buildStarterDsl('copy', meta({ type: 'webhook', path: 'p1' }, { copyDsl: source }))
    )
    expect(dsl.id).toBe('wf_new')
    expect(dsl.name).toBe('新流程')
    expect(dsl.nodes).toHaveLength(1)
    expect(dsl.nodes[0].id).toBe('n1')
    expect(dsl.trigger.type).toBe('trigger.webhook')
  })

  it('copy 源非法：安全退化为当前触发方式的案例（不抛、仍产合法且非空的 DSL）', () => {
    const dsl = JSON.parse(buildStarterDsl('copy', meta({ type: 'none' }, { copyDsl: 'not-json' })))
    expect(dsl.nodes.length).toBeGreaterThan(0)
  })

  it('产出物一定是合法 JSON 字符串', () => {
    expect(() => JSON.parse(buildStarterDsl('blank', meta({ type: 'none' })))).not.toThrow()
    expect(() =>
      JSON.parse(buildStarterDsl('case', meta({ type: 'schedule', cron: '0 0 * * * ?' })))
    ).not.toThrow()
  })
})

describe('injectTrigger', () => {
  it('只替换 trigger，保留 nodes/edges 原样', () => {
    const src = JSON.stringify({
      id: 'wf',
      trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: 'old' } },
      nodes: [{ id: 'n1', type: 'tool' }],
      edges: [{ from: 'START', to: 'n1' }]
    })
    const out = JSON.parse(injectTrigger(src, { type: 'form_event', formCode: 'f', eventType: 'update' }))
    expect(out.trigger.type).toBe('trigger.form_event')
    expect(out.nodes).toHaveLength(1)
    expect(out.edges).toHaveLength(1)
  })

  it('none：删除 trigger 块', () => {
    const src = JSON.stringify({ id: 'wf', trigger: { type: 'trigger.chat', config: {} }, nodes: [] })
    expect(JSON.parse(injectTrigger(src, { type: 'none' })).trigger).toBeUndefined()
  })

  it('源非法：原样返回，不破坏数据', () => {
    expect(injectTrigger('broken', { type: 'chat' })).toBe('broken')
  })
})
