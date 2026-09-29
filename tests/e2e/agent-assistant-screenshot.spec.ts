import { test, expect } from '@playwright/test'

/** 截一张完成态的图，人工核对渲染效果 */
test('截图：助手回答完成态', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  if (page.url().includes('/login')) {
    await page.fill('input[placeholder*="账号"], input[placeholder*="用户名"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.getByRole('button', { name: /登录|登 录/ }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 })
  }
  await page.goto('/ai/agent/assistant')
  await expect(page.getByText('我是平台助手')).toBeVisible({ timeout: 20000 })
  await page
    .locator('.el-tag__content')
    .filter({ hasText: '为什么我配的联动不生效' })
    .first()
    .click()
  await expect(page.locator('[data-testid="assistant-answer"]').last()).toContainText('otherwise', {
    timeout: 90000
  })
  await expect(page.getByText('知识引用')).toBeVisible({ timeout: 30000 })
  // 等流真正结束（「停止」按钮换回「发送」），否则截到的是半截回答
  await expect(page.getByRole('button', { name: /发送/ })).toBeVisible({ timeout: 90000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'test-results/agent-assistant-done.png', fullPage: false })
})
