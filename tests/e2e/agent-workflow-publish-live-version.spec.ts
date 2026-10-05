import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * B6 / S16「发布 ≠ 生效」的**用户可见那一半**：发布确认框必须说清这一版会不会立刻上线
 *
 * 🔴 为什么走浏览器：后端那半（无主版本时补钉、聊天侧发布即生效）由
 * `AgentWorkflowDefServicePublishDefTest` 的 B6 小节 + 两个负控覆盖。但「确认框文案按有没有主版本分叉」
 * 与「发布后 success / warning 分叉」是纯前端行为，单测够不着（vitest 是 node 环境，
 * `include: ['src/**\/*.spec.ts']`，压根加载不了 .vue）。而这条文案一旦说错，形态正是本模块头号缺陷
 * 「操作成功但不生效且无提示」的镜像版：**操作没生效，却提示说生效了**。
 *
 * 🔴 全程零残留 —— 这是本 spec 与 `agent-workflow-version.spec.ts` 的关键差别，也是它能存在的前提：
 * 用例**只让确认框出现、然后点取消**，`/publish` 一次都不调。
 *   - `deleteDef` 只允许删 DRAFT（`WorkflowDefStatusEnum.isDraft`），已发布行是不可变快照，
 *     API 删不掉、只能停用，停用后仍是永久惰性行。所以**任何真发布的 e2e 都会在库里留永久残渣**
 *     （version spec 就是这么做的，并在 afterAll 注释里认了这件事）。
 *   - 取消路径下：分支一只造一个 DRAFT（afterAll 删掉）；分支二用 `/rollback` 造一个 DRAFT
 *     （afterAll 删掉），被钉住的那个已发布版本**原样不动**。两边都 0 行新增。
 *   - 顺带这也验证了「取消真的取消」：取消后按 id 复查，状态必须仍是 DRAFT。
 *
 * 🔴 分支二**复用库里已有的「已发布且钉着主版本」的流程**，不自己 seed 一个。
 * 自己 seed 就得先发布（= 永久残渣）。发现不到就 skip 并**喊出声**，不静默跳过 ——
 * 静默 skip 会让「分支二从来没被测过」这件事在报告里看不出来。
 *
 * 前置（0 LLM token）：后端 48080 + 前端 dev :80 在跑。全程 tool 节点，无任何 LLM 调用。
 */

const API = 'http://127.0.0.1:48080/admin-api'
/** 本 spec 造的草稿统一前缀，残留核查按它反查（见 _b6-residue.py） */
const CODE_PREFIX = 'wf_b6_e2e_'

