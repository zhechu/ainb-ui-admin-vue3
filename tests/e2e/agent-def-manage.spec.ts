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
 * 本 spec 全程通过 UI 自建数据（不预播种），用时间戳保证 code 唯一。
 * 🔴 每条用例**自己清掉自己造的行**（草稿直接删，已发布/已停用先停用再删）——
 *    谁造谁清才扛得住 `-g` 单跑：只跑其中一条时，库里也不该多出探针数据。
 */

const CODE = `e2e_def_${Date.now().toString().slice(-8)}`

/** 需求10 种子数据：系统内置的「默认平台助手」（xpy-2026-09-29-agent-def-builtin-platform-assistant.sql） */
const BUILTIN_CODE = 'platform_assistant'

/**
 * 按编码把列表收敛到本用例关心的行。
 *
 * 🔴 不能省：列表是**同租户所有人共用**的一份（不是本 spec 私有的），行数随别人建的数据、
 * 以及历次探针没清干净的残留一起涨。只靠 `filter({hasText: CODE})` 断言，一旦新行被排到第 2 页
 * 就会「查不到」，看起来像功能坏了，实际是分页。搜索后行数确定，断言才有意义。
 * （这里刻意不写「当前有 N 条」：那个数会烂，而理由不会。）
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

    // ---------- 清理：把本用例造的这一行带走 ----------
    // 🔴 这段不是断言，是**还债**。文件头一直承诺「跑完自清理」，但本用例造的行走到最后是
    //    「已停用」——既不是草稿，也没人删它；下一条用例名叫「清理本 spec 造的数据」，
    //    删的却是它自己另造的 CODE2。于是每跑一次就在开发库里留一行 e2e_def_*，
    //    多跑几轮就把真数据淹在探针数据里（§3.6 第 19 条：残留非空即本轮失败）。
    //    已停用行本就可删（需求11），且「删除按钮在停用后出现」已被第五条用例断言过，
    //    故这里只清数据、不再重复钉行为。
    await searchByCode(page, CODE)
    const leftover = page.locator('.el-table__body tr').filter({ hasText: CODE }).first()
    await leftover.getByRole('button', { name: '删除' }).first().click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(page.locator('.el-message').filter({ hasText: /删除成功/ }).first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.locator('.el-table__body tr').filter({ hasText: CODE })).toHaveCount(0, {
      timeout: 15000
    })
  })

  // 🔴 名字原来叫「草稿可删除（清理本 spec 造的数据）」——后半句是假的：它删的是自己现造的
  //    CODE2，第一条用例留下的 CODE 一行都没碰。改名的同时把那份债挪回欠它的人头上。
  test('草稿可删除（自己造的自己删）', async ({ page }) => {
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

/**
 * 🔴 D4-25：已绑定的只读工具被管理员**停用**之后，界面上此前一丝痕迹都没有
 *
 * 缺陷链条（三段都核过源码）：
 *   ① `def/editor/index.vue` 的下拉只按【声明风险】过滤（D4-22 修的），**从不看 `enabled`** ⟹
 *      停用的工具此前是**正常可挑**的候选，界面上与启用的一模一样；
 *   ② 后端 `AgentDefServiceImpl.validateToolKeys` 也只查「有没有登记」+「声明风险是不是只读」，
 *      **同样不看 enabled** ⟹ 保存、发布一路绿灯；
 *   ③ 真炸的地方在运行期：`AgentSecurityGateway#checkTool` 读 `tool.isEnabled()`，
 *      抛 `AGENT_TOOL_DISABLED`（「AI 助手工具({})已被停用」）—— 用户每次问话都失败，
 *      而配置页上什么都看不出来。这就是本模块头号反模式「配了不生效且无提示」的教科书形态。
 *
 * 修法（本次）：候选行置灰 + 挂原因（`el-option` 的 disabled 是真挑不动，不只是画个灰色），
 * 且**不把它从列表里滤掉** —— 存量已绑定的键还得显示得出中文名，否则 Element Plus 的 `getOption`
 * 会回落成裸机器键；再在表单里就地报一句警，把「解绑 / 去工具管理重新启用」两条出路写在同一句里。
 * 🔴 后端那半（发布期硬拒停用工具）**刻意没做**：它会让「管理员停用某个工具」之后，
 *    所有绑了它的 Agent 连**无关的**改动都发布不了。那是产品决策，等裁定，不夹带在这一刀里。
 *
 * 🔴 为什么非要走浏览器：`enabled` 有没有下发用 curl 就能验，但「灰没灰、挑不挑得动、
 *    那句警告出没出来、标签还是不是中文名」四件事全在 DOM 里，接口层一件都看不见。
 * 🔴 时序刻意按真实事故排：**先绑定、后停用**。反过来（先停用再试着绑）验不到存量那一半，
 *    而存量才是这条缺陷真正咬人的地方。
 * 🔴 0 LLM token：保存草稿与发布都不调模型，全程只动 DOM 与两个管理接口。
 * 🔴 数据自净用 try/finally，两笔都要还：给 `data_interface_list` 落的**停用覆盖行**
 *    （不还的话整条 e2e 队列里所有依赖它的用例全废），以及本用例新建的**草稿 def**。
 */
