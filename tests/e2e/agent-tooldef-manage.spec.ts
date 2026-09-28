import { test, expect } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 工具管理页端到端验证（AI助手 问题2 + 2026-09-28 增量：内置工具在线维护）
 *
 * 🔴 为什么非要走浏览器：本页是全新页面（双 tab：内置工具维护 + 自定义工具 CRUD + 结构化 HTTP 配置弹窗 +
 *   凭据脱敏闭环），接口层只能证 CRUD 通，证不了「菜单真出现、内置 tab 真列出代码工具、维护弹窗真回显代码默认、
 *   保存后真显示『维护中/停用』、恢复默认真退回、自定义弹窗真渲染结构化字段」——这些只有真实 DOM 才暴露。
 *   本模块头号缺陷「配了/点了但不生效且无提示」正是这类管理页最易踩的坑，故必须浏览器实测。
 *
 * 前置：后端 48080（已 apply xpy-2026-09-28-agent-tool-def-menu.sql + xpy-2026-09-28-agent-tool-override.sql
 *   并重启，菜单/权限/覆盖表生效）+ 前端 dev server。
 * 数据自净：内置维护用例末尾「恢复默认」；自定义用例建一条 e2e 专用工具、末尾删除。
 */

const TOOL_KEY = 'e2e_tooldef_ui'
const LIST_URL = /\/agent\/tooldef$/
const URL_PLACEHOLDER = '如 https://api.example.com/orders，可用 {{参数名}} 占位'
const TOOLKEY_PLACEHOLDER = '小写字母开头，仅含小写字母/数字/下划线，如 health_ping'

