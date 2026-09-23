import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 不受支持的控件必须从设计器左侧面板消失
 *
 * 验的是 B0 顺带修掉的一个静默丢数据缺陷：
 *
 * 设计器内核的「表格表单」(tableForm) 与子表控件一样是 array 值的 subForm，
 * 但本模块的子表绑定只认 group。改造前它在菜单里可拖、发布也不报错 ——
 * 用户拖进来、配好明细列、填完数据提交，接口返回成功，明细却一行都没进库。
 * 「分组」(subForm) 是 object 值的嵌套表单，本模块的字段映射按扁平 field 组织，
 * 同样存不进去。
 *
 * 两道防线都要验：
 * 1. 设计器菜单隐藏（本文件）—— 不让用户拖进来
 * 2. 发布校验拒绝（后端 FormDesignWidgetSupportValidatorTest）—— 本配置漂移或
 *    历史表单已含此类控件时兜住
 *
 * 隐藏清单来自控件契约，不是手写的常量，所以这里同时也在验证
 * 「契约 → 设计器配置」这条链路真的接上了。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/**
 * 必须被隐藏的控件在左侧面板上的显示名
 *
 * 用显示名而不是 type：左侧面板渲染的是 label，用户看到的也是 label。
 * 显示名取自内核的 zh-cn 语言包（子表单组件菜单下的三项分别是
 * 「子表单」group、「分组」subForm、「表格表单」tableForm）。
 */
const HIDDEN_WIDGET_LABELS = ['表格表单', '分组']

/** 唯一受支持的明细录入控件，必须仍然可用 —— 否则就是把功能一起藏掉了 */
const SUB_TABLE_LABEL = '子表单'

/**
 * 手写签名的显示名
 *
 * 特殊：内核的 signaturePad 与自建的 Signature **显示名完全相同**（都是「手写签名」），
 * 所以它不能放进 HIDDEN_WIDGET_LABELS —— 那条断言要求计数为 0，而自建的那个必须在。
 * 换成「恰好出现一次」：内核那个没被藏掉时会变成两项，而两项里用户分不出
 * 哪个是把 base64 直接写进库的那一个。
 */
const SIGNATURE_LABEL = '手写签名'

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
  // 超时给到 60s：登录后要加载整个后台首屏，开发服务器冷启动时这一步会现编译
  // 一大批模块。短超时只会制造随机失败，与被测逻辑无关
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
  return body.data?.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

/**
 * 造一张属于本组用例的空白草稿，并返回它的编号
 *
 * ⚠️ 这里曾经直接取「列表里的第一张表单」当画布。那是个不稳定的依赖：
 * 谁往环境里加一张表单、或改了排序，这组用例就会跑到别人的表单上去。
 * 现在每次自己建，与环境里有什么表单无关。
 */
/** 本组用例建过的画布表单，跑完统一删掉 */
const scratchFormIds: number[] = []

async function createScratchForm(request: APIRequestContext, token: string): Promise<number> {
  const response = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: '控件支持性用例画布',
      code: `e2e_unsup_canvas_${Date.now()}`,
      // 1 = 纯表单。只当画布用，不发布、不绑表
      formType: 1,
      formConf: JSON.stringify({ form: { labelWidth: '100px' } }),
      formFields: [],
      dataSourceConfigId: 0
    }
  })
  expect(response.ok(), '造画布表单失败').toBeTruthy()
  const id = ((await response.json()) as { data: number }).data
  expect(id, '创建接口没有返回编号').toBeTruthy()
  scratchFormIds.push(id)
  return id
}

test.afterAll(async ({ request }) => {
  if (scratchFormIds.length === 0) return
  const login = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  const token = ((await login.json()) as { data?: { accessToken?: string } }).data?.accessToken
  if (!token) return
  for (const id of scratchFormIds.splice(0)) {
    await request
      .delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, { headers: authHeaders(token) })
      .catch(() => undefined)
  }
})

/** 打开低代码表单设计器 */
async function openFormDesigner(page: Page, formId: number) {
  await page.goto(`/infra/online/editor?id=${formId}`)
  await page.getByText('表单设计', { exact: true }).last().click()
  await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })
}

/** 打开流程表单设计器 */
async function openBpmFormDesigner(page: Page) {
  await page.goto('/bpm/manager/form/edit')
  await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })
}

