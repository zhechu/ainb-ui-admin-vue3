import { test, expect } from '@playwright/test'
import { login, gotoWithAuth, apiLogin } from './helpers/auth'
import { monacoOf, setMonacoText, expectMonacoVisible } from './helpers/monaco'
import { createWorkflowDraft, deleteWorkflowDraftsByCode } from './helpers/workflow'

/**
 * 流程编排「新增面板 → 整页设计器」端到端验证
 *
 * 🔴 为什么非要走浏览器：接口/单测证不了「页内面板真能建草稿并跳设计器、三栏真渲染、VueFlow 不 0 高塌陷、
 *   顶栏缩放/开发者模式真能驱动画布、JSON 面板真是代码编辑器且能放大、点节点上的『＋』真能接线、
 *   删除真不弹二次确认、撤销/重做真回退」——这些只有真实 DOM 才暴露（本模块头号缺陷正是
 *   「配了/点了但不生效且无提示」）。
 *
 * 覆盖的用户要求：
 *   Req2 删除节点/连线不二次确认（撤销兜底）
 *   Req4 画布工具条取消，缩放 + 开发者模式上顶栏与撤销重做同行；字号统一
 *   Req5 开发者模式下的流程 JSON 可放大成弹窗
 *   Req6 JSON 面板换成代码编辑器（高亮 + 实时格式校验）
 *   Req7 鼠标移到节点上出现「＋」，点它直接选节点接到后面
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。DSL 里不放大模型节点以外的真实调用，
 * 「大模型」节点只是加进画布并不运行，故不消耗额度。
 * 数据自净：用例体末尾回列表删一次（顺带验删除交互），`afterAll` 再按 code 兜一次底 ——
 *           本用例有 20 多个断言、180s 预算，红在任何一步都不该把草稿留在库里（F1 / §4.7）。
 */

const LIST_URL = /\/ai\/agent\/workflow$/
const EDITOR_URL = /\/agent-workflow\/editor/

/**
 * 🔴 提到模块级是为了 `afterAll` 能读到：钩子在用例体之外，局部变量它看不见。
 * 注意本 code 与 `agent-workflow-form.spec.ts` 同前缀（都是 `wf_e2e_`），故兜底清理
 * 必须按**全等**复核，不能拿 like 的结果直接删 —— 见 helpers/workflow 里的说明。
 */
const STAMP = Date.now()
const WF_CODE = `wf_e2e_${STAMP}`

