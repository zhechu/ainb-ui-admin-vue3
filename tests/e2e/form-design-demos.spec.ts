import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 开发示例的端到端验证
 *
 * 验的是【基础设施 → 开发示例 → 在线开发】下面那批示例表单「真的能用」。
 *
 * ## 与接口冒烟的分工
 *
 * 示例入库时有一轮接口冒烟（新增→详情→分页→更新→删除），那一轮保证
 * 「表绑定配对了、值存得进去也读得回来」。这里保证的是另一半：
 * **界面上渲染得出来**。两者不能互相替代 ——
 * 本模块反复踩过「后端与运行时都做完了，但没有入口」，
 * 那种缺陷接口全绿、用户却用不上。
 *
 * ## 前置条件
 *
 * 示例已由入库脚本建好并发布。用例只读不写配置，
 * 造的业务数据自己删干净。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  expect(response.ok(), '接口登录失败').toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  return body.data!.accessToken as string
}

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

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

/**
 * 打开示例的运行时页
 *
 * 走静态预览路由，不走发布生成的菜单路由 —— 新菜单要分配给角色、
 * 再重新登录才会注册动态路由，在用例里改角色菜单分配的风险远大于收益。
 * 预览路由不绕过鉴权，运行时接口仍按 infra:form-design-run:{code}:{action} 校验。
 */
async function openDemo(page: Page, code: string) {
  await page.goto(`/infra-form-design/preview?code=${code}`)
}

/** 造一条业务数据，返回主键。用完要删 */
async function createRow(
  request: APIRequestContext,
  token: string,
  code: string,
  data: Record<string, any>
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/infra/form-design/runtime/${code}/create`, {
    headers: authHeaders(token),
    data
  })
  const body = (await response.json()) as { code: number; msg: string; data: any }
  expect(body.code, `造数据失败：${body.msg}`).toBe(0)
  return String(body.data)
}

async function deleteRow(
  request: APIRequestContext,
  token: string,
  code: string,
  id: string | undefined
) {
  if (!id) return
  await request
    .delete(`${API_BASE_URL}/infra/form-design/runtime/${code}/delete?id=${id}`, {
      headers: authHeaders(token)
    })
    .catch(() => undefined)
}

// =====================================================================
// 示例 1：控件总览
// =====================================================================

const GALLERY = 'test_demo_widget_gallery'

test.describe('示例 1 · 控件总览', () => {
  test('列表页渲染：查询区按控件类型分化、格式化列渲染成元素', async ({ page, request }) => {
    const token = await apiLogin(request)
    let id: string | undefined
    try {
      id = await createRow(request, token, GALLERY, {
        title: 'E2E 控件总览',
        amount: 2580.5,
        rate_score: 5,
        enabled: 1,
        priority: '1',
        bill_status: 'APPROVED',
        occur_date: '2026-09-11',
        homepage: 'https://example.com/e2e'
      })

      await login(page)
      await openDemo(page, GALLERY)
      await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

      // 查询区：字典字段是下拉、日期是日期控件、数字是数字框，而不是一律文本框。
      // 超过三项默认折叠，先展开
      const searchArea = page.locator('.el-form--inline').first()
      await expect(searchArea.locator('.el-select').first()).toBeVisible()
      await page.getByRole('button', { name: /展开/ }).click()
      await expect(searchArea.locator('.el-date-editor').first()).toBeVisible()
      await expect(searchArea.locator('.el-input-number').first()).toBeVisible()

      const body = page.locator('.el-table__body-wrapper tbody')
      await expect(body).toContainText('E2E 控件总览')

      // 标签列渲染成标签，且印的是字典中文
      await expect(body.locator('.el-tag').first()).toBeVisible()
      await expect(body).toContainText('已审批')

      // 超链接列渲染成可点的链接
      await expect(body.locator('a.el-link').first()).toHaveAttribute('href', /example\.com/)

      // 千分位生效
      await expect(body).toContainText('2,580.50')

      // 合计行
      await expect(page.locator('.el-table__footer-wrapper')).toBeVisible()
    } finally {
      await deleteRow(request, token, GALLERY, id)
    }
  })

  test('表单页渲染：分组标题、各类控件与纯展示控件都出得来', async ({ page }) => {
    // 只开弹窗不提交，没有数据要清，因此不需要 try/finally
    await login(page)
    await openDemo(page, GALLERY)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    await page.getByRole('button', { name: '新增' }).click()
    const dialog = page.locator('.el-dialog')
    await expect(dialog).toBeVisible({ timeout: 20_000 })

    // 七个分组标题都在
    for (const group of ['一、基础输入', '二、选项类', '三、层级与多值', '四、时间',
      '五、文件与富媒体', '六、计算与编号', '七、纯展示控件']) {
      await expect(dialog, `分组[${group}]没渲染出来`).toContainText(group)
    }

    // 抽查几类控件的实例真的挂上了，而不只是标题文字
    await expect(dialog.locator('.el-rate').first(), '评分控件没渲染').toBeVisible()
    await expect(dialog.locator('.el-slider').first(), '滑块没渲染').toBeVisible()
    await expect(dialog.locator('.el-switch').first(), '开关没渲染').toBeVisible()
    await expect(dialog.locator('.el-color-picker').first(), '颜色选择没渲染').toBeVisible()
    await expect(dialog.locator('.el-transfer').first(), '穿梭框没渲染').toBeVisible()

    // 纯展示控件：提示、分割线
    await expect(dialog.locator('.el-alert').first(), '提示控件没渲染').toBeVisible()
    await expect(dialog.locator('.el-divider').first(), '分割线没渲染').toBeVisible()
  })

  test('演示数据齐全：两条记录都在，图片与附件列渲染成元素而不是地址', async ({
    page,
    request
  }) => {
    // 示例的价值是「打开就能看到每个控件长什么样」。少了演示数据，
    // 列表整片是「-」，等于什么都没演示。这条用例守住入库脚本真的跑过。
    const token = await apiLogin(request)
    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${GALLERY}/page`,
      {
        headers: authHeaders(token),
        data: { pageNo: 1, pageSize: 100, conditions: [] }
      }
    )
    const rows = (((await response.json()) as any).data?.list ?? []) as Record<string, any>[]
    const demos = rows.filter((row) =>
      ['新能源汽车采购意向单', '办公家具年度框架协议'].includes(row.title)
    )
    expect(demos.length, '示例的两条演示数据不齐，先跑 script/form-demo/demo1_gallery_data.py').toBe(2)

    // 列表配出来的每一列都要有值 —— 演示数据的意义就在于「每个字段都有值」
    const listedFields = [
      'title', 'priority', 'bill_status', 'amount', 'rate_score',
      'occur_date', 'cover_image', 'attachment', 'homepage', 'bill_no'
    ]
    for (const row of demos) {
      for (const field of listedFields) {
        expect(row[field], `演示数据[${row.title}]的 ${field} 是空的`).toBeTruthy()
      }
    }

    await login(page)
    await openDemo(page, GALLERY)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    const body = page.locator('.el-table__body-wrapper tbody')
    await expect(body).toContainText('新能源汽车采购意向单')
    await expect(body).toContainText('办公家具年度框架协议')

    // 图片列渲染成图片元素（不是一串地址），附件列渲染成带原文件名的链接
    await expect(body.locator('.el-image').first(), '图片列没渲染成图片').toBeVisible()
    await expect(body.getByText('gallery-attach-1.txt').first(), '附件列应显示原文件名').toBeVisible()
  })
})