/** 最小可发布 DSL：单个只读 tool 节点，不碰 infra/bpm，不花 token */
const dsl = (code: string, tag: string) =>
  JSON.stringify(
    {
      dslVersion: '1.0',
      id: code,
      name: code,
      description: tag,
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

test.describe('发布确认框说清「会不会立刻上线」（B6 / S16）', () => {
  test.setTimeout(180_000)

  let req: APIRequestContext
  let token = ''
  /** 本 spec 造出来的草稿 id，afterAll 逐个删（DRAFT 可删，故能真清零） */
  const draftIds: number[] = []

  const api = async (path: string, method = 'GET', body?: any) => {
    const r = await req.fetch(API + path, {
      method,
      data: body,
      headers: {
        'tenant-id': '1',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    })
    return r.json()
  }

  /**
   * 造草稿的公共入口。
   * 🔴 逐步断言：seed 静默失败时后面只会报「找不到行」，真因是夹具没造出来
   * （台账 #128 那一族：前置挂了却把账算到用例头上）。
   */
  const seedDraft = async (path: string, body?: any): Promise<number> => {
    const r = await api(path, 'POST', body)
    expect(r?.code, `seed ${path} 应成功，实际 ${JSON.stringify(r)}`).toBe(0)
    const id = r.data as number
    draftIds.push(id)
    return id
  }

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext()
    const lr = await api('/system/auth/login', 'POST', { username: 'admin', password: 'admin123' })
    token = lr?.data?.accessToken
    if (!token) throw new Error('seed login failed: ' + JSON.stringify(lr))
  })

  test.afterAll(async () => {
    // 🔴 与 F1 同一纪律：清理必须在 afterAll，不能只写在用例体末尾 —— 用例一红就跳过清理，
    //    而红恰恰是最需要清理的时刻。删除失败也要**出声**（裸 await 会让 4xx/5xx 静默通过）。
    for (const id of draftIds) {
      const r = await api(`/agent/workflow-def/delete?id=${id}`, 'DELETE').catch((e) => ({
        code: -1,
        msg: String(e)
      }))
      expect(r?.code, `afterAll 删除草稿 id=${id} 应成功，实际 ${JSON.stringify(r)}`).toBe(0)
    }
    await req?.dispose()
  })

  /**
   * 在列表页搜出 code、点该行「发布」、等确认框出现，返回确认框 locator
   *
   * 🔴 按「该行有没有发布按钮」挑行，不按 `.first()`：分支二里同一个 code 在列表中会有**两行**
   * （被钉住的已发布版 + 回滚出的新草稿），而已发布行挂的是「停用」不是「发布」。
   * 用 .first() 的话挑到哪一行取决于后端排序（version DESC / id DESC / create_time DESC），
   * 排序一改用例就红在一个与 B6 无关的地方 —— 甚至可能挑中已发布行、报「找不到发布按钮」，
   * 让人以为发布按钮丢了。
   */
  const openPublishConfirm = async (page: Page, code: string) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/workflow')
    const search = page.locator('input[placeholder="请输入流程编码"]')
    await search.fill(code)
    await search.press('Enter')
    const rows = page.locator('.el-table__body tr').filter({ hasText: code })
    await expect(rows.first(), `列表里应搜到 ${code} 的行`).toBeVisible({ timeout: 15000 })
    const draftRow = rows.filter({ has: page.locator('button', { hasText: '发布' }) }).first()
    await expect(draftRow, `${code} 应有一行带「发布」按钮（即草稿行）`).toBeVisible({
      timeout: 15000
    })
    await draftRow.getByRole('button', { name: '发布', exact: true }).click()
    const box = page.locator('.el-message-box')
    await expect(box, '点「发布」后应弹出确认框').toBeVisible({ timeout: 15000 })
    return box
  }

  /** 点取消，并断言确认框已消失（取消路径不碰 /validate、更不碰 /publish） */
  const cancelConfirm = async (page: Page, box: Locator) => {
    await box.getByRole('button', { name: /取\s*消/ }).click()
    await expect(box).toBeHidden({ timeout: 15000 })
  }

  test('分支一：该 code 从没钉过主版本 ⟹ 确认框说「发布后它就是线上生效版本」', async ({ page }) => {
    const code = CODE_PREFIX + 'fresh_' + Date.now().toString(36)
    const id = await seedDraft('/agent/workflow-def/create', {
      code,
      name: code,
      dsl: dsl(code, 'b6-fresh'),
      description: 'b6-fresh'
    })

    const box = await openPublishConfirm(page, code)
    // 🔴 两个方向都断言：只断「含 A」的话，文案里同时印着「仍是 v1」这种自相矛盾的句子也照样绿。
    await expect(box).toContainText('发布后它就是线上生效版本')
    await expect(box).not.toContainText('线上生效版本仍是')
    // 🔴 不许把内部标记漏给用户（迭代四里已经抓到过两处：nodeConfigSchema 的 🔴 与字面 <b>）
    await expect(box).not.toContainText('🔴')
    await expect(box).not.toContainText('undefined')

    await cancelConfirm(page, box)

    // 取消后必须仍是 DRAFT —— 证明这条用例真的没发布（也就是真的零残留）
    const after = await api(`/agent/workflow-def/get?id=${id}`)
    expect(after?.code, `复查 ${code} 应可读，实际 ${JSON.stringify(after)}`).toBe(0)
    expect(after.data.status, '点了取消，状态不该离开 DRAFT').toBe('DRAFT')
    expect(after.data.primaryFlag, '草稿不该被钉成主版本').toBeFalsy()
  })

  test('分支二：该 code 已钉着生效中的主版本 ⟹ 确认框说「线上生效版本仍是 v{n}」', async ({
    page
  }) => {
    // 发现一个「已发布 + 钉着主版本」的流程。不自己 seed：seed 就得先发布 = 永久残渣。
    const pageResp = await api('/agent/workflow-def/page?pageNo=1&pageSize=100&status=PUBLISHED')
    expect(pageResp?.code, `分页查已发布流程应成功，实际 ${JSON.stringify(pageResp)}`).toBe(0)
    const pinned = ((pageResp.data?.list ?? []) as any[]).find((r) => r.primaryFlag === true)
    if (!pinned) {
      // 🔴 喊出声而不是静默 skip：静默跳过会让「分支二从来没被测过」在报告里看不出来。
      console.log(
        '[B6 分支二] 库里没有任何「已发布且钉着主版本」的流程，无法验证 blocker 文案。' +
          '请先 apply sql/mysql/xpy-2026-10-05-agent-workflow-primary-backfill.sql，' +
          '或在「版本」抽屉里对某个已发布版本点「设为主版本」。'
      )
      test.skip(true, '库里没有已钉主版本的已发布流程，分支二无从验证')
      return
    }
    const liveCode = pinned.code as string
    const liveVersion = pinned.version as number

    // /rollback 给同一条流程加一个新版本（DRAFT）。这是「加版本」的唯一合法路径 ——
    // createDef 对已占用的 code 直接拒（S5-b / G12）。产物是 DRAFT，可删，故仍零残留。
    const draftId = await seedDraft(`/agent/workflow-def/rollback?id=${pinned.id}`)

    const box = await openPublishConfirm(page, liveCode)
    // 该行是回滚出来的新草稿（version = liveVersion + 1），列表里同 code 可能有两行，
    // 故按 id 复查草稿确实存在，再断言文案点名的是**被钉住的那一版**。
    const draftResp = await api(`/agent/workflow-def/get?id=${draftId}`)
    expect(draftResp?.code, `复查回滚草稿应可读，实际 ${JSON.stringify(draftResp)}`).toBe(0)
    expect(draftResp.data.status, '回滚产物应是草稿').toBe('DRAFT')

    await expect(box).toContainText(`线上生效版本仍是 v${liveVersion}`)
    await expect(box).toContainText('设为主版本')
    // 🔴 两个方向都断言：这一支绝不能再同时印「发布后它就是线上生效版本」，否则文案自相矛盾
    await expect(box).not.toContainText('发布后它就是线上生效版本')
    await expect(box).not.toContainText('🔴')
    await expect(box).not.toContainText('undefined')

    await cancelConfirm(page, box)

    // 取消后：新草稿仍是 DRAFT，且**被钉住的那一版原样不动**（本用例没碰它）
    const afterDraft = await api(`/agent/workflow-def/get?id=${draftId}`)
    expect(afterDraft.data.status, '点了取消，回滚草稿不该被发布').toBe('DRAFT')
    const afterPinned = await api(`/agent/workflow-def/get?id=${pinned.id}`)
    expect(afterPinned.data.status, '被钉住的版本不该被动过').toBe('PUBLISHED')
    expect(afterPinned.data.primaryFlag, '被钉住的版本不该掉钉').toBe(true)
  })
})
