import { test, expect } from '@playwright/test'
import {
  STEP_TIMEOUT_MS,
  boundedRawText,
  boundedText,
  waitTerminal,
  waitTerminalOutcome
} from './helpers/terminal'

/**
 * `waitTerminal` 的**构造样本**测试（方案 §2-7）：不跑真发、不花一分钱，钉住「等待函数必定按时返回」
 *
 * ## 为什么这条测试是 P1 里最靠前的一件
 * 一个「超时后不会返回」的等待函数，等于把**卡死**和**失败**混成同一类。在那之后跑的任何
 * T1/T2/A4-d，只要报「等满 N 秒未收敛」，都无法区分「模型真没答」和「等待函数自己挂了」。
 * 实测疤（A4-d run3，2026-10-04）：`08:24:23` 后端 buildDraft 已经成功、草稿卡真的渲染出来了，
 * 测试却毫无反应；`PLAN_TIMEOUT=600s` 在 `08:27:37` 该到期也没到期；`08:31` 被人手杀掉 ⟹
 * `afterAll` 没跑、残留没清。
 *
 * ## 已确认的因果（不是「可能是网络」）
 * 原实现里有一行 `await alert.last().innerText().catch(() => '')`。
 * `playwright.config.ts` **没有设 `use.actionTimeout`** ⟹ locator 操作的默认超时是 **0（无限等）**，
 * 于是页面上没有 `.el-alert--error` 时（**绝大多数正常轮次都没有**）这个 promise 永不 settle，
 * `.catch()` 压根不触发；而 `while (Date.now() < deadline)` 只在每轮**开头**求值一次，
 * 一旦卡在轮内，deadline 就再也轮不到被检查。
 *
 * 🔴 推论：run3 不是在 `08:24` 才卡的 —— 它**从第一轮采样就卡住了**（`08:17:37` 发出 send-stream 时
 *    页面上既没有草稿卡也没有 alert）。所以「草稿卡都渲染出来了为什么 outcome=true 那条分支没返回」
 *    这个疑问的答案是：那一轮循环压根没走到过第二次采样。
 *
 * 这条机制已用一次性探针实测确认（对不存在的元素调 `last().innerText()`，与 8 秒定时器 race，
 * 8 秒后仍是 STILL_PENDING），不是读文档推的。
 *
 * ## 🔴 变异探针怎么打（方案 §2-8）
 * 把 `helpers/terminal.ts` 里 `alert.last().innerText({ timeout: step })` 的显式 timeout 去掉、
 * 并把外层的 `bounded(...)` 换成直接 `await` —— 下面「② 空页面」与「③ 只有进度条」两条
 * 必须从「按时返回」变成**挂到用例超时**（红在 `expect(elapsed).toBeLessThan(...)`，
 * 而且是被 90 秒用例超时判死，不是断言失败）。只红不退，或红在别的断言上，都算探针无效。
 */

/** 造一个「只有规划进度条在转」的页面：run3 卡死时的真实形状 */
const PLANNING_ONLY = `<div data-testid="assistant-planning">正在把需求拆解成流程…</div>`

/** 造一个什么都没有的页面：run3 **第一轮采样**时的真实形状（原实现在这一轮就永久挂起） */
const NOTHING = `<div data-testid="assistant-scroll"><p>（还没有任何产出）</p></div>`

/** 每个终局判据都要先自证「采得到」（方案 §2-6），否则下面的按时返回是空洞通过 */
const BUDGET_MS = 6_000
/** 允许超出的量：helper 的守卫是「每步 ≤ STEP_TIMEOUT+250、poll ≤ POLL_MS+500」，给足调度抖动 */
const SLACK_MS = 4_000

