import { test, expect, type APIRequestContext } from '@playwright/test'
import {
  cleanupOwnedConversations,
  parseLastConversationId,
  watchOwnedConversations,
  type ConversationOwnership
} from './helpers/conversation-ownership'

/**
 * `helpers/conversation-ownership.ts` 的**构造样本**测试（方案 §2-7）：不跑真发、不联网、不花钱
 *
 * ## 为什么这份判据值得单独钉
 * 它决定的是「afterAll 删谁」。判据错了有两个方向，坏的程度天差地别：
 * - **多认领**（把别人的会话算成自己的）⟹ 删掉用户数据，不可逆。
 *   2026-10-07 真发生过：T2 的 afterAll 原先按「跑后全集 − 跑前基线」求差集，
 *   把同一时间窗里别人新建的会话当成残留删了，报告还印「删除本轮新建 1 条」像是干得漂亮。
 * - **少认领**（自己建的没抓到）⟹ 会话残留在库里，脏，但可逆、且不动别人的东西。
 *
 * 所以本文件的重心是**多认领那一侧**：① 钉死存档解析只认 `v` 里那个 id、
 * ② 钉死拆台子只删账本里的、③ 钉死「基线里已有的」即便出现在账本里也不删。
 * 少认领那一侧只要求「说出来」（④）。
 *
 * ## 🔴 少认领那一侧真的救过场
 * 归属凭据的第一版是「读 SSE 正文里的 META 事件」，2026-10-08 A4-d 真发一轮实测**认领 0 条**
 * （流式响应 Playwright 拿不回正文）。它没有变成一次假绿，正是因为 ④ 钉的那行 ⚠️ 印了出来。
 * 所以 ④ 不是凑数的用例：它是「换实现时不许把报警器一起拆掉」的守卫。
 *
 * ## 🔴 变异探针怎么打（方案 §2-8）
 * 1. 把 `parseLastConversationId` 改成对原文直接跑正则 `/"id":(\d+)/`
 *    ⟹ 用例 ① 必须红（两层 JSON 里 `v` 之外那个 `id` 会被认成会话号）。
 * 2. 把 `cleanupOwnedConversations` 里遍历 `owned` 改成遍历 `now`（即恢复差集口径）
 *    ⟹ 用例 ② 必须红（foreign 那条会被删掉）。
 * 3. 把 `if (baseline.has(id)) { keptBaselineHits++; continue }` 去掉
 *    ⟹ 用例 ③ 必须红（提问跑进既有会话时，用户的历史对话会被删）。
 * 4. 把「发了却没认领到」那两行 ⚠️ 去掉 ⟹ 用例 ④ 必须红。
 * 5. 把钩子里 `Storage.prototype.setItem` 那句 `forward(key, value)` 删掉
 *    ⟹ 用例 ⑥ 必须红在**阳性对照**那一条（「钩子没把 localStorage 的写入认领进账本」），
 *       而 ⑦ 仍绿 —— ⑦ 走的是「装钩子前已存在的存档」那条补认路径，两条路必须分开守。
 *       2026-10-08 实打过：⑥ 红在 poll 超时、⑦ 绿，探针有效。
 * 6. 把钩子里 `key.indexOf(prefix) !== 0` 这个键前缀过滤去掉
 *    ⟹ 用例 ⑥ 必须红在「非 agentLastConversation 前缀的键被认成了会话」，
 *       且阳性对照那一段仍绿（说明红在过滤上，不是红在钩子整体没生效）。
 *       2026-10-08 实打过，形状如上，探针有效。
 * 只红不退、或红在别的断言上，都算探针无效。
 */

/**
 * web-storage-cache 的存档原文：`{c,e,v}`，而 `v` 是**又序列化过一次的字符串**
 *
 * <p>🔴 刻意用 `JSON.stringify` 拼而不是手写转义：手写的那份迟早与真实原文差一个反斜杠，
 *    而差一个反斜杠的样本会让解析用例**假绿**（测的是我手写的形状，不是产品写出来的形状）。
 */
const envelope = (value: unknown) =>
  JSON.stringify({ c: 1759872841000, e: 1762464841000, v: JSON.stringify(value) })

/** 与 A4-d 真发那一轮实测形状一致：save(id, title) 存的三格 */
const REALISTIC_RAW = envelope({
  id: 658,
  title: '我要建一张新表「xpy_e2e_gate」',
  savedAt: 1759872841000
})

/** 假的 APIRequestContext：只实现本判据用到的 get/delete，并把删过的 id 记下来 */
function fakeRequest(existing: number[]) {
  const deleted: number[] = []
  const request = {
    get: async () => ({
      json: async () => ({ code: 0, data: { list: existing.map((id) => ({ id })) } })
    }),
    delete: async (_url: string, opts: any) => {
      deleted.push(opts.params.id)
      return { json: async () => ({ code: 0 }) }
    }
  } as unknown as APIRequestContext
  return { request, deleted }
}

function fakeOwnership(owned: number[], sends: number): ConversationOwnership {
  return {
    noteSend: () => {},
    ownedIds: () => new Set(owned),
    sendAttempts: () => sends
  }
}

