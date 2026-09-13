import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 表格示例（G01–G12）的端到端验证
 *
 * 验的是【基础设施 → 开发示例 → 在线开发】下面那批「表格示例」在界面上**真的长成
 * 配的那个样子**。这一层不能省：本模块最常见的缺陷形态是「配了、保存成功了、
 * 但没生效，且没有任何提示」—— 单测全绿、发布成功、接口冒烟通过，三者都拦不住它。
 *
 * ## 断言的是 DOM 事实，不是截图
 *
 * 合并单元格读 `rowspan` 属性、分组表头数 `thead` 的行数、合计行读 `tfoot` 的文本。
 * 截图比对在这里没用：表格的像素会随主题、字体、浏览器版本变，而「这一格跨了 3 行」
 * 是个确定的事实。
 *
 * ## 前置条件
 *
 * 示例已由 `script/form-demo/demo_grid_*.py` 建好并发布，
 * 演示数据由 `demo_grid_data.py` 灌好（60 条项目台账）。
 * 用例**只读**，不造也不删业务数据 —— 十二个示例共用同一批数据，
 * 任何一个用例删了数据，其余用例的合计与分组数都会跟着变。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 演示数据的规模，由 demo_grid_data.py 固定产出。变了这里也要跟着变 */
const TOTAL_PROJECTS = 60

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

/**
 * 打开示例的运行时页并等表格出来
 *
 * 走静态预览路由，不走发布生成的菜单路由 —— 新菜单要分配给角色、再重新登录
 * 才会注册动态路由，在用例里改角色菜单分配的风险远大于收益。
 */
async function openGrid(page: Page, code: string) {
  await page.goto(`/infra-form-design/preview?code=${code}`)
  await expect(page.locator('.el-table').first()).toBeVisible({ timeout: 60_000 })
  // 表格容器可见 ≠ 数据回来了。等到 tbody 里真的有行，否则后面的断言
  // 会在空表上跑，报错指向「找不到元素」而不是「数据没回来」
  await expect(page.locator('.el-table__body-wrapper tbody tr').first()).toBeVisible({
    timeout: 30_000
  })
}

/** 表体。固定列会让 el-table 渲染出多份 tbody，只取主表体那一份 */
const bodyRows = (page: Page) =>
  page.locator('.el-table__body-wrapper').first().locator('tbody tr')

/** 表头行。分组表头会是两行 */
const headerRows = (page: Page) =>
  page.locator('.el-table__header-wrapper').first().locator('thead tr')

/**
 * 表格真正的横向滚动容器
 *
 * ⚠️ 不是 `.el-table__body-wrapper` —— 它的 scrollWidth 与 clientWidth 恒等
 * （本例实测都是 1018），拿它判溢出永远是 false、拿它滚动永远不动。
 * 真正滚动的是它里面那层 el-scrollbar 的 wrap（实测 scrollWidth 4054）。
 *
 * 这个坑的杀伤力在于「滚动」那条用例会**空跑通过**：滚了个不会动的元素，
 * 固定列自然也没动，断言于是成立。第一版就是这么写的，直到旁边那条
 * 判溢出的用例失败才暴露出来。
 */
const scrollWrap = (page: Page) =>
  page.locator('.el-table__body-wrapper .el-scrollbar__wrap').first()

// =====================================================================
// G01 表格基础与列格式化
// =====================================================================

test.describe('G01 · 表格基础与列格式化', () => {
  test('十一种格式化各自渲染成该有的样子', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_basic')

    const body = page.locator('.el-table__body-wrapper').first()

    // 字典翻译：库里存 SOFT，列上要显示中文
    await expect(body, '字典列没翻译，显示的还是编码').toContainText('软件开发')

    // 标签：渲染成 el-tag 元素，且印的是字典中文而不是编码
    await expect(body.locator('.el-tag').first()).toBeVisible()

    // 千分位 + 两位小数。预算金额是 120000 起步、步长 38000，
    // 第一条一定含千分位分隔符
    await expect(body, '金额列没走千分位').toContainText(/\d,\d{3}/)

    // 百分比：库里存 0.xxxx，列上要带 %
    await expect(body, '百分比列没有 % 号').toContainText('%')

    // 布尔：库里 0/1，列上显示 是/否
    await expect(body).toContainText(/是|否/)

    // 超链接渲染成可点的 a 标签
    await expect(body.locator('a.el-link').first()).toHaveAttribute(
      'href',
      /example\.com\/project/
    )

    // 日期与日期时间是两种格式化：后者要带时分秒
    await expect(body, '日期时间列没带时分秒').toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)

    // 空值统一显示占位符（演示数据里每 5 条留一条空备注）
    await expect(body, '空值没有显示占位符').toContainText('-')
  })

  test('序号列跨页连续，不是每页从 1 数起', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_basic')

    // 第一页第一行是 1
    await expect(bodyRows(page).first().locator('td').first()).toHaveText('1')

    await page.locator('.el-pagination').getByLabel('下一页', { exact: false }).click()
    await expect(bodyRows(page).first().locator('td').first()).toHaveText('21', {
      timeout: 15_000
    })
  })

  test('分页总数与演示数据一致', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_basic')
    await expect(page.locator('.el-pagination')).toContainText(String(TOTAL_PROJECTS))
  })
})

// =====================================================================
// G02 冻结列与宽表
// =====================================================================

test.describe('G02 · 冻结列与宽表', () => {
  test('左右两头各有固定列，且表格确实横向溢出', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_wide')

    // Element Plus 5 把固定列做成列上的类，不再单独渲染一层 .el-table__fixed。
    // 两种实现都认，只断言「左右各有固定列」这个事实，不绑某一个版本的类名
    const leftFixed = await page
      .locator('.el-table-fixed-column--left, .el-table__fixed')
      .count()
    expect(leftFixed, '左固定列没生效').toBeGreaterThan(0)

    const rightFixed = await page
      .locator('.el-table-fixed-column--right, .el-table__fixed-right')
      .count()
    expect(rightFixed, '右固定的操作列没生效').toBeGreaterThan(0)

    // 宽表的意义在于装不下。装得下的话固定列就没有任何可演示的
    const overflow = await scrollWrap(page).evaluate(
      (el) => el.scrollWidth > el.clientWidth + 10
    )
    expect(overflow, '表格没有横向溢出，固定列演示不出价值').toBeTruthy()
  })

  test('横向滚到最右边，左固定列仍然停在原处', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_wide')

    const wrap = scrollWrap(page)
    const before = await bodyRows(page).first().locator('td').first().boundingBox()

    await wrap.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    await page.waitForTimeout(300)
    // 先确认真的滚动了 —— 没滚动的话下面那条断言会空跑通过
    const scrolled = await wrap.evaluate((el) => el.scrollLeft)
    expect(scrolled, '压根没滚起来，固定列的断言会空跑').toBeGreaterThan(100)

    const after = await bodyRows(page).first().locator('td').first().boundingBox()
    expect(before, '取不到滚动前的位置').not.toBeNull()
    expect(after, '取不到滚动后的位置').not.toBeNull()
    expect(
      Math.abs((after!.x ?? 0) - (before!.x ?? 0)),
      '左固定列跟着横滚跑了，等于没固定'
    ).toBeLessThan(5)
  })
})

