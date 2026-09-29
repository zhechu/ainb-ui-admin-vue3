import { test, expect, type Page } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 需求9：「AI 大模型」菜单改名为「AI」，整个「AI 助手」菜单挂到它下面
 *
 * 🔴 为什么接口证过了还要走浏览器
 * 菜单是**数据库驱动**的（system_menu → get-permission-info → permission store → generateRoutes），
 * 接口层已经核对过菜单树：根节点是「AI」path=/ai，下面挂着「AI 助手」目录与七个页面。
 * 但接口证不了两件只在真实 DOM 里才会坏的事：
 *   ① 侧边栏到底渲染成「AI」还是仍显示旧名「AI 大模型」——菜单名与前端路由 title 是两套东西，
 *      改了库里、漏了 i18n/路由 meta，界面上就还是旧名；
 *   ② 七个页面的 path 从 /agent/* 挪到 /ai/agent/* 之后，component 字符串还能不能被
 *      routerHelper 解析出来。解析不到就是本平台最阴的缺陷形态：「菜单点得开、页面一片空白」，
 *      接口 200、单测全绿，只有真点一遍才暴露。
 * 另外顺带守住「移动」的语义：旧的 /agent/* 顶级路由必须真的没了，否则用户会看到两个入口。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。本 spec 只读不写，无需清理。
 */

/** AI 助手目录下的七个页面：路由 + 菜单名 + 「这页真渲染出来了」的判据 */
const PAGES: { path: string; menu: string; probe: (p: Page) => Promise<void> }[] = [
  {
    path: '/ai/agent/assistant',
    menu: '智能助手',
    // 需求8 把 Agent 选择器挪到了发送行，它同时是「聊天面板挂载成功」的最稳判据
    probe: async (p) => {
      await expect(p.locator('[data-testid="agent-picker"]').first()).toBeVisible({ timeout: 20000 })
    }
  },
  {
    path: '/ai/agent/workflow',
    menu: '流程编排',
    probe: async (p) => {
      await expect(p.getByText('流程编码').first()).toBeVisible({ timeout: 20000 })
    }
  },
  {
    path: '/ai/agent/def',
    menu: '智能体管理',
    probe: async (p) => {
      await expect(p.getByRole('columnheader', { name: '序号' }).first()).toBeVisible({
        timeout: 20000
      })
    }
  },
  {
    path: '/ai/agent/tooldef',
    menu: '工具管理',
    probe: async (p) => {
      // 需求5 的结论就写在页首这条 alert 里，它同时是「工具管理页渲染成功」的判据
      await expect(p.getByText(/不遵循 MCP 协议/).first()).toBeVisible({ timeout: 20000 })
    }
  },
  {
    path: '/ai/agent/prompt-template',
    menu: '提示词模板',
    probe: async (p) => {
      await expect(p.getByRole('columnheader', { name: '占位符' }).first()).toBeVisible({
        timeout: 20000
      })
    }
  },
  {
    path: '/ai/agent/usage',
    menu: '用量看板',
    probe: async (p) => {
      await expect(p.getByText('调用次数').first()).toBeVisible({ timeout: 20000 })
    }
  },
  {
    path: '/ai/agent/config',
    menu: '助手配置',
    probe: async (p) => {
      await expect(p.getByText('总开关').first()).toBeVisible({ timeout: 20000 })
    }
  }
]

/**
 * 一个 el-menu 的直接子项的**菜单名**数组。
 *
 * 🔴 两个坑，都是踩过才写进来的：
 *   1. 不能直接取 li 的 textContent —— 目录（el-sub-menu）的子菜单是内联渲染的，
 *      textContent 会把标题和所有子项连成一串（"AI助手智能助手流程编排…"），断言 equals 必然失败。
 *      故目录只取它的 `.el-sub-menu__title`。
 *   2. 不能用选择器猜层级 —— 这套布局在不同主题下顶层可能是文字项也可能是图标+悬浮二级，
 *      而 `ul.el-menu` 的直接子 li 永远是当前层的菜单项，与主题无关。
 */
async function menuTitles(root: ReturnType<Page['locator']>): Promise<string[]> {
  const titles = await root.evaluate((el) =>
    Array.from(el.children).map((c) => {
      const title = c.querySelector('.el-sub-menu__title')
      return ((title ?? c).textContent || '').replace(/\s+/g, '')
    })
  )
  return titles.filter(Boolean)
}

