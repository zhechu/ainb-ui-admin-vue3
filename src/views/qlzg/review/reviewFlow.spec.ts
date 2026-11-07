import { describe, expect, it } from 'vitest'
import type { QlzgReviewRunVO, QlzgReviewVO } from '@/api/qlzg/reviewRun'
import type { QlzgReviewWaiverChainVO, QlzgReviewWaiverVO } from '@/api/qlzg/reviewConfig'
import type { QlzgReviewRuleVO } from '@/api/qlzg/reviewRule'
import {
  REVIEW_INHERIT,
  REVIEW_REASON_MAX_LENGTH,
  REVIEW_REASON_MIN_LENGTH,
  RULE_SEVERITY_ORDER
} from '@/views/qlzg/constants'
import {
  advisoryReleasedCountOf,
  blocksFinalizeNow,
  currentEffectiveWaiverOf,
  effectiveOffWaiverOf,
  hitDetailText,
  modeTraceStateOf,
  reportReviewBannerOf,
  reportReviewBarOf,
  resolvedTargetModeOf,
  reviewEntryVisible,
  reviewEntryVisibleByMode,
  reviewInheritAvailable,
  reviewModeUnchanged,
  reviewReasonBlocksSubmit,
  reviewReasonProblem,
  ruleCodeEditable,
  ruleRowReadOnly,
  ruleSetVersionChanged,
  runRowMarkOf,
  runRowRevocable,
  runRowSummaryOf,
  runRowWaivable,
  severityWithinCeiling,
  statutoryAckRequired,
  unwaivedBlockCountOf,
  unwaivedBlockTextOf,
  waiverBrokenOf,
  waiverRowStateOf,
  waiverRowTagType
} from './reviewFlow'

/**
 * 复核域界面判定的守卫。
 *
 * 🔴 这一批判定**错了不报错**：全部是「界面显示哪一种状态」的分岔，
 *    HTTP 200、类型检查通过、后端一声不响。所以它们必须是纯函数、必须被测。
 *    最贵的那一条是 {@link reportReviewBannerOf}：判据写歪的产物是
 *    「一份从来没被复核过的报告上挂着一条『0 条问题』的黄条」，
 *    用户读成「查过了，没问题」—— 而 §11.9.2.6 第 3 条要防的正是「关了就看不见」，
 *    这一条坏法是它的镜像：「没查过却看起来查过了」。
 */

const review = (overrides: Partial<QlzgReviewVO> = {}): QlzgReviewVO =>
  ({ id: 1, reportId: 4096, runStatus: 'OK', blockCountUnwaived: 0, ...overrides }) as QlzgReviewVO

const waiver = (overrides: Partial<QlzgReviewWaiverVO> = {}): QlzgReviewWaiverVO =>
  ({ id: 1, waiveScope: 'ORG', toMode: 'OFF', ...overrides }) as QlzgReviewWaiverVO

const rule = (overrides: Partial<QlzgReviewRuleVO> = {}): QlzgReviewRuleVO =>
  ({
    id: 1,
    ruleCode: 'ORG-01',
    ruleName: '机构自建',
    platform: false,
    ...overrides
  }) as QlzgReviewRuleVO

describe('reportReviewBannerOf —— 报告页那条常驻横条', () => {
  /**
   * 🔴 后端刻意返回 **null**（不是空对象、也不是 0 条）表示「这份报告从来没被复核过」。
   *    此时**两条都不显示**：一条写着「0 条问题」的黄条会被读成「查过了，没问题」，
   *    而真相是一行都没查
   */
  it('🔴 latest 为 null / undefined ⇒ NONE（两条都不显示）', () => {
    expect(reportReviewBannerOf(null)).toBe('NONE')
    expect(reportReviewBannerOf(undefined)).toBe('NONE')
  })

  /**
   * 🔴 OFF 档下闸 C **照样**落一行 SKIPPED 运行头，所以 latest 是**非空**的。
   *    灰条的判据是运行状态，不是 `latest == null` —— 写反的表现是
   *    OFF 档报告页上什么都不显示，而那正是 §11.9.2.6 第 4 条禁止的
   *    （「三个月后没人记得这台机构关过什么」）
   */
  it('🔴 runStatus = SKIPPED ⇒ GREY，即使 latest 非空', () => {
    expect(reportReviewBannerOf(review({ runStatus: 'SKIPPED', totalRules: 0 }))).toBe('GREY')
  })

  it('🔴 SKIPPED 排在 blockCountUnwaived 之前：一行都没跑比 0 条问题更强', () => {
    // 正常形状下 SKIPPED 的 blockCountUnwaived 恒为 0（totalRules = 0），
    // 所以这条只在「运行头被写坏了」时才分岔 —— 而那时该显示的是灰条，
    // 因为「不知道跑了没有」比「有 3 条没清零」更是这份数据的实情
    expect(reportReviewBannerOf(review({ runStatus: 'SKIPPED', blockCountUnwaived: 3 }))).toBe(
      'GREY'
    )
  })

  /**
   * 🔴 这一条钉住 2026-11-03 补上的第四态：一次 FAILED 的运行**必须**有自己的横条。
   *    求值失败的那几条规则既不算通过也不算命中，所以 `blockCountUnwaived` 是 0 ——
   *    在补它之前这种运行落到 NONE，报告页上「复核没跑完」与「跑完了、也清零了」
   *    长得一模一样，定稿弹层那一格还写着「0 条」。
   *    它会真实发生：当天那次「全系统一份报告也定不了稿」
   *    （装载器少供 2 个按 expr_params 现算的事实）就是 48 条规则全部求值失败，
   *    而报告页上一条横条都没有
   */
  it('🔴 runStatus = FAILED ⇒ INCOMPLETE，不是 NONE', () => {
    expect(reportReviewBannerOf(review({ runStatus: 'FAILED', blockCountUnwaived: 0 }))).toBe(
      'INCOMPLETE'
    )
  })

  /**
   * 🔴 FAILED 排在 blockCountUnwaived **之前**，与后端闸 C 同序：
   *    {@code QlzgReviewGateServiceImpl} 先抛 {@code REVIEW_RUN_FAILED}、
   *    后抛 {@code GATE_C_BLOCKED}。横条若反过来先报 BLOCK 条数，
   *    报出来的是**按跑成的那几条数出来的**一个偏小的数，
   *    而它旁边没有任何一个字说「这个数不完整」
   */
  it('🔴 FAILED 且 blockCountUnwaived > 0 ⇒ INCOMPLETE（不显示黄条）', () => {
    expect(reportReviewBannerOf(review({ runStatus: 'FAILED', blockCountUnwaived: 3 }))).toBe(
      'INCOMPLETE'
    )
  })

  /**
   * 🔴 判据是「不是 OK」而不是「等于 FAILED」，于是**认不出的码也算没跑完**，
   *    与 `constants.ts#reviewRunStatusTagType` 对坏值给黄同一个口径。
   *    反过来的写法会让一个坏码落到 NONE —— 又一次把「不知道」显示成「没问题」
   */
  it('🔴 认不出的 runStatus ⇒ INCOMPLETE（坏码不算「跑完了」）', () => {
    for (const runStatus of ['WHATEVER', '', undefined, null]) {
      expect(reportReviewBannerOf(review({ runStatus: runStatus as never }))).toBe('INCOMPLETE')
    }
  })

  it('🔴 blockCountUnwaived > 0 ⇒ YELLOW，且**不看档位**', () => {
    // ADVISORY 下它是「签字人将对此承担责任」，ENFORCE 下它是「清零之前定不了稿」。
    // 同一句话在两个档位下都成立，差别由旁边的档位标去说，不由横条去说
    for (const gateCMode of ['ENFORCE', 'ADVISORY']) {
      expect(
        reportReviewBannerOf(review({ runStatus: 'OK', blockCountUnwaived: 3, gateCMode }))
      ).toBe('YELLOW')
    }
  })

  it('blockCountUnwaived = 0 / 缺值 ⇒ NONE', () => {
    expect(reportReviewBannerOf(review({ blockCountUnwaived: 0 }))).toBe('NONE')
    expect(reportReviewBannerOf(review({ blockCountUnwaived: undefined }))).toBe('NONE')
  })

  /**
   * 🔴 这一条钉住「不要读 passed」：ADVISORY 档下报告带着 `passed = 0`
   *    一路走到 FINALIZED 是**常态**（测试 #29③ 钉的就是这件事）。
   *    拿 passed 当判据会让每一份 ADVISORY 报告都挂着黄条，
   *    而黄条上那个整数是 0 —— 一条自相矛盾的横条
   */
  it('🔴 passed = 0 而 blockCountUnwaived = 0 ⇒ NONE（不读 passed）', () => {
    expect(reportReviewBannerOf(review({ passed: 0, blockCountUnwaived: 0 }))).toBe('NONE')
  })

  /**
   * 🔴 也不要读 blockCount：它是**历史事实**（那一次运行命中了几条 BLOCK），
   *    豁免只改明细行、不改运行头，于是它永远不减。
   *    技术负责人豁免完 12 条、黄条上仍写着 12 —— 那就是这一列的坏法
   */
  it('🔴 blockCount = 12 而 blockCountUnwaived = 0 ⇒ NONE（不读 blockCount）', () => {
    expect(reportReviewBannerOf(review({ blockCount: 12, blockCountUnwaived: 0 }))).toBe('NONE')
  })

  it('unwaivedBlockCountOf 与横条判据读**同一列**', () => {
    expect(unwaivedBlockCountOf(review({ blockCountUnwaived: 3 }))).toBe(3)
    expect(unwaivedBlockCountOf(null)).toBe(0)
    expect(unwaivedBlockCountOf(review({ blockCountUnwaived: undefined }))).toBe(0)
    // 横条说 YELLOW 的那一份，整数必须 > 0；反过来也一样
    const yellow = review({ blockCountUnwaived: 3 })
    expect(reportReviewBannerOf(yellow)).toBe('YELLOW')
    expect(unwaivedBlockCountOf(yellow)).toBeGreaterThan(0)
  })
})

