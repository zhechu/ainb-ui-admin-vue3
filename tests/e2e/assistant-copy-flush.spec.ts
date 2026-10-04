import { test, expect } from '@playwright/test'
import { gotoWithAuth, login } from './helpers/auth'

/**
 * P0-2 · 「复制」必须拿到完整答案：SSE 结束时打字机没 flush ⟹ 用户静默少复制一截
 *
 * ## 缺陷
 * `AssistantChat.vue` 的 `onComplete` 只置了 `streaming=false` 与 `status='SUCCESS'`，
 * **没有调 `typewriter.flush()`**。而「复制」按钮的 `v-if` 正是 `status === 'SUCCESS'`，
 * 它复制的是 `item.content` —— 也就是打字机**已吐出的那一半**。
 * 于是：动画还在跑，按钮已经亮着，用户点下去拿到一段被截断的答案，
 * 而界面上看不出任何异常（气泡随后自己补完，剪贴板不会）。
 * `onerror` 与 `handleStop` 两条路都 flush 了，唯独**正常结束**这条没 flush。
 *
 * 🔴 同一条根因还有一个更响的表现：`onComplete` 里的空流判定读的是 `assistantMessage.content`，
 *    而 content 只由打字机写入。整份答复一次性到达、动画一格都还没吐时 content 仍是空串，
 *    于是一次**正常回答**会被判成「AI 助手没有返回任何内容，请重试」并盖一条红错。
 *    本用例的合成流就是「一次性到达」这个形状，所以两种表现它都能撞到。
 *
 * ## 🔴 0 LLM token
 * `send-stream` 用 `page.route` 换成合成 SSE（与 `agent-workflow-manifest.spec.ts` 同一套路），
 * 绝不打到后端、绝不触发任何模型调用。也不落库 ⟹ 无残留、无需 afterAll 清理。
 *
 * ## 为什么这条只能在浏览器里验（方案 §2-9：验不了就明说）
 * 打字机是 `AssistantChat.vue` 里的一个**SFC 内部对象**，没有导出；而 `vitest.config.ts`
 * 是 `environment: 'node'`，挂不了组件。所以「单测层面断言复制内容完整」这一条
 * **在本项目当前的测试基座下做不到**，改用真浏览器 + 合成流验同一件事 ——
 * 它比单测更贴：验的就是用户点那个按钮时剪贴板里到底是什么。
 *
 * ## 🔴 变异探针怎么打（方案 §2-8）
 * 把 `AssistantChat.vue` 里 `handleSend` 的 `onComplete` 那句 `typewriter.flush()` 删掉
 * （只删那一处即可，`handleHitlDecision` 那处不影响本用例），本用例必须变红，
 * 且红在「复制到的文本 === 完整答案」那条上（或红在「复制按钮压根没出现」——
 * 那是同一条根因的另一种表现：空流误判把 SUCCESS 换成了 ERROR，两种都算探到）。
 */

/**
 * 合成答复正文
 *
 * 🔴 长度是**算过的**，不是随手写的：打字机最快 6 字符 / 8ms = 750 字符/秒，
 *    4500 字符要吐 **6 秒**。而合成流是一次性 fulfill 的，`onComplete` 在毫秒级就触发 ⟹
 *    那一刻打字机**必然**还压着几乎整份 backlog。这就是本用例的阳性对照（方案 §2-6）：
 *    没有它，「复制到的内容完整」这条断言在 flush 有没有生效两种情况下都会绿。
 *
 * 正文刻意不含任何 markdown 记号：MarkdownView 会改写标题/列表/代码块，
 * 而断言要拿渲染文本与原文逐字比，夹了记号就得多一层「渲染后应该长什么样」的猜测。
 */
const FULL_ANSWER = Array.from({ length: 90 }, (_, i) => `第${i + 1}段：这是一段用于验证复制完整性的纯文本。`).join('')

function sseBody(content: string): string {
  return [
    { type: 'MESSAGE', content },
    { type: 'DONE' }
  ]
    .map((data) => `data: ${JSON.stringify({ code: 0, data })}\n\n`)
    .join('')
}

