import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiHeaders, apiLogin, gotoWithAuth, login, API_BASE_URL } from './helpers/auth'

/**
 * 已停用的流程定义**不许**被恢复执行（迭代七 B3-3）
 *
 * 🔴 为什么非要走浏览器
 * 后端那半（`AgentWorkflowExecutionServiceImpl#requireDefResumable`）已由单测钉住；
 * 但本条的判据在方案 §8 里写的是**③行为层**：「把定义置 DISABLED → **真点恢复** → 被拒，
 * 且告警真的发出去了」。只有真点一次才能暴露这几件单测看不到的事：
 *   · 抽屉里「恢复」按钮在定义停用后**照样亮着**（它的条件只看 row.status==='INTERRUPTED'）——
 *     这是有意的：按钮亮着 + 点了给一句说得清的拒绝，好过按钮消失让人以为界面坏了；
 *   · 后端那句拒绝**穿得过 SSE 流**并落到 `message.error` 上（`payload.code !== 0` 那一支）；
 *   · 拒绝之后列表**自动刷新**，且那一行**仍是「等待确认」**——刻意不写终态：
 *     写成 FAILED 会让「定义被停用」和「执行自己失败了」在库里长成同一个样子。
 *
 * 🔴 0 LLM token、0 写操作：seed 的流程五个节点全只读（tool data_interface_list × 3 +
 * hitl.confirm + condition.rule），两条分支都只读，所以敢在真库上真点「恢复」。
 *
 * ⚠️ 「告警真的发出去了」这半**不在本 spec 里断言**：本轮告警面只到日志（一条可 grep 的 WARN，
 * 刻意不借 `AgentFailureAlertService` —— 那条通道的语义是「执行进了 FAILED 终态」，而本处执行
 * 仍是 INTERRUPTED，借它发站内信等于替一个没失败的执行编病因）。日志由跑完后 grep 后端输出验证，
 * 标记串是 `[requireDefResumable]`；真正的告警通道等第 07 轮 B5-4。
 *
 * 前置：后端 48080 + 前端 dev :80 在跑。
 * 自 seed 自净：afterAll **取消**那条挂起执行（否则留下一行永远恢复不了的 INTERRUPTED），
 * 定义保持 DISABLED（PUBLISHED 不可删，停用即是本子系统对「不再被跑起来」的收口）。
 */

/** 与 agent-workflow-resume.spec.ts 同款形状：START → list → gate → check → yes/no */
const dsl = (code: string) =>
  JSON.stringify(
    {
      dslVersion: '1.0',
      id: code,
      name: code,
      description: 'B3-3 e2e：只读闸口，用于验证「定义停用后不许恢复」，全链路 0 LLM token、0 写操作',
      trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: '' } },
      variables: [
        { key: 'input', type: 'string', merge: 'replace', required: false },
        { key: 'list_out', type: 'object', merge: 'replace' },
        { key: 'confirm_result', type: 'boolean', merge: 'replace' },
        { key: 'yes_out', type: 'object', merge: 'replace' },
        { key: 'no_out', type: 'object', merge: 'replace' }
      ],
      nodes: [
        {
          id: 'list',
          type: 'tool',
          name: '列表',
          config: { toolId: 'data_interface_list', args: {}, outputVar: 'list_out' }
        },
        { id: 'gate', type: 'hitl.confirm', name: '人工确认', config: { approveVar: 'confirm_result' } },
        {
          id: 'check',
          type: 'condition.rule',
          name: '分流',
          config: {
            branches: [{ target: 'approved', conditions: [{ var: 'confirm_result', op: 'is_true' }] }],
            default: 'rejected'
          }
        },
        {
          id: 'yes',
          type: 'tool',
          name: '同意分支',
          config: { toolId: 'data_interface_list', args: {}, outputVar: 'yes_out' }
        },
        {
          id: 'no',
          type: 'tool',
          name: '拒绝分支',
          config: { toolId: 'data_interface_list', args: {}, outputVar: 'no_out' }
        }
      ],
      edges: [
        { from: 'START', to: 'list' },
        { from: 'list', to: 'gate' },
        { from: 'gate', to: 'check' },
        { from: 'check', to: null, type: 'conditional', cases: { approved: 'yes' }, default: 'no' },
        { from: 'yes', to: 'END' },
        { from: 'no', to: 'END' }
      ],
      settings: { recovery: 'forward', executionTimeoutSeconds: 60 }
    },
    null,
    2
  )

