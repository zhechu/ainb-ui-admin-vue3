import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 守卫：注释里不得写死「源码位置 = 标识符 + 冒号 + 行号」这种引用（E4 的强制点）
 *
 * ## 为什么要这条守卫
 * 注释里钉的行号会随代码增删而漂移，漂了之后比没写还坏 —— 它把读者精准地导向一个
 * **已经不是当初那处**的位置，还带着「有出处」的可信度。E4 在前端 `src` + `tests`
 * 实测到 84 处这种引用（53 处冒号前有标识符、31 处是光一个冒号），漂移**已经真实发生**：
 *   · 指到别处的：`WorkflowDslValidator` 那组 V14 判据，原写的一千三百二十一行附近
 *     如今是一千七百一十行，而原行号上躺着的是另一条完全不相干成员的 javadoc
 *   · 漂了几百行的：本仓某处「本文件两百五十七到二百七十二行」实指三百五十八到三百七十三行
 *   · 前提已经不成立的：`prompt-template-chat-matrix.spec.ts` 原先断言 onComplete 不调
 *     typewriter 的 flush，实读产品源码是三条路径都调了 —— 行号漂不漂反倒是次要的
 * 也测到**没漂**的反例（`HitlBpmApprovalNodeExecutor` 的两处、chat-matrix 开头那处），
 * 说明漂不漂纯看运气 —— 而「纯看运气」正是不该写行号的理由。
 *
 * ## 正确写法（换成不随增删漂移的锚点）
 *   · 指向某成员        → 写「类#成员」，例如 `AssistantChat.vue` 的 applyChatEvent
 *   · 指向类级注释的一段 → 写「类注释『节名』那一节」
 *   · 指向界面元素       → 写 data-testid，例如 `sandbox-drawer` 那个抽屉
 *   · 描述枚举/编码值    → 用等号而不是冒号（冒号会被本守卫当成位置引用）
 *
 * ## 🔴 为什么扫两种形状，而不只是「标识符 + 冒号 + 行号」
 * 第一版扫描器（以及后端那条同源守卫）要求冒号前有标识符，于是**结构性地漏掉**了另一类：
 * 括号里光一个冒号、「本文件 冒号 行号」这种。这类没有标识符可 grep，漂了之后连
 * 「该搜哪个符号」都无从下手，恰恰是最该被守住的。E4 第二批补的就是这 31 处。
 * 下面 `scannerFlagsBareColonShape` 是一条专门钉住这个洞的负控。
 *
 * ## 🔴 为什么必须用真正的注释状态机，而不是「行前缀粗判」
 * 「整行以注释符开头就跳过」会两头错：行尾注释（`const x = 1; // 见某处`）不以注释符开头 → 漏掉；
 * 而字符串正文里的同款形状又会被误当违规。故这里跑一遍**等长**字符状态机（见 `commentView`），
 * 只保留注释正文，于是报告里的行号与原文件完全对齐。
 * 状态机还**必须识别正则字面量**：本仓 e2e 里有 `path.replace(/\//g, ...)`，那个正则字面量
 * 含有两个连续的斜杠 —— 不认正则就会把它当行注释起点，于是同一行右边的**代码**
 * （一个带 timeout 键的对象字面量）整段被当成注释正文报出来。这是实测踩过的。
 *
 * ## ⚠️ 为什么不能像后端那样「零白名单 + 宽正则」
 * 后端那条守卫扫的是 `src/main/java`，注释里没有 CSS；本仓的 `.vue` 注释里合法地钉着大量
 * **与违规同形状**的东西 —— CSS 属性（`width` 跟冒号跟百分之百）、Playwright 配置键
 * （`workers` 跟冒号跟 1）、示例对象字面量（`{a:1}`）、`dev` 跟冒号跟端口号。
 * 要在这些上面做零白名单的禁令，就得先把两类分开。做法是**收窄语法**而不是加白名单：
 * 只有「带源码扩展名的文件名 / 点或井号分隔的成员路径 / PascalCase 类名 / camelCase 方法名 /
 * 版本号式规则名」才判违规，**全小写单个单词一律放行**（`width`、`dev`、`localhost` 都在这一类）。
 * 白名单正是新违规藏身之处，所以这里一个标识符白名单都不建。
 *
 * ## ⚠️ 已知取舍（两条，都是刻意 fail-open，宁可漏报也不误报把 CI 弄红）
 *   · 全小写单个单词的引用扫不出（例如某处引用一个叫 parse 的函数再跟行号）。
 *     E4 已转换的 53 处里只有 4 处是这一形状，损失可接受；换来的是 CSS 噪声零白名单。
 *   · 光冒号那一路放行一组**封闭的**知名端口号（见 `PORT_LIKE`）。代价是「恰好指向第 80 行」
 *     这类引用会漏。端口集合是封闭的、且新增的是端口不是标识符，与「会长大的白名单」不同性质。
 *   · `.vue` 的 `<template>` 区里标签之间的纯文本被当成代码抹掉。模板正文里写行号引用的概率
 *     远低于在 script 注释里写，接受。
 *
 * ## 🔴 本文件自己也在被扫的范围内 ⟹ 上面这些注释必须先过自己这一关
 * 后端那条守卫落在 `src/test`、而它只扫 `src/main`，所以它没被自己扫到（侥幸，不是设计）。
 * 本文件在 `src` 下、且本守卫扫 `src`，所以**举例一律放进字符串字面量**（代码位，不会被扫），
 * 注释正文里只用文字描述形状。这条性质由 `guardPassesItsOwnRule` 钉住。
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

