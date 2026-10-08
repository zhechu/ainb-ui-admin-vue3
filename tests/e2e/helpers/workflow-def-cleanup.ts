import type { APIRequestContext } from '@playwright/test'
import { API_BASE_URL } from './auth'

/**
 * 流程 def 的**归属判据**与拆台子（T1 / T2 / headless-gate 三份矩阵 spec 共用）
 *
 * ## 为什么要跟会话那份判据（`conversation-ownership.ts`）分开写
 * 两者的**凭据来源不一样**，硬凑成一份会把两件事都做坏：
 * - 会话的凭据是产品写进 localStorage 的「最近一次会话」id —— 一个能一路追到 DOM 的信号；
 * - def 没有这种信号。规划器造草稿走的是后端 SSE，前端只在草稿卡上渲染，
 *   **不落任何本地存档**，所以凭据只能是「用例体里当场记下的 id」（`claimed`）。
 *
 * ## 🔴 墓碑一：收尾**不许**用「跑后全集 − 跑前基线」决定删谁
 * 差集回答的是「库里多了什么」，回答不了「多的这条是**谁**建的」。
 * 三份 spec 原先都是这个口径，两种坏法都真发生过：
 * - **多认领**：同一时间窗里别人（另一个 e2e、或用户自己开的浏览器）新建的 def 落进差集被删掉。
 *   不可逆、无报错，报告还印一句「删除本轮新建 N 条」像是干得漂亮。
 *   会话那边 2026-10-07 真删过一条，def 这边只是还没撞上而已。
 * - **中断收尾**：差集里混进一条 `PUBLISHED` 时，`/workflow-def/delete` 按设计返回
 *   `WORKFLOW_DEF_NOT_DRAFT`，而原代码用 `expectOk` 直接把它抛出去 —— afterAll 在删除循环里就断了，
 *   **残留核账一行都没写、报告压根没落盘**。下一轮 `beforeAll` 把这条残留吃进基线，
 *   于是它永久隐形（正是下面墓碑三说的那种「对历史残留天生免疫」）。
 *
 * ## 🔴 墓碑二：只删 DRAFT 会漏掉「自行发布」，而那是本套用例**最该抓**的缺陷
 * 2026-10-08 02:07 的 T2 那一轮实测：示例「帮我配置【演示角色】角色…」被分型成 BUILD，
 * 规划器造出 def #567，然后**有东西把它发布并跑了起来**（02:07:59 PUBLISHED，02:08:00 执行 #174，
 * 停在 INTERRUPTED 上没人管）。而那一轮 T2 **全绿**，因为它的「没有东西越过闸口自行发布」
 * 只通过**物理表数**这个代理量在查 —— 那条示例不建表，代理量看不见它。
 * 所以这里把「本轮新造、却不是 DRAFT」单独判成 ❌，并且**不删**：
 * 删不掉（后端按设计拒绝）是一层，更重要的是静默删除等于把证据一起销毁。
 *
 * ## 🔴 墓碑三：`leftover` 不许是**条数**差
 * T1 原先写的是 `leftoverDef = afterDef.size - baselineDefIds.size`。
 * 条数差有两个致命问题：① 别人删掉一条 + 本轮残留一条 ⟹ 差为 0，恒绿；
 * ② 它拿**别人的数据**判自己的成败，和用别人的数据决定删谁是同一个错误的两面。
 * 换成 `leftoverOwned`：**本轮新造、且本该被删掉、却还在库里**的那些 id。
 */

const DEF_PAGE_API = `${API_BASE_URL}/agent/workflow-def/page`
const DEF_DELETE_API = `${API_BASE_URL}/agent/workflow-def/delete`
const DEF_DISABLE_API = `${API_BASE_URL}/agent/workflow-def/disable`
const EXECUTION_PAGE_API = `${API_BASE_URL}/agent/workflow/execution/page`
const EXECUTION_CANCEL_API = `${API_BASE_URL}/agent/workflow/cancel`

