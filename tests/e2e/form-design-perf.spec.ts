import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * 表单设计器的性能采集
 *
 * 按设计方案 §9.4：本阶段【只采集、只记录、不阻断】。没有历史数据，日后定阈值只能拍脑袋，
 * 所以采集必须先做起来；但也不设门禁，避免在功能还在大改的阶段制造随机失败。
 *
 * 结果追加写入 docs/perf-baseline.md，带批次号与提交号，便于横向比对趋势。
 *
 * ## 为什么用接口造表单而不是点 200 次左侧面板
 *
 * 点击添加是串行的 UI 操作，200 次要好几分钟，而且每次点击的耗时本身也会被算进去，
 * 测不出「画布渲染 200 个控件要多久」。改成先用接口写好一张 200 字段的表单，
 * 再打开设计器 —— 这才是用户打开一张大表单时的真实路径。
 *
 * ## 重点关注：属性面板的响应延迟
 *
 * 这一项是 B0 那次改造的直接目标。改造前字段去重用 `watch(deep: true)` 侦听整棵规则树，
 * 每次属性微调都会触发全树遍历 + 结构化比对；改造后只侦听一个由 field/children/props.rule
 * 拼出的结构签名，改标题这类操作根本不会触发去重。
 * 200 控件下的差距见 docs/perf-baseline.md 里的对比记录。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 造多少个控件。200 是设计方案里「大表单」的参照规模 */
const WIDGET_COUNT = Number(process.env.PERF_WIDGET_COUNT || 200)
/** 属性面板改多少次标题取样 */
const EDIT_SAMPLES = Number(process.env.PERF_EDIT_SAMPLES || 20)

/**
 * 运行时采集用的表单字段数
 *
 * ⚠️ 上限是 e2e 夹具表里可用的列数（7 列）。字段数直接决定每次请求要校验多少列，
 * 而那正是元数据缓存要压的开销 —— 想量更大的规模，得先给夹具表加列。
 * 现在这个规模量不出「宽表单」的退化，只能守住「别再退回没有缓存的量级」。
 */
const RUNTIME_FIELD_COUNT = Number(process.env.PERF_RUNTIME_FIELDS || 7)
/**
 * 运行时每项取样次数
 *
 * ⚠️ 取 30 而不是 10。10 次的时候 p90 就是排序后的第 9 个值 —— <b>一个离群值就能
 * 决定它</b>：实测同一份代码两次采集，写入 p90 一次 79ms、一次 250ms，差了三倍多。
 * 拿那种数去定阈值，门禁必然随机红。
 */
const RUNTIME_SAMPLES = Number(process.env.PERF_RUNTIME_SAMPLES || 30)

/**
 * 性能门禁的阈值（毫秒）
 *
 * 交接文档台账第 3 项：「无阈值 → 渐进式退化可能连续多批不被发现」。现在补上，
 * 但要先说清<b>它守得住什么、守不住什么</b> —— 一个被高估的门禁比没有门禁更糟。
 *
 * ## 没有沿用「P90 上浮 20%」那条建议
 *
 * 那条写在采集脚本最初的注释里，当时还没有运行时数据。实测读详情 p90 只有 16–18ms，
 * 上浮 20% 是 3ms 的余量，完全落在机器噪声里 —— 门禁会随机红，
 * 而随机红的门禁最终一定会被人加 `.skip`。
 *
 * ## 实测分布（30 次取样，同一台机器连跑三轮）
 *
 * | 项 | p90 三轮 | 阈值 | 加缓存前实测（第十八节） |
 * |---|---|---|---|
 * | 写入 | 180 / 210 / 217ms | 400ms | 160–335ms（**区间重叠**） |
 * | 读详情 | 18 / 17 / 16ms | 80ms | 80–265ms |
 * | 分页 | 18 / 17 / 20ms | 100ms | 同属那条 SELECT 路径 |
 *
 * ## ⚠️ 写入这条守不住「缓存被摘掉」
 *
 * 它现在的 p90（180–220ms）与加缓存前的区间（160–335ms）<b>是重叠的</b>。
 * 原因是写入路径上还有十来步（提交流水线、序列化、长度校验、唯一性、业务主键、
 * 单据编号、子表/副表），元数据那部分只占其中一段。所以写入的阈值 400ms 只能抓
 * <b>严重退化</b>，抓不到「缓存没了」这一档 —— 不要以为它能。
 *
 * 真正能守住缓存那一档的是<b>读详情与分页</b>：现在 16–20ms，加缓存前 80–265ms，
 * 差 5–10 倍，阈值放在 80/100ms 上既有 4–5 倍噪声余量，又会在缓存失效时立刻红。
 *
 * ## ⚠️ 顺带记一个待查项
 *
 * 写入 p90 180–220ms（7 个字段）明显高于读详情的 16ms。这一档是不是合理、
 * 十来步里哪一步占大头，本次<b>没有排查</b> —— 记进交接文档，归到 B10 的「大表单性能」。
 *
 * ## 为什么门禁只加在这个 spec 里
 *
 * 它本来就不在默认套件里（跑法是 `--grep-invert "性能采集"` 排除掉）。
 * 门禁放这儿不会给日常 e2e 制造随机失败，而真跑性能采集时又是一道实打实的检查。
 * 做成「环境变量开启」的可选门禁没有意义 —— 没人会去开，等于「配了但不生效」。
 *
 * ## 阈值红了怎么办
 *
 * 先换台机器复测排除机器差异。确实是代码退化就修；确实是基线过时就
 * <b>连同 docs/perf-baseline.md 的记录一起更新</b> —— 只改数字不留记录，
 * 下一个人无从判断这个阈值是怎么来的。
 */
