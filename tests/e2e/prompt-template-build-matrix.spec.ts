import { test, expect, type APIRequestContext } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { API_BASE_URL, apiHeaders, apiLogin, gotoWithAuth, login } from './helpers/auth'
import { CLICK_TIMEOUT_MS, bounded, boundedText, waitTerminal } from './helpers/terminal'

/**
 * T2：BUILD 类示例逐条真发（迭代二方案 §6.1）
 *
 * 🔴 这个用例守的是「意图分型 + 变更预演」这条链，而且它是 T1 的**阳性对照**
 *   T1 对 37 条 CHAT 示例断言「没有草稿卡」。一条只会绿的断言等于没有断言（方案 §6.3-8），
 *   所以必须有一个地方证明 `[data-testid="workflow-draft-card"]` 这个选择器**真的能命中**。
 *   就是这里：BUILD 示例必须出草稿卡，出不来就红。T1 与本文件必须一起跑。
 *
 * 🔴 与方案 T2 的范围差异（这一条是**刻意**的，不是没做完）
 *   方案写的是「产出草稿卡 → manifest 四块齐全 → 体检通过 → 沙箱跑通 → 发布被闸门正确放行」。
 *   本用例做到「体检通过」为止，**不点「确认并运行」**。三个理由，都是硬的：
 *
 *   ① 越过确认闸口就是不可逆 DDL。示例 55/57 要建物理表，示例 59 要 ALTER 现有的
 *      「销售报价单」表。建表/改表没有事务可回滚（DdlExecutor 的类注释写得很直白：不假装能回滚），
 *      而表名是 AI 现场起的、每轮都可能不同 ⟹ **没法可靠清理**。每跑一次就攒一批孤儿表，
 *      跑十次之后没人分得清哪张是谁造的。方案 §6.2 的残留判据是 `biz_e2e_%` 前缀，
 *      它压根匹配不到 AI 起的名字 —— 照抄那条 LIKE 会得到一个**恒绿**的残留检查。
 *      所以本文件改用「跑前跑后物理表**集合**逐一比对」（见 afterAll），任何新表都抓得住。
 *   ② 示例 59 会改一张**共享**表单。第二次跑必然撞「列已存在」，那是测试自己造的既成事实，
 *      不是被测对象的缺陷 —— 红得毫无信息量。
 *   ③ 那两半本来就有人守着，且守得更好：
 *      · 「发布被闸门正确放行」⟹ `script/verify-workflow-orchestration/`（A4-b）
 *        拿 50 条夹具双向打真实 `/validate`，只读、确定、可重复，比在 UI 里点一次强得多。
 *      · 「沙箱跑通 / 确认并运行」⟹ `agent-plan-stream.spec.ts` 已经点了「确认并运行」
 *        并断言走到运行终态，用的是一条**只读**流程（列数据接口），不留残留。
 *
 * 🔴 「manifest 四块齐全」为什么改成「后端算了什么，界面上就得看得见什么」
 *   四块（表 / 字段控件 / 查询条件 / 菜单权限）在 ChangeManifestCard 里全是 `v-if` 按数据渲染的：
 *   `tableGroups`←TABLE_CREATE|TABLE_ALTER、`formGroups`←FORM_CREATE|FORM_UPDATE、
 *   `searchConditions`←FORM_CREATE 里 searchable 的字段、`publishGroups`←FORM_PUBLISH。
 *   也就是说**该不该有四块，取决于 AI 这一轮规划出了什么**，而那是非确定的：
 *   示例 55 的第 1 步原文就是「查一下有没有能复用的表，**别急着建新表**」——
 *   AI 真找到可复用的表时不产出 TABLE_CREATE 是**正确**行为，此时断言「必须有表这一块」
 *   会红在一个正确答案上。所以硬写四种 kind 的期望值是错的。
 *   真正稳定、且正是 UI e2e 该管的事是**保真**：拿 `/validate` 返回的 manifest（后端口径）
 *   逐块比对界面上渲染出来的块（用户口径），**双向**断言（方案 §6.3-4）——
 *   后端算了而界面没画 = 用户看不见自己要担的风险；后端没算而界面画了 = 凭空吓人。
 *   实际出现了哪几种 kind 会逐条写进报告，供人对照方案的「四块齐全」评审。
 *
 *   🔴 实测（2026-10-04，示例 55 真跑一轮）：方案的「四块齐全」对这些示例**根本不成立**，
 *      而且不成立的原因是正确的，不是缺陷：
 *        kinds=[FORM_CREATE]，riskLevel=LOW，四块里只有「字段控件」有内容。
 *        · 没有「表」：AI 照示例第 1 步「别急着建新表」把主表名留成运行期变量
 *          `{{$.table_name}}`，体检期的原话是「主表名要到运行期才确定……本次这两项都跳过了」。
 *          静态 manifest 里当然没有 TABLE_CREATE。
 *        · 没有「菜单权限」：示例第 5 步明写「等我确认之后再发布，不要自己发布」，
 *          规划里就没有 FORM_PUBLISH 节点。
 *        · 没有「查询条件」：8 个字段的 searchable 全是 null、searchableFields 是空数组
 *          （这一条**值得人看一眼**：用户的原话是「行政能一眼看出哪间会议室什么时候空着」，
 *          一个可查询字段都没标，列表页就没有查询条件。属于规划质量问题，不是渲染问题，
 *          机械断言管不了，已按 §6.3-23 记在这里而不是假装测过了）。
 *      所以写死「四块必须齐全」会红在一个**正确**答案上。保真断言才是这里唯一站得住的口径。
 *
 *   🔴🔴 同一条示例、两轮真发，规划结果**不一样**（这条把上面从「推断」升级成「实测」）：
 *        · 第 1 轮（00:07，def #419）：kinds=[FORM_CREATE]，riskLevel=LOW，节点 10 个，校验 2 轮才过。
 *          没有 datamodel_create 节点，主表名是运行期变量 `{{$.table_name}}`。
 *        · 第 2 轮（00:14，def #420）：kinds=[TABLE_CREATE, FORM_CREATE]，riskLevel=**IRREVERSIBLE**，
 *          节点 8 个，校验 **5** 轮才过。这回真建表了，args.model 里 8 个列齐全。
 *      输入一字未改，「表」这一块从「没有」变成「有」，风险级从 LOW 跳到 IRREVERSIBLE。
 *      所以任何写死 kind 集合、写死 riskLevel、写死节点数的断言都是**必然间歇性红**的，
 *      不是「跑几次就稳了」——它每一轮都在重新掷骰子。本文件因此只断言**关系**
 *      （后端算了 X ⟺ 界面画出 X），不断言 X 的具体取值。
 *      报告里逐条印出 kinds / riskLevel / 节点数 / 校验轮次，就是给人看这轮骰子掷出了什么。
 *
 *      附带量到的一条：`search-conditions=无` 在**三条** BUILD 示例上全部成立（不只是 55）。
 *      🔴🔴 这里原先还跟着两句结论 ——「45 条示例里凡是要建表/建表单的，AI 一个 searchable 都没标」
 *      与「三条示例的正文都没有查询要求 ⟹ 一个都不标是**照教执行**」。**两句都已证伪，2026-10-05 就地改掉**
 *      （证据是九份草稿的 DSL 原文：只读 SQL 取 `agent_workflow_def.dsl`，`TO_BASE64` 避免转义，
 *      正则 `searchable["']?\s*:\s*true` 两种写法都数；逐条见迭代四方案 §15-6 那张三轮对照表）：
 *        · case 57 的正文**有**查询要求（「主管能**按客户和按人查**拜访情况」＝把查询说成用途的隐含表述），
 *          而 run13 / run14 它都真标了 **4 个** searchable ⟹ 「一个都没标」不成立；
 *          且同一个 plus、同一段提问，run12 一个没标、run13 标了 4 个 ⟹ 是**遵从度不稳定**，
 *          既不是「照教执行」也不是「系统性遗漏」（规划路径本来就钉了 `temperature=0.1`，
 *          `WorkflowPlannerServiceImpl:323`，所以高温采样解释不了这个抖动）。
 *        · case 59 三轮都真标了 **1 个**，报告却永远印「无」—— 那是**本文件自己的统计口径**造成的：
 *          下面 :571 那句 `.filter((x) => x.kind === 'FORM_CREATE')`，而 59 是 `FORM_UPDATE`
 *          ⟹ 它标的那 1 个**永远不计入**。🔴 这条最要紧，因为它意味着 `manifest-search-conditions`
 *          这块**从来没被 FORM_UPDATE 路径验过**（连带缺陷记为 D4-20：加可查询字段时变更预演
 *          不画「查询条件」区块，属产品决定，先报不做）。
 *        · 只有 case 55 真的是「照教执行」（正文确实没有查询要求，三轮都 0 个）。
 *      ⟹ 原结论**只在 1/3 的样本上成立**，却被当成「三条全部」写进了验收清单 ——
 *      与 D4-02「断言文案自带误诊」是同一个毛病：留着会把下一个人派去追一个不存在的遗漏，故就地改掉。
 *      `searchable` 的唯一一处教法在 `FormSaveDraftTool.java:507-508`——
 *      「**用户说「列表里要用某字段查询」时**，给该字段传 true」。
 *      教法本身本轮**仍不改**，但理由换了：不是因为「AI 没错」，而是因为改法的时机不对
 *      （规划模型正在 failover 到 flash，这时候改提示词，量到的差异分不清是谁的功劳）。
 *      该放宽的是那句教法的**触发条件写法**，要把「像『主管能按客户查』这种把查询说成用途的隐含表述」也算进去。
 *      结论与裁量见迭代四方案 §15-6。
 *
 * 🔴 「停在确认之前」本身就是一条从数据里长出来的断言
 *   三条示例的正文/验收标准都明写了不许自行发布：55「等我确认之后再发布，不要自己发布」、
 *   57「停在发布前」、59「请只改这一处」。所以「卡片停在待确认、没有任何 def 变成 PUBLISHED」
 *   不是测试的便利措施，而是被测需求本身。afterAll 会拿跑前的 def 状态快照做差集来验。
 *
 * 🔴 体检走接口而不是点确认：`POST /agent/workflow-def/validate` 是**只读**的
 *   （ChangeManifestDryRunner 的类注释：只准调 previewDdl / inspectFormDesign /
 *    previewPublishMenu / validateFlowReady 这类只读接口，一个写接口都不调）。
 *   这正是前端 precheckPublish 走的同一条路（先 `GET /get?id` 取 DSL —— `/page` 刻意把 dsl 置 null，
 *   拿 row.dsl 去体检会永远走进「内容为空」那条 —— 再打 /validate）。
 *   于是「体检通过」这一格能在**不产生任何数据**的前提下真量到。
 *
 * 前置：后端 48080 + 前端 dev server 在跑，聊天模型可用，且规划模型可用。
 * 单条 BUILD 的规划实测数十秒~数分钟（多轮生成-校验-自修正），三条串行，超时给足。
 */

