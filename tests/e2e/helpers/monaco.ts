import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Monaco 代码编辑器的 e2e 读写助手
 *
 * 🔴 为什么不能用 locator.fill()：Monaco 的真内容在它的 model 里，DOM 上那个 textarea 只承载
 *   「当前正在输入的一行」，fill 把值塞进去 Monaco 根本不认，编辑器纹丝不动，断言随即全部超时。
 *
 * 🔴 为什么写入走「剪贴板 + Control+V」而不是 keyboard.insertText()：
 *   insertText 被 Monaco 当成**逐字输入**，多行文本里的每个换行都会触发一次 autoIndent，
 *   缩进逐行累加——实测把 782 字符 / 51 行的 JSON 撑成 6702 字符 / 52 行且解析失败。
 *   而真实粘贴走 Monaco 的 onPaste 路径，缩进只归一化一次，实测 624 字符 / 41 行原样落地、一字不差。
 *   所以多行内容必须用粘贴；单行内容两者皆可（insertText 无换行可累加，也是既有 spec 一直在用的写法）。
 *   注意这不是产品缺陷：真人 Ctrl+V 走的就是被验证过的那条路径。
 *
 * 🔴 为什么读内容要谨慎：Monaco 是虚拟滚动，`.view-lines` 只渲染视口内的行，长 JSON 读不全。
 *   能断言调用方自己的状态回显就断言那个（例如流程 JSON 面板底部的「N 个节点 / M 条连线」），
 *   实在要读全文再用 readMonacoText()，并且只断言视口内必然存在的片段。
 */

/** 定位作用域里的 Monaco 编辑器根元素 */
export const monacoOf = (scope: Locator): Locator => scope.locator('.monaco-editor').first()

/**
 * 整段替换 Monaco 编辑器内容（先全选删空再粘贴，避免追加在原文后面）。
 *
 * 剪贴板权限在这里就地授予：助手被多个 spec 复用，让每个 spec 各自记得 grantPermissions 太容易漏。
 * localhost 在 Chromium 里算安全上下文，navigator.clipboard 可直接用。
 */
export async function setMonacoText(page: Page, editor: Locator, text: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  await page.keyboard.press('Control+V')
  // 等 Monaco 把内容 change 事件冒泡到 v-model（同步是即时的，但视图重绘要一拍）
  await page.waitForTimeout(300)
}

/** 读出编辑器视口内已渲染的文本（nbsp 归一成普通空格，方便直接断言） */
export async function readMonacoText(editor: Locator): Promise<string> {
  return (await editor.locator('.view-lines').first().innerText()).replace(/\u00a0/g, ' ')
}

/** 断言编辑器已经渲染出来（比直接 click 更早暴露「组件没挂载」这类问题） */
export async function expectMonacoVisible(editor: Locator, timeout = 15_000): Promise<void> {
  await expect(editor).toBeVisible({ timeout })
}