// =====================================================================
// 示例 2：列表标签页
// =====================================================================

const TASK_TAB = 'test_demo_task_tab'

/**
 * 表格里【看得见的】数据行数
 *
 * ⚠️ 必须加 :visible。树形表格里，折叠起来的子行仍然留在 DOM 里（display:none），
 * 直接数 tr 会把它们算进去 —— 一棵只展示三个根节点的树会数出十七行。
 */
const rowCount = (page: Page) =>
  page.locator('.el-table__body-wrapper tbody tr:visible').count()

test.describe('示例 2 · 列表标签页', () => {
  test('演示数据齐全：八条、三种状态条数各不相同', async ({ request }) => {
    // 各页签条数一样的话，切页签时看不出到底筛没筛 —— 演示数据本身要能说明问题
    const token = await apiLogin(request)
    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${TASK_TAB}/page`,
      { headers: authHeaders(token), data: { pageNo: 1, pageSize: 100, conditions: [] } }
    )
    const rows = (((await response.json()) as any).data?.list ?? []) as Record<string, any>[]
    expect(rows.length, '演示数据不齐，先跑 script/form-demo/demo2_task_tab.py').toBe(8)

    for (const row of rows) {
      for (const field of ['task_name', 'task_state', 'priority', 'owner_name',
        'plan_date', 'remark']) {
        expect(row[field], `演示数据[${row.task_name}]的 ${field} 是空的`).toBeTruthy()
      }
    }

    const byState = (state: string) => rows.filter((r) => r.task_state === state).length
    expect(byState('TODO')).toBe(4)
    expect(byState('DOING')).toBe(2)
    expect(byState('DONE')).toBe(2)
  })

  test('⚠️ 切页签真的筛数据，且「全部」页签由运行时自动补在最前面', async ({ page }) => {
    await login(page)
    await openDemo(page, TASK_TAB)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    const tabs = page.locator('.el-tabs__item:visible')
    // 配置里只写了三个页签，「全部」是运行时加的。
    // 按文案断言而不是按数量：el-tabs 会多渲染一个不可见的辅助节点，
    // 数个数会得到 5，但那一个并不是页签
    await expect
      .poll(async () => (await tabs.allInnerTexts()).map((t) => t.trim()), { timeout: 10_000 })
      .toEqual(['全部', '待办', '进行中', '已完成'])

    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(8)

    await tabs.filter({ hasText: '待办' }).click()
    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(4)

    await tabs.filter({ hasText: '进行中' }).click()
    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(2)

    // 切回「全部」要能恢复，而不是把上一个页签的条件留着
    await tabs.first().click()
    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(8)
  })

  test('页签条件与查询条件叠加，而不是互相覆盖', async ({ page }) => {
    await login(page)
    await openDemo(page, TASK_TAB)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    // 待办 4 条，其中优先级为「高」的是 2 条（安全扫描、上线演练）
    await page.locator('.el-tabs__item').filter({ hasText: '待办' }).click()
    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(4)

    const priority = page
      .locator('.el-form--inline .el-form-item')
      .filter({ hasText: '优先级' })
      .first()
    await priority.locator('.el-select').click()
    await page.locator('.el-select-dropdown__item').filter({ hasText: '高' }).first().click()

    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(2)
  })

  test('百分比列按库里存的小数换算，不是直接把小数印出来', async ({ page }) => {
    // 库里存 0.65 还是 65 两种约定都存在，选错会差 100 倍
    await login(page)
    await openDemo(page, TASK_TAB)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    const body = page.locator('.el-table__body-wrapper tbody')
    await expect(body).toContainText('65%')
    await expect(body).not.toContainText('0.65%')
  })
})

// =====================================================================
// 示例 3：列表行内编辑
// =====================================================================

const PRICE_INLINE = 'test_demo_price_inline'

/** 按商品名称定位到那一行 */
const priceRowOf = (page: Page, name: string) =>
  page.locator('.el-table__body-wrapper tbody tr').filter({ hasText: name }).first()

test.describe('示例 3 · 列表行内编辑', () => {
  test('演示数据齐全：八条，每条每个字段都有值', async ({ request }) => {
    const token = await apiLogin(request)
    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${PRICE_INLINE}/page`,
      { headers: authHeaders(token), data: { pageNo: 1, pageSize: 100, conditions: [] } }
    )
    const rows = (((await response.json()) as any).data?.list ?? []) as Record<string, any>[]
    expect(rows.length, '演示数据不齐，先跑 script/form-demo/demo3_price_inline.py').toBe(8)
    for (const row of rows) {
      for (const field of ['product_name', 'category', 'list_price', 'sale_price',
        'stock_qty', 'effect_date']) {
        expect(row[field], `演示数据[${row.product_name}]的 ${field} 是空的`).toBeTruthy()
      }
      // on_sale 有 0 值，不能用 toBeTruthy 判 —— 0 是有效值不是空
      expect(row.on_sale, `演示数据[${row.product_name}]的 on_sale 没有值`).not.toBeNull()
    }
  })

  test('⚠️ 就地改一行并保存，勾了「可编辑」的列才变成控件', async ({ page, request }) => {
    const token = await apiLogin(request)
    try {
      await login(page)
      await openDemo(page, PRICE_INLINE)
      await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

      const row = priceRowOf(page, '无线耳机')
      await row.getByRole('button', { name: '编辑' }).click()

      // 勾了的列变控件；商品名称没勾，仍是文本
      await expect(row.locator('.el-input-number'), '标价/售价/库存三列应变成数字框')
        .toHaveCount(3)
      await expect(row.locator('.el-select'), '分类列应变成下拉').toHaveCount(1)
      await expect(row.locator('.el-switch'), '上架列应变成开关').toHaveCount(1)
      await expect(row.locator('.el-date-editor'), '生效日期应变成日期控件').toHaveCount(1)
      await expect(row.locator('input[type="text"]').first()).toBeVisible()

      // 编辑态下只剩保存 / 取消
      await expect(row.getByRole('button', { name: '保存' })).toBeVisible()
      await expect(row.getByRole('button', { name: '编辑' })).toHaveCount(0)

      // 改售价：899 → 859
      const salePrice = row.locator('.el-input-number input').nth(1)
      await salePrice.fill('859')

      const updatePromise = page.waitForResponse(
        (r) => r.url().includes(`/${PRICE_INLINE}/update`) && r.request().method() === 'PUT'
      )
      await row.getByRole('button', { name: '保存' }).click()
      const response = await updatePromise

      // 整条记录回传：没配成列的字段也要带上，否则会被当成「清空」
      const sent = JSON.parse(response.request().postData() || '{}')
      expect(Number(sent.sale_price)).toBe(859)
      expect(sent.product_name, '没改过的字段也要带上').toBe('无线耳机')

      await expect(priceRowOf(page, '无线耳机')).toContainText('859.00', { timeout: 10_000 })
    } finally {
      // 把售价改回去，免得重复跑时数据漂移
      const list = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/${PRICE_INLINE}/page`,
        {
          headers: authHeaders(token),
          data: {
            pageNo: 1,
            pageSize: 100,
            conditions: [{ field: 'product_name', operator: 'EQ', value: '无线耳机' }]
          }
        }
      )
      const hit = (((await list.json()) as any).data?.list ?? [])[0]
      if (hit) {
        const detail = await request.get(
          `${API_BASE_URL}/infra/form-design/runtime/${PRICE_INLINE}/get?id=${hit.id}`,
          { headers: authHeaders(token) }
        )
        const full = ((await detail.json()) as any).data ?? {}
        await request.put(
          `${API_BASE_URL}/infra/form-design/runtime/${PRICE_INLINE}/update?id=${hit.id}`,
          { headers: authHeaders(token), data: { ...full, sale_price: 899 } }
        )
      }
    }
  })

  test('⚠️ 行内编辑走同一条提交流水线：售价高于标价会被拦住', async ({ page }) => {
    // 行内编辑不是「绕过校验的快捷通道」。这条跨字段校验配在表单上，
    // 弹窗编辑与行内编辑必须表现一致
    await login(page)
    await openDemo(page, PRICE_INLINE)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    const row = priceRowOf(page, '电饭煲')
    await row.getByRole('button', { name: '编辑' }).click()
    // 标价 599，把售价改成 699
    await row.locator('.el-input-number input').nth(1).fill('699')

    // 断言落在响应体上而不是那条提示消息上：ElMessage 几秒后会自己消失，
    // 按提示文案断言是在和它的存活时间赛跑
    const updatePromise = page.waitForResponse(
      (r) => r.url().includes(`/${PRICE_INLINE}/update`) && r.request().method() === 'PUT'
    )
    await row.getByRole('button', { name: '保存' }).click()
    const body = (await (await updatePromise).json()) as { code: number; msg: string }

    expect(body.code, '售价高于标价竟然存进去了').not.toBe(0)
    expect(body.msg).toContain('售价不得高于标价')

    // 校验失败不退出编辑态，用户刚填的内容不能丢
    await expect(row.getByRole('button', { name: '保存' })).toBeVisible()
  })
})

// =====================================================================
// 示例 4：列表左侧树
// =====================================================================

const STAFF_TREE = 'test_demo_staff_tree'

test.describe('示例 4 · 列表左侧树', () => {
  test('演示数据齐全：十条，每个末级区域都有人', async ({ request }) => {
    // 点到空区域时，看不出是「筛选生效了」还是「配错了」
    const token = await apiLogin(request)
    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/${STAFF_TREE}/page`,
      { headers: authHeaders(token), data: { pageNo: 1, pageSize: 100, conditions: [] } }
    )
    const rows = (((await response.json()) as any).data?.list ?? []) as Record<string, any>[]
    expect(rows.length, '演示数据不齐，先跑 script/form-demo/demo4_staff_tree.py').toBe(10)
    for (const row of rows) {
      for (const field of ['staff_name', 'staff_no', 'region', 'post_name',
        'mobile', 'entry_date']) {
        expect(row[field], `演示数据[${row.staff_name}]的 ${field} 是空的`).toBeTruthy()
      }
    }
    for (const region of ['SH', 'JS', 'ZJ', 'BJ', 'TJ', 'GD', 'GX']) {
      expect(rows.some((r) => r.region === region), `区域 ${region} 下面一个人都没有`).toBe(true)
    }
  })

  test('⚠️ 左侧树出得来，点节点真的按区域筛数据', async ({ page }) => {
    await login(page)
    await openDemo(page, STAFF_TREE)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    const tree = page.locator('.left-tree-panel')
    await expect(tree, '左侧树面板没渲染').toBeVisible()
    await expect(tree).toContainText('按区域浏览')

    // ⚠️ 字典是两层的，树也必须是两层：顶层只有「全部」与三个大区，
    // 省份是折叠在大区下面的。平铺渲染的话父子会并排成兄弟、顺序还是乱的
    const topNodes = tree.locator('.el-tree > .el-tree-node')
    await expect
      .poll(async () => (await topNodes.allInnerTexts()).map((t) => t.trim()), { timeout: 10_000 })
      .toEqual(['全部', '华东', '华北', '华南'])

    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(10)

    // 点大区「华东」：要连同下面的上海/江苏/浙江一起匹配，共 4 人。
    // 只按大区自身的值筛的话一条都查不到 —— 员工身上存的是省份
    await tree.getByText('华东', { exact: true }).click()
    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(4)

    // 展开华东，点「上海」——上海有 2 个人
    const east = tree.locator('.el-tree-node').filter({ hasText: '华东' }).first()
    await east.locator('.el-tree-node__expand-icon').first().click()
    await tree.getByText('上海', { exact: true }).click()
    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(2)

    const body = page.locator('.el-table__body-wrapper tbody')
    await expect(body).toContainText('张伟')
    await expect(body).toContainText('李娜')
    await expect(body).not.toContainText('周涛')
  })

  test('区域列按字典翻译成中文，而不是显示编码', async ({ page }) => {
    await login(page)
    await openDemo(page, STAFF_TREE)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    const body = page.locator('.el-table__body-wrapper tbody')
    await expect(body).toContainText('上海')
    await expect(body, '列表里不该出现字典编码').not.toContainText('SH')
  })
})

