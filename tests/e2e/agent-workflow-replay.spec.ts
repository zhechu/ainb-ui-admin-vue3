import { test, expect, type APIRequestContext } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 节点级执行回放画布 端到端验证（增量15 / P4 可视化编辑器后续刀：节点级回放）
 *
 * 🔴 为什么非要走浏览器
 * 合并逻辑（trace 按 nodeId 聚合、多次尝试排序取末态、未执行/合成端点兜底）已被 replayModel.spec.ts
 * 纯函数单测钉死；但「回放入口选不中执行行」「VueFlow 容器 0 高塌陷不渲染（R1）」「节点染色/详情面板
 * 在真实 DOM 里出不来」这类缺陷只有真实浏览器才暴露——正是本模块头号缺陷「配了但不生效且无提示」的翻版。
 *
 * 🔴 0 LLM token：seed 的流程只含一个只读 tool 节点（data_interface_list），全链路不调模型。
 *   beforeAll 真跑一次 run-stream 造出「执行实例 + 节点级 trace」，回放渲染的就是这份真实 trace。
 *
 * 🔴 第二条用例顺带钉住「节点 trace 落库三列」（迭代六 D2：node_name / tool_id / parent_node_id）。
 *   放这里是因为本文件的 seed 恰好是唯一现成的「真跑出来的 tool 节点 trace 行」，且 node.name（'list'）
 *   刻意与 node.id（'step_1'）不同 —— 相同的话「名字没落库、前端把 id 显示两遍」也是绿的。
 *
 * 前置：后端 48080 + 前端 dev :80 在跑；库里有 test_demo_* 数据接口（tool 节点数据源，无则返回空列表仍 SUCCESS）。
 * 自 seed 自净：afterAll 停用造的 chatflow（PUBLISHED 不可删；执行行留作惰性历史，不影响功能）。
 */

const API = 'http://127.0.0.1:48080/admin-api'

const dsl = (code: string) =>
  JSON.stringify(
    {
      dslVersion: '1.0',
      id: code,
      name: code,
      description: '增量15 e2e：单只读 tool 节点，全链路 0 LLM token',
      trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: '' } },
      variables: [
        { key: 'input', type: 'string', merge: 'replace', required: false },
        { key: 'output', type: 'object', merge: 'replace' }
      ],
      nodes: [
        {
          id: 'step_1',
          type: 'tool',
          name: 'list',
          config: { toolId: 'data_interface_list', args: {}, outputVar: 'output' }
        }
      ],
      edges: [
        { from: 'START', to: 'step_1' },
        { from: 'step_1', to: 'END' }
      ],
      settings: { recovery: 'forward', executionTimeoutSeconds: 60 }
    },
    null,
    2
  )

