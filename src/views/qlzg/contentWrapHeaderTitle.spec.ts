import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 守卫：`<ContentWrap>` 用了 `#header` 插槽，就必须同时传 `title` prop
 *
 * ## 为什么这条值得一个守卫
 * `ContentWrap.vue` 的头部是这么写的：
 *
 *     <template v-if="title" #header> … <slot name="header" /> … </template>
 *
 * `v-if="title"` gate 住的是**整个 el-card 头部**，插槽内容跟它一起消失。
 * 于是「忘记传 title」的后果不是少一行标题，而是**头部那排按钮全部不渲染** ——
 * 不报错、不告警、HTTP 200、页面看着完全正常，只有用户发现自己回不去上一页。
 *
 * I3-g-5 端到端走查时实测中招 **3 处**（`calculation/index.vue`、`calcResult/index.vue`、
 * `case/recall/index.vue`）：三个页面都写了 `<template #header>` 放按钮，
 * 又都在插槽里自己写了个 `<span>测算</span>` 当标题，于是都没传 `title` prop。
 * 丢掉的是「发起测算 / 去定值 / 刷新 / 回标的台账 / 重新召回」——
 * 其中「回标的台账」是那三页**唯一**的出口（三个菜单都是 `visible = false`）。
 *
 * 这三页在 I3-g-3 / I3-g-4 交付时都跑过 `ts:check` 与 `pnpm lint`，两个都绿：
 * 插槽名拼错、prop 漏传，在类型与 lint 层面都是合法的 Vue。
 *
 * ## 正确写法
 * `title` 传给 ContentWrap，插槽里**只放按钮**（标题文字由 ContentWrap 自己渲染，
 * 插槽里再写一遍会出现两个标题）。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function repoRoot(): string {
  let d = HERE
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(d, 'vitest.config.ts')) && existsSync(join(d, 'package.json'))) return d
    const up = dirname(d)
    if (up === d) break
    d = up
  }
  throw new Error(`从 ${HERE} 往上 12 层没找到仓库根 ⟹ 扫描口径坏了，守卫会变成假绿`)
}

export type Violation = { file: string; line: number; tag: string }

/** HTML 空元素：没有闭合标签，不能让它把深度加上去 */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
])

/**
 * 一次扫出一个记号：注释 / 闭合标签 / 开始标签。注释必须排在最前，
 * 否则 `<!-- <ContentWrap> -->` 这种举例会被当成真标签
 */
const TOKEN =
  /<!--[\s\S]*?-->|<\/([A-Za-z][-\w.]*)\s*>|<([A-Za-z][-\w.]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)\s*>/g

/**
 * 扫一份源码，返回「用了 #header 却没传 title」的 ContentWrap
 *
 * 🔴 **必须数嵌套深度**，只把 `<ContentWrap …>` 到 `</ContentWrap>` 之间整段切出来判是不够的。
 *    实测反例：`src/views/crm/contract/config/index.vue` 与 `crm/customer/poolConfig/index.vue`
 *    都是 `<ContentWrap>` 里套一个 `<el-card shadow="never">`，而那个 `<template #header>`
 *    属于**里面的 el-card**（el-card 的头部不 gate 在 title 上，所以那两页是好的）。
 *    整段切出来判会把它们报成违规 —— 而一条对着两个正常页面恒红的守卫，
 *    下一个人会直接删掉它，连同它守的那三页一起。
 *    所以判据是「`<template #header>` 出现在 ContentWrap 的**直接子级**（深度 0）」。
 * 🔴 属性里认 `title` / `:title` 两种；`v-bind="obj"` 这种整体展开刻意不认 ——
 *    它到底有没有 title 只有运行期知道，而本仓没有一处这么用。
 */