test.describe('定义已停用时恢复被拒（B3-3）', () => {
  test.setTimeout(240_000)

  let code = ''
  let wfId = 0
  let execId = 0
  let req: APIRequestContext
  let token = ''

  const api = async (path: string, method = 'GET', body?: any) =>
    req.fetch(API_BASE_URL + path, {
      method,
      data: body,
      timeout: 60_000,
      headers: { 'Content-Type': 'application/json', ...apiHeaders(token) }
    })

  /** 真跑一次 run-stream 停在闸口上，返回那条挂起执行行（落库与流关闭之间有窗口，故轮询） */
  const runUntilSuspended = async (): Promise<any> => {
    await (await api('/agent/workflow/run-stream', 'POST', { code, input: { input: 'e2e' } })).text()
    for (let i = 0; i < 40; i++) {
      const page = await (
        await api('/agent/workflow/execution/page?pageNo=1&pageSize=10&workflowDefId=' + wfId)
      ).json()
      const hit = (page?.data?.list ?? []).find((r: any) => r.status === 'INTERRUPTED')
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error('run-stream 之后没等到 INTERRUPTED 的执行行')
  }

  const traceNodeIds = async (): Promise<string[]> => {
    const r = await (await api('/agent/workflow/node-trace/list?executionId=' + execId)).json()
    return ((r?.data ?? []) as any[]).map((t) => t.nodeId)
  }

  const statusOf = async (): Promise<string> => {
    const page = await (
      await api('/agent/workflow/execution/page?pageNo=1&pageSize=10&workflowDefId=' + wfId)
    ).json()
    return (page?.data?.list ?? []).find((r: any) => r.id === execId)?.status ?? '(查不到)'
  }

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext()
    token = await apiLogin(req)

    code = 'wf_b33_e2e_' + Date.now().toString(36)
    const mk = await (
      await api('/agent/workflow-def/create', 'POST', {
        code,
        name: code,
        dsl: dsl(code),
        description: 'B3-3 e2e'
      })
    ).json()
    if (mk.code !== 0) throw new Error('create workflow failed: ' + JSON.stringify(mk))
    wfId = mk.data
    const pub = await (await api('/agent/workflow-def/publish?id=' + wfId, 'POST')).json()
    if (pub.code !== 0) throw new Error('publish workflow failed: ' + JSON.stringify(pub))

    const suspended = await runUntilSuspended()
    execId = suspended.id
  })

  test.afterAll(async () => {
    // 🔴 清理必须在这里、不能在用例体末尾：用例一红，末尾那句就被跳过，
    //    留下的是一行永远恢复不了的 INTERRUPTED（定义已停用）—— 正是本 spec 要防的那种残渣。
    if (execId) await api('/agent/workflow/cancel?executionId=' + execId, 'POST').catch(() => {})
    if (wfId) await api('/agent/workflow-def/disable?id=' + wfId, 'POST').catch(() => {})
    await req?.dispose()
  })

  test('停用定义后真点「恢复」→ 被拒、点名是哪个定义、执行行仍停在等待确认', async ({ page }) => {
    // 停用必须在「跑起来」之后：run() 走 getPublishedByCode，停用了压根选不出来，
    // 也就造不出「挂起中的执行 + 已停用的定义」这个组合 —— 而这个组合正是本条的全部场景。
    const dis = await (await api('/agent/workflow-def/disable?id=' + wfId, 'POST')).json()
    expect(dis.code, '停用定义失败：' + JSON.stringify(dis)).toBe(0)

    const traceBefore = await traceNodeIds()
    expect(traceBefore, '挂起时应已跑过闸口前的 list：' + JSON.stringify(traceBefore)).toContain(
      'list'
    )

    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    const search = page.locator('input[placeholder="请输入流程编码"]')
    await search.fill(code)
    await search.press('Enter')

    const row = page.locator('.el-table__body tr').filter({ hasText: code }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    // 🔴 反向自检：列表上这一行确实显示「已停用」。不先钉住这一条，
    //    万一 disable 接口没生效（或列表读的是缓存），后面那句拒绝就可能是别的原因给的。
    await expect(row.locator('.el-tag').filter({ hasText: '已停用' }).first()).toBeVisible()

    await row.getByRole('button', { name: '执行历史' }).click()
    const drawer = page.locator('.el-drawer').filter({ hasText: '执行历史' }).first()
    await expect(drawer).toBeVisible({ timeout: 15000 })

    /**
     * 按「执行编号」那一格精确定位行。
     * 🔴 不能用 hasText(id)：耗时、时间戳里都可能出现同样的数字，会串到别的行上。
     */
    const execRow = drawer
      .locator('.el-table__body tr')
      .filter({ has: page.locator('td').filter({ hasText: new RegExp(`^\\s*${execId}\\s*$`) }) })
    await expect(execRow).toHaveCount(1)

    // 🔴 判据 1：定义停用了，「恢复」按钮**照样在**（它的条件只看执行状态）。
    //    这是有意的取舍，故这里把它钉住：按钮消失会让人以为界面坏了、进而去翻前端代码，
    //    而真正的答案在后端那条守卫上 —— 让人点得到、点了给一句说得清的拒绝，比藏起来好。
    await expect(execRow.getByRole('button', { name: '恢复' })).toBeVisible()

    await execRow.getByRole('button', { name: '恢复' }).click()
    const box = page.locator('.el-message-box').filter({ hasText: '恢复挂起的执行' }).first()
    await expect(box).toBeVisible({ timeout: 10000 })
    await box.getByRole('button', { name: '仍要恢复' }).click()

    // 🔴 判据 2（最锋利）：拒绝的话必须**点名是哪个定义**、并说清是「已停用」。
    //    只断言「有个错误提示」是不够的 —— 那连 STATE_INVALID（被别人抢先恢复）也能过，
    //    而这两个成因的处置完全不同（一个是去取消执行，一个是刷新列表看最新状态）。
    const toast = page.locator('.el-message').filter({ hasText: '恢复未完成' }).first()
    await expect(toast).toBeVisible({ timeout: 30000 })
    await expect(toast).toContainText(code)
    await expect(toast).toContainText('已停用')
    await expect(toast).toContainText('不能再恢复')
    // 出路必须在：不给「去执行历史取消它」这句，管理员面前就只剩一行永远挂着的执行
    await expect(toast).toContainText('取消')

    // 🔴 判据 3：列表自动刷新后，这一行**仍是**「等待确认」（= 库里仍是 INTERRUPTED）。
    //    刻意不写终态：写成 FAILED 会让「定义被停用」和「执行自己失败了」长成同一个样子。
    await expect(
      execRow.locator('.el-tag').filter({ hasText: '等待确认' }).first(),
      '被拒后这一行不该变终态；它应仍停在等待确认，好让人去「取消」收尾'
    ).toBeVisible({ timeout: 30000 })
    expect(await statusOf(), '库里的状态也不该被这次拒绝改动').toBe('INTERRUPTED')

    // 🔴 判据 4：流程**真没往下跑**。只断言界面文案的话，「拒绝了但图还是续跑了」照样能过 ——
    //    那才是最坏的形态：副作用发生了，界面却说被拦下了。
    const traceAfter = await traceNodeIds()
    expect(traceAfter, '被拒后不该跑过闸口：' + JSON.stringify(traceAfter)).not.toContain('check')
    expect(traceAfter, '被拒后不该跑同意分支：' + JSON.stringify(traceAfter)).not.toContain('yes')
    expect(traceAfter, '被拒后不该跑拒绝分支：' + JSON.stringify(traceAfter)).not.toContain('no')
    expect(traceAfter, 'trace 不该因为这次被拒的恢复而变长').toEqual(traceBefore)
  })
})