describe('unwaivedBlockTextOf —— 「未清零 BLOCK」那一格写什么', () => {
  /**
   * 🔴 只有 OK 才写数字。另外两态写数字的话，用户读到的是「查过了，没问题」，
   *    而真相分别是「一行都没查」（SKIPPED）与「查了一半、结论未知」（FAILED）——
   *    与 {@link reportReviewBannerOf} 要防的是同一件事（§11.9.2.6 第 3 条）
   */
  it('🔴 只有 runStatus = OK 才写「N 条」', () => {
    expect(unwaivedBlockTextOf(review({ runStatus: 'OK', blockCountUnwaived: 3 }))).toBe('3 条')
    expect(unwaivedBlockTextOf(review({ runStatus: 'OK', blockCountUnwaived: 0 }))).toBe('0 条')
    expect(unwaivedBlockTextOf(review({ runStatus: 'SKIPPED' }))).not.toContain('条')
    expect(unwaivedBlockTextOf(review({ runStatus: 'FAILED' }))).not.toContain('条')
    expect(unwaivedBlockTextOf(review({ runStatus: 'WHATEVER' as never }))).not.toContain('条')
  })

  it('🔴 null ⇒ 「还没被复核过」，与横条的 NONE 同一个含义', () => {
    expect(unwaivedBlockTextOf(null)).toBe('还没被复核过')
    expect(unwaivedBlockTextOf(undefined)).toBe('还没被复核过')
    expect(reportReviewBannerOf(null)).toBe('NONE')
  })

  it('🔴 FAILED ⇒ 写出「结论未知」，不写「没问题」那一类话', () => {
    const text = unwaivedBlockTextOf(review({ runStatus: 'FAILED', blockCountUnwaived: 0 }))
    expect(text).toContain('结论未知')
    expect(text).not.toContain('没问题')
  })

  it('🔴 写数字的那一态与横条判据**同源**：说「0 条」的那一份横条必然是 NONE', () => {
    const clean = review({ runStatus: 'OK', blockCountUnwaived: 0 })
    expect(unwaivedBlockTextOf(clean)).toBe('0 条')
    expect(reportReviewBannerOf(clean)).toBe('NONE')
    const yellow = review({ runStatus: 'OK', blockCountUnwaived: 3 })
    expect(unwaivedBlockTextOf(yellow)).toBe('3 条')
    expect(reportReviewBannerOf(yellow)).toBe('YELLOW')
  })
})

describe('reviewEntryVisible —— 复核工作台的入口', () => {
  /**
   * 🔴 OFF 档下是**隐藏**，不是置灰（§11.9.2.6 第 8 条）：
   *    OFF 的语义是「这个功能不在」，一个点进去永远空白的页面比没有入口更贵
   */
  it('workbenchVisible = false ⇒ 隐藏', () => {
    expect(reviewEntryVisible({ reportId: 1, workbenchVisible: false } as never)).toBe(false)
  })

  it('workbenchVisible = true ⇒ 出现', () => {
    expect(reviewEntryVisible({ reportId: 1, workbenchVisible: true } as never)).toBe(true)
  })

  /**
   * 🔴 数据**还没回来**时也算 false。反过来写（`!== false`）的表现是：
   *    打开报告页 → 入口先出现 → 请求回来 → 入口消失，
   *    而一个「出现过又消失」的按钮是会被点到的，点到的那一次落到一个空白页
   */
  it('🔴 严格等于 true：缺值 / null / undefined 一律 false', () => {
    expect(reviewEntryVisible(undefined)).toBe(false)
    expect(reviewEntryVisible(null)).toBe(false)
    expect(reviewEntryVisible({ reportId: 1 } as never)).toBe(false)
  })
})

describe('reviewReasonProblem —— 变更理由', () => {
  it('🔴 两个字数常量与后端 QlzgReviewWaiverDO 同值', () => {
    // 10 是 §11.9.2.7 第 5 条写死的规格，500 是 qlzg_review_waiver.reason 的列宽。
    // 两者都**不随机构变**，所以抄一份是安全的（与 resultFlow 那条纪律不冲突，
    // 理由写在 reviewFlow.ts 的类注释里）。改这里之前先改后端那个常量
    expect(REVIEW_REASON_MIN_LENGTH).toBe(10)
    expect(REVIEW_REASON_MAX_LENGTH).toBe(500)
  })

  it('空 / 全空白 ⇒ 一句话提到「口头或线下审批不能代替」', () => {
    // §11.9.2.7 第 5 条明确不接受口头 / 线下审批代替 reason。
    // 只写「请填写理由」的话，赶稿的人会认为「我已经口头请示过了」就算填了
    for (const reason of [undefined, null, '', '   ', '\n\t ']) {
      const problem = reviewReasonProblem(reason)
      expect(problem).not.toBeNull()
      expect(problem).toContain('口头')
    }
  })

  it('🔴 下限数**去空白后**的字数：9 个字加一堆空格仍然不够', () => {
    expect(reviewReasonProblem('  123456789  ')).toContain('至少 10 个字')
    expect(reviewReasonProblem('123456789')).toContain('现在 9 个')
  })

  it('10 个字刚好够', () => {
    expect(reviewReasonProblem('1234567890')).toBeNull()
    expect(reviewReasonProblem('  1234567890  ')).toBeNull()
  })

  /**
   * 🔴 上限量**原始**字数，不是 trim 后的 —— 这个不对称是照抄后端的：
   *    500 那一道是 VO 上的 `@Size(max = 500)`，Bean Validation **不 trim**。
   *    把两道都改成量 trim 后的字数的话，「501 个字符里带一个空格」会被前端放行、
   *    被 @Size 拒掉，而那句「不能超过 500 个字符」与用户眼前的字数对不上。
   *    别把这个不对称「修」成对称的
   */
  it('🔴 上限量原始字数：501 个字符里带空格仍然超', () => {
    const raw = `${'a'.repeat(500)} `
    expect(raw.trim().length).toBe(500)
    expect(reviewReasonProblem(raw)).toContain('不能超过 500 个字符')
    expect(reviewReasonProblem('a'.repeat(500))).toBeNull()
  })

  it('报错句里带上**当前**字数，让人不必自己数', () => {
    expect(reviewReasonProblem('abc')).toContain('现在 3 个')
    expect(reviewReasonProblem('a'.repeat(600))).toContain('现在 600 个')
  })
})

