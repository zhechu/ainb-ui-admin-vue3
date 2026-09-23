import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 全局悬浮助手入口的端到端验证（方案 §12「悬浮唤起 + 独立页面两种入口」）
 *
 * 🔴 为什么非要走浏览器
 * 这个入口的价值全在「在别的页面上也能用」。而它有三个只有真跑一遍才看得出来的失败模式：
 *   ① 悬浮球被别的固定定位元素遮住 / 点不到（z-index、Backtop 重叠）
 *   ② 抽屉打开了，但里面的对话区高度塌了、输入框被挤出可视区
 *   ③ 抽屉里的那份对话与独立页那份<b>行为不一致</b>（复用组件没复用成功）
 * 这三条接口测试与单测一条都覆盖不到。
 *
 * 前置：后端 48080 与前端 dev server 同时在跑。
 */

test.describe('AI 助手 · 全局悬浮入口', () => {
  test.setTimeout(120_000)

  test('在业务页面上唤起：悬浮球可点、抽屉里是完整可用的对话区', async ({ page }) => {
    await login(page)
    // 刻意挑一个与助手无关的业务页面 —— 这正是它存在的意义：
    // 用户卡在某个页面上时，不必离开就能问
    await gotoWithAuth(page, '/infra/data-manage/data-model')

    // 1. 悬浮球应当出现，并且真的可以点到（被遮住的话 click 会超时）
    const ball = page.locator('[data-testid="agent-dock-ball"]')
    await expect(ball).toBeVisible({ timeout: 20000 })
    await ball.click()

    // 2. 抽屉里是完整的对话区：空态引导 + 输入框 + 发送按钮
    //    ⚠️ 必须用 .agent-dock-drawer 而不是 .el-drawer —— Layout 里还挂着
    //    「项目配置」那个抽屉，笼统匹配会 strict mode violation
    const drawer = page.locator('.agent-dock-drawer')
    await expect(drawer).toBeVisible({ timeout: 10000 })
    await expect(drawer.getByText('我是平台助手')).toBeVisible({ timeout: 20000 })

    const input = drawer.locator('textarea')
    await expect(input).toBeVisible()
    // 🔴 输入框必须在可视区内。抽屉高度算错时它会被挤到屏幕外 ——
    //    界面看着正常，但用户根本没法打字
    const box = await input.boundingBox()
    expect(box, '输入框拿不到位置，说明它没被渲染出来').not.toBeNull()
    const viewport = page.viewportSize()!
    expect(box!.y + box!.height, '输入框被挤出了可视区').toBeLessThanOrEqual(viewport.height)

    // 3. 引导问题也要在（它是空态里唯一的行动指引）
    await expect(
      drawer.locator('.el-tag__content').filter({ hasText: '为什么我配的联动不生效' }).first()
    ).toBeVisible({ timeout: 20000 })

    // 4. 收起后悬浮球还在，可以再次唤起
    await drawer.locator('[data-testid="agent-dock-close"]').click()
    await expect(drawer).not.toBeVisible({ timeout: 10000 })
    await expect(ball).toBeVisible()
  })

  test('🔴 助手独立页上整块不渲染 —— 否则页面与浮层里各有一个对话组件', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/assistant')
    await expect(page.getByText('我是平台助手').first()).toBeVisible({ timeout: 20000 })

    await expect(page.locator('[data-testid="agent-dock-ball"]')).toHaveCount(0)
    // 🔴 光藏球不够：抽屉不摘掉的话，里面的 AssistantChat 仍然挂在 DOM 上，
    //    两份组件各持有一条 SSE 连接与一个打字机定时器。实测踩到过
    await expect(page.locator('.agent-dock-drawer')).toHaveCount(0)
    await expect(page.getByText('我是平台助手')).toHaveCount(1)
  })

  test('抽屉里点「展开」跳到独立页，浮层那份随之消失', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/infra/data-manage/data-model')

    await page.locator('[data-testid="agent-dock-ball"]').click()
    await expect(page.locator('.agent-dock-drawer')).toBeVisible({ timeout: 10000 })

    await page.locator('[data-testid="agent-dock-expand"]').click()
    await page.waitForURL(/\/agent\/assistant/, { timeout: 20000 })
    await expect(page.getByText('我是平台助手').first()).toBeVisible({ timeout: 20000 })
    // 跳过去之后浮层那一份必须整个消失，否则就成了「页面里一个、浮层里还有一个」
    await expect(page.locator('[data-testid="agent-dock-ball"]')).toHaveCount(0)
    await expect(page.locator('.agent-dock-drawer')).toHaveCount(0)
    await expect(page.getByText('我是平台助手')).toHaveCount(1)
  })
})