interface CaseRow {
  id: number
  templateId: number
  title: string
  content: string
  expectHint?: string | null
  expectIntent?: 'CHAT' | 'BUILD' | null
}

interface ManifestChange {
  kind: string
  nodeId?: string
  summary?: string
  target?: Record<string, any>
  detail?: Record<string, any>
  dryRun?: { warnings?: string[]; rejected?: boolean }
}

interface ValidateVO {
  passed: boolean
  errors: string[]
  warnings: string[]
  manifest?: { riskLevel?: string; headline?: string; changes?: ManifestChange[] } | null
}

interface DefRow {
  id: number
  code: string
  name: string
  status: string
  dsl?: string | null
}

/** AssistantChat.vue:591 INPUT_MAX_LENGTH */
const INPUT_MAX_LENGTH = 2000

/** 单条 BUILD 等草稿卡的上限。agent-plan-stream 用的是 480 秒，照它 */
const PER_CASE_PLAN_TIMEOUT = 480_000

const REPORT_DIR = path.join(__dirname, '../../_evidence')
const REPORT = path.join(REPORT_DIR, 'prompt-template-build-matrix.md')

const ONLY = (process.env.TPL_MATRIX_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter((n) => Number.isFinite(n))

let token = ''
let allCases: CaseRow[] = []
let baselineTables = new Set<string>()
let baselineDefs = new Map<number, string>()
let baselineConversationIds = new Set<number>()
/** 本轮真发新造的流程 def id。与 baselineDefs 分开记，见用例体里那条注释 */
const runCreatedDefs: number[] = []
const failures: string[] = []
const rows: string[] = []

const H = () => apiHeaders(token)
const caseApi = `${API_BASE_URL}/agent/prompt-template-case/simple-list`
const tableApi = `${API_BASE_URL}/infra/data-model/list-database-table`
const defPageApi = `${API_BASE_URL}/agent/workflow-def/page`
const defGetApi = `${API_BASE_URL}/agent/workflow-def/get`
const defDeleteApi = `${API_BASE_URL}/agent/workflow-def/delete`
const validateApi = `${API_BASE_URL}/agent/workflow-def/validate`
const conversationPageApi = `${API_BASE_URL}/agent/assistant/conversation/page`
const conversationDeleteApi = `${API_BASE_URL}/agent/assistant/conversation/delete`

/**
 * 🔴 清单类接口必须先验 code，再信 data
 *
 * `body?.data?.list ?? []` 这种写法会把 401/500 静默吃成空清单，于是「跑后全集」是空集、
 * 差集也是空集 —— 残留检查看起来干干净净，其实一条都没查到。
 * **一个恒绿的残留检查比没有检查更坏**（和下面 TABLE_NAME 那条同一个道理）。
 *
 * T1 已经真撞过一次：2026-10-04 全量跑了 45.6 分钟，而 access token 只活 30 分钟
 * （`system_oauth2_client.access_token_validity_seconds=1800`），afterAll 拿过期 token 收尾，
 * 42 条会话一条没删，报告却印「删除 0 条（基线 1 条原样保留）」，读起来像成功。
 * T2 原先注的是「只跑 6 分钟撞不到过期」，那个前提已经过期：2026-10-04 实测 **16.0 分钟**，
 * 余量从 5 倍缩到不到 2 倍，而 planner 产不出合法 JSON 时会白烧轮次（缺陷 D4-01），只会更慢。
 * 所以 T2 的 afterAll 开头也重新登录，不再赌 TTL。接口 500 一样会静默吃成空集，所以两边都验。
 */
function expectOk(body: any, what: string): void {
  expect(body?.code, `${what}失败（code=${body?.code}）：${body?.msg ?? ''}`).toBe(0)
}

/** 物理表全集。用只读接口而不是连 MySQL：e2e 里不该出现库口令 */
async function listPhysicalTables(request: APIRequestContext): Promise<Set<string>> {
  const resp = await request.get(tableApi, { headers: H() })
  const body = await resp.json()
  expectOk(body, '取物理表清单')
  // 🔴 键是大写 TABLE_NAME（information_schema 的列名原样透出）。
  //    按小写 tableName 取会全取成 undefined，于是「没有新增表」恒成立 ——
  //    一个恒绿的残留检查比没有检查更坏
  return new Set((body.data ?? []).map((t: any) => String(t.TABLE_NAME ?? t.tableName ?? t.name)))
}

async function listDefs(request: APIRequestContext): Promise<DefRow[]> {
  const out: DefRow[] = []
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const resp = await request.get(defPageApi, { headers: H(), params: { pageNo, pageSize: 100 } })
    const body = await resp.json()
    expectOk(body, `取流程 def 分页 pageNo=${pageNo}`)
    const list = (body?.data?.list ?? []) as DefRow[]
    out.push(...list)
    if (list.length < 100) break
  }
  return out
}

