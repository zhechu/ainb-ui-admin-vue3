import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 表单设计模块 · 14 项缺陷的回归验证
 *
 * 这一批缺陷的共同点是**接口全绿、单测全绿，只有人打开页面才看得出来**：
 * 下拉被压成一条窄缝、日期回显成空、附件点开是新窗口、关联控件渲染成未知元素。
 * 所以断言都落在真实浏览器里渲染出来的 DOM 与几何尺寸上，而不是接口返回值。
 *
 * 前置条件：示例已由 script/form-demo 下的脚本建好并发布。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'
const GALLERY = 'test_demo_widget_gallery'
const CONTRACT = 'test_demo_contract'
/** 示例 1 的演示数据里固定存在的一条，用它验回显 */
const DEMO_ROW_TITLE = '新能源汽车采购意向单'

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
  const loginPromise = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  expect((await loginPromise).ok()).toBeTruthy()
  // 冷启动首屏要现编译一大批模块，默认 10s 不够
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
}

/** 表单容器：弹窗 / 抽屉 / 页内，三种都认（呈现方式是一项配置，不能写死 .el-dialog） */
const formPanel = (page: Page) =>
  page.locator('.el-dialog:visible, .el-drawer:visible, .inline-panel').first()

/** 打开某张示例表单的运行时页。走静态预览路由，不依赖菜单是否建好 */
async function openRuntime(page: Page, code: string) {
  await page.goto(`/infra-form-design/preview?code=${code}`)
  await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
}

/** 打开设计器并切到「列表设计」这一步 */
async function openListDesign(page: Page, designId: number) {
  // ⚠️ apiLogin 只拿到接口用的 token，浏览器这边还是未登录状态 —— 少了这一步会跳登录页
  await login(page)
  await page.goto(`/infra/form-design/editor?id=${designId}`)
  await expect(page.locator('.step-list-design')).toBeAttached({ timeout: 60_000 })
  await page.locator('span', { hasText: /^列表设计$/ }).first().click()
  await expect(page.locator('.step-list-design')).toBeVisible({ timeout: 30_000 })
  // 回显是异步的，等第一张配置表出来。
  // ⚠️ 一定要带 :visible —— el-tabs 把所有页签都留在 DOM 里，
  // 不加的话 first() 会命中另一个页签里那张隐藏的表
  await expect(page.locator('.step-list-design .config-table:visible').first()).toBeVisible({
    timeout: 30_000
  })
}

/** 按编码查表单设计的编号 */
async function designIdOf(request: APIRequestContext, token: string, code: string) {
  const response = await request.get(
    `${API_BASE_URL}/infra/form-design/page?pageNo=1&pageSize=100&code=${code}`,
    { headers: authHeaders(token) }
  )
  const list = (((await response.json()) as any).data?.list ?? []) as any[]
  const hit = list.find((item) => item.code === code)
  expect(hit, `找不到编码为 ${code} 的表单设计`).toBeTruthy()
  return hit.id as number
}

/** 切到列表设计下的某个页签 */
async function switchPane(page: Page, label: string) {
  await page.locator('.step-list-design .el-tabs__item', { hasText: label }).first().click()
  await page.waitForTimeout(400)
}

// ==================== 设计器 ====================

