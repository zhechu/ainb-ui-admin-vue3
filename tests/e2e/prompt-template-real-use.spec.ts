import { test, expect } from '@playwright/test'
import { apiHeaders, apiLogin, gotoWithAuth, login, API_BASE_URL } from './helpers/auth'

/**
 * 提示词模板「真能用」验证（2026-09-29 二轮需求4）
 *
 * 🔴 为什么非要走浏览器，而且非要真发一条
 * 模板模块此前的覆盖停在「管理页增删改查 + 点一条插进输入框」，但用户嘴里的「能用」是：
 * 选一条模板 → 替换占位符 → 发出去 → 模型照着答。这条链路上任何一环断了
 * （popover 分组渲染错、插入被 2000 字上限拦、占位符提醒不出现、发送按钮没解禁），
 * 管理页的用例全绿也发现不了 —— 正是本平台头号缺陷「配置保存成功但不生效」的形状。
 *
 * 两个用例分工：
 *   ① 逐条点一遍<b>全部启用模板</b>：每条都真插进输入框且正文一字不差（数据层审计管长度/占位符成形，这里管 UI 链路）
 *   ② 挑一条带占位符的，替换后<b>真发送</b>并等模型答完：这就是需求要的「一次真正的测试案例」
 *
 * 前置：后端 48080 + 前端 dev server 在跑；用例②需要一个可用的聊天模型（实测 20~60 秒）。
 */

interface Tpl {
  id: number
  name: string
  content: string
  category?: string
  status?: number
}

const PLACEHOLDER = /{{\s*[^{}]+?\s*}}/g

test.describe('提示词模板 · 真实可用', () => {
  test.setTimeout(300_000)

  test('每条启用模板都真插得进输入框（逐条点，正文一字不差）', async ({ page, request }) => {
    const token = await apiLogin(request)
    const resp = await request.get(`${API_BASE_URL}/agent/prompt-template/simple-list`, {
      headers: apiHeaders(token)
    })
    const tpls = ((await resp.json()).data ?? []) as Tpl[]
    expect(tpls.length, '没有任何启用中的模板，用例失去意义').toBeGreaterThan(0)

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 20_000 })

    let placeholderToastChecked = false
    for (const tpl of tpls) {
      await page.locator('[data-testid="template-picker"]').click()
      const popper = page.locator('.agent-tpl-popover:visible')
      await expect(popper).toBeVisible({ timeout: 10_000 })
      // 名称可能互为前缀（「搭表单」/「搭表单-带字段」），故锚定整串精确匹配
      const item = popper
        .locator('.agent-tpl-item')
        .filter({ has: page.locator('.agent-tpl-item-name', { hasText: new RegExp(`^${tpl.name}$`) }) })
      await expect(item, `模板「${tpl.name}」没出现在选择面板里`).toHaveCount(1)
      await item.click()

      // 输入框为空时插入 = 正文原样；被 2000 字上限拦下的话这里会直接红
      await expect(textarea, `模板「${tpl.name}」插入后正文不符`).toHaveValue(tpl.content, {
        timeout: 5_000
      })

      if (!placeholderToastChecked && PLACEHOLDER.test(tpl.content)) {
        PLACEHOLDER.lastIndex = 0
        placeholderToastChecked = true
        await expect(
          page.locator('.el-message').filter({ hasText: '处占位符要替换' })
        ).toBeVisible({ timeout: 5_000 })
      }
      await textarea.fill('')
    }
    expect(
      placeholderToastChecked,
      '全部模板都没有占位符？占位符提醒这条链路就没被走到'
    ).toBe(true)
  })

  test('真案例：带占位符的模板替换后发送，模型真答得上', async ({ page, request }) => {
    const token = await apiLogin(request)
    const resp = await request.get(`${API_BASE_URL}/agent/prompt-template/simple-list`, {
      headers: apiHeaders(token)
    })
    const tpls = ((await resp.json()).data ?? []) as Tpl[]
    const tpl = tpls.find((t) => (t.content.match(PLACEHOLDER) ?? []).length > 0)
    expect(tpl, '没有带占位符的启用模板，用例失去意义').toBeTruthy()
    PLACEHOLDER.lastIndex = 0

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 20_000 })

    // 走真实 UI 插入，而不是直接 fill：插入链路本身也是被测对象
    await page.locator('[data-testid="template-picker"]').click()
    const popper = page.locator('.agent-tpl-popover:visible')
    await popper
      .locator('.agent-tpl-item')
      .filter({ has: page.locator('.agent-tpl-item-name', { hasText: new RegExp(`^${tpl!.name}$`) }) })
      .click()
    await expect(textarea).toHaveValue(tpl!.content, { timeout: 5_000 })

    // 用户视角的「替换占位符」：把每处 {{xx}} 填成具体值，再整段发送
    const question = tpl!.content.replace(PLACEHOLDER, '员工信息登记表')
    expect(question, '替换后不应残留占位符').not.toContain('{{')
    await textarea.fill(question)
    await page.getByRole('button', { name: /发\s*送/ }).click()

    // 判「答完」用停止按钮消失：模型答什么不由测试决定，但流结束是确定的
    await expect(page.getByRole('button', { name: /停止/ })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /停止/ })).toHaveCount(0, { timeout: 180_000 })

    // 🔴 断言在 assistant-answer 上（正文），不能断言整个气泡：思维链里提到关键词不算答出来
    const answer = page.locator('[data-testid="assistant-answer"]').last()
    await expect(answer).toBeVisible({ timeout: 30_000 })
    const text = (await answer.innerText()).trim()
    expect(text.length, '模型没有答出任何正文').toBeGreaterThan(0)
    expect(text, '答案里漏出了未替换的占位符').not.toContain('{{')
    // 出错态会以 el-alert 形式挂在气泡里，真案例不允许带病通过
    await expect(page.locator('.el-alert--error')).toHaveCount(0)
  })
})