/** 左侧面板上某个显示名的控件项 */
const menuItem = (page: Page, label: string) =>
  page.locator('._fc-l-item').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })

test.describe('不受支持的控件从设计器隐藏', () => {
  test('低代码表单设计器：表格表单与分组不出现在左侧面板', async ({ page, request }) => {
    const token = await login(page)
    await openFormDesigner(page, await createScratchForm(request, token))

    for (const label of HIDDEN_WIDGET_LABELS) {
      await expect(
        menuItem(page, label),
        `控件[${label}]不被本模块支持，会让明细数据静默写不进库，必须从左侧面板隐藏`
      ).toHaveCount(0)
    }
  })

  test('低代码表单设计器：受支持的子表单仍然可用', async ({ page, request }) => {
    const token = await login(page)
    await openFormDesigner(page, await createScratchForm(request, token))

    // 反向验证：隐藏清单不能把唯一能用的明细控件也带走。
    // 少了这条，把 hiddenItem 配错成隐藏全部子表类控件也不会被发现
    await expect(
      menuItem(page, SUB_TABLE_LABEL),
      '子表单是本模块唯一支持的明细录入控件，必须可用'
    ).toHaveCount(1)
  })

  test('⚠️ 手写签名在左侧面板只出现一次：内核那个已被自建控件顶替', async ({ page, request }) => {
    const token = await login(page)
    await openFormDesigner(page, await createScratchForm(request, token))

    // 内核的 signaturePad 把 canvas 直出的 base64 当值（单张 20–100KB），
    // 自建的 Signature 先上传文件服务、只存 URL。两者同名，出现两项的话
    // 用户没有任何办法分辨哪个会把 base64 写进库
    await expect(
      menuItem(page, SIGNATURE_LABEL),
      '手写签名应当只有自建的那一个'
    ).toHaveCount(1)
  })

  test('⚠️ 步骤条在左侧面板可用，「步骤」不出现（它只能拖进容器内部）', async ({
    page,
    request
  }) => {
    // 放在这个文件里是因为它有现成的设计器脚手架（openFormDesigner / menuItem）。
    // 验的是容器控件那两个逆向出来的写法真的生效：
    // 菜单项上的 `children: 'FormStep'` 声明它是容器，子节点上的 `inside: true`
    // 让「步骤」不进面板 —— 少了它，用户能拖出一个没有容器的孤儿步骤
    const token = await login(page)
    await openFormDesigner(page, await createScratchForm(request, token))

    await expect(menuItem(page, '步骤条'), '步骤条容器应当在左侧面板里').toHaveCount(1)
    await expect(
      menuItem(page, '步骤'),
      '「步骤」是容器的子节点，不该单独出现在左侧面板'
    ).toHaveCount(0)

    // 拖进画布：默认带两步，两步的标题都要渲染出来。
    // 这一条验的是 rule() 里的默认 children 与容器本身在设计器里能不能渲染 ——
    // 只验菜单存在的话，一个渲染就报错的容器照样能通过
    await menuItem(page, '步骤条').first().click()
    await expect(page.locator('._fc-r-tab-props')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('第一步', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('第二步', { exact: true }).first()).toBeVisible()
  })

  test('低代码表单设计器：子表单能正常拖入并展开内部规则', async ({ page, request }) => {    const token = await login(page)
    await openFormDesigner(page, await createScratchForm(request, token))

    await menuItem(page, SUB_TABLE_LABEL).first().click()
    // 添加后自动选中并切到属性面板，说明控件被正常创建而不是被 hiddenItem 拦掉
    await expect(page.locator('._fc-r-tab-props')).toBeVisible({ timeout: 15_000 })
  })

  test('流程表单设计器：同一份隐藏清单也生效', async ({ page }) => {
    await login(page)
    await openBpmFormDesigner(page)

    // 两个设计器共用 createDesignerConfig，隐藏清单来自同一份契约。
    // 这条用例的意义在于防止「只在一个入口生效」—— 改造前两处配置各自独立，
    // 正是会出现这种单侧生效的情形
    for (const label of HIDDEN_WIDGET_LABELS) {
      await expect(
        menuItem(page, label),
        `流程表单设计器里控件[${label}]也必须隐藏`
      ).toHaveCount(0)
    }
    await expect(menuItem(page, SUB_TABLE_LABEL), '流程表单设计器里子表单仍应可用').toHaveCount(1)
  })
})