test.describe('节点级执行回放画布（增量15）', () => {
  test.setTimeout(180_000)

  let code = ''
  let wfId = 0
  let req: APIRequestContext
  let token = ''

  const api = async (path: string, method = 'GET', body?: any) => {
    const r = await req.fetch(API + path, {
      method,
      data: body,
      timeout: 60_000,
      headers: {
        'tenant-id': '1',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    })
    return r
  }

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext()
    const lr = await (
      await api('/system/auth/login', 'POST', { username: 'admin', password: 'admin123' })
    ).json()
    token = lr?.data?.accessToken
    if (!token) throw new Error('seed login failed: ' + JSON.stringify(lr))

    // 1) 造一条已发布流程（单只读 tool 节点）
    code = 'wf_replay_e2e_' + Date.now().toString(36)
    const mk = (await api('/agent/workflow-def/create', 'POST', {
      code,
      name: code,
      dsl: dsl(code),
      description: '增量15 e2e'
    })) as any
    const mkBody = await mk.json()
    if (mkBody.code !== 0) throw new Error('create workflow failed: ' + JSON.stringify(mkBody))
    wfId = mkBody.data
    const pub = await (await api('/agent/workflow-def/publish?id=' + wfId, 'POST')).json()
    if (pub.code !== 0) throw new Error('publish workflow failed: ' + JSON.stringify(pub))

    // 2) 真跑一次 run-stream（0 LLM token）→ 落「执行实例 + 节点级 trace」。SSE 随流程 DONE 而关闭，读尽即持久化完成。
    const runResp = await api('/agent/workflow/run-stream', 'POST', {
      code,
      input: { input: 'e2e replay' }
    })
    await runResp.text()

    // 3) 守卫：确认执行已落库（回放入口的数据源），否则后续 UI 断言无从谈起
    const page = await (
      await api('/agent/workflow/execution/page?pageNo=1&pageSize=10&workflowDefId=' + wfId)
    ).json()
    expect(page?.data?.total, '执行未落库：' + JSON.stringify(page)).toBeGreaterThan(0)
  })

  test.afterAll(async () => {
    // 已发布版本不可删，只能停用（停止接受新执行）。彻底清除需 SQL 软删 code。
    if (wfId) await api('/agent/workflow-def/disable?id=' + wfId, 'POST').catch(() => {})
    await req?.dispose()
  })

  test('执行历史 → 画布回放：节点按执行态染色 + 点节点看尝试详情', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    // 按 code 搜索（回车触发 handleQuery）
    const search = page.locator('input[placeholder="请输入流程编码"]')
    await search.fill(code)
    await search.press('Enter')

    const row = page.locator('.el-table__body tr').filter({ hasText: code }).first()
    await expect(row).toBeVisible({ timeout: 15000 })

    // 打开执行历史抽屉
    await row.getByRole('button', { name: '执行历史' }).click()
    const drawer = page.locator('.el-drawer').filter({ hasText: '执行历史' }).first()
    await expect(drawer).toBeVisible({ timeout: 15000 })

    // 抽屉内至少一条执行行（beforeAll 真跑过一次）
    const execRows = drawer.locator('.el-table__body tr')
    await expect(execRows.first()).toBeVisible({ timeout: 15000 })

    // 点「画布回放」→ 打开回放对话框
    await drawer.getByRole('button', { name: '画布回放' }).first().click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '执行回放' }).first()
    await expect(dialog).toBeVisible({ timeout: 15000 })

    // 🔴 核心判据 1：VueFlow 真渲染出节点 DOM（不是 0 高塌陷，R1 回归守卫）。START→tool→END = 3 节点。
    const flowNodes = dialog.locator('.vue-flow__node')
    await expect(flowNodes.first()).toBeVisible({ timeout: 15000 })
    expect(await flowNodes.count()).toBeGreaterThanOrEqual(3)

    // 🔴 核心判据 2：画布容器有非零高度（R1）
    const wrap = dialog.locator('.canvas-wrap').first()
    const box = await wrap.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThan(100)

    // 🔴 核心判据 3：tool 节点执行成功 → 染成「成功」态徽标（合成端点 START/END 为「未执行」）
    await expect(dialog.locator('.vue-flow__node').filter({ hasText: '成功' }).first()).toBeVisible({
      timeout: 15000
    })

    // 🔴 核心判据 4：点该成功节点 → 右侧详情面板出「节点 id / 尝试详情（token/耗时）」
    await dialog.locator('.vue-flow__node').filter({ hasText: '成功' }).first().click()
    await expect(dialog.getByText('节点 id：step_1').first()).toBeVisible({ timeout: 10000 })
    await expect(dialog.getByText(/次尝试/).first()).toBeVisible({ timeout: 10000 })

    // 关闭回放对话框（exact 只匹配页脚「关闭」，避开右上角 X）
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })
  })

  test('节点 trace 落库三列：node_name / tool_id / parent_node_id（迭代六 D2）', async ({ page }) => {
    // ===== 第一层：接口层（DO → RespVO）=====
    // 🔴 为什么非走接口不可：BeanUtils.toBean 是**按字段名**映射的，名字打错它**静默跳过**——
    //    编译过、后端单测全绿、这一列永远空。这就是本模块头号缺陷「配了但不生效且无提示」的形状，
    //    而 NodeTraceRecorderTest 那 7 条单测只能证明 DO 上有值，证明不了它能出到线上。
    const exec = await (
      await api('/agent/workflow/execution/page?pageNo=1&pageSize=10&workflowDefId=' + wfId)
    ).json()
    const executionId = exec?.data?.list?.[0]?.id
    expect(executionId, '取不到执行实例：' + JSON.stringify(exec)).toBeTruthy()

    const traceBody = await (
      await api('/agent/workflow/node-trace/list?executionId=' + executionId)
    ).json()
    const traces: any[] = traceBody?.data ?? []
    expect(traces.length, '一条 trace 都没落库：' + JSON.stringify(traceBody)).toBeGreaterThan(0)

    // 合成端点不落 trace 行（回放画布上的 START/END 是前端补的），否则回放会把它们当执行过的节点染色
    expect(
      traces.filter((t) => t.nodeId === 'START' || t.nodeId === 'END'),
      '合成端点不该有 trace 行'
    ).toHaveLength(0)

    // 取末次尝试：seed 流程只跑一次就该只有一行，但失败重试会多一行，这里不该因重试而误红
    const stepRows = traces.filter((t) => t.nodeId === 'step_1')
    expect(stepRows.length, 'seed 的 step_1 没有 trace 行：' + JSON.stringify(traces)).toBeGreaterThan(
      0
    )
    const t = stepRows.at(-1)

    // 🔴 node_name：'list' ≠ 'step_1'，所以这条断言真的能区分「记了名字」和「把 id 又抄了一遍」
    expect(t.nodeName, '节点显示名没落库（node_name）').toBe('list')
    // 🔴 tool_id：这一列以前压根不存在，运维看到一行失败的 tool trace 只知道「某个工具炸了」
    expect(t.toolId, 'tool 节点调的哪个工具没落库（tool_id）').toBe('data_interface_list')
    // 🔴 parent_node_id：顶层节点为 NULL。用 ?? null 而不是 toBeUndefined —— 断言不该绑在
    //    Jackson 是否序列化 null 字段这种与业务无关的策略上
    expect(t.parentNodeId ?? null, '顶层节点不该有 parent_node_id').toBeNull()

    // ===== 第二层：浏览器层（RespVO → VO → 模板）=====
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

    // 展开执行行 → 懒加载节点级 trace 子表（onExpandChange 才发请求）
    const execRow = drawer.locator('.el-table__body tr').first()
    await expect(execRow).toBeVisible({ timeout: 15000 })
    await execRow.locator('.el-table__expand-icon').click()

    const sub = drawer.locator('.el-table__expanded-cell .el-table').first()
    const subRow = sub.locator('.el-table__row').first()
    await expect(subRow).toBeVisible({ timeout: 15000 })

    // 🔴 判据：「工具」列真渲染出 toolId（新增列，此前不存在）
    await expect(sub).toContainText('data_interface_list')

    // 🔴 判据：「节点 id」格子里显示机器 id，显示名挂在 title 上（刻意不单独占一列，子表已 7 列）。
    //    这一条与上面的 toContainText 是两件事：toContainText 只证明串出现在子表某处，
    //    这条才证明它落在「工具」那一列、而名字落在 title 属性上。
    const idCell = subRow.locator('td').first().locator('span')
    await expect(idCell).toHaveText('step_1')
    await expect(idCell).toHaveAttribute('title', 'list')
  })
})
