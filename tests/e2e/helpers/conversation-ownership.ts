import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL } from './auth'
import { CACHE_KEY } from '../../../src/hooks/web/useCache'

/**
 * 「哪些会话是本轮 e2e 自己建的」—— 归属判定与拆台子
 *
 * ## 🔴 为什么判据必须是**归属**，不能是「跑后 − 跑前」的差集
 *
 * 实测疤（2026-10-07，T2 prompt-template-build-matrix）：那份 spec 的 afterAll 原先是
 *
 * ```ts
 * for (const id of await listConversationIds(request)) {
 *   if (baselineConversationIds.has(id)) continue   // ← 差集口径
 *   await request.delete(conversationDeleteApi, ...)
 * }
 * ```
 *
 * 差集回答的是「库里**多了什么**」，回答不了「多的这条是**谁**建的」。
 * 后端库是共用的：另一个人开着浏览器、另一个 e2e 在跑、甚至同一个人另开一个标签页，
 * 在同一时间窗里新建的会话都会落进差集，于是被当成残留删掉。
 * 那一轮真删掉了一条不属于本轮的会话（不可逆、无报错），
 * 报告还印一句「删除本轮新建 1 条（基线 N 条原样保留）」，读起来像干得漂亮。
 *
 * 这与 `helpers/agent.ts` 的 `sweepTestConversations`（只删标题以 `E2E` 开头的）、
 * `assistant-chat-error-keeps-execution-id.spec.ts`（只删自己那个 seed Agent 名下的）
 * 是同一条纪律：**删除是不可逆动作，就必须指着「我建的东西」删，不能指着「新的东西」删。**
 *
 * ## 归属凭据：产品自己写进 localStorage 的那个 id
 *
 * 后端在 SSE 的 META 事件里回推 conversationId，`AssistantChat.vue` 的 `applyChatEvent`
 * 收下它 → `emit('update:conversationId')` → `views/agent/assistant/index.vue` 的
 * `watch(activeConversationId)` → `useLastConversation().save(id, title)` →
 * localStorage 的 `agentLastConversation:{userId}`。
 *
 * 这条链是产品为了「刷新页面还能接上刚才那句话」自己维护的（悬浮窗与独立页共用），
 * 测试搭它的便车 ⟹ 键前缀直接 import 产品的 `CACHE_KEY`，不在这里留第二份字面量；
 * 前端哪天换了存法，这里的构造样本测试会先红，不会静默漂开。
 *
 * ## 🔴 墓碑：别「简化」回直接读 SSE 正文（试过，实测拿不到）
 *
 * 第一版走的是 `page.on('response')` + `resp.text()`，想从 `data:{"type":"META",…}` 里抠 id。
 * 2026-10-08 A4-d 真发一轮实测：**认领 0 条**，而库里确实多出了本轮那条会话。
 * `send-stream` 是 fetchEventSource 的流式响应，正文由页面自己 `getReader()` 逐块消费，
 * Playwright 那头 `text()` 拿不回来；reject 又被 `.catch(() => {})` 吃掉，账本就是空的。
 *
 * 值得记下来的是**空账本没有变成一次假绿**：`cleanupOwnedConversations` 如实印了
 * 「发出 1 次提问、却一条会话都没认领到 —— 别把这份报告读成清理干净」，
 * 那条 ⚠️ 就是为这一刻写的。所以它是「脏但可逆」的失败方向，才敢在这里换实现。
 *
 * ## 🔴 抓不到就必须**说出来**
 *
 * 少认领的后果是「自己建的会话残留在库里」（脏，但可逆、且不动别人的数据），
 * 所以这里刻意**不 throw**，而是把「认领数 < 发送数」如实写进报告行。
 * 一个恒绿的残留检查比没有检查更坏 —— 那句话在 T1/T2 的文件头各写了一遍，这里照办。
 */

/** 会话删除接口。三份矩阵 spec 各自拼过一遍同一个 URL，收进来只留一份 */
export const CONVERSATION_DELETE_API = `${API_BASE_URL}/agent/assistant/conversation/delete`

/** 会话分页接口。同上 */
export const CONVERSATION_PAGE_API = `${API_BASE_URL}/agent/assistant/conversation/page`

/** 产品存「最近一次会话」的 localStorage 键前缀（按 userId 分片） */
const LAST_CONVERSATION_KEY_PREFIX = CACHE_KEY.AGENT_LAST_CONVERSATION_PREFIX

/**
 * 从 web-storage-cache 的存档里取出会话 id
 *
 * <p>🔴 **两层** JSON：`wsCache.set(key, {id,title,savedAt})` 落到 localStorage 的是
 *    `{"c":…,"e":…,"v":"{\"id\":658,…}"}` —— `v` 是又序列化过一次的**字符串**。
 *    所以拿正则直接抠 `"id":658` 抠不到（原文里长这样：`\"id\":658`），必须解两层。
 *
 * <p>解析读不懂就返回 undefined，由调用方报「没认领到」，不在这里猜。
 */