test.describe('流程编排：新增弹窗 → 整页设计器', () => {
  test.setTimeout(180_000)

  test.afterAll(async ({ request }) => {
    const token = await apiLogin(request)
    await deleteWorkflowDraftsByCode(request, token, WF_CODE)
  })

  test('新增建草稿 → 三栏设计器 → 顶栏缩放/开发者模式 → JSON 放大 → ＋加节点 → 删除免确认 → 撤销重做', async ({
    page
  }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    // Req1（上一轮）：序号列 +「新增」按钮（不再是「新增流程」直跳设计器）
    await expect(page.getByRole('columnheader', { name: '序号' }).first()).toBeVisible({
      timeout: 20000
    })
    const addBtn = page.getByRole('button', { name: '新增', exact: true })
    await expect(addBtn).toBeVisible()

    // 点「新增」→ 页内元信息面板（Req2 新增与设计分开；Req1 由弹窗改页内，定位见 helpers/workflow）
    await createWorkflowDraft(page, { code: WF_CODE, name: `E2E测试流程${STAMP}` })

    // 建草稿后跳整页设计器
    await page.waitForURL(EDITOR_URL, { timeout: 20000 })

    // 三栏设计器渲染。chat 案例 START→查表单→回答→END ≥3 节点，VueFlow 非 0 高（R1 回归守卫）
    const flowNodes = page.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 20000 })
    const initialCount = await flowNodes.count()
    expect(initialCount).toBeGreaterThanOrEqual(3)
    const flowBox = await page.locator('.vue-flow').first().boundingBox()
    expect(flowBox?.height ?? 0).toBeGreaterThan(100)
    // 需求5：左右侧栏默认收起，画布吃满宽度。先断言「收起」这个默认态本身，再手动展开左目录
    const railLeft = page.locator('[data-testid="rail-left"]')
    await expect(railLeft).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.wf-palette__item')).toHaveCount(0)
    await expect(page.locator('.wf-panel')).toHaveCount(0)
    await railLeft.click()
    // 左目录在
    await expect(page.locator('.wf-palette__item').first()).toBeVisible({ timeout: 10000 })

    // Req4：画布内不再有工具条那一行（缩放/删除/开发者模式全搬走了），画布因此吃满高度
    await expect(page.locator('.wf-designer__toolbar')).toHaveCount(0)
    // 缩放与开发者模式在顶栏，和撤销/重做同一行
    const historyBar = page.locator('.wf-editor__history')
    await expect(historyBar.getByRole('button', { name: '撤销' })).toBeVisible({ timeout: 10000 })
    await expect(historyBar.getByRole('button', { name: '放大' })).toBeVisible()
    await expect(historyBar.getByRole('button', { name: '缩小' })).toBeVisible()
    await expect(historyBar.getByRole('button', { name: '适配画布' })).toBeVisible()
    await expect(historyBar.locator('[data-testid="dev-mode-switch"]')).toBeVisible()

    // 缩放按钮真能驱动画布：记下当前视口变换，点「放大」后必须变
    // 🔴 变换写在 .vue-flow__transformationpane 上（VueFlow 1.48 的 Viewport 内部结构），
    //   不是 .vue-flow__viewport —— 后者是外层容器，本身不带 transform，读它永远是 "none"
    const viewport = page.locator('.vue-flow__transformationpane').first()
    const readTransform = () => viewport.evaluate((el) => getComputedStyle(el).transform)
    const transformBefore = await readTransform()
    expect(transformBefore).not.toBe('none')
    await historyBar.getByRole('button', { name: '放大' }).click()
    await expect.poll(readTransform, { timeout: 5000 }).not.toBe(transformBefore)
    await historyBar.getByRole('button', { name: '适配画布' }).click()

    // Req4 + Req6：开发者模式 → 底部流程 JSON 面板是代码编辑器（Monaco）+ 实时格式校验状态条
    await historyBar.locator('[data-testid="dev-mode-switch"]').click()
    const jsonPanel = page.locator('[data-testid="dsl-json-panel"]')
    await expect(jsonPanel).toBeVisible({ timeout: 10000 })
    const dslEditor = monacoOf(jsonPanel)
    await expectMonacoVisible(dslEditor)
    const jsonStatus = page.locator('[data-testid="dsl-json-status"]')
    await expect(jsonStatus).toContainText('JSON 格式正确', { timeout: 10000 })
    // 状态条带节点/连线摘要：既能证明画布改动同步回了事实源 JSON，也是下面断言的抓手
    // 🔴 不去断言 Monaco 的文本内容——它只渲染视口内的行（虚拟滚动），长 JSON 根本读不全
    const readNodeCount = async () =>
      Number(((await jsonStatus.textContent()) ?? '').match(/(\d+)\s*个节点/)?.[1] ?? -1)
    const nodesBefore = await readNodeCount()
    expect(nodesBefore).toBeGreaterThan(0)

    // Req6：格式检查真的会报错（在编辑器里把 JSON 改坏，状态条立刻指出第几行）
    // 🔴 故意用「键忘了加引号」这种坏法：不含引号/括号，就算 Monaco 的自动补全插了字符也照样非法，
    //   断言不会因为补全而假通过（写 '{"nodes": [}' 一旦被补成 '{"nodes": []}' 反而变成合法 JSON）
    await setMonacoText(page, dslEditor, '{ nodes: [] }')
    await expect(jsonStatus).toContainText('JSON 格式错误', { timeout: 10000 })
    // 还原：手改 JSON 只动 dslText、不动事实源 dslObject，所以「重新布局」重算时会把原文重新写回文本框
    await page.getByRole('button', { name: '重新布局' }).click()
    await expect(jsonStatus).toContainText('JSON 格式正确', { timeout: 10000 })

    // Req5：JSON 面板可放大成弹窗（复用全站 Dialog，标题栏自带全屏切换）
    await page.locator('[data-testid="dsl-json-enlarge"]').click()
    const lgDialog = page.locator('.el-dialog').filter({ hasText: '流程 JSON（事实源）' }).first()
    await expect(lgDialog).toBeVisible({ timeout: 10000 })
    await expect(page.locator('[data-testid="dsl-json-status-lg"]')).toContainText(
      'JSON 格式正确',
      { timeout: 10000 }
    )
    // 放大后的编辑器比面板里那个高（真的变大了，不是换了个壳）
    const lgBox = await monacoOf(lgDialog).boundingBox()
    const smBox = await dslEditor.boundingBox()
    expect(lgBox?.height ?? 0).toBeGreaterThan((smBox?.height ?? 0) + 50)
    await lgDialog.getByRole('button', { name: '关闭' }).click()
    await expect(lgDialog).toBeHidden({ timeout: 10000 })

    // 目录点「大模型」→ 节点 +1，属性面板自动选中并出结构化字段（提示词/模型）
    await page.locator('.wf-palette__item').filter({ hasText: '大模型' }).first().click()
    await expect(flowNodes).toHaveCount(initialCount + 1, { timeout: 10000 })
    await expect(page.getByText('节点配置').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('提示词', { exact: true }).first()).toBeVisible({ timeout: 10000 })
    // 画布改动同步回底部流程 JSON（事实源）：状态条摘要里的节点数 +1
    await expect.poll(readNodeCount, { timeout: 10000 }).toBe(nodesBefore + 1)

    // 撤销 → 节点数回落；重做 → 恢复
    await historyBar.getByRole('button', { name: '撤销' }).click()
    await expect(flowNodes).toHaveCount(initialCount, { timeout: 10000 })
    await historyBar.getByRole('button', { name: '重做' }).click()
    await expect(flowNodes).toHaveCount(initialCount + 1, { timeout: 10000 })

    // Req7：鼠标移到节点上出现「＋」，点它直接从弹窗选一个节点接到后面
    const lookup = flowNodes.filter({ hasText: '按问题查表单' }).first()
    await lookup.hover()
    const plus = lookup.locator('[data-testid="node-plus"]')
    // 🔴 用 toHaveCSS 而不是 toBeVisible：按钮平时是 opacity:0，而 Playwright 认为 opacity:0 也算「可见」
    await expect(plus).toHaveCSS('opacity', '1', { timeout: 5000 })
    await plus.click()
    const quick = page.locator('[data-testid="quick-add-dialog"]')
    await expect(quick).toBeVisible({ timeout: 10000 })
    await expect(quick).toContainText('按问题查表单')
    const countBeforeQuick = await flowNodes.count()
    // 🔴 必须用「知识检索」这个唯一标签：快捷弹窗每项同时渲染 标签+描述，
    //   「知识库」只出现在描述里（可能命中多项），「大模型」更是同时是 大模型 的标签和 LLM 条件 的描述
    await quick.locator('.wf-quick__item').filter({ hasText: '知识检索' }).first().click()
    await expect(quick).toBeHidden({ timeout: 10000 })
    await expect(flowNodes).toHaveCount(countBeforeQuick + 1, { timeout: 10000 })
    // 新节点被自动选中，属性面板跟着切过去
    await expect(page.getByText('节点配置').first()).toBeVisible({ timeout: 10000 })

    // Req2：删除节点不弹二次确认（撤销能兜底）。删除按钮已搬到右侧属性面板（就近操作）
    const delNodeBtn = page.locator('[data-testid="delete-node-btn"]')
    await expect(delNodeBtn).toBeVisible({ timeout: 10000 })
    await delNodeBtn.click()
    // 立刻掉一个节点，且没有任何确认弹窗插进来
    await expect(flowNodes).toHaveCount(countBeforeQuick, { timeout: 10000 })
    await expect(page.locator('.el-message-box')).toHaveCount(0)
    // 撤销把它找回来
    await historyBar.getByRole('button', { name: '撤销' }).click()
    await expect(flowNodes).toHaveCount(countBeforeQuick + 1, { timeout: 10000 })

    // 沙箱测试抽屉能打开（不实际跑，避免消耗 token；运行链路由 agent-workflow-sandbox 覆盖）
    await page.getByRole('button', { name: '沙箱测试' }).click()
    await expect(page.locator('[data-testid="sandbox-drawer"]')).toBeVisible({ timeout: 10000 })
    // 不关抽屉：下面走 page.goto 硬跳，Vue Router 的未保存守卫拦不到，也就没必要跟关闭按钮较劲

    // 清理 + 顺带验删除交互：硬跳回列表（绕过未保存改动守卫）→ 删除刚建的草稿。
    // 🔴 这段别删、也别指望它兜底 —— 真正的兜底在上面的 afterAll，这段只在用例走到这里时才执行。
    await gotoWithAuth(page, '/ai/agent/workflow')
    const row = page.locator('.el-table__body tr').filter({ hasText: WF_CODE }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: '删除成功' }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: WF_CODE })).toHaveCount(0, {
      timeout: 15000
    })
    await expect(page).toHaveURL(LIST_URL)
  })
})
