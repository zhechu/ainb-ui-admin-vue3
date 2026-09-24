import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 控件渲染与录入的端到端验证
 *
 * 守的是一批「配置读得到、界面也有那一行、控件却是个空壳」的缺陷 —— 它们的共同点是
 * **接口全绿、脚本全绿，只有人打开页面才看得出来**，所以只能在这一层拦：
 *
 * - 规则类型在 form-create 里解析不到组件时，会渲染成一个未知元素（`<password>`、
 *   `<daterange>`、`<elimage>`），页面上是一片空白，控制台顶多一条 warning
 * - 更隐蔽的是超链接：规则类型 `Link` 被归一成 `link`，而 `link` 是原生 HTML 标签，
 *   于是渲染成一个 void element，**连 warning 都没有**
 * - 选项类控件的数据源配错位置时，控件本身渲染得好好的，只是一个选项都没有
 *
 * 所以这里的断言分三层：控件渲染成了真组件 → 选项类控件真的有数据 → 真录一条存得进读得回。
 *
 * 前置条件：示例已由 script/form-demo 下的脚本建好并发布。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'
const GALLERY = 'test_demo_widget_gallery'

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

/**
 * 表单容器：弹窗 / 抽屉 / 页内，三种都认
 *
 * ⚠️ 不要写死 .el-dialog。表单装在哪里由列表设计里的「表单呈现方式」决定，
 * 那是一项配置 —— 示例表单的这项配置一旦被改过，本文件的用例会一起以
 * 「弹窗没出现」失败，而真正的原因与所测的控件渲染毫无关系，排查时极易被带偏。
 */
const formPanel = (page: Page) =>
  page.locator('.el-dialog:visible, .el-drawer:visible, .inline-panel').first()

/** 打开示例的运行时页。走静态预览路由，理由见 form-design-demos.spec.ts */
async function openGallery(page: Page) {
  await page.goto(`/infra-form-design/preview?code=${GALLERY}`)
  await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
}

/** 按标题删掉用例自己造的那条数据 */
async function deleteRowsByTitle(request: APIRequestContext, token: string, title: string) {
  const response = await request.post(`${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/page`, {
    headers: authHeaders(token),
    data: { pageNo: 1, pageSize: 100, conditions: [] }
  })
  const rows = (((await response.json()) as any).data?.list ?? []) as Record<string, any>[]
  for (const row of rows.filter((r) => r.title === title)) {
    await request
      .delete(`${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/delete?id=${row.id}`, {
        headers: authHeaders(token)
      })
      .catch(() => undefined)
  }
}

