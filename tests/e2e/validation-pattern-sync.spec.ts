import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import patternFile from '@/components/FormValidation/validation-patterns.json'
import { BUILTIN_PATTERNS, PATTERN_LIBRARY_VERSION } from '@/components/FormValidation/patterns'

/**
 * 内置正则库的前后端一致性验证
 *
 * 与控件契约同一套机制：规范副本在后端 resources 下，前端有一份构建期副本
 * （两个仓库是独立的 git 仓库，没有共享构建产物）。
 *
 * 为什么这份一致性比控件契约更要紧：校验必须失焦即时反馈（前端读本地副本），
 * 又必须在服务端复校验（构造请求能绕过前端）。两侧正则一旦漂移，用户遇到的是
 * **「界面上填好了但提交失败」**，而现象里没有任何线索指向「两侧正则不一样」。
 *
 * 用例集（cases 段）与正则放在同一个文件里，所以这里连用例一起比 ——
 * 只比正则不比用例的话，一侧偷偷改了用例期望也不会被发现。
 *
 * ⚠️ 本用例拦不住「两侧同时被改成不同内容」（各自都自洽）。那只能靠流程约束：
 * 永远先改后端规范副本，再复制到前端。详见后端 resources/form-design/SYNC.md。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

async function login(page: Page): Promise<string> {
  await page.goto('/login')
  const form = page
    .locator('form.login-form')
    .filter({ has: page.locator('input[type="password"]') })
    .filter({ has: page.locator('input[type="checkbox"]') })
    .first()
  await expect(form).toBeVisible()
  const inputs = form.locator('input:visible')
  const count = await inputs.count()
  if (count >= 3) await inputs.nth(0).fill('xpy')
  await inputs.nth(count - 2).fill('admin')
  await inputs.nth(count - 1).fill('admin123')
  const loginPromise = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  const response = await loginPromise
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  // 超时给到 60s：登录成功后要加载整个后台首屏，开发服务器冷启动时
  // 这一步会现编译一大批模块，默认 10s 不够，短超时只会制造随机失败
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
  return body.data?.accessToken as string
}

interface BackendPatternLibrary {
  libraryVersion: number
  patterns: Array<{
    key: string
    label: string
    pattern: string
    message: string
  }>
}

async function fetchBackendPatterns(
  request: APIRequestContext,
  token: string
): Promise<BackendPatternLibrary> {
  const response = await request.get(`${API_BASE_URL}/infra/form-design/validation-patterns`, {
    headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID }
  })
  expect(response.ok(), '取内置正则库接口失败').toBeTruthy()
  const body = (await response.json()) as { data?: BackendPatternLibrary }
  expect(body.data, '正则库接口返回体里没有 data').toBeTruthy()
  return body.data as BackendPatternLibrary
}

test.describe('内置正则库的前后端一致性', () => {
  test('版本号与条目清单两侧一致（数量、key、顺序）', async ({ page, request }) => {
    const token = await login(page)
    const backend = await fetchBackendPatterns(request, token)

    expect(backend.libraryVersion, '正则库版本号不一致').toBe(PATTERN_LIBRARY_VERSION)

    const backendKeys = backend.patterns.map((p) => p.key)
    const frontendKeys = BUILTIN_PATTERNS.map((p) => p.key)

    // 先比集合差异：报错能直接指出「哪条只有一侧有」，比直接比数组好定位
    expect(
      backendKeys.filter((k) => !frontendKeys.includes(k)),
      '这些正则只在后端有，前端副本没跟上'
    ).toEqual([])
    expect(
      frontendKeys.filter((k) => !backendKeys.includes(k)),
      '这些正则只在前端副本里有，后端没跟上'
    ).toEqual([])
    // 顺序也要一致：声明顺序被当作稳定顺序用（设计器下拉框）
    expect(frontendKeys, '正则顺序两侧不一致').toEqual(backendKeys)
  })

  test('⚠️ 每条正则的 pattern 字符串两侧完全一致', async ({ page, request }) => {
    const token = await login(page)
    const backend = await fetchBackendPatterns(request, token)
    const frontendByKey = new Map(BUILTIN_PATTERNS.map((p) => [p.key, p]))

    for (const backendPattern of backend.patterns) {
      const frontendPattern = frontendByKey.get(backendPattern.key)
      expect(frontendPattern, `前端副本里缺少正则 ${backendPattern.key}`).toBeTruthy()
      if (!frontendPattern) continue

      // pattern 是最要紧的一项：差一个字符就是两套校验标准
      expect(
        frontendPattern.pattern,
        `正则 ${backendPattern.key} 的 pattern 两侧不一致 —— ` +
          '这会让同一个值在前端通过、在服务端被拒'
      ).toBe(backendPattern.pattern)
      expect(frontendPattern.label, `正则 ${backendPattern.key} 的 label 不一致`).toBe(
        backendPattern.label
      )
      expect(frontendPattern.message, `正则 ${backendPattern.key} 的 message 不一致`).toBe(
        backendPattern.message
      )
    }
  })

  test('用例集非空且每条正则都被覆盖 —— 没有用例的正则等于没有一致性保障', async ({
    page,
    request
  }) => {
    const token = await login(page)
    await fetchBackendPatterns(request, token)

    const cases = (patternFile as any).cases as Array<{ key: string; expected: boolean }>
    expect(cases?.length, '前端副本里没有 cases 段').toBeGreaterThan(0)

    const missing = BUILTIN_PATTERNS.filter(
      (p) => !cases.some((c) => c.key?.toUpperCase() === p.key.toUpperCase())
    ).map((p) => p.key)
    expect(missing, `这些正则没有任何用例：${missing.join('、')}`).toEqual([])

    // 每条正则都要有「应当不匹配」的反例。只有正例的话，一个写成 `.*` 的正则
    // 也能让全部用例通过 —— 那种正则等于没有校验
    const withoutNegative = BUILTIN_PATTERNS.filter(
      (p) => !cases.some((c) => c.key?.toUpperCase() === p.key.toUpperCase() && c.expected === false)
    ).map((p) => p.key)
    expect(withoutNegative, `这些正则只有正例没有反例：${withoutNegative.join('、')}`).toEqual([])
  })
})