test.describe('需求9：AI助手菜单挂到「AI」下', () => {
  test.setTimeout(240_000)
  // 🔴 必须给宽屏：默认 1280px 下顶部根菜单装不下，多出来的会被折进「更多」浮层（不渲染就没文本），
  //    读根菜单名会读不到「AI」。1920 下七个根菜单能一次排开。
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('顶级菜单是「AI」（不再是「AI 大模型」），「AI 助手」在它下面且七个页面齐全', async ({
    page
  }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/def')

    // 这套布局是「顶部横向根菜单 + 左侧显示当前根的子菜单」：
    //   header（.el-menu--horizontal）= 一级根菜单；sidebar（.el-menu--vertical）= 当前根的子菜单
    const header = page.locator('.el-menu--horizontal').first()
    const sidebar = page.locator('.el-menu--vertical').first()
    await expect(header).toBeVisible({ timeout: 20000 })
    await expect(sidebar).toBeVisible({ timeout: 20000 })

    const roots = await menuTitles(header)
    const subs = await menuTitles(sidebar)
    console.log('===ROOT_MENUS===', JSON.stringify(roots))
    console.log('===AI_CHILDREN===', JSON.stringify(subs))

    expect(roots, `顶级菜单应有改名后的「AI」，实际是 ${JSON.stringify(roots)}`).toContain('AI')
    expect(roots, '需求9：「AI 大模型」应已改名为「AI」').not.toContain('AI大模型')
    // 「AI 助手」必须从顶级降为「AI」的子目录：它还挂在顶级就等于没挪
    expect(roots, '需求9：「AI 助手」不该再是顶级菜单').not.toContain('AI助手')

    // 停在 /ai/agent/def 时，左侧展示的正是「AI」根的子菜单 —— 它必须包含「AI 助手」目录，
    // 且原来平级的 AI 对话/绘画/写作/… 仍在（证明是「挂进来」而不是「把 AI 根换成了 AI 助手」）
    expect(subs, `「AI」下应有「AI 助手」子目录，实际是 ${JSON.stringify(subs)}`).toContain('AI助手')
    expect(subs, '「AI」原有的兄弟菜单不该被挤掉').toContain('AI对话')

    // 展开「AI 助手」→ 有且仅有七个页面
    const assistant = sidebar
      .locator('.el-sub-menu')
      .filter({
        has: page.locator('.el-sub-menu__title').filter({ hasText: /^\s*AI 助手\s*$/ })
      })
      .first()
    const assistantTitle = assistant.locator('.el-sub-menu__title').first()
    await expect(assistantTitle).toBeVisible({ timeout: 15000 })
    if ((await assistantTitle.getAttribute('aria-expanded')) !== 'true') {
      await assistantTitle.click()
    }
    await expect(assistant.locator('.el-menu-item')).toHaveCount(PAGES.length, { timeout: 15000 })
    for (const { menu } of PAGES) {
      // 🔴 必须限定在「AI 助手」这个子树里找：AI 根下另有一个同名的「工具管理」（AI 大模型自带的），
      //    全局 .first() 会命中它，于是「AI 助手少了工具管理」这种真缺陷反而测不出来
      await expect(
        assistant.locator('.el-menu-item').filter({ hasText: new RegExp(`^\\s*${menu}\\s*$`) }),
        `「AI 助手」下应有菜单项「${menu}」`
      ).toBeVisible({ timeout: 15000 })
    }
  })

  test('七个页面在 /ai/agent/* 下都能打开且非空白', async ({ page }) => {
    await login(page)
    for (const { path, menu, probe } of PAGES) {
      await gotoWithAuth(page, path)
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'), { timeout: 20000 })
      // 路由 component 解析失败时，页面会停在 404 兜底上——菜单名与「页面不存在」同时出现就是这种情况
      await expect(page.getByText('页面不存在').first()).toHaveCount(0)
      await probe(page)
      console.log(`===PAGE_OK=== ${menu} ${path}`)
    }
  })

  test('旧的 /agent/* 顶级路由已经不存在（不是多挂一个入口）', async ({ page }) => {
    await login(page)
    await page.goto('/agent/def')
    await page.waitForLoadState('networkidle')
    // 智能体管理列表还在渲染，就说明旧路由没被摘干净
    await expect(page.getByRole('columnheader', { name: '编码' })).toHaveCount(0, { timeout: 8000 })
  })
})