test.describe('P0-2 · 打字机 flush：动画没吐完就点「复制」，也必须拿到完整答案', () => {
  test.setTimeout(180_000)

  test('复制到的文本 === 完整答案（不是前缀），且阳性对照证明动画当时确实没吐完', async ({
    page
  }) => {
    // 🔴 剪贴板探针必须在 login/goto **之前**装：addInitScript 只对其后的导航生效。
    //    两条路都堵上 —— useClipboard({legacy:true}) 会先试 navigator.clipboard.writeText，
    //    拿不到再回落 document.execCommand('copy')，走哪条都要能抓到原文。
    await page.addInitScript(() => {
      const w = window as any
      w.__copied = []
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (t: string) => {
              w.__copied.push(String(t))
            },
            readText: async () => w.__copied[w.__copied.length - 1] ?? ''
          }
        })
      } catch {
        /* 浏览器不允许覆写就只靠 execCommand 那条 */
      }
      const origExec = document.execCommand.bind(document)
      document.execCommand = ((cmd: string, ...rest: any[]) => {
        if (String(cmd).toLowerCase() === 'copy') {
          const el = document.activeElement as any
          w.__copied.push(el && 'value' in el ? String(el.value) : String(document.getSelection() ?? ''))
          return true
        }
        return origExec(cmd, ...rest)
      }) as any
    })

    // 🔴 拦截必须在 login/goto 之前挂：fetchEventSource 走 fetch，晚一步请求就真发出去了
    await page.route('**/agent/assistant/send-stream', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody(FULL_ANSWER)
      })
    )

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')

    const textarea = page.locator('textarea[placeholder*="问点什么吧"]').first()
    await expect(textarea).toBeVisible({ timeout: 20_000 })
    await textarea.fill('请把这张表的字段一个个讲清楚')

    const sentAt = Date.now()
    await page.getByRole('button', { name: /发送/ }).first().click()

    // 「复制」按钮只在 status==='SUCCESS' 时渲染 —— 它出现的那一刻，正是缺陷可达的那一刻
    const copyBtn = page.getByTestId('assistant-copy').first()
    await expect(
      copyBtn,
      `「复制」按钮压根没出现。这本身就是同一条根因的另一种表现：整份答复一次性到达、` +
        `打字机一格都没吐时 item.content 仍是空串，onComplete 的空流判定把这次**正常回答**` +
        `误判成了「AI 助手没有返回任何内容」并盖了红错。页面上的 alert 原文见下条断言`
    ).toBeVisible({ timeout: 30_000 })
    const elapsedToSuccess = Date.now() - sentAt

    // ---------- 🔴 阳性对照（方案 §2-6）：证明「动画未吐完」这个前提是真的 ----------
    // 不靠抓拍某一帧（flush 生效后就抓不到了），靠**算**：
    // 打字机最快 750 字符/秒，吐完 FULL_ANSWER 至少要这么久；而按钮在 elapsedToSuccess 就亮了。
    const minAnimationMs = Math.floor((FULL_ANSWER.length / 750) * 1000)
    expect(
      elapsedToSuccess,
      `阳性对照失效：这条答复 ${FULL_ANSWER.length} 字符，打字机吐完至少要 ${minAnimationMs}ms，` +
        `而「完成态」在 ${elapsedToSuccess}ms 就到了 —— 两者太接近，说明本轮**没能**构造出` +
        `「动画未吐完就已 SUCCESS」的状态，那么下面「复制内容完整」这条断言在 flush 有没有生效` +
        `两种情况下都会绿，判据是空的`
    ).toBeLessThan(minAnimationMs)

    // ---------- 主断言 ----------
    await copyBtn.click()
    await expect(page.locator('.el-message').filter({ hasText: '已复制到剪贴板' }).first()).toBeVisible({
      timeout: 10_000
    })
    const copied = await page.evaluate(() => {
      const w = window as any
      return Array.isArray(w.__copied) ? (w.__copied[w.__copied.length - 1] ?? '') : ''
    })

    expect(
      copied.length,
      `剪贴板探针一个字都没抓到 —— 要么 handleCopy 没被点到，要么 useClipboard 走了第三条路。` +
        `不管哪种，本用例的主断言现在是**空洞通过**，先修探针再看结论`
    ).toBeGreaterThan(0)
    expect(
      copied,
      `复制到的是 ${copied.length} 字符，完整答案是 ${FULL_ANSWER.length} 字符 —— ` +
        `用户拿到了一段被静默截断的答案，而界面上看不出来（气泡随后自己补完，剪贴板不会）。` +
        `${copied.length < FULL_ANSWER.length && FULL_ANSWER.startsWith(copied) ? '（确认是**前缀**，正是打字机没 flush 的形状）' : ''}`
    ).toBe(FULL_ANSWER)

    // 渲染出来的气泡也必须是全文：flush 的作用不只是喂剪贴板，也是「别让用户盯着半截话」
    const rendered = ((await page.getByTestId('assistant-answer').first().textContent()) ?? '').trim()
    expect(rendered.length, '完成态之后气泡里应已是全文').toBeGreaterThanOrEqual(FULL_ANSWER.length)
  })
})
