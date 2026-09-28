import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 流程「可视化编辑器」端到端验证（增量14d 首刀 → AI助手 UX 修复问题3/4 迁移到整页设计器）
 *
 * 🔴 AI助手 UX 修复（问题3）：可视化编辑器不再是「表单弹窗里再套一个 1200px 弹窗」，而是隐藏路由整页
 *   /agent-workflow/editor 内嵌 WorkflowEditorCanvas（三栏：目录 / 画布 / 配置面板 + 底部 DSL JSON 兜底）。
 *   本用例相应从「操作两层 dialog」改为「操作整页」。旧断言里的 dialog 作用域、『可视化编辑』开弹窗、
 *   取消关两层弹窗均已随 WorkflowDefFormDialog / WorkflowEditorDialog 删除而失效。
 * 🔴 问题4 增强覆盖：
 *   - tool.args 从「裸 JSON 提示」改为 KeyValueEditor 结构化编辑（删掉旧的『args…请用下方 DSL JSON 编辑』断言，
 *     改断言键值编辑器把预填 args 渲染成「参数名/值」行）；
 *   - 新增 condition.rule 分支可视化面板（增分支 → 路由键 + 条件行）。
 *   拖拽落点（HTML5 dataTransfer）在 Playwright 里易抖，不在此自动化，改由浏览器手测覆盖（点击新增已覆盖加节点路径）。
 *
 * 🔴 为什么非要走浏览器：接口/单测（editorModel.spec.ts / nodeConfigSchema.spec.ts）证不了「整页设计器能挂载、
 *   VueFlow 不 0 高塌陷(R1)、点击目录真能加节点、选中节点配置面板真能弹出、画布改动能同步回底部 DSL JSON、
 *   补偿打标随节点类型切换」——这些只有真实 DOM 才暴露。本模块头号缺陷「配了/点了但不生效且无提示」正是
 *   可视化编辑器最易踩的坑，故必须浏览器实测。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑；工具目录走 /agent/config/tool-list。
 * 数据自净：全程在「新建」整页里操作，最后返回列表不落库（不点保存）。
 *
 * 判据：新增→整页设计器 → 画布渲染骨架 ≥3 节点且非 0 高 → 点击目录「大模型」加节点 → 节点数 +1、
 *       配置面板自动选中并显示名称 → 底部 DSL JSON 同步出现 type=llm → llm 打「不可补偿」标 →
 *       选中工具节点显示 toolId 下拉 + args 键值编辑器 → tool 可补偿：recovery 切 compensate 三字段出现且
 *       同步进 DSL、切回跟随全局 compensation 被删 → 加「规则条件」节点出现分支可视化面板 → 返回不落库。
 */

const EDITOR_URL = /\/agent-workflow\/editor/
const LIST_URL = /\/agent\/workflow$/