/** `/agent/workflow-def/page` 返回的一行（`dsl` 在列表端点恒为 null，故不取） */
export type DefRowLite = {
  id: number
  code?: string | null
  name?: string | null
  status: string
  /** MANUAL=手动添加，AUTO=规划器/助手对话自动生成。判「这条像不像本轮真发造出来的」就靠它 */
  source?: string | null
  triggerType?: string | null
}

/**
 * 能被 `POST /agent/workflow/cancel` 中止的状态白名单
 *
 * <p>🔴 与后端 `WorkflowExecutionStatusEnum.isCancellable` **同口径**（CREATED/RUNNING/INTERRUPTED）。
 *    刻意不写成「!isFinal」：`COMPENSATING` 不是终态但**不可取消**（反做只做了一半比卡死更难查），
 *    后端为此专门写了白名单而不是取反。这里跟着写白名单，新状态默认落进「不碰」。
 */
const CANCELLABLE_EXECUTION_STATUSES = ['CREATED', 'RUNNING', 'INTERRUPTED']

/**
 * 流程 def 全集（分页翻到底）
 *
 * <p>🔴 先验 code 再信 data。`body?.data?.list ?? []` 会把 401/500 静默吃成空清单，
 *    于是「跑后全集」是空集、差集也是空集 —— 一个恒绿的残留检查比没有检查更坏。
 */
export async function listWorkflowDefs(
  request: APIRequestContext,
  headers: () => Record<string, string>
): Promise<DefRowLite[]> {
  const out: DefRowLite[] = []
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const resp = await request.get(DEF_PAGE_API, {
      headers: headers(),
      params: { pageNo, pageSize: 100 }
    })
    const body = await resp.json()
    if (body?.code !== 0) {
      throw new Error(
        `取流程 def 分页失败（pageNo=${pageNo}，code=${body?.code}）：${body?.msg ?? ''}`
      )
    }
    const list = (body?.data?.list ?? []) as DefRowLite[]
    out.push(...list)
    if (list.length < 100) break
  }
  return out
}

export type DefCleanupReport = {
  /** 跑后库里多出来的（不在基线里）—— 全集，含不敢删的 */
  created: DefRowLite[]
  /** 真删掉的 id */
  deleted: number[]
  /**
   * 新造、没人认领、但 `source=AUTO` 的草稿 ⟹ 删了，同时报出来
   *
   * <p>⚠️ 不是干净轮次该有的东西：它说明有用例在记下 def id 之前就红掉了。
   */
  orphans: DefRowLite[]
  /**
   * 新造、却**不是 DRAFT** 的 ⟹ ❌ 有东西越过闸口自行发布了
   *
   * <p>不删（后端按设计拒绝，且删了等于销毁证据）。PUBLISHED 的会被停用，见 `disabled`。
   */
  selfPublished: DefRowLite[]
  /** 被停用（PUBLISHED → DISABLED）的 id */
  disabled: number[]
  /** 基线里的 def 被改成 PUBLISHED ⟹ ❌ 既有流程被自行发布 */
  promoted: DefRowLite[]
  /**
   * 新造、DRAFT、但**不是** AUTO 且没人认领 ⟹ 原样保留
   *
   * <p>那可能是别的用例（`wf_shallow_*` / `e2e_r08u_*` 这类手工 seed）或人的手工草稿。
   * 少认领只会脏，多认领不可逆 —— 与会话那边同一个取舍。
   */
  foreignDrafts: DefRowLite[]
  /** 本轮 def 名下被取消掉的挂起执行 id */
  cancelledExecutions: number[]
  /** 取消之后**仍**处于可取消状态的执行（❌ 清理静默失败） */
  leftoverExecutions: { defId: number; execId: number; status: string }[]
  /**
   * 本轮新造、本该删掉、却还在库里的 def id（§6.2：残留非空即视为该轮失败）
   *
   * <p>🔴 口径是「本轮造的还在不在」，不是条数差 —— 见文件头墓碑三。
   */
  leftoverOwned: number[]
  /**
   * 清理过程里的失败（请求抛异常、返回码非 0）
   *
   * <p>🔴 本函数**不 throw**：throw 会把 afterAll 打断，残留核账一行都写不出、报告落不了盘，
   *    那比留着一条残渣更坏（下一轮把它吃进基线，它就永久隐形了）。
   *    失败一律收进这里，由调用方在**报告落盘之后**统一断言。
   */
  failures: string[]
  /** markdown 报告行（已带换行） */
  lines: string[]
}

