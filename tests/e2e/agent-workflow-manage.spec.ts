import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 流程编排管理页 + 只读画布 端到端验证（6 项优化 Req1/Req2 列表侧 + 只读查看器回归）
 *
 * 🔴 为什么非要走浏览器
 * 「菜单点开是空白页」「只读画布 0 高塌陷(R1)」这类缺陷接口通也证不了，必须真实 DOM。
 *
 * 🔴 本轮改造后的对齐点（不再依赖任何播种数据，全程只读、不改库）：
 *   - Req1：列表首列是「序号」列；顶部按钮文案是「新增」（不再是「新增流程」）。
 *   - Req2：「新增」与设计分开——点「新增」弹元信息弹窗（建草稿+跳设计器由 agent-workflow-editor.spec.ts 覆盖）。
 *   - 只读查看器（WorkflowCanvasDialog + WorkflowEditorCanvas，本轮保留降级为只读）仍能渲染节点/连线、非 0 高。
 *   - 执行历史抽屉能打开（有行渲染行、无行渲染空态，均算正常）。
 *
 * 数据自净：纯只读，不新增/不发布/不停用/不删除，跑完不留痕。
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑；库里已有若干流程定义（真实数据即可）。
 */

test.describe('流程编排管理页', () => {
  test.setTimeout(120_000)

  test('列表渲染：序号列 + 「新增」按钮 + 至少一行真实数据', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    // 页面非空白：搜索表单 + 列表表格都在
    await expect(page.getByText('流程编码').first()).toBeVisible({ timeout: 20000 })

    // Req1：序号列表头存在
    await expect(page.getByRole('columnheader', { name: '序号' }).first()).toBeVisible({
      timeout: 15000
    })

    // Req1/Req2：顶部按钮文案是「新增」（精确匹配，避开「新增流程」旧文案）
    await expect(page.getByRole('button', { name: '新增', exact: true }).first()).toBeVisible({
      timeout: 15000
    })

    // 至少渲染出一行真实数据
    const rows = page.locator('.el-table__body tr')
    await expect(rows.first()).toBeVisible({ timeout: 20000 })
    expect(await rows.count()).toBeGreaterThan(0)
  })

  test('「新增」弹出元信息弹窗（Req2：新增与设计分开）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    await page.getByRole('button', { name: '新增', exact: true }).first().click()

    // 元信息弹窗出现：含「流程名称」「流程编码」「起步模板」字段
    const dialog = page.locator('.el-dialog').filter({ hasText: '新增流程' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })
    await expect(dialog.getByText('流程名称').first()).toBeVisible({ timeout: 10000 })
    await expect(dialog.getByText('流程编码').first()).toBeVisible({ timeout: 10000 })

    // 取消关闭，不落库
    await dialog.getByRole('button', { name: /取消|关闭/ }).first().click()
    await expect(dialog).toBeHidden({ timeout: 10000 })
  })

  /**
   * Req3：五种触发方式的经典案例
   *
   * 🔴 为什么非走浏览器不可：案例数据本身有 54 条单测守着（结构不变量 + 后端 error 规则复刻），
   *   但「切触发方式时内联卡片真的跟着换」「五个页签真的都渲染出来」只在真实 DOM 里暴露——
   *   computed 没接上、v-if 写错、页签 name 冲突，单测全绿而页面是空的。
   * 同时顺带守 Req1：chat 触发下「驱动 Agent」是下拉而不是手填输入框。
   */
  test('触发案例：列表页参考手册五页签 + 新增弹窗内联卡片随触发方式切换（Req3/Req1）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    // ① 列表页工具栏「触发案例」→ 参考手册弹窗，五个页签一个不缺
    await page.getByTestId('trigger-case-btn').click()
    const caseDialog = page.locator('.el-dialog').filter({ hasText: '触发方式经典案例' }).first()
    await expect(caseDialog).toBeVisible({ timeout: 15000 })
    const tabs = caseDialog.locator('.el-tabs__item')
    await expect(tabs).toHaveCount(5, { timeout: 10000 })
    for (const label of ['手动 / 接口', '对话驱动 Agent', '表单事件', '定时', 'Webhook']) {
      await expect(tabs.filter({ hasText: label }).first()).toBeVisible()
    }
    // 默认停在第一个页签，案例正文渲染出来了（标题 + 流程走向 + 要点）
    await expect(caseDialog.locator('.tcv__title').first()).toBeVisible({ timeout: 10000 })
    await expect(caseDialog.getByText('流程走向').first()).toBeVisible()
    // 切到 Webhook 页签：条件分支案例，走向里出现「按金额分流」
    await tabs.filter({ hasText: 'Webhook' }).first().click()
    await expect(caseDialog.locator('.tcv__row').filter({ hasText: '按金额分流' }).first()).toBeVisible({
      timeout: 10000
    })
    await caseDialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(caseDialog).toBeHidden({ timeout: 10000 })

    // ② 新增弹窗内联案例卡：默认 chat → 「表单问答助手」
    await page.getByRole('button', { name: '新增', exact: true }).first().click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新增流程' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })
    const inline = dialog.getByTestId('trigger-case-inline')
    await expect(inline.locator('.tcv__title').filter({ hasText: '表单问答助手' }).first()).toBeVisible({
      timeout: 10000
    })

    // Req1：chat 触发下「驱动 Agent」是下拉（el-select）而不是手填 input
    // 🔴 用 label 精确定位：hasText 会把「起步模板」项也匹配上（它的提示语里就写着"按下面选的触发方式…"）
    const formItem = (label: string) =>
      dialog.locator(`.el-form-item:has(.el-form-item__label:text-is("${label}"))`).first()
    const agentItem = formItem('驱动 Agent')
    await expect(agentItem.locator('.el-select').first()).toBeVisible({ timeout: 10000 })

    // ③ 切到「定时」→ 内联卡片换成定时案例，且 cron 字段出现
    await formItem('触发方式').locator('.el-select').click()
    await page.locator('.el-select-dropdown__item:visible').filter({ hasText: '定时' }).first().click()
    await expect(inline.locator('.tcv__title').filter({ hasText: '数据接口巡检' }).first()).toBeVisible({
      timeout: 10000
    })
    await expect(dialog.getByText('Cron 表达式').first()).toBeVisible({ timeout: 10000 })

    await dialog.getByRole('button', { name: /取消/ }).first().click()
    await expect(dialog).toBeHidden({ timeout: 10000 })
  })

  test('只读画布查看器渲染出 DSL 节点与连线（R1 回归守卫）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    const firstRow = page.locator('.el-table__body tr').first()
    await expect(firstRow).toBeVisible({ timeout: 20000 })
    await firstRow.getByRole('button', { name: '查看画布' }).click()

    // 对话框出现
    const dialog = page.locator('.el-dialog').filter({ hasText: '流程画布' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })

    // 🔴 核心判据：Vue Flow 真的渲染出节点 DOM（不是 0 高塌陷）。
    const flowNodes = dialog.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 15000 })
    expect(await flowNodes.count()).toBeGreaterThanOrEqual(1)

    // 画布容器有非零高度（R1 回归守卫）
    const wrap = dialog.locator('.canvas-wrap').first()
    const box = await wrap.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThan(100)

    // exact:true 只匹配页脚「关闭」按钮，避开右上角 X（aria-label=「关闭此对话框」也含「关闭」）
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  })

  test('执行历史抽屉能打开（只读，不依赖播种执行行）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    const firstRow = page.locator('.el-table__body tr').first()
    await expect(firstRow).toBeVisible({ timeout: 20000 })
    await firstRow.getByRole('button', { name: '执行历史' }).click()

    const drawer = page.locator('.el-drawer').filter({ hasText: '执行历史' }).first()
    await expect(drawer).toBeVisible({ timeout: 15000 })

    // 有执行行则渲染行，无则空态——两者都证明抽屉正常工作（不再断言特定播种节点）
    const hasRows = await drawer.locator('.el-table__body tr').count()
    const hasEmpty = await drawer.locator('.el-table__empty-block, .el-empty').count()
    expect(hasRows > 0 || hasEmpty > 0).toBeTruthy()
  })
})
