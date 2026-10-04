import type { Page } from '@playwright/test'

/**
 * 「等一轮真发收敛到终局」的公共实现
 *
 * ## 🔴 为什么这个函数值得单独抽出来、并且每一步都套硬超时
 *
 * 实测疤（A4-d run3，2026-10-04 08:17 起，测试被人手杀掉）：
 * `08:17:37` 发出 send-stream 之后，等待函数**一次都没能走完第一轮采样**，
 * 于是 `08:24:23` 后端 `buildDraft` 成功、草稿卡真的渲染出来了，测试却毫无反应；
 * `PLAN_TIMEOUT=600s` 在 `08:27:37` 就该到期，也没到期；`08:31` 人工判定卡死杀进程 ⟹
 * `afterAll` 没跑、残留没清。
 *
 * 根因不是网络、不是模型、也不是超时值给小了，而是一行 locator 调用：
 *
 * ```ts
 * const alertText = await alert.last().innerText().catch(() => '')
 * ```
 *
 * `playwright.config.ts` **没有设 `use.actionTimeout`** ⟹ locator 操作的默认超时是 **0（无限等）**。
 * 页面上没有 `.el-alert--error` 时（也就是**绝大多数正常轮次**），这个 `innerText()`
 * 的 promise **永远不 settle**，`.catch()` 压根不触发。而 `while (Date.now() < deadline)`
 * 的守卫只在每轮**开头**求值一次 —— 一旦卡在轮内，`deadline` 就再也轮不到被检查。
 *
 * 已用一条一次性探针实测确认（不是读文档推的）：对不存在的元素调 `last().innerText()`，
 * 与一个 8 秒定时器 race，8 秒后仍是 `STILL_PENDING`。
 *
 * ## 两层防护，缺一不可
 *
 * 1. **显式 timeout**：给会等待的 locator 调用（`innerText`/`textContent`）传一个有限的
 *    `timeout`。这管的是 locator 的「等待层」——元素迟迟不出现时按时放弃。
 *    （`isVisible()` 本身不等待，不需要。）
 * 2. **`bounded()` 硬超时**：显式 timeout 管不到「协议调用本身发不出去」这一层 ——
 *    locator 调用最终要在渲染进程主线程上执行，主线程被长任务占满时（本轮 SSE 的答复
 *    带着思考模型的上万 completion token，打字机以 8ms 间隔重排整段 markdown）
 *    这些调用会排队，排多久都不报错。所以每一步外面再 race 一个定时器：
 *    **宁可这一轮采样作废，也绝不让等待函数比 deadline 活得久。**
 *
 * 🔴 判据纪律（方案 §2-6）：本文件返回的 `sawPlanning=false` 会被调用方用来判「没走 BUILD 路径」。
 *    那它就必须先在一条**成功**的轮次上被证明确实采得到 —— 见
 *    `tests/e2e/wait-terminal-deadline.spec.ts` 的阳性对照。否则 `assistant-planning`
 *    这个 data-testid 哪天改了名，每次 Planner 故障都会被冤枉成意图分型故障。
 */

/** 轮询步长。规划进度条一轮要挂十几秒到几分钟，2 秒一轮不会漏 */
const POLL_MS = 2_000

/** 单个 locator 调用的显式上限；取小值是为了让 deadline 能被及时重新求值 */
const STEP_TIMEOUT_MS = 2_000

/**
 * 一轮真发的终局
 *
 * @param outcome     true=出了草稿卡，false=被当成 CHAT 直接答了一段文字，null=报错或等到超时
 * @param sawPlanning 轮询期间是否**见到过**规划进度条（`assistant-planning`）
 * @param errorText   见到 error alert 时当场抓下的原文；空串=没挂过 alert
 */
export type Terminal = { outcome: boolean | null; sawPlanning: boolean; errorText: string }

const STALL = Symbol('stall')
type Stalled = typeof STALL

