import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { API_BASE_URL, apiHeaders, apiLogin } from './helpers/auth'

/**
 * 权限体系重构（S8/S9）· 浏览器端验收
 *
 * 覆盖 `docs/permission-rebuild/S8bcd-交接.md` §6 列出的 6 条人工验收路径。
 *
 * ## 为什么这套必须存在
 *
 * S8/S9 的后端接口、单测、Python 端到端全部绿过，但**没有任何一次在浏览器里走过**，
 * 结果漏掉了两个只有开界面才看得见的缺陷：
 *   1. 菜单树返回空数组 —— 登录后导航栏什么都没有（permissions 733 条而 menus []）
 *   2. 规则管理页 / 权限诊断页没有菜单行，是进不去的孤儿页面
 * 两个都是「接口 200、日志干净、就是用不了」，正是 CLAUDE.md 反复强调的那类缺陷。
 *
 * ## 前置
 *
 * 后端 48080 + 前端 dev server（Playwright 的 webServer 会自动拉起）。
 */

const ADMIN = { tenant: 'xpy', username: 'admin', password: 'admin123' }

/**
 * 权限模块各页的前端路由。
 *
 * 🔴 比菜单名多出两层，不是笔误：2026-09-19 的菜单重构
 * （{@code sql/mysql/xpy-2026-09-19-org-permission-menu.sql}）把角色管理挂进了新目录「组织权限」，
 * 规则/资源/诊断又挂进其下的「权限管理」。前端路由是**菜单 path 逐级拼接**出来的，
 * 于是 {@code /system/rule} 变成了 {@code /system/org-permission/perm/rule}。
 *
 * <p>旧写法不再匹配任何路由，页面整个空白（{@code .el-card} 数为 0），
 * 断言报的却是「元素找不到」—— 看着像组件坏了，实际<b>压根没进那个页面</b>。
 * 实测这两个 spec 里 7 条用例全部因此失败，而后端一个错都没报。
 *
 * <p>⚠️ 只有【前端路由】变了。后端接口路径原样不动
 * （仍是 {@code /system/rule/page}、{@code /system/permission-diag/check}），别跟着一起改。
 */
const ROLE_PAGE = '/system/org-permission/role'
const RULE_PAGE = '/system/org-permission/perm/rule'
const DIAG_PAGE = '/system/org-permission/perm/permission-diag'

async function login(page: Page) {
  await page.goto('/login')
  const form = page
    .locator('form.login-form')
    .filter({ has: page.locator('input[type="password"]') })
    .filter({ has: page.locator('input[type="checkbox"]') })
    .first()
  await expect(form).toBeVisible()

  const inputs = form.locator('input:visible')
  const inputCount = await inputs.count()
  if (inputCount >= 3) await inputs.nth(0).fill(ADMIN.tenant)
  await inputs.nth(inputCount - 2).fill(ADMIN.username)
  await inputs.nth(inputCount - 1).fill(ADMIN.password)

  const loginResp = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  expect((await loginResp).ok()).toBeTruthy()
  await expect(page).not.toHaveURL(/\/login/)
}

/** 侧边栏的悬浮二级菜单会盖住内容区，把后续点击截走。与本用例无关，屏蔽掉 */
async function hidePopupMenu(page: Page) {
  await page.addStyleTag({ content: '.el-menu--popup { display: none !important; }' })
}

/**
 * 收起弹窗里当前打开的下拉浮层。
 *
 * 🔴 必须显式收起，不能指望「点下一个 select 会自动关掉上一个」—— 实测不会。
 *   EP 把 popper 挂在 body 上（{@code #el-popper-container-*}），资源那棵树高 280px，
 *   正好压在下面的「行过滤规则」select 上，点击被 popper 截走，
 *   Playwright 一路重试到 90s 用例超时，报的却是「click 超时」，看不出是遮挡。
 *
 * <p>⚠️ 也不能按 Esc：{@code el-dialog} 的 {@code close-on-press-escape} 默认是 true，
 *   一个 Esc 会把【整个弹窗】一起关掉。所以点弹窗标题栏这个中立区域。
 */
async function closeOpenDropdown(page: Page, dialog: Locator) {
  await dialog.locator('.el-dialog__header').click()
  await expect(page.locator('.el-select-dropdown:visible')).toHaveCount(0, { timeout: 10_000 })
}

