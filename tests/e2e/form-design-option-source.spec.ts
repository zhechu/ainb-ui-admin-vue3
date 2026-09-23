import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 选项类控件「选项来源」三选一的端到端验证
 *
 * 验的是本次改造的主体：下拉框、单选框、多选框、级联选择、树形选择、树形控件这六个控件，
 * 属性面板上的「选项来源」变成 静态数据 / 数据字典 / 数据接口 三选一互斥，
 * 远程分支不再让用户填 URL，而是直接选数据接口模块里的一条接口。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 六个支持选项数据源的内置控件，左侧面板上的显示名 */
const OPTION_WIDGETS = ['选择器', '单选框', '多选框', '级联选择器', '树形选择', '树形控件']

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
  // 超时给到 60s 而不是默认的 10s：登录成功后要加载整个后台首屏，
  // 开发服务器冷启动时这一步会现编译一大批模块。这不是被测逻辑慢，
  // 纯粹是首次编译的固定开销，短超时只会制造随机失败
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
 * ⚠️ 这里曾经直接取「列表里的第一张表单」来当画布。那是个不稳定的依赖：
 * 谁往环境里加一张表单、或改了排序，这组用例就会跑到别人的表单上去 ——
 * 开发示例批量入库后它立刻就挂了，现象是预览弹窗里控件渲染不出来，
 * 而失败信息完全指不到真正的原因。
 *
 * 现在每次自己建、用完删掉，与环境里有什么表单无关。
 */
/** 本组用例建过的画布表单，跑完统一删掉，免得在环境里越堆越多 */
const scratchFormIds: number[] = []

async function createScratchForm(request: APIRequestContext, token: string): Promise<number> {
  const response = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: '选项来源用例画布',
      code: `e2e_optsrc_canvas_${Date.now()}`,
      // 1 = 纯表单。这组用例只用它当画布，不发布、不绑表
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
  const token = await apiLogin(request)
  for (const id of scratchFormIds.splice(0)) {
    await request
      .delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, { headers: authHeaders(token) })
      .catch(() => undefined)
  }
})

/** 纯接口登录，供清理钩子用 —— 钩子里没有页面，不能走界面登录 */
async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  const body = (await response.json()) as { data?: { accessToken?: string } }
  return body.data?.accessToken as string
}

async function createStaticInterface(
  request: APIRequestContext,
  token: string,
  suffix: string
): Promise<number> {
  const created = await request.post(`${API_BASE_URL}/infra/data-interface/create`, {
    headers: authHeaders(token),
    data: {
      name: `E2E选项接口${suffix}`,
      code: `e2e_optsrc_${suffix}`,
      type: 2, // 静态 JSON，不依赖任何业务表
      status: 0,
      config: JSON.stringify([
        { id: 101, name: '选项甲' },
        { id: 102, name: '选项乙' }
      ])
    }
  })
  expect(created.ok()).toBeTruthy()
  const body = (await created.json()) as { code: number; data: number; msg: string }
  expect(body.code, body.msg).toBe(0)
  return body.data
}

async function deleteInterface(request: APIRequestContext, token: string, id: number | undefined) {
  if (!id) return
  await request.delete(`${API_BASE_URL}/infra/data-interface/delete?id=${id}`, {
    headers: authHeaders(token)
  })
}

/** 打开设计器并切到「表单设计」这一步 */
async function openDesigner(page: Page, formId: number) {
  await page.goto(`/infra/online/editor?id=${formId}`)
  await page.getByText('表单设计', { exact: true }).last().click()
  await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 30_000 })
}

/** 从左侧面板点击添加一个控件（设计器的 clickMenu，比模拟拖拽稳定） */
async function addWidget(page: Page, label: string) {
  const item = page.locator('._fc-l-item', { hasText: label }).first()
  await expect(item).toHaveCount(1, { timeout: 15_000 })
  await expect(item).toBeVisible()
  await item.click()
  // autoActive 默认开启，添加后自动选中并把右侧切到属性面板
  await expect(page.locator('._fc-r-tab-props')).toBeVisible({ timeout: 15_000 })
}