// =====================================================================
// G03 多级分组表头
// =====================================================================

test.describe('G03 · 多级分组表头', () => {
  test('表头是两行，五个分组名都在第一行', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_header')

    await expect(headerRows(page), '分组表头没生效，表头还是一行').toHaveCount(2)

    const first = headerRows(page).first()
    for (const group of ['分类信息', '客户与团队', '时间节点', '金额（元）与比率', '标记与联系方式']) {
      await expect(first, `分组[${group}]没出现在第一行表头`).toContainText(group)
    }
  })

  test('分组下的子列在第二行，且 colspan 与成员数对得上', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_header')

    // 「时间节点」组配了三列
    const cell = headerRows(page).first().locator('th').filter({ hasText: '时间节点' }).first()
    await expect(cell).toHaveAttribute('colspan', '3')

    await expect(headerRows(page).nth(1)).toContainText('开始日期')
    await expect(headerRows(page).nth(1)).toContainText('计划完工')
    await expect(headerRows(page).nth(1)).toContainText('交付时间')
  })
})

// =====================================================================
// G04 合计行与明细合计
// =====================================================================

test.describe('G04 · 合计行与明细合计', () => {
  test('合计行跟随各列自己的格式化，而不是一律两位小数', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_summary')

    const footer = page.locator('.el-table__footer-wrapper').first()
    await expect(footer, '合计行没出来').toBeVisible()
    await expect(footer).toContainText('合计')

    const text = (await footer.innerText()).replace(/\s+/g, ' ')

    // 金额列配的是「两位小数 + 千分位」
    expect(text, `合计行里没有千分位格式的金额：${text}`).toMatch(/\d{1,3}(,\d{3})+\.\d{2}/)

    // 团队人数配的是「0 位小数」。修复前这里会是 xxx.00 —— 同一行上
    // 一个数两位小数、一个数零位小数，正是这条修复要的效果
    expect(text, `团队人数的合计带了小数，说明合计行没跟随列格式化：${text}`).toMatch(
      /(^|[^\d.])\d{3}([^\d.]|$)/
    )
  })

  test('没配进合计的百分比列显示占位符，而不是一个错的数', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_summary')
    // 百分比相加得不到百分比，所以毛利率列刻意没配进 summaryColumns
    await expect(page.locator('.el-table__footer-wrapper').first()).toContainText('-')
  })

  test('明细列的合计按明细行累加，与主表列不是一个口径', async ({ page, request }) => {
    const token = await apiLogin(request)
    // 从接口直接算一遍期望值：明细合计 = 全部明细行的金额之和，
    // 而不是「主记录数 × 某个值」。两种口径算出来的数差得很远，
    // 写死一个数在这里反而看不出是哪种口径
    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/test_demo_grid_summary/page`,
      {
        headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID },
        data: { pageNo: 1, pageSize: 10, conditions: [], sortField: 'project_code', sortOrder: 'asc' }
      }
    )
    const rows = (await response.json()).data.list as any[]
    const expected = rows
      .flatMap((row) => row.costs ?? [])
      .reduce((sum: number, item: any) => sum + Number(item.cost_amount), 0)
    expect(expected, '演示数据里这一页没有费用明细，断言失去意义').toBeGreaterThan(0)

    await login(page)
    await openGrid(page, 'test_demo_grid_summary')
    const footer = page.locator('.el-table__footer-wrapper').first()
    const formatted = expected.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
    await expect(footer, '明细列的合计对不上').toContainText(formatted)
  })
})

// =====================================================================
// G05 主子表展开与跨行合并
// =====================================================================

test.describe('G05 · 主子表展开与跨行合并', () => {
  test('一条主记录摊平成多行，主表列纵向合并成一格', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_expand')

    // 每页 10 条主记录，展开后行数一定多于 10 —— 不多于就是没展开
    const rowCount = await bodyRows(page).count()
    expect(rowCount, `展开没生效，行数还是 ${rowCount}`).toBeGreaterThan(10)

    // 主表列真的跨行了：找出第一个 rowspan > 1 的单元格
    const spans = await page
      .locator('.el-table__body-wrapper')
      .first()
      .locator('tbody td[rowspan]')
      .evaluateAll((cells) => cells.map((c) => Number(c.getAttribute('rowspan'))))
    expect(
      spans.some((n) => n > 1),
      '一个跨行合并的单元格都没有，主表列没合并'
    ).toBeTruthy()
  })

  test('明细列逐行独立，不参与合并', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_expand')

    // 里程碑名称是明细列，同一条主记录下的多行应该显示不同的里程碑，
    // 而不是被合并成一格
    const body = page.locator('.el-table__body-wrapper').first()
    await expect(body).toContainText('需求确认')
    await expect(body).toContainText('方案评审')
  })

  test('没有明细的主记录仍占一行，不会整条消失', async ({ page, request }) => {
    const token = await apiLogin(request)
    // 演示数据里每 23 条留一条没有任何明细的项目
    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/test_demo_grid_expand/page`,
      {
        headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID },
        data: { pageNo: 1, pageSize: 100, conditions: [], sortField: 'project_code', sortOrder: 'asc' }
      }
    )
    const rows = (await response.json()).data.list as any[]
    const empty = rows.find((r) => (r.milestones ?? []).length === 0 && (r.costs ?? []).length === 0)
    expect(empty, '演示数据里没有「无明细」的项目，这条断言失去意义').toBeTruthy()

    await login(page)
    await openGrid(page, 'test_demo_grid_expand')
    // 它在第一页（按编号排序，XM2026023 落在前 10 条之后）——
    // 用查询区把它筛出来，避免依赖它恰好在第几页
    await page.locator('.el-form--inline input').first().fill(empty.project_name)
    await page.getByRole('button', { name: '搜索' }).click()
    await expect(
      page.locator('.el-table__body-wrapper').first(),
      '没有明细的主记录从列表里消失了'
    ).toContainText(empty.project_name, { timeout: 15_000 })
  })

  test('明细展开时不出现多选框：勾一行的语义不明确', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_expand')
    await expect(
      page.locator('.el-table__body-wrapper').first().locator('.el-checkbox')
    ).toHaveCount(0)
  })
})

