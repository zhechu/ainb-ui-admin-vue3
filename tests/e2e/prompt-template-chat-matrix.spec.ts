import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { API_BASE_URL, apiHeaders, apiLogin, gotoWithAuth, login } from './helpers/auth'
import { CLICK_TIMEOUT_MS, STEP_TIMEOUT_MS, bounded, boundedText } from './helpers/terminal'
import {
  cleanupOwnedConversations,
  listConversationIdSet,
  watchOwnedConversations,
  type ConversationCleanupReport,
  type ConversationOwnership
} from './helpers/conversation-ownership'

/**
 * T1：CHAT 类示例逐条真发（迭代二方案 §6.1）
 *
 * 🔴 为什么非要真发、而且非要发满一轮
 * 本平台头号缺陷是「配置保存成功但不生效」。落到提示词模板上，它的形状是：
 * 管理页增删改查全绿、点一条也能插进输入框，但真发出去之后模型答非所问、
 * 或者正文里漏出没替换的 {{占位符}}、或者一条本该直接问答的示例被判成了 BUILD
 * 而去编排流程。这四种都不会让任何一条既有单测变红 —— 只有真发一条才知道。
 *
 * 🔴 断言分两半，两半的效力**不一样**，不要混着读：
 *
 *   【机械断言】本用例真的判、判不过就红：
 *     ① 示例正文一字不差地插进了输入框（不是接口返回 200，是 textarea 的值）
 *     ② 流真的收尾了（「停止」按钮消失）
 *     ③ 正文非空
 *     ④ 正文里没有 {{ 残留
 *     ⑤ 没有 error alert（气泡压根没出来时由 ⑭ 先认；吐了一半才挂 alert 的走这一条）
 *     ⑥ 确实走了 CHAT 路径：没有草稿卡、没有规划进度条
 *     ⑦ 正文长度 >= 该条 expect_hint 的长度（**纯拒答除外**，见下）
 *     ⑧ 可比总体内的知识库拒答条数 <= KNOWN_REFUSAL_COUNT（棘轮，总体定义见该常量）
 *     ⑨ CHAT→BUILD 误判的 id 集合 ⊆ KNOWN_MISCLASSIFIED_AS_BUILD（棘轮，新增即红）
 *     ⑩ 等不到答完的 id 集合 ⊆ KNOWN_STREAM_TIMEOUT（棘轮，新增即红）
 *     ⑪ 收尾后会话与流程 def 都回到基线（残留非空即判红，方案 §6.2）
 *     ⑫ 拒答判据本身在真实正文与阈值边界上分类正确（`判据自检` 那条用例，不开浏览器）
 *     ⑬ 三个白名单常量彼此自洽、且都能在示例库里对上号（`数据层审计` 那条用例）
 *     ⑭ 模型侧没答的条数为 0（厂商配额/密钥/网络）—— **排在 ⑧⑨⑩ 之前抛**，
 *        因为它一旦非空，那三条棘轮的分母都在缩水、可能 vacuously 绿（见该断言处的注释）
 *
 *   🔴 ⑧⑨⑩ 三条棘轮的读法：白名单/上限**不是**「跳过不测」。命中已知项的条目照样真发、
 *     照样逐条落报告（打 ⚠️ 而不是 ❌），只是不计入 failures、也**不计入有效覆盖**。
 *     哪天已知的不复现了，汇总段的「棘轮结账」会点出来，那时把集合收紧（只许紧不许松）——
 *     但**只认全量跑**，子集跑（TPL_MATRIX_ONLY）里没复现不算，报告里会明写这个前提。
 *     为什么不让它们红着：见 KNOWN_REFUSAL_COUNT / KNOWN_MISCLASSIFIED_AS_BUILD 的注释，
 *     一句话是「让 T1 永久红在已知缺陷上，等于放弃发现新缺陷」。
 *
 *   【人工评审】本用例**不判**，只把证据落盘：
 *     expect_hint 是一段自然语言验收标准（实测 47~107 字，例如
 *     「要给出流程编排与组织权限两个入口的菜单路径，并按先后排好顺序……
 *       不能只给一句笼统的『在系统设置里』」），里面既有正向要求也有反向要求，
 *     还夹着「必须真去取回表结构、不能凭空猜列名」这种要看工具调用才知道的条款。
 *     它不是一张关键词表，机械断言不了。硬把里面带引号的词抠出来当关键词去匹配是错的：
 *     实测 45 条里只有 19 条含「」引号词、27 个词各只出现一次，而且有的是**反向**的
 *     （「不能只给一句笼统的『在系统设置里』」—— 这个词恰恰**不该**出现）。
 *     所以本用例把 提问 + 验收标准 + 模型正文 三元组逐条写进
 *     `_evidence/prompt-template-chat-matrix.md`，让人一遍扫完 42 条做评审。
 *     🔴 按方案 §6.3-23「验不了就明说验不了」：退出码绿**只代表上面 ①~⑩ 过了**，
 *        不代表模型答得符合 expect_hint。这一半的覆盖缺口是明示的，不是被藏起来的。
 *
 * 🔴 ⑥ 的「什么都没发生」为什么可信（方案 §6.3-6 要求先证明这一项探通了）
 *   AssistantChat.vue 的普通问答气泡是 `<template v-if="!item.cardStatus && !item.hitl">`，
 *   普通问答气泡（含 assistant-answer）与草稿卡在同一条消息上**互斥**。
 *   所以「assistant-answer 可见且非空」本身就是「这条消息没有 cardStatus」的证明 ——
 *   不是靠扫不到某个 testid 来推断的。选择器字符串本身写错的情形由 T2 兜住：
 *   `prompt-template-build-matrix.spec.ts` 对 BUILD 示例正向断言同一个 testid **必须出现**。
 *   ④ 同理：它成立的前提是「示例正文里本来就没有 {{」，这一前提由下面那条
 *   数据层审计用例现场量（不是假设），量不到就整体报红、不会拿一个假前提去判 42 条。
 *
 * 🔴 ⑦ 的阈值不是拍的
 *   「答案比验收标准还短」是唯一能确定的下界：hint 实测最长 107 字、且每条都要求逐条列举，
 *   而真实答案实测数百到数千字。这个下界离真实答案很远（不会误红），
 *   又能挡住「好的，我来帮您查一下」这类占位式回答（③ 挡不住它，因为它非空）。
 *   刻意**不**断言「必须含列表/标题/表格」：id=41 的 hint 明确要求
 *   「输出必须是文字叙述而不是只贴一张流程图」，那条断言会红在正确答案上。
 *
 * 🔴🔴 两轮全量真发的实测结论：⑦ 抓到的不是「答得短」，是**知识库拒答**
 *   被测助手是挂了「平台使用手册」知识库的 RAG 助手，答案里到处是「依据片段N」。
 *   手册没写的章节，它回一句 `手册里没有覆盖这个问题。`（11 字，加标点 12 字），
 *   有时前面加个引子（`依据提供的手册片段，…`）、有时后面再补一句为什么没覆盖，撑到 138 字。
 *   拒答集中在 **BPM 审批 / 定时任务 / 消息通知 / 智能体 / 知识库搭建 / ERP 集成** 这几块，
 *   而 id=3 的答案自己就把话说明白了：「审批流程：手册里没有覆盖这个问题。
 *   AI 助手：手册里没有覆盖这个问题。」
 *
 *   第二轮（2026-10-04 02:26，37.6 分钟，42 条全量）量到的底数：
 *     **23 条拒答**、4 条压根没产生答案正文（id=19/21 被判成 BUILD、id=43 超时、
 *     id=13 是 NULL 意图这一轮走了 BUILD）、**有效覆盖 15/42**。
 *     ⟹ 示例库里超过一半的提问，问的是手册根本没写的章节；那些条永远测不到提示词模板。
 *     ⚠️ 那一轮报告自己印的是「有效覆盖 16/42」，**多算了一条**：当时用
 *        `completed − refusals` 推的，而 completed 里含 id=13 那条走了 BUILD、根本没答案的。
 *        现在直接数 `assertPlainAnswer` 返回 ANSWERED 的次数，不再靠减法。
 *
 *   🔴 第一轮（45.6 分钟）之所以不能拿来当底数：它的判据是「又短又含那句」（40 字上限），
 *     只红了 13 条，而 id=17/41/63 同样以那句开头、只因解释得长（66~87 字）就越过了
 *     各自的 hint 长度，被 ⑦ **判成通过**；id=37 更极端，87 字对 62 字的 hint，
 *     一条压根没回答问题的答案成了「有效覆盖」。那是**假绿**，比红坏得多。
 *     换成「以那句开头」之后又漏了 id=25（带引子，那句在第 10 字），
 *     把它错红成「正文 22 字比 hint 短」—— 颜色对、归因错，还两头少算。
 *     现在这版是「位置 + 长度」双阈值，两个阈值各自由真实样本顶住，
 *     并由 ⑫ 那条 `判据自检` 用例在**不开浏览器**的前提下钉死（方案 §6.3-7：
 *     判据自己要有独立的构造样本测试）。取舍详见 REFUSAL_MARK 的注释。
 *     上面那个「23 条拒答」也是这么来的：拿新判据**离线重扫**第二轮报告里的逐字正文，
 *     而不是信那一轮当场印出来的 22（推导与逐条 id 见 KNOWN_REFUSAL_COUNT 的注释）。
 *
 *   ⚠️⚠️ 同一条示例的**失败形状本身在轮与轮之间会变**，这是第三轮（02:41，只跑 id=19,21）量到的：
 *      · id=19 前两轮被判成 BUILD，这一轮走了 CHAT，回了一句 116 字的拒答；
 *      · id=21 前两轮被判成 BUILD 且很快出卡（def #426），这一轮**没出卡**、卡到 300 秒超时。
 *      所以 ⑧ 的分母不能是「全 42 条」—— NULL 意图的条目（id=9/11/13/27/43）这一轮走 CHAT、
 *      下一轮可能走 BUILD，走进哪条路决定了它有没有**机会**被判成拒答，分母会漂的比率做不了棘轮。
 *      现在 ⑧ 只数「钉死 CHAT 且不在形状不稳名单里」的 35 条（推导见 KNOWN_REFUSAL_COUNT）。
 *      剩下真能把 ⑧ 顶红的只有「这 35 条里**净多**了一条拒答」，那是要抓的信号；
 *      报告会把名单外新增的 id 直接点出来。🔴 但「净多」不等于「新增」—— run9 就是
 *      4 条翻成拒答、3 条翻回实答，净 +1 而覆盖面一个字没变；认出 id 之后怎么分辨这两种红，
 *      见 KNOWN_REFUSAL_COUNT 注释里那段。
 *
 *   处置见 KNOWN_REFUSAL_COUNT 的注释（棘轮 + 逐条落报告），核心一句：
 *   **⑦ 红在拒答上是「量到了真问题」，但那个问题的归属是知识库覆盖面，不是提示词模板。**
 *   把 T1 永久红在这上面，代价是模板真出回归时没人能从一片红里看出新增了哪一种。
 *
 *   🔴 顺带记三条这个用例自己的缺陷（都已修）：
 *      · ⑦ 原先在 `return text` **之前**抛，调用方的赋值没执行，于是**恰恰在红掉的那些条上
 *        报告把模型正文丢了**，只印一句占位符 `_（没有走到问答气泡）_` —— 而它也正好 12 字，
 *        和真实答案的 12 字撞在一起，极易把人带偏成「气泡没渲染」。现在先落 sink 再断言。
 *      · `sent++` 原先写在 try 末尾，任何一条红掉就不加，导致下一条**不点「新建对话」**、
 *        直接追加进上一条的会话。首轮 13 条红 ⟹ 至少 13 次串台，后面的答案都带着前文上下文，
 *        而报告上完全看不出来。现在「点完发送」就记 dispatched，断言全过才记 completed。
 *      · 报告文件名原先是固定的，第二轮只跑 4 条的子集把第一轮 42 条的证据**覆盖没了**。
 *        加了带时间戳的副本（REPORT_STAMPED）之后又踩了一次：`-g "判据自检"` 这种过滤跑
 *        同样会执行 beforeAll / afterAll，rows 里只有一个空头，一写就把 canonical 换成 7 行废纸。
 *        现在 canonical 只在「主用例真跑过 **且** 是全量跑」时才覆盖，其余情况只落副本，
 *        子集跑的副本名里带 `subset`。断言消息里指的路径也跟着换成 REPORT_THIS_RUN，
 *        免得红了之后让人去翻一份没被本轮写过的旧报告。
 *
 * 🔴 与方案的三处实测偏差（都在下面第一条用例里现场量，不写死）
 *   ① 方案说「25 条 CHAT 模板」。实际是 **45 条示例**，按 expect_intent 分：
 *      CHAT 37 / NULL 5 / BUILD 3。本用例跑 42 条（CHAT + NULL），BUILD 3 条归 T2。
 *   ② 方案说的是「模板」，但 expect_hint / expect_intent 挂在**示例**上
 *      （agent_prompt_template_case），模板表 agent_prompt_template 连 code 列都没有。
 *      要断言 hint 就必须以示例为单位。
 *   ③ 方案说 T1 耗时 ~15min。两轮全量真发实测 **45.6 / 37.6 分钟**（42 条，均值 54~65 秒/条），
 *      是方案的 2.5~3 倍。而 2026-10-04 上午换过模型集之后，单条 CHAT 实测涨到 **267 秒**，
 *      42 条的典型耗时变成 ~3.7 小时。故 test.setTimeout 现为 **6.5 小时**（按单条上限算出的硬上界，
 *      推导见主用例里那行），并支持 TPL_MATRIX_ONLY=9,11 只跑指定示例 id（改一条 hint 时不必等几小时）。
 *
 * 🔴 本文件与 prompt-template-build-matrix.spec.ts **不许并发跑**
 *   两边的 afterAll 都按「跑前快照 vs 跑后全集」的差集删会话。并发时 T2 的快照里没有
 *   T1 正在用的那些会话，收尾会把它们当成本轮新建的一起删掉 —— 表现是 T1 莫名红在
 *   「新建对话之后上一轮的气泡不见了」这类看不懂的地方。Playwright 配的 workers:1
 *   本来就会串行，别为了省时间去开多 worker。
 *
 * 🔴 跑频：方案 §6.1 给 T1 定的是「每次改 prompt / 每次发版」，不是每次改动。
 *   全量 e2e 本来就约 1.8 小时，这两个文件再加约一小时，所以日常改动请显式排掉：
 *   `npx playwright test --grep-invert "T1 ·|T2 ·"`
 *   （标题里的 `T1 ·` / `T2 ·` 就是为此留的稳定标记；本仓 e2e 没有 @tag 约定，不新造一个）
 *
 * 🔴 数据卫生：只删这一轮自己造出来的会话**与草稿 def**
 *   每条示例都在**全新会话**里发（点「新建对话」→ chatRef.reset()），否则第 20 条会带着
 *   前 19 条的上下文，既污染答案也把 token 成本乘上去。代价是 42 条会话落在库里。
 *   清理走 beforeAll 快照 + afterAll 差集，**不**用 helpers/agent.ts 的 sweepTestConversations：
 *   那个按标题前缀 E2E 删，而这里会话标题是后端从首条消息截出来的中文，压根不带 E2E 前缀 ——
 *   用它等于一条都删不掉，还会顺手删掉别人真名叫 E2E 开头的会话。
 *   清理写在 afterAll（方案 §6.2「不能写在用例体末尾」）：用例体中途红掉时照样要拆台子。
 *
 *   🔴 首轮全量真发**实测漏了两样**，两个坑都填了：
 *   ① 会话一条没删掉，而报告印的是「删除 0 条（基线 1 条原样保留）」——读起来像成功。
 *      根因：access token 只活 30 分钟（`system_oauth2_client.access_token_validity_seconds=1800`，
 *      库里量过），而用例体跑了 45.6 分钟；token 是 beforeAll 取的，到 afterAll 已过期，
 *      分页接口一律 401，老写法 `body?.data?.list ?? []` 把 401 静默吃成空数组，
 *      差集自然为空。⟹ afterAll 现在**重新登录**，且所有清单接口都过 expectOk 验 code。
 *      单条 smoke 跑 1.4 分钟，永远撞不到这个坑 —— 只有全量跑才暴露，
 *      这正是「smoke 绿不等于全量绿」的一个具体形状。
 *   ② 漏了两条草稿 def（#426 来自 id=21：一条 expect_intent=CHAT 的示例被判成了 BUILD；
 *      #427 来自 id=13：expect_intent 为空、两种意图都合法，那轮走了 BUILD）。
 *      原先以为「CHAT 用例不产 def」，错了 ⟹ 现在 def 也进快照、也进差集、也断言归零。
 *
 * 前置：后端 48080 + 前端 dev server 在跑，且聊天模型可用。
 */

