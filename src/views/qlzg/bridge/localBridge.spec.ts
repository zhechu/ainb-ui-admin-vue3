import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it, beforeEach } from 'vitest'
import type { BridgeCapability } from '@/api/qlzg/bridge'
import {
  clientTypeDiagnostic,
  decide,
  desktopAlternative,
  desktopSuggestion,
  isDesktopAvailable,
  oversizeWayOut,
  relayWayOut,
  retryWayOut,
  setDesktopAvailability
} from './localBridge'

/**
 * LocalBridge 前端半边的守卫 —— 两件事：文案不许推荐一个不存在的客户端，契约不许与后端漂移
 *
 * <h3>🔴 第一件：默认状态（桌面端不可用）下，五句出路里没有一句指向桌面客户端</h3>
 * 桌面端本体在 **I23**，而上传这条路早就写好了六处「建议改用桌面客户端」。
 * 其中 {@link relayWayOut} 那处是**硬拦**：走中转且超 16 MB 时这一份就是传不上去，
 * 而它给出的唯一出路是一个用户装不到的东西 —— 反复重试、反复失败，
 * 而真正能解开的人（管理员，换成支持预签名的 S3 兼容存储）压根没被提到。
 * 这类文案不报错、不崩溃，只是让用户觉得系统在推诿，所以只能靠断言钉住。
 *
 * <h3>🔴 第二件：前端这份契约副本要与后端枚举逐字一致</h3>
 * 后端 `QlzgBridgeCapabilityEnum` 是 D14 ①「契约签名一致」的载体，而前端
 * `src/api/qlzg/bridge/index.ts` 是它的一份手抄副本。抄错一个能力码的后果是
 * 探针打到 404（本仓 404 的 HTTP 状态码是 200，`code` 在响应体里），
 * 前端拿到的是「这一项不可用」而不是「路径写错了」—— 两种答复长得一模一样。
 *
 * <h3>⚠️ 后端那份用**文本**读，不 import</h3>
 * 它跨仓、而且是 Java。前端这个 api 模块也同样用文本读：它 import 了 `@/config/axios`，
 * 那条链在模块加载期就要摸 `window`，而本仓 vitest 是 `environment: 'node'`，
 * 一旦 import 整个 spec 会在收集阶段炸掉、一条断言都跑不到。
 *
 * <h3>⚠️ 兄弟仓没检出时是 skip，不是 pass</h3>
 * 只检出前端的那份工作区里比不了，此时 skip；vitest 会把 skip 显式报出来，
 * 不会看起来像通过。但前端自身那两条（union 与 url 一致、拦截器发头）**永远跑**。
 */

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

/** 从本文件往上找前端仓根（认 `vitest.config.ts` + `package.json` 同时存在） */
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

const FRONTEND = repoRoot()

/** 后端能力枚举；兄弟仓没检出时是 null */
function backendEnumFile(): string | null {
  const candidate = join(
    dirname(FRONTEND),
    'ainb',
    'enlev-module-qlzg',
    'src',
    'main',
    'java',
    'cn',
    'enlev',
    'ainb',
    'module',
    'qlzg',
    'enums',
    'QlzgBridgeCapabilityEnum.java'
  )
  return existsSync(candidate) ? candidate : null
}

const read = (path: string): string => readFileSync(path, 'utf8')

/** 前端 api 模块（用文本读，理由见文件头） */
const apiSource = (): string => read(join(FRONTEND, 'src', 'api', 'qlzg', 'bridge', 'index.ts'))

