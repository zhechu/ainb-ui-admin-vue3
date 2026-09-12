// 字典作为「选项数据源」—— 端到端验证（真实浏览器）
//
// 覆盖三件事：
//   1. 六个内置选项类控件的属性面板都出现了「数据字典」配置项
//   2. buildDictOptions 在树/扁平、三种展开方式、三种值类型下的解析结果
//   3. applyDictSource 把选项写到每种控件各自正确的属性路径上（含子表、布局容器递归）
//
// playwright 是 pnpm 装的间接依赖，没有提升到顶层 node_modules，按实际路径解析
const { chromium } = require('../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright')

const BASE = 'http://localhost'
const API = 'http://127.0.0.1:48080/admin-api'

// 缩进用的是不换行空格（U+00A0）：普通空格在 HTML 里会被折叠，缩进就白做了
const NB = '  '

const passed = []
const failed = []

function check(name, cond, detail = '') {
  if (cond) {
    passed.push(name)
    console.log(`  [PASS] ${name}`)
  } else {
    failed.push([name, detail])
    console.log(`  [FAIL] ${name}  ${detail}`)
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, `\n      实际: ${a}\n      期望: ${e}`)
}

async function api(method, path, { body, params, token } = {}) {
  let url = API + path
  if (params) url += '?' + new URLSearchParams(params)
  const headers = { 'Content-Type': 'application/json', 'tenant-id': '1' }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return res.json()
}

