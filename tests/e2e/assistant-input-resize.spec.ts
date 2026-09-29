import { test, expect, type Locator, type Page } from '@playwright/test'
import { gotoWithAuth, login } from './helpers/auth'

/**
 * 智能助手输入框「上下拖大」验证（2026-09-29 三轮追加需求）
 *
 * 🔴 为什么非要走浏览器
 * 用户的原话是「输入超过 4 行就要滚动查看了」。这句话描述的是一个<b>几何事实</b>：
 * textarea 的 scrollHeight 超过了 clientHeight，于是长提示词只能在框内滚着看。
 * 单测里没有布局，接口测试里更没有 —— 只有真浏览器能量出这两个数并证明拖动改变了它们。
 *
 * 三个失败模式，逐条守住：
 *   ① 拖了但高度没变（内联 height 没生效 / :deep 的 height:100% 没穿透到 textarea）
 *   ② 高度变了但内部还是要滚（撑的是外壳，textarea 自己没跟着长）—— 这正是本次需求的靶心
 *   ③ 拖高之后把消息区挤没了、或输入框自己溢出视口（flex 布局没做 flex-shrink-0 / 没设上限）
 *
 * 前置：后端 48080 + 前端 dev server 在跑。本文件不发消息，不需要可用模型。
 */

/** 独立页与悬浮球抽屉共用同一份 AssistantChat，量法必须一致，否则两处会各修各的 */
async function metrics(locator: Locator) {
  return locator.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight
  }))
}

/** 造一段超过默认 3 行容量的正文：8 行，逐行不同，避免被折叠/去重干扰 */
const LONG_PROMPT = Array.from({ length: 8 }, (_, i) => `第${i + 1}行：请检查这里的配置是否符合要求`).join(
  '\n'
)

/**
 * 从热区中心往上拖 delta 像素
 *
 * 🔴 起点必须是 boundingBox 的几何中心：热区只有 6px 高、又骑在分割线上，
 *    用默认的中心点没问题，但一旦拿左上角当起点，mousedown 会落到热区外，拖动整个不触发。
 */
async function dragHandleUp(page: Page, handle: Locator, delta: number) {
  const box = await handle.boundingBox()
  expect(box, '拿不到拖拽热区的位置').not.toBeNull()
  const startX = box!.x + box!.width / 2
  const startY = box!.y + box!.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY - delta, { steps: 12 })
  await page.mouse.up()
}

