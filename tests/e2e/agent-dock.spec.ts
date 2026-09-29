import { test, expect, type Locator, type Page } from '@playwright/test'
import { apiLogin, gotoWithAuth, login } from './helpers/auth'
import { createConversation, sweepTestConversations } from './helpers/agent'

/**
 * 全局悬浮助手入口的端到端验证（方案 §12「悬浮唤起 + 独立页面两种入口」）
 *
 * 🔴 为什么非要走浏览器
 * 这个入口的价值全在「在别的页面上也能用」。而它有三个只有真跑一遍才看得出来的失败模式：
 *   ① 悬浮球被别的固定定位元素遮住 / 点不到（z-index、Backtop 重叠）
 *   ② 抽屉打开了，但里面的对话区高度塌了、输入框被挤出可视区
 *   ③ 抽屉里的那份对话与独立页那份<b>行为不一致</b>（复用组件没复用成功）
 * 这三条接口测试与单测一条都覆盖不到。
 *
 * 后半段还守一批「历史会话」相关的失败模式，它们同样只在真浏览器里现形：
 *   ④ 切到历史列表时把对话组件销毁了 —— 正在生成的回答被 onBeforeUnmount 掐断，
 *      界面上看是「答案停在半截，再也不动了」
 *   ⑤ 刷新之后接不回刚才那次对话（本地记忆没写进去 / 写进去了没读出来）
 *   ⑥ 会话在别处被删了，恢复流程却弹一个错误框而不是安静地退回空态
 *
 * 前置：后端 48080 与前端 dev server 同时在跑；带「AI」字样的用例还需要一个可用的聊天模型。
 */

/** 刻意挑一个与助手无关的业务页面 —— 这正是它存在的意义：用户卡在某个页面上时不必离开就能问 */
const BUSINESS_PAGE = '/infra/data-manage/data-model'

const drawerOf = (page: Page) => page.locator('.agent-dock-drawer')

async function openDrawer(page: Page): Promise<Locator> {
  // Playwright 的鼠标默认停在 (0,0)，正好压在左上角的菜单上：手机上侧边菜单是折叠态，
  // 弹出的子菜单浮层能一直盖到右下角的悬浮球，于是 click 永远被 intercept。
  // 先把鼠标挪到内容区中间让浮层收起（桌面上球与菜单不重叠，这一步只是保险）
  await page.mouse.move(180, 300)
  await page.locator('[data-testid="agent-dock-ball"]').click()
  const drawer = drawerOf(page)
  await expect(drawer).toBeVisible({ timeout: 10_000 })
  // 对话区是懒挂载的：第一次打开要等它真的挂上来，否则后面全在跟 undefined 打交道
  await expect(drawer.locator('textarea')).toBeVisible({ timeout: 20_000 })
  return drawer
}

/**
 * 在抽屉里问一句并等到答完
 *
 * 判「答完」用的是<b>停止按钮消失</b>，不是答案里出现了某个词 ——
 * 模型答什么不由测试决定，但「流结束了」是确定的。
 */
async function askOnce(drawer: Locator, question: string) {
  await drawer.locator('textarea').fill(question)
  await drawer.getByRole('button', { name: /发送/ }).click()
  await expect(drawer.getByRole('button', { name: /停止/ })).toBeVisible({ timeout: 30_000 })
  await expect(drawer.getByRole('button', { name: /停止/ })).toHaveCount(0, { timeout: 120_000 })
}

/** 打开历史列表里某一条的操作菜单（菜单项在 body 层的浮层里，不在抽屉内） */
async function openItemMenu(page: Page, drawer: Locator, id: number): Promise<Locator> {
  const item = drawer.locator(`[data-conversation-id="${id}"]`)
  await expect(item).toBeVisible({ timeout: 10_000 })
  await item.hover()
  await item.locator('.el-dropdown').first().click()
  const menu = page.locator('.el-dropdown-menu:visible').last()
  await expect(menu).toBeVisible({ timeout: 10_000 })
  return menu
}

