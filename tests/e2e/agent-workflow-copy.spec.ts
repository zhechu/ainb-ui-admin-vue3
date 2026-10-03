import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiHeaders, apiLogin, gotoWithAuth } from './helpers/auth'

/**
 * 复制流程 + 只读查看（重构 S5-d / 方案 §3-L4 4.1、4.2）
 *
 * 🔴 为什么这些断言只能在真浏览器里做：本刀改的全是**模板层的条件渲染**
 *    （「设计」常显、文案按 editable 切、「编辑/删除」改判 editable、复制按钮两种形态），
 *    而前端没有组件测试设施（没装 @vue/test-utils）⟹ v-if / :disabled 绑错一个字，
 *    单测和 ts:check 都不会红，只有渲染出来的 DOM 会。
 *    更关键的是 editable 这一格：它是 S5-c 新加的服务端派生字段，
 *    **列表页拿不拿得到它**（/page 的 BeanUtils.toBean 有没有把它带上）只有真请求才知道。
 *
 * ⚠️ 台账 #109：hasPermi 对 `*:*:*` 短路、e2e 恒以 admin 登录 ⟹ 本 spec **证明不了**
 *    「设计」按钮权限从 update 放宽到 query 这件事。别把这里的绿当成那次放宽的验收判据。
 *
 * 🔴 自 seed 自净：beforeAll 用 admin API 备两条源流程 ——
 *    ① 一条**含冲突配置**的 DRAFT（webhook path/secret + 建表名 + 表单编码 + 审批流 key + 子流程），
 *       时间戳 code，afterAll 删掉 ⟹ 这条是完全自净的；
 *    ② 一条**不含任何冲突配置**的 PUBLISHED（chat 触发 + 一个只读工具节点，即已知可发布的形状），
 *       用来验「非草稿行」的按钮态与「空清单是正常的」那一支。
 *       ⚠️ 它的 code 是**固定的**、且「有就复用」：已发布的行是不可变快照、接口删不掉，
 *       用时间戳 code 就等于每跑一次永久多一条垃圾行。详见 publishedCode 的注释。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev :80 在跑。
 */

const API = 'http://127.0.0.1:48080/admin-api'
const LIST_PATH = '/ai/agent/workflow'
/** 设计器路由：`router/modules/remaining.ts` 的 `/agent-workflow/editor`（隐藏路由，与列表页不同源） */
const EDITOR_URL_RE = /\/agent-workflow\/editor/

/** ① 含冲突配置的 DSL：每一格都对应 WorkflowCopyRewriter 的一条规则 */
const conflictDsl = (code: string, table: string) =>
  JSON.stringify(
    {
      dslVersion: '1.0',
      id: code,
      name: code,
      description: 'S5-d e2e 冲突样本',
      trigger: {
        type: 'trigger.webhook',
        config: { path: 'wf-cp-e2e-hook', authType: 'hmac', secret: 'e2e-copy-secret-do-not-log' }
      },
      variables: [
        { key: 'payload', type: 'object', merge: 'replace' },
        { key: 'created', type: 'object', merge: 'replace' },
        { key: 'saved', type: 'object', merge: 'replace' },
        { key: 'approved', type: 'object', merge: 'replace' },
        { key: 'subOut', type: 'object', merge: 'replace' }
      ],
      nodes: [
        {
          id: 'mk_table',
          type: 'tool',
          name: '建表',
          config: {
            toolId: 'datamodel_create',
            args: { model: { tableName: table, comment: 'S5-d e2e' } },
            outputVar: 'created'
          }
        },
        {
          id: 'mk_form',
          type: 'tool',
          name: '建表单',
          config: {
            toolId: 'form_save_draft',
            args: { code: 'cp_e2e_form', mainTable: table },
            outputVar: 'saved'
          }
        },
        {
          id: 'ask_boss',
          type: 'hitl.bpm_approval',
          name: '走审批',
          config: { bpmProcessDefKey: 'cp_e2e_bpm_key', outputVar: 'approved' }
        },
        {
          id: 'call_sub',
          type: 'sub_workflow',
          name: '套子流程',
          config: { workflowId: 'wf_cp_e2e_sub', outputVar: 'subOut' }
        }
      ],
      edges: [
        { from: 'START', to: 'mk_table' },
        { from: 'mk_table', to: 'mk_form' },
        { from: 'mk_form', to: 'ask_boss' },
        { from: 'ask_boss', to: 'call_sub' },
        { from: 'call_sub', to: 'END' }
      ],
      settings: { recovery: 'forward', executionTimeoutSeconds: 60 }
    },
    null,
    2
  )