interface CaseRow {
  id: number
  templateId: number
  title: string
  content: string
  expectHint?: string | null
  expectIntent?: 'CHAT' | 'BUILD' | null
  status?: number
}

/** AssistantChat.vue 的 INPUT_MAX_LENGTH。超过它 insertIntoInput 直接拒绝插入 */
const INPUT_MAX_LENGTH = 2000

const REPORT_DIR = path.join(__dirname, '../../_evidence')
const REPORT = path.join(REPORT_DIR, 'prompt-template-chat-matrix.md')

/** 只跑指定示例 id（逗号分隔）。空 = 全跑 */
const ONLY = (process.env.TPL_MATRIX_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter((n) => Number.isFinite(n))

/**
 * 同一份报告的**带时间戳副本**
 * 🔴 不是为了留纪念，是因为固定文件名会**悄悄吃掉上一轮的证据**：
 *    2026-10-04 首轮全量真发（42 条、13 条红、45.6 分钟）的那份报告，
 *    被随后一次 4 条的子集跑覆盖得干干净净 —— 而那份报告是「id=21 这条 expect_intent=CHAT
 *    的示例到底有没有被判成 BUILD」唯一的直接证据（库里只剩一条软删的 def #426，
 *    能证明规划器真产出了流程，却证明不了当时页面上有没有出草稿卡）。
 *    结论只能靠 spec 头注释里手抄的那几行留着，原始逐条正文永久丢了。
 *    所以从这轮起：canonical 路径照旧（人要看的永远是最新那份），同时落一份带时间戳的。
 *
 * 🔴 光有副本还不够，canonical 自己也得挑时候写。两种跑法都会把它换成废纸：
 *    · `-g "判据自检"` 这类过滤：beforeAll / afterAll 照跑，rows 里只有一个空头，
 *      一写就把上一轮 42 条换成 7 行。2026-10-04 就真被这么吃过一次（靠副本捞回来）。
 *    · `TPL_MATRIX_ONLY=19,21` 子集跑：内容是真的，但只有 2 条 ——
 *      打开 canonical 的人会以为「矩阵就这 2 条」。
 *    ⟹ canonical 只在**主用例真跑过且是全量**时覆盖；其余情况只落副本，
 *      且子集跑的副本文件名里带 `subset`，一眼分得清。
 */
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_STAMPED = path.join(
  REPORT_DIR,
  `prompt-template-chat-matrix.${ONLY.length ? 'subset.' : ''}${RUN_STAMP}.md`
)

/** 本轮证据真正落在哪个文件上 —— 断言消息里指路用，指错了等于让人去翻一份旧报告 */
const REPORT_THIS_RUN = ONLY.length === 0 ? REPORT : REPORT_STAMPED

/** 主用例到底跑没跑。`-g` 过滤掉它时，beforeAll/afterAll 仍然会跑 —— 靠这个标记区分 */
let mainTestRan = false

/**
 * 落盘。任何一个路径写失败都不该把用例带红 —— 报告是产物，不是被测对象
 */
function flushReport(): void {
  const text = rows.join('')
  try {
    mkdirSync(REPORT_DIR, { recursive: true })
    if (mainTestRan && ONLY.length === 0) writeFileSync(REPORT, text, 'utf8')
    if (mainTestRan) writeFileSync(REPORT_STAMPED, text, 'utf8')
  } catch {
    /* 证据写不出去不影响断言结论 */
  }
}

/**
 * 每条示例等模型答完的上限
 *
 * 🔴 300 秒不是拍的：首轮全量真发（2026-10-04）实测 42 条共 45.6 分钟，均值 65 秒/条；
 *    但 id=43（给报销流程加一道财务复核）**在 180 秒上被这条上限掐断了** ——
 *    同一轮里别的条 65 秒就答完，它一条顶到三倍还没收尾。
 *    放到 300 秒是为了把「模型慢」与「模型卡死」分开：真卡死的话 300 秒照样红，
 *    而慢的那些不至于因为一个按均值拍的上限被误判。
 *
 * 🔴🔴 2026-10-04 中午再放到 **480 秒**，同样不是拍的 —— 那天上午**换了模型集**：
 *    `ai_model` 里 66/67/68/69（qwen3.7-max / qwen3.7-flash / qwen3.7-plus-2026-05-26 / qwen3-max）
 *    在 07:44~08:31 被置为 DISABLE（status=1；🔴 注意本项目 `CommonStatusEnum.ENABLE=0`、`DISABLE=1`，
 *    与直觉相反，读这张表时别看反），启用的是 06:12~06:21 新建的 70~76 那一组。
 *    换完之后 CHAT 的单次耗时整个变了量级，`agent_usage_log` 里量得到的：
 *      · 换之前（00~03 时，模型 qwen3.7-plus-2026-05-26）：CHAT 均值 **23~69 秒**，completion 1318~2201 token
 *      · 换之后（11:47:40，模型 qwen3.5-plus-2026-02-15）：**267 秒**，completion **4371** token，status=SUCCESS
 *      · 06:46~06:56 三条 CANCELLED/「用户中断」的 duration 是 **293.4 / 294.8 / 294.7 秒** ——
 *        三条齐刷刷顶在 294 秒，正是被这条 300 秒上限掐断、下一条点「新建对话」时把流带断的形状
 *    ⟹ 267 秒已经吃掉 300 秒上限的 **89%**，294 秒那三条直接超了。留着 300 秒的话，
 *    「模型慢」会被大批误记成 STREAM_TIMEOUT，而棘轮分不清「换了模型所以慢」和「模板真出了回归」。
 *    480 秒 = 实测最大值 294 秒的 1.6 倍，与 T2 的 `PER_CASE_PLAN_TIMEOUT` 取齐。
 *    🔴 这不是把上限一路调大直到变绿：真卡死的话 480 秒照样红，判据的方向没变。
 */
const PER_CASE_STREAM_TIMEOUT = 480_000

/**
 * ⑥ 分型时，等页面说出「走编排还是走问答」的上限
 *
 * 🔴 与 {@link waitAnswerOrError} 的 30 秒取齐，理由也一样：这一步只在**流式已经收尾之后**跑，
 *    两个证据的出现都很快 —— 问答气泡此刻本来就在页面上；草稿卡实测在「停止」消失后
 *    **127ms** 挂上来（时刻表见 `waitBuildPath`）。30 秒是几十倍余量，不是调参调出来的。
 *
 * 🔴 它**不给正常条增加耗时**：三个 locator 里任一个可见就立刻返回，第一轮轮询就走完。
 *    真等满 30 秒的只有「页面上什么都没有」那种条 —— 那种条原来也要在
 *    `waitAnswerOrError` 里等满 30 秒，多出来的是**串联**的第二段，
 *    而这正是为了不把厂商配额故障误报成渲染缺陷（见 MARK_PROVIDER_FAILURE）必须付的价。
 */
const INTENT_RACE_TIMEOUT_MS = 30_000

/**
 * 等打字机贴完正文的总预算 / 单次读取上限
 *
 * <p>30 秒这个总预算沿用改前的值（原来是 60 轮 × 500ms）。改成按 deadline 而不是按轮数，
 * 是因为轮内读取现在可能 STALL：按轮数计的话，几次 STALL 就把预算悄悄吃光了，
 * 而判据「连着两次读到同样的文本」需要的是**墙上时间**够长。
 *
 * <p>单次给 4 秒而不是 `terminal.ts` 的 2 秒：这里读的是**已经答完**的长正文
 * （实测最长上千字），`innerText` 要等一次布局；2 秒在慢轮次上会白 STALL 一次。
 */
const SETTLE_BUDGET_MS = 30_000
const SETTLE_STEP_MS = 4_000

/**
 * 知识库拒答的判据 —— 三个数都是从 42 条真实正文里量出来的，不是拍的
 *
 * 🔴 走过的四种错写法，形状都很具体：
 *
 *   · **「含这句」**会误伤实答。id=3 的答案开头是「平台能力概述」，逐项答得很实（449 字），
 *     只在第 186 字处夹一句「审批流程：手册里没有覆盖这个问题。AI 助手：手册里没有覆盖这个问题。」——
 *     那是**局部**没覆盖，整体是条好答案。id=61/69/71/73/79 同理（那句出现在第 82~191 字）。
 *   · **「又短又含这句」**（第一版就是它，阈值 40 字）会**放过**真拒答，而且放过的方式最坏：让它绿。
 *     实测拒答远不止 11~12 字一种长度：模型常会补一句「提供的片段主要涵盖X，未涉及Y」，
 *     撑到 47~138 字。id=37 有一轮是 87 字、而它的 hint 只有 62 字 ⟹ ⑦「正文不短于 hint」**判它过了**。
 *     一条压根没回答问题的答案，因为解释得够长而被算成有效覆盖 —— 这是假绿，比红更坏。
 *   · **「以这句开头」**（第二版）会**漏掉带引子的拒答**。2026-10-04 02:26 那轮全量真发抓到 id=25：
 *     正文是 `依据提供的手册片段，手册里没有覆盖这个问题。`（22 字），那句在第 **10** 字才开始，
 *     于是前缀判据没认出来，它落到 ⑦ 上以「正文 22 字比验收标准 80 字短」红了 ——
 *     红是红了，但归因归错了地方（记成「答得太短」而不是「知识库没覆盖」），
 *     有效覆盖因此少算一条、拒答棘轮也少算一条。
 *   · **「只认一个字面写法」**（前三版都是它）会**漏掉换了个字的同一句拒答**。2026-10-05 run14 抓到 id=65：
 *     正文逐字是 `手册中没有覆盖这个问题。`（12 字）—— 与 `手册里没有覆盖这个问题。` 只差「中 / 里」一个字，
 *     语义完全相同，`indexOf` 却认不出来，于是它又落到 ⑦ 上、以「正文 12 字比验收标准 72 字短」红了。
 *     🔴 这是 id=25 那次翻车的**同一个形状第二次发生**：红是红了，归因照样归错（记成「答得太短」），
 *     代价也一样 —— run14 报告印的拒答 **18** 条，按同一份正文重算是 **19** 条，棘轮少算一条；
 *     `hint-satisfaction.mjs` 更是直接**卡死**（它的对账闸发现「重算的比报告印的还多」，throw 了）。
 *     ⟹ 教训不是「再补一个字面」，而是**判据认的是「模型说了什么」，而模型的措辞不由我们控**：
 *     同一句拒答它会自己换字（里/中、还可能换成别的）。所以改成认**一组等价写法**，
 *     并且每加一种写法都必须在下面 `判据自检` 里留下真实样本 —— 否则下一个人不知道那个字面是被谁逼出来的。
 *
 * ## 现在的判据：那句（任一等价写法）出现在**开头附近**，且整篇**除了这句没别的实质内容**
 * 两个阈值各自被真实样本从两边夹住，余量都写在这儿，改之前先看会不会踩到边界：
 *
 *   · `REFUSAL_MARK_MAX_OFFSET = 20`
 *     认下引子（id=25 的 `依据提供的手册片段，` = 10 字，id=33 的 `关于租户套餐对可选范围的限制，` = 15 字）。
 *     上界由实答钉住：含这句的实答里，那句最早出现在第 **82** 字（id=69）。20 与 82 之间余量很大。
 *   · `REFUSAL_MAX_LENGTH = 240`
 *     在「开头附近出现这句」的子集里把拒答与实答分开，靠的是整篇长度：
 *     最长的一条拒答是 **138** 字（id=5：`手册里没有覆盖这个问题。依据片段1、2、4，手册仅分散列出了…`），
 *     而同样在开头附近提到这句、却是条实答的是 **458** 字（id=33：先说「关于租户套餐对可选范围的限制，
 *     手册里没有覆盖这个问题」，随后「其他配置步骤如下：」把剩下几问全答了）。
 *     138 与 458 之间取 240。
 *
 * ⚠️ 这个判据是**报告与棘轮用的启发式**，不是产品逻辑，所以它自己有构造样本测试
 *    （见下面那条「判据自检」用例）—— 方案 §6.3-7：判据自己要有独立的测试。
 *    42 条真实正文按本判据分类，与人工逐条读下来的结论**完全一致**（23 拒答 / 19 非拒答）。
 *    🔴 但那 42 条是 2026-10-04 02:26 那轮量的，用的是**只认「里」**的旧口径。
 *    2026-10-05 起认下「中」这个等价写法 ⟹ 同一条正文**只可能从「非拒答」翻成「拒答」，不会反向**，
 *    所以跨这个时间点的两轮拒答数**不可并排比**；棘轮基线 22 也是旧口径量的（见 `KNOWN_REFUSAL_COUNT`）。
 */
const REFUSAL_MARK = '手册里没有覆盖这个问题'
/**
 * 同一句拒答的另一种写法，只差「中 / 里」一个字。逐字实测于 run14 的 id=65
 * （`_evidence/prompt-template-chat-matrix.md` 里「15/42 · id=65」那例，整篇正文就是这 12 字），见上面第四种错写法。
 * 🔴 加一种写法 = 放宽判据 = **口径变更**。必须同时做两件事，缺一件就是悄悄把尺子改宽：
 *    ① 在下面 `判据自检` 里钉住那条真实样本；② 在报告「棘轮结账」处注明本轮起拒答数不能与旧轮并排比。
 */
const REFUSAL_MARK_ALT = '手册中没有覆盖这个问题'
const REFUSAL_MARK_MAX_OFFSET = 20
const REFUSAL_MAX_LENGTH = 240

/**
 * 已知拒答条数 —— 棘轮，不是绿灯
 *
 * ## 🔴 它数的是**哪一堆**，比数字本身重要
 *
 * 第一版把它写成「全 42 条里的拒答总数 = 23」，那是个**不可比**的量：
 * 分母里混着 5 条 expect_intent 为 NULL 的示例（id=9/11/13/27/43）—— 它们这一轮走 CHAT、
 * 下一轮可能走 BUILD（run 2 里 id=13 就走了 BUILD，压根不产生答案正文），
 * 走进哪条路决定了它**有没有机会**被判成拒答。分母会漂的比率做不了棘轮，
 * 红了也说不清是「手册少了一章」还是「id=13 这轮改走问答了」。
 *
 * 所以棘轮只数**钉死在 CHAT、且失败形状稳定**的那一堆：
 *
 *     37 条 expect_intent=CHAT
 *   − 2 条形状不稳（id=19/21，见 KNOWN_UNSTABLE_IDS）
 *   = **35 条**可比总体
 *
 * 在这个总体上，2026-10-04 02:26 那轮全量真发（37.6 分钟）实测拒答 **21 条**。
 * 这个 21 不是那一轮当场印出来的数（当场是 22，用的是旧的前缀判据），而是拿**现在这版判据**
 * 离线重扫同一份报告里 42 条逐字正文重算的：多认出带引子的 id=25，再扣掉 expect_intent
 * 为 NULL 因而不在总体内的 id=9/27 ⟹ 21。重扫是一次性脚本（`_evidence/rescan-refusals.mjs`，
 * 属 gitignore 的证据目录，不入库）；入库的是它的逐条结论。
 *
 * 重扫同时量出 7 条「含那句但判为实答」的，位置全在第 82~191 字（id=3/61/69/71/73/79）
 * 或整篇 458 字（id=33）—— 这就是两个阈值取 20 / 240 的实测依据。
 *
 * ## 🔴 2026-10-04 19:35 run9 起，基线是 **22**，而且这次涨的是**交易**不是覆盖面
 *
 * run9（§5 关思考 + 杠杆A/C + D4-12~D4-15 全部落地后的第一轮 T1 全量）实测拒答 22 条：
 *
 *     15 17 23 25 29 33 35 37 39 41 45 47 49 51 53 63 65 73 75 79 85 89   ← 22 条，即 KNOWN_REFUSED_IDS
 *
 * 与 21 条那版比，是**双向漂移**而不是单边变差：
 *   · 新增拒答 4 条 —— 33、73、75、79，正文全是 11 字的裸拒答「手册里没有覆盖这个问题」；
 *   · 同时翻回实答 3 条 —— 1、5、7，正文分别 454 / 612 / 609 字。
 *
 * 🔴 **这 4 条里有 3 条（33/73/79）本来就是边界条**：上面那段校准记录点名的
 * 「含那句但判为实答」正是它们 —— 33 整篇 458 字、73/79 的那句落在第 82~191 字。
 * 也就是说它们过去是**先说了那句、再靠思考预算续写出实质内容**才被判成实答的；
 * §5 把思考关掉，它们就停在那句上了。真正全新的只有 75（合同起止日期与金额校验）。
 *
 * 排除了另外两种解释，才敢把这笔账记在 §5 头上：
 *   · **不是手册少了章节** —— `ai_knowledge` 6 行、`ai_knowledge_document` 47 行，
 *     update_time 都停在 2026-09-22，基线那轮之后一个字没动过；
 *   · **不是换了模型** —— `ai_model` 最新 update_time 是 10-04 08:31、status 未动
 *     （§3.2 红线 6：不改 `ai_model.status` 去换回快模型）。
 * 而 §5（f22ef4c7d5，CHAT/INTENT/PLAN 三条路径显式关思考）是这期间**唯一**动过 CHAT 路径的改动。
 *
 * 换到的东西（`agent_usage_log` 实测，同一张表同一口径，基线 = 02:26 那轮）：
 *
 *     INTENT   avg 5167ms → 958ms    （−81%）
 *     PLAN_DSL avg 96897ms → 37857ms （−61%）
 *     CHAT     avg 31559ms → 20229ms （−36%）
 *     T1 整轮墙钟 37.6min → 18.8min
 *     ⑨ CHAT 被判成 BUILD：0 条（已知 2 条未复现）　⑩ 等不到答完：0 条（已知 2 条未复现）
 *
 * ⑩ 归零尤其要紧：run7/run8 那两条烧满 480 秒预算的超时，正是思考模式在 CHAT 路径上的账。
 *
 * ⚠️ 方案 §15-1 预估的是「CHAT 掉到 ~10s 量级」，**实测没兑现**，只有 −36%；
 *    兑现的是 INTENT 与 PLAN_DSL 两条。别把预估的数当结论写进报告。
 *
 * 🔴 所以这次调 21→22 是**重新定基线**，不是「手册又少了一块」。棘轮从 22 起
 *    照旧只许紧不许松：补上手册章节就把它调小，别再调回去。
 *    这笔交易由用户在 2026-10-04 明确裁定「接受交易，重新定基线到 22」。
 *
 * ⟹ 35 条可比总体里只有 13 条真的走到了提示词模板该走的路（run9：有效覆盖 14/42）。
 *
 * ## ⚠️ 抖动来自两处，都已在总体定义里排掉或点名
 *
 *   · **措辞不稳**：id=9 在 10-04 00:07 那轮开头是 `手册里没有覆盖「设备台账」具体业务字段…`
 *     （不含固定短语，判据算实答），02:26 这轮却是 `手册里没有覆盖这个问题。依据：…`（算拒答）。
 *     同一条示例、输入一字未改，两轮结论相反。id=9 是 NULL 意图，**不在总体内**，所以这条抖动不影响棘轮。
 *   · **形状不稳**：id=19/21 在 BUILD 误判与 CHAT 之间来回，id=21 还会卡到 300 秒超时。
 *     这两条**从总体里扣掉了**，所以它们怎么翻都不会把棘轮顶红。
 *     代价是这 2 条的拒答状态没人盯 —— 由 ⑨⑩ 两条类棘轮盯着，不漏。
 *
 * 剩下真能把 ⑧ 顶红的只有一种情况：35 条里**净多**了一条拒答。那是要抓的信号。
 * 红了先看报告的拒答清单认一下是哪个 id，再决定是补手册还是把这条挪进白名单。
 *
 * 🔴 但 run9 教了一件事：**净多一条未必等于手册少了一块**。那一轮是 4 条翻成拒答、
 *    3 条翻回实答，净 +1，而手册一个字没动。所以认出 id 之后还要多看一眼它上一轮是什么形状 ——
 *    若它本就在「含那句但判为实答」的边界上（阈值 20 / 240 正是拿它们校准的），
 *    那就是**答案长度**跨过了判据线，不是覆盖面变了。这两种红要分开报：
 *    前者是产品变了，后者是判据的分辨率到边了。
 *
 * ## 🔴 为什么用棘轮、而不是让 ⑦ 直接判红
 *
 * 拒答的根因是**手册缺章节**（BPM 审批 / 定时任务 / 消息通知 / 智能体 / 知识库搭建 / ERP 集成），
 * 那是知识库覆盖面的问题，不是模板机制的问题，改模板改不动它。
 * 让 T1 永久红在这上面的代价是：以后模板真出了回归（插入串字、占位符漏出、
 * CHAT 被判成 BUILD），T1 照样是红的，没人能从一片红里看出新增了哪一种。
 * 棘轮的写法是「不许比已知更多」：手册再少覆盖一条就红，补上一章就绿（那时把数字调小）。
 *
 * 🔴 每条拒答都逐条写进报告，**包括不在总体内的那些**，不因为不计入棘轮就藏起来（方案 §6.3-23）
 * 🔴 真正的解法不在本文件里，是个**待裁定的产品问题**：要么补手册章节，
 *    要么把示例库（S7）的提问范围收回到手册覆盖得到的地方。
 *    现状是示例库有一半以上在问手册没写的章节 —— 那部分示例永远测不到模板。
 */
const KNOWN_REFUSAL_COUNT = 22

/**
 * 上面那个 22 是**哪些** id —— 只用来在报告/断言消息里点名「新增的是哪条」，不参与断言
 *
 * 🔴 断言刻意用**条数**而不是**集合差**：手册是静态文档，同一条示例在两轮之间
 *    翻成拒答或翻回实答，那是 LLM 采样的抖动，不是手册少了一章。
 *    用集合差的话，「id=A 不拒答了、id=B 开始拒答」会红 —— 而覆盖面其实没变。
 *    条数才对应「手册又少了一块」这件事。点名仍然给，是为了红了能立刻看出是谁。
 *
 * 22 条 = 2026-10-04 19:35 run9 那轮实测的 26 条拒答，扣掉 4 条不在可比总体内的
 * id=9/11/19/27（意图为 NULL 或形状不稳）。上一版是 21 条，两者的差是双向漂移，
 * 逐条账与那笔交易的实测收益见 KNOWN_REFUSAL_COUNT 的注释。
 *
 * ⚠️ 换基线时**两个常量必须一起改**：本文件有一条自检会把「名单条数 ≠ 上限」判红，
 *    因为报告点的名与断言用的数一旦对不上，红了就认不出是谁。
 */
const KNOWN_REFUSED_IDS = new Set([
  15, 17, 23, 25, 29, 33, 35, 37, 39, 41, 45, 47, 49, 51, 53, 63, 65, 73, 75, 79, 85, 89
])

/**
 * 已知的意图误判：expect_intent=CHAT，实际被判成 BUILD（聊天里出了流程草稿卡）
 *
 * 🔴 这是**产品缺陷**，不是测试缺陷，而且是本轮最值得报的一条：
 *    id=19「请按月份统计设备报修工单的数量和维修金额…输出成表格并给出合计行」
 *    id=21「把设备报修工单和设备台账按设备编号关联起来查…请先确认这两张表都存在」
 *    两条都是**查数/统计**的请求，用户要的是一张结果表，却被拉去编排流程。
 *    共同点很具体：提问里出现了「统计 / 关联起来查」+ 表名，分型就倒向了 BUILD。
 *    id=21 在 10-04 00:07 那轮也复现了（漏下草稿 def #426「设备报修与台账关联查询分析」，
 *    trigger.chat + agent_loop + llm 两个节点），所以它**不是偶发**。
 *
 * ⚠️ 但它也**不是每次都这样**：10-04 02:41 的 `TPL_MATRIX_ONLY=19,21` 子集跑里，
 *    两条都没出草稿卡 —— id=19 走了 CHAT 并回了一句 116 字的拒答，id=21 卡到 300 秒超时。
 *    所以这两个集合记的是「**观测到过**这一种失败形状」，不是「这条永远这么失败」。
 *    同一批输入在分型上就是不稳的，这本身是比「误判」更该报的性质。
 *
 * 为什么记成白名单而不是修判据：⑥ 那条断言本身是对的（方案 §6.3-3 点名要抓的就是这一格），
 * 红得也对。但让 T1 永久红在这里，代价与拒答那条一样 —— 掩盖新增回归。
 * 所以走「已知集合」棘轮：**新出现**一条误判就红；已知的哪条哪天不复现了，报告里会点出来，
 * 那时把它从集合里删掉（棘轮只许紧不许松）。
 * 🔴 「不复现」只认**全量跑**：子集跑（ONLY 非空）里没复现不算，
 *    汇总段的棘轮结账会带上这个前提，别照着一份 2 条的子集报告去删白名单。
 */
const KNOWN_MISCLASSIFIED_AS_BUILD = new Set([19, 21])

/**
 * 已知的「等不到答完」：id=43「给报销流程加一道财务复核」、id=21「报修工单关联设备台账」
 *
 * 🔴 id=43 三轮真发、两个不同的上限，都没等到：10-04 00:07 那轮卡在 180 秒，
 *    02:26 这轮卡在 300 秒（实测耗时 300763ms，正好是上限本身，说明是**被掐断的**，不是刚好答完）。
 *    该条要求「先取回它现在完整的节点树，在这棵树上做最小改动」，
 *    而库里并没有一条叫「差旅费报销审批」的流程 —— 怀疑是找不到目标后在工具回路里打转。
 *
 * 🔴 id=21 是 02:41 子集跑新量到的：300828ms，同样顶满上限，且这一轮**没有**产出草稿 def
 *    （afterAll 的 def 差集是 0 条）—— 说明它卡在问答路径上，不是卡在规划上。
 *    同一条示例前两轮的形状是「被判成 BUILD 并且很快出卡」，这一轮变成「走 CHAT 然后卡死」。
 *    ⟹ id=21 与 id=43 的共同点是**查/改一个库里不存在的东西**，怀疑同一个根因。
 *
 * ⚠️ 这一类**需要单独查**，本用例只负责不让它掩盖别的回归。
 *    处置方式刻意**不是**「把 PER_CASE_STREAM_TIMEOUT 再调大」：
 *    从 180 调到 300 已经证明调大治不了它，再调只是把一轮真发拖得更长
 *    （42 条已经要 37.6 分钟），而问题照样在。现在已知 2 条 × 300 秒 = 一轮白等 10 分钟。
 */
const KNOWN_STREAM_TIMEOUT = new Set([43, 21])

/**
 * 失败**形状**在轮与轮之间会变的 id
 *
 * 由上面两个缺陷白名单求并集推出来，**不另立一份名单** —— 另立就会漂。
 * 用途只有一个：把它们从 ⑧ 拒答棘轮的可比总体里扣掉（见 KNOWN_REFUSAL_COUNT）。
 * 它们不是「不测了」，照样真发、照样落报告，只是改由 ⑨⑩ 两条类棘轮盯着。
 */
const KNOWN_UNSTABLE_IDS = new Set([...KNOWN_MISCLASSIFIED_AS_BUILD, ...KNOWN_STREAM_TIMEOUT])

/**
 * 两个已知缺陷类的**标记字面量**：既拼进断言消息，又用来在 catch 里认类
 *
 * 🔴 认类只能靠消息文本，因为 Playwright 的 expect 抛的是它自己的错误类型，
 *    分不出「是哪一条断言红的」。把标记抽成常量、两处共用，改文案时不会把认类改瞎 ——
 *    真改瞎的后果是已知缺陷重新变红（还算好），或者新缺陷被误认成已知（那就假绿了）。
 *    已实测：Playwright 会把自定义消息放在 `e.message` 的**第一行**，
 *    2026-10-04 02:26 那轮的 4 条失败行就是这么落进报告的。
 */
const MARK_MISCLASSIFIED_AS_BUILD = '被判成了 BUILD'
const MARK_STREAM_TIMEOUT = '仍未答完'
/**
 * 模型侧压根没答（厂商配额/密钥/网络），与「答得不好」是两码事
 *
 * 🔴 实测 2026-10-04 03:23:05 起 DashScope 免费额度耗尽，三个候选模型
 *    （qwen3.7-max / -flash / -plus-2026-05-26）全部回
 *    `403 {"code":"AllocationQuota.FreeTierOnly","message":"Free quota exhausted…"}`，
 *    后端把 assistant 消息以 status=FAILURE + error_msg 落库，token_count=0。
 *    那一轮 run3 的最后 10 条（cases 33~42）全中，而报告印的是「问答气泡没渲染出来」——
 *    把一次厂商配额故障指成了前端渲染缺陷。真因其实**就显示在页面上**：
 *    SSE 的 error 分支（AssistantChat.vue 的 applyChatEvent case 'ERROR'）会把 errorMsg 渲染成 `.el-alert--error`，
 *    只是原来的 ⑦ 先等气泡、等不到就抛，压根没走到查 alert 那一步。
 *
 * 🔴 连带后果比误报更坏：AgentIntentClassifier#classify 在异常时
 *    **回落成 CHAT**（设计如此，「分类挂了不能让整次对话跟着挂」），
 *    于是配额耗尽期间每一条都被判成 CHAT，② 那条「确实走了 CHAT 路径」**空过**，
 *    而 ⑧ 的拒答棘轮因为总体缩水（该答的没答）也跟着 vacuously 绿。
 *    所以这一类必须单独认出来、单独红、并且**连续命中就中止本轮**（见 PROVIDER_ABORT_AFTER）。
 */
const MARK_PROVIDER_FAILURE = '模型侧没答'

/**
 * 连续多少条命中 PROVIDER_FAILURE 就中止本轮
 *
 * 取 3：一条可能是抖动，两条可能是巧合，三条连着基本就是配额/密钥没了。
 * 中止的收益不是省时间（虽然能省 5 分钟以上），而是**不让报告继续攒假数据**：
 * 再跑下去，⑧ 的分母会一路缩水到 0，那时候「拒答没超上限」这句话就彻底没有意义了。
 */
const PROVIDER_ABORT_AFTER = 3

/** 本轮**实际观测到**的已知缺陷类命中，id 列表。跑完与上面两个集合做差，见汇总段 */
const observedMisclassified: number[] = []
const observedTimeout: number[] = []
/** 模型侧没答的 id（不参与任何棘轮：它不是缺陷白名单，是本轮作废的原因） */
const observedProviderFailure: number[] = []
/** 已知且本轮复现的，进这里（报告里逐条印，但不计入 failures） */
const knownDefects: string[] = []

let token = ''
let baselineConversationIds = new Set<number>()
/**
 * 本轮**自己认领**的会话账本
 *
 * <p>🔴 afterAll 只删账本里的东西，判据与实现见 `helpers/conversation-ownership.ts`
 *    （T2 / headless-gate 共用同一份）。墓碑在那边：原先的差集口径删掉过一条不属于本轮的会话。
 *
 * <p>⚠️ 可能仍是 undefined：beforeAll 就红了、真发用例压根没起跑，此时没有页面可挂钩子。
 */
let ownership: ConversationOwnership | undefined
let baselineDefIds = new Set<number>()
let allCases: CaseRow[] = []
const failures: string[] = []
/**
 * 拒答清单。带 id 而不只是 label：⑧ 的棘轮要按「钉死在 CHAT 且形状稳定」的总体筛，
 * 只有 label 就得从中文标题反解 id —— 那是自找的错处。
 */
const refusals: { id: number; label: string }[] = []
/**
 * 真的答出话来的条数（assertPlainAnswer 返回 'ANSWERED'）
 *
 * 🔴 不能用 `completed - refusals.length` 代替。completed 里含 expect_intent 为 NULL
 *    而这一轮走了 BUILD 的条目（run 2 的 id=13），那些条**根本没产生答案正文**，
 *    减掉拒答数之后它们会被算成「有效覆盖」—— run 2 的 16/42 就是这么多算了一条，
 *    离线重扫逐字正文之后实际是 **15**。
 */
let answered = 0
const rows: string[] = []

const H = () => apiHeaders(token)
const caseApi = `${API_BASE_URL}/agent/prompt-template-case/simple-list`
const defPageApi = `${API_BASE_URL}/agent/workflow-def/page`
const defDeleteApi = `${API_BASE_URL}/agent/workflow-def/delete`

/**
 * 🔴 清单类接口必须先验 code，再信 data
 *
 * 2026-10-04 那一轮全量真发之后，afterAll 报「删除本轮新建的会话 0 条（基线 1 条原样保留）」——
 * 读起来像是干净收工了，实际上库里躺着 **43** 条会话，42 条是这一轮漏的。
 * 根因：access token 有效期 `system_oauth2_client.access_token_validity_seconds = 1800`（30 分钟），
 * 而 T1 的用例体实测跑了 **45.6 分钟**。token 是 beforeAll 里取的，到 afterAll 已经过期 15 分钟，
 * 分页接口一律 401。老写法 `body?.data?.list ?? []` 把 401 静默吃成空数组，
 * 于是「跑后全集」是空集，差集自然是空的，一条都不删 —— 还印了一句像成功的话。
 *
 * 所以这里把 code 断死：取不到清单就**报红**，绝不把「没取到」当成「没有」。
 * 方案 §6.3-6 的同一条道理：断言「什么都没发生」之前，得先证明这一项探通了。
 */
function expectOk(body: any, what: string): void {
  expect(body?.code, `${what}失败（code=${body?.code}）：${body?.msg ?? ''}`).toBe(0)
}

async function fetchCases(request: APIRequestContext): Promise<CaseRow[]> {
  const resp = await request.get(caseApi, { headers: H() })
  const body = await resp.json()
  expectOk(body, '取示例清单')
  return (body.data ?? []) as CaseRow[]
}

/**
 * 流程 def 全集。T1 也要收这个尾 —— 早先以为 CHAT 用例不产 def，实测错了：
 * 2026-10-04 那一轮漏下两条草稿 def（#426「设备报修与台账关联查询分析」来自 id=21，
 * 一条 expect_intent=CHAT 的示例被判成了 BUILD；#427「预览xpy_contract改表DDL」来自 id=13，
 * expect_intent 为空、两种意图都合法，这轮走了 BUILD）。
 * 只删会话不删 def，等于每跑一轮往库里留几条草稿。
 */
async function listDefIds(request: APIRequestContext): Promise<Set<number>> {
  const ids = new Set<number>()
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const resp = await request.get(defPageApi, { headers: H(), params: { pageNo, pageSize: 100 } })
    const body = await resp.json()
    expectOk(body, `取流程 def 分页 pageNo=${pageNo}`)
    const list = body?.data?.list ?? []
    for (const item of list) ids.add(item.id as number)
    if (list.length < 100) break
  }
  return ids
}

