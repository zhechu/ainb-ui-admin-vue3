import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 组织选择器与列表布局的回归验证
 *
 * 这一批缺陷全都只在浏览器里看得出来：控件塌成一个按钮宽、配了部门却只加载了用户、
 * 表格高度写死一个数不跟着视口走。接口层与单测层全都是绿的。
 *
 * 前置条件：示例已由 script/form-demo 下的脚本建好并发布。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'
const GALLERY = 'test_demo_widget_gallery'
/** 复杂表头示例：竖线在这张表上是承载信息的，不能一起去掉 */
const REPORT = 'test_demo_report_header'
/** 示例数据里 org_owner 存的是【用户】的那一条 */
const ROW_WITH_USER = '新能源汽车采购意向单'
/** 示例数据里 org_owner 存的是【部门】的那一条 —— 键名写错时正是它回显不出来 */
const ROW_WITH_DEPT = '办公家具年度框架协议'

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  expect(response.ok(), '接口登录失败').toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  return body.data!.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

async function login(page: Page): Promise<void> {
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
  await form.locator('button').last().click()
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
}

const formPanel = (page: Page) =>
  page.locator('.el-dialog:visible, .el-drawer:visible, .inline-panel').first()

const itemOf = (page: Page, label: string | RegExp) =>
  formPanel(page).locator('.el-form-item').filter({ hasText: label }).first()

async function openRuntime(page: Page, code: string) {
  await page.goto(`/infra-form-design/preview?code=${code}`)
  await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
}

async function openRowForm(page: Page, title: string, action = '编辑') {
  await page
    .locator('.el-table__body-wrapper .el-table__row')
    .filter({ hasText: title })
    .first()
    .getByText(action)
    .click()
  await expect(formPanel(page)).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2500)
}

/** 组织选择器当前显示的文案。单选时 el-select 把选中项渲染在 placeholder 槽里 */
const orgDisplay = (page: Page) =>
  itemOf(page, '组织架构选择').evaluate((item) => {
    const holder = item.querySelector('.el-select__placeholder')
    return {
      text: holder?.textContent?.trim() ?? '',
      // 有值时 is-transparent 会被摘掉，靠它区分「选中项」与「占位提示」
      isPlaceholder: holder?.className?.includes('is-transparent') ?? true
    }
  })

