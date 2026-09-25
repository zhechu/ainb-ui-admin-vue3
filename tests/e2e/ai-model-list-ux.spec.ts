import { expect, test } from '@playwright/test'
import { API_BASE_URL, apiHeaders, apiLogin, gotoWithAuth } from './helpers/auth'

/**
 * 模型列表页 UX 改动的走查：序号列、状态筛选、平台字典下拉
 */
test.describe('AI 模型列表页', () => {
  test('序号列 + 状态筛选 + 平台下拉', async ({ page, request }) => {
    await gotoWithAuth(page, '/ai/console/model')

    // ① 序号列存在且从 1 开始
    const indexCells = page.locator('td.col-index')
    await expect(indexCells.first()).toHaveText('1')

    // ② 平台搜索是下拉（字典），不是输入框
    const platformSelect = page
      .locator('.el-form-item', { hasText: '模型平台' })
      .locator('.el-select')
    await expect(platformSelect).toBeVisible()
    await platformSelect.click()
    await expect(page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first()).toBeVisible()
    await page.keyboard.press('Escape')

    // ③ 状态筛选：选「开启」后所有行状态都是开启
    const statusSelect = page.locator('.el-form-item', { hasText: '状态' }).locator('.el-select')
    await expect(statusSelect).toBeVisible()
    await statusSelect.click()
    await page
      .locator('.el-select-dropdown:visible .el-select-dropdown__item', { hasText: '开启' })
      .first()
      .click()
    await page.getByRole('button', { name: /搜索/ }).click()
    await page.waitForLoadState('networkidle')
    const rows = page.locator('.el-table__body-wrapper tbody tr')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).locator('.el-tag', { hasText: '开启' }).first()).toBeVisible()
    }

    // ④ 接口层：status=0 返回的记录全部为开启，且与页面一致
    const token = await apiLogin(request)
    const resp = await request.get(`${API_BASE_URL}/ai/model/page?pageNo=1&pageSize=100&status=0`, {
      headers: apiHeaders(token)
    })
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.code).toBe(0)
    expect(body.data.list.length).toBe(count)
    for (const item of body.data.list) {
      expect(item.status).toBe(0)
    }
  })
})