/**
 * 命中的是哪一种写法。报告要把它**原样**印出来（「以「X」开头」），印错了读者就会去查一句模型压根没说过的话。
 * 取**最早**出现的那种：两种写法可能在同一篇里都出现，而位置阈值判的是「那句在开头附近」，
 * 所以要比的是最早那个位置，不是任一个。没命中（或命中得太靠后）返回 null。
 */
function matchedRefusalMark(body: string): string | null {
  let hit: string | null = null
  let hitAt = Number.MAX_SAFE_INTEGER
  for (const mark of [REFUSAL_MARK, REFUSAL_MARK_ALT]) {
    const at = body.indexOf(mark)
    if (at >= 0 && at < hitAt) {
      hit = mark
      hitAt = at
    }
  }
  return hitAt <= REFUSAL_MARK_MAX_OFFSET ? hit : null
}

/**
 * 拒答判据。两个阈值的取值依据、以及四种错写法各自的失败形状，见 REFUSAL_MARK 的注释。
 * 🔴 刻意写成不碰 page 的纯函数：下面那条「判据自检」用例要拿真实正文当构造样本直接喂它
 *    （方案 §6.3-7 —— 判据自己要有独立的测试，否则判据错了没人知道）
 */
function isRefusal(text: string): boolean {
  const body = text.trim()
  if (body.length === 0 || body.length > REFUSAL_MAX_LENGTH) return false
  return matchedRefusalMark(body) !== null
}

