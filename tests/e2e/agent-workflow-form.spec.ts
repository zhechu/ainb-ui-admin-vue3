import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 流程定义 新建/编辑表单 + DSL 校验 + 预览画布 端到端验证（增量8 / P4 第二刀）
 *
 * 🔴 为什么非要走浏览器
 * 这一刀把第一刀已交付但「无前端调用方」的 create/update/delete 端点接起来，并新增 /validate。
 * 接口通不等于表单能开、Monaco(CodeEditor) 能渲染、校验结果能内联展示、预览画布能画出未保存的 DSL。
 * 这些只有在真实 DOM 里才暴露（尤其 Monaco 挂载、嵌套对话框层级、Vue Flow 高度塌陷 R1）。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。
 * 数据自净：用例创建的 wf_e2e_* 草稿在用例内删除；预览用例不创建任何数据。
 *
 * 判据：新增表单可开 + Monaco 渲染 → 校验DSL 返回「校验通过」→ 保存草稿落库并出现在列表
 *       → 编辑时 code 只读且回填 → 删除清理；预览画布渲染出未保存 DSL 的节点/边。
 */

test.describe('流程定义新建-编辑表单', () => {
  test.setTimeout(120_000)

  test('新增→校验→保存→编辑→删除 全生命周期', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    // 唯一 code，匹配 ^[a-z][a-z0-9_]{1,63}$
    const code = `wf_e2e_${Date.now().toString(36)}`
    const name = `E2E 表单流程 ${code}`

    // 1. 打开新建表单
    await page.getByRole('button', { name: '新增流程' }).click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新建流程定义' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })

    // 2. CodeEditor(Monaco) 挂载出来，DSL 已预填最小合法骨架
    await expect(dialog.locator('.code-editor').first()).toBeVisible({ timeout: 15000 })

    // 3. 填 code + name（DSL 用预填骨架，不去动 Monaco —— 它本就是一份能通过双层校验的合法流程）
    await dialog.locator('input[placeholder*="小写字母开头"]').fill(code)
    await dialog.locator('input[placeholder="请输入流程名称"]').fill(name)

    // 4. 校验DSL → 内联展示「校验通过」（骨架合法：START→tool→END，tool 用已注册只读工具）
    await dialog.getByRole('button', { name: '校验DSL' }).click()
    await expect(
      dialog.getByText('校验通过：结构合法，可作为可执行流程发布').first()
    ).toBeVisible({ timeout: 15000 })

    // 5. 保存草稿：校验通过 → 无二次确认 → 直接落库；成功 toast + 列表出现新行
    await dialog.getByRole('button', { name: '保存草稿' }).click()
    await expect(page.locator('.el-message').filter({ hasText: '新建成功' }).first()).toBeVisible({
      timeout: 15000
    })
    const newRow = page.locator('.el-table__body tr').filter({ hasText: code }).first()
    await expect(newRow).toBeVisible({ timeout: 15000 })

    // 6. 编辑：表单打开，code 只读、name 已回填（列表不带 dsl，编辑时按 id 拉完整定义）
    await newRow.getByRole('button', { name: '编辑' }).click()
    const editDialog = page.locator('.el-dialog').filter({ hasText: '编辑流程定义' }).first()
    await expect(editDialog).toBeVisible({ timeout: 15000 })
    await expect(editDialog.locator('input[placeholder*="小写字母开头"]')).toBeDisabled()
    await expect(editDialog.locator('input[placeholder="请输入流程名称"]')).toHaveValue(name)
    await editDialog.getByRole('button', { name: '取消' }).click()

    // 7. 删除（既验证删除、又清理数据）：delConfirm 二次确认 → 成功 toast → 行消失
    await newRow.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: '删除成功' }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: code })).toHaveCount(0, {
      timeout: 15000
    })
  })

  test('预览画布：渲染当前未保存的 DSL', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    await page.getByRole('button', { name: '新增流程' }).click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新建流程定义' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })

    // 预览画布 → 嵌套只读画布（标题「预览」）渲染骨架节点：START→tool→END ≥ 3
    await dialog.getByRole('button', { name: '预览画布' }).click()
    const canvas = page.locator('.el-dialog').filter({ hasText: '流程画布（预览）' }).first()
    await expect(canvas).toBeVisible({ timeout: 15000 })
    const flowNodes = canvas.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 15000 })
    expect(await flowNodes.count()).toBeGreaterThanOrEqual(3)
    // 画布容器非零高度（R1 回归守卫）
    const box = await canvas.locator('.canvas-wrap').first().boundingBox()
    expect(box?.height ?? 0).toBeGreaterThan(100)

    // 关闭画布（exact 避开右上角 X 的 aria-label「关闭此对话框」）
    await canvas.getByRole('button', { name: '关闭', exact: true }).click()
    // 取消表单：不创建任何数据
    await dialog.getByRole('button', { name: '取消' }).click()
  })
})
