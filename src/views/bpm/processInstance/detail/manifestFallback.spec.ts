import { describe, expect, it } from 'vitest'
import type { ChangeManifestVO } from '@/api/agent/workflow'
import {
  describeOpaquePayload,
  looksLikeManifest,
  parseFailedManifest,
  readAgentManifest
} from './manifestFallback'

/**
 * `manifestFallback` 单测 —— 缺陷 C10 的强制点
 *
 * ## 🔴 这份测试存在的理由
 * C10 的原形是「`raw` 有值却解析不出来时返回 null ⟹ 页签消失 ⟹ 审批人读到的是
 * 『这条流程不改什么』」。它原先内联在 `index.vue` 的 computed 里，**没有任何测试能碰到它**：
 * 前端单测只收 `src` 下的 `*.spec.ts`，`.vue` 的 setup 体不在其中。
 * 于是那条纪律只写在注释里 —— 与本模块反复撞上的那类缺陷同型：「约束无强制点」。
 *
 * ## 两个方向都要钉
 * 这块兜底有两种坏法，方向相反，**只钉一种等于没钉**：
 * 1. **假阴性**：坏载荷被放行 ⟹ 渲染出一个空壳清单，而空壳会印出
 *    「本次不产生任何写操作」那句安心话（比页签消失更坏：那是撒谎）。
 * 2. **假阳性**：🔴 好清单被判成坏的 ⟹ 一份本来清清楚楚的清单被换成
 *    「读不出来」，审批人被无端吓一次，而且**没人会注意到这个退化** ——
 *    因为界面看起来「还是有页签的」。下面 `真实清单必须原样放行` 那一组专治这个。
 *
 * ## ⚠️ 未覆盖的部分
 * 本测试钉的是纯函数策略，**不**钉渲染。渲染侧的判据我**读源码核过**（不是猜的）：
 * `ChangeManifestCard` 里 `statChips` 的 `push` 是 `if (value) chips.push(…)` ⟹ 全零 ⟹ 一个徽标都不出；
 * 那句安心话的门是 `v-if="!statChips.length && !manifest.degraded"` ⟹ `degraded: true` 时它不出现；
 * `workflowLabel` 是 `if (!w) return ''` ⟹ 不设 `workflow` 就不印流程名。
 * 但「源码这么写」不等于「浏览器里真这么显示」，而且**两处**渲染点都没走过：
 * 详情页的「变更清单」页签，以及 `ProcessInstanceOperationButton` 的「通过」弹层里那张 compact 卡。
 * 实测环境里 `ACT_HI_VARINST` 中 `agent_change_manifest` 的行数为 **0** ——
 * 没有任何现成的 agent 审批实例可看；造一个需要真跑一次 agent 流程（要花模型额度，未获授权），
 * 或往 BPM 历史变量表里塞假数据（裸 SQL 写库，红线禁止）。故这一层**本次未验证**，登记在案。
 */

/** 一份形状完整的真清单：后端 `finish()` 正常算出来的那种 */
const realManifest = (): ChangeManifestVO => ({
  manifestVersion: 1,
  degraded: false,
  workflow: { code: 'wf_demo', name: '演示流程', version: 3 },
  headline: '将新建 1 张数据表、发布 2 个表单',
  riskLevel: 'IRREVERSIBLE',
  riskDescription: '不可逆',
  riskNote: '含不可逆操作：执行后无法自动回滚（MySQL 的 DDL 没有事务）',
  changes: [],
  approvals: [],
  waits: [],
  unresolved: [],
  untrustedInputs: [],
  stats: {
    tables: 1,
    alteredTables: 0,
    registeredTables: 0,
    forms: 2,
    updatedForms: 0,
    menus: 0,
    permissions: 0,
    processes: 0,
    dataWrites: 0,
    dataInterfaces: 0,
    genericTools: 0,
    irreversibleCount: 1,
    writeToolCount: 3,
    readToolCount: 0,
    dryRunRejected: 0,
    dryRunNotProbed: 0
  },
  generatedAt: '2026-10-06 08:00:00'
})