describe('statutoryAckRequired —— 法定评估的红色警示区', () => {
  /**
   * 🔴 与后端 QlzgReviewWaiverRecord#requiresAck() 逐字同判据：
   *    「法定评估业务」**且**「变更后不再强制」两条同时成立。
   *    后半条不可省：OFF → ENFORCE 是一次**恢复**，它没有放弃任何控制，
   *    要求勾选一份写着「关闭机器复核不改变贵机构义务」的告知是一句自相矛盾的话 ——
   *    而用户会照着勾，于是档案里留下一行「他确认了关闭告知」的 ack_text，
   *    配的却是 to_mode = 'ENFORCE'。30 年后念这一行的人会读出相反的意思
   */
  it('🔴 法定 + 目标不是 ENFORCE ⇒ 必须勾选', () => {
    expect(statutoryAckRequired(true, 'ADVISORY')).toBe(true)
    expect(statutoryAckRequired(true, 'OFF')).toBe(true)
  })

  it('🔴 法定 + 目标是 ENFORCE ⇒ 不必勾（那是一次恢复）', () => {
    expect(statutoryAckRequired(true, 'ENFORCE')).toBe(false)
  })

  it('非法定业务一律不必勾（§11.9.2.1 的字面规定）', () => {
    expect(statutoryAckRequired(false, 'OFF')).toBe(false)
    expect(statutoryAckRequired(false, 'ADVISORY')).toBe(false)
    expect(statutoryAckRequired(undefined, 'OFF')).toBe(false)
    expect(statutoryAckRequired(null, 'OFF')).toBe(false)
  })

  /**
   * 🔴 选了「跟随机构配置」（INHERIT）而**不知道**解析结果时，保守要求勾选。
   *    这一支可证明无害：后端只在 requiresAck() 为真时才把告知文案快照进 ack_text，
   *    所以多送一个 true 不会在档案里凭空多出一行「他确认了关闭告知」——
   *    而 `ack_text 非空 ⟺ 法定业务的知情降级` 这个等价关系是可检索的判据，不能被破坏
   */
  it('🔴 解析结果未知（undefined / null）⇒ 保守要求勾选', () => {
    expect(statutoryAckRequired(true, undefined)).toBe(true)
    expect(statutoryAckRequired(true, null)).toBe(true)
  })

  it('🔴 返回 false 的含义是「不必勾」，**不是**「不许改」', () => {
    // V4 那个实体性拒绝（REVIEW_MODE_LOCKED_STATUTORY）在 V5 已整条撤回：
    // 法定评估业务的入口不置灰，改成红色警示区 + 勾选（§11.9.2.6 第 6 条）。
    // 置灰会被理解成「功能坏了」，勾选确认才是「你决定、你担责」
    expect(statutoryAckRequired(true, 'ENFORCE')).toBe(false)
    expect(statutoryAckRequired(false, 'OFF')).toBe(false)
  })
})

describe('waiverRowStateOf —— 变更留痕的三种行', () => {
  it('🔴 rejected = true ⇒ REJECTED，且排在最前', () => {
    // 一行被程序性拒绝的尝试**没有**生效过，也就谈不上被撤销，两件事不能同时成立
    expect(waiverRowStateOf(waiver({ rejected: true }))).toBe('REJECTED')
    expect(
      waiverRowStateOf(waiver({ rejected: true, effectiveTo: new Date(), revokedBy: 7 }))
    ).toBe('REJECTED')
  })

  /**
   * 🔴 判据是 effectiveTo 有没有值，不是 revokedAt：
   *    两者由 revoke() 在同一条 UPDATE 里写、通常同值，
   *    但 effectiveTo 为 NULL 在 DDL 里的原话是**长期有效**
   *    （后端 stillEffective() 因此写成 `effectiveTo == null || !now.isAfter(effectiveTo)`）
   */
  it('🔴 effectiveTo 有值 ⇒ REVOKED；为 null ⇒ 长期有效 = EFFECTIVE', () => {
    expect(waiverRowStateOf(waiver({ effectiveTo: new Date() }))).toBe('REVOKED')
    expect(waiverRowStateOf(waiver({ effectiveTo: null }))).toBe('EFFECTIVE')
    expect(waiverRowStateOf(waiver({ effectiveTo: undefined }))).toBe('EFFECTIVE')
  })

  it('🔴 撤销之后 revokedBy / waiveReason **保留**，所以 REVOKED 行仍有责任人可显示', () => {
    const revoked = waiver({ effectiveTo: new Date(), revokedBy: 7, revokedByNickname: '张三' })
    expect(waiverRowStateOf(revoked)).toBe('REVOKED')
    // 清空那两列等于销毁一段留痕，而撤销豁免恰恰是最该留下痕迹的动作之一
    expect(revoked.revokedByNickname).toBe('张三')
  })

  it('null 行按 REJECTED 处理（那是「不知道这一行是什么」，不是「生效中」）', () => {
    expect(waiverRowStateOf(null)).toBe('REJECTED')
    expect(waiverRowStateOf(undefined)).toBe('REJECTED')
  })

  it('🔴 生效中是红的：一次**正在生效**的控制放松最该跳出来', () => {
    expect(waiverRowTagType('EFFECTIVE')).toBe('danger')
    expect(waiverRowTagType('REVOKED')).toBe('info')
    // 被程序性拒绝：没生效，但「有人在赶稿时想关掉复核」这件事值得看见，
    // 所以它既不是灰的（会被当成历史）、也不是红的（它没生效）
    expect(waiverRowTagType('REJECTED')).toBe('warning')
  })
})

describe('ruleRowReadOnly / ruleCodeEditable —— 规则配置页', () => {
  it('🔴 platform = true ⇒ 整行只读', () => {
    expect(ruleRowReadOnly(rule({ platform: true }))).toBe(true)
  })

  it('platform = false ⇒ 可改', () => {
    expect(ruleRowReadOnly(rule({ platform: false }))).toBe(false)
  })

  /**
   * 🔴 platform **缺值**时按只读处理：那是「不知道这行能不能改」，
   *    而猜错的方向里「让一条平台行被改掉」远比「多灰一行」贵
   */
  it('🔴 platform 缺值 ⇒ 只读（保守）', () => {
    expect(ruleRowReadOnly(rule({ platform: undefined }))).toBe(true)
    expect(ruleRowReadOnly({ id: 1, ruleCode: 'X' } as QlzgReviewRuleVO)).toBe(true)
  })

  /**
   * 🔴 但 `rule` 本身为 null 时**不是**只读：那是新建表单，压根没有既存行需要保护。
   *    这一支若也按只读处理，新建规则表单会整屏灰掉 ——
   *    看起来像功能坏了，而 §11.9.2.6 第 6 条那条纪律说的正是这种误解
   */
  it('🔴 没有既存行（新建表单）⇒ 不只读', () => {
    expect(ruleRowReadOnly(null)).toBe(false)
    expect(ruleRowReadOnly(undefined)).toBe(false)
  })

  it('🔴 ruleCode：新建可编辑，修改灰掉（不是隐藏）', () => {
    expect(ruleCodeEditable(null)).toBe(true)
    expect(ruleCodeEditable(undefined)).toBe(true)
    expect(ruleCodeEditable({ ruleCode: 'ORG-01' } as QlzgReviewRuleVO)).toBe(true)
    expect(ruleCodeEditable(rule({ id: 1 }))).toBe(false)
  })

  it('🔴 两份判据刻意分开：平台行是「整行只读」，自建行的修改表单是「能改但码不能改」', () => {
    // 合成一个函数的话，「灰掉码」与「整行只读」在界面上就成了同一种表现，
    // 而它们的出路完全不同：前者是「新建一条同码的」，后者是「抄它的 expr 去新建」
    const platform = rule({ id: 9, platform: true })
    expect(ruleRowReadOnly(platform)).toBe(true)
    expect(ruleCodeEditable(platform)).toBe(false)
    const own = rule({ id: 9, platform: false })
    expect(ruleRowReadOnly(own)).toBe(false)
    expect(ruleCodeEditable(own)).toBe(false)
    const draft = rule({ id: undefined, platform: false })
    expect(ruleRowReadOnly(draft)).toBe(false)
    expect(ruleCodeEditable(draft)).toBe(true)
  })
})

