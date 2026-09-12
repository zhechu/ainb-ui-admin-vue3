// 数据字典树形化 —— 前端页面端到端验证（真实浏览器）
//
// 覆盖左树右表主页的关键交互：分类树渲染、选中切换、树形字典的树表展开、
// 关键字过滤保父链、新增下级、以及前端字典缓存的树形能力。
// playwright 是 pnpm 装的间接依赖，没有提升到顶层 node_modules，这里按实际路径解析
const { chromium } = require('../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright')

const BASE = 'http://localhost'
const API = 'http://127.0.0.1:48080/admin-api'

const passed = []
const failed = []

/**
 * 关掉侧边菜单的悬停浮层
 *
 * 自动化导航时指针会扫过左侧菜单，弹出的二级菜单浮层会盖住左树并拦截点击。
 * 它是自动化的副作用，与被测页面无关。
 */
async function dismissMenuPopper(page) {
  await page.mouse.move(1200, 600)
  await page.waitForTimeout(400)
}

/**
 * 全局屏蔽侧边菜单的悬停浮层
 *
 * 自动化时指针扫过左侧菜单会弹出二级菜单，盖住内容区并拦截点击。
 * 浮层容器的 id 每次导航都变，逐次注入样式盖不住，所以用 initScript 对整个会话生效。
 * 只做视觉与命中屏蔽，不改 DOM 结构——删节点会破坏 Vue 的锚点。
 */
async function blockMenuPopper(page) {
  await page.addInitScript(() => {
    const css =
      '[id^="el-popper-container"]{pointer-events:none !important;visibility:hidden !important;}'
    const inject = () => {
      const style = document.createElement('style')
      style.textContent = css
      document.head?.appendChild(style)
    }
    if (document.head) inject()
    else document.addEventListener('DOMContentLoaded', inject)
  })
}

function check(name, cond, detail = '') {
  if (cond) {
    passed.push(name)
    console.log(`  [PASS] ${name}`)
  } else {
    failed.push([name, detail])
    console.log(`  [FAIL] ${name}  ${detail}`)
  }
}

// 直接打后端准备测试数据，避免把页面交互当成数据构造手段
async function api(method, path, { body, params, token } = {}) {
  let url = API + path
  if (params) url += '?' + new URLSearchParams(params)
  const headers = { 'Content-Type': 'application/json', 'tenant-id': '1' }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return res.json()
}