// ==================== 扫描内核 ====================

/**
 * `/` 之前最近一个非空白字符属于这一组时，只可能是正则字面量而不是除号。
 * 空串代表「文件开头」。
 */
const REGEX_ALLOWED_AFTER = new Set([
  '=',
  '(',
  ',',
  '[',
  ':',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '~',
  '^',
  '<',
  '>',
  ''
])

/**
 * 产出「只含注释正文」的**等长**视图：代码、字符串、正则字面量全抹成空格，
 * 行注释 / 块注释 / HTML 注释正文原样保留，所有换行原样保留 ⟹ 行号与原文件一致。
 */
export function commentView(raw: string): string {
  const n = raw.length
  const v = new Array<string>(n).fill(' ')
  let i = 0
  let st = 0 // 0=代码 1=行注释 2=块注释/HTML注释 3=字符串
  let q = ''
  let lastSig = ''
  while (i < n) {
    const c = raw[i]
    const d = raw[i + 1]
    if (st === 0) {
      if (c === '/' && d === '/') {
        st = 1
        v[i] = v[i + 1] = c
        i += 2
        continue
      }
      if (c === '/' && d === '*') {
        st = 2
        v[i] = v[i + 1] = c
        i += 2
        continue
      }
      if (c === '<' && raw.startsWith('<!--', i)) {
        st = 2
        for (let k = 0; k < 4; k++) v[i + k] = raw[i + k]
        i += 4
        continue
      }
      if (c === '/' && REGEX_ALLOWED_AFTER.has(lastSig)) {
        let j = i + 1
        let inClass = false
        let ok = false
        while (j < n) {
          const r = raw[j]
          if (r === '\\') {
            j += 2
            continue
          }
          if (r === '\n') break // JS 正则不跨行 ⟹ 这不是正则，退回当除号
          if (r === '[') inClass = true
          else if (r === ']') inClass = false
          else if (r === '/' && !inClass) {
            ok = true
            break
          }
          j++
        }
        if (ok) {
          i = j + 1
          lastSig = '/'
          continue
        }
      }
      if (c === '"' || c === "'" || c === '`') {
        st = 3
        q = c
        i++
        continue
      }
      if (c === '\n') {
        v[i] = c
        lastSig = ''
        i++
        continue
      }
      if (!/\s/.test(c)) lastSig = c
      i++
      continue
    }
    if (st === 1) {
      v[i] = c
      if (c === '\n') {
        st = 0
        lastSig = ''
      }
      i++
      continue
    }
    if (st === 2) {
      if (c === '*' && d === '/') {
        v[i] = v[i + 1] = c
        st = 0
        i += 2
        continue
      }
      if (raw.startsWith('-->', i)) {
        for (let k = 0; k < 3; k++) v[i + k] = raw[i + k]
        st = 0
        i += 3
        continue
      }
      v[i] = c
      i++
      continue
    }
    // st === 3：反引号模板串可以跨行，遇到未转义的同种引号才出栈
    if (c === '\\') {
      if (raw[i + 1] === '\n') v[i + 1] = '\n'
      i += 2
      continue
    }
    if (c === q) {
      st = 0
      q = ''
      lastSig = c
    } else if (c === '\n') {
      v[i] = c
      lastSig = ''
    }
    i++
  }
  return v.join('')
}

