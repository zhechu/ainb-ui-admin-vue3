import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 规划路径（BUILD 意图）的流式投递验证 —— plan-as-workflow 版（增量7b）
 *
 * 🔴 这个用例守的是一次<b>真实的、极难察觉的</b>故障：
 * 用户输入建流程的需求之后，界面上「正在理解需求…」一动不动地挂了五分多钟，
 * 然后卡片才突然出现。用户的原话是「没有反应，是又出 BUG 了吗」。
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
 * 增量7b 之后，BUILD 意图产出的不再是一份线性计划（plan-card + 勾选步骤），
 * 而是一整份 Workflow DSL 草稿（workflow-draft-card + 只读节点预览）。
 * 进度条的 data-testid（assistant-planning / assistant-planning-text）契约不变，
 * 脚手架（Sinks unicast）也逐行保留 —— 这条用例的核心价值因此原样生效。
 *
 * 前置：后端 48080 与前端 dev server 同时在跑，且聊天模型可用。
 * 一轮生成实测数十秒~数分钟（多轮模型调用 + 自修正），超时给足 10 分钟。
 */

const QUESTION = '做一个工作流：列出关键词为 test_demo 的数据接口，最多返回 5 条'

/** 采样间隔。生成每轮之间实测间隔数秒~数十秒，8 秒足够抓到变化又不至于空转 */
const SAMPLE_INTERVAL_MS = 8_000

/** 等终态的最长时间。留足余量 */
const TERMINAL_TIMEOUT_MS = 480_000