test.describe('T1 · CHAT 类示例逐条真发', () => {
  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request)
    baselineConversationIds = await listConversationIdSet(request, H)
    baselineDefIds = await listDefIds(request)
    allCases = await fetchCases(request)
  })

  test.afterAll(async ({ request }) => {
    // 🔴 只删「快照里没有、现在有」的：这一轮真发出来的会话与草稿 def。
    //    不做全量清空 —— 库里还有别人（和别的用例）的东西，删了就是越界。
    // 🔴 必须重新登录：beforeAll 那个 token 到这里已经跑了 45 分钟，
    //    而 access token 只活 30 分钟（见 expectOk 的注释）。拿过期 token 收尾，
    //    清单取成空集，差集为空，一条都删不掉，还会印一句「基线原样保留」像是成功了。
    if (token) {
      try {
        token = await apiLogin(request)
      } catch {
        rows.push(`\n---\n\n⚠️ 收尾重新登录失败，本轮残留**没有清理**，需人工核\n`)
      }
    }
    let deletedDef = 0
    if (token) {
      // 🔴 会话只删**本轮自己认领的**：凭据是产品写进 localStorage 的「最近一次会话」id。
      //    原先按「跑后 − 跑前」求差集，而差集回答的是「库里多了什么」、不是「多的这条是**谁**建的」——
      //    T1 一轮要跑 45 分钟，这么长的窗口里别人（或另一个 e2e）新建的会话必被扫进来一起删掉。
      //    T2 在 2026-10-07 真删过一条不属于本轮的会话：不可逆、无报错，
      //    报告还印一句「删除本轮新建 1 条（基线原样保留）」，读起来像干得漂亮。
      //    🔴 末尾那条 leftover 断言也换了口径：用别人的数据判自己的成败，
      //       和用别人的数据决定删谁，是同一个错误的两面
      let conversationCleanup: ConversationCleanupReport | undefined
      if (ownership) {
        conversationCleanup = await cleanupOwnedConversations({
          request,
          headers: H,
          ownership,
          baseline: baselineConversationIds
        })
      }
      const nowDef = await listDefIds(request)
      for (const id of nowDef) {
        if (baselineDefIds.has(id)) continue
        const r = await request.delete(defDeleteApi, { headers: H(), params: { id } })
        expectOk(await r.json(), `删除流程 def ${id}`)
        deletedDef++
      }
      // 🔴 绝对值必须一起印，不能只印差集。
      //    差集口径对**历史残留天生免疫**：上一轮被人手杀掉时 afterAll 没跑、留下的孤儿会话，
      //    这一轮 beforeAll 会把它当基线吃进去，于是差集永远是 0、核账永远绿 ——
      //    而库里的垃圾一轮一轮往上叠，没人看得出来。2026-10-04 就真叠过一次
      //    （11:47 那轮卡死被杀，留下会话 446 与消息 880/881，是人工用 SQL 查出来才清掉的）。
      //    印上绝对值，读报告的人一眼就能发现「跑后会话 2 条」和「基线本来就该 1 条」对不上。
      const afterConv = await listConversationIdSet(request, H)
      const afterDef = await listDefIds(request)
      const leftoverDef = afterDef.size - baselineDefIds.size
      rows.push(
        `\n---\n\n## 残留核账（方案 §6.2）\n\n` +
          (conversationCleanup
            ? conversationCleanup.lines.join('')
            : `- 会话：本轮没跑到真发（未挂监听），一条都不删；基线 ${baselineConversationIds.size} 条原样保留\n`) +
          `- 流程 def：跑前 ${baselineDefIds.size} 条 → 删除本轮新建 ${deletedDef} 条 → 跑后多出 ${leftoverDef} 条\n` +
          `- 绝对值（供人工核对历史残留）：跑后会话共 ${afterConv.size} 条 [${[...afterConv].join(',')}]，` +
          `流程 def 共 ${afterDef.size} 条 [${[...afterDef].join(',')}]\n`
      )
      expect(
        conversationCleanup?.leftoverOwned ?? [],
        `本轮自建的会话没清干净，库里还留着 ${(conversationCleanup?.leftoverOwned ?? []).join(', ')}` +
          `（§6.2：残留非空即视为该轮失败）。别人的会话不算在这里 —— 见上面那几行 ⚠️`
      ).toHaveLength(0)
      expect(leftoverDef, `流程 def 没清干净，库里多出 ${leftoverDef} 条本轮草稿（§6.2：残留非空即视为该轮失败）`).toBe(0)
    }
    // 🔴 全量重写而不是 append：rows 是**全量**累积的，用例体里每跑完一条就已经整份重写过一次，
    //    这里再 append 一遍等于把整份报告抄两份进文件。全量重写还有个好处：
    //    用例中途崩了、汇总那段没跑到，这里照样能落一份到目前为止的完整报告。
    flushReport()
  })

  // ===================================================================
  // 数据层审计：先把「42 条真发」的前提量一遍
  //
  // 🔴 这条用例不调模型、几秒钟就跑完，但它守着的是后面那近一小时的**前提**。
  //    前提崩了而没人量的话，表现是「42 条全红」或更糟 ——「42 条全绿但什么也没测」：
  //    · 示例正文里真有 {{ ：那 ④「答案不许有 {{ 残留」就成了假断言
  //      （模型照抄提问里的 DSL 表达式是**正确**行为，见 applyCase 的类注释）
  //    · 正文超过 2000 字：insertIntoInput 直接拒绝插入，红的原因是字数上限而不是模型
  //    · 清单为空：一条都不发，循环体压根没进去，用例却会绿
  // ===================================================================
  test('数据层前置审计：清单非空、正文可插、无占位符、意图分型齐全', async () => {
    expect(allCases.length, 'simple-list 一条示例都没返回，T1 会绿得毫无意义').toBeGreaterThan(0)

    const split = { CHAT: 0, BUILD: 0, NULL: 0 }
    for (const c of allCases) {
      const content = c.content ?? ''
      expect(content.trim().length, `示例 ${c.id}（${c.title}）正文是空的，插不进去`).toBeGreaterThan(0)
      expect(
        content.length,
        `示例 ${c.id}（${c.title}）正文 ${content.length} 字，超过输入框 ${INPUT_MAX_LENGTH} 字上限 —— ` +
          `UI 会拒绝插入，红的将是字数上限而不是模型`
      ).toBeLessThanOrEqual(INPUT_MAX_LENGTH)
      expect(
        content,
        `示例 ${c.id}（${c.title}）正文里含 {{{{ }}}}：那「答案不许有 {{ 残留」这条断言对它不成立` +
          `（模型照抄提问里的 DSL 表达式是正确行为），必须把它排除出 ④ 的适用范围`
      ).not.toContain('{{')
      expect(
        (c.expectHint ?? '').trim().length,
        `示例 ${c.id}（${c.title}）没有 expect_hint，评审时没有对照标准`
      ).toBeGreaterThan(0)
      if (c.expectIntent === 'CHAT') split.CHAT++
      else if (c.expectIntent === 'BUILD') split.BUILD++
      else split.NULL++
    }

    // 🔴 两侧都要有：只有 CHAT 没有 BUILD 时，⑥「没有草稿卡」就永远不可能被证伪 ——
    //    一把只会绿尺子（方案 §6.3-8）。BUILD 那半由 T2 真发，这里只量它存在
    expect(split.CHAT, '一条 CHAT 示例都没有').toBeGreaterThan(0)
    expect(split.BUILD, '一条 BUILD 示例都没有 —— T2 会没得跑，且 ⑥ 无法被证伪').toBeGreaterThan(0)

    /**
     * 🔴 三个白名单常量自己也得被量一遍
     *
     * 它们是手写的 id 列表，写错一个数字的后果是**静默的**：
     *   · KNOWN_REFUSED_IDS 与 KNOWN_REFUSAL_COUNT 不同步 ⟹ 报告点的名与断言用的数对不上，
     *     红了之后照着名单去找「新增的那条」会找错人；
     *   · 名单里混进一个 NULL 意图或不存在的 id ⟹ 可比总体的定义（35 条）当场失真，
     *     而 ⑧ 那条断言照样是绿的 —— 因为它只看条数。
     * 这一段就是 §6.3-6 的同一件事：断言「总量没变」之前，先证明这个总量是**怎么算出来的**。
     */
    expect(
      KNOWN_REFUSED_IDS.size,
      `KNOWN_REFUSED_IDS 有 ${KNOWN_REFUSED_IDS.size} 个 id，而 KNOWN_REFUSAL_COUNT=${KNOWN_REFUSAL_COUNT} —— ` +
        `两者必须同步，否则报告点的「新增是哪条」与断言用的条数对不上`
    ).toBe(KNOWN_REFUSAL_COUNT)

    const byId = new Map(allCases.map((c) => [c.id, c]))
    for (const id of KNOWN_REFUSED_IDS) {
      const c = byId.get(id)
      expect(c, `KNOWN_REFUSED_IDS 里的 id=${id} 在示例库里不存在（写错了？示例被删了？）`).toBeTruthy()
      expect(
        c!.expectIntent,
        `KNOWN_REFUSED_IDS 里的 id=${id}（${c!.title}）expect_intent 是 ${c!.expectIntent ?? 'NULL'}，不是 CHAT —— ` +
          `它不在 ⑧ 的可比总体内（NULL 意图的条目这一轮可能走 BUILD，压根不产生答案正文），` +
          `留在名单里会把上限撑大`
      ).toBe('CHAT')
    }
    const overlap = [...KNOWN_UNSTABLE_IDS].filter((id) => KNOWN_REFUSED_IDS.has(id))
    expect(
      overlap,
      `id ${overlap.join('、')} 同时出现在 KNOWN_REFUSED_IDS 与形状不稳名单里 —— ` +
        `不稳的条目既然从总体里扣掉了，就不该再占一个拒答名额`
    ).toHaveLength(0)
    for (const id of KNOWN_UNSTABLE_IDS) {
      expect(byId.has(id), `形状不稳名单里的 id=${id} 在示例库里不存在`).toBe(true)
    }

    // 全量跑时可比总体应当是 35（37 条 CHAT − id19/21；id=43 是 NULL 意图，本来就不在 37 里）。
    // 🔴 这里**照着主用例的口径重算一遍**，不用 `split.CHAT − 名单大小` 那种减法：
    //    形状不稳名单里混着 NULL 意图的 id，减法会把总体算少一条，而 ⑧ 的上限是按 35 定的
    if (ONLY.length === 0) {
      const ratchetTotal = allCases.filter(
        (c) => c.expectIntent === 'CHAT' && !KNOWN_UNSTABLE_IDS.has(c.id)
      ).length
      expect(
        ratchetTotal,
        `可比总体算出来是 ${ratchetTotal} 条，与 KNOWN_REFUSAL_COUNT 注释里写的 35 不符 —— ` +
          `要么示例库改了，要么形状不稳名单改了，两处注释与数字得一起对齐`
      ).toBe(35)
    }

    rows.push(
      `# T1 · CHAT 类示例真发矩阵\n\n` +
        `- 生成时间：${new Date().toISOString()}\n` +
        `- 示例总数：**${allCases.length}**（CHAT ${split.CHAT} / BUILD ${split.BUILD} / 意图不限 ${split.NULL}）\n` +
        `- 本用例真发：**${split.CHAT + split.NULL}** 条（CHAT + 意图不限）；BUILD ${split.BUILD} 条归 T2\n` +
        `- 过滤器 TPL_MATRIX_ONLY：${ONLY.length ? ONLY.join(',') : '（未设，全跑）'}\n\n` +
        `> 🔴 本文件是**人工评审**用的证据，不是断言产物。机械断言是 ①~⑭（见 spec 头注释），\n` +
        `> 其中逐条判答案的只有 ①~⑦，⑧⑨⑩ 是轮级棘轮，⑪ 是残留核账，⑫ 是判据自检，\n` +
        `> ⑬ 是白名单自洽，⑭ 是「模型侧有没有答」（非空即本轮作废，排在 ⑧⑨⑩ 之前抛）；\n` +
        `> expect_hint 的符合性需要人对照「验收标准」与「模型正文」逐条判。\n`
    )
  })

  /**
   * 判据自检（方案 §6.3-7：判据自己要有独立的「构造样本」测试）
   *
   * 🔴 这条用例**不碰浏览器、不调模型**，几毫秒就跑完，但它是最重要的一条：
   *    isRefusal 是「有效覆盖」与「拒答棘轮」两个数字的唯一来源。它错一次，
   *    报告上的覆盖数就假一次 —— 而且假的方向通常是**偏乐观**（把拒答算成实答）。
   *    已经真错过三回，而**三回的失败方向都是偏乐观**（把拒答算成实答、或少算拒答）：
   *    ① 40 字阈值版把 87 字的 id=37 放成了实答；
   *    ② 前缀版把带引子的 id=25（22 字）漏成了「答得太短」；
   *    ③ 只认「里」的版本把 run14 的 id=65（`手册中没有覆盖这个问题。`，12 字）也漏成了「答得太短」——
   *       棘轮因此少算一条（报告印 **18**、真值 **19**），`hint-satisfaction.mjs` 的对账闸直接 throw。
   *    🔴 ② 与 ③ 是**同一个形状**隔两天重犯一次（判据没认出来 ⟹ 落到 ⑦ 上以「答得太短」红 ⟹ 归因归错），
   *       所以这次不只补样本，还把「加一种写法必须留下真实样本 + 注明口径变更」写进了 `REFUSAL_MARK_ALT` 的注释。
   *
   * 样本分两类：
   *   · **真实正文**：从历轮报告里逐字摘出来的（「里」那批出自 2026-10-04 02:26 那轮，「中」那条出自 run14），
   *     含三版的翻车现场；
   *   · **边界构造**：把两个阈值各自的两侧顶到 ±1 字（**两种写法都顶**），防止以后有人「顺手放宽一点」而没人发现。
   */
  test('判据自检：拒答识别在真实正文与阈值边界上都分类正确', async () => {
    const M = REFUSAL_MARK
    const A = REFUSAL_MARK_ALT

    // ---------- 真实正文（「里」那批逐字摘自 2026-10-04 02:26 那轮报告，「中」那条摘自 run14） ----------
    const realRefusals: [string, string][] = [
      ['id=1/49/53（光秃秃一句，11 字）', '手册里没有覆盖这个问题'],
      ['id=17/23/37/39/47/63/85/89（加句号，12 字）', '手册里没有覆盖这个问题。'],
      [
        'id=25（带引子，22 字）—— 前缀判据就是漏了它',
        '依据提供的手册片段，手册里没有覆盖这个问题。'
      ],
      [
        'id=9（47 字，补了一句为什么没覆盖）',
        '手册里没有覆盖这个问题。依据：提供的全部手册片段均未包含具体业务字段（如设备台账）的设计规范。'
      ],
      [
        'id=41（47 字）',
        '手册里没有覆盖这个问题。依据提供的所有片段，均未提及「合同会签审批」的具体流程节点与分支设计。'
      ],
      [
        'id=65（run14，12 字，整篇正文就这一句）—— 只认「里」的旧判据漏了它，' +
          '于是它落到 ⑦ 上以「正文 12 字比验收标准 72 字短」红，归因归错、棘轮少算一条',
        '手册中没有覆盖这个问题。'
      ]
    ]
    for (const [why, body] of realRefusals) {
      expect(isRefusal(body), `${why} 应判为拒答，判据却说不是。正文：${body}`).toBe(true)
    }

    const realAnswers: [string, string][] = [
      [
        'id=33（458 字）：开头 15 字处确实说了「这个问题没覆盖」，但随后把其余几问全答了 —— ' +
          '这条是**长度阈值**存在的唯一理由',
        '关于租户套餐对可选范围的限制，手册里没有覆盖这个问题。 其他配置步骤如下： 准备与建角色：在【用户管理】建一个测试用' +
          '户并把它加进目标角色；配数据范围：在角色上把数据范围改成「仅本人」；验隔离：换另一个账号登录，确认看不到前一个账号的单子。'.repeat(3)
      ],
      [
        'id=3（449 字）：逐项答得很实，只在第 186 字处夹一句局部没覆盖 —— 这条是**位置阈值**存在的理由',
        '答'.repeat(186) + '审批流程：手册里没有覆盖这个问题。AI 助手：手册里没有覆盖这个问题。'
      ],
      ['id=31（455 字，一句拒答的话都没有）', '配置步骤： 确认槽位映射：打开报价单数据集的「资源配置」面板 → 「槽位映射」。']
    ]
    for (const [why, body] of realAnswers) {
      expect(isRefusal(body), `${why} 应判为实答，判据却说是拒答。正文前 60 字：${body.slice(0, 60)}`).toBe(false)
    }

    // ---------- 阈值边界（各顶到 ±1 字） ----------
    expect(
      isRefusal('前'.repeat(REFUSAL_MARK_MAX_OFFSET) + M),
      `那句正好出现在第 ${REFUSAL_MARK_MAX_OFFSET} 字（阈值本身）时应判拒答`
    ).toBe(true)
    expect(
      isRefusal('前'.repeat(REFUSAL_MARK_MAX_OFFSET + 1) + M),
      `那句出现在第 ${REFUSAL_MARK_MAX_OFFSET + 1} 字（阈值 +1）时应判实答 —— 再往后就是「局部没覆盖」那种实答的地盘了`
    ).toBe(false)
    expect(
      isRefusal(M + '。' + 'x'.repeat(REFUSAL_MAX_LENGTH - M.length - 1)),
      `整篇正好 ${REFUSAL_MAX_LENGTH} 字（阈值本身）时应判拒答`
    ).toBe(true)
    expect(
      isRefusal(M + '。' + 'x'.repeat(REFUSAL_MAX_LENGTH - M.length)),
      `整篇 ${REFUSAL_MAX_LENGTH + 1} 字（阈值 +1）时应判实答 —— 最长的真实拒答只有 138 字（id=5），` +
        `而最短的「开头提到这句却是实答」有 458 字（id=33），阈值取在两者之间`
    ).toBe(false)

    // ---------- 两种写法等价，且**共用**同一对阈值（放宽写法不等于放宽位置/长度） ----------
    expect(isRefusal(A), '光秃秃的「中」写法同样应判拒答').toBe(true)
    expect(
      isRefusal('前'.repeat(REFUSAL_MARK_MAX_OFFSET) + A),
      `「中」写法正好出现在第 ${REFUSAL_MARK_MAX_OFFSET} 字（阈值本身）时应判拒答`
    ).toBe(true)
    expect(
      isRefusal('前'.repeat(REFUSAL_MARK_MAX_OFFSET + 1) + A),
      `「中」写法出现在第 ${REFUSAL_MARK_MAX_OFFSET + 1} 字（阈值 +1）时同样应判实答`
    ).toBe(false)
    expect(
      isRefusal('答'.repeat(120) + A),
      '「中」写法夹在长实答中间（id=3 那种「局部没覆盖」的形状）应判实答 —— 认下新写法**不许**顺手放宽位置阈值'
    ).toBe(false)
    expect(
      isRefusal('手册中没有覆盖「设备台账」具体业务字段'),
      '「中」写法也不许放宽成前缀「手册中没有覆盖」：少了「这个问题」四个字的仍是**局部**没覆盖'
    ).toBe(false)
    // 两种写法混在一篇里时，位置比的是**最早**那个：开头那句「中」已经定了它是拒答，
    // 后面再夹一句「里」不改变结论（反向的形状由上面 `'答'.repeat(120) + A` 钉住）
    const mixed = A + '。' + '答'.repeat(100) + M
    expect(isRefusal(mixed), '开头是「中」、后面还夹了「里」⟹ 仍应判拒答').toBe(true)
    // ---------- 报告印的必须是**实际命中**的那种写法（红线：只准原样引用原文） ----------
    expect(matchedRefusalMark(mixed), '混排时印最早命中的那种').toBe(A)
    expect(matchedRefusalMark('前'.repeat(3) + M + '。'), '只命中「里」时印「里」，别印成常量表里排第一的那个').toBe(M)
    expect(matchedRefusalMark('答'.repeat(50)), '没命中就返回 null，调用方自己去兜').toBeNull()

    // ---------- 退化输入 ----------
    expect(isRefusal(''), '空正文不该被判成拒答（它是「没答出来」，另一条断言管）').toBe(false)
    expect(isRefusal('   '), '纯空白同上').toBe(false)
    expect(
      isRefusal('手册里没有覆盖「设备台账」具体业务字段'),
      '别把判据放宽成前缀「手册里没有覆盖」：少了「这个问题」四个字的是**局部**没覆盖，' +
        'id=9 在 10-04 00:07 那轮就是这么开头、随后给出了可用建表规则的，那是条实答'
    ).toBe(false)
  })

  test('42 条非 BUILD 示例逐条真发：插入一字不差、答案落地、无残留、确实走了 CHAT 路径', async ({
    page
  }) => {
    // 🔴 6.5 小时，不是拍的，也不是「一路调大直到不超时」—— 它是**算出来的上界**：
    //    每条的墙上时间被 PER_CASE_STREAM_TIMEOUT 钉死在 480 秒，加上意图分型（实测 ~5 秒）、
    //    打字机收敛（SETTLE_BUDGET_MS 30 秒）与 UI 开销，单条最坏 ~520 秒；42 条 ⟹ 6.07 小时。
    //    给到 6.5 小时是为了让「跑完」这件事**只由模型决定，不由这个天花板决定**：
    //    宁可它慢慢跑完，也不要中途被掐断 —— 掐断的后果是最后几条的结论落在报告外面，
    //    读的人以为它们过了（这条疤写在上面 REPORT_THIS_RUN 的注释里）。
    //
    // 🔴 为什么要重算：原先的 100 分钟是按 2026-10-04 凌晨那两轮实测的 **45.6 / 37.6 分钟**
    //    （均值 54~65 秒/条）留一倍余量得来的，那个均值属于 `qwen3.7-plus-2026-05-26`。
    //    当天上午模型集换了（详见 PER_CASE_STREAM_TIMEOUT 的注释），换完实测单条 CHAT
    //    **267 秒**、completion 4371 token ⟹ 42 条的典型耗时已经是 ~3.7 小时，100 分钟必被掐断。
    //    所以这两个数是**一起**改的：只放大单条上限而不放大总预算，等于把卡死点从条内挪到条间。
    test.setTimeout(23_400_000)

    const targets = allCases
      .filter((c) => c.expectIntent !== 'BUILD')
      .filter((c) => ONLY.length === 0 || ONLY.includes(c.id))
    expect(targets.length, '过滤之后一条都不剩，这个用例等于没跑').toBeGreaterThan(0)

    /**
     * ⑧ 拒答棘轮的**可比总体**：钉死在 CHAT、且失败形状稳定的那些 id
     *
     * 推导见 KNOWN_REFUSAL_COUNT 的注释。全量跑时是 35 条（37 − id19/21）；
     * 子集跑时按子集算 —— 棘轮那句断言在子集跑里天然只会更松，不会假红。
     */
    const ratchetIds = new Set(
      targets.filter((c) => c.expectIntent === 'CHAT' && !KNOWN_UNSTABLE_IDS.has(c.id)).map((c) => c.id)
    )

    // 🔴 先把审计那条写好的头落盘。放在循环外而不是 afterAll 里：
    //    这一轮要是中途崩了，afterAll 的追加照样执行，但头必须在第一条结果之前就在文件里
    mainTestRan = true
    flushReport()

    await login(page)
    await gotoWithAuth(page, '/ai/agent/assistant')

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 20_000 })

    // 🔴 认领会话：产品收到 META 事件后把 conversationId 写进 localStorage 的「最近一次会话」，
    //    那是「这条会话是本轮建的」唯一可信的凭据。afterAll 只删账本里的东西 ——
    //    判据、钩子与拆台子都在 helpers/conversation-ownership.ts，T2 / headless-gate 共用一份
    ownership = await watchOwnedConversations(page)

    /**
     * 🔴 两个计数器必须分开，合用一个会**污染后面所有条**
     *
     * 第一版只有一个 `sent`，既当「已经发过几条」的开关（决定要不要点「新建对话」），
     * 又当「几条通过了断言」的成绩。而 `sent++` 写在 try 的**末尾** ——
     * 于是任何一条断言红掉，`sent` 就不加，下一条进来时 `sent > 0` 判不出「上一条发过」，
     * **「新建对话」不点了**，新问题直接追加进上一条的会话里。
     * 后果不是红一条，是从此每一条都带着前面所有条的上下文：答案被污染、token 成本翻倍，
     * 而报告上看不出来（首轮全量 13 条红 ⟹ 至少 13 次串台）。
     *
     * 现在：`dispatched` 在**点完发送**就加（发出去了就是发出去了，与断言结果无关），
     * `completed` 在全部断言过了之后才加。
     */
    let dispatched = 0
    let completed = 0
    /**
     * 🔴 连续命中 PROVIDER_FAILURE 的条数；一旦有一条正常，立刻归零
     *
     * 用「连续」而不是「累计」：42 条里零星坏两三条是抖动，累计计数会误中止；
     * 连着坏三条才是配额/密钥没了。取 3 见 PROVIDER_ABORT_AFTER。
     */
    let providerStreak = 0
    let shouldAbort = false
    let abortReason = ''
    /**
     * 🔴 本轮**真的把断言跑到了**的 id。不能拿 `targets` 当它
     *
     * 提前中止（shouldAbort）的时候，`targets` 里还躺着没跑的 id。
     * 拿它算 `healed` 就会印出一串「已知缺陷不复现了，可以收紧」——
     * 而它们压根没被测过。照做等于把白名单删空，下一轮全量跑红一片。
     * 这正是下面 `ranThisCase` 存在的原因：模型侧没答的那条也**不算跑过**，
     * 它没探到分型、也没探到流式收尾。
     */
    const ranIdsList: number[] = []
    for (const [i, c] of targets.entries()) {
      const startedAt = Date.now()
      const label = `示例 ${c.id}（${c.title}）`
      const detail: string[] = []
      let ranThisCase = true
      // 🔴 用 holder 而不是 `let answerText`：断言抛出去时赋值语句不会执行，
      //    正文就丢了。assertPlainAnswer 读完立刻写进 sink，抛不抛都带得出来
      const sink = { text: '' }
      /** ③④⑤⑦ 与拒答分流。两条路径（CHAT / 意图不限走了问答）共用，别抄两遍 */
      const tallyAnswer = async (): Promise<void> => {
        if ((await assertPlainAnswer(page, c, detail, sink)) === 'REFUSED') {
          refusals.push({ id: c.id, label })
        } else {
          answered++
        }
      }
      try {
        // 每条都从全新会话开始。第一条进来时会话本来就是空的（全新浏览器上下文
        // ⟹ localStorage 空 ⟹ useLastConversation 读不到东西 ⟹ 不会恢复上一轮）
        // 🔴 下面每个 click 都带 CLICK_TIMEOUT_MS：这几句都排在断言**之前**，
        //    按钮一旦不在，无限等的 click 会先把整条用例挂死（见 CLICK_TIMEOUT_MS 的注释）
        if (dispatched > 0) {
          await page.getByRole('button', { name: /新建对话/ }).click({ timeout: CLICK_TIMEOUT_MS })
          await expect(page.locator('[data-testid="assistant-answer"]')).toHaveCount(0, {
            timeout: 10_000
          })
        }

        // ---------- ① 走真实 UI 插入，并断言插入的结果而不是接口的返回 ----------
        await page.locator('[data-testid="template-picker"]').click({ timeout: CLICK_TIMEOUT_MS })
        const popper = page.locator('.agent-tpl-popover:visible')
        await expect(popper).toBeVisible({ timeout: 10_000 })
        await popper
          .locator('[data-testid="tpl-tab-case"]')
          .click({ timeout: CLICK_TIMEOUT_MS })
        // 🔴 用 data-case-id 精确点，不按标题文本匹配：45 条示例分 40 个模板分组，
        //    标题互为前缀的不少，文本匹配一旦命中两条就会点错 —— 而点错的表现是
        //    「答案与 hint 对不上」，读报告的人会去怀疑模型
        const item = popper.locator(`[data-testid="case-item"][data-case-id="${c.id}"]`)
        await expect(item, `${label} 没出现在示例面板里（可能被停用，或 simple-list 与 UI 口径不一致）`).toHaveCount(1)
        await item.click({ timeout: CLICK_TIMEOUT_MS })
        await expect(textarea, `${label} 插入后正文不符`).toHaveValue(c.content, { timeout: 5_000 })

        // ---------- ② 真发，等流收尾 ----------
        await page.getByRole('button', { name: /发\s*送/ }).click({ timeout: CLICK_TIMEOUT_MS })
        // 🔴 点完就记账，不等断言：见上面 dispatched / answered 的注释
        dispatched++
        // 会话认领数与它比，才能发现「META 一条都没抓到」这种抓取失效。
        // 同样刻意不等断言：会话在后端已经建出来了，用例后面红不红与它无关
        ownership?.noteSend()
        // 「停止」一闪而过的答案采不到，但这里采不到就说明**压根没进流式** ——
        // 那是要报的。真要遇到快速答案误红，改法是 race 两种可见性，不是删掉这一步
        // 🔴 这句预言在 2026-10-04 14:36 那轮应验了，只是应验在**下一步（⑥）**上：
        //    「停止」消失与草稿卡挂载之间隔了 127ms，⑥ 的瞬时快照正好落在空档里。
        //    现已按这里的处方改成 race（见 `waitBuildPath`），② 本身不用动
        await expect(page.getByRole('button', { name: /停止/ }), `${label} 没进入流式生成`).toBeVisible({
          timeout: 30_000
        })
        await expect(
          page.getByRole('button', { name: /停止/ }),
          `${label} 等 ${PER_CASE_STREAM_TIMEOUT / 1000} 秒${MARK_STREAM_TIMEOUT}`
        ).toHaveCount(0, { timeout: PER_CASE_STREAM_TIMEOUT })

        // ---------- ⑥ 意图分型：CHAT 必须走问答路径 ----------
        /**
         * 🔴 走 {@link waitBuildPath} 而不是 `await draftCards.count()`：那张不等人的快照
         *    会把「卡片在流式收尾后 127ms 才挂上来」读成「没有卡片」，
         *    进而让一条本该被棘轮降级成 ⚠️ 的已知误判，变成一条认不出类的硬红。
         *    疤与时刻表见 waitBuildPath 的注释。
         */
        const buildEvidence = await waitBuildPath(page, INTENT_RACE_TIMEOUT_MS)

        if (c.expectIntent === 'CHAT') {
          /**
           * 🔴 草稿卡与规划条**合成一条**断言：原来是两条独立 expect，
           *    而第二条的消息（「出现了规划进度条…」）不含 MARK_MISCLASSIFIED_AS_BUILD
           *    ⟹ 只出规划条、不出卡片的那种误判会被认成「新故障」硬红，
           *    和上面那个 race 是同一族的病（该被棘轮认出来的类，认不出来）。
           */
          expect(
            buildEvidence,
            `${label} ${MARK_MISCLASSIFIED_AS_BUILD}（聊天里出了${buildEvidence}）—— 一条本该直接问答的示例被拉去编排流程，` +
              `而「答案非空」这种断言发现不了它`
          ).toBe('')
          detail.push('意图：CHAT（无草稿卡、无规划进度条）')
          await tallyAnswer()
        } else {
          // expect_intent 为 NULL = 两种意图都可接受（见 AgentPromptTemplateCaseDO 的字段注释）。
          // 🔴 但「都可接受」不等于「都可以没有」：必须落在其中一条路径上，
          //    两边都空就是既没答也没编排 —— 那正是要抓的
          if (buildEvidence) {
            detail.push(`意图：BUILD（expect_intent 为空，两种都合法；这里出了${buildEvidence}）`)
          } else {
            detail.push('意图：CHAT（expect_intent 为空，两种都合法；这里走了问答）')
            await tallyAnswer()
          }
        }
        completed++
      } catch (e) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)

        /**
         * 🔴 认类 → 查白名单 → 决定红不红
         *
         * 认不出类（msg 不含任何标记）就是**新故障**，照原样红。
         * 认得出类但 id 不在已知集合里，也红 —— 这正是棘轮要抓的「又多了一条」。
         * 认得出类且 id 在已知集合里，才降级成 ⚠️：它复现是预期内的，
         * 让它红只会把新增回归淹掉（见 KNOWN_MISCLASSIFIED_AS_BUILD 的注释）。
         *
         * 🔴 PROVIDER_FAILURE 排在最前认，且**不走白名单那一套**：
         *    它不是缺陷格子，是本轮作废的原因（见下面那一段）。
         */
        const cls = msg.includes(MARK_PROVIDER_FAILURE)
          ? ('PROVIDER_FAILURE' as const)
          : msg.includes(MARK_MISCLASSIFIED_AS_BUILD)
            ? ('MISCLASSIFIED_AS_BUILD' as const)
            : msg.includes(MARK_STREAM_TIMEOUT)
              ? ('STREAM_TIMEOUT' as const)
              : null
        if (cls === 'MISCLASSIFIED_AS_BUILD') observedMisclassified.push(c.id)
        if (cls === 'STREAM_TIMEOUT') observedTimeout.push(c.id)

        if (cls === 'PROVIDER_FAILURE') {
          /**
           * 🔴 单独一条路：不进 failures、不查白名单、不计入 ranIds
           *
           * 厂商侧没回话 ⟹ 模型正文压根不存在 ⟹ ⑧⑨⑩ 三条棘轮的分母都在缩水。
           * 混进 failures 的话，报出来的是「N 条机械断言没过」，查的人会去逐条看正文，
           * 而正文是空的 —— run3 最后 10 条就是这么白查的，还顺手把外部配额故障
           * 记成了前端渲染缺陷。
           *
           * 🔴 连着 PROVIDER_ABORT_AFTER 条就中止本轮。收益不是省时间（虽然能省十几分钟），
           *    而是**不让报告继续攒假数据**：再跑下去 ⑧ 的分母会一路磨到 0，
           *    那时候「拒答没超上限」这句话彻底没有意义（§6.3-6）。
           */
          observedProviderFailure.push(c.id)
          providerStreak++
          ranThisCase = false
          detail.push(`🔴 ${msg}`)
          detail.push('　　模型侧没答 ⟹ 这一条既没测到提示词模板、也没测到意图分型，不计入任何棘轮')
          if (providerStreak >= PROVIDER_ABORT_AFTER) {
            abortReason =
              `连续 ${providerStreak} 条模型侧没答（${fmtIds(observedProviderFailure.slice(-providerStreak))}），` +
              `本轮到 id=${c.id} 为止中止，后面 ${targets.length - i - 1} 条没跑`
            detail.push(`　　🛑 ${abortReason}`)
            shouldAbort = true
          } else {
            detail.push(
              `　　已连续 ${providerStreak} 条，到 ${PROVIDER_ABORT_AFTER} 条中止本轮` +
              `（一条可能是抖动，两条可能是巧合，连着三条基本就是配额/密钥没了）`
            )
          }
        } else {
          providerStreak = 0

          const known =
            cls === 'MISCLASSIFIED_AS_BUILD'
              ? KNOWN_MISCLASSIFIED_AS_BUILD.has(c.id)
              : cls === 'STREAM_TIMEOUT'
                ? KNOWN_STREAM_TIMEOUT.has(c.id)
                : false

          if (cls && known) {
            knownDefects.push(`${label}：${cls}`)
            detail.push(`⚠️ 已知缺陷复现 · ${cls}：${msg}`)
            detail.push('　　不计入 failures（棘轮），但也**没有**测到模板 —— 不计入有效覆盖')
          } else {
            failures.push(`${label}：${msg}`)
            detail.push(`❌ ${msg}`)
            if (cls) detail.push(`　　🔴 ${cls} 撞上了**不在**已知集合里的 id=${c.id}，这是新增的一条`)
          }
        }
      }

      if (ranThisCase) ranIdsList.push(c.id)

      const elapsed = Date.now() - startedAt
      rows.push(
        `\n---\n\n## ${i + 1}/${targets.length} · id=${c.id} · ${c.title}\n\n` +
          `- expect_intent：${c.expectIntent ?? '（空 = 两种都合法）'}\n` +
          `- 耗时：${elapsed}ms\n` +
          `${detail.map((d) => `- ${d}`).join('\n')}\n\n` +
          `**提问**\n\n${c.content}\n\n` +
          `**验收标准（expect_hint · 人工评审用，本用例不机械断言）**\n\n${c.expectHint ?? ''}\n\n` +
          `**模型正文**\n\n${sink.text || '_（正文没取到：要么没走到问答气泡，要么在 ① ~ ⑥ 某一步就红了 —— 看上面的 ❌ 行）_'}\n`
      )
      // 逐条落盘：中途被 timeout 掐断时，已跑完的那些结论还在文件里
      flushReport()
      // 🔴 break 放在 rows.push + flushReport **之后**：中止的那一条自己也要落进报告，
      //    否则报告里最后一条是好的，读的人看不出这一轮是断在哪儿的
      if (shouldAbort) break
    }

    /**
     * 两个已知缺陷类的棘轮结账
     *
     * 🔴 `healed` 必须先与**本轮真跑过的 id** 求交：ONLY 子集跑的时候，
     *    没被跑的那些 id 不在 observed 里，直接做差会印出一串「不复现了，可以收紧」，
     *    照做就把白名单删空了 —— 下一轮全量跑立刻红一片。
     *    即便交了，子集跑也**不许**当收紧的依据（样本才两三条），所以下面把提示按 ONLY 分开印。
     */
    const ranIds = new Set(ranIdsList)
    const newMisclassified = observedMisclassified.filter((id) => !KNOWN_MISCLASSIFIED_AS_BUILD.has(id))
    const newTimeout = observedTimeout.filter((id) => !KNOWN_STREAM_TIMEOUT.has(id))
    const healedMisclassified = [...KNOWN_MISCLASSIFIED_AS_BUILD].filter(
      (id) => ranIds.has(id) && !observedMisclassified.includes(id)
    )
    const healedTimeout = [...KNOWN_STREAM_TIMEOUT].filter(
      (id) => ranIds.has(id) && !observedTimeout.includes(id)
    )
    const healed = [
      ...(healedMisclassified.length ? [`CHAT→BUILD 不复现：${fmtIds(healedMisclassified)}`] : []),
      ...(healedTimeout.length ? [`等不到答完 不复现：${fmtIds(healedTimeout)}`] : [])
    ]

    /**
     * ⑧ 的棘轮只数**可比总体**里的拒答（推导见 KNOWN_REFUSAL_COUNT）
     * 总体外的拒答照样逐条印进报告，只是不参与这条断言
     */
    const stableRefusals = refusals.filter((r) => ratchetIds.has(r.id))
    const outOfRatchet = refusals.filter((r) => !ratchetIds.has(r.id))
    /** 总体内、且不在已记录的 21 条里的 —— 这才是「手册又少了一块」的候选 */
    const newRefusals = stableRefusals.filter((r) => !KNOWN_REFUSED_IDS.has(r.id))
    /**
     * 🔴 ⑧ 的分母**实际探通**了多少条
     *
     * 光印「上限 21、本轮 13」是不够的：13 ≤ 21 在总体缩水时是**空过**的。
     * 提前中止、或若干条模型侧没答，都会让「该答的没答」冒充「没新增拒答」。
     * §6.3-6 的原话是「凡断言什么都没发生，前面必须先有一条断言这一项确实探通了」——
     * 这里没法给每条都补一次探通断言，那就至少把分母印在断言消息里，让空过看得见。
     */
    const ratchetRan = [...ratchetIds].filter((id) => ranIds.has(id)).length

    // 🔴 「有效覆盖」必须印出来：拒答的那些条**没有测到提示词模板**，
    //    只印「真发 42/42」会让人以为 42 条都验过了。这是 §6.3-23 的明示要求
    rows.push(
      `\n---\n\n## 汇总\n\n` +
        (abortReason
          ? `> 🛑 **本轮提前中止：${abortReason}**\n` +
            `> 中止之后的所有数字（拒答、有效覆盖、棘轮结账）都建立在缩水的分母上，**不能当结论用**。\n\n`
          : '') +
        `- 真发（点出去过）：${dispatched}/${targets.length} 条\n` +
        `- 断言全过：${completed}/${targets.length} 条\n` +
        `- **有效覆盖：${answered}/${targets.length} 条**（发出去、模型确实答出了实质正文、且不是拒答）\n` +
        `- 🔴 模型侧没答（厂商配额/密钥/网络，本轮作废的原因，不进任何棘轮）：${observedProviderFailure.length} 条` +
        `${observedProviderFailure.length ? ` ${fmtIds(observedProviderFailure)}` : ''}\n` +
        `- 知识库拒答：${refusals.length} 条\n` +
        (refusals.length
          ? refusals
              .map((r) => `  - ⚠️ ${r.label}${ratchetIds.has(r.id) ? '' : '　_（不在棘轮总体内：意图不限或形状不稳）_'}`)
              .join('\n') + '\n'
          : '') +
        `- 已知缺陷复现（不计入失败，也不计入有效覆盖）：${knownDefects.length} 条\n` +
        (knownDefects.length ? knownDefects.map((f) => `  - ⚠️ ${f}`).join('\n') + '\n' : '') +
        `- 机械断言失败：${failures.length} 条\n` +
        (failures.length ? failures.map((f) => `  - ❌ ${f}`).join('\n') + '\n' : '') +
        `\n### 棘轮结账\n\n` +
        `- ⑧ 拒答：可比总体 ${ratchetIds.size} 条（钉死 CHAT 且形状稳定），` +
        `**本轮真探通 ${ratchetRan} 条**，其中拒答 **${stableRefusals.length}** 条，上限 ${KNOWN_REFUSAL_COUNT}，` +
        `**名单外新增** ${newRefusals.length} 条 ${fmtIds(newRefusals.map((r) => r.id))}` +
        (ratchetRan < ratchetIds.size
          ? `\n- 　　🔴 分母缩水了 ${ratchetIds.size - ratchetRan} 条（模型侧没答或本轮中止）—— ` +
            `上面那个「没超上限」是**空过**的，不是结论`
          : '') +
        `${outOfRatchet.length ? `\n- 　　总体外拒答（不参与 ⑧，但照样要看）：${outOfRatchet.length} 条 ${fmtIds(outOfRatchet.map((r) => r.id))}` : ''}\n` +
        `- ⑨ CHAT 被判成 BUILD：观测 ${observedMisclassified.length} 条 ${fmtIds(observedMisclassified)}，` +
        `已知 ${KNOWN_MISCLASSIFIED_AS_BUILD.size} 条，**新增** ${newMisclassified.length} 条 ${fmtIds(newMisclassified)}\n` +
        `- ⑩ 等不到答完：观测 ${observedTimeout.length} 条 ${fmtIds(observedTimeout)}，` +
        `已知 ${KNOWN_STREAM_TIMEOUT.size} 条，**新增** ${newTimeout.length} 条 ${fmtIds(newTimeout)}\n` +
        (healed.length
          ? `\n> 🔔 已知项本轮没复现：\n` +
            healed.map((h) => `> - ${h}`).join('\n') +
            '\n' +
            (ONLY.length === 0
              ? `> 连续**两轮全量跑**都不复现，才把它从集合里删掉 —— 棘轮只许紧不许松。\n`
              : `> ⚠️ 本轮是子集跑（TPL_MATRIX_ONLY=${ONLY.join(',')}），样本太小，` +
                `**不能**据此收紧白名单。\n`)
          : '') +
        `\n> 拒答 = 模型回了「${REFUSAL_MARK}」（或只差一个字的等价写法「${REFUSAL_MARK_ALT}」）。这些条目的 expect_hint **根本没被检验**，\n` +
        `> 评审时不要把它们当成「答得不好」，它们是「手册没写这一章」。要补的是知识库，不是模板。\n`
    )
    flushReport()

    /**
     * 🔴 ⑭ 排在**所有棘轮之前**，比 ⑨⑩ 还要靠前
     *
     * 模型侧没答的时候，⑧⑨⑩ 的分母都在缩水，三条都可能 vacuously 绿：
     *   · ⑧「拒答没超上限」—— 该答的没答，自然不算拒答
     *   · ⑨「没有新增 CHAT→BUILD」—— AgentIntentClassifier#classify 在异常时
     *     **回落成 CHAT**（设计如此，「分类挂了不能让整次对话跟着挂」），
     *     于是配额耗尽期间每一条都被判成 CHAT，⑨ 和 ② 一起空过
     *   · ⑩「没有等不到答完」—— 报错比超时快得多，压根走不到那条断言
     * 先红在 ⑭ 上，读报告的人才不会把「厂商配额没了」读成「模板这轮没退化」。
     */
    expect(
      observedProviderFailure,
      `${observedProviderFailure.length} 条模型侧没答（${fmtIds(observedProviderFailure)}）—— 本轮**作废**，` +
        `它既不是提示词模板的结论，也不是意图分型的结论。` +
        `真因就在下面这些地方，三处互为印证：逐条 detail 里印的 error alert 原文、` +
        `agent_message（status=FAILURE、token_count=0、error_msg 非空）、后端日志的 ` +
        `AiModelFailoverServiceImpl:132 [callWithFallback]。` +
        `配额/密钥恢复之前**不要重跑** —— 重跑只会再攒一份假数据，还会把 ⑧ 的分母磨到 0。` +
        (abortReason ? `\n本轮已提前中止：${abortReason}` : '')
    ).toHaveLength(0)

    // 🔴 两条类棘轮放在 `failures` 那条**之前**：新增项同时也躺在 failures 里，
    //    先抛 failures 只会得到一句「N 条没过」，看不到是**哪一类**、要不要改白名单
    expect(
      newMisclassified,
      `又多了 ${newMisclassified.length} 条 CHAT 示例被判成 BUILD（${fmtIds(newMisclassified)}）—— ` +
        `意图分型退化了一个新格子。逐条正文见 ${path.relative(process.cwd(), REPORT_THIS_RUN)}；` +
        `确认是新缺陷之后再加进 KNOWN_MISCLASSIFIED_AS_BUILD，别把断言删了`
    ).toHaveLength(0)

    expect(
      newTimeout,
      `又多了 ${newTimeout.length} 条等不到答完（${fmtIds(newTimeout)}，上限 ${PER_CASE_STREAM_TIMEOUT / 1000} 秒）—— ` +
        `id=43/21 已经证明「把上限调大」治不了这一类，先去看它是不是也在工具回路里打转`
    ).toHaveLength(0)

    expect(
      failures,
      `${failures.length} 条示例真发时机械断言没过（详见 ${path.relative(process.cwd(), REPORT_THIS_RUN)}）`
    ).toHaveLength(0)

    expect(
      stableRefusals.length,
      `可比总体（${ratchetIds.size} 条钉死 CHAT 且形状稳定的示例，本轮真探通 ${ratchetRan} 条）里` +
        `拒答 ${stableRefusals.length} 条，` +
        `超过已记录的 ${KNOWN_REFUSAL_COUNT} 条。名单外新增的是 ${fmtIds(newRefusals.map((r) => r.id))}；` +
        `逐条清单见 ${path.relative(process.cwd(), REPORT_THIS_RUN)} 的汇总段。` +
        `🔴 先分辨是三种里的哪一种，别一律记成「手册少了一块」：` +
        `①手册覆盖面真的少了（或模板把问题问歪了，让检索命中不到）；` +
        `②名单里某条翻回了实答、另一条翻成拒答 —— 那是采样抖动，本断言刻意用条数不用集合差，` +
        `所以只有**净多**才会红，红了就该看它上一轮是什么形状；` +
        `③它本就是「含那句但判为实答」的边界条（阈值 20 / 240 正是拿 id=3/33/61/69/71/73/79 校准的），` +
        `答案长度跨过了判据线 —— run9 那 4 条里有 3 条是这种，而手册一个字没动。` +
        `确认是①并补完知识库之后，请把 KNOWN_REFUSAL_COUNT 与 KNOWN_REFUSED_IDS 一起调小，别把棘轮松回去`
    ).toBeLessThanOrEqual(KNOWN_REFUSAL_COUNT)
  })
})