/**
 * 后端 `ChangeManifest.degraded(reason)` 经 `toManifestTree` 往返后的形状
 *
 * ⚠️ 文案是从后端 `ChangeManifest.java` 的 `degraded()` **逐字抄来的**，
 *    而**没有任何测试守着这件事**：跨仓引用（前端单测去读 `../../ruoyi-vue-pro/…`）
 *    在只签出前端仓的环境里必然崩，得不偿失。所以后端改了那段话，这里会静默失真。
 *    失真不影响本文件的判据（③ 那组断的是「原样放行」，靠对象引用相等，不靠文案内容），
 *    但会让这份夹具不再代表真实载荷 —— 改后端降级文案时请顺手看一眼这里。
 *    2026-10-06 我在给它换行以过 prettier 时就真的抄漏过半句，是靠回头 diff 才发现的。
 */
const backendDegraded = (): ChangeManifestVO => ({
  manifestVersion: 1,
  degraded: true,
  workflow: { code: 'wf_demo', name: '演示流程', version: null },
  headline: '变更清单生成失败：本次审批看不到将要发生的变更',
  riskLevel: 'HIGH',
  riskDescription: '风险未知',
  riskNote:
    '平台没能算出「将会做什么」。这不代表本次没有影响——请在看不清影响面的情况下谨慎决定，或让流程负责人修复后重跑。',
  changes: [],
  approvals: [],
  waits: [],
  unresolved: [
    {
      nodeId: null,
      nodeName: '整条流程',
      type: 'MANIFEST_FAILED',
      tool: null,
      reason: '变更清单生成失败：DSL 读不出来'
    }
  ],
  untrustedInputs: [],
  stats: {
    tables: 0,
    alteredTables: 0,
    registeredTables: 0,
    forms: 0,
    updatedForms: 0,
    menus: 0,
    permissions: 0,
    processes: 0,
    dataWrites: 0,
    dataInterfaces: 0,
    genericTools: 0,
    irreversibleCount: 0,
    writeToolCount: 0,
    readToolCount: 0,
    dryRunRejected: 0,
    dryRunNotProbed: 0
  }
})

/** 递归收集对象里所有含中文的字符串，连同路径 —— 与后端 SummarySpacingTest 的 ④ 域同一套做法 */
const chineseIn = (value: unknown, path: string, out: Record<string, string>): void => {
  if (typeof value === 'string') {
    if (new RegExp('[\\u4e00-\\u9fff]').test(value)) out[path] = value
    return
  }
  if (Array.isArray(value)) {
    value.forEach((element, index) => chineseIn(element, `${path}[${index}]`, out))
    return
  }
  if (typeof value === 'object' && value !== null) {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) =>
      chineseIn(child, `${path}.${key}`, out)
    )
  }
}

const chineseOf = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  chineseIn(value, 'manifest', out)
  return out
}