/** 从一个 TS union 类型里抠出字面量成员 */
function unionMembers(source: string, typeName: string): string[] {
  const start = source.indexOf(`export type ${typeName}`)
  expect(start, `api 模块里没有 export type ${typeName}`).toBeGreaterThan(-1)
  const body = source.slice(start, source.indexOf('\n\n', start))
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** 从后端枚举里抠出「能力码 → degradeTo」 */
function backendCapabilities(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  // 每一项的形状是 NAME("capability", "description",\n "degradeTo", "degradeToName", …
  const pattern = /([A-Z][A-Z_]+)\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,/g
  for (const m of source.matchAll(pattern)) {
    out[m[2]] = m[4]
  }
  return out
}

/**
 * 把后端枚举切成「一项一段」
 *
 * reason 那一列跨了多行、还是用 `+` 拼的，靠「取最后一个字符串字面量」拿不到它，
 * 只能按项名切段，再在段里找关键词
 */
function enumEntries(source: string): { code: string; body: string }[] {
  const heads = [...source.matchAll(/^ {4}[A-Z][A-Z_0-9]+\("([a-z-]+)"/gm)]
  const end = source.indexOf('\n    ;')
  expect(end, '后端枚举没有以 "    ;" 结尾，切段口径坏了').toBeGreaterThan(-1)
  return heads.map((head, i) => ({
    code: head[1],
    body: source.slice(head.index!, i + 1 < heads.length ? heads[i + 1].index! : end)
  }))
}

/** 造一个信封，只填被测字段关心的部分 */
const envelope = (over: Partial<BridgeCapability> = {}): BridgeCapability => ({
  capability: 'chunk-upload',
  capabilityName: '分片流式上传',
  nativeSupported: false,
  degradeTo: 'presign-put',
  degradeToName: '预签名单次直传',
  degradeEndpoint: '/admin-api/qlzg/material/prepare',
  reason: '分片与断点续传要桌面端（I23）',
  clientType: 'web',
  clientTypeHeader: 'web',
  ...over
})

beforeEach(() => {
  // 🔴 模块级状态必须每条测试前归位：漏一次就会让下一条在「桌面端可用」的前提下跑，
  //    而那一侧的断言恰好都是 not.toContain，错了也看不出来
  setDesktopAvailability(null)
})

describe('decide：走原生还是走降级', () => {
  it('Web 端永不走原生，哪怕服务端说 nativeSupported=true', () => {
    // I23 之后服务端会对桌面端返回 true，而 Web 端拿到的是同一个 true。
    // 浏览器里没有本机实现可走，照着走就是调用失败 —— 而失败发生在客户端本机，
    // 服务端日志里什么都没有
    const decision = decide(envelope({ nativeSupported: true }), 'web')
    expect(decision.route).toBe('degrade')
    expect(decision.usable).toBe(true)
    expect(decision.degradeTo).toBe('presign-put')
  })

  it('桌面端 + 服务端说可用 → 走原生', () => {
    const decision = decide(envelope({ nativeSupported: true }), 'desktop')
    expect(decision.route).toBe('native')
    expect(decision.usable).toBe(true)
    expect(decision.degradeTo).toBeNull()
  })

  it('桌面端 + 服务端说不可用 → 仍走降级（服务端才是判据）', () => {
    const decision = decide(envelope({ nativeSupported: false }), 'desktop')
    expect(decision.route).toBe('degrade')
    expect(decision.degradeEndpoint).toBe('/admin-api/qlzg/material/prepare')
  })

  it('degradeTo=none 或没有降级端点 → 不可用（MVP 期只有 UKey 签章一项）', () => {
    const byNone = decide(envelope({ capability: 'sign-with-ukey', degradeTo: 'none' }), 'web')
    expect(byNone.route).toBe('unavailable')
    expect(byNone.usable).toBe(false)

    // 后端把 degradeEndpoint 漏成 null 时也要判成不可用：
    // 一个「有降级方式、却没有降级去处」的答复会让调用方拿到 undefined 就去发请求
    const byMissingEndpoint = decide(envelope({ degradeEndpoint: null }), 'web')
    expect(byMissingEndpoint.route).toBe('unavailable')
    expect(byMissingEndpoint.usable).toBe(false)
  })
})

describe('clientTypeDiagnostic：端标识有没有被读到', () => {
  it('一致时返回空串', () => {
    expect(clientTypeDiagnostic(envelope(), 'web')).toBe('')
  })

  it('服务端没收到这个头 → 说出来', () => {
    // 🔴 这是「X-Client-Type 名字写错了」唯一的发现时机：后端判定链认不出来时静默兜到 web，
    //    表现只是账单上某一端恒为 0，与「没人用这一端」在数据上完全一样
    const text = clientTypeDiagnostic(envelope({ clientTypeHeader: null }), 'web')
    expect(text).toContain('没收到')
    expect(text).toContain('X-Client-Type')
  })

  it('收到的值与发出去的不一样 → 说出来', () => {
    const text = clientTypeDiagnostic(envelope({ clientTypeHeader: 'desktop' }), 'web')
    expect(text).toContain('desktop')
    expect(text).toContain('改写')
  })

  it('大小写不同不算不一致（后端 equalsIgnoreCase）', () => {
    expect(clientTypeDiagnostic(envelope({ clientTypeHeader: 'WEB' }), 'web')).toBe('')
  })

  it('收到了、却判成了别的端 → 说出来', () => {
    const text = clientTypeDiagnostic(envelope({ clientType: 'desktop' }), 'web')
    expect(text).toContain('判定链')
  })
})

describe('五句出路：桌面端不存在时必须指向用户真能做的动作', () => {
  it('默认（探针没跑）就是不可用，且没有一句推荐桌面客户端', () => {
    expect(isDesktopAvailable()).toBe(false)
    for (const text of [
      desktopSuggestion(),
      desktopAlternative(),
      relayWayOut(),
      oversizeWayOut(),
      retryWayOut()
    ]) {
      expect(text).not.toContain('改用桌面客户端')
      expect(text).not.toContain('用桌面端')
    }
  })

  it('硬拦那一句指向部署侧的真解法，不是让用户去装一个还没有的东西', () => {
    expect(relayWayOut()).toContain('联系管理员')
    expect(relayWayOut()).toContain('S3 兼容存储')
    expect(oversizeWayOut()).toContain('联系管理员')
  })

  it('「，或改用桌面客户端」这个从句整个消失，不留半句连接词', () => {
    expect(desktopAlternative()).toBe('')
  })

  it('服务端说可用之后，五句都变回推荐桌面客户端', () => {
    setDesktopAvailability(envelope({ nativeSupported: true }))
    expect(isDesktopAvailable()).toBe(true)
    expect(desktopSuggestion()).toBe('建议改用桌面客户端')
    expect(desktopAlternative()).toBe('，或改用桌面客户端')
    expect(relayWayOut()).toContain('桌面客户端')
    expect(oversizeWayOut()).toContain('桌面客户端')
    expect(retryWayOut()).toContain('桌面客户端')
  })

  it('探针失败（null）之后回到不可用', () => {
    setDesktopAvailability(envelope({ nativeSupported: true }))
    expect(isDesktopAvailable()).toBe(true)
    setDesktopAvailability(null)
    expect(isDesktopAvailable()).toBe(false)
    // ⚠️ 断言的是「不再**推荐**改用桌面客户端」，不是「这句话里没有桌面客户端四个字」：
    //    诚实那一侧的措辞本身是「桌面客户端尚未发布，建议分成几次拖入」，
    //    反向断言 toContain('桌面客户端') 会被它自己那句否定式命中而恒红 ——
    //    与后端 QlzgLocalBridgeContractTest 栽过的是同一个坑。
    expect(desktopSuggestion()).not.toContain('改用桌面客户端')
    expect(desktopSuggestion()).toContain('尚未发布')
  })

  it('nativeSupported=false 的信封也算不可用（不是「拿不到」才不可用）', () => {
    setDesktopAvailability(envelope({ nativeSupported: false }))
    expect(isDesktopAvailable()).toBe(false)
  })
})

describe('前端这份契约副本自身是自洽的', () => {
  it('能力码 union 与五个 url 的最后一段一一对应', () => {
    const source = apiSource()
    const codes = unionMembers(source, 'BridgeCapabilityCode')
    expect(codes).toHaveLength(5)

    const urls = [...source.matchAll(/url: '(\/qlzg\/bridge\/[^']+)'/g)].map((m) => m[1])
    expect(urls).toHaveLength(5)
    expect(urls.map((u) => u.slice('/qlzg/bridge/'.length)).sort()).toEqual([...codes].sort())
  })

  it('降级方式 union 是方案 §13.4.4 那五种，一个不多一个不少', () => {
    expect(unionMembers(apiSource(), 'BridgeDegradeTo').sort()).toEqual(
      ['browser-download', 'none', 'presign-put', 'server-extract', 'webkitdirectory'].sort()
    )
  })

  it('🔴 axios 拦截器发的头名是 X-Client-Type（D14 定稿），值是 web', () => {
    // 头名写错的后果不是报错，是账单上某一端恒为 0 —— 而它与「没人用这一端」无法区分。
    // 这条断言与后端 QlzgClientTypeResolverTest#headerNameIsFinalizedAsXClientType 是
    // 同一个事实的两份拷贝，刻意不互相读：两边都要各自写对，才叫定稿
    const source = read(join(FRONTEND, 'src', 'config', 'axios', 'service.ts'))
    expect(source).toContain("config.headers['X-Client-Type'] = 'web'")
    expect(source).not.toContain('X-Enlev-Client')
  })

  it('🔴 探针不带请求体，不兜成 {}', () => {
    // 后端那四个 POST 是 @RequestBody(required = false) + @Valid：
    // 无体能拿到信封，而 `{}` 会被当成「一个缺字段的原生载荷」判 400。
    // 400 与「这一项能力不可用」长得完全不一样，前端只会看到探针失败 ——
    // 于是 I23 真把 nativeSupported 翻成 true 之后，这里仍然会说「桌面客户端尚未发布」。
    // 实测过（2026-11-04，curl 打真后端）：无体 / 空体 → code 0；`{}` → code 400
    const source = apiSource()
    expect(source.match(/data: payload \}\)/g)?.length ?? 0).toBe(4)
    expect(source).not.toContain('data: payload ?? {}')
  })
})