test.describe('表单设计器 · 列表设计面板', () => {
  test('① 合计列下拉不再被压成窄缝，⑥⑦ 两张配置表能在表内滚动', async ({ page, request }) => {
    const token = await apiLogin(request)
    await openListDesign(page, await designIdOf(request, token, GALLERY))

    // ---- ① 合计列 ----
    //
    // 它套在 inline 表单里。el-select 默认 width:100%，而 inline 的 form-item
    // 宽度由内容决定 —— 这个循环的解是「塌到最小」，原先只有几十像素宽，
    // 选进去两个列就只剩一个「+1」，看不出自己选了什么
    const summarySwitch = page
      .locator('.step-list-design .el-form-item:visible')
      .filter({ hasText: '显示合计行' })
      .locator('.el-switch')
      .first()
    // ⚠️ 先看状态再点：这项开关会被上一次执行留成开着的，
    // 无条件点一下反而把它关掉，下面那个下拉就永远找不到
    if (!(await summarySwitch.getAttribute('class'))?.includes('is-checked')) {
      await summarySwitch.click()
    }
    const summarySelect = page.locator('.step-list-design .summary-picker:visible .el-select').first()
    await expect(summarySelect, '合计列下拉没渲染').toBeVisible()
    const summaryWidth = (await summarySelect.boundingBox())!.width
    expect(summaryWidth, `合计列下拉只有 ${summaryWidth}px，又被压回去了`).toBeGreaterThan(380)
    // 关掉，别把示例的配置改了
    if ((await summarySwitch.getAttribute('class'))?.includes('is-checked')) {
      await summarySwitch.click()
    }

    // ---- ⑥ 列配置表格能在表内滚动 ----
    const columnTable = page.locator('.step-list-design .config-table:visible').first()
    const columnScrollable = await columnTable.evaluate((el) => {
      const wrapper = el.querySelector('.el-scrollbar__wrap, .el-table__body-wrapper') as HTMLElement
      return { max: getComputedStyle(el).maxHeight, client: wrapper?.clientHeight ?? 0 }
    })
    expect(columnScrollable.max, '列配置表格没有高度上限，数据一多就只能整页滚').not.toBe('none')

    // ---- ⑥ 格式化列显示的是名称，不是 DICT / DATETIME 这些内部枚举值 ----
    const formatterTexts = await columnTable
      .locator('td .el-button--primary.is-link')
      .allInnerTexts()
    expect(formatterTexts.length, '列配置里一个格式化按钮都没有').toBeGreaterThan(0)
    const leakedEnum = formatterTexts.find((text) =>
      /^(DICT|DATE|DATETIME|NUMBER|PERCENT|BOOLEAN|TAG|LINK|IMAGE|FILE)$/.test(text.trim())
    )
    expect(leakedEnum, `格式化列还在印内部枚举值：${leakedEnum}`).toBeUndefined()
    expect(
      formatterTexts.some((text) => /字典翻译|日期|数字|标签|图片|附件|百分比|布尔值|无/.test(text)),
      '格式化列没有印出中文名称'
    ).toBeTruthy()

    // ---- ⑦ 查询条件表格 ----
    await switchPane(page, '查询条件')
    const searchTable = page.locator('.step-list-design .config-table:visible').first()
    await expect(searchTable).toBeVisible()
    const searchMaxHeight = await searchTable.evaluate((el) => getComputedStyle(el).maxHeight)
    expect(searchMaxHeight, '查询条件表格没有高度上限').not.toBe('none')
  })

  test('⑦ 字典类型是树形选择、且显示字典名称而不是编码', async ({ page, request }) => {
    const token = await apiLogin(request)
    await openListDesign(page, await designIdOf(request, token, GALLERY))
    await switchPane(page, '查询条件')

    // 先把某个查询项的查询控件改成「下拉」，字典类型那一格才会出现
    const firstRow = page.locator('.step-list-design .config-table:visible tbody tr').first()
    await firstRow.locator('td').nth(3).locator('.el-select').first().click()
    await page
      .locator('.el-select-dropdown:visible .el-select-dropdown__item', { hasText: '下拉' })
      .first()
      .click()
    await page.waitForTimeout(300)

    // 字典类型这一格现在应当是 el-tree-select（而不是一个平铺的 el-select）
    const dictCell = firstRow.locator('td').nth(4)
    await expect(dictCell.locator('.el-select').first(), '字典类型没渲染').toBeVisible()
    await dictCell.locator('.el-select').first().click()
    const tree = page.locator('.el-select-dropdown:visible .el-tree').first()
    await expect(tree, '字典类型不是树形选择 —— 字典类型本身是有层级的').toBeVisible({
      timeout: 15_000
    })

    // 树上印的必须是字典【名称】。全是 system_xxx 这样的编码就说明没改到。
    // ⚠️ 读 .el-tree-node__content 而不是 .el-tree-node__label —— 这棵树用了
    // 自定义节点插槽（名称 + 浅色编码），内核那个 label span 根本不会渲染
    const nodeTexts = await tree.locator('.el-tree-node__content').allInnerTexts()
    expect(nodeTexts.length, '字典类型树是空的').toBeGreaterThan(0)
    const hasChineseName = nodeTexts.some((text) => /[一-龥]/.test(text))
    expect(hasChineseName, `字典类型树上没有中文名称，印的还是编码：${nodeTexts.slice(0, 5)}`).toBeTruthy()
    await page.keyboard.press('Escape')
  })

  test('⑫ 按钮设置里能配操作列的折叠阈值', async ({ page, request }) => {
    const token = await apiLogin(request)
    await openListDesign(page, await designIdOf(request, token, GALLERY))
    await switchPane(page, '按钮设置')

    const thresholdItem = page
      .locator('.step-list-design .el-form-item:visible')
      .filter({ hasText: '按钮折叠阈值' })
      .first()
    await expect(thresholdItem, '按钮设置里没有折叠阈值这一项').toBeVisible()
    await expect(
      thresholdItem.locator('.el-input-number input'),
      '折叠阈值不是一个可填的数字'
    ).toBeVisible()
    // 提示里要把当前配置下的折叠结果直接说出来，不必存一次再去列表页看
    await expect(thresholdItem.locator('.form-tip')).toContainText('更多')
  })

  test('⑧ 详情页页签删掉后保存，重新打开不再出现', async ({ page, request }) => {
    const token = await apiLogin(request)
    const designId = await designIdOf(request, token, GALLERY)

    // 先通过接口种一个页签，避免依赖示例本来有没有配
    const before = await (
      await request.get(`${API_BASE_URL}/infra/form-design/get?id=${designId}`, {
        headers: authHeaders(token)
      })
    ).json()
    const original = before.data
    await request.put(`${API_BASE_URL}/infra/form-design/update`, {
      headers: authHeaders(token),
      data: {
        ...original,
        detailTabs: JSON.stringify([{ key: 'e2eTab', label: 'E2E临时页签', type: 'CHANGE_LOG' }])
      }
    })

    await openListDesign(page, designId)
    await switchPane(page, '详情页页签')
    // ⚠️ 不能用 `input[value="e2eTab"]`：Vue 把值绑成 DOM 属性，
    // HTML 属性上并没有它，这个选择器永远匹配不到
    const tabRow = page
      .locator('.detail-tab-editor tbody tr')
      .filter({ has: page.locator('input[placeholder="如 changeLog"]') })
      .first()
    await expect(tabRow, '刚种下去的页签没回显出来').toBeVisible({ timeout: 20_000 })
    await tabRow.getByRole('button', { name: '删除' }).click()
    await expect(tabRow).toHaveCount(0)

    // 保存（拆分按钮的主按钮）
    const saveResponse = page.waitForResponse(
      (r) => r.url().includes('/infra/form-design/update') && r.request().method() === 'PUT'
    )
    await page.getByRole('button', { name: /^保\s*存$/ }).first().click()
    expect((await saveResponse).ok()).toBeTruthy()
    await page.waitForTimeout(1500)

    // ---- 库里真的清掉了吗 ----
    //
    // 这才是这条缺陷的要害：MyBatis-Plus 默认不更新 null 字段，
    // 「删完保存」的接口返回成功，而库里那份从来没被动过 ——
    // 重新打开页签又全回来了，界面上完全看不出是哪一步没生效
    const after = await (
      await request.get(`${API_BASE_URL}/infra/form-design/get?id=${designId}`, {
        headers: authHeaders(token)
      })
    ).json()
    expect(after.data.detailTabs ?? null, '页签删掉保存后，库里还留着').toBeFalsy()

    // 界面上重新打开也不该再出现
    await page.reload()
    await expect(page.locator('.step-list-design')).toBeAttached({ timeout: 60_000 })
    await page.locator('span', { hasText: /^列表设计$/ }).first().click()
    await switchPane(page, '详情页页签')
    await expect(
      page.locator('.detail-tab-editor tbody tr'),
      '删掉的页签又回显出来了'
    ).toHaveCount(0)
  })
})

