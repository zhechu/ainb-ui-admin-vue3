import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'
import { monacoOf, setMonacoText } from './helpers/monaco'
import { createWorkflowDraft } from './helpers/workflow'

/**
 * 流程设计器「类型化输入/输出端口 + 上游变量引用」端到端验证（6 项优化 Req5 / Phase E）
 *
 * 🔴 Req5 原话：节点属性页要把「前序节点的输入/输出定义清楚（类似 coze 的类型化端口），并说明后序节点
 *   如何引用，让非技术人员也能快速上手」。实现为叠加在既有扁平状态模型上的「契约层」：属性面板给每个
 *   可引用字段标类型色点 + 类型名 + 挂「引用上游变量」选择器，并展示「本节点产出（供下游引用）」。
 *
 * 🔴 为什么非要走浏览器：单测（nodeIoContract.spec / ioReference.spec）只证纯函数，证不了「选中节点后
 *   属性面板真渲染出类型色点/产出区、点『引用上游变量』真弹出上游产出、点选真把 {{$.var}} 写进字段并
 *   同步回事实源 DSL」——这些只有真实 DOM 才暴露。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。数据自净：末尾删除新建草稿。
 *
 * 判据：经典案例（chat）的工具节点「按问题查表单」（outputVar=forms）选中后 → 属性面板出「本节点产出（供下游引用）」列出
 *       forms（对象）→ 开发者模式注入 tool→llm 链 → 选中 llm → 提示词字段出「引用上游变量」入口 →
 *       点开列出上游 listOut → 点选后提示词写入 {{$.listOut}}（面板 selConfig 即 DSL 节点的真实 config 引用，
 *       故这一步同时证明写回了事实源）。
 *       第二例钉 mode 的承重性：同样有上游产出时，tool.args 挂选择器而 hitl.bpm_approval.formVars 不挂。
 */

const EDITOR_URL = /\/agent-workflow\/editor/

/** 注入用：START→工具(产出 listOut)→大模型→END 的两节点链，让大模型有「上游产出」可引用 */
const CHAIN_DSL = {
  dslVersion: '1.0',
  id: 'wf_io_chain',
  name: 'IO 引用测试',
  variables: [{ key: 'input', type: 'string', merge: 'replace' }],
  nodes: [
    {
      id: 't1',
      type: 'tool',
      name: '取数',
      config: { toolId: 'data_interface_list', args: {}, outputVar: 'listOut' }
    },
    { id: 'l1', type: 'llm', name: '总结节点', config: { prompt: '', outputVar: '' } }
  ],
  edges: [
    { from: 'START', to: 't1' },
    { from: 't1', to: 'l1' },
    { from: 'l1', to: 'END' }
  ],
  settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
}

/**
 * 注入用：START→工具(t1，产出 listOut)→工具(t2，**未配 outputVar**)→审批(b1)→END
 *
 * 🔴 关键是 t2/b1 都**有**上游产出（listOut）：VariableRefPicker 的触发按钮除了受 mode 约束，
 *   还受 `v-if="upstream.length"` 约束。若待测节点没有上游，「按钮不在」就分不清是 mode 拦的
 *   还是没东西可引 —— 断言会退化成恒真。
 * 🔴 t2 刻意不配 outputVar，用来验「契约补上默认名后，画布也报出兜底产出 tool_result」。
 */
const MODE_DSL = {
  dslVersion: '1.0',
  id: 'wf_io_mode',
  name: 'IO 模式测试',
  variables: [{ key: 'input', type: 'string', merge: 'replace' }],
  nodes: [
    {
      id: 't1',
      type: 'tool',
      name: '取数',
      config: { toolId: 'data_interface_list', args: {}, outputVar: 'listOut' }
    },
    {
      id: 't2',
      type: 'tool',
      name: '无参工具',
      config: { toolId: 'data_interface_list', args: {} }
    },
    {
      id: 'b1',
      type: 'hitl.bpm_approval',
      name: '走审批',
      config: { bpmProcessDefKey: '', approveVar: 'bpm_approved', statusVar: 'bpm_status', formVars: {} }
    }
  ],
  edges: [
    { from: 'START', to: 't1' },
    { from: 't1', to: 't2' },
    { from: 't2', to: 'b1' },
    { from: 'b1', to: 'END' }
  ],
  settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
}