test.describe('智能体设计器 · 停用工具的置灰与就地警告（D4-25）', () => {
  test.setTimeout(240_000)

  /** 被停用的目标：声明只读、代码默认启用，停用它不影响任何写路径 */
  const TARGET = 'data_interface_list'
  /** 对照工具：同样声明只读但**不**停用。没有它，「TARGET 挑不动」可能只是整个下拉坏了 */
  const CONTROL = 'form_list'
  const CODE = `e2e_dis_${Date.now().toString().slice(-8)}`
  const CODE_PLACEHOLDER =
    '小写字母开头，仅含小写字母/数字/下划线，如 order_assistant'

  test('先绑定后停用 ⟹ 就地报警 + 标签仍是中文名 + 候选置灰挑不动（对照工具照旧可挑）', async ({
    page,
    request
  }) => {
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
    // 前提自检：这条用例的全部意义建立在「TARGET 声明只读、当前启用、没有存量覆盖行」之上
    expect(before.declaredRiskLevel, `${TARGET} 应为声明只读，否则它压根不在下拉里`).toBe('READ_ONLY')
    expect(before.enabled, `${TARGET} 应为启用态，否则「先绑定」这一步就假了`).toBe(true)
    expect(before.overridden, `${TARGET} 不该有存量覆盖行，否则 finally 的「恢复默认」会抹掉别人的维护`).toBe(
      false
    )

    let defId = ''
    try {
      // ---------- ① 趁它还启用，用 UI 建草稿并真绑定它 ----------
      await login(page)
      await gotoWithAuth(page, '/ai/agent/def')
      await expect(page.getByText('编码').first()).toBeVisible({ timeout: 20000 })
      await page.getByRole('button', { name: '新增', exact: true }).first().click()
      await page.waitForURL(/\/agent-def\/editor/)

      await page.getByPlaceholder('请输入名称，如「订单客服」').fill('E2E 停用工具助手')
      await page.getByPlaceholder(CODE_PLACEHOLDER).fill(CODE)
      await page.locator('[data-testid="agent-persona"]').fill('用于验证工具被停用后的界面提示。')

      const toolCard = page.locator('.el-card').filter({ hasText: '工具（只读）' }).first()
      await expect(toolCard).toBeVisible({ timeout: 20000 })
      // 🔴 多选控件的 .el-select__placeholder 盖在 input 上，直接点 input 会被拦指针事件：
      //    先点容器开菜单，再对 filter input 用 fill 触发过滤（与本文件第 3 条用例同款处置）
      await toolCard.locator('.el-select').first().click()
      await toolCard.locator('input').first().fill(TARGET)
      const targetOpt = page
        .locator('.el-select-dropdown__item:visible')
        .filter({ hasText: TARGET })
        .first()
      await expect(targetOpt).toBeVisible({ timeout: 15000 })
      // 停用之前它必须是**可挑的**，否则下面所有断言都在验一个压根没发生的场景
      await expect(targetOpt).not.toHaveClass(/is-disabled/)
      await expect(toolCard.locator('[data-testid="tool-disabled-warning"]')).toHaveCount(0)
      await targetOpt.click()
      await expect(
        toolCard.locator('.el-tag').filter({ hasText: TARGET }).first()
      ).toBeVisible({ timeout: 10000 })

      await page.getByRole('button', { name: /保存草稿/ }).click()
      await expect(page.locator('.el-message').filter({ hasText: '新建成功' }).first()).toBeVisible({
        timeout: 15000
      })
      await expect(page).toHaveURL(/\/agent-def\/editor\?id=\d+/)
      defId = new URL(page.url()).searchParams.get('id') || ''
      expect(defId, 'URL 上应带出新草稿的 id').toBeTruthy()

      // ---------- ② 管理员把它停用 ----------
      // 🔴 registered-update 是【整份提交】：其余字段一律原样回填生效值。
      //    少回填 permissions 会被后端当成「删空代码权限」= 一次货真价实的安全放松（D4-22 那条同款坑）。
      //    停用是**收紧**不是放松，故不需要 confirmRelax。
      const disable = await request.put(`${API_BASE_URL}/agent/tool-def/registered-update`, {
        headers,
        data: {
          toolName: TARGET,
          displayName: before.displayName,
          description: before.description,
          groupName: before.groupName,
          permissions: before.permissions,
          paramsSchema: before.paramsSchema,
          riskLevel: before.riskLevel,
          enabled: false,
          remark: 'e2e-D4-25-探针-非真实停用'
        }
      })
      expect(disable.ok(), `停用应成功，实际 ${disable.status()}`).toBeTruthy()
      const after = await readTarget()
      expect(after.enabled, '停用应已生效').toBe(false)
      expect(after.declaredEnabled, '声明值不该被在线维护改动').toBe(true)
      expect(after.permissions, '探针只改启用位，权限串不该被动过').toBe(before.permissions)

      // ---------- ③ 重新打开这份草稿（= 用户第二天回来改点别的） ----------
      // 🔴 必须 reload：loadTools 有 `if (toolList.value.length > 0) return` 的内存缓存，
      //    不重载读到的还是停用前的目录，那就成了自己给自己造的假绿。
      await page.reload()
      await page.waitForURL(/\/agent-def\/editor\?id=\d+/)
      const card2 = page.locator('.el-card').filter({ hasText: '工具（只读）' }).first()
      await expect(card2).toBeVisible({ timeout: 20000 })

      // (a) 标签仍是「中文名（机器键）」，没退化成裸机器键
      const tag = card2.locator('.el-tag').filter({ hasText: TARGET }).first()
      await expect(tag).toBeVisible({ timeout: 15000 })
      await expect(tag).toContainText(before.displayName)

      // (b) 表单里就地报警：说清「不会拦你」+「运行期会被网关拒」+ 两条出路
      const warning = card2.locator('[data-testid="tool-disabled-warning"]')
      await expect(warning).toBeVisible({ timeout: 15000 })
      const warningText = (await warning.innerText()).replace(/\s+/g, '')
      expect(warningText, '警告应点名被停用的工具').toContain(before.displayName)
      expect(warningText, '警告应说清「保存/发布不拦」，否则用户以为界面会兜住').toContain(
        '保存和发布都不会拦你'
      )
      expect(warningText, '警告应说清运行期的真实后果与安全网关').toContain('安全网关')
      expect(warningText, '警告应原样引用后端错误码文案（红线：不替 error 编病因）').toContain(
        '已被停用'
      )
      expect(warningText, '警告必须给出路：解绑').toContain('移除')
      expect(warningText, '警告必须给出路：去工具管理重新启用').toContain('工具管理')

      // (c) 下拉里它置灰、挂原因、且真挑不动
      await card2.locator('.el-select').first().click()
      await card2.locator('input').first().fill(TARGET)
      const blockedOpt = page
        .locator('.el-select-dropdown__item:visible')
        .filter({ hasText: TARGET })
        .first()
      await expect(blockedOpt).toBeVisible({ timeout: 15000 })
      await expect(blockedOpt).toHaveClass(/is-disabled/)
      await expect(blockedOpt.locator('[data-testid="tool-option-block"]')).toHaveText('已停用')
      await expect(blockedOpt).toHaveAttribute('title', /已被停用，不能再绑定/)
      await expect(blockedOpt).toHaveAttribute('title', new RegExp(TARGET))
      // 强点也挑不进去：绑定数仍是 1（disabled 不是「画个灰色」，是真拦）
      await blockedOpt.click({ force: true })
      await expect(card2.locator('.el-tag').filter({ hasText: CONTROL })).toHaveCount(0)
      await expect(card2.locator('.el-select .el-tag')).toHaveCount(1)

      // (d) 反空转对照：同下拉里没被停用的只读工具照样可挑
      await card2.locator('input').first().fill(CONTROL)
      const controlOpt = page
        .locator('.el-select-dropdown__item:visible')
        .filter({ hasText: CONTROL })
        .first()
      await expect(controlOpt).toBeVisible({ timeout: 15000 })
      await expect(controlOpt).not.toHaveClass(/is-disabled/)
      await expect(controlOpt.locator('[data-testid="tool-option-block"]')).toHaveCount(0)
      await controlOpt.click()
      // 🔴 这里**不能**按文字找 CONTROL 的 tag：控件开着 `collapse-tags`（maxCollapseTags=1），
      //    选中第 2 个之后 DOM 里只有「第 1 个 tag + 一个折叠 tag」，折叠 tag 的文本由
      //    Element Plus 的 select2.mjs 拼成 `" + " + (selected.length - maxCollapseTags)`，
      //    CONTROL 的名字被折进 tooltip 里了（第一次跑就是在这里假红：element(s) not found）。
      //    故改数 tag 个数 + 认那个 `+ 1`，同样能证明「点得进去」。
      await expect(card2.locator('.el-select .el-tag')).toHaveCount(2, { timeout: 10000 })
      await expect(card2.locator('.el-select .el-tag').last()).toContainText(/\+\s*1/)
      // 第 1 个 tag 仍是 TARGET，且仍是中文名（折叠不改首个 tag 的 label）
      await expect(card2.locator('.el-select .el-tag').first()).toContainText(before.displayName)
    } finally {
      // ---------- 还债 1：撤掉停用覆盖行 ----------
      // 放在 finally 且在删草稿之前：这行不还，后面所有依赖 data_interface_list 的用例全废
      const reset = await request.delete(
        `${API_BASE_URL}/agent/tool-def/registered-reset?toolName=${encodeURIComponent(TARGET)}`,
        { headers }
      )
      expect(reset.ok(), `恢复默认应成功，实际 ${reset.status()}`).toBeTruthy()
      const restored = await readTarget()
      expect(restored.enabled, '恢复默认后应退回启用').toBe(true)
      expect(restored.overridden, '恢复默认后不该再有覆盖行').toBe(false)

      // ---------- 还债 2：删掉本用例造的草稿 ----------
      if (defId) {
        const del = await request.delete(`${API_BASE_URL}/agent/def/delete?id=${defId}`, { headers })
        expect(del.ok(), `删草稿应成功，实际 ${del.status()}`).toBeTruthy()
        const delBody = await del.json()
        expect(delBody.code, `删草稿应返回 code=0，实际 ${JSON.stringify(delBody)}`).toBe(0)
      }
    }
  })
})

