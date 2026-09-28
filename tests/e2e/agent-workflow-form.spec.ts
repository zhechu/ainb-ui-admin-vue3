import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 流程定义 新建/编辑（整页设计器）+ DSL 校验 + 保存落库 端到端验证
 *
 * 🔴 AI助手 UX 修复（问题3）：新建/编辑从「900px 表单弹窗套 1200px 可视化弹窗」改为隐藏路由整页设计器
 *   /agent-workflow/editor（仿门户设计器 InfraPortalEditor）。本用例相应从「操作 dialog」改为「操作整页」：
 *   URL 可刷新可分享、浏览器后退回列表、编辑空间充足。旧用例断言的 .el-dialog「新建流程定义」/「编辑流程定义」、
 *   Monaco .code-editor、以及「预览画布」嵌套弹窗均已随 WorkflowDefFormDialog 删除而不复存在——
 *   DSL 现在是整页画布底部的 .editor-json textarea，「预览」被整页画布本身取代
 *   （列表页「查看画布」的只读预览仍在，见 agent-workflow-manage.spec.ts）。
 *
 * 🔴 为什么非要走浏览器：接口通不等于整页设计器能挂载、VueFlow 不 0 高塌陷(R1)、校验结果能内联展示、
 *   保存后 URL 补 id 防刷新重复新建、返回列表出现新行、编辑态 code 只读且按 id 回填。这些只有真实 DOM 才暴露。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。
 * 数据自净：用例创建的 wf_e2e_* 草稿在用例内删除。
 *
 * 判据：新增→整页设计器挂载（骨架 ≥3 节点、非 0 高）→ 填 code/name → 校验「通过」→ 保存草稿落库
 *       → URL 补 ?id= → 返回列表见新行 → 编辑（code 只读 + name 回填）→ 删除清理。
 */

// 编辑器隐藏路由是 /agent-workflow/editor（连字符），列表页是 /agent/workflow（斜杠），别混
const EDITOR_URL = /\/agent-workflow\/editor/
const LIST_URL = /\/agent\/workflow$/

test.describe('流程定义整页设计器：新建-校验-保存-编辑-删除', () => {
  test.setTimeout(120_000)

  test('全生命周期', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    // 唯一 code，匹配 ^[a-z][a-z0-9_]{1,63}$
    const code = `wf_e2e_${Date.now().toString(36)}`
    const name = `E2E 表单流程 ${code}`

    // 1. 列表页「新增流程」（问题2：已移入搜索表单末尾）→ 跳整页设计器（不再是弹窗）
    await page.getByRole('button', { name: '新增流程' }).click()
    await page.waitForURL(EDITOR_URL, { timeout: 15000 })

    // 1b. 整页设计器挂载：画布渲染出预填骨架 START→tool→END（≥3 节点），且 VueFlow 非 0 高（R1 守卫）
    const flowNodes = page.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 15000 })
    expect(await flowNodes.count()).toBeGreaterThanOrEqual(3)
    const flowBox = await page.locator('.vue-flow').first().boundingBox()
    expect(flowBox?.height ?? 0).toBeGreaterThan(100)

    // 2. 顶栏就地填 code + name（DSL 用预填骨架，本就能通过后端双层校验）
    await page.locator('input[placeholder="流程编码"]').fill(code)
    await page.locator('input[placeholder="流程名称"]').fill(name)

    // 3. 校验 → 内联展示「校验通过」（骨架合法：START→tool→END，tool 用已注册只读工具）
    await page.getByRole('button', { name: '校验', exact: true }).click()
    await expect(
      page.getByText('校验通过：结构合法，可作为可执行流程发布').first()
    ).toBeVisible({ timeout: 15000 })

    // 4. 保存草稿：校验通过 → 无二次确认 → 直接落库；成功 toast + URL 补上 ?id=（防刷新重复新建）
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page.locator('.el-message').filter({ hasText: '新建成功' }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page).toHaveURL(/\/agent-workflow\/editor\?id=\d+/, { timeout: 15000 })

    // 5. 返回列表（保存后 dirty=false，返回不弹确认）→ 新行出现
    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(LIST_URL, { timeout: 15000 })
    const newRow = page.locator('.el-table__body tr').filter({ hasText: code }).first()
    await expect(newRow).toBeVisible({ timeout: 15000 })

    // 6. 编辑：整页设计器带 ?id 打开，code 只读、name 已回填（列表不带 dsl，编辑时按 id 拉完整定义）
    await newRow.getByRole('button', { name: '编辑' }).click()
    await page.waitForURL(/\/agent-workflow\/editor\?id=\d+/, { timeout: 15000 })
    await expect(page.locator('input[placeholder="流程编码"]')).toBeDisabled({ timeout: 15000 })
    await expect(page.locator('input[placeholder="流程名称"]')).toHaveValue(name)

    // 7. 返回列表（loadDef 后 dirty=false，返回不弹确认）
    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(LIST_URL, { timeout: 15000 })

    // 8. 删除（既验证删除、又清理数据）：delConfirm 二次确认 → 成功 toast → 行消失
    const targetRow = page.locator('.el-table__body tr').filter({ hasText: code }).first()
    await expect(targetRow).toBeVisible({ timeout: 15000 })
    await targetRow.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: '删除成功' }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: code })).toHaveCount(0, {
      timeout: 15000
    })
  })
})
