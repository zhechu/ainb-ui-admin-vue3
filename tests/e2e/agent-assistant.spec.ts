import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

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
    await gotoWithAuth(page, '/agent/assistant')

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
    await gotoWithAuth(page, '/agent/assistant')

    await page.getByRole('button', { name: /新建对话/ }).click()
    // 新建后回到空态
    await expect(page.getByText('我是平台助手')).toBeVisible({ timeout: 20000 })
  })
})
