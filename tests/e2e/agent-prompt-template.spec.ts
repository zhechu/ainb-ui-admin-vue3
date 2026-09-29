import { test, expect, type Page, type Locator } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 提示词模板端到端验证（2026-09-29 需求7 + 需求8）
 *
 * 🔴 为什么非要走浏览器：这个模块整条价值链是「管理员在管理页存一条模板 → 用户在智能助手里点一下
 *   → 正文落进输入框」。中间任何一环断了都不会报错，只会表现为「按钮点开是空的」或
 *   「刚存的模板找不到」——正是本平台头号缺陷「配了但不生效且无提示」的形状。
 *   接口层能证 CRUD 通，证不了：菜单真出现、占位符真被识别并高亮、popover 真按分类分组、
 *   点一条真插进输入框而【不是直接发出去】、以及需求8 的「Agent 选择器与发送按钮真在同一行」。
 *
 * 🔴 关键取舍：本 spec 刻意【不发送】任何消息。模板正文里的 {{占位符}} 需要用户先替换，
 *   替他发出去等于让模型对着「{{订单号}}」这种字面量编一个答案 —— 那是最难查的一类错
 *   （有回答、无报错、答案是错的）。所以这里只断言「插入到输入框」并断言「没有产生新的对话气泡」。
 *
 * 前置：后端 48080（已 apply xpy-2026-09-29-agent-prompt-template.sql 并重启）+ 前端 dev server。
 * 数据自净：管理页用例建一条 e2e 专用模板、末尾删除。
 */

const LIST_URL = /\/ai\/agent\/prompt-template$/
const NAME_PREFIX = 'e2e模板-'
/** 种子数据里一定存在的两条（xpy-2026-09-29-agent-prompt-template.sql 每个租户各插一份） */
const SEED_NAME = '这个功能在哪配'
const SEED_CATEGORY = '平台使用'

const formItem = (scope: Locator | Page, label: string): Locator =>
  scope.locator(`.el-form-item:has(.el-form-item__label:text-is("${label}"))`).first()

const box = async (l: Locator) => {
  const b = await l.boundingBox()
  if (!b) throw new Error('元素不可见，取不到 boundingBox')
  return b
}
/** 两个元素的纵向区间有重叠 = 视觉上行 */
const onSameRow = (a: { y: number; height: number }, b: { y: number; height: number }) =>
  a.y < b.y + b.height && b.y < a.y + a.height