/**
 * 「答案气泡」与「error alert」二选一，谁先出现算谁
 *
 * 🔴 不能只等气泡。2026-10-04 run3 的最后 10 条全是厂商配额耗尽，
 *    而报告印的是「问答气泡没渲染出来」—— 把一次外部配额故障指成了前端渲染缺陷。
 *    真因其实**就显示在页面上**：SSE 的 error 分支（AssistantChat.vue 的 applyChatEvent case 'ERROR'）
 *    会把 errorMsg 渲染成 `.el-alert--error`，只是原来的 ⑦ 先等气泡、等不到就抛，
 *    压根没走到查 alert 那一步（alert 检查排在气泡断言**之后**）。
 *
 * 🔴 于是这里改成两个 locator 一起轮询，并且**把 alert 的原文带回去**。
 *    原文是关键：它是 `所有 AI 模型均不可用，最后错误：403 - {"code":"AllocationQuota…"}`
 *    这种一读就知道该找谁的东西，比任何推测都硬。同一条错误也落在
 *    `agent_message.error_msg`（status=FAILURE、token_count=0），两处互为印证。
 *
 * @returns answer=true 表示气泡出来了；否则 error 非空表示页面给出了错误原文，
 *          两者都假表示 30 秒内页面上什么都没有（那才是真要查前端/SSE 的情况）
 *
 * 🔴 **本函数保证在 timeoutMs 内返回**（超出量不超过一个 {@link STEP_TIMEOUT_MS} 的调度抖动）。
 *    改前它不保证：`while (Date.now() < deadline)` 的守卫只在每轮**开头**求值一次，
 *    而轮内的 locator 调用在 `actionTimeout=0` 下是无限等的 ——
 *    一旦卡在轮内，deadline 再也轮不到被检查。实测疤见下面 `assertPlainAnswer` 的注释。
 */
