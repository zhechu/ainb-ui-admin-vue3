import { test, expect, type Page, type Locator } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 工具管理页端到端验证
 * （AI助手 问题2 + 2026-09-28 内置工具在线维护 + 2026-09-29 需求1/2/3/4/5）
 *
 * 🔴 为什么非要走浏览器：本页是双 tab 的管理页（内置工具在线维护 + 自定义工具 CRUD），
 *   2026-09-29 又整体从「弹窗」改成「页内面板」、自定义工具从「自带 HTTP」改成「关联数据接口」。
 *   接口层只能证 CRUD 通，证不了下面这些只有真实 DOM 才暴露的东西：
 *     · 需求1：内置工具的展示名真是中文、分组真归好类（后端返回什么不等于页面显示什么）；
 *     · 需求2：新增/编辑真是页内面板而【不是弹窗】，且两个 tab 都真有分页；
 *     · 需求3：关联数据接口后，入参表真回显、绑到「含写」接口时执行方式真自动切换并自动补权限；
 *     · 需求4：按钮文案真是「新增」而不是「新增工具」；
 *     · 二轮需求3：列表顶部「不遵循 MCP」提示语已删除（说明保留在 index.vue 的文件头注释里）。
 *   本模块头号缺陷「配了/点了但不生效且无提示」正是这类管理页最易踩的坑，故必须浏览器实测。
 *
 * 🔴 选择器一律走「当前可见的 tab-pane」：el-tabs 的非激活面板是 v-show（display:none）而不是卸载，
 *    直接 page.locator('.el-table__row') 会把两个 tab 的行加在一起数，得到一个看着对、实则错位的断言。
 *
 * 前置：后端 48080（已 apply xpy-2026-09-29-agent-tool-def-data-interface.sql 并重启）+ 前端 dev server。
 * 数据自净：内置维护用例末尾「恢复默认」；自定义用例建一条 e2e 专用工具、末尾删除；
 *          写接口联动用例只走到「返回」，不落库。
 */

const TOOL_KEY_PREFIX = 'e2e_di_tool_'
const LIST_URL = /\/ai\/agent\/tooldef$/
const TOOLKEY_PLACEHOLDER = '小写字母开头，如 sales_daily_report'
/** 只读接口：绑它不触发任何自动切换，用来验证「干净的只读路径」 */
const READONLY_INTERFACE = 'role_api'
/** 含写接口：验证 mode/权限自动联动（编码里带时间戳会变，只能按名称搜） */
const WRITE_INTERFACE_KEYWORD = '作废单据'
const INVOKE_PERMISSION = 'infra:data-interface:invoke'

/** 内置工具里挑一个「只读、无副作用」的作为维护目标，改坏了也只是一行显示层覆盖 */
const BUILTIN_TARGET = 'data_interface_list'
/** 该目标所在的分组；用分组过滤顺便把需求1的「分组可用」一起验了 */
const BUILTIN_TARGET_GROUP = '数据接口'

/** 当前可见的 tab-pane（el-tabs 非激活面板是 display:none，不卸载） */
const pane = (page: Page): Locator => page.locator('.el-tab-pane:visible').first()

/** 按 label 精确定位表单项：页面上有多个 select，靠 hasText 会串到相邻项 */
const formItem = (scope: Locator | Page, label: string): Locator =>
  scope.locator(`.el-form-item:has(.el-form-item__label:text-is("${label}"))`).first()

/** 当前可见的下拉面板（Element Plus 把 popper teleport 到 body，关闭的是 display:none） */
const visibleDropdown = (page: Page): Locator => page.locator('.el-select-dropdown:visible').last()

