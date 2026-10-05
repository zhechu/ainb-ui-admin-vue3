import { test, expect } from '@playwright/test'
import { login, gotoWithAuth, apiLogin } from './helpers/auth'
import { deleteWorkflowDraftsByCode } from './helpers/workflow'

/**
 * 流程定义 新建 → 体检 → 保存草稿 → 编辑元信息 → 设计 → 删除 全生命周期端到端验证
 *
 * 🔴 本用例的历史与三次改版：
 *   - 最早：新建/编辑是「900px 表单弹窗套 1200px 可视化弹窗」，用例操作 dialog。
 *   - 第二轮（AI助手 UX 问题3）：改成隐藏路由整页设计器 /agent-workflow/editor，用例改操作整页，
 *     列表页「新增流程」直接跳设计器、code/name 在顶栏就地填。
 *   - 第三轮（6 项优化 Req2「新增与设计分开」）：列表页按钮改为「新增」，先弹**元信息弹窗**
 *     （名称 + 编码 + 触发方式 + 起步模板）建好草稿，再带 ?id= 进设计器；行操作拆成
 *     「设计」（跳设计器画画布）与「编辑」（弹窗只改元信息）。
 *   - 本轮（Req1「新增流程页内显示」）：元信息从 640px 弹窗改成**页内面板**（与工具管理同一套范式），
 *     列表与面板是同级条件渲染，URL 不变。故本用例把 dialog 定位换成 .panel-title / .panel-header。
 *
 * 🔴 为什么非要走浏览器：接口通不等于整页设计器能挂载、VueFlow 不 0 高塌陷(R1)、体检结果能内联展示、
 *   保存后 URL 带 id 防刷新重复新建、返回列表出现新行、「编辑」面板里 code 只读且按 id 回填。
 *   这些只有真实 DOM 才暴露（本模块头号缺陷正是「配了/点了但不生效且无提示」）。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。经典案例模板不含大模型节点的真实调用。
 * 数据自净：第 9 步的删除**本身就是被测行为**（顺带把数据带走）；`afterAll` 再按 code 兜一次底，
 *           保证用例红在第 1~8 步任何一处时草稿也不会留在库里（F1 / §4.7）。
 *
 * 判据：新增面板建草稿 → 设计器挂载（骨架 ≥3 节点、非 0 高、URL 带 ?id=）→ 编码只读且等于面板里填的
 *       → 体检「通过」→ 改名后保存草稿「保存成功」→ 返回列表见新行 → 「编辑」面板 code 只读 + name 回填
 *       → 「设计」再进设计器 → 删除清理。
 */

// 编辑器隐藏路由是 /agent-workflow/editor（连字符），列表页是 /ai/agent/workflow（斜杠），别混
const EDITOR_URL = /\/agent-workflow\/editor/
const LIST_URL = /\/ai\/agent\/workflow$/

/**
 * 唯一 code，匹配 ^[a-z][a-z0-9_]{1,63}$。
 *
 * 🔴 提到模块级是为了 `afterAll` 能读到。与 `agent-workflow-editor.spec.ts` 同前缀（都是 `wf_e2e_`），
 *    故兜底清理按**全等**复核后才删 —— 否则两个 spec 并行跑时会互删对方的草稿。
 */
const WF_CODE = `wf_e2e_${Date.now().toString(36)}`