async function waitAnswerOrError(
  page: Page,
  timeoutMs: number
): Promise<{ answer: boolean; error: string }> {
  const answer = page.locator('[data-testid="assistant-answer"]').last()
  const alert = page.locator('.el-alert--error').last()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await bounded(answer.isVisible().catch(() => false), STEP_TIMEOUT_MS)) === true) {
      return { answer: true, error: '' }
    }
    if ((await bounded(alert.isVisible().catch(() => false), STEP_TIMEOUT_MS)) === true) {
      const text = await boundedText(alert, STEP_TIMEOUT_MS)
      if (text) return { answer: false, error: text }
    }
    const left = deadline - Date.now()
    if (left <= 0) break
    await bounded(page.waitForTimeout(Math.min(500, left)), 1_000)
  }
  return { answer: false, error: '' }
}

/**
 * ⑥ 的**前置**：等页面说出「这条走的是编排路径还是问答路径」，别拍瞬时快照
 *
 * 🔴 疤（2026-10-04 14:36 那轮，id=19，一轮 3.5 小时的真发被它判成红）：
 *    原来这里是 `const cardCount = await draftCards.count()` —— 一张**不等**的快照，
 *    时机恰好卡在流式收尾与草稿卡挂载之间的空档里：
 *
 *    | 时刻 | 事件 | 出处 |
 *    |---|---|---|
 *    | 14:36:46.267 | chat 触发器只记类型 code(wf_plan_mutg750u_1) | `WorkflowTriggerExtractor#applyChat` |
 *    | 14:36:46.308 | insertNewVersion(id=437, status=DRAFT) | `AgentWorkflowDefServiceImpl#insertNewVersion` |
 *    | ~14:36:46.31 | 「停止」消失 ⟹ **快照在这里读到 0** | 本用例 ② |
 *    | 14:36:46.435 | 前端才去取 `planner/workflow-draft?defId=437` 挂卡片 | 后端访问日志 |
 *
 *    读到 0 就走进 CHAT 分支去等问答气泡，而气泡与草稿卡在同一条消息上**互斥**（见本文件开头 ⑥ 那段），
 *    永远等不到；30 秒后抛「问答气泡没渲染出来，页面上也没有 error alert」——
 *    这句**不含任何 MARK** ⟹ catch 里 `cls === null` ⟹「认不出类就是新故障，照原样红」⟹ 硬红。
 *
 * 🔴 后果比误报一条更坏：id=19 本来就该由 `KNOWN_MISCLASSIFIED_AS_BUILD` 棘轮降级成 ⚠️，
 *    被这一 race 一搅，变成了「一条不在已知集合里的新故障」。
 *    这正是本文件 ② 那句注释预言过的改法 —— race 两种可见性，**不是**删掉这一步。
 *
 * 🔴 只回答「有没有走编排」，不去判问答气泡：气泡与 error alert 谁先出现算谁，
 *    {@link waitAnswerOrError} 已经做对了，别在这儿抄第二遍（抄两份就会漂）。
 *    所以本函数返回空串时，调用方照旧交给 `tallyAnswer()` —— 厂商配额耗尽那条路
 *    （MARK_PROVIDER_FAILURE）一点没丢。
 *
 * 🔴 顺序上先查编排侧两个 locator：它们一旦出现就不会自己消失，
 *    而问答气泡在打字机期间随时可能可见。让「更确定、更要报」的那个先判，
 *    万一互斥前提哪天被破坏，误报方向是 BUILD（会被棘轮认出来），不是假绿。
 *
 * @returns `''` 没走编排；否则是**看得见的那个证据**的中文名（拼进断言消息用）
 */
