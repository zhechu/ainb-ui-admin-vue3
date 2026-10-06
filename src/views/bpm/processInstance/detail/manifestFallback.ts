import type { ChangeManifestVO } from '@/api/agent/workflow'

/**
 * BPM 审批详情页读 `agent_change_manifest` 流程变量的**全部**判定策略（缺陷 C10 / 存量清单 #107 的反面）
 *
 * ## 为什么单独抽一个模块
 * 这块逻辑原先内联在 `index.vue` 的一个 computed 里，于是它**没有任何强制点**：
 * 前端单测收的是 `src` 下的 `*.spec.ts`，而 `.vue` 的 setup 体不在其中。
 * 一份「读不出来就沉默」的兜底，恰恰是最需要被钉住的东西 ——
 * 与后端 `SummarySpacingTest` 那条「约束要落在会红的地方」是同一个道理。
 * 抽出来之后它是纯函数，`manifestFallback.spec.ts` 能直接喂各种坏载荷。
 *
 * ## 🔴 这个模块只有一种情况返回 null
 * `raw` 压根没有值 —— 即「这条流程不是 agent 流程」或「作者关掉了 injectManifest」。
 * 这两种情况下页签不出现是**对的**：平台从没答应过要给一份清单。
 *
 * `raw` 有值却读不出来时**一律**返回一份降级清单，不再返回 null。理由见 `parseFailedManifest`。
 */

/**
 * 只说载荷**是什么形状**，不说它**是什么内容** —— 理由见 {@link parseFailedManifest}
 *
 * 🔴 长度那半截**整段**按分支拼，不要只换 `size` 的值：两个分支的留白需求不同
 *    （`3` 是 ASCII，两侧要空格；`不可读` 是中文，两侧都不能有）。
 *    原先写成 `长度 ${size}` + `size = '不可读'`，产出「长度 不可读」—— 两个中文词之间多一格。
 *    这不是审美问题：留白规则的全部意义是让「多一格」在界面上显眼，
 *    一旦中文之间也允许空格，接缝上的洞就再也看不出来了。
 */
export const describeOpaquePayload = (raw: unknown): string => {
  const type = raw === null ? 'null' : typeof raw
  const size = typeof raw === 'string' ? `长度 ${raw.length} 字符` : '长度不可读'
  return `类型 ${type}，${size}`
}

/**
 * 这份对象看起来是不是一份清单
 *
 * 🔴 只查 `headline` 一个键，刻意不做完整形状校验：这里要挡的不是「字段不全」，
 *    而是「一个空对象或不相干的对象被当成清单渲染」—— 那种情况下 `ChangeManifestCard`
 *    会因为 `statChips` 为空且 `degraded` 不为真，印出「本次不产生任何写操作」那句**安心话**。
 *    那比页签消失更坏：页签消失至少是沉默，安心话是撒谎。
 *    `headline` 是真清单与降级清单**都必有**的那一格（后端 `finish` 与 `degraded` 都会设它，
 *    且 `buildHeadline` 的两个分支都返回非空串），故它是判「是不是清单」最省的一个键；
 *    其余字段缺了顶多少显示一块，不会说谎。
 *
 * ⚠️ 它同时统一了三条本来要分开判的退化形态：`JSON.parse('null')` 得到 null、
 *    `JSON.parse('123')` 得到数字、`JSON.parse('[1,2]')` 得到数组 ——
 *    三者在 `typeof x === 'object'` 上并不一致（数组与 null 都是 'object'），但在这里都判否。
 */
export const looksLikeManifest = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { headline?: unknown }).headline === 'string'

/**
 * `raw` 有值、但浏览器读不出来时，就地造一份**前端自己降级**的清单
 *
 * 🔴 为什么必须造一份而不是返回 null：返回 null ⟹ 页签的 `v-if="agentManifest"` 判假 ⟹
 *    「变更清单」页签**整个消失**，而页签消失在这块界面上的既有含义是「这条流程不改什么」。
 *    于是「平台给了、我读不出来」被渲染成「没有变更」—— 审批人正在盲批一个不可逆动作，
 *    界面给他的却是一片安静。这与后端 `ChangeManifest.degraded(reason)` 是同一条纪律：
 *    「没算出来」和「不改什么」在界面上必须是两句话。
 *
 * 🔴 而且 null 毁掉的是**两处**渲染，第二处更坏：`index.vue` 把同一个 computed 既喂给页签、
 *    又经 `:agent-manifest` 传给 `ProcessInstanceOperationButton`，后者在「通过」弹层里
 *    用 `v-if="agentManifest"` 挂了一张 compact 版清单卡。null ⟹ **点「通过」时弹层里
 *    连一行提示都没有**，审批人是在完全无信息的情况下按下那个按钮的。
 *    返回降级清单后，这两处都会出现，并明说「读不出来」。
 *
 * 🔴 与后端那份降级清单**刻意不共用文案**，因为两者的修复方向不同：
 *    后端那份说「平台没算出来」（要去查 DSL 与抽取器），
 *    这份说「平台给了、浏览器读不出来」（要去查 BPM 流程变量的序列化）。
 *    抄同一句话会让排查的人先去看错的那一侧。
 *
 * 🔴 `reason` 里**只报类型与长度，绝不回显 `raw` 的内容**：读不出来的载荷可能是被截断的任意字节，
 *    其中可能夹带个人信息，而审批详情页对所有有权查看这条流程的人可见 —— 回显等于再暴露一次。
 *    同理，这份清单**不引用 `raw` 的任何内容**（只取 `typeof` 与 `length`），
 *    故它自己不会再抛第二次异常：调用方那个 computed 不会因为兜底而把整个详情页搞挂。
 */