test.describe('提示词模板（管理页）', () => {
  test.setTimeout(180_000)

  test('需求7：菜单出现 + 种子数据 + 占位符识别 + 页内新增/编辑/删除 + 分页', async ({ page, request }) => {
    const name = `${NAME_PREFIX}${Date.now()}`
    await login(page)
    await gotoWithAuth(page, '/ai/agent/prompt-template')
    await page.waitForURL(LIST_URL, { timeout: 15000 })

    // ---------- 菜单真出现（菜单 SQL + 需求9 挂到 AI 下的直接证据） ----------
    await expect(page.getByText('提示词模板', { exact: true }).first()).toBeVisible({ timeout: 15000 })

    // ---------- 种子数据在列表里，且分页渲染 ----------
    await expect(page.locator('.el-table__row').first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.el-table__row').filter({ hasText: SEED_NAME }).first()).toBeVisible()
    await expect(page.locator('.el-pagination')).toBeVisible()
    await expect(page.locator('.el-pagination__total')).toContainText(/共\s*\d+\s*条/)

    // ---------- 占位符列：正文里的 {{x}} 被拆出来单独展示 ----------
    // 列序：1 序号 / 2 模板名称 / 3 分类 / 4 正文 / 5 占位符 / 6 排序 / 7 状态 / 8 创建时间 / 9 操作
    const seedRow = page.locator('.el-table__row').filter({ hasText: SEED_NAME }).first()
    await expect(seedRow.locator('td:nth-child(3)')).toContainText(SEED_CATEGORY)
    const seedPlaceholders = await seedRow.locator('td:nth-child(5) .el-tag').allInnerTexts()
    expect(seedPlaceholders.map((p) => p.trim()), '种子模板「这个功能在哪配」应识别出 {{想做的事}}').toContain(
      '想做的事'
    )
    await expect(seedRow.locator('td:nth-child(7)')).toContainText('开启')

    // ---------- 搜索：按名称过滤 ----------
    await formItem(page, '名称').locator('input').fill(SEED_NAME)
    await page.getByRole('button', { name: /搜\s*索/ }).click()
    await expect
      .poll(async () => page.locator('.el-table__row').count(), { timeout: 15000 })
      .toBe(1)
    await page.getByRole('button', { name: /重\s*置/ }).click()
    await expect(page.locator('.el-table__row').filter({ hasText: SEED_NAME }).first()).toBeVisible({
      timeout: 15000
    })

    // ---------- 自净前置：清掉上次失败可能残留的同名模板 ----------
    const token = await apiLogin(request)
    const headers = apiHeaders(token)
    const leftover = await (
      await request.get(
        `${API_BASE_URL}/agent/prompt-template/page?pageNo=1&pageSize=100&name=${encodeURIComponent(NAME_PREFIX)}`,
        { headers }
      )
    ).json()
    for (const t of (leftover.data?.list ?? []) as { id: number }[]) {
      await request.delete(`${API_BASE_URL}/agent/prompt-template/delete?id=${t.id}`, { headers })
    }

    // ---------- 需求7：新增走【页内面板】，不是弹窗 ----------
    await page.getByRole('button', { name: '新增', exact: true }).first().click()
    await expect(page.locator('.panel-title').filter({ hasText: '新增模板' })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.el-dialog')).toHaveCount(0)
    // 右侧那块「聊天面板里的样子」实时预览——它不是装饰，是让管理员存之前就看到用户会看到什么
    await expect(page.getByText('聊天面板里的样子')).toBeVisible()

    await formItem(page, '模板名称').locator('input').fill(name)
    await formItem(page, '模板正文').locator('textarea').fill('请核对 {{订单号}} 的状态，并说明 {{关注点}}。')
    await formItem(page, '分类').locator('.el-select').click()
    const dd = page.locator('.el-select-dropdown:visible').last()
    await dd.locator('.el-select-dropdown__item').filter({ hasText: SEED_CATEGORY }).first().click()

    // 占位符实时识别：两个都要出现，且列表里去重
    await expect(page.getByText('订单号', { exact: true }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('关注点', { exact: true }).first()).toBeVisible({ timeout: 10000 })
    // 右侧预览：正文里的占位符要被 <mark> 高亮出来（分段渲染，不是 v-html，故无 XSS 面）
    const preview = page.locator('.preview-card')
    await expect(preview.locator('.preview-title')).toHaveText('聊天面板里的样子')
    await expect(preview.locator('.preview-name')).toHaveText(name)
    await expect(preview.locator('.preview-content')).toContainText('订单号')
    expect(
      await preview.locator('mark.preview-ph').count(),
      '预览里两个占位符都应被高亮'
    ).toBe(2)

    await page.locator('.panel-header').getByRole('button', { name: /保\s*存/ }).click()
    await expect(page.locator('.panel-title')).toHaveCount(0, { timeout: 25000 })

    // ---------- 新模板出现在列表 ----------
    const row = page.locator('.el-table__row').filter({ hasText: name }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row.locator('td:nth-child(5) .el-tag')).toHaveCount(2)

    // ---------- 编辑：正文回显、改完存回 ----------
    await row.getByRole('button', { name: '编辑' }).click()
    await expect(page.locator('.panel-title').filter({ hasText: '编辑模板' })).toBeVisible({ timeout: 15000 })
    await expect(formItem(page, '模板名称').locator('input')).toHaveValue(name)
    // 🔴 正文必须原样回显：回显不出来就等于「存了但看不见」，用户会以为没存上
    await expect(formItem(page, '模板正文').locator('textarea')).toHaveValue(
      '请核对 {{订单号}} 的状态，并说明 {{关注点}}。'
    )
    await formItem(page, '模板正文').locator('textarea').fill('改后正文 {{新占位符}}')
    await page.locator('.panel-header').getByRole('button', { name: /保\s*存/ }).click()
    await expect(page.locator('.panel-title')).toHaveCount(0, { timeout: 25000 })
    await expect(page.locator('.el-table__row').filter({ hasText: name }).first().locator('td:nth-child(5)')).toContainText(
      '新占位符',
      { timeout: 20000 }
    )

    // ---------- 删除（数据自净） ----------
    await page.locator('.el-table__row').filter({ hasText: name }).first().getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-table__row').filter({ hasText: name })).toHaveCount(0, { timeout: 25000 })
  })
})

test.describe('提示词模板（智能助手面板）', () => {
  test.setTimeout(180_000)

  test('需求7+8：模板/Agent/发送同一行 + popover 分组 + 点一条插入输入框且不发送', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    await page.waitForURL(/\/ai\/agent\/assistant/, { timeout: 20000 })

    const input = page.locator('textarea[placeholder*="问点什么吧"]').first()
    await expect(input).toBeVisible({ timeout: 20000 })

    const templateBtn = page.locator('[data-testid="template-picker"]')
    const agentPicker = page.locator('[data-testid="agent-picker"]')
    const sendBtn = page.getByRole('button', { name: /发\s*送/ }).first()

    // ---------- 需求8：三者必须在【同一行】 ----------
    // 🔴 这条是需求8 的唯一硬证据。原来 Agent 选择器独占一行、白占 40px 竖向空间，
    //    挪进发送行之后，三个元素的纵向区间必须互相重叠。只断言「都可见」是证不出来的
    //    ——它们竖着排三行也一样都可见。
    await expect(templateBtn).toBeVisible({ timeout: 15000 })
    await expect(agentPicker).toBeVisible({ timeout: 15000 })
    await expect(sendBtn).toBeVisible({ timeout: 15000 })
    const [tplBox, agentBox, sendBox] = [await box(templateBtn), await box(agentPicker), await box(sendBtn)]
    expect(onSameRow(tplBox, agentBox), `模板按钮(y=${tplBox.y},h=${tplBox.height}) 与 Agent 选择器(y=${agentBox.y},h=${agentBox.height}) 不在同一行`).toBe(true)
    expect(onSameRow(agentBox, sendBox), `Agent 选择器与发送按钮不在同一行`).toBe(true)
    expect(onSameRow(tplBox, sendBox), '模板按钮与发送按钮不在同一行').toBe(true)
    // 输入框必须在这一行【之上】（先写字、后发送，符合用户习惯）
    const inputBox = await box(input)
    expect(inputBox.y + inputBox.height, '输入框应在按钮行上方').toBeLessThanOrEqual(tplBox.y + 1)

    // ---------- 需求7：点「模板」→ popover 出现且按分类分组 ----------
    await templateBtn.click()
    const popper = page.locator('.agent-tpl-popover')
    await expect(popper).toBeVisible({ timeout: 15000 })
    await expect(popper.locator('.agent-tpl-item').first()).toBeVisible({ timeout: 20000 })

    const groupTitles = (await popper.locator('.agent-tpl-group-title').allInnerTexts()).map((g) => g.trim())
    expect(groupTitles.length, 'popover 应按分类分组').toBeGreaterThan(0)
    expect(groupTitles, `分组里应含种子分类「${SEED_CATEGORY}」，实际：${groupTitles.join('/')}`).toContain(
      SEED_CATEGORY
    )
    await expect(popper.locator('.agent-tpl-foot')).toContainText('占位符替换后再发送')

    // 搜索框能过滤
    await popper.locator('input[placeholder*="搜名称"]').fill(SEED_NAME)
    await expect(popper.locator('.agent-tpl-item').first()).toContainText(SEED_NAME, { timeout: 10000 })
    await expect
      .poll(async () => popper.locator('.agent-tpl-item').count(), { timeout: 10000 })
      .toBe(1)
    await popper.locator('input[placeholder*="搜名称"]').fill('')

    // ---------- 点一条 → 正文落进输入框，popover 关闭，且【没有发出去】 ----------
    const bubblesBefore = await page.locator('[data-testid="assistant-answer"]').count()
    await expect(input).toHaveValue('')
    await popper.locator('.agent-tpl-item').filter({ hasText: SEED_NAME }).first().click()

    await expect(popper).toBeHidden({ timeout: 10000 })
    // 🔴 插入的是模板正文原文（含 {{占位符}}），不是被谁替换过的东西
    //    textarea 要用 toHaveValue（DOM 的 textContent 不跟随 value 变化，toContainText 会假失败）
    await expect(input).toHaveValue(/\{\{/, { timeout: 10000 })
    await expect(input).toHaveValue(/想做的事/)
    // 🔴 必须是【插入】而不是【发送】：气泡数不能变
    await expect
      .poll(async () => page.locator('[data-testid="assistant-answer"]').count(), {
        timeout: 5000,
        message: '点模板不应发送消息'
      })
      .toBe(bubblesBefore)
    // 占位符提示要出现，否则用户不知道还得替换
    await expect(page.locator('.el-message').filter({ hasText: /占位符/ }).first()).toBeVisible({
      timeout: 10000
    })

    // ---------- 再点一条 → 追加而不是覆盖（不能吃掉已写的字） ----------
    const firstText = await input.inputValue()
    await templateBtn.click()
    await expect(popper).toBeVisible({ timeout: 10000 })
    await popper.locator('.agent-tpl-item').first().click()
    await expect
      .poll(async () => (await input.inputValue()).startsWith(firstText.trim().slice(0, 20)), {
        timeout: 10000,
        message: '第二次插入应追加在原文之后，而不是覆盖'
      })
      .toBe(true)
    await expect(input).not.toHaveValue(firstText)
  })
})
