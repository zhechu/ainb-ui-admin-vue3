import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

/**
 * 字典分类迁移包 + 全局滚动条 —— 浏览器端验证
 *
 * 后端行为已经由 script/e2e_dict_transfer.py 逐条覆盖，这里只验证浏览器里才看得见的部分：
 * 导出按钮真的下载到一个能用的包、导入弹窗把三种策略摆出来、
 * 以及滚动条确实是「不占位 + 鼠标进入才浮现」的那一种。
 */

async function login(page: Page) {
  await page.goto('/login')
  const form = page
    .locator('form.login-form')
    .filter({ has: page.locator('input[type="password"]') })
    .filter({ has: page.locator('input[type="checkbox"]') })
    .first()
  await expect(form).toBeVisible()

  const inputs = form.locator('input:visible')
  const inputCount = await inputs.count()
  if (inputCount >= 3) await inputs.nth(0).fill('xpy')
  await inputs.nth(inputCount - 2).fill('admin')
  await inputs.nth(inputCount - 1).fill('admin123')

  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/system/auth/login') && response.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  expect((await loginResponsePromise).ok()).toBeTruthy()
  await expect(page).not.toHaveURL(/\/login/)
}

/** 左树工具栏上的图标按钮。图标本身没有可读文本，靠 aria-label 定位 */
const treeToolbarButton = (page: Page, label: string) =>
  page.locator(`.w-280px [aria-label="${label}"]`)

/** 打开「分类管理」抽屉 */
async function openManageDrawer(page: Page) {
  await treeToolbarButton(page, '分类管理').click()
  const drawer = page.locator('.el-drawer:visible', { hasText: '字典分类管理' })
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('.el-table__body tbody tr').first()).toBeVisible()
  return drawer
}

/** 打开字典管理页，等左树把分类拉回来 */
async function gotoDictPage(page: Page) {
  await page.goto('/system/dict')
  await expect(page.locator('.el-tree').first()).toBeVisible()
  await expect(page.locator('.el-tree-node').first()).toBeVisible()
  // 这套布局的侧边栏是「图标栏 + 悬浮二级菜单」，二级菜单会盖住内容区，
  // 把后面对树节点的 hover 全部截走。它跟本用例要验证的东西无关，直接屏蔽掉。
  // 只关掉 .el-menu--popup，不动整个 popper 容器——下面还要点 el-dropdown 的菜单
  await page.addStyleTag({ content: '.el-menu--popup { display: none !important; }' })
}

test('字典分类树的工具栏提供刷新、展开全部、折叠全部与分类管理', async ({ page }) => {
  await login(page)
  await gotoDictPage(page)

  // 树节点上不该有任何操作按钮：面板只有 280px，挂按钮就把分类名挤没了
  await page.locator('.el-tree-node__content').first().hover()
  await expect(page.locator('.el-tree-node__content button')).toHaveCount(0)

  // 四个操作都在工具栏上
  for (const label of ['刷新数据', '展开全部', '折叠全部', '分类管理']) {
    await expect(treeToolbarButton(page, label)).toBeVisible()
  }

  const visibleNodes = () => page.locator('.el-tree-node__content:visible').count()

  // 折叠全部：只剩顶层分组
  await treeToolbarButton(page, '折叠全部').click()
  await expect.poll(visibleNodes).toBeGreaterThan(0)
  const collapsed = await visibleNodes()

  // 展开全部：可见节点显著变多
  await treeToolbarButton(page, '展开全部').click()
  await expect.poll(visibleNodes).toBeGreaterThan(collapsed)
  const expanded = await visibleNodes()

  // 刷新之后展开态要沿用，不能悄悄塌回默认的那一条分支
  await treeToolbarButton(page, '刷新数据').click()
  await expect(page.locator('.el-message', { hasText: '已刷新' })).toBeVisible()
  await expect.poll(visibleNodes).toBe(expanded)

  // 先折叠全部再搜索，命中项仍然要看得见——否则等于搜了个寂寞
  await treeToolbarButton(page, '折叠全部').click()
  const search = page.locator('.w-280px input[placeholder="搜索分类名称/编码"]')
  await search.fill('用户性别')
  await search.press('Enter')
  await expect(
    page.locator('.el-tree-node__content:visible', { hasText: '用户性别' })
  ).toBeVisible()
})

