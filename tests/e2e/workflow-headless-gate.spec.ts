import { test, expect, type APIRequestContext } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { API_BASE_URL, apiHeaders, apiLogin, gotoWithAuth, login } from './helpers/auth'
import { STEP_TIMEOUT_MS, boundedText, waitTerminal } from './helpers/terminal'

/**
 * A4-d · 无头流程的人工闸口：真发一轮，验「规划器 + 体检 + 自修正回路」三件事合起来能不能收敛
 *
 * ## 这条用例要抓的那一格
 * 方案（迭代二 §5 A2/S8，第 234 行）要求「真跑一次编排」。落到可断言的地上，真正没人验过的是这一格：
 * **一个「定时触发 + 建表」的请求，最后收敛出来的流程，闸口必须是 `hitl.bpm_approval`，不能是 `hitl.confirm`。**
 *
 * 为什么这一格值得单独钉：`hitl.confirm` 靠 `interruptBefore` 挂起，唤醒只有两条路 ——
 * 人在聊天窗口点确认卡，或人调 resume-stream。定时触发的执行**没有聊天窗口**，
 * 落库时 resume_at 与 event_key 都是 NULL，连「到点自动醒」「被事件叫醒」两个兜底都不存在。
 * 表现是流程发布成功、每次触发多一条静静躺在 INTERRUPTED 的执行记录，谁也不知道
 * （`WorkflowDslValidator.validateHeadlessHitlConfirm` 的类注释把这段写得很直白，V13）。
 *
 * ## 🔴 为什么这一条断言**可以**写死，而同类的 kinds/riskLevel/节点数不能
 * T2 的头注释记了一条实测：同一条 BUILD 示例、输入一字未改、两轮真发，
 * kinds 从 `[FORM_CREATE]` 变成 `[TABLE_CREATE, FORM_CREATE]`、riskLevel 从 LOW 变成 IRREVERSIBLE、
 * 节点数 10→8、校验轮次 2→5。所以那边任何写死取值的断言都是**必然间歇性红**的。
 *
 * 闸口类型不一样：它是**被体检逼出来的**，不是模型随手挑的。
 *   · 无头流程里出现 `hitl.confirm` → V13 报 **error**；
 *   · 声明风险 IRREVERSIBLE 的写节点上游没有闸口 → V11 报 **error**；
 *   · 而这两条 error 的文案**都直接写出了该改成什么**（V13 那句结尾就是「请改用 hitl.bpm_approval」）。
 * 规划器跑的是自修正回路：error 不消就不出草稿。于是「收敛后的 DSL 里没有 hitl.confirm」
 * 这个结论的稳定性来自回路，而不是来自模型当天的心情 —— 这正是方案 §6.3-5 要的
 * 「断言机制在运作，而不是断言没报错」。
 *
 * ## 断言清单（① ~ ⑧）
 *   ① 前置阳性对照：/validate 这个端点**真的会拒**（拿一份空 DSL 去打，必须 passed=false）。
 *      没有这一条，后面所有「passed=false」都可能是端点压根没通 —— §6.3-6。
 *   ② 真发出了流程草稿卡（走了 BUILD 路径，不是被当成闲聊答了一段字）。
 *   ③ 收敛后的 **DSL** 触发器**真的是无头**（schedule）。
 *      🔴 这一条不许省，也不许拿 def 行的 trigger_type 兜底：V11/V13 走 `triggerTypeOf(def)`，
 *      读的是 **DSL 的 trigger 块**；行上那列是保存时另抽的。
 *      def #427（2026-10-04 那轮 T1 漏下的残留，id=13 产出）实测 `trigger` 块**整个是 null**，
 *      而 `isHeadlessTrigger(null)` 按设计返回 false（没有 trigger 的定义只能由人点 run-stream 跑，
 *      那个人在场）。也就是说：规划器**会**把触发器丢掉，而一旦丢掉，V11/V13 全部静默失效、
 *      本用例的 ⑤⑥⑦ 会**全部变成空断言并且全绿**。所以这里必须先把「DSL 确实无头」钉住。
 *      ⚠️ def 行那一列只在**与 DSL 矛盾**时才红，NULL 只报不红 —— 本库从无 schedule 先例，
 *      且该列填充与创建路径有关（详见用例体里那条注释）。§6.3-23：验不了就明说验不了。
 *   ④ 收敛后的 DSL 打 /validate **passed=true**（自修正回路真的收敛了，不是撞够轮次被放弃）。
 *      这一条同时是 ⑥⑦ 的阳性对照：没有它，「插一个节点进去被拒」可能只是我把 DSL 插坏了。
 *   ⑤ 收敛后的 DSL 里**没有** `hitl.confirm` 节点。
 *   ⑥ 变异探针（拒的一侧）：往收敛后的 DSL 里**插一个** `hitl.confirm`，/validate 必须 passed=false，
 *      且错误文案里必须出现「聊天确认卡」与「hitl.bpm_approval」——
 *      红要红在预期的那条规则上，不是随便红一下就算（§6.3-8）。
 *   ⑦ 变异探针（放的一侧，闸门必须双向断言 §6.3-4）：同一个位置插 `hitl.bpm_approval`，
 *      则「聊天确认卡」这条错误**不许**出现。
 *      ⚠️ 这里刻意**不**断言 passed=true：一个光板 bpm_approval 没配 bpmProcessDefKey，
 *      很可能撞上别的规则（那是它该撞的），本条只对 V13 这一条规则的有无表态。
 *
 * ### 🔴 ⑥⑦ 的判据为什么是「聊天确认卡」而不是看起来更直白的「没有人在场」
 * 因为**「没有人在场」不是 V13 独有的**，V11 的 error 分支（`WorkflowDslValidator:1309`，
 * 无头 + IRREVERSIBLE + 上游没闸口）也印同一句「本流程由…触发、跑起来时没有人在场」，
 * 而且它的出路文案里**同样**写着 `hitl.bpm_approval`（:1313）。
 * 用这句当判据的话，⑥ 会因为 V11 报错而「通过」、⑦ 会因为 V11 报错而「失败」——
 * 两条断言都在验一条根本没打算验的规则，而且方向还反了。
 * 「一直停在 INTERRUPTED」也不行：V13(:1364) 与 V14(:1425/:1435) 都有它。
 * 在**错误文案**里唯一属于 V13 的是「推一张聊天确认卡然后挂起」（:1363）——
 * 该短语在本类的其余出现处（:191/:1210/:1525）全是注释，不会进 errors。
 *
 * ⑧ 的判据「上游没有人工闸口」没有这个问题：V11 的 error(:1304) 与 warning(:1320) 都用它，
 * 而 ⑧ 只搜 errors，warning 撞不进来。
 *
 * ### 插一个光板 `hitl.bpm_approval`（config 为空）算不算闸口
 * 算。V11 收闸口只看节点 type（`:1264-1275`：`BPM_APPROVAL_TYPE.equals(node.getType())` 就进
 * headlessGates），**不看 config**。所以 ⑦ 插进去的那个光板节点确实能满足 V11，
 * 不会因为「缺 bpmProcessDefKey」而让 V11 补一刀、把 ⑦ 的判据污染掉。
 * （这条是读代码确认的，不是猜的 —— 猜错的话 ⑦ 会变成一条恒红的断言。）
 *   ⑧ 构造样本（§6-3-7，不依赖模型）：手搓一份「schedule 触发 + datamodel_create + 上游没有闸口」
 *      的最小 DSL，/validate 必须报出「上游没有人工闸口」。
 *      这一条证明 V11 的 **error** 分支在这个后端构建上是活的 ——
 *      ③④⑤ 走通时模型很可能已经自己把闸口加上了，于是 V11 那一格在本轮**根本没被触发**，
 *      没有 ⑧ 就等于「V11 存在」这件事只由单测背书、没有真跑背书。
 *
 * ## 🔴 验不了的部分，明说（§6.3-23）
 * 「声明风险 IRREVERSIBLE 的写节点上游必须有闸口」这条，**前端拿不到逐工具的声明风险**：
 * `/node-io-contract` 的 Contract 记录里没有 risk 字段（grep 过，一个字都没有），
 * 于是本用例只能用 manifest 的**流程级** riskLevel 当代理。
 * 若本轮 riskLevel 不是 IRREVERSIBLE，则「不可逆动作 → 必须有 BPM 闸口」这一格**没有被检验**，
 * 报告里会打一行显眼的 ⚠️。V11 的 error 分支改由 ⑧ 的构造样本独立背书。
 *
 * ## 数据卫生
 * 与 T1/T2 同一套纪律，且踩过同样的坑：
 *   · access token 只活 1800 秒，而真发一轮可能几十分钟 ⟹ **afterAll 必须重新登录**再收尾，
 *     否则清单取成空集、删 0 条、还印一句像成功的话（T1 首轮就这么漏了 42 条会话）。
 *   · 所有清单类接口先验 `code`，再信 `data`（`expectOk`）。
 *   · 残留核账：会话与流程 def 都必须回到基线，**残留非空即视为该轮失败**（方案 §6.2）。
 *   · 🔴 建表是 IRREVERSIBLE，本用例**只出草稿、绝不点「确认并运行」**，也绝不调 /publish。
 *     ⑧ 那份构造样本走的是 /validate，它只读不落库（端点自己的 @Operation 写着「只读不落库」）。
 *
 * ## 与其它用例的关系
 * 本文件**不与 T1/T2 同时跑**：三者的 afterAll 都是「拿基线做差集然后删」，
 * 并发时彼此新建的会话会被对方当成残留删掉。
 */

