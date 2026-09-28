import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 流程编排「新增弹窗 → 整页设计器」端到端验证（6 项优化 Phase A/B/C/D 重构后）
 *
 * 🔴 为什么重写：本模块原先是「列表『新增流程』按钮直跳整页设计器（内嵌 1515 行巨型画布）」。
 *   6 项优化后改为：列表『新增』→ 元信息弹窗（名称/编码/触发/模板）→ 建草稿 → 跳门户式三栏设计器
 *   （左目录 / 中画布 / 右属性面板 + 顶栏撤销/重做/沙箱测试）。旧断言（『新增流程』直跳、.editor-json、
 *   .palette-item）已随重构失效，故整篇按新 UI 重写。
 *
 * 🔴 为什么非要走浏览器：接口/单测证不了「弹窗真能建草稿并跳设计器、三栏真渲染、VueFlow 不 0 高塌陷、
 *   点目录真加节点、撤销/重做真回退、沙箱抽屉真能打开」——这些只有真实 DOM 才暴露（本模块头号缺陷
 *   正是「配了/点了但不生效且无提示」）。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。
 * 数据自净：新建的草稿在最后回列表删除（用唯一 code 定位）。
 *
 * 判据：序号列在 → 『新增』弹窗 → 填名称/编码/示例骨架 → 确定 → 跳设计器 → 画布 ≥3 节点且非 0 高 →
 *       左目录在 → 开发者模式出底部 JSON → 点『大模型』节点 +1 且属性面板出结构化字段 →
 *       撤销节点回落 / 重做恢复 → 沙箱抽屉可开 → 回列表删除草稿。
 */

const LIST_URL = /\/agent\/workflow$/
const EDITOR_URL = /\/agent-workflow\/editor/

test.describe('流程编排：新增弹窗 → 整页设计器', () => {
  test.setTimeout(150_000)

  test('序号列 + 新增弹窗建草稿 → 三栏设计器 → 加节点/撤销重做 → 沙箱抽屉', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    // Req1：序号列（参考模型配置页）+「新增」按钮（不再是「新增流程」直跳设计器）
    await expect(page.getByRole('columnheader', { name: '序号' }).first()).toBeVisible({
      timeout: 20000
    })
    const addBtn = page.getByRole('button', { name: '新增', exact: true })
    await expect(addBtn).toBeVisible()

    // Req2：点「新增」→ 元信息弹窗（新增与设计分开）
    await addBtn.click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新增流程' }).first()
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const stamp = Date.now()
    const code = `wf_e2e_${stamp}`
    await dialog.locator('input[placeholder="请输入流程名称"]').fill(`E2E测试流程${stamp}`)
    await dialog.locator('input[placeholder*="小写字母开头"]').fill(code)
    await dialog.getByText('示例骨架', { exact: true }).click()
    await dialog.getByRole('button', { name: '确定', exact: true }).click()

    // 建草稿后跳整页设计器
    await page.waitForURL(EDITOR_URL, { timeout: 20000 })

    // Phase C：三栏设计器渲染。示例骨架 START→tool→END ≥3 节点，VueFlow 非 0 高（R1 回归守卫）
    const flowNodes = page.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 20000 })
    const initialCount = await flowNodes.count()
    expect(initialCount).toBeGreaterThanOrEqual(3)
    const flowBox = await page.locator('.vue-flow').first().boundingBox()
    expect(flowBox?.height ?? 0).toBeGreaterThan(100)
    // 左目录在
    await expect(page.locator('.wf-palette__item').first()).toBeVisible({ timeout: 10000 })

    // 开发者模式 → 底部流程 JSON 可见（新类名 .wf-designer__json）
    await page.locator('[data-testid="dev-mode-switch"]').click()
    const dslTextarea = page.locator('.wf-designer__json textarea').last()
    await expect(dslTextarea).toBeVisible({ timeout: 10000 })

    // 目录点「大模型」→ 节点 +1，属性面板自动选中并出结构化字段（提示词/模型）
    await page.locator('.wf-palette__item').filter({ hasText: '大模型' }).first().click()
    await expect(page.locator('.vue-flow__node')).toHaveCount(initialCount + 1, { timeout: 10000 })
    await expect(page.getByText('节点配置').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('提示词', { exact: true }).first()).toBeVisible({ timeout: 10000 })
    // 画布改动同步回底部流程 JSON（事实源）
    await expect(dslTextarea).toHaveValue(/"type":\s*"llm"/, { timeout: 10000 })

    // Phase C：撤销 → 节点数回落；重做 → 恢复
    await page.getByRole('button', { name: '撤销' }).click()
    await expect(page.locator('.vue-flow__node')).toHaveCount(initialCount, { timeout: 10000 })
    await page.getByRole('button', { name: '重做' }).click()
    await expect(page.locator('.vue-flow__node')).toHaveCount(initialCount + 1, { timeout: 10000 })

    // Phase D：沙箱测试抽屉能打开（不实际跑，避免消耗 token；运行链路由后端接口测试覆盖）
    await page.getByRole('button', { name: '沙箱测试' }).click()
    await expect(page.locator('[data-testid="sandbox-drawer"]')).toBeVisible({ timeout: 10000 })

    // 清理：硬跳回列表（绕过未保存改动守卫）→ 删除刚建的草稿（数据自净）
    await gotoWithAuth(page, '/agent/workflow')
    const row = page.locator('.el-table__body tr').filter({ hasText: code }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: '删除成功' }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: code })).toHaveCount(0, {
      timeout: 15000
    })
    await expect(page).toHaveURL(LIST_URL)
  })
})