test.describe('流程可视化编辑器（整页设计器）', () => {
  test.setTimeout(120_000)

  test('画布渲染 + 目录加节点 + 配置面板 + DSL 双向同步 + 补偿打标 + 分支可视化', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/agent/workflow')

    // 1. 列表页「新增流程」→ 跳整页设计器（预填最小合法骨架 START→tool→END）
    await page.getByRole('button', { name: '新增流程' }).click()
    await page.waitForURL(EDITOR_URL, { timeout: 15000 })

    // 2. 画布渲染：骨架 ≥3 节点（合成 START + tool + 合成 END），且 VueFlow 非 0 高（R1 回归守卫）
    const flowNodes = page.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 15000 })
    const initialCount = await flowNodes.count()
    expect(initialCount).toBeGreaterThanOrEqual(3)
    const flowBox = await page.locator('.vue-flow').first().boundingBox()
    expect(flowBox?.height ?? 0).toBeGreaterThan(100)

    // 3. 左侧目录点击「大模型」→ 加一个 llm 节点（节点数 +1）
    await page.locator('.palette-item').filter({ hasText: '大模型' }).first().click()
    await expect(page.locator('.vue-flow__node')).toHaveCount(initialCount + 1, { timeout: 10000 })

    // 4. 新节点被自动选中 → 右侧配置面板出现「节点配置」+ 名称回填「大模型」
    await expect(page.getByText('节点配置').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[placeholder="节点显示名"]')).toHaveValue('大模型')

    // 4b. llm 节点渲染「结构化配置字段」（不再只有裸 JSON）：提示词 textarea + 模型 select 标签出现
    await expect(page.getByText('提示词（prompt）').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('模型（modelId）').first()).toBeVisible({ timeout: 10000 })

    // 5. 画布改动同步回底部 DSL JSON（事实源）：出现新节点的 type=llm
    const dslTextarea = page.locator('.editor-json textarea').last()
    await expect(dslTextarea).toHaveValue(/"type":\s*"llm"/, { timeout: 10000 })

    // 5b. 可补偿性打标：llm 节点此刻仍被自动选中 → 面板打「不可补偿」标、无 recovery 下拉
    //     （对齐后端 NON_COMPENSABLE_TYPES：模型 token 已耗，声明补偿不生效）
    await expect(page.locator('[data-testid="node-noncompensable-tag"]')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('[data-testid="node-recovery-select"]')).toHaveCount(0)

    // 6. 选中工具节点（骨架里的 step_1）→ 配置面板出现 toolId 下拉
    await page.locator('.vue-flow__node').filter({ hasText: '示例工具节点' }).first().click()
    await expect(page.getByText('工具（toolId）').first()).toBeVisible({ timeout: 10000 })

    // 6b（问题4）：tool.args 现在是 KeyValueEditor 结构化编辑（不再是「请用下方 DSL JSON 编辑」提示）。
    //     预填骨架 args={keyword,limit} → 键值编辑器渲染出「参数名」输入行，首行回填 keyword。
    await expect(page.getByText('工具入参（args）').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[placeholder="参数名"]').first()).toHaveValue('keyword', {
      timeout: 10000
    })

    // 6c. 可补偿性打标：tool 节点出现「失败恢复与补偿」区块 + recovery 下拉（可补偿类型）
    await expect(page.getByText('失败恢复与补偿').first()).toBeVisible({ timeout: 10000 })
    const recoverySelect = page.locator('[data-testid="node-recovery-select"]')
    await expect(recoverySelect).toBeVisible()

    // 6d：切到 compensate → 补偿三字段出现，且顶层 recovery/compensation 同步进底部 DSL JSON（事实源）
    await recoverySelect.click()
    await page
      .locator('.el-select-dropdown__item')
      .filter({ hasText: 'compensate — 失败时 Saga 逆序补偿' })
      .first()
      .click()
    await expect(page.locator('[data-testid="node-compensate-ref"]')).toBeVisible({ timeout: 10000 })
    // el-input 的 data-testid 透传到内层 input/textarea 本体（非包一层），故直接按属性选
    await expect(page.locator('textarea[data-testid="node-before-image"]')).toBeVisible()
    await expect(page.locator('input[data-testid="node-idempotency-key"]')).toBeVisible()
    await expect(dslTextarea).toHaveValue(/"recovery":\s*"compensate"/, { timeout: 10000 })
    await expect(dslTextarea).toHaveValue(/"compensation":\s*\{/, { timeout: 10000 })

    // 6e：切回跟随全局 → compensation 从 DSL 里整个删掉（不留会被后端 warn 的脏声明）
    await page.locator('[data-testid="node-recovery-select"]').click()
    await page
      .locator('.el-select-dropdown__item')
      .filter({ hasText: '跟随全局（默认 forward 断点续跑）' })
      .first()
      .click()
    await expect(page.locator('[data-testid="node-compensate-ref"]')).toHaveCount(0, { timeout: 10000 })
    await expect(dslTextarea).not.toHaveValue(/"compensation"/, { timeout: 10000 })

    // 7（问题4：condition.rule 分支可视化）：加一个「规则条件」节点 → 面板出现分支编辑区
    await page.locator('.palette-item').filter({ hasText: '规则条件' }).first().click()
    await expect(page.getByText('分支（按顺序匹配，命中即走）').first()).toBeVisible({ timeout: 10000 })
    // 加一条分支 → 出现「分支 1」卡片 + 路由键输入 + 「添加条件（AND）」按钮
    await page.getByRole('button', { name: '添加分支', exact: true }).click()
    await expect(page.getByText('分支 1').first()).toBeVisible({ timeout: 10000 })
    await expect(
      page.locator('input[placeholder*="需与该节点条件边的分支键一致"]').first()
    ).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: '添加条件（AND）' }).first()).toBeVisible()

    // 8. 不落库：返回列表（有未保存改动 → 二次确认离开）
    await page.locator('button[title="返回列表"]').click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await page.waitForURL(LIST_URL, { timeout: 15000 })
  })
})
