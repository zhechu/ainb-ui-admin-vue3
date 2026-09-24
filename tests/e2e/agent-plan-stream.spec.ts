import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 规划路径（BUILD 意图）的流式投递验证
 *
 * 🔴 这个用例守的是一次<b>真实的、极难察觉的</b>故障：
 * 用户输入「帮我建一个可以验证所有基础控件的表单…」之后，界面上
 * 「正在理解需求…」一动不动地挂了五分多钟，然后方案卡片才突然出现。
 * 用户的原话是「没有反应，是又出 BUG 了吗」。
 *
 * 根因不在模型、不在网络、也不在 Tomcat，而在 Reactor 的组装方式：
 * 后端原先用 {@code Flux.create(sink -> {阻塞规划}).subscribeOn(boundedElastic)}，
 * 而 subscribeOn 的预取是 {@code worker.schedule(() -> s.request(n))} ——
 * 派发到的正是那个被五分钟阻塞规划占死的 worker，于是下游的需求永远补不上，
 * 事件全积压在缓冲区里，直到规划结束才一次性涌出。
 *
 * 所以这里的<b>核心断言不是「最后有没有出卡片」，而是「进度文字会不会随时间变化」</b>。
 * 只断言结果的话，积压版和修好版都会通过 —— 那等于什么都没守住。
 *
 * 前置：后端 48080 与前端 dev server 同时在跑，且聊天模型可用。
 * 一轮规划实测 3~5 分钟（多轮模型调用 + 工具查询），超时给足 10 分钟。
 */

const QUESTION = '帮我建一个可以验证所有基础控件的表单（包含列表展示的功能），尽量复用已有的表'

/** 采样间隔。规划每轮之间实测间隔 20~60 秒，8 秒足够抓到变化又不至于空转 */
const SAMPLE_INTERVAL_MS = 8_000

/** 等终态的最长时间。实测一轮规划 3~5 分钟，留一倍余量 */
const TERMINAL_TIMEOUT_MS = 480_000

test.describe('AI 助手规划路径', () => {
  test.setTimeout(600_000)

  test('规划进度实时可见，并最终收敛出方案卡片或直接回答', async ({ page }) => {
    // 未捕获异常比 console.error 更值得断言：dev server 下 console.error 有噪音，
    // 而 pageerror 一旦出现就是真炸了（比如 SSE 事件里多了个前端没处理的字段）
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    await login(page)
    await gotoWithAuth(page, '/agent/assistant')

    await page.locator('textarea').fill(QUESTION)
    await page.getByRole('button', { name: /发送/ }).click()

    const planning = page.locator('[data-testid="assistant-planning-text"]')
    const planCard = page.locator('[data-testid="plan-card"]')
    const answer = page.locator('[data-testid="assistant-answer"]')

    // 意图分类本身是一次阻塞的模型调用（实测 3~8 秒），所以首个进度事件不是立刻到的
    await expect(planning).toBeVisible({ timeout: 90_000 })

    // ===================================================================
    // 边采样边等终态
    //
    // 不能「先等卡片出现、再回头看进度」—— 卡片一出现，规划进度条就被
    // v-else-if 换掉了，那时再也采不到进度文字。必须同一条循环里边等边采。
    // ===================================================================
    const samples = new Set<string>()
    const deadline = Date.now() + TERMINAL_TIMEOUT_MS
    let reachedTerminal = false

    while (Date.now() < deadline) {
      if (await planCard.isVisible().catch(() => false)) {
        reachedTerminal = true
        break
      }
      // 模型也可能判断「这事不需要变更」而直接回答（type=answer），
      // 那是设计内的合法终态，不能当成失败
      if (await answer.isVisible().catch(() => false)) {
        const text = (await answer.textContent().catch(() => '')) ?? ''
        if (text.trim().length > 0) {
          reachedTerminal = true
          break
        }
      }
      const text = ((await planning.textContent().catch(() => null)) ?? '').trim()
      if (text) {
        samples.add(text)
      }
      await page.waitForTimeout(SAMPLE_INTERVAL_MS)
    }

    // 🔴 核心断言一：进度文字必须<b>变过</b>。
    //    积压版的表现是全程只有「正在理解需求…」这一句，samples.size 恒为 1。
    expect(
      samples.size,
      `规划进度文字全程没有变化（只采到 ${[...samples].join(' | ')}）—— ` +
        `说明 SSE 事件又被积压到最后一次性发出了`
    ).toBeGreaterThanOrEqual(3)

    // 🔴 核心断言二：必须走到终态，不能一直转圈。
    //    「一直转圈」正是用户报的那个现象
    expect(reachedTerminal, '等待 8 分钟仍未产出方案卡片或回答，规划没有收敛').toBe(true)

    // 🔴 核心断言三：不能是「跑满轮次仍未能给出方案」那种失败。
    //    那是规划循环无法收敛的症状（模型不知道自己没轮次了，5 轮全花在查资料上），
    //    修法是：把轮次预算写进 system prompt + 最后一轮禁止再查 + 轮次上限 5→6
    const bodyText = await page.locator('[data-testid="assistant-scroll"]').textContent()
    expect(bodyText).not.toContain('仍未能给出可执行的方案')

    // 终态之后流必须已经收尾：「停止」按钮消失，否则前端还认为在生成中
    await expect(page.getByRole('button', { name: /停止/ })).toHaveCount(0, { timeout: 30_000 })

    // 走到方案卡片的话，卡片里必须有至少一个步骤 ——
    // 空卡片是「校验把字段全删光了还放过去」的症状
    const hasPlanCard = await planCard.isVisible().catch(() => false)
    if (hasPlanCard) {
      await expect(planCard.getByText('待确认')).toBeVisible()
      const stepRows = planCard.locator('.el-checkbox')
      expect(await stepRows.count(), '方案卡片里一个步骤都没有').toBeGreaterThanOrEqual(1)
    }

    // ===================================================================
    // 🔴 刷新之后卡片必须还在
    //
    // 这一段守的是另一个真缺陷：后端 AgentMessageRespVO 里<b>压根没有 planId 字段</b>，
    // 而前端 loadMessages 靠 item.planId 去 /agent/plan/get 重建卡片。
    // 拿不到 planId 就走「普通消息」分支 —— 刷新页面后那张「待确认」卡片
    // 退化成一段纯文字，没有勾选框、没有确认按钮，方案<b>再也执行不了</b>，
    // 而且全程没有任何报错。前端那行原先写的是 (item as any).planId，
    // 那个 as any 正好把类型上的缺口盖住了。
    // ===================================================================
    if (hasPlanCard) {
      const summaryBefore = ((await planCard.locator('span').nth(1).textContent()) ?? '').trim()
      await page.reload()
      await expect(page.locator('[data-testid="plan-card"]')).toBeVisible({ timeout: 60_000 })
      const cardAfter = page.locator('[data-testid="plan-card"]')
      await expect(cardAfter.getByText('待确认')).toBeVisible()
      expect(
        await cardAfter.locator('.el-checkbox').count(),
        '刷新之后方案卡片的步骤没了 —— planId 没能从消息列表里带回来'
      ).toBeGreaterThanOrEqual(1)
      if (summaryBefore) {
        await expect(cardAfter).toContainText(summaryBefore.slice(0, 20))
      }
    }

    expect(pageErrors, `页面出现未捕获异常：${pageErrors.join(' / ')}`).toHaveLength(0)
  })
})