test.describe('工具管理页（内置工具在线维护）', () => {
  test.setTimeout(120_000)

  test('内置 tab 列出代码工具 + 维护即时生效（维护中/停用）+ 恢复默认', async ({ page, request }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/tooldef')
    await page.waitForURL(LIST_URL, { timeout: 15000 })

    // 1. 默认停在「内置工具」tab，且列出 ≥20 个代码工具
    await expect(page.getByRole('tab', { name: '内置工具' })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15000 })
    const rowCount = await page.locator('.el-table__row').count()
    expect(rowCount, `内置工具应 ≥20 行，实际 ${rowCount}`).toBeGreaterThanOrEqual(20)

    // 2. 取第一行的工具名作为维护目标（注册表顺序稳定）
    const firstRow = page.locator('.el-table__row').first()
    const toolName = (await firstRow.locator('td').first().innerText()).trim()
    expect(toolName).toBeTruthy()

    // 自净前置：先用接口清掉可能残留的覆盖，确保从「默认」态开始（避免上次失败留脏）
    const token = await apiLogin(request)
    await request.delete(
      `${API_BASE_URL}/agent/tool-def/registered-reset?toolName=${encodeURIComponent(toolName)}`,
      { headers: apiHeaders(token) }
    )
    await page.getByRole('button', { name: /刷新/ }).first().click()
    await expect(
      page.locator('.el-table__row').filter({ hasText: toolName }).first()
    ).toBeVisible({ timeout: 15000 })

    // 3. 打开「维护」弹窗：标题带工具名，回显代码默认（声明值）作为帮助行，顶部有安全提示
    await page
      .locator('.el-table__row')
      .filter({ hasText: toolName })
      .first()
      .getByRole('button', { name: '维护' })
      .click()
    const dialog = page.locator('.el-dialog').filter({ hasText: `维护内置工具 · ${toolName}` }).last()
    await expect(dialog).toBeVisible({ timeout: 15000 })
    await expect(dialog.locator('.el-alert').first()).toBeVisible()
    await expect(dialog.getByText(/代码默认：/).first()).toBeVisible()

    // 4. 改展示名 + 关启用
    await dialog.getByPlaceholder(`留空=用工具名（${toolName}）`).fill('E2E 维护展示名')
    const enableSwitch = dialog
      .locator('.el-form-item')
      .filter({ hasText: '启用' })
      .locator('.el-switch')
      .first()
    const switchClass = await enableSwitch.getAttribute('class')
    if (switchClass && switchClass.includes('is-checked')) {
      await enableSwitch.click()
    }
    await dialog.getByRole('button', { name: /保存并生效/ }).click()
    await expect(dialog).toBeHidden({ timeout: 15000 })

    // 5. 该行立即显示「维护中」+「停用」+ 新展示名（列表由 @success 自动重载）
    const row = page.locator('.el-table__row').filter({ hasText: toolName }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row.getByText('维护中')).toBeVisible()
    await expect(row.getByText('停用', { exact: true })).toBeVisible()
    await expect(row).toContainText('E2E 维护展示名')

    // 6. 恢复默认 → 「维护中」消失、回到「默认」、展示名退回工具名
    await row.getByRole('button', { name: '恢复默认' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(row.getByText('维护中')).toHaveCount(0, { timeout: 15000 })
    await expect(row.getByText('默认', { exact: true })).toBeVisible({ timeout: 15000 })
    await expect(row.getByText('E2E 维护展示名')).toHaveCount(0, { timeout: 15000 })
  })
})

test.describe('工具管理页（用户自定义工具）', () => {
  test.setTimeout(120_000)

  test('菜单出现 + 新增（结构化 HTTP 配置）+ 编辑凭据脱敏 + 删除', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/tooldef')
    await page.waitForURL(LIST_URL, { timeout: 15000 })

    // 1. 侧栏菜单「工具管理」存在（菜单 SQL 生效的直接证据）
    await expect(page.getByText('工具管理', { exact: true }).first()).toBeVisible({ timeout: 15000 })

    // 2. 切到「自定义工具」tab（默认停在内置工具）
    await page.getByRole('tab', { name: '自定义工具' }).click()

    // 3. 列表页渲染：新增按钮
    await expect(page.getByRole('button', { name: /新增工具/ }).first()).toBeVisible({ timeout: 15000 })

    // 4. 新增工具：结构化填基本信息 + HTTP 配置 + Bearer 鉴权
    await page.getByRole('button', { name: /新增工具/ }).first().click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新增工具' }).last()
    await expect(dialog).toBeVisible({ timeout: 15000 })
    await dialog.getByPlaceholder('如：健康探测').fill('E2E 工具页验证')
    await dialog.getByPlaceholder(TOOLKEY_PLACEHOLDER).fill(TOOL_KEY)
    await dialog.getByPlaceholder(URL_PLACEHOLDER).fill('https://example.com/e2e')
    // 鉴权方式切到 Bearer Token → 出现 Token 输入框（placeholder 为「请输入 Token」，因尚未配置）
    await dialog.locator('.el-form-item').filter({ hasText: '鉴权方式' }).locator('.el-select').click()
    await page.locator('.el-select-dropdown__item').filter({ hasText: 'Bearer Token' }).first().click()
    const tokenInput = dialog.getByPlaceholder('请输入 Token')
    await expect(tokenInput).toBeVisible({ timeout: 10000 })
    await tokenInput.fill('e2e-secret-token')
    await dialog.getByRole('button', { name: /确\s*定/ }).click()

    // 5. 列表出现新工具（工具键 + 展示名）
    const row = page.locator('.el-table__row').filter({ hasText: TOOL_KEY })
    await expect(row.first()).toBeVisible({ timeout: 15000 })
    await expect(row.first()).toContainText('E2E 工具页验证')

    // 6. 编辑：Bearer Token 输入框为空、placeholder=「已配置（留空则不修改）」（脱敏闭环）
    await row.first().getByRole('button', { name: '编辑' }).click()
    const editDialog = page.locator('.el-dialog').filter({ hasText: '编辑工具' }).last()
    await expect(editDialog).toBeVisible({ timeout: 15000 })
    const editToken = editDialog.getByPlaceholder('已配置（留空则不修改）')
    await expect(editToken).toBeVisible({ timeout: 10000 })
    await expect(editToken).toHaveValue('')
    await expect(editDialog.getByPlaceholder(TOOLKEY_PLACEHOLDER)).toBeDisabled()

    // 7. 不改凭据直接保存 → 成功（后端用旧值回填，工具仍可用）
    await editDialog.getByRole('button', { name: /确\s*定/ }).click()
    await expect(editDialog).toBeHidden({ timeout: 15000 })
    await expect(page.locator('.el-table__row').filter({ hasText: TOOL_KEY }).first()).toBeVisible({
      timeout: 15000
    })

    // 8. 删除 → 列表不再出现（数据自净）
    await page
      .locator('.el-table__row')
      .filter({ hasText: TOOL_KEY })
      .first()
      .getByRole('button', { name: '删除' })
      .click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-table__row').filter({ hasText: TOOL_KEY })).toHaveCount(0, {
      timeout: 15000
    })
  })
})
