import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * axios 响应拦截器的**错误形状**约束（台账 C2）
 *
 * <h3>为什么是扫源码原文，而不是 import service.ts 真跑一遍</h3>
 * `service.ts` 在模块顶层就 `useI18n()`（走 auto-import，没有显式 import 可以 mock）、
 * 读 `import.meta.env`、拉 element-plus 与 router —— 在 vitest 的 node 环境里 import 它必然炸，
 * 而 `src/config/` 下至今零测试覆盖，也没有任何现成的 mock 基座可复用。
 * 本仓既有的同类先例是 `views/agent/workflow/layout.spec.ts`：读源文件原文 + 正则断言，
 * **抓不到锚点就抛**，绝不回落默认值让断言假通过。这里沿用同一套。
 *
 * <h3>🔴 C2 修的是哪一半、没修的是哪一半（两者搞混就会做出错误的后续决定）</h3>
 * 业务错误码那一支原来是 `return Promise.reject('error')` —— reject 出去的是**字面量字符串**，
 * 调用方 `catch (e)` 里 `e.message` 是 undefined；后端那段 msg 除了进一个 4.5 秒自动消失的
 * 通知标题之外，在界面上没有任何留得住的落点。修完是 `reject(new Error(msg))`，
 * 与同文件 500 / 901 两支同形。
 *
 * 但**用户一直都看得到文案**（那一支本来就弹 `ElNotification.error({ title: msg })`）——
 * 被吞掉的只是「调用方能不能拿到」。所以本用例把通知那一行也钉住：
 * 后来人若以为「反正 catch 里有了」而把通知删掉，用户就真的一条提示都看不见了，
 * 那是从「文案读不完」直接退回到「文案不存在」，比 C2 本身更糟。
 */
const src = readFileSync(fileURLToPath(new URL('./service.ts', import.meta.url)), 'utf-8')

/**
 * 抓 `else if (code !== 0 && code !== 200) { … }` 这一支的分支体。
 *
 * 🔴 抓不到就抛：锚点漂了说明这段被重构过，那时该改的是本用例的读法，
 * 而不是把断言放宽成「文件里没有 reject('error') 就算过」。
 */
const bizErrorBranch = (): string => {
  const start = src.indexOf('} else if (code !== 0 && code !== 200) {')
  if (start < 0) {
    throw new Error('service.ts 里找不到业务错误码那一支：被重构了？请同步本用例的起始锚点')
  }
  const end = src.indexOf('\n    } else {', start)
  if (end < 0) {
    throw new Error('业务错误码那一支的结束锚点（`} else { return data }`）找不到，请同步本用例')
  }
  return src.slice(start, end)
}

describe('axios 响应拦截器：reject 出去的东西必须带上后端 msg（C2）', () => {
  it('业务错误码那一支 reject 的是 Error(msg)，不是字面量字符串', () => {
    const branch = bizErrorBranch()
    expect(branch).toContain('return Promise.reject(new Error(msg))')
    expect(branch).not.toContain("Promise.reject('error')")
  })

  it('同一支仍然把 msg 弹成通知：修的是「调用方拿不拿得到」，不是「用户看不看得见」', () => {
    expect(bizErrorBranch()).toContain('ElNotification.error({ title: msg })')
  })

  it('全文件不存在任何「reject 一个字面量字符串」的错误形状', () => {
    // 🔴 全文件扫描而不是逐支点名：C2 的病形是「reject 一个不带信息的字面量」，它可能出现在任何一支，
    //    点名式断言只能证明「被点到的那几支是对的」，剩下那些正是没人看的地方。
    // 🟡 刻意**不**覆盖 `Promise.reject(msg)`（ignoreMsgs 那一支）：它 reject 的确实是字符串，
    //    但那是装着 msg 的**变量**，调用方拿得到文字。把它一并改成 Error 属于另一件事
    //    （会动到令牌刷新链路那个 catch），不在 C2 的落点里。所以本断言只禁字面量，不禁字符串变量。
    const literals = [...src.matchAll(/Promise\.reject\(\s*(['"`])[^'"`]*\1\s*\)/g)].map((m) => m[0])
    expect(literals).toEqual([])
  })

  it('500 / 901 / 业务错误三支同形：钉住注释里那句「同形」不是写来好看的', () => {
    const count = (src.match(/return Promise\.reject\(new Error\(msg\)\)/g) || []).length
    // 🔴 刻意钉死字面量 3（与 `subFieldSeparator` 那两条测试同一个套路）：
    //    将来真要加第四支同形的 reject，本用例会红 —— 那时把 3 改成 4 并想清楚为什么是 4，
    //    比让「同形」这句话悄悄失效要好。
    expect(count).toBe(3)
  })
})