describe('severityWithinCeiling —— 灰掉非法档位', () => {
  it('🔴 RULE_SEVERITY_ORDER 是升序，与后端 priority（INFO 1 / WARN 2 / BLOCK 3）同序', () => {
    expect(RULE_SEVERITY_ORDER).toEqual(['INFO', 'WARN', 'BLOCK'])
  })

  it('天花板 BLOCK ⇒ 三档都能选（机构自建规则的法域一律 ORG_INTERNAL，天花板就是 BLOCK）', () => {
    for (const severity of ['INFO', 'WARN', 'BLOCK']) {
      expect(severityWithinCeiling(severity, 'BLOCK')).toBe(true)
    }
  })

  /**
   * 🔴 「专家指引」的天花板是 WARN：建议性文件不能产生强制性拦截（优先级 5 永不升级），
   *    后端那个码是 REVIEW_RULE_SEVERITY_NOT_ALLOWED。
   *    一个能选中、点了保存才被拒的下拉，产出的是「为什么选不了」这个疑问 ——
   *    灰掉并把天花板印在旁边，才是把答案放在决策点上（与 §11.9.2.6 第 2 条同一条纪律）
   */
  it('🔴 天花板 WARN ⇒ BLOCK 不合法', () => {
    expect(severityWithinCeiling('BLOCK', 'WARN')).toBe(false)
    expect(severityWithinCeiling('WARN', 'WARN')).toBe(true)
    expect(severityWithinCeiling('INFO', 'WARN')).toBe(true)
  })

  it('天花板 INFO ⇒ 只有 INFO 合法', () => {
    expect(severityWithinCeiling('INFO', 'INFO')).toBe(true)
    expect(severityWithinCeiling('WARN', 'INFO')).toBe(false)
    expect(severityWithinCeiling('BLOCK', 'INFO')).toBe(false)
  })

  /**
   * 🔴 认不出的码一律 false，**不**回落到 true：
   *    RULE_SEVERITY_ORDER 里 indexOf 返回 −1，而 −1 比任何下标都小，
   *    于是「一个坏码 ≤ BLOCK」恒成立 —— 那就是「拨得动、存不下、也不报错」。
   *    后端 QlzgRuleSeverityEnum#ofStrict 对认不出的取值返回 null，本函数与它同向
   *    （I5-f 修的正是这个：回落成 BLOCK 的坏行能被当成合法 BLOCK 豁免掉）
   */
  it('🔴 认不出的严重度 ⇒ false（不回落到 true）', () => {
    expect(severityWithinCeiling('WHATEVER', 'BLOCK')).toBe(false)
    expect(severityWithinCeiling('', 'BLOCK')).toBe(false)
    expect(severityWithinCeiling(undefined, 'BLOCK')).toBe(false)
    expect(severityWithinCeiling('block', 'BLOCK')).toBe(false) // 大小写不归一：归一等于替调用方猜
  })

  it('🔴 认不出的天花板 ⇒ false，也不回落', () => {
    expect(severityWithinCeiling('BLOCK', 'WHATEVER')).toBe(false)
    expect(severityWithinCeiling('INFO', 'WHATEVER')).toBe(false)
  })

  /**
   * ⚠️ 天花板**缺值**时按 BLOCK 处理 —— 与「认不出」不同向，这是刻意的：
   *    机构自建规则的天花板恒为 BLOCK，缺值就是「后端没下发这一列」，
   *    回落到「什么都不许选」会把一个正常的新建表单变成三档全灰
   */
  it('⚠️ 天花板缺值 ⇒ 按 BLOCK（三档都能选）', () => {
    expect(severityWithinCeiling('BLOCK', undefined)).toBe(true)
    expect(severityWithinCeiling('BLOCK', null)).toBe(true)
    expect(severityWithinCeiling('BLOCK', '')).toBe(true)
  })
})

describe('ruleSetVersionChanged —— 版本红点', () => {
  it('两个指纹都在且不等 ⇒ true', () => {
    expect(ruleSetVersionChanged('a'.repeat(32), 'b'.repeat(32))).toBe(true)
  })

  it('相等 ⇒ false', () => {
    expect(ruleSetVersionChanged('a'.repeat(32), 'a'.repeat(32))).toBe(false)
  })

  /**
   * 🔴 任一侧为空 ⇒ false，不是 true：「不知道」与「变了」是两件事。
   *    一份还没跑过复核的报告（ruleSetVersion 为 null）没有「按另一批规则判的」这个含义，
   *    在每一份新报告上都亮一个红点，红点就在三天内失去全部意义，
   *    而那时真正变了的那一次也没人会看
   */
  it('🔴 任一侧空 / 缺值 ⇒ false', () => {
    expect(ruleSetVersionChanged(null, 'b'.repeat(32))).toBe(false)
    expect(ruleSetVersionChanged(undefined, 'b'.repeat(32))).toBe(false)
    expect(ruleSetVersionChanged('', 'b'.repeat(32))).toBe(false)
    expect(ruleSetVersionChanged('a'.repeat(32), null)).toBe(false)
    expect(ruleSetVersionChanged('a'.repeat(32), '')).toBe(false)
    expect(ruleSetVersionChanged(undefined, undefined)).toBe(false)
  })
})

describe('blocksFinalizeNow —— 一律读后端算好的那一列', () => {
  /**
   * 🔴 前端**不要**自己按 `severity === 'BLOCK' && hit && !waived` 拼一个：
   *    拼出来的那一份在「一行 BLOCK 是坏的」（waived = 1 而 waiveReason 为空 ⇒
   *    waivedProperly = false，闸 C 不认这次豁免）时会与后端差 1，而两处都不报错 ——
   *    表现是「黄条说 3 条、清单里数出 2 条」，用户无从判断哪一边错了
   */
  it('只认后端那一列', () => {
    expect(blocksFinalizeNow({ blocksFinalizeNow: true })).toBe(true)
    expect(blocksFinalizeNow({ blocksFinalizeNow: false })).toBe(false)
    expect(blocksFinalizeNow({ blocksFinalizeNow: undefined })).toBe(false)
    expect(blocksFinalizeNow(null)).toBe(false)
    expect(blocksFinalizeNow(undefined)).toBe(false)
    // 一行「坏豁免」：waived = 1 而理由是空的 ⇒ 闸 C 不认，后端那一列仍是 true
    expect(
      blocksFinalizeNow({
        blocksFinalizeNow: true,
        severity: 'BLOCK',
        hit: true,
        waived: true,
        waivedProperly: false
      } as never)
    ).toBe(true)
  })
})

