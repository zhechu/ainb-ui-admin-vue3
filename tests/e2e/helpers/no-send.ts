import { expect, type Page } from '@playwright/test'

/**
 * 「点一下只该把正文填进输入框、不该直接发出去」这条判据的正确写法
 *
 * ## 🔴 为什么不能用「气泡数前后相等」来判（方案 §2-6 红线）
 *
 * `prompt-template-case.spec.ts` 与 `agent-prompt-template.spec.ts` 原先都这么写：
 * 点击前数一遍 `[data-testid="assistant-answer"]`，点击后再数一遍，断言两次相等。
 *
 * 这个判据在 `data-testid` 改名那天会**静默退化成 `0 === 0` 恒真**，而它守的恰恰是本模块
 * 最阴的一类缺陷：点示例/模板本该只是插入，一旦变成直接发出去，模型就会对着
 * 「{{订单号}}」这种**没填实的字面量**编一个答案 —— 有回答、无报错、答案是错的。
 *
 * 更麻烦的是这条判据**给不出**阳性对照：两个 spec 都刻意不发送任何消息
 * （理由见各自头注释），所以整轮跑完也没有一个气泡出现过，
 * 「这个选择器今天还探得到东西吗」根本无从证明。§2-6 明令：
 * 凡断言「什么都没发生」，前面必须先有一条断言「这一项确实探通了」。
 *
 * ## 换成网络判据，阳性对照是白送的
 *
 * 发送只有一条路径：`POST /agent/assistant/send-stream`（`src/api/agent/assistant/index.ts:138`，
 * 全仓唯一）。于是判据改成「这条请求一条都没发出过」，而它的阳性对照同样免费 ——
 * 打开「示例 / 模板」页签时必然发一条 `simple-list`，页签里能列出数据就是它回来了。
 * 连 `simple-list` 都没记到，说明监听器压根没挂上，此时「没有 send-stream」一文不值，
 * 先红给人看，别拿一个恒真的判据去当验收。
 *
 * ## 用法（顺序不能反）
 *
 * ```ts
 * const noSend = watchNoSend(page)   // 🔴 必须早于「打开页签」那次点击，边界见下
 * await login(page)
 * … 打开页签、点一条 …
 * noSend.expectLive('/agent/prompt-template-case/simple-list', '示例页签的列表请求')  // 先证探通
 * noSend.expectNeverSent('点一条示例')                                              // 再断言没发生
 * ```
 *
 * ⚠️ 「早于」的确切边界是**触发 probeFragment 那条请求的交互**，不是 `login`/`goto`。
 * 探针 F4 实测过：把挂载点挪到 `waitForURL` **之后**（login/goto 都已跑完），`expectLive` 照样绿 ——
 * 因为 `simple-list` 是**点开页签那一刻**才发的，登录跳转期间压根不发。
 * 所以早先这里写的「必须在 login/goto 之前挂」是个**假约束**，已改掉。
 * 两个 spec 仍把它放在用例第一行，理由不是「非第一行不可」，而是那是唯一不用推理就必然成立的位置：
 * 以后往用例里再加任何交互，都不会不小心排到它前面去。
 */
export function watchNoSend(page: Page) {
  const urls: string[] = []
  page.on('request', (request) => urls.push(request.url()))
  const matching = (fragment: string) => urls.filter((url) => url.includes(fragment))

  return {
    /** 发送路径的唯一入口，全仓只有这一处（见文件头注） */
    SEND_STREAM: '/agent/assistant/send-stream',

    /**
     * 🔴 阳性对照（§2-6）：先证明这只监听器真在记 agent 模块的请求
     *
     * @param probeFragment 一条**必然发生过**的请求的 URL 片段（如页签的 `simple-list`）
     * @param what          它是干什么的，写进失败文案，别让人回头猜
     */
    expectLive(probeFragment: string, what: string) {
      expect(
        matching(probeFragment).length,
        `阳性对照失效：监听器没记到${what}（${probeFragment}）。` +
          `那么下面「没发出 send-stream」是恒真的，证不了任何事 —— ` +
          `要么监听挂晚了（必须早于触发这条请求的那次交互，见文件头注），要么这条请求的 URL 变了`
      ).toBeGreaterThan(0)
    },

    /** 反向判据：一条 `send-stream` 都不许有 */
    expectNeverSent(what: string) {
      expect(matching(this.SEND_STREAM), `${what}不该把正文直接发出去（只该填进输入框）`).toEqual([])
    }
  }
}