const REPORT_DIR = path.join(__dirname, '../../_evidence')
const REPORT = path.join(REPORT_DIR, 'workflow-headless-gate.md')
/** 带时间戳的副本。理由与 T1 同：固定文件名会悄悄吃掉上一轮的证据 */
const REPORT_STAMPED = path.join(
  REPORT_DIR,
  `workflow-headless-gate.${new Date().toISOString().replace(/[:.]/g, '-')}.md`
)

/** 单轮规划等草稿卡的上限。agent-plan-stream 用 480 秒；建表这类要多轮体检，给到 600 */
const PLAN_TIMEOUT = 600_000

const H = () => apiHeaders(token)
const conversationPageApi = `${API_BASE_URL}/agent/assistant/conversation/page`
const conversationDeleteApi = `${API_BASE_URL}/agent/assistant/conversation/delete`
const defPageApi = `${API_BASE_URL}/agent/workflow-def/page`
const defGetApi = `${API_BASE_URL}/agent/workflow-def/get`
const defDeleteApi = `${API_BASE_URL}/agent/workflow-def/delete`
const validateApi = `${API_BASE_URL}/agent/workflow-def/validate`

/**
 * 提问正文
 *
 * 🔴 **刻意不提闸口**。一旦写成「请用 BPM 审批做闸口」，模型照抄就能过，
 * 本用例就退化成「验模型会不会复读我的要求」，A2/S8 那个「体检 error 逼着回路改对」的机制
 * 一点都没被检验（§6.3-5：要断言机制在运作）。
 * 只给三件事实：要**新建**一张表、要**定时**自动跑、跑的时候**没人守着**。
 * 闸口该用什么类型，让规划器自己和体检去谈。
 */