describe('runRowMarkOf —— 明细行的图标记号', () => {
  /**
   * 🔴 errored = true ⇒ 灰色问号，不是绿勾也不是红叉：
   *    那一条规则压根没求出结果，我们不知道它过没过。
   *    渲染成绿勾是「假装查过了」，渲染成红叉是「假装查出了问题」，
   *    两者都在一份要保存 30 年的档案上写了一句假话
   */
  it('🔴 errored 优先于 hit：一条 errored 且 hit 的行仍是 UNKNOWN', () => {
    expect(runRowMarkOf({ errored: true, hit: true })).toBe('UNKNOWN')
    expect(runRowMarkOf({ errored: true, hit: false })).toBe('UNKNOWN')
    expect(runRowMarkOf({ errored: true })).toBe('UNKNOWN')
  })

  it('没出错时按 hit 分绿勾 / 红叉', () => {
    expect(runRowMarkOf({ errored: false, hit: true })).toBe('HIT')
    expect(runRowMarkOf({ hit: true })).toBe('HIT')
    expect(runRowMarkOf({ errored: false, hit: false })).toBe('PASS')
  })

  /**
   * 🔴 runs 是**每条规则一行**，不只是命中的那些 ——
   *    「48 条里有 45 条没命中」与「只查了 3 条」是两件不同的事，
   *    所以 PASS 要如实显示，不要折叠掉
   */
  it('🔴 hit 缺值按 PASS（未命中），不按 UNKNOWN', () => {
    // errored 缺值 + hit 缺值 = 一条正常求值、结果为「未命中」的行
    expect(runRowMarkOf({})).toBe('PASS')
  })

  it('没有这一行时才是 UNKNOWN', () => {
    expect(runRowMarkOf(null)).toBe('UNKNOWN')
    expect(runRowMarkOf(undefined)).toBe('UNKNOWN')
  })
})

describe('runRowWaivable / runRowRevocable —— 逐条豁免', () => {
  it('🔴 命中 + BLOCK + 尚未豁免，三者缺一不可', () => {
    expect(runRowWaivable({ hit: true, severity: 'BLOCK', waived: false })).toBe(true)
    // 未命中的行在工作台上是一条绿勾，它上面**没有**豁免按钮（不是置灰的按钮）
    expect(runRowWaivable({ hit: false, severity: 'BLOCK', waived: false })).toBe(false)
    // WARN / INFO 本来就不拦定稿，给它们写一个 waived = 1 等于在档案里记一件没发生的事
    expect(runRowWaivable({ hit: true, severity: 'WARN', waived: false })).toBe(false)
    expect(runRowWaivable({ hit: true, severity: 'INFO', waived: false })).toBe(false)
    expect(runRowWaivable({ hit: true, severity: 'BLOCK', waived: true })).toBe(false)
  })

  it('缺值一律不可豁免（保守）', () => {
    expect(runRowWaivable(null)).toBe(false)
    expect(runRowWaivable(undefined)).toBe(false)
    expect(runRowWaivable({})).toBe(false)
    expect(runRowWaivable({ severity: 'BLOCK' })).toBe(false)
  })

  /**
   * 🔴 判据是 waived === true，**不是** waivedProperly：
   *    一行 waived = 1 而理由是空的**坏行**按后者判「不算豁免」，
   *    于是它在界面上显示成已豁免、闸 C 却不认，
   *    而**撤销正是修好它的唯一手段**（后端的判据同样是 waived = 1）
   */
  it('🔴 坏行（waived = true 而 waivedProperly = false）**可撤销**、不可再豁免', () => {
    const broken = { waived: true, waivedProperly: false, hit: true, severity: 'BLOCK' }
    expect(runRowRevocable(broken)).toBe(true)
    expect(runRowWaivable(broken)).toBe(false)
  })

  it('🔴 可撤销的判据只看 waived', () => {
    expect(runRowRevocable({ waived: true })).toBe(true)
    expect(runRowRevocable({ waived: false })).toBe(false)
    expect(runRowRevocable({ waived: undefined })).toBe(false)
    expect(runRowRevocable(null)).toBe(false)
    expect(runRowRevocable(undefined)).toBe(false)
  })
})

describe('reviewReasonBlocksSubmit —— 哪一类不合格该禁用提交按钮', () => {
  /**
   * 🔴🔴 这一条守的是一整类**静默抹除**：后端刻意把「少于 10 字」放在 Service 里判，
   *    为的是让它先写一行 rejected = 1 的留痕再抛异常。
   *    前端在这里禁用按钮的话，那道校验永远轮不到、测试照样全绿、后端一声不响 ——
   *    而档案里从此再也没有「有人在赶稿时想关掉复核」这条记录。
   *    判据只有一条：**后端会不会为这次尝试留痕**。会 ⇒ 不许拦；不会 ⇒ 拦下不丢东西。
   */
  it('🔴 1–9 个字**放行**：后端要为它写一行 rejected = 1 的留痕', () => {
    expect(reviewReasonBlocksSubmit('太短')).toBe(false)
    expect(reviewReasonBlocksSubmit('a'.repeat(REVIEW_REASON_MIN_LENGTH - 1))).toBe(false)
    // 去空白后 5 个字，仍然是「后端会留痕」那一类
    expect(reviewReasonBlocksSubmit('  太短了  ')).toBe(false)
    // 🔴 而 reviewReasonProblem 对同一份输入**有**话说 —— 两者的差别正是这段注释：
    //    一个是要显示出来的提示，一个是该不该禁用按钮
    expect(reviewReasonProblem('太短')).toContain(`至少 ${REVIEW_REASON_MIN_LENGTH} 个字`)
  })

  it('🔴 放行那一类的提示文案必须把「会被记下来」说出来', () => {
    // 不写这半句的话，用户读到的只是「不合格」，他会以为改短一点重新填就行 ——
    // 而实际上他这一次点击已经在档案里留了一行
    expect(reviewReasonProblem('太短')).toContain('已被程序性拒绝')
  })

  it('🔴 空白与超上限**拦下**：那两道是 Bean Validation，压根到不了 Service、不留痕', () => {
    expect(reviewReasonBlocksSubmit('')).toBe(true)
    expect(reviewReasonBlocksSubmit('   ')).toBe(true)
    expect(reviewReasonBlocksSubmit(null)).toBe(true)
    expect(reviewReasonBlocksSubmit(undefined)).toBe(true)
    // 超上限那一道放过去撞的是 MySQL Data too long，用户读到的是「系统异常」
    expect(reviewReasonBlocksSubmit('a'.repeat(REVIEW_REASON_MAX_LENGTH + 1))).toBe(true)
  })

  it('⚠️ 上限量**原始**字数，与 reviewReasonProblem 同一个不对称', () => {
    // trim 后正好 500、原串 501：@Size(max = 500) 不 trim，所以这一份会被 Bean Validation 打回
    const raw = 'a'.repeat(REVIEW_REASON_MAX_LENGTH) + ' '
    expect(reviewReasonBlocksSubmit(raw)).toBe(true)
    expect(reviewReasonProblem(raw)).toContain('不能超过')
    // 原串正好 500：两道都过
    expect(reviewReasonBlocksSubmit('a'.repeat(REVIEW_REASON_MAX_LENGTH))).toBe(false)
    expect(reviewReasonProblem('a'.repeat(REVIEW_REASON_MAX_LENGTH))).toBeNull()
  })

  it('合格的理由既不拦也不提示', () => {
    const ok = '本机构内控要求法定评估业务全部由技术负责人二级复核'
    expect(reviewReasonBlocksSubmit(ok)).toBe(false)
    expect(reviewReasonProblem(ok)).toBeNull()
  })
})

describe('reviewInheritAvailable —— 哪一级的下拉里有「跟随上级」', () => {
  it('🔴 机构级没有：它没有上一级，传 INHERIT 会被 of() 回落成 ENFORCE', () => {
    expect(reviewInheritAvailable('ORG')).toBe(false)
  })

  it('项目级与报告级都有', () => {
    expect(reviewInheritAvailable('PROJECT')).toBe(true)
    expect(reviewInheritAvailable('REPORT')).toBe(true)
  })

  it('⚠️ 缺值按「没有」处理：多给一项比少给一项坏', () => {
    // 少给的表现是项目级弹层里找不到「跟随机构配置」，用户会问一句；
    // 多给的表现是机构级多出一个选项，选它就把档位改成最严的一档、
    // 而留痕如实记下 to_mode = 'ENFORCE' —— 一次与用户意图相反的变更
    expect(reviewInheritAvailable(null)).toBe(false)
    expect(reviewInheritAvailable(undefined)).toBe(false)
  })
})