export const parseFailedManifest = (raw: unknown): ChangeManifestVO => ({
  // 后端 ChangeManifest.VERSION 当前是 1。这个键前端零消费者，填上只为形状完整
  manifestVersion: 1,
  degraded: true,
  headline: '变更清单读不出来：本次审批看不到将要发生的变更',
  // 刻意 HIGH 而不是 IRREVERSIBLE：后者是一句此刻不知道真伪的断言，与后端 degraded() 同理
  riskLevel: 'HIGH',
  riskDescription: '风险未知',
  riskNote:
    '平台给了这份流程的变更清单，但浏览器没能把它读出来。这不代表本次没有影响——' +
    '请在看不清影响面的情况下谨慎决定，或让流程负责人修复后重新发起。',
  changes: [],
  approvals: [],
  waits: [],
  unresolved: [
    {
      nodeName: '整条流程',
      type: 'MANIFEST_FAILED',
      reason:
        `流程变量 agent_change_manifest 里存的不是合法的变更清单（${describeOpaquePayload(raw)}）。` +
        '它本该在发起审批时由平台冻结进去；请联系流程负责人检查这条流程的清单注入，修复后重新发起。'
    }
  ],
  untrustedInputs: [],
  // 🔴 16 个计数**逐个填 0**，不用 `as` 绕过类型：它们确实是「一个都没数出来」，
  //    与后端 `private ManifestStats stats = new ManifestStats()` 的字段初值同一形状。
  //    渲染侧不会把全 0 读成「确认过、没有写操作」：`statChips` 只推非零值 ⟹ 一个徽标都不显示，
  //    而顶部那句安心话由 `v-if="!statChips.length && !manifest.degraded"` 挡住，
  //    `degraded: true` 时它压根不出现。
  //    ⚠️ 是 16 个不是 15 个（`index.vue` 里那段注释原先写 15，与 `ManifestStatsVO` 自己的注释对不上）。
  stats: {
    tables: 0,
    alteredTables: 0,
    registeredTables: 0,
    forms: 0,
    updatedForms: 0,
    menus: 0,
    permissions: 0,
    processes: 0,
    dataWrites: 0,
    dataInterfaces: 0,
    genericTools: 0,
    irreversibleCount: 0,
    writeToolCount: 0,
    readToolCount: 0,
    dryRunRejected: 0,
    dryRunNotProbed: 0
  }
  // ⚠️ 刻意**不设** `workflow`：载荷没读出来，流程叫什么名字平台无从知晓。
  //    回填一个空对象会让 `workflowLabel` 走 `w.name || w.code || '未命名流程'` + `version == null → '草稿'`，
  //    渲染成「未命名流程（草稿）」—— 那是替一条我们读不出来的流程编了一个「它是草稿」的断言。
  //    留空 ⟹ `workflowLabel` 返回空串、那行不印任何字。
  //    （⚠️ 不是「那一行整条消失」：包着它的 `<div>` 没有 `v-if`，仍会渲染出一小段空白。）
})

/**
 * 读 `agent_change_manifest` 这个流程变量，返回「能渲染的清单」或 null（= 页签不出现）
 *
 * 🔴 冻结再读回来可能是对象、也可能是 JSON 字符串（取决于 BPM 的变量序列化），两种都接。
 * ⚠️ 退化路径有**三条**，别只补 `catch` 那一条：
 * <ol>
 *   <li>`JSON.parse` 抛异常（载荷被截断、或压根不是 JSON）</li>
 *   <li>解析成功但不是对象（`"null"` / `"123"` / `"\"abc\""` 都是合法 JSON）</li>
 *   <li>解析出来是个对象、却不是清单（空对象、数组）</li>
 * </ol>
 * 三条在界面上是同一件事，故统一走 {@link looksLikeManifest} 判定。
 * ③ 尤其阴：它原先被当成好清单放行，最终印出的是那句**安心话**。
 *
 * 🔴 `JSON.parse` 必须留在 try 里：这块渲染不出来顶多少一块信息，
 *    绝不能因为一个变量把整个审批详情页搞挂。
 */
export const readAgentManifest = (raw: unknown): ChangeManifestVO | null => {
  if (!raw) return null
  if (typeof raw === 'object') {
    return looksLikeManifest(raw) ? (raw as ChangeManifestVO) : parseFailedManifest(raw)
  }
  try {
    const parsed = JSON.parse(raw as string)
    return looksLikeManifest(parsed) ? (parsed as ChangeManifestVO) : parseFailedManifest(raw)
  } catch {
    return parseFailedManifest(raw)
  }
}
