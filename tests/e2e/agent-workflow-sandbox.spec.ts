import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'
import { monacoOf, setMonacoText } from './helpers/monaco'
import { createWorkflowDraft } from './helpers/workflow'

/**
 * 流程设计器「沙箱测试」端到端验证（6 项优化 Req4b / Phase D）
 *
 * 🔴 Req4 绑定决策：沙箱 =「后端沙箱·写操作 mock」——真跑当前草稿 DSL，逐节点流式回传；
 *   LLM 与只读工具真实执行，非 READ_ONLY（写/不可逆）工具被 mock（返回占位结果，无真实副作用）。
 *
 * 🔴 为什么非要走浏览器：后端 mock 卡点已用裸 HTTP 流验证过，但「SandboxPanel 真能挂载、点『运行沙箱』
 *   真发起 SSE、事件流真被 reduceSandboxEvent 折叠成逐节点时间线、写节点真打『已模拟写操作』标、
 *   只读节点真跑（不被 mock）、顶部真出『有写操作被模拟』提示」——这些只有真实 DOM 才暴露。
 *
 * 🔴 0 LLM token：DSL 里只放 tool 节点（不放 llm），故不消耗大模型额度。
 *   - form_list  = READ_ONLY → 真实执行（状态应为「成功」，绝不打 mock 标）
 *   - form_data_create = LOW（非 READ_ONLY）→ 被沙箱 mock（状态「已模拟写操作」）
 *
 * 前置：后端 48080 + 前端 dev server 同时在跑。数据自净：末尾删除新建草稿。
 */

const EDITOR_URL = /\/agent-workflow\/editor/

/** 注入用：START→只读工具(form_list)→写工具(form_data_create)→END。写工具会被沙箱 mock，只读工具真跑 */
const SANDBOX_DSL = {
  dslVersion: '1.0',
  id: 'wf_sbx_e2e',
  name: '沙箱测试流程',
  variables: [{ key: 'input', type: 'string', merge: 'replace' }],
  nodes: [
    {
      id: 'ro_node',
      type: 'tool',
      name: '只读工具',
      config: { toolId: 'form_list', args: {}, outputVar: 'roOut' }
    },
    {
      id: 'wr_node',
      type: 'tool',
      name: '写操作工具',
      config: { toolId: 'form_data_create', args: { formId: 1, data: {} }, outputVar: 'wrOut' }
    }
  ],
  edges: [
    { from: 'START', to: 'ro_node' },
    { from: 'ro_node', to: 'wr_node' },
    { from: 'wr_node', to: 'END' }
  ],
  settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
}

test.describe('流程设计器：沙箱测试（Req4b）', () => {
  test.setTimeout(150_000)

  test('运行沙箱：只读工具真跑、写工具被 mock、逐节点时间线渲染', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    // 新增 → 经典案例草稿（默认模板）→ 跳设计器；随后整份 DSL 会被替换成沙箱专用链，模板内容不影响断言
    const stamp = Date.now()
    const code = `wf_sbx_${stamp}`
    await createWorkflowDraft(page, { code, name: `沙箱测试${stamp}` })
    await page.waitForURL(EDITOR_URL, { timeout: 20000 })

    await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20000 })

    // 开发者模式 → 注入「只读→写」两节点链
    await page.locator('[data-testid="dev-mode-switch"]').click()
    const jsonPanel = page.locator('[data-testid="dsl-json-panel"]')
    await expect(jsonPanel).toBeVisible({ timeout: 10000 })
    // 🔴 Req6：底部流程 JSON 已是 Monaco 代码框，不能用 fill()（真实内容在 Monaco 的 model 里，
    //   DOM 上那个 textarea 只承载正在输入的一行）——统一走 helpers/monaco 的 全选+删除+insertText
    await setMonacoText(page, monacoOf(jsonPanel), JSON.stringify(SANDBOX_DSL, null, 2))
    await expect(jsonPanel.locator('[data-testid="dsl-json-status"]')).toContainText(
      'JSON 格式正确',
      { timeout: 10000 }
    )
    await jsonPanel.getByRole('button', { name: '应用到画布' }).click()

    // 打开沙箱抽屉
    await page.getByRole('button', { name: '沙箱测试' }).click()
    const drawer = page.locator('[data-testid="sandbox-drawer"]').first()
    await expect(drawer).toBeVisible({ timeout: 10000 })
    // 纪律提示：真花钱 + 写操作已 mock
    await expect(drawer.getByText('沙箱会真实调用大模型（消耗 token）').first()).toBeVisible()

    // 运行沙箱
    await drawer.getByRole('button', { name: /运行沙箱|试跑中/ }).first().click()

    // 逐节点时间线出现：写操作工具被 mock → 状态「已模拟写操作」
    const wrRow = drawer.locator('.sbx__row').filter({ hasText: '写操作工具' }).first()
    await expect(wrRow).toBeVisible({ timeout: 30000 })
    await expect(wrRow.getByText('已模拟写操作').first()).toBeVisible({ timeout: 30000 })

    // 顶部「有写操作被模拟」提示出现（run.anyMocked）
    await expect(
      drawer.getByText('本次有写操作被模拟（mock），未产生真实副作用').first()
    ).toBeVisible({ timeout: 30000 })

    // 只读工具真跑（不被 mock）：该行出现，且状态不是「已模拟写操作」
    const roRow = drawer.locator('.sbx__row').filter({ hasText: '只读工具' }).first()
    await expect(roRow).toBeVisible({ timeout: 30000 })
    await expect(roRow.getByText('已模拟写操作')).toHaveCount(0)

    // 展开写节点详情 → 输出区打「写操作已模拟」标
    await wrRow.click()
    await expect(
      drawer.locator('.sbx__detail').filter({ hasText: '写操作已模拟' }).first()
    ).toBeVisible({ timeout: 10000 })

    // 清理：硬跳回列表删除草稿
    await gotoWithAuth(page, '/ai/agent/workflow')
    const row = page.locator('.el-table__body tr').filter({ hasText: code }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: '删除成功' }).first()).toBeVisible({
      timeout: 15000
    })
  })
})
