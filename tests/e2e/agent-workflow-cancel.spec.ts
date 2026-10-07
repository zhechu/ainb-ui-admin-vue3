import { test, expect, type APIRequestContext } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 执行历史抽屉的「主动取消」端到端验证（迭代七 B3-2 / B3-9，方案 §5③）
 *
 * 🔴 为什么非要走浏览器（方案 §5③ 的最后一行）
 *   判据写的是「前端抽屉**真点一次**「取消」」，并且明确否掉了「按钮渲染出来了」这种算通过的方式。
 *   后端那一半（cancel 落 CANCELLED、不补偿、不告警、CAS 输给晚到的收尾）已由
 *   AgentWorkflowExecutionServiceImplCancelTest（9 条）+ EventFluxRuntimeTest 的 F-3（真订阅真 dispose）
 *   钉住，并在真库上实测过（执行 151 = INTERRUPTED 取消、执行 152 = **RUNNING 中途**取消，
 *   后者 0.7s 后还被晚到的 settle 撞了一次、被 updateByIdUnlessCancelled 挡下）。
 *   剩下只有真实浏览器才暴露的三件事：
 *     ① 按钮压根没渲染出来（cancellable 没进 VO / v-hasPermi 把权限串写错 / 权限没授给角色）；
 *     ② 确认框没把「取消不是撤销」说清楚，运维拿它当回滚用；
 *     ③ 点完之后列表不刷新，那一行还挂着「等待确认」—— 正是本模块头号缺陷
 *        「操作成功了但不生效且无提示」的形状。
 *
 * 🔴 0 LLM token、0 写操作：seed 的流程两个节点全只读（tool data_interface_list + hitl.confirm）。
 *   与 agent-workflow-resume.spec.ts 同款取舍，只有这样才能在真库上把「取消」点到底。
 *
 * 🔴 seed 刻意用 recovery='compensate'（resume spec 用的是 'forward'）
 *   否则判据 7 里「没有补偿痕迹」是**空的**：forward 本来就不补偿，取消走错了路也看不出来。
 *   用 compensate 之后，AgentWorkflowCompensator#compensate 一旦被调到就会**无条件**把执行
 *   先写成 COMPENSATING、再写 COMPENSATED（即使一个可补偿节点都没有，见其 targets.isEmpty() 分支），
 *   于是「status 恰好是 CANCELLED」这一条同时钉住「没走 FAILED」和「没触发补偿」。
 *
 * 🔴 最锋利的两条是判据 5 与判据 6：
 *   判据 5 —— 取消之后 恢复/拒绝/取消 **三个按钮必须一起消失**。这是裁定 A-Ⅰ（CANCELLED 不可 resume）
 *             在 UI 侧唯一的钉子：只断言「状态变成已取消」是不够的，按钮还在的话，
 *             运维点「恢复」会收到一句「当前状态（CANCELLED）不允许该操作」。
 *   判据 6 —— tag 必须是灰（info）而**不是**红（danger）。本轮把「用户按了停」从 FAILED 里拆出来，
 *             界面上若仍是一片红，那两件事在运维眼里就还是同一件：数据分开了、视觉没分开。
 *
 * 前置：后端 48080（且已 install 本轮的 yudao-module-agent）+ 前端 dev :80 在跑；
 *       agent:workflow:cancel 权限已入库（sql/mysql/xpy-2026-10-07-agent-workflow-cancel-perm.sql）且后端已重启。
 * 自 seed 自净：afterAll 停用造的 chatflow（PUBLISHED 不可删；执行行留作惰性历史，不影响功能）。
 *       🔴 残留判据是「**集合不变**」而不是「probe 行 = 0」（红线第 24 条）——
 *       该判据已由 _logs/r04/21-behavior-probe.log 第 11 节实测（system_menu 7→7、无活的 probe 流程）。
 */

const API = 'http://127.0.0.1:48080/admin-api'

/**
 * 形状刻意复刻 resume spec 的闸口：START → list(tool) → gate(hitl.confirm) → END。
 * 差别只在 settings.recovery = 'compensate'（理由见文件头）。
 */
const dsl = (code: string) =>
  JSON.stringify(
    {
      dslVersion: '1.0',
      id: code,
      name: code,
      description:
        'iter7-r04 e2e：只读闸口，0 LLM token / 0 写操作；recovery=compensate 是为了让「无补偿」这条断言非空',
      trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: '' } },
      variables: [
        { key: 'input', type: 'string', merge: 'replace', required: false },
        { key: 'list_out', type: 'object', merge: 'replace' },
        { key: 'confirm_result', type: 'boolean', merge: 'replace' }
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
        }
      ],
      edges: [
        { from: 'START', to: 'list' },
        { from: 'list', to: 'gate' },
        { from: 'gate', to: 'END' }
      ],
      settings: { recovery: 'compensate', executionTimeoutSeconds: 60 }
    },
    null,
    2
  )

