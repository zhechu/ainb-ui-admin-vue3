import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 契约的两份副本是否真的一致
 *
 * <h3>🔴 这条 spec 补的是 `SYNC.md` 里明写着「没有」的那一个</h3>
 * 后端 {@code enlev-module-infra/src/main/resources/form-design/SYNC.md} 原先说得很清楚：
 * 「前端副本漂移没有任何自动化拦截」、「后端改了、忘了复制，今天**不会有任何测试变红**」。
 * 而本仓有 4 处注释把一条并不存在的 e2e 当成守卫来引用：
 * {@code contracts/index.ts}、{@code contracts/cellFormat.ts}（那份引的是同样不存在的
 * {@code cell-format-contract-sync.spec.ts}）、{@code FormCreate/src/config/useMaskRule.ts}，
 * 以及 {@code agent/workflow/editor/nodeIoContract.ts} —— 最后这处甚至把它当成「先例」推荐照抄。
 * 四处都已改成指向本文件，后端 {@code SYNC.md} 与两个 Java 注释里同一套说法也一并更正。
 *
 * <h3>为什么是 vitest 而不是一条 e2e</h3>
 * 那几处注释设想的形状是「打运行中的后端 {@code GET /infra/form-design/widget-contracts}、
 * 与本地副本 diff」。但本仓 {@code playwright.config.ts} 与 {@code tests/} 都不存在，
 * {@code pnpm test:e2e} 必然失败；而且那个形状还要求比对时后端正好起着。
 * 直接读两个仓的磁盘文件不需要任何服务在跑，也就真的能被 {@code pnpm test:unit} 带上。
 *
 * <h3>🔴 比的是<b>解析后的 JSON</b>，不是字节</h3>
 * 前端工作副本是 CRLF、后端规范副本是 LF（{@code core.autocrlf = true} 的产物，
 * 入库后两边都是 LF）。比字节会让这条 spec <b>恒红</b>，而恒红的守卫等于没有守卫 ——
 * 下一个人会直接把它加进忽略清单，真漂移反而混在里面过去了。
 *
 * <h3>⚠️ 兄弟仓没检出时是 skip，不是 pass</h3>
 * 三个仓是各自独立的 git 仓库、并列在同一个父目录下（见仓库根 {@code AGENTS.md}）。
 * 只检出了前端的那一份工作区里比不了，此时 skip 并打印一行说明 ——
 * vitest 会把 skip 显式报出来，不会看起来像通过。
 * 但下面那条「前端副本自身是合法契约」的用例<b>永远都跑</b>，
 * 免得整个文件在某种检出形态下一条断言都不执行、却报绿。
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
  throw new Error(`从 ${HERE} 往上 12 层没找到仓库根 ⟹ 路径口径坏了，守卫会变成假绿`)
}

const FRONTEND_DIR = HERE
const CONTRACT_FILES = ['form-widget-contracts.json', 'cell-format-contracts.json'] as const

/** 后端规范副本所在目录；兄弟仓没检出时是 null */
function backendDir(): string | null {
  const candidate = join(
    dirname(repoRoot()),
    'ainb',
    'enlev-module-infra',
    'src',
    'main',
    'resources',
    'form-design'
  )
  return existsSync(candidate) ? candidate : null
}

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'))

/**
 * 逐路径列出两处 JSON 的差异
 *
 * 🔴 只报「不相等」是不够的：契约有 63 个控件、每个几十个字段，
 *    一句 expect(...).toEqual(...) 打出来的 diff 有几千行，没人会从里面找到那一个改漏的键。
 *    这里把差异压成 {@code widgets[7].props[2].name: "a" => "b"} 这种能直接照着改的形状。
 */
function diffPaths(a: any, b: any, path = ''): string[] {
  const out: string[] = []
  if (a === b) return out
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i++) out.push(...diffPaths(a[i], b[i], `${path}[${i}]`))
    return out
  }
  const bothObjects =
    a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)
  if (bothObjects) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      out.push(...diffPaths(a[key], b[key], path ? `${path}.${key}` : key))
    }
    return out
  }
  out.push(`${path || '(根)'}: ${JSON.stringify(a)} => ${JSON.stringify(b)}`)
  return out
}