test.describe('AI 助手 · 输入框上下拖大', () => {
  test.setTimeout(180_000)

  test('独立页：8 行提示词默认要滚，往上拖后不用滚，双击恢复', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')

    const wrap = page.locator('.agent-input-wrap')
    const textarea = wrap.locator('textarea')
    await expect(textarea).toBeVisible({ timeout: 20_000 })

    await textarea.fill(LONG_PROMPT)

    // ① 默认态确实是要滚的 —— 先把「病症」量出来，否则后面「治好了」无从证明
    const before = await metrics(textarea)
    expect(
      before.scrollHeight,
      `8 行文本在默认 3 行框里本该溢出，实测 scrollHeight=${before.scrollHeight} clientHeight=${before.clientHeight}`
    ).toBeGreaterThan(before.clientHeight)

    const handle = page.locator('[data-testid="chat-input-resize"]')
    await expect(handle).toBeVisible()
    await dragHandleUp(page, handle, 160)

    // ② 框真变高了，并且高到能一次看全（clientHeight >= scrollHeight 才叫「不用滚」）
    const after = await metrics(textarea)
    expect(
      after.clientHeight,
      `往上拖 160px 后输入框没变高（前 ${before.clientHeight} → 后 ${after.clientHeight}）`
    ).toBeGreaterThan(before.clientHeight + 100)
    expect(
      after.clientHeight,
      `拖高之后 8 行仍要滚着看：clientHeight=${after.clientHeight} < scrollHeight=${after.scrollHeight}`
    ).toBeGreaterThanOrEqual(after.scrollHeight)

    // ③ 代价可控：消息区不能被挤没，输入框也不能溢出视口
    const scrollArea = page.locator('[data-testid="assistant-scroll"]')
    const scrollBox = await scrollArea.boundingBox()
    expect(scrollBox, '拿不到消息区尺寸').not.toBeNull()
    expect(scrollBox!.height, '输入框拉高后消息区被挤没了').toBeGreaterThan(120)
    const taBox = await textarea.boundingBox()
    expect(taBox!.y + taBox!.height, '输入框溢出了视口').toBeLessThanOrEqual(
      page.viewportSize()!.height
    )

    // ④ 双击热区回到默认：不是「拖回去」，而是一键还原（用户拖过头时的退路）
    await handle.dblclick()
    const reset = await metrics(textarea)
    expect(
      reset.clientHeight,
      `双击后没有恢复默认高度（当前 ${reset.clientHeight}，默认 ${before.clientHeight}）`
    ).toBeLessThanOrEqual(before.clientHeight + 4)
    expect(reset.scrollHeight, '恢复默认后 8 行文本又该溢出了').toBeGreaterThan(reset.clientHeight)
  })

  test('独立页：往上拖有上限，不会把对话区吃光', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')

    const textarea = page.locator('.agent-input-wrap textarea')
    await expect(textarea).toBeVisible({ timeout: 20_000 })
    const scrollArea = page.locator('[data-testid="assistant-scroll"]')
    const beforeScroll = (await scrollArea.boundingBox())!.height

    // 拖一个远超上限的距离（2000px）：真被拖到 2000 高的话，消息区会被压成 0
    const handle = page.locator('[data-testid="chat-input-resize"]')
    await dragHandleUp(page, handle, 2000)

    const box = await textarea.boundingBox()
    expect(box, '拿不到输入框尺寸').not.toBeNull()
    expect(box!.height, `输入框高度没被夹住：${box.height}px`).toBeLessThanOrEqual(484)
    // 上限的真正含义是「给对话留活路」，所以断言落在消息区上而不是像素数上：
    // 按视口比例算的话，720 高的窗口里能拖到只剩 83px 消息区 —— 输入框大了，回答却看不见
    const afterScroll = (await scrollArea.boundingBox())!.height
    expect(
      afterScroll,
      `拖到顶后消息区被挤没了：${afterScroll}px（原本 ${beforeScroll}px）`
    ).toBeGreaterThanOrEqual(150)
  })

  test('悬浮球抽屉：compact 形态下同样能拖高，且输入框仍在可视区内', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/infra/data-manage/data-model')

    await page.mouse.move(180, 300)
    await page.locator('[data-testid="agent-dock-ball"]').click()
    const drawer = page.locator('.agent-dock-drawer')
    await expect(drawer).toBeVisible({ timeout: 10_000 })
    const textarea = drawer.locator('.agent-input-wrap textarea')
    await expect(textarea).toBeVisible({ timeout: 20_000 })

    await textarea.fill(LONG_PROMPT)
    const before = await metrics(textarea)
    expect(
      before.scrollHeight,
      '抽屉里 2 行框装 8 行文本本该溢出，量不出病症就没法证明修好了'
    ).toBeGreaterThan(before.clientHeight)

    await dragHandleUp(page, drawer.locator('[data-testid="chat-input-resize"]'), 140)

    const after = await metrics(textarea)
    expect(after.clientHeight, '抽屉里拖不动').toBeGreaterThan(before.clientHeight + 80)
    expect(
      after.clientHeight,
      `抽屉里拖高后 8 行仍要滚：clientHeight=${after.clientHeight} < scrollHeight=${after.scrollHeight}`
    ).toBeGreaterThanOrEqual(after.scrollHeight)

    // 抽屉是满屏高的浮层，输入框被顶出可视区的话用户连发送按钮都看不到
    const box = await textarea.boundingBox()
    expect(box!.y + box!.height, '抽屉里输入框被挤出可视区').toBeLessThanOrEqual(
      page.viewportSize()!.height
    )
    await expect(drawer.getByRole('button', { name: /发\s*送/ })).toBeVisible()
  })
})
