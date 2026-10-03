import { test, expect } from '@playwright/test'
import { login, gotoWithAuth, apiLogin, apiHeaders, API_BASE_URL } from './helpers/auth'

/**
 * 变更清单（ChangeManifest）四处宿主渲染 —— 端到端验证（重构 S3 / Req 3）
 *
 * 🔴 为什么非要走浏览器：后端单测能证明「清单算得对」（S2 那 1134 条已经证明了），
 *   但证明不了「算对的东西真被画出来、并且画成了人话」。本模块的头号缺陷形态是
 *   「配了/算了但不生效且无提示」—— 清单恰恰是那种**算对了却渲染错**会直接骗人点同意的东西：
 *   - `manifest == null` 渲染成「本次不产生任何写操作」→ 审批人放心通过，实际啥都没核实
 *   - `NOT_PROBED` 渲染成红色「不通过」→ 作者去改一份本来没问题的 DSL
 *   - 裁剪过的清单不显示 hidden 计数 → 用户以为看到了全部影响面
 *   这三条只有在真实 DOM 上才验得出来，故本 spec 全部断言写在**渲染结果**上，不重复断言后端算术。
 *
 * 🔴 用词约定（2026-10-03 起）：机器口径是 `dryRun`，**用户可见文案一律说「预演」**。
 *   「干跑」是 dry run 的直译、读不通，已从 src/ 的 7 处用户可见字符串里退场
 *   （`ManifestDryRunTag` 两态标签、`WorkflowDraftCard` 折叠条徽标、
 *   `ChangeManifestCard` 的红色置顶行 + 统计芯片 + 复制出去的 markdown 两处）。
 *   本文件里剩下的「干跑」只出现在**描述机器概念**的注释中（如「干跑三态 PASSED/REJECTED/
 *   NOT_PROBED」），刻意不改：那是后端 `dryRun` 字段的中文对照，不是界面文案。
 *   ⟹ 断言字面量必须是「预演」，注释里说「干跑」不算漂移。
 *
 * 🔴 一份 fixture 同时命中干跑三态（PASSED / REJECTED / NOT_PROBED）：
 *   这是纪律②唯一诚实的验法。三态塌成两态是这条纪律要防的缺陷，
 *   用三份各自的 fixture 分别验，就永远验不出「它们在同一个界面上被区分开了」——
 *   而用户看到的正是同一个界面。
 *
 * 🔴 0 LLM token：设计器那条打真后端（/validate 自带 manifest）；
 *   聊天那两条用 `page.route` 把 `send-stream` 换成**合成 SSE**，
 *   但事件里塞的 manifest 是 beforeAll 从真 `/manifest` 取回来的原样载荷 ——
 *   合成的是「传输」，不是「数据」。真跑 BUILD 意图要 8 分钟且烧 token，换不来更多渲染覆盖。
 *
 * 🔴 未覆盖：BPM 审批详情 + 通过弹层（宿主 #3）。S6 已把清单冻结进流程变量
 * `agent_change_manifest`（后端 `b8cf277486`），但**这个宿主至今没有 e2e**——
 * 而它恰好是台账 #90 的落点：`BpmProcessInstanceServiceImpl.fillOnlineFormData:440`
 * 对**在线表单**流程会把 `formVariables` **整体替换**成业务表行、把注入的键抹掉。
 * S6 的真跑量具读的是 `/bpm/process-instance/manager-page`（裸 Flowable 变量，
 * **压根不经过 `fillOnlineFormData`**），所以那条路径结构上量不到 #90。
 * ⟹ 补这个宿主的 e2e 时必须打 `/bpm/process-instance/get-approval-detail`，那才是前端
 *   `detail/index.vue:360` 真读的端点（`api/bpm/processInstance/index.ts:95`）。
 *   见台账 #90 与 `_evidence/verify90-approval-detail.py`（已在同款 fixture 上把两条通道并排量过）。
 *
 * 前置：后端 48080 + 前端 dev server 同时在跑。
 * 数据自净：beforeAll 建的草稿在 afterAll 删除（DRAFT 可删）。清单本身只读不落库。
 */