const PROMPT = [
  '我要建一张新表「xpy_e2e_gate_probe」，用来记录设备巡检结果，',
  '字段有：巡检人、巡检时间、设备编号、巡检结论、备注。这张表现在不存在，需要你新建。',
  '',
  '请把它做成一个每天早上 8 点自动执行的流程，到点自己跑起来，不需要我守着。',
  '',
  '先出草稿给我看，不要自己发布。'
].join('\n')

/**
 * ⑧ 的构造样本用的表名。两条硬约束，都是实测撞出来的：
 *   · 必须是一张**确定不存在**的表，否则干跑会先报「表名被占」
 *   · 🔴 必须以 `biz_` 开头（`DataModelParamResolver.CREATE_PARAMS_SCHEMA:60`）。
 *     先前写成 `xpy_e2e_v11_probe`，干跑于是**多出一条无关错误**
 *     「表名 xpy_e2e_v11_probe 缺少业务表前缀，应改为 biz_…」——
 *     V11 照样报，但 ⑧ 红/绿的归因被污染了（§6.3-8 的第二个判据：红要红在对的原因上）
 */
const PROBE_TABLE = 'biz_xpy_e2e_v11_probe'
/** ⑥⑦ 插进去的那个探针节点的 id。取个不可能与模型产出撞车的名字 */
const PROBE_NODE_ID = 'e2e_gate_probe_node'

/**
 * V13 在错误文案里**独有**的判据。为什么不用「没有人在场」见文件头 ⑥⑦ 那一节
 * （V11:1309 也印那一句，用它会验错规则、而且 ⑦ 的方向还会反过来）
 */
const V13_MARK = '聊天确认卡'
/** V11 的 error 判据。warning(:1320) 用同一句，但本用例只搜 errors，撞不进来 */
const V11_MARK = '上游没有人工闸口'

type ValidateResp = {
  passed?: boolean
  errors?: string[]
  warnings?: string[]
  manifest?: { riskLevel?: string; headline?: string; changes?: { kind?: string }[] } | null
}
type DefRow = { id: number; name: string; status: string; triggerType?: string | null }
type DslNode = { id?: string; type?: string; name?: string; config?: Recordable }
type DslEdge = { from?: string; to?: string }
type Dsl = { trigger?: { type?: string } | null; nodes?: DslNode[]; edges?: DslEdge[] }

let token = ''
let baselineConversationIds = new Set<number>()
let baselineDefIds = new Set<number>()
const rows: string[] = []

function flushReport(): void {
  const text = rows.join('')
  try {
    mkdirSync(REPORT_DIR, { recursive: true })
    writeFileSync(REPORT, text, 'utf8')
    writeFileSync(REPORT_STAMPED, text, 'utf8')
  } catch {
    /* 证据写不出去不影响断言结论 */
  }
}

/**
 * 🔴 清单类接口必须先验 code，再信 data
 * 老写法 `body?.data?.list ?? []` 会把 401 静默吃成空数组：token 过期后差集恒为空、
 * 删 0 条、残留检查恒过，报告上还印一句「已清理」—— 一个恒绿的残留检查比没有检查更坏。
 */
function expectOk(body: any, what: string): void {
  expect(body?.code, `${what}失败（code=${body?.code}）：${body?.msg ?? ''}`).toBe(0)
}

async function listConversationIds(request: APIRequestContext): Promise<Set<number>> {
  const ids = new Set<number>()
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const resp = await request.get(conversationPageApi, {
      headers: H(),
      params: { pageNo, pageSize: 100 }
    })
    const body = await resp.json()
    expectOk(body, `取会话清单第 ${pageNo} 页`)
    const list = body.data?.list ?? []
    for (const item of list) ids.add(item.id as number)
    if (list.length < 100) break
  }
  return ids
}

async function listDefs(request: APIRequestContext): Promise<DefRow[]> {
  const out: DefRow[] = []
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const resp = await request.get(defPageApi, { headers: H(), params: { pageNo, pageSize: 100 } })
    const body = await resp.json()
    expectOk(body, `取流程 def 清单第 ${pageNo} 页`)
    const list = (body.data?.list ?? []) as DefRow[]
    out.push(...list)
    if (list.length < 100) break
  }
  return out
}

/** `/get?id` 才带完整 dsl；`/page` 刻意把它置 null（一份 DSL 几十 KB） */
async function fetchDsl(request: APIRequestContext, id: number): Promise<Dsl> {
  const resp = await request.get(defGetApi, { headers: H(), params: { id } })
  const body = await resp.json()
  expectOk(body, `取 def #${id} 详情`)
  const dsl = body?.data?.dsl as string | undefined
  expect(dsl?.trim().length, `def #${id} 取不到 DSL 正文（/page 的 dsl 是 null，必须走 /get?id）`).toBeGreaterThan(0)
  return JSON.parse(dsl as string) as Dsl
}

async function validate(
  request: APIRequestContext,
  dsl: string | Dsl,
  id?: number
): Promise<ValidateResp> {
  const payload = typeof dsl === 'string' ? dsl : JSON.stringify(dsl)
  const resp = await request.post(validateApi, { headers: H(), data: { dsl: payload, id } })
  const body = await resp.json()
  expectOk(body, '调 /validate')
  return (body.data ?? {}) as ValidateResp
}

/** 把 `trigger.schedule` / `schedule` / `TRIGGER.CHAT` 之流归一成裸类型，与 isHeadlessTrigger 同口径 */
function normalizeTriggerType(raw?: string | null): string | null {
  if (!raw) return null
  const t = String(raw).trim().toLowerCase()
  return t.startsWith('trigger.') ? t.slice('trigger.'.length) : t
}

