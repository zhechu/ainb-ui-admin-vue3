import { describe, expect, it } from 'vitest'
import { NODE_TYPE_META, nodeHasRequiredGap } from '../nodeSummary'
import { buildStarterDsl, type WorkflowTriggerType } from './starterDsl'
import {
  TRIGGER_CASE_ORDER,
  TRIGGER_CASES,
  triggerCaseOf,
  triggerTypeLabel,
  type TriggerCase
} from './triggerCases'

/**
 * 触发方式经典案例的结构不变量（AI助手 流程编排优化 / Req 3）
 *
 * 🔴 为什么这些断言值得写：案例是「给用户抄的样板」，一旦某条案例体检不过，用户照抄就会撞墙，
 *    而且撞墙时他认为是自己配错了——比没有案例更糟。这里把后端 WorkflowDslValidator 的**每一条 error 规则**
 *    与「不产 warning」的条件在前端复刻一遍，让案例坏掉时单测先红，而不是等用户在浏览器里发现。
 *
 * 🔴 后端 /validate 的实测已在开发期逐个跑过（五条全 passed、0 error、0 warning）；本 spec 是它的
 *    离线守门员，防止后续改案例时把不变量改坏。
 */

const ALL_TYPES: WorkflowTriggerType[] = ['none', 'chat', 'form_event', 'schedule', 'webhook']

/** 后端 WorkflowDslValidator.ID_PATTERN */
const ID_PATTERN = /^[a-z][a-z0-9_]{0,62}$/
/** 后端 WorkflowDslValidator.PLACEHOLDER_ROOT */
const PLACEHOLDER_ROOT = /\{\{\s*\$\.([a-zA-Z][a-zA-Z0-9_]*)/g

/** 无头触发：后台自动跑，界面上没有人可以点「同意」或发事件 */
const HEADLESS: WorkflowTriggerType[] = ['form_event', 'schedule', 'webhook']
/** 挂起后需要人来唤醒的节点类型——无头流程里放它们等于永久卡死 */
const BLOCKING_TYPES = ['hitl.confirm', 'hitl.bpm_approval', 'wait']

/** 案例只允许用只读工具：样板会被真跑（沙箱/手动运行），不能产生副作用 */
const READ_ONLY_TOOLS = [
  'data_interface_list',
  'data_interface_query',
  'datamodel_column_types',
  'datamodel_list',
  'datamodel_physical_tables',
  'datamodel_preview_ddl',
  'datamodel_structure',
  'diagnose_not_working',
  'doc_search',
  'explain_form_rule',
  'explain_process',
  'form_get',
  'form_inspect',
  'form_list',
  'form_data_get',
  'form_data_page',
  'process_get_simple',
  'process_list',
  'widget_contract_get'
]

/** 深度遍历所有字符串值，收集 {{$.xxx}} 的根名 */
const collectPlaceholderRoots = (value: any, out: Set<string>): void => {
  if (typeof value === 'string') {
    for (const m of value.matchAll(PLACEHOLDER_ROOT)) out.add(m[1])
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collectPlaceholderRoots(v, out))
    return
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectPlaceholderRoots(v, out))
  }
}

describe('triggerCases 目录完整性', () => {
  it('五种触发方式各有一个案例，一个都不缺', () => {
    expect(TRIGGER_CASE_ORDER).toEqual(ALL_TYPES)
    for (const t of ALL_TYPES) {
      expect(TRIGGER_CASES[t], `缺少 ${t} 的案例`).toBeDefined()
      expect(TRIGGER_CASES[t].triggerType).toBe(t)
    }
  })

  it('每个案例的人话字段都填了（标题/场景/走向/触发怎么填/要点）', () => {
    for (const t of ALL_TYPES) {
      const c = TRIGGER_CASES[t]
      expect(c.title, `${t}.title`).toBeTruthy()
      expect(c.scenario, `${t}.scenario`).toBeTruthy()
      expect(c.flowText, `${t}.flowText`).toBeTruthy()
      expect(c.configSummary, `${t}.configSummary`).toBeTruthy()
      expect(c.highlights.length, `${t}.highlights`).toBeGreaterThan(0)
      // 要点里不许出现裸的后端 config 键名——面向非技术人员，键名是噪音
      for (const h of c.highlights) {
        expect(h, `${t} 要点应说人话：${h}`).not.toMatch(/outputVar|toolId|inputVar/)
      }
    }
  })

  it('triggerCaseOf 认不出的类型返回 undefined，不抛错', () => {
    expect(triggerCaseOf('nope')).toBeUndefined()
    expect(triggerCaseOf(null)).toBeUndefined()
    expect(triggerCaseOf(undefined)).toBeUndefined()
    expect(triggerCaseOf('webhook')?.triggerType).toBe('webhook')
  })

  it('triggerTypeLabel 认不出的类型原样返回，绝不吐 undefined 让页面渲染空白', () => {
    expect(triggerTypeLabel('chat')).toBe('对话驱动 Agent')
    expect(triggerTypeLabel('什么鬼')).toBe('什么鬼')
    expect(triggerTypeLabel(null)).toBe('未配置')
  })
})