export function parseLastConversationId(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  let item: any
  try {
    item = JSON.parse(raw)
  } catch {
    return undefined
  }
  let value: any = item?.v
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  const id = Number(value?.id)
  return Number.isInteger(id) && id > 0 ? id : undefined
}

/**
 * 一轮 e2e 对会话的认领账本
 *
 * <p>用法：页面就绪后 `await watchOwnedConversations(page)`，每次点「发送」后 {@link noteSend}，
 *    afterAll 里把账本交给 {@link cleanupOwnedConversations}。
 *    id 是页面**推**过来的（见下面那个钩子），所以不需要在删之前再「等一等」。
 */
export type ConversationOwnership = {
  /** 点了一次「发送」。用来发现「一条都没认领到」这种抓取失效 */
  noteSend(): void
  /** 认领到的会话 id（只读快照） */
  ownedIds(): Set<number>
  /** 点过几次「发送」 */
  sendAttempts(): number
}

/**
 * 装进页面的钩子：产品往 localStorage 写「最近一次会话」时，把原文推回 Node 侧
 *
 * <p>🔴 只推**原文**，解析留在 Node 侧那一份 {@link parseLastConversationId}：
 *    页面里再写一份解析逻辑，两份就会漂开，而漂开的表现是「认领不到」——最难查的那种。
 *
 * <p>🔴 钩子里绝不抛异常：`setItem` 是产品自己在调的，抛出去等于把测试的毛病
 *    变成产品的保存失败（配额处理那条路径也会被绕过）。
 */
function installLastConversationHook(prefix: string) {
  const w = window as any
  if (w.__e2eLastConversationHooked) return
  w.__e2eLastConversationHooked = true

  const forward = (key: string | null, raw: string | null) => {
    if (typeof key !== 'string' || key.indexOf(prefix) !== 0 || !raw) return
    try {
      w.__e2eClaimConversation(raw)
    } catch {
      // 绑定还没就绪（或已经随上下文销毁）：认不到会被报告如实说出来
    }
  }

  const rawSet = Storage.prototype.setItem
  Storage.prototype.setItem = function (key: string, value: string) {
    rawSet.call(this, key, value)
    forward(key, value)
  }

  // 装钩子之前就已经躺在 localStorage 里的也补认一次：
  // 页面挂载时会恢复「最近一次会话」，那条虽说是既有的，
  // 但认领下来交给基线判一道（在基线里 ⟹ 只报不删）比漏认安全
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) forward(key, localStorage.getItem(key))
  }
}

/**
 * 在页面上挂归属钩子，把**本页面**建起来的会话记进账本
 *
 * <p>必须在点「发送」之前调用；调用时机在导航之后也没关系 ——
 *    钩子既装进当前文档（`evaluate`），也注册给之后每一次导航（`addInitScript`）。
 */
export async function watchOwnedConversations(page: Page): Promise<ConversationOwnership> {
  const ids = new Set<number>()
  let sends = 0

  await page.exposeBinding('__e2eClaimConversation', (_source, raw: unknown) => {
    const id = parseLastConversationId(typeof raw === 'string' ? raw : String(raw ?? ''))
    if (id !== undefined) ids.add(id)
  })
  await page.addInitScript(installLastConversationHook, LAST_CONVERSATION_KEY_PREFIX)
  await page.evaluate(installLastConversationHook, LAST_CONVERSATION_KEY_PREFIX)

  return {
    noteSend: () => {
      sends++
    },
    ownedIds: () => new Set(ids),
    sendAttempts: () => sends
  }
}

/** 拆台子的结果，给调用方拼进自己的报告 */
export type ConversationCleanupReport = {
  /** 真删掉的条数 */
  deleted: number
  /** 认领到的 id 却在基线里 = 提问跑进了既有会话，未删 */
  keptBaselineHits: number
  /** 本轮期间库里多出来、但不是本轮建的 —— 原样保留，只报出来 */
  foreign: number[]
  /**
   * 本轮自建、却**没删掉**的（删除静默失败或压根没发起）
   *
   * <p>🔴 这才是「残留非空即视为该轮失败」该断言的对象。原先那条断言用的是
   *    `跑后总数 − 跑前总数`，而差里混着别人的会话 —— 别人在这一小时里聊了一句，
   *    本轮就会被判红，且判词说的是「你没清干净」。**用别人的数据判自己的成败，
   *    和用别人的数据决定删谁，是同一个错误的两面。**
   */
  leftoverOwned: number[]
  /** markdown 报告行（已带换行），直接拼进残留核账那一段 */
  lines: string[]
}

/**
 * 只删本轮**自己认领**的会话，并把「不敢删的」如实报出来
 *
 * @param headers  带 token 的请求头工厂。⚠️ 调用方在 afterAll 里通常已经重新登录过
 *                 （token TTL 1800 秒，而矩阵轮实测 16 分钟），这里只负责用
 * @param baseline 跑前拍的会话全集。**只用于「不许删」的兜底与报告**，不用于挑删除目标
 */
