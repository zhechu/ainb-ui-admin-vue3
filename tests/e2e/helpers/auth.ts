import type { APIRequestContext, Page } from '@playwright/test'

/**
 * e2e 的登录与带鉴权跳转
 *
 * <h3>🔴 为什么需要「带鉴权跳转」，而不是 login 之后直接 goto</h3>
 * 登录成功之后紧接着的一次 {@code goto} 会<b>偶发</b>被路由守卫弹回登录页。
 *
 * <p>不处理的话，失败现象是「页面上什么都没有」：
 * 断言报的是 `element(s) not found`，看起来像组件没渲染或者接口没返回，
 * 实际是<b>根本没进去那个页面</b>。要翻 error-context.md 里的页面快照
 * 才能看出停在登录表单上。实测在 agent 的四个 spec 上都踩到过，
 * 每次都先怀疑了一遍业务代码。
 *
 * <p>根因是这一层自己的两处竞态（都不是产品缺陷），已按「看状态、不看瞬时 URL」修掉：
 * <ol>
 *   <li>{@link login} 用一次性的 {@code page.url()} 判断要不要登录，而 goto 在 load 就返回、
 *       /login 又是懒加载路由 —— 读早了就整个空转，一次都没登录；</li>
 *   <li>{@link gotoWithAuth} 重试前不等动态路由装配完，下一次 goto 会把启动打断。</li>
 * </ol>
 * 重试仍失败时，抛出的信息会带上每轮的 {@code token=true/false}，用来区分
 * 「没登录上」和「登录上了但守卫不认」——后者才需要去查 src/permission.ts。
 */

const ADMIN = { username: 'admin', password: 'admin123' }

/** localStorage 里访问令牌的键名，与 src/utils/auth.ts 的 AccessTokenKey 一致（web-storage-cache 不加前缀） */
const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN'

const hasToken = (page: Page) =>
  page.evaluate((key) => !!window.localStorage.getItem(key), ACCESS_TOKEN_KEY)

/**
 * 登录（幂等：已经登录就直接返回）
 *
 * <h3>🔴 判定「要不要登录」必须看 DOM，不能读一次 page.url()</h3>
 * {@code page.goto} 在 {@code load} 事件就返回，而 {@code /login} 是<b>懒加载路由</b>——
 * 守卫的 {@code next('/login?redirect=…')} 要等那次动态 import 落地才改地址栏。
 * 于是「读一次 url」是个真竞态：读早了看到 {@code /}，就以为已经登录，直接返回。
 *
 * <p>一旦这样空转，后续每次 {@code goto} 都会被守卫弹回登录页，重试多少次都没用
 * （重试里调的还是这个会空转的 login）。实测表现为
 * {@code agent-usage-dashboard.spec.ts} 五次重试全败，失败快照里登录表单
 * <b>填好了却没提交</b>、静静停在 /login —— 填好的值来自「记住我」的本地缓存，
 * 不是本次输入，正是空转的指纹。
 */
export async function login(page: Page, cred = ADMIN) {
  await page.goto('/')
  // 等外壳把「有没有登录态」决定完。登录页只有密码框、应用外壳只有菜单容器，二者必居其一，
  // 故用一个并集选择器等 attached 即可（不必 Promise.race 两个 waitFor —— 那样输掉的一支
  // 之后超时会变成 unhandled rejection，而且两支各有一份计时器，难推理）。
  // 🔴 必须是 attached 而不是默认的 visible：手机视口下侧边栏是折叠的
  //    （.el-menu--vertical.el-menu--collapse，display:none），等 visible 会白等 30 秒后超时，
  //    而那时其实早就登录成功了 —— agent-dock 的手机视口用例就是这么被误伤的。
  await page
    .locator('input[type="password"], .el-menu')
    .first()
    .waitFor({ state: 'attached', timeout: 30000 })
  if (!(await page.locator('input[type="password"]').first().isVisible().catch(() => false))) {
    return // 已有登录态
  }
  await page.fill('input[placeholder*="账号"], input[placeholder*="用户名"]', cred.username)
  await page.fill('input[type="password"]', cred.password)
  await page.getByRole('button', { name: /登录|登 录/ }).click()
  // 🔴 先等令牌落盘，再等地址栏。顺序反了会在「URL 变了但 setToken 还没执行」的窗口里放手，
  //    紧接着的 goto 又是一次无令牌启动。
  await page.waitForFunction((key) => !!window.localStorage.getItem(key), ACCESS_TOKEN_KEY, {
    timeout: 30000
  })
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 })
  // URL 一变就返回还是太早：permission-info / generateRoutes 还在飞，
  // 此时再 goto 会把这次启动整个打断。等菜单挂上＝动态路由装配完成。
  await page.locator('.el-menu').first().waitFor({ state: 'attached', timeout: 30000 })
}

/**
 * 跳到某个页面；被弹回登录页就重登再跳，最多五次
 *
 * 次数给到 5 而不是 3：后端刚重启时首次登录要冷启动（租户缓存、动态路由装配都慢），
 * 连着几条用例里总有一条会撞上「token 有了但守卫还没认」，3 次偶尔不够。
 *
 * @param path 目标路径
 */
export async function gotoWithAuth(page: Page, path: string, cred = ADMIN) {
  const trace: string[] = []
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto(path)
    // 🔴 必须先等页面静默再判断 URL。
    //    弹回登录是 SPA 启动之后由路由守卫在【客户端】做的重定向，
    //    goto 返回的那一刻 page.url() 还停在目标路径上 ——
    //    此时判断必然认为「进去了」，然后才被踢走。
    //    第一版就是这么写的，于是重试逻辑一次都没触发过。
    await page.waitForLoadState('networkidle')
    if (!page.url().includes('/login')) {
      return
    }
    // 失败时把「令牌在不在」一起抛出来：这是区分两种根因的唯一判据。
    // 令牌不在 → 登录压根没做成（见 login() 的竞态说明）；
    // 令牌在 → 守卫/缓存读取有问题，那才是产品代码的缺陷，得去查 src/permission.ts。
    trace.push(`#${attempt} url=${page.url()} token=${await hasToken(page).catch(() => 'unknown')}`)
    await login(page, cred)
  }
  throw new Error(`跳转到 ${path} 时反复被弹回登录页，登录态没建立起来\n${trace.join('\n')}`)
}

// ==================== 纯接口侧的登录 ====================

export const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
export const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/**
 * 用接口登录拿 token
 *
 * 造测试数据（建会话、建表单）走接口比点界面快一个数量级，也不会因为
 * 界面上的偶发动效而抖。断言仍然只在界面上做 —— 这一层只负责铺前置。
 */
export async function apiLogin(request: APIRequestContext, cred = ADMIN): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: cred.username, password: cred.password }
  })
  if (!response.ok()) throw new Error(`接口登录失败：${response.status()}`)
  const body = (await response.json()) as { data?: { accessToken?: string } }
  const token = body.data?.accessToken
  if (!token) throw new Error('接口登录没返回 accessToken')
  return token
}

export const apiHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

