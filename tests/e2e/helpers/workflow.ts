import { expect, type Page } from '@playwright/test'

/**
 * 流程编排列表页的公共动作
 *
 * 抽出来的直接原因：Req1 把「新增 / 编辑元信息」从 640px 弹窗改成了页内面板，定位方式随之从
 * `.el-dialog` 换成 `.panel-title` / `.panel-header` / `form.el-form`，而「点新增 → 填名称编码 →
 * 选经典案例 → 确定」这套开场白在 5 个用例里逐字重复。散着写的话，下次这个表单再换形态
 * （弹窗 ↔ 面板 ↔ 整页，它已经换过三回了）又要改五处。
 */

/**
 * 页内面板的三个锚点
 *
 * 🔴 面板与列表是同级条件渲染（v-if / v-else-if）：面板在的时候列表整块——含搜索表单和「查看画布」
 *    「执行历史」「版本」「触发案例」四个弹窗——都不在 DOM 里。所以这里不必像弹窗那样先 filter 出
 *    某一层再往里定位，页面上同时只有一份 `form.el-form`。
 * 🔴 反过来说，断言「面板已关闭」要用 `toHaveCount(0)` 而不是 `toBeHidden()`：它是被卸载的，
 *    而 toBeHidden 对不存在的元素也算通过，写不出区别。
 */
export function workflowPanel(page: Page) {
  return {
    /** 面板标题：新增流程 / 编辑流程信息 */
    title: page.locator('.panel-title'),
    /** 表单本体，用来定位字段、控件与内联的经典案例卡 */
    form: page.locator('form.el-form'),
    /** 顶部动作条：返回 / 取消 / 确定 */
    header: page.locator('.panel-header')
  }
}

export type WorkflowPanel = ReturnType<typeof workflowPanel>

/** 点列表页「新增」，等页内面板出现 */
export async function openWorkflowCreatePanel(page: Page): Promise<WorkflowPanel> {
  await page.getByRole('button', { name: '新增', exact: true }).first().click()
  const panel = workflowPanel(page)
  await expect(panel.title).toHaveText('新增流程', { timeout: 15000 })
  return panel
}

/**
 * 走完新增面板：填名称与编码、选「经典案例」起步模板、点确定
 *
 * 不含跳转断言：有的用例要等设计器 URL，有的只关心建完草稿后留在列表，交给调用方。
 *
 * 🔴 按钮文案是「确 定」（Element 在两个汉字之间插的空格），故用 `\s*` 容错的正则而不是 exact 字符串。
 * 🔴 起步模板用 `.el-radio` 容器定位而不是 getByText：面板内联的案例卡与 form-tip 里也出现
 *    「经典案例」四个字，getByText 会撞严格模式（多匹配）而失败。
 */
export async function createWorkflowDraft(page: Page, opts: { code: string; name: string }) {
  const panel = await openWorkflowCreatePanel(page)
  await panel.form.locator('input[placeholder="请输入流程名称"]').fill(opts.name)
  await panel.form.locator('input[placeholder*="小写字母开头"]').fill(opts.code)
  await panel.form.locator('.el-radio').filter({ hasText: '经典案例' }).first().click()
  await panel.header.getByRole('button', { name: /确\s*定/ }).click()
}
