import { test, expect, type APIRequestContext } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 执行历史抽屉的「挂起执行兜底救援」端到端验证（重构 S4a-h / 方案 §2-D10）
 *
 * 🔴 为什么非要走浏览器
 * 这一刀的全部价值在「运维拿一条卡在 INTERRUPTED 的执行，界面上**点得动**、点完**真的续跑**」。
 * 后端 resume 的语义（CAS 抢占、checkpoint 续跑、HITL 键回退）已由
 * HitlConfirmResumeRuntimeTest / HitlBpmApprovalResumeRuntimeTest 用真编译器钉死；
 * 而「按钮压根没渲染出来」「确认框把人支去查一个早跑完的节点」「续跑成功了但列表不刷新、
 * 运维看不出刚才那一下生效没有」只有真实浏览器才暴露 —— 正是本模块头号缺陷
 * 「配了但不生效且无提示」的翻版。
 *
 * 🔴 0 LLM token、0 写操作：seed 的流程五个节点全只读
 *   （tool data_interface_list × 3 + hitl.confirm + condition.rule），**两条分支都只读**。
 *   这是刻意的：只有这样才敢在真库上把「恢复（同意）」和「拒绝（不同意）」两条路都点到底。
 *   若把同意分支换成 form_save_draft 之类的写工具，本 spec 就只能验证到确认框为止。
 *
 * 🔴 最锋利的断言在接口侧（判据 5 / 7）：续跑完回读节点级 trace，
 *   点「拒绝」的那条必须真跑过 `no`、点「恢复」的那条必须真跑过 `yes`。
 *   只断言「状态变成成功」是不够的 —— 那恰恰是 #46 的形态：反馈键没送到闸口，
 *   流程按「驳回」走完，执行状态照样报 SUCCEEDED，界面上全绿。
 *
 * 前置：后端 48080 + 前端 dev :80 在跑。
 * 自 seed 自净：afterAll 先把本 chatflow 名下**仍挂起**的执行推成终态，再停用造的 chatflow。
 *   🔴 本 spec 造**两条**执行（拒绝那条在 beforeAll 里起、同意那条在用例体中途起），
 *   两条都只有被点到底才会变成 SUCCEEDED；用例在任何一处红掉，那条就停在 INTERRUPTED ——
 *   而它停得住：hitl.confirm 既不写 resume_at 也不写 event_key，两个自动唤醒方都扫不到它，
 *   定义随后又被停用，人工「恢复」也会被定义状态检查拒掉。
 *   完整取舍写在 agent-workflow-cancel.spec.ts 文件头「自 seed 自净」那一节，这里不抄第二遍。
 */

const API = 'http://127.0.0.1:48080/admin-api'

/**
 * 形状刻意复刻编排器真会生成的那种闸口：`approveVar` 是**自定义名**（confirm_result）而非默认的
 * hitl_approved。于是本 spec 顺带钉住了前端那两个键的「对冲」能不能穿过
 * HitlConfirmNodeExecutor#execute 的回退 —— 只发默认键，却要让一个自定义名的闸口判对。
 */