const THRESHOLDS: Record<string, number> = {
  runtimeCreateP90: Number(process.env.PERF_MAX_CREATE || 400),
  runtimeGetP90: Number(process.env.PERF_MAX_GET || 80),
  runtimePageP90: Number(process.env.PERF_MAX_PAGE || 100)
}

/**
 * 门禁断言
 *
 * 报错里带上「阈值怎么来的」与「怎么更新」—— 只说「超了」的话，
 * 接手的人第一反应是把阈值调大
 */
function checkThreshold(key: string, actual: number) {
  const limit = THRESHOLDS[key]
  if (limit === undefined) return
  expect(
    actual,
    `${key} = ${fmt(actual)}，超过阈值 ${fmt(limit)}。` +
      `阈值守的是【量级】不是百分比（见 docs/perf-baseline.md 与本文件注释）。` +
      `若确认是机器差异，换台机器复测；若是刻意的行为变更，请连同基线记录一起更新阈值`
  ).toBeLessThanOrEqual(limit)
}

/** 采集结果的落盘位置 */
const REPORT_PATH = resolve(process.cwd(), 'docs/perf-baseline.md')
/** 本次采集的标签，便于在报告里区分「改造前/改造后」等场景 */
const RUN_LABEL = process.env.PERF_LABEL || '未命名'

async function login(page: Page): Promise<string> {
  await page.goto('/login')
  const form = page
    .locator('form.login-form')
    .filter({ has: page.locator('input[type="password"]') })
    .filter({ has: page.locator('input[type="checkbox"]') })
    .first()
  await expect(form).toBeVisible()
  const inputs = form.locator('input:visible')
  const count = await inputs.count()
  if (count >= 3) await inputs.nth(0).fill('xpy')
  await inputs.nth(count - 2).fill('admin')
  await inputs.nth(count - 1).fill('admin123')
  const loginPromise = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  const response = await loginPromise
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
  return body.data?.accessToken as string
}