describe('resolvedTargetModeOf —— 下拉里那个值解析成哪一档', () => {
  it('普通档位原样返回', () => {
    expect(resolvedTargetModeOf('ENFORCE', 'ADVISORY')).toBe('ENFORCE')
    expect(resolvedTargetModeOf('OFF', 'ADVISORY')).toBe('OFF')
  })

  it('🔴 选中「跟随上级」时返回**上一级说的那一档**，不是 INHERIT', () => {
    // 后端 assertChanged 比的是解析后的值，留痕行的 to_mode 写的也是它。
    // 前端要预判「档位没变」与「要不要勾告知」，就必须先做同一次解析
    expect(resolvedTargetModeOf(REVIEW_INHERIT, 'OFF')).toBe('OFF')
    expect(resolvedTargetModeOf(REVIEW_INHERIT, 'ENFORCE')).toBe('ENFORCE')
  })

  it('🔴 上一级档位缺值时返回 null，**不**回落到某一档', () => {
    // 回落到 ENFORCE 的话，「跟随机构配置」会在界面上显示成
    // 「你正在把本项目改成最严的一档」—— 而机构可能恰恰是 OFF
    expect(resolvedTargetModeOf(REVIEW_INHERIT, null)).toBeNull()
    expect(resolvedTargetModeOf(REVIEW_INHERIT, undefined)).toBeNull()
  })

  it('没选时返回 null', () => {
    expect(resolvedTargetModeOf(null, 'OFF')).toBeNull()
    expect(resolvedTargetModeOf(undefined, 'OFF')).toBeNull()
    expect(resolvedTargetModeOf('', 'OFF')).toBeNull()
  })
})

describe('reviewModeUnchanged —— 后端会判 REVIEW_MODE_UNCHANGED 的那一种提交', () => {
  it('🔴 这一条**可以**在前端拦：后端 assertChanged 排在留痕之前，压根不写行', () => {
    expect(reviewModeUnchanged('OFF', 'OFF')).toBe(true)
    expect(reviewModeUnchanged('ADVISORY', 'OFF')).toBe(false)
  })

  it('🔴 比的是**解析后**的两侧：项目级选 INHERIT 而机构是 OFF 时，与本项目当前的 OFF 相同', () => {
    // 那一次提交后端同样判 UNCHANGED（from / to 都是「本项目之后新建报告会拿到的档位」，
    // 不是那一列的字面值）。前端拿原值比的话会放行一次必然失败的往返
    const resolved = resolvedTargetModeOf(REVIEW_INHERIT, 'OFF')
    expect(reviewModeUnchanged('OFF', resolved)).toBe(true)
  })

  it('⚠️ 任一侧为 null ⇒ false（不拦），交给后端判', () => {
    // 「不知道当前是哪一档」与「知道、且相同」是两件事
    expect(reviewModeUnchanged(null, 'OFF')).toBe(false)
    expect(reviewModeUnchanged(undefined, 'OFF')).toBe(false)
    expect(reviewModeUnchanged('OFF', null)).toBe(false)
    expect(reviewModeUnchanged('OFF', undefined)).toBe(false)
    expect(reviewModeUnchanged(null, null)).toBe(false)
  })
})

describe('currentEffectiveWaiverOf —— 历史列表里正在生效的那一行', () => {
  it('🔴 跳过 rejected = 1 的行：它从来没有生效过，而它的 to_mode 照样写着 OFF', () => {
    const rejected = waiver({ id: 9, rejected: true, toMode: 'OFF' })
    const effective = waiver({ id: 8, toMode: 'ADVISORY' })
    // 后端按 create_time DESC 下发，所以被拒的那一次（更晚）排在前面
    expect(currentEffectiveWaiverOf([rejected, effective])).toBe(effective)
  })

  it('🔴 跳过已回填 effective_to 的行（已被改回来的那一次）', () => {
    const revoked = waiver({ id: 7, toMode: 'OFF', effectiveTo: new Date() })
    const effective = waiver({ id: 6, toMode: 'ENFORCE' })
    expect(currentEffectiveWaiverOf([revoked, effective])).toBe(effective)
  })

  /**
   * 🔴 后端 revokeInEffect 在插新行**之前**会把本作用域下所有生效行回填 effective_to，
   *    所以一次成功变更之后恰好剩一行 EFFECTIVE ⟹ 这个 find 与列表顺序无关。
   *    把它钉住：哪天有人改成「取第一行」，被拒的那一次尝试就会顶上来
   */
  it('🔴 至多一行，所以打乱顺序返回的仍是同一行（不要依赖后端的排序）', () => {
    const effective = waiver({ id: 5, toMode: 'OFF' })
    const others = [
      waiver({ id: 4, rejected: true, toMode: 'OFF' }),
      waiver({ id: 3, toMode: 'ADVISORY', effectiveTo: new Date() })
    ]
    expect(currentEffectiveWaiverOf([effective, ...others])).toBe(effective)
    expect(currentEffectiveWaiverOf([...others, effective])).toBe(effective)
    expect(currentEffectiveWaiverOf([others[0], effective, others[1]])).toBe(effective)
  })

  it('一行都没有时返回 null（含义由 modeTraceStateOf 分开说）', () => {
    expect(currentEffectiveWaiverOf([])).toBeNull()
    expect(currentEffectiveWaiverOf(null)).toBeNull()
    expect(currentEffectiveWaiverOf(undefined)).toBeNull()
    expect(currentEffectiveWaiverOf([waiver({ rejected: true })])).toBeNull()
  })
})

describe('modeTraceStateOf —— 配置行与留痕行对不对得上', () => {
  it('🔴 NOT_CONFIGURED 必须是独立的一档：新机构一行留痕都没有是**正常**状态', () => {
    // 把它报成 NO_TRACE 等于在新机构的第一次访问上挂一条警告，
    // 而一条在健康页面上恒红的提示会被下一个人直接删掉
    expect(modeTraceStateOf({ configured: false, reviewMode: 'ADVISORY' }, null)).toBe(
      'NOT_CONFIGURED'
    )
    expect(modeTraceStateOf({ configured: false, reviewMode: 'ADVISORY' }, waiver())).toBe(
      'NOT_CONFIGURED'
    )
    expect(modeTraceStateOf(null, null)).toBe('NOT_CONFIGURED')
    expect(modeTraceStateOf(undefined, undefined)).toBe('NOT_CONFIGURED')
    expect(modeTraceStateOf({ reviewMode: 'ADVISORY' }, null)).toBe('NOT_CONFIGURED')
  })

  it('🔴 配了、却没有一条生效中的留痕 ⇒ NO_TRACE（有人绕过 Service 直接改了库）', () => {
    // 后果是实的：OFF 档下 requireTraced 找不到授权行，
    // 这个机构每一份 OFF 报告都定不了稿，报错说「没有留痕」，
    // 而配置页明明写着 OFF
    expect(modeTraceStateOf({ configured: true, reviewMode: 'OFF' }, null)).toBe('NO_TRACE')
  })

  it('两侧一致 ⇒ MATCH', () => {
    expect(
      modeTraceStateOf({ configured: true, reviewMode: 'OFF' }, waiver({ toMode: 'OFF' }))
    ).toBe('MATCH')
    expect(
      modeTraceStateOf({ configured: true, reviewMode: 'ENFORCE' }, waiver({ toMode: 'ENFORCE' }))
    ).toBe('MATCH')
  })

  it('🔴 两侧不一致 ⇒ MISMATCH，且比的是**原串**（一列坏数据要表现为不一致）', () => {
    expect(
      modeTraceStateOf({ configured: true, reviewMode: 'ADVISORY' }, waiver({ toMode: 'OFF' }))
    ).toBe('MISMATCH')
    // reviewMode 后端已经过了 of()（认不出的取值回落 ENFORCE），
    // toMode 刻意没过 —— 所以留痕列被写坏时这里报不一致，而不是被回落值掩盖掉
    expect(
      modeTraceStateOf({ configured: true, reviewMode: 'ENFORCE' }, waiver({ toMode: 'off' }))
    ).toBe('MISMATCH')
    expect(
      modeTraceStateOf({ configured: true, reviewMode: 'OFF' }, waiver({ toMode: null }))
    ).toBe('MISMATCH')
  })
})