/** 源码扩展名：带它的 token 是文件名，文件名后跟冒号跟数字不可能是 CSS */
const SOURCE_EXT =
  /\.(ts|tsx|mts|js|jsx|mjs|vue|json|java|sql|md|py|sh|ya?ml|xml|css|scss|less|html|snap)$/

/**
 * 光冒号那一路放行的**封闭**端口集合。今天全仓的残留只有两个成员（前端 dev 端口与后端端口），
 * 其余是保险。🔴 这是端口表不是标识符白名单：它不会因为「又多了一处合法引用」而长大。
 */
const PORT_LIKE = new Set(['80', '443', '3000', '3306', '48080', '5173', '6379', '8080', '9222'])

/** A 型：冒号前有标识符（可含 `.` `/` `#` 分隔的成员路径） */
const RE_A = /([A-Za-z_][A-Za-z0-9_]*(?:[./#][A-Za-z_][A-Za-z0-9_]*)*)\s*:\s*(\d{1,5})(-\d{1,5})?/g
/**
 * B 型：光一个冒号跟行号。
 * 🔴 前置排除组里**不含** `/` —— 否则「括号里两个用斜杠隔开的行号」的第二个会被漏掉（实测漏过）。
 */
const RE_B = /(^|[^\w.:#-]):(\d{2,5})(-\d{1,5})?/g
/** URL 整段抹掉，免得 authority 里的 host 加端口变成假警报（与后端那条守卫同一处理） */
const RE_URL = /[A-Za-z][A-Za-z0-9+.\-]*:\/\/\S*/g
/**
 * 光冒号那一路要跳过时间戳的残段（`14:36:46` 里冒号后面那截）。
 * 🔴 用 `new RegExp` 而不是带 `i` 标志的字面量：V8 在某些位置会把 `/…/i.test(x)` 解析成
 * 「正则对象的属性 i」再 `.test`，于是运行期报 undefined 上没有 test（实测踩过）。
 */
const RE_TIME_TAIL = new RegExp('\\d\\s*:\\s*\\d*\\s*$')

/**
 * 只有这些形状才判违规 —— 它们不可能是 CSS 属性、配置键或示例对象字面量。
 * 全小写单个单词（`width`、`dev`、`localhost`）与单字母一律放行，理由见文件头「已知取舍」。
 */
function shapeIsUnambiguous(ident: string): boolean {
  if (ident.includes('#')) return true // 类#成员
  if (SOURCE_EXT.test(ident)) return true // 带源码扩展名的文件名
  if (ident.includes('.') || ident.includes('/')) return true // 点/斜杠分隔的成员路径
  if (/^V\d+$/.test(ident)) return true // 版本号式的校验规则名
  if (/^[A-Z][A-Za-z0-9]*$/.test(ident)) return true // PascalCase 类名
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(ident)) return true // camelCase 方法名 / 变量名
  return false
}

/**
 * 两条**结构性**排除（不是标识符白名单）：
 *  · 前一个字符是 `@` ⟹ 是 `@Date` / `@since` 这类文档标签名，不是位置引用
 *    （本仓 4 处残留在 `src/views/ai/music/**` 的厂商标头里）
 *  · 前面是 `{` 或 `,`、且后面是 `}` 或 `,` ⟹ 是注释里贴的示例对象字面量的键值对
 *    （实测那处是 `getDefPage` 的入参示例）。用「且」而不是「或」：
 *    圆括号里的真引用（前后是 ASCII 圆括号）不会被这条吞掉。
 */
function isStructurallyExcluded(view: string, start: number, end: number): boolean {
  if (view[start - 1] === '@') return true
  const prev = view.slice(0, start).replace(/\s+$/, '').slice(-1)
  const next = view.slice(end).replace(/^\s+/, '').slice(0, 1)
  return (prev === '{' || prev === ',') && (next === '}' || next === ',')
}

export type Violation = {
  shape: 'A' | 'B'
  file: string
  line: number
  token: string
  text: string
}

/** 对一段源码跑「注释视图 → 抹 URL → 两种形状匹配 → 结构性排除」，返回命中 */
function refsIn(snippet: string, file = '<snippet>'): Violation[] {
  const view = commentView(snippet).replace(RE_URL, (m) => ' '.repeat(m.length))
  // 🔴 按 `\n` 切、并记下每行在 view 里的**绝对起始偏移**：结构性排除要看 token 两侧的字符，
  //    必须有绝对偏移。不能用「前面各行长度 + 1」累加 —— 注释位里的 `\r` 是原样保留的，
  //    分隔符有时是 2 个字符，那样算出来在 CRLF 文件上会一路漂（本仓 AssistantChat.vue 就是 CRLF）。
  const lines: string[] = []
  const bases: number[] = []
  let cur = ''
  for (let k = 0; k < view.length; k++) {
    if (view[k] === '\n') {
      lines.push(cur)
      bases.push(k - cur.length)
      cur = ''
    } else {
      cur += view[k]
    }
  }
  lines.push(cur)
  bases.push(view.length - cur.length)

  const rawLines = snippet.split('\n').map((l) => l.replace(/\r$/, ''))
  const out: Violation[] = []
  lines.forEach((ln, idx) => {
    const base = bases[idx]
    for (const g of ln.matchAll(RE_A)) {
      const start = base + (g.index ?? 0)
      if (!shapeIsUnambiguous(g[1])) continue
      // 🔴 end 必须是**整个匹配**的末尾（数字之后），不是标识符的末尾 ——
      //    传成 `start + g[1].length` 的话 next 读到的是那个冒号，对象字面量那条排除永远不触发
      //    （实测就是这样：全仓唯一一处残留没被放行）。
      if (isStructurallyExcluded(view, start, start + g[0].length)) continue
      out.push({
        shape: 'A',
        file,
        line: idx + 1,
        token: g[0].replace(/\s+/g, ''),
        text: (rawLines[idx] ?? '').trim().slice(0, 160)
      })
    }
    for (const g of ln.matchAll(RE_B)) {
      if (PORT_LIKE.has(g[2]) && !g[3]) continue
      const head = ln.slice(0, (g.index ?? 0) + g[1].length)
      if (RE_TIME_TAIL.test(head)) continue // 时间戳 14:36:46 的残段
      out.push({
        shape: 'B',
        file,
        line: idx + 1,
        token: ':' + g[2] + (g[3] ?? ''),
        text: (rawLines[idx] ?? '').trim().slice(0, 160)
      })
    }
  })
  return out
}

function collect(root: string, exts: string[]): string[] {
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
      if (!exts.some((x) => e.name.endsWith(x))) continue
      if (e.name.endsWith('.d.ts')) continue
      out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

// ==================== 全域禁令 ====================

describe('🔴 注释里禁止写死源码位置引用（E4 守卫）', () => {
  it('全域 src + tests：注释里不得出现「标识符 + 冒号 + 行号」或光冒号跟行号', () => {
    const root = repoRoot()
    const srcFiles = collect(join(root, 'src'), ['.ts', '.vue'])
    const testFiles = collect(join(root, 'tests'), ['.ts', '.vue'])
    // 🔴 域自检：目录挪走 / 路径写错时 collect 返回空，禁令会变成永远通过的空测试。
    //    下限取自今天实测的 1434 与 103。tests 单独设下限是必要的 ——
    //    E4 的 84 处里有 31 处在 tests/e2e 下，那一半静默掉出去守卫照样全绿。
    expect(
      srcFiles.length,
      `src 只扫到 ${srcFiles.length} 个（今天实测 1434）⟹ 口径大概率坏了`
    ).toBeGreaterThanOrEqual(1100)
    // ⚠️ tests/ 已随「清理垃圾文件」那次提交被整个删掉（195 个文件连 playwright.config.ts），
    //    所以 collect 返回 0 是**真实状态**，不是口径坏了 —— 原来那条无条件下限因此长期红，
    //    把整个 test:unit 变成常红套件，新违规混在红灯里没人看得见。
    //    但探针本身绝不能删：目录若哪天回来、或 glob 被写坏，都得照样报警。
    //    故改成双向钉死 ——「目录在 ⇒ 必须够数」「目录不在 ⇒ 必须一个都没扫到」，
    //    两种坏法都会失败，规则（禁令）一个字没放宽。
    if (existsSync(join(root, 'tests'))) {
      expect(
        testFiles.length,
        `tests 目录存在却只扫到 ${testFiles.length} 个（历史实测 103）⟹ 口径大概率坏了`
      ).toBeGreaterThanOrEqual(80)
    } else {
      expect(
        testFiles.length,
        `tests 目录不存在，却扫到了 ${testFiles.length} 个文件 ⟹ collect 的路径拼错了`
      ).toBe(0)
    }

    const violations: Violation[] = []
    for (const p of [...srcFiles, ...testFiles]) {
      const rel = relative(root, p).split(sep).join('/')
      violations.push(...refsIn(readFileSync(p, 'utf8'), rel))
    }

    expect(
      violations,
      [
        `注释里不得写死源码位置引用 —— 行号会随代码增删漂移，漂了之后比没写还坏：`,
        `它把读者精准导向一个已经不是当初那处的位置，还带着「有出处」的可信度。`,
        ``,
        `正确写法（换成不漂移的锚点）：`,
        `  · 指向某成员        → 类#成员，例如 HitlBpmApprovalNodeExecutor#resolveResult`,
        `  · 指向类级注释的一段 → 类注释「节名」那一节`,
        `  · 指向界面元素       → data-testid，例如 sandbox-drawer 那个抽屉`,
        `  · 描述枚举/编码值    → 用等号，例如 type=11（冒号会被本守卫当成位置引用）`,
        ``,
        `已放行：URL 的 host 加端口、CSS 属性、示例对象字面量、@ 开头的文档标签、`,
        `        全小写单个单词、封闭端口表里的光冒号。仍被拦下说明形状确实是位置引用。`,
        ``,
        `违规 ${violations.length} 处：`,
        ...violations.map((v) => `  ${v.file}:${v.line}  [${v.shape}型 ${v.token}]  ${v.text}`)
      ].join('\n')
    ).toHaveLength(0)
  })
})

// ==================== 变异探针：证明扫描器既不太窄也不太宽 ====================

describe('🔴 扫描器自检（防止「把要守的东西删掉，禁令就更绿」）', () => {
  it('正向自检：行注释 / 块注释 / 行尾注释 / 同一行多处，都必须扫得出', () => {
    // 举例一律放在**字符串字面量**里：字符串是代码位，会被注释视图抹掉，
    // 所以本文件不会因为举了例子而撞自己那条禁令。
    expect(refsIn('// 见 WorkflowDslValidator:1309').map((v) => v.token)).toEqual([
      'WorkflowDslValidator:1309'
    ])
    expect(refsIn('/* 见 sendStream:129-140 */').map((v) => v.token)).toEqual([
      'sendStream:129-140'
    ])
    expect(refsIn('/** {@code StepTableBinding.vue:677} 那一处 */').map((v) => v.token)).toEqual([
      'StepTableBinding.vue:677'
    ])
    // 行尾注释：这正是「行前缀粗判」会漏的形状
    expect(refsIn('const x = 1; // 见 markError:1231').map((v) => v.token)).toEqual([
      'markError:1231'
    ])
    expect(
      refsIn('// AgentIntentClassifier.classify:118 与 WorkflowDslValidator#resume:365').map(
        (v) => v.token
      )
    ).toEqual(['AgentIntentClassifier.classify:118', 'WorkflowDslValidator#resume:365'])
    // HTML 注释（.vue 的 template 区）
    expect(refsIn('<!-- 见 applyChatEvent:1247 -->').map((v) => v.token)).toEqual([
      'applyChatEvent:1247'
    ])
  })

  it('🔴 正向自检：光冒号那一路必须单独扫得出（第一版扫描器就是漏在这里）', () => {
    const cases = [
      '// 见 (:1241) 与 WORKFLOW_CONFIRM(:1273)',
      '// 沙箱是一个非模态 drawer（本文件 :257-272）',
      '// V13(:1364) 与 V14(:1425/:1435) 都有它',
      '// 读到空串时下面 :191 那句本来就会跳过'
    ]
    for (const c of cases) {
      const b = refsIn(c).filter((v) => v.shape === 'B')
      expect(b.length, `光冒号形状没被扫出 ⟹ 守卫有个正好对着最易漂那类的洞：${c}`).toBeGreaterThan(
        0
      )
    }
    // 斜杠隔开的第二个行号也要扫出（前置排除组里刻意不含斜杠）
    expect(
      refsIn('// (:1425/:1435)')
        .filter((v) => v.shape === 'B')
        .map((v) => v.token)
    ).toEqual([':1425', ':1435'])
  })

  it('反向自检：字符串 / 模板串 / 正则字面量 / 代码位都不得误报', () => {
    expect(refsIn('const s = "见 Foo:123"')).toHaveLength(0)
    expect(refsIn('const s = `跨行模板串 Bar:45\n第二行`')).toHaveLength(0)
    expect(refsIn("const s = 'Baz:78'")).toHaveLength(0)
    expect(refsIn('const x = flag ? 1 : 2; map.set("k:9", v)')).toHaveLength(0)
    // 🔴 正则字面量里含两个连续斜杠：不认正则就会把同一行右边的代码当成注释正文
    expect(
      refsIn("const p = path.replace(/\\//g, '\\\\/'); expect(p).toBe('x') // 行尾无引用")
    ).toHaveLength(0)
  })

  it('反向自检：CSS / 配置键 / 示例对象字面量 / URL 端口 / 文档标签 / 全小写单词都不得误报', () => {
    // 下面每一条都是从本仓真实残留里抄来的，不是假想形状
    const noise = [
      '/* Element Plus 的 .el-select 自带 width:100%，与之同为单类选择器 */',
      '/* 右边 flex:1 的赋值输入框被挤成 0 宽 */',
      '// 按钮平时是 opacity:0，而 Playwright 认为 opacity:0 也算「可见」',
      '// describe.serial + workers:1 保证文件内顺序',
      '// el-select 找不到匹配的 option，会把原始的 key（dept:103）直接印出来',
      '// 例：target: {a:1} source:{a:2,b:3} 结果为：{a:2}',
      '// 前置（0 LLM token）：后端 48080 + 前端 dev :80 在跑。',
      '// 前端 axios 直连 :48080，所以这里必须用绝对地址',
      '// 当前页面协议 + host（如 http://localhost:8080），替换成 ws://localhost:8080',
      // 🔴 这两条**必须带上真正的注释起始符**：原先写成光秃秃的 ` * …`，
      //    于是状态机把行首的星号当代码抹掉、再把那对反引号当成模板串起点，
      //    整段压根没进注释视图 ⟹ 断言恒绿、等于没测（实测踩过，是它掩盖了上面的 end 偏移 bug）。
      '/**\n * @Date: 2024-07-19 11:13:38\n */',
      "/**\n * `getDefPage({status:'PUBLISHED', pageSize:100})`，那是按版本行分页的\n */",
      '// margin-left: 30px; 与 max-width: 240px 都是单类选择器',
      '// transition: 0s width ease-in-out',
      '// scrollbarWrap.scrollTo({ left: 0, top: 0, behavior: "auto" })'
    ]
    for (const n of noise) {
      // 🔴 先证明这条用例**非空过**：注释视图里必须真的留下了东西，否则「0 处违规」毫无意义。
      //    反向自检最容易烂成恒绿，而恒绿的负控比没有负控更坏 —— 它让人以为守住了。
      expect(commentView(n).trim(), `用例根本没进注释视图 ⟹ 这条负控是恒绿的：${n}`).not.toBe('')
      expect(refsIn(n), `被误报了 ⟹ 假警报的代价是真警报没人看：${n}`).toHaveLength(0)
    }
    // 纯数字比值 / 时间：首字符必须是字母或下划线才守得住
    expect(refsIn('// 比例 16:9，时间 12:30，坐标 3:4:5')).toHaveLength(0)
  })

  it('🔴 反向自检：结构性排除不得吞掉圆括号 / 文档内联标签里的真引用', () => {
    // 「前面是 { 或 ,、后面是 } 或 ,」用的是「且」：ASCII 圆括号里的真引用必须照报
    expect(refsIn('// 见 (markError:1231) 那处').map((v) => v.token)).toEqual(['markError:1231'])
    expect(refsIn('// 甲 Foo:11, 乙 Bar:22').map((v) => v.token)).toEqual(['Foo:11', 'Bar:22'])
    // 🔴 文档内联标签 `{@code …}` 的花括号**不是**对象字面量。这里之所以不会被误放行，
    //    是因为标识符前一个非空白字符是 code 的末字母、而不是那个左花括号 —— 把这个理由钉住，
    //    免得下一个人「顺手」把排除条件放宽成「往前找到第一个 { 就算」。
    expect(refsIn('/** {@code WorkflowDslValidator:1309} 那一处 */').map((v) => v.token)).toEqual([
      'WorkflowDslValidator:1309'
    ])
    expect(refsIn('/** {@link FormSaveDraftTool#build:88} */').map((v) => v.token)).toEqual([
      'FormSaveDraftTool#build:88'
    ])
  })

  it('🔴 自检：注释视图必须与原文件等长且换行数一致（否则报告里的行号不可信）', () => {
    const raw = [
      "import x from './y'",
      '// 行注释里有引用',
      'const s = "字符串里的不算"',
      '/* 块注释',
      '   跨行也不算代码 */',
      'const r = /\\//g',
      'const a = 1; // 行尾注释',
      '<!-- HTML 注释 -->'
    ].join('\n')
    const view = commentView(raw)
    expect(view.length, '视图必须等长（等长才能保证偏移与行号一致）').toBe(raw.length)
    expect(
      view.split('\n').length,
      '注释视图与原文件换行数不等 ⟹ 报告里的行号会错位，等于给读者又一个假出处'
    ).toBe(raw.split('\n').length)
    // 该抹的都抹了：字符串正文与正则字面量位置必须是空格
    expect(view.split('\n')[2].trim()).toBe('')
    expect(view.split('\n')[5].trim()).toBe('')
    // 该留的都留了：三种注释正文原样
    expect(view.split('\n')[1]).toContain('行注释里有引用')
    expect(view.split('\n')[6]).toContain('行尾注释')
    expect(view.split('\n')[7]).toContain('HTML 注释')
  })

  it('🔴 自检：目录不存在时 collect 必须返回空 —— 这正是上面两条下限要挡的静默失效', () => {
    const root = repoRoot()
    expect(collect(join(root, 'src', '__definitely_absent__'), ['.ts'])).toHaveLength(0)
    expect(collect(join(root, '__definitely_absent__'), ['.ts'])).toHaveLength(0)
  })

  it('🔴 自检：本文件自己也在扫描范围内，故本文件的注释必须先过自己这一关', () => {
    const root = repoRoot()
    const self = relative(root, fileURLToPath(import.meta.url))
      .split(sep)
      .join('/')
    const hits = refsIn(readFileSync(join(root, self), 'utf8'), self)
    expect(
      hits.map((v) => `${v.line} [${v.shape}型 ${v.token}] ${v.text}`),
      '守卫自己违规 ⟹ 要么规则太宽（把举例的散文也拦了），要么本文件该把举例挪进字符串字面量'
    ).toHaveLength(0)
  })
})
