import { test, expect, type Page } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 智能体管理页 + 整页设计器 端到端验证
 *
 * 🔴 为什么非要走浏览器
 * 后端 curl 已证 7 端点 + 状态机全通，但「菜单点开是空白页」「弹窗改整页后导航/回填是否正常」
 * 这类缺陷只在真实 DOM 里暴露。AI助手 UX 修复（问题3）把新建/编辑/查看从 760px 弹窗改成了
 * 隐藏路由整页设计器 /agent-def/editor，故本 spec 从「驱动 dialog」整体改为「驱动整页设计器」：
 *   列表点「新增」→ 跳整页设计器 → 填必填 → 保存草稿（URL 补 id）→ 返回列表 → 行状态机。
 *
 * 🔴 尤其要守住的平台头号反模式：「配置保存成功但不生效」——工具多选（toolKeys CSV⇄数组适配器）
 *   往返若丢了，表现为「选了工具保存成功、重新打开却空了」，curl/单测全绿，只有浏览器走一遍才暴露。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev server 同时在跑。
 * 本 spec 全程通过 UI 自建数据（不预播种），用时间戳保证 code 唯一，跑完自清理（删草稿）。
 */

const CODE = `e2e_def_${Date.now().toString().slice(-8)}`

/** 需求10 种子数据：系统内置的「默认平台助手」（xpy-2026-09-29-agent-def-builtin-platform-assistant.sql） */
const BUILTIN_CODE = 'platform_assistant'

/**
 * 按编码把列表收敛到本用例关心的行。
 *
 * 🔴 不能省：列表是全租户共享的（当前已有 12+ 条 Agent），只靠 `filter({hasText: CODE})` 断言，
 * 一旦新行被排到第 2 页就会「查不到」，看起来像功能坏了，实际是分页。搜索后行数确定，断言才有意义。
 */
async function searchByCode(page: Page, code: string) {
  await page.getByPlaceholder('请输入编码').fill(code)
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await expect(page.locator('.el-table__body tr').filter({ hasText: code }).first()).toBeVisible({
    timeout: 20000
  })
}

/** 列表页「新增」→ 整页设计器 → 填三个必填 → 保存草稿 → 断言落库 → 返回列表 */
async function createDraftViaUi(page: Page, code: string, name: string, persona: string) {
  await page.getByRole('button', { name: '新增', exact: true }).first().click()
  await page.waitForURL(/\/agent-def\/editor/)

  await page.getByPlaceholder('请输入名称，如「订单客服」').fill(name)
  await page
    .getByPlaceholder('小写字母开头，仅含小写字母/数字/下划线，如 order_assistant')
    .fill(code)
  await page.locator('[data-testid="agent-persona"]').fill(persona)

  await page.getByRole('button', { name: /保存草稿/ }).click()
  await expect(page.locator('.el-message').filter({ hasText: '新建成功' }).first()).toBeVisible({
    timeout: 15000
  })
  // 新建成功后 URL 补上 id（防刷新重复新建）
  await expect(page).toHaveURL(/\/agent-def\/editor\?id=\d+/)

  await page.locator('button[title="返回列表"]').click()
  await page.waitForURL(/\/agent\/def$/)
}

