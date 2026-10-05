import { expect, test, type Locator, type Page } from '@playwright/test'
import { API_BASE_URL, apiHeaders, apiLogin, gotoWithAuth, login } from './helpers/auth'
import { openWorkflowCreatePanel } from './helpers/workflow'

/**
 * webhook 触发器的鉴权配置：下拉只剩两档、缺省 hmac、验签密钥常驻必填（#72）
 *
 * <h3>🔴 为什么非要走浏览器</h3>
 * 这一格的改动全在模板与表单校验里：删掉一个 {@code <el-option>}、把「验签密钥」的
 * {@code v-if} 去掉、把缺省值从 'none' 改成 'hmac'、给 validateTrigger 加一条必填。
 * vitest 覆盖的是 starterDsl / triggerCases 这些**纯逻辑模块**，压根不挂载
 * WorkflowForm.vue —— 所以「单测 1003 条全绿」对这一格**零证明力**。
 * 而本模块的头号缺陷正是「界面上能选、点了保存才炸」，只有真实 DOM 才暴露。
 *
 * <p>顺带钉住一条反向要求：补上密钥必须**真能建出草稿**，且落库的 DSL 与界面上看到的
 * 逐字一致。只验「拦住」不验「放行」的测试，会在过度拦截时照样全绿。
 *
 * <p>前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。
 *
 * <h3>数据自净为什么是两层</h3>
 * 用例内那次删除是**产品断言**（草稿态可删，对应 {@code AgentWorkflowDefServiceImpl#deleteDef} 的守卫），
 * 但它排在第 8 步——前面任何一步失败，用例就中止在那儿，草稿留在库里。
 * 这不是假想：{@code agent-workflow-editor.spec.ts} 同样是「删在最后」，实测已经漏过一行
 * （id=161，DRAFT，2026-10-01），而它的头注释也写着「数据自净」。
 * ⟹ 兜底放在 {@code afterAll}，**按 code 反查**而不是按 id：id 要等第 6 步跳转成功才知道，
 * 而「建出来了但没跳过去」正是最需要兜底的那条路径。
 * 反查走 {@code version-list}，它经 {@code BaseDO} 的 {@code @TableLogic} 自动带 {@code deleted=0}，
 * 故第 8 步已删成功时这里查到空集、什么都不做。
 */

const EDITOR_URL = /\/agent-workflow\/editor\?id=(\d+)/
const LIST_URL = /\/ai\/agent\/workflow$/

/** 本次跑造的 code，供 afterAll 兜底反查；用例一开始就赋值，故任何一步失败都能清 */
let createdCode: string | null = null

/** 面板里按 label 取一个 el-form-item（面板是页内条件渲染，同时只有一份 form.el-form） */
const formItem = (page: Page, label: string): Locator =>
  page.locator('form.el-form .el-form-item').filter({ has: page.locator(`.el-form-item__label:text-is("${label}")`) })

/** 当前可见的那个下拉浮层；用 last() 是因为 Element 会保留已关闭的浮层在 DOM 里 */
const visibleDropdown = (page: Page): Locator => page.locator('.el-select-dropdown:visible').last()

