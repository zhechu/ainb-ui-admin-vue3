import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 前端脚本编辑器的端到端验证
 *
 * 覆盖两件让「写脚本」这件事从能用变成好用的东西：
 *
 * 1. 右侧速查区列出本表单的字段与沙箱注入的 API，点一下插到光标处
 * 2. 编辑器是 Monaco，敲 `formData.` 能补出字段名
 *
 * 速查区的 API 清单必须与 sandbox.ts 的 SandboxContext 对得上 ——
 * 多列一个沙箱里没有的名字，用户照着写出来的脚本会在运行时拿到 undefined
 * 且不报错（沙箱代理对未白名单标识符返回 undefined），属于静默失效。
 *
 * ## ⚠️ 为什么要断言编辑器的高度
 *
 * 这里踩过一次：编辑器容器没拿到高度，Monaco 渲染成一条 5px 的缝。
 * 而 `toBeVisible()` 对 5px 高的元素返回 true、`click()` 点得中、
 * 键盘也写得进去 —— 整套用例全绿，实际打开却是一条线，根本没法编辑。
 *
 * 教训有两条，都写进用例里了：
 * 1. 对「要给人看、给人操作」的区域，光断言可见不够，得断言它有可用的尺寸
 * 2. 输入优先用 `keyboard.type()`（真实按键）。`insertText()` 走输入法提交路径，
 *    不触发按键联动 —— 方便，但正因如此它绕过了真实用户会遇到的问题
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
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
  return body.data?.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

const FORM_FIELDS = [
  JSON.stringify({ type: 'inputNumber', field: 'amount', title: '报销金额', props: {} }),
  JSON.stringify({ type: 'input', field: 'reason', title: '说明', props: {} }),
  JSON.stringify({ type: 'input', field: 'applicant', title: '申请人', props: {} })
]

async function createForm(request: APIRequestContext, token: string): Promise<number> {
  const resp = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: '脚本编辑器用例',
      code: `e2e_script_${Date.now()}`,
      formType: 1,
      formConf: JSON.stringify({ form: { labelWidth: '100px' } }),
      formFields: FORM_FIELDS
    }
  })
  expect(resp.ok()).toBeTruthy()
  return ((await resp.json()) as { data: number }).data
}

async function deleteForm(request: APIRequestContext, token: string, id: number) {
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, {
    headers: authHeaders(token)
  })
}

/** 打开设计器 → 逻辑与扩展 → 扩展方式页签 */
async function openScriptPanel(page: Page, id: number) {
  await page.goto(`/infra/form-design/editor?id=${id}`)
  await page.getByText('逻辑与扩展', { exact: true }).last().click()
  await page.getByRole('tab', { name: '扩展方式' }).click()
  const editor = page.locator('.monaco-editor').first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  // ⚠️ 可见还不够：容器没拿到高度时 Monaco 会渲染成一条几像素的缝，
  // 可见、可点、可输入，但人没法用。必须卡住真实高度
  const box = await editor.boundingBox()
  expect(box?.height ?? 0, '脚本编辑器被压扁了，实际用不了').toBeGreaterThan(150)
}

/** 读 Monaco 当前内容。行之间会有不可见字符，取纯文本比对前先归一 */
async function monacoText(page: Page): Promise<string> {
  return (await page.locator('.monaco-editor .view-lines').first().innerText())
    .replace(/ /g, ' ')
    .trim()
}