// =====================================================================
// G06 同值单元格合并
// =====================================================================

/** 读出表体里所有带 rowspan 的单元格，按「第几列 → rowspan」归类 */
async function rowspanByColumn(page: Page): Promise<Record<number, number[]>> {
  return page
    .locator('.el-table__body-wrapper')
    .first()
    .locator('tbody tr')
    .evaluateAll((rows) => {
      const result: Record<number, number[]> = {}
      rows.forEach((tr) => {
        Array.from(tr.querySelectorAll('td')).forEach((td) => {
          // cellIndex 在有合并时会错位，改用 el-table 写在 class 上的列序
          const match = /el-table_\d+_column_(\d+)/.exec(td.className)
          if (!match) return
          const col = Number(match[1])
          const span = Number(td.getAttribute('rowspan') || 1)
          ;(result[col] ||= []).push(span)
        })
      })
      return result
    })
}

/**
 * 还原指定几列的合并块：每块是 `{ 起始行号, 跨几行 }`
 *
 * ⚠️ 定位列靠 el-table 写在 td 上的 `el-table_N_column_M` 类，不靠 cellIndex ——
 * 被合并吃掉的格子根本不在 DOM 里，同一列在不同行上的 cellIndex 是错位的。
 *
 * @param dataColumnIndexes 数据列的序号，0 起。序号列排在前面但它也算一列，
 *                          所以这里传的是「按 class 上的列序排完之后的下标」
 */
async function mergeBlocks(
  page: Page,
  dataColumnIndexes: number[]
): Promise<Array<Array<{ start: number; span: number }>>> {
  return page
    .locator('.el-table__body-wrapper')
    .first()
    .evaluate((wrapper, indexes: number[]) => {
      const rows = Array.from(wrapper.querySelectorAll('tbody tr'))
      const orders = new Set<number>()
      rows.forEach((tr) =>
        tr.querySelectorAll('td').forEach((td) => {
          const m = /el-table_\d+_column_(\d+)/.exec(td.className)
          if (m) orders.add(Number(m[1]))
        })
      )
      const sorted = [...orders].sort((a, b) => a - b)

      return indexes.map((idx) => {
        const order = sorted[idx]
        const out: Array<{ start: number; span: number }> = []
        rows.forEach((tr, i) => {
          const td = Array.from(tr.querySelectorAll('td')).find((c) =>
            c.className.includes(`column_${order}`)
          )
          if (td) out.push({ start: i, span: Number(td.getAttribute('rowspan') || 1) })
        })
        return out
      })
    }, dataColumnIndexes)
}

test.describe('G06 · 同值单元格合并', () => {
  test('开了合并的列真的跨行，没开的列逐行独立', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_merge')

    const byColumn = await rowspanByColumn(page)
    const columns = Object.values(byColumn)
    expect(columns.length, '一列都没读到，选择器失效了').toBeGreaterThan(5)

    const merged = columns.filter((spans) => spans.some((n) => n > 1))
    expect(merged.length, '没有任何一列发生合并，同值合并没生效').toBeGreaterThanOrEqual(3)

    const plain = columns.filter((spans) => spans.every((n) => n === 1))
    expect(plain.length, '所有列都合并了，对照列没起作用').toBeGreaterThan(0)
  })

  test('级联：阶段列的合并块不会跨过类型列的边界', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_merge')

    // ⚠️ 必须翻到第 2 页
    //
    // 能证伪级联的边界只有一处：「咨询 | 运维期 | 孙磊」紧挨着
    // 「运维 | 运维期 | 孙磊」—— 类型换了、阶段与负责人都没换。
    // 按 sort_key 排序后它落在第 38/39 与 40 行之间，每页 30 条时在第 2 页。
    //
    // 第一页上每个类型交界处的阶段都是「运维期 → 立项」，本来就不同，
    // 级联写对写错长得一模一样 —— 在第一页上跑这条用例会**空跑通过**。
    // （这是实测出来的：把 cellMerge 的级联判断去掉，第一页的断言照样通过。）
    await page.locator('.el-pagination').getByLabel('下一页', { exact: false }).click()
    await expect(page.locator('.el-table__body-wrapper').first()).toContainText('运维服务', {
      timeout: 15_000
    })

    const [type, phase, owner] = await mergeBlocks(page, [1, 2, 3])

    // 先确认这一页真的合并出了东西 —— 跨度全是 1 的话，下面的包含关系
    // 自动成立，这条用例就成了空跑
    expect(
      type.filter((b) => b.span > 1).length,
      '类型列没有任何跨行块，包含关系断言会空跑'
    ).toBeGreaterThan(0)
    expect(
      phase.filter((b) => b.span > 1).length,
      '阶段列没有任何跨行块，包含关系断言会空跑'
    ).toBeGreaterThan(0)

    // 每个「阶段」「负责人」合并块都必须完整落在某个「类型」合并块之内。
    // 不级联的话，边界处那两段会粘成一格跨过类型边界 ——
    // 单元格边界是齐的，语义是错的
    for (const [name, blocks] of [
      ['阶段', phase],
      ['负责人', owner]
    ] as const) {
      for (const block of blocks) {
        const owning = type.find(
          (t) => block.start >= t.start && block.start + block.span <= t.start + t.span
        )
        expect(
          owning,
          `${name}的合并块 [${block.start}, ${block.start + block.span}) 跨过了类型列的边界 —— ` +
            '级联合并没生效'
        ).toBeTruthy()
      }
    }
  })

  test('操作列不参与合并：每条记录都得有自己的一组按钮', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_merge')

    const rowCount = await bodyRows(page).count()
    // 合并的一段里是若干条**不同的记录**。操作列跟着合并的话，
    // 那一组按钮只能作用于段首那条，其余记录再也删不掉、改不了
    const editButtons = await page
      .locator('.el-table__body-wrapper')
      .first()
      .getByRole('button', { name: '编辑' })
      .count()
    expect(editButtons, `行数 ${rowCount}，编辑按钮只有 ${editButtons} 个`).toBe(rowCount)
  })

  test('空值不合并，各自成一格', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_merge')

    // 风险等级列每 11 条留一条空。空值一律 rowspan=1 —— 连续空值并成一个
    // 跨十几行的 `-` 大格，看着像渲染坏了
    const emptyCellSpans = await page
      .locator('.el-table__body-wrapper')
      .first()
      .locator('tbody td')
      .evaluateAll((cells) =>
        cells
          .filter((td) => (td.textContent || '').trim() === '-')
          .map((td) => Number(td.getAttribute('rowspan') || 1))
      )
    expect(emptyCellSpans.length, '这一页没有空值单元格，断言失去意义').toBeGreaterThan(0)
    expect(
      emptyCellSpans.every((n) => n === 1),
      `有空值单元格被合并了：${emptyCellSpans.join(',')}`
    ).toBeTruthy()
  })
})

