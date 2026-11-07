import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 守卫：qlzg 的模板正文里不得出现「渲染出来给人看、却渲染不出来」的记号
 *
 * ## 为什么要这条守卫
 * `.vue` 的 `<template>` 段是 HTML，不是 Markdown。写在那里的 `**加粗**` 会**逐字**
 * 显示成两对星号，`🔴` / `⚠️` 会显示成一个红点与一个警告三角 —— 而这两个符号在本仓
 * 是**写给下一个改代码的人**的标记（AGENTS.md 与全部 Java 注释都用它标「这里有坑」），
 * 出现在评估师眼前的界面上时它什么都不表示，只让文案看起来像一份没排好版的草稿。
 *
 * I2-g 交付时实测有 **17 处**这样的记号落在 5 个案例页的模板正文里
 * （CaseForm / CaseImportForm / case 台账 / 召回页 / 召回面板），
 * 全部是「注释里的强调顺手写进了可见文案」。它不报错、不影响功能、
 * 单元测试全绿，只有真打开页面才看得见 —— 而那几页要到建完菜单才点得到。
 *
 * ## 正确写法
 *  · 界面文案里的强调 → `<b>加粗</b>`（Element Plus 的 `form-hint` 那一类小字同样适用）
 *  · 「这里有坑」的标记 → 只写进 `<!-- -->` 注释或 `<script>` 的 JSDoc，
 *    那两处不进 DOM，符号照旧对下一个人有用
 *
 * ## 🔴 为什么必须数 `<template>` 的**嵌套深度**，而不是「第一个 `</template>` 就算结束」
 * 插槽写法 `<template #default>` … `</template>` 在本仓每一张表格里都有若干个。
 * 第一版扫描器就是按「遇到 `</template>` 就离开模板段」写的，
 * 于是它在第一个插槽结束的地方**永久停止扫描** ——
 * 实测那样只能扫出 8 处，漏掉的 9 处里包括召回页那句
 * 「召回的入参**只有一个标的编号**」，而它恰好是用户最先看到的一行。
 * 漏报的这一版还**全绿**，比没有守卫更坏。下面 `nestedSlotsAreStillScanned` 专门钉这个洞。
 *
 * ## ⚠️ 刻意只扫 qlzg，不扫全仓
 * 上游（yudao）那几百个页面里有同类写法，改它们既不属于本迭代、也会把 diff 撑到没法审。
 * 全域禁令要靠「零白名单」才立得住（见 `src/utils/commentLineRefBan.spec.ts` 那条同类守卫），
 * 而为上游残留建一份文件白名单，正好是新违规藏身的地方。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

/** 从本文件往上找仓库根（认 `vitest.config.ts` + `package.json` 同时存在） */
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

/**
 * 产出「只含模板可见正文」的**等行**视图：`<template>` 段之外、以及 `<!-- -->` 注释正文
 * 一律抹成空行，行数与原文件一致 ⟹ 报告里的行号可以直接点开。
 *
 * 🔴 跨行注释用一个 sticky 的 `inComment` 标志处理：本仓的模板注释动辄三四行，
 *    只按「本行有没有 `<!--`」判会把注释的后半截当成正文报出来。
 * 🔴 跨行的**闭合标签**同样要 sticky（`pendingClose`）：Prettier 会把行尾放不下的
 *    `</template>` 拆成 `</template` + 换行 + `>`（本仓实测 7 个文件是这个形状，
 *    且它是 Prettier 的**稳定输出**，`--write` 不会改回去）。逐行匹配 `</template>`
 *    数不到它 ⟹ 深度永不归零 ⟹ 整个 `<script>` 段被当成模板正文，
 *    JSDoc 里每一个 🔴 与 `**` 都成了违规（实测一份弹层报出 30 处假违规）。
 *    假违规比漏报更坏：一个在健康文件上恒红的守卫，会被下一个人连规则一起删掉。
 */
export function renderedView(raw: string): string {
  const out: string[] = []
  let depth = 0
  let inComment = false
  let pendingClose = false
  for (const line of raw.split('\n')) {
    let text = line
    if (inComment) {
      const end = text.indexOf('-->')
      if (end < 0) {
        pendingClose = false
        out.push('')
        continue
      }
      text = text.slice(end + 3)
      inComment = false
    }
    const parts = text.split('<!--')
    let kept = parts[0]
    for (let p = 1; p < parts.length; p++) {
      const end = parts[p].indexOf('-->')
      if (end < 0) {
        inComment = true
        break
      }
      kept += parts[p].slice(end + 3)
    }
    // 上一行以 `</template` 收尾时，那个 `>` 落在本行行首
    let carried = 0
    if (pendingClose) {
      pendingClose = false
      if (/^\s*>/.test(kept)) {
        carried = 1
        kept = kept.replace(/^\s*>/, '')
      }
    }
    const opens = (kept.match(/<template[\s>]/g) || []).length
    const closes = (kept.match(/<\/template\s*>/g) || []).length + carried
    if (/<\/template\s*$/.test(kept)) pendingClose = true
    const wasInside = depth > 0
    depth = Math.max(0, depth + opens - closes)
    if (!wasInside && opens === 0) {
      out.push('')
      continue
    }
    // 末尾那个 `>?` 是为了把拆行后只剩 `</template` 的半截标签也抹掉
    out.push(kept.replace(/<\/?template\b[^>]*>?/g, ''))
  }
  return out.join('\n')
}