// =====================================================================
// 示例 5：跨表取数（关联表单）
// =====================================================================

const CUSTOMER = 'test_demo_customer'
const CONTRACT = 'test_demo_contract'

const pageRows = async (
  request: APIRequestContext,
  token: string,
  code: string
): Promise<Record<string, any>[]> => {
  const response = await request.post(
    `${API_BASE_URL}/infra/form-design/runtime/${code}/page`,
    { headers: authHeaders(token), data: { pageNo: 1, pageSize: 100, conditions: [] } }
  )
  return (((await response.json()) as any).data?.list ?? []) as Record<string, any>[]
}

test.describe('示例 5 · 跨表取数', () => {
  test('演示数据齐全：客户五条、合同四条，带出字段都有值', async ({ request }) => {
    const token = await apiLogin(request)

    const customers = await pageRows(request, token, CUSTOMER)
    expect(customers.length, '客户数据不齐，先跑 script/form-demo/demo5_relation.py').toBe(5)
    for (const row of customers) {
      for (const field of ['customer_name', 'customer_no', 'level',
        'contact_name', 'contact_phone', 'region']) {
        expect(row[field], `客户[${row.customer_name}]的 ${field} 是空的`).toBeTruthy()
      }
    }

    const contracts = await pageRows(request, token, CONTRACT)
    expect(contracts.length).toBe(4)
    for (const row of contracts) {
      for (const field of ['contract_no', 'customer_name', 'customer_level',
        'contact_name', 'contact_phone', 'sign_date', 'amount', 'bill_status']) {
        expect(row[field], `合同[${row.contract_no}]的 ${field} 是空的`).toBeTruthy()
      }
    }
  })

  test('⚠️ 带出值由服务端重读写入：前端没送这四个字段，库里照样有', async ({ request }) => {
    // 前端提交的带出值不可信（用户可能开着老页面，也可能直接改请求），
    // 所以服务端重读被关联记录并覆盖，而不是校验前端算得对不对
    const token = await apiLogin(request)
    const customers = await pageRows(request, token, CUSTOMER)
    const target = customers.find((c) => c.customer_no === 'K0005')
    expect(target, '缺少用于本条用例的客户 K0005').toBeTruthy()

    let createdId: string | undefined
    try {
      // 只送客户主键与合同自己的字段，四个带出字段一个都不送
      createdId = await createRow(request, token, CONTRACT, {
        customer_id: String(target!.id),
        sign_date: '2026-09-12',
        amount: 1234.56,
        bill_status: 'DRAFT'
      })

      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${CONTRACT}/get?id=${createdId}`,
        { headers: authHeaders(token) }
      )
      const saved = ((await detail.json()) as any).data ?? {}
      expect(saved.customer_name, '客户名称没有被带出来').toBe('中原物流有限公司')
      expect(saved.customer_level).toBe('B')
      expect(saved.contact_name).toBe('陈经理')
      expect(saved.contact_phone).toBe('13900000005')
    } finally {
      await deleteRow(request, token, CONTRACT, createdId)
    }
  })

  test('⚠️ 前端伪造的带出值会被服务端覆盖掉', async ({ request }) => {
    const token = await apiLogin(request)
    const customers = await pageRows(request, token, CUSTOMER)
    const target = customers.find((c) => c.customer_no === 'K0005')

    let createdId: string | undefined
    try {
      createdId = await createRow(request, token, CONTRACT, {
        customer_id: String(target!.id),
        // 绕过界面直接送一份假的带出值
        customer_name: '我瞎写的公司',
        customer_level: 'A',
        contact_name: '假联系人',
        contact_phone: '13000000000',
        sign_date: '2026-09-12',
        amount: 1.0,
        bill_status: 'DRAFT'
      })

      const detail = await request.get(
        `${API_BASE_URL}/infra/form-design/runtime/${CONTRACT}/get?id=${createdId}`,
        { headers: authHeaders(token) }
      )
      const saved = ((await detail.json()) as any).data ?? {}
      expect(saved.customer_name, '伪造的带出值竟然存进去了').toBe('中原物流有限公司')
      expect(saved.contact_phone).toBe('13900000005')
    } finally {
      await deleteRow(request, token, CONTRACT, createdId)
    }
  })

  test('合同列表把带出的等级渲染成标签，金额有合计行', async ({ page }) => {
    await login(page)
    await openDemo(page, CONTRACT)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    const body = page.locator('.el-table__body-wrapper tbody')
    await expect(body).toContainText('海通科技有限公司')
    await expect(body.locator('.el-tag').first()).toBeVisible()
    // 带出的等级按字典翻译，而不是显示 A / B / C
    await expect(body).toContainText('A 类（重点）')

    // 286000 + 1520000 + 96800 + 45300 = 1948100
    await expect(page.locator('.el-table__footer-wrapper')).toContainText('1948100.00', {
      timeout: 10_000
    })
  })
})

// =====================================================================
// 示例 6 / 7：数据接口取数
// =====================================================================

const API_WIDGET = 'test_demo_api_widget'
const API_PARAM = 'test_demo_api_param'

/**
 * 表单弹窗里按标签定位一个表单项
 *
 * ⚠️ 按 hasText 过滤整个表单项会把【占位提示】也算进去：
 * 「部门」那一项的占位写的是「先选部门，下面的人员选项跟着变」，
 * 于是找「人员」会先命中「部门」那一项 —— 表现为点开人员下拉却弹出部门选项。
 * 所以只拿标签元素来比，且要求完全相等。
 */
const dialogItemOf = (page: Page, label: string) =>
  page
    .locator('.el-dialog .el-form-item')
    .filter({ has: page.locator('.el-form-item__label', { hasText: new RegExp(`^${label}`) }) })
    .first()

test.describe('示例 6 · 控件调用数据接口', () => {
  test('演示数据齐全，公式列由服务端算出', async ({ request }) => {
    const token = await apiLogin(request)
    const rows = await pageRows(request, token, API_WIDGET)
    expect(rows.length, '演示数据不齐，先跑 script/form-demo/demo67_data_interface.py').toBe(3)
    for (const row of rows) {
      for (const field of ['apply_title', 'product_value', 'dept_value',
        'product_price', 'qty', 'total_amount']) {
        expect(row[field], `演示数据[${row.apply_title}]的 ${field} 是空的`).toBeTruthy()
      }
      expect(Number(row.total_amount), '金额合计不等于单价 × 数量')
        .toBeCloseTo(Number(row.product_price) * Number(row.qty), 2)
    }
  })

  test('⚠️ 下拉的选项真的从接口取回来了，不只是配置里写了一条接口编码', async ({ page }) => {
    // 「配了数据源但运行时没解析」是这一类功能最典型的失效方式：
    // 配置读得到、界面也渲染了下拉，就是一个选项都没有
    await login(page)
    await openDemo(page, API_WIDGET)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    await page.getByRole('button', { name: '新增' }).click()
    await expect(page.locator('.el-dialog')).toBeVisible({ timeout: 20_000 })

    await dialogItemOf(page, '商品').locator('.el-select').click()
    const options = page.locator('.el-select-dropdown__item:visible')
    await expect(options.first()).toBeVisible({ timeout: 10_000 })
    expect(await options.count(), '商品下拉一个选项都没有').toBeGreaterThanOrEqual(8)
    // labelField 配的是 ${label}（${price} 元）组合写法
    await expect(options.first()).toContainText('元')
  })
})

test.describe('示例 7 · 接口入参引用表单字段', () => {
  test('演示数据齐全，人员编码与所选部门对得上', async ({ request }) => {
    const token = await apiLogin(request)
    const rows = await pageRows(request, token, API_PARAM)
    expect(rows.length, '演示数据不齐，先跑 script/form-demo/demo67_data_interface.py').toBe(3)

    // 部门与人员的对应关系来自 test_demo_employee
    const belongs: Record<string, string[]> = {
      D01: ['E001', 'E002', 'E003'],
      D02: ['E004', 'E005'],
      D03: ['E006', 'E007'],
      D04: ['E008']
    }
    for (const row of rows) {
      for (const field of ['apply_title', 'dept_value', 'user_value',
        'apply_reason', 'apply_date']) {
        expect(row[field], `演示数据[${row.apply_title}]的 ${field} 是空的`).toBeTruthy()
      }
      expect(belongs[row.dept_value], `未知部门 ${row.dept_value}`).toBeTruthy()
      expect(belongs[row.dept_value]).toContain(row.user_value)
    }
  })

  test('⚠️ 换部门后人员选项跟着重取，而不是停在上一个部门的人', async ({ page }) => {
    await login(page)
    await openDemo(page, API_PARAM)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    await page.getByRole('button', { name: '新增' }).click()
    await expect(page.locator('.el-dialog')).toBeVisible({ timeout: 20_000 })

    const pickDept = async (name: string) => {
      await dialogItemOf(page, '部门').locator('.el-select').click()
      await page.locator('.el-select-dropdown__item:visible').filter({ hasText: name })
        .first().click()
    }
    const employeeOptions = async () => {
      await dialogItemOf(page, '人员').locator('.el-select').click()
      const options = page.locator('.el-select-dropdown__item:visible')
      await expect(options.first()).toBeVisible({ timeout: 10_000 })
      const texts = (await options.allInnerTexts()).map((t) => t.trim())
      await page.keyboard.press('Escape')
      return texts
    }

    // 研发部：张伟 / 李娜 / 王强
    await pickDept('研发部')
    const dev = await employeeOptions()
    expect(dev).toContain('张伟')
    expect(dev).not.toContain('刘洋')

    // 换成市场部：刘洋 / 陈静。停在上一批人是这类联动最常见的失效方式
    await pickDept('市场部')
    const market = await employeeOptions()
    expect(market, '换了部门，人员选项还停在上一个部门').not.toContain('张伟')
    expect(market).toContain('刘洋')
  })
})

// =====================================================================
// 示例 8 / 9 / 10：主子表、树形表格、销售订单
// =====================================================================

const REPORT = 'test_demo_report_header'
const CATEGORY = 'test_demo_category_tree'
const ORDER = 'test_demo_sales_order'

test.describe('示例 8 · 复杂表头（主子表）', () => {
  test('⚠️ 明细行的公式由服务端算出，而不是留空', async ({ request }) => {
    // 子表内部规则挂在 props.rule 下（不是 children），服务端的收集器原来
    // 只走 children —— 于是明细里的公式从不重算，前端提交什么就存什么
    const token = await apiLogin(request)
    const rows = await pageRows(request, token, REPORT)
    expect(rows.length, '演示数据不齐，先跑 script/form-demo/demo8910_master_detail.py')
      .toBeGreaterThan(0)

    let checked = 0
    for (const row of rows) {
      const items = (row.items ?? []) as Record<string, any>[]
      for (const item of items) {
        expect(item.item_amount, `明细[${item.item_name}]的金额没算出来`).toBeTruthy()
        expect(Number(item.item_amount))
          .toBeCloseTo(Number(item.item_qty) * Number(item.item_price), 2)
        checked++
      }
    }
    expect(checked, '一条明细都没查到，用例没有真的验到东西').toBeGreaterThan(0)
  })

  test('复杂表头分组渲染成两层表头，明细列把主记录摊平成多行', async ({ page }) => {
    await login(page)
    await openDemo(page, REPORT)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    const header = page.locator('.el-table__header-wrapper')
    for (const group of ['填报信息', '联系方式', '金额（元）', '费用明细']) {
      await expect(header, `分组表头[${group}]没渲染`).toContainText(group)
    }
    // 两层表头：分组一行、叶子列一行
    expect(await header.locator('tr').count()).toBeGreaterThanOrEqual(2)

    // 两条主记录、五条明细 → 摊平后是五行
    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(5)
  })
})

test.describe('示例 9 · 树形表格', () => {
  test('演示数据是三层结构', async ({ request }) => {
    const token = await apiLogin(request)
    const rows = await pageRows(request, token, CATEGORY)
    expect(rows.length, '演示数据不齐').toBe(17)
    // 只有两层的话，「展开后还能再展开」这条看不出来
    const tops = rows.filter((r) => Number(r.parent_id ?? 0) === 0)
    expect(tops.length).toBe(3)
  })

  test('⚠️ 列表建成树：顶层只有三个根，展开后才出现子节点', async ({ page }) => {
    await login(page)
    await openDemo(page, CATEGORY)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    // 树形与分页互斥，所以不该有分页条
    await expect(page.locator('.el-pagination')).toHaveCount(0)

    // 初始只显示三个顶层节点
    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(3)

    const body = page.locator('.el-table__body-wrapper tbody')
    await expect(body).toContainText('电子产品')
    // ⚠️ 按「看得见」断言而不是 toContainText：折叠的子行仍在 DOM 里，
    // textContent 照样含着它们的文字
    const visibleRow = (text: string) =>
      page.locator('.el-table__body-wrapper tbody tr:visible').filter({ hasText: text })
    await expect(visibleRow('智能手机'), '三级节点一开始不该显示').toHaveCount(0)

    // 展开第一个根 → 多出两个二级节点
    await body.locator('.el-table__expand-icon').first().click()
    await expect.poll(() => rowCount(page), { timeout: 10_000 }).toBe(5)
    await expect(visibleRow('手机').first()).toBeVisible()
    await expect(visibleRow('智能手机'), '还没展开二级，三级仍不该显示').toHaveCount(0)
  })
})

test.describe('示例 10 · 销售订单', () => {
  test('演示数据齐全：单号由模板生成、客户名带出、应付金额由公式算出', async ({ request }) => {
    const token = await apiLogin(request)
    const rows = await pageRows(request, token, ORDER)
    expect(rows.length, '演示数据不齐').toBe(3)

    for (const row of rows) {
      for (const field of ['order_no', 'customer_name', 'order_status', 'pay_type',
        'order_date', 'deliver_date', 'goods_amount', 'discount_rate',
        'pay_amount', 'receiver']) {
        expect(row[field], `订单[${row.order_no}]的 ${field} 是空的`).toBeTruthy()
      }
      expect(String(row.order_no), '单号应当由单据模板生成').toMatch(/^SO\d{8}\d{4}$/)
      expect(Number(row.pay_amount), '应付金额不等于货款 × 折扣率')
        .toBeCloseTo(Number(row.goods_amount) * Number(row.discount_rate), 2)
    }
  })

  test('列表：状态是标签、折扣率按百分比、两列有合计', async ({ page }) => {
    await login(page)
    await openDemo(page, ORDER)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    const body = page.locator('.el-table__body-wrapper tbody')
    await expect(body.locator('.el-tag').first()).toBeVisible()
    await expect(body).toContainText('已完成')
    // discount_rate 库里存 0.95，按百分比列显示成 95%
    await expect(body).toContainText('95%')
    await expect(page.locator('.el-table__footer-wrapper')).toBeVisible()
  })

  test('⚠️ 配了打印模板才有「打印」按钮，点开能出内容', async ({ page }) => {
    // 打印走 iframe.contentWindow.print()。headless 下它本身是空操作，
    // 但盖掉更稳 —— 哪天有人加 --headed 跑一次，一个卡住的打印对话框
    // 会让整组用例超时，而失败原因完全指不到这里
    await page.addInitScript(() => {
      window.print = () => {}
    })
    await login(page)
    await openDemo(page, ORDER)
    await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })

    const firstRow = page.locator('.el-table__body-wrapper tbody tr').first()
    await expect(firstRow.getByRole('button', { name: '打印' })).toBeVisible()
    //
    // ⚠️ 「变更记录」现在在「更多」下拉里，不在行上直接摆着
    //
    // 这张示例的行按钮有五个（编辑/详情/打印/变更记录/删除），超过了操作列的
    // 折叠阈值，多出来的两个收进了下拉。折叠是配置项（列表设计 →
    // 按钮设置 → 按钮折叠阈值），不是这条用例要测的东西 ——
    // 这里只确认它**还在**、点得到，落在哪一层由那项配置决定。
    //
    await firstRow.locator('.el-dropdown').first().click()
    await expect(
      page.locator('.el-dropdown-menu:visible', { hasText: '变更记录' }).first()
    ).toBeVisible()
    await page.keyboard.press('Escape')

    await firstRow.getByRole('button', { name: '打印' }).click()

    // 先断言 srcdoc：printHtml 是把整份文档写进隐藏 iframe 的 srcdoc 的
    const srcdoc = page.locator('iframe[aria-hidden="true"]').first()
    await expect(srcdoc).toHaveAttribute('srcdoc', /销 售 订 单/, { timeout: 15_000 })
    const doc = (await srcdoc.getAttribute('srcdoc')) ?? ''
    expect(doc, '占位符应当换成这条记录的订单号').toMatch(/SO\d{12}/)
    expect(doc, '模板里的占位符不该原样留着').not.toContain('{order_no}')

    // ⚠️ srcdoc 属性对不等于文档真的渲染出来了，所以再落一条断言在 iframe 内部
    const frame = page.frameLocator('iframe[aria-hidden="true"]').first()
    await expect(frame.locator('body'), '打印文档必须真的渲染出来').toContainText('应付金额', {
      timeout: 15_000
    })
  })
})