/** 纯接口登录。运行时那组用例不需要开浏览器 —— 量的是服务端开销 */
async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/system/auth/login`, {
    headers: { 'tenant-id': TENANT_ID },
    data: { username: 'admin', password: 'admin123' }
  })
  const body = (await response.json()) as { data?: { accessToken?: string } }
  expect(body.data?.accessToken, '登录失败').toBeTruthy()
  return body.data!.accessToken as string
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'tenant-id': TENANT_ID
})

/**
 * 生成 N 个单行输入控件的规则
 *
 * 用 input 而不是混合控件类型：本次量的是设计器处理规则数量的开销，
 * 混入富文本、子表这类重控件会把「控件自身渲染成本」混进来，看不出规则规模的影响。
 */
const buildFormFields = (count: number): string[] =>
  Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      type: 'input',
      field: `perf_field_${i}`,
      title: `性能字段 ${i}`,
      info: '',
      $required: false,
      props: {}
    })
  )

/** 造一张 N 字段的草稿表单，返回它的编号 */
async function createPerfForm(request: APIRequestContext, token: string): Promise<number> {
  const suffix = String(WIDGET_COUNT)
  const response = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: `性能采集-${suffix}字段`,
      // 编码带时间戳避免与上一次残留的表单撞唯一索引
      code: `perf_${suffix}_${Date.now()}`,
      formType: 1,
      formConf: JSON.stringify({ form: { labelWidth: '100px' } }),
      formFields: buildFormFields(WIDGET_COUNT)
    }
  })
  expect(response.ok(), '造性能采集用表单失败').toBeTruthy()
  const body = (await response.json()) as { data?: number }
  expect(body.data, '创建接口没有返回表单编号').toBeTruthy()
  return body.data as number
}

/**
 * 造一张【已发布】的表单，绑到 e2e 夹具表
 *
 * 与上面那张不同：那张只为了在设计器里画出来，字段不用真的映射到列；
 * 这张要能写库，所以每个字段都得有映射，而夹具表的列是固定那几个 ——
 * 用 memo/reason 这两个 varchar 列轮流映射即可，本项量的是「字段数量」带来的
 * 每列校验开销，不是「写多少种类型」
 */
async function createRuntimePerfForm(
  request: APIRequestContext,
  token: string
): Promise<{ id: number; code: string }> {
  const table = 'test_e2e_form_runtime'
  // ⚠️ 每个字段必须映射到【不同】的列。第一版让多个字段复用两列，以为「后写的覆盖
  // 先写的」，实际 INSERT 会报 Column 'memo' specified twice —— 而它是运行时的
  // 系统异常，采集用例只会看到「写入失败」，看不出是夹具配错了
  const columns = ['reason', 'mobile', 'memo', 'signature', 'sign_short', 'detail', 'tags']
  const fields: string[] = []
  const fieldMapping: Record<string, any> = {}
  for (let i = 0; i < Math.min(RUNTIME_FIELD_COUNT, columns.length); i++) {
    const field = `rt_field_${i}`
    fields.push(
      JSON.stringify({ type: 'input', field, title: `运行时字段 ${i}`, props: {} })
    )
    fieldMapping[field] = { table, column: columns[i], jdbcType: 'VARCHAR' }
  }
  const code = `perf_rt_${Date.now()}`
  const response = await request.post(`${API_BASE_URL}/infra/form-design/create`, {
    headers: authHeaders(token),
    data: {
      name: `性能采集-运行时${RUNTIME_FIELD_COUNT}字段`,
      code,
      formType: 1,
      formConf: JSON.stringify({ form: {} }),
      formFields: fields,
      dataSourceConfigId: 0,
      mainTable: table,
      mainPk: 'id',
      tableBinding: JSON.stringify({ mainTable: table, mainPk: 'id', fieldMapping })
    }
  })
  const body = (await response.json()) as { code: number; data: number; msg: string }
  expect(body.code, `造运行时采集表单失败：${body.msg}`).toBe(0)
  const publish = await request.post(`${API_BASE_URL}/infra/form-design/publish`, {
    headers: authHeaders(token),
    data: { id: body.data, parentMenuId: 2, changeSummary: 'perf' }
  })
  const publishBody = (await publish.json()) as { code: number; msg: string }
  expect(publishBody.code, `发布失败：${publishBody.msg}`).toBe(0)
  return { id: body.data, code }
}

async function deletePerfForm(request: APIRequestContext, token: string, id: number) {
  // 采集完就删掉：留在库里会污染其它用例的「取第一张表单」逻辑
  await request.delete(`${API_BASE_URL}/infra/form-design/delete?id=${id}`, {
    headers: authHeaders(token)
  })
}

/** 统计量。p90 比平均值有意义 —— 卡顿是偶发的，平均值会把它抹平 */
const stats = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
  return {
    p50: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1],
    avg: sorted.reduce((a, b) => a + b, 0) / sorted.length
  }
}

const fmt = (n: number) => `${n.toFixed(1)}ms`

function appendReport(lines: string[]) {
  const dir = dirname(REPORT_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (!existsSync(REPORT_PATH)) {
    writeFileSync(
      REPORT_PATH,
      [
        '# 表单设计模块性能基线',
        '',
        '按设计方案 §9.4：本阶段只采集、只记录、**不设门禁**。',
        '没有历史数据日后定阈值只能拍脑袋，所以先把采集做起来；但功能仍在大改，',
        '设阈值只会制造随机失败。',
        '',
        '采集方式：`PERF_LABEL=<标签> npx playwright test form-design-perf`',
        '',
        '后续补门禁时，建议以采集到的数据取 P90 上浮 20% 作为阈值，而不是沿用方案里的参考值。',
        '',
        '---',
        ''
      ].join('\n'),
      'utf-8'
    )
  }
  appendFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf-8')
}

test.describe('表单设计器性能采集', () => {
  // 造表单 + 渲染 200 控件 + 20 次属性编辑，默认 90s 不够
  test.setTimeout(300_000)

  test(`画布渲染与属性面板响应（${WIDGET_COUNT} 控件）`, async ({ page, request }) => {
    const token = await login(page)
    const formId = await createPerfForm(request, token)

    try {
      // ==================== 场景一：打开一张 N 控件的表单 ====================
      await page.goto(`/infra/online/editor?id=${formId}`)
      const renderStart = Date.now()
      await page.getByText('表单设计', { exact: true }).last().click()
      await expect(page.locator('._fc-designer')).toBeVisible({ timeout: 120_000 })
      // 等到最后一个控件真的画出来，而不是只等容器可见 ——
      // 容器可见时列表可能还在渲染，那样量出来的数偏小且不稳定
      await expect(
        page.locator('._fd-drag-item').last(),
        '画布上的控件没有全部渲染出来'
      ).toBeVisible({ timeout: 120_000 })
      const widgetCount = await page.locator('._fd-drag-item').count()
      const renderMs = Date.now() - renderStart

      // ==================== 场景二：属性面板改字段名称的响应延迟 ====================
      // 选中一个控件，反复改标题。这一项直接对应 B0 去掉 deep watch 的改造
      await page.locator('._fd-drag-item').first().click()
      await expect(page.locator('._fc-r-tab-props')).toBeVisible({ timeout: 30_000 })

      const titleInput = page
        .locator('._fc-r-tab-props .el-form-item')
        // 标签是「字段名称」而不是「标题」—— 这是设计器实际渲染出来的文案，
        // 别按直觉写成「标题」，那样定位不到（「字段 ID」也含「字段」，但不含「字段名称」，不会误匹配）
        .filter({ hasText: '字段名称' })
        .locator('input')
        .first()
      await expect(titleInput).toBeVisible({ timeout: 30_000 })

      const editSamples: number[] = []
      for (let i = 0; i < EDIT_SAMPLES; i++) {
        const value = `压测标题-${i}`
        const t0 = Date.now()
        await titleInput.fill(value)
        // 等画布上的标题真的跟着变了，才算这次编辑处理完 ——
        // 只等 fill 返回量的是输入框自己的响应，与规则树的处理开销无关
        await expect(
          page.locator('._fd-drag-item').first(),
          '画布没有同步到新标题'
        ).toContainText(value, { timeout: 30_000 })
        editSamples.push(Date.now() - t0)
      }

      const edit = stats(editSamples)

      // ==================== 落盘 ====================
      const commit = process.env.PERF_COMMIT || '(未提供)'
      appendReport([
        `## ${RUN_LABEL}`,
        '',
        `- 采集时间：${new Date().toISOString()}`,
        `- 提交：${commit}`,
        `- 控件数：${widgetCount}（目标 ${WIDGET_COUNT}）`,
        '',
        '| 场景 | 指标 | 数值 |',
        '|---|---|---|',
        `| 画布首次渲染（${widgetCount} 控件） | 耗时 | ${fmt(renderMs)} |`,
        `| 属性面板改标题（${EDIT_SAMPLES} 次取样） | p50 | ${fmt(edit.p50)} |`,
        `| 属性面板改标题 | p90 | ${fmt(edit.p90)} |`,
        `| 属性面板改标题 | max | ${fmt(edit.max)} |`,
        `| 属性面板改标题 | avg | ${fmt(edit.avg)} |`,
        ''
      ])

      // 只打印，不断言 —— 本阶段不设门禁
      console.log(
        `[perf][${RUN_LABEL}] 控件 ${widgetCount} | 渲染 ${fmt(renderMs)} | ` +
          `改标题 p50 ${fmt(edit.p50)} p90 ${fmt(edit.p90)} max ${fmt(edit.max)}`
      )

      // 唯一的断言：控件数量对得上。数量不对说明表单没造对，那这组数据没有意义
      expect(widgetCount, '渲染出的控件数与预期不符，本次采集数据不可用').toBe(WIDGET_COUNT)
    } finally {
      await deletePerfForm(request, token, formId)
    }
  })

  test('运行时读写延迟（已发布表单）', async ({ request }) => {
    const token = await apiLogin(request)
    let fixture: { id: number; code: string } | undefined
    const created: any[] = []
    try {
      fixture = await createRuntimePerfForm(request, token)

      // ==================== 场景三：写入 ====================
      //
      // 这条路径上每一次 validateColumn 都要读一次表结构元数据，字段越多越慢。
      // 元数据缓存（交接文档第十八节）就是冲它去的 —— 而那次的问题是【手工计时】
      // 发现的，因为当时的采集只覆盖设计器。这一组用例补的就是这个缺口。
      const createSamples: number[] = []
      for (let i = 0; i < RUNTIME_SAMPLES; i++) {
        const data: Record<string, any> = {}
        for (let f = 0; f < RUNTIME_FIELD_COUNT; f++) data[`rt_field_${f}`] = `v${i}_${f}`
        const t0 = Date.now()
        const response = await request.post(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/create`,
          { headers: authHeaders(token), data }
        )
        const body = (await response.json()) as { code: number; data: any; msg: string }
        expect(body.code, `写入失败：${body.msg}`).toBe(0)
        createSamples.push(Date.now() - t0)
        created.push(body.data)
      }

      // ==================== 场景四：读详情 ====================
      const getSamples: number[] = []
      for (let i = 0; i < RUNTIME_SAMPLES; i++) {
        const t0 = Date.now()
        const response = await request.get(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/get?id=${created[0]}`,
          { headers: authHeaders(token) }
        )
        expect(((await response.json()) as { code: number }).code).toBe(0)
        getSamples.push(Date.now() - t0)
      }

      // ==================== 场景五：分页 ====================
      const pageSamples: number[] = []
      for (let i = 0; i < RUNTIME_SAMPLES; i++) {
        const t0 = Date.now()
        const response = await request.post(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture.code}/page`,
          { headers: authHeaders(token), data: { pageNo: 1, pageSize: 20 } }
        )
        expect(((await response.json()) as { code: number }).code).toBe(0)
        pageSamples.push(Date.now() - t0)
      }

      // ⚠️ 第一次调用含冷启动（元数据缓存未命中、JIT 未预热），把它单列出来而不是
      // 混进 p50 —— 混进去的话，样本一多它就被摊平，而缓存失效后的首次开销恰恰是
      // 这一组最该盯的数之一
      const cold = { create: createSamples[0], get: getSamples[0], page: pageSamples[0] }
      const warm = {
        create: stats(createSamples.slice(1)),
        get: stats(getSamples.slice(1)),
        page: stats(pageSamples.slice(1))
      }

      appendReport([
        `## ${RUN_LABEL} · 运行时`,
        '',
        `- 采集时间：${new Date().toISOString()}`,
        `- 提交：${process.env.PERF_COMMIT || '(未提供)'}`,
        `- 表单字段数：${RUNTIME_FIELD_COUNT}，每项取样 ${RUNTIME_SAMPLES} 次`,
        '',
        '| 场景 | 首次(冷) | p50(热) | p90(热) | max(热) |',
        '|---|---|---|---|---|',
        `| 运行时写入 | ${fmt(cold.create)} | ${fmt(warm.create.p50)} | ${fmt(warm.create.p90)} | ${fmt(warm.create.max)} |`,
        `| 运行时读详情 | ${fmt(cold.get)} | ${fmt(warm.get.p50)} | ${fmt(warm.get.p90)} | ${fmt(warm.get.max)} |`,
        `| 运行时分页 | ${fmt(cold.page)} | ${fmt(warm.page.p50)} | ${fmt(warm.page.p90)} | ${fmt(warm.page.max)} |`,
        ''
      ])
      console.log(
        `[perf][${RUN_LABEL}][运行时] 写入 冷${fmt(cold.create)} p90 ${fmt(warm.create.p90)} | ` +
          `读详情 冷${fmt(cold.get)} p90 ${fmt(warm.get.p90)} | ` +
          `分页 冷${fmt(cold.page)} p90 ${fmt(warm.page.p90)}`
      )

      checkThreshold('runtimeCreateP90', warm.create.p90)
      checkThreshold('runtimeGetP90', warm.get.p90)
      checkThreshold('runtimePageP90', warm.page.p90)
    } finally {
      for (const id of created) {
        await request.delete(
          `${API_BASE_URL}/infra/form-design/runtime/${fixture!.code}/delete?id=${id}`,
          { headers: authHeaders(token) }
        )
      }
      if (fixture) await deletePerfForm(request, token, fixture.id)
    }
  })
})
