import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 流程编排管理页 + 只读画布 端到端验证（增量8 / P4 第一刀）
 *
 * 🔴 为什么非要走浏览器
 * 这一刀修的是「菜单点开是空白页」的真实缺陷 —— 接口通不等于页面渲染得出来。
 * 尤其 Vue Flow 容器高度塌陷（0 高不可见）只在真实 DOM 里才暴露（R1）。
 *
 * 前置（0 LLM token）：
 *   - 后端 48080 + 前端 dev server 同时在跑；
 *   - DB 里播种一条 DRAFT def（code=wf_p4_demo，最小合法 DSL：START→tool→END）+ 一条执行行 + 节点 trace。
 *     播种 SQL 见验证记录，验证后清理。
 *
 * 判据：页面非空白 → def 列表渲染播种行 → 只读画布渲染出节点/边 → 发布/停用翻状态 → 执行历史 + 节点 trace。
 */

const DEMO_CODE = 'wf_p4_demo'

test.describe('流程编排管理页', () => {
  test.setTimeout(120_000)

  test('菜单不再空白：def 列表渲染出播种的流程', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    // 页面非空白：搜索表单 + 列表表格都在
    await expect(page.getByText('流程编码').first()).toBeVisible({ timeout: 20000 })
    const rows = page.locator('.el-table__body tr')
    await expect(rows.filter({ hasText: DEMO_CODE }).first()).toBeVisible({ timeout: 20000 })
  })

  test('只读画布渲染出 DSL 节点与连线', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    const demoRow = page.locator('.el-table__body tr').filter({ hasText: DEMO_CODE }).first()
    await expect(demoRow).toBeVisible({ timeout: 20000 })
    await demoRow.getByRole('button', { name: '查看画布' }).click()

    // 对话框出现
    const dialog = page.locator('.el-dialog').filter({ hasText: '流程画布' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })

    // 🔴 核心判据：Vue Flow 真的渲染出节点 DOM（不是 0 高塌陷）。
    //    最小 DSL START→tool→END = 3 个节点（含合成端点）。
    const flowNodes = dialog.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 15000 })
    expect(await flowNodes.count()).toBeGreaterThanOrEqual(3)

    // 画布容器有非零高度（R1 回归守卫）
    const wrap = dialog.locator('.canvas-wrap').first()
    const box = await wrap.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThan(100)

    // 连线也渲染出来了
    expect(await dialog.locator('.vue-flow__edge').count()).toBeGreaterThanOrEqual(2)

    // exact:true 只匹配页脚「关闭」按钮，避开右上角 X（aria-label=「关闭此对话框」也含「关闭」）
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  })

  test('发布 → 停用 翻状态', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    const demoRow = page.locator('.el-table__body tr').filter({ hasText: DEMO_CODE }).first()
    await expect(demoRow).toBeVisible({ timeout: 20000 })

    // 播种为 DRAFT 时应出现「发布」按钮；若已被前序运行翻成 DISABLED，则跳过发布、直接验停用幂等不可得
    const publishBtn = demoRow.getByRole('button', { name: '发布' })
    if (await publishBtn.count()) {
      await publishBtn.click()
      // 二次确认（el-message-box）
      await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
      await expect(page.locator('.el-message').filter({ hasText: '发布成功' }).first()).toBeVisible({
        timeout: 15000
      })
      // 状态翻成「已发布」，且出现「停用」按钮
      await expect(
        page.locator('.el-table__body tr').filter({ hasText: DEMO_CODE }).first().getByText('已发布')
      ).toBeVisible({ timeout: 15000 })

      const disableBtn = page
        .locator('.el-table__body tr')
        .filter({ hasText: DEMO_CODE })
        .first()
        .getByRole('button', { name: '停用' })
      await disableBtn.click()
      await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
      await expect(page.locator('.el-message').filter({ hasText: '停用成功' }).first()).toBeVisible({
        timeout: 15000
      })
      await expect(
        page.locator('.el-table__body tr').filter({ hasText: DEMO_CODE }).first().getByText('已停用')
      ).toBeVisible({ timeout: 15000 })
    }
  })

  test('执行历史抽屉 + 节点级 trace', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    const demoRow = page.locator('.el-table__body tr').filter({ hasText: DEMO_CODE }).first()
    await expect(demoRow).toBeVisible({ timeout: 20000 })
    await demoRow.getByRole('button', { name: '执行历史' }).click()

    const drawer = page.locator('.el-drawer').filter({ hasText: '执行历史' }).first()
    await expect(drawer).toBeVisible({ timeout: 15000 })

    // 播种了一条执行行：要么渲染出行，要么空态（两者都算抽屉正常工作，但播种后应有行）
    const execRows = drawer.locator('.el-table__body tr')
    await expect(execRows.first()).toBeVisible({ timeout: 15000 })

    // 展开第一行 → 懒加载节点级 trace 子表
    await drawer.locator('.el-table__expand-icon').first().click()
    // 子表里应出现播种的节点 id（tool 节点）
    await expect(drawer.getByText('query_customer').first()).toBeVisible({ timeout: 15000 })
  })
})