describe('reportReviewBarOf —— 灰条要常驻，而 OFF 档的 DRAFT 还没有运行头', () => {
  it('🔴 OFF 档 + 从来没被复核过（latest 为 null）⇒ 仍然是 GREY', () => {
    // §11.9.2.6 第 4 条那个「常驻」二字的唯一考验就在这一支：
    // 只按运行状态判的话这里返回 NONE，一份正在被写的 OFF 档报告
    // 页面上一个字都不提复核被关掉了
    expect(reportReviewBarOf('OFF', null)).toBe('GREY')
    expect(reportReviewBannerOf(null)).toBe('NONE')
  })

  it('OFF 档 + 已有一行 SKIPPED 的运行头 ⇒ GREY（两条判据在此重合）', () => {
    expect(reportReviewBarOf('OFF', review({ runStatus: 'SKIPPED' }))).toBe('GREY')
  })

  it('🔴 OFF 档压过黄条：即使读到一个未清零的整数也不显示黄条', () => {
    // OFF 档写零行明细，这个整数本该恒为 0；真读到非 0 说明库被绕过 Service 写坏了。
    // 此时显示灰条是保守的那一侧 —— 黄条会把人引向一个 OFF 档下入口已隐藏的工作台
    expect(reportReviewBarOf('OFF', review({ blockCountUnwaived: 3 }))).toBe('GREY')
  })

  it('🔴 OFF 档压过红条：一次 FAILED 的运行也不显示「没跑完」', () => {
    // 与上一条同一个理由，只是换成新加的第四态：OFF 档下闸 C 写的是 SKIPPED，
    // 读到 FAILED 说明库被绕过 Service 写坏了。此时灰条是保守的那一侧 ——
    // 红条会把人引向一个 OFF 档下**入口已隐藏**的工作台，点进去是 404
    expect(reportReviewBarOf('OFF', review({ runStatus: 'FAILED' }))).toBe('GREY')
  })

  it('不是 OFF 时完全交给 reportReviewBannerOf，两者逐支相同', () => {
    for (const mode of ['ENFORCE', 'ADVISORY', null, undefined, 'off', '坏码']) {
      for (const latest of [
        null,
        review({ runStatus: 'SKIPPED' }),
        review({ runStatus: 'FAILED' }),
        review({ blockCountUnwaived: 2 })
      ]) {
        expect(reportReviewBarOf(mode, latest)).toBe(reportReviewBannerOf(latest))
      }
    }
  })

  it('ENFORCE 档 + 有未清零 BLOCK ⇒ YELLOW（黄条不看档位）', () => {
    expect(reportReviewBarOf('ENFORCE', review({ blockCountUnwaived: 3 }))).toBe('YELLOW')
    expect(reportReviewBarOf('ADVISORY', review({ blockCountUnwaived: 3 }))).toBe('YELLOW')
  })
})

describe('reviewEntryVisibleByMode —— 报告页用档位那列判入口（不去读 /workbench）', () => {
  it('🔴 与后端 of(mode).runsRules() 逐字等价：只有字面 OFF 藏入口', () => {
    expect(reviewEntryVisibleByMode('OFF')).toBe(false)
    expect(reviewEntryVisibleByMode('ENFORCE')).toBe(true)
    expect(reviewEntryVisibleByMode('ADVISORY')).toBe(true)
  })

  it('🔴 null / 空串 / 认不出的坏码一律算「入口在」，与后端回落 ENFORCE 同向', () => {
    // 藏错方向的代价是一个功能对所有人消失，而后端在同样这一列上
    // 选的是严的一侧回落（ENFORCE ⇒ runsRules 为真），两边必须同向
    expect(reviewEntryVisibleByMode(null)).toBe(true)
    expect(reviewEntryVisibleByMode(undefined)).toBe(true)
    expect(reviewEntryVisibleByMode('')).toBe(true)
    expect(reviewEntryVisibleByMode('off')).toBe(true)
    expect(reviewEntryVisibleByMode('坏码')).toBe(true)
  })

  it('与 reviewEntryVisible 在正常数据上给出同一个答案', () => {
    // 两个函数读的是同一件事的两个来源：一个读 /workbench 那个布尔，
    // 一个读报告上冻结的那一列。答不一样就说明后端把 of() 的回落改了
    for (const mode of ['ENFORCE', 'ADVISORY', 'OFF']) {
      expect(reviewEntryVisibleByMode(mode)).toBe(
        reviewEntryVisible({ workbenchVisible: mode !== 'OFF' } as never)
      )
    }
  })

  it('🔴 模块没装 ⇒ 无论档位是什么都藏入口（REPORT_ONLY / REPORT_SIGN）', () => {
    // 退化形态下 reviewModeEffective 是 null，按上面那一条它算「入口在」——
    // 而点进去那一页的每个接口都归 @QlzgModuleGate(REVIEW)，全部 code=404，
    // 本仓 404 的 HTTP 状态码又是 200：用户拿到一个空白页，后端日志一行都没有
    expect(reviewEntryVisibleByMode(null, false)).toBe(false)
    expect(reviewEntryVisibleByMode('ENFORCE', false)).toBe(false)
    expect(reviewEntryVisibleByMode('ADVISORY', false)).toBe(false)
    expect(reviewEntryVisibleByMode('OFF', false)).toBe(false)
  })

  it('🔴 第二个入参不传时按「装了」算，与 moduleForm#isInstalled 取不到形态答 true 同向', () => {
    // 漏改的调用点、/qlzg/module/current 请求失败，产出都必须是
    // 「退化部署下多一个 404 的入口」，而不是「标准部署下这个功能对所有人消失」
    expect(reviewEntryVisibleByMode('ENFORCE')).toBe(true)
    expect(reviewEntryVisibleByMode('ENFORCE', true)).toBe(true)
  })
})

describe('effectiveOffWaiverOf —— 灰条上那个人名的责任落点', () => {
  const chain = (overrides: Partial<QlzgReviewWaiverChainVO> = {}): QlzgReviewWaiverChainVO =>
    ({ hasAny: true, reportLevel: [], projectLevel: [], orgLevel: [], ...overrides }) as never

  it('三段都空 ⇒ null（灰条照显示，只是不写人名）', () => {
    expect(effectiveOffWaiverOf(chain())).toBeNull()
    expect(effectiveOffWaiverOf(null)).toBeNull()
    expect(effectiveOffWaiverOf(undefined)).toBeNull()
  })

  it('🔴 优先级是报告 → 项目 → 机构，与后端 requireTraced 同序', () => {
    // 答成机构级那一位，而真相是本项目自己钉过一行，
    // 就是把责任落点挪到了另一个人身上
    const reportRow = waiver({ id: 3, waivedByNickname: '报告级那位' })
    const projectRow = waiver({ id: 2, waivedByNickname: '项目级那位' })
    const orgRow = waiver({ id: 1, waivedByNickname: '机构级那位' })
    expect(
      effectiveOffWaiverOf(
        chain({ reportLevel: [reportRow], projectLevel: [projectRow], orgLevel: [orgRow] })
      )?.id
    ).toBe(3)
    expect(
      effectiveOffWaiverOf(chain({ projectLevel: [projectRow], orgLevel: [orgRow] }))?.id
    ).toBe(2)
    expect(effectiveOffWaiverOf(chain({ orgLevel: [orgRow] }))?.id).toBe(1)
  })

  it('🔴 只认**生效中**的那一行：被拒的与被改回的都不算授权', () => {
    // 一次 rejected = 1 的尝试从来没有生效过，而它的 to_mode 照样写着 OFF；
    // 拿它当灰条上的人名，等于把一个没做成的决定说成了做成了的
    const rejectedRow = waiver({ id: 9, rejected: true, waivedByNickname: '试过没成的人' })
    const revokedRow = waiver({
      id: 8,
      effectiveTo: new Date('2026-03-14T00:00:00'),
      waivedByNickname: '关了又改回来的人'
    })
    const liveRow = waiver({ id: 7, waivedByNickname: '现在生效的那位' })
    expect(effectiveOffWaiverOf(chain({ orgLevel: [rejectedRow, revokedRow, liveRow] }))?.id).toBe(
      7
    )
    expect(effectiveOffWaiverOf(chain({ orgLevel: [rejectedRow, revokedRow] }))).toBeNull()
  })
})