export function headerWithoutTitle(raw: string, file = '<snippet>'): Violation[] {
  const out: Violation[] = []
  const open = /<ContentWrap\b/g
  let m: RegExpExecArray | null
  while ((m = open.exec(raw)) !== null) {
    const tagEnd = raw.indexOf('>', m.index)
    if (tagEnd < 0) continue
    const attrs = raw.slice(m.index, tagEnd + 1)
    // 自闭合（`<ContentWrap />`）没有插槽内容，不参与判定
    if (/\/>\s*$/.test(attrs)) continue

    let depth = 0
    let headerSlot = false
    TOKEN.lastIndex = tagEnd + 1
    let t: RegExpExecArray | null
    while ((t = TOKEN.exec(raw)) !== null) {
      if (t[0].startsWith('<!--')) continue
      if (t[1] !== undefined) {
        // 闭合标签：ContentWrap 自己的那一个把深度打到 -1，扫描到此为止
        if (t[1] === 'ContentWrap' && depth === 0) break
        depth = Math.max(0, depth - 1)
        continue
      }
      const name = t[2]
      const tagAttrs = t[3] || ''
      const selfClosing = t[4] === '/' || VOID_TAGS.has(name.toLowerCase())
      if (depth === 0 && name === 'template' && /(^|\s)#header\b/.test(tagAttrs)) {
        headerSlot = true
      }
      if (!selfClosing) depth++
    }

    if (!headerSlot) continue
    if (/(^|\s):?title\s*=/.test(attrs)) continue
    out.push({
      file,
      line: raw.slice(0, m.index).split('\n').length,
      tag: attrs.replace(/\s+/g, ' ').trim().slice(0, 100)
    })
  }
  return out
}

