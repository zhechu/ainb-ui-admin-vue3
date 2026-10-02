import type { AgentWorkflowDefValidateVO } from '@/api/agent/workflow'

/**
 * 发布预检的判定逻辑（重构 S4b / 前端半边）
 *
 * <h3>🔴 为什么这个预检不是「少一次往返」的优化，而是唯一可读的通道</h3>
 * 后端闸门拒发布时抛 `WORKFLOW_DEF_VALIDATE_FAILED`，文案里逐条列了 error。但
 * `src/config/axios/service.ts` 的响应拦截器对业务错误码只做
 * `ElNotification.error({ title: msg })` 然后 `Promise.reject('error')` ——
 * reject 出去的是**字面量字符串 'error'**，不带 msg（台账 #91）。
 * 于是调用方永远拿不到那段文字，用户看到的是一个 4.5 秒自动消失的通知，
 * 而且 `catch (e)` 里连 `e.message` 都是 undefined。
 *
 * 所以「逐条列出要改什么」这件事，今天只能由前端在**发请求之前**做完：
 * `/validate` 返回的是 200 + 结构化 `{passed, errors, warnings}`，绕开了拦截器那条吞文案的分支。
 * 后端闸门仍然是**权威**判定（预检通过不代表一定发得出去，中间可能有人改了库），
 * 它只是没有一条能把话说到用户眼前的通路。
 *
 * <h3>为什么判定要单独抽成一个纯模块</h3>
 * 两个宿主（列表页 `handlePublish`、聊天确认卡 `handleConfirmWorkflow`）要的是同一套判定，
 * 而 vitest 从不 mount `.vue`（本目录既有约定：逻辑放 `.ts`，配一个同名 `.spec.ts`）。
 * 判定写在组件里就等于零单测覆盖 —— 而这段逻辑里最容易写错的两条恰恰是「反了就会出人命」的方向：
 * 把 warning 也当成阻断（存量 20+ 行一夜发不出去），以及预检自己坏了就把人堵死（该降级成照发）。
 */

/** 预检自己没能跑成时的兜底文案：说清「没跑成」而不是「没问题」 */
const PRECHECK_UNAVAILABLE = '体检接口没有响应（可能缺少 agent:workflow:query 权限，或后端不可达）'

/** 流程内容为空是本地就能判定的，不必降级成「盲发」再让后端用一条读不到的文案拒回来 */
const DSL_EMPTY = '流程内容为空，无法发布：请先在设计器里把节点连起来'

/** 后端说未通过却一条 error 都没给 —— 这本身是缺陷，但不能渲染成一个空对话框 */
const NO_ERROR_DETAIL =
  '后端判定这条流程不能发布，但没有返回具体的错误项。这本身是个缺陷，请把流程编码告知管理员。'

export type PublishGateVerdict =
  | {
      /** 体检通过：可以发。warnings 带出来让宿主提示「有 N 条建议调整」，与设计器口径一致 */
      action: 'publish'
      warnings: string[]
    }
  | {
      /** 有阻断错误：不发，且必须把 errors 逐条渲染出来 */
      action: 'block'
      errors: string[]
      warnings: string[]
    }
  | {
      /**
       * 预检自己没跑成（取不到 DSL / 接口 403 / 网络错）。
       *
       * 🔴 降级成「照发」而不是「堵死」：预检是**为了让人读懂**才存在的一层，
       * 它坏了不该反过来变成一道没人授权过的新闸门 —— 尤其 403 是权限配置问题（台账 #70），
       * 与这条流程合不合法毫无关系。后端闸门仍是权威，真不合法它照样拒。
       * 代价是那次拒绝的文案会被拦截器吞掉，所以宿主要把 reason 显示出来，
       * 用户至少知道「刚才那下没预检成」，而不是对着一个空白的失败发愣。
       */
      action: 'publish-blind'
      reason: string
    }

/**
 * 把一份体检结果判成三态之一。纯函数，不做 I/O。
 *
 * @param result `/validate` 的响应；null / undefined 表示「压根没拿到结果」
 */
export const decidePublishGate = (
  result?: AgentWorkflowDefValidateVO | null
): PublishGateVerdict => {
  if (!result) {
    return { action: 'publish-blind', reason: PRECHECK_UNAVAILABLE }
  }
  // 🔴 过一遍线：这两个字段是 HTTP 上来的，`v-for` 一个 undefined 会直接渲染报错
  const errors = Array.isArray(result.errors) ? result.errors : []
  const warnings = Array.isArray(result.warnings) ? result.warnings : []
  // 🔴 判据取「passed 为假 **或** errors 非空」，而不是只信其中一个：
  //    后端的 passed 就是 errors.isEmpty()，两者本该等价；一旦不等价（字段漂了、响应被截断了），
  //    fail-close 的方向是拦下来 —— 一道闸门在自相矛盾时放行，比它误拦一次坏得多。
  if (!result.passed || errors.length > 0) {
    return {
      action: 'block',
      errors: errors.length > 0 ? errors : [NO_ERROR_DETAIL],
      warnings
    }
  }
  return { action: 'publish', warnings }
}

/**
 * 跑一次发布预检：取 DSL → 打 `/validate` → 判成三态。
 *
 * 两个依赖都以函数注入，而不是在这里直接 import API：本目录的 `.spec.ts` 一律是纯逻辑单测
 * （没有任何 `vi.mock`），注入之后用普通箭头函数就能把 403、超时、空 DSL 这些分支全跑一遍。
 *
 * @param loadDsl  取这条流程的 DSL 原文。🔴 列表页必须走 `GET /get?id`：
 *                 `GET /page` 刻意把 dsl 置成 null（一份 DSL 几十 KB，一页 20 行就是兆级负载），
 *                 所以**行里没有 dsl**，拿 row.dsl 去预检会永远走进「内容为空」那条。
 * @param validate 打 `/validate`
 */
export const precheckPublish = async (
  loadDsl: () => Promise<string | null | undefined>,
  validate: (dsl: string) => Promise<AgentWorkflowDefValidateVO>
): Promise<PublishGateVerdict> => {
  let dsl: string | null | undefined
  try {
    dsl = await loadDsl()
  } catch {
    // 取不到 DSL 与「体检不通过」是两件事：前者是这一层坏了，按降级处理
    return { action: 'publish-blind', reason: '取不到流程内容，未能预检' }
  }
  if (!dsl?.trim()) {
    return { action: 'block', errors: [DSL_EMPTY], warnings: [] }
  }
  try {
    return decidePublishGate(await validate(dsl))
  } catch {
    return { action: 'publish-blind', reason: PRECHECK_UNAVAILABLE }
  }
}