/**
 * 给一个 promise 套硬超时：超时则返回 {@link STALL}，**绝不抛**
 *
 * <p>刻意不 reject：调用方要的是「这一步没拿到结果，继续下一轮」，
 * 而不是把一次采样失败放大成整条用例失败 —— 真发一轮几十分钟，
 * 中间某一步的协议调用慢一下不该让整轮白烧。
 *
 * <p>被放弃的那个 promise 不 cancel（Playwright 没有取消 API），它自己会随页面关闭而结束；
 * 这里只负责不再等它。
 */
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T | Stalled> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<Stalled>((resolve) => {
        timer = setTimeout(() => resolve(STALL), ms)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 剩余预算，最少给 200ms —— 给 0 会让 bounded 立刻判 STALL，白白丢掉一轮采样 */
function stepBudget(deadline: number): number {
  return Math.max(200, Math.min(STEP_TIMEOUT_MS, deadline - Date.now()))
}

/**
 * 等一轮真发收敛到终态（A4-d 用：四种终局都要认，包括 error alert）
 *
 * 🔴 **本函数保证在 `timeoutMs` 内返回**（超出量不超过一个 `STEP_TIMEOUT_MS` 的调度抖动）。
 *    这条保证由 `wait-terminal-deadline.spec.ts` 的构造样本钉住：那里造了一个
 *    「后端已给结论、但前端终局判据一个都不认」的页面（只有规划进度条在转），
 *    断言它必定按时返回 `outcome: null`。把 bounded 拆掉，那条测试会挂到用例超时才红。
 */
export async function waitTerminal(page: Page, timeoutMs: number): Promise<Terminal> {
  const draftCard = page.locator('[data-testid="workflow-draft-card"]')
  const answer = page.locator('[data-testid="assistant-answer"]')
  const planning = page.locator('[data-testid="assistant-planning"]')
  const alert = page.locator('.el-alert--error')
  const deadline = Date.now() + timeoutMs
  let sawPlanning = false

  while (Date.now() < deadline) {
    const step = stepBudget(deadline)

    if ((await bounded(planning.isVisible().catch(() => false), step)) === true) {
      sawPlanning = true
    }
    if ((await bounded(draftCard.isVisible().catch(() => false), step)) === true) {
      return { outcome: true, sawPlanning, errorText: '' }
    }
    // 🔴 alert 原文要在**看见它的那一刻**抓下来，不能等返回后再读：
    //    后续事件有可能改写这块 DOM，事后读到的是另一轮的错。
    const alertText = await bounded(
      alert.last().innerText({ timeout: step }).catch(() => ''),
      step + 250
    )
    if (typeof alertText === 'string' && alertText.trim().length > 0) {
      return { outcome: null, sawPlanning, errorText: alertText.trim() }
    }
    if ((await bounded(answer.isVisible().catch(() => false), step)) === true) {
      const text = await bounded(answer.textContent({ timeout: step }).catch(() => ''), step + 250)
      if (typeof text === 'string' && text.trim().length > 0) {
        return { outcome: false, sawPlanning, errorText: '' }
      }
    }

    const left = deadline - Date.now()
    if (left <= 0) break
    await bounded(page.waitForTimeout(Math.min(POLL_MS, left)), POLL_MS + 500)
  }
  return { outcome: null, sawPlanning, errorText: '' }
}

/**
 * 只认「出了草稿卡 / 直接答了文字」两种终局的版本（T1/T2 模板矩阵用）
 *
 * <p>🔴 刻意**不**认 error alert：矩阵那侧的判词把 `null` 一律报成「等满 N 秒未收敛」，
 *    而一个瞬时 alert 会让它提前几分钟返回 null，报告里就会印一句与事实不符的「等满」。
 *    改它要连判词一起改，那是另一件事；本轮只把「永不返回」这个真缺陷修掉，
 *    语义与改前逐字一致（见 `prompt-template-build-matrix.spec.ts` 原先那份本地实现）。
 *
 * @returns true=出了草稿卡；false=被判成 CHAT 直接答了文字；null=超时仍在转圈
 */
export async function waitTerminalOutcome(page: Page, timeoutMs: number): Promise<boolean | null> {
  const draftCard = page.locator('[data-testid="workflow-draft-card"]')
  const answer = page.locator('[data-testid="assistant-answer"]')
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const step = stepBudget(deadline)
    if ((await bounded(draftCard.isVisible().catch(() => false), step)) === true) return true
    if ((await bounded(answer.isVisible().catch(() => false), step)) === true) {
      const text = await bounded(answer.textContent({ timeout: step }).catch(() => ''), step + 250)
      if (typeof text === 'string' && text.trim().length > 0) return false
    }
    const left = deadline - Date.now()
    if (left <= 0) break
    await bounded(page.waitForTimeout(Math.min(POLL_MS, left)), POLL_MS + 500)
  }
  return null
}