describe('manifestFallback：agent_change_manifest 读不出来时的兜底（C10）', () => {
  // ==================== ① 假阳性：好清单必须原样放行 ====================

  it('🔴 真清单（对象形态）原样放行，绝不被判成降级', () => {
    const raw = realManifest()
    const got = readAgentManifest(raw)
    expect(got).toBe(raw) // 是同一个对象引用，不是副本、更不是降级品
    expect(got?.degraded).toBe(false)
    expect(got?.headline).toBe('将新建 1 张数据表、发布 2 个表单')
  })

  it('🔴 真清单（JSON 串形态）解析后放行 —— BPM 变量序列化可能是字符串', () => {
    const got = readAgentManifest(JSON.stringify(realManifest()))
    expect(got?.degraded).toBe(false)
    expect(got?.headline).toBe('将新建 1 张数据表、发布 2 个表单')
    expect(got?.workflow?.name).toBe('演示流程')
  })

  it('🔴 后端自己造的降级清单必须原样放行，不能被前端再包一层', () => {
    const raw = backendDegraded()
    const got = readAgentManifest(raw)
    expect(got).toBe(raw)
    // 再包一层的后果：reason 会从「DSL 读不出来」（指向真病因）
    // 变成「载荷不合法」（指向序列化），把排查的人引到错的那一侧
    expect(got?.unresolved[0]?.reason).toContain('DSL 读不出来')
    expect(got?.workflow?.name).toBe('演示流程')
  })

  it('🔴 只有「压根没有值」才返回 null —— 那是页签本该不出现的唯一情形', () => {
    expect(readAgentManifest(undefined)).toBeNull()
    expect(readAgentManifest(null)).toBeNull()
    expect(readAgentManifest('')).toBeNull()
  })

  // ==================== ② 假阴性：坏载荷一律降级，绝不沉默 ====================

  /**
   * 三条退化路径 × 各种坏载荷
   *
   * ⚠️ `'{}'` 与 `{}` 这两条是 C10 里最阴的：它们**是**对象、`typeof` 判得过去，
   * 于是原先被当成好清单放行，最终 `ChangeManifestCard` 印出的是那句安心话。
   */
  const brokenPayloads: Array<[string, unknown]> = [
    ['① JSON 解析抛异常（被截断）', '{"headline":"将新建 1 张'],
    ['① JSON 解析抛异常（压根不是 JSON）', 'not-json-at-all'],
    ['② 解析成 null', 'null'],
    ['② 解析成数字', '123'],
    ['② 解析成字符串', '"abc"'],
    ['② 解析成布尔', 'true'],
    ['③ 解析成数组', '[1,2]'],
    ['③ 解析成空对象', '{}'],
    ['③ 解析成对象但没 headline', '{"changes":[],"stats":{}}'],
    ['③ 直接就是个空对象（不是串）', {}],
    ['③ 直接就是个数组（不是串）', [1, 2]],
    ['③ headline 不是字符串', '{"headline":123}']
  ]

  it.each(brokenPayloads)('🔴 坏载荷降级而不沉默：%s', (_label, raw) => {
    const got = readAgentManifest(raw)
    expect(got).not.toBeNull() // 返回 null 就是 C10 原形：页签消失 ⟹ 界面上等于「不改什么」
    expect(got?.degraded).toBe(true) // 前端靠它咽回「本次不产生任何写操作」那句安心话
    expect(got?.headline).toContain('读不出来')
    expect(got?.riskLevel).toBe('HIGH')
    expect(got?.riskDescription).toBe('风险未知')
    expect(got?.unresolved).toHaveLength(1)
    expect(got?.unresolved[0]?.type).toBe('MANIFEST_FAILED')
    expect(got?.unresolved[0]?.nodeName).toBe('整条流程')
  })

  it('🔴 riskLevel 给 HIGH 而不是 IRREVERSIBLE —— 后者是一句此刻不知道真伪的断言', () => {
    expect(parseFailedManifest('x').riskLevel).not.toBe('IRREVERSIBLE')
  })

  it('🔴 降级清单刻意不设 workflow —— 回填空对象会渲染成「未命名流程（草稿）」，那是编造', () => {
    const got = parseFailedManifest('x')
    expect(got.workflow).toBeUndefined()
  })

  it('🔴 16 个计数逐个填 0（不是一个 `as` 糊过去）—— 与后端 ManifestStats 的字段初值同形', () => {
    const stats = parseFailedManifest('x').stats
    const keys = Object.keys(stats)
    expect(keys).toHaveLength(16)
    keys.forEach((key) => {
      expect((stats as unknown as Record<string, number>)[key], `${key} 必须是 0`).toBe(0)
    })
  })

  // ==================== ③ 🔴 隐私：绝不回显载荷内容 ====================

  it('🔴 reason 只报类型与长度，绝不回显载荷内容（载荷可能是被截断的个人信息）', () => {
    // 一份「读不出来」的载荷里可能夹着什么，就用什么当探针
    const payload = '{"note":"客户手机号 13800138000 与身份证号 110101199003074512'
    const got = parseFailedManifest(payload)
    const reason = got.unresolved[0]?.reason ?? ''

    expect(reason).not.toContain('13800138000')
    expect(reason).not.toContain('110101199003074512')
    expect(reason).not.toContain('客户手机号')
    // 但排查的人得能看出形状，否则这条 reason 什么忙都帮不上
    expect(reason).toContain('string')
    expect(reason).toContain(String(payload.length))
    // 整份清单里任何一格都不许出现载荷原文
    const everything = JSON.stringify(got)
    expect(everything).not.toContain('13800138000')
    expect(everything).not.toContain('110101199003074512')
  })

  it('describeOpaquePayload 对非字符串载荷说「长度不可读」，而不是编一个数', () => {
    expect(describeOpaquePayload({})).toContain('object')
    expect(describeOpaquePayload({})).toContain('长度不可读')
    expect(describeOpaquePayload(null)).toContain('null')
    expect(describeOpaquePayload('abc')).toBe('类型 string，长度 3 字符')
  })

  // ==================== ④ 留白规则：与后端同一条横向纪律 ====================

  /**
   * 🔴 这一节只钉「ASCII 两侧留空格、全角前不留」那一条，**刻意不钉「中文之间不许有空格」**
   *
   * 2026-10-06 实测过后者：前端 1264 个含中文字面量里 5 处命中、后端 manifest 包 315 个里 9 处命中，
   * 而**全部是故意的排版** —— Element Plus 的两字按钮惯例（`取 消` / `确 定`）、
   * cron 说明里的 `秒 分 时 日 月 周`、占位符示例 `如 客户跟进流程（副本）`、
   * 以及 9 条 `ChangeManifestDryRunner` 的日志标签（`干跑自身出错 节点({})`，本就不进界面）。
   * 把它加成断言只会逼人开例外，例外一开这条断言就恒绿了 —— 与后端 SummarySpacingTest
   * 里记的那条「恒绿负控比没有负控更坏」是同一件事。
   *
   * 所以「两个中文词之间多一格」这一类，靠的是上面 ③ 里那句
   * `toBe('类型 string，长度 3 字符')` / `toContain('长度不可读')` —— **逐字钉住本模块自己的文案**。
   * 它确实抓到过一次：`describeOpaquePayload` 原先写成 `长度 ${size}`，
   * 非字符串分支填 `不可读`，产出「长度 不可读」。扫描规则看不见它，逐字断言看得见。
   */
  it('🔴 降级清单里每一段中文都不带「空格+全角括号」的模板洞', () => {
    const strings = chineseOf(parseFailedManifest('探针载荷'))
    // 反向自检：先证明这一域真的扫到了中文，否则「一个洞都没有」等于「一个字都没看」
    expect(Object.keys(strings).length).toBeGreaterThanOrEqual(5)

    const holes = Object.entries(strings)
      .filter(([, text]) => text.includes(' （') || text.includes(' 「'))
      .map(([path, text]) => `${path} →「${text}」`)
    expect(
      holes,
      '规则：ASCII 两侧留空格，全角「」（）前不留。洞通常在两段字符串的接缝上，' +
        '单个字面量里看不出来（后端同型缺陷见 SummarySpacingTest）'
    ).toEqual([])
  })

  it('looksLikeManifest 的判据是 headline 一个键，别的字段缺了不影响', () => {
    expect(looksLikeManifest({ headline: '将新建 1 张数据表' })).toBe(true)
    expect(looksLikeManifest({ headline: '' })).toBe(true) // 空串也是字符串：字段不全 ≠ 不是清单
    expect(looksLikeManifest({ headline: 1 })).toBe(false)
    expect(looksLikeManifest({})).toBe(false)
    expect(looksLikeManifest(null)).toBe(false)
    expect(looksLikeManifest([])).toBe(false)
    expect(looksLikeManifest('将新建 1 张数据表')).toBe(false)
  })
})