/**
 * 按编码找表单编号
 *
 * ⚠️ 必须翻页找，不能一次要一大页：分页接口的 pageSize 有上限（100），
 * 超过会返回 data=null 而不是报错。开发环境里的表单数早就过百了。
 */
async function findDesignId(
  request: APIRequestContext,
  token: string,
  code: string
): Promise<number> {
  for (let pageNo = 1; pageNo <= 60; pageNo++) {
    const res = await request.get(
      `${API_BASE_URL}/infra/form-design/page?pageNo=${pageNo}&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID } }
    )
    const rows = ((await res.json()).data?.list ?? []) as any[]
    const hit = rows.find((r) => r.code === code)
    if (hit) return hit.id
    if (rows.length < 100) break
  }
  throw new Error(`找不到编码为 ${code} 的表单，示例没建好`)
}

/** 打开设计器并切到「列表设计」这一步 */
async function openListDesign(page: Page, id: number) {
  await page.goto(`/infra/form-design/editor?id=${id}`)
  await page.locator('.cursor-pointer').filter({ hasText: '列表设计' }).first().click()
}

test.describe('G06 · 设计器侧', () => {
  test('「同值合并」开关在列配置里出得来，且已配的值回显得对', async ({ page, request }) => {
    const token = await apiLogin(request)
    const id = await findDesignId(request, token, 'test_demo_grid_merge')

    await login(page)
    await openListDesign(page, id)

    // ⚠️ 不能用 `.el-table` 的第一个
    //
    // 设计器的各步是 v-show 切换的，前几步的 DOM 一直都在 ——
    // `.el-table` 的第一个永远是「数据绑定」那一步的审计列表格，
    // 不管当前停在哪一步。第一版就是这么写的，报错说「列配置里没有同值合并」，
    // 而实际上找的压根不是列配置那张表。
    //
    // 用列配置表独有的表头「宽度类型」把它挑出来。
    const columnTable = page.locator('.el-table').filter({ hasText: '宽度类型' }).first()
    await expect(columnTable, '没切到列表设计这一步').toBeVisible({ timeout: 30_000 })

    // 开关这一列必须真的渲染出来 —— 配置项加了、界面上没有，等于用户配不了
    await expect(columnTable, '列配置里没有「同值合并」这一列').toContainText('同值合并')

    // 回显：脚本里给前四列配了 mergeSame，界面上要能看出来
    await expect(
      page.locator('.form-tip').filter({ hasText: '已开启同值合并' }),
      '合并列的提示没出来，说明配置没回显'
    ).toContainText('项目类型 → 项目阶段 → 负责人')
  })
})

// =====================================================================
// G07 行分组与分组小计
// =====================================================================

/**
 * 看得见的行数
 *
 * ⚠️ 树形下必须用它，不能数 `tbody tr` —— el-table 把折叠的子行留在 DOM 里，
 * 只是 display:none。数 tr 得到的是全部节点数，看起来像树根本没建起来。
 */
const visibleRowCount = (page: Page) =>
  page.locator('.el-table__body-wrapper').first().locator('tbody tr:visible').count()

/** 按文字找看得见的行。同理不能用 toContainText —— 折叠行的文字也在 DOM 里 */
const visibleRow = (page: Page, text: string) =>
  page
    .locator('.el-table__body-wrapper')
    .first()
    .locator('tbody tr:visible')
    .filter({ hasText: text })

/** 分组行的定位器 */
const groupRows = (page: Page) =>
  page.locator('.el-table__body-wrapper').first().locator('tbody tr.grid-group-tr')

test.describe('G07 · 行分组与分组小计', () => {
  test('每组前插一行分组行，横跨整张表并带条数与小计', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_group')

    // 演示数据里项目类型有五种，第一页（30 条）至少覆盖到前几种
    const count = await groupRows(page).count()
    expect(count, '一个分组行都没有，行分组没生效').toBeGreaterThan(1)

    const first = groupRows(page).first()
    // 组名走的是列的格式化，印的是字典中文而不是编码
    await expect(first, '分组行上印的是字典编码，没走列格式化').not.toContainText('SOFT')
    await expect(first).toContainText(/软件开发|系统集成|咨询服务|运维服务|硬件供货/)
    // 条数
    await expect(first, '分组行上没有条数').toContainText(/（\d+ 条）/)
    // 小计，且跟着列的格式化走千分位
    await expect(first, '分组行上没有小计').toContainText('预算金额')
    await expect(first).toContainText(/\d{1,3}(,\d{3})+\.\d{2}/)

    // 整行合成一格：分组行里只有一个 td
    await expect(first.locator('td'), '分组行没有横跨整张表').toHaveCount(1)
  })

  test('分组行上不放任何按钮 —— 它不是一条记录', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_group')
    await expect(groupRows(page).first().locator('button')).toHaveCount(0)
  })

  test('点分组行折叠，该组的数据行消失、分组行与小计还在', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_group')

    const before = await bodyRows(page).count()
    const firstGroup = groupRows(page).first()
    const label = (await firstGroup.innerText()).replace(/\s+/g, ' ')
    // 「（N 条）」里的 N 就是该组在本页的数据行数
    const matched = /（(\d+) 条）/.exec(label)
    expect(matched, `分组行上读不到条数：${label}`).toBeTruthy()
    const groupSize = Number(matched![1])

    await firstGroup.click()
    await expect(bodyRows(page)).toHaveCount(before - groupSize, { timeout: 10_000 })
    // 折起来之后条数与小计仍要在，否则折叠等于把这组的信息一起藏了
    await expect(groupRows(page).first()).toContainText(`（${groupSize} 条）`)

    // 再点一次展开，回到原样
    await groupRows(page).first().click()
    await expect(bodyRows(page)).toHaveCount(before, { timeout: 10_000 })
  })

  test('分组不依赖排序：本示例按编号排序，同类型的行并不相邻', async ({ page, request }) => {
    const token = await apiLogin(request)
    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/test_demo_grid_group/page`,
      {
        headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID },
        data: {
          pageNo: 1,
          pageSize: 30,
          conditions: [],
          sortField: 'project_code',
          sortOrder: 'asc'
        }
      }
    )
    const rows = (await response.json()).data.list as any[]
    // 先确认数据确实是「同类型不相邻」的，否则这条用例证明不了什么
    const switches = rows.filter(
      (row, i) => i > 0 && row.project_type !== rows[i - 1].project_type
    ).length
    const distinct = new Set(rows.map((r) => r.project_type)).size
    expect(
      switches,
      `本页类型切换 ${switches} 次、共 ${distinct} 种 —— 同类型的行是相邻的，证明不了分组独立于排序`
    ).toBeGreaterThan(distinct)

    await login(page)
    await openGrid(page, 'test_demo_grid_group')
    // 分组数应当等于去重后的类型数，而不是「类型切换的次数」
    await expect(groupRows(page)).toHaveCount(distinct)
  })

  test('分组小计与底部合计行并存，且口径不同', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_group')

    const footer = page.locator('.el-table__footer-wrapper').first()
    await expect(footer, '底部合计行不见了').toBeVisible()

    // 各组小计之和应当等于底部合计。两者口径不同（组内 / 全页），
    // 但加起来必须对得上 —— 对不上说明有一组被漏算或重复算了
    const groupSums = await groupRows(page).evaluateAll((rows) =>
      rows.map((tr) => {
        const text = (tr.textContent || '').replace(/\s+/g, ' ')
        const m = /预算金额：([\d,]+\.\d{2})/.exec(text)
        return m ? Number(m[1].replace(/,/g, '')) : 0
      })
    )
    expect(groupSums.length).toBeGreaterThan(1)
    const total = groupSums.reduce((a, b) => a + b, 0)

    const footerText = (await footer.innerText()).replace(/\s+/g, ' ')
    const expected = total.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
    expect(
      footerText,
      `各组小计之和 ${expected} 与底部合计对不上：${footerText}`
    ).toContain(expected)
  })
})