test.describe('流程设计器：类型化 I/O 端口 + 上游引用（Req5）', () => {
  test.setTimeout(150_000)

  test('属性面板产出区 + 引用上游变量选择器写入 {{$.var}}', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    // 新增 → 经典案例草稿（默认模板；触发方式默认 chat → 「表单问答助手」案例）→ 跳设计器
    const stamp = Date.now()
    const code = `wf_io_${stamp}`
    await createWorkflowDraft(page, { code, name: `IO测试${stamp}` })
    await page.waitForURL(EDITOR_URL, { timeout: 20000 })

    const flowNodes = page.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 20000 })
    // 🔴 Req4：缩放按钮搬到了顶栏（与撤销/重做同一行），旧的画布工具条已删除
    const historyBar = page.locator('.wf-editor__history')
    const fitBtn = historyBar.getByRole('button', { name: '适配画布' })

    // 1) 选中案例里的工具节点「按问题查表单」（outputVar=forms）→ 属性面板出「本节点产出（供下游引用）」+ forms
    await fitBtn.click()
    await flowNodes.filter({ hasText: '按问题查表单' }).first().click()
    await expect(page.getByText('本节点产出（供下游引用）').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.wf-io__var').filter({ hasText: 'forms' }).first()).toBeVisible()
    // 类型化字段：至少渲染出一个类型名标签（Req5「类型化端口」的可视证据）
    await expect(page.locator('.wf-field-type').first()).toBeVisible({ timeout: 10000 })

    // 2) 开发者模式 → 注入 tool→llm 两节点链（让大模型有上游产出可引用）
    await page.locator('[data-testid="dev-mode-switch"]').click()
    const jsonPanel = page.locator('[data-testid="dsl-json-panel"]')
    await expect(jsonPanel).toBeVisible({ timeout: 10000 })
    // 🔴 Req6：底部流程 JSON 已是 Monaco 代码框，不能用 fill()（Monaco 的真实内容在 model 里，
    //   DOM 上那个 textarea 只承载正在输入的一行）——统一走 helpers/monaco 的 全选+删除+insertText
    const dslEditor = monacoOf(jsonPanel)
    await setMonacoText(page, dslEditor, JSON.stringify(CHAIN_DSL, null, 2))
    await expect(jsonPanel.locator('[data-testid="dsl-json-status"]')).toContainText(
      'JSON 格式正确',
      { timeout: 10000 }
    )
    await jsonPanel.getByRole('button', { name: '应用到画布' }).click()

    // 3) 选中新链里的大模型节点「总结节点」
    await fitBtn.click()
    await page.locator('.vue-flow__node').filter({ hasText: '总结节点' }).first().click()
    await expect(page.getByText('节点配置').first()).toBeVisible({ timeout: 10000 })

    // 4) 提示词字段（可引用）出「引用上游变量」入口 → 点开列出上游 listOut → 点选写入 {{$.listOut}}
    const promptItem = page.locator('.el-form-item').filter({ hasText: '提示词' }).first()
    const refTrigger = promptItem.locator('[data-testid="vref-trigger"]')
    await expect(refTrigger).toBeVisible({ timeout: 10000 })
    await refTrigger.click()
    const refItem = page.locator('.vref__item').filter({ hasText: 'listOut' }).first()
    await expect(refItem).toBeVisible({ timeout: 10000 })
    await refItem.click()

    // 写进事实源 DSL：属性面板的 selConfig 就是 DSL 节点上那个真实 config 对象引用（useWorkflowEditor
    // 里 computed 直接返回 selectedNode.config），所以提示词输入框的值 == dslObject 里 l1.config.prompt。
    // 🔴 不去读底部 Monaco：它按视口虚拟化渲染，几十行的 JSON 只有可见的十来行在 DOM 里，断言会假失败。
    await expect(promptItem.locator('textarea')).toHaveValue(/\{\{\$\.listOut\}\}/, {
      timeout: 10000
    })

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

  /**
   * 🔴 契约的 `mode` 不是文案，是承重结构：它经 canRefField 决定属性面板要不要给这个字段挂
   *   「引用上游变量」选择器，而选择器 emit 的是**字符串**、onPickRef 直接 `selConfig[key] = value` 整体赋值。
   *   formVars 是**对象**字段，被换成字符串后 configMap("formVars") 返回 null ⟹ 用户配的审批表单变量全丢，
   *   且全程无提示。它的 mode 曾是 both，所以这条路一直开着。
   *
   * 为什么非要走浏览器：mode → canRefField → v-if 渲染这条链只有真实 DOM 才暴露；
   * 而且 VariableRefPicker 的触发按钮还额外受 `v-if="upstream.length"` 约束 —— 没有上游产出时
   * 「按钮不在」既可能是 mode 拦住了、也可能是没东西可引，两者在 DOM 上无法区分。
   * 所以本例刻意让待测节点**有**上游产出（t1 产出 listOut），把「没得引」这个混淆因素排掉。
   *
   * 正向对照：同一个上游下，t2 的 args（mode=both，后端真的解析顶层字符串值）**必须**还挂着选择器。
   * 少了这条，把两个字段一起降成 literal 也能让上面的断言变绿 —— 那就把真能力也砍了。
   */
  test('formVars 不再挂「引用上游变量」（对象字段被换成字符串会静默丢配置），args 仍挂', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    const stamp = Date.now()
    const code = `wf_iomode_${stamp}`
    await createWorkflowDraft(page, { code, name: `IO模式${stamp}` })
    await page.waitForURL(EDITOR_URL, { timeout: 20000 })
    await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20000 })

    const fitBtn = page.locator('.wf-editor__history').getByRole('button', { name: '适配画布' })
    await page.locator('[data-testid="dev-mode-switch"]').click()
    const jsonPanel = page.locator('[data-testid="dsl-json-panel"]')
    await expect(jsonPanel).toBeVisible({ timeout: 10000 })
    await setMonacoText(page, monacoOf(jsonPanel), JSON.stringify(MODE_DSL, null, 2))
    await expect(jsonPanel.locator('[data-testid="dsl-json-status"]')).toContainText('JSON 格式正确', {
      timeout: 10000
    })
    await jsonPanel.getByRole('button', { name: '应用到画布' }).click()
    await fitBtn.click()

    // 1) 正向对照：t2（tool，未配 outputVar）的 args 仍挂选择器
    //    🔴 不去点开这个弹层：VariableRefPicker 的触发按钮本身就带 `v-if="upstream.length"`，
    //       它可见即已证明「t2 有上游产出可选」—— 而这正是要排掉的混淆因素
    //       （b1 与 t2 同以 t1 为祖先，故 b1 那边「按钮不在」只能是 mode 拦的，不是没东西可引）。
    //       点开再 Escape 反而会让弹层/面板盖住画布，后续节点点击被 intercept。
    await page.locator('.vue-flow__node').filter({ hasText: '无参工具' }).first().click()
    await expect(page.getByText('节点配置').first()).toBeVisible({ timeout: 10000 })
    const argsItem = page.locator('.el-form-item').filter({ hasText: '工具入参' }).first()
    await expect(argsItem.locator('[data-testid="vref-trigger"]')).toBeVisible({ timeout: 10000 })
    // 未配 outputVar 的 tool 也要报出兜底产出名 —— 执行器真的会写这个键，瞒着用户才是误导
    await expect(page.getByText('本节点产出（供下游引用）').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.wf-io__var').filter({ hasText: 'tool_result' }).first()).toBeVisible()

    // 2) 待测：b1（hitl.bpm_approval）的 formVars 不挂选择器，且 hint 明说占位符不生效
    //    🔴 先重新「适配画布」：b1 在链尾，属性面板展开后可能盖住它，直接点会被 intercept。
    await fitBtn.click()
    await page.locator('.vue-flow__node').filter({ hasText: '走审批' }).first().click()
    const formVarsItem = page.locator('.el-form-item').filter({ hasText: '审批表单参数' }).first()
    await expect(formVarsItem).toBeVisible({ timeout: 10000 })
    await expect(formVarsItem.locator('[data-testid="vref-trigger"]')).toHaveCount(0)
    await expect(formVarsItem.locator('.wf-panel__hint')).toContainText('不会被替换')

    // 清理
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