test.describe('控件总览 · 渲染与录入', () => {
  test('每个控件都渲染成了真组件，没有解析不到的空壳', async ({ page }) => {
    await login(page)
    await openGallery(page)
    await page.getByRole('button', { name: '新增' }).click()
    const dialog = formPanel(page)
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    // 表单里控件很多，等最后一组（布局容器）出来再断言
    await expect(dialog.locator('.form-steps').first()).toBeVisible({ timeout: 30_000 })

    // ---- 总闸：不允许出现未知元素 ----
    //
    // 浏览器把认不出来的标签建成 HTMLUnknownElement。规则类型在 form-create 里
    // 解析不到组件时，产物正是这种元素 —— 一次性把所有这类缺陷都拦下，
    // 比逐个控件写断言更不容易漏（将来新增控件忘了注册渲染器也会被这条抓到）。
    const unknownTags = await dialog.evaluate((root) =>
      Array.from(root.querySelectorAll('*'))
        .filter((el) => el instanceof HTMLUnknownElement)
        .map((el) => el.tagName.toLowerCase())
    )
    expect(unknownTags, `这些规则类型没有对应的渲染组件：${unknownTags.join('、')}`).toEqual([])

    // ---- 超链接单独查 ----
    //
    // 它不会变成 HTMLUnknownElement：`link` 是原生 HTML 标签，浏览器会老老实实
    // 建一个 HTMLLinkElement（void element，页面上什么都不显示），上面那条闸放它过去。
    expect(await dialog.locator('link').count(), '超链接又渲染成原生 <link> 了').toBe(0)
    // 新增时被引用的「主页地址」字段还没填，超链接降级成纯文本 —— 文案得在
    await expect(fieldContent(dialog, '超链接'), '超链接控件没渲染出内容').toContainText('打开主页')

    // 展示类控件的文案放在规则的 children 里（不是 props）。运行时的场景/折叠过滤
    // 曾经把字符串子节点整个丢掉，表现是控件在、里面一个字都没有
    await expect(dialog.locator('.el-tag').first(), '标签控件没有文字').toContainText('示例标签')
    await expect(dialog, '按钮控件没有文字').toContainText('这是一个展示用按钮')
    await expect(dialog, '自定义 HTML 没有内容').toContainText('这段内容由「自定义 HTML」控件渲染')
    await expect(dialog, '文字控件没有内容').toContainText('「文字」控件用来放一段固定说明')

    // ---- 逐个点名：这几个是这次修复的对象 ----
    await expect(dialog.locator('input[type="password"]').first(), '密码框没渲染').toBeVisible()
    await expect(
      dialog.locator('.el-date-editor--daterange, .el-date-editor--datetimerange').first(),
      '日期区间没渲染'
    ).toBeVisible()
    await expect(dialog.locator('.el-date-editor--timerange').first(), '时间区间没渲染').toBeVisible()
    await expect(dialog.locator('.el-tree').first(), '树形控件没渲染').toBeVisible()
    await expect(dialog.locator('.el-transfer').first(), '穿梭框没渲染').toBeVisible()
    await expect(dialog.locator('.signature-canvas').first(), '手写签名画布没渲染').toBeVisible()
    // 断言 .el-image（ElImage 的根类）而不是 .el-image img：本条要证明的是「控件解析成了
    // 真组件、不是空壳」，而 .el-image 只在 ElImage 真正挂载后才存在（解析不到会退化成
    // HTMLUnknownElement，已被上面的总闸拦下）。里面的 <img> 要等 src 下载成功才出现，
    // 而这张图指向外部 demo 资源站（test.yudao.iocoder.cn），它会 403 —— 那是外网可达性，
    // 不是控件渲染缺陷，不该让本用例跟着外部主机抖动。
    await expect(dialog.locator('.el-image').first(), '静态图片控件没渲染成 ElImage').toBeVisible()
  })

  test('选项类控件真的取到了数据，而不只是渲染出一个空下拉', async ({ page }) => {
    await login(page)
    await openGallery(page)
    await page.getByRole('button', { name: '新增' }).click()
    const dialog = formPanel(page)
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(dialog.locator('.el-transfer').first()).toBeVisible({ timeout: 30_000 })

    // 树形控件（字典树）：有节点，而不是「暂无数据」
    const tree = dialog.locator('.el-tree').first()
    await expect(tree.locator('.el-tree-node').first(), '树形控件没有节点').toBeVisible()
    await expect(tree).not.toContainText('暂无数据')

    // 穿梭框：左栏有待选项
    const transfer = dialog.locator('.el-transfer').first()
    expect(
      await transfer.locator('.el-transfer-panel').first().locator('.el-transfer-panel__item').count(),
      '穿梭框左栏没有可选项'
    ).toBeGreaterThan(0)

    // 远程数据选择（数据接口）：展开后有选项。
    // 它取数走 /data-interface/options，返回体被服务端包了两层，
    // 剥壳漏了就是「接口调成功、下拉全空」
    await openSelectByLabel(page, dialog, '远程数据选择（数据接口）')
    const remoteOptions = page.locator('.el-select-dropdown:visible .el-select-dropdown__item')
    await expect(remoteOptions.first(), '远程数据选择没有选项').toBeVisible({ timeout: 15_000 })
    expect(await remoteOptions.count()).toBeGreaterThan(0)
    await page.keyboard.press('Escape')

    // 树选择（字典树）：展开后是一棵树
    await openSelectByLabel(page, dialog, '树选择（字典树）')
    await expect(
      page.locator('.el-select-dropdown:visible .el-tree-node').first(),
      '树选择没有节点'
    ).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')

    // 下拉（数据字典）：同一套选项来源机制，一并守住
    await openSelectByLabel(page, dialog, '下拉（数据字典）')
    await expect(
      page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first(),
      '字典下拉没有选项'
    ).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
  })

  test('真录入一条：这批控件的值存得进也读得回', async ({ page, request }) => {
    const token = await apiLogin(request)
    const title = `E2E 控件录入 ${Date.now()}`
    try {
      await login(page)
      await openGallery(page)
      await page.getByRole('button', { name: '新增' }).click()
      const dialog = formPanel(page)
      await expect(dialog).toBeVisible({ timeout: 30_000 })
      await expect(dialog.locator('.el-transfer').first()).toBeVisible({ timeout: 30_000 })

      // 必填的单行文本
      await fieldContent(dialog, '单行文本').locator('input').first().fill(title)

      // 主页地址：下面的超链接控件用 `{homepage}` 引用它。
      // ⚠️ 地址里刻意带 & 与查询串 —— 整条地址来自一个字段时插值【不能】编码，
      // 编了 https://… 会变成 https%3A%2F%2F…，浏览器当成相对路径，
      // 链接看着渲染得好好的、点下去跳到当前站点下一个不存在的页面
      const homepage = 'https://example.com/e2e?a=1&b=2'
      await fieldContent(dialog, '主页地址').locator('input').first().fill(homepage)
      const link = fieldContent(dialog, '超链接').locator('a.el-link').first()
      await expect(link, '超链接没有跟着主页地址变成可点的链接').toBeVisible({ timeout: 10_000 })
      await expect(link, '超链接的地址被编码坏了').toHaveAttribute('href', homepage)

      // 密码框：这是「无法输入」那条的正面验证
      const password = dialog.locator('input[type="password"]').first()
      await password.fill('E2E@Passw0rd')
      await expect(password).toHaveValue('E2E@Passw0rd')

      // 日期区间：点开面板，选当月的 10 号与 20 号
      const dateRange = fieldContent(dialog, '日期区间（一列存两头）')
      await dateRange.locator('input').first().click()
      const panel = page.locator('.el-picker-panel:visible').first()
      await expect(panel).toBeVisible({ timeout: 10_000 })
      await panel.locator('td.available:not(.next-month):not(.prev-month)').nth(9).click()
      await panel.locator('td.available:not(.next-month):not(.prev-month)').nth(19).click()
      await expect(dateRange.locator('input').first(), '日期区间没有选中值').not.toHaveValue('')

      // 树形控件：勾一个节点。
      // 点可见的方块（.el-checkbox__inner），不要点 .el-checkbox__original ——
      // 那个原生 input 被样式挪出了视口，Playwright 会判定「不在视口内」
      const tree = dialog.locator('.el-tree').first()
      await tree.scrollIntoViewIfNeeded()
      const treeCheckbox = tree.locator('.el-tree-node .el-checkbox__inner').first()
      await treeCheckbox.click()
      await expect(
        tree.locator('.el-tree-node .el-checkbox.is-checked').first(),
        '树形控件没能勾上节点'
      ).toBeVisible()

      // 穿梭框：把左栏第一项移到右栏
      const transfer = dialog.locator('.el-transfer').first()
      const leftPanel = transfer.locator('.el-transfer-panel').first()
      await leftPanel.locator('.el-transfer-panel__item').first().click()
      await transfer.locator('.el-transfer__buttons button').last().click()
      expect(
        await transfer.locator('.el-transfer-panel').last().locator('.el-transfer-panel__item').count(),
        '穿梭框没能把选项移到右栏'
      ).toBeGreaterThan(0)

      // 远程数据选择：挑一个接口返回的选项
      await openSelectByLabel(page, dialog, '远程数据选择（数据接口）')
      await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first().click()

      // 中文名附件：显示出来的必须是中文原名，不是百分号编码
      const uploadInput = dialog.locator('.upload-file input[type="file"]').first()
      await uploadInput.setInputFiles({
        name: '录入测试-中文附件.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('E2E 上传内容', 'utf-8')
      })
      const uploadedName = dialog.locator('.upload-file').first()
      await expect(uploadedName, '中文文件名显示成了百分号编码').toContainText(
        '录入测试-中文附件.txt',
        { timeout: 30_000 }
      )

      // 手写签名：画一笔再确认，值应当换成一张图
      const canvas = dialog.locator('.signature-canvas').first()
      await canvas.scrollIntoViewIfNeeded()
      const box = await canvas.boundingBox()
      expect(box, '签名画布没有尺寸').toBeTruthy()
      await page.mouse.move(box!.x + 20, box!.y + 20)
      await page.mouse.down()
      await page.mouse.move(box!.x + 120, box!.y + 70, { steps: 10 })
      await page.mouse.move(box!.x + 220, box!.y + 30, { steps: 10 })
      await page.mouse.up()
      await dialog.getByRole('button', { name: '确认签名' }).click()
      await expect(dialog.locator('.signature-signed img'), '签名没有保存成图片').toBeVisible({
        timeout: 30_000
      })
      // 签完必须还能重签 —— 「允许重签」的默认值曾经被 Vue 的 boolean 转换翻成 false，
      // 表现是只要字段有值就永远签不了
      await expect(
        dialog.getByRole('button', { name: '重签' }),
        '已签名后没有「重签」入口'
      ).toBeVisible()

      // 提交
      await dialog.getByRole('button', { name: /确\s*定|保\s*存|提\s*交/ }).last().click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })

      // ---- 回查：接口读回来的值要齐 ----
      const response = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/page`,
        { headers: authHeaders(token), data: { pageNo: 1, pageSize: 100, conditions: [] } }
      )
      const rows = (((await response.json()) as any).data?.list ?? []) as Record<string, any>[]
      const saved = rows.find((r) => r.title === title)
      expect(saved, '刚录入的那条查不到').toBeTruthy()

      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/get?id=${saved!.id}`,
        { headers: authHeaders(token) }
      )
      const record = ((await detail.json()) as any).data as Record<string, any>
      expect(record.secret, '密码框的值没存进去').toBe('E2E@Passw0rd')
      expect(Array.isArray(record.date_range) && record.date_range.length, '日期区间没存成两头').toBe(2)
      expect(record.tree_multi?.length, '树形控件的勾选没存进去').toBeGreaterThan(0)
      expect(record.transfer_values?.length, '穿梭框的选中没存进去').toBeGreaterThan(0)
      expect(record.remote_value, '远程数据选择的值没存进去').toBeTruthy()
      expect(record.sign_image, '签名没存进去').toBeTruthy()
      expect(record.attachment?.length, '附件没存进去').toBeGreaterThan(0)
      // 服务端会把上传值补成 {name,url,...}，原文件名要是中文原名
      expect(
        JSON.stringify(record.attachment),
        '附件的原文件名没落成中文'
      ).toContain('录入测试-中文附件.txt')

      // ---- 再打开编辑，界面上也读得回 ----
      await openGallery(page)
      await page
        .locator('.el-table__body-wrapper tbody tr', { hasText: title })
        .first()
        .getByRole('button', { name: '编辑' })
        .click()
      const editDialog = formPanel(page)
      await expect(editDialog).toBeVisible({ timeout: 30_000 })
      await expect(editDialog.locator('input[type="password"]').first()).toHaveValue(
        'E2E@Passw0rd',
        { timeout: 30_000 }
      )
      await expect(
        fieldContent(editDialog, '日期区间（一列存两头）').locator('input').first(),
        '日期区间回显是空的'
      ).not.toHaveValue('')
      await expect(editDialog.locator('.upload-file').first()).toContainText(
        '录入测试-中文附件.txt'
      )
      await expect(editDialog.locator('.signature-signed img')).toBeVisible()
    } finally {
      await deleteRowsByTitle(request, token, title)
    }
  })
})

