import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiHeaders, apiLogin, gotoWithAuth } from './helpers/auth'

/**
 * 设计器只读态 + 顶栏「影响面」（重构 S5-e / 方案 §3-L4 4.3）
 *
 * 🔴 为什么这些断言只能在真浏览器里做：本刀改的全是模板层的条件渲染与禁用态
 *    （只读 banner 的 v-if、两个出口按钮、写动作的 :disabled、影响面按钮**不**跟只读联动），
 *    而前端没有组件测试设施（没装 @vue/test-utils）⟹ 绑错一个字，单测和 ts:check 都不会红。
 *
 * 本 spec 钉四件事：
 * ① 只读 banner 的文案**逐字取自后端** `editDeniedReason`（G14：可编辑性规则不在前端重写第二遍）；
 * ② 只读态下写动作全禁，而「影响面」仍然可用 —— 那里「体检」是禁用的，影响面是唯一入口；
 * ③ 影响面面板必须自己说清「量的是哪一版」：/manifest 的 dsl 与 id 二选一，
 *    干净画布走 id、脏画布走 dsl，两条路的结论不是同一份东西；
 * ④ banner 的两个出口真的通：复制打开对话框并预填源流程，回滚把设计器切到新草稿。
 *
 * ⚠️ 台账 #109：hasPermi 对 `*:*:*` 短路、e2e 恒以 admin 登录 ⟹ 本 spec **证明不了**
 *    两个出口按钮挂的 `agent:workflow:create` 对无权用户是否真的隐藏。
 *
 * 🔴 自 seed 自净：草稿样本用时间戳 code（afterAll 删）；已发布样本用**固定 code + 有就复用**
 *    （已发布的行是不可变快照、/delete 只放行草稿 ⟹ 时间戳 code 等于每跑一次永久多一条垃圾行，
 *    理由与做法同 agent-workflow-copy.spec.ts 的 publishedCode）。回滚出的新草稿也进 afterAll 清单。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev :80 在跑。
 */

const API = 'http://127.0.0.1:48080/admin-api'