const propsPanel = (page: Page) => page.locator('._fc-r-tab-props')

/** 属性面板里的「选项来源」单选组 */
const optionSourceGroup = (page: Page) =>
  propsPanel(page)
    .locator('.el-form-item')
    .filter({ hasText: '选项' })
    .locator('.el-radio-group')
    .first()

/** 切换选项来源 */
async function switchSource(page: Page, label: string) {
  await optionSourceGroup(page).getByText(label, { exact: true }).click()
}

/** 当前选中的选项来源 */
const activeSource = (page: Page) =>
  optionSourceGroup(page).locator('.el-radio-button.is-active .el-radio-button__inner')

test.describe('选项来源三选一', () => {
  test('六个控件的选项来源都是 静态数据/数据字典/数据接口 三项', async ({ page, request }) => {
    const token = await login(page)
    await openDesigner(page, await createScratchForm(request, token))

    for (const widget of OPTION_WIDGETS) {
      await addWidget(page, widget)
      const group = optionSourceGroup(page)
      await expect(group, `控件[${widget}]应有选项来源单选组`).toBeVisible({ timeout: 10_000 })
      const labels = await group.locator('.el-radio-button__inner').allInnerTexts()
      expect(labels.map((t) => t.trim()).filter(Boolean), `控件[${widget}]的选项来源`).toEqual([
        '静态数据',
        '数据字典',
        '数据接口'
      ])
    }
  })

  test('数据接口分支是选接口，不再是填 URL 与写解析函数', async ({ page, request }) => {
    const token = await login(page)
    await openDesigner(page, await createScratchForm(request, token))
    await addWidget(page, '选择器')

    await switchSource(page, '数据接口')

    // 出现数据接口配置区
    await expect(propsPanel(page).locator('.data-interface-config')).toBeVisible({
      timeout: 10_000
    })
    // 内置远程分支那套自由输入项不该再出现。这是本次改造的核心断言：
    // 解析函数会被 new Function 执行，裸 URL 让接口路径散落在表单 JSON 里无法检索
    await expect(propsPanel(page).getByText('url 地址', { exact: false })).toHaveCount(0)
    await expect(propsPanel(page).getByText('选项解析函数', { exact: false })).toHaveCount(0)
    await expect(propsPanel(page).getByText('请求参数 JSON', { exact: false })).toHaveCount(0)
  })

  test('数据字典分支是选字典', async ({ page, request }) => {
    const token = await login(page)
    await openDesigner(page, await createScratchForm(request, token))
    await addWidget(page, '选择器')

    await switchSource(page, '数据字典')
    await expect(propsPanel(page).locator('.dict-source')).toBeVisible({ timeout: 10_000 })
  })

  test('三个分支互斥：切换后另外两种的配置区消失', async ({ page, request }) => {
    const token = await login(page)
    await openDesigner(page, await createScratchForm(request, token))
    await addWidget(page, '选择器')

    await switchSource(page, '数据字典')
    await expect(propsPanel(page).locator('.dict-source')).toBeVisible()
    await expect(propsPanel(page).locator('.data-interface-config')).toHaveCount(0)

    await switchSource(page, '数据接口')
    await expect(propsPanel(page).locator('.data-interface-config')).toBeVisible()
    await expect(propsPanel(page).locator('.dict-source')).toHaveCount(0)

    await switchSource(page, '静态数据')
    await expect(propsPanel(page).locator('.data-interface-config')).toHaveCount(0)
    await expect(propsPanel(page).locator('.dict-source')).toHaveCount(0)
  })

  test('数据字典分支的下拉里有字典可选', async ({ page, request }) => {
    const token = await login(page)
    await openDesigner(page, await createScratchForm(request, token))
    await addWidget(page, '选择器')

    await switchSource(page, '数据字典')
    const dictSelect = propsPanel(page).locator('.dict-source .el-select').first()
    await expect(dictSelect).toBeVisible()
    await dictSelect.click()

    // 字典精简列表接口刻意返回「开启 + 禁用」的全部字典，所以必须下发 status，
    // 否则前端「只列开启中的」这条过滤会把所有字典都滤掉，下拉全空
    const items = page.locator('.el-select-dropdown__item:visible')
    await expect(items.first()).toBeVisible({ timeout: 10_000 })
    expect(await items.count()).toBeGreaterThan(0)
  })

  test('从静态数据切走再切回，手工配的选项不丢', async ({ page, request }) => {
    const token = await login(page)
    await openDesigner(page, await createScratchForm(request, token))
    // 用单选框：它把所有选项直接渲染进画布，不用展开下拉就能断言
    await addWidget(page, '单选框')

    const item = page.locator('._fd-drag-item').last()
    // 新拖入的控件自带三条示例选项
    await expect(item).toContainText('选项01')
    const originalText = await item.innerText()

    await switchSource(page, '数据字典')
    // 切走后选项路径被清空，示例选项不再显示
    await expect(item).not.toContainText('选项01')

    await switchSource(page, '静态数据')
    // 切回来必须还原成原来那几条，而不是变成空列表
    await expect(item).toContainText('选项01')
    expect(await item.innerText()).toBe(originalText)
  })

  test('配好数据字典后，画布与预览都能看到选项', async ({ page, request }) => {
    const token = await login(page)
    await openDesigner(page, await createScratchForm(request, token))
    // 单选框会把选项直接渲染进画布，不用展开下拉就能断言
    await addWidget(page, '单选框')

    await switchSource(page, '数据字典')
    const dictSelect = propsPanel(page).locator('.dict-source .el-select').first()
    await dictSelect.click()
    const firstDict = page.locator('.el-select-dropdown__item:visible').first()
    await expect(firstDict).toBeVisible({ timeout: 10_000 })
    const dictLabel = (await firstDict.innerText()).trim()
    await firstDict.click()

    // 画布上要立刻出现该字典的选项。
    // 字典/接口来源在规则里只是一份声明，不解析进活规则的话画布和预览都是空的 ——
    // 静态数据之所以「有数据」，是因为它的选项本来就在规则里
    const item = page.locator('._fd-drag-item').last()
    await expect(item, `选中字典[${dictLabel}]后画布应出现选项`).not.toHaveText('单选框', {
      timeout: 10_000
    })
    const canvasText = await item.innerText()
    expect(canvasText.replace('单选框', '').trim().length).toBeGreaterThan(0)

    // 设计器预览走 getJson → getRule（活规则的深拷贝），同样应该有选项
    await page.locator('button', { hasText: '预览' }).first().click()
    const previewDialog = page.locator('._fd-preview-dialog')
    await expect(previewDialog).toBeVisible({ timeout: 10_000 })
    const previewRadio = previewDialog.locator('.el-radio-group').first()
    await expect(previewRadio).toBeVisible()
    expect(await previewRadio.locator('.el-radio').count()).toBeGreaterThan(0)
  })

  test('选项来源可回显：重新选中控件后仍停在数据接口', async ({ page, request }) => {
    const token = await login(page)
    const suffix = `${Date.now()}`
    let interfaceId: number | undefined

    try {
      interfaceId = await createStaticInterface(request, token, suffix)
      await openDesigner(page, await createScratchForm(request, token))
      await addWidget(page, '选择器')

      await switchSource(page, '数据接口')
      const picker = propsPanel(page).locator('.data-interface-config .el-select').first()
      await picker.click()
      await page
        .locator('.el-select-dropdown__item:visible', { hasText: `E2E选项接口${suffix}` })
        .first()
        .click()
      await expect(activeSource(page)).toHaveText('数据接口')

      // 取消选中，再从画布上重新选中同一个控件 —— 属性面板会整体重建。
      // 设计器内核的 _optionType 恒取默认值 2（静态），能停在「数据接口」
      // 说明自研的回显推导生效了
      await propsPanel(page).locator('._fc-r-tools-close').first().click()
      await page.locator('._fd-drag-item').last().click()
      await expect(propsPanel(page)).toBeVisible()
      await expect(activeSource(page)).toHaveText('数据接口')
      await expect(propsPanel(page).locator('.data-interface-config')).toBeVisible()
    } finally {
      await deleteInterface(request, token, interfaceId)
    }
  })
})