test.describe('智能体管理页', () => {
  test.setTimeout(180_000)

  test('菜单非空白 + 新建 → 发布 → 停用 全生命周期', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/def')

    // 页面非空白：搜索表单在（Req 8：文案已从「Agent 编码」收敛为「编码」）
    await expect(page.getByText('编码').first()).toBeVisible({ timeout: 20000 })
    // Req 8：列表首列是序号列（参考模型配置页）
    await expect(
      page.locator('.el-table__header th').filter({ hasText: '序号' }).first()
    ).toBeVisible({ timeout: 15000 })

    await createDraftViaUi(page, CODE, 'E2E 测试助手', '你是一个用于端到端测试的助手，请友好地回答。')

    // 列表出现新行，状态=草稿
    const row = page.locator('.el-table__body tr').filter({ hasText: CODE }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row.getByText('草稿')).toBeVisible({ timeout: 15000 })

    // 发布
    await row.getByRole('button', { name: '发布' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /发布成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(
      page.locator('.el-table__body tr').filter({ hasText: CODE }).first().getByText('已发布')
    ).toBeVisible({ timeout: 15000 })

    // 停用
    await page
      .locator('.el-table__body tr')
      .filter({ hasText: CODE })
      .first()
      .getByRole('button', { name: '停用' })
      .first()
      .click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /停用成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(
      page.locator('.el-table__body tr').filter({ hasText: CODE }).first().getByText('已停用')
    ).toBeVisible({ timeout: 15000 })

    // 查看（已停用行）→ 整页只读：字段禁用 + 只读提示 + 不可保存
    await page
      .locator('.el-table__body tr')
      .filter({ hasText: CODE })
      .first()
      .getByRole('button', { name: '查看' })
      .first()
      .click()
    await page.waitForURL(/\/agent-def\/editor\?id=\d+/)
    await expect(page).toHaveURL(/mode=view/)
    await expect(page.getByPlaceholder('请输入名称，如「订单客服」')).toBeDisabled()
    await expect(page.locator('.el-alert--warning').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /保存草稿/ })).toBeDisabled()
    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(/\/agent\/def$/)
  })

  test('草稿可删除（清理本 spec 造的数据）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/def')

    const CODE2 = `e2e_del_${Date.now().toString().slice(-8)}`
    await createDraftViaUi(page, CODE2, '待删助手', '临时人设，用于验证删除。')

    const row = page.locator('.el-table__body tr').filter({ hasText: CODE2 }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: '删除' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /删除成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: CODE2 })).toHaveCount(0, {
      timeout: 15000
    })
  })

  /**
   * 工具多选的「表单 ↔ VO」往返（0 LLM token）
   *
   * 🔴 为什么非走浏览器不可：curl 差分已证后端 create/get 对 tool_keys 的持久化+规范化+发布期只读校验，
   * 但「多选控件绑逗号串」这条前端适配（selectedTools computed get/set + loadDef 回填 toolKeys）只在真实 DOM 里暴露。
   * 判据：新建时选一个只读工具 → 保存草稿 → 重新编辑 → 该工具仍选中 → 删草稿清理。
   */
  test('工具多选绑定 → 保存 → 重新编辑仍选中（toolKeys 往返，0 token）', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/def')
    await expect(page.getByText('编码').first()).toBeVisible({ timeout: 20000 })

    const CODE3 = `e2e_tool_${Date.now().toString().slice(-8)}`
    await page.getByRole('button', { name: '新增', exact: true }).first().click()
    await page.waitForURL(/\/agent-def\/editor/)

    await page.getByPlaceholder('请输入名称，如「订单客服」').fill('E2E 工具助手')
    await page
      .getByPlaceholder('小写字母开头，仅含小写字母/数字/下划线，如 order_assistant')
      .fill(CODE3)
    await page.locator('[data-testid="agent-persona"]').fill('你是工具往返测试助手。')

    // 绑定一个只读工具：下拉只列【声明】风险为只读（declaredRequireConfirm===false）的工具，
    // 故 data_interface_list 必在列。（D4-22：此前过滤的是生效值 requireConfirm，见文件末那条用例）
    // 🔴 这版 Element Plus 的多选把 .el-select__placeholder 盖在 input 上，直接点 input 会被「拦截指针事件」；
    //    改点 .el-select 容器开菜单，再对 filter input 用 fill 触发过滤
    const toolCard = page.locator('.el-card').filter({ hasText: '工具（只读）' }).first()
    await toolCard.locator('.el-select').first().click()
    await toolCard.locator('input').first().fill('data_interface_list')
    const option = page
      .locator('.el-select-dropdown__item:visible')
      .filter({ hasText: 'data_interface_list' })
      .first()
    await expect(option).toBeVisible({ timeout: 10000 })
    await option.click()
    // 选中后控件内出现该工具的 tag（证明 set 把数组写进了 formData.toolKeys）
    await expect(
      toolCard.locator('.el-tag').filter({ hasText: 'data_interface_list' }).first()
    ).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: /保存草稿/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: '新建成功' }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page).toHaveURL(/\/agent-def\/editor\?id=\d+/)

    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(/\/agent\/def$/)

    // 重新打开编辑：工具应仍选中（证明 loadDef 回填了 toolKeys，往返无丢失）
    const row = page.locator('.el-table__body tr').filter({ hasText: CODE3 }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: '编辑' }).first().click()
    await page.waitForURL(/\/agent-def\/editor\?id=\d+/)
    const editToolCard = page.locator('.el-card').filter({ hasText: '工具（只读）' }).first()
    await expect(
      editToolCard.locator('.el-tag').filter({ hasText: 'data_interface_list' }).first()
    ).toBeVisible({ timeout: 15000 })

    // 清理：返回列表 + 删除草稿
    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(/\/agent\/def$/)
    await row.getByRole('button', { name: '删除' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /删除成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: CODE3 })).toHaveCount(0, {
      timeout: 15000
    })
  })

  /**
   * 需求10：系统内置的「默认平台助手」出现在智能体列表里，可就地维护，但不给删除/停用/派生。
   *
   * 🔴 为什么单开一条用例：内置行的状态是「已发布」，正好撞上 handleEdit 的「已发布 → 先派生新草稿」分支，
   * 全靠 `row.builtin` 短路。短路一旦漏掉，用户点「编辑」会被问「要不要派生 v2」，而派生出的 v2 不是内置行、
   * 改了根本不会被聊天入口读到——这就是平台头号反模式「保存成功但不生效」的又一副面孔。
   * 后端另有 AGENT_DEF_BUILTIN_READONLY(1_041_008_005) 兜底，但按钮就不该出现。
   */
  test('需求10：系统内置行可就地编辑，且无删除/停用/派生入口', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/def')

    await searchByCode(page, BUILTIN_CODE)
    const row = page.locator('.el-table__body tr').filter({ hasText: BUILTIN_CODE }).first()
    // 列序号含首列的批量删除勾选列（2026-09-29 需求9 新增），整体比业务列偏移 1
    const builtinId = (await row.locator('td:nth-child(3)').innerText()).trim()

    // 打标 + 状态：它是「已发布」，但额外挂一枚「系统内置」danger 标
    // 🔴 必须按列取：内置行的【描述】正文本身就以「系统内置：…」开头，
    //    直接 row.getByText('系统内置') 会同时命中标签和描述两个节点（strict mode 违规）
    const statusCell = row.locator('td:nth-child(7)')
    await expect(statusCell.locator('.el-tag').filter({ hasText: '系统内置' })).toBeVisible({
      timeout: 15000
    })
    await expect(statusCell.locator('.el-tag').filter({ hasText: '已发布' })).toBeVisible()
    await expect(row.locator('td:nth-child(5)')).toHaveText('默认平台助手')

    // 就地维护的三个入口都在
    for (const name of ['查看', '编辑', '复制']) {
      await expect(row.getByRole('button', { name })).toBeVisible()
    }
    // 状态机入口一个都不给：内置行不可发布/停用/删除
    for (const name of ['发布', '停用', '删除']) {
      await expect(row.getByRole('button', { name })).toHaveCount(0)
    }

    // 编辑 → 直接进整页设计器（同一 id、非只读态），不弹「派生新版本」确认框
    await row.getByRole('button', { name: '编辑' }).click()
    await page.waitForURL(/\/agent-def\/editor\?id=\d+/)
    await expect(page.locator('.el-message-box')).toHaveCount(0)
    expect(page.url(), '内置行编辑必须落在原行上，不能派生出新 id').toContain(`id=${builtinId}`)
    await expect(page).not.toHaveURL(/mode=view/)
    await expect(page.getByPlaceholder('请输入名称，如「订单客服」')).toBeEnabled()

    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(/\/agent\/def$/)
  })

  /**
   * 需求11：「编辑」已发布行 = 派生同 code 的 v2 草稿；「复制」= 换 code 的另一个 v1 草稿。
   *
   * 🔴 两者极易混淆，混淆的后果很实在：派生沿用同 code（同一 Agent 的新版本，历史对话仍走 v1），
   * 复制换 code（另一个 Agent 从 v1 起）。若把复制实现成派生，副本会挂在别人名下当 v(n+1)；
   * 若把派生实现成就地改，按 v1 路由的历史对话与新对话会拿到两份不同人设。
   * 本用例把两条路的 id / code / version / status 全部钉死，并验证人设确实被搬过去了。
   */
  test('需求11：已发布行编辑派生 v2 草稿 + 复制成新编码草稿', async ({ page }) => {
    test.setTimeout(300_000)
    await login(page)
    await gotoWithAuth(page, '/ai/agent/def')
    await expect(page.getByText('编码').first()).toBeVisible({ timeout: 20000 })

    const CODE_V = `e2e_ver_${Date.now().toString().slice(-8)}`
    const CODE_COPY = `${CODE_V}_copy` // openCopyDialog 的默认预填值，直接沿用即可（也顺带验证预填能过校验）
    const PERSONA = '你是派生/复制测试助手，请只回答「收到」。'

    await createDraftViaUi(page, CODE_V, '派生源助手', PERSONA)
    await searchByCode(page, CODE_V)
    const row = page.locator('.el-table__body tr').filter({ hasText: CODE_V }).first()
    const originId = (await row.locator('td:nth-child(3)').innerText()).trim()

    // ---------- 发布，把它变成「不可就地改」的状态 ----------
    await row.getByRole('button', { name: '发布' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /发布成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(row.getByText('已发布')).toBeVisible({ timeout: 15000 })

    // ---------- 编辑 → 派生 v2 草稿 ----------
    await row.getByRole('button', { name: '编辑' }).first().click()
    await expect(page.locator('.el-message-box')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.el-message-box')).toContainText(
      '将基于它派生一个新草稿版本（同编码、版本 v2），原版本保持不变'
    )
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /已派生新草稿 v2/ }).first()).toBeVisible({
      timeout: 15000
    })
    await page.waitForURL(/\/agent-def\/editor\?id=(\d+)/)
    const derivedId = new URL(page.url()).searchParams.get('id')
    expect(derivedId, '派生必须落在新 id 上，不能就地改已发布行').not.toBe(originId)

    // 派生要把人设整份搬过来，否则「派生成功但编辑器是空的」= 白派生
    await expect(page.locator('[data-testid="agent-persona"]')).toHaveValue(/派生\/复制测试助手/, {
      timeout: 20000
    })
    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(/\/agent\/def$/)

    // 同 code 两行：v1 已发布（原行未被动过）+ v2 草稿（派生出的新行）
    await searchByCode(page, CODE_V)
    const sameCode = page.locator('.el-table__body tr').filter({ hasText: CODE_V })
    await expect(sameCode).toHaveCount(2, { timeout: 20000 })
    const v1 = sameCode.filter({ hasText: '已发布' }).first()
    const v2 = sameCode.filter({ hasText: '草稿' }).first()
    await expect(v1.locator('td:nth-child(6)')).toHaveText('1')
    await expect(v2.locator('td:nth-child(6)')).toHaveText('2')
    expect((await v2.locator('td:nth-child(3)').innerText()).trim()).toBe(derivedId)

    // ---------- 复制 → 换 code 的 v1 草稿 ----------
    await v1.getByRole('button', { name: '复制' }).first().click()
    const dialog = page.locator('.el-dialog:visible').filter({ hasText: '复制智能体' })
    await expect(dialog).toBeVisible({ timeout: 15000 })
    await expect(dialog.locator('.el-dialog__title')).toHaveText('复制智能体')
    await expect(dialog).toContainText('将复制成一个独立的新智能体（草稿）')
    await expect(dialog).toContainText(`派生源助手（${CODE_V} v1）`)
    // 预填：编码 = 源编码_copy，名称 = 源名称（副本）——「连点确定」这条路也必须走得通
    await expect(
      dialog.locator('input[placeholder="小写字母开头，仅含小写字母/数字/下划线"]')
    ).toHaveValue(CODE_COPY)
    await expect(dialog.locator('input[placeholder="请输入名称"]')).toHaveValue('派生源助手（副本）')
    await dialog.getByRole('button', { name: '确定' }).click()
    await expect(
      page.locator('.el-message').filter({ hasText: /复制成功/ }).first()
    ).toBeVisible({ timeout: 15000 })
    await page.waitForURL(/\/agent-def\/editor\?id=\d+/)
    const copiedId = new URL(page.url()).searchParams.get('id')
    expect(copiedId, '复制必须新建一行').not.toBe(originId)
    expect(copiedId).not.toBe(derivedId)
    await expect(page.getByPlaceholder('请输入名称，如「订单客服」')).toHaveValue('派生源助手（副本）', {
      timeout: 20000
    })
    await page.locator('button[title="返回列表"]').click()
    await page.waitForURL(/\/agent\/def$/)

    // 编码是 like 匹配，副本也在同一搜索结果里：v1 已发布 + v2 草稿 + 副本 v1 草稿
    await searchByCode(page, CODE_V)
    await expect(page.locator('.el-table__body tr').filter({ hasText: CODE_V })).toHaveCount(3, {
      timeout: 20000
    })
    const copiedRow = page.locator('.el-table__body tr').filter({ hasText: CODE_COPY }).first()
    await expect(copiedRow.locator('td:nth-child(6)')).toHaveText('1')
    await expect(copiedRow.getByText('草稿')).toBeVisible()
    // 副本不是内置行、也不是已发布行，故删除按钮在
    await expect(copiedRow.getByRole('button', { name: '删除' })).toBeVisible()

    // ---------- 清理：两个草稿直接删；已发布的 v1 必须先停用 ----------
    const drafts = () =>
      page.locator('.el-table__body tr').filter({ hasText: CODE_V }).filter({ hasText: '草稿' })
    for (const left of [1, 0]) {
      const r = drafts().first()
      await expect(r).toBeVisible({ timeout: 15000 })
      await r.getByRole('button', { name: '删除' }).first().click()
      await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
      await expect(drafts()).toHaveCount(left, { timeout: 15000 })
    }

    // 已发布行不渲染删除按钮（后端另有 AGENT_DEF_PUBLISHED_NOT_DELETABLE 兜底）
    const published = page
      .locator('.el-table__body tr')
      .filter({ hasText: CODE_V })
      .filter({ hasText: '已发布' })
      .first()
    await expect(published).toBeVisible({ timeout: 15000 })
    await expect(published.getByRole('button', { name: '删除' })).toHaveCount(0)
    await published.getByRole('button', { name: '停用' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /停用成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    // 停用后删除按钮出现（需求11：草稿 + 已停用可删）
    const disabled = page.locator('.el-table__body tr').filter({ hasText: CODE_V }).first()
    await expect(disabled.getByText('已停用')).toBeVisible({ timeout: 15000 })
    await disabled.getByRole('button', { name: '删除' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-table__body tr').filter({ hasText: CODE_V })).toHaveCount(0, {
      timeout: 15000
    })
  })
})

