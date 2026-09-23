import type { Page } from '@playwright/test'

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
 * 跳到某个页面；被弹回登录页就重登再跳，最多三次
 *
 * @param path 目标路径
 */
export async function gotoWithAuth(page: Page, path: string, cred = ADMIN) {
  for (let attempt = 0; attempt < 3; attempt++) {
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