describe('每个案例的图主体都满足后端 error 级规则', () => {
  for (const t of ALL_TYPES) {
    describe(t, () => {
      const body = TRIGGER_CASES[t].body()

      it('节点 id 合法且唯一，类型是已知的 13 种之一', () => {
        const ids = body.nodes.map((n) => n.id)
        expect(new Set(ids).size, 'id 重复').toBe(ids.length)
        for (const n of body.nodes) {
          expect(n.id, `id ${n.id} 不合 ID_PATTERN`).toMatch(ID_PATTERN)
          expect(NODE_TYPE_META[n.type], `未知节点类型 ${n.type}`).toBeDefined()
        }
      })

      it('节点必填配置无缺口（画布上不出红点）', () => {
        for (const n of body.nodes) {
          expect(nodeHasRequiredGap(n as any), `${n.id} 必填有缺口`).toBe(false)
        }
      })

      it('至少一条边从 START 出发、至少一条边指向 END', () => {
        const fromStart = body.edges.some((e) => e.from === 'START')
        const toEnd = body.edges.some((e) => e.to === 'END' || e.default === 'END'
          || Object.values(e.cases ?? {}).includes('END'))
        expect(fromStart, '没有 START 入口').toBe(true)
        expect(toEnd, '没有 END 出口').toBe(true)
      })

      it('每条边的端点都解析得到（START/END 或已声明的节点 id）', () => {
        const known = new Set([...body.nodes.map((n) => n.id), 'START', 'END'])
        for (const e of body.edges) {
          expect(known.has(e.from), `from ${e.from} 解析不到`).toBe(true)
          if (e.to) expect(known.has(e.to), `to ${e.to} 解析不到`).toBe(true)
          for (const target of Object.values(e.cases ?? {})) {
            expect(known.has(target as string), `cases 目标 ${target} 解析不到`).toBe(true)
          }
          if (e.default) {
            expect(known.has(e.default), `default 目标 ${e.default} 解析不到`).toBe(true)
          }
        }
      })

      it('条件边必须带 type=conditional，且有 cases 或 default', () => {
        for (const e of body.edges) {
          const hasCases = !!e.cases && Object.keys(e.cases).length > 0
          if (hasCases || e.default) {
            // 🔴 EdgeDTO.isConditional() 只认 type==="conditional"；漏写 type 会让 cases 被当成普通边忽略，
            //    表现为「配了分支但永远走同一条」——最难查的那种静默失效
            expect(e.type, `条件边 ${e.from} 漏写 type=conditional`).toBe('conditional')
            expect(hasCases || !!e.default).toBe(true)
          }
        }
      })

      it('所有 {{$.x}} 引用的根都已声明（后端 error 级规则）', () => {
        const declared = new Set(body.variables.map((v) => v.key))
        declared.add('input') // 后端固定放行 input
        const roots = new Set<string>()
        collectPlaceholderRoots(body.nodes, roots)
        for (const r of roots) {
          expect(declared.has(r), `{{$.${r}}} 的根未声明`).toBe(true)
        }
      })

      it('每个 outputVar 都在 variables 里声明过（否则后端产 warning）', () => {
        const declared = new Set(body.variables.map((v) => v.key))
        for (const n of body.nodes) {
          const out = n.config?.outputVar
          if (typeof out === 'string' && out) {
            expect(declared.has(out), `${n.id} 的 outputVar ${out} 未声明`).toBe(true)
          }
        }
      })

      it('只用只读工具（案例会被真跑，不能有副作用）', () => {
        for (const n of body.nodes) {
          if (n.type === 'tool') {
            expect(READ_ONLY_TOOLS, `${n.config?.toolId} 不是只读工具`).toContain(n.config?.toolId)
          }
        }
      })

      if (HEADLESS.includes(t)) {
        it('无头触发不含人工确认/等待节点（挂起后没人唤醒，会永久卡死）', () => {
          for (const n of body.nodes) {
            expect(BLOCKING_TYPES, `${n.id} 是无头流程里的挂起节点`).not.toContain(n.type)
          }
        })
      }
    })
  }
})

describe('body() 每次返回全新对象', () => {
  it('就地突变一次不会污染下一次取用', () => {
    const c: TriggerCase = TRIGGER_CASES.chat
    const a = c.body()
    // editorModel 的所有变更都是就地突变；模拟「用户改了第一个节点的名字」
    a.nodes[0].name = '被改脏了'
    a.variables.push({ key: 'dirty', type: 'string' })
    const b = c.body()
    expect(b.nodes[0].name).not.toBe('被改脏了')
    expect(b.variables.some((v) => v.key === 'dirty')).toBe(false)
    expect(b.nodes).not.toBe(a.nodes)
  })
})

describe('buildStarterDsl("case") 端到端组装', () => {
  const triggerFor = (t: WorkflowTriggerType): any =>
    ({
      none: { type: 'none' },
      chat: { type: 'chat', agentId: 'bot' },
      form_event: { type: 'form_event', formCode: 'f', eventType: 'create' },
      schedule: { type: 'schedule', cron: '0 0 2 * * ?' },
      webhook: { type: 'webhook', path: 'p', authType: 'none' }
    })[t]

  for (const t of ALL_TYPES) {
    it(`${t}：产出合法 JSON，带 code/name、非空 nodes、trigger 与所选方式一致`, () => {
      const dsl = JSON.parse(
        buildStarterDsl('case', { code: 'wf_x', name: '案例', description: '', trigger: triggerFor(t) })
      )
      expect(dsl.id).toBe('wf_x')
      expect(dsl.name).toBe('案例')
      expect(dsl.nodes.length).toBeGreaterThan(0)
      expect(dsl.settings).toBeDefined()
      if (t === 'none') {
        expect(dsl.trigger).toBeUndefined()
      } else {
        expect(dsl.trigger.type).toBe(`trigger.${t}`)
      }
    })
  }

  it('copy 源非法时退化为当前触发方式的案例（仍是完整流程，不是空画布）', () => {
    const dsl = JSON.parse(
      buildStarterDsl('copy', {
        code: 'wf_x',
        name: 'n',
        trigger: { type: 'schedule', cron: '0 0 2 * * ?' },
        copyDsl: 'not-json'
      })
    )
    expect(dsl.nodes.map((n: any) => n.id)).toEqual(TRIGGER_CASES.schedule.body().nodes.map((n) => n.id))
  })
})