test.describe('数据接口选项的运行时解析', () => {
  test('规则里配了数据接口，加载表单时选项被真实取回并填入', async ({ page, request }) => {
    const token = await login(page)
    const suffix = `${Date.now()}`
    let interfaceId: number | undefined
    let formId: number | undefined
    let originalFields: string[] | undefined

    try {
      // 1) 建一个静态 JSON 接口，不依赖任何业务表
      interfaceId = await createStaticInterface(request, token, suffix)

      // 2) 往一张已有表单里塞一个「选项来自该接口」的下拉，options 故意留空
      formId = await createScratchForm(request, token)
      const detailResponse = await request.get(
        `${API_BASE_URL}/infra/form-design/get?id=${formId}`,
        { headers: authHeaders(token) }
      )
      expect(detailResponse.ok()).toBeTruthy()
      const detail = ((await detailResponse.json()) as { data: any }).data
      originalFields = [...(detail.formFields || [])]

      // 用单选框而不是下拉：单选框会把所有选项直接渲染进 DOM，
      // 而画布上的控件被 _fd-drag-mask 遮住，展不开下拉，没法断言下拉里的内容
      const injected = JSON.stringify({
        type: 'radio',
        field: `e2eOptSrc${suffix}`,
        title: 'E2E接口选项',
        options: [],
        props: {
          dataSource: {
            interfaceCode: `e2e_optsrc_${suffix}`,
            interfaceId,
            interfaceName: `E2E选项接口${suffix}`,
            valueField: 'id',
            labelField: 'name',
            params: [],
            cache: false
          }
        }
      })
      const updateResponse = await request.put(`${API_BASE_URL}/infra/form-design/update`, {
        headers: authHeaders(token),
        data: { ...detail, formFields: [...originalFields, injected] }
      })
      expect(updateResponse.ok()).toBeTruthy()
      expect(((await updateResponse.json()) as { code: number }).code).toBe(0)

      // 3) 打开设计器 —— 加载走 decodeFields，会触发数据接口取数并原地写回选项
      const optionsRequest = page.waitForResponse(
        (r) => r.url().includes('/infra/data-interface/options') && r.request().method() === 'POST'
      )
      await openDesigner(page, formId)
      const optionsResponse = await optionsRequest
      expect(optionsResponse.ok(), '加载表单时应向 /options 取数').toBeTruthy()

      // 4) 选中该字段，属性面板应回显为「数据接口」
      const injectedItem = page.locator('._fd-drag-item').filter({ hasText: 'E2E接口选项' }).first()
      await expect(injectedItem).toBeVisible({ timeout: 15_000 })
      await injectedItem.click()
      await expect(activeSource(page)).toHaveText('数据接口')

      // 5) 选项被真实取回并填进规则：画布上那个单选框直接渲染出接口返回的两条
      await expect(injectedItem).toContainText('选项甲', { timeout: 15_000 })
      await expect(injectedItem).toContainText('选项乙')
    } finally {
      // 还原表单，删掉临时接口
      if (formId && originalFields) {
        const detailResponse = await request.get(
          `${API_BASE_URL}/infra/form-design/get?id=${formId}`,
          { headers: authHeaders(token) }
        )
        if (detailResponse.ok()) {
          const detail = ((await detailResponse.json()) as { data: any }).data
          await request.put(`${API_BASE_URL}/infra/form-design/update`, {
            headers: authHeaders(token),
            data: { ...detail, formFields: originalFields }
          })
        }
      }
      await deleteInterface(request, token, interfaceId)
    }
  })
})
