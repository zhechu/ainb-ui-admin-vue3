import { test, expect, type APIRequestContext } from '@playwright/test'
import {
  cleanupOwnedDefs,
  type DefRowLite
} from './helpers/workflow-def-cleanup'

/**
 * `helpers/workflow-def-cleanup.ts` 的**构造样本**测试：不跑真发、不联网、不花钱
 *
 * ## 为什么这份判据值得单独钉（与 `conversation-ownership.spec.ts` 同一个理由）
 * 它决定的是「afterAll 删谁、以及删不掉的时候怎么说」。判据错了有两个方向，坏的程度天差地别：
 * - **多认领**（把别人的 def 算成自己的）⟹ 删掉别人正在用的东西，不可逆。
 * - **少认领**（自己造的没删掉）⟹ 残渣留在库里，脏，但可逆、且不动别人的东西。
 *
 * 所以本文件的重心也在**多认领那一侧**，外加两条只有 def 这边才有的：
 * - ②「本轮新造却不是草稿」—— 这是 2026-10-08 真漏掉的那一格（def #567 被自行发布成 PUBLISHED、
 *   还跑出一条挂在闸口上的执行 #174，而那一轮 T2 **全绿**）；
 * - ⑦ leftover 的口径 —— 原先写的是「跑后条数 − 跑前条数」，那是个**恒绿**的尺子。
 *
 * ## 🔴 变异探针怎么打
 * 1. 把 `cleanupOwnedDefs` 里的 `else if (d.source === 'AUTO')` 那一支连同 `foreignDrafts` 一起去掉
 *    （即恢复「不在基线里的 DRAFT 全删」）⟹ 用例 ① 必须红（别人的手工草稿被删）。
 * 2. 把 `if (d.status !== 'DRAFT') { selfPublished.push(d) }` 改成 `continue`
 *    （即恢复「只删 DRAFT、别的不管」）⟹ 用例 ② 必须红。
 * 3. 把 `leftoverOwned` 换成 `defsNow.length - baseline.size` 那种条数差 ⟹ 用例 ⑦ 必须红。
 * 4. 把 `call` 里的 try/catch 去掉、让异常往外抛 ⟹ 用例 ⑥ 必须红（afterAll 会被打断）。
 * 5. 把执行取消后的那次回读去掉 ⟹ 用例 ⑤ 必须红（取消失败会被报成清干净了）。
 * 只红不退、或红在别的断言上，都算探针无效。
 */

type Row = DefRowLite & { __exec?: { id: number; status: string }[] }

/**
 * 假的 APIRequestContext：只实现本判据用到的 get/delete/post，并把做过的动作记下来
 *
 * <p>🔴 形状照真接口抄：`/page` 返回 `{code,data:{list}}`，删除/取消/停用返回 `{code,data}`。
 *    抄错形状会让用例**假绿**（测的是我手写的形状，不是产品返回的形状）——
 *    与 `conversation-ownership.spec.ts` 里那个 `envelope()` 用 JSON.stringify 拼是同一个道理。
 */
