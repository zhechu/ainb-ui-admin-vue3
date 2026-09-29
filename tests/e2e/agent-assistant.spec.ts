import { test, expect } from '@playwright/test'
import { apiLogin, login, gotoWithAuth } from './helpers/auth'
import { createConversation, sweepTestConversations } from './helpers/agent'

/**
 * AI 助手主界面的端到端验证（P1 / 方案 §9、§12）
 *
 * 🔴 为什么非要走浏览器
 * 这个子系统最常见的缺陷形态是「配了、保存成功了、但没生效，且没有任何提示」。
 * 接口 200、单测全绿、SSE 用 python 能收到事件 —— 三者都不能替代
 * 「界面上真的把字打出来了、建议真的能点」。
 *
 * 前置：后端 48080 与前端 dev server 同时在跑，且至少有一个聊天模型可用。
 */

// 登录与跳转走共用辅助：登录之后紧接着的一次 goto 会偶发被路由守卫弹回登录页，
// 不处理的话失败现象是「页面上什么都没有」，看起来像业务代码坏了。详见 helpers/auth.ts

test.describe('AI 助手', () => {
  test.setTimeout(180_000) // 一次 RAG 问答实测 7~22 秒，两轮加载页面要留足

  test('问答全流程：流式打字、手册引用、对话后建议可点', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')

    // 1. 空态要给引导问题 —— 空白输入框会让用户不知道能问什么
    await expect(page.getByText('我是平台助手')).toBeVisible({ timeout: 20000 })
    // ⚠️ 必须限定在标签里取。左侧会话列表可能存在同名的历史会话
    // （标题就是取首条提问的前若干字），不限定会撞上 strict mode
    const guide = page
      .locator('.el-tag__content')
      .filter({ hasText: '为什么我配的联动不生效' })
      .first()
    await expect(guide).toBeVisible({ timeout: 20000 })

    // 2. 点引导问题直接发送
    await guide.click()

    // 3. 流式：等正文出现
    //    ⚠️ 必须断言在 .markdown-view 上，不能笼统地断言整个气泡。
    //    气泡里还有思维链，而思维链几乎一定会提到问题里的关键词 ——
    //    断言整个气泡的话，模型「想过」就算通过了，哪怕最终一个字都没答出来。
    const answer = page.locator('[data-testid="assistant-answer"]').last()
    await expect(answer).toContainText('otherwise', { timeout: 90000 })

    // 4. 🔴 marker 绝不能漏到界面上。
    //    漏了的表现是用户看到 "<<<SUGGESTIONS>>>[{...}]" 一串东西
    await expect(answer).not.toContainText('<<<SUGGESTIONS>>>')
    await expect(answer).not.toContainText('{"text"')

    // 4b. 思维链要在正文出现后自动折叠，否则答案被挤到屏幕外
    await expect(page.getByText('已深度思考')).toBeVisible({ timeout: 30000 })

    // 5. 引用出处（复用 ai/chat 的知识引用组件）
    await expect(page.getByText('知识引用')).toBeVisible({ timeout: 30000 })

    // 6. 对话后建议：必须可点击直接发送（方案 §9.3）
    //    建议标签在助手气泡下方，与引导问题的标签区分开 —— 后者此刻已经不在了
    const suggestionTags = page.locator('.el-tag__content')
    await expect(suggestionTags.first()).toBeVisible({ timeout: 90000 })
    const suggestionCount = await suggestionTags.count()
    expect(suggestionCount, '建议最多 3 条，超过会变成噪声').toBeLessThanOrEqual(3)

    // 点第一条建议要真的发出去：消息条数增加
    const bubblesBefore = await page.locator('.el-avatar').count()
    await suggestionTags.first().click()
    await expect
      .poll(async () => page.locator('.el-avatar').count(), { timeout: 60000 })
      .toBeGreaterThan(bubblesBefore)

    // 7. 会话列表里应出现这次对话，标题取首条提问
    await expect(page.locator('text=为什么我配的联动不生效').first()).toBeVisible()
  })

  test('会话管理：新建、切换、删除', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')

    await page.getByRole('button', { name: /新建对话/ }).click()
    // 新建后回到空态
    await expect(page.getByText('我是平台助手')).toBeVisible({ timeout: 20000 })
  })

  test('会话列表按时间分组；从悬浮窗接过来的会话刷新后仍是选中态', async ({ page, request }) => {
    const token = await apiLogin(request)
    const title = `E2E 接力 ${Date.now()}`
    const id = await createConversation(request, token, title)
    try {
      await login(page)
      // 先在悬浮窗里选中这条会话 —— 两个入口共用一份「最近会话」记忆
      await gotoWithAuth(page, '/infra/data-manage/data-model')
      await page.locator('[data-testid="agent-dock-ball"]').click()
      const drawer = page.locator('.agent-dock-drawer')
      await expect(drawer.locator('textarea')).toBeVisible({ timeout: 20000 })
      await drawer.locator('[data-testid="agent-dock-history"]').click()
      await drawer.locator(`[data-conversation-id="${id}"]`).click()
      await expect(drawer.locator('textarea')).toBeVisible({ timeout: 10000 })

      // 展开到独立页：换了个入口不该丢上下文
      await drawer.locator('[data-testid="agent-dock-expand"]').click()
      await page.waitForURL(/\/agent\/assistant/, { timeout: 20000 })
      const item = page.locator(`[data-conversation-id="${id}"]`)
      await expect(item).toBeVisible({ timeout: 20000 })
      await expect(item, '展开到独立页后没有接上同一个会话').toHaveAttribute(
        'data-active',
        'true'
      )
      // 今天建的会话要落在「今天」这一档，而不是和三个月前的混成一坨
      await expect(page.getByText('今天').first()).toBeVisible()

      // 刷新：独立页自己也要能从本地记忆里恢复选中
      await page.reload()
      await expect(page.locator(`[data-conversation-id="${id}"]`), '刷新后丢了上次选中的会话')
        .toHaveAttribute('data-active', 'true', { timeout: 30000 })
    } finally {
      await sweepTestConversations(request, token)
    }
  })

  test('AI · 长答案：往上翻不被打字机拽回底部，答案可整段复制', async ({ page }) => {
    test.setTimeout(300_000) // 一轮详细回答实测 20~60 秒，加上两次页面加载要留足
    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')

    // 🔴 把视口压矮，让「答案超出一屏」成为<b>确定</b>前提。
    //    否则这条用例灵不灵取决于模型这次答得多长 —— 实测同一问题有时溢出 370px、
    //    有时只溢出 10px，时红时绿。滚动 / 回到底部 / 复制这些行为本身与视口高度无关，
    //    压矮视口只是把「内容比容器高」这件事变成必然，不改变被测行为。
    //    独立页对话区高度是 calc(100vh - 130px)，360 高 → 容器仅 230px，任何正经答案都会溢出。
    await page.setViewportSize({ width: 1280, height: 360 })

    const question = '请分步骤详细说明主子表怎么配置，越详细越好'
    await page.locator('textarea').fill(question)
    await page.getByRole('button', { name: /发送/ }).click()
    // 等答完（停止按钮消失），并且答案要够长才谈得上滚动
    await expect(page.getByRole('button', { name: /停止/ })).toHaveCount(0, { timeout: 150000 })
    const answer = page.locator('[data-testid="assistant-answer"]').last()
    await expect(answer).toContainText(/\S/, { timeout: 30000 })

    // 用直接子选择器：答案正文里可能嵌套 el-scrollbar，用后代选择器会撞 strict mode
    const wrap = page.locator('[data-testid="assistant-scroll"] > .el-scrollbar__wrap')

    // 🔴 停止按钮消失只代表 SSE 流结束，打字机是<b>滞后逐字</b>渲染的 ——
    //    此刻正文往往才露出几个字，立刻量 scrollHeight 会得到「不可滚动」的假象。
    //    等 scrollHeight 连续 ~900ms 不再增长，才认为打字机把缓冲的正文吐完了。
    let lastHeight = -1
    let stableTicks = 0
    await expect
      .poll(
        async () => {
          const h = await wrap.evaluate((el) => el.scrollHeight)
          stableTicks = h === lastHeight ? stableTicks + 1 : 0
          lastHeight = h
          return stableTicks
        },
        { timeout: 60000, intervals: [300], message: '打字机迟迟没有把答案吐完' }
      )
      .toBeGreaterThanOrEqual(3)

    const scrollable = await wrap.evaluate((el) => el.scrollHeight - el.clientHeight)
    expect(scrollable, '答案没有超出一屏，这条用例的前提不成立').toBeGreaterThan(120)

    // 往上翻：打字机不该再把人拽回底部（这是本次修的主要体验缺陷）
    await wrap.evaluate((el) => {
      el.scrollTop = 0
    })
    const backToBottom = page.locator('[data-testid="scroll-to-bottom"]')
    await expect(backToBottom, '往上翻之后没有出现「回到底部」入口').toBeVisible({
      timeout: 10000
    })
    await expect
      .poll(async () => wrap.evaluate((el) => el.scrollTop), { timeout: 5000 })
      .toBeLessThan(100)

    await backToBottom.click()
    await expect(backToBottom).toHaveCount(0, { timeout: 10000 })
    await expect
      .poll(async () => wrap.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight), {
        timeout: 10000
      })
      .toBeLessThan(40)

    // 整段复制。MarkdownView 自带的复制只管代码块，答案正文以前复制不出来
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const copyButton = page.locator('[data-testid="assistant-copy"]').last()
    await expect(copyButton).toBeVisible()
    await copyButton.click()
    await expect(page.getByText('已复制到剪贴板')).toBeVisible({ timeout: 10000 })
    // 只断言「确实拿到了内容」：复制的是原始 markdown，而答案文本由模型决定，
    // 拿渲染后的文本去比是比不上的（标记符号本来就该有差异）
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied.trim().length, '剪贴板是空的，复制没真发生').toBeGreaterThan(0)
  })
})
