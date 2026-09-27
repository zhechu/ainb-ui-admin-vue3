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

  /**
   * 增量12 / slice-3b 批次 B4c：工具多选的「表单 ↔ VO」往返（0 LLM token）
   *
   * 🔴 为什么非走浏览器不可：curl 差分已证后端 create/get 对 tool_keys 的持久化+规范化+发布期只读校验，
   * 但「多选控件绑逗号串」这条前端适配（selectedTools computed get/set + open() 回填 toolKeys）只在真实 DOM 里暴露。
   * 若 set 没把数组拼回 formData.toolKeys、或 open() 漏了 `toolKeys: data.toolKeys ?? ''`，
   * 表现为「选了工具保存成功、重新打开却空了」——正是本平台头号反模式「配置保存成功但不生效」，且单测/curl 全绿。
   * 判据：新建时选一个只读工具 → 保存草稿 → 重新编辑 → 该工具仍选中 → 删草稿清理。
   */
  test('工具多选绑定 → 保存 → 重新编辑仍选中（B4c toolKeys 往返，0 token）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/def')
    await expect(page.getByText('Agent 编码').first()).toBeVisible({ timeout: 20000 })

    const CODE3 = `e2e_tool_${Date.now().toString().slice(-8)}`
    await page.getByRole('button', { name: /新增 Agent/ }).first().click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新建 Agent 定义' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })
    await dialog.locator('.el-form-item:has-text("Agent 编码") input').first().fill(CODE3)
    await dialog.locator('.el-form-item:has-text("名称") input').first().fill('E2E 工具助手')
    await dialog
      .locator('.el-form-item:has-text("人设") textarea')
      .first()
      .fill('你是工具往返测试助手。')

    // 绑定一个只读工具：下拉只列 requireConfirm===false 的工具，故 data_interface_list 必在列
    // 🔴 这版 Element Plus 的多选把 .el-select__placeholder 盖在 input 上，直接点 input 会被「拦截指针事件」；
    //    改点 .el-select 容器（placeholder 是其后代，不算拦截）开菜单，再对 filter input 用 fill 触发过滤
    const toolItem = dialog.locator('.el-form-item:has-text("工具")').first()
    await toolItem.locator('.el-select').first().click()
    await toolItem.locator('input').first().fill('data_interface_list')
    const option = page
      .locator('.el-select-dropdown__item:visible')
      .filter({ hasText: 'data_interface_list' })
      .first()
    await expect(option).toBeVisible({ timeout: 10000 })
    await option.click()
    // 选中后控件内出现该工具的 tag（证明 set 把数组写进了 formData.toolKeys）
    await expect(
      toolItem.locator('.el-tag').filter({ hasText: 'data_interface_list' }).first()
    ).toBeVisible({ timeout: 10000 })

    await dialog.getByRole('button', { name: /保存草稿|保存/ }).first().click()
    await expect(page.locator('.el-message').filter({ hasText: /成功/ }).first()).toBeVisible({
      timeout: 15000
    })

    // 重新打开编辑：工具应仍选中（证明 open() 回填了 toolKeys，往返无丢失）
    const row = page.locator('.el-table__body tr').filter({ hasText: CODE3 }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: '编辑' }).first().click()
    const editDialog = page
      .locator('.el-dialog')
      .filter({ hasText: '编辑 Agent 定义（草稿）' })
      .first()
    await expect(editDialog).toBeVisible({ timeout: 15000 })
    await expect(
      editDialog
        .locator('.el-form-item:has-text("工具") .el-tag')
        .filter({ hasText: 'data_interface_list' })
        .first()
    ).toBeVisible({ timeout: 15000 })

    // 清理：关闭编辑弹窗 + 删除草稿
    await editDialog.getByRole('button', { name: /取消|关闭/ }).first().click()
    await expect(editDialog).toBeHidden({ timeout: 10000 })
    await row.getByRole('button', { name: '删除' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /删除成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: CODE3 })).toHaveCount(0, {
      timeout: 15000
    })
  })
})