function fakeApi(opts: {
  defs: Row[]
  /** 删除会失败（返回非 0 码）的 def id —— 模拟 token 过期或状态不许删 */
  failDelete?: number[]
  /** 取消会失败的执行 id */
  failCancel?: number[]
  /** 分页接口整个 500 —— 模拟「清单取不到」 */
  pageThrows?: boolean
}) {
  const deleted: number[] = []
  const disabled: number[] = []
  const cancelled: number[] = []
  const failDelete = new Set(opts.failDelete ?? [])
  const failCancel = new Set(opts.failCancel ?? [])
  // 删掉/停用的行要真的从「库里」消失或改状态，回读才验得出东西
  const live = new Map(opts.defs.map((d) => [d.id, { ...d }]))

  const request = {
    get: async (url: string, o: any) => ({
      json: async () => {
        if (opts.pageThrows) return { code: 500, msg: 'Internal Server Error' }
        if (url.includes('/workflow-def/page')) {
          return { code: 0, data: { list: [...live.values()].map(({ __exec, ...rest }) => rest) } }
        }
        if (url.includes('/workflow/execution/page')) {
          const defId = o?.params?.workflowDefId
          return { code: 0, data: { list: live.get(defId)?.__exec ?? [] } }
        }
        return { code: 404, msg: 'unexpected get ' + url }
      }
    }),
    delete: async (_url: string, o: any) => ({
      json: async () => {
        const id = o?.params?.id
        if (failDelete.has(id)) return { code: 1_030_900_001, msg: '删除失败（模拟）' }
        const row = live.get(id)
        if (!row) return { code: 1_030_900_000, msg: '流程定义不存在' }
        // 后端 deleteDef 只允许 DRAFT，非草稿一律拒（AgentWorkflowDefServiceImpl:319）
        if (row.status !== 'DRAFT') return { code: 1_030_900_002, msg: '只有草稿状态的流程定义才能删除' }
        live.delete(id)
        deleted.push(id)
        return { code: 0, data: true }
      }
    }),
    post: async (url: string, o: any) => ({
      json: async () => {
        if (url.includes('/workflow/cancel')) {
          const id = o?.params?.executionId
          if (failCancel.has(id)) return { code: 1_030_901_000, msg: '当前状态不允许取消' }
          for (const row of live.values()) {
            const hit = (row.__exec ?? []).find((e) => e.id === id)
            if (hit) hit.status = 'CANCELLED'
          }
          cancelled.push(id)
          return { code: 0, data: true }
        }
        if (url.includes('/workflow-def/disable')) {
          const id = o?.params?.id
          const row = live.get(id)
          if (!row) return { code: 1_030_900_000, msg: '流程定义不存在' }
          if (row.status !== 'PUBLISHED') return { code: 1_030_900_003, msg: '只有已发布的流程才能停用' }
          row.status = 'DISABLED'
          disabled.push(id)
          return { code: 0, data: true }
        }
        return { code: 404, msg: 'unexpected post ' + url }
      }
    })
  } as unknown as APIRequestContext
  return { request, deleted, disabled, cancelled, live }
}

const run = (api: APIRequestContext, baseline: Map<number, string>, claimed: number[], claimsTracked?: boolean) =>
  cleanupOwnedDefs({
    request: api,
    headers: () => ({}),
    baseline,
    claimed,
    ...(claimsTracked === undefined ? {} : { claimsTracked })
  })

