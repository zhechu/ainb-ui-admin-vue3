/**
 * 「去哪儿恢复一条挂起的执行」—— 菜单路径与提示句的唯一前端来源（台账 B3-8）
 *
 * 🔴 诞生背景：`AssistantChat.vue` 的三处 SSE `onerror` 都只留一句「连接中断，请重试」就
 * `throw err` 走人。执行编号（executionId）当时**明明就在组件 state 里**（WORKFLOW_CONFIRM /
 * run-stream 的 META 带回来的），却一个字都不往页面上写 —— 用户手上没有任何凭据，
 * 既认不出有哪条执行、也不知道去哪儿恢复，只能重发一遍问题（于是又跑一遍、又计一次费）。
 *
 * 🔴 与 nameCatalog.ts / nodeSummary.ts 同款纪律：**纯函数、不抛异常、拿不到就返回空串**。
 * 空串是刻意的：宁可不提示，也不要提示一句把人支去查不到东西的话（理由见 executionResumeHint）。
 */

/**
 * 执行历史抽屉所在的菜单路径。
 *
 * 🔴 逐字来自库里 `system_menu` 的 name，实测 2026-10-07，据
 * `sql/mysql/xpy-2026-09-29-agent-menu-under-ai.sql` 头部那棵侧栏树：
 * AI → AI 助手 → 流程编排（path `/ai/agent/workflow`）；
 * 「执行历史」不是独立菜单，是该页列表行上的按钮，点开是 `ExecutionHistoryDrawer`。
 *
 * 🔴 写成「工作流定义」「流程执行」都是把人支去一个侧栏里**找不到**的名字 ——
 * 2026-09-29 就造过这个死路：卡片提示「可在「流程执行」页恢复」，而那个页压根不存在，
 * 抽屉当时还是只读的（见 `AssistantChat.vue` 里 INTERRUPTED 那段注释）。
 * 改菜单名时必须一起改这里，`resumeRoute.spec.ts` 会按这两个名字钉住。
 *
 * ⚠️ 恢复按钮只在 **INTERRUPTED** 行出现（其余状态调 resume 后端直接抛 STATE_INVALID），
 * 所以提示句用的是「查看它的状态；若仍停在「等待确认」，可在那里恢复」，
 * 而不是打包票说「点一下就能恢复」。
 */
export const EXECUTION_HISTORY_ROUTE = '「AI 助手 → 流程编排」页的「执行历史」'

/**
 * 把「执行编号 + 去哪儿恢复」拼成一句能直接贴在报错文案后面的话。
 *
 * 🔴 拿不到 executionId 时返回**空串**，不退化成一句没有编号的「可在执行历史恢复」：
 * 没有编号，用户到了抽屉里认不出是哪一条（同一个定义可能跑过几十次，列表按时间倒序，
 * 断连那次未必在第一行），那句提示就从「出路」变成「又一个死路」。
 *
 * 🔴 三处 `throw err` 共用本函数（`handleSend` / `handleHitlDecision` / 草稿卡运行），
 * 不要各自手写一句 —— 手写三份的失效形态是「其中一处漏了编号」，
 * 而那处恰好是最难复现的那条路径（连接中断本来就不好造，漏了也没人发现）。
 *
 * 🔴 本函数**不**改变「必须 throw」这条纪律：`fetchEventSource` 的 `onerror` 不抛异常就会
 * 自动无限重连，表现为同一个问题被反复提交、反复计费。调用方是「先把编号写到页面上，再 throw」。
 */
export const executionResumeHint = (executionId?: number | null): string =>
  executionId == null
    ? ''
    : `（本次已产生执行 #${executionId}：聊天里恢复不了时，可凭这个编号到${EXECUTION_HISTORY_ROUTE}里查看它的状态；若仍停在「等待确认」，可在那里恢复）`