/** ② 不含任何冲突配置的 DSL（chat + 一个只读工具节点）。与 agent-workflow-version.spec.ts 同一形状：已知可发布 */
const plainDsl = (code: string) =>
  JSON.stringify(
    {
      dslVersion: '1.0',
      id: code,
      name: code,
      description: 'S5-d e2e 无冲突样本',
      trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: '' } },
      variables: [
        { key: 'input', type: 'object', merge: 'replace' },
        { key: 'listOut', type: 'object', merge: 'replace' }
      ],
      nodes: [
        {
          id: 'step_1',
          type: 'tool',
          name: 'list',
          config: { toolId: 'data_interface_list', args: {}, outputVar: 'listOut' }
        }
      ],
      edges: [
        { from: 'START', to: 'step_1' },
        { from: 'step_1', to: 'END' }
      ],
      settings: { recovery: 'forward', executionTimeoutSeconds: 60 }
    },
    null,
    2
  )

test.describe('流程复制与只读查看（S5-d）', () => {
  test.setTimeout(240_000)

  const stamp = Date.now().toString(36)
  const conflictCode = `wf_cp_a_${stamp}`
  const conflictTable = `biz_cp_a_${stamp}`
  const copyCode = `${conflictCode}_copy`

  /**
   * 🔴 已发布样本用**固定 code**，且 beforeAll「有就复用、没有才造」。
   *
   * 为什么不能像草稿样本那样用时间戳 code：已发布的行是不可变快照，`/delete` 只放行草稿
   * ⟹ 每跑一次就永久多出一条只能停用的行，而停用后的行又不能再当「已发布」样本用。
   * 首两轮跑下来库里已经积了 14 条（全量清单见 `_evidence/s5d-cleanup.log`）。
   * 固定 code + 复用把残留从「每跑 +1」压成「恒为 1 条」。
   *
   * ⚠️ 因此 afterAll **故意不停用它**：停用等于把样本作废，下一轮只能走 `/rollback`
   * 造新版本再发布，而版本本身也是行 ⟹ 又退回无界增长。
   */
  const publishedCode = 'wf_cp_pub_e2e'
  const publishedCopyCode = `${publishedCode}_copy`

  let req: APIRequestContext
  let token = ''
  /** 复制产物与冲突样本（一律 DRAFT，可删）；afterAll 清理 */
  const draftIdsToDelete: number[] = []
  /** 固定复用的已发布样本 id，仅用于残留声明 */
  let publishedId = 0

  const api = async (path: string, method = 'GET', body?: any) => {
    const r = await req.fetch(API + path, {
      method,
      data: body,
      headers: { 'Content-Type': 'application/json', ...apiHeaders(token) }
    })
    return r.json()
  }

  /**
   * 🔴 逐步断言而不是「造完再说」：seed 静默失败时，后面的用例只会报「找不到行」，
   *    而真因是夹具压根没造出来（台账 #128 那一族：前置挂了却把账算到用例头上）。
   */
  const seed = async (what: string, path: string, body?: any, method = 'POST') => {
    const res = await api(path, method, body)
    expect(res?.code, `${what} 失败：${JSON.stringify(res)}`).toBe(0)
    return res.data
  }

  type Version = { id: number; code: string; version: number; status: string }

  /**
   * 按 code 精确取版本列表（`selectListByCode` = `eq(code)`，version 倒序）。
   * 🔴 不用 `/page?code=`：那条走 likeIfPresent，搜 `wf_cp_pub_e2e` 会把复制品
   *    `wf_cp_pub_e2e_copy` 一起捞回来，而这里要的恰恰是「这个 code 自己有没有已发布行」。
   */
  const versionListOf = async (code: string): Promise<Version[]> =>
    ((await api(`/agent/workflow-def/version-list?code=${code}`))?.data ?? []) as Version[]

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext()
    token = await apiLogin(req)

    // ① 含冲突配置的草稿。create 不跑 validateDsl ⟹ 节点配置不需要真实存在，
    //    但 insertNewVersion 会跑 triggerExtractor.apply ⟹ webhook 的 path/authType/secret 必须合法。
    const conflictId = await seed('造冲突样本草稿', '/agent/workflow-def/create', {
      code: conflictCode,
      name: 'S5d 冲突样本',
      dsl: conflictDsl(conflictCode, conflictTable),
      description: 'S5-d e2e seed'
    })
    draftIdsToDelete.push(conflictId)

    // ② 已发布样本：复用优先（理由见 publishedCode 的注释）
    const versions = await versionListOf(publishedCode)
    const live = versions.find((v) => v.status === 'PUBLISHED')
    if (live) {
      publishedId = live.id
    } else {
      // 没有现成的已发布行。剩草稿就直接发；只剩停用行则 /rollback 出新草稿再发
      // （不能再调 /create：S5-b 起同 code 会被 WORKFLOW_DEF_CODE_DUPLICATE 拒）
      const draft = versions.find((v) => v.status === 'DRAFT')
      const target: number =
        draft?.id ??
        (versions.length
          ? await seed(
              '回滚出新的已发布样本版本',
              `/agent/workflow-def/rollback?id=${versions[0].id}`,
              undefined,
              'POST'
            )
          : await seed('造已发布样本草稿', '/agent/workflow-def/create', {
              code: publishedCode,
              name: 'S5d 无冲突样本',
              dsl: plainDsl(publishedCode),
              description: 'S5-d e2e seed（固定 code，跨次复用）'
            }))
      // 发布失败就把闸门原文抛出来：那是「样本形状过时了」的唯一线索，吞掉它就只能看到后面一堆找不到行
      const pubRes = await api(`/agent/workflow-def/publish?id=${target}`, 'POST')
      expect(pubRes?.code, `发布已发布样本失败（闸门原文）：${JSON.stringify(pubRes?.msg)}`).toBe(0)
      publishedId = target
    }

    // ③ 扫掉上一轮中途死掉时漏出的复制品草稿。
    //    留着它，「无冲突流程复制」那条用例的实时查重会当场判「已被占用」⟹ 提交按钮禁用、用例红，
    //    而红的原因与本刀功能毫无关系（首跑就是这么连红两条的）。
    const leftovers = await versionListOf(publishedCopyCode)
    for (const v of leftovers.filter((x) => x.status === 'DRAFT')) {
      await api(`/agent/workflow-def/delete?id=${v.id}`, 'DELETE').catch(() => undefined)
    }
  })

  test.afterAll(async () => {
    // 🔴 清理不靠用例体末尾（台账 #87：写在用例体里，用例一红就漏出垃圾行），一律 afterAll
    for (const id of draftIdsToDelete) {
      await api(`/agent/workflow-def/delete?id=${id}`, 'DELETE').catch(() => undefined)
    }
    await req?.dispose()
    console.log(
      `[S5-d e2e 残留声明] 固定复用的已发布样本 code=${publishedCode} id=${publishedId}` +
        `（🔴 故意不停用，理由见 publishedCode 的注释）；已删除的草稿 id=${JSON.stringify(
          draftIdsToDelete
        )}`
    )
  })

  /**
   * 按 code 搜出唯一一行。
   * 🔴 用 `.cell` 的**全等**文本定位，不用 hasText 子串：搜索框走 likeIfPresent，
   *    搜 `wf_cp_pub_e2e` 会把复制品 `wf_cp_pub_e2e_copy` 一起搜出来。
   *
   * @param statusLabel 需要再按状态钉一行时传（`草稿`/`已发布`/`已停用`）。
   *   固定 code 的已发布样本一旦走过 /rollback，同一 code 就有两行（旧的已停用 + 新的已发布），
   *   裸 `.first()` 会挑错行 —— 那种红看起来像「按钮态判错了」，真因却是夹具撞上了同名版本。
   */
  const rowOf = (page: Page, code: string, statusLabel?: string): Locator => {
    const byCode = page
      .locator('.el-table__row')
      .filter({ has: page.locator('.cell').filter({ hasText: new RegExp(`^${code}$`) }) })
    return (
      statusLabel
        ? byCode.filter({ has: page.locator('.el-tag').filter({ hasText: statusLabel }) })
        : byCode
    ).first()
  }

  const searchCode = async (page: Page, code: string, statusLabel?: string) => {
    await gotoWithAuth(page, LIST_PATH)
    const input = page.locator('input[placeholder="请输入流程编码"]')
    await input.fill(code)
    await input.press('Enter')
    await expect(rowOf(page, code, statusLabel)).toBeVisible({ timeout: 20000 })
  }

  /** 已发布样本是固定 code、可能有多版本行 ⟹ 一律按「已发布」钉住那一行（见 rowOf 的说明） */
  const searchPublished = (page: Page) => searchCode(page, publishedCode, '已发布')
  const publishedRow = (page: Page) => rowOf(page, publishedCode, '已发布')

  test('草稿行：设计常显、编辑/删除按 editable 放行、复制是普通链接', async ({ page }) => {
    await searchCode(page, conflictCode)
    const row = rowOf(page, conflictCode)

    // 🔴 「设计」常显 + 文案随 editable 切。这一条同时证明了 /page 出口**带上了** editable：
    //    拿不到这一格时 `row.editable` 为 undefined ⟹ 文案会落成「查看设计」、编辑/删除会消失，
    //    三条断言一起红。
    await expect(row.locator('[data-testid="wf-design-btn"]')).toHaveText('设计')
    await expect(row.getByRole('button', { name: '编辑' })).toBeVisible()
    await expect(row.getByRole('button', { name: '删除' })).toBeVisible()
    await expect(row.getByRole('button', { name: '发布' })).toBeVisible()
    await expect(row.locator('[data-testid="wf-copy-btn"]')).toBeVisible()
    // 草稿行走的是普通链接那一支，不该出现加粗的主操作
    await expect(row.locator('[data-testid="wf-copy-as-draft-btn"]')).toHaveCount(0)
  })

  test('已发布行：文案变「查看设计」、编辑/删除消失、复制升成主操作', async ({ page }) => {
    await searchPublished(page)
    const row = publishedRow(page)

    await expect(row.locator('[data-testid="wf-design-btn"]')).toHaveText('查看设计')
    await expect(row.getByRole('button', { name: '编辑' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: '删除' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: '发布' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: '停用' })).toBeVisible()
    await expect(row.locator('[data-testid="wf-copy-btn"]')).toHaveCount(0)
    const main = row.locator('[data-testid="wf-copy-as-draft-btn"]')
    await expect(main).toBeVisible()
    await expect(main).toHaveText('复制为新草稿')
    // 主操作必须是 plain 实心（不是 link）：这是「用户面对改不动的流程真正想做的事」的视觉承诺
    await expect(main).toHaveClass(/el-button--primary/)
    expect(await main.getAttribute('class')).not.toContain('is-link')
  })

  /**
   * 🔴 量**竖直中心**而不是 offsetTop/top：同一行里 `size="small"` 的按钮和默认尺寸按钮
   *    高度不同，顶端天然差 2px（首跑就是这么假红的：`[367,367,367,367,367,365]`）。
   *    中心线才是不受按钮高度影响的量 —— 真折行时两行中心至少差一个按钮高（≥20px）。
   */
  const buttonCenters = async (row: Locator) =>
    row.locator('td').last().locator('button').evaluateAll((els) =>
      els.map((e) => {
        const r = (e as HTMLElement).getBoundingClientRect()
        return { center: Math.round(r.top + r.height / 2), text: (e.textContent || '').trim() }
      })
    )

  /** 同一行内的中心线极差。>8px 说明折行了（8 是「2px 尺寸差」与「≥20px 折行差」之间的空档） */
  const assertOneLine = (which: string, centers: { center: number; text: string }[]) => {
    expect(centers.length, `${which}按钮数为 0`).toBeGreaterThan(0)
    const nums = centers.map((c) => c.center)
    const spread = Math.max(...nums) - Math.min(...nums)
    expect(
      spread,
      `${which}按钮折行了：中心线极差 ${spread}px，明细 ${JSON.stringify(centers)}`
    ).toBeLessThanOrEqual(8)
    return centers
  }

  /**
   * 量「这一行的按钮实际需要多宽」，返回 需求宽度 / 可用宽度。
   *
   * 🔴 不能用 `.cell` 的 scrollWidth 当需求宽度：内容不溢出时它被夹成 clientWidth
   *    （首跑就量出「需 520 / 可用 520」，余量信息全被吃掉，等于没量）。
   *    真需求 = 首末按钮外沿跨度 + 单元格左右内边距；可用 = td 的 clientWidth（含 padding、不含边框）。
   *    ⚠️ 这个量法**只在没折行时成立**，所以调用点必须排在 assertOneLine 之后。
   */
  const measureOpsWidth = async (row: Locator) =>
    row.locator('td').last().evaluate((td) => {
      const cell = td.querySelector('.cell') as HTMLElement
      const btns = Array.from(cell.querySelectorAll('button')) as HTMLElement[]
      const span = Math.ceil(
        btns[btns.length - 1].getBoundingClientRect().right -
          btns[0].getBoundingClientRect().left
      )
      const cs = getComputedStyle(cell)
      const padX = Math.ceil(parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight))
      return { needed: span + padX, avail: Math.floor(td.clientWidth), span, padX }
    })

  test('操作列不换行：所有按钮位仍在同一行内', async ({ page }) => {
    await searchCode(page, conflictCode)
    const draftRow = rowOf(page, conflictCode)
    const centers = assertOneLine('草稿行', await buttonCenters(draftRow))
    const draft = await measureOpsWidth(draftRow)

    await searchPublished(page)
    const row2 = publishedRow(page)
    const centers2 = assertOneLine('已发布行', await buttonCenters(row2))
    const published = await measureOpsWidth(row2)

    // 量出实际占宽，供 min-width 定值复核（方案说「440 必须加大」但没给新数值 ⟹ 这个数就是答案）
    console.log(
      `[S5-d 操作列实测] 草稿行 ${centers.length} 钮 需宽=${draft.needed}px 可用=${draft.avail}px；` +
        `已发布行 ${centers2.length} 钮 需宽=${published.needed}px 可用=${published.avail}px；` +
        `余量 草稿=${draft.avail - draft.needed}px 已发布=${published.avail - published.needed}px`
    )
    for (const [which, m] of [
      ['草稿行', draft],
      ['已发布行', published]
    ] as const) {
      expect(
        m.needed,
        `${which}操作列内容横向溢出：需 ${m.needed}px、只有 ${m.avail}px（按钮会被截断）`
      ).toBeLessThanOrEqual(m.avail)
    }
  })

  test('复制对话框：预填 + 实时查重（撞名时禁用提交）', async ({ page }) => {
    await searchCode(page, conflictCode)
    await rowOf(page, conflictCode).locator('[data-testid="wf-copy-btn"]').click()

    const dialog = page.locator('[data-testid="workflow-copy-dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-testid="copy-source"]')).toContainText(conflictCode)
    // 预填：{code}_copy 与 {name}（副本）
    await expect(dialog.locator('[data-testid="copy-new-code"]')).toHaveValue(copyCode)
    await expect(dialog.locator('[data-testid="copy-new-name"]')).toHaveValue('S5d 冲突样本（副本）')
    // 自动改写开关默认开。🔴 断言 class 不断言 aria-checked：`data-testid` 落在 el-switch 的**根 div**上
    //    （attrs 透传到根），而 role="switch" 的 input 在里层 —— 根 div 只有 `is-checked` 这个类
    await expect(dialog.locator('[data-testid="copy-rewrite-switch"]')).toHaveClass(/is-checked/)
    // 预填的编码也要查一次：源流程已经存在 _copy 时用户应该当场看到红字，而不是提交后被后端拒
    await expect(dialog.locator('[data-testid="copy-code-dedup"]')).toContainText('编码可用', {
      timeout: 15000
    })

    // 撞上一个已存在的编码 → 红字 + 提交禁用（拿固定复用的已发布样本当「别人已占用」的那个 code）
    const codeInput = dialog.locator('[data-testid="copy-new-code"]')
    await codeInput.fill(publishedCode)
    await expect(dialog.locator('[data-testid="copy-code-dedup"]')).toContainText('已经有流程在用', {
      timeout: 15000
    })
    await expect(dialog.locator('[data-testid="copy-submit"]')).toBeDisabled()

    await codeInput.fill(copyCode)
    await expect(dialog.locator('[data-testid="copy-code-dedup"]')).toContainText('编码可用', {
      timeout: 15000
    })
    await expect(dialog.locator('[data-testid="copy-submit"]')).toBeEnabled()
  })

  test('复制落库：清单两段都列出，且对话框不自动关', async ({ page }) => {
    await searchCode(page, conflictCode)
    await rowOf(page, conflictCode).locator('[data-testid="wf-copy-btn"]').click()
    const dialog = page.locator('[data-testid="workflow-copy-dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-testid="copy-code-dedup"]')).toContainText('编码可用', {
      timeout: 15000
    })

    await dialog.locator('[data-testid="copy-submit"]').click()

    // 🔴 复制成功后**留在清单阶段**：/copy 不跑发布体检，rewritten[] 是这一步唯一的用户可见信号，
    //    而且没有任何端点能把它再取回来一次。自动关对话框 = 永久丢掉它。
    await expect(dialog.locator('[data-testid="copy-changed-title"]')).toBeVisible({ timeout: 20000 })
    await expect(dialog).toContainText('已复制为新草稿')
    await expect(dialog).toContainText(copyCode)

    // 「服务端替你改了」段：建表名 / 表单编码 / webhook path 都该带上 _copy
    // 🔴 按 **reason** 过滤，不按表名过滤：建表名那一行和「主表跟随」那一行都含旧表名，
    //    按表名过滤会命中两行 ⟹ strict mode 直接红（首跑就是这么红的，且那两行同时出现
    //    恰恰证明了两趟改写的规则生效）
    const changed = dialog.locator('[data-testid="copy-rewrite-changed"]')
    const byReason = (reason: string) => changed.filter({ hasText: reason })
    await expect(byReason('建表名加了后缀')).toContainText(`${conflictTable}_copy`)
    await expect(byReason('表单编码加了后缀')).toContainText('cp_e2e_form_copy')
    await expect(byReason('webhook 入站路径已改写')).toContainText('wf-cp-e2e-hook_copy')
    // 主表跟上了建表名的改写 —— 这是「两趟、顺序不可换」那条规则在界面上唯一的可见证据：
    // 一趟写完的话，建表节点排在表单节点之前的这份 DSL 也会漏，表单就写进一张不存在的表
    await expect(byReason('主表跟随')).toContainText(`${conflictTable}_copy`)

    // 「刻意没改」段：审批流 / 子流程 / 验签密钥
    const kept = dialog.locator('[data-testid="copy-rewrite-kept"]')
    await expect(kept.filter({ hasText: '审批流未复制' })).toContainText('cp_e2e_bpm_key')
    await expect(kept.filter({ hasText: '子流程未复制' })).toContainText('wf_cp_e2e_sub')
    // 🔴 密钥真值绝不进清单（后端填的是掩码）。这一条是安全断言，不是文案断言。
    await expect(dialog).not.toContainText('e2e-copy-secret-do-not-log')
    await expect(kept.filter({ hasText: '验签密钥沿用' })).toBeVisible()

    // 表单阶段的控件应当已经不在（阶段切换真的发生了，而不是两个阶段叠着渲染）
    await expect(dialog.locator('[data-testid="copy-submit"]')).toHaveCount(0)
    await expect(dialog.locator('[data-testid="copy-go-design"]')).toBeVisible()

    // 关掉之后列表要能看见新草稿（@success → getList）
    await dialog.locator('[data-testid="copy-close"]').click()
    await expect(dialog).toBeHidden()
    await searchCode(page, copyCode)
    const copyRow = rowOf(page, copyCode)
    await expect(copyRow).toBeVisible({ timeout: 20000 })
    await expect(copyRow.locator('.el-tag').filter({ hasText: '草稿' }).first()).toBeVisible()

    // 记下产物 id 供 afterAll 清理（🔴 不清就是台账 #87 那种漏出的垃圾行）
    const idText = await copyRow.locator('td').nth(1).innerText()
    const newId = Number(idText.trim())
    expect(newId, `从列表读新草稿 id 失败，读到的是「${idText}」`).toBeGreaterThan(0)
    draftIdsToDelete.push(newId)
  })

  test('无冲突流程复制：清单为空是「没有冲突配置」，不是「清单不可用」', async ({ page }) => {
    await searchPublished(page)
    await publishedRow(page).locator('[data-testid="wf-copy-as-draft-btn"]').click()
    const dialog = page.locator('[data-testid="workflow-copy-dialog"]')
    await expect(dialog).toBeVisible()
    // 这条走的是**默认预填编码**（{code}_copy）直接提交：beforeAll 已扫掉上一轮漏出的同名草稿，
    // 否则查重会判「已被占用」把提交按钮禁掉，红得跟本刀功能毫无关系
    await expect(dialog.locator('[data-testid="copy-code-dedup"]')).toContainText('编码可用', {
      timeout: 15000
    })
    await dialog.locator('[data-testid="copy-submit"]').click()

    await expect(dialog).toContainText('已复制为新草稿', { timeout: 20000 })
    // ⚠️ 空清单与「清单不可用」是两回事（后者是 /validate 的 manifest === null）。措辞必须区分
    await expect(dialog).toContainText('没有需要处理的冲突配置')
    await expect(dialog).not.toContainText('清单不可用')
    await expect(dialog.locator('[data-testid="copy-rewrite-changed"]')).toHaveCount(0)
    await expect(dialog.locator('[data-testid="copy-rewrite-kept"]')).toHaveCount(0)

    await dialog.locator('[data-testid="copy-go-design"]').click()
    await expect(dialog).toBeHidden()
    // 「去设计器完善」直奔那份新草稿
    // 🔴 路由是 `remaining.ts` 里的 `/agent-workflow/editor`（连字符、且**不在** /ai/agent 下），
    //    列表页的路径 `/ai/agent/workflow` 是菜单路由 —— 两者不同源，别照着列表路径猜
    await page.waitForURL(EDITOR_URL_RE, { timeout: 20000 })
    expect(page.url()).toContain('id=')

    // 回列表把产物记下来清理
    await searchCode(page, publishedCopyCode, '草稿')
    const copyRow = rowOf(page, publishedCopyCode, '草稿')
    await expect(copyRow).toBeVisible({ timeout: 20000 })
    const newId = Number((await copyRow.locator('td').nth(1).innerText()).trim())
    expect(newId).toBeGreaterThan(0)
    draftIdsToDelete.push(newId)
  })

  test('只读画布底部有「打开完整设计器」链接，点了真的跳过去', async ({ page }) => {
    await searchPublished(page)
    await publishedRow(page).getByRole('button', { name: '查看画布' }).click()
    const canvas = page.locator('.el-dialog').filter({ hasText: '流程画布' }).first()
    await expect(canvas).toBeVisible({ timeout: 20000 })

    const link = canvas.locator('[data-testid="canvas-open-designer"]')
    await expect(link).toBeVisible()
    // 非草稿行 → 文案带「只读」。取自服务端下发的 editable，不在前端判 status
    await expect(link).toHaveText('打开完整设计器（只读）')

    await link.click()
    await expect(canvas).toBeHidden()
    await page.waitForURL(EDITOR_URL_RE, { timeout: 20000 })
  })

  test('草稿行的只读画布链接不带「只读」（editable 真的下发了）', async ({ page }) => {
    await searchCode(page, conflictCode)
    await rowOf(page, conflictCode).getByRole('button', { name: '查看画布' }).click()
    const canvas = page.locator('.el-dialog').filter({ hasText: '流程画布' }).first()
    await expect(canvas).toBeVisible({ timeout: 20000 })
    await expect(canvas.locator('[data-testid="canvas-open-designer"]')).toHaveText('打开完整设计器')
    // 🔴 必须 exact：el-dialog 右上角那个关闭按钮的 aria-label 是「关闭此对话框」，
    //    不带 exact 会同时命中它和底部那枚「关闭」⟹ strict mode 红
    await canvas.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(canvas).toBeHidden()
  })

  /**
   * S5-f：新增面板的「复制已有」不再自己拼 DSL，而是把用户交给**同一个**复制对话框。
   *
   * 🔴 钉的是行为，不是实现，三件事：
   *   ① 选中「复制已有」后面板只剩「起步模板 + 复制来源」—— 名称/编码/触发方式/经典案例/描述**一个都不渲染**。
   *      留着它们就是让人填一份**不会被使用**的配置：复制品的 trigger 原样从源流程带走，
   *      新编码/新名称由对话框问（那里才有实时查重），描述沿用源流程。
   *      这正是本平台头号缺陷形态「配了不生效且无提示」，所以「格子不见了」本身就是验收项。
   *   ② 点「下一步」弹出的是复制对话框，且预填的是**所选源流程**的 `{code}_copy`。
   *   ③ 落库走的是 `/copy` 而不是 `createDef`：判据是清单里出现那张冲突表名的改写行。
   *      前端拼装路径压根不产清单，而且它带过去的建表名与源**逐字相同**（这就是 G11）⟹ 这条断言在它下面无处可绿。
   *
   * 🔴 新编码刻意**不用**预填值：`{conflictCode}_copy` 已被前面「复制落库」那条用例占用，
   *    沿用它会撞上实时查重（提交钮禁用），红得与本刀无关。
   * 🔴 收尾走「我已读完，关闭」→ 面板「取 消」而**不是**「去设计器完善」：这条路才会经过
   *    `WorkflowForm` 的 `listDirty` —— 宿主的 `backToList` 故意不重拉数据，面板不记这一笔的话
   *    返回列表看到的还是旧列表，刚复制出来的那条不在里面，形状上等同于「复制没成功」。
   */
  test('S5-f 新增面板「复制已有」：只剩来源一格，交回复制对话框，返回后列表里真有那一行', async ({
    page
  }) => {
    const newCode = `${conflictCode}_s5f`
    /** 按 label 定位一个表单项。🔴 断言「不渲染」时必须先有正面对照，否则整块面板没渲染也会假绿 */
    const itemOf = (label: string) =>
      page.locator('.el-form-item').filter({
        has: page.locator('.el-form-item__label', { hasText: label })
      })

    await gotoWithAuth(page, LIST_PATH)
    await page.getByRole('button', { name: '新增', exact: true }).click()

    // 正面对照：默认「经典案例」档时这些格都在
    await expect(itemOf('流程名称')).toHaveCount(1)
    await expect(itemOf('触发方式')).toHaveCount(1)
    await expect(itemOf('经典案例')).toHaveCount(1)
    await expect(page.locator('[data-testid="form-submit"]')).toHaveText('确 定')

    // ① 切到「复制已有」
    const copyRadio = page.locator('.el-radio').filter({ hasText: '复制已有' })
    await copyRadio.click()
    await expect(copyRadio).toHaveClass(/is-checked/)
    await expect(itemOf('流程名称')).toHaveCount(0)
    await expect(itemOf('流程编码')).toHaveCount(0)
    await expect(itemOf('触发方式')).toHaveCount(0)
    await expect(itemOf('经典案例')).toHaveCount(0)
    await expect(itemOf('描述')).toHaveCount(0)
    await expect(itemOf('复制来源')).toHaveCount(1)
    // 按钮改口：这一步不建流程，还叫「确 定」会让人以为点完弹窗是失败了
    await expect(page.locator('[data-testid="form-submit"]')).toHaveText('下一步：填新编码')

    // 选源：用冲突样本，它的改写清单非空（③ 要据此判「走的是 /copy」）
    await page.locator('[data-testid="copy-source-select"]').click()
    // 🔴 锚定整个 label 而不是 `hasText` 子串 + `.first()`：前面「复制落库」那条用例已经造出一条
    //    `S5d 冲突样本（副本）`，它的 label 同样含「S5d 冲突样本」，而 copyOptions 是**新的在前**
    //    ⟹ `.first()` 选中的是复制品，对话框预填就成了 `{conflictCode}_copy_copy`（run1 就是这么红的）。
    //    不写 `hasNotText:'副本'`：那等于把断言押在对话框的命名约定上，而不是「我要的那一条」。
    await page
      .locator('.el-select-dropdown__item')
      .filter({ hasText: /^\s*S5d 冲突样本（v\d+）\s*$/ })
      .click()

    // ② 交回复制对话框
    await page.locator('[data-testid="form-submit"]').click()
    const dialog = page.locator('[data-testid="workflow-copy-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 20000 })
    await expect(dialog.locator('[data-testid="copy-source"]')).toContainText(conflictCode)
    await expect(dialog.locator('[data-testid="copy-new-code"]')).toHaveValue(
      `${conflictCode}_copy`
    )

    // 换成不撞名的新编码，等防抖查重自己落到「可用」（🔴 不 sleep 一个拍脑袋的数）
    await dialog.locator('[data-testid="copy-new-code"]').fill(newCode)
    await expect(dialog.locator('[data-testid="copy-code-dedup"]')).toContainText('编码可用', {
      timeout: 15000
    })
    await dialog.locator('[data-testid="copy-submit"]').click()

    // ③ 清单里出现冲突表名的改写行 ⟹ 这是服务端 /copy 的产物，不是前端拼的 DSL
    await expect(dialog.locator('[data-testid="copy-changed-title"]')).toBeVisible({
      timeout: 30000
    })
    await expect(
      dialog
        .locator('[data-testid="copy-rewrite-changed"]')
        .filter({ hasText: conflictTable })
        .first()
    ).toContainText(`${conflictTable}_copy`)

    // 读完清单关掉对话框，再从面板「取 消」回列表
    await dialog.locator('[data-testid="copy-close"]').click()
    await expect(dialog).toBeHidden()
    await page
      .locator('.panel-header')
      .getByRole('button', { name: '取 消', exact: true })
      .click()

    // 🔴 刻意**不重新导航**：这条断言守的就是 listDirty（见用例头注释）
    await expect(rowOf(page, newCode)).toBeVisible({ timeout: 20000 })

    // 登记清理（🔴 台账 #87：断言之后再登记就可能在红的时候漏出垃圾行，故先查后登记再断言）
    const created = await versionListOf(newCode)
    created.forEach((v) => draftIdsToDelete.push(v.id))
    expect(created.length, '复制品没落库').toBeGreaterThan(0)
    expect(created[0].status, '复制品必须是草稿（/copy 一律落 DRAFT）').toBe('DRAFT')
  })
})
