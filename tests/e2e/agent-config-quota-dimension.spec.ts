import { test, expect } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * AI 助手配额 —— Agent / 工作流维度（P7 治理 / 待办 #6b）的浏览器端验证
 *
 * 🔴 为什么必须走浏览器：本平台头号缺陷是「配置保存成功但不生效且无提示」。
 * 配额维度的 save→落库→enforcement 链路已由 curl 差分（12/12）与活体拦截（8/8）钉死，
 * 但 UI 这层——「表单渲染 4 个维度、工作流禁用金额、Agent 下拉真的加载出选项、保存后表格真的出现」——
 * 单测与 ts:check 都替代不了在真浏览器里点一遍。
 *
 * 前置：后端 48080 与前端 dev server 同时在跑。0 LLM token（不发聊天）。
 * 跑完用接口清掉造出来的 Agent / 配额，绝不留残留。
 */

const AGENT_CODE = 'e2e_quota_ui_agent'
const AGENT_NAME = 'UI配额测试Agent'

test.describe('AI 助手配额 - Agent/工作流维度', () => {
  test.setTimeout(180_000)

  let token: string
  let agentId: number

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)
    const h = apiHeaders(token)
    // seed 一个已发布 Agent，好让「选择 Agent」下拉里有选项可选
    const r = await request.post(`${API_BASE_URL}/agent/def/create`, {
      headers: h,
      data: { code: AGENT_CODE, name: AGENT_NAME, persona: '测试人设' }
    })
    agentId = (await r.json()).data
    await request.post(`${API_BASE_URL}/agent/def/publish?id=${agentId}`, { headers: h })
  })

  test.afterAll(async ({ request }) => {
    const h = apiHeaders(token)
    // 清掉测试期间可能建下的 AGENT 配额（按 targetKey 找 id 再删）+ 停用 Agent
    const list = await (
      await request.get(`${API_BASE_URL}/agent/config/quota/list`, { headers: h })
    ).json()
    for (const q of list.data ?? []) {
      if (q.targetKey === AGENT_CODE) {
        await request.delete(`${API_BASE_URL}/agent/config/quota/delete?id=${q.id}`, { headers: h })
      }
    }
    if (agentId) {
      await request.post(`${API_BASE_URL}/agent/def/disable?id=${agentId}`, { headers: h })
    }
  })

  test('表单渲染 4 维度；工作流禁用金额；Agent 下拉加载选项；保存后表格出现', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/config')
    await expect(page.getByText('用量配额')).toBeVisible({ timeout: 20_000 })

    // 打开新增表单
    await page.getByRole('button', { name: '新增配额' }).click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新增配额' })
    await expect(dialog).toBeVisible()

    // 1) 四个维度都渲染出来
    for (const label of ['整个租户', '指定用户', '指定 Agent', '指定工作流']) {
      await expect(dialog.locator('.el-radio', { hasText: label })).toBeVisible()
    }

    // 2) 切到「指定工作流」：金额上限被禁用 + 出现提示 + 出现「选择工作流」下拉
    await dialog.locator('.el-radio', { hasText: '指定工作流' }).click()
    const costItem = dialog.locator('.el-form-item', { hasText: '金额上限' })
    await expect(costItem.locator('input')).toBeDisabled()
    await expect(dialog.getByText('工作流维度只支持 token 上限')).toBeVisible()
    await expect(dialog.locator('.el-form-item', { hasText: '选择工作流' })).toBeVisible()

    // 3) 切到「指定 Agent」：金额恢复可用、Agent 下拉出现，展开后有 seed 的选项
    await dialog.locator('.el-radio', { hasText: '指定 Agent' }).click()
    const agentItem = dialog.locator('.el-form-item', { hasText: '选择 Agent' })
    await expect(agentItem).toBeVisible()
    await expect(costItem.locator('input')).toBeEnabled()
    await agentItem.locator('.el-select').click()
    // Element Plus 的下拉是 teleport 到 body 的，全局找
    const option = page.locator('.el-select-dropdown__item', { hasText: AGENT_NAME })
    await expect(option.first()).toBeVisible({ timeout: 10_000 })
    await option.first().click()

    // 4) 填 token 上限并保存
    await dialog.locator('.el-form-item', { hasText: 'token 上限' }).locator('input').fill('12345')
    await dialog.getByRole('button', { name: /确\s*定/ }).click()
    await expect(page.locator('.el-message', { hasText: '已保存' })).toBeVisible({ timeout: 10_000 })

    // 5) 表格出现「Agent：<code>」= 保存真的落库并回显（不是「保存成功但不生效」）
    await expect(page.getByText(`Agent：${AGENT_CODE}`)).toBeVisible({ timeout: 10_000 })
  })
})