test.describe('waitTerminal 的构造样本：终局判据采得到，且必定按时返回', () => {
  test.setTimeout(120_000)

  test('① 阳性对照：三种终局判据都真的采得到（否则下面的按时返回都是空洞通过）', async ({
    page
  }) => {
    // ①-a 进度条 → 草稿卡：既证明 sawPlanning 采得到，也证明 outcome=true 采得到。
    //      🔴 必须**先**有进度条**再**出卡：真界面里两者是 v-if / v-else 互斥的，
    //      同时摆上去就等于没验「沿途记录」这件事 —— 卡片一出现进度条就再也查不到了。
    await page.setContent(`
      <div id="host">${PLANNING_ONLY}</div>
      <script>
        setTimeout(() => {
          document.getElementById('host').innerHTML =
            '<div data-testid="workflow-draft-card"><span>待确认</span></div>'
        }, 1500)
      </script>
    `)
    const drafted = await waitTerminal(page, BUDGET_MS)
    expect(
      drafted.sawPlanning,
      `草稿卡出来了，却**从没采到**规划进度条 —— 要么 [data-testid="assistant-planning"] 改名了，` +
        `要么采样漏了它。不管哪种，「有没有走 BUILD」这条判据已经失效：真发失败时会把 Planner 的锅` +
        `记到意图分型头上，排查方向整个反过来`
    ).toBe(true)
    expect(drafted.outcome, '草稿卡可见时必须认出 outcome=true').toBe(true)

    // ①-b error alert：outcome=null，且原文是**当场**抓下来的
    await page.setContent(
      `<div class="el-alert el-alert--error"><span>模型连续两轮产出完全相同的 DSL</span></div>`
    )
    const alerted = await waitTerminal(page, BUDGET_MS)
    expect(alerted.outcome, 'alert 是一种终局，必须当场认出来并立刻返回，不能空转到超时').toBe(null)
    expect(alerted.errorText, 'alert 原文必须被抓下来（判词只准原样引用它）').toContain(
      '模型连续两轮产出完全相同的 DSL'
    )

    // ①-c 直接答了一段文字：outcome=false
    await page.setContent(`<div data-testid="assistant-answer">库里已经有这张表了</div>`)
    const answered = await waitTerminal(page, BUDGET_MS)
    expect(answered.outcome, '答案气泡非空时必须认出 outcome=false（被判成 CHAT）').toBe(false)
    expect(answered.sawPlanning, '这一页从没出现过进度条，sawPlanning 必须是 false').toBe(false)
  })

  test('② 🔴 构造样本：页面上什么终局都没有（run3 第一轮采样的形状）→ 必须在预算内返回', async ({
    page
  }) => {
    // 这就是原实现永久挂起的那个形状：没有草稿卡、没有 alert、没有答案气泡。
    // 「后端已给结论、但前端终局判据一个都不认」——buildDraft 成功了，而卡片要另发一次 HTTP
    // 取 DSL 正文才切到「待确认」，后端静默时它就一直不出现。
    await page.setContent(NOTHING)

    const startedAt = Date.now()
    const terminal = await waitTerminal(page, BUDGET_MS)
    const elapsed = Date.now() - startedAt

    expect(
      elapsed,
      `waitTerminal 在 ${BUDGET_MS}ms 的预算里没有返回（实际 ${elapsed}ms）。` +
        `这就是 run3 的形状：一旦卡在轮内，while 的 deadline 守卫再也轮不到被求值，` +
        `「卡死」和「失败」被混成同一类，之后所有「等满 N 秒未收敛」的判词都不可信`
    ).toBeLessThan(BUDGET_MS + SLACK_MS)
    expect(terminal.outcome, '没有任何终局判据成立时必须是 null（无结论），不能瞎猜一个').toBe(null)
    expect(terminal.errorText, '没挂过 alert 就不该编出一段 alert 原文').toBe('')
    expect(terminal.sawPlanning, '这一页从没出现过进度条').toBe(false)

    // 同一个形状下，T1/T2 用的那个简化版也必须按时返回
    const startedAt2 = Date.now()
    const simple = await waitTerminalOutcome(page, BUDGET_MS)
    expect(
      Date.now() - startedAt2,
      `waitTerminalOutcome 也没在预算内返回（T1/T2 全量矩阵 45 分钟一轮，卡一次就是整轮作废）`
    ).toBeLessThan(BUDGET_MS + SLACK_MS)
    expect(simple, '简化版同样要返回 null（超时仍在转圈）').toBe(null)
  })

  test('③ 🔴 构造样本：只有进度条一直在转（run3 卡死期间的形状）→ 必须在预算内返回，且 sawPlanning=true', async ({
    page
  }) => {
    await page.setContent(PLANNING_ONLY)

    const startedAt = Date.now()
    const terminal = await waitTerminal(page, BUDGET_MS)
    const elapsed = Date.now() - startedAt

    expect(
      elapsed,
      `只有进度条在转时 waitTerminal 没有按时返回（实际 ${elapsed}ms / 预算 ${BUDGET_MS}ms）`
    ).toBeLessThan(BUDGET_MS + SLACK_MS)
    expect(terminal.outcome, '进度条不是终局，必须继续等到预算耗尽后返回 null').toBe(null)
    expect(
      terminal.sawPlanning,
      `进度条一直在页面上，却没采到 sawPlanning —— 这条判据失效了（见 ①-a 的说明）`
    ).toBe(true)
  })

  test('④ 预算给到 0 或已过期：立刻返回，不抛、不死循环', async ({ page }) => {
    await page.setContent(NOTHING)

    const startedAt = Date.now()
    const zero = await waitTerminal(page, 0)
    expect(Date.now() - startedAt, '预算 0 必须立刻返回').toBeLessThan(2_000)
    expect(zero).toEqual({ outcome: null, sawPlanning: false, errorText: '' })

    const negative = await waitTerminal(page, -5_000)
    expect(negative.outcome, '负预算同样要返回 null，不能抛').toBe(null)
  })

  /**
   * 🔴 钉住那两个**共享守卫**本身，而不是钉住某一个等待函数
   *
   * ②③ 证明的是 `waitTerminal` 按时返回，但它只是调用方之一。同一个坑在三个文件里各留过一份
   * 本地实现（A4-d 的 `waitTerminal`、T2 的轮次徽标读取、T1 的 `assertPlainAnswer`），
   * 修完一份另一份照样炸 —— T1 那份就是 2026-10-04 全量真跑跑到 11:52 卡死、
   * 12:1x 被人手杀掉、`afterAll` 没跑的那一次。所以守卫抽成 `boundedText`/`boundedRawText`
   * 之后，必须有一条测试**直接打在守卫上**：元素压根不存在时也得按时返回空串。
   *
   * 🔴 变异探针：把 `boundedText` 里的 `.innerText({ timeout: ms })` 改成 `.innerText()`、
   *    并把外层 `bounded(...)` 换成直接 `await` —— 本条必须从「返回空串」变成**挂到用例超时**
   *    （被 120 秒用例超时判死，不是断言失败）。只红不退算探针无效。
   */
  test('⑤ 🔴 构造样本：元素压根不存在时，共享守卫必须按时返回空串（T1 卡死那一轮的形状）', async ({
    page
  }) => {
    // 正常轮次的真实形状：答案气泡在，error alert **不在**
    await page.setContent(`<div data-testid="assistant-answer">答完了，没有任何报错</div>`)
    const absent = page.locator('.el-alert--error').last()

    for (const [name, read] of [
      ['boundedText', boundedText],
      ['boundedRawText', boundedRawText]
    ] as const) {
      const startedAt = Date.now()
      const got = await read(absent, STEP_TIMEOUT_MS)
      const elapsed = Date.now() - startedAt
      expect(got, `${name} 对不存在的元素必须返回空串，绝不能挂住调用方`).toBe('')
      expect(
        elapsed,
        `${name} 在元素不存在时用了 ${elapsed}ms 才返回（上限 STEP_TIMEOUT_MS=${STEP_TIMEOUT_MS} + 调度余量）。` +
          `守卫一旦失效，调用它的那个 while 循环就再也轮不到求值 deadline —— ` +
          `整条用例永久挂起、报告一个案例块都不落盘、afterAll 不跑、残留不清`
      ).toBeLessThan(STEP_TIMEOUT_MS + SLACK_MS)
    }

    // 🔴 阳性对照：元素真在的时候必须读得到原文。没有这一句，上面两条「按时返回空串」
    //    会被一个「永远返回空串」的实现骗过去（方案 §2-6：判据自己要先探通一次）
    await page.setContent(`<div class="el-alert el-alert--error">所有 AI 模型均不可用</div>`)
    expect(
      await boundedText(page.locator('.el-alert--error').last(), STEP_TIMEOUT_MS),
      'alert 真在页面上时必须把原文读出来（判词只准原样引用它）'
    ).toContain('所有 AI 模型均不可用')
  })
})
