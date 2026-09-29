import { test, expect, type APIRequestContext } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * 版本管理抽屉端到端验证（增量14b + 顺带证 14a 权限点已授予 admin）
 *
 * 🔴 为什么走浏览器：14b 新增 WorkflowVersionDrawer（同 code 多版本列表 + 主版本徽标 + 对比/回滚/设主版本）。
 * 端点已由后端单测覆盖，但「抽屉能开、版本行渲染、主版本徽标出现、perm 门控按钮对 admin 可见」只有真实 DOM
 * 才暴露——尤其按钮上的 v-hasPermi（14a 新增的 agent:workflow:create/publish 权限点）若没授予 admin，按钮会
 * 静默消失（本模块头号缺陷「配了但不生效且无提示」的翻版）。
 *
 * 🔴 自 seed 自净：beforeAll 用 admin API 造一个含 2 个已发布版本的流程并把 v1 设为主版本；afterAll 停用它们。
 *   （已发布版本是不可变快照，API 只能停用不能删；彻底清除需 SQL 软删，见文件末注释。停用后不再接受新执行，
 *   且默认列表可按状态过滤，残留为惰性行，不影响功能。）
 * 前置（0 LLM token）：后端 48080 + 前端 dev :80 在跑。全程 tool 节点，无任何 LLM 调用。
 */

const API = 'http://127.0.0.1:48080/admin-api'

const dsl = (code: string, tag: string) =>
  JSON.stringify(
    {
      dslVersion: '1.0',
      id: code,
      name: code,
      description: tag,
      trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: '' } },
      variables: [
        { key: 'input', type: 'object', merge: 'replace' },
        { key: 'listOut', type: 'object', merge: 'replace' }
      ],
      nodes: [
        {
          id: 'step_1',
          type: 'tool',
          name: 'list',
          config: { toolId: 'data_interface_list', args: {}, outputVar: 'listOut' }
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

test.describe('流程版本管理抽屉（14b）', () => {
  test.setTimeout(180_000)

  let code = ''
  const ids: number[] = []
  let req: APIRequestContext
  let token = ''

  const api = async (path: string, method = 'GET', body?: any) => {
    const r = await req.fetch(API + path, {
      method,
      data: body,
      headers: {
        'tenant-id': '1',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    })
    return r.json()
  }

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext()
    const lr = await api('/system/auth/login', 'POST', { username: 'admin', password: 'admin123' })
    token = lr?.data?.accessToken
    if (!token) throw new Error('seed login failed: ' + JSON.stringify(lr))

    code = 'wf_ver_e2e_' + Date.now().toString(36)
    const mk = (tag: string) => ({ code, name: code, dsl: dsl(code, tag), description: tag })
    const id1 = (await api('/agent/workflow-def/create', 'POST', mk('v1')))?.data
    await api('/agent/workflow-def/publish?id=' + id1, 'POST')
    const id2 = (await api('/agent/workflow-def/create', 'POST', mk('v2')))?.data
    await api('/agent/workflow-def/publish?id=' + id2, 'POST')
    await api('/agent/workflow-def/set-primary?id=' + id1, 'POST')
    ids.push(id1, id2)
  })

  test.afterAll(async () => {
    // 已发布版本不可删，只能停用（停止接受新执行）。彻底清除需：
    //   UPDATE agent_workflow_def SET deleted=b'1' WHERE code='<code>';
    for (const id of ids) await api('/agent/workflow-def/disable?id=' + id, 'POST').catch(() => {})
    await req?.dispose()
  })

  test('抽屉打开 + 多版本列表 + 主版本徽标 + perm 门控按钮可见', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    // 按 code 搜索（回车触发 handleQuery，避开按钮名猜测）
    const search = page.locator('input[placeholder="请输入流程编码"]')
    await search.fill(code)
    await search.press('Enter')

    // 列表出现该 code 的行，点击行内「版本」按钮打开抽屉
    const firstRow = page.locator('.el-table__body tr').filter({ hasText: code }).first()
    await expect(firstRow).toBeVisible({ timeout: 15000 })
    await firstRow.getByRole('button', { name: '版本' }).click()

    const drawer = page.locator('.el-drawer').filter({ hasText: '版本管理' }).first()
    await expect(drawer).toBeVisible({ timeout: 15000 })

    // 抽屉内版本表：同 code 两个版本都在
    await expect(drawer.locator('.el-table__body tr')).toHaveCount(2, { timeout: 15000 })

    // 主版本徽标出现（seed 时把 v1 设为主版本）——证明 primaryFlag 渲染
    await expect(drawer.getByText('主版本').first()).toBeVisible({ timeout: 10000 })

    // 🔴 14a 顺带验证：回滚按钮挂 v-hasPermi=['agent:workflow:create']，对 admin 可见
    //   （若该权限点没授予 admin，按钮会消失 → 此断言失败）
    await expect(drawer.getByRole('button', { name: '回滚到此版' }).first()).toBeVisible({
      timeout: 10000
    })

    // 对比区存在（不实际点开下拉，避免 el-select 多 popper 的 strict-mode 抖动）
    await expect(drawer.getByText('版本对比：').first()).toBeVisible()

    // 关闭抽屉（ESC）
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden({ timeout: 10000 })
  })
})