/**
 * 🔴 D4-25 后端半（2026-10-05 裁定：**警告，不硬拒**）的界面那侧 —— 列表页发布确认框
 *
 * <h3>为什么上一条用例（编辑器里的就地警告）盖不住这一条</h3>
 * 编辑器那句 `disabledBoundWarning` 只有**打开编辑器**才看得见。而发布绝大多数时候是在
 * **列表页直接点「发布」**完成的 —— 那条路径此前一个字都不说：管理员点完看到「发布成功」，
 * 用户聊天时每次调工具都被安全网关拒，两边都以为对方是好的。
 * 后端 `publishDefById` 同一时刻会落一条 WARN，但日志不是给点按钮的人看的。
 *
 * <h3>🔴 这条用例真正要钉的是「警告 ≠ 拦截」</h3>
 * 裁定选的是警告而不是 error，理由是：停用是「工具管理」页的动作，与本 Agent 的配置无关；
 * 硬拒会让绑了它的 Agent **连改人设、换模型这类无关改动都发布不了**，
 * 而 `validateToolKeys` 只在 `publishDefById` 里被调（create/update 只过 normalizeToolKeys），
 * 于是「重新发布」这个恢复动作会一起被堵死 —— 正好与 `publishDefById` 里
 * 「DISABLED 也放行（重新上线）」的取舍直接打架。
 * 所以本用例**真的点了「确定」并断言发布成功**：只弹框后取消的话，「不拦」这半边一点没验到，
 * 一个把警告写成 error 的实现照样能绿。
 *
 * 🔴 0 LLM token：建草稿、发布、停用、删全走管理接口与 DOM，一次模型都不调。
 * 🔴 草稿用 **API** 建而不是走编辑器 UI：被测对象是列表页那个确认框，
 *    编辑器那条路径上一条用例已经验过了，这里再走一遍只是把 4 分钟拉长到 8 分钟。
 * 🔴 时序仍按真实事故排：**先绑定、后停用**（反过来验不到存量那一半）。
 * 🔴 步骤③ 之前必须 **reload**：`toolCatalog` 有「一次页面生命周期只拉一次」的内存缓存，
 *    不重载读到的还是停用前的目录 —— 那就成了自己给自己造的假绿（与上一条用例同款坑）。
 * 🔴 数据自净用 try/finally，两笔都要还：给 `data_interface_list` 落的**停用覆盖行**
 *    （不还的话整条 e2e 队列里所有依赖它的用例全废），以及本用例**已发布**的 def
 *    （已发布不可直删，要先停用再删）。
 */