/**
 * 🔴 D4-22：「工具（只读）」下拉的过滤必须读【声明】风险，不是生效风险
 *
 * 背景：迭代三把运行期各道闸全部改读 `getDeclaredRisk()`（`AgentDefServiceImpl.validateToolKeys`、
 * `WorkflowDslValidator` V3/V11、`AgentLoopGraphBuilder` 两道只读闸、沙箱 mock、发布判定），
 * 而工具管理页的「降险」改的是**生效值**。此前 `def/editor/index.vue` 按生效值 `requireConfirm`
 * 过滤下拉，于是：管理员把 `datamodel_create`（声明 IRREVERSIBLE）降成只读 → 它出现在「只读工具」
 * 下拉里 → 能选中、能存草稿 → 后端按声明值把它拒掉。界面不是没帮上忙，是**主动指了反方向**。
 *
 * 🔴 为什么非要走浏览器：后端那一半（`declaredRisk` 有没有下发）用 curl 就能验，
 *    但「下拉里到底有没有这一项」是 `Array.filter` 加 `el-select` 远程过滤的合力，
 *    接口层完全看不见。而这类缺陷的表现恰好是本平台头号反模式：配置能存、点发布才炸。
 *
 * 🔴 全程 0 LLM token：只开设计器、开下拉、看选项，不保存、不发布、不聊天。
 * 🔴 数据自净用 try/finally：这条用例会**真的**给 `datamodel_create` 落一条降险覆盖行。
 *    断言中途失败也不能把它留在开发库里 —— 那不是探针，那是一次没人知道的安全放松。
 */
