import { test, expect } from '@playwright/test'

/**
 * AI 助手管理员配置页的端到端验证（方案 §12）
 *
 * 🔴 这个页面上有一个「总开关」，关掉之后所有提问都会被拒绝。
 * 所以测试必须验到「改完真的生效」，而不只是「保存按钮点得动」——
 * 一个点得动但不生效的开关，比没有这个开关危险得多：
 * 管理员以为关掉了，实际还开着。
 *
 * 前置：后端 48080 与前端 dev server 同时在跑。
 * ⚠️ 用例会真的关一次助手再开回来，跑的时候别同时在用助手。
 */

const ADMIN = { username: 'admin', password: 'admin123' }

async function login(page) {
  await page.goto('/')
  if (page.url().includes('/login')) {
    await page.fill('input[placeholder*="账号"], input[placeholder*="用户名"]', ADMIN.username)
    await page.fill('input[type="password"]', ADMIN.password)
    await page.getByRole('button', { name: /登录|登 录/ }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 })
  }
}

test.describe('AI 助手管理员配置', () => {
  test.setTimeout(120_000)

  test('三块内容都渲染得出来，工具清单是只读的', async ({ page }) => {
    await login(page)
    await page.goto('/agent/config')

    await expect(page.getByText('总开关')).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('用量配额')).toBeVisible()
    await expect(page.getByText('已注册的工具')).toBeVisible()

    // 工具清单要有内容，且必须包含那个最危险的工具
    await expect(page.getByText('datamodel_create')).toBeVisible()
    // 它必须被标成「要确认」—— 这是 Plan 铁律在界面上的体现
    const row = page.locator('.el-table__row', { hasText: 'datamodel_create' })
    await expect(row.getByText('要确认')).toBeVisible()

    // 只读：工具表里不该出现任何开关
    await expect(
      page.locator('.el-table__row', { hasText: 'datamodel_create' }).locator('.el-switch')
    ).toHaveCount(0)
  })

  test('🔴 总开关关掉之后，助手真的会拒绝提问', async ({ page, request }) => {
    await login(page)
    await page.goto('/agent/config')
    await expect(page.getByText('总开关')).toBeVisible({ timeout: 20000 })

    const toggle = page.locator('.el-switch').first()

    // 1. 关掉并保存
    await toggle.click()
    await page.getByRole('button', { name: /^保存$/ }).click()
    await expect(page.getByText('已保存')).toBeVisible({ timeout: 10000 })

    // 2. 直接打接口验证：助手确实拒绝了
    //    走接口而不是走助手页面，是为了拿到确切的错误码而不是看界面提示
    const token = await page.evaluate(() => {
      const raw = localStorage.getItem('ACCESS_TOKEN')
      if (!raw) return ''
      // web-storage-cache 存的是 {c:创建时间, e:过期时间, v:JSON.stringify(值)}，
      // 真正的 token 在 v 里、且被二次序列化过。直接 replace 引号会拿到整个包装对象
      try {
        const item = JSON.parse(raw)
        return typeof item.v === 'string' ? JSON.parse(item.v) : String(item.v ?? '')
      } catch {
        return ''
      }
    })
    expect(token, 'ACCESS_TOKEN 解析失败').toBeTruthy()
    const resp = await request.post('http://127.0.0.1:48080/admin-api/agent/assistant/send-stream', {
      headers: {
        'Content-Type': 'application/json',
        'tenant-id': '1',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream'
      },
      data: { content: '你好' }
    })
    const body = await resp.text()
    // AGENT_DISABLED = 1041000003
    expect(body, `关掉开关后助手仍然响应了：${body.slice(0, 300)}`).toContain('1041000003')

    // 3. 开回来，别把环境留在关闭状态
    await page.reload()
    await expect(page.getByText('总开关')).toBeVisible({ timeout: 20000 })
    await page.locator('.el-switch').first().click()
    await page.getByRole('button', { name: /^保存$/ }).click()
    await expect(page.getByText('已保存')).toBeVisible({ timeout: 10000 })
  })
})
