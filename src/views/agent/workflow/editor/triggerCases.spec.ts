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
 *    而且撞墙时他认为是自己配错了——比没有案例更糟。
 *
 * 🔴 但本 spec **不是**后端 WorkflowDslValidator 的离线复刻，别当成双端一致的证据来读。
 *    V1~V19 落地后（2026-10-02，`5050bfe0d8`→`fee188d5cf`）后端 V 系列 19 条里 **17 条生效**
 *    （V9 未实现、V17 不可能触发），这里只碰得到其中三条：
 *      · V13/V14 → `isHeadlessUnsafe()`（下面专有一节喂构造样本钉它）
 *      · V15     → 「webhook 案例预填的鉴权方式能过 V15」那一条不变量
 *    其余 **14** 条生效规则（工具存在/启用、agent_loop 只读、表与列存在、bpm 流程已部署、
 *    模型存在、子流程已发布、干跑被拒、触发器×风险矩阵、不可达节点、写而未声明……）
 *    **这里一条都没有**，由后端 `WorkflowDslValidatorTest`（145 条）独家守着。
 *    ⟹ 刻意不复刻：把那 14 条在前端再写一遍就是校验器的第二份副本，会漂（方案 §2-D7）。
 *       权威在后端，这里只管「**这五个案例本身**别坏」。
 *
 * 🔴 后端 /validate 的实测：2026-10-02 用**带全 V1~V19 的构建**逐条重跑过，
 *    五条案例仍全 passed、0 error、0 warning（`demo_none`/`demo_chat`/`demo_form_event`/
 *    `demo_schedule`/`demo_webhook`，按 TriggerCaseView 的同一套 buildStarterDsl('case', …) 组装）。
 *    ⚠️ 那次实测是**手工跑的、没有自动化**，所以下次后端再加规则时它不会自己重跑 ——
 *       本 spec 全绿**不等于**案例还能过后端体检。改案例后请重跑一次真 /validate。
 *
 * ⚠️ 残留的漂移面（已登记为方案 §0.8.1 第 14 行 / D-new23）：`isHeadlessUnsafe()` 是 V13/V14
 *    判据的**第二个读者**，两端只靠注释对齐、无自动链路。它今天有 7 条口径测试钉着（6 条喂构造
 *    样本 + 1 条扫 `NODE_TYPE_META` 全键的穷举表态），但后端若改了 V13/V14 的口径，这里不会自动红。
 */

const ALL_TYPES: WorkflowTriggerType[] = ['none', 'chat', 'form_event', 'schedule', 'webhook']