/**
 * 拆台子：只删本轮**认领的**（或明确是 AI 规划器造的）草稿，其余如实报出来
 *
 * @param baseline      跑前拍的 `id → status`。⚠️ 只用于「不许删」的兜底与「被自行发布」的判据
 * @param claimed       用例体里当场记下的 def id（可能为空：T1 是 CHAT 矩阵，本来就不该造 def）
 * @param claimsTracked 本 spec 到底**有没有**在逐条记 def id。只影响报告措辞，不影响删谁：
 *                      没记的话，删掉的那些全是按 `source=AUTO` 认下来的，
 *                      报告必须这么说 —— 印成「孤儿草稿（有用例红在记下 id 之前）」是**误诊**，
 *                      会把人支去查一条压根没红的用例
 */
export async function cleanupOwnedDefs(opts: {
  request: APIRequestContext
  headers: () => Record<string, string>
  baseline: Map<number, string>
  claimed: Iterable<number>
  claimsTracked?: boolean
}): Promise<DefCleanupReport> {
  const { request, headers, baseline } = opts
  const claimsTracked = opts.claimsTracked !== false
  const claimed = new Set(opts.claimed)
  const failures: string[] = []

  /** 发一次请求并把返回码验掉；失败记进 failures，返回 null（**不 throw**） */
  const call = async (
    what: string,
    run: () => Promise<any>
  ): Promise<any | null> => {
    try {
      const body = await run()
      if (body?.code !== 0) {
        failures.push(`${what}失败（code=${body?.code}）：${body?.msg ?? ''}`)
        return null
      }
      return body
    } catch (e: any) {
      failures.push(`${what}抛异常：${e?.message ?? String(e)}`)
      return null
    }
  }

  let defsNow: DefRowLite[]
  try {
    defsNow = await listWorkflowDefs(request, headers)
  } catch (e: any) {
    // 连清单都取不到时，后面所有判据都是空的。这时候**必须**说出来：
    // 「created 0 条」与「取清单失败」在报告里长得一模一样，而前者会被读成清干净了
    failures.push(`取流程 def 清单失败：${e?.message ?? String(e)}（下面的核账**全部无效**，需人工核）`)
    defsNow = []
  }

  const created = defsNow.filter((d) => !baseline.has(d.id))
  const promoted = defsNow.filter(
    (d) => baseline.has(d.id) && baseline.get(d.id) !== d.status && d.status === 'PUBLISHED'
  )

  const orphans: DefRowLite[] = []
  const selfPublished: DefRowLite[] = []
  const foreignDrafts: DefRowLite[] = []
  const deleteTargets: DefRowLite[] = []
  for (const d of created) {
    if (d.status !== 'DRAFT') {
      selfPublished.push(d)
    } else if (claimed.has(d.id)) {
      deleteTargets.push(d)
    } else if (d.source === 'AUTO') {
      orphans.push(d)
      deleteTargets.push(d)
    } else {
      foreignDrafts.push(d)
    }
  }

  // ---------- ① 先取消本轮 def 名下的挂起执行 ----------
  // 🔴 顺序是「先清执行、再删 def」，与 agent-workflow-cancel.spec.ts 的 afterAll 同口径。
  //    挂起执行（INTERRUPTED）是**正常等确认**、不是故障，可它会一直躺在那儿：
  //    既不落终态、又让 def 永远删不掉（PUBLISHED/DISABLED 可能被 sub_workflow 按 (code,version) 钉住）。
  //    `POST /agent/workflow/cancel` 是产品给管理员的唯一清场手段，夹具没有理由绕过它去改库。
  // 🔴 对 selfPublished 那些也照样取消：留着一条永远挂起的执行，
  //    正是 2026-10-08 那条 def #567 / 执行 #174 的形状。
  const cancelledExecutions: number[] = []
  const leftoverExecutions: { defId: number; execId: number; status: string }[] = []
  const listExecutions = async (defId: number) => {
    const body = await call(`取 def #${defId} 的执行分页`, async () =>
      (
        await request.get(EXECUTION_PAGE_API, {
          headers: headers(),
          params: { pageNo: 1, pageSize: 100, workflowDefId: defId }
        })
      ).json()
    )
    return ((body?.data?.list ?? []) as any[]).filter((r) =>
      CANCELLABLE_EXECUTION_STATUSES.includes(r?.status)
    )
  }
  for (const d of created) {
    for (const row of await listExecutions(d.id)) {
      const ok = await call(`取消 def #${d.id} 名下的挂起执行 #${row.id}`, async () =>
        (
          await request.post(EXECUTION_CANCEL_API, {
            headers: headers(),
            params: { executionId: row.id }
          })
        ).json()
      )
      if (ok) cancelledExecutions.push(row.id)
    }
    // 🔴 清完必须回读自检，不能「请求发出去了就算清过了」：cancel 自己也会失败
    //    （撞上晚到的 settle、或状态已不在白名单里）。静默失败的清理比不清理更坏 ——
    //    它把残渣从「看得见」变成「看不见」，下一轮再看到 INTERRUPTED 行时谁也不会怀疑到收尾头上
    for (const row of await listExecutions(d.id)) {
      leftoverExecutions.push({ defId: d.id, execId: row.id, status: row.status })
    }
  }

  // ---------- ② 删本轮新造的草稿 ----------
  const deleted: number[] = []
  for (const d of deleteTargets) {
    const body = await call(`删本轮新造的草稿 def #${d.id}`, async () =>
      (await request.delete(DEF_DELETE_API, { headers: headers(), params: { id: d.id } })).json()
    )
    if (body) deleted.push(d.id)
  }

  // ---------- ③ 自行发布的：停用，但**不删** ----------
  // 🔴 停用是为了**止住活的风险**（PUBLISHED 的 chatflow/schedule 会继续被触发），
  //    不是为了把证据抹掉：DISABLED 保留整行与全部执行历史，报告里也照样点名成 ❌。
  //    不停用的话，这条 def 会被下一轮的 beforeAll 吃进基线，从此永久隐形 ——
  //    那正是 #567 的遭遇。
  const disabled: number[] = []
  for (const d of selfPublished) {
    if (d.status !== 'PUBLISHED') continue
    const body = await call(`停用自行发布的 def #${d.id}`, async () =>
      (await request.post(DEF_DISABLE_API, { headers: headers(), params: { id: d.id } })).json()
    )
    if (body) disabled.push(d.id)
  }

  // ---------- ④ 回读：本轮造的还在不在 ----------
  const deletedSet = new Set(deleted)
  let leftoverOwned: number[] = []
  try {
    const after = await listWorkflowDefs(request, headers)
    const stillThere = new Set(after.map((d) => d.id))
    leftoverOwned = deleteTargets.map((d) => d.id).filter((id) => !deletedSet.has(id) && stillThere.has(id))
  } catch (e: any) {
    failures.push(`回读流程 def 清单失败：${e?.message ?? String(e)}（残留核账**无效**，需人工核）`)
    // 回读不到时按「该删的都算没删掉」报，宁可误报也不许印成清干净了
    leftoverOwned = deleteTargets.map((d) => d.id).filter((id) => !deletedSet.has(id))
  }

  // ---------- 报告 ----------
  const label = (d: DefRowLite) => `${d.id}/${d.status}${d.source ? `/${d.source}` : ''}「${d.name ?? ''}」`
  const lines: string[] = [
    `- 流程 def：跑前 ${baseline.size} 条 → 本轮新造 ${created.length} 条` +
      `${created.length ? `（${created.map(label).join(', ')}）` : ''} → 删草稿 ${deleted.length} 条\n`
  ]
  lines.push(
    orphans.length
      ? claimsTracked
        ? `- ⚠️ 其中没人认领的孤儿草稿（source=AUTO，说明有用例在记下 def id 之前就红掉了）：` +
          `${orphans.map((d) => d.id).join(', ')} —— 已删\n`
        : `- 按 source=AUTO 认下来并删掉的草稿（本 spec **不逐条记** def id，` +
          `所以没法区分「本轮真发造的」与「同窗内别人用助手造的」）：${orphans.map((d) => d.id).join(', ')}\n`
      : claimsTracked
      ? `- 其中没人认领的孤儿草稿：无\n`
      : `- 本轮新造的 AUTO 草稿：无\n`
  )
  lines.push(
    foreignDrafts.length
      ? `- ⚠️ 本轮期间多出的**手工来源**草稿（不是本轮认领的，可能是别的用例或人的）：` +
        `${foreignDrafts.map(label).join(', ')} —— 原样保留（删掉不可逆）\n`
      : `- 本轮期间多出的、非本轮所建的 def：无\n`
  )
  lines.push(
    selfPublished.length
      ? `- ❌ 本轮新造、却**不是草稿**的 def：${selfPublished.map(label).join(', ')} —— ` +
        `本套用例的设计是**不点「确认并运行」**，出现这一条说明有东西越过闸口自行发布了。` +
        `按设计不可删（可能已有执行历史、或被 sub_workflow 按 (code,version) 钉住），` +
        `已停用 ${disabled.length} 条，需人工核 DSL 与执行历史\n`
      : `- 本轮新造却不是草稿的 def（自行发布）：无\n`
  )
  lines.push(
    promoted.length
      ? `- ❌ 状态被改成 PUBLISHED 的**既有** def：${promoted.map(label).join(', ')} —— 自行发布就是缺陷\n`
      : `- 状态被改成 PUBLISHED 的既有 def：无\n`
  )
  lines.push(
    cancelledExecutions.length || leftoverExecutions.length
      ? `- 本轮 def 名下的挂起执行：走 /workflow/cancel 取消 ${cancelledExecutions.length} 条` +
        `${
          leftoverExecutions.length
            ? `；❌ 取消后**仍**挂着 ${leftoverExecutions.length} 条（` +
              leftoverExecutions.map((r) => `def#${r.defId}/exec#${r.execId}/${r.status}`).join(', ') +
              `）`
            : '；取消后回读为空'
        }\n`
      : `- 本轮 def 名下的挂起执行：无\n`
  )
  if (leftoverOwned.length) {
    lines.push(
      `- ❌ 本轮自建、却**没删掉**的流程 def：${leftoverOwned.join(', ')} —— 删除静默失败或压根没发起\n`
    )
  }
  if (failures.length) {
    // 🔴 这一段是「清理失效」的可见化。少清只会脏（自己的残渣留在库里），
    //    而**报成清干净了**才是真正坏的那件事，所以宁可多印几行 ⚠️
    lines.push(
      `- ⚠️ 收尾过程有 ${failures.length} 处失败（下面这些是**没清干净**的证据，` +
      `别把上面「删草稿 ${deleted.length} 条」读成清干净了）：\n` +
        failures.map((f) => `  - ${f}\n`).join('')
    )
  }

  return {
    created,
    deleted,
    orphans,
    selfPublished,
    disabled,
    promoted,
    foreignDrafts,
    cancelledExecutions,
    leftoverExecutions,
    leftoverOwned,
    failures,
    lines
  }
}