/**
 * 判违规的三种形状
 *
 * 🔴 `⚠` 不带变体选择符也要拦：`⚠` 与 `⚠️` 在编辑器里长得几乎一样，
 *    只匹配带 `U+FE0F` 的那一个会漏掉另一种输入法打出来的。
 * 🔴 `**` 一律算违规，不给「也许是乘方」留口子：模板正文里的乘方只可能写在
 *    `{{ }}` 表达式里，而 qlzg 没有一处这么用；真出现了，改成 `Math.pow` 也不亏。
 */
const BANNED = /🔴|⚠|\*\*/

export type Violation = { file: string; line: number; text: string }

/** 扫一份源码，返回模板可见正文里的违规 */
export function renderedMarksIn(raw: string, file = '<snippet>'): Violation[] {
  const view = renderedView(raw)
  const out: Violation[] = []
  view.split('\n').forEach((line, idx) => {
    if (!BANNED.test(line)) return
    out.push({ file, line: idx + 1, text: line.trim().slice(0, 140) })
  })
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

describe('🔴 qlzg 模板正文里禁止出现渲染不出来的记号', () => {
  it('全域 src/views/qlzg：模板可见正文不得出现 🔴 / ⚠ / **', () => {
    const root = repoRoot()
    const files = collectVue(join(root, 'src', 'views', 'qlzg'))
    // 🔴 域自检：目录挪走 / 路径写错时 collect 返回空，禁令会变成永远通过的空测试。
    //    下限**跟着交付往上棘**：写这条守卫时（I3-g-3）实测 21 个页面、下限定在 18，
    //    而 I4-g / I5-g / I6-b 又加了三批，2026-11-04 实测已是 54 个 ——
    //    🔴 下限留在 18 的话，一次「扫描口径悄悄少扫了三十几个文件」照样全绿。
    //    所以每交付一批页面就把这个数往上抬到「实测值减一点余量」，别只加文件不改下限
    expect(
      files.length,
      `src/views/qlzg 只扫到 ${files.length} 个 .vue（2026-11-04 实测 54）⟹ 口径大概率坏了`
    ).toBeGreaterThanOrEqual(50)

    const violations: Violation[] = []
    for (const p of files) {
      const rel = relative(root, p).split(sep).join('/')
      violations.push(...renderedMarksIn(readFileSync(p, 'utf8'), rel))
    }

    expect(
      violations,
      [
        `模板正文里不得出现渲染不出来的记号 —— <template> 段是 HTML 不是 Markdown：`,
        `  · **加粗** 会逐字显示成两对星号`,
        `  · 🔴 / ⚠️ 是写给改代码的人看的「这里有坑」标记，出现在评估师眼前什么都不表示`,
        ``,
        `改成：界面强调用 <b>…</b>；「这里有坑」写进 <!-- --> 注释或 script 的 JSDoc。`,
        ``,
        `违规 ${violations.length} 处：`,
        ...violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`)
      ].join('\n')
    ).toHaveLength(0)
  })
})

describe('🔴 扫描器自检（防止「把要守的东西删掉，禁令就更绿」）', () => {
  it('正向自检：正文、属性值、插值、跨行注释之后的正文，都必须扫得出', () => {
    const cases = [
      ['<template>\n  <div>这一屏**不可跳过**</div>\n</template>', 2],
      // 属性值同样会渲染（tooltip 的 content 就是一处实测残留）
      ['<template>\n  <el-tooltip content="🔴 等于没有" />\n</template>', 2],
      // 插值表达式之外的静态文本
      ['<template>\n  <span>{{ n }} 条 ⚠ 注意</span>\n</template>', 2],
      // 跨行注释**之后**的正文：不认 sticky 注释状态就会把它当注释抹掉
      ['<template>\n  <!--\n    这是注释\n  -->\n  <div>**正文**</div>\n</template>', 5]
    ] as const
    for (const [src, line] of cases) {
      const hits = renderedMarksIn(src)
      expect(hits.length, `没扫出 ⟹ 守卫有个洞：${JSON.stringify(src)}`).toBe(1)
      expect(hits[0].line, `行号错位 ⟹ 报告会把人导向另一行：${JSON.stringify(src)}`).toBe(line)
    }
  })

  it('🔴 正向自检：嵌套插槽之后的正文必须仍在扫描范围内（第一版就是漏在这里）', () => {
    // 这一份的形状抄自真实页面：表格里一个 #default 插槽，插槽**之后**还有正文
    const src = [
      '<template>',
      '  <el-table :data="list">',
      '    <el-table-column label="a">',
      '      <template #default="scope">{{ scope.row.a }}</template>',
      '    </el-table-column>',
      '  </el-table>',
      '  <div>插槽之后的正文**不该被漏掉**</div>',
      '</template>'
    ].join('\n')
    const hits = renderedMarksIn(src)
    expect(
      hits.map((v) => v.line),
      '「遇到第一个 </template> 就离开模板段」的写法会在这里返回空 ⟹ 漏报且全绿'
    ).toEqual([7])
  })

  it('🔴 正向自检：Prettier 拆行的 `</template\\n>` 必须数得到 —— 数不到就把整个 script 段当正文', () => {
    // 这一份的形状抄自 ReviewModeChangeDialog：行内 <template v-if> 被 Prettier 拆成
    // `<template v-if="…"` + 换行 + `>`，闭合标签同样被拆成 `</template` + 换行 + `>`。
    // 这是 Prettier 的**稳定输出**（`--write` 不会改回去），本仓实测 7 个文件是这个形状。
    const src = [
      '<template>',
      '  <el-alert type="warning">',
      '    <div class="alert-text">',
      '      仅对之后新建的报告生效<template v-if="draftCount != null"',
      '        >，已在编制的 <b>{{ draftCount }}</b> 份报告不受影响</template',
      '      >。',
      '    </div>',
      '  </el-alert>',
      '</template>',
      '<script lang="ts" setup>',
      '/** 🔴 JSDoc 里的记号是**给下一个人**看的，不该被报 */',
      '</script>'
    ].join('\n')
    const hits = renderedMarksIn(src)
    expect(
      hits,
      '拆行的闭合标签没被数到 ⟹ 深度永不归零 ⟹ script 段的 JSDoc 全被当成模板正文报出来。' +
        '假违规比漏报更坏：一个在健康文件上恒红的守卫会被下一个人连规则一起删掉'
    ).toHaveLength(0)
    // 反向钉住：拆行**之内**的可见正文仍在扫描范围里（别为了归零把这一段整个抹掉）
    expect(renderedMarksIn(src.replace('份报告不受影响', '份报告**不受影响**'))[0]?.line).toBe(5)
  })

  it('反向自检：注释、script、style 三处都不得误报', () => {
    const clean = [
      '<template>',
      '  <!-- 🔴 这里的注释**不该**被报出来 -->',
      '  <!--',
      '    ⚠️ 多行注释里的记号同样不该被报',
      '  -->',
      '  <div><b>正确的强调写法</b></div>',
      '  <el-table>',
      '    <template #default="scope">',
      '      <!-- 🔴 插槽里的注释也不该被报 -->',
      '      <span>{{ scope.row.x }}</span>',
      '    </template>',
      '  </el-table>',
      '</template>',
      '<script lang="ts" setup>',
      '/** 🔴 JSDoc 里的记号是**给下一个人**看的，不该被报 */',
      'const a = 2 ** 3',
      '</script>',
      '<style lang="scss" scoped>',
      '/* 🔴 样式注释同样不该被报 */',
      '.a { font-weight: bold; }',
      '</style>'
    ].join('\n')
    // 🔴 先证明这份用例**非空过**：模板段里必须真的留下了可见正文，
    //    否则「0 处违规」毫无意义（反向自检最容易烂成恒绿）
    expect(
      renderedView(clean).replace(/\s/g, ''),
      '这份用例压根没进模板视图 ⟹ 下面那条「0 处违规」是恒绿的'
    ).not.toBe('')
    expect(renderedMarksIn(clean)).toHaveLength(0)
  })

  it('🔴 自检：目录不存在时 collect 必须返回空 —— 这正是上面那条下限要挡的静默失效', () => {
    const root = repoRoot()
    expect(collectVue(join(root, 'src', 'views', '__definitely_absent__'))).toHaveLength(0)
  })

  it('🔴 自检：本文件自己不在扫描范围内（它是 .ts，且守卫只扫 .vue）', () => {
    // 举例都放在字符串字面量里，但本文件压根不是 .vue ⟹ collectVue 不会收到它。
    // 把这条性质钉住：哪天把扫描范围放宽到 .ts，本文件里那些举例就会撞自己这条禁令
    const root = repoRoot()
    const self = relative(root, fileURLToPath(import.meta.url))
      .split(sep)
      .join('/')
    expect(self.endsWith('.vue')).toBe(false)
    expect(collectVue(join(root, 'src', 'views', 'qlzg')).some((p) => p.endsWith('.spec.ts'))).toBe(
      false
    )
  })
})