/** 后端 WorkflowDslValidator.ID_PATTERN */
const ID_PATTERN = /^[a-z][a-z0-9_]{0,62}$/
/** 后端 WorkflowDslValidator.PLACEHOLDER_ROOT */
const PLACEHOLDER_ROOT = /\{\{\s*\$\.([a-zA-Z][a-zA-Z0-9_]*)/g

/**
 * 无头触发：后台自动跑，界面上没有人可以点「同意」或发事件。
 *
 * 🔴 `none` **不在**里面，这不是漏项：none 压根不产 trigger 块（见文末 buildStarterDsl 那条断言），
 *    后端 triggerTypeOf 因此拿到 null，而 isHeadlessTrigger(null) 明确返回 false
 *    （WorkflowDslValidator:1457-1459）—— 这种定义只能由人点 run-stream 跑起来（沙箱、执行历史的重跑），
 *    那个人就在场，聊天确认卡有地方推。把它算成无头，会把「沙箱里调 hitl.confirm」这条主路径整个堵死。
 */
const HEADLESS: WorkflowTriggerType[] = ['form_event', 'schedule', 'webhook']

/**
 * 无头触发下**唤不醒**的节点类型。逐字对齐后端 V13 / V14，不多不少。
 *
 * 🔴 原名 BLOCKING_TYPES，且列了 hitl.bpm_approval 和整个 wait —— **两项都是错的**：
 *   · `hitl.bpm_approval` 恰恰是 V13 给无头流程指的**出路**，错误文案原话就是
 *     「无头流程的人工介入请改用 hitl.bpm_approval（走 BPM 待办唤醒，有承办人、不依赖聊天窗口）」；
 *     V11 也把它同时放进 headlessGates 与 attendedGates（WorkflowDslValidator:1210-1212，
 *     注释写着「有无头都能唤醒」）。把它列成禁用，等于教用户别用那个唯一能用的选项 ——
 *     照抄的人会把闸口整个删掉，那正是 V11 要拦的方向。
 *   · `wait` 必须按 waitType 分档：duration 有平台内的自动唤醒方
 *     （WorkflowWaitResumeScheduler 扫 resume_at 到点续跑），V14 明确不管它，理由写在 :1321-1324
 *     「一刀切禁掉所有 wait 会把『等 10 分钟再发通知』这种完全正常的自动化挡在门外」；
 *     只有 event 那一档靠外部系统调 POST /agent/workflow/event，而平台内**零调用方**。
 *
 * 所以这里从「一张类型黑名单」改成「一个按 config 判的谓词」：判据是**唤不唤得醒**，
 * 不是**会不会挂起**。挂起本身从来不是问题，醒不过来才是。
 */
const HEADLESS_UNSAFE_TYPES = ['hitl.confirm']

/** wait 在无头触发下唤不醒的那一档；大小写敏感，与 V14:1351-1355 同口径 */
const WAIT_TYPE_EVENT = 'event'

const notBlank = (v: any): boolean => typeof v === 'string' && v.trim() !== ''

/**
 * 这个节点放进无头流程会不会永久卡在 INTERRUPTED。
 *
 * 🔴 wait(event) 这半边的判据刻意与 V14 逐字一致：
 *   · waitType **大小写敏感**地等于 event。「取值合不合法」是编译器 validateWaitConfig 的权威
 *     （EVENT 会被它判「未知，仅支持 duration/event」）；这里若放宽成不敏感，同一份 DSL 就会
 *     同时收到「未知 waitType」和「没声明唤醒方」两条 —— 一个根因说两遍。
 *   · 声明**只认 owner / endpoint，光写 note 不算**（wakeupDeclarationOf:1499 要求两者至少一个非空；
 *     V14:1332-1334 的理由是「只填一句 note 等于把问题抄了一遍当答案」）。
 *
 * ⚠️ 声明了在后端只降到 warning，不是「安全」。本谓词返回 false 的含义是**不阻断发布**，
 *    与后端 error / warning 的分界同口径 —— 别把它当成「这么配就没风险了」。
 */
const isHeadlessUnsafe = (node: Record<string, any>): boolean => {
  if (HEADLESS_UNSAFE_TYPES.includes(node.type)) return true
  if (node.type !== 'wait') return false
  const waitType = node.config?.waitType
  if (typeof waitType !== 'string' || waitType.trim() !== WAIT_TYPE_EVENT) return false
  const wakeup = node.config?.externalWakeup
  if (!wakeup || typeof wakeup !== 'object') return true
  return !(notBlank(wakeup.owner) || notBlank(wakeup.endpoint))
}

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

  /**
   * 🔴 重构 S4a-i：webhook 此前是三个无头案例里唯一没写「无头执行」这条约束的。
   *
   * 漏掉的后果不是少一句提示：form_event 与 schedule 都写了、webhook 没写，
   * 读者合理的推论就是「webhook 没有这个限制」，于是照着放一个「人工确认」节点，
   * 发布时撞 error，还认为是自己配错了。
   *
   * 两条断言都不是在钉措辞，而是在钉**这条约束在不在场、给没给出路**：
   * 只说「不许放」会让作者把闸口整个删掉 —— 那正是 V11 要拦的方向
   * （WorkflowDslValidator:1286-1287 同一条文案纪律）。
   */
  it('每个无头案例都写明了无头约束，且都指出了「BPM 审批」这条出路', () => {
    for (const t of HEADLESS) {
      const hs = TRIGGER_CASES[t].highlights
      expect(
        hs.some((h) => h.includes('无头执行')),
        `${t} 是无头触发，要点里却没说这件事，读者会以为只有别的触发方式有约束`
      ).toBe(true)
      expect(
        hs.some((h) => h.includes('BPM 审批')),
        `${t} 的无头要点没给出路，作者只会把人工闸口整个删掉`
      ).toBe(true)
    }
  })

  /**
   * 案例预填的鉴权方式必须真能落库、真能发布。
   *
   * 🔴 #72 起「不鉴权」这一档已从平台整个删掉，三处同改：设计器下拉没有它、
   *    后端 WorkflowTriggerExtractor 落库前就拒、入站 verifyAuth 也一律拒；V15 仍然报 error
   *    （管的是存量 DSL 与直改数据库这两种来路）。根因是「安全全靠 path 不可猜」在本平台不成立 ——
   *    path 是作者手填的一格，两个仓库里都没有任何随机串生成，而且它会进日志、进前端 URL、进浏览器历史。
   *    预填一个落不了库的值，等于把用户直接送到一句报错面前。
   */
  it('webhook 案例预填的鉴权方式能过 V15 与落库校验', () => {
    expect(TRIGGER_CASES.webhook.triggerDefaults.authType).toMatch(/^(hmac|token)$/)
  })

  /**
   * 🔴 刻意断言「没有 secret 预填」：密钥是凭据，预填一个字面量等于鼓励所有租户共用一个弱密钥，
   *    还会明文显示在弹窗里。留空 + 提交前必填校验，逼作者自己生成一条。
   *    本条守的是「别有人日后好心加个 secret: 'changeme'」。
   */
  it('webhook 案例不预填 secret（凭据不给字面量默认值）', () => {
    expect(TRIGGER_CASES.webhook.triggerDefaults).not.toHaveProperty('secret')
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
        it('无头触发不含唤不醒的节点（挂起后没人唤醒，会永久卡在 INTERRUPTED）', () => {
          for (const n of body.nodes) {
            expect(isHeadlessUnsafe(n), `${n.id}（${n.type}）在无头流程里醒不过来`).toBe(false)
          }
        })
      }
    })
  }
})