/**
 * 从后端捞一个真实存在的【字段级】资源标识（type=FIELD / COLUMN）。
 *
 * 🔴 不写死：授权弹窗的「字段显示模式」是 {@code :disabled="!isFieldLevelResource"}，
 *   必须先选中一个 COLUMN/FIELD 资源才解锁。把某个 permission 写死在用例里，
 *   一旦那行资源被改名或删除，用例就挂在一个跟本次改动毫不相干的数据上，排查半天。
 */
async function anyFieldLevelPermission(request: APIRequestContext): Promise<string> {
  const token = await apiLogin(request)
  const resp = await request.get(
    `${API_BASE_URL}/system/resource/list?includeFieldLevel=true`,
    { headers: apiHeaders(token) }
  )
  const body = await resp.json()
  expect(body.code, `资源列表接口异常：${JSON.stringify(body).slice(0, 200)}`).toBe(0)
  const hit = body.data.find((r: any) => r.type === 'FIELD' || r.type === 'COLUMN')
  expect(hit, '库里一个字段级资源都没有，「字段显示模式」这条用例无从验证').toBeTruthy()
  return hit.permission
}

test.describe('权限重构 · 浏览器验收', () => {
  // ── 路径 0：导航树非空（修复回归钉子）───────────────────────────
  test('登录后导航菜单不是空的', async ({ page }) => {
    const infoResp = page.waitForResponse((r) =>
      r.url().includes('/system/auth/get-permission-info')
    )
    await login(page)
    const body = await (await infoResp).json()

    // 这一条就是那个缺陷的回归钉子：修复前 menus 是 []，permissions 却有 733 条
    expect(body.data.permissions.length).toBeGreaterThan(0)
    expect(
      body.data.menus.length,
      'menus 为空 = 导航栏什么都不显示（listAllowedMenuIds 没补菜单树祖先）'
    ).toBeGreaterThan(0)

    // 界面上也要真的渲染出来，不能只是接口有数据
    await expect(page.locator('.el-menu').first()).toBeVisible()
  })

  // ── 路径 1 & 2：角色管理 →「资源授权」独立页 →「新增授权」弹窗 ──────
  test('角色管理 →「资源授权」独立页能打开，新增授权弹窗里资源树与规则下拉都有数据', async ({ page }) => {
    await login(page)
    await page.goto(ROLE_PAGE)
    await hidePopupMenu(page)
    await expect(page.locator('.el-table__body tbody tr').first()).toBeVisible()

    // 🔴「资源授权」早已【不是弹窗】，而是页内跳转到独立路由 /system/role/grant?roleId=N
    //   （见 role/index.vue 的 openGrantPage、router/modules/remaining.ts 的 SystemRoleGrant）。
    //   资源有 800+ 个，塞进弹窗既挤又卡，所以整页承载。这里按【跳转】断言，别再找 el-dialog。
    await page.locator('button:has-text("资源授权")').first().click()
    await page.waitForURL(/\/system\/role\/grant\?roleId=\d+/, { timeout: 15_000 })
    // roleId 没接上时页面是 el-empty 空态（不崩，但也配不了授权），所以按钮必须真的可用
    await expect(page.getByRole('button', { name: '新增授权' })).toBeEnabled({ timeout: 15_000 })

    // 「新增授权」这一层才是弹窗
    await page.getByRole('button', { name: '新增授权' }).click()
    const dialog = page.locator('.el-dialog:visible').filter({ hasText: '新增授权' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })

    // 资源树要真展开出节点 —— 资源接口空 / 树没建起来时这里是一片空白，
    // 表现是「弹窗打得开、就是选不了资源」。
    // ⚠️ 组件是 el-select + #empty 插槽里的 el-tree-v2（虚拟化树），不是 el-tree-select：
    //    800+ 资源全量渲染会卡，所以 .el-tree-select__popper 这个选择器已经不存在了。
    const formItemOf = (label: string) =>
      dialog.locator('.el-form-item').filter({ has: page.locator(`.el-form-item__label:text-is("${label}")`) })
    await formItemOf('资源').locator('.el-select').first().click()
    await expect(
      page.locator('.el-select-dropdown:visible .el-tree-node').first(),
      '资源树没有节点：资源接口没数据或树没建起来'
    ).toBeVisible({ timeout: 15_000 })

    // 行过滤规则下拉也要有候选
    await closeOpenDropdown(page, dialog)
    await formItemOf('行过滤规则').locator('.el-select').first().click()
    await expect(
      page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first(),
      '行过滤规则下拉没有候选：规则表是空的'
    ).toBeVisible({ timeout: 15_000 })
  })

  // ── 路径 3：规则管理页 ────────────────────────────────────────
  test('规则管理页可访问，列表有种子规则', async ({ page }) => {
    await login(page)
    const listResp = page.waitForResponse((r) => r.url().includes('/system/rule/page'))
    await page.goto(RULE_PAGE)
    await hidePopupMenu(page)

    expect((await listResp).ok()).toBeTruthy()
    // 页面真的渲染出来了（不是 404 或空白路由）
    await expect(page.locator('button:has-text("新增")').first()).toBeVisible()
    await expect(page.locator('.el-table__body tbody tr').first()).toBeVisible()
  })

  // ── 路径 6：权限诊断页 ────────────────────────────────────────
  test('权限诊断页：查一个已知权限串能出结论与资源链', async ({ page }) => {
    await login(page)
    await page.goto(DIAG_PAGE)
    await hidePopupMenu(page)

    // 🔴 权限标识早已从「裸 input」换成 el-select（filterable + allow-create），
    //    placeholder 也从「如 system:user:query」变成「搜索或输入，如 system:user:query」。
    //    EP 把 select 的 placeholder 渲染成 span 而不是 input 属性，
    //    所以 input[placeholder=...] 永远定位不到 —— 只能按表单项结构定位。
    const form = page.locator('.el-form').first()
    const permissionSelect = form.locator('.el-select').first()
    await expect(permissionSelect).toBeVisible({ timeout: 20_000 })
    await permissionSelect.click()
    await permissionSelect.locator('input').first().fill('system:grant:query')
    // 必须【点中下拉项】才算选上：allow-create 下光填字不会写进 v-model，
    // 而 runDiag 开头就是 if (!query.permission.trim()) 直接 return —— 表现为「点了诊断没反应」
    await page
      .locator('.el-select-dropdown__item:visible')
      .filter({ hasText: 'system:grant:query' })
      .first()
      .click()

    const diagResp = page.waitForResponse((r) =>
      r.url().includes('/system/permission-diag/check')
    )
    await page.locator('button:has-text("诊断")').first().click()
    const payload = await (await diagResp).json()

    expect(payload.code).toBe(0)
    expect(['ALLOWED', 'DENIED']).toContain(payload.data.conclusion)
    expect(payload.data.subjects.length, '主体闭包为空').toBeGreaterThan(0)
    expect(payload.data.resourceChain.length, '资源链为空').toBeGreaterThan(0)

    // 结论要真的显示在界面上，而不只是接口返回了。
    // 页面渲染的是中文（✅ 有权限 / 🚫 无权限），不是原始的 ALLOWED/DENIED
    const shown = payload.data.conclusion === 'ALLOWED' ? '有权限' : '无权限'
    await expect(page.getByText(shown).first()).toBeVisible()
  })

  // ── 字段模式枚举必须与后端 FieldModeEnum 对齐 ──────────────────
  test('授权弹窗的「字段显示模式」取值与后端 FieldModeEnum 一致', async ({ page, request }) => {
    const fieldPermission = await anyFieldLevelPermission(request)

    await login(page)
    await page.goto(ROLE_PAGE)
    await hidePopupMenu(page)
    await expect(page.locator('.el-table__body tbody tr').first()).toBeVisible()
    // 「资源授权」是页内跳转到独立页，弹窗在【那一页】上才点得到（详见上面那条用例的说明）
    await page.locator('button:has-text("资源授权")').first().click()
    await page.waitForURL(/\/system\/role\/grant\?roleId=\d+/, { timeout: 15_000 })
    await page.getByRole('button', { name: '新增授权' }).click()
    const dialog = page.locator('.el-dialog:visible').filter({ hasText: '新增授权' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })

    const formItemOf = (label: string) =>
      dialog
        .locator('.el-form-item')
        .filter({ has: page.locator(`.el-form-item__label:text-is("${label}")`) })
    const fieldModeInput = formItemOf('字段显示模式').locator('.el-select input').first()

    // 🔴 没选资源时这个 select 是【禁用】的（GrantForm.vue: :disabled="!isFieldLevelResource"）。
    //   直接点禁用态的 select 根本不会弹下拉，断言只会报「元素找不到」——
    //   看着像候选值丢了，其实是压根没打开。曾因此误判过一次。
    //   先钉住禁用态本身：它保证「字段管控配到菜单资源上」这种无效配置在界面上就填不出来。
    //   ⚠️ 断 input 的 disabled 而不是根节点的 class：EP 2.13 的 is-disabled
    //      挂在里层 .el-select__wrapper 上，根 .el-select 上并没有。
    await expect(fieldModeInput).toBeDisabled()

    // 选中一个字段级资源来解锁。字段级资源默认【不加载】，得先勾上下拉头部的开关
    await formItemOf('资源').locator('.el-select').first().click()
    const includeFieldLevel = page
      .locator('.el-checkbox')
      .filter({ hasText: '显示字段级资源' })
      .first()
    await expect(includeFieldLevel, '资源下拉头部的「显示字段级资源」开关不见了').toBeVisible({
      timeout: 15_000
    })
    // 🔴 必须等重载请求回来再过滤：勾选后 reloadResourceTree 会重建树并 filter('')。
    //   抢在它前面填关键字，过滤结果会被随后的 filter('') 冲掉，
    //   表现是「明明勾了开关、树里还是没有字段资源」，间歇性发生，最难查。
    const reloadResp = page.waitForResponse(
      (r) => r.url().includes('/system/resource/list') && r.request().method() === 'GET'
    )
    await includeFieldLevel.click()
    expect((await reloadResp).ok(), '资源列表重载请求失败').toBeTruthy()

    // 1000+ 资源的虚拟化树，靠 el-select 的 filterable 过滤到目标节点
    // （filter-method 转发给 el-tree-v2 的 filter，内部有 150ms 防抖）
    await formItemOf('资源').locator('.el-select input').first().fill(fieldPermission)
    // 用 __content 而不是 .el-tree-node 定位：后者会把祖先节点一起匹配上（子孙含关键字），
    // .first() 拿到的就是最外层，点上去选中的是菜单而不是字段
    const targetNode = page
      .locator('.el-select-dropdown:visible .el-tree-node__content')
      .filter({ hasText: fieldPermission })
      .first()
    await expect(
      targetNode,
      `勾选「显示字段级资源」后仍找不到 ${fieldPermission}：includeFieldLevel 参数没传到后端`
    ).toBeVisible({ timeout: 15_000 })
    await targetNode.click()

    await closeOpenDropdown(page, dialog)
    await expect(
      fieldModeInput,
      `选中字段级资源 ${fieldPermission} 后「字段显示模式」仍被禁用：resourceId 没写进表单`
    ).toBeEnabled({ timeout: 10_000 })

    // 打开「字段显示模式」下拉，读出全部候选值
    await formItemOf('字段显示模式').locator('.el-select').click()
    const options = page.locator('.el-select-dropdown:visible .el-select-dropdown__item')
    await expect(options.first()).toBeVisible({ timeout: 10_000 })
    const labels = await options.allInnerTexts()

    // 后端 FieldModeEnum 只有 EDITABLE / READONLY / HIDDEN。
    // 曾经这里是 VISIBLE —— 后端 parse 不出来会把【整行授权过滤掉】，
    // 表现是「选了可见、保存成功、列表也显示可见，判定时却完全不生效」
    expect(labels.join(' ')).toContain('EDITABLE')
    expect(labels.join(' '), 'VISIBLE 不是后端认识的取值').not.toContain('VISIBLE')
    // 三个取值一个都不能少：少一个就意味着某种字段管控在界面上根本选不到
    expect(labels, `字段显示模式候选与 FieldModeEnum 不符：${labels.join(' / ')}`).toHaveLength(3)
    expect(labels.join(' ')).toContain('READONLY')
    expect(labels.join(' ')).toContain('HIDDEN')
  })

  // ── 路径 5：BPM 流程定义页 →「权限配置」──────────────────────
  test('BPM 流程定义页有「权限配置」入口', async ({ page }) => {
    await login(page)
    // ⚠️ 这个页面是**隐藏的静态路由** `/bpm/manager/definition`（见 router/modules/remaining.ts），
    // 没有菜单行，从流程模型列表跳进来，且要带 ?key= 才有数据
    await page.goto('/bpm/manager/definition?key=leave')
    await hidePopupMenu(page)
    await expect(page.locator('.el-table__body tbody tr').first()).toBeVisible({ timeout: 20_000 })

    // 按钮带 v-hasPermi="['system:grant:query']" —— 没授权时它会静默消失
    await expect(page.locator('button:has-text("权限配置")').first()).toBeVisible()
  })
})