const TS = Date.now().toString().slice(-8)
const WF_CODE = `e2e_mf_${TS}`
const WF_NAME = `E2E变更清单${TS}`
/** webhook 触发器的 path：全库唯一，撞了会触发 triggerKey 冲突 */
const WEBHOOK_PATH = `e2e_mf_${TS}`
/** 带 biz_ 前缀 ⟹ 干跑 PASSED（后端要求业务表加前缀，见 DryRunResult 的 reason 原文） */
const T_OK = `biz_e2e_mf_ok_${TS}`
/** 不带前缀 ⟹ 干跑 REJECTED。故意留一个不合规的，红色「不通过」才有真数据可断言 */
const T_BAD = `e2e_mf_bad_${TS}`
const FORM_CODE = `e2e_mf_f_${TS}`
const FORM_NAME = `E2E清单表单${TS}`
/** 只读工具：验「计数但不进 changes」—— 后端 WorkflowChangeManifestBuilder 的纪律 */
const READ_TOOL = 'form_list'

let token: string
let defId: number
/** 从真 `/manifest` 取回的三份载荷：全流程、按 n_form 裁剪过、以及给「不可用」用例用的 null */
let fullManifest: any
let scopedManifest: any

function buildDsl(): string {
  return JSON.stringify({
    dslVersion: '1.0',
    id: WF_CODE,
    name: WF_NAME,
    description: 'S3 e2e：建表（合规/不合规各一）+ 建表单草稿 + 一个只读工具，0 LLM token',
    // 🔴 只能用 webhook：后端 WorkflowTriggerExtractor 认 chat/form_event/schedule/webhook 四种，
    //    而本例要验的是「污点溯源认得出外部输入源」—— 只有 trigger.webhook 会产生 TRIGGER_WEBHOOK 这个源，
    //    故下面 n_read 的 {{$.input}} 能被认出来。
    // 🔴 #72 起 authType 只能是 hmac/token 且 secret 必填（落库前就拒）。这里给一个字面量 secret：
    //    它与 path 一样只是 DSL 里的一个字符串，不需要任何前置数据。
    //    （本例从不真的 POST /agent/webhook/{path}，所以密钥是什么无所谓，也就无需造签名。）
    //    ⚠️ 原来这里写的是 authType:'none'，注释声称「只有 none 不需要额外造前置数据」——
    //    那句前提是假的：secret 同样是字面量；何况 schedule 也只靠一个 cron 字符串。
    trigger: {
      type: 'trigger.webhook',
      config: { path: WEBHOOK_PATH, authType: 'hmac', secret: 'e2e-only-not-a-real-secret' }
    },
    variables: [
      { key: 'input', type: 'string', merge: 'replace', required: false },
      { key: 'output', type: 'object', merge: 'replace' }
    ],
    nodes: [
      {
        id: 'n_ok',
        type: 'tool',
        name: '建表通过',
        config: {
          toolId: 'datamodel_create',
          args: {
            model: {
              modelName: `E2E模型OK${TS}`,
              tableName: T_OK,
              tableComment: '前缀合规的表',
              columns: [
                {
                  columnName: 'title',
                  columnComment: '标题',
                  columnType: 'VARCHAR',
                  length: 100,
                  nullable: false
                },
                // scale 与 length 一起给：清单要能显示 DECIMAL(10,2)，
                // 只显示「精度 10」的话审批人看不出小数位 —— 而金额的小数位最需要人确认
                { columnName: 'amount', columnComment: '金额', columnType: 'DECIMAL', length: 10, scale: 2 }
              ],
              indexes: [{ indexName: 'idx_title', indexType: 'NORMAL', columnNames: ['title'] }]
            }
          },
          outputVar: 'output'
        }
      },
      {
        id: 'n_bad',
        type: 'tool',
        name: '建表被拒',
        config: {
          toolId: 'datamodel_create',
          args: {
            model: {
              modelName: `E2E模型BAD${TS}`,
              tableName: T_BAD,
              tableComment: '缺业务前缀的表',
              columns: [{ columnName: 'memo', columnComment: '备注', columnType: 'VARCHAR', length: 50 }]
            }
          },
          outputVar: 'output'
        }
      },
      {
        id: 'n_form',
        type: 'tool',
        name: '建表单草稿',
        config: {
          toolId: 'form_save_draft',
          args: {
            code: FORM_CODE,
            name: FORM_NAME,
            mainTable: T_OK,
            fields: [
              {
                field: 'title',
                title: '标题',
                widget: 'input',
                jdbcType: 'VARCHAR',
                required: true,
                searchable: true,
                operator: 'LIKE'
              },
              { field: 'amount', title: '金额', widget: 'number', jdbcType: 'DECIMAL', searchable: false }
            ]
          },
          outputVar: 'output'
        }
      },
      {
        // 只读工具 + 外部入参：一个节点同时验两件事 ——
        // ① 它不该出现在 changes 里，但要被 readToolCount 记上
        // ② {{$.input}} 从 webhook 流到这里，untrustedInputs 该有一条
        id: 'n_read',
        type: 'tool',
        name: '查表单清单',
        config: { toolId: READ_TOOL, args: { name: '{{$.input}}' }, outputVar: 'output' }
      }
    ],
    edges: [
      { from: 'START', to: 'n_ok' },
      { from: 'n_ok', to: 'n_bad' },
      { from: 'n_bad', to: 'n_form' },
      { from: 'n_form', to: 'n_read' },
      { from: 'n_read', to: 'END' }
    ],
    settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
  })
}