test.describe('智能体设计器 · 工具下拉的只读过滤（D4-22）', () => {
  test.setTimeout(180_000)

  const TARGET = 'datamodel_create'
  /** 真只读工具，用来做「反空转」对照：下拉整个坏了也能让 TARGET 那条断言通过 */
  const READONLY_CONTROL = 'data_interface_list'

  test('降过险的写工具仍不进「只读」下拉；同下拉里真只读工具照样在', async ({ page, request }) => {
    const token = await apiLogin(request)
    const headers = apiHeaders(token)

    const readTarget = async () => {
      const resp = await request.get(`${API_BASE_URL}/agent/tool-def/registered-list`, { headers })
      expect(resp.ok(), 'registered-list 应可读').toBeTruthy()
      const body = await resp.json()
      const hit = (body.data || []).find((t: any) => t.toolName === TARGET)
      expect(hit, `应能在内置工具里找到 ${TARGET}`).toBeTruthy()
      return hit
    }

    const before = await readTarget()
    // 前提自检：这条用例的全部意义建立在「TARGET 的声明风险是写操作」之上
    expect(before.declaredRiskLevel, `${TARGET} 的声明风险应为 IRREVERSIBLE，否则本用例前提没了`).toBe(
      'IRREVERSIBLE'
    )

    const relax = await request.put(`${API_BASE_URL}/agent/tool-def/registered-update`, {
      headers,
      data: {
        toolName: TARGET,
        // 🔴 registered-update 是【整份提交】：permissions 传 null 会被后端当成「删空代码权限」
        //    （= 调用只需登录），那是货真价实的安全放松。探针只想改风险，故把生效值原样回填。
        displayName: before.displayName,
        description: before.description,
        groupName: before.groupName,
        permissions: before.permissions,
        paramsSchema: before.paramsSchema,
        enabled: true,
        riskLevel: 'READ_ONLY',
        // B1 之后降险必须显式表态，否则后端直接拒（错误码 1_041_009_001）且什么都不落库
        confirmRelax: true,
        remark: 'e2e-D4-22-探针-非真实放松'
      }
    })
    expect(relax.ok(), `降险应成功（已带 confirmRelax），实际 ${relax.status()}`).toBeTruthy()

    try {
      // 降险确实生效了：生效风险已是只读、生效 requireConfirm 已翻成 false
      const after = await readTarget()
      expect(after.riskLevel, '生效风险应已被降成 READ_ONLY').toBe('READ_ONLY')
      expect(after.requireConfirm, '生效 requireConfirm 应已翻成 false').toBe(false)
      // 而声明值一动不动 —— 后端闸门读的就是它
      expect(after.declaredRiskLevel, '声明风险不该被在线维护改动').toBe('IRREVERSIBLE')
      // 🔴 这里刻意【不】断言 declaredRequireConfirm：/registered-list 没有这个字段，
      //    写 `after.declaredRequireConfirm ?? true` 只会得到一条恒真的假断言。
      //    「声明口径仍需确认」由后端 RiskLevel.IRREVERSIBLE.isRequireConfirm() 保证，
      //    并已被 AgentNameCatalogServiceTest 的三条用例钉住。
      expect(after.permissions, '探针只改风险，权限串不该被动过').toBe(before.permissions)

      await login(page)
      await gotoWithAuth(page, '/ai/agent/def')
      await expect(page.getByText('编码').first()).toBeVisible({ timeout: 20000 })
      await page.getByRole('button', { name: '新增', exact: true }).first().click()
      await page.waitForURL(/\/agent-def\/editor/)

      const toolCard = page.locator('.el-card').filter({ hasText: '工具（只读）' }).first()
      await expect(toolCard).toBeVisible({ timeout: 20000 })
      await toolCard.locator('.el-select').first().click()

      // ---------- 反空转对照：真只读工具必须还在，否则下面那条「查不到」可能只是下拉整个坏了 ----------
      await toolCard.locator('input').first().fill(READONLY_CONTROL)
      await expect(
        page.locator('.el-select-dropdown__item:visible').filter({ hasText: READONLY_CONTROL }).first()
      ).toBeVisible({ timeout: 15000 })

      // ---------- 核心断言：降过险的写工具【不该】出现在只读下拉里 ----------
      await toolCard.locator('input').first().fill(TARGET)
      await expect
        .poll(
          async () =>
            await page.locator('.el-select-dropdown__item:visible').filter({ hasText: TARGET }).count(),
          {
            timeout: 10000,
            message:
              `${TARGET} 的生效风险已被降成只读，但声明风险仍是 IRREVERSIBLE；` +
              '后端 validateToolKeys 按声明值拒它，故下拉里不该出现这一项'
          }
        )
        .toBe(0)
    } finally {
      // 恢复默认 = 删覆盖行。放在 finally：断言失败也必须把这次放松撤掉
      const reset = await request.delete(
        `${API_BASE_URL}/agent/tool-def/registered-reset?toolName=${encodeURIComponent(TARGET)}`,
        { headers }
      )
      expect(reset.ok(), `恢复默认应成功，实际 ${reset.status()}`).toBeTruthy()
      const restored = await readTarget()
      expect(restored.riskLevel, '恢复默认后生效风险应退回声明值').toBe('IRREVERSIBLE')
      expect(restored.overridden, '恢复默认后不该再有覆盖行').toBe(false)
    }
  })
})