describe('与后端 QlzgBridgeCapabilityEnum 逐字比对', () => {
  const backend = backendEnumFile()

  it.skipIf(!backend)('五项能力码与降级方式两边一致', () => {
    const fromBackend = backendCapabilities(read(backend!))
    const codes = unionMembers(apiSource(), 'BridgeCapabilityCode')

    expect(Object.keys(fromBackend).sort()).toEqual([...codes].sort())

    // local-extract 的降级是「服务端抽取」，不是「不支持」——
    // 方案 §16.2 那一行专门点了这一项的名：服务端 Tika 抽取（I1-d）是真能干的，
    // 把它答成「不支持」等于把一个好功能藏起来
    expect(fromBackend['local-extract']).toBe('server-extract')
    expect(fromBackend['sign-with-ukey']).toBe('none')
    expect(fromBackend['directory-scan']).toBe('webkitdirectory')
    expect(fromBackend['chunk-upload']).toBe('presign-put')
    expect(fromBackend['report-file']).toBe('browser-download')
  })

  it.skipIf(!backend)('后端每一项的理由都说清了「该做什么」，不是只说「不行」', () => {
    const source = read(backend!)
    const entries = enumEntries(source)
    expect(entries.map((e) => e.code)).toEqual([
      'directory-scan',
      'local-extract',
      'chunk-upload',
      'sign-with-ukey',
      'report-file'
    ])
    // 🔴 后端枚举里 reason 那一列的 javadoc 写的是「必须说清该做什么，不能只说不行」。
    //    这句话编译期与运行期都不会报错，理由被删成一句「不支持」照样跑得起来 ——
    //    所以在这里逐项钉住「出路」那个词还在不在。
    const wayOut: Record<string, string> = {
      'directory-scan': 'webkitdirectory',
      'local-extract': '服务端抽取',
      'chunk-upload': 'presign-put',
      'sign-with-ukey': '打印、手签、盖章',
      'report-file': 'word-url'
    }
    for (const entry of entries) {
      expect(entry.body, `${entry.code} 的理由里没写出路`).toContain(wayOut[entry.code])
      // 每一项都要点名它要等到哪个迭代 —— 「以后会有」不是一个可核对的承诺
      expect(entry.body, `${entry.code} 的理由里没点名迭代`).toMatch(/I\d\d/)
    }
    // sign-with-ukey 必须点名 I30：I23 的桌面端排在 I30 之后，
    // 写成「请用桌面端」的话用户装完发现还是没有，而这句话是从我们自己的接口里出来的
    expect(entries.find((e) => e.code === 'sign-with-ukey')!.body).toContain('I30')
    // 五项里只有一项没有降级端点（UKey 签章），其余四项都必须指向一个已有端点
    expect(source.match(/null,\s*\n\s*"/g)?.length ?? 0).toBe(1)
  })

  it('后端那份没检出时把这件事说出来', () => {
    if (backend) return
    // eslint-disable-next-line no-console
    console.info(
      `[localBridge.spec] 跳过与后端的比对：${join(dirname(FRONTEND), 'ainb')} 不在。` +
        '前端自身那几条照跑。'
    )
    expect(true).toBe(true)
  })
})
