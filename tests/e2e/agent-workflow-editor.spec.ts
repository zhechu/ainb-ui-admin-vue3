import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 流程「可视化编辑器」首刀端到端验证（增量14d / P4 可视化编辑器首刀）
 *
 * 🔴 为什么非要走浏览器
 * 这一刀新增可交互画布 WorkflowEditorDialog（Vue Flow 拖动/连线/选中 + 节点配置面板 + DSL 双向同步）。
 * 接口/单测（editorModel.spec.ts 11 例）证不了「对话框能开、VueFlow 不 0 高塌陷(R1)、点击目录真能加节点、
 * 选中节点配置面板真能弹出、画布改动能同步回底部 DSL JSON」——这些只有真实 DOM 才暴露。本模块头号缺陷
 * 「配了/点了但不生效且无提示」正是可视化编辑器最易踩的坑，故必须浏览器实测。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑；工具目录走 /agent/config/tool-list。
 * 数据自净：全程在「新建流程」表单里操作，最后取消，不落任何库数据。
 *
 * 判据：新增表单→「可视化编辑」按钮开编辑器 → 画布渲染骨架 ≥3 节点且非 0 高 → 点击目录「大模型」加节点
 *       → 节点数 +1、配置面板自动选中并显示名称 → 底部 DSL JSON 同步出现新节点 type=llm
 *       → 选中工具节点显示 toolId 下拉 → 取消不落库。
 */

test.describe('流程可视化编辑器（首刀）', () => {
  test.setTimeout(120_000)

  test('画布渲染 + 目录加节点 + 配置面板 + DSL 双向同步', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    // 1. 打开新建表单（预填最小合法骨架 START→tool→END）
    await page.getByRole('button', { name: '新增流程' }).click()
    const form = page.locator('.el-dialog').filter({ hasText: '新建流程定义' }).first()
    await expect(form).toBeVisible({ timeout: 15000 })

    // 2. 「可视化编辑」按钮存在并打开编辑器（用标题过滤，避开表单里同名按钮的干扰）
    await form.getByRole('button', { name: '可视化编辑' }).click()
    const editor = page
      .locator('.el-dialog')
      .filter({ has: page.locator('.el-dialog__title', { hasText: '可视化编辑' }) })
      .first()
    await expect(editor).toBeVisible({ timeout: 15000 })

    // 3. 画布渲染：骨架 ≥3 节点（合成 START + tool + 合成 END），且 VueFlow 非 0 高（R1 回归守卫）
    const flowNodes = editor.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 15000 })
    const initialCount = await flowNodes.count()
    expect(initialCount).toBeGreaterThanOrEqual(3)
    const flowBox = await editor.locator('.vue-flow').first().boundingBox()
    expect(flowBox?.height ?? 0).toBeGreaterThan(100)

    // 4. 左侧目录点击「大模型」→ 加一个 llm 节点（节点数 +1）
    await editor.locator('.palette-item').filter({ hasText: '大模型' }).first().click()
    await expect(editor.locator('.vue-flow__node')).toHaveCount(initialCount + 1, { timeout: 10000 })

    // 5. 新节点被自动选中 → 右侧配置面板出现「节点配置」+ 名称回填「大模型」
    await expect(editor.getByText('节点配置').first()).toBeVisible({ timeout: 10000 })
    await expect(editor.locator('input[placeholder="节点显示名"]')).toHaveValue('大模型')

    // 6. 画布改动同步回底部 DSL JSON（事实源）：出现新节点的 type=llm
    const dslTextarea = editor.locator('.editor-json textarea').last()
    await expect(dslTextarea).toHaveValue(/"type":\s*"llm"/, { timeout: 10000 })

    // 7. 选中工具节点（骨架里的 step_1）→ 配置面板出现 toolId 下拉
    await editor.locator('.vue-flow__node').filter({ hasText: '示例工具节点' }).first().click()
    await expect(editor.getByText('工具（toolId）').first()).toBeVisible({ timeout: 10000 })

    // 8. 取消：先关编辑器，再关表单，不落任何库数据
    await editor.getByRole('button', { name: '取消' }).click()
    await expect(editor).toBeHidden({ timeout: 10000 })
    await form.getByRole('button', { name: '取消' }).click()
    await expect(form).toBeHidden({ timeout: 10000 })
  })
})