test.describe('AI 助手 · 全局悬浮入口', () => {
  // 带「AI」的用例要等一轮真实的流式问答（实测 20~60 秒），再加上登录与两次页面加载
  test.setTimeout(300_000)

  test('在业务页面上唤起：悬浮球可点、抽屉里是完整可用的对话区', async ({ page }) => {
    await login(page)
    // 刻意挑一个与助手无关的业务页面 —— 这正是它存在的意义：
    // 用户卡在某个页面上时，不必离开就能问
    await gotoWithAuth(page, '/infra/data-manage/data-model')

    // 1. 悬浮球应当出现，并且真的可以点到（被遮住的话 click 会超时）
    const ball = page.locator('[data-testid="agent-dock-ball"]')
    await expect(ball).toBeVisible({ timeout: 20000 })
    await ball.click()

    // 2. 抽屉里是完整的对话区：空态引导 + 输入框 + 发送按钮
    //    ⚠️ 必须用 .agent-dock-drawer 而不是 .el-drawer —— Layout 里还挂着
    //    「项目配置」那个抽屉，笼统匹配会 strict mode violation
    const drawer = page.locator('.agent-dock-drawer')
    await expect(drawer).toBeVisible({ timeout: 10000 })
    await expect(drawer.getByText('我是平台助手')).toBeVisible({ timeout: 20000 })

    const input = drawer.locator('textarea')
    await expect(input).toBeVisible()
    // 🔴 输入框必须在可视区内。抽屉高度算错时它会被挤到屏幕外 ——
    //    界面看着正常，但用户根本没法打字
    const box = await input.boundingBox()
    expect(box, '输入框拿不到位置，说明它没被渲染出来').not.toBeNull()
    const viewport = page.viewportSize()!
    expect(box!.y + box!.height, '输入框被挤出了可视区').toBeLessThanOrEqual(viewport.height)

    // 3. 引导问题也要在（它是空态里唯一的行动指引）
    await expect(
      drawer.locator('.el-tag__content').filter({ hasText: '为什么我配的联动不生效' }).first()
    ).toBeVisible({ timeout: 20000 })

    // 4. 收起后悬浮球还在，可以再次唤起
    await drawer.locator('[data-testid="agent-dock-close"]').click()
    await expect(drawer).not.toBeVisible({ timeout: 10000 })
    await expect(ball).toBeVisible()
  })

  test('🔴 助手独立页上整块不渲染 —— 否则页面与浮层里各有一个对话组件', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    await expect(page.getByText('我是平台助手').first()).toBeVisible({ timeout: 20000 })

    await expect(page.locator('[data-testid="agent-dock-ball"]')).toHaveCount(0)
    // 🔴 光藏球不够：抽屉不摘掉的话，里面的 AssistantChat 仍然挂在 DOM 上，
    //    两份组件各持有一条 SSE 连接与一个打字机定时器。实测踩到过
    await expect(page.locator('.agent-dock-drawer')).toHaveCount(0)
    await expect(page.getByText('我是平台助手')).toHaveCount(1)
  })

  test('抽屉里点「展开」跳到独立页，浮层那份随之消失', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/infra/data-manage/data-model')

    await page.locator('[data-testid="agent-dock-ball"]').click()
    await expect(page.locator('.agent-dock-drawer')).toBeVisible({ timeout: 10000 })

    await page.locator('[data-testid="agent-dock-expand"]').click()
    await page.waitForURL(/\/agent\/assistant/, { timeout: 20000 })
    await expect(page.getByText('我是平台助手').first()).toBeVisible({ timeout: 20000 })
    // 跳过去之后浮层那一份必须整个消失，否则就成了「页面里一个、浮层里还有一个」
    await expect(page.locator('[data-testid="agent-dock-ball"]')).toHaveCount(0)
    await expect(page.locator('.agent-dock-drawer')).toHaveCount(0)
    await expect(page.getByText('我是平台助手')).toHaveCount(1)
  })

  test('二轮需求1：左缘拖拽调宽 + 头部最大化/还原', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, BUSINESS_PAGE)
    const drawer = await openDrawer(page)

    // ⚠️ 亚像素：width 实测会返回 479.99998 这类值，统一 Math.round 再比
    const widthOf = async () => Math.round((await drawer.boundingBox())!.width)
    expect(await widthOf(), '默认宽度应保持改版前的 480').toBe(480)

    // 拖左缘往左 300px：抽屉贴右边，宽度应同步 +300（默认视口 1280，上限 90% 够不到）
    const handle = page.locator('[data-testid="agent-dock-resize"]')
    await expect(handle).toBeVisible()
    const hb = (await handle.boundingBox())!
    const startX = hb.x + hb.width / 2
    await page.mouse.move(startX, hb.y + 240)
    await page.mouse.down()
    await page.mouse.move(startX - 300, hb.y + 240, { steps: 10 })
    await page.mouse.up()
    const dragged = await widthOf()
    expect(dragged, '拖拽后抽屉没有变宽').toBe(780)

    // 最大化铺满视口；还原回「拖出来的宽度」而不是默认 480 —— 用户拖出的尺寸不该被一次最大化吃掉。
    // ⚠️ 最大化/还原的宽度变化是带 0.3s 动画的（只有拖拽期间关过渡），故用 expect.poll 等动画落地
    const viewportWidth = (await page.viewportSize())!.width
    await page.locator('[data-testid="agent-dock-maximize"]').click()
    await expect.poll(widthOf, { timeout: 5_000, message: '最大化后应铺满视口' }).toBe(viewportWidth)
    await page.locator('[data-testid="agent-dock-maximize"]').click()
    await expect.poll(widthOf, { timeout: 5_000, message: '还原后应回到拖拽出的宽度' }).toBe(dragged)
  })

  test('历史会话：抽屉里就能看到列表，点一条能切回去继续', async ({ page, request }) => {
    const token = await apiLogin(request)
    const title = `E2E 历史列表 ${Date.now()}`
    const id = await createConversation(request, token, title)
    try {
      await login(page)
      await gotoWithAuth(page, BUSINESS_PAGE)
      const drawer = await openDrawer(page)

      await drawer.locator('[data-testid="agent-dock-history"]').click()
      const item = drawer.locator(`[data-conversation-id="${id}"]`)
      await expect(item, '刚建的会话没出现在历史列表里').toBeVisible({ timeout: 15_000 })
      await expect(item).toContainText(title)
      // 分组标题：今天建的会话应当落在「今天」这一档下
      await expect(drawer.getByText('今天').first()).toBeVisible()

      // 🔴 对话区必须还挂在 DOM 上（只是被 v-show 藏了）。
      //    被 v-if 销毁的话，用户「翻个历史」的代价就是正在生成的回答被掐断
      await expect(drawer.getByText('我是平台助手')).toBeAttached()
      await expect(drawer.getByText('我是平台助手')).not.toBeVisible()

      // 点一条 → 回到对话视图。这条会话是空的，所以看到的仍是空态，
      // 但列表要收起、输入框要能用
      await item.click()
      await expect(item, '选中会话后没有切回对话视图').not.toBeVisible({ timeout: 10_000 })
      await expect(drawer.locator('textarea')).toBeVisible()
      await expect(drawer.getByText('我是平台助手')).toBeVisible()

      // 再进历史列表：刚才那条应当是选中态
      await drawer.locator('[data-testid="agent-dock-history"]').click()
      await expect(item).toHaveAttribute('data-active', 'true', { timeout: 15_000 })
      await drawer.locator('[data-testid="agent-dock-history-back"]').click()
      await expect(drawer.locator('textarea')).toBeVisible()
    } finally {
      await sweepTestConversations(request, token)
    }
  })

  test('历史会话：重命名与置顶都当场生效', async ({ page, request }) => {
    const token = await apiLogin(request)
    const title = `E2E 待改名 ${Date.now()}`
    const renamed = `${title} 已改`
    const id = await createConversation(request, token, title)
    try {
      await login(page)
      await gotoWithAuth(page, BUSINESS_PAGE)
      const drawer = await openDrawer(page)
      await drawer.locator('[data-testid="agent-dock-history"]').click()
      const item = drawer.locator(`[data-conversation-id="${id}"]`)
      await expect(item).toBeVisible({ timeout: 15_000 })

      // 重命名
      let menu = await openItemMenu(page, drawer, id)
      await menu.locator('.el-dropdown-menu__item').filter({ hasText: '重命名' }).click()
      const prompt = page.locator('.el-message-box').last()
      await expect(prompt).toBeVisible({ timeout: 10_000 })
      await prompt.locator('input').fill(renamed)
      await prompt.getByRole('button', { name: /确定/ }).click()
      await expect(item, '重命名没有生效').toContainText(renamed, { timeout: 15_000 })

      // 置顶：置顶的会话要被拎到「置顶」分组里
      menu = await openItemMenu(page, drawer, id)
      await menu.locator('.el-dropdown-menu__item').filter({ hasText: '置顶' }).click()
      await expect(drawer.getByText('置顶').first(), '置顶后没有出现「置顶」分组').toBeVisible({
        timeout: 15_000
      })
      await expect(item.locator('.iconify, svg').first()).toBeVisible()
    } finally {
      await sweepTestConversations(request, token)
    }
  })

  test('删掉正在看的会话：回到空态，但人还留在历史列表里', async ({ page, request }) => {
    const token = await apiLogin(request)
    const title = `E2E 待删除 ${Date.now()}`
    const id = await createConversation(request, token, title)
    try {
      await login(page)
      await gotoWithAuth(page, BUSINESS_PAGE)
      const drawer = await openDrawer(page)

      // 先选中它，让它成为「正在看的会话」
      await drawer.locator('[data-testid="agent-dock-history"]').click()
      await drawer.locator(`[data-conversation-id="${id}"]`).click()
      await expect(drawer.locator('textarea')).toBeVisible({ timeout: 10_000 })

      await drawer.locator('[data-testid="agent-dock-history"]').click()
      const menu = await openItemMenu(page, drawer, id)
      await menu.locator('.el-dropdown-menu__item').filter({ hasText: '删除' }).click()
      const confirm = page.locator('.el-message-box').last()
      await expect(confirm).toBeVisible({ timeout: 10_000 })
      await confirm.getByRole('button', { name: /确定/ }).click()

      await expect(
        drawer.locator(`[data-conversation-id="${id}"]`),
        '删除后那一条还赖在列表里'
      ).toHaveCount(0, { timeout: 15_000 })
      // 用户是在管理历史，删完把他甩回对话视图等于打断他接着删下一条
      await expect(drawer.locator('[data-testid="agent-dock-history-back"]')).toBeVisible()
      // 被删的正是当前会话 → 对话区清空
      await expect(drawer.getByText('我是平台助手')).toBeAttached()
    } finally {
      await sweepTestConversations(request, token)
    }
  })

  test('AI · 关掉抽屉再刷新页面：接得上刚才那次对话', async ({ page, request }) => {
    const token = await apiLogin(request)
    const question = `E2E 续接 ${Date.now()}`
    try {
      await login(page)
      await gotoWithAuth(page, BUSINESS_PAGE)
      let drawer = await openDrawer(page)
      await askOnce(drawer, question)
      await expect(drawer.getByText(question).first()).toBeVisible()

      await drawer.locator('[data-testid="agent-dock-close"]').click()
      await expect(drawer).not.toBeVisible({ timeout: 10_000 })

      // 刷新 = 组件全部重建，内存里的 conversationId 一定没了。
      // 能接回来只可能是本地记忆起了作用
      await page.reload()
      await expect(page.locator('[data-testid="agent-dock-ball"]')).toBeVisible({ timeout: 30_000 })
      drawer = await openDrawer(page)
      await expect(
        drawer.getByText(question).first(),
        '刷新后没有接上刚才的对话（本地记忆没写进去或没读出来）'
      ).toBeVisible({ timeout: 30_000 })
      // 已经接上了，就不该再摆一个「继续上次对话」按钮来添乱
      await expect(drawer.locator('[data-testid="assistant-resume"]')).toHaveCount(0)
    } finally {
      await sweepTestConversations(request, token)
    }
  })

  test('AI · 本地记忆被清掉后：空态给一个「继续上次对话」的显式入口', async ({ page, request }) => {
    const token = await apiLogin(request)
    const question = `E2E 恢复入口 ${Date.now()}`
    try {
      await login(page)
      await gotoWithAuth(page, BUSINESS_PAGE)
      const drawer = await openDrawer(page)
      await askOnce(drawer, question)

      // 模拟「隔天再来」：记忆被清、组件也重建了，但会话还在后端。
      // 🔴 必须 reload —— 抽屉关掉是不卸载的，光清缓存再点开，
      //    内存里那份消息还在，看到的根本不是空态，这条用例就白测了
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('agentLastConversation:')) localStorage.removeItem(key)
        }
      })
      await page.reload()
      await expect(page.locator('[data-testid="agent-dock-ball"]')).toBeVisible({ timeout: 30_000 })
      await page.locator('[data-testid="agent-dock-ball"]').click()
      await expect(drawer.getByText('我是平台助手')).toBeVisible({ timeout: 20_000 })

      // 🔴 不静默恢复：隔天打开的人多半是来问新问题的，直接扔回旧会话他得先退出来才敢提问
      const resume = drawer.locator('[data-testid="assistant-resume"]')
      await expect(resume, '空态里没有「继续上次对话」入口').toBeVisible({ timeout: 20_000 })
      await expect(resume).toContainText('继续上次对话')

      await resume.click()
      await expect(
        drawer.getByText(question).first(),
        '点了「继续上次对话」却没把历史消息加载出来'
      ).toBeVisible({ timeout: 30_000 })
      await expect(resume).toHaveCount(0)
    } finally {
      await sweepTestConversations(request, token)
    }
  })

  test('AI · 生成中切去翻历史再切回来：回答还在继续，没有被掐断', async ({ page, request }) => {
    const token = await apiLogin(request)
    const question = `E2E 不断流 ${Date.now()}`
    try {
      await login(page)
      await gotoWithAuth(page, BUSINESS_PAGE)
      const drawer = await openDrawer(page)
      await drawer.locator('textarea').fill(question)
      await drawer.getByRole('button', { name: /发送/ }).click()
      await expect(drawer.getByRole('button', { name: /停止/ })).toBeVisible({ timeout: 30_000 })

      // 生成过程中切到历史列表
      await drawer.locator('[data-testid="agent-dock-history"]').click()
      // 对话区被藏起来但没被销毁 —— 销毁的话下面这两条会同时变成 count 0
      await expect(drawer.getByText(question).first()).toBeAttached()
      await expect(drawer.getByText(question).first()).not.toBeVisible()

      await drawer.locator('[data-testid="agent-dock-history-back"]').click()
      await expect(drawer.getByText(question).first()).toBeVisible({ timeout: 10_000 })
      // 流没断：要么还在生成，要么已经生成完；答案最终必须落下来
      await expect(drawer.getByRole('button', { name: /停止/ })).toHaveCount(0, {
        timeout: 120_000
      })
      await expect(
        drawer.locator('[data-testid="assistant-answer"]').last(),
        '切走一趟回来答案就没了，说明 SSE 被 v-if 销毁时掐断了'
      ).toContainText(/\S/, { timeout: 30_000 })
    } finally {
      await sweepTestConversations(request, token)
    }
  })

  test('手机视口：抽屉铺满屏宽，输入框仍在可视区内', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await login(page)
    await gotoWithAuth(page, BUSINESS_PAGE)

    // 移动端侧边菜单会因「当前路由高亮」自动展开，它的浮层（el-popper-container）
    // 会一直盖到右下角、压住悬浮球，于是 click 永远被 intercept —— 这跟悬浮球本身无关，
    // 真实用户会先把菜单收起。这里把菜单浮层的指针事件关掉模拟「收起」，
    // 让下面走的仍是通用 openDrawer 的真实点击，不影响本用例真正的两条断言。
    await page.evaluate(() => {
      document
        .querySelectorAll('[id^="el-popper-container"]')
        .forEach((el) => ((el as HTMLElement).style.pointerEvents = 'none'))
    })

    const drawer = await openDrawer(page)

    const box = await drawer.locator('textarea').boundingBox()
    expect(box, '手机上输入框没渲染出来').not.toBeNull()
    expect(box!.y + box!.height, '手机上输入框被挤出了可视区').toBeLessThanOrEqual(667)

    // 写死 480px 的话在 375 宽的屏幕上会溢出，用户得横向拖动才能看到发送按钮。
    // ⚠️ 用 Math.round：width:100% 的抽屉实测会返回 375.0000076 这种亚像素值，
    //    直接 <= 375 会因为浮点误差假红，而它显然没有溢出。
    const drawerBox = await drawer.boundingBox()
    expect(drawerBox, '拿不到抽屉尺寸').not.toBeNull()
    expect(Math.round(drawerBox!.width), '抽屉宽度超出了屏宽').toBeLessThanOrEqual(375)
  })
})
