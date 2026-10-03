import { test, expect, type Page, type Locator } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 提示词模板**用例**端到端验证（S7 / L5，2026-10-03）
 *
 * 🔴 为什么非要走浏览器：用例的整条价值链是「管理员在模板行下展开子表存一条示例 →
 *   用户在智能助手的「示例」页签点一下 → **填好的正文一字不差地落进输入框**」。
 *   中间任何一环断了都不报错，只会表现为「点开示例页签是空的」或「插进去的正文和库里那条不一样」
 *   —— 后者尤其阴：正文被谁 trim 了、被谁改写了、被截断了，用户看不出来，
 *   他只知道自己照着示例发出去，得到的回答驴唇不对马嘴。
 *   接口层能证 CRUD 通，证不了「展开真的能看见子表」「点一下真的插进输入框而不是直接发出去」。
 *
 * 🔴 本 spec 刻意【不发送】任何消息，理由与 agent-prompt-template.spec.ts 同：
 *   替用户发出去等于让模型对着字面量编答案，那是最难查的一类错（有回答、无报错、答案是错的）。
 *   所以这里只断言「插入到输入框」并断言「没有产生新的对话气泡」。
 *
 * 🔴 两个 describe 各自覆盖一条【双向】闸口，缺半边都不算验过：
 *   - 管理页子表走 /list-by-template，**含关闭态**（管理员要能重新打开一条下架的示例）；
 *   - 聊天面板走 /simple-list，**只含开启态**，且要求「用例开启 **且它的模板也开启」。
 *   只钉「关闭的在聊天面板消失」的话，把两个端点都改成不过滤 status 也能变绿 ——
 *   那时管理页的子表会跟着一起消失，示例「删不掉也找不到」。故两边都断言。
 *
 * 前置：后端 48080（已 apply xpy-2026-10-03-prompt-template-case.sql 并**重启**）+ 前端 dev server。
 * 数据自净：管理页用例建一条 e2e 专用模板 + 其下示例、末尾连同模板一起删掉（顺带验证连带删）；
 *           聊天面板用例走 API 建删，并在 finally 里兜底清理。
 */

const LIST_URL = /\/ai\/agent\/prompt-template$/
const ASSISTANT_URL = /\/ai\/agent\/assistant/
const TPL_PREFIX = 'e2e用例模板-'
const CASE_PREFIX = 'e2e示例-'
/** 种子数据里一定存在的模板（xpy-2026-09-29 每个租户各插一份），聊天面板用例挂在它下面 */
const SEED_TPL_NAME = '这个功能在哪配'

const formItem = (scope: Locator | Page, label: string): Locator =>
  scope.locator(`.el-form-item:has(.el-form-item__label:text-is("${label}"))`).first()

/** 外层模板表的行（子表也是 el-table，全局 .el-table__row 会连它一起命中） */
const tplRows = (page: Page) => page.locator('tr.tpl-row')

const apiGet = async (request: any, headers: any, path: string) =>
  (await request.get(`${API_BASE_URL}${path}`, { headers })).json()

/** 按标题前缀清掉本 spec 可能残留的示例（上次失败留下的） */
const purgeCasesByTitle = async (request: any, headers: any, prefix: string) => {
  const page = await apiGet(request, headers, `/agent/prompt-template-case/page?pageNo=1&pageSize=200&title=${encodeURIComponent(prefix)}`)
  for (const c of (page.data?.list ?? []) as { id: number }[]) {
    await request.delete(`${API_BASE_URL}/agent/prompt-template-case/delete?id=${c.id}`, { headers })
  }
  return (page.data?.list ?? []).length
}