function collectVue(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (e.name.endsWith('.vue')) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

/**
 * 🔴 这条守卫扫**全仓 `src/`**，不像 `renderedMarkdownBan.spec.ts` 那样只扫 qlzg。
 * 那条守卫收窄是因为上游有几百处同类残留、建白名单正好给新违规藏身；
 * 这一条不需要白名单 —— 修完 qlzg 那三页之后全仓 0 处违规。
 * 上游另有两页（`crm/contract/config`、`crm/customer/poolConfig`）也同时出现
 * `<ContentWrap>` 与 `#header>`，但那个插槽属于**里面套的 el-card**，不是 ContentWrap 的
 * （el-card 的头部不 gate 在 title 上，那两页是好的）—— 这正是上面那条深度判据存在的原因。
 */
describe('🔴 ContentWrap 用了 #header 插槽就必须传 title', () => {
  it('全域 src/：不得存在「有 #header 插槽、无 title prop」的 ContentWrap', () => {
    const root = repoRoot()
    const files = collectVue(join(root, 'src'))
    expect(
      files.length,
      `src 只扫到 ${files.length} 个 .vue ⟹ 口径大概率坏了，守卫会变成假绿`
    ).toBeGreaterThan(500)

    const withHeader: string[] = []
    const violations: Violation[] = []
    for (const p of files) {
      const raw = readFileSync(p, 'utf8')
      const rel = relative(root, p).split(sep).join('/')
      if (/<ContentWrap\b/.test(raw) && /<template\s+#header\b/.test(raw)) withHeader.push(rel)
      violations.push(...headerWithoutTitle(raw, rel))
    }

    // 🔴 非空转自检：全仓至少有 qlzg 那三页 + 上游 crm 那两页同时出现
    //    `<ContentWrap>` 与 `<template #header>`（crm 那两处的插槽属于里层 el-card，不算违规）。
    //    扫描口径坏掉（比如 ContentWrap 改名、或 collect 返回空）时这条会先红，
    //    而不是让下面那条「0 处违规」变成一个恒绿的空断言
    expect(
      withHeader.length,
      `全仓只找到 ${withHeader.length} 个同时含 ContentWrap 与 #header 的文件（今天实测 5）⟹ 口径大概率坏了`
    ).toBeGreaterThanOrEqual(3)

    expect(
      violations,
      [
        `ContentWrap 的头部整块 gate 在 title 上（\`<template v-if="title" #header>\`），`,
        `漏传 title 的后果不是少一行标题，而是 #header 插槽里的按钮**全部不渲染** —— 无报错、HTTP 200。`,
        ``,
        `改成：<ContentWrap title="标题"> 且插槽里只放按钮（标题由 ContentWrap 自己渲染，别再写一遍）。`,
        ``,
        `违规 ${violations.length} 处：`,
        ...violations.map((v) => `  ${v.file}:${v.line}  ${v.tag}`)
      ].join('\n')
    ).toHaveLength(0)
  })
})

describe('🔴 扫描器自检（防止「把要守的东西删掉，禁令就更绿」）', () => {
  it('正向自检：缺 title 的三种写法都要扫得出，行号要准', () => {
    const cases = [
      // 实测中招的形状：插槽里自己写了个 <span> 当标题
      [
        '<template>\n  <ContentWrap>\n    <template #header>\n      <span>测算</span>\n    </template>\n  </ContentWrap>\n</template>',
        2
      ],
      // 换行属性：`title` 在第二行，正则要能跨行看到属性区
      ['<template>\n  <ContentWrap\n    class="mb-12px"\n  >\n    <template #header>x</template>\n  </ContentWrap>\n</template>', 2],
      // 一个文件里两个 ContentWrap，只有第二个缺 title ⟹ 只报第二个
      [
        '<template>\n  <ContentWrap title="A">\n    <template #header>a</template>\n  </ContentWrap>\n  <ContentWrap>\n    <template #header>b</template>\n  </ContentWrap>\n</template>',
        5
      ]
    ] as const
    for (const [src, line] of cases) {
      const hits = headerWithoutTitle(src)
      expect(hits.length, `没扫出 ⟹ 守卫有个洞：${JSON.stringify(src)}`).toBe(1)
      expect(hits[0].line, `行号错位 ⟹ 报告会把人导向另一行：${JSON.stringify(src)}`).toBe(line)
    }
  })

  it('反向自检：传了 title、以及 #header 属于别的组件时，都不得误报', () => {
    const clean = [
      '<template>',
      '  <ContentWrap title="结果确定">',
      '    <template #header>',
      '      <el-button>回标的台账</el-button>',
      '    </template>',
      '  </ContentWrap>',
      '  <ContentWrap :title="dynamicTitle">',
      '    <template #header>b</template>',
      '  </ContentWrap>',
      '  <!-- 没有头部插槽的 ContentWrap（qlzg 那几张列表页就是这个形状）-->',
      '  <ContentWrap>',
      '    <el-form>搜索栏</el-form>',
      '  </ContentWrap>',
      '  <Dialog title="x">',
      '    <template #header>对话框自己的头部</template>',
      '  </Dialog>',
      // 🔴 实测反例的形状（抄自 crm/contract/config/index.vue）：
      //    ContentWrap 里套一个 el-card，`#header` 是 el-card 的插槽。
      //    el-card 的头部不 gate 在 title 上，所以这一页是好的，不得报
      '  <ContentWrap>',
      '    <el-form>',
      '      <el-card shadow="never">',
      '        <template #header>',
      '          <CardTitle title="合同配置设置" />',
      '        </template>',
      '      </el-card>',
      '    </el-form>',
      '  </ContentWrap>',
      '</template>'
    ].join('\n')
    // 🔴 先证明这份用例里**确实**有 ContentWrap + #header 的组合，
    //    否则「0 处违规」毫无意义（反向自检最容易烂成恒绿）
    expect(headerWithoutTitle(clean.replace(' title="结果确定"', ''))).toHaveLength(1)
    expect(headerWithoutTitle(clean)).toHaveLength(0)
  })

  it('🔴 自检：目录不存在时 collect 必须返回空 —— 这正是上面那条下限要挡的静默失效', () => {
    const root = repoRoot()
    expect(collectVue(join(root, 'src', '__definitely_absent__'))).toHaveLength(0)
  })
})