test.describe('执行历史抽屉的主动取消（迭代七 B3-2 / B3-9）', () => {
  test.setTimeout(240_000)

  let code = ''
  let wfId = 0
  let req: APIRequestContext
  let token = ''
  /** 已认领的执行 id，避免同一条被两轮各点一次 */
  let seenExecId = 0
  let execSuspended: any = null

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

  /** 真跑一次 run-stream，把它停在闸口上，返回那条挂起执行的整行（SSE 随挂起而结束） */
  const runUntilSuspended = async (): Promise<any> => {
    await (
      await api('/agent/workflow/run-stream', 'POST', { code, input: { input: 'e2e-cancel' } })
    ).text()
    for (let i = 0; i < 40; i++) {
      const page = await (
        await api('/agent/workflow/execution/page?pageNo=1&pageSize=20&workflowDefId=' + wfId)
      ).json()
      const hit = (page?.data?.list ?? []).find(
        (r: any) => r.id > seenExecId && r.status === 'INTERRUPTED'
      )
      if (hit) {
        seenExecId = hit.id
        // 🔴 INTERRUPTED 行必须已经被服务端判成可取消。这一条挡的是「按钮出不来」三个成因里的
        //    第一个（cancellable 没进 RespVO）—— 它比判据 1 更早失败，能把锅精确指到后端 VO 上，
        //    而不是让人去怀疑 v-hasPermi 或角色授权。
        expect(
          hit.cancellable,
          'INTERRUPTED 行的 cancellable 应为 true：' + JSON.stringify(hit)
        ).toBe(true)
        // 🔴 判据 3 的非空守卫：本 spec seed 的形状是 START → list(tool) → gate(hitl.confirm)，
        //    故 suspend_node 必须是 gate、current_node 必须是 list，两者**必然不同**。
        //    没有这一条，「确认框点名闸口」那半在字段缺失时会退化成断言一个 undefined，
        //    而 `toContain('正挂在闸口「undefined」上')` 只要文案里也印出 undefined 就能过 —— 恒绿的空断言。
        expect(hit.suspendNode, '挂起闸口应是 gate：' + JSON.stringify(hit)).toBe('gate')
        expect(hit.currentNode, '最后跑完的节点应是 list：' + JSON.stringify(hit)).toBe('list')
        return hit
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error('run-stream 之后没等到 INTERRUPTED 的执行行')
  }

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext()
    const lr = await (
      await api('/system/auth/login', 'POST', { username: 'admin', password: 'admin123' })
    ).json()
    token = lr?.data?.accessToken
    if (!token) throw new Error('seed login failed: ' + JSON.stringify(lr))

    code = 'wf_cancel_e2e_' + Date.now().toString(36)
    const mkBody = await (
      await api('/agent/workflow-def/create', 'POST', {
        code,
        name: code,
        dsl: dsl(code),
        description: 'iter7-r04 cancel e2e'
      })
    ).json()
    if (mkBody.code !== 0) throw new Error('create workflow failed: ' + JSON.stringify(mkBody))
    wfId = mkBody.data
    const pub = await (await api('/agent/workflow-def/publish?id=' + wfId, 'POST')).json()
    if (pub.code !== 0) throw new Error('publish workflow failed: ' + JSON.stringify(pub))

    // 🔴 非空断言的前提闸（实测教训，见 _logs/r04/23-e2e-cancel.log 的第一次失败）：
    //    判据 7 里「取消没触发补偿」只有在 recovery=compensate 时才有意义 —— forward 本来就不补偿，
    //    取消走错了路也照样看不到补偿痕迹，那条判据会恒绿。
    //    ⚠️ 这里**只能查已发布的 def**，不能查执行行：AgentWorkflowExecutionRespVO 没有 recovery 字段
    //    （实测：execution/page 返回的行里 recovery === undefined）。给 VO 补这个字段属于另一刀，
    //    本轮不夹带。执行行确实继承了 def 的 recovery —— 已由只读 SQL 实测
    //    （_logs/r04/21-behavior-probe.log 第 4/7 节：执行 151、152 的 recovery 列均为 COMPENSATE）。
    const defBack = await (await api('/agent/workflow-def/get?id=' + wfId)).json()
    const seededDsl = JSON.parse(defBack?.data?.dsl ?? '{}')
    expect(
      seededDsl?.settings?.recovery,
      'seed 出来的流程 recovery 不是 compensate，判据 7 的「无补偿痕迹」将毫无意义（恒绿）：' +
        JSON.stringify(seededDsl?.settings)
    ).toBe('compensate')

    execSuspended = await runUntilSuspended()
  })

  test.afterAll(async () => {
    if (wfId) await api('/agent/workflow-def/disable?id=' + wfId, 'POST').catch(() => {})
    await req?.dispose()
  })

  test('INTERRUPTED 行出「取消」并真点到底：落已取消、按钮全收、tag 转灰、不补偿', async ({
    page
  }) => {
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
     */
    const rowOf = (id: number) =>
      execRows.filter({
        has: page.locator('td').filter({ hasText: new RegExp(`^\\s*${id}\\s*$`) })
      })

    const suspended = rowOf(execSuspended.id)
    await expect(suspended).toHaveCount(1)

    // 🔴 判据 1：四个动作都渲染出来（画布回放 + 恢复 + 拒绝 + 取消）。
    //    「取消」出不来有三个各自独立的成因，这条判据一次性挡住：
    //    cancellable 没进 RespVO（BeanUtils 跳过只读 getter 是预期的，靠 Jackson 出）／
    //    v-hasPermi 的权限串写错／ agent:workflow:cancel 没授给当前角色。
    await expect(suspended.getByRole('button', { name: '画布回放' })).toBeVisible()
    await expect(suspended.getByRole('button', { name: '恢复' })).toBeVisible()
    await expect(suspended.getByRole('button', { name: '拒绝' })).toBeVisible()
    await expect(
      suspended.getByRole('button', { name: '取消' }),
      '「取消」没渲染出来：cancellable 没进 VO、v-hasPermi 权限串不对、或权限没授给该角色'
    ).toBeVisible()

    // 🔴 判据 2：加了第四个按钮之后 250px 的操作列没把它们挤到被裁掉。
    //    toBeVisible 检不出裁剪（元素照样布局在 overflow:hidden 的格子里），只能量滚动宽。
    //    这条是本轮**新引入**的风险：resume spec 那时是 3 个按钮 / 180px。
    const overflow = await suspended
      .locator('td')
      .last()
      .evaluate((el) => {
        const cell = el.querySelector('.cell') ?? el
        return cell.scrollWidth - cell.clientWidth
      })
    expect(overflow, '操作列被裁剪，四个按钮摆不下（width 需再加）').toBeLessThanOrEqual(1)

    // 🔴 判据 3：确认框必须把「取消不是撤销」讲清楚。三句 ⚠️ 各挡一个会被误判的后果，
    //    少任何一句，运维就会拿取消当「回滚」或当「立刻停止烧 token」用。
    await suspended.getByRole('button', { name: '取消' }).click()
    const box = page.locator('.el-message-box').filter({ hasText: '取消这条执行' }).first()
    await expect(box).toBeVisible({ timeout: 10000 })
    const boxText = (await box.textContent()) ?? ''
    expect(boxText, '确认框必须说清「停不下正在跑的节点」，否则会被当成立刻止烧').toContain(
      '停不下正在执行的那个节点'
    )
    expect(boxText, '确认框必须说清「不触发补偿反做」，否则会被当成回滚').toContain(
      '不会触发补偿反做'
    )
    expect(boxText, '确认框必须说清「不可恢复」（裁定 A-Ⅰ）').toContain('不可恢复')
    // 🔴 INTERRUPTED 行专属：**必须点名闸口**，而不只是说一句「挂在某个闸口上」。
    //    本轮初版这里写的是「它最后跑完的节点是「list」」+ 一句不点名的「正挂在闸口上等人工确认」，
    //    对挂起行是**错的**：current_node 只在节点跑完时写，真正的挂起点（gate）在它后面 ——
    //    运维于是被支去查一个早就跑完的节点。那正是迭代六 B3-10 刚从「恢复」确认框里拆掉的缺陷，
    //    新加的「取消」动作差点把它原样引入一遍。
    //    🔴 与 resume spec 同款「对冲」断言：本 spec seed 的形状下 suspendNode(gate) 与 currentNode(list)
    //    **必然不同**，所以这条不可能靠 current_node 蒙对。
    expect(
      boxText,
      '挂起中的执行必须点名闸口（suspend_node），不能只报最后跑完的节点：' + boxText
    ).toContain(`正挂在闸口「${execSuspended.suspendNode}」上`)
    // 那半「最后跑完的节点」仍须在：它是 trace/回放的入口，两半各记各的
    expect(boxText, '闸口与「最后跑完的节点」两半必须都在').toContain(
      `最后跑完的节点是「${execSuspended.currentNode || '未知'}」`
    )
    // 它本来点「恢复」就能接着跑，取消是放弃这次等待
    expect(boxText, '挂起中的执行必须额外说明「取消等于放弃这次等待」').toContain(
      '取消等于放弃这次等待'
    )
    // 🔴 反面：suspend_node 有值时绝不能落到「说不清挂在哪个闸口」那一档措辞。
    //    两档混用会让运维在明明有真值时读到一句「未知」，那比一直没有这一格更难查。
    expect(boxText, '有 suspend_node 时不该走「说不清」那一档').not.toContain('说不清')
    // 🔴 反面：这个框走的是纯文本插值（没开 dangerouslyUseHTMLString），markdown 星号会**原样印出来**。
    //    实测过一版写着「且**不会**触发补偿反做」，界面上就是四个字面星号 —— 判据 3 的
    //    toContain('不会触发补偿反做') 照样过，只有这条能抓住它。
    expect(boxText, '确认框里不该出现字面 markdown 星号（本框不开 HTML 渲染）').not.toContain('**')

    await box.getByRole('button', { name: '仍要取消' }).click()

    // 🔴 判据 4：取消成功的提示 + 列表自动刷新（不刷新的话这行还挂着「等待确认」，
    //    运维看不出刚才那一下生效没有 —— 本模块头号缺陷的形状）
    await expect(page.locator('.el-message').filter({ hasText: '已取消' }).first()).toBeVisible({
      timeout: 30000
    })
    const tag = suspended.locator('.el-tag').filter({ hasText: '已取消' }).first()
    await expect(tag, '取消后列表没刷新，这一行还显示等待确认').toBeVisible({ timeout: 30000 })

    // 🔴 判据 5（最锋利）：取消之后 恢复/拒绝/取消 **三个按钮必须一起消失**，只留画布回放。
    //    这是裁定 A-Ⅰ（CANCELLED 不可 resume）在 UI 侧唯一的钉子。按钮还在的话，
    //    运维点「恢复」会收到「当前状态（CANCELLED）不允许该操作」—— 又一次「摆出来只是让人点了看报错」。
    expect(
      await suspended.getByRole('button', { name: '取消' }).count(),
      '已取消的行不该再摆「取消」按钮（cancellable 应已翻成 false）'
    ).toBe(0)
    expect(
      await suspended.getByRole('button', { name: '恢复' }).count(),
      '已取消的行不该再摆「恢复」按钮（A-Ⅰ：CANCELLED 不可 resume）'
    ).toBe(0)
    expect(await suspended.getByRole('button', { name: '拒绝' }).count()).toBe(0)
    await expect(suspended.getByRole('button', { name: '画布回放' })).toBeVisible()

    // 🔴 判据 6：tag 必须是灰（info），**不是**红（danger）。
    //    本轮把「用户按了停」从 FAILED 里拆出来；界面上若仍是一片红，
    //    那两件事在运维眼里就还是同一件 —— 数据分开了、视觉没分开，等于本轮白做一半。
    const cls = (await tag.getAttribute('class')) ?? ''
    expect(cls, 'CANCELLED 的 tag 应当是 info（灰）：' + cls).toContain('el-tag--info')
    expect(
      cls,
      'CANCELLED 的 tag 绝不能是 danger（红），那会把它和 FAILED 重新混成一件事：' + cls
    ).not.toContain('el-tag--danger')

    // 🔴 判据 6b：状态格必须是中文「已取消」，不能把机器串 CANCELLED 直接印出来。
    //    成因是 EXEC_LABELS 漏了 CANCELLED 那一格 —— 静默失败，页面上看着像「有值」，其实没翻译。
    expect(
      await suspended
        .locator('td')
        .filter({ hasText: /CANCELLED/ })
        .count(),
      '状态列印出了机器串 CANCELLED，说明 EXEC_LABELS 漏了这一格'
    ).toBe(0)

    // 🔴 判据 7：回读接口，库里那一行确实是 CANCELLED、原因逐字是「用户中断」、
    //    且服务端派生的 cancellable 已翻成 false（判据 5 的按钮消失正是靠它）。
    const after = await (await api('/agent/workflow/execution/get?id=' + execSuspended.id)).json()
    expect(
      after?.data?.status,
      '取消后 status 必须是 CANCELLED：' + JSON.stringify(after?.data)
    ).toBe('CANCELLED')
    expect(after?.data?.errorMsg, '取消原因必须逐字落「用户中断」').toBe('用户中断')
    expect(after?.data?.cancellable, 'CANCELLED 行的 cancellable 必须是 false').toBe(false)
    // 🔴 无补偿痕迹：补偿一旦被调到，status 必然是 COMPENSATING/COMPENSATED/COMPENSATION_FAILED 之一
    //    （AgentWorkflowCompensator#compensate 无条件先写 COMPENSATING），绝不会停在 CANCELLED。
    //    seed 用了 recovery=compensate，所以这条不是空断言。
    expect(
      ['COMPENSATING', 'COMPENSATED', 'COMPENSATION_FAILED'],
      '取消不该触发 Saga 补偿（B3-1 的「行为错」）'
    ).not.toContain(after?.data?.status)
  })
})