describe('控件契约的前后端两份副本', () => {
  const backend = backendDir()

  /**
   * 🔴 这一条<b>永远都跑</b>，与兄弟仓在不在无关。
   *
   * 它守的不是「两份一致」，而是「前端这一份本身还能用」：
   * {@code contracts/index.ts} 在**模块加载期**就读 {@code structural.subTableWidgetType}
   * 这类结构性事实，一个缺键的契约不会报错，而是让一批同步函数拿到 {@code undefined}
   * 继续跑下去 —— 表现是子表控件认不出来、富文本清洗整段跳过，全都静默。
   */
  it('前端副本自身是一份合法契约', () => {
    for (const file of CONTRACT_FILES) {
      const json = readJson(join(FRONTEND_DIR, file))
      expect(typeof json.contractVersion, `${file} 缺 contractVersion`).toBe('number')
    }

    const widgets = readJson(join(FRONTEND_DIR, 'form-widget-contracts.json'))
    expect(Array.isArray(widgets.widgets)).toBe(true)
    expect(widgets.widgets.length).toBeGreaterThan(0)
    for (const w of widgets.widgets) {
      // 少任何一个，contracts/index.ts 的派生函数都会静默返回 undefined / false
      expect(typeof w.type, `控件缺 type：${JSON.stringify(w).slice(0, 80)}`).toBe('string')
      expect(typeof w.valueType, `控件 ${w.type} 缺 valueType`).toBe('string')
      expect(typeof w.storage, `控件 ${w.type} 缺 storage`).toBe('string')
    }
    expect(typeof widgets.structural?.subTableWidgetType).toBe('string')
    expect(typeof widgets.structural?.subFieldSeparator).toBe('string')
    expect(typeof widgets.structural?.delimitedSeparator).toBe('string')
  })

  const skipped = !backend

  it.skipIf(skipped)('两份 form-widget-contracts.json 逐字段一致', () => {
    const front = readJson(join(FRONTEND_DIR, 'form-widget-contracts.json'))
    const back = readJson(join(backend!, 'form-widget-contracts.json'))
    const diffs = diffPaths(back, front)
    expect(diffs, hint(diffs)).toEqual([])
  })

  it.skipIf(skipped)('两份 cell-format-contracts.json 逐字段一致', () => {
    const front = readJson(join(FRONTEND_DIR, 'cell-format-contracts.json'))
    const back = readJson(join(backend!, 'cell-format-contracts.json'))
    const diffs = diffPaths(back, front)
    expect(diffs, hint(diffs)).toEqual([])
  })

  it('比不了的时候要说清楚，不能悄悄报绿', () => {
    if (!skipped) return
    console.warn(
      `[contractSync] 跳过了两份契约的比对：在 ${relative(process.cwd(), dirname(repoRoot()))}` +
        ` 下没找到 ainb/enlev-module-infra/src/main/resources/form-design。` +
        ` 只检出了前端仓时这是正常的；但如果你是在三仓并列的工作区里看到这一行，` +
        ` 说明路径口径坏了、守卫已经变成假绿。`
    )
  })
})

/** 差异清单的抬头。改契约的正确流程见后端 form-design/SYNC.md：先改规范副本，再复制到前端 */
function hint(diffs: string[]): string {
  const shown = diffs.slice(0, 20).join('\n  ')
  const more = diffs.length > 20 ? `\n  …另外 ${diffs.length - 20} 处` : ''
  return (
    `前端副本与后端规范副本对不上（左边是后端、右边是前端）：\n  ${shown}${more}\n` +
    `改法见 ainb/enlev-module-infra/src/main/resources/form-design/SYNC.md：` +
    `先改后端规范副本，再原样复制到前端，不要在前端直接编辑 JSON。`
  )
}