test.describe('会话归属判据（构造样本）', () => {
  test('① 解析：id 只从存档的 v 里取，且要解两层', async () => {
    // 阳性对照：真形状必须抓得到。抓不到的话下面几条「不许乱认」全都是空洞通过
    expect(parseLastConversationId(REALISTIC_RAW)).toBe(658)

    // 🔴 id 必须来自 v，不是原文里随便哪个 "id"：
    //    存档外层被塞了一个别的 id 时，认下来就会去删一个不相干的会话
    expect(
      parseLastConversationId(
        JSON.stringify({ c: 1, e: 2, id: 999, v: JSON.stringify({ id: 658 }) })
      ),
      '取了 v 以外的 id —— 那可能是缓存信封自己的字段，不是会话号'
    ).toBe(658)

    // 标题正文里出现「id:999」这种字样时不能被骗走（正则口径会栽在这里）
    expect(
      parseLastConversationId(envelope({ id: 7, title: '他说 {"id":999} 然后', savedAt: 1 }))
    ).toBe(7)

    // v 已经是对象（没有二次序列化）时也认：宽容这一层不会导致多认领
    expect(parseLastConversationId(JSON.stringify({ c: 1, e: 2, v: { id: 11 } }))).toBe(11)

    // 字符串形式的 id 要认（后端 Long 序列化成字符串时就是这样），否则整轮少认领
    expect(parseLastConversationId(envelope({ id: '658' }))).toBe(658)

    // 读不懂 / 没有 id / id 不合法：一律 undefined。
    // 0 与负数尤其不能认 —— 认下来就是对着一个不存在的会话发删除请求
    expect(parseLastConversationId(null)).toBeUndefined()
    expect(parseLastConversationId('')).toBeUndefined()
    expect(parseLastConversationId('not json')).toBeUndefined()
    expect(parseLastConversationId('{"c":1,"e":2,"v":"{\\"id\\":')).toBeUndefined()
    expect(parseLastConversationId(envelope({ title: '没有 id' }))).toBeUndefined()
    expect(parseLastConversationId(envelope({ id: 0 }))).toBeUndefined()
    expect(parseLastConversationId(envelope({ id: -3 }))).toBeUndefined()
    expect(parseLastConversationId(envelope({ id: 'abc' }))).toBeUndefined()
    // 少了 v 这一层就不认：宁可少认领（会被 ④ 那行 ⚠️ 报出来），也不去猜别的字段
    expect(parseLastConversationId(JSON.stringify({ id: 5 }))).toBeUndefined()
  })

  test('② 🔴 拆台子只删账本里的：本轮期间别人新建的会话必须**原样保留**', async () => {
    // 1/2 是跑前就有的，3 是本轮建的，4 是**别人**在同一时间窗里建的（那次真删的形状）
    const { request, deleted } = fakeRequest([1, 2, 3, 4])

    const report = await cleanupOwnedConversations({
      request,
      headers: () => ({}),
      ownership: fakeOwnership([3], 1),
      baseline: new Set([1, 2])
    })

    expect(deleted, '删到了账本以外的会话 —— 那是别人的数据，删掉不可逆').toEqual([3])
    expect(report.deleted).toBe(1)
    expect(report.foreign, '别人建的会话没被如实报出来').toEqual([4])
    expect(report.leftoverOwned).toEqual([])
    const text = report.lines.join('')
    expect(text, '报告里没点名那条被保留的外来会话').toContain('4')
    expect(text, '外来会话必须写成「原样保留」，不能让人以为清干净了').toContain('原样保留')
  })

  test('③ 🔴 账本里的 id 若本来就在基线里，也不许删（提问跑进了既有会话）', async () => {
    // 「新建对话」没点成、或页面按 useLastConversation 续上了上一次的会话时就是这个形状：
    // 产品照样把那个 id 写进 localStorage，于是它进了账本 —— 但它是**用户的历史对话**
    const { request, deleted } = fakeRequest([1, 2])

    const report = await cleanupOwnedConversations({
      request,
      headers: () => ({}),
      ownership: fakeOwnership([2], 1),
      baseline: new Set([1, 2])
    })

    expect(deleted, '删掉了基线里已有的会话 = 删用户的历史对话').toEqual([])
    expect(report.keptBaselineHits).toBe(1)
    expect(
      report.lines.join(''),
      '这件事必须说出来，否则「删了 0 条」看着像什么都没发出去'
    ).toContain('既有')
  })

  test('④ 少认领必须**说出来**：一个恒绿的残留检查比没有检查更坏', async () => {
    // a) 发了提问、一条都没认领到 —— A4-d 第一版实测就是这个形状
    const a = await cleanupOwnedConversations({
      request: fakeRequest([1]).request,
      headers: () => ({}),
      ownership: fakeOwnership([], 3),
      baseline: new Set([1])
    })
    expect(a.lines.join(''), '发了 3 次提问却一条没认领到，报告必须 warn').toContain(
      '一条会话都没认领到'
    )
    expect(
      a.lines.join(''),
      '光说「没认领到」还不够，得把「别读成清理干净」也写进去，否则下一个人只看第一行'
    ).toContain('别把这份报告读成')

    // b) 部分认领：3 次提问只抓到 1 条
    const b = await cleanupOwnedConversations({
      request: fakeRequest([1, 2]).request,
      headers: () => ({}),
      ownership: fakeOwnership([2], 3),
      baseline: new Set([1])
    })
    expect(b.lines.join(''), '认领数少于发送数时必须 warn，不能印成「清干净了」').toContain(
      '只认领到 1 条'
    )

    // c) 全认领到了就不该有 ⚠️：warn 满天飞等于没有 warn
    const c = await cleanupOwnedConversations({
      request: fakeRequest([1, 2]).request,
      headers: () => ({}),
      ownership: fakeOwnership([2], 1),
      baseline: new Set([1])
    })
    expect(c.lines.join(''), '正常轮次不该印 ⚠️').not.toContain('⚠️')
  })

  test('⑤ 账本里有、库里没有的（没建成 / 已被别处清掉）不去删', async () => {
    const { request, deleted } = fakeRequest([1])

    const report = await cleanupOwnedConversations({
      request,
      headers: () => ({}),
      // 9 是「用例在发送前就红了、会话压根没建成」的那一条
      ownership: fakeOwnership([9], 1),
      baseline: new Set([1])
    })

    expect(deleted, '对着一个不存在的 id 发删除请求').toEqual([])
    expect(report.deleted).toBe(0)
    expect(report.leftoverOwned, '库里本来就没有它，不算残留').toEqual([])
  })

  test('⑥ 🔴 页面里的钩子真的会认领：写进 localStorage 的那一下必须到账本里', async ({ page }) => {
    // 这一条守的是**第一版真发时静默失效**的那个环节（读 SSE 正文，认领 0 条）。
    // 钩子只在浏览器里存在，①~⑤ 那套假 request 碰不到它，所以单独开一条带 page 的。
    //
    // 🔴 不连后端、不连 dev server：用 route 拦一个假源，图的是「localStorage 可用」这一个前提。
    //    真去 dev server 上跑的话，本文件就从「不联网不花钱」退化成「先起两个服务再说」
    await page.route('**/*', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>t</title>' })
    )
    await page.goto('http://e2e-ownership.invalid/')

    const ownership = await watchOwnedConversations(page)

    // 阳性对照：产品那条写入（save → wsCache.set → Storage.prototype.setItem）必须被认领到
    await page.evaluate((raw) => localStorage.setItem('agentLastConversation:1', raw), REALISTIC_RAW)
    await expect
      .poll(() => ownership.ownedIds().has(658), { message: '钩子没把 localStorage 的写入认领进账本' })
      .toBe(true)

    // 🔴 键前缀必须过滤：别的键里也有 `"id":数字` 的话，认下来就是去删一个不相干的会话
    await page.evaluate(() =>
      localStorage.setItem('ACCESS_TOKEN', JSON.stringify({ c: 1, e: 2, v: JSON.stringify({ id: 777 }) }))
    )
    await page.evaluate(() => localStorage.setItem('themeConfig:1', '{"id":888}'))
    // 让上面两次写入有机会飞回来（认领是异步的），再断言账本没被污染
    await page.waitForTimeout(200)
    expect(
      [...ownership.ownedIds()],
      '非 agentLastConversation 前缀的键被认成了会话 —— 那会去删不相干的东西'
    ).toEqual([658])

    // 换会话（新建对话后又发一条）：两条都要在账本里，只留最后一条就会漏删前一条
    await page.evaluate(
      (raw) => localStorage.setItem('agentLastConversation:1', raw),
      envelope({ id: 659, title: '第二条', savedAt: 2 })
    )
    await expect.poll(() => ownership.ownedIds().size).toBe(2)
    expect(ownership.ownedIds().has(659)).toBe(true)

    // 解析不了的原文不许让钩子抛出去：抛了就变成产品的保存失败
    await page.evaluate(() => localStorage.setItem('agentLastConversation:1', '{{{ 不是 JSON'))
    await page.waitForTimeout(200)
    expect(ownership.ownedIds().size, '坏原文把账本搅乱了').toBe(2)
  })

  test('⑦ 钩子对**装钩子之前**就已存在的存档也补认（页面挂载时的恢复写入）', async ({ page }) => {
    await page.route('**/*', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>t</title>' })
    )
    await page.goto('http://e2e-ownership.invalid/')
    // 先塞好存档，再装钩子 —— 模拟「上一次跑的会话还躺在 localStorage 里」
    await page.evaluate((raw) => localStorage.setItem('agentLastConversation:1', raw), REALISTIC_RAW)

    const ownership = await watchOwnedConversations(page)
    expect(
      ownership.ownedIds().has(658),
      '装钩子之前就在的存档没被补认 —— 那类 id 交给基线判一道（在基线里⟹只报不删）比漏认安全'
    ).toBe(true)
  })
})