async function waitBuildPath(page: Page, timeoutMs: number): Promise<string> {
  const card = page.locator('[data-testid="workflow-draft-card"]').last()
  const planning = page.locator('[data-testid="assistant-planning"]').last()
  const answer = page.locator('[data-testid="assistant-answer"]').last()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await bounded(card.isVisible().catch(() => false), STEP_TIMEOUT_MS)) === true) return '流程草稿卡'
    if ((await bounded(planning.isVisible().catch(() => false), STEP_TIMEOUT_MS)) === true) return '规划进度条'
    // 问答气泡先出来就说明这条走的是问答路径，编排侧不用再等了（互斥，见本文件开头 ⑥ 那段）
    if ((await bounded(answer.isVisible().catch(() => false), STEP_TIMEOUT_MS)) === true) return ''
    const left = deadline - Date.now()
    if (left <= 0) break
    await bounded(page.waitForTimeout(Math.min(500, left)), 1_000)
  }
  // 三个都没出现：不是「走了问答」，是页面上什么都没有。
  // 交给 tallyAnswer() 去区分「渲染缺陷」与「厂商配额」，别在这里编病因
  return ''
}

/** id 列表印成 `（19、21）`；空列表印 `（无）`，别印成一对空括号让人以为漏了值 */
function fmtIds(ids: number[]): string {
  return ids.length ? `（${ids.join('、')}）` : '（无）'
}