test.describe('G07 · 设计器侧', () => {
  test('「行分组」区块在高级页签里配得出来，且已配的值回显得对', async ({ page, request }) => {
    const token = await apiLogin(request)
    const id = await findDesignId(request, token, 'test_demo_grid_group')

    await login(page)
    await openListDesign(page, id)
    await page.getByRole('tab', { name: '高级' }).click()

    const panel = page.locator('.config-form').filter({ hasText: '启用行分组' }).first()
    await expect(panel, '高级页签里没有「行分组」这一块').toBeVisible({ timeout: 30_000 })

    // 回显：脚本里配了按项目类型分组 + 两列小计
    await expect(panel, '分组字段没回显').toContainText('项目类型')
    await expect(panel.locator('.el-select').last(), '组内小计没回显').toContainText('预算金额')
  })

  test('⚠️ 回归：列表设计这一步能正常打开', async ({ page, request }) => {
    // 加行分组时踩过一次：`watch(mergeSameAvailable)` 在 setup 阶段求值，
    // 撞上声明在后面的 rowGroup 的暂时性死区，抛 ReferenceError ——
    // 整个设计器页白屏，而报错完全指不到「行分组」上。
    // 这条用例专门钉住「这一步打得开」，它比任何单项断言都先失败。
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    const token = await apiLogin(request)
    const id = await findDesignId(request, token, 'test_demo_grid_group')

    await login(page)
    await openListDesign(page, id)
    await expect(page.locator('.el-table').filter({ hasText: '宽度类型' }).first()).toBeVisible({
      timeout: 30_000
    })
    expect(errors, `设计器页抛了未捕获异常：${errors.join('；')}`).toHaveLength(0)
  })
})

// =====================================================================
// G08 树形台账（WBS）
// =====================================================================