export async function cleanupOwnedConversations(opts: {
  request: APIRequestContext
  headers: () => Record<string, string>
  ownership: ConversationOwnership
  baseline: Set<number>
}): Promise<ConversationCleanupReport> {
  const { request, headers, ownership, baseline } = opts
  const owned = ownership.ownedIds()
  const sends = ownership.sendAttempts()

  const now = await listConversationIdSet(request, headers)
  const foreign = [...now].filter((id) => !baseline.has(id) && !owned.has(id))

  let deleted = 0
  let keptBaselineHits = 0
  const deletedIds = new Set<number>()
  for (const id of owned) {
    // 没建成的（用例在发送前就红了）不必删；已被别处清掉的也不重复删
    if (!now.has(id)) continue
    // 认领到的 id 却在基线里 = 这次提问跑进了**既有**会话（「新建对话」没点成，
    // 或页面按 useLastConversation 续上了上一次的会话）。那是用户的历史对话，不是残留
    if (baseline.has(id)) {
      keptBaselineHits++
      continue
    }
    // 🔴 每个删除都验返回码：不验的话 token 过期或状态不许删都会静默失败，
    //    而计数器照样 ++、报告照样印「已删 N 条」—— 清理失败被记成清理成功
    const resp = await request.delete(CONVERSATION_DELETE_API, {
      headers: headers(),
      params: { id }
    })
    const body = await resp.json()
    expect(
      body?.code,
      `删本轮自建的会话 #${id} 失败（code=${body?.code}）：${body?.msg ?? ''}`
    ).toBe(0)
    deletedIds.add(id)
    deleted++
  }
  const leftoverOwned = [...owned].filter(
    (id) => !baseline.has(id) && now.has(id) && !deletedIds.has(id)
  )

  const lines: string[] = [
    `- 会话：删除本轮自建的 ${deleted} 条（认领 ${owned.size} 条，基线 ${baseline.size} 条原样保留）\n`
  ]
  lines.push(
    foreign.length
      ? `- ⚠️ 本轮期间库里多出的会话，但**不是本轮建的**：${foreign.join(', ')} —— ` +
        `原样保留（可能是别人的对话，删掉不可逆）\n`
      : `- 本轮期间出现的、非本轮所建的会话：无\n`
  )
  if (keptBaselineHits) {
    lines.push(
      `- ⚠️ 有 ${keptBaselineHits} 次提问跑进了**既有**会话（新建对话没点成，或页面续上了上一次的会话）—— 未删\n`
    )
  }
  // 🔴 下面两条是「抓取失效」的可见化。少认领只会脏（自己的会话留在库里），
  //    但**报成清干净了**才是真正坏的那件事，所以宁可多印一行 ⚠️。
  //    读 SSE 正文那一版就是靠它才没有变成一次假绿（见文件头那条墓碑）
  if (sends > 0 && owned.size === 0) {
    lines.push(
      `- ⚠️ 发出 ${sends} 次提问、却**一条会话都没认领到** —— 归属钩子没生效，` +
        `本轮新建的会话可能全残留在库里，需人工核（别把这份报告读成「清理干净」）\n`
    )
  } else if (owned.size < sends) {
    lines.push(
      `- ⚠️ 发出 ${sends} 次提问、只认领到 ${owned.size} 条会话 —— ` +
        `差额可能是页面还没写下 localStorage 用例就红了，残留需人工核\n`
    )
  }
  if (leftoverOwned.length) {
    lines.push(
      `- ❌ 本轮自建、却**没删掉**的会话：${leftoverOwned.join(', ')} —— 删除静默失败或压根没发起\n`
    )
  }

  return { deleted, keptBaselineHits, foreign, leftoverOwned, lines }
}

/**
 * 会话 id 全集（分页翻到底）
 *
 * <p>🔴 与三份矩阵 spec 里各自的 {@code listConversationIds} 同口径：先验 code 再信 data。
 *    `body?.data?.list ?? []` 会把 401/500 静默吃成空清单，于是「库里多了什么」恒为空 ——
 *    一个恒绿的残留检查比没有检查更坏。
 */
export async function listConversationIdSet(
  request: APIRequestContext,
  headers: () => Record<string, string>
): Promise<Set<number>> {
  const ids = new Set<number>()
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const resp = await request.get(CONVERSATION_PAGE_API, {
      headers: headers(),
      params: { pageNo, pageSize: 100 }
    })
    const body = await resp.json()
    expect(
      body?.code,
      `取会话分页失败（pageNo=${pageNo}，code=${body?.code}）：${body?.msg ?? ''}`
    ).toBe(0)
    const list = body?.data?.list ?? []
    for (const item of list) ids.add(item.id as number)
    if (list.length < 100) break
  }
  return ids
}
