import type { APIRequestContext, Page } from '@playwright/test'

/**
 * e2e 的登录与带鉴权跳转
 *
 * <h3>🔴 为什么需要「带鉴权跳转」，而不是 login 之后直接 goto</h3>
 * 登录成功之后紧接着的一次 {@code goto} 会<b>偶发</b>被路由守卫弹回登录页 ——
 * token 拿到了，但权限与动态路由还没装配完。连着跑多条用例时尤其容易撞上。
 *
 * <p>不处理的话，失败现象是「页面上什么都没有」：
 * 断言报的是 `element(s) not found`，看起来像组件没渲染或者接口没返回，
 * 实际是<b>根本没进去那个页面</b>。要翻 error-context.md 里的页面快照
 * 才能看出停在登录表单上。实测在 agent 的四个 spec 上都踩到过，
 * 每次都先怀疑了一遍业务代码。
 */

const ADMIN = { username: 'admin', password: 'admin123' }

export async function login(page: Page, cred = ADMIN) {
  await page.goto('/')
  if (page.url().includes('/login')) {
    await page.fill('input[placeholder*="账号"], input[placeholder*="用户名"]', cred.username)
    await page.fill('input[type="password"]', cred.password)
    await page.getByRole('button', { name: /登录|登 录/ }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 })
  }
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
    await login(page, cred)
  }
  throw new Error(`跳转到 ${path} 时反复被弹回登录页，登录态没建立起来`)
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