/** 合成 SSE：外层是 CommonResult 信封，`code !== 0` 会被 fetchEventSource 当成整条流失败 */
function sseBody(events: any[]): string {
  return [...events, { type: 'DONE' }]
    .map((data) => `data: ${JSON.stringify({ code: 0, data })}\n\n`)
    .join('')
}

test.describe('变更清单渲染（S3）：四处宿主共用一个组件，三条纪律一处都不许塌', () => {
  test.setTimeout(180_000)

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)
    const H = apiHeaders(token)

    const created = (await (
      await request.post(`${API_BASE_URL}/agent/workflow-def/create`, {
        headers: H,
        data: { code: WF_CODE, name: WF_NAME, dsl: buildDsl() }
      })
    ).json()) as { code: number; data?: number; msg?: string }
    expect(created.code, `建草稿失败：${created.msg ?? JSON.stringify(created)}`).toBe(0)
    defId = created.data!

    // 🔴 dsl 与 id **互斥**（后端 1041006019「两份都给了，无法判断要预览哪一份」）。
    //    这里给 dsl：要的是「这份 DSL 跑起来会改什么」，与 /validate 附带的同一口径
    const full = (await (
      await request.post(`${API_BASE_URL}/agent/workflow-def/manifest`, {
        headers: H,
        data: { dsl: buildDsl() }
      })
    ).json()) as { code: number; data?: any; msg?: string }
    expect(full.code, `取全流程清单失败：${full.msg ?? ''}`).toBe(0)
    fullManifest = full.data

    // 🔴 前置断言：fixture 必须真命中干跑三态，否则下面纪律②的三条断言全是**假通过**
    //    （三态只剩两态时，「NOT_PROBED 渲染成黄色」这条会因为压根没有黄色标签而悄悄不验）
    const outcomes = (fullManifest.changes ?? []).map((c: any) => c.dryRun?.outcome).sort()
    expect(outcomes, `fixture 不再命中干跑三态，实际是 ${JSON.stringify(outcomes)}`).toEqual([
      'NOT_PROBED',
      'PASSED',
      'REJECTED'
    ])
    // 只读工具「计数但不进 changes」：这两条一起才证明 changes 里没有它是**刻意的**
    expect(fullManifest.stats.readToolCount, '只读工具没被计数，「不进 changes」就无从区分是刻意还是漏了').toBe(1)
    expect(
      (fullManifest.changes ?? []).some((c: any) => c.tool === READ_TOOL),
      `只读工具 ${READ_TOOL} 出现在 changes 里了 —— 那「无写操作」这个绿标就不再可信`
    ).toBe(false)
    // 污点溯源要真有一条，否则「独立计数」那条断言也是假通过
    expect(fullManifest.untrustedInputs?.length, 'fixture 没产生污点流向').toBe(1)

    const scoped = (await (
      await request.post(`${API_BASE_URL}/agent/workflow-def/manifest`, {
        headers: H,
        data: { dsl: buildDsl(), fromNodeId: 'n_form' }
      })
    ).json()) as { code: number; data?: any; msg?: string }
    expect(scoped.code, `取裁剪清单失败：${scoped.msg ?? ''}`).toBe(0)
    scopedManifest = scoped.data
    // 🔴 纪律③的前提：这份必须真被裁剪过。pruned 为 false 时 hiddenChanges 是 0，
    //    「显示出裁剪记账」那条断言会因为没东西可显示而假通过
    expect(scopedManifest.scope?.pruned, 'fromNodeId=n_form 没有产生裁剪，纪律③没法验').toBe(true)
    expect(scopedManifest.scope.hiddenChanges, '裁剪了却没有隐藏项，记账无从断言').toBe(2)
  })

  test.afterAll(async ({ request }) => {
    // DRAFT 可删（PUBLISHED 不行）；本 spec 从不发布，所以这里一定删得掉
    if (defId) {
      await request.delete(`${API_BASE_URL}/agent/workflow-def/delete?id=${defId}`, {
        headers: apiHeaders(token)
      })
    }
  })

  test('宿主④ 设计器影响面：四块明细 + 预演三态同屏不塌 + 独立污点计数', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, `/agent-workflow/editor?id=${defId}`)

    // 点「体检」。🔴 不发第二个请求：/validate 的响应本身就附带 manifest（S2-f 起），
    //    所以影响面是「点完体检紧接着出现」，不需要再找一个按钮
    await page.getByRole('button', { name: '体检', exact: true }).click()

    const card = page.getByTestId('designer-manifest')
    await expect(card).toBeVisible({ timeout: 30000 })

    // 🔴 toast 不许在清单预演被拒时还说「没有发现问题」：预演被拒时 passed 恒为 false
    //    （WorkflowDslValidator.foldDryRunRejections 无条件把每条 REJECTED 折进 errors），
    //    所以用户看到的第一句话必须是 error 型「体检未通过」，而不是 success 的「没有发现问题」。
    //    红色「预演不通过」明细仍在卡片里，由下面的 manifest-conflict / manifest-tables 各断言钉住。
    //
    //    #86 路径 A（2026-10-03 落地）：editor/index.vue 里那段「passed 为真 且 dryRunRejected>0」
    //    的 warning 分支是 S4a-c 之后留下的死代码，已删；本断言相应从「warning 干跑不通过」
    //    改为「error 体检未通过」，不再期待那个不可达的 toast。
    //    ⚠️ 那次落地**没跑过本 spec**（`_evidence` 里 10:10 之后没有 e2e 日志），
    //    本条断言的第一次实跑是 2026-10-03 改「干跑」→「预演」这一刀，见 _evidence/e2e-*.log。
    await expect(page.locator('.el-message--error').last()).toContainText('体检未通过')

    // ---------- 头部：headline / riskNote / 版本 / 触发器 ----------
    const headline = card.getByTestId('manifest-headline')
    await expect(headline).toContainText('将新建 2 张数据表、新建 1 张表单')
    await expect(headline).toContainText('不可逆')
    // version 为 null ⟹ 显示「草稿」而不是空着或显示「v0」
    await expect(headline).toContainText('草稿')

    // 裁定⑩：污点条数是**独立计数**，不进 headline / riskNote
    const untrustedCount = card.getByTestId('manifest-untrusted-count')
    await expect(untrustedCount).toBeVisible()
    await expect(untrustedCount).toContainText('另有 1 处外部输入')
    // 🔴 反向断言：headline 那**一句话**里不许混进污点条数（它挂在同一个头部块的下面一行）。
    //    混进去就等于两个信号共用一句话，用户学会忽略整句 —— 裁定⑩要防的正是这个
    await expect(headline.locator('div.text-14px')).toHaveText('将新建 2 张数据表、新建 1 张表单')

    // 触发器与唤醒方式（裁定⑬的 S3 半边）。本流程没有人工闸口且未被裁剪，故是「一路跑到底」
    const triggerNote = card.getByTestId('manifest-trigger-note')
    await expect(triggerNote).toContainText('Webhook')
    // 🔴 反向断言，且是这条用例真正的**强制点**：TRIGGER_LABELS 的键若写成裸 `webhook`，
    //    查表全落空、`|| w.triggerType` 会静默兜住，界面就成了「本流程由「trigger.webhook」触发」。
    //    只断言「含 Webhook」在某些回落路径下仍可能碰巧过关，故直接钉死机器键不许出现
    await expect(triggerNote).not.toContainText('trigger.')
    await expect(triggerNote).toContainText('全程无人工闸口')

    // ---------- 纪律②：干跑被拒进红色置顶，且 reason 是后端原文 ----------
    const blocker = card.getByTestId('manifest-conflict')
    await expect(blocker).toHaveCount(1)
    await expect(blocker).toContainText('缺少业务表前缀')

    // ---------- 纪律②核心：三态同屏，颜色不许塌 ----------
    // 🔴 含 blocker ⟹ mustShowDetail 为真 ⟹ 明细默认展开，不必先点开关
    const tables = card.getByTestId('manifest-tables')
    await expect(tables).toBeVisible({ timeout: 10000 })

    const okGroup = tables.locator('div.mb-10px').filter({ hasText: T_OK }).first()
    const badGroup = tables.locator('div.mb-10px').filter({ hasText: T_BAD }).first()
    const okTag = okGroup.getByTestId('dry-run-tag')
    const badTag = badGroup.getByTestId('dry-run-tag')

    await expect(okTag).toHaveText('预演通过')
    await expect(badTag).toHaveText('预演不通过')
    // 🔴 这两条是纪律②的**强制点**：只看文案不够，文案对了颜色错了照样骗人
    //    （红色 = 需要立刻处理，绿色 = 可以放心）。el-tag 的类型落在 class 上
    await expect(okTag).toHaveClass(/el-tag--success/)
    await expect(badTag).toHaveClass(/el-tag--danger/)

    // 表单那一格是 NOT_PROBED：黄色「本次没校验」，**不是**红色「不通过」
    const formFields = card.getByTestId('manifest-form-fields')
    await expect(formFields).toBeVisible({ timeout: 10000 })
    const notProbedTag = formFields.getByTestId('dry-run-tag')
    await expect(notProbedTag).toHaveText('本次没校验')
    await expect(notProbedTag).toHaveClass(/el-tag--warning/)
    // 🔴 反向断言：这一格绝不能被染成红色。把「没核实」说成「核实过且不行」，
    //    作者会去改一份本来没问题的 DSL —— 这是纪律②要消灭的那个具体后果
    await expect(notProbedTag).not.toHaveClass(/el-tag--danger/)
    // reason 是后端原文照抄、挂在 tooltip 上，不自己编话。
    // 🔴 这条要**悬停**才验得出来：reason 不在 DOM 文本里，只在浮层里。
    //    不验它的话，三态文案对了但「为什么」全是空的，用户照样无从判断
    await notProbedTag.hover()
    await expect(page.locator('.el-popper[role="tooltip"]').filter({ hasText: '本次没探' }).first()).toBeVisible({
      timeout: 10000
    })

    // ---------- 明细四块：表 / 字段 / 控件 / 查询条件 ----------
    // 表：列名、DECIMAL(10,2) 的完整精度、索引
    await expect(okGroup).toContainText('title')
    await expect(okGroup).toContainText('DECIMAL(10,2)')
    await expect(okGroup).toContainText('idx_title')
    // 🔴 TABLE_CREATE 没有「操作」列：新增/修改/删除三类列并进同一张表是 **TABLE_ALTER** 才有的事，
    //    建表时画一列全是「新增」的「操作」是噪音。而改表时不画就是把删列伪装成例行变更
    await expect(okGroup.locator('.el-table__header th').filter({ hasText: '操作' })).toHaveCount(0)
    // 「对应控件」列出现了，且是按列名 ↔ 表单字段名对出来的（控件信息不在表列上）
    await expect(okGroup.locator('.el-table__header th').filter({ hasText: '对应控件' })).toHaveCount(1)
    await expect(okGroup).toContainText('单行输入')

    // 字段：中文名 + 必填
    await expect(formFields).toContainText(FORM_NAME)
    await expect(formFields).toContainText('标题')
    await expect(formFields).toContainText('金额')

    // 查询条件：只有 searchable 的那个字段进得来，操作符已翻译成中文
    const search = card.getByTestId('manifest-search-conditions')
    await expect(search).toBeVisible({ timeout: 10000 })
    await expect(search).toContainText('标题')
    await expect(search).toContainText('包含')
    // 🔴 amount 明确 searchable:false，它出现在查询区就是「读了但没照做」
    await expect(search).not.toContainText('金额')

    // ---------- 摘要计数 ----------
    const stats = card.getByTestId('manifest-stats')
    // 🔴 断在「新建表」那一格芯片上，而不是整块 stats 含不含 "2"：
    //    "2" 在这块里到处都是（不可逆 2、预演被拒…），宽断言等于没断 —— 计数错位也照样绿
    await expect(stats.locator('span').filter({ hasText: '新建表' }).first()).toContainText('2')
    await expect(stats.locator('span').filter({ hasText: '预演被拒' }).first()).toContainText('1')
    // 🔴 只读工具「计数但不进 changes」在前端的落点：没有这一格，
    //    「changes 里没有 form_list」就分不清是「扫过了确实不写」还是「压根没扫到」
    await expect(stats.locator('span').filter({ hasText: '只读工具' }).first()).toContainText('1')

    // ---------- 污点明细 ----------
    const untrusted = card.getByTestId('manifest-untrusted')
    await expect(untrusted).toBeVisible({ timeout: 10000 })
    await expect(untrusted).toContainText('webhook')
    await expect(untrusted).toContainText('查表单清单')

    // ---------- 折叠开关：明细收得起来，也展得回去 ----------
    const toggle = card.getByTestId('manifest-detail-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(card.getByTestId('manifest-tables')).toBeHidden()
    // 🔴 收起后头部结论必须还在：headline / blocker / 计数是「不点开也要看见」的那部分，
    //    跟着一起收起来就等于把结论藏进折叠里
    await expect(card.getByTestId('manifest-headline')).toBeVisible()
    await expect(card.getByTestId('manifest-conflict')).toBeVisible()
    await toggle.click()
    await expect(card.getByTestId('manifest-tables')).toBeVisible()
  })

  test('宿主② 草稿卡「变更预演」：不点开也知道值不值得点开（合成 SSE，0 LLM token）', async ({ page }) => {
    // 🔴 必须在 login/goto 之前挂：fetchEventSource 走的是 fetch，拦截晚一步请求就真发出去了
    await page.route('**/agent/assistant/send-stream', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody([
          {
            type: 'WORKFLOW_DRAFT',
            workflowDefId: defId,
            workflowCode: WF_CODE,
            workflowName: WF_NAME,
            summary: `${WF_NAME}（合成草稿）`,
            warnings: []
          }
        ])
      })
    )

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    await page.locator('textarea[placeholder*="问点什么吧"]').first().fill('帮我建一条建表建表单的流程')
    await page.getByRole('button', { name: /发送/ }).first().click()

    const card = page.getByTestId('workflow-draft-card').first()
    await expect(card).toBeVisible({ timeout: 30000 })

    // WORKFLOW_DRAFT 事件里**刻意不带 manifest**（单一装配路径）：清单由随后那次真
    // `workflow-draft` GET 组装。所以卡片上这份确实是后端算的，不是合成流里塞的
    const title = card.getByTestId('draft-manifest-title')
    await expect(title).toBeVisible({ timeout: 20000 })
    await expect(title).toContainText('变更预演')

    // 🔴 必须用**直接子级**选择器：清单卡内部还嵌着折叠（每张表的「索引 N 个」就是一个
    //    el-collapse-item），后代选择器会连着它们一起命中 ⟹ strict mode 违规。
    //    顺带这也说明卡片里那个嵌套折叠是真实存在的，不是本用例臆想的结构
    const header = card.locator('.manifest-collapse > .el-collapse-item > .el-collapse-item__header')
    // 折叠条上的风险徽标：不点开也能知道值不值得点开。
    // 🔴 本 fixture 同时满足「预演不通过」与「含不可逆动作」，出来的是前者 ——
    //    这是 manifestRisk 里刻意的优先级：预演被拒是「照这么改跑不通」，比「改完撤不回」更硬，
    //    两个徽标并排会互相稀释，只能出一个，就出更该拦住人的那个
    await expect(header).toContainText('预演不通过')

    // 🔴 自动展开：这一条守的是 el-collapse 的 v-model 必须是「展开项 name 数组」而不是 boolean。
    //    绑 false 上去它跟任何 name 都不相等 ⟹ 恒收起且不报错，自动展开的逻辑就成了死代码。
    //    建表这类不可逆动作该在确认卡上就看见，而不是等运行完才发现多了一张表
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    const inner = card.getByTestId('draft-manifest')
    await expect(inner.getByTestId('manifest-headline')).toBeVisible({ timeout: 15000 })
    await expect(inner.getByTestId('manifest-headline')).toContainText('将新建 2 张数据表')
    await expect(inner.getByTestId('manifest-tables')).toBeVisible()
  })

  test('宿主① HITL 确认卡：显示名优先 + 纪律③裁剪记账一个都不少（合成 SSE，0 LLM token）', async ({ page }) => {
    await page.route('**/agent/assistant/send-stream', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody([
          {
            type: 'WORKFLOW_CONFIRM',
            executionId: 999999,
            nodeId: 'n_form',
            nodeName: '建表单草稿',
            content: '即将新建表单，确认继续吗？',
            // 🔴 塞的是 beforeAll 从真 /manifest 取回的**裁剪过**的载荷原样，不是手搓的假数据：
            //    合成的是传输，不是数据。手搓的话等于拿自己的想象验自己的实现
            manifest: scopedManifest
          }
        ])
      })
    )

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    await page.locator('textarea[placeholder*="问点什么吧"]').first().fill('跑一下这条流程')
    await page.getByRole('button', { name: /发送/ }).first().click()

    const card = page.getByTestId('hitl-confirm-card').first()
    await expect(card).toBeVisible({ timeout: 30000 })

    // Req3：显示名优先，机器键退居其次。`n_form` 对审批人没有信息量，「建表单草稿」才是他能据以判断的
    await expect(card).toContainText('建表单草稿')
    await expect(card.getByTestId('hitl-node-id')).toHaveText('n_form')

    const manifest = card.getByTestId('hitl-manifest')
    await expect(manifest).toBeVisible({ timeout: 15000 })

    // 🔴 纪律③：裁剪不许静默。这份只覆盖 n_form 及之后，此前 2 项变更没列出 ——
    //    不显示这句话，用户看到的就是「一份声称自己完整、其实不完整」的清单，
    //    而他会照着它点同意
    const scopeNote = manifest.getByTestId('manifest-scope-note')
    await expect(scopeNote).toBeVisible()
    await expect(scopeNote).toContainText('建表单草稿')
    await expect(scopeNote).toContainText('2 项变更没有列出')

    // 裁剪后只剩 FORM_CREATE 一格，被裁掉的两张建表不该出现
    await expect(manifest.getByTestId('manifest-tables')).toHaveCount(0)
    await expect(manifest.getByTestId('manifest-form-fields')).toContainText(FORM_NAME)

    // 🔴 触发器注解在裁剪态下**不许**说「全程无人工闸口」：
    //    approvals 为空是因为上游被裁掉了，不是因为真的没有闸口。
    //    这里 hiddenApprovals 恰好是 0，所以走的是「一路跑到底」那句 ——
    //    但必须确认它说的是本清单范围内的事，而不是替整条流程打包票
    const triggerNote = manifest.getByTestId('manifest-trigger-note')
    await expect(triggerNote).toBeVisible()
    await expect(triggerNote).toContainText('Webhook')
  })

  test('纪律①：manifest 为 null 渲染成「清单不可用」，绝不是「本次不产生任何写操作」', async ({ page }) => {
    await page.route('**/agent/assistant/send-stream', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody([
          {
            type: 'WORKFLOW_CONFIRM',
            executionId: 999998,
            nodeId: 'n_form',
            nodeName: '建表单草稿',
            content: '即将新建表单，确认继续吗？',
            // 后端 buildManifestOrNull 失败时就是给 null（附带版可以缺席，专门要清单的端点不许假装成功）
            manifest: null
          }
        ])
      })
    )

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    await page.locator('textarea[placeholder*="问点什么吧"]').first().fill('跑一下这条流程')
    await page.getByRole('button', { name: /发送/ }).first().click()

    const card = page.getByTestId('hitl-confirm-card').first()
    await expect(card).toBeVisible({ timeout: 30000 })

    const manifest = card.getByTestId('hitl-manifest')
    await expect(manifest).toBeVisible({ timeout: 15000 })
    await expect(manifest.getByTestId('manifest-unavailable')).toBeVisible()

    // 🔴 这条**反向**断言才是纪律①的本体：null 与「查过了，确实什么都不改」在数据上都是
    //    「没有变更项」，但一个是「不知道」一个是「知道且为空」。渲染成同一句话，
    //    审批人就会把「平台没核实」读成「核实过没问题」然后放心点通过
    await expect(manifest).not.toContainText('本次不产生任何写操作')
    // 也不许渲染出一个空的绿色「无写操作」徽标来冒充结论
    await expect(manifest.getByTestId('manifest-stats')).toHaveCount(0)

    // 「同意」按钮仍然可点：清单缺席不该把流程卡死（缺席是可见的，但不是阻断性的）
    await expect(card.getByTestId('hitl-approve')).toBeVisible()
  })
})