test.describe('工具管理页（内置工具在线维护）', () => {
  test.setTimeout(180_000)

  test('需求1/2/5：中文展示名与分组 + 分组过滤 + 页内维护面板（非弹窗）+ 分页 + 恢复默认', async ({
    page,
    request
  }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/tooldef')
    await page.waitForURL(LIST_URL, { timeout: 15000 })

    // ---------- 2026-09-29 二轮需求3：列表顶部「不遵循 MCP」提示语已按体验要求删除 ----------
    await expect(page.locator('.el-alert').filter({ hasText: /不遵循 MCP 协议/ })).toHaveCount(0)

    // ---------- 需求2：默认停在「内置工具」tab，首页 20 行 + 分页 ----------
    await expect(page.getByRole('tab', { name: '内置工具' })).toBeVisible({ timeout: 15000 })
    const builtinPane = pane(page)
    await expect(builtinPane.locator('.el-table__row').first()).toBeVisible({ timeout: 15000 })
    const rowCount = await builtinPane.locator('.el-table__row').count()
    expect(rowCount, `内置工具首页应为 20 行（前端分页），实际 ${rowCount}`).toBe(20)
    await expect(builtinPane.locator('.el-pagination')).toBeVisible()
    await expect(builtinPane.locator('.el-pagination__total')).toContainText(/共\s*\d+\s*条/)

    // ---------- 需求1：展示名全是中文、分组都归好类且是业务语义 ----------
    // 列序：1 序号 / 2 展示名 / 3 工具名 / 4 分组 / 5 风险 / 6 权限 / 7 状态 / 8 维护 / 9 操作
    const displayNames = await builtinPane.locator('.el-table__row td:nth-child(2)').allInnerTexts()
    const notChinese = displayNames.filter((n) => !/[\u4e00-\u9fa5]/.test(n))
    expect(notChinese, `展示名应为中文，这些不是：${notChinese.join(' / ')}`).toHaveLength(0)

    const groups = (await builtinPane.locator('.el-table__row td:nth-child(4) .el-tag').allInnerTexts())
      .map((g) => g.trim())
    expect(groups.length, '首页每行都应有分组标签').toBe(rowCount)
    const groupOptions = [...new Set(groups)]
    // 分组必须是给人看的中文，不能是代码里的英文包名（那等于没分组）
    const nonChineseGroups = groupOptions.filter((g) => !/[\u4e00-\u9fa5]/.test(g))
    expect(nonChineseGroups, `分组出现非中文名：${nonChineseGroups.join('/')}`).toHaveLength(0)

    // ---------- 需求1+2：分组过滤生效，且过滤后页码退回第 1 页 ----------
    await formItem(builtinPane, '分组').locator('.el-select').click()
    await visibleDropdown(page).locator('.el-select-dropdown__item').filter({ hasText: BUILTIN_TARGET_GROUP }).first().click()
    await expect
      .poll(
        async () =>
          (await pane(page).locator('.el-table__row td:nth-child(4) .el-tag').allInnerTexts()).map((g) =>
            g.trim()
          ),
        { timeout: 10000, message: `过滤「${BUILTIN_TARGET_GROUP}」后应只剩该分组的行` }
      )
      .toEqual([BUILTIN_TARGET_GROUP, BUILTIN_TARGET_GROUP, BUILTIN_TARGET_GROUP])

    const targetRow = pane(page).locator('.el-table__row').filter({ hasText: BUILTIN_TARGET }).first()
    await expect(targetRow).toBeVisible({ timeout: 10000 })

    // 自净前置：先用接口清掉可能残留的覆盖，确保从「默认」态开始（避免上次失败留脏）
    const token = await apiLogin(request)
    await request.delete(
      `${API_BASE_URL}/agent/tool-def/registered-reset?toolName=${encodeURIComponent(BUILTIN_TARGET)}`,
      { headers: apiHeaders(token) }
    )
    await pane(page).getByRole('button', { name: /刷新/ }).first().click()
    const freshRow = pane(page).locator('.el-table__row').filter({ hasText: BUILTIN_TARGET }).first()
    await expect(freshRow).toBeVisible({ timeout: 15000 })
    await expect(freshRow.getByText('默认', { exact: true })).toBeVisible({ timeout: 10000 })

    // ---------- 需求2：点「维护」→ 页内面板，且【没有弹窗】 ----------
    // 🔴 列表展示名必须在点「维护」之前读：面板与列表是 v-if/v-else 互斥渲染，
    //    面板一开列表就卸载了，事后再去读行会一直等到超时。
    const listDisplayName = (await freshRow.locator('td:nth-child(2)').innerText()).trim()
    await freshRow.getByRole('button', { name: '维护' }).click()
    await expect(
      page.locator('.panel-title').filter({ hasText: `维护内置工具 · ${BUILTIN_TARGET}` })
    ).toBeVisible({ timeout: 15000 })
    // 🔴 需求2 的核心断言：改页内之后，本页任何操作都不该再出现 el-dialog
    await expect(page.locator('.el-dialog')).toHaveCount(0)
    // 面板顶部有安全提示（覆盖立即生效 + 安全放松会被审计）
    await expect(page.locator('.el-alert').filter({ hasText: /覆盖立即生效/ }).first()).toBeVisible()
    // 每个字段都用帮助行回显【代码默认值】，让管理员看清自己在覆盖什么
    await expect(page.getByText(/代码默认：/).first()).toBeVisible()
    // 工具名不可改（它是代码里的身份，模型按它调用）
    await expect(formItem(page, '工具名').locator('input')).toBeDisabled()
    await expect(formItem(page, '工具名').locator('input')).toHaveValue(BUILTIN_TARGET)
    // 🔴 需求2（2026-09-29）：展示名必须【带入】列表里那个中文名，不能是空白。
    //    历史 BUG 正是点「维护」进来展示名空白：管理员以为要自己填，存个空串就把中文展示名覆盖没了。
    //    只断言「能填」断不出这个 BUG——本用例紧接着就要填新值，空白也能过——所以必须先断言带入值。
    expect(listDisplayName, '列表里的展示名应是中文').toMatch(/[\u4e00-\u9fa5]/)
    await expect(formItem(page, '展示名').locator('input')).toHaveValue(listDisplayName)

    // ---------- 改展示名 + 关启用 ----------
    await formItem(page, '展示名').locator('input').fill('E2E 维护展示名')
    const enableSwitch = formItem(page, '启用').locator('.el-switch').first()
    if ((await enableSwitch.getAttribute('class'))?.includes('is-checked')) {
      await enableSwitch.click()
    }
    await page.getByRole('button', { name: /保存并生效/ }).click()

    // ---------- 保存后自动回列表，该行立即显示「维护中」+「停用」+ 新展示名 ----------
    await expect(page.locator('.panel-title')).toHaveCount(0, { timeout: 20000 })
    const row = pane(page).locator('.el-table__row').filter({ hasText: BUILTIN_TARGET }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row.getByText('维护中')).toBeVisible()
    await expect(row.getByText('停用', { exact: true })).toBeVisible()
    await expect(row).toContainText('E2E 维护展示名')

    // ---------- 恢复默认 →「维护中」消失、回到「默认」、展示名与启用状态都退回代码声明 ----------
    await row.getByRole('button', { name: '恢复默认' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(row.getByText('维护中')).toHaveCount(0, { timeout: 15000 })
    await expect(row.getByText('默认', { exact: true })).toBeVisible({ timeout: 15000 })
    await expect(row.getByText('E2E 维护展示名')).toHaveCount(0, { timeout: 15000 })
    await expect(row.getByText('启用', { exact: true })).toBeVisible({ timeout: 10000 })
  })
})

test.describe('工具管理页（自定义工具 = 数据接口的 AI 包装层）', () => {
  test.setTimeout(180_000)

  test('需求2/3/4：新增按钮文案 + 页内面板 + 关联只读接口 + 入参回显 + 查看/编辑/删除 + 分页', async ({
    page
  }) => {
    const toolKey = `${TOOL_KEY_PREFIX}${Date.now()}`
    await login(page)
    await gotoWithAuth(page, '/ai/agent/tooldef')
    await page.waitForURL(LIST_URL, { timeout: 15000 })

    // 切到「自定义工具」tab（默认停在内置工具）
    await page.getByRole('tab', { name: '自定义工具' }).click()
    await expect(pane(page).getByRole('button', { name: '新增', exact: true }).first()).toBeVisible({
      timeout: 15000
    })

    // ---------- 需求4：按钮文案是「新增」，不再是「新增工具」 ----------
    await expect(page.getByRole('button', { name: '新增工具' })).toHaveCount(0)

    // ---------- 需求2：点「新增」→ 页内面板，不是弹窗 ----------
    await pane(page).getByRole('button', { name: '新增', exact: true }).first().click()
    await expect(page.locator('.panel-title').filter({ hasText: '新增工具' })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.el-dialog')).toHaveCount(0)
    // 面板顶部说清「自定义工具 = 数据接口的 AI 包装层」（需求3 的定性说明）
    await expect(page.locator('.el-alert').filter({ hasText: /数据接口/ }).first()).toBeVisible()
    // 需求3：HTTP 那套字段（鉴权方式 / URL / Token）必须彻底消失
    await expect(page.getByText('鉴权方式')).toHaveCount(0)
    await expect(page.getByPlaceholder(/https:\/\/api\.example\.com/)).toHaveCount(0)
    await expect(page.getByText(/Bearer Token/)).toHaveCount(0)

    // ---------- 填基本信息 ----------
    await formItem(page, '工具键').locator('input').fill(toolKey)
    await expect(formItem(page, '工具键').locator('input')).toHaveAttribute('placeholder', TOOLKEY_PLACEHOLDER)
    await formItem(page, '展示名').locator('input').fill('E2E 数据接口包装工具')
    await formItem(page, '工具说明')
      .locator('textarea')
      .fill('这是一条 e2e 自动化用例创建的临时工具，用于验证自定义工具关联数据接口的全链路。')

    // ---------- 需求3：关联只读数据接口 ----------
    await formItem(page, '关联数据接口').locator('.el-select').click()
    const dropdown = visibleDropdown(page)
    await expect(dropdown.locator('.el-select-dropdown__item').first()).toBeVisible({ timeout: 20000 })
    await dropdown.locator('.el-select-dropdown__item').filter({ hasText: READONLY_INTERFACE }).first().click()
    await expect(formItem(page, '关联数据接口')).toContainText(READONLY_INTERFACE, { timeout: 10000 })

    // 入参表回显（role_api 声明了 2 个入参）——这是「模型知道该传什么」的唯一来源
    await expect(formItem(page, '接口入参')).toBeVisible({ timeout: 10000 })
    const paramRowCount = await formItem(page, '接口入参').locator('.el-table__row').count()
    expect(paramRowCount, 'role_api 应有入参回显').toBeGreaterThan(0)

    // 只读接口 + 默认「只读查询」→ 不该出现任何 ⚠️ 警告
    await expect(page.getByText(/所绑接口含写操作/)).toHaveCount(0)
    await expect(formItem(page, '执行方式').locator('.el-radio-button.is-active')).toContainText('只读查询')

    // ---------- 保存 ----------
    await page.locator('.panel-header').getByRole('button', { name: /保\s*存/ }).click()
    await expect(page.locator('.panel-title')).toHaveCount(0, { timeout: 25000 })

    // ---------- 列表出现新工具，且「关联数据接口」「执行方式」两列有值 ----------
    const row = pane(page).locator('.el-table__row').filter({ hasText: toolKey }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row).toContainText('E2E 数据接口包装工具')
    await expect(row).toContainText(READONLY_INTERFACE)
    await expect(row.getByText('只读查询')).toBeVisible()
    // 🔴 需求2：有数据之后分页必须出现（Pagination 是 v-show="total>0"，空列表时不渲染，
    //    所以这条只能在建完之后断言，否则会假失败）
    await expect(pane(page).locator('.el-pagination')).toBeVisible({ timeout: 15000 })

    // ---------- 编辑：工具键禁用、已绑接口正确回显 ----------
    await row.getByRole('button', { name: '编辑' }).click()
    await expect(page.locator('.panel-title').filter({ hasText: '编辑工具' })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.el-dialog')).toHaveCount(0)
    await expect(formItem(page, '工具键').locator('input')).toBeDisabled()
    await expect(formItem(page, '工具键').locator('input')).toHaveValue(toolKey)
    // 🔴 关键回归点：已绑接口必须回显，否则下拉只显示一个光秃秃的 code，看着像「配置丢了」
    await expect(formItem(page, '关联数据接口')).toContainText(READONLY_INTERFACE, { timeout: 20000 })
    await expect(formItem(page, '展示名').locator('input')).toHaveValue('E2E 数据接口包装工具')

    await formItem(page, '展示名').locator('input').fill('E2E 数据接口包装工具(改)')
    await page.locator('.panel-header').getByRole('button', { name: /保\s*存/ }).click()
    await expect(page.locator('.panel-title')).toHaveCount(0, { timeout: 25000 })
    await expect(pane(page).locator('.el-table__row').filter({ hasText: toolKey }).first()).toContainText(
      'E2E 数据接口包装工具(改)',
      { timeout: 20000 }
    )

    // ---------- 查看：只读面板，没有保存按钮 ----------
    await pane(page)
      .locator('.el-table__row')
      .filter({ hasText: toolKey })
      .first()
      .getByRole('button', { name: '查看' })
      .click()
    await expect(page.locator('.panel-title').filter({ hasText: '查看工具' })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.panel-header').getByRole('button', { name: /保\s*存/ })).toHaveCount(0)
    await expect(page.locator('.panel-header').getByRole('button', { name: '返回' })).toBeVisible()
    await page.locator('.panel-header').getByRole('button', { name: '返回' }).click()
    await expect(page.locator('.panel-title')).toHaveCount(0, { timeout: 15000 })

    // ---------- 删除（数据自净） ----------
    await pane(page)
      .locator('.el-table__row')
      .filter({ hasText: toolKey })
      .first()
      .getByRole('button', { name: '删除' })
      .click()
    await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
    await expect(pane(page).locator('.el-table__row').filter({ hasText: toolKey })).toHaveCount(0, {
      timeout: 25000
    })
  })

  test('需求3：绑「含写」接口 → 执行方式自动切全能力、自动补 invoke 权限、风险低标给出警告', async ({
    page
  }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/tooldef')
    await page.waitForURL(LIST_URL, { timeout: 15000 })
    await page.getByRole('tab', { name: '自定义工具' }).click()
    await pane(page).getByRole('button', { name: '新增', exact: true }).first().click()
    await expect(page.locator('.panel-title').filter({ hasText: '新增工具' })).toBeVisible({ timeout: 15000 })

    // 远程搜索含写接口（编码里带时间戳，只能按名称搜）
    await formItem(page, '关联数据接口').locator('.el-select').click()
    await formItem(page, '关联数据接口').locator('input').fill(WRITE_INTERFACE_KEYWORD)
    const dropdown = visibleDropdown(page)
    await expect(
      dropdown.locator('.el-select-dropdown__item').filter({ hasText: WRITE_INTERFACE_KEYWORD }).first()
    ).toBeVisible({ timeout: 20000 })
    // 下拉项上应有「含写」红标——后端分析脚本得出的权威判断，比表单上填的可信
    await expect(dropdown.locator('.el-select-dropdown__item').filter({ hasText: '含写' }).first()).toBeVisible()
    await dropdown.locator('.el-select-dropdown__item').filter({ hasText: '含写' }).first().click()

    // 🔴 自动切到「全能力执行」：只读查询根本跑不动含写接口，不切就会「保存成功但一调就报错」
    await expect(formItem(page, '执行方式').locator('.el-radio-button.is-active')).toContainText(
      '全能力执行',
      { timeout: 10000 }
    )
    // 🔴 自动补上 invoke 权限：漏了后端直接拒，且用户看不出缺的是哪一个
    await expect(formItem(page, '所需权限').locator('input')).toHaveValue(INVOKE_PERMISSION, {
      timeout: 10000
    })
    // 风险等级仍停在默认的「只读」→ 必须给出醒目警告（安全字段只提示、不代改）
    await expect(page.getByText(/会让它绕过确认/).first()).toBeVisible({ timeout: 10000 })

    // 不落库，直接返回
    await page.locator('.panel-header').getByRole('button', { name: '返回' }).click()
    await expect(page.locator('.panel-title')).toHaveCount(0, { timeout: 15000 })
  })
})