test.describe('提示词模板用例（管理页子表）', () => {
  test.setTimeout(300_000)

  test('S7：行内展开出子表 + 新增/编辑/关闭/删除示例 + 删模板连带删示例', async ({ page, request }) => {
    const token = await apiLogin(request)
    const headers = apiHeaders(token)
    const tplName = `${TPL_PREFIX}${Date.now()}`
    const caseA = `${CASE_PREFIX}A-${Date.now()}`
    const caseB = `${CASE_PREFIX}B-${Date.now()}`
    await purgeCasesByTitle(request, headers, CASE_PREFIX)

    await login(page)
    await gotoWithAuth(page, '/ai/agent/prompt-template')
    await page.waitForURL(LIST_URL, { timeout: 15000 })

    // ---------- 建一条 e2e 专用模板（用例子表要挂在某条模板下） ----------
    await page.locator('[data-testid="tpl-create"]').click()
    await expect(page.locator('.panel-title').filter({ hasText: '新增模板' })).toBeVisible({ timeout: 15000 })
    await formItem(page, '模板名称').locator('input').fill(tplName)
    await formItem(page, '模板正文').locator('textarea').fill('请核对 {{订单号}} 的状态。')
    await page.locator('.panel-header').getByRole('button', { name: /保\s*存/ }).click()
    await expect(page.locator('.panel-title')).toHaveCount(0, { timeout: 25000 })

    const row = tplRows(page).filter({ hasText: tplName }).first()
    await expect(row, '新模板存完应出现在列表里（onSaved 会跳到最后一页）').toBeVisible({ timeout: 20000 })

    // ---------- 展开：子表出现，且此刻是空的 ----------
    await row.locator('.el-table__expand-icon').click()
    const panel = page.locator('[data-testid="case-panel"]')
    await expect(panel).toBeVisible({ timeout: 15000 })
    // 🔴 空态要明说「还没有示例」并给出「示例是什么」的一句话，不能是一片白：
    //    管理员看不出这是「没有数据」还是「子表没加载出来」
    await expect(panel.locator('.case-empty')).toContainText('还没有示例')
    await expect(panel.locator('[data-testid="case-create"]')).toBeVisible()

    // ---------- 新增示例 A（走弹窗） ----------
    await panel.locator('[data-testid="case-create"]').click()
    const dialog = page.locator('[data-testid="case-form-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 15000 })
    // 所属模板只读回显：编辑示例时必须看得见「我在给哪条模板加」
    await expect(formItem(dialog, '所属模板').locator('input')).toHaveValue(tplName)
    await formItem(dialog, '标题').locator('input').fill(caseA)
    const BODY_A = '请核对订单 SO-20261003-0087 的状态，并说明它卡在哪一步、还要多久能发货。'
    await formItem(dialog, '正文').locator('textarea').fill(BODY_A)
    await formItem(dialog, '期望要点').locator('textarea').fill('要给出订单当前所处的节点，并说明下一步动作')
    // 期望分型：这条是「问怎么做/查一下」，选 CHAT
    await formItem(dialog, '期望分型').locator('.el-select').click()
    await page.locator('.el-select-dropdown:visible').last()
      .locator('.el-select-dropdown__item').filter({ hasText: 'CHAT' }).first().click()
    await dialog.locator('[data-testid="case-form-save"]').click()
    await expect(dialog).toBeHidden({ timeout: 20000 })

    // 子表里出现，且各列都对得上
    const caseRowA = panel.locator('[data-testid="case-title"]').filter({ hasText: caseA }).first()
    await expect(caseRowA).toBeVisible({ timeout: 20000 })
    await expect(panel.locator('.el-table__row').filter({ hasText: caseA }).first().locator('[data-testid="case-intent-CHAT"]')).toBeVisible()

    // ---------- 新增示例 B（留着给「删模板连带删」用） ----------
    await panel.locator('[data-testid="case-create"]').click()
    await expect(dialog).toBeVisible({ timeout: 15000 })
    await formItem(dialog, '标题').locator('input').fill(caseB)
    await formItem(dialog, '正文').locator('textarea').fill('第二条示例的正文。')
    // 🔴 期望分型**留空**：这是有意义的第三态（两种分型都算对），不是「忘了填」。
    //    子表必须把它显示成「留空」而不是空白 —— 空白会被下一个管理员读成「这里该填但没人填」，
    //    于是他去补一个会随机翻面的期望值
    await expect(formItem(dialog, '期望分型').locator('input')).toHaveValue('')
    await dialog.locator('[data-testid="case-form-save"]').click()
    await expect(dialog).toBeHidden({ timeout: 20000 })
    const rowB = panel.locator('.el-table__row').filter({ hasText: caseB }).first()
    await expect(rowB).toBeVisible({ timeout: 20000 })
    await expect(rowB.locator('[data-testid="case-intent-blank"]')).toBeVisible()

    // ---------- 编辑示例 A：正文原样回显、改完存回 ----------
    await panel.locator('.el-table__row').filter({ hasText: caseA }).first()
      .locator('[data-testid="case-edit"]').click()
    await expect(dialog).toBeVisible({ timeout: 15000 })
    // 🔴 正文必须一字不差地回显：回显不出来就等于「存了但看不见」，管理员会以为没存上而重填一遍
    await expect(formItem(dialog, '正文').locator('textarea')).toHaveValue(BODY_A)
    const BODY_A2 = '请核对订单 SO-20261003-0087 的状态，并说明它卡在哪一步。'
    await formItem(dialog, '正文').locator('textarea').fill(BODY_A2)
    // 顺手把状态改成「关闭」，下面用它验双向闸口的管理页那半边
    await formItem(dialog, '状态').locator('.el-radio').filter({ hasText: '关闭' }).click()
    await dialog.locator('[data-testid="case-form-save"]').click()
    await expect(dialog).toBeHidden({ timeout: 20000 })

    const rowA = panel.locator('.el-table__row').filter({ hasText: caseA }).first()
    await expect(rowA.locator('[data-testid="case-title"]')).toHaveText(caseA, { timeout: 20000 })
    // 🔴 关闭之后**仍要在子表里可见**：/list-by-template 含关闭态。
    //    若这里也按 status 过滤，管理员关掉一条示例它就当场从管理页消失，「删不掉也找不到」
    await expect(rowA).toContainText('关闭')
    // 通过 API 交叉验证：管理页看到的这条确实是关闭态，而不是标签渲染错了
    const byTpl = await apiGet(request, headers, `/agent/prompt-template-case/list-by-template?templateId=${await templateIdOf(request, headers, tplName)}`)
    const apiA = (byTpl.data ?? []).find((c: any) => c.title === caseA)
    expect(apiA, '/list-by-template 必须含关闭态的示例').toBeTruthy()
    expect(apiA.status, '刚在弹窗里改成关闭，库里应落 1').toBe(1)
    expect(apiA.content, '正文应原样存、不 trim 不改写').toBe(BODY_A2)

    // ---------- 删除示例 B（UI），随后删模板连带删示例 A ----------
    await panel.locator('.el-table__row').filter({ hasText: caseB }).first()
      .locator('[data-testid="case-delete"]').click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(panel.locator('[data-testid="case-title"]').filter({ hasText: caseB })).toHaveCount(0, {
      timeout: 20000
    })

    // 🔴 删模板的确认框必须**说出连带删示例**这件事：示例是人工一条条写的、删了不可恢复，
    //    只说「确认删除模板」的话，管理员事后才发现「我只是想删条模板，怎么示例也没了」
    await row.locator('[data-testid="tpl-delete"]').click()
    const confirmBox = page.locator('.el-message-box')
    await expect(confirmBox).toContainText('示例会一并删除', { timeout: 15000 })
    await confirmBox.getByRole('button', { name: /确定|确认/ }).click()
    await expect(tplRows(page).filter({ hasText: tplName })).toHaveCount(0, { timeout: 25000 })

    // ---------- 连带删的直接证据：示例 A 也不该还在库里 ----------
    // 🔴 这条是本 spec 最要紧的断言之一。漏掉连带删的话，示例 A 会变成一条**孤儿**：
    //    /page 还数得出它，但管理页的子表按 templateId 查、聊天面板按「模板也开启」查，
    //    两边都找不到它 —— 也就是「明明有 45 条，页面上只找得到 30 条」，且没有任何报错。
    await expect
      .poll(async () => (await purgeCasesByTitle(request, headers, CASE_PREFIX)), {
        timeout: 20000,
        message: '删模板后它名下的示例应已被连带删除，/page 里不该再数得到'
      })
      .toBe(0)
  })
})

/** 按名称查模板 id（种子模板的 id 各租户不同，故不能写死） */
async function templateIdOf(request: any, headers: any, name: string): Promise<number> {
  const res = await apiGet(request, headers, `/agent/prompt-template/page?pageNo=1&pageSize=100&name=${encodeURIComponent(name)}`)
  const hit = (res.data?.list ?? []).find((t: any) => t.name === name)
  if (!hit) throw new Error(`找不到模板「${name}」，种子数据可能没 apply`)
  return hit.id
}

test.describe('提示词模板用例（聊天面板「示例」页签）', () => {
  test.setTimeout(300_000)

  test('S7：示例页签按模板分组 + 点一条【一字不差】插入输入框且不发送 + 关闭的示例不出现', async ({ page, request }) => {
    const token = await apiLogin(request)
    const headers = apiHeaders(token)
    const caseTitle = `${CASE_PREFIX}chat-${Date.now()}`
    // 🔴 正文里刻意留一处换行和一处首尾空白之外的排版：插入是**原样**的，
    //    任何「顺手 trim / 压平换行」都会让这条断言变红。首尾空白没放，
    //    因为 el-input 的 value 与后端存的值在这里应当完全相等，放首尾空白只会引入无关的偶发
    const BODY = '请查一下 agent_device_repair 这张表的建表语句，\n并说明 device_no 上有没有索引。'

    let createdId: number | undefined
    try {
      await purgeCasesByTitle(request, headers, CASE_PREFIX)
      const tplId = await templateIdOf(request, headers, SEED_TPL_NAME)
      const created = await (
        await request.post(`${API_BASE_URL}/agent/prompt-template-case/create`, {
          headers,
          data: { templateId: tplId, title: caseTitle, content: BODY, status: 0, sort: 999 }
        })
      ).json()
      expect(created.code, `建 e2e 示例失败：${created.msg}`).toBe(0)
      createdId = created.data

      await login(page)
      await gotoWithAuth(page, '/ai/agent/assistant')
      await page.waitForURL(ASSISTANT_URL, { timeout: 20000 })

      const input = page.locator('textarea[placeholder*="问点什么吧"]').first()
      await expect(input).toBeVisible({ timeout: 20000 })
      await expect(input).toHaveValue('')

      // ---------- 「模板」按钮 → popover，且有「模板 / 示例」两个页签 ----------
      const templateBtn = page.locator('[data-testid="template-picker"]')
      await templateBtn.click()
      const popper = page.locator('.agent-tpl-popover')
      await expect(popper).toBeVisible({ timeout: 15000 })
      // 默认停在「模板」页签：按钮上写的就是「模板」，点开却停在示例会像跳错了地方
      await expect(popper.locator('[data-testid="tpl-item"]').first()).toBeVisible({ timeout: 20000 })
      await expect(popper.locator('[data-testid="case-item"]')).toHaveCount(0)

      // ---------- 切到「示例」：按所属模板名分组，且种子示例真的能到达前端 ----------
      await popper.locator('[data-testid="tpl-tab-case"]').click()
      await expect(popper.locator('[data-testid="case-item"]').first()).toBeVisible({ timeout: 25000 })
      // 🔴 这条钉的是「45 条种子示例不是只躺在库里」：分组标题取自模板名，
      //    种子里每个模板都至少有一条示例，故标题数应当 > 1
      const groupTitles = (await popper.locator('.agent-tpl-group-title').allInnerTexts()).map((g) => g.trim())
      expect(groupTitles.length, `示例页签应按所属模板分组，实际分组数=${groupTitles.length}`).toBeGreaterThan(1)
      expect(groupTitles, `分组里应含种子模板「${SEED_TPL_NAME}」，实际：${groupTitles.join(' / ')}`).toContain(SEED_TPL_NAME)
      await expect(popper.locator('.agent-tpl-foot')).toContainText('正文已填好，可以直接发')

      // 刚建的那条在列表里
      const target = popper.locator(`[data-testid="case-item"][data-case-id="${createdId}"]`)
      await expect(target, '刚通过 API 建的示例应出现在「示例」页签里').toHaveCount(1)
      await expect(target).toContainText(caseTitle)
      // 摘要只显示第一行：全展开会把几十条示例变成一篇没法扫读的文章
      await expect(target.locator('.agent-tpl-item-desc')).toHaveText('请查一下 agent_device_repair 这张表的建表语句，')

      // ---------- 点一条 → 正文【一字不差】落进输入框，popover 关闭，且【没有发出去】 ----------
      const bubblesBefore = await page.locator('[data-testid="assistant-answer"]').count()
      await target.click()
      await expect(popper).toBeHidden({ timeout: 10000 })
      // 🔴🔴 本 spec 最要紧的一条断言。toHaveValue(string) 是**全等**比较：
      //    正文被 trim 了、换行被压平了、被谁改写了、被 INPUT_MAX_LENGTH 截断了 —— 任何一种都会在这里变红。
      //    真值取自 API（库里的 content），不是测试里另抄一份字面量：
      //    抄一份的话，两边一起写错就永远绿，而库里那条其实是坏的。
      const apiCase = (
        (await apiGet(request, headers, `/agent/prompt-template-case/get?id=${createdId}`)).data ?? {}
      ) as { content: string }
      expect(apiCase.content, '前置：API 取到的正文应与建时一致').toBe(BODY)
      await expect(
        input,
        '插进输入框的正文必须与库里的 content 一字不差（原样插入，不 trim / 不改写 / 不压平换行）'
      ).toHaveValue(apiCase.content, { timeout: 10000 })

      // 🔴 必须是【插入】而不是【发送】：气泡数不能变
      await expect
        .poll(async () => page.locator('[data-testid="assistant-answer"]').count(), {
          timeout: 5000,
          message: '点示例不应发送消息'
        })
        .toBe(bubblesBefore)

      // ---------- 再点一条 → 追加而不是覆盖（不能吃掉已写的字） ----------
      await templateBtn.click()
      await expect(popper).toBeVisible({ timeout: 10000 })
      // 重开回到「模板」页签，故要再切一次
      await popper.locator('[data-testid="tpl-tab-case"]').click()
      await expect(popper.locator(`[data-testid="case-item"][data-case-id="${createdId}"]`)).toHaveCount(1, {
        timeout: 20000
      })
      await popper.locator(`[data-testid="case-item"][data-case-id="${createdId}"]`).click()
      // 🔴 全等断言，一次钉住三件事：追加而不是覆盖、两份正文都一字不差、分隔符是两个换行。
      //    早先这里写的是 startsWith(旧值) + 长度变长，那组合是漏的：
      //    「旧值 + 一个错字符 + 新正文」同样既 startsWith 又变长，却能悄悄把两段正文粘成一句读不通的话。
      //    真值仍取自 API（apiCase.content），不在测试里另抄一份字面量。
      await expect(input).toHaveValue(`${apiCase.content}\n\n${apiCase.content}`, { timeout: 10000 })

      // ---------- 双向闸口的另半边：把这条示例关掉，它就不该再出现在「示例」页签 ----------
      await input.fill('')
      await request.put(`${API_BASE_URL}/agent/prompt-template-case/update`, {
        headers,
        data: { id: createdId, templateId: tplId, title: caseTitle, content: BODY, status: 1, sort: 999 }
      })
      // 🔴 管理页那半边（关闭后**仍在**子表里）由上一个 describe 断言，两边合起来才是完整的闸口：
      //    只钉这一半的话，把 /list-by-template 和 /simple-list 一起改成「都只返回开启态」也能变绿，
      //    而那时管理员关掉一条示例，它就当场从管理页消失 ——「删不掉也找不到」
      await templateBtn.click()
      await expect(popper).toBeVisible({ timeout: 10000 })
      await popper.locator('[data-testid="tpl-tab-case"]').click()
      await expect(popper.locator('[data-testid="case-item"]').first()).toBeVisible({ timeout: 20000 })
      await expect(
        popper.locator(`[data-testid="case-item"][data-case-id="${createdId}"]`),
        '关闭态的示例不该出现在聊天面板：模板/示例被下架后，用户不该再被引导走那条路'
      ).toHaveCount(0)
      // 但它在管理页口径里仍然查得到
      const stillThere = await apiGet(request, headers, `/agent/prompt-template-case/list-by-template?templateId=${tplId}`)
      expect(
        (stillThere.data ?? []).some((c: any) => c.id === createdId),
        '/list-by-template 必须含关闭态，否则示例「删不掉也找不到」'
      ).toBe(true)
    } finally {
      // 数据自净：即便中途断言失败也要把这条 e2e 示例删掉，
      // 否则它会一直挂在种子模板下，把后面每一次跑的结果都污染一点
      if (createdId) {
        await request.delete(`${API_BASE_URL}/agent/prompt-template-case/delete?id=${createdId}`, { headers }).catch(() => {})
      }
      await purgeCasesByTitle(request, headers, CASE_PREFIX).catch(() => {})
    }
  })
})