test.describe('表单设计器 · 头部按钮', () => {
  /**
   * 保存按钮错位
   *
   * 原先右侧按钮组写死 w-300px，第三步起要放四个按钮（体检 / 上一步 / 下一步 /
   * 保存拆分按钮）装不下：保存的下拉箭头被挤到第二行、整组戳出 50px 的头部，
   * 体检压到步骤条上，窄屏时保存干脆跑到可视区外。
   *
   * 三档视口都量一遍 —— 这个缺陷在宽屏上只是「有点丑」，窄屏上才是「点不到保存」。
   */
  for (const width of [1440, 1280, 1100]) {
    test(`@${width} 保存按钮完整落在头部内，且不与步骤条重叠`, async ({ page, request }) => {
      const token = await apiLogin(request)
      const listResp = await request.get(
        `${API_BASE_URL}/infra/form-design/page?pageNo=1&pageSize=100`,
        { headers: authHeaders(token) }
      )
      const designs = (((await listResp.json()) as any).data?.list ?? []) as any[]
      const gallery = designs.find((d) => d.code === GALLERY)
      expect(gallery, '找不到控件总览示例，先跑 script/form-demo/demo1_gallery.py').toBeTruthy()

      await page.setViewportSize({ width, height: 900 })
      await login(page)
      await page.goto(`/infra/online/editor?id=${gallery.id}`)
      await page.waitForSelector('.form-design-editor-page', { timeout: 60_000 })

      // 切到第三步：按钮最多的那一步
      await page
        .locator('.form-design-editor-page .absolute.top-0 span', { hasText: '表单设计' })
        .first()
        .click()
      await expect(page.locator('.form-design-wrapper')).toBeVisible({ timeout: 60_000 })

      const geo = await page.evaluate(() => {
        const header = document.querySelector(
          '.form-design-editor-page .absolute.top-0'
        ) as HTMLElement
        const right = header.lastElementChild as HTMLElement
        const steps = header.children[1] as HTMLElement
        const save = Array.from(right.querySelectorAll('button')).find((b) =>
          (b as HTMLElement).innerText.replace(/\s/g, '').includes('保存')
        ) as HTMLElement
        const box = (el: Element) => {
          const r = el.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }
        }
        return {
          win: window.innerWidth,
          header: box(header),
          steps: box(steps),
          right: box(right),
          save: save ? box(save) : null
        }
      })

      expect(geo.save, '找不到保存按钮').toBeTruthy()
      // 完整落在视口内
      expect(geo.save!.right, '保存按钮右边越过了窗口').toBeLessThanOrEqual(geo.win)
      expect(geo.save!.left, '保存按钮被挤到了窗口外').toBeGreaterThan(0)
      // 没有戳出 50px 的头部（拆分按钮换行时会同时戳出上下两边）
      expect(geo.right.top, '按钮组戳出了头部上边').toBeGreaterThanOrEqual(geo.header.top - 1)
      expect(geo.right.bottom, '按钮组戳出了头部下边').toBeLessThanOrEqual(geo.header.bottom + 1)
      // 按钮没有压到步骤条上
      expect(geo.right.left, '按钮组与步骤条重叠了').toBeGreaterThanOrEqual(geo.steps.right - 1)
    })
  }
})