test.describe('智能体列表页 · 发布确认框里的停用工具警告（D4-25 后端半）', () => {
  test.setTimeout(240_000)

  /** 被停用的目标：声明只读、代码默认启用，停用它不影响任何写路径 */
  const TARGET = 'data_interface_list'
  /** 对照工具：同样绑定、但**不**停用。没有它就断不出「警告只点名真停用的那个」 */
  const CONTROL = 'form_list'
  const CODE = `e2e_pubwarn_${Date.now().toString().slice(-8)}`

  test('先绑定后停用 ⟹ 确认框点名停用项、不点名对照项，且点确定照样发布成功', async ({
    page,
    request
  }) => {
    const token = await apiLogin(request)
    const headers = apiHeaders(token)

    const readTool = async (name: string) => {
      const resp = await request.get(`${API_BASE_URL}/agent/tool-def/registered-list`, { headers })
      expect(resp.ok(), 'registered-list 应可读').toBeTruthy()
      const body = await resp.json()
      const hit = (body.data || []).find((t: any) => t.toolName === name)
      expect(hit, `应能在内置工具里找到 ${name}`).toBeTruthy()
      return hit
    }

    const target0 = await readTool(TARGET)
    const control0 = await readTool(CONTROL)
    // 前提自检：本用例的全部意义建立在「TARGET 声明只读、当前启用、没有存量覆盖行」之上
    expect(target0.declaredRiskLevel, `${TARGET} 应为声明只读，否则它压根绑不进 Agent`).toBe('READ_ONLY')
    expect(target0.enabled, `${TARGET} 应为启用态，否则「先绑定」这一步就假了`).toBe(true)
    expect(
      target0.overridden,
      `${TARGET} 不该有存量覆盖行，否则 finally 的「恢复默认」会抹掉别人的维护`
    ).toBe(false)
    expect(control0.enabled, `${CONTROL} 作为对照必须处于启用态`).toBe(true)

    /** 打开列表页并搜到本用例那一行（🔴 必须先搜：列表是同租户共用的，不搜会被分页挤走） */
    const openRow = async () => {
      await gotoWithAuth(page, '/ai/agent/def')
      await searchByCode(page, CODE)
      const row = page.locator('.el-table__body tr').filter({ hasText: CODE }).first()
      await expect(row, `列表里应搜到 ${CODE} 的行`).toBeVisible({ timeout: 20000 })
      return row
    }

    /** 点「发布」拿到确认框，并把正文压成无空白串（Element Plus 会按容器宽度折行） */
    const openPublishConfirm = async () => {
      const row = await openRow()
      await row.getByRole('button', { name: '发布', exact: true }).click()
      const box = page.locator('.el-message-box')
      await expect(box, '点「发布」后应弹出确认框').toBeVisible({ timeout: 20000 })
      await expect(box.locator('.el-message-box__message')).toBeVisible({ timeout: 15000 })
      return (await box.locator('.el-message-box__message').innerText()).replace(/\s+/g, '')
    }

    let defId = ''
    let published = false
    try {
      // ---------- ① 趁 TARGET 还启用，用 API 建一份绑了【TARGET + CONTROL】的草稿 ----------
      const created = await request.post(`${API_BASE_URL}/agent/def/create`, {
        headers,
        data: {
          code: CODE,
          name: 'E2E 发布警告助手',
          persona: '用于验证列表页发布确认框里的停用工具警告。',
          toolKeys: `${TARGET},${CONTROL}`
        }
      })
      expect(created.ok(), `建草稿应成功，实际 ${created.status()}`).toBeTruthy()
      const createdBody = await created.json()
      expect(createdBody.code, `建草稿应返回 code=0，实际 ${JSON.stringify(createdBody)}`).toBe(0)
      defId = String(createdBody.data)
      expect(defId, '建草稿应返回新 id').toBeTruthy()

      await login(page)

      // ---------- ② 反空转对照：还没停用时，确认框里【不该】有这段警告 ----------
      // 🔴 这半边不可省：没有它，一个「无论有没有停用工具都贴一段警告」的实现同样全绿，
      //    而那种实现会把确认框变成每次都喊一嗓子 —— 喊几次之后管理员就不看了，
      //    与 B1 里「弹几次假的二次确认，真的那次直接点确定不看字」是同一种失效方式。
      const beforeText = await openPublishConfirm()
      expect(beforeText, '基础确认文案应在').toContain(`确认发布Agent「E2E发布警告助手」`)
      expect(beforeText, '工具都启用着，不该出现停用警告').not.toContain('当前已被停用')
      expect(beforeText, '工具都启用着，不该提到安全网关').not.toContain('安全网关')
      await page.locator('.el-message-box').getByRole('button', { name: /取\s*消/ }).click()
      await expect(page.locator('.el-message-box')).toBeHidden({ timeout: 15000 })

      // ---------- ③ 管理员把 TARGET 停用 ----------
      // 🔴 registered-update 是【整份提交】：其余字段一律原样回填生效值。
      //    少回填 permissions 会被后端当成「删空代码权限」= 一次货真价实的安全放松。
      //    停用是**收紧**不是放松，故不需要 confirmRelax。
      const disable = await request.put(`${API_BASE_URL}/agent/tool-def/registered-update`, {
        headers,
        data: {
          toolName: TARGET,
          displayName: target0.displayName,
          description: target0.description,
          groupName: target0.groupName,
          permissions: target0.permissions,
          paramsSchema: target0.paramsSchema,
          riskLevel: target0.riskLevel,
          enabled: false,
          remark: 'e2e-D4-25b-探针-非真实停用'
        }
      })
      expect(disable.ok(), `停用应成功，实际 ${disable.status()}`).toBeTruthy()
      expect((await readTool(TARGET)).enabled, '停用应已生效').toBe(false)

      // ---------- ④ 重新加载列表页（toolCatalog 有页面级缓存，不 reload 就是假绿）----------
      await page.reload()
      const afterText = await openPublishConfirm()

      // (a) 点名被停用的那个，且用的是中文名（裸机器键管理员认不出来）
      expect(afterText, '警告应点名被停用的工具（中文名）').toContain(target0.displayName)
      // (b) 🔴 不点名没停用的那个：一起列出来会让人去解绑一个本来是好的工具
      expect(afterText, '对照工具没被停用，不该被点名').not.toContain(control0.displayName)
      // (c) 说清「不拦你」—— 这是裁定本体，不说会让人以为界面会兜住
      expect(afterText, '警告应说清发布不会被拦').toContain('发布不会拦你')
      // (d) 说清运行期的真实后果与出处
      expect(afterText, '警告应说清运行期会被安全网关拒').toContain('安全网关')
      // (e) 两条出路都要给：解绑 / 去工具管理重新启用
      expect(afterText, '警告必须给出路：解绑').toContain('解绑')
      expect(afterText, '警告必须给出路：去工具管理重新启用').toContain('工具管理')

      // ---------- ⑤ 🔴 真的点「确定」：警告不是拦截，发布必须成功 ----------
      await page.locator('.el-message-box').getByRole('button', { name: /确\s*定/ }).click()
      await expect(
        page.locator('.el-message').filter({ hasText: '发布成功' }).first(),
        '带着停用工具也必须发布成功 —— 裁定的就是「警告而不是硬拒」'
      ).toBeVisible({ timeout: 20000 })
      published = true

      const got = await request.get(`${API_BASE_URL}/agent/def/get?id=${defId}`, { headers })
      const gotBody = await got.json()
      expect(gotBody.code, `读回 def 应成功，实际 ${JSON.stringify(gotBody)}`).toBe(0)
      expect(gotBody.data.status, '发布后状态应为 PUBLISHED').toBe('PUBLISHED')
      expect(gotBody.data.toolKeys, '发布不该动 toolKeys（警告只说不改）').toBe(`${TARGET},${CONTROL}`)
    } finally {
      // ---------- 还债 1：撤掉停用覆盖行 ----------
      // 放在 finally 且在删 def 之前：这行不还，后面所有依赖 data_interface_list 的用例全废
      const reset = await request.delete(
        `${API_BASE_URL}/agent/tool-def/registered-reset?toolName=${encodeURIComponent(TARGET)}`,
        { headers }
      )
      expect(reset.ok(), `恢复默认应成功，实际 ${reset.status()}`).toBeTruthy()
      const restored = await readTool(TARGET)
      expect(restored.enabled, '恢复默认后应退回启用').toBe(true)
      expect(restored.overridden, '恢复默认后不该再有覆盖行').toBe(false)

      // ---------- 还债 2：删掉本用例造的 def ----------
      // 🔴 已发布不可直删（后端 AGENT_DEF_PUBLISHED_NOT_DELETABLE），要先停用再删。
      //    用 published 标记而不是去读一次状态：读也可能失败，而失败时我们仍需尽力删。
      if (defId) {
        if (published) {
          const off = await request.post(`${API_BASE_URL}/agent/def/disable?id=${defId}`, { headers })
          expect(off.ok(), `停用应成功，实际 ${off.status()}`).toBeTruthy()
        }
        const del = await request.delete(`${API_BASE_URL}/agent/def/delete?id=${defId}`, { headers })
        expect(del.ok(), `删 def 应成功，实际 ${del.status()}`).toBeTruthy()
        const delBody = await del.json()
        expect(delBody.code, `删 def 应返回 code=0，实际 ${JSON.stringify(delBody)}`).toBe(0)
      }
    }
  })
})