test.describe('前端脚本编辑器', () => {
  test('⚠️ 右侧列出本表单的字段，点一下插到光标处', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token)
    try {
      await openScriptPanel(page, id)

      // 三个字段都要在，且带上标题 —— 只给字段名的话用户还是得回上一步对照
      const aside = page.locator('.script-aside')
      await expect(aside.getByText('amount', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(aside.getByText('报销金额')).toBeVisible()
      await expect(aside.getByText('applicant', { exact: true })).toBeVisible()

      // 点一下要真的插进编辑器，而不只是复制到剪贴板
      await aside.locator('.aside-item:visible').filter({ hasText: 'amount' }).first().click()
      expect(await monacoText(page)).toContain('formData.amount')
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 字段多时能搜出来', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token)
    try {
      await openScriptPanel(page, id)
      const aside = page.locator('.script-aside')

      await aside.getByPlaceholder('搜字段名或标题').fill('申请')
      // 非激活页签也渲染，要按可见性过滤，否则会连「接口」页签里的条目一起数
      await expect(aside.locator('.aside-item:visible')).toHaveCount(1)
      await expect(aside.getByText('applicant', { exact: true })).toBeVisible()

      // 搜不到要给话说，不是留一片空白
      await aside.getByPlaceholder('搜字段名或标题').fill('zzz_不存在')
      await expect(aside.getByText('没有匹配的字段')).toBeVisible()
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 接口页签点一下插入带括号的调用形态', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token)
    try {
      await openScriptPanel(page, id)
      const aside = page.locator('.script-aside')
      await aside.getByRole('tab', { name: '接口' }).click()

      await expect(aside.getByText('setFieldValue', { exact: true })).toBeVisible({
        timeout: 15_000
      })
      await aside.locator('.aside-item:visible').filter({ hasText: 'setFieldValue' }).first().click()

      // 插的是可直接往里填的形态，而不是光秃秃一个名字
      expect(await monacoText(page)).toContain("setFieldValue('',")
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 敲 formData. 能补出本表单的字段', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token)
    try {
      await openScriptPanel(page, id)

      const editor = page.locator('.monaco-editor').first()
      await editor.click()
      // 用真实按键：补全本来就该由输入触发，insertText 不触发按键联动，
      // 用它等于把「敲点号弹补全」这件事本身跳过了
      await page.keyboard.type('formData.')

      const suggest = page.locator('.monaco-editor .suggest-widget')
      await expect(suggest).toBeVisible({ timeout: 15_000 })
      await expect(suggest.getByText('amount', { exact: true })).toBeVisible()
      await expect(suggest.getByText('reason', { exact: true })).toBeVisible()
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('⚠️ 编辑器高度跟着浏览器走，不留大片空白', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token)
    try {
      await openScriptPanel(page, id)

      const editor = page.locator('.code-editor').first()
      const aside = page.locator('.script-aside').first()

      const measure = async () => {
        await page.waitForTimeout(400)
        const box = await editor.boundingBox()
        const asideBox = await aside.boundingBox()
        const vp = page.viewportSize()!
        return {
          height: box?.height ?? 0,
          // 编辑器底部到视口底部还剩多少 —— 这就是用户看到的那片空白
          gap: vp.height - ((box?.y ?? 0) + (box?.height ?? 0)),
          asideHeight: asideBox?.height ?? 0
        }
      }

      const small = await measure()
      await page.setViewportSize({ width: 1920, height: 1080 })
      const large = await measure()

      // 屏幕高了，编辑器要跟着长，而不是停在固定行数上
      expect(large.height, '视口变高后编辑器没跟着长').toBeGreaterThan(small.height + 100)
      // 底部不该留一大片空白
      expect(large.gap, '编辑器下方空了一大片').toBeLessThan(80)
      // 右侧速查区与编辑器等高，否则旁边空一条看着像没对齐
      expect(Math.abs(large.asideHeight - large.height)).toBeLessThan(4)

      // 缩回去也要跟随，且不顶出可视区
      await page.setViewportSize({ width: 1280, height: 720 })
      const back = await measure()
      expect(back.height).toBeLessThan(large.height)
      expect(back.gap, '缩小窗口后编辑器顶出了可视区').toBeGreaterThan(-40)
    } finally {
      await deleteForm(request, token, id)
    }
  })

  test('切换钩子页签时各自的脚本互不串味', async ({ page, request }) => {
    const token = await login(page)
    const id = await createForm(request, token)
    try {
      await openScriptPanel(page, id)

      const editor = page.locator('.monaco-editor').first()
      await editor.click()
      await page.keyboard.type('// 这是加载钩子')

      // 编辑器实例只有一个、切页签换内容，所以这里最容易出的问题是串内容
      await page.getByRole('tab', { name: '提交前' }).click()
      expect(await monacoText(page)).not.toContain('这是加载钩子')
      await editor.click()
      await page.keyboard.type('// 这是提交钩子')

      await page.getByRole('tab', { name: '表单加载' }).click()
      const loadText = await monacoText(page)
      expect(loadText).toContain('这是加载钩子')
      expect(loadText).not.toContain('这是提交钩子')
    } finally {
      await deleteForm(request, token, id)
    }
  })
})