test.describe('流程定义：新增面板-体检-保存-编辑-设计-删除', () => {
  test.setTimeout(150_000)

  /**
   * 兜底清理（F1）。第 9 步走通时草稿已经删掉了，这里删到 0 行是**预期结果**，不是失败；
   * 它真正起作用的是「用例红在第 1~8 步」那种情况 —— 而那恰恰是最容易漏数据的时候。
   */
  test.afterAll(async ({ request }) => {
    const token = await apiLogin(request)
    await deleteWorkflowDraftsByCode(request, token, WF_CODE)
  })

  test('全生命周期', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    const name = `E2E 表单流程 ${WF_CODE}`

    // 1. 列表页「新增」→ 页内元信息面板（Req1：由弹窗改页内；Req2：新增与设计分开）
    await page.getByRole('button', { name: '新增', exact: true }).click()
    // 🔴 面板与列表是同级条件渲染：面板出现时列表整块（含搜索表单、各弹窗）都不在 DOM 里，
    //    所以这里不需要像弹窗那样先 filter 出某一层再往里定位，直接按页面唯一性取即可。
    const panelTitle = page.locator('.panel-title')
    await expect(panelTitle).toHaveText('新增流程', { timeout: 15000 })
    const form = page.locator('form.el-form')
    // 需求6：元信息里只留「描述」，不能再有「备注」。
    // 🔴 两个字段语义完全重叠，留着用户就得猜「这句该写哪儿」，两处都写又会各自漂移；
    //    后端 AgentWorkflowDefDO.remark 已随 xpy-2026-09-29-agent-workflow-def-drop-remark.sql 一并删掉
    await expect(form.locator('.el-form-item__label').filter({ hasText: '描述' })).toHaveCount(1)
    await expect(form.locator('.el-form-item__label').filter({ hasText: '备注' })).toHaveCount(0)
    await form.locator('input[placeholder="请输入流程名称"]').fill(name)
    await form.locator('input[placeholder*="小写字母开头"]').fill(WF_CODE)
    // 起步模板选「经典案例」：按当前触发方式生成一条完整可过双层校验的骨架
    // 🔴 用 .el-radio 容器定位而不是 getByText：面板内联的案例卡与 form-tip 里也出现「经典案例」四个字，
    //    getByText 会撞严格模式（多匹配）而失败
    await form.locator('.el-radio').filter({ hasText: '经典案例' }).first().click()
    // 🔴 按钮文案写的是「确 定」（Element 两个汉字间的空格），故用 \s* 容错的正则而不是 exact 字符串
    await page.locator('.panel-header').getByRole('button', { name: /确\s*定/ }).click()

    // 2. 草稿落库后带 ?id= 进整页设计器（id 已在 URL 上 → 刷新不会重复新建）
    await page.waitForURL(/\/agent-workflow\/editor\?id=\d+/, { timeout: 20000 })

    // 2b. 整页设计器挂载：画布渲染出案例骨架（≥3 节点），且 VueFlow 非 0 高（R1 守卫）
    const flowNodes = page.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 20000 })
    expect(await flowNodes.count()).toBeGreaterThanOrEqual(3)
    const flowBox = await page.locator('.vue-flow').first().boundingBox()
    expect(flowBox?.height ?? 0).toBeGreaterThan(100)

    // 2c. 编码在顶栏只读回填（Req2 之后编码只在新增面板里定，设计器不再让人改）
    await expect(page.locator('input[placeholder="流程编码"]')).toBeDisabled({ timeout: 15000 })
    await expect(page.locator('input[placeholder="流程编码"]')).toHaveValue(WF_CODE)
    await expect(page.locator('input[placeholder="流程名称"]')).toHaveValue(name)

    // 3. 体检 → 内联展示「体检通过」（经典案例骨架合法，能过后端双层校验）
    // 🔴 断言 toast 用 /体检通过/ 而不是内联 alert 的整句：有 warning 时 alert 标题不同，
    //    但两种情况都算「通过」，不该因为多一条建议就把用例判死
    await page.getByRole('button', { name: '体检' }).click()
    await expect(page.locator('.el-message').filter({ hasText: '体检通过' }).first()).toBeVisible({
      timeout: 20000
    })

    // 4. 改名后保存草稿：id 已存在 → 走更新（toast 是「保存成功」而非「新建成功」），URL 保持带 id
    const renamed = `${name} 改`
    await page.locator('input[placeholder="流程名称"]').fill(renamed)
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page.locator('.el-message').filter({ hasText: '保存成功' }).first()).toBeVisible({
      timeout: 20000
    })
    await expect(page).toHaveURL(/\/agent-workflow\/editor\?id=\d+/)

    // 5. 返回列表（保存后 dirty=false，返回不弹确认）→ 新行出现，且显示的是改后的名字
    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(LIST_URL, { timeout: 15000 })
    const newRow = page.locator('.el-table__body tr').filter({ hasText: WF_CODE }).first()
    await expect(newRow).toBeVisible({ timeout: 15000 })
    await expect(newRow).toContainText(renamed)

    // 6. 行「编辑」→ 页内元信息面板：code 只读、name 按 id 回填（列表不带 dsl，面板自己按 id 拉完整定义）
    await newRow.getByRole('button', { name: '编辑' }).click()
    await expect(panelTitle).toHaveText('编辑流程信息', { timeout: 15000 })
    const editForm = page.locator('form.el-form')
    await expect(editForm.locator('input[placeholder*="小写字母开头"]')).toBeDisabled()
    await expect(editForm.locator('input[placeholder*="小写字母开头"]')).toHaveValue(WF_CODE)
    await expect(editForm.locator('input[placeholder="请输入流程名称"]')).toHaveValue(renamed)
    // 取消 → 面板卸载、列表回来（v-else-if 切换，不是隐藏），故断言 count 0 而不是 hidden
    await page.locator('.panel-header').getByRole('button', { name: /取\s*消/ }).click()
    await expect(panelTitle).toHaveCount(0, { timeout: 15000 })

    // 7. 行「设计」→ 整页设计器（Req2 的「设计与编辑分开」另一半）
    await newRow.getByRole('button', { name: '设计' }).click()
    await page.waitForURL(/\/agent-workflow\/editor\?id=\d+/, { timeout: 15000 })
    await expect(flowNodes.first()).toBeVisible({ timeout: 20000 })
    await expect(page.locator('input[placeholder="流程名称"]')).toHaveValue(renamed)

    // 8. 返回列表（loadDef 后 dirty=false，返回不弹确认）
    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(LIST_URL, { timeout: 15000 })

    // 9. 删除（既验证删除、又清理数据）：列表页删除仍保留二次确认（不可逆，且这里没有撤销兜底）
    // 🔴 这一步是**被测行为**，不是纯清理，别搬进 afterAll —— 搬走就等于不验删除了。
    //    兜底交给 describe 顶上那个 afterAll，它负责的是「本步之前就红掉」那种情况。
    const targetRow = page.locator('.el-table__body tr').filter({ hasText: WF_CODE }).first()
    await expect(targetRow).toBeVisible({ timeout: 15000 })
    await targetRow.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: '删除成功' }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: WF_CODE })).toHaveCount(0, {
      timeout: 15000
    })
  })
})