// =====================================================================
// 设计器产出的规则类型
// =====================================================================

/**
 * 从左侧面板点击添加一个控件（设计器的 clickMenu，比模拟拖拽稳定）
 */
async function addWidget(page: Page, label: string) {
  const item = page.locator('._fc-l-item', { hasText: label }).first()
  await expect(item, `左侧面板里找不到控件[${label}]`).toHaveCount(1, { timeout: 15_000 })
  await item.click()
  await expect(page.locator('._fc-r-tab-props')).toBeVisible({ timeout: 15_000 })
}

test.describe('设计器产出的规则类型与控件契约一致', () => {
  /**
   * 契约（form-widget-contracts.json）里的 `type` 是**规则里的 type**，后端按它查
   * 落库形态与能力位；而设计器内核的密码输入 / 日期区间 / 时间区间三个菜单，
   * 拖出来的规则类型分别是 input / datePicker / timePicker —— 菜单名不等于规则类型。
   *
   * 这条差异最要命的是日期区间：契约里它是 array + delimited（一列存两头），
   * datePicker 却是 date + scalar。类型对不上时，一个数组会被当标量往日期列里写，
   * 而且一路不报错。所以这里守的是「从设计器拖出来的东西，后端认得出是什么」。
   */
  const EXPECTED: Array<{ label: string; type: string }> = [
    { label: '密码输入', type: 'password' },
    { label: '日期区间', type: 'dateRange' },
    { label: '时间区间', type: 'timeRange' }
  ]

  let scratchId: number | undefined

  test.afterAll(async ({ request }) => {
    if (!scratchId) return
    const token = await apiLogin(request)
    await request
      .delete(`${API_BASE_URL}/infra/form-design/delete?id=${scratchId}`, {
        headers: authHeaders(token)
      })
      .catch(() => undefined)
    scratchId = undefined
  })

  test('拖出来的密码框 / 日期区间 / 时间区间，type 就是契约里的那个', async ({ page, request }) => {
    const token = await apiLogin(request)
    // 自己建画布，不借用环境里已有的表单 —— 借用会让这组用例跟着别人的改动飘
    const created = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
      headers: authHeaders(token),
      data: {
        name: '控件类型用例画布',
        code: `e2e_widget_type_${Date.now()}`,
        formType: 1,
        formConf: JSON.stringify({ form: { labelWidth: '100px' } }),
        formFields: [],
        dataSourceConfigId: 0
      }
    })
    expect(created.ok(), '造画布表单失败').toBeTruthy()
    scratchId = ((await created.json()) as { data: number }).data

    await login(page)
    await page.goto(`/infra/online/editor?id=${scratchId}`)
    await page.getByText('表单设计', { exact: true }).last().click()
    await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 60_000 })

    for (const { label } of EXPECTED) {
      await addWidget(page, label)
    }

    // 存下来，再从接口读回规则 —— 断言的是「真的存进去的那份」，
    // 不是画布上的内存状态
    const saved = page.waitForResponse(
      (r) => r.url().includes('/infra/form-design/update') && r.request().method() === 'PUT'
    )
    await page
      .locator('.form-design-editor-page .absolute.top-0 button', { hasText: '保 存' })
      .first()
      .click()
    expect((await saved).ok(), '保存请求没成功').toBeTruthy()
    await expect(page.locator('.el-message__content', { hasText: '保存成功' })).toBeVisible({
      timeout: 30_000
    })

    const detail = await request.get(
      `${API_BASE_URL}/infra/form-design/get?id=${scratchId}`,
      { headers: authHeaders(token) }
    )
    const fields = (((await detail.json()) as any).data?.formFields ?? []) as string[]
    const rules = fields.map((f) => JSON.parse(f) as Record<string, any>)

    for (const { label, type } of EXPECTED) {
      const hit = rules.find((r) => r._fc_drag_tag === type)
      expect(hit, `画布里没有[${label}]这个控件`).toBeTruthy()
      expect(hit!.type, `[${label}]存下来的规则类型与契约不一致`).toBe(type)
    }
  })
})

// =====================================================================
// 小工具
// =====================================================================

/**
 * 按 label 文字定位那一项的内容区。表单里同类控件很多，只能靠 label 认
 *
 * ⚠️ 用「开头匹配」而不是「包含」：这张表单里有一项叫「主页地址（供下方超链接引用）」，
 * 按包含去找「超链接」会先命中它，拿到的是个输入框，断言全落空还看不出原因。
 */
function fieldContent(root: ReturnType<Page['locator']>, label: string) {
  const startsWith = new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return root
    .locator('.el-form-item')
    .filter({ has: root.page().locator('.el-form-item__label', { hasText: startsWith }) })
    .first()
    .locator('.el-form-item__content')
}

/** 展开某个 label 对应的下拉 */
async function openSelectByLabel(
  page: Page,
  root: ReturnType<Page['locator']>,
  label: string
): Promise<void> {
  const content = fieldContent(root, label)
  await content.scrollIntoViewIfNeeded()
  await content.locator('.el-select__wrapper, .el-select').first().click()
}