/** 不含任何冲突配置的 DSL（chat + 一个只读工具节点）。与另外两个 spec 同一形状：已知可发布、也能出清单 */
const plainDsl = (code: string, name: string) =>
  JSON.stringify(
    {
      dslVersion: '1.0',
      id: code,
      name,
      description: 'S5-e e2e 样本',
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

test.describe('设计器只读态与影响面（S5-e）', () => {
  test.setTimeout(240_000)

  const stamp = Date.now().toString(36)
  const draftCode = `wf_ro_d_${stamp}`
  const draftName = 'S5e 草稿样本'
  /** 已发布样本：固定 code + 复用优先（理由见文件头） */
  const publishedCode = 'wf_ro_pub_e2e'
  const publishedName = 'S5e 已发布样本'

  let req: APIRequestContext
  let token = ''
  /** 一律 DRAFT、可删；afterAll 清理（含回滚用例产出的那一版） */
  const draftIdsToDelete: number[] = []
  let draftId = 0
  let publishedId = 0
  /** 后端下发的「为什么不能改」原文。banner 必须逐字用它，故这里取接口而不写字面量 */
  let deniedReason = ''

  const api = async (path: string, method = 'GET', body?: any) => {
    const r = await req.fetch(API + path, {
      method,
      data: body,
      headers: { 'Content-Type': 'application/json', ...apiHeaders(token) }
    })
    return r.json()
  }

  /**
   * 🔴 逐步断言而不是「造完再说」：seed 静默失败时，后面的用例只会报「找不到元素」，
   *    而真因是夹具压根没造出来（台账 #128 那一族：前置挂了却把账算到用例头上）。
   */
  const seed = async (what: string, path: string, body?: any, method = 'POST') => {
    const res = await api(path, method, body)
    expect(res?.code, `${what} 失败：${JSON.stringify(res)}`).toBe(0)
    return res.data
  }

  type Version = { id: number; code: string; version: number; status: string }

  /** 按 code 精确取版本列表（eq 匹配，version 倒序）。不用 /page?code=：那条是 like，会捞回复制品 */
  const versionListOf = async (code: string): Promise<Version[]> =>
    ((await api(`/agent/workflow-def/version-list?code=${code}`))?.data ?? []) as Version[]

  /** 设计器路由：`router/modules/remaining.ts` 的 `/agent-workflow/editor`（隐藏路由，不在 /ai/agent 下） */
  const editorUrl = (id: number) => `/agent-workflow/editor?id=${id}`

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext()
    token = await apiLogin(req)

    // ① 草稿样本（时间戳 code ⟹ 完全自净）
    draftId = await seed('造草稿样本', '/agent/workflow-def/create', {
      code: draftCode,
      name: draftName,
      dsl: plainDsl(draftCode, draftName),
      description: 'S5-e e2e seed'
    })
    draftIdsToDelete.push(draftId)

    // ② 已发布样本：复用优先。没有现成的就「剩草稿直接发 / 只剩停用行则回滚出新版本再发」
    //    （不能再调 /create：同 code 会被 WORKFLOW_DEF_CODE_DUPLICATE 拒）
    const versions = await versionListOf(publishedCode)
    const live = versions.find((v) => v.status === 'PUBLISHED')
    let pubId = live?.id
    if (!pubId) {
      const draft = versions.find((v) => v.status === 'DRAFT')
      pubId =
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
              name: publishedName,
              dsl: plainDsl(publishedCode, publishedName),
              description: 'S5-e e2e seed（固定 code，跨次复用）'
            }))
      // 发布失败就把闸门原文抛出来：那是「样本形状过时了」的唯一线索，吞掉它就只能看到后面一堆找不到元素
      const pubRes = await api(`/agent/workflow-def/publish?id=${pubId}`, 'POST')
      expect(pubRes?.code, `发布已发布样本失败（闸门原文）：${JSON.stringify(pubRes?.msg)}`).toBe(0)
    }
    publishedId = pubId

    // ③ 取「为什么不能改」的原文。这是 ①号用例的期望值，必须来自接口：
    //    写成字面量的话，前端就算自己编了一句一模一样的也照样绿，那条断言就白写了。
    const got = await api(`/agent/workflow-def/get?id=${publishedId}`)
    expect(got?.code, `读已发布样本失败：${JSON.stringify(got)}`).toBe(0)
    expect(got.data.editable, 'S5-c 的 editable 没下发，本 spec 的前提不成立').toBe(false)
    deniedReason = got.data.editDeniedReason ?? ''
    // 🔴 必须非空：空串会让 toContainText('') 无条件通过，把 ①号用例变成假绿
    expect(deniedReason.trim(), '后端没给 editDeniedReason，「文案取后端」这条无从验起').not.toBe('')

    console.log(
      `[S5-e e2e 夹具] 草稿 id=${draftId} code=${draftCode}；已发布样本 id=${publishedId} code=${publishedCode}` +
        `（${live ? '复用' : '本次新发布'}）；editDeniedReason=「${deniedReason}」`
    )
  })

  test.afterAll(async () => {
    // 🔴 清理一律放 afterAll（台账 #87：写在用例体里，用例一红就漏出垃圾行）
    for (const id of draftIdsToDelete) {
      await api(`/agent/workflow-def/delete?id=${id}`, 'DELETE').catch(() => undefined)
    }
    console.log(
      `[S5-e e2e 残留声明] 固定复用的已发布样本 code=${publishedCode} id=${publishedId}` +
        `（🔴 故意不停用：停用等于作废样本，下一轮只能再造一行，残留就回到无界增长）`
    )
    await req.dispose()
  })

  test('① 只读态：banner 逐字用后端那句拒绝理由，两个出口都在，写动作全禁', async ({ page }) => {
    await gotoWithAuth(page, editorUrl(publishedId))

    const banner = page.getByTestId('readonly-banner')
    await expect(banner).toBeVisible({ timeout: 30000 })
    // 🔴 逐字包含后端原文，不是「包含某个关键词」：这一条钉的就是「文案不在前端手写」。
    //    前端若自己编一句（哪怕意思一样），这里就红。
    await expect(banner).toContainText(deniedReason)

    await expect(page.getByTestId('banner-copy-btn')).toBeEnabled()
    await expect(page.getByTestId('banner-rollback-btn')).toBeEnabled()

    // 写动作全禁。🔴「影响面」反过来必须**可用**：只读态下「体检」是禁用的，
    //    影响面成了看清「这条流程跑起来会动什么」的唯一入口，而那恰恰是决定要不要另出一份草稿
    //    之前最该看的东西 —— 所以它只按「画布有没有就绪」禁用，不按 readonly 禁用。
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '保存并发布', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '体检', exact: true })).toBeDisabled()
    await expect(page.getByTestId('manifest-btn')).toBeEnabled()
    await expect(page.locator('.wf-editor__name input')).toBeDisabled()

    // 身份区那枚 12px 的「只读」小标签已被整条 banner 取代（连 CSS 一起删了，留着就是死样式）
    await expect(page.locator('.wf-editor__ro')).toHaveCount(0)
  })

  test('② 只读态也能拉影响面，且面板自己说清量的是哪一版', async ({ page }) => {
    await gotoWithAuth(page, editorUrl(publishedId))
    await expect(page.getByTestId('readonly-banner')).toBeVisible({ timeout: 30000 })

    await page.getByTestId('manifest-btn').click()
    const panel = page.getByTestId('manifest-panel')
    await expect(panel).toBeVisible({ timeout: 30000 })
    // 画布干净 ⟹ 走 id 那一路（带执行历史 + 台账 #81 的「已落地」降档）。
    // 🔴 面板必须把这件事说出来：用户无法自己推出「这份清单量的是库里那版还是我手上这版」。
    await expect(panel).toContainText('量的是库里已保存的这一版')
    await expect(page.getByTestId('designer-manifest-explicit')).toBeVisible()

    // 收起要整块消失，不是留个空壳占着画布高度
    await panel.getByRole('button', { name: '收起', exact: true }).click()
    await expect(panel).toHaveCount(0)
  })

  test('③ 草稿态：没有 banner；改脏之后影响面改口「画布上未保存的改动」', async ({ page }) => {
    await gotoWithAuth(page, editorUrl(draftId))

    // 🔴 先等「这一版真加载出来了」的正向证据，再断言 banner 不存在：
    //    页面还没渲染时 banner 当然也不存在，直接断 toHaveCount(0) 是假绿。
    const nameInput = page.locator('.wf-editor__name input')
    await expect(nameInput).toHaveValue(draftName, { timeout: 30000 })
    await expect(page.getByTestId('readonly-banner')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled()

    await page.getByTestId('manifest-btn').click()
    const panel = page.getByTestId('manifest-panel')
    await expect(panel).toContainText('量的是库里已保存的这一版', { timeout: 30000 })

    // 改名称把页面弄脏（@input → markDirty）。此后画布上这份与库里那版不再同源，
    // 🔴 必须改走 dsl：拿 id 去问就会把「另一版的影响面」摆到用户面前，而他可能据此决定发不发。
    await nameInput.fill(`${draftName}（已改脏）`)
    await page.getByTestId('manifest-btn').click()
    await expect(panel).toContainText('量的是画布上未保存的改动')
  })

  test('④ banner 的「复制为新草稿」打开复制对话框并预填源流程', async ({ page }) => {
    await gotoWithAuth(page, editorUrl(publishedId))
    await expect(page.getByTestId('readonly-banner')).toBeVisible({ timeout: 30000 })

    await page.getByTestId('banner-copy-btn').click()
    // 与列表页共用同一个对话框（不另写一份）：testid 就是 S5-d 那一个
    const dialog = page.getByTestId('workflow-copy-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-testid="copy-source"]')).toContainText(publishedCode)
    await expect(dialog.locator('[data-testid="copy-new-code"]')).toHaveValue(`${publishedCode}_copy`)

    // 🔴 刻意**不提交**：提交的产物与改写清单由 agent-workflow-copy.spec.ts 逐条钉住，
    //    这里只验「banner 这个入口通不通」，顺带把残留压到 0。
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    // 🔴 断「隐藏」而不是断「不存在」：el-dialog 关掉走的是 v-show（没给 destroy-on-close），
    //    DOM 节点还在、只是 display:none ⟹ toHaveCount(0) 永远红。首跑就是这么红的。
    await expect(dialog).toBeHidden()
  })

  test('⑤ banner 的「回滚为新草稿」真的把设计器切到新草稿', async ({ page }) => {
    await gotoWithAuth(page, editorUrl(publishedId))
    await expect(page.getByTestId('readonly-banner')).toBeVisible({ timeout: 30000 })

    await page.getByTestId('banner-rollback-btn').click()
    const box = page.locator('.el-message-box')
    await expect(box).toBeVisible()
    await box.getByRole('button', { name: /确定|确认/ }).click()

    // 🔴 判「切过去了」看 query 里的 id 变没变，不看整条 URL：gotoDef 用的是 replace，path 一模一样
    await page.waitForFunction(
      (oldId) => new URL(window.location.href).searchParams.get('id') !== oldId,
      String(publishedId),
      { timeout: 30000 }
    )
    const newId = Number(new URL(page.url()).searchParams.get('id'))
    expect(newId, '回滚没有把设计器切到一个新 id 上').toBeGreaterThan(0)
    // 🔴 先登记再断言：断言一红就漏出一条删不掉的草稿（台账 #87）
    draftIdsToDelete.push(newId)

    // 新草稿可编辑。🔴 等状态标签变成「草稿」是这一组断言里唯一的**正向**加载证据：
    //    banner 消失 / 按钮解禁在 loadDef 回来之前就已经成立了，直接断言会是假绿。
    await expect(page.locator('.wf-editor__meta .el-tag')).toHaveText('草稿', { timeout: 30000 })
    await expect(page.getByTestId('readonly-banner')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled()
    await expect(page.locator('.wf-editor__name input')).toBeEnabled()
  })
})