async function main() {
  const token = (
    await api('POST', '/system/auth/login', { body: { username: 'admin', password: 'admin123' } })
  ).data.accessToken

  // ---------- 清理 + 造数：一个三层树形字典 + 一个平铺字典 ----------
  const types = (await api('GET', '/system/dict-type/list', { token })).data
  for (const t of types) {
    if (['xpy_cat', 'xpy_flat'].includes(t.type)) {
      for (const d of (await api('GET', '/system/dict-data/tree-list', { token, params: { dictType: t.type } })).data) {
        await api('DELETE', '/system/dict-data/delete', { token, params: { id: d.id, cascade: 'true' } })
      }
      await api('DELETE', '/system/dict-type/delete', { token, params: { id: t.id } })
    }
  }
  const catId = (await api('POST', '/system/dict-type/create', {
    token,
    body: { parentId: 0, nodeType: 2, name: '商品分类', type: 'xpy_cat', sort: 0, treeEnable: 1, cacheMode: 1, status: 0 }
  })).data
  const flatId = (await api('POST', '/system/dict-type/create', {
    token,
    body: { parentId: 0, nodeType: 2, name: '平铺字典', type: 'xpy_flat', sort: 0, treeEnable: 0, cacheMode: 1, status: 0 }
  })).data
  const add = async (dictType, label, value, parentId, sort) =>
    (await api('POST', '/system/dict-data/create', {
      token, body: { dictType, parentId, label, value, sort, status: 0 }
    })).data
  //   电子产品 ─ 手机 ─ 智能机 / 功能机
  //            └ 电脑
  //   服装
  await add('xpy_cat', '电子产品', 'elec', 0, 0)
  const phone = await add('xpy_cat', '手机', 'phone', (await api('GET', '/system/dict-data/tree-list', { token, params: { dictType: 'xpy_cat' } })).data.find((x) => x.value === 'elec').id, 0)
  const elec = (await api('GET', '/system/dict-data/tree-list', { token, params: { dictType: 'xpy_cat' } })).data.find((x) => x.value === 'elec').id
  await add('xpy_cat', '智能机', '1', phone, 0)
  await add('xpy_cat', '功能机', '2', phone, 1)
  await add('xpy_cat', '电脑', 'computer', elec, 1)
  await add('xpy_cat', '服装', 'cloth', 0, 1)
  await add('xpy_flat', '甲', 'a', 0, 0)
  await add('xpy_flat', '乙', 'b', 0, 1)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  try {
    console.log('【登录】')
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await page.fill('input[placeholder*="账号"], input[placeholder*="用户名"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button:has-text("登 录"), button:has-text("登录")')
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 })
    check('登录成功', true)

    // 打开任意页面，只为拿到一个能 import 项目模块的运行环境
    await page.goto(BASE + '/system/dict', { waitUntil: 'networkidle' })
    await page.evaluate(async () => {
      const store = await import('/src/store/modules/dict.ts')
      await store.useDictStoreWithOut().resetDict()
    })

    // ---------- buildDictOptions ----------
    console.log('\n【选项解析：树形字典】')
    const treeOpts = await page.evaluate(async () => {
      const m = await import('/src/components/FormCreate/src/utils/dictSource.ts')
      return {
        tree: m.buildDictOptions({ dictType: 'xpy_cat', valueType: 'str' }, true),
        path: m.buildDictOptions({ dictType: 'xpy_cat', valueType: 'str', flatMode: 'path' }, false),
        indent: m.buildDictOptions({ dictType: 'xpy_cat', valueType: 'str', flatMode: 'indent' }, false),
        leaf: m.buildDictOptions({ dictType: 'xpy_cat', valueType: 'str', flatMode: 'leaf' }, false),
        sub: m.buildDictOptions({ dictType: 'xpy_cat', valueType: 'str', rootValue: 'elec' }, true),
        int: m.buildDictOptions({ dictType: 'xpy_cat', valueType: 'int', rootValue: 'phone' }, false),
        bool: m.buildDictOptions({ dictType: 'xpy_flat', valueType: 'bool' }, false),
        flat: m.buildDictOptions({ dictType: 'xpy_flat', valueType: 'str' }, false),
        missingRoot: m.buildDictOptions({ dictType: 'xpy_cat', rootValue: 'not_exist' }, true),
        empty: m.buildDictOptions({ dictType: '' }, false)
      }
    })

    eq('层级控件拿到嵌套结构', treeOpts.tree.map((n) => [n.label, (n.children || []).map((c) => c.label)]),
      [['电子产品', ['手机', '电脑']], ['服装', []]])
    eq('扁平控件按全路径展开', treeOpts.path.map((n) => n.label),
      ['电子产品', '电子产品 / 手机', '电子产品 / 手机 / 智能机', '电子产品 / 手机 / 功能机', '电子产品 / 电脑', '服装'])
    eq('扁平控件按缩进展开', treeOpts.indent.map((n) => n.label),
      ['电子产品', NB.repeat(1) + '手机', NB.repeat(2) + '智能机', NB.repeat(2) + '功能机', NB.repeat(1) + '电脑', '服装'])
    eq('扁平控件只取叶子', treeOpts.leaf.map((n) => n.label), ['智能机', '功能机', '电脑', '服装'])
    eq('起始节点只取子树', treeOpts.sub.map((n) => n.label), ['手机', '电脑'])
    check('起始节点不存在时返回空而不是整棵树', treeOpts.missingRoot.length === 0,
      JSON.stringify(treeOpts.missingRoot))

    console.log('\n【选项解析：值类型与平铺字典】')
    eq('valueType=int 把值转成数字', treeOpts.int.map((n) => n.value), [1, 2])
    check('valueType=int 结果确实是 number 类型',
      treeOpts.int.every((n) => typeof n.value === 'number'), JSON.stringify(treeOpts.int))
    eq('valueType=bool 把值转成布尔', treeOpts.bool.map((n) => n.value), [false, false])
    eq('平铺字典保持原样不拼路径', treeOpts.flat.map((n) => n.label), ['甲', '乙'])
    eq('未配置字典时返回空选项', treeOpts.empty, [])

    // ---------- applyDictSource ----------
    console.log('\n【运行时注入：写到正确的属性路径】')
    const applied = await page.evaluate(async () => {
      const m = await import('/src/components/FormCreate/src/utils/dictSource.ts')
      const src = { dictType: 'xpy_flat', valueType: 'str' }
      const rules = [
        { type: 'select', field: 's', props: { dictSource: src } },
        { type: 'radio', field: 'r', props: { dictSource: src } },
        { type: 'checkbox', field: 'c', props: { dictSource: src } },
        { type: 'cascader', field: 'cas', props: { dictSource: src } },
        { type: 'elTreeSelect', field: 'ts', props: { dictSource: src } },
        { type: 'tree', field: 't', props: { dictSource: src } },
        { type: 'input', field: 'i', props: { dictSource: src } },
        { type: 'select', field: 'plain', props: {}, options: [{ label: '原有', value: 'x' }] },
        { type: 'row', children: [{ type: 'select', field: 'nested', props: { dictSource: src } }] },
        { type: 'group', field: 'sub', props: { rule: [{ type: 'select', field: 'inSub', props: { dictSource: src } }] } }
      ]
      m.applyDictSource(rules)
      const by = (f) => rules.find((r) => r.field === f)
      return {
        select: (by('s').options || []).map((o) => o.label),
        radio: (by('r').options || []).map((o) => o.label),
        checkbox: (by('c').options || []).map((o) => o.label),
        cascader: (by('cas').props.options || []).map((o) => o.label),
        treeSelect: (by('ts').props.data || []).map((o) => o.label),
        tree: (by('t').props.data || []).map((o) => o.label),
        inputUntouched: by('i').options === undefined && by('i').props.options === undefined,
        plainUntouched: (by('plain').options || []).map((o) => o.label),
        nested: (rules[8].children[0].options || []).map((o) => o.label),
        inSubTable: (rules[9].props.rule[0].options || []).map((o) => o.label)
      }
    })

    eq('select 写入 options', applied.select, ['甲', '乙'])
    eq('radio 写入 options', applied.radio, ['甲', '乙'])
    eq('checkbox 写入 options', applied.checkbox, ['甲', '乙'])
    eq('cascader 写入 props.options', applied.cascader, ['甲', '乙'])
    eq('elTreeSelect 写入 props.data', applied.treeSelect, ['甲', '乙'])
    eq('tree 写入 props.data', applied.tree, ['甲', '乙'])
    check('不支持字典的控件不被改动', applied.inputUntouched)
    eq('没配字典的控件保留原有选项', applied.plainUntouched, ['原有'])
    eq('布局容器内的控件被递归处理', applied.nested, ['甲', '乙'])
    eq('子表控件内的控件被递归处理', applied.inSubTable, ['甲', '乙'])

    // ---------- 设计器接线 ----------
    //
    // 设计器页面是四步向导，form-create 只在第 3 步挂载，要走到那里得先填完
    // 数据源和主表。与其在 e2e 里复刻一遍向导流程（脆且慢），不如直接验证接线契约：
    // 六个内置控件是否都被注册了「数据字典」配置项、参数对不对。
    console.log('\n【设计器接线】')
    const wiring = await page.evaluate(async () => {
      const m = await import('/src/components/FormCreate/src/config/useDictOptionSource.ts')
      const calls = []
      // 用一个假的 designer 顶替，只记录它收到了什么
      const fakeDesigner = {
        value: {
          setComponentRuleConfig: (name, ruleFn, append) => {
            calls.push({ name, append, rule: ruleFn() })
          },
          getRule: () => []
        }
      }
      m.useDictOptionSource(fakeDesigner).buildDictOptionSource()
      return calls
    })

    eq('六个内置选项类控件都被接上字典数据源', wiring.map((c) => c.name),
      ['select', 'radio', 'checkbox', 'cascader', 'elTreeSelect', 'tree'])
    check('全部以追加方式注册，不覆盖内置属性面板', wiring.every((c) => c.append === true))
    check('注册的是 DictSourceConfig 配置项',
      wiring.every((c) => c.rule[0]?.type === 'DictSourceConfig'))
    check('写入路径为 rule.props.dictSource',
      wiring.every((c) => c.rule[0]?.field === 'formCreateProps>dictSource'),
      JSON.stringify(wiring.map((c) => c.rule[0]?.field)))
    eq('层级类控件标记为 treeMode',
      wiring.filter((c) => c.rule[0]?.props?.treeMode).map((c) => c.name),
      ['cascader', 'elTreeSelect', 'tree'])

    // 全局注册靠组件的 name（plugins/formCreate/index.ts 用 app.component(component.name)），
    // name 丢了会静默注册失败，属性面板上就是一片空白
    const compName = await page.evaluate(async () => {
      const mod = await import('/src/components/FormCreate/src/components/DictSourceConfig.vue')
      return mod.default?.name || mod.default?.__name
    })
    check('DictSourceConfig 具备可注册的组件名', compName === 'DictSourceConfig', `name=${compName}`)

    // 设计器预览态：配完字典要能立刻看到选项，否则没法验证配置是否正确
    const preview = await page.evaluate(async () => {
      const m = await import('/src/components/FormCreate/src/config/useDictOptionSource.ts')
      const rules = [{ type: 'select', field: 's', props: { dictSource: { dictType: 'xpy_flat' } } }]
      const fakeDesigner = { value: { setComponentRuleConfig: () => {}, getRule: () => rules } }
      const changed = m.useDictOptionSource(fakeDesigner).previewDictSource()
      return { changed, labels: (rules[0].options || []).map((o) => o.label) }
    })
    check('设计器预览态也会解析字典选项', preview.changed === true)
    eq('预览态解析出的选项正确', preview.labels, ['甲', '乙'])

    check('页面无 JS 报错', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
    for (const t of ['xpy_cat', 'xpy_flat']) {
      for (const d of (await api('GET', '/system/dict-data/tree-list', { token, params: { dictType: t } })).data) {
        await api('DELETE', '/system/dict-data/delete', { token, params: { id: d.id, cascade: 'true' } })
      }
    }
    await api('DELETE', '/system/dict-type/delete', { token, params: { id: catId } })
    await api('DELETE', '/system/dict-type/delete', { token, params: { id: flatId } })
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