/**
 * ③④⑤⑦：普通问答气泡上的四条机械断言
 *
 * 🔴 断在 assistant-answer 上，不能断整个气泡：AssistantChat.vue 里那个 data-testid 上方的注释写得很清楚，
 *    思维链内部也渲染 MarkdownView，不加这个 testid 的话「模型想过」就算通过，
 *    哪怕最终一个字都没答出来。
 *
 * 🔴 正文通过 `sink` 带出去，而不是靠 return：2026-10-04 那一轮 13 条红，
 *    报告里它们的「模型正文」全印成 `_（没有走到问答气泡）_` —— 因为 ⑦ 是
 *    `return text` **之前**抛的，调用方的 `answerText = await ...` 永远没被赋值。
 *    结果是：**恰恰在最需要看模型答了什么的那 13 条上，报告把答案丢了**，
 *    只剩一句「正文 12 字」，查的人无从判断 12 字到底是什么。
 *    （那 12 字其实就是 `手册里没有覆盖这个问题。`，而占位符也正好 12 字，
 *      两个 12 字撞在一起，更容易把人带偏。）先落袋、再断言，就不会丢。
 *
 * @returns 'ANSWERED' 真的答了；'REFUSED' 知识库拒答（这一条没测到模板，计入棘轮）
 */
async function assertPlainAnswer(
  page: Page,
  c: CaseRow,
  detail: string[],
  sink: { text: string }
): Promise<'ANSWERED' | 'REFUSED'> {
  const gate = await waitAnswerOrError(page, 30_000)
  expect(
    gate.answer,
    gate.error
      ? `示例 ${c.id}（${c.title}）${MARK_PROVIDER_FAILURE}：${gate.error}`
      : `示例 ${c.id}（${c.title}）的问答气泡没渲染出来，页面上也没有 error alert —— ` +
        `这一条从界面上查不出原因，得去看 SSE 与 agent_message.status`
  ).toBe(true)
  const text = await settledAnswerText(page)
  sink.text = text

  expect(text.length, `示例 ${c.id}（${c.title}）模型没有答出任何正文`).toBeGreaterThan(0)
  expect(
    text,
    `示例 ${c.id}（${c.title}）答案里漏出了未替换的占位符 —— ` +
      `提问正文本身不含 {{（已由数据层审计现场量过），所以这里的 {{ 只可能是模型照字面量吐回来的`
  ).not.toContain('{{')
  // 正文吐出来了、气泡里却还挂着 error alert：流到一半断的（典型是厂商侧配额/超时）。
  // 🔴 与「一个字都没吐」归同一类，因为后果一样 —— 这一条没测到模板，本轮的分母在缩水。
  //    分成两类的唯一作用是让报告好读，而代价是「一半断掉」被当成模板缺陷去查，那更贵
  //
  // 🔴🔴 实测疤（2026-10-04 T1 全量真跑，11:47 起，11:52 卡死，12:1x 人手杀进程）：
  //    这一行原先写作 `await page.locator('.el-alert--error').last().innerText().catch(() => '')`。
  //    `playwright.config.ts` 没设 `use.actionTimeout` ⟹ locator 操作默认**无限等**；
  //    而**正常轮次页面上压根没有 error alert**，于是这个 promise 永不 settle、
  //    `.catch()` 永不触发 —— 整条用例挂在那里，报告一个案例块都没落盘，
  //    `afterAll` 没跑、残留没清。第一条示例答完（11:52:07）之后就没再动过。
  //    同一个坑在 A4-d（`helpers/terminal.ts` 头注）与 T2 各炸过一次，这是第三次。
  //    改法就是复用那份已经验过的 `boundedText`，别再就地手写 `.catch()`。
  const alertText = await boundedText(page.locator('.el-alert--error').last(), STEP_TIMEOUT_MS)
  expect(
    alertText,
    alertText
      ? `示例 ${c.id}（${c.title}）${MARK_PROVIDER_FAILURE}：正文吐到一半挂了 error alert —— ${alertText}`
      : `示例 ${c.id}（${c.title}）气泡里挂了 error alert，真发不允许带病通过`
  ).toBe('')

  // 🔴 拒答要在 ⑦ 之前分流，而且**必须**在它之前：
  //    拒答可以长达 87 字（模型会补一句「提供的片段主要涵盖X，未涉及Y」），
  //    而 hint 最短的只有 47 字 —— 放在 ⑦ 后面的话，长拒答会被 ⑦ 判成「答得够长」直接放行。
  //    两种红的处置也完全不同：⑦ 红要改模板，拒答红要补知识库，混成一条就没法派活了
  // 🔴 印的是**实际命中的那一种写法**，不是常量 REFUSAL_MARK：id=65 说的是「手册**中**没有覆盖」，
  //    照旧写法印出来会让读者去报告里找一句模型没说的话（红线：只准原样引用原文）
  const refusedMark = isRefusal(text) ? matchedRefusalMark(text.trim()) : null
  if (refusedMark) {
    detail.push(
      `⚠️ 知识库拒答（${text.length} 字，以「${refusedMark}」开头）—— 这一条**没有真正测到提示词模板**`
    )
    return 'REFUSED'
  }

  const hint = (c.expectHint ?? '').trim()
  expect(
    text.length,
    `示例 ${c.id}（${c.title}）正文 ${text.length} 字，比它的验收标准（${hint.length} 字）还短 —— ` +
      `一份要求逐条列举的标准不可能被这么短的答案覆盖（正文已落进报告，先去看它到底答了什么）`
  ).toBeGreaterThanOrEqual(hint.length)

  detail.push(`正文 ${text.length} 字（验收标准 ${hint.length} 字）`)
  return 'ANSWERED'
}

/**
 * 等打字机吐完，再读正文
 *
 * 🔴 这一步不能省，省了会**静默**毁掉整份报告。
 *   AssistantChat.vue 的 typewriter 把后端已经流完的正文按 24ms/格逐字往上贴
 *   （积压越多贴得越快，上限约 750 字/秒）。贴字没放完就去读，界面上的正文就是半截的。
 *   ⚠️ 这里原先写的理由是「流正常结束时 onComplete 只把 streaming 置 false、**没有调**
 *     typewriter.flush()，只有报错分支和 handleStop 调了」—— 🔴 **那条前提已经不成立**：
 *     现在三条路径（onComplete / onerror / handleStop）都调了 flush，且 onComplete 那次
 *     刻意排在空流判定之前，理由见 AssistantChat.vue 里 onComplete 那段
 *     「先把打字机吐完，再置完成态。顺序是硬性的」的注释。
 *   🔴 但本步骤**照旧保留**、这一批里不动它：E4 只改注释，而「flush 补齐之后这一步还需不需要」
 *     是个产品行为问题，得真跑一轮才答得了 —— 记为 E4 的遗留项，不在注释里替它下结论。
 *   直接 innerText() 的后果有两个，都不好察觉：
 *     · 落盘的是**半截答案**。人工拿它去对 expect_hint 评审，等于对着残缺文本判分 ——
 *       比不评审更坏，因为它看起来像是评审过了。
 *     · 「正文长度 >= 验收标准长度」会红在一条其实答得很好的示例上，
 *       而红字指向的是模型，查的人不会想到是前端动画没放完。
 *   🔴 判据用「连着两次读到同样的文本」，不用固定等待：45 条答案长短差几十倍，
 *     固定值要么白等要么等不够。上限 30 秒，远超实测最长的贴字时间。
 *
 * 🔴 这里同样必须走 `boundedText` 而不是裸 `innerText()`：打字机贴字时渲染进程主线程
 *    会被长任务占满，locator 调用排队等不到执行 —— 那一层裸 `{ timeout }` 都管不到，
 *    只有外面再 race 一个定时器才保证会返回（见 `helpers/terminal.ts` 的「两层防护」）。
 */
async function settledAnswerText(page: Page): Promise<string> {
  const answer = page.locator('[data-testid="assistant-answer"]').last()
  const deadline = Date.now() + SETTLE_BUDGET_MS
  let prev = ''
  let last = ''
  while (Date.now() < deadline) {
    const cur = await boundedText(answer, SETTLE_STEP_MS)
    // 🔴 只有真读到非空正文才推进 prev：一次 STALL 会返回空串，
    //    若也参与比较就会「空 == 空」被判成收敛，把半截答案当成定稿落盘
    if (cur.length > 0) {
      if (cur === prev) return cur
      prev = cur
      last = cur
    }
    const left = deadline - Date.now()
    if (left <= 0) break
    await bounded(page.waitForTimeout(Math.min(500, left)), 1_000)
  }
  return last
}