test('分类管理抽屉从右侧滑出，能集中做增删改与导出', async ({ page }) => {
  await login(page)
  await gotoDictPage(page)

  const drawer = await openManageDrawer(page)

  // 是「从右侧滑出」而不是别的方向：面板右缘贴着视口右缘，左缘留出一段让底下的页面还看得见
  const viewport = page.viewportSize()!
  const box = (await drawer.boundingBox())!
  expect(Math.abs(box.x + box.width - viewport.width)).toBeLessThanOrEqual(2)
  expect(box.x).toBeGreaterThan(0)
  expect(box.width).toBeLessThan(viewport.width)

  // 整棵分类树摊成一张表：编码、类型这些左树上放不下的信息都在
  const table = drawer.locator('.el-table')
  await expect(table).toBeVisible()
  for (const header of ['分类名称', '编码', '类型', '状态', '操作']) {
    await expect(table.locator('th', { hasText: header }).first()).toBeVisible()
  }
  const rowCount = await table.locator('.el-table__body tbody tr').count()
  expect(rowCount).toBeGreaterThan(0)

  // 分组行比字典行多一个「新增下级」——字典底下挂的是字典数据，不能再挂分类
  const groupRow = table
    .locator('.el-table__body tbody tr')
    .filter({ has: page.locator('.el-tag', { hasText: '分组' }) })
    .first()
  if (await groupRow.count()) {
    await expect(groupRow.locator('button', { hasText: '新增下级' })).toBeVisible()
  }

  // 搜索会把结果收窄
  await drawer.locator('input[placeholder="搜索分类名称/编码"]').fill('用户性别')
  await drawer.locator('input[placeholder="搜索分类名称/编码"]').press('Enter')
  await expect
    .poll(async () => table.locator('.el-table__body tbody tr').count())
    .toBeLessThan(rowCount)

  // 行内导出走的是同一条迁移包通道
  const downloadPromise = page.waitForEvent('download')
  await table
    .locator('.el-table__body tbody tr')
    .first()
    .locator('button', { hasText: '导出' })
    .click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  const pkg = JSON.parse(await readFile(await download.path(), 'utf-8'))

  expect(pkg.version).toBe(1)
  expect(Array.isArray(pkg.types)).toBeTruthy()
  expect(pkg.types.length).toBeGreaterThan(0)
  // 包里只能有编码，不能夹带导出环境的自增主键
  expect(pkg.types[0].id).toBeUndefined()
  expect(pkg.types[0].type).toBeTruthy()
  // 根节点不记录自己在导出环境的位置，落点由导入方决定
  expect(pkg.types[0].parentType ?? null).toBeNull()

  // 抽屉里的「导入分类」弹窗要能盖在抽屉之上，否则等于点不了
  await drawer.locator('button', { hasText: '导入分类' }).click()
  const importDialog = page.locator('.el-dialog:visible', { hasText: '导入字典分类' })
  await expect(importDialog).toBeVisible()
  for (const label of ['跳过', '覆盖', '建副本']) {
    await expect(importDialog.locator('.el-radio', { hasText: label })).toBeVisible()
  }
  await expect(importDialog.locator('.el-upload-dragger')).toBeVisible()
})

test('字典分类树的滚动条不占内容宽度，且鼠标移入才浮现', async ({ page }) => {
  await login(page)
  await gotoDictPage(page)

  const scrollbar = page
    .locator('.el-tree')
    .first()
    // contains() 会把 el-scrollbar__view 也算进来，这里按整个 class 词匹配
    .locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " el-scrollbar ")][1]'
    )
  await expect(scrollbar).toBeVisible()

  // 原生滚动条会从 clientWidth 里吃掉 8~17px；el-scrollbar 把它藏了，两者应当相等
  const metrics = await scrollbar.evaluate((el) => {
    const wrap = el.querySelector('.el-scrollbar__wrap') as HTMLElement
    return {
      gutter: wrap.offsetWidth - wrap.clientWidth,
      scrollable: wrap.scrollHeight > wrap.clientHeight
    }
  })
  expect(metrics.gutter).toBe(0)
  expect(metrics.scrollable).toBeTruthy() // 分类够多，确实处在会滚动的状态

  const verticalBar = scrollbar.locator('.el-scrollbar__bar.is-vertical')

  // 鼠标不在容器上时滚动条整根不渲染（el-scrollbar 用 v-show 控制，不是仅仅调透明度）
  await page.mouse.move(0, 0)
  await expect(verticalBar).toBeHidden()

  // 移进去之后浮现
  await scrollbar.hover()
  await expect(verticalBar).toBeVisible()
})

test('全局滚动条基线对包不进 el-scrollbar 的原生滚动区生效', async ({ page }) => {
  await login(page)
  await page.goto('/')

  // 第三方组件、可编辑区这些包不了的地方，靠全局样式压成细条 + 默认透明
  const style = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'width:120px;height:60px;overflow:auto;position:fixed;left:-9999px;'
    probe.innerHTML = '<div style="height:600px"></div>'
    document.body.appendChild(probe)
    const result = {
      track: getComputedStyle(probe, '::-webkit-scrollbar').width,
      thumb: getComputedStyle(probe, '::-webkit-scrollbar-thumb').backgroundColor,
      firefoxWidth: getComputedStyle(probe).scrollbarWidth,
      gutter: probe.offsetWidth - probe.clientWidth
    }
    probe.remove()
    return result
  })

  // 8px 的细条，远窄于 Windows 原生的 17px
  expect(style.track).toBe('8px')
  // 默认状态下滑块完全透明，鼠标进入容器才染色
  expect(style.thumb).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
  // Firefox 走的是 scrollbar-width
  expect(style.firefoxWidth).toBe('thin')
  // 无论浏览器用不用悬浮式滚动条，都不该再出现 17px 那种粗条
  expect(style.gutter).toBeLessThanOrEqual(8)
})
