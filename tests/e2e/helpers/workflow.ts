import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, apiHeaders } from './auth'

/**
 * 流程编排列表页的公共动作
 *
 * 抽出来的直接原因：Req1 把「新增 / 编辑元信息」从 640px 弹窗改成了页内面板，定位方式随之从
 * `.el-dialog` 换成 `.panel-title` / `.panel-header` / `form.el-form`，而「点新增 → 填名称编码 →
 * 选经典案例 → 确定」这套开场白在 5 个用例里逐字重复。散着写的话，下次这个表单再换形态
 * （弹窗 ↔ 面板 ↔ 整页，它已经换过三回了）又要改五处。
 */

/**
 * 页内面板的三个锚点
 *
 * 🔴 面板与列表是同级条件渲染（v-if / v-else-if）：面板在的时候列表整块——含搜索表单和「查看画布」
 *    「执行历史」「版本」「触发案例」四个弹窗——都不在 DOM 里。所以这里不必像弹窗那样先 filter 出
 *    某一层再往里定位，页面上同时只有一份 `form.el-form`。
 * 🔴 反过来说，断言「面板已关闭」要用 `toHaveCount(0)` 而不是 `toBeHidden()`：它是被卸载的，
 *    而 toBeHidden 对不存在的元素也算通过，写不出区别。
 */
export function workflowPanel(page: Page) {
  return {
    /** 面板标题：新增流程 / 编辑流程信息 */
    title: page.locator('.panel-title'),
    /** 表单本体，用来定位字段、控件与内联的经典案例卡 */
    form: page.locator('form.el-form'),
    /** 顶部动作条：返回 / 取消 / 确定 */
    header: page.locator('.panel-header')
  }
}

export type WorkflowPanel = ReturnType<typeof workflowPanel>

/** 点列表页「新增」，等页内面板出现 */
export async function openWorkflowCreatePanel(page: Page): Promise<WorkflowPanel> {
  await page.getByRole('button', { name: '新增', exact: true }).first().click()
  const panel = workflowPanel(page)
  await expect(panel.title).toHaveText('新增流程', { timeout: 15000 })
  return panel
}

/**
 * 走完新增面板：填名称与编码、选「经典案例」起步模板、点确定
 *
 * 不含跳转断言：有的用例要等设计器 URL，有的只关心建完草稿后留在列表，交给调用方。
 *
 * 🔴 按钮文案是「确 定」（Element 在两个汉字之间插的空格），故用 `\s*` 容错的正则而不是 exact 字符串。
 * 🔴 起步模板用 `.el-radio` 容器定位而不是 getByText：面板内联的案例卡与 form-tip 里也出现
 *    「经典案例」四个字，getByText 会撞严格模式（多匹配）而失败。
 */
export async function createWorkflowDraft(page: Page, opts: { code: string; name: string }) {
  const panel = await openWorkflowCreatePanel(page)
  await panel.form.locator('input[placeholder="请输入流程名称"]').fill(opts.name)
  await panel.form.locator('input[placeholder*="小写字母开头"]').fill(opts.code)
  await panel.form.locator('.el-radio').filter({ hasText: '经典案例' }).first().click()
  await panel.header.getByRole('button', { name: /确\s*定/ }).click()
}

/**
 * `afterAll` 用的兜底清理：按 code 把本 spec 造的流程**草稿**删干净，返回删掉的行数。
 *
 * 🔴 为什么必须有它（方案 §9.4 F1 / §4.7 / §3.6 第 20 条）
 * 清理若只写在用例体的最后一条语句，那么**用例一红，清理就被跳过** —— 而用例红恰恰是最需要
 * 清理的时刻。旧文档记的实测后果是「漏出 3 行 DRAFT（id=161/170/172）」，
 * 而下一个跑测试的人看到的是「库里凭空多出脏数据」，压根想不到那是上一个红用例的遗产。
 * 方案把「残留非空」直接判成本轮失败，所以这不是卫生问题，是会让整轮验收作废的问题。
 *
 * 🔴 为什么按 code 反查、而不是用建草稿时记下的 id
 * 用例可能死在「草稿已建成」与「id 已记下」之间的任何一步（最典型：`waitForURL` 超时）。
 * 按 code 反查连这种情况也收得走。`code` 各 spec 都带时间戳，全库唯一，误删不到别人的数据。
 *
 * 🔴 走接口而不是驱动页面：`afterAll` 拿不到 `page`（只有 worker 级 fixture），
 * 而且此时页面可能正停在未保存守卫后面 —— 拿接口清理不受 UI 状态影响。
 *
 * 🔴 只删 DRAFT。后端本就只允许删草稿；碰到非草稿行说明用例把它发布/停用了，
 * 那是**被测行为的一部分**而非残渣，这里不越权代删（不 disable 再 delete），只打一行日志喊出来。
 *
 * 🔴 与用例体末尾那段 UI 删除**并存，不要二选一**：那段断言的是「删除按钮 + 二次确认 +
 * 删除成功提示」这条真实交互路径，本函数保证的是「无论用例死在哪儿都不留数据」。
 * 两者目的不同，删掉任何一个都会丢掉一样东西。
 *
 * @param request Playwright 的 `request` fixture（`afterAll` 的参数里取）
 * @param token   `apiLogin()` 拿到的 accessToken
 * @param code    流程编码（精确匹配，不是 like）
 * @returns 实际删掉的行数。用例体已经删干净时返回 0 —— **这是正常的，不是失败**。
 */
export async function deleteWorkflowDraftsByCode(
  request: APIRequestContext,
  token: string,
  code: string
): Promise<number> {
  const headers = apiHeaders(token)
  const listResp = await request.get(
    `${API_BASE_URL}/agent/workflow-def/page?pageNo=1&pageSize=100&code=${encodeURIComponent(code)}`,
    { headers }
  )
  // 🔴 清理自己失败时必须**出声**。裸 await 的话，删除请求 4xx/5xx 或返回业务错误码都会静默通过，
  //    残留照样留在库里，而报告显示全绿 —— 这正是 D4-04 在 T2 里修掉的同一个毛病，别在这儿重新长出来。
  expect(listResp.ok(), `清理前置：按 code 查流程应可读，实际 HTTP ${listResp.status()}`).toBeTruthy()
  const listBody = (await listResp.json()) as {
    code: number
    msg?: string
    data?: { list?: { id: number; code: string; status: string }[] }
  }
  expect(listBody.code, `清理前置：分页接口应返回 0，实际 ${listBody.code} ${listBody.msg ?? ''}`).toBe(0)
  // code 是 like 匹配，前缀相同的别的行会被一起捞回来，故这里按全等复核一遍
  const rows = (listBody.data?.list ?? []).filter((r) => r.code === code)

  let deleted = 0
  for (const row of rows) {
    if (row.status !== 'DRAFT') {
      console.log(
        `[cleanup] ${code} id=${row.id} 状态是 ${row.status} 而非 DRAFT，afterAll 不代删（那是被测行为，不是残渣）`
      )
      continue
    }
    const delResp = await request.delete(`${API_BASE_URL}/agent/workflow-def/delete?id=${row.id}`, {
      headers
    })
    const delBody = (await delResp.json()) as { code: number; msg?: string }
    expect(
      delBody.code,
      `清理：删除草稿 ${code}(id=${row.id}) 应成功，实际 code=${delBody.code} ${delBody.msg ?? ''}`
    ).toBe(0)
    deleted++
  }
  return deleted
}