async function listConversationIds(request: APIRequestContext): Promise<Set<number>> {
  const ids = new Set<number>()
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const resp = await request.get(conversationPageApi, {
      headers: H(),
      params: { pageNo, pageSize: 100 }
    })
    const body = await resp.json()
    expectOk(body, `取会话分页 pageNo=${pageNo}`)
    const list = body?.data?.list ?? []
    for (const item of list) ids.add(item.id as number)
    if (list.length < 100) break
  }
  return ids
}

test.describe('T2 · BUILD 类示例逐条真发', () => {
  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)
    const resp = await request.get(caseApi, { headers: H() })
    const body = await resp.json()
    expect(body.code, `取示例清单失败：${body.msg}`).toBe(0)
    allCases = (body.data ?? []) as CaseRow[]
    baselineTables = await listPhysicalTables(request)
    baselineDefs = new Map((await listDefs(request)).map((d) => [d.id, d.status]))
    baselineConversationIds = await listConversationIds(request)
  })

  test.afterAll(async ({ request }) => {
    if (!token) return
    // 🔴 收尾前重新登录（方案 §2.8）。token TTL 是 1800 秒，而本轮实测跑了 16.0 分钟 ——
    //    余量不到 2 倍。拿旧 token 收尾时，下面那些 expectOk 确实会把 401 抓成红，
    //    但那时残留已经躺在库里了：T1 就是这么攒下 42 条没删掉的会话的。别赌，直接换新 token。
    // 🔴 登录失败**只记一行、不 throw**：throw 会把整个 afterAll 打断，残留核账一条都不做，
    //    比拿旧 token 试一次更糟（T1 的 afterAll 就是这个形状，两边对齐）
    try {
      token = await apiLogin(request)
    } catch {
      rows.push(`\n---\n\n⚠️ 收尾重新登录失败，下面按旧 token 试；残留**可能没清干净**，需人工核\n`)
    }

    // ---------- 残留核账（方案 §6.2：残留非空即视为该轮失败） ----------
    const tablesNow = await listPhysicalTables(request)
    const newTables = [...tablesNow].filter((t) => !baselineTables.has(t))
    const goneTables = [...baselineTables].filter((t) => !tablesNow.has(t))

    const defsNow = await listDefs(request)
    // 「本轮之后库里多出来的」全集，而不是只看 runCreatedDefs 记下的那些：
    // 用例中途红掉时可能还没来得及记，那条草稿就成了没人认领的孤儿。差集口径才兜得住
    const created = defsNow.filter((d) => !baselineDefs.has(d.id))
    const orphans = created.filter((d) => !runCreatedDefs.includes(d.id))
    const promoted = defsNow.filter(
      (d) => baselineDefs.get(d.id) && baselineDefs.get(d.id) !== d.status && d.status === 'PUBLISHED'
    )

    // 🔴 拆台子：本轮新造的**草稿**删掉。只删 DRAFT —— PUBLISHED 的删不掉也不该删，
    //    它已经在下面被记成失败项了，静默删除等于把证据一起销毁
    let deletedDefs = 0
    for (const d of created) {
      if (d.status !== 'DRAFT') continue
      // 🔴 每个删除请求都过 expectOk（方案 §4.7）：不验返回码时，token 过期或状态不许删
      //    都会静默失败，而计数器照样 ++、报告照样印「已删 N 条」—— 清理失败被记成清理成功
      const delResp = await request.delete(defDeleteApi, { headers: H(), params: { id: d.id } })
      expectOk(await delResp.json(), `删本轮新造的草稿 def #${d.id}`)
      deletedDefs++
    }
    const conversationsNow = await listConversationIds(request)
    let deletedConversations = 0
    for (const id of conversationsNow) {
      if (baselineConversationIds.has(id)) continue
      const delResp = await request.delete(conversationDeleteApi, { headers: H(), params: { id } })
      expectOk(await delResp.json(), `删本轮新造的会话 #${id}`)
      deletedConversations++
    }

    rows.push(
      `\n---\n\n## 残留核账（方案 §6.2）\n\n` +
        `- 物理表：跑前 ${baselineTables.size} 张 → 跑后 ${tablesNow.size} 张\n` +
        `- 新增表：${newTables.length ? `❌ ${newTables.join(', ')}` : '无'}\n` +
        `- 消失的表：${goneTables.length ? `❌ ${goneTables.join(', ')}` : '无'}\n` +
        `- 本轮新造的流程 def：${created.length} 条（${created.map((d) => `${d.id}/${d.status}`).join(', ') || '无'}），` +
        `已删草稿 ${deletedDefs} 条\n` +
        `- 其中没人认领的孤儿草稿：${
          orphans.length
            ? `⚠️ ${orphans.map((d) => d.id).join(', ')}（说明有用例在记下 def 之前就红掉了）`
            : '无'
        }\n` +
        `- 状态被改成 PUBLISHED 的既有 def：${promoted.length ? `❌ ${promoted.map((d) => d.id).join(', ')}` : '无'}\n` +
        `- 会话：删除本轮新建 ${deletedConversations} 条（基线 ${baselineConversationIds.size} 条原样保留）\n`
    )
    try {
      mkdirSync(REPORT_DIR, { recursive: true })
      writeFileSync(REPORT, rows.join(''), 'utf8')
    } catch {}

    // 🔴 建表是不可逆的：一旦这里红了，删 def 也救不回来，必须人工去库里处理。
    //    所以失败信息里直接写清「哪张表、谁造的」，不要让下一个人重新推一遍
    expect(
      newTables,
      `本轮真发新建了物理表（不可逆，删 def 救不回来，需人工核）：${newTables.join(', ')}。` +
        `T2 的设计是**不点确认并运行**，出现新表说明有东西越过闸口自己发布了`
    ).toHaveLength(0)
    expect(goneTables, `本轮有物理表消失了：${goneTables.join(', ')}`).toHaveLength(0)
    expect(
      promoted,
      `有 ${promoted.length} 条既有流程被发布成 PUBLISHED（id=${promoted.map((d) => d.id).join(', ')}）—— ` +
        `三条 BUILD 示例都明写「等我确认之后再发布」，自行发布就是缺陷`
    ).toHaveLength(0)
  })

  test('数据层前置审计：BUILD 示例存在、正文可插、无占位符', async () => {
    const builds = allCases.filter((c) => c.expectIntent === 'BUILD')
    expect(
      builds.length,
      '一条 expect_intent=BUILD 的示例都没有 —— T2 没得跑，且 T1 的「没有草稿卡」断言失去阳性对照'
    ).toBeGreaterThan(0)
    // 🔴 CHAT 那半也必须存在：否则「BUILD 示例出了草稿卡」可能只是因为分类器把什么都判成 BUILD
    expect(
      allCases.filter((c) => c.expectIntent === 'CHAT').length,
      '一条 CHAT 示例都没有 —— 分类器恒判 BUILD 也会全绿'
    ).toBeGreaterThan(0)

    for (const c of builds) {
      expect((c.content ?? '').trim().length, `示例 ${c.id} 正文是空的`).toBeGreaterThan(0)
      expect(
        c.content.length,
        `示例 ${c.id}（${c.title}）正文 ${c.content.length} 字，超过 ${INPUT_MAX_LENGTH} 字上限，UI 会拒绝插入`
      ).toBeLessThanOrEqual(INPUT_MAX_LENGTH)
      expect(c.content, `示例 ${c.id}（${c.title}）正文里含 {{`).not.toContain('{{')
      expect((c.expectHint ?? '').trim().length, `示例 ${c.id} 没有 expect_hint`).toBeGreaterThan(0)
    }

    rows.push(
      `# T2 · BUILD 类示例真发矩阵\n\n` +
        `- 生成时间：${new Date().toISOString()}\n` +
        `- 示例总数 ${allCases.length}，其中 BUILD **${builds.length}** 条（方案写的是 10 条，实测对不上）\n` +
        `- 基线：物理表 ${baselineTables.size} 张、流程 def ${baselineDefs.size} 条、会话 ${baselineConversationIds.size} 条\n` +
        `- 过滤器 TPL_MATRIX_ONLY：${ONLY.length ? ONLY.join(',') : '（未设，全跑）'}\n\n` +
        `> 🔴 本用例**不点「确认并运行」**，理由见 spec 头注释。绿只代表：分型判成了 BUILD、\n` +
        `> 草稿卡与变更预演渲染保真、只读体检通过、且没有任何东西被自行发布。\n`
    )
  })

  test('BUILD 示例逐条真发：出草稿卡、变更预演保真、体检通过、停在确认之前', async ({
    page,
    request
  }) => {
    test.setTimeout(2_100_000)

    const targets = allCases
      .filter((c) => c.expectIntent === 'BUILD')
      .filter((c) => ONLY.length === 0 || ONLY.includes(c.id))
    expect(targets.length, '过滤之后一条都不剩').toBeGreaterThan(0)

    mkdirSync(REPORT_DIR, { recursive: true })
    writeFileSync(REPORT, rows.join(''), 'utf8')

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 20_000 })

    let sent = 0
    for (const [i, c] of targets.entries()) {
      const startedAt = Date.now()
      const label = `示例 ${c.id}（${c.title}）`
      const detail: string[] = []
      try {
        // 🔴 每条示例**自己**拍一次 def 快照（缺陷 D4-13，2026-10-04 run8 实测）。
        //    原先是拿全轮的 baselineDefs + runCreatedDefs 求差集、再取 fresh[fresh.length - 1]，
        //    两处都错：① /page 返回是**新→旧**（本轮残留核账印出来的就是 445,444,443），
        //    取最后一条等于取**最旧**那条；② runCreatedDefs 只在示例整条跑通时才 push，
        //    任何一条红掉之后它没认领的 def 就永久留在候选里，后面每条示例都可能挑中它。
        //    run8 的示例 59 就是这么被判红的：它自己的卡是 #445（改销售报价单表单），
        //    断言却拿 #443（示例 55 的「创建会议室预订登记表」）的后端 manifest 去比页面 ——
        //    #443 有 FORM_PUBLISH 而 #445 没有 ⟹ 报「manifest-permissions 没渲染」。
        //    铁证是它自己那条 detail：一次**纯改表单**的示例，kinds 里印出了 FORM_CREATE。
        //    改成「开跑前拍一张、之后取新增里 id 最大的那条」，两件事一起消掉，
        //    也不再依赖「上一条示例成功没有」。
        const defsBefore = new Set((await listDefs(request)).map((d) => d.id))
        // 🔴 每个 click 都带 CLICK_TIMEOUT_MS：它们都排在断言**之前**，按钮一旦不在，
        //    无限等的 click 会先把整条用例挂死（见 helpers/terminal.ts 里那个常量的注释）
        // 🔴 判据是 `i > 0` 而不是原先的 `sent > 0`：`sent` 只在示例**整条跑通**时才 ++，
        //    于是任何一条失败之后，后面所有示例都挤在**同一个会话**里跑，上一条的
        //    草稿卡与 error alert 全留在页面上。run7 就是这么把 id=59 判红的 ——
        //    59 自己的产品链路全过（草稿卡待确认、4 个节点、体检 warnings 0、def #442），
        //    却栽在末尾那条页面级 alert 计数上，而挂在页面上的其实是 55/57 规划失败留下的 alert。
        //    「新开一个会话」与「上一条成功没有」是两件无关的事，别用同一个变量表达。
        if (i > 0) {
          await page.getByRole('button', { name: /新建对话/ }).click({ timeout: CLICK_TIMEOUT_MS })
          await expect(page.locator('[data-testid="workflow-draft-card"]')).toHaveCount(0, {
            timeout: 10_000
          })
          // 🔴 气泡清零还不够，alert 也得清零 —— 这一条是本用例末尾那条
          //    「页面上不许挂 error alert」能成立的**前提**：只有在开头证明了页面是干净的，
          //    末尾数到的 alert 才必然是**本条示例自己**产的。少了这一条，那条断言就分不清
          //    「本条出错了」与「上一条的错还挂在屏幕上」，而它两种都报成前者。
          await expect(
            page.locator('.el-alert--error'),
            `${label} 开跑前页面上还挂着上一条示例的 error alert —— 会话没真的切干净，` +
              `后面那条「不许挂 alert」的断言就失去意义了`
          ).toHaveCount(0, { timeout: 10_000 })
        }

        await page.locator('[data-testid="template-picker"]').click({ timeout: CLICK_TIMEOUT_MS })
        const popper = page.locator('.agent-tpl-popover:visible')
        await expect(popper).toBeVisible({ timeout: 10_000 })
        await popper
          .locator('[data-testid="tpl-tab-case"]')
          .click({ timeout: CLICK_TIMEOUT_MS })
        const item = popper.locator(`[data-testid="case-item"][data-case-id="${c.id}"]`)
        await expect(item, `${label} 没出现在示例面板里`).toHaveCount(1)
        await item.click({ timeout: CLICK_TIMEOUT_MS })
        await expect(textarea, `${label} 插入后正文不符`).toHaveValue(c.content, { timeout: 5_000 })

        await page.getByRole('button', { name: /发\s*送/ }).click({ timeout: CLICK_TIMEOUT_MS })

        // ---------- 分型：BUILD 示例必须出草稿卡 ----------
        // 🔴 与 agent-plan-stream.spec.ts 的口径**刻意相反**：那条用例容忍被判成 CHAT
        //    （它测的是 SSE 积压，不是分型），这里不容忍 —— expect_intent=BUILD 是
        //    示例库里人工标定的期望，判成 CHAT 就是方案 §6.3-3 点名要抓的那个缺陷：
        //    「一条本该编排的模板被误判成 CHAT 时，测试会以『答案非空』通过」
        const terminal = await waitTerminal(page, PER_CASE_PLAN_TIMEOUT)
        const card = terminal.outcome
        // 🔴 末尾那句病因**必须随分支变化**（缺陷 D4-02 / 方案 §3.3 第 7 条「不替 error alert 编病因」）。
        //    原先「意图分型没走 BUILD 路径」是无条件拼上去的，连超时分支也拼 ——
        //    而超时分支里分型根本不是原因。这已经真误导过一次：id=57 明明是 planner 产不出合法 JSON，
        //    报告却把责任推给意图分型。别把这几句合回去「省点重复」。
        //
        // 🔴 换用 waitTerminal（而不是原先的 waitTerminalOutcome）修的是同一类毛病的**另一半**：
        //    waitTerminalOutcome **刻意不认** error alert（它自己的 javadoc 写着
        //    「改它要连判词一起改，那是另一件事」），于是后端规划失败、alert 早就挂上页面了，
        //    测试还在原地空转到 480 秒、返回 null，报告印一句与事实**相反**的
        //    「480 秒内未收敛：planner 在轮次上限内未产出合法 DSL」。
        //    run7 的 id=55/57 就是这么各白等到预算耗尽（分别**至少** 6 分钟、5 分 40 秒，
        //    合计约 12 分钟、占那轮 16.7 分钟的七成 —— 数字的推导见 `helpers/terminal.ts` 的墓碑），
        //    病因还写错了。那「另一件事」就是这件事。
        //    alert 分支只准**原样引用 alert 原文**，不许自己编（§3.3 第 7 条）。
        if (terminal.errorText) {
          detail.push(`error alert 原文：${terminal.errorText}`)
        }
        detail.push(
          `终局：outcome=${String(terminal.outcome)}，sawPlanning=${terminal.sawPlanning}` +
            (terminal.errorText ? '，页面挂了 error alert' : '')
        )
        expect(
          card,
          `${label} 没产出流程草稿卡 —— ${
            terminal.errorText
              ? `页面挂了 error alert，原文：${terminal.errorText}`
              : card === null
                ? `${PER_CASE_PLAN_TIMEOUT / 1000} 秒内未收敛（既没出草稿卡、也没答文字、也没挂 alert）：` +
                  'planner 仍在转圈'
                : '被判成了 CHAT，直接答了一段文字：意图分型没走 BUILD 路径'
          }`
        ).toBe(true)

        const draftCard = page.locator('[data-testid="workflow-draft-card"]')
        // 🔴 必须指着 `draft-status` 这枚标签本身，**不能**写 `draftCard.getByText('待确认')`
        //    （缺陷 D4-12，2026-10-04 run8 实测）：卡片标题是模型自己写的一句话，
        //    示例 55 那轮它写的是「按步骤创建会议室预订表：查重、选控件、存草稿、体检、**待确认**后发布」。
        //    getByText 于是同时命中标题与状态标签两个元素 ⟹ Playwright 抛 strict mode violation ⟹
        //    真因落在错误消息的第 3 行，而下面的 catch 只取第 1 行 ⟹ 报告印出
        //    「草稿卡不在待确认态」，可卡片当时**正是**待确认态（trace `2-trace.trace` line=667
        //    ts=50284.154 的快照里两处文本都在）。这与 D4-02 是同一类毛病：判词自带误诊。
        //    标题里会不会出现「待确认」取决于模型这轮怎么措辞 ⟹ 写死 getByText 的断言是**间歇性红**的。
        await expect(
          draftCard.locator('[data-testid="draft-status"]'),
          `${label} 的草稿卡不在「待确认」态`
        ).toHaveText('待确认')
        expect(
          await draftCard.locator('[data-testid="workflow-node"]').count(),
          `${label} 的草稿卡里一个节点都没有 —— DSL 解析不出 nodes 还放过去了`
        ).toBeGreaterThanOrEqual(1)
        detail.push('草稿卡：待确认，节点 ' + (await draftCard.locator('[data-testid="workflow-node"]').count()) + ' 个')

        // S8 的轮次徽标：rounds 不落库，只有直播这一路有值
        const rounds = draftCard.locator('[data-testid="draft-rounds"]')
        await expect(rounds, `${label} 的草稿卡上没有轮次徽标（rounds 没从 SSE 走到 DOM）`).toHaveCount(1)
        // 🔴 徽标只是给人看的一行 detail，不是断言：读不到就如实写「没读到」，
        //    绝不用无限等的 textContent（渲染进程主线程被占满时它排队不报错）
        const roundsText = await bounded(
          rounds.textContent({ timeout: 10_000 }).catch(() => null),
          12_000
        )
        detail.push(
          `轮次徽标：${typeof roundsText === 'string' && roundsText.trim() ? roundsText.trim() : '（没读到）'}`
        )

        // ---------- 变更预演：折叠条默认收起时点开 ----------
        // WorkflowDraftCard:308 的 manifestOpen 只在 IRREVERSIBLE/HIGH/dryRunRejected 时自动展开
        const manifest = page.locator('[data-testid="draft-manifest"]')
        if (!(await manifest.isVisible().catch(() => false))) {
          await page
            .locator('[data-testid="draft-manifest-title"]')
            .click({ timeout: CLICK_TIMEOUT_MS })
        }
        await expect(manifest, `${label} 的变更预演没渲染出来`).toBeVisible({ timeout: 20_000 })
        await expect(
          page.locator('[data-testid="manifest-unavailable"]'),
          `${label} 的变更预演是「不可用」态 —— 建表这类不可逆动作必须让人在确认前看见`
        ).toHaveCount(0)
        // 🔴 这一句原先是裸 `await ...innerText()`：`assistant-scroll` 前面没有任何 expect 兜着，
        //    元素不在就是无限等、整条用例永久挂起。加了上限之后同样情形会抛 TimeoutError，
        //    被下面的 catch 记成「示例 N 失败」，本轮剩下的照常跑完。
        // 🔴 STALL 单独 throw 而不是当成空串：空串会让 `not.toContain` **静默通过**，
        //    那等于「取不到正文」被记成「正文里没有那句失败提示」—— 正是要抓的缺陷反而绿了
        const scrollText = await bounded(
          page.locator('[data-testid="assistant-scroll"]').innerText({ timeout: 10_000 }),
          12_000
        )
        if (typeof scrollText !== 'string') {
          throw new Error(
            `${label} 读滚动容器 12 秒没读到（渲染进程主线程被占满）—— 取不到正文就没法判它是不是「后端未能生成变更清单」`
          )
        }
        expect(scrollText, `${label} 的变更预演取失败了`).not.toContain('后端未能生成变更清单')

        // ---------- 体检：走只读接口，不点确认 ----------
        const defs = await listDefs(request)
        const fresh = defs.filter((d) => !defsBefore.has(d.id))
        expect(
          fresh.length,
          `${label} 出了草稿卡，但流程 def 列表里没有新增行（本例开跑前 ${defsBefore.size} 条 → 跑后 ${defs.length} 条）` +
            ` —— 卡片是拿什么渲染的？`
        ).toBeGreaterThan(0)
        // 🔴 取 id **最大**的那条，不是数组最后一条：/page 是新→旧（见上面 defsBefore 那段注释）。
        //    一条示例正常只造一份草稿，但 AI 万一规划出两版，页面渲染的是后一版，
        //    拿前一版的 manifest 去比页面就是「凭空吓人」那一支断言在正确规划上报红。
        const def = fresh.reduce((a, b) => (b.id > a.id ? b : a))
        detail.push(`新造 def：#${def.id} ${def.code}「${def.name}」状态 ${def.status}`)
        expect(
          def.status,
          `${label} 新造的 def 状态是 ${def.status} 而不是 DRAFT —— 有东西越过确认闸口发布了`
        ).toBe('DRAFT')

        // 🔴 必须走 GET /get?id 取 DSL：/page 刻意把 dsl 置成 null（一份 DSL 几十 KB）
        const getResp = await request.get(defGetApi, { headers: H(), params: { id: def.id } })
        const getBody = await getResp.json()
        const dsl = getBody?.data?.dsl as string | undefined
        expect(dsl?.trim().length, `def #${def.id} 取不到 DSL，体检无从谈起`).toBeGreaterThan(0)

        const valResp = await request.post(validateApi, { headers: H(), data: { dsl, id: def.id } })
        const valBody = await valResp.json()
        expect(valBody.code, `体检接口失败：${valBody.msg}`).toBe(0)
        const v = valBody.data as ValidateVO
        expect(
          v.errors,
          `${label} 体检没过（def #${def.id}）：${(v.errors ?? []).join(' / ')}`
        ).toHaveLength(0)
        expect(v.passed, `${label} 体检 passed=false 但 errors 是空的，口径自相矛盾`).toBe(true)
        detail.push(
          `体检：通过，warnings ${v.warnings?.length ?? 0} 条` +
            (v.warnings?.length ? `（${v.warnings.join(' / ')}）` : '')
        )

        // ---------- 保真：后端算了什么，界面上就得看得见什么（双向） ----------
        const changes = v.manifest?.changes ?? []
        const kinds = changes.map((x) => x.kind)
        detail.push(`manifest：riskLevel=${v.manifest?.riskLevel ?? '?'}，kinds=[${kinds.join(', ')}]`)
        expect(changes.length, `${label} 的 manifest 里一条变更都没有 —— 空计划不该出草稿卡`).toBeGreaterThan(0)

        const searchable = changes
          .filter((x) => x.kind === 'FORM_CREATE')
          .reduce((n, x) => {
            const d = x.detail ?? {}
            // 🔴 两个来源都要看：前端 searchConditions 只读 detail.fields[].searchable，
            //    但后端 detail 里还有一个平行的 searchableFields 数组。只按前端那条路径推期望值，
            //    等于拿 UI 的口径去验 UI —— 后端把可查询字段放进 searchableFields 而 fields[].searchable
            //    全是 null 时，两边一起看不见，检查恒绿（实测这轮两处都是空，口径一致；
            //    但「一致」要每次现场量出来，不能假设）
            const fromFields = ((d.fields ?? d.formFields ?? []) as any[]).filter((f) =>
              [true, 'true', 1, '1'].includes(f?.searchable)
            ).length
            const fromList = Array.isArray(d.searchableFields) ? d.searchableFields.length : 0
            return n + Math.max(fromFields, fromList)
          }, 0)

        // 四块的期望值全部**从后端口径反推**，不写死：AI 这轮规划出什么，界面就该画出什么。
        // 🔴 表这一块要认三种 kind：ChangeManifestCard:585 的 tableGroups 依次吃
        //    TABLE_CREATE、TABLE_ALTER、**TABLE_REGISTER**（登记已有表）。漏了最后一种的话，
        //    一条「复用已有表」的正确规划会画出表区块、而期望值说「不该有」⟹ 红在正确答案上。
        //    这不是假想：示例 55 的第 1 步原文就是「查一下有没有能复用的表，别急着建新表」
        const expectBlocks: Record<string, boolean> = {
          'manifest-tables':
            kinds.includes('TABLE_CREATE') ||
            kinds.includes('TABLE_ALTER') ||
            kinds.includes('TABLE_REGISTER'),
          'manifest-form-fields': kinds.includes('FORM_CREATE') || kinds.includes('FORM_UPDATE'),
          'manifest-search-conditions': searchable > 0,
          'manifest-permissions': kinds.includes('FORM_PUBLISH')
        }
        for (const [testid, should] of Object.entries(expectBlocks)) {
          const n = await page.locator(`[data-testid="${testid}"]`).count()
          if (should) {
            expect(
              n,
              `${label} 后端 manifest 里有对应变更（kinds=[${kinds.join(',')}], searchable=${searchable}），` +
                `但界面上 ${testid} 没渲染 —— 用户看不见自己将要担的那部分风险`
            ).toBeGreaterThan(0)
          } else {
            expect(
              n,
              `${label} 后端 manifest 里没有对应变更（kinds=[${kinds.join(',')}], searchable=${searchable}），` +
                `界面上却画出了 ${testid} —— 凭空吓人`
            ).toBe(0)
          }
        }
        detail.push(
          `四块保真：${Object.entries(expectBlocks)
            .map(([k, s]) => `${k.replace('manifest-', '')}=${s ? '有' : '无'}`)
            .join('，')}`
        )

        // 🔴 这条现在才**真的**在说「本条示例挂了 alert」：开跑前已经断言过 alert 清零
        //    （见上面 `i > 0` 那段），所以留到这里的只可能是本条自己产的。
        //    原先它是**页面级**计数、又不抓原文，两件事都分不清 —— run7 的 id=59 就是
        //    被 55/57 留下的 alert 判红的，而报告只印了一句「页面上挂了 error alert」，
        //    既没说是哪条示例的错、也没说错在哪。原文必须落进断言消息与报告。
        const leftover = page.locator('.el-alert--error')
        const leftoverCount = await leftover.count()
        // 🔴 只在真的数到 alert 时才去读原文：没有 alert 时 innerText 要等满显式 timeout 才 reject，
        //    每条示例白等 10 秒。count() 不等待，先用它分流。
        const leftoverText =
          leftoverCount > 0 ? await boundedText(leftover.last(), 10_000) : ''
        if (leftoverText) {
          detail.push(`error alert 原文：${leftoverText}`)
        }
        expect(
          leftoverCount,
          `${label} 页面上挂了 error alert，原文：${leftoverText || '（10 秒内没读到）'}`
        ).toBe(0)

        // 🔴 记进「本轮新造」清单，而**不是**塞回 baselineDefs。
        //    早先这里写的是 baselineDefs.set(def.id, ...)，本意是让下一条示例别把它重复当成新的，
        //    副作用是 afterAll 的差集里它也不再算「本轮造的」⟹ 草稿永远删不掉、
        //    报告还印一句「本轮新造 0 条」把这事盖过去。两个用途必须分开记
        runCreatedDefs.push(def.id)
        sent++
      } catch (e) {
        // 🔴 只截第一行本来是**报告可读性**的取舍（Playwright 的完整错误后面还跟着源码框，
        //    几十行噪音不该进 markdown），但 run8 证明它会把真因整个吞掉：
        //    strict mode violation 的原文在第 3 行，报告里只剩第 1 行那句自定义判词，
        //    于是我照着「草稿卡不在待确认态」去查状态机，而卡片当时**正是**待确认态（缺陷 D4-12）。
        //    所以除第一行外，「命中多个元素」这类**定位失败**的原文也一并留下 ——
        //    它说的是「这条断言自己指错了地方」，不是「产品错了」，两者在报告里必须能分开。
        const lines = (e instanceof Error ? e.message : String(e)).split('\n')
        const cause = lines.find((l, n) => n > 0 && /strict mode violation/i.test(l))
        const msg = cause ? `${lines[0].trim()}｜定位失败原文：${cause.trim()}` : lines[0]
        failures.push(`${label}：${msg}`)
        detail.push(`❌ ${msg}`)
      }

      rows.push(
        `\n---\n\n## ${i + 1}/${targets.length} · id=${c.id} · ${c.title}\n\n` +
          `- 耗时：${Date.now() - startedAt}ms\n` +
          `${detail.map((d) => `- ${d}`).join('\n')}\n\n` +
          `**提问**\n\n${c.content}\n\n` +
          `**验收标准（expect_hint · 人工评审用）**\n\n${c.expectHint ?? ''}\n`
      )
      try {
        writeFileSync(REPORT, rows.join(''), 'utf8')
      } catch {}
    }

    rows.push(
      `\n---\n\n## 汇总\n\n- 真发：${sent}/${targets.length} 条\n- 失败：${failures.length} 条\n` +
        (failures.length ? failures.map((f) => `  - ${f}`).join('\n') + '\n' : '')
    )

    expect(
      failures,
      `${failures.length} 条 BUILD 示例没过（详见 ${path.relative(process.cwd(), REPORT)}）`
    ).toHaveLength(0)
  })
})