test.describe('组织选择器', () => {
  test('① 没有数据时也是满宽，不是一个按钮那么宽', async ({ page }) => {
    await login(page)
    await openRuntime(page, GALLERY)
    await page.getByRole('button', { name: /^新增$/ }).first().click()
    await expect(formPanel(page)).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2500)

    const widths = await formPanel(page).evaluate((root) => {
      const find = (label: string) =>
        Array.from(root.querySelectorAll('.el-form-item')).find((el) =>
          (el.querySelector('.el-form-item__label')?.textContent || '').includes(label)
        )
      const org = find('组织架构选择')
      const reference = find('下拉（数据字典）')
      return {
        org: (org?.querySelector('.org-picker') as HTMLElement)?.getBoundingClientRect().width ?? 0,
        reference:
          (reference?.querySelector('.el-select') as HTMLElement)?.getBoundingClientRect().width ?? 0
      }
    })

    // 和同一张表单里的普通下拉比，而不是跟一个写死的像素数比 —— 表单宽度会随窗口变
    expect(widths.reference, '对照用的普通下拉没找到').toBeGreaterThan(200)
    expect(
      widths.org,
      `组织选择器只有 ${Math.round(widths.org)}px，而旁边的普通下拉有 ${Math.round(widths.reference)}px —— 外层容器又塌了`
    ).toBeGreaterThan(widths.reference * 0.9)
  })

  test('② 选过的用户与部门都能回显成名称', async ({ page }) => {
    await login(page)

    // --- 值是用户 ---
    await openRuntime(page, GALLERY)
    await openRowForm(page, ROW_WITH_USER)
    const asUser = await orgDisplay(page)
    expect(asUser.isPlaceholder, '用户值没回显，框里还是占位提示').toBeFalsy()
    expect(asUser.text, '回显的不该是 user:103 这种原始 key').not.toMatch(/^(user|dept|post|role):/)

    // --- 值是部门 ---
    //
    // ⚠️ 这一条才是关键。规则里的可选类型键名写错时（subjectTypes / types），
    // 控件会静默退回「只加载用户」—— 用户值照样回显得好好的，只有部门值回显不出来。
    // 只测用户的话，这个缺陷完全测不到
    await openRuntime(page, GALLERY)
    await openRowForm(page, ROW_WITH_DEPT)
    const asDept = await orgDisplay(page)
    expect(asDept.isPlaceholder, '部门值没回显 —— 多半是可选类型里没加载部门').toBeFalsy()
    expect(asDept.text, '回显的不该是 dept:103 这种原始 key').not.toMatch(/^(user|dept|post|role):/)
    expect(asDept.text, '部门回显成了一条查不到的记录').not.toContain('已不存在')
  })

  test('⑥ 真录一条：选个部门存进去，再打开还是它', async ({ page, request }) => {
    const token = await apiLogin(request)
    const title = `E2E组织选择-${Date.now()}`

    await login(page)
    await openRuntime(page, GALLERY)
    await page.getByRole('button', { name: /^新增$/ }).first().click()
    await expect(formPanel(page)).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2500)

    await itemOf(page, '单行文本').locator('input').first().fill(title)

    // 打开下拉，挑「部门」分组里的第一项
    await itemOf(page, '组织架构选择').locator('.el-select').first().click()
    const dropdown = page.locator('.el-select-dropdown:visible').first()
    await expect(dropdown).toBeVisible({ timeout: 15_000 })
    const deptGroup = dropdown.locator('.el-select-group__wrap', { hasText: '部门' }).first()
    await expect(deptGroup, '下拉里没有「部门」分组 —— 可选类型没生效').toBeVisible({
      timeout: 15_000
    })
    const deptOption = deptGroup.locator('.el-select-dropdown__item').first()
    const deptName = (await deptOption.innerText()).replace(/部门$/, '').trim()
    await deptOption.click()
    await page.waitForTimeout(500)

    const created = page.waitForResponse(
      (r) => r.url().includes(`/${GALLERY}/create`) && r.request().method() === 'POST'
    )
    await page.getByRole('button', { name: /^确\s*定$/ }).first().click()
    const body = (await (await created).json()) as any
    expect(body.code, `提交失败：${body.msg}`).toBe(0)

    // 落库的是 {type,id} 契约，不是一串 "dept:103"
    const listResponse = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/page`,
      { headers: authHeaders(token), data: { pageNo: 1, pageSize: 100, conditions: [] } }
    )
    const rows = (((await listResponse.json()) as any).data?.list ?? []) as any[]
    const mine = rows.filter((r) => r.title === title)
    expect(mine.length, '刚录的那条查不到').toBe(1)
    expect(mine[0].org_owner, '组织字段没按 {type,id} 落库').toMatchObject({ type: 'dept' })

    try {
      await openRuntime(page, GALLERY)
      await openRowForm(page, title)
      const echoed = await orgDisplay(page)
      expect(echoed.isPlaceholder, '自己刚存的部门回显不出来').toBeFalsy()
      expect(echoed.text, '回显的部门与选的那个对不上').toContain(deptName)
      await page.keyboard.press('Escape')
    } finally {
      for (const row of mine) {
        await request
          .delete(`${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/delete?id=${row.id}`, {
            headers: authHeaders(token)
          })
          .catch(() => undefined)
      }
    }
  })
})

test.describe('列表设计 · 配置表格的高度', () => {
  test('③④ 表格跟着视口高度走，不是写死一个数', async ({ page, request }) => {
    const token = await apiLogin(request)
    const id = await designId(request, token)
    await page.setViewportSize({ width: 1600, height: 768 })
    await login(page)

    /** 量当前可见的那张配置表。⚠️ el-tabs 会把所有页签都留在 DOM 里 */
    const measure = () =>
      page.evaluate(() => {
        const table = Array.from(
          document.querySelectorAll('.step-list-design .config-table')
        ).find((el) => (el as HTMLElement).offsetParent) as HTMLElement | undefined
        if (!table) return null
        const box = table.getBoundingClientRect()
        return {
          viewport: window.innerHeight,
          height: Math.round(box.height),
          bottomLeft: Math.round(window.innerHeight - box.bottom)
        }
      })

    const open = async (height: number) => {
      await page.setViewportSize({ width: 1600, height })
      await page.goto(`/infra/online/editor?id=${id}`)
      await expect(page.locator('.step-list-design')).toBeAttached({ timeout: 60_000 })
      await page.locator('span', { hasText: /^列表设计$/ }).first().click()
      await expect(page.locator('.step-list-design .config-table:visible').first()).toBeVisible({
        timeout: 30_000
      })
      await page.waitForTimeout(1200)
    }

    await open(768)
    const small = await measure()
    expect(small, '量不到配置表格').toBeTruthy()
    // 表格不能戳出视口 —— 戳出去的话最后几行要靠页面滚动才够得着
    expect(small!.bottomLeft, `表格戳出视口底部 ${-small!.bottomLeft}px`).toBeGreaterThanOrEqual(0)

    await open(1080)
    const large = await measure()
    // 屏幕高了 312px，表格必须跟着长 —— 停在原地就是「没适配浏览器，底下空一片」
    expect(
      large!.height,
      `视口从 768 变到 1080，表格高度却还是 ${large!.height}px，没有跟着变`
    ).toBeGreaterThan(small!.height)
    expect(large!.bottomLeft).toBeGreaterThanOrEqual(0)
  })
})

/** 取控件总览示例的表单设计编号 */
async function designId(request: APIRequestContext, token: string): Promise<number> {
  const response = await request.get(
    `${API_BASE_URL}/infra/form-design/page?pageNo=1&pageSize=100&code=${GALLERY}`,
    { headers: authHeaders(token) }
  )
  const list = (((await response.json()) as any).data?.list ?? []) as any[]
  const hit = list.find((item) => item.code === GALLERY)
  expect(hit, '找不到控件总览示例').toBeTruthy()
  return hit.id as number
}

test.describe('发布后的列表样式', () => {
  test('⑤ 向租户列表看齐：不铺满屏的格子线，行距读得下来', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await login(page)

    // --- 参照物：租户列表 ---
    await page.goto('/system/tenant/list')
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(1500)
    const tenant = await page.evaluate(() => {
      const td = document.querySelector('.el-table tbody td') as HTMLElement
      return { 竖线: td ? getComputedStyle(td).borderRightWidth : null }
    })
    expect(tenant.竖线, '参照物变了：租户列表现在有竖线了').toBe('0px')

    // --- 表单运行时列表 ---
    await openRuntime(page, GALLERY)
    await page.waitForTimeout(1500)
    const runtime = await page.evaluate(() => {
      const table = document.querySelector('.runtime-table') as HTMLElement
      const tr = table?.querySelector('tbody tr') as HTMLElement
      const td = tr?.querySelector('td') as HTMLElement
      const th = table?.querySelector('thead th') as HTMLElement
      const footer = table?.querySelector('.el-table__footer-wrapper td') as HTMLElement
      return {
        行高: tr ? Math.round(tr.getBoundingClientRect().height) : 0,
        竖线: td ? getComputedStyle(td).borderRightWidth : null,
        表头底色: th ? getComputedStyle(th).backgroundColor : null,
        隔行: !!document.querySelector('.el-table__row--striped'),
        合计行高: footer ? Math.round(footer.getBoundingClientRect().height) : 0
      }
    })
    expect(runtime.竖线, '还是满屏格子线，比系统里其它列表页重得多').toBe('0px')
    expect(runtime.行高, `行高只有 ${runtime.行高}px，单元格里的标签和缩略图贴着边`).toBeGreaterThan(40)
    expect(runtime.表头底色, '表头没有底色，滚动时会混进第一行').not.toBe('rgba(0, 0, 0, 0)')
    expect(runtime.隔行, '没有隔行色，横向扫一行十列容易串行').toBeTruthy()
    // 「合计」两个字挤在 46px 的多选列里会竖着折成两行，把整行撑高一倍
    expect(runtime.合计行高, '合计行被撑高了，多半是「合计」两个字折行了').toBeLessThan(60)
  })

  test('⑤ 分组表头仍然保留竖线 —— 那里的竖线是承载信息的', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await login(page)
    await openRuntime(page, REPORT)
    await page.waitForTimeout(1500)
    const border = await page.evaluate(() => {
      const td = document.querySelector('.runtime-table tbody td') as HTMLElement
      return td ? getComputedStyle(td).borderRightWidth : null
    })
    // 没有竖线就分不出父表头罩着哪几列，也看不出哪几行属于同一条主记录
    expect(border, '分组表头的竖线被一起去掉了').toBe('1px')
  })
})
