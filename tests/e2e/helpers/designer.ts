import { expect, type Page } from '@playwright/test'

/**
 * 表单设计器的公共导航动作
 *
 * 抽出来的直接原因：「逻辑与扩展」从向导的独立一步改成了设计器
 * 「表单配置」面板里的一个弹窗入口，进入路径从「点一下步骤名」变成了四步。
 * 这个序列在 e2e 里出现十几次，散着写一旦交互再变就要改十几处。
 */

/** 设计器右侧配置面板的页签名 */
type DesignerTab = '属性配置' | '表单配置' | '验证配置' | '事件配置'

/**
 * 切到向导的某一步
 *
 * 按名字定位而不是「序号+名字」：步骤序号会随步骤增减而变，
 * 用例关心的只是「这一步长什么样」，不该被顺序绑住。
 */
export async function gotoStep(page: Page, title: string) {
  await page.locator('.cursor-pointer').filter({ hasText: title }).first().click()
}

/** 切到设计器右侧配置面板的某个页签 */
export async function gotoDesignerTab(page: Page, tab: DesignerTab) {
  const target = page.locator('._fc-r-tab').filter({ hasText: tab }).first()
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.click()
}

/**
 * 打开「逻辑与扩展」弹窗
 *
 * 路径：表单设计这一步 → 右侧「表单配置」页签 → 入口按钮 → 弹窗。
 *
 * ⚠️ 入口按钮与弹窗标题同名，都叫「逻辑与扩展」。按钮限定在
 * `._fc-r-tab-form` 容器内定位，避免弹窗打开后再次匹配时选中标题。
 */
export async function openLogicDialog(page: Page) {
  await gotoStep(page, '表单设计')
  await gotoDesignerTab(page, '表单配置')

  const entry = page.locator('._fc-r-tab-form').getByRole('button', { name: /逻辑与扩展/ })
  await expect(entry).toBeVisible({ timeout: 30_000 })
  await entry.click()

  // 等弹窗真的渲染出来再交给调用方 —— 它是懒渲染的，点完到内容可见有一拍
  await expect(page.getByRole('dialog').filter({ hasText: '逻辑与扩展' })).toBeVisible({
    timeout: 30_000
  })
}

/** 关闭「逻辑与扩展」弹窗（走「完成」按钮，会触发一次就地校验） */
export async function closeLogicDialog(page: Page) {
  const dialog = page.getByRole('dialog').filter({ hasText: '逻辑与扩展' })
  await dialog.getByRole('button', { name: '完成' }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}