async function main() {
  const login = await api('POST', '/system/auth/login', {
    body: { username: 'admin', password: 'admin123' }
  })
  const token = login.data.accessToken

  // ---------- 清理 + 造数 ----------
  const types = (await api('GET', '/system/dict-type/list', { token })).data
  for (const t of types) {
    if (['xpy_area', 'xpy_group_md'].includes(t.type)) {
      const rows = (await api('GET', '/system/dict-data/tree-list', { token, params: { dictType: t.type } })).data
      for (const d of rows) {
        await api('DELETE', '/system/dict-data/delete', { token, params: { id: d.id, cascade: 'true' } })
      }
      await api('DELETE', '/system/dict-type/delete', { token, params: { id: t.id } })
    }
  }
  const gid = (await api('POST', '/system/dict-type/create', {
    token, body: { parentId: 0, nodeType: 1, name: '主数据分组', type: 'xpy_group_md', sort: 0, status: 0 }
  })).data
  const tid = (await api('POST', '/system/dict-type/create', {
    token,
    body: { parentId: gid, nodeType: 2, name: '行政区划', type: 'xpy_area', sort: 0, treeEnable: 1, cacheMode: 1, status: 0 }
  })).data
  const add = async (label, value, parentId) =>
    (await api('POST', '/system/dict-data/create', {
      token, body: { dictType: 'xpy_area', parentId, label, value, sort: 0, status: 0 }
    })).data
  const gd = await add('广东省', 'gd', 0)
  const sz = await add('深圳市', 'sz', gd)
  await add('南山区', 'ns', sz)
  await add('湖南省', 'hn', 0)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const pageErrors = []
  await blockMenuPopper(page)
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // 直接取 m.text() 遇到对象会变成没有信息量的 "Object"，逐个参数序列化
    Promise.all(
      m.args().map((a) =>
        a
          .evaluate((v) => {
            if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack || ''}`
            try {
              return typeof v === 'string' ? v : JSON.stringify(v)
            } catch {
              return String(v)
            }
          })
          .catch(() => m.text())
      )
    )
      .then((args) => pageErrors.push(`[${m.location().url}] ` + args.join(' ')))
      .catch(() => pageErrors.push(m.text()))
  })
  // 把失败的接口调用也记下来，否则页面上只看到一个红色提示，定位不到原因
  page.on('response', async (r) => {
    if (r.url().includes('/admin-api/') && r.request().method() !== 'GET') {
      try {
        const body = await r.json()
        if (body.code !== 0) {
          pageErrors.push(`${r.request().method()} ${new URL(r.url()).pathname} -> ${JSON.stringify(body)}`)
        }
      } catch {}
    }
  })

  try {
    // ---------- 登录 ----------
    console.log('【登录】')
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await page.fill('input[placeholder*="账号"], input[placeholder*="用户名"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button:has-text("登 录"), button:has-text("登录")')
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 })
    check('登录成功', true)

    // ---------- 左树右表主页 ----------
    console.log('\n【左树右表】')
    await page.goto(BASE + '/system/dict', { waitUntil: 'networkidle' })
    await page.waitForSelector('.el-tree', { timeout: 20000 })
    // 导航时指针会扫过左侧菜单，留下的悬停浮层会拦截后续点击
    await dismissMenuPopper(page)

    const groupNode = page.locator('.el-tree-node', { hasText: '主数据分组' }).first()
    check('分类树渲染出分组节点', (await groupNode.count()) > 0)
    // 分组默认折叠（存量字典 270+ 个，全展开等于没分组），像真实用户那样先点开
    await groupNode.locator('.el-tree-node__expand-icon').first().click()
    await page.waitForTimeout(600)
    const dictNode = page.locator('.el-tree-node__content', { hasText: '行政区划' }).first()
    check('展开分组后渲染出字典节点', (await dictNode.count()) > 0)

    // ---------- 切换到树形字典 ----------
    await dictNode.click()
    await page.waitForTimeout(1200)
    check('选中后右侧标题显示字典名', await page.locator('text=行政区划').first().isVisible())
    check('树形字典有「树形」标记', (await page.locator('.el-tag:has-text("树形")').count()) > 0)

    // ---------- 树表 ----------
    console.log('\n【树表】')
    const rowText = await page.locator('.el-table__body tr').allTextContents()
    check('树表渲染出根节点', rowText.some((t) => t.includes('广东省')))
    check('树表默认展开显示二级', rowText.some((t) => t.includes('深圳市')))
    check('树表默认展开显示三级', rowText.some((t) => t.includes('南山区')))
    const indentLevels = await page.locator('.el-table__indent').evaluateAll((els) =>
      els.map((e) => parseInt(e.style.paddingLeft) || 0)
    )
    check('树表有多级缩进（层级可视）', new Set(indentLevels).size >= 2,
      `levels=${[...new Set(indentLevels)]}`)

    // ---------- 关键字过滤保父链 ----------
    console.log('\n【关键字过滤】')
    await page.fill('input[placeholder*="搜索标签"]', '南山')
    await page.click('button:has-text("搜索")')
    await page.waitForTimeout(1200)
    const filtered = await page.locator('.el-table__body tr').allTextContents()
    check('过滤后命中项仍在', filtered.some((t) => t.includes('南山区')))
    check('过滤后祖先「深圳市」被保留', filtered.some((t) => t.includes('深圳市')))
    check('过滤后祖先「广东省」被保留', filtered.some((t) => t.includes('广东省')))
    check('过滤后无关分支「湖南省」被排除', !filtered.some((t) => t.includes('湖南省')))

    // ---------- 新增下级 ----------
    console.log('\n【新增下级】')
    await page.click('button:has-text("重置")')
    await page.waitForTimeout(1000)
    const gdRow = page.locator('.el-table__body tr', { hasText: '广东省' }).first()
    await gdRow.locator('button:has-text("新增下级")').click()
    await page.waitForSelector('.el-dialog', { timeout: 10000 })
    check('新增下级弹窗出现「上级节点」选择器',
      (await page.locator('.el-dialog:visible label:has-text("上级节点")').count()) > 0)
    await page.fill('.el-dialog:visible input[placeholder="请输入数据标签"]', '珠海市')
    await page.fill('.el-dialog:visible input[placeholder="请输入数据键值"]', 'zh')
    // 刻意不填「显示排序」：它是必填规则，默认值必须能直接通过校验，
    // 否则树形字典每加一个节点都要手动补一次
    await page.click('.el-dialog:visible button:has-text("确 定")')
    await page.waitForTimeout(2000)
    const afterAdd = await page.locator('.el-table__body tr').allTextContents()
    check('新增的下级出现在树表中', afterAdd.some((t) => t.includes('珠海市')))
    const created = (await api('GET', '/system/dict-data/tree-list', { token, params: { dictType: 'xpy_area' } })).data
      .find((x) => x.value === 'zh')
    check('新增的下级父级正确', created && created.parentId === gd, `parentId=${created?.parentId}`)
    check('新增的下级层级正确', created && created.treeLevel === 2, `treeLevel=${created?.treeLevel}`)

    // ---------- 前端字典缓存的树形能力 ----------
    console.log('\n【前端缓存树形能力】')
    const cacheResult = await page.evaluate(async () => {
      const mod = await import('/src/utils/dict.ts')
      const store = await import('/src/store/modules/dict.ts')
      await store.useDictStoreWithOut().resetDict()
      return {
        treeRoots: mod.getDictTree('xpy_area').map((n) => n.label),
        childrenOfGd: mod.getDictChildren('xpy_area', 'gd').map((n) => n.label),
        pathOfNs: mod.getDictPathLabels('xpy_area', 'ns'),
        flatUnchanged: mod.getStrDictOptions('system_user_sex').map((n) => n.label)
      }
    })
    check('getDictTree 返回根节点', cacheResult.treeRoots.includes('广东省') && cacheResult.treeRoots.includes('湖南省'),
      JSON.stringify(cacheResult.treeRoots))
    check('getDictTree 不把子节点当根', !cacheResult.treeRoots.includes('南山区'),
      JSON.stringify(cacheResult.treeRoots))
    check('getDictChildren 取直接子级', cacheResult.childrenOfGd.includes('深圳市'),
      JSON.stringify(cacheResult.childrenOfGd))
    check('getDictPathLabels 返回全路径',
      JSON.stringify(cacheResult.pathOfNs) === JSON.stringify(['广东省', '深圳市', '南山区']),
      JSON.stringify(cacheResult.pathOfNs))
    check('平铺字典行为不变（存量 240+ 字典的回归）',
      cacheResult.flatUnchanged.includes('男') && cacheResult.flatUnchanged.includes('女'),
      JSON.stringify(cacheResult.flatUnchanged))

    // ---------- 左树拖拽排序 ----------
    console.log('\n【左树拖拽排序】')
    // 造两个同级分组，sort 都是 0——这正是「只改被拖动节点」会失效的场景
    const g1 = (await api('POST', '/system/dict-type/create', {
      token, body: { parentId: 0, nodeType: 1, name: 'ZZ排序甲', type: 'xpy_sort_a', sort: 0, status: 0 }
    })).data
    const g2 = (await api('POST', '/system/dict-type/create', {
      token, body: { parentId: 0, nodeType: 1, name: 'ZZ排序乙', type: 'xpy_sort_b', sort: 0, status: 0 }
    })).data
    await api('PUT', '/system/dict-type/move', { token, body: { id: g2, parentId: 0, sort: 0 } })
    const afterMove = (await api('GET', '/system/dict-type/list', { token })).data.filter((x) => x.parentId === 0)
    check('分类拖拽后被移动项排到最前', afterMove[0].id === g2, `first=${afterMove[0].id}`)
    const typeSorts = afterMove.map((x) => x.sort).sort((a, b) => a - b)
    check('分类同级 sort 重新编号且两两不同',
      JSON.stringify(typeSorts) === JSON.stringify(afterMove.map((_, i) => i)),
      JSON.stringify(typeSorts))
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.el-tree')
    const treeLabels = await page.locator('.el-tree > .el-tree-node > .el-tree-node__content').allTextContents()
    check('刷新后左树按新顺序渲染',
      treeLabels.findIndex((t) => t.includes('ZZ排序乙')) < treeLabels.findIndex((t) => t.includes('ZZ排序甲')),
      JSON.stringify(treeLabels))
    await api('DELETE', '/system/dict-type/delete', { token, params: { id: g1 } })
    await api('DELETE', '/system/dict-type/delete', { token, params: { id: g2 } })

    // ---------- 导入导出入口 ----------
    console.log('\n【导入导出入口】')
    await page.goto(BASE + '/system/dict', { waitUntil: 'networkidle' })
    await page.waitForSelector('.el-tree')
    await page
      .locator('.el-tree-node', { hasText: '主数据分组' })
      .first()
      .locator('.el-tree-node__expand-icon')
      .first()
      .click()
    await page.waitForTimeout(600)
    await page.locator('.el-tree-node__content', { hasText: '行政区划' }).first().click()
    await page.waitForTimeout(1200)
    check('工具栏出现导入按钮', (await page.locator('button:has-text("导入")').count()) > 0)
    check('工具栏出现导出按钮', (await page.locator('button:has-text("导出")').count()) > 0)

    await page.click('button:has-text("导入")')
    await page.waitForSelector('.el-dialog:visible', { timeout: 10000 })
    const dlg = page.locator('.el-dialog:visible')
    check('导入弹窗标明了目标字典', (await dlg.textContent())?.includes('xpy_area'))
    check('树形字典的导入弹窗给出层级填写说明',
      (await dlg.textContent())?.includes('上级键值'))
    check('导入弹窗提供模板下载', (await dlg.locator('text=下载模板').count()) > 0)
    await dlg.locator('button:has-text("取 消"), button:has-text("关 闭")').first().click()
    await page.waitForTimeout(500)

    // ---------- DictTag ----------
    console.log('\n【DictTag】')
    const tagResult = await page.evaluate(async () => {
      const { createApp, h } = await import('/node_modules/.vite/deps/vue.js')
      const DictTag = (await import('/src/components/DictTag/src/DictTag.vue')).default
      const dict = await import('/src/utils/dict.ts')

      const render = (props) => {
        const el = document.createElement('div')
        document.body.appendChild(el)
        const app = createApp({ render: () => h(DictTag, props) })
        app.mount(el)
        const text = el.textContent
        app.unmount()
        el.remove()
        return text
      }

      // 渲染前先记下缓存里的 colorType，渲染后再看有没有被改掉
      const before = dict
        .getDictOptions('common_status')
        .map((d) => `${d.value}:${d.colorType}`)
        .join(',')
      const plain = render({ type: 'xpy_area', value: 'ns' })
      const withPath = render({ type: 'xpy_area', value: 'ns', showPath: true })
      const customSep = render({
        type: 'xpy_area',
        value: 'ns',
        showPath: true,
        pathSeparator: ' > '
      })
      // common_status 里有 colorType=primary 的项，正是会触发回写的那种
      render({ type: 'common_status', value: 0 })
      render({ type: 'common_status', value: 0 })
      const after = dict
        .getDictOptions('common_status')
        .map((d) => `${d.value}:${d.colorType}`)
        .join(',')
      const flat = render({ type: 'common_status', value: 0, showPath: true })

      return { plain, withPath, customSep, before, after, flat }
    })

    check('默认只显示自身标签', tagResult.plain.trim() === '南山区', `got=${tagResult.plain}`)
    check(
      'showPath 显示从根到自身的全路径',
      tagResult.withPath.replace(/\s/g, '') === '广东省/深圳市/南山区',
      `got=${tagResult.withPath}`
    )
    check(
      'pathSeparator 可自定义',
      tagResult.customSep.includes('>'),
      `got=${tagResult.customSep}`
    )
    // 渲染不能改动字典缓存：dict 是共享对象，回写会把颜色永久抹掉，波及其它消费方
    check(
      '渲染不会污染字典缓存里的 colorType',
      tagResult.before === tagResult.after,
      `\n      渲染前: ${tagResult.before}\n      渲染后: ${tagResult.after}`
    )
    check(
      '平铺字典开启 showPath 时退化为自身标签',
      tagResult.flat.trim().length > 0 && !tagResult.flat.includes('/'),
      `got=${tagResult.flat}`
    )

    // ---------- 旧路由重定向 ----------
    console.log('\n【旧路由兼容】')
    await page.goto(BASE + '/dict/type/data/xpy_area', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    check('旧的字典数据路由重定向到新页面', page.url().includes('/system/dict'), page.url())
    check('重定向后定位到指定字典',
      (await page.locator('.el-tag:has-text("xpy_area")').count()) > 0)

    // 图标走 iconify 的公网 CDN，离线环境下必然取不到，与本次改动无关，不计入断言
    const appErrors = pageErrors.filter((e) => !/api\.unisvg\.com|api\.iconify\.design|simplesvg\.com/.test(e))
    check('页面无 JS 报错', appErrors.length === 0, appErrors.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
    // ---------- 收尾清理 ----------
    const rows = (await api('GET', '/system/dict-data/tree-list', { token, params: { dictType: 'xpy_area' } })).data
    for (const d of rows) {
      await api('DELETE', '/system/dict-data/delete', { token, params: { id: d.id, cascade: 'true' } })
    }
    await api('DELETE', '/system/dict-type/delete', { token, params: { id: tid } })
    await api('DELETE', '/system/dict-type/delete', { token, params: { id: gid } })
  }

  console.log('\n' + '='.repeat(56))
  console.log(`通过 ${passed.length} / ${passed.length + failed.length}`)
  if (failed.length) {
    console.log('失败项：')
    failed.forEach(([n, d]) => console.log(`  - ${n}  ${d}`))
    process.exit(1)
  }
  console.log('全部通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
