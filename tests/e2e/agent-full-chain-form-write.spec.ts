import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 全链路 e2e（P7 收口·设计方案第六节）：真实浏览器单条贯穿「拆解 → 编排 → 执行 → 落表单」
 *
 * 与分段用例的分工：agent-plan-stream 守「拆解出草稿卡片 + 确认能跑起来」，
 * agent-workflow-chat-route 守「接口 seed 的工作流被聊天驱动」，form-design-demos 守「表单运行时渲染」——
 * 但没有任何一条证明<b>业务闭环</b>：用户在助手里说一句需求，最终有一行业务数据真的落进了表单。
 * 这正是设计方案 P7「全链路 e2e」点名的判据，也是本平台头号缺陷
 * 「配置保存成功但不生效且无提示」的最终防线：链路任何一段静默断掉，本用例都会红。
 *
 * 链路：
 *   拆解  BUILD 意图 → plan-as-workflow 产出 DSL 草稿（真 LLM，多轮，给足 8 分钟）
 *   编排  草稿卡片「确认并运行」→ publish-workflow（DRAFT→PUBLISHED）
 *   执行  run-stream 跑 tool 节点 form_data_create（0 LLM token 的执行段）
 *   落表单 runtime page 接口按唯一标记 title 查到那行数据
 *
 * 数据自净：表单数据行删除、发布的工作流停用（PUBLISHED 不可删）。
 */

const FORM_CODE = 'test_demo_widget_gallery'
const MARKER = `e2e_chain_${Date.now()}`
// 把工具与字段写死在需求里：拆解环节仍是真 planner 产出 DSL，但强约束让 args 可预期，
// 避免模型自由发挥挑一个不存在的字段导致 create 失败（那是链路外的噪音）
const QUESTION =
  `做一个工作流：调用 form_data_create 工具往表单 ${FORM_CODE} 新增一条数据，` +
  `data 里只需要 title 一个字段，值固定填「${MARKER}」，不要用模板变量，直接写死`

const SAMPLE_INTERVAL_MS = 8_000
const TERMINAL_TIMEOUT_MS = 480_000

/** runtime 分页按 title 精确找回本次落库的行（marker 含时间戳，全局唯一） */
async function findRowByTitle(
  request: APIRequestContext,
  token: string,
  title: string
): Promise<{ id: string } | null> {
  const resp = await request.post(`${API_BASE_URL}/infra/form-design/runtime/${FORM_CODE}/page`, {
    headers: apiHeaders(token),
    data: { pageNo: 1, pageSize: 100 }
  })
  const body = (await resp.json()) as { code: number; data: { list: any[] } }
  expect(body.code, 'runtime 分页查询失败').toBe(0)
  const hit = (body.data?.list ?? []).find((r) => r?.title === title)
  return hit ? { id: String(hit.id) } : null
}

test.describe('全链路：拆解 → 编排 → 执行 → 落表单', () => {
  test.setTimeout(720_000)

  test('助手里一句需求，最终有一行数据真的落进表单', async ({ page, request }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    const token = await apiLogin(request)
    let createdRowId: string | undefined
    let workflowDefId: number | undefined

    try {
      // ============ 拆解：BUILD 意图 → DSL 草稿卡片 ============
      await login(page)
      await gotoWithAuth(page, '/agent/assistant')
      await page.locator('textarea').fill(QUESTION)
      await page.getByRole('button', { name: /发送/ }).click()

      const planning = page.locator('[data-testid="assistant-planning-text"]')
      const draftCard = page.locator('[data-testid="workflow-draft-card"]')
      await expect(planning).toBeVisible({ timeout: 90_000 })

      const deadline = Date.now() + TERMINAL_TIMEOUT_MS
      let sawCard = false
      while (Date.now() < deadline) {
        if (await draftCard.isVisible().catch(() => false)) {
          sawCard = true
          break
        }
        await page.waitForTimeout(SAMPLE_INTERVAL_MS)
      }
      expect(sawCard, '等待 8 分钟未产出草稿卡片（可能被分类成 CHAT 或拆解失败）').toBe(true)
      const bodyText = await page.locator('[data-testid="assistant-scroll"]').textContent()
      expect(bodyText).not.toContain('复杂需求拆解为 Workflow DSL 失败')
      await expect(draftCard.getByText('待确认')).toBeVisible()
      expect(
        await draftCard.locator('[data-testid="workflow-node"]').count(),
        '草稿卡片里没有节点预览'
      ).toBeGreaterThanOrEqual(1)

      // ============ 编排 + 执行：确认并运行 → publish → run-stream ============
      // 从 run-stream 请求体里拿 workflow code（卡片 UI 不展示 code，请求体是唯一确定来源）
      const runReqPromise = page.waitForRequest(
        (r) => r.url().includes('/agent/workflow/run-stream') && r.method() === 'POST',
        { timeout: 60_000 }
      )
      await draftCard.getByRole('button', { name: /确认并运行/ }).click()
      const runReq = await runReqPromise
      const runBody = JSON.parse(runReq.postData() ?? '{}') as { code?: string }
      const workflowCode = runBody.code
      expect(workflowCode, 'run-stream 请求体里没有 workflow code').toBeTruthy()

      const runTerminal = draftCard.locator('.el-alert')
      await expect(
        runTerminal.filter({ hasText: /运行完成|运行失败|已挂起/ }).first()
      ).toBeVisible({ timeout: 120_000 })
      await expect(
        runTerminal.filter({ hasText: '运行完成' }).first(),
        '工作流没有跑到「运行完成」——执行段断了（看卡片里的错误信息）'
      ).toBeVisible()

      // 编排落库旁证：def 已发布（PUBLISHED）
      const pageResp = await request.get(`${API_BASE_URL}/agent/workflow-def/page`, {
        headers: apiHeaders(token),
        params: { pageNo: 1, pageSize: 100 }
      })
      const pageBody = (await pageResp.json()) as { code: number; data: { list: any[] } }
      expect(pageBody.code).toBe(0)
      const def = (pageBody.data?.list ?? []).find((d) => d.code === workflowCode)
      expect(def, `工作流 ${workflowCode} 没落库`).toBeTruthy()
      workflowDefId = def.id
      expect(String(def.status), '确认后工作流应为已发布态').toMatch(/PUBLISHED|2/)

      // ============ 落表单：那行数据必须真的查得到 ============
      let row = await findRowByTitle(request, token, MARKER)
      for (let i = 0; i < 5 && !row; i++) {
        await page.waitForTimeout(2_000)
        row = await findRowByTitle(request, token, MARKER)
      }
      expect(row, `表单 ${FORM_CODE} 里没有 title=${MARKER} 的行——链路最后一段「落表单」断了`).toBeTruthy()
      createdRowId = row!.id
    } finally {
      // 数据自净：删表单行 + 停用工作流（PUBLISHED 不可删，与 chat-route spec 同纪律）
      if (createdRowId) {
        await request
          .delete(
            `${API_BASE_URL}/infra/form-design/runtime/${FORM_CODE}/delete?id=${createdRowId}`,
            { headers: apiHeaders(token) }
          )
          .catch(() => undefined)
      }
      if (workflowDefId) {
        await request
          .post(`${API_BASE_URL}/agent/workflow-def/disable?id=${workflowDefId}`, {
            headers: apiHeaders(token)
          })
          .catch(() => undefined)
      }
      expect(pageErrors, `页面出现未捕获异常：${pageErrors.join(' / ')}`).toHaveLength(0)
    }
  })
})