test.describe('webhook 触发器：鉴权方式只剩 hmac/token，验签密钥常驻必填', () => {
  test.setTimeout(150_000)

  test.afterAll(async ({ request }) => {
    if (!createdCode) return
    const token = await apiLogin(request)
    const res = await request.get(`${API_BASE_URL}/agent/workflow-def/version-list?code=${createdCode}`, {
      headers: apiHeaders(token)
    })
    const body = await res.json()
    expect(body.code, JSON.stringify(body)).toBe(0)
    for (const item of body.data ?? []) {
      const del = await request.delete(`${API_BASE_URL}/agent/workflow-def/delete?id=${item.id}`, {
        headers: apiHeaders(token)
      })
      expect((await del.json()).code, `兜底清理失败：id=${item.id}`).toBe(0)
    }
  })

  test('下拉无「不鉴权」项、缺省 hmac、缺密钥建不出草稿、补上密钥能建且 DSL 与界面一致', async ({
    page,
    request
  }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')

    const code = `wf_e2e_wh${Date.now().toString(36)}`
    createdCode = code
    const name = `E2E webhook 鉴权 ${code}`
    const path = `e2e_hook_${Date.now().toString(36)}`
    const secret = `e2e-only-${Date.now().toString(36)}`

    const panel = await openWorkflowCreatePanel(page)
    await panel.form.locator('input[placeholder="请输入流程名称"]').fill(name)
    await panel.form.locator('input[placeholder*="小写字母开头"]').fill(code)

    // 1. 触发方式切到 Webhook（label 唯一来源是 triggerCases.ts 的 TRIGGER_TYPE_LABELS）
    await formItem(page, '触发方式').locator('.el-select').click()
    await visibleDropdown(page).locator('.el-select-dropdown__item').filter({ hasText: 'Webhook' }).first().click()

    // 2. webhook 专属的三格都出现了；其中「验签密钥」必须是**常驻**的，不能藏在 v-if 后面
    await expect(formItem(page, '入站 Path')).toBeVisible({ timeout: 15000 })
    await expect(formItem(page, '鉴权方式')).toBeVisible()
    await expect(formItem(page, '验签密钥')).toBeVisible()

    // 3. 🔴 本用例的主判据：鉴权方式下拉**恰好两项**，且没有任何一项在暗示「不鉴权也行」
    await formItem(page, '鉴权方式').locator('.el-select').click()
    const authOptions = visibleDropdown(page).locator('.el-select-dropdown__item')
    await expect(authOptions).toHaveCount(2, { timeout: 15000 })
    const labels = (await authOptions.allTextContents()).map((s) => s.trim())
    expect(labels).toEqual(['HMAC-SHA256 签名', '静态令牌 Token'])
    // 逐项扫一遍而不是只比对数组：万一将来有人加回第三项，这条能直接说出加回来的是什么话术
    for (const text of labels) {
      expect(text, `鉴权方式里不该再出现「不鉴权」这一档：${text}`).not.toMatch(/不可猜|不鉴权|无\s*（/)
    }
    // 关掉浮层（选 hmac 保持缺省，不动它 —— 顺带验缺省值就是第一项）
    await page.keyboard.press('Escape')

    // 4. 缺省就是 hmac：界面上显示的是它的 label，而不是空的或裸值 'none'
    //    🔴 这一格一旦回退成 'none'，el-select 找不到对应 option 会把**裸值当 label 显示**成 "none"
    //    🔴 定位到 .el-select__placeholder 而不是 .el-select__selected-item：后者在 Element 2.13 里
    //       会同时匹配「输入框包装层」与「显示值」两个节点，撞严格模式（实测报 2 elements）
    await expect(formItem(page, '鉴权方式').locator('.el-select__placeholder')).toHaveText('HMAC-SHA256 签名', {
      timeout: 15000
    })

    // 5. 只填 path、密钥留空 → 表单校验必须拦住，且**不许**跳进设计器（跳了就等于建出了草稿）
    await formItem(page, '入站 Path').locator('input').fill(path)
    await panel.header.getByRole('button', { name: /确\s*定/ }).click()
    await expect(page.locator('.el-form-item__error').filter({ hasText: '必须填写验签密钥' }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page).toHaveURL(LIST_URL)

    // 6. 补上密钥 → 建出草稿并带 ?id= 进整页设计器（证明没有过度拦截）
    await formItem(page, '验签密钥').locator('input').fill(secret)
    await panel.header.getByRole('button', { name: /确\s*定/ }).click()
    await page.waitForURL(EDITOR_URL, { timeout: 20000 })
    const id = Number(EDITOR_URL.exec(page.url())![1])

    // 7. 🔴 落库的 DSL 必须与界面上看到的逐字一致：authType=hmac、secret 原样、path 原样。
    //    这一条才是本模块要消灭的那个缺陷的正面判据——「保存成功但落库的不是你以为的那份」。
    const token = await apiLogin(request)
    const got = await request.get(`${API_BASE_URL}/agent/workflow-def/get?id=${id}`, {
      headers: apiHeaders(token)
    })
    const body = await got.json()
    expect(body.code, JSON.stringify(body)).toBe(0)
    const trigger = JSON.parse(body.data.dsl).trigger
    expect(trigger.type).toBe('trigger.webhook')
    expect(trigger.config).toMatchObject({ path, authType: 'hmac', secret })

    // 8. 自净第一层（产品断言）：草稿态可删 —— 对应 AgentWorkflowDefServiceImpl#deleteDef 的守卫。
    //    删成功后 afterAll 按 code 反查到空集，兜底那一层自然不动手。
    const del = await request.delete(`${API_BASE_URL}/agent/workflow-def/delete?id=${id}`, {
      headers: apiHeaders(token)
    })
    expect((await del.json()).code).toBe(0)
  })
})