/**
 * 在 START 与第一个节点之间插一个探针节点
 *
 * 🔴 不能只是 push 一个孤立节点：那样它会**不可达**，V13 虽然照样报（它只看节点类型 + 触发器），
 *    但 ⑦ 那一侧就会因为「不可达节点」这类无关错误而变得说不清；
 *    而且一份带孤立节点的 DSL 根本不能代表「作者真会这么写」的那一格。
 *    串进主链才是 ⑥⑦ 想验的写法。
 */
function withProbeNode(dsl: Dsl, type: string): Dsl {
  const nodes = [...(dsl.nodes ?? [])]
  const edges = [...(dsl.edges ?? [])]
  const startEdge = edges.find((e) => e.from === 'START')
  expect(
    startEdge,
    '收敛后的 DSL 里没有 from=START 的边，探针节点没地方串 —— 这份 DSL 的结构与本用例的假设不符'
  ).toBeTruthy()
  const firstId = startEdge!.to
  const kept = edges.filter((e) => e !== startEdge)
  return {
    ...dsl,
    nodes: [
      { id: PROBE_NODE_ID, type, name: 'e2e 探针节点', config: {} },
      ...nodes
    ],
    edges: [
      { from: 'START', to: PROBE_NODE_ID },
      { from: PROBE_NODE_ID, to: firstId },
      ...kept
    ]
  }
}

/** ⑧ 的构造样本：schedule 触发 + datamodel_create + 上游一个闸口都没有 */
function syntheticUnguardedHeadlessDsl(): Dsl {
  return {
    // 🔴 字符串 '1.0'，不是数字 1。实测库里真实的 DSL（def #426/#427）这一项都是 "1.0"，
    //    写成数字会在更早的版本校验就被拒，⑧ 于是红在一个与 V11 无关的原因上
    dslVersion: '1.0',
    name: 'e2e V11 构造样本',
    trigger: { type: 'trigger.schedule', config: { cron: '0 0 8 * * ?' } },
    nodes: [
      {
        id: 'create_table',
        type: 'tool',
        name: '新建表',
        config: {
          toolId: 'datamodel_create',
          outputVar: 'create_out',
          // args 的形状照 DataModelParamResolver.CREATE_PARAMS_SCHEMA(:58-75)：
          //   · 表名嵌在 model 里，不是顶层（这一点与 form_save_draft 的 mainTable 在顶层**不一样**，踩过）
          //   · 🔴 列的键是 columnName/columnComment/columnType，**不是** name/comment/type。
          //     写成 name 时干跑只回一句「存在没有字段名的列」，一条 × 列数，
          //     和 V11 混在同一个 errors 数组里 —— ⑧ 于是可能红在字段名上而不是闸口上
          //   · 🔴 columnType 是**受控枚举**且取值大写（DataModelColumnTypeEnum：STRING/LONG/…），
          //     不是 MySQL 类型名。typeOf() 只按 type 匹配、不看 mysqlType，
          //     所以 'bigint' / 'varchar(64)' 都不认；STRING 还必须显式给 length
          args: {
            model: {
              tableName: PROBE_TABLE,
              tableComment: 'e2e V11 构造样本，只走 /validate 只读干跑，不落库',
              columns: [
                { columnName: 'owner_user_id', columnType: 'LONG', columnComment: '归属人' },
                { columnName: 'result', columnType: 'STRING', length: 64, columnComment: '巡检结论' }
              ]
            }
          }
        }
      }
    ],
    edges: [{ from: 'START', to: 'create_table' }, { from: 'create_table', to: 'END' }]
  } as unknown as Dsl
}

/**
 * `Terminal` 与 `waitTerminal` 已抽到 `helpers/terminal.ts`
 *
 * 🔴 抽出去不是为了整洁，是为了**能被单独测**：方案 §2-7 要求判据自己有独立的构造样本测试，
 *    而构造样本必须打的是**真发用例用的那同一个函数** —— 留在 spec 文件里就没法在不跑真发
 *    （45 分钟 + 花钱）的前提下测它。见 `tests/e2e/wait-terminal-deadline.spec.ts`。
 *
 * 原先那份实现有一个会让整条用例永久挂起的缺陷（`alert.last().innerText()` 在页面没有
 * error alert 时永不 settle，因为 `playwright.config.ts` 没设 `use.actionTimeout`），
 * 完整的因果链与两层防护写在 `helpers/terminal.ts` 的头注释里。
 *
 * 下面两段判据说明**仍然适用**，故原样保留：
 *
 * <h3>🔴 为什么必须沿途记录 sawPlanning，而不能事后再去看</h3>
 * 规划进度条是 {@code v-if="status === 'planning'"}，草稿卡是它的 {@code v-else} ——
 * 一旦这一轮结束（出卡、报错、或被取消），{@code cardStatus} 被清掉，进度条就<b>再也查不到了</b>。
 * 事后去断言它必然为假，于是「分类走对了但 Planner 没产出草稿」会被记成「压根没走 BUILD」。
 *
 * <p>这个区分不是咬文嚼字，两者的处置<b>完全相反</b>：
 * <ul>
 *   <li>没走 BUILD ⟹ 意图分型的锅，该去看 classifier 的提示词/用例的 expect_intent；</li>
 *   <li>走了 BUILD 但没出卡 ⟹ Planner 的锅（DSL 产不合法、轮次耗尽、厂商报错），
 *       该去看 {@code agent_usage_log} 的 PLAN_DSL 行与后端日志的 {@code [parseDsl]}。</li>
 * </ul>
 * 实测疤（2026-10-04）：A4-d 连着几轮都报「被判成了 CHAT」，查下来分类<b>一直是对的</b>，
 * 真因是 few-shot 样例把 {@code datamodel_create} 的参数形状教错了（{@code args.name} 而非
 * {@code args.model.{tableName,tableComment,columns[]}}），模型照抄、6 轮全在同一处把括号数错。
 * 报告把一次 Planner 缺陷记成了分型缺陷，排查方向整个反了。
 *
 * <h3>🔴 error alert 也是一种终局，必须当场认出来并立刻返回</h3>
 * 实测疤（2026-10-04 run2）：Planner 第 3 轮撞上定点检测，07:36 就把完整失败原因挂上了页面，
 * 但本函数原先只认「草稿卡」与「答了一段文字」两种终局，于是又空转 240 秒直到 600 秒超时，
 * 报告印的是「等满 600 秒未收敛」—— 把一个 5 分钟就有<b>确定结论</b>的故障，
 * 说成了一个 10 分钟<b>没结论</b>的故障。判词指错方向，排查的人会去查超时/网络，
 * 而真因就明明白白写在页面那段 alert 里。
 */