test.describe('AI 助手规划路径（plan-as-workflow）', () => {
  test.setTimeout(600_000)

  test('规划进度实时可见，并最终收敛出 Workflow 草稿卡片', async ({ page }) => {
    // 未捕获异常比 console.error 更值得断言：dev server 下 console.error 有噪音，
    // 而 pageerror 一旦出现就是真炸了（比如 SSE 事件里多了个前端没处理的字段）
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')

    await page.locator('textarea').fill(QUESTION)
    await page.getByRole('button', { name: /发送/ }).click()

    const planning = page.locator('[data-testid="assistant-planning-text"]')
    const draftCard = page.locator('[data-testid="workflow-draft-card"]')
    const answer = page.locator('[data-testid="assistant-answer"]')

    // 意图分类本身是一次阻塞的模型调用（实测 3~8 秒），所以首个进度事件不是立刻到的
    await expect(planning).toBeVisible({ timeout: 90_000 })

    // ===================================================================
    // 边采样边等终态
    //
    // 不能「先等卡片出现、再回头看进度」—— 卡片一出现，规划进度条就被
    // v-else 换掉了，那时再也采不到进度文字。必须同一条循环里边等边采。
    // ===================================================================
    const samples = new Set<string>()
    const deadline = Date.now() + TERMINAL_TIMEOUT_MS
    let reachedTerminal = false

    while (Date.now() < deadline) {
      if (await draftCard.isVisible().catch(() => false)) {
        reachedTerminal = true
        break
      }
      // 分类器也可能把这句判成 CHAT 而直接回答（未走 BUILD）——
      // 那是既有分类件的合法行为，不能当成失败
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

    // 🔴 核心断言一：进度文字必须在卡片出现之前被采到（至少 1 次）。
    //    这是反「SSE 积压」的守卫：积压版的表现是 planning 直到最后一刻才和卡片
    //    同时涌出，循环第一轮就因 card 可见而 break，samples 恒为 0（或 planning
    //    在 90s 内根本不可见而超时）。
    //    🔴 不再要求 >=3：plan-as-workflow 用强模型常常<b>一轮</b>就产出合法 DSL
    //    （7a/7b 实测 rounds=1），此时后端只发一句「正在把需求拆解成流程…」，
    //    生成数十秒内完成，根本来不及采到 3 个不同进度。旧线性 planner 必然多轮
    //    查资料才有 3+ 句 —— 那个阈值是它的产物，对新路径是误判。
    expect(
      samples.size,
      `卡片出现前没有采到任何规划进度文字 —— ` +
        `说明 SSE 事件又被积压到最后一次性发出了（planning 与 card 同时涌出）`
    ).toBeGreaterThanOrEqual(1)

    // 🔴 核心断言二：必须走到终态，不能一直转圈。
    //    「一直转圈」正是用户报的那个现象
    expect(reachedTerminal, '等待 8 分钟仍未产出草稿卡片或回答，规划没有收敛').toBe(true)

    // 🔴 核心断言三：不能是「轮次耗尽仍未能生成合法 DSL」那种失败。
    //    那是生成-校验-自修正循环无法收敛的症状（WORKFLOW_PLAN_DSL_GENERATION_FAILED）
    const bodyText = await page.locator('[data-testid="assistant-scroll"]').textContent()
    expect(bodyText).not.toContain('复杂需求拆解为 Workflow DSL 失败')

    // 终态之后流必须已经收尾：「停止」按钮消失，否则前端还认为在生成中
    await expect(page.getByRole('button', { name: /停止/ })).toHaveCount(0, { timeout: 30_000 })

    // 走到草稿卡片的话，卡片里必须有至少一个节点预览 ——
    // 空卡片是「DSL 解析不出 nodes 还放过去」的症状
    const hasDraftCard = await draftCard.isVisible().catch(() => false)
    if (hasDraftCard) {
      await expect(draftCard.getByText('待确认')).toBeVisible()
      const nodeRows = draftCard.locator('[data-testid="workflow-node"]')
      expect(await nodeRows.count(), '草稿卡片里一个节点都没有').toBeGreaterThanOrEqual(1)
    }

    // ===================================================================
    // 🔴 刷新之后卡片必须还在
    //
    // 这一段守的是另一个真缺陷：后端 RespVO 里<b>曾经压根没有关联字段</b>，
    // 而前端 loadMessages 靠它去重建卡片。拿不到就走「普通消息」分支 ——
    // 刷新页面后那张「待确认」卡片退化成一段纯文字，没有节点预览、没有确认按钮，
    // 流程<b>再也发布不了</b>，而且全程没有任何报错。
    // 增量7b 后这个字段是 workflowDefId，重建走 /agent/planner/workflow-draft。
    // ===================================================================
    if (hasDraftCard) {
      const summaryBefore = ((await draftCard.locator('span').nth(1).textContent()) ?? '').trim()
      await page.reload()
      await expect(page.locator('[data-testid="workflow-draft-card"]')).toBeVisible({
        timeout: 60_000
      })
      const cardAfter = page.locator('[data-testid="workflow-draft-card"]')
      await expect(cardAfter.getByText('待确认')).toBeVisible()
      expect(
        await cardAfter.locator('[data-testid="workflow-node"]').count(),
        '刷新之后草稿卡片的节点没了 —— workflowDefId 没能从消息列表里带回来'
      ).toBeGreaterThanOrEqual(1)
      if (summaryBefore) {
        await expect(cardAfter).toContainText(summaryBefore.slice(0, 20))
      }

      // ===================================================================
      // 🔴 确认并运行：闭环的最后一段
      //
      // 点「确认并运行」→ publish-workflow（DRAFT→PUBLISHED）→ run-stream（既有引擎）。
      // 断言卡片走到一个运行终态（运行完成 / 运行失败 / 已挂起），而不是一直「运行中」。
      // 这一步证明：聊天里生成的草稿，确认之后真的能被既有 Workflow 引擎跑起来。
      // ===================================================================
      await cardAfter.getByRole('button', { name: /确认并运行/ }).click()
      const runTerminal = cardAfter.locator('.el-alert')
      await expect(
        runTerminal.filter({ hasText: /运行完成|运行失败|已挂起/ }).first()
      ).toBeVisible({ timeout: 120_000 })
    }

    expect(pageErrors, `页面出现未捕获异常：${pageErrors.join(' / ')}`).toHaveLength(0)
  })
})