/**
 * 「等这一轮真发收敛到终态」已抽到 `helpers/terminal.ts`，本文件用的是 `waitTerminal`
 *
 * 🔴 抽出去的两个理由，第一个是硬的：原先那份本地实现里
 *    `await answer.textContent().catch(() => '')` 没有显式 timeout，而
 *    `playwright.config.ts` **没设 `use.actionTimeout`** ⟹ locator 默认无限等。
 *    这一处靠前面的 `isVisible()` 兜着（元素存在时 textContent 会立刻返回），
 *    所以还没真炸过；但 A4-d 那份同构实现里的 `alert.last().innerText()` 炸了 ——
 *    页面没有 error alert 时它**永不 settle**，`while (Date.now() < deadline)` 的守卫
 *    再也轮不到被求值，整条用例永久挂起（run3 就是这么被人手杀掉的，afterAll 没跑、残留没清）。
 *    同一个坑不该在两个文件里各留一份。
 *
 * 第二个理由：方案 §2-7 要求判据自己有独立的构造样本测试，而构造样本必须打**真发用例用的
 * 那同一个函数** —— 见 `tests/e2e/wait-terminal-deadline.spec.ts`。
 *
 * 🔴 本文件用的是 `waitTerminal` 而**不是** `waitTerminalOutcome`（缺陷 D4-10/D4-11，2026-10-04 run7）：
 *    后者刻意不认 error alert，于是后端规划失败、alert 早已挂上页面，测试仍空转到
 *    `PER_CASE_PLAN_TIMEOUT` 才返回 null，报告印一句与事实相反的「N 秒内未收敛」。
 *    run7 的 id=55/57 就是这么各白等到预算耗尽（分别**至少** 6 分钟、5 分 40 秒，推导见
 *    `helpers/terminal.ts` 的墓碑）。`waitTerminal` 四种终局都认，且把 alert 原文一并带回来，
 *    正好喂给 §3.3 第 7 条要求的「只准原样引用原文」。它的 alert 分支同样有构造样本阳性对照
 *    （`wait-terminal-deadline.spec.ts` 里那条 `alerted`），不是只靠真发才验得到。
 *    🔴 run8（18:05~18:07）已实测兑现：id=57 的建表被拒在 **54.9 秒**就带着 alert 原文返回
 *    （「字段 participants 的类型 JSON 不在受支持的列表里。可选：DATE/DATETIME/…」），
 *    而不是 run7 那样空转 480 秒再印一句与事实相反的「未收敛」。
 */