test.describe('流程 def 归属判据（构造样本）', () => {
  test('① 🔴 只删本轮认领的草稿：别人的**手工**草稿必须原样保留', async () => {
    // a) 干净轮次：跑前 1/2，本轮认领了 3。此时报告里**一条 ⚠️ 都不该有** ——
    //    warn 满天飞等于没有 warn，下一个人会开始忽略它
    const a = fakeApi({
      defs: [
        { id: 1, name: '既有已发布', status: 'PUBLISHED', source: 'MANUAL' },
        { id: 2, name: '既有草稿', status: 'DRAFT', source: 'MANUAL' },
        { id: 3, name: '本轮认领的', status: 'DRAFT', source: 'AUTO', code: 'wf_plan_a_1' }
      ]
    })
    const baseline = new Map([
      [1, 'PUBLISHED'],
      [2, 'DRAFT']
    ])
    const ra = await run(a.request, baseline, [3])
    expect(a.deleted, '本轮认领的草稿没被删掉').toEqual([3])
    expect(ra.foreignDrafts).toEqual([])
    expect(ra.failures, '干净轮次不该有 failures').toEqual([])
    expect(ra.lines.join(''), '干净轮次不该印 ⚠️').not.toContain('⚠️')
    expect(ra.lines.join(''), '干净轮次不该印 ❌').not.toContain('❌')

    // b) 同一时间窗里**别人**手工建了一条草稿（真形状：wf_shallow_r06b_* / e2e_r08u_* 那批）。
    //    它不在账本里、来源也不是 AUTO ⟹ 必须原样保留
    const b = fakeApi({
      defs: [
        { id: 1, name: '既有已发布', status: 'PUBLISHED', source: 'MANUAL' },
        { id: 2, name: '既有草稿', status: 'DRAFT', source: 'MANUAL' },
        { id: 3, name: '本轮认领的', status: 'DRAFT', source: 'AUTO', code: 'wf_plan_a_1' },
        { id: 4, name: '别人的手工草稿', status: 'DRAFT', source: 'MANUAL', code: 'wf_shallow_x' }
      ]
    })
    const rb = await run(b.request, baseline, [3])

    expect(b.deleted, '删到了账本以外的 def —— 那是别人的东西，删掉不可逆').toEqual([3])
    expect(b.live.has(4), '别人的手工草稿被删了').toBe(true)
    expect(rb.foreignDrafts.map((d) => d.id), '外来草稿没被如实报出来').toEqual([4])
    const text = rb.lines.join('')
    expect(text, '报告里没点名那条被保留的外来草稿').toContain('4')
    expect(text, '外来草稿必须写成「原样保留」，不能让人以为清干净了').toContain('原样保留')
    expect(rb.leftoverOwned).toEqual([])
  })

  test('② 🔴 本轮新造却不是草稿：不删、判成自行发布、并停用（def #567 那一格）', async () => {
    // 这就是 2026-10-08 02:07 那轮的实测形状：规划器造出草稿，随后**有东西把它发布并跑了起来**，
    // 留下一条挂在闸口上的 INTERRUPTED 执行。原先的收尾只删 DRAFT、`promoted` 又只看基线里的 def，
    // 于是这一条**没有任何断言覆盖** ⟹ T2 全绿，#567 永久留在库里
    const { request, deleted, disabled, cancelled, live } = fakeApi({
      defs: [
        {
          id: 567,
          name: '配置演示角色AI助手权限',
          status: 'PUBLISHED',
          source: 'AUTO',
          code: 'wf_plan_muyf6s9l_4',
          __exec: [{ id: 174, status: 'INTERRUPTED' }]
        }
      ]
    })

    const report = await run(request, new Map(), [567])

    expect(deleted, 'PUBLISHED 按设计删不掉，也不该删（静默删除等于把证据一起销毁）').toEqual([])
    expect(report.selfPublished.map((d) => d.id), '自行发布的那一条没被抓出来').toEqual([567])
    expect(disabled, '没走产品的停用端点止住活的风险 —— 它会被下一轮吃进基线，从此永久隐形').toEqual([567])
    expect(live.get(567)?.status, '停用后应落在产品自己的退役态').toBe('DISABLED')
    expect(cancelled, '挂着的那条执行没被取消').toEqual([174])
    expect(report.leftoverExecutions, '取消之后回读应为空').toEqual([])
    const text = report.lines.join('')
    expect(text, '报告里必须点名成 ❌，不能只印「删草稿 0 条」').toContain('❌')
    expect(text, '报告必须说清是「越过闸口自行发布」，否则下一个人不知道去查什么').toContain('自行发布')
    expect(text).toContain('567')
  })

  test('③ 没人认领的 AUTO 草稿：照样删（兜住「用例红在记下 id 之前」），但措辞要如实', async () => {
    const mk = () =>
      fakeApi({
        defs: [
          { id: 10, name: '孤儿 AI 草稿', status: 'DRAFT', source: 'AUTO' },
          { id: 11, name: '孤儿手工草稿', status: 'DRAFT', source: 'MANUAL' }
        ]
      })

    // a) 逐条记 id 的 spec（T2 / headless-gate）：这是**异常**，得印 ⚠️ 说明有用例红掉了
    const a = mk()
    const ra = await run(a.request, new Map(), [])
    expect(a.deleted, '孤儿 AUTO 草稿没被兜住 —— 它会一轮一轮往上叠').toEqual([10])
    expect(ra.orphans.map((d) => d.id)).toEqual([10])
    expect(ra.lines.join(''), 'claimsTracked 时必须报成「孤儿草稿」⚠️').toContain('孤儿草稿')
    expect(ra.lines.join('')).toContain('⚠️')

    // b) 不逐条记 id 的 spec（T1 是 CHAT 矩阵）：按 source=AUTO 认下来是**常态**，
    //    印成「孤儿草稿（有用例红掉了）」是误诊，会把人支去查一条压根没红的用例
    const b = mk()
    const rb = await run(b.request, new Map(), [], false)
    expect(b.deleted).toEqual([10])
    const textB = rb.lines.join('')
    expect(textB, '不逐条认领时必须如实说「本 spec 不逐条记 def id」').toContain('不逐条记')
    expect(textB, '同一件事在 b) 里不该被报成异常').not.toContain('孤儿草稿')

    // c) 两侧都不该碰 MANUAL 的那条
    expect(a.live.has(11) && b.live.has(11), '手工来源的草稿被删了').toBe(true)
  })

  test('④ 基线里的 def 被改成 PUBLISHED ⟹ promoted（既有流程被自行发布）', async () => {
    const { request, deleted, disabled } = fakeApi({
      defs: [
        { id: 20, name: '跑前是草稿', status: 'PUBLISHED', source: 'MANUAL' },
        { id: 21, name: '跑前就已发布', status: 'PUBLISHED', source: 'MANUAL' },
        { id: 22, name: '跑前已发布、这轮被停用', status: 'DISABLED', source: 'MANUAL' }
      ]
    })

    const report = await run(
      request,
      new Map([
        [20, 'DRAFT'],
        [21, 'PUBLISHED'],
        [22, 'PUBLISHED']
      ]),
      []
    )

    expect(report.promoted.map((d) => d.id), '既有草稿被发布成 PUBLISHED 没被抓出来').toEqual([20])
    expect(deleted, '基线里的 def 一条都不许删').toEqual([])
    expect(disabled, 'promoted 不是本轮新造的，停用它是越界').toEqual([])
    expect(report.lines.join('')).toContain('❌')
  })

  test('⑤ 🔴 取消挂起执行之后必须回读：取消失败不许被报成清干净了', async () => {
    const { request, cancelled } = fakeApi({
      defs: [
        {
          id: 30,
          name: '带两条挂起执行',
          status: 'DRAFT',
          source: 'AUTO',
          // SUCCEEDED 是终态，不该被碰；COMPENSATING 不在可取消白名单里（后端 isCancellable 的口径），也不该被碰
          __exec: [
            { id: 300, status: 'INTERRUPTED' },
            { id: 301, status: 'RUNNING' },
            { id: 302, status: 'SUCCEEDED' },
            { id: 303, status: 'COMPENSATING' }
          ]
        }
      ],
      failCancel: [301]
    })

    const report = await run(request, new Map(), [30])

    expect(cancelled, '只该对 CREATED/RUNNING/INTERRUPTED 三档**成功**取消（301 被模拟成失败）').toEqual([300])
    expect(
      report.leftoverExecutions,
      '301 取消失败了，回读必须把它报出来 —— 静默失败的清理比不清理更坏'
    ).toEqual([{ defId: 30, execId: 301, status: 'RUNNING' }])
    expect(report.lines.join('')).toContain('❌')
    // def 本身照样删得掉（DRAFT）：执行没清干净是**另一件**事，不该互相掩盖
    expect(report.deleted).toEqual([30])
  })

  test('⑥ 🔴 任何一步失败都**不许 throw**，且必须印出 ⚠️', async () => {
    // a) 删除失败（token 过期 / 状态不许删）
    const a = fakeApi({
      defs: [{ id: 40, name: '删不掉的草稿', status: 'DRAFT', source: 'AUTO' }],
      failDelete: [40]
    })
    const ra = await run(a.request, new Map(), [40])
    expect(ra.deleted).toEqual([])
    expect(ra.leftoverOwned, '删失败了却没记成残留').toEqual([40])
    expect(ra.failures.join(''), '失败原因必须原样带出来，否则下一个人只知道「没删掉」').toContain('1030900001')
    expect(ra.lines.join('')).toContain('⚠️')
    expect(ra.lines.join(''), '光说「有失败」还不够，得把「别读成清理干净」也写进去').toContain('别把上面')

    // b) 分页接口整个 500：这时候 created 是空集，与「真的没有新增」在报告里长得一模一样
    const b = fakeApi({ defs: [{ id: 41, name: 'x', status: 'DRAFT', source: 'AUTO' }], pageThrows: true })
    let rb: Awaited<ReturnType<typeof run>> | undefined
    let threw = ''
    try {
      rb = await run(b.request, new Map(), [41])
    } catch (e: any) {
      threw = e?.message ?? String(e)
    }
    expect(threw, 'throw 会把 afterAll 打断在 flushReport 之前，残留核账一行都落不了盘').toBe('')
    expect(rb?.failures.join(''), '取不到清单必须说出来，不能印成「本轮新造 0 条」').toContain('全部无效')
    expect(rb?.lines.join('')).toContain('⚠️')
  })

  test('⑦ 🔴 leftover 不许是**条数差**：别人删一条 + 本轮残留一条，条数差是 0', async () => {
    // 基线 2 条。跑动期间：#1 被**别人**删了，本轮新造的 #50 删不掉（模拟删除失败）。
    // 跑后还是 2 条 ⟹ 老口径 `afterDef.size - baselineDefIds.size === 0` ⟹ **恒绿**。
    // 新口径问的是「本轮造的那条还在不在」⟹ 必须红。
    const { request } = fakeApi({
      defs: [
        { id: 2, name: '既有草稿', status: 'DRAFT', source: 'MANUAL' },
        { id: 50, name: '本轮残留', status: 'DRAFT', source: 'AUTO' }
      ],
      failDelete: [50]
    })

    const report = await run(
      request,
      new Map([
        [1, 'PUBLISHED'],
        [2, 'DRAFT']
      ]),
      [50]
    )

    expect(report.leftoverOwned, '条数差为 0 就把残留放过去了 —— 用别人的数据判自己的成败').toEqual([50])
    expect(report.lines.join('')).toContain('❌')
  })
})