/**
 * {@link isHeadlessUnsafe} 自己的口径测试。
 *
 * 🔴 为什么必须单独立一节：上面那条断言问的是「案例里没有这种节点」，而五个案例**本来**就
 *    一个挂起节点都没放 —— 哪怕这个谓词恒返回 false，那条断言也照样全绿，它守不住任何东西。
 *    真正的判据在这里：逐条对齐后端 V13 / V14 / V11 的结论。少了这一节，
 *    把 hitl.bpm_approval 重新加回黑名单（S4a-i 修的正是这个）也不会红。
 */
describe('isHeadlessUnsafe 与后端 V13/V14/V11 同口径', () => {
  const node = (type: string, config: Record<string, any> = {}) => ({ id: 'n', type, config })

  it('hitl.confirm 唤不醒：V13 在无头触发下报 error，且配了自定义 approveVar 也一样', () => {
    expect(isHeadlessUnsafe(node('hitl.confirm'))).toBe(true)
    expect(isHeadlessUnsafe(node('hitl.confirm', { approveVar: 'confirm_result' }))).toBe(true)
  })

  it('hitl.bpm_approval 唤得醒：它就是 V13 给无头流程指的出路，绝不可列进黑名单', () => {
    expect(isHeadlessUnsafe(node('hitl.bpm_approval'))).toBe(false)
    expect(isHeadlessUnsafe(node('hitl.bpm_approval', { bpmProcessDefKey: 'k' }))).toBe(false)
  })

  it('wait(duration) 唤得醒：WorkflowWaitResumeScheduler 到点自动续跑，V14 明确不管这一档', () => {
    expect(isHeadlessUnsafe(node('wait', { waitType: 'duration', duration: 30 }))).toBe(false)
    // 没填 waitType 也不归本谓词管：那是编译器 validateWaitConfig 的活
    expect(isHeadlessUnsafe(node('wait', {}))).toBe(false)
  })

  it('wait(event) 没声明唤醒方 → 唤不醒：平台内零调用方会去发那个事件', () => {
    expect(isHeadlessUnsafe(node('wait', { waitType: 'event', eventKey: 'k' }))).toBe(true)
    // 光写 note 不算声明（V14:1332-1334：等于把问题抄了一遍当答案）
    expect(
      isHeadlessUnsafe(
        node('wait', { waitType: 'event', externalWakeup: { note: '到时候会有人调' } })
      )
    ).toBe(true)
    // 纯空白同样算没声明（wakeupDeclarationOf:1499 用的是 isBlank）
    expect(
      isHeadlessUnsafe(
        node('wait', { waitType: 'event', externalWakeup: { owner: '  ', endpoint: '' } })
      )
    ).toBe(true)
    // externalWakeup 不是对象 = 没声明
    expect(isHeadlessUnsafe(node('wait', { waitType: 'event', externalWakeup: '订单中心' }))).toBe(
      true
    )
  })

  it('wait(event) 声明了 owner 或 endpoint 之一 → 不阻断（后端降到 warning，不是沉默）', () => {
    expect(
      isHeadlessUnsafe(node('wait', { waitType: 'event', externalWakeup: { owner: '订单中心' } }))
    ).toBe(false)
    expect(
      isHeadlessUnsafe(
        node('wait', {
          waitType: 'event',
          externalWakeup: { endpoint: 'POST /agent/workflow/event' }
        })
      )
    ).toBe(false)
  })

  it('waitType 大小写敏感：EVENT 归编译器判「未知 waitType」，本谓词不代劳', () => {
    expect(isHeadlessUnsafe(node('wait', { waitType: 'EVENT' }))).toBe(false)
  })

  it('13 种节点类型逐一表态：只有 hitl.confirm 唤不醒，新增类型必须回来改这条', () => {
    const types = Object.keys(NODE_TYPE_META)
    expect(types, '节点类型应当是 13 种').toHaveLength(13)
    // 空 config 下 wait 不算（waitType 未填归编译器管），故这份清单里只剩 hitl.confirm
    expect(types.filter((t) => isHeadlessUnsafe(node(t)))).toEqual(['hitl.confirm'])
  })
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
      webhook: { type: 'webhook', path: 'p', authType: 'hmac', secret: 's3cr3t' }
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
})
