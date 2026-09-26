import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * Agent 定义管理页 端到端验证（增量9 / P5 第一刀：Agent Builder 目录管理面）
 *
 * 🔴 为什么非要走浏览器
 * 后端 curl 已证 7 端点 + 状态机全通，但「菜单点开是空白页」这类缺陷只在真实 DOM 里暴露
 * （本刀新建了 agent/def/index + 新挂了「Agent 定义」菜单，动态路由能否解析到组件、表格能否渲染
 * 出后端数据、表单弹窗能否提交、发布/停用能否翻 tag，都要浏览器里走一遍）。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。
 * 本 spec 全程通过 UI 自建数据（不预播种），用时间戳保证 code 唯一，跑完自清理（删草稿）。
 *
 * 判据：菜单非空白 → 列表页渲染 → 新建表单落库出 DRAFT 行 → 发布翻「已发布」→ 停用翻「已停用」→
 *       再建一条草稿并删除成功。
 */

const CODE = `e2e_def_${Date.now().toString().slice(-8)}`

test.describe('Agent 定义管理页', () => {
  test.setTimeout(180_000)

  test('菜单非空白 + 新建 → 发布 → 停用 → 删除草稿 全生命周期', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/def')

    // 页面非空白：搜索表单在
    await expect(page.getByText('Agent 编码').first()).toBeVisible({ timeout: 20000 })

    // 新建
    await page.getByRole('button', { name: /新增 Agent/ }).first().click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新建 Agent 定义' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })

    // code / name / persona 三个必填
    await dialog.locator('.el-form-item:has-text("Agent 编码") input').first().fill(CODE)
    await dialog.locator('.el-form-item:has-text("名称") input').first().fill('E2E 测试助手')
    await dialog
      .locator('.el-form-item:has-text("人设") textarea')
      .first()
      .fill('你是一个用于端到端测试的助手，请友好地回答。')

    await dialog.getByRole('button', { name: /保存草稿|保存/ }).first().click()
    await expect(page.locator('.el-message').filter({ hasText: /成功/ }).first()).toBeVisible({
      timeout: 15000
    })

    // 列表出现新行，状态=草稿
    const row = page.locator('.el-table__body tr').filter({ hasText: CODE }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row.getByText('草稿')).toBeVisible({ timeout: 15000 })

    // 发布
    await row.getByRole('button', { name: '发布' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /发布成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(
      page.locator('.el-table__body tr').filter({ hasText: CODE }).first().getByText('已发布')
    ).toBeVisible({ timeout: 15000 })

    // 停用
    await page
      .locator('.el-table__body tr')
      .filter({ hasText: CODE })
      .first()
      .getByRole('button', { name: '停用' })
      .first()
      .click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /停用成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(
      page.locator('.el-table__body tr').filter({ hasText: CODE }).first().getByText('已停用')
    ).toBeVisible({ timeout: 15000 })
  })

  test('草稿可删除（清理本 spec 造的数据）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/def')

    const CODE2 = `e2e_del_${Date.now().toString().slice(-8)}`
    await page.getByRole('button', { name: /新增 Agent/ }).first().click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新建 Agent 定义' }).first()
    await dialog.locator('.el-form-item:has-text("Agent 编码") input').first().fill(CODE2)
    await dialog.locator('.el-form-item:has-text("名称") input').first().fill('待删助手')
    await dialog.locator('.el-form-item:has-text("人设") textarea').first().fill('临时人设，用于验证删除。')
    await dialog.getByRole('button', { name: /保存草稿|保存/ }).first().click()
    await expect(page.locator('.el-message').filter({ hasText: /成功/ }).first()).toBeVisible({
      timeout: 15000
    })

    const row = page.locator('.el-table__body tr').filter({ hasText: CODE2 }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: '删除' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /删除成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: CODE2 })).toHaveCount(0, {
      timeout: 15000
    })
  })
})