test.describe('G08 · 树形台账', () => {
  test('顶层只有三个根，逐层展开才出现下一层', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_tree')

    // ⚠️ 必须按【看得见的行】数，不能数 tbody tr
    //
    // el-table 的树形把折叠的子行留在 DOM 里，只是 display:none ——
    // 数 tbody tr 会得到全部 22 行，看起来像「树根本没建起来」。
    // 同理 toContainText 也不能用：折叠行的 textContent 照样在。
    await expect.poll(() => visibleRowCount(page), { timeout: 10_000 }).toBe(3)
    await expect(visibleRow(page, '需求与设计')).toHaveCount(1)
    await expect(visibleRow(page, '业务调研'), '二级节点一开始不该显示').toHaveCount(0)

    // 展开第一个根 → 多出两个二级节点
    await bodyRows(page).first().locator('.el-table__expand-icon').click()
    await expect.poll(() => visibleRowCount(page), { timeout: 10_000 }).toBe(5)
    await expect(visibleRow(page, '业务调研').first()).toBeVisible()
    // 四层结构：二级刚展开时三级仍不该露出来
    await expect(visibleRow(page, '现场访谈'), '还没展开二级，三级仍不该显示').toHaveCount(0)

    // 再展开一层
    await visibleRow(page, '业务调研').first().locator('.el-table__expand-icon').click()
    await expect(visibleRow(page, '现场访谈').first()).toBeVisible({ timeout: 10_000 })
  })

  test('树形下不出现分页器，否则子行会被翻页截掉', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_tree')
    // 分页按行数截断，会把父行留在上一页、子行推到下一页 ——
    // 子行找不到父节点就整个从树里消失
    await expect(page.locator('.el-pagination')).toHaveCount(0)
  })

  test('树形与合计并用：合计是全部节点求和', async ({ page, request }) => {
    const token = await apiLogin(request)
    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/test_demo_grid_tree/page`,
      {
        headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID },
        data: { pageNo: 1, pageSize: 100, conditions: [] }
      }
    )
    const rows = (await response.json()).data.list as any[]
    const total = rows.reduce((sum, r) => sum + Number(r.plan_hours ?? 0), 0)
    expect(total, '演示数据里工时全是空的').toBeGreaterThan(0)

    await login(page)
    await openGrid(page, 'test_demo_grid_tree')
    const footer = page.locator('.el-table__footer-wrapper').first()
    await expect(footer).toBeVisible()
    // 计划工时列配的是「1 位小数」，合计行跟着走
    await expect(footer, '树形下的合计对不上').toContainText(total.toFixed(1))
  })
})

// =====================================================================
// G09 左侧树 + 标签页双维筛选
// =====================================================================

test.describe('G09 · 左侧树与标签页双维筛选', () => {
  test('左侧树与顶部页签同时在', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_filter')
    await expect(page.locator('.el-tree'), '左侧树没出来').toBeVisible()
    await expect(page.getByRole('tab', { name: '进行中' }), '状态页签没出来').toBeVisible()
  })

  test('两个维度是「与」的关系：叠加后的条数等于同时满足两者的条数', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    const countOf = async (conditions: any[]) => {
      const res = await request.post(
        `${API_BASE_URL}/infra/form-design/runtime/test_demo_grid_filter/page`,
        {
          headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID },
          data: { pageNo: 1, pageSize: 100, conditions }
        }
      )
      return (await res.json()).data.total as number
    }
    const both = await countOf([
      { field: 'project_type', operator: 'EQ', value: 'SOFT' },
      { field: 'project_status', operator: 'EQ', value: 'RUNNING' }
    ])
    const onlyType = await countOf([{ field: 'project_type', operator: 'EQ', value: 'SOFT' }])
    // 叠加后必须比单条件少，否则「与」的关系无从验证
    expect(both, `软件开发 ${onlyType} 条、其中进行中 ${both} 条 —— 两者相等，证明不了叠加`)
      .toBeLessThan(onlyType)

    await login(page)
    await openGrid(page, 'test_demo_grid_filter')
    await page.locator('.el-tree').getByText('软件开发', { exact: true }).click()
    await expect(page.locator('.el-pagination')).toContainText(String(onlyType), {
      timeout: 15_000
    })

    // 再叠一层页签
    await page.getByRole('tab', { name: '进行中' }).click()
    await expect(
      page.locator('.el-pagination'),
      '左树与页签没有叠加，页签把左树的筛选覆盖掉了'
    ).toContainText(String(both), { timeout: 15_000 })
  })
})

// =====================================================================
// G10 行内编辑与批量操作
// =====================================================================

test.describe('G10 · 行内编辑与批量操作', () => {
  test('四种编辑器：点编辑后数字/下拉/日期/开关各自变成对应的控件', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_inline')

    const firstRow = bodyRows(page).first()
    await firstRow.getByRole('button', { name: '编辑' }).click()

    // 编辑态下这一行才有输入控件，其余行没有
    await expect(firstRow.locator('.el-input-number').first(), '数字编辑器没出来').toBeVisible({
      timeout: 10_000
    })
    await expect(firstRow.locator('.el-select').first(), '下拉编辑器没出来').toBeVisible()
    await expect(firstRow.locator('.el-date-editor').first(), '日期编辑器没出来').toBeVisible()
    await expect(firstRow.locator('.el-switch').first(), '开关编辑器没出来').toBeVisible()

    // 不可编辑的对照列仍然是纯文本
    await expect(bodyRows(page).nth(1).locator('.el-input-number')).toHaveCount(0)

    await firstRow.getByRole('button', { name: '取消' }).click()
  })

  test('编辑态下只留保存与取消，其余按钮让位', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_inline')
    const firstRow = bodyRows(page).first()
    await firstRow.getByRole('button', { name: '编辑' }).click()
    await expect(firstRow.getByRole('button', { name: '保存' })).toBeVisible({ timeout: 10_000 })
    // 点「详情」是带着没存的改动过去还是丢掉？不给这个选择比猜一个更好
    await expect(firstRow.getByRole('button', { name: '详情' })).toHaveCount(0)
    await firstRow.getByRole('button', { name: '取消' }).click()
  })

  test('配了批量按钮才有多选列，勾选后按钮才可点', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_inline')

    const checkbox = bodyRows(page).first().locator('.el-checkbox').first()
    await expect(checkbox, '配了批量删除却没有多选列').toBeVisible()

    const batchButton = page.getByRole('button', { name: /批量删除/ })
    await expect(batchButton, '一条都没勾时批量删除应当是禁用的').toBeDisabled()
    await checkbox.click()
    await expect(batchButton).toBeEnabled()
    await expect(batchButton, '勾选数没有回显在按钮上').toContainText('(1)')
    // 不真的删 —— 十二个示例共用同一批数据
    await checkbox.click()
  })
})

// =====================================================================
// G11 表格打印
// =====================================================================

/**
 * 截获打印出来的 HTML
 *
 * `printHtml` 把文档塞进一个隐藏 iframe 的 `srcdoc` 再调 `print()`。
 * 用例里不能真的弹打印对话框（会把浏览器卡住），所以：
 *   1. 先把 `window.print` 换成空函数
 *   2. 点按钮
 *   3. 从 DOM 里把那个 iframe 的 srcdoc 读出来
 *
 * ⚠️ 必须在点按钮**之前**注入，`addInitScript` 在每次导航后、页面脚本前执行。
 */
async function capturePrintHtml(page: Page, trigger: () => Promise<void>): Promise<string> {
  await page.evaluate(() => {
    // iframe 里的 print 才是真正被调的那个，但 iframe 是运行时创建的，
    // 拿不到它的 window。改成拦 HTMLIFrameElement 的 srcdoc 设置 ——
    // 值一写进去就存起来，print 弹不弹都不影响
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      'srcdoc'
    )!
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      configurable: true,
      get() {
        return descriptor.get!.call(this)
      },
      set(value: string) {
        ;(window as any).__printed = value
        // 不真的写进去：写了浏览器会加载文档并弹出打印对话框，把用例挂死
      }
    })
  })
  await trigger()
  await page.waitForFunction(() => !!(window as any).__printed, undefined, { timeout: 15_000 })
  return page.evaluate(() => (window as any).__printed as string)
}

test.describe('G11 · 表格打印', () => {
  test('列表打印：分组表头、合并单元格、合计行一个都不少', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_print')

    const html = await capturePrintHtml(page, async () => {
      await page.getByRole('button', { name: '打印列表' }).click()
    })

    // 分组表头 → thead 两行 + colspan
    expect(html, '打印出来没有分组表头').toContain('金额（元）')
    expect(html, '分组表头没有 colspan').toMatch(/colspan="\d+"/)
    expect(html, '独立列没有纵向贯通两行').toContain('rowspan="2"')

    // 合并单元格 → 数据区的 rowspan
    const bodyPart = html.slice(html.indexOf('<tbody>'))
    expect(bodyPart, '打印出来没有合并单元格').toMatch(/rowspan="[2-9]/)

    // 合计行 → tfoot
    expect(html, '打印出来没有合计行').toContain('<tfoot>')
    expect(html, '合计行里没有金额').toMatch(/\d{1,3}(,\d{3})+\.\d{2}/)

    // 页脚写明印了多少条，免得用户以为印的是全部
    expect(html).toMatch(/本次打印 \d+ 条，共 \d+ 条/)

    // 不该把操作按钮印上去
    expect(html, '打印出来带上了操作按钮').not.toContain('<button')
  })

  test('列表打印跟着筛选走：筛完之后印的是筛出来的那些', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_print')

    // 按负责人筛一个只出现在运维类里的人
    await page.locator('.el-form--inline input').nth(2).fill('孙磊')
    await page.getByRole('button', { name: '搜索' }).click()
    await expect(page.locator('.el-pagination')).not.toContainText(String(TOTAL_PROJECTS), {
      timeout: 15_000
    })

    const html = await capturePrintHtml(page, async () => {
      await page.getByRole('button', { name: '打印列表' }).click()
    })
    expect(html).toContain('孙磊')
    // 筛掉的人不该出现在纸上
    expect(html, '打印的不是筛选后的结果').not.toContain('张伟')
  })

  test('单据打印：模板里的子表循环真的展开成多行明细', async ({ page, request }) => {
    // 期望值从接口取，不写死 —— 每条项目挂几条明细是算出来的，
    // 写死一个数会在演示数据的构造规则变动时误报
    const token = await apiLogin(request)
    const response = await request.post(
      `${API_BASE_URL}/infra/form-design/runtime/test_demo_grid_print/page`,
      {
        headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID },
        data: { pageNo: 1, pageSize: 1, conditions: [], sortField: 'sort_key', sortOrder: 'asc' }
      }
    )
    const row = ((await response.json()).data.list as any[])[0]
    // ⚠️ 明细要走**详情**接口取，不能用分页接口的返回值
    //
    // 分页只查 listConf 里真正引用了的子表（性能优化：一张表单可能配了三张明细表）。
    // G11 的列表一列明细都没配，所以分页返回的记录上没有 milestones / costs ——
    // 拿它当期望值会得到 0 条，报「第一条项目没有里程碑」，
    // 而库里明明有。单据打印本身也是走详情接口取数的，口径一致。
    const detailRes = await request.get(
      `${API_BASE_URL}/infra/form-design/runtime/test_demo_grid_print/get?id=${row.id}`,
      { headers: { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID } }
    )
    const first = (await detailRes.json()).data
    const milestones = (first.milestones ?? []) as any[]
    const costs = (first.costs ?? []) as any[]
    expect(milestones.length, '第一条项目没有里程碑，这条用例证明不了循环').toBeGreaterThan(1)
    expect(costs.length, '第一条项目没有费用明细').toBeGreaterThan(1)

    await login(page)
    await openGrid(page, 'test_demo_grid_print')

    const html = await capturePrintHtml(page, async () => {
      await bodyRows(page).first().getByRole('button', { name: '打印' }).click()
    })

    expect(html, '单据抬头没印出来').toContain('项目立项单')
    expect(html, '里程碑表格没印出来').toContain('里程碑计划')
    expect(html, '费用明细表格没印出来').toContain('费用预算明细')

    // 循环段被展开：占位符不该原样留在纸上
    expect(html, '循环标记原样印在单据上了').not.toContain('{#milestones}')
    expect(html, '明细列的占位符没被替换').not.toContain('{ms_name}')
    expect(html, '主表占位符没被替换').not.toContain('{project_code}')
    expect(html, '主表字段没印出来').toContain(first.project_code)

    // ⚠️ 按【每一条明细的实际值】断言，而不是数 <tr>
    //
    // 数 <tr> 看着简单，但模板里的换行缩进会让 `<tr><td>` 这种紧凑写法匹配不上
    // （费用那张表的 tr 与 td 之间有换行），于是只数到里程碑那几行，
    // 报「循环没生效」而实际上两张表都展开了。第一版就栽在这里。
    milestones.forEach((row, index) => {
      expect(html, `第 ${index + 1} 条里程碑没印出来`).toContain(row.ms_name)
    })
    costs.forEach((row, index) => {
      expect(html, `第 ${index + 1} 条费用明细没印出来`).toContain(row.cost_item)
    })
    // 两张表的行数不同，能证明各自按自己的明细数展开，而不是套用同一个数
    const uniqueMs = new Set(milestones.map((r) => r.ms_name)).size
    const uniqueCost = new Set(costs.map((r) => r.cost_item)).size
    expect(uniqueMs + uniqueCost, '明细项太少，断言没有区分力').toBeGreaterThan(2)
  })
})

// =====================================================================
// G12 富展示单元格与列设置
// =====================================================================

test.describe('G12 · 富展示单元格', () => {
  test('图片、签名、附件、超链接、标签都渲染成元素而不是一串文字', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_cell')
    const body = page.locator('.el-table__body-wrapper').first()

    // 图片列：真的有 img 且加载成功（naturalWidth > 0）。
    // 只断言 <img> 在的话，一个坏掉的 URL 也照样满足
    const images = body.locator('.el-image img')
    await expect(images.first()).toBeVisible({ timeout: 15_000 })
    const loaded = await images.first().evaluate((el: any) => el.naturalWidth > 0)
    expect(loaded, '图片列里的图没加载出来 —— 演示数据可能塞的是假 URL').toBeTruthy()

    // 附件列：显示原文件名，不是哈希路径
    const fileLink = body.locator('a.el-link').filter({ hasText: '.txt' }).first()
    await expect(fileLink, '附件列没显示原文件名').toBeVisible()

    // 超链接列
    await expect(
      body.locator('a.el-link').filter({ hasText: '打开' }).first()
    ).toHaveAttribute('href', /example\.com\/project/)

    // 标签列
    await expect(body.locator('.el-tag').first()).toBeVisible()
  })

  test('没有图片的记录显示占位符，而不是一个破图标', async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_cell')
    // 演示数据只给前 8 条配了图片，第 9 条起是空的
    await page.locator('.el-pagination').getByLabel('下一页', { exact: false }).click()
    const body = page.locator('.el-table__body-wrapper').first()
    await expect(body).toContainText('-', { timeout: 15_000 })
    await expect(body.locator('.el-image img'), '第二页不该有图片').toHaveCount(0)
  })
})

test.describe('G12 · 运行时列设置', () => {
  /** 表头里看得见的列标题 */
  const headerLabels = (page: Page) =>
    page
      .locator('.el-table__header-wrapper')
      .first()
      .locator('thead th:visible .cell')
      .allInnerTexts()

  test.beforeEach(async ({ page }) => {
    await login(page)
    await openGrid(page, 'test_demo_grid_cell')
    // 每条用例从干净的偏好开始 —— 偏好存在 localStorage 里，会跨用例残留
    await page.getByRole('button', { name: '列设置' }).click()
    await page.getByRole('button', { name: '恢复默认' }).click()
    await page.keyboard.press('Escape')
  })

  test('隐藏一列后表头少一列，刷新页面仍然隐藏', async ({ page }) => {
    const before = await headerLabels(page)
    expect(before, '表头一列都没读到').toContain('联系电话')

    await page.getByRole('button', { name: '列设置' }).click()
    const panel = page.locator('.column-setting')
    await expect(panel).toBeVisible({ timeout: 10_000 })
    await panel.locator('.el-checkbox').filter({ hasText: '联系电话' }).click()
    await page.keyboard.press('Escape')

    await expect
      .poll(async () => (await headerLabels(page)).includes('联系电话'), { timeout: 10_000 })
      .toBe(false)

    // 存在本地，刷新后还在 —— 不存的话每次进页面都要重调一遍
    await page.reload()
    await expect(page.locator('.el-table__body-wrapper tbody tr').first()).toBeVisible({
      timeout: 60_000
    })
    expect(
      (await headerLabels(page)).includes('联系电话'),
      '刷新之后隐藏的列又回来了，偏好没存住'
    ).toBe(false)
  })

  test('恢复默认把隐藏的列放回来', async ({ page }) => {
    await page.getByRole('button', { name: '列设置' }).click()
    const panel = page.locator('.column-setting')
    await panel.locator('.el-checkbox').filter({ hasText: '联系邮箱' }).click()
    await expect
      .poll(async () => (await headerLabels(page)).includes('联系邮箱'), { timeout: 10_000 })
      .toBe(false)

    await panel.getByRole('button', { name: '恢复默认' }).click()
    await expect
      .poll(async () => (await headerLabels(page)).includes('联系邮箱'), { timeout: 10_000 })
      .toBe(true)
  })

  test('改列宽立刻生效', async ({ page }) => {
    const widthOf = async (label: string) =>
      page
        .locator('.el-table__header-wrapper')
        .first()
        .locator('thead th:visible')
        .filter({ hasText: label })
        .first()
        .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width)

    const before = await widthOf('负责人')
    await page.getByRole('button', { name: '列设置' }).click()
    const row = page
      .locator('.column-setting-item')
      .filter({ hasText: '负责人' })
      .first()
    // ⚠️ 限定到宽度输入框：这一行里还有复选框的 input，
    // 直接 locator('input') 会命中两个
    const widthInput = row.locator('.column-setting-width input')
    await widthInput.fill('300')
    await widthInput.press('Enter')
    await page.keyboard.press('Escape')

    await expect.poll(() => widthOf('负责人'), { timeout: 10_000 }).toBeGreaterThan(before + 50)
  })

  test('固定列与明细列的拖拽把手是禁用的', async ({ page }) => {
    await page.getByRole('button', { name: '列设置' }).click()
    const panel = page.locator('.column-setting')
    // 项目编号是左固定列
    await expect(
      panel.locator('.column-setting-item').filter({ hasText: '项目编号' })
        .locator('.column-setting-handle'),
      '固定列的把手应当是禁用的 —— 它的偏移量按列序算，拖了会错位'
    ).toHaveClass(/is-disabled/)
    // 普通列可以拖
    await expect(
      panel.locator('.column-setting-item').filter({ hasText: '负责人' })
        .locator('.column-setting-handle')
    ).not.toHaveClass(/is-disabled/)
  })

  test('没开列设置的示例不出现齿轮按钮', async ({ page }) => {
    // 默认关：给每张已发布的列表凭空多一个按钮是一种意外
    await openGrid(page, 'test_demo_grid_basic')
    await expect(page.getByRole('button', { name: '列设置' })).toHaveCount(0)
  })
})

test.describe('G11 · 设计器侧', () => {
  test('打印模板编辑器能一键插入明细表格，且结构是对的', async ({ page, request }) => {
    const token = await apiLogin(request)
    const id = await findDesignId(request, token, 'test_demo_grid_print')

    await login(page)
    await openListDesign(page, id)
    await page.getByRole('tab', { name: '打印模板' }).click()

    const panel = page.locator('.print-template-editor')
    await expect(panel).toBeVisible({ timeout: 30_000 })

    // 两张子表都要列在「插入明细表格」下面 —— 清单取自表绑定，
    // 与发布校验是同一份依据
    await expect(panel, '没有「插入明细表格」这一块').toContainText('插入明细表格')
    await expect(panel).toContainText('{#milestones}')
    await expect(panel).toContainText('{#costs}')

    // 已配的模板里循环段是完整的，不该报警告
    await expect(
      panel.locator('.el-alert--warning'),
      '已配好的模板被误报成有问题'
    ).toHaveCount(0)
  })

  test('⚠️ 回归：模板在设计器里打开并保存一次之后，明细循环仍然有效', async ({
    page,
    request
  }) => {
    // 这是本功能栽过的一次：早先用成对的 {#子表}…{/子表}，标记写在 </tr> 与 <tr> 之间。
    // 字符串层面完全正常、打印也印得对，但 HTML 的 foster parenting 规则会把
    // <table> 里不在单元格内的文本整段挪到表格前面 —— 富文本编辑器读进来再吐出去，
    // 两个标记就挨在一起跑到了表格外，明细行落在循环之外。
    // 现象是「模板没动过，打开保存一下，明细就印不出来了」，没有任何报错。
    //
    // 所以这条用例走的是完整往返：打开设计器 → 保存 → 回运行时打印 → 断言明细还在。
    const token = await apiLogin(request)
    const id = await findDesignId(request, token, 'test_demo_grid_print')

    await login(page)
    await openListDesign(page, id)
    await page.getByRole('tab', { name: '打印模板' }).click()
    await expect(page.locator('.print-template-editor')).toBeVisible({ timeout: 30_000 })
    // 让编辑器真的把模板吐出来一遍：点进正文再保存
    await page.locator('.print-template-editor [contenteditable="true"]').first().click()
    // ⚠️ 按钮文案是「保 存」，中间有一个空格（设计器里两字按钮都这么排版），
    // 写成 /保存/ 匹配不上
    await page.getByRole('button', { name: /保\s*存/ }).first().click()
    await expect(page.locator('.el-message--success').first()).toBeVisible({ timeout: 20_000 })

    // 回运行时打印，明细必须还在
    await openGrid(page, 'test_demo_grid_print')
    const html = await capturePrintHtml(page, async () => {
      await bodyRows(page).first().getByRole('button', { name: '打印' }).click()
    })
    expect(html, '往返之后标记原样印在了单据上').not.toContain('{#milestones}')
    expect(html, '往返之后明细列的占位符没被替换').not.toContain('{ms_name}')
    expect(html, '往返之后明细一行都印不出来了').toMatch(/需求确认|方案评审|开发完成/)
  })

  test('⚠️ 循环段引用错子表时，设计器当场就有警告', async ({ page, request }) => {
    // 发布校验会拦一次，但那要等到发布。设计期就说清楚，省一趟来回
    const token = await apiLogin(request)
    const id = await findDesignId(request, token, 'test_demo_grid_print')

    await login(page)
    await openListDesign(page, id)
    await page.getByRole('tab', { name: '打印模板' }).click()
    const panel = page.locator('.print-template-editor')
    await expect(panel).toBeVisible({ timeout: 30_000 })

    // 在编辑器里打一段引用了不存在子表的循环
    const editable = panel.locator('[contenteditable="true"]').first()
    await editable.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('{#nosuch}')

    await expect(
      panel.locator('.el-alert--warning'),
      '标记放在表格外面却没有警告'
    ).toContainText('nosuch', { timeout: 15_000 })

    // ⚠️ 不保存 —— 这条用例只看设计期提示，改脏了会影响 G11 的运行时用例
    await page.keyboard.press('Control+Z')
  })
})