const dsl = (code: string) =>
  JSON.stringify(
    {
      dslVersion: '1.0',
      id: code,
      name: code,
      description: 'S4a-h e2e：只读闸口 + 两条只读分支，全链路 0 LLM token、0 写操作',
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
        {
          id: 'gate',
          type: 'hitl.confirm',
          name: '人工确认',
          config: { approveVar: 'confirm_result' }
        },
        {
          id: 'check',
          type: 'condition.rule',
          name: '分流',
          config: {
            branches: [
              { target: 'approved', conditions: [{ var: 'confirm_result', op: 'is_true' }] }
            ],
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

test.describe('执行历史抽屉的挂起救援按钮（S4a-h）', () => {
  test.setTimeout(240_000)

  let code = ''
  let wfId = 0
  let req: APIRequestContext
  let token = ''
  /** 已认领的执行 id，避免同一条被两轮各点一次 */
  let seenExecId = 0
  let execReject: any = null
  let execApprove: any = null

  const api = async (path: string, method = 'GET', body?: any) => {
    return req.fetch(API + path, {
      method,
      data: body,
      timeout: 60_000,
      headers: {
        'tenant-id': '1',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    })
  }

  /**
   * 真跑一次 run-stream，把它停在闸口上，返回那条挂起执行的整行。
   * SSE 随挂起而结束（末元素是 InterruptionMetadata）；落库与流关闭之间有极短窗口，故轮询等 INTERRUPTED。
   */
  const runUntilSuspended = async (): Promise<any> => {
    await (
      await api('/agent/workflow/run-stream', 'POST', { code, input: { input: 'e2e' } })
    ).text()
    for (let i = 0; i < 40; i++) {
      const page = await (
        await api('/agent/workflow/execution/page?pageNo=1&pageSize=10&workflowDefId=' + wfId)
      ).json()
      const hit = (page?.data?.list ?? []).find(
        (r: any) => r.id > seenExecId && r.status === 'INTERRUPTED'
      )
      if (hit) {
        seenExecId = hit.id
        // 🔴 判据 0（迭代六 D1；也是「挂起节点 id 取错」那个缺陷在端到端侧唯一的钉子）：
        //    本 spec seed 的形状是 START → list(tool) → gate(hitl.confirm)，正是实测表里
        //    InterruptionMetadata.node() 会给错值的那一档 —— 它给的是最后跑完的 list，
        //    而被 interruptsBefore 拦下的其实是 gate。
        //    🔴 两列都断言、且它们必须不相等：只断言 suspendNode==='gate' 是弱的
        //    （后端把 current_node 也写成 gate 的话，两列一起错也能过）；把 currentNode==='list'
        //    一并钉住，才说明这两列真的各记各的。
        //    后端那一半（两处 Service 改用 DslToStateGraphCompiler#resolveSuspendNodeId）
        //    没有任何单测覆盖 —— 退回去不会让 agent 模块任何一条变红，这里是它唯一的验证口。
        expect(
          hit.suspendNode,
          'suspend_node 应是被拦下的闸口 gate，而不是最后跑完的 list：' + JSON.stringify(hit)
        ).toBe('gate')
        expect(
          hit.currentNode,
          'current_node 应是最后跑完的 list（两列若相同，说明落库口径又被合并成一件事了）'
        ).toBe('list')
        return hit
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error('run-stream 之后没等到 INTERRUPTED 的执行行')
  }

  const traceNodeIds = async (executionId: number): Promise<string[]> => {
    const r = await (await api('/agent/workflow/node-trace/list?executionId=' + executionId)).json()
    return ((r?.data ?? []) as any[]).map((t) => t.nodeId)
  }

  /**
   * 本 chatflow 名下所有仍挂起的执行行。
   * 🔴 按 `workflowDefId` 扫而不是记「我造过哪几个 id」：afterAll 要清的正是用例没跑到那一步时
   *    留下的行，那种情况下记账用的 `execReject`/`execApprove` 很可能压根没赋上值。
   *    以 def 为界也保证这条清理只可能碰到本 spec 自己造的行。
   */
  const interruptedExecutions = async (): Promise<any[]> => {
    const page = await (
      await api('/agent/workflow/execution/page?pageNo=1&pageSize=20&workflowDefId=' + wfId)
    ).json()
    return (page?.data?.list ?? []).filter((r: any) => r.status === 'INTERRUPTED')
  }

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext()
    const lr = await (
      await api('/system/auth/login', 'POST', { username: 'admin', password: 'admin123' })
    ).json()
    token = lr?.data?.accessToken
    if (!token) throw new Error('seed login failed: ' + JSON.stringify(lr))

    code = 'wf_hitl_e2e_' + Date.now().toString(36)
    const mkBody = await (
      await api('/agent/workflow-def/create', 'POST', {
        code,
        name: code,
        dsl: dsl(code),
        description: 'S4a-h e2e'
      })
    ).json()
    if (mkBody.code !== 0) throw new Error('create workflow failed: ' + JSON.stringify(mkBody))
    wfId = mkBody.data
    const pub = await (await api('/agent/workflow-def/publish?id=' + wfId, 'POST')).json()
    if (pub.code !== 0) throw new Error('publish workflow failed: ' + JSON.stringify(pub))

    execReject = await runUntilSuspended()
  })

  test.afterAll(async () => {
    try {
      if (wfId) {
        // 🔴 清理必须在 afterAll、不能在用例体末尾：用例一红，末尾那句就被跳过，
        //    留下一行永远恢复不了的 INTERRUPTED（定义随后被停用）。走产品自己的 cancel 端点推成终态，
        //    不直接改库。happy path 下两条执行都已 SUCCEEDED，这里扫不到东西、一次请求都不发 ⟹ 幂等。
        for (const row of await interruptedExecutions()) {
          await api('/agent/workflow/cancel?executionId=' + row.id, 'POST').catch(() => {})
        }
        // 🔴 回读自检：cancel 自己也会失败，而上一行那个 catch 会把原话整个吞掉。
        //    静默失败的清理比不清理更坏 —— 残渣从「看得见」变成「看不见」。
        const left = await interruptedExecutions()
        if (left.length > 0) {
          throw new Error(
            'afterAll 清理后本流程名下仍有挂起执行（残渣非空 = 本轮失败）：' +
              JSON.stringify(left.map((r: any) => ({ id: r.id, status: r.status })))
          )
        }
      }
    } finally {
      if (wfId) await api('/agent/workflow-def/disable?id=' + wfId, 'POST').catch(() => {})
      await req?.dispose()
    }
  })

  test('INTERRUPTED 行出「恢复/拒绝」并真续跑；成功行不出这两个按钮', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    const search = page.locator('input[placeholder="请输入流程编码"]')
    await search.fill(code)
    await search.press('Enter')

    const row = page.locator('.el-table__body tr').filter({ hasText: code }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.getByRole('button', { name: '执行历史' }).click()

    const drawer = page.locator('.el-drawer').filter({ hasText: '执行历史' }).first()
    await expect(drawer).toBeVisible({ timeout: 15000 })

    const execRows = drawer.locator('.el-table__body tr')
    await expect(execRows.first()).toBeVisible({ timeout: 15000 })

    /**
     * 按「执行编号」那一格精确定位行。
     * 🔴 不能用 hasText(id)：耗时、时间戳里都可能出现同样的数字，会串到别的行上。
     *    整格只含这个 id，故用锚定的正则匹配那一格。
     */
    const rowOf = (id: number) =>
      execRows.filter({ has: page.locator('td').filter({ hasText: new RegExp(`^\\s*${id}\\s*$`) }) })

    const suspended = rowOf(execReject.id)
    await expect(suspended).toHaveCount(1)

    // 🔴 判据 1：三个动作都渲染出来（画布回放 + 恢复 + 拒绝）
    await expect(suspended.getByRole('button', { name: '画布回放' })).toBeVisible()
    await expect(suspended.getByRole('button', { name: '恢复' })).toBeVisible()
    await expect(suspended.getByRole('button', { name: '拒绝' })).toBeVisible()

    // 🔴 判据 1b（迭代六 D1）：抽屉上真有「挂起闸口」这一格，且值是 gate 而不是 list。
    //    修订前这一格**压根不存在** —— 挂起节点只暂存在内存的 interruptedNode 里，刷新即丢，
    //    于是运维在列表上只能看到「当前节点 list」，而流程其实停在 list 之后的 gate 上。
    await expect(
      suspended.locator('td').filter({ hasText: new RegExp('^\\s*gate\\s*$') }).first(),
      '「挂起闸口」列没渲染出 gate（列没加、字段没进 VO、或后端没落 suspend_node）'
    ).toBeVisible()

    // 🔴 判据 2：180px 的操作列没把三个 link 按钮挤到被裁掉。
    //    toBeVisible 检不出裁剪（元素照样布局在 overflow:hidden 的格子里），只能量滚动宽。
    const overflow = await suspended
      .locator('td')
      .last()
      .evaluate((el) => {
        const cell = el.querySelector('.cell') ?? el
        return cell.scrollWidth - cell.clientWidth
      })
    expect(overflow, '操作列被裁剪，三个按钮摆不下').toBeLessThanOrEqual(1)

    // 🔴 判据 3：确认框的措辞必须跟着库里真值走，且必须**点名闸口**（迭代六 B3-10）。
    //    suspend_node 落库之后（D1），确认框能说「正挂在闸口「gate」上，恢复后第一个执行的就是它」——
    //    这一句是本判据的全部价值：运维点下去之前知道会续跑哪个节点。
    //    🔴 同时保留「最后跑完的节点是「list」」那半，且**两半必须都在**：
    //    只留闸口会让人以为 current_node 没用了（它仍是 trace/回放的入口），
    //    只留 current_node 就是本判据修订前的形态（把运维支去查一个早跑完的节点）。
    //    current_node 只在**节点跑完**时写（AgentWorkflowExecutionServiceImpl#runGraph 的 else 分支）。
    await suspended.getByRole('button', { name: '拒绝' }).click()
    const box = page.locator('.el-message-box').filter({ hasText: '拒绝挂起的执行' }).first()
    await expect(box).toBeVisible({ timeout: 10000 })
    const saidNode = execReject.currentNode || '未知'
    await expect(
      box.getByText(`最后跑完的节点是「${saidNode}」`, { exact: false }).first()
    ).toBeVisible()
    // 🔴 最锋利的一条：确认框必须报出**闸口**（suspend_node），而不只是最后跑完的节点。
    //    这两个值在本 spec 的形状下必然不同（list vs gate），所以它不可能靠 current_node 蒙对。
    await expect(
      box.getByText(`正挂在闸口「${execReject.suspendNode}」上`, { exact: false }).first(),
      '确认框没点名挂起闸口：suspend_node 没落库、没进 RespVO、或前端没读它'
    ).toBeVisible()
    // 「真执行」提醒必须在：不给这句话，运维会以为「拒绝」只是打个标记
    await expect(box.getByText('真执行', { exact: false }).first()).toBeVisible()
    expect(await box.getByText('当前停在节点', { exact: false }).count()).toBe(0)
    // 🔴 反面：suspend_node 有值时绝不能走「说不清挂在哪个闸口」那一档措辞。
    //    两档混用会让运维在明明有真值时读到一句「未知」，那比一直没有这一格更难查。
    expect(await box.getByText('说不清挂在哪个闸口', { exact: false }).count()).toBe(0)

    await box.getByRole('button', { name: '仍要拒绝' }).click()

    // 🔴 判据 4：续跑成功的提示 + 列表自动刷新（不刷新的话这行还挂着「等待确认」）
    await expect(
      page.locator('.el-message').filter({ hasText: '已续跑完成' }).first()
    ).toBeVisible({ timeout: 60000 })
    await expect(
      suspended.locator('.el-tag').filter({ hasText: '成功' }).first(),
      '拒绝后列表没刷新，这一行还显示等待确认'
    ).toBeVisible({ timeout: 30000 })

    // 🔴 判据 5（最锋利）：反馈真送到了闸口，且走的是**拒绝**分支
    const rejectTrace = await traceNodeIds(execReject.id)
    expect(rejectTrace, '拒绝后应真跑过 no 节点：' + JSON.stringify(rejectTrace)).toContain('no')
    expect(rejectTrace, '拒绝后不该跑同意分支：' + JSON.stringify(rejectTrace)).not.toContain('yes')

    // 🔴 判据 6：非 INTERRUPTED 行**不出**这两个按钮（其余状态调 resume 后端直接抛 STATE_INVALID，
    //    摆出来只是让人点了看报错）；但「画布回放」仍在。
    expect(
      await suspended.getByRole('button', { name: '拒绝' }).count(),
      '已成功的行不该再摆「拒绝」按钮'
    ).toBe(0)
    expect(await suspended.getByRole('button', { name: '恢复' }).count()).toBe(0)
    await expect(suspended.getByRole('button', { name: '画布回放' })).toBeVisible()

    // ========== 第二轮：点「恢复（同意）」，必须走 yes 分支 ==========
    execApprove = await runUntilSuspended()
    // 抽屉没有刷新按钮，getList 只在 open() 和翻页时调 —— 关掉重开才能拉到新执行
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden({ timeout: 15000 })
    await row.getByRole('button', { name: '执行历史' }).click()
    await expect(drawer).toBeVisible({ timeout: 15000 })
    await expect(rowOf(execApprove.id)).toHaveCount(1, { timeout: 15000 })

    // 两行并存：新挂起的有救援按钮、刚成功的那条没有 —— 判据 6 的最强形态
    await expect(
      execRows.filter({ has: page.getByRole('button', { name: '恢复' }) }),
      '应当只有挂起中的那一行出救援按钮'
    ).toHaveCount(1)

    const live = rowOf(execApprove.id)
    await live.getByRole('button', { name: '恢复' }).click()
    const box2 = page.locator('.el-message-box').filter({ hasText: '恢复挂起的执行' }).first()
    await expect(box2).toBeVisible({ timeout: 10000 })
    await expect(box2.getByText('仍要恢复', { exact: false }).first()).toBeVisible()
    await expect(box2.getByText('真执行', { exact: false }).first()).toBeVisible()
    // wait(event) 的跳过风险必须写明：那条路本该由事件唤醒，人工 resume 等于绕过等待
    await expect(box2.getByText('wait', { exact: false }).first()).toBeVisible()
    await box2.getByRole('button', { name: '仍要恢复' }).click()

    await expect(
      page.locator('.el-message').filter({ hasText: '已续跑完成' }).first()
    ).toBeVisible({ timeout: 60000 })
    await expect(
      live.locator('.el-tag').filter({ hasText: '成功' }).first(),
      '恢复后列表没刷新'
    ).toBeVisible({ timeout: 30000 })

    // 🔴 判据 7：「恢复」真的等于「同意」—— #46 那类静默反向的唯一可靠探针
    const approveTrace = await traceNodeIds(execApprove.id)
    expect(approveTrace, '恢复后应真跑过 yes 节点：' + JSON.stringify(approveTrace)).toContain('yes')
    expect(approveTrace, '恢复后不该跑拒绝分支：' + JSON.stringify(approveTrace)).not.toContain('no')
  })
})