// ==================== 管理列表页 ====================

test.describe('表单设计 · 管理列表页', () => {
  test('③ 列表行距不再挤成一叠细线', async ({ page }) => {
    await login(page)
    await page.goto('/infra/form-design/list')
    const table = page.locator('.form-design-table')
    await expect(table).toBeVisible({ timeout: 60_000 })
    await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 })

    const rowHeight = (await table.locator('tbody tr').first().boundingBox())!.height
    expect(rowHeight, `行高只有 ${rowHeight}px，还是挤在一起`).toBeGreaterThan(44)

    // 表头要能与数据区分开，否则滚动时表头会「混进」第一行
    const headerBg = await table
      .locator('thead th')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(headerBg, '表头没有底色').not.toBe('rgba(0, 0, 0, 0)')
  })
})

// ==================== 运行时 ====================

test.describe('表单运行时 · 控件总览示例', () => {
  test('④⑤ 签名、省市区、日期都能回显出来', async ({ page }) => {
    await login(page)
    await openRuntime(page, GALLERY)

    const demoRow = page
      .locator('.el-table__body-wrapper .el-table__row')
      .filter({ hasText: DEMO_ROW_TITLE })
      .first()
    await expect(demoRow, '示例数据不在第一页，先跑一遍 demo1_gallery_data.py').toBeVisible({
      timeout: 30_000
    })
    await demoRow.getByText('编辑').click()
    const panel = formPanel(page)
    await expect(panel).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2500)

    // ---- ④ 手写签名 ----
    //
    // 断言的是「图片不是一整块纯色」。示例数据以前用一张 240×80 的纯 #303133
    // 色块当签名，按 contain 铺满签名框之后界面上就是一片黑，
    // 与「控件渲染坏了」分不出区别
    const signImg = panel.locator('.signature-signed img').first()
    await expect(signImg, '签名没有回显成图片').toBeVisible({ timeout: 15_000 })
    const inkRatio = await signImg.evaluate(async (img: HTMLImageElement) => {
      // 直接 drawImage(img) 会因为跨域把画布污染掉，getImageData 抛 SecurityError。
      // 先 fetch 成 blob 再解码 —— blob 是同源的，画布不会被污染
      const blob = await (await fetch(img.src)).blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let dark = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) dark++
      }
      return dark / (canvas.width * canvas.height)
    })
    expect(inkRatio, `签名图 ${Math.round(inkRatio * 100)}% 是深色 —— 又是一块纯色了`).toBeLessThan(
      0.5
    )
    expect(inkRatio, '签名图上一笔都没有').toBeGreaterThan(0.005)

    // ---- ⑤ 省市区 ----
    const areaItem = panel.locator('.el-form-item').filter({ hasText: '省市区' }).first()
    const areaText = await areaItem.locator('.el-cascader input').first().inputValue()
    expect(areaText, '省市区回显是空的 —— 落库的是字符串，级联选择器按数字匹配').toContain('/')

    // ---- ⑤ 日期 ----
    const dateItem = panel
      .locator('.el-form-item')
      .filter({ hasText: /^日期$/ })
      .first()
    const dateText = await dateItem.locator('input').first().inputValue()
    expect(dateText, '日期回显是空的').toMatch(/^\d{4}-\d{2}-\d{2}$/)

    await page.keyboard.press('Escape')
  })

  test('⑤⑭ 真录一条：省市区与日期存得进、读得回、再打开还在', async ({ page, request }) => {
    const token = await apiLogin(request)
    const title = `E2E省市区日期-${Date.now()}`

    await login(page)
    await openRuntime(page, GALLERY)
    await page.getByRole('button', { name: /^新增$/ }).first().click()
    await expect(formPanel(page)).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2500)

    const itemOf = (label: string | RegExp) =>
      formPanel(page).locator('.el-form-item').filter({ hasText: label }).first()

    await itemOf('单行文本').locator('input').first().fill(title)

    // ---- 省市区：级联三级都点一遍 ----
    await itemOf('省市区').locator('.el-cascader').first().click()
    const cascader = page.locator('.el-cascader-panel:visible').first()
    await expect(cascader).toBeVisible({ timeout: 15_000 })
    //
    // ⚠️ 逐级都点名，不用「第一个节点」
    //
    // 地区数据的第一个根节点是香港特别行政区，它下面没有市辖区 —— 点了不会
    // 展开出第二列，用例会以「找不到第二级」失败，而那与省市区控件毫不相干。
    // 另外这个级联开了 checkStrictly（任意一级都能选），点标签是【展开】，
    // 点整个节点才是【选中】，所以前两级只点标签。
    //
    await cascader.locator('.el-cascader-node', { hasText: '上海市' }).first().locator('.el-cascader-node__label').click()
    await expect(cascader.locator('.el-cascader-menu')).toHaveCount(2, { timeout: 10_000 })
    await cascader.locator('.el-cascader-menu').nth(1).locator('.el-cascader-node__label').first().click()
    await expect(cascader.locator('.el-cascader-menu')).toHaveCount(3, { timeout: 10_000 })
    await cascader.locator('.el-cascader-menu').nth(2).locator('.el-cascader-node').first().click()
    await page.waitForTimeout(500)
    const areaPicked = await itemOf('省市区').locator('.el-cascader input').first().inputValue()
    expect(areaPicked, '省市区没选上').toContain('/')

    // ---- 日期：直接填，不依赖日历面板的当月布局 ----
    await itemOf(/^日期$/).locator('input').first().fill('2026-07-15')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    const createResponse = page.waitForResponse(
      (r) => r.url().includes(`/${GALLERY}/create`) && r.request().method() === 'POST'
    )
    await page.getByRole('button', { name: /^确\s*定$/ }).first().click()
    const createdBody = (await (await createResponse).json()) as any
    expect(createdBody.code, `提交失败：${createdBody.msg}`).toBe(0)

    // ---- 落库形态：日期是 yyyy-MM-dd 字符串，省市区是三级编码 ----
    const listResponse = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/page`,
      { headers: authHeaders(token), data: { pageNo: 1, pageSize: 100, conditions: [] } }
    )
    const rows = (((await listResponse.json()) as any).data?.list ?? []) as any[]
    const mine = rows.filter((r) => r.title === title)
    expect(mine.length, '刚录的那条查不到').toBe(1)
    expect(
      mine[0].occur_date,
      '日期没下发成 yyyy-MM-dd —— 下发纪元毫秒的话日期控件回显不上'
    ).toBe('2026-07-15')
    expect(Array.isArray(mine[0].area_code), '省市区没存成三级路径').toBeTruthy()
    expect(mine[0].area_code.length, '省市区应当是省/市/区三级').toBe(3)

    try {
      // ---- 再打开一次：这两项必须原样回显出来 ----
      await page.reload()
      await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
      await page
        .locator('.el-table__body-wrapper .el-table__row')
        .filter({ hasText: title })
        .first()
        .getByText('编辑')
        .click()
      await expect(formPanel(page)).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(2500)
      expect(await itemOf(/^日期$/).locator('input').first().inputValue(), '日期回显丢了').toBe(
        '2026-07-15'
      )
      expect(
        await itemOf('省市区').locator('.el-cascader input').first().inputValue(),
        '省市区回显丢了'
      ).toBe(areaPicked)
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

  test('⑩ 先编辑再新增，新增页不带上一条的内容', async ({ page }) => {
    await login(page)
    await openRuntime(page, GALLERY)

    // 1. 先打开一条已有记录的编辑态
    const demoRow = page
      .locator('.el-table__body-wrapper .el-table__row')
      .filter({ hasText: DEMO_ROW_TITLE })
      .first()
    await demoRow.getByText('编辑').click()
    await expect(formPanel(page)).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2500)
    const valueOf = async (label: string | RegExp) =>
      formPanel(page)
        .locator('.el-form-item')
        .filter({ hasText: label })
        .first()
        .locator('input')
        .first()
        .inputValue()
    expect(await valueOf('单行文本')).toBe(DEMO_ROW_TITLE)
    expect(await valueOf('数字（金额）')).not.toBe('')
    await page.getByRole('button', { name: /^取\s*消$/ }).first().click()
    await page.waitForTimeout(1000)

    // 2. 再点新增 —— 这条记录的值一个都不该跟过来
    await page.getByRole('button', { name: /^新增$/ }).first().click()
    await expect(formPanel(page)).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2500)

    // ⚠️ 不断言「单行文本是空的」：浏览器的自动填充会把登录用的账号塞进
    // 页面上第一个文本框，那与本用例要测的东西无关。只断言它不是刚才那条记录
    expect(await valueOf('单行文本'), '新增页带进了上一条记录的标题').not.toBe(DEMO_ROW_TITLE)
    expect(await valueOf('数字（金额）'), '新增页带进了上一条记录的金额').toBe('')
    expect(await valueOf('省市区'), '新增页带进了上一条记录的省市区').toBe('')
    expect(await valueOf(/^日期$/), '新增页带进了上一条记录的日期').toBe('')

    await page.keyboard.press('Escape')
  })

  test('② 批量删除是危险色，⑨ 附件点击触发下载而不是新开窗口', async ({ page, request }) => {
    const token = await apiLogin(request)
    // 示例默认没开批量删除，临时打开它 —— 测完还原
    const designId = await designIdOf(request, token, GALLERY)
    const detail = (await (
      await request.get(`${API_BASE_URL}/infra/form-design/get?id=${designId}`, {
        headers: authHeaders(token)
      })
    ).json()).data
    const listConf = JSON.parse(detail.listConf)
    const restoreConf = detail.listConf
    listConf.operationColumn = {
      ...(listConf.operationColumn ?? {}),
      buttons: [
        { key: 'create', label: '新增', icon: 'ep:plus', show: true },
        { key: 'export', label: '导出', icon: 'ep:download', show: true },
        { key: 'batchDelete', label: '批量删除', icon: 'ep:delete', show: true },
        { key: 'edit', label: '编辑', show: true },
        { key: 'detail', label: '详情', show: true },
        { key: 'delete', label: '删除', show: true }
      ]
    }
    await request.put(`${API_BASE_URL}/infra/form-design/update`, {
      headers: authHeaders(token),
      data: { ...detail, listConf: JSON.stringify(listConf) }
    })
    await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
      headers: authHeaders(token),
      data: { id: designId }
    })

    try {
      await login(page)
      await openRuntime(page, GALLERY)

      // ---- ② 批量删除的颜色要与租户列表一致 ----
      const batchDelete = page.getByRole('button', { name: /批量删除/ }).first()
      await expect(batchDelete, '批量删除按钮没出现').toBeVisible({ timeout: 30_000 })
      await expect(batchDelete, '批量删除还是默认灰，与「导出」看起来一样人畜无害').toHaveClass(
        /el-button--danger/
      )
      await expect(page.getByRole('button', { name: /^导出$/ }).first()).toHaveClass(
        /el-button--success/
      )

      // ---- ⑨ 附件列点击应当触发下载 ----
      const attachLink = page
        .locator('.el-table .list-cell-files .el-link')
        .first()
      await expect(attachLink, '附件列没渲染出附件').toBeVisible({ timeout: 20_000 })
      // 点击前记下窗口数：以前这里会 window.open 出一个新标签
      const pagesBefore = page.context().pages().length
      const downloadPromise = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null)
      await attachLink.click()
      const download = await downloadPromise
      expect(download, '点附件没有触发下载 —— 多半又变回在新窗口里打开了').toBeTruthy()
      expect(await download!.suggestedFilename()).toBeTruthy()
      expect(page.context().pages().length, '点附件弹出了新窗口').toBe(pagesBefore)
    } finally {
      await request.put(`${API_BASE_URL}/infra/form-design/update`, {
        headers: authHeaders(token),
        data: { ...detail, listConf: restoreConf }
      })
      await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: designId }
      })
    }
  })

  test('⑪ 导出能下载到文件，失败时也会弹出提示', async ({ page, request }) => {
    const token = await apiLogin(request)
    const designId = await designIdOf(request, token, GALLERY)
    const detail = (await (
      await request.get(`${API_BASE_URL}/infra/form-design/get?id=${designId}`, {
        headers: authHeaders(token)
      })
    ).json()).data
    const listConf = JSON.parse(detail.listConf)
    const restoreConf = detail.listConf
    listConf.operationColumn = {
      ...(listConf.operationColumn ?? {}),
      buttons: [
        { key: 'create', label: '新增', show: true },
        { key: 'export', label: '导出', show: true },
        { key: 'edit', label: '编辑', show: true },
        { key: 'detail', label: '详情', show: true },
        { key: 'delete', label: '删除', show: true }
      ]
    }
    await request.put(`${API_BASE_URL}/infra/form-design/update`, {
      headers: authHeaders(token),
      data: { ...detail, listConf: JSON.stringify(listConf) }
    })
    await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
      headers: authHeaders(token),
      data: { id: designId }
    })

    try {
      await login(page)
      await openRuntime(page, GALLERY)
      const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
      await page.getByRole('button', { name: /^导出$/ }).first().click()
      // 确认框
      await page.locator('.el-message-box__btns button').last().click()
      const download = await downloadPromise
      const fileName = download.suggestedFilename()
      expect(
        fileName,
        '导出没有下载到 xlsx —— 以前 DATE 列会让 FastExcel 找不到 Converter 直接 500'
      ).toMatch(/\.xlsx$/)
      // 文件名要是表单的中文名。
      // ⚠️ 响应头指望不上：ExcelUtils.write 设 Content-Disposition 的时机在写流之后，
      // 那会儿响应已经 chunked、早提交了，这个头发不出来（框架里每个导出都这样）。
      // 所以文件名由前端给 —— 退回用表单编码的话，用户拿到的是一堆 test_demo_xxx.xlsx
      expect(fileName, `导出文件名退回成编码了：${fileName}`).toContain('控件总览示例')
      // 不该出现错误提示
      await expect(page.locator('.el-message--error')).toHaveCount(0)
    } finally {
      await request.put(`${API_BASE_URL}/infra/form-design/update`, {
        headers: authHeaders(token),
        data: { ...detail, listConf: restoreConf }
      })
      await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
        headers: authHeaders(token),
        data: { id: designId }
      })
    }
  })
})

test.describe('表单运行时 · 跨表取数示例', () => {
  test('⑬ 关联客户能选、能带出、能提交', async ({ page, request }) => {
    const token = await apiLogin(request)
    // 金额当作这一条的指纹：合同编号由模板生成，事先不知道是什么
    const uniqueAmount = Number(`1${String(Date.now()).slice(-6)}.11`)

    await login(page)
    await openRuntime(page, CONTRACT)
    await page.getByRole('button', { name: /^新增$/ }).first().click()
    const panel = formPanel(page)
    await expect(panel).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2000)

    // ---- 控件本身要渲染成真组件 ----
    //
    // 以前 form-create 解析 type: 'RelationForm' 时在组件表里找不到它，
    // 产出一个 <relationform> 未知元素：页面上一片空白，只有一条 warning。
    // 而这个字段是必填的，于是整张表单根本提交不了
    const unknownTags = await panel.evaluate((root) =>
      Array.from(root.querySelectorAll('*'))
        .filter((el) => el instanceof HTMLUnknownElement)
        .map((el) => el.tagName.toLowerCase())
    )
    expect(unknownTags, `这些规则类型没有渲染组件：${unknownTags.join('、')}`).toEqual([])

    const relationItem = panel.locator('.el-form-item').filter({ hasText: '关联客户' }).first()
    await expect(relationItem.locator('.relation-form'), '关联客户控件没渲染').toBeVisible()

    // ---- 选一条客户 ----
    await relationItem.locator('.el-select').first().click()
    const option = page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first()
    await expect(option, '关联客户下拉一个选项都没有').toBeVisible({ timeout: 20_000 })
    const customerName = (await option.innerText()).trim()
    await option.click()
    await page.waitForTimeout(1200)

    // ---- 带出字段要当场填上，而不是等保存成功再打开才有值 ----
    const broughtName = await panel
      .locator('.el-form-item')
      .filter({ hasText: '客户名称（带出）' })
      .first()
      .locator('input')
      .first()
      .inputValue()
    expect(broughtName, '选了客户但带出字段还是空的').toBe(customerName)

    // ---- 填完必填项真的提交一次 ----
    //
    // 这张表单的必填项是：关联客户、签订日期、合同金额、状态。
    // 合同编号由单据模板自动生成，不用填
    const signDate = panel.locator('.el-form-item').filter({ hasText: '签订日期' }).first()
    await signDate.locator('input').first().fill('2026-09-12')
    await page.keyboard.press('Enter')
    const amount = panel.locator('.el-form-item').filter({ hasText: '合同金额' }).first()
    await amount.locator('input').first().fill(String(uniqueAmount))
    const status = panel
      .locator('.el-form-item')
      .filter({ hasText: /^状态/ })
      .first()
    await status.locator('.el-select').first().click()
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first().click()

    const createResponse = page.waitForResponse(
      (r) => r.url().includes(`/${CONTRACT}/create`) && r.request().method() === 'POST'
    )
    await page.getByRole('button', { name: /^确\s*定$/ }).first().click()
    const created = await createResponse
    const createdBody = (await created.json()) as any
    expect(createdBody.code, `提交失败：${createdBody.msg}`).toBe(0)

    // ---- 服务端重读被关联记录后，落库的带出字段要与选中的客户一致 ----
    const pageResponse = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${CONTRACT}/page`,
      { headers: authHeaders(token), data: { pageNo: 1, pageSize: 100, conditions: [] } }
    )
    const rows = (((await pageResponse.json()) as any).data?.list ?? []) as any[]
    const mine = rows.filter((r) => Number(r.amount) === uniqueAmount)
    expect(mine.length, '刚提交的那条查不到').toBeGreaterThan(0)
    expect(mine[0].customer_name, '关联带出的客户名没落库').toBe(customerName)

    // 清掉自己造的数据
    for (const row of mine) {
      await request
        .delete(`${API_BASE_URL}/infra/form-design/runtime/${CONTRACT}/delete?id=${row.id}`, {
          headers: authHeaders(token)
        })
        .catch(() => undefined)
    }
  })
})