describe('waiverBrokenOf —— 一行坏掉的豁免必须被看见', () => {
  it('🔴 waived 为真而 waivedProperly 为假 ⇒ true', () => {
    // 这一行在界面上显示成已豁免、闸 C 却不认，用户看到的是「我明明豁免过了」。
    // 而撤销豁免是修好它的唯一手段，所以这一列不一致时必须显式提示
    expect(waiverBrokenOf({ waived: true, waivedProperly: false })).toBe(true)
    expect(waiverBrokenOf({ waived: true, waivedProperly: null })).toBe(true)
    expect(waiverBrokenOf({ waived: true })).toBe(true)
  })

  it('合法豁免与「压根没豁免过」都不带警告', () => {
    expect(waiverBrokenOf({ waived: true, waivedProperly: true })).toBe(false)
    expect(waiverBrokenOf({ waived: false, waivedProperly: false })).toBe(false)
    expect(waiverBrokenOf({ waived: false })).toBe(false)
    expect(waiverBrokenOf(null)).toBe(false)
    expect(waiverBrokenOf(undefined)).toBe(false)
  })
})

describe('runRowSummaryOf —— 工作台顶上那一行汇总', () => {
  const run = (overrides: Partial<QlzgReviewRunVO> = {}): QlzgReviewRunVO =>
    ({ id: 1, ruleCode: 'R01', hit: false, errored: false, ...overrides }) as QlzgReviewRunVO

  it('🔴 errored 必须从 pass 里分出来，不能并进去', () => {
    // 一份要保存 30 年的档案上，「查过了没问题」与「没查出来」不能是同一个数
    const summary = runRowSummaryOf([
      run({ errored: true }),
      run({ errored: true, hit: true }),
      run({}),
      run({ hit: true })
    ])
    expect(summary).toEqual({ total: 4, hit: 1, pass: 1, errored: 2, blocking: 0 })
    expect(summary.hit + summary.pass + summary.errored).toBe(summary.total)
  })

  it('🔴 blocking 读后端那一列，不按 severity + hit + waived 自己拼', () => {
    // 自己拼的那一份在遇到一条坏豁免时会与黄条差 1，而两处都不报错
    expect(
      runRowSummaryOf([
        run({ hit: true, severity: 'BLOCK', blocksFinalizeNow: true }),
        run({ hit: true, severity: 'BLOCK', waived: true, waivedProperly: false }),
        run({ hit: true, severity: 'BLOCK', blocksFinalizeNow: false })
      ]).blocking
    ).toBe(1)
  })

  it('空清单与 null 都给全零，而不是报错', () => {
    const zero = { total: 0, hit: 0, pass: 0, errored: 0, blocking: 0 }
    expect(runRowSummaryOf([])).toEqual(zero)
    expect(runRowSummaryOf(null)).toEqual(zero)
    expect(runRowSummaryOf(undefined)).toEqual(zero)
  })

  it('🔴 OFF 档下 total 为 0：那一屏要能说出「一条都没跑」', () => {
    // 后端在 latest 为 null 时把 runs 设成【空清单】而不是 null，
    // 于是这一支是真实会走到的，不是防御性代码
    expect(runRowSummaryOf([]).total).toBe(0)
  })
})

describe('advisoryReleasedCountOf —— ADVISORY 档专属的那份「机器发现但已放行」清单', () => {
  const run = (overrides: Partial<QlzgReviewRunVO> = {}): QlzgReviewRunVO =>
    ({ id: 1, ruleCode: 'R01', hit: false, severity: 'BLOCK', ...overrides }) as QlzgReviewRunVO

  it('🔴 数的是「BLOCK 且命中、而此刻不拦」，与 blocking 互斥', () => {
    const runs = [
      run({ hit: true, blocksFinalizeNow: false }),
      run({ hit: true, blocksFinalizeNow: false }),
      run({ hit: true, blocksFinalizeNow: true }),
      run({ hit: false, blocksFinalizeNow: false })
    ]
    expect(advisoryReleasedCountOf(runs)).toBe(2)
    expect(runRowSummaryOf(runs).blocking).toBe(1)
    expect(advisoryReleasedCountOf(runs) + runRowSummaryOf(runs).blocking).toBe(3)
  })

  it('WARN / INFO 不算：它们本来就不拦定稿，「放行」这个词对它们没有意义', () => {
    expect(
      advisoryReleasedCountOf([
        run({ hit: true, severity: 'WARN', blocksFinalizeNow: false }),
        run({ hit: true, severity: 'INFO', blocksFinalizeNow: false })
      ])
    ).toBe(0)
  })

  it('🔴 ENFORCE 档下必然为 0 —— 所以这个数必须与档位一起判', () => {
    // 脱离 ADVISORY 单独显示它，会把「技术负责人逐条豁免过」读成
    // 「机构把拦截关了」，而两者的责任人不是同一个人
    const enforced = [run({ hit: true, blocksFinalizeNow: true })]
    expect(advisoryReleasedCountOf(enforced)).toBe(0)
  })

  it('空清单与 null 都给 0，而不是报错', () => {
    expect(advisoryReleasedCountOf([])).toBe(0)
    expect(advisoryReleasedCountOf(null)).toBe(0)
    expect(advisoryReleasedCountOf(undefined)).toBe(0)
  })
})

describe('hitDetailText —— 展开一行明细时那段任意 JSON 显示成什么', () => {
  it('合法的对象 / 数组要缩进美化，因为它是给人读的', () => {
    expect(hitDetailText('{"a":1,"b":[2,3]}')).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
    expect(hitDetailText('[1,2]')).toBe('[\n  1,\n  2\n]')
  })

  it('🔴 parse 失败 ⇒ 原样显示那段字符串，**不**显示「解析失败」', () => {
    // 那一列的约定是「一段任意 JSON」，而约定不是约束。
    // 显示「解析失败」等于把唯一有用的内容藏起来，只留下一个关于它的坏消息
    expect(hitDetailText('引擎读不到 built_year')).toBe('引擎读不到 built_year')
    expect(hitDetailText('{坏的')).toBe('{坏的')
  })

  it('⚠️ 标量原样显示（连引号一起），且 JSON 的 null 不与「没留下细节」混在一起', () => {
    expect(hitDetailText('123')).toBe('123')
    // 原样 = 库里存的是什么就显示什么。给 '"abc"' 脱掉引号是一次改写，
    // 而这一块的标题写的正是「引擎当时写下的原文」
    expect(hitDetailText('"abc"')).toBe('"abc"')
    expect(hitDetailText('true')).toBe('true')
    // JSON 里的 null 是一个**值**（引擎确实写下了「这一项是空的」），
    // 与「这一列压根没写过」是两件事；前者原样显示，后者给空串让 v-if 收起整块
    expect(hitDetailText('null')).toBe('null')
  })

  it('空 / 空白 / null / undefined 一律给空串，好让模板把整块收起来', () => {
    expect(hitDetailText('')).toBe('')
    expect(hitDetailText('   ')).toBe('')
    expect(hitDetailText(null)).toBe('')
    expect(hitDetailText(undefined)).toBe('')
  })

  it('🔴 两端空白要 trim 掉再 parse：MySQL 的 json 列不会带，但引擎拼的串可能会', () => {
    expect(hitDetailText('  {"a":1}  ')).toBe('{\n  "a": 1\n}')
  })
})