test.describe('A4-d · 无头流程的人工闸口（真发 + 变异探针）', () => {
  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)
    baselineConversationIds = await listConversationIds(request)
    baselineDefIds = new Set((await listDefs(request)).map((d) => d.id))
    rows.push(
      `# A4-d · 无头流程的人工闸口\n\n` +
        `- 生成时间：${new Date().toISOString()}\n` +
        `- 基线：会话 ${baselineConversationIds.size} 条、流程 def ${baselineDefIds.size} 条\n\n` +
        `> 🔴 本用例**只出草稿**，不点「确认并运行」、不调 /publish。建表 IRREVERSIBLE，只允许在开发库跑。\n\n---\n\n`
    )
  })

  test.afterAll(async ({ request }) => {
    // 🔴 必须重新登录：beforeAll 那个 token 到这儿可能已经跑过 30 分钟（access_token_validity_seconds=1800）
    if (token) {
      try {
        token = await apiLogin(request)
      } catch {
        rows.push(`\n---\n\n⚠️ 收尾重新登录失败，本轮残留**没有清理**，需人工核\n`)
      }
    }
    let deletedConv = 0
    let deletedDef = 0
    if (token) {
      for (const id of await listConversationIds(request)) {
        if (baselineConversationIds.has(id)) continue
        const r = await request.delete(conversationDeleteApi, { headers: H(), params: { id } })
        expectOk(await r.json(), `删除会话 ${id}`)
        deletedConv++
      }
      for (const d of await listDefs(request)) {
        if (baselineDefIds.has(d.id)) continue
        const r = await request.delete(defDeleteApi, { headers: H(), params: { id: d.id } })
        expectOk(await r.json(), `删除流程 def ${d.id}`)
        deletedDef++
      }
      const leftoverConv = (await listConversationIds(request)).size - baselineConversationIds.size
      const leftoverDef = (await listDefs(request)).filter((d) => !baselineDefIds.has(d.id)).length
      rows.push(
        `\n---\n\n## 残留核账（方案 §6.2）\n\n` +
          `- 会话：跑前 ${baselineConversationIds.size} 条 → 删除本轮新建 ${deletedConv} 条 → 跑后多出 ${leftoverConv} 条\n` +
          `- 流程 def：跑前 ${baselineDefIds.size} 条 → 删除本轮新建 ${deletedDef} 条 → 跑后多出 ${leftoverDef} 条\n` +
          `- 物理表：**本用例不建表**（只出草稿 + 只读体检），故不核表数\n`
      )
      expect(leftoverConv, `会话没清干净（§6.2：残留非空即视为该轮失败）`).toBe(0)
      expect(leftoverDef, `流程 def 没清干净（§6.2：残留非空即视为该轮失败）`).toBe(0)
    }
    flushReport()
  })

  test('① 前置阳性对照：/validate 真的会拒；⑧ 构造样本真的能触发 V11', async ({ request }) => {
    // ① 没有这一条，后面每个 passed=false 都可能是端点没通
    const empty = await validate(request, { nodes: [], edges: [] })
    expect(
      empty.passed,
      `/validate 对一份空 DSL 竟然判 passed=true —— 这个端点没有在真校验，` +
        `后面所有「被拒」的结论都不成立。errors=${JSON.stringify(empty.errors ?? [])}`
    ).toBe(false)
    rows.push(`## ① 前置阳性对照\n\n- 空 DSL → passed=${empty.passed}，errors ${empty.errors?.length ?? 0} 条 ✅\n\n`)

    // ⑧ V11 的 error 分支：无头 + 不可逆 + 上游没闸口
    const synthetic = await validate(request, syntheticUnguardedHeadlessDsl())
    const errs = synthetic.errors ?? []
    rows.push(
      `## ⑧ 构造样本（V11 的 error 分支）\n\n` +
        `- passed=${synthetic.passed}\n` +
        `- errors：\n${errs.map((e) => `  - ${e}`).join('\n') || '  -（无）'}\n\n`
    )
    expect(
      errs.some((e) => e.includes(V11_MARK)),
      `构造样本（schedule 触发 + datamodel_create + 上游无闸口）**没有**触发 V11 的 error。` +
        `两种可能：要么 V11 在这个构建上失效了，要么这份样本压根没走到 V11（比如 DSL 在更早的结构校验就被拒、` +
        `或干跑没能识别出 datamodel_create 的声明风险）。errors 全文已落进报告，先看它到底报了什么`
    ).toBe(true)
    expect(
      errs.some((e) => e.includes('hitl.bpm_approval')),
      `V11 报了「上游没有人工闸口」，但文案里**没有给出该改成什么**。` +
        `AgentValidateResult 的纪律是文案必须给出路 —— 只说「没闸口」会让作者把动作整个删掉`
    ).toBe(true)
    flushReport()
  })

  test('②~⑦ 真发一轮「定时 + 建表」：收敛、无头、无 hitl.confirm，且闸门双向可验', async ({
    page,
    request
  }) => {
    test.setTimeout(1_500_000)
    const startedAt = Date.now()

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 20_000 })
    await textarea.fill(PROMPT)
    await page.getByRole('button', { name: /发\s*送/ }).click()

    // ---------- ② 走了 BUILD 路径 ----------
    const { outcome: card, sawPlanning, errorText } = await waitTerminal(page, PLAN_TIMEOUT)
    /**
     * 🔴 没出草稿卡时，error alert 的原文就是这一轮**唯一**的一手结论，必须先捞出来再断言
     *
     * 实测疤（T1 run3，2026-10-04 03:23 起）：页面上**明明挂着** `.el-alert--error`
     * （AssistantChat.vue 把 SSE 的 errorMsg 渲染成它），报告印的却是「问答气泡没渲染出来」——
     * 把一次后端故障记成了前端渲染缺陷，排查方向整个反了。
     *
     * ⚠️ 但「有 error alert」只说明**有错**，不说明错在哪一层。BUILD 路径上
     * 意图分型失败、厂商侧报错、Planner 轮次耗尽，三者都会在同一个位置挂出 alert。
     * 所以还要靠 sawPlanning 把它们分开，见 waitTerminal 的注释与下面的三分支判词。
     *
     * ⚠️ 更要紧的是**别替 alert 编原因**。同一次 run3 我一度把它记成「DashScope 免费额度耗尽、
     * 三个候选模型全回 403、配额恢复前不要重跑」，并写进了判词 —— 那是错的，害用户白花钱续了额度。
     * 真相：`AllocationQuota.FreeTierOnly` 是**单个模型**的免费额度桶用完，不是账号耗尽；
     * 日志里 66/67/68/69 共 403 了 166 次，而 `MODEL_ALL_UNAVAILABLE`/「没有可用的聊天模型」
     * **全部日志 0 次** —— failover 每次都切成功，没有一次请求因此失败。
     * 所以判词只准**原样引用** alert 原文，不准替它下病因结论：
     * 病因要拿 alert 原文去比 `agent_usage_log` 与后端日志才能定，测试代码没这个能力。
     *
     * 🔴 这条 alert 在 BUILD 路径上**曾经压根渲染不出来**：AssistantChat.vue 把 error alert
     * 包在 `v-if="!item.cardStatus"` 里，而 PLANNING 事件会把 cardStatus 置成 'planning'，
     * ERROR 分支又没清它 —— 于是 Planner 失败时页面只剩一个转不停的圈，一个字都不说。
     * 已修（markError 同时清 cardStatus），修完这一条才真的捞得到东西；
     * run2 里那段「轮次耗尽 + 定点检测」的原文能印进报告，就是这个修复生效的直接证据。
     */
    // 🔴 兜底那一路必须走 boundedText：`card === false`（被判成 CHAT 直接答了文字）且
    //    waitTerminal 没采到 alert 时，页面上**没有** `.el-alert--error`，
    //    裸 `innerText().catch(() => '')` 在 actionTimeout=0 下永不 settle、catch 永不触发 ⟹ 整条用例挂死。
    //    这正是 T1 的 assertPlainAnswer 在 2026-10-04 废掉一轮全量真跑的同一个坑。
    const providerError =
      card === true
        ? ''
        : errorText ||
          (await boundedText(page.locator('.el-alert--error').last(), STEP_TIMEOUT_MS))
    rows.push(
      `## ②~⑦ 真发\n\n- 提问：\n\n\`\`\`\n${PROMPT}\n\`\`\`\n\n` +
        `- 耗时：${Date.now() - startedAt}ms\n` +
        `- 规划进度条出现过：${sawPlanning ? '是（确实走进了 BUILD 路径）' : '否'}\n` +
        (providerError ? `- 页面 error alert 原文：${providerError}\n` : '')
    )

    // 🔴 判据自己要先「探通」一次（§6.3-6）：sawPlanning=false 是本轮用来判「没走 BUILD」的依据，
    //    那它就必须先在一条**成功**的轮次上被证明确实采得到。否则 assistant-planning 这个
    //    data-testid 哪天改了名，判据会静默退化成恒 false，把每一次 Planner 故障都冤枉成分型故障。
    if (card === true) {
      expect(
        sawPlanning,
        `草稿卡出来了，却**从没采到**规划进度条 —— 要么 [data-testid="assistant-planning"] 改名了，` +
          `要么 2 秒一轮的采样漏了它。不管哪种，「有没有走 BUILD」这条判据已经失效：` +
          `失败时会把 Planner 的锅记到意图分型头上，排查方向整个反过来`
      ).toBe(true)
    }

    expect(
      card,
      card === true
        ? ''
        : sawPlanning
          ? `**意图分型是对的**（规划进度条出现过 ⟹ 确实走进了 BUILD 路径），但 Planner 没能产出草稿卡。` +
            `这是 Planner 侧的故障，**不是**分型的结论 —— 该查的是 agent_usage_log 里 scene=PLAN_DSL 的行` +
            `（轮次、每轮 prompt_tokens、落在哪个模型）与后端日志的 [parseDsl]/[planToWorkflow] 段。` +
            `终局：${card === null && providerError ? '页面已挂出 error alert（有确定结论）' : card === null ? '等满 600 秒未收敛（无结论，那才要查超时/网络）' : 'outcome=' + card}。` +
            `页面 error alert 原文：${providerError || '（空 —— alert 没渲染出来，那本身又是一条前端缺陷）'}`
          : providerError
            ? `规划进度条**从未出现**，且页面挂着 error alert ⟹ 这一轮在走进 BUILD 之前就失败了。` +
              `它**不是**意图分型的结论。\n` +
              `🔴 别急着替这段原文下病因：alert 只说明「有错」，错在哪一层要拿它的原文去比 ` +
              `agent_usage_log（scene=INTENT 那一行是 SUCCESS 还是 FAILURE）与后端日志才能定。` +
              `曾经有人（就是我）把它一口咬定成「厂商配额耗尽、恢复前不要重跑」，` +
              `查下来是假的 —— failover 一直在自愈，那句判词白白拦住了重跑。\n` +
              `alert 原文：${providerError}`
            : `规划进度条**从未出现**、也没有任何 error alert ⟹ 意图分型把「定时 + 建表」判成了 CHAT，` +
              `直接答了一段文字（${card === null ? '或等满 600 秒未收敛' : '终局 outcome=' + card}）。` +
              `分型没走 BUILD 路径，后面的闸口断言全都无从谈起`
    ).toBe(true)
    const draftCard = page.locator('[data-testid="workflow-draft-card"]')
    await expect(draftCard.getByText('待确认'), '草稿卡不在「待确认」态').toBeVisible()
    rows.push(`- 草稿卡：待确认，节点 ${await draftCard.locator('[data-testid="workflow-node"]').count()} 个\n`)

    // 🔴 到这里就停：**绝不点「确认并运行」**。建表 IRREVERSIBLE，本用例只验编排、不验执行。
    //    （不断言那个按钮不存在 —— 它本来就该在草稿卡上，T2 也只是不点它而已。）

    // ---------- 找到本轮新造的 def ----------
    const created = (await listDefs(request)).filter((d) => !baselineDefIds.has(d.id))
    expect(
      created.length,
      `草稿卡出来了，但库里没有新增的流程 def（新增 ${created.length} 条）—— 草稿没落库，取不到 DSL`
    ).toBeGreaterThan(0)
    const def = created[0]
    const dsl = await fetchDsl(request, def.id)
    rows.push(`- 新造 def：#${def.id}「${def.name}」状态 ${def.status}\n`)

    // ---------- ③ 真的是无头 ----------
    // 🔴 必须断言 **DSL 里的** trigger，不能拿 def 行的 triggerType 兜底。
    //    V11/V13 走的是 `triggerTypeOf(def)`，它读的是 **DSL 的 trigger 块**；
    //    def 行上那个 trigger_type 是保存时 WorkflowTriggerExtractor 抽出来另存的。
    //    两者不一致时（行说 schedule、DSL 里没有 trigger），**以 DSL 为准的规则会全部静默失效**，
    //    而看行数据的人会以为一切正常 —— 这正是要抓的那一格，所以这里刻意让不一致直接红。
    const fromRow = normalizeTriggerType(def.triggerType)
    const fromDsl = normalizeTriggerType(dsl.trigger?.type)
    rows.push(`- 触发器：DSL 内=${fromDsl ?? 'null'}，def 行=${fromRow ?? 'null'}\n`)
    expect(
      fromDsl,
      `收敛后的 DSL **没有 trigger 块**（def 行上是 ${fromRow ?? 'null'}）。` +
        `这不是「小事漏了一段」：isHeadlessTrigger(null) 按设计返回 false，` +
        `于是 V11/V13/V14 一起静默失效，本用例 ⑤⑥⑦ 会全部变成空断言并且全绿。` +
        `实测先例：def #427（id=13 产出）的 trigger 就是整个 null`
    ).not.toBeNull()
    expect(
      fromDsl,
      `要求「每天早上 8 点自动执行」，DSL 收敛出来的触发器却是「${fromDsl}」—— ` +
        `定时这一半没落地，于是流程不是无头的，闸口类型这件事根本轮不到 V13 管`
    ).toBe('schedule')
    // 🔴 def 行那一列**只在矛盾时才红**，NULL 只报不红。理由（都是查库查出来的，不是猜的）：
    //    · 行上存的是**裸值**（`chat`），不带 `trigger.` 前缀 —— 抽取器会剥掉，normalizeTriggerType 两种都吃；
    //    · 本库**从来没有过一条 trigger_type='schedule' 的 def**（实测 6 条 NULL + 8 条 chat），
    //      所以「AI 规划出 schedule 时行上会不会写 schedule」这件事**没有先例可参照**；
    //    · 而且行上这列的填充与**创建路径**有关：PUBLISHED 的 #416/#417/#418 全是 NULL，
    //      AI 规划出的 DRAFT #419~#422/#426 却都是 'chat'。
    //    在没法先跑一轮看真实取值的情况下把它写成 toBe('schedule')，很可能红在一个良性原因上
    //    （比如草稿阶段压根不抽取、发布时才抽），那就违背了 §6.3-23「验不了就明说验不了」。
    //    但「DSL 说 schedule、行上却写 chat」是**任何时机都讲不通的矛盾**，这一格照红。
    if (fromRow === null) {
      rows.push(
        `- ⚠️ def 行的 triggerType 是 **NULL**，而 DSL 里是 schedule。` +
          `定时调度读的是行上这几列，草稿阶段不抽取也许是设计如此（本库无 schedule 先例可对照），` +
          `但**发布之后**若仍是 NULL，就等于「DSL 说要定时、平台上根本不会定时」。` +
          `本用例只出草稿不发布，故这一格**验不了**，留给人工在发布路径上核\n`
      )
    } else {
      expect(
        fromRow,
        `DSL 里 trigger.type=schedule，def 行的 triggerType 却是「${fromRow}」—— ` +
          `两边讲的不是同一件事。定时调度读的是行上这几列，抽取错了等于「DSL 说要定时、平台上按别的节奏定时」`
      ).toBe('schedule')
    }

    // ---------- ④ 自修正回路真的收敛了 ----------
    const real = await validate(request, dsl, def.id)
    const nodes = dsl.nodes ?? []
    const kinds = (real.manifest?.changes ?? []).map((c) => c.kind)
    rows.push(
      `- 体检（收敛后原样）：passed=${real.passed}，errors ${real.errors?.length ?? 0} 条，` +
        `warnings ${real.warnings?.length ?? 0} 条\n` +
        `- manifest：riskLevel=${real.manifest?.riskLevel ?? '?'}，kinds=[${kinds.join(', ')}]\n` +
        `- 节点类型：[${nodes.map((n) => `${n.id}:${n.type}`).join(', ')}]\n`
    )
    expect(
      real.passed,
      `收敛后的 DSL 打 /validate **没过**（说明草稿是在体检未通过的状态下就端出来的）。errors：\n` +
        (real.errors ?? []).map((e) => `  - ${e}`).join('\n')
    ).toBe(true)

    // ---------- ⑤ 没有 hitl.confirm ----------
    const confirms = nodes.filter((n) => n.type === 'hitl.confirm')
    expect(
      confirms.map((n) => n.id),
      `无头流程里出现了 ${confirms.length} 个 hitl.confirm 节点，而 ④ 刚刚证明这份 DSL 体检是**通过**的 —— ` +
        `两件事不可能同时成立，除非 V13 在这个构建上失效了。` +
        `这种流程发布成功后每次触发都会静静躺在 INTERRUPTED，没有任何唤醒方`
    ).toHaveLength(0)

    // ---------- 🔴 显式记录「不可逆 → 必须有 BPM 闸口」这一格到底有没有被检验 ----------
    const approvals = nodes.filter((n) => n.type === 'hitl.bpm_approval')
    if (real.manifest?.riskLevel === 'IRREVERSIBLE') {
      expect(
        approvals.length,
        `manifest 判本轮是 IRREVERSIBLE，但收敛后的 DSL 里一个 hitl.bpm_approval 都没有。` +
          `④ 又说体检通过 —— 那 V11 的 error 分支就是失效的`
      ).toBeGreaterThan(0)
      rows.push(`- ✅ 「不可逆 → 上游有 BPM 闸口」这一格**被本轮真跑检验到了**（bpm_approval ${approvals.length} 个）\n`)
    } else {
      rows.push(
        `- ⚠️ **本轮 riskLevel=${real.manifest?.riskLevel ?? '?'}，不是 IRREVERSIBLE** —— ` +
          `「不可逆动作上游必须有 BPM 闸口」这一格**没有被真跑检验**，只有 ⑧ 的构造样本在背书 V11。` +
          `原因见 T2 头注释：同一条示例两轮真发，riskLevel 会从 LOW 跳到 IRREVERSIBLE，这一格能不能验到取决于模型当天怎么规划\n`
      )
    }

    // ---------- ⑥⑦ 变异探针：闸门必须双向断言 ----------
    const mutatedConfirm = await validate(request, withProbeNode(dsl, 'hitl.confirm'), def.id)
    const confirmErrs = mutatedConfirm.errors ?? []
    const mutatedApproval = await validate(request, withProbeNode(dsl, 'hitl.bpm_approval'), def.id)
    const approvalErrs = mutatedApproval.errors ?? []
    rows.push(
      `\n### ⑥⑦ 变异探针（只改插入节点的 type，其余一字不动）\n\n` +
        `- 插 hitl.confirm → passed=${mutatedConfirm.passed}，errors ${confirmErrs.length} 条\n` +
        `- 插 hitl.bpm_approval → passed=${mutatedApproval.passed}，errors ${approvalErrs.length} 条\n` +
        `- 插 confirm 时的 errors：\n${confirmErrs.map((e) => `  - ${e}`).join('\n') || '  -（无）'}\n`
    )

    // ⑥ 拒的一侧，且必须红在 V13 那条文案上
    expect(
      mutatedConfirm.passed,
      `往无头流程里插一个 hitl.confirm，/validate 竟然判 passed=true —— V13 没有拦住它。` +
        `④ 已证明未变异时是 passed=true，所以这不是「我本来就没通过过」`
    ).toBe(false)
    expect(
      confirmErrs.some((e) => e.includes(V13_MARK) && e.includes('hitl.bpm_approval')),
      `插 hitl.confirm 后确实 passed=false，但 errors 里**没有** V13 那条文案` +
        `（要同时含「${V13_MARK}」与「hitl.bpm_approval」—— 前者是 V13 在错误文案里独有的判据，` +
        `「没有人在场」不行，V11 也印那一句）。` +
        `那就是红在别的原因上（很可能是我把 DSL 插坏了），§6.3-8 要求红在预期的那条规则上。errors 全文已落进报告`
    ).toBe(true)

    // ⑦ 放的一侧：同位置换成 bpm_approval，V13 必须闭嘴
    expect(
      approvalErrs.some((e) => e.includes(V13_MARK)),
      `同一个位置插 hitl.bpm_approval，V13 却仍然报「${V13_MARK}」—— ` +
        `那这条规则不是在区分闸口类型，而是在无差别拒绝一切人工介入，` +
        `作者按它的文案改完还是过不去（文案给的路是死路）`
    ).toBe(false)

    flushReport()
  })
})
