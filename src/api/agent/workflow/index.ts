import request from '@/config/axios'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { getAccessToken, getTenantId } from '@/utils/auth'
import { config } from '@/config/axios/config'
import type { WorkflowEventVO } from '@/api/agent/planner'

/**
 * 沙箱/run-stream 事件（与后端 {@code AgentWorkflowExecutionService.WorkflowEvent} 一一对应）。
 * 沙箱试跑与正式运行共用同一套事件模型，故直接复用 planner 导出的 {@code WorkflowEventVO}，
 * 不再另立一份，避免「流里塞一份、别处查一份」的类型漂移。
 */
export type { WorkflowEventVO }

/**
 * Workflow 定义（管理页列表/画布用）
 *
 * 🔴 与后端 {@code AgentWorkflowDefRespVO} 一一对应。列表分页端点会把 dsl 置 null（负载考虑），
 * 只有 {@link AgentWorkflowApi.getDef} 才返回完整 dsl 原文，供只读画布解析渲染。
 */
export interface AgentWorkflowDefVO {
  id: number
  code: string
  name: string
  version: number
  /** DRAFT 草稿 / PUBLISHED 已发布 / DISABLED 已停用 */
  status: string
  /** 是否主版本（增量14b）：同 code 多已发布版本中被指定为当前生效的那一版；执行入口优先选中它 */
  primaryFlag?: boolean
  description?: string
  /**
   * 来源：MANUAL=管理员手动新增 / AUTO=规划器或助手对话由大模型自动生成。
   * 🔴 只读，由服务端按「走的哪个 create 入口」决定，故 SaveVO 里没有它。
   */
  source?: string
  /** DSL JSON 原文；仅 get?id 返回，分页为 null */
  dsl?: string | null
  /** form_event / schedule / chat / webhook / 空（无触发器） */
  triggerType?: string
  triggerKey?: string
  triggerNextFireAt?: Date
  ownerUserId?: number
  createTime?: Date
  updateTime?: Date
  /**
   * 这一行能不能就地编辑（S5-c 起由服务端派生下发，修 G14）
   *
   * 🔴 **不要在前端重写这条判据**（即不要写 `status === 'DRAFT'`）。后端强制点
   *   （`updateDef` / `deleteDef` 抛 `WORKFLOW_DEF_NOT_DRAFT`）与本字段共用
   *   `WorkflowDefStatusEnum.isDraft` 同一个方法；前端再抄一份 `'DRAFT'` 字面量，
   *   等状态机加一档（如 ARCHIVED）就会出现「按钮亮着、点了被拒」——正是 G14 要收敛的那份重复。
   * 🔴 声明成可选是为了**失败朝安全那一侧倒**：拿不到这一格时 `v-if="row.editable"` 自然为假
   *   ⟹ 按「不可编辑」渲染，与后端对 status 为空的处理同方向。
   *   故消费方一律写 `row.editable`（真值判断），**不要**写 `row.editable !== false`。
   */
  editable?: boolean
  /**
   * `editable=false` 时后端给的现成说明；`editable=true` 时为 null。
   * 🔴 直接渲染这一句，不要前端另编文案：状态机加一档时后端会跟着改，前端抄的那句会留在旧状态上。
   */
  editDeniedReason?: string | null
}

export interface AgentWorkflowDefPageReqVO extends PageParam {
  code?: string
  name?: string
  status?: string
  triggerType?: string
  /** MANUAL / AUTO；不传=全部 */
  source?: string
}

/**
 * 新建/修改定义的入参，对应后端 {@code AgentWorkflowDefSaveReqVO}。
 * 🔴 新建时 id 为空、code 必填且可编辑；修改时 id 必填、code 只读（改 code 等于换一条流程，后端不支持）。
 * 后端 update 仅对 DRAFT 生效，非草稿抛 WORKFLOW_DEF_NOT_DRAFT。
 */
export interface AgentWorkflowDefSaveVO {
  id?: number
  code: string
  name: string
  dsl: string
  /** 🔴 没有 remark：description 已承担说明职责，两个近义字段只会让人不知道填哪个（列已从表里删除） */
  description?: string
  /** 🔴 刻意没有 source：来源由服务端按入口写死，允许前端传就等于允许把自动生成的行伪装成手动 */
}

/**
 * 复制时服务端对一格冲突配置的处理结果，对应后端 {@code WorkflowCopyRewriter.Rewrite}（record）。
 *
 * 🔴 **`from === to` 不是「没变化」这么平淡**，它是「刻意没改，但你要知道」：
 *   审批流未复制仍指向源流程的 BPM key、webhook 密钥沿用了源流程、建表名加完后缀不合规所以保留原值……
 *   这些是<b>待办</b>，渲染时必须与「服务端替你改了」分开列，否则用户会把它们当成已完成项划掉。
 * 🔴 `from`/`to` 里**永远不会是密钥**（后端 webhook secret 那一行填的是掩码文案），
 *   故可以放心直接插值渲染；但仍一律用文本插值，不用 v-html。
 */
export interface WorkflowCopyRewriteVO {
  /** 这一格在 DSL 里的位置，如 `nodes[save].config.args.code` */
  path: string
  /** 源值 */
  from: string
  /** 新值；与 from 相同即未改写 */
  to: string
  /** 为什么这么处理。写给「要据此决定发不发布」的人看，故必须整条显示，不能截断成 tooltip */
  reason: string
}

/**
 * 复制定义的入参，对应后端 {@code AgentWorkflowDefCopyReqVO}。
 *
 * 🔴 **刻意没有 `dsl` 字段**：复制的 DSL 只能由后端从源定义读出来再改写。
 *   前端自己拼一份 DSL 传进「复制」就是 G11 的形状 —— 前端不知道 webhook path / 建表名 /
 *   BPM key 会跟源流程抢同一份不可逆的外部资源。
 * 🔴 也不要在这里校验 code 格式：后端正则的 message 已经是给人看的中文，
 *   前端再抄一份 `CODE_PATTERN` 字面量，两处漂移就表现为「前端放过了、后端拒了」。
 */
export interface AgentWorkflowDefCopyVO {
  /** 源定义编号；草稿/已发布/已停用都能作为复制蓝本 */
  id: number
  newCode: string
  newName: string
  /** 留空表示沿用源流程的描述 */
  newDescription?: string
  /**
   * 是否自动改写冲突配置。
   * 🔴 **不传 = 改写**（后端按 `!Boolean.FALSE.equals(...)` 判）。只有「显式关掉」才该关掉：
   *   默认朝「不会撞车」那一边倒。关掉之后照样逐格回显，因为用户主动选择自己处理时
   *   更需要一份完整清单。
   */
  rewriteConflicts?: boolean
}

/**
 * 复制结果，对应后端 {@code AgentWorkflowDefCopyRespVO}。
 *
 * 🔴 `rewritten` 是这一步**唯一**的用户可见信号：复制走 `insertNewVersion`，
 *   全方法**不跑** `validateDsl`（S4b 的发布闸门在发布期，复制在建草稿期）
 *   ⟹ 复制可以产出一份**必然发不出去**的草稿而不报任何错。
 *   故前端必须把清单弹出来，不能只 toast 一句「复制成功」。
 * ⚠️ `rewritten` 为**空数组是正常的**：那表示这份 DSL 里没有任何会撞车的配置（比如一条纯 LLM 问答流程）。
 *   它与「清单不可用」（`manifest === null` 那种情况）**不是一回事**，绝不能渲染成后者的措辞。
 */
export interface AgentWorkflowDefCopyResultVO {
  /** 新草稿的编号 */
  id: number
  code: string
  name: string
  /** 新编码下恒为 1 */
  version: number
  /** 一律 DRAFT，即使源是 PUBLISHED */
  status: string
  rewritten: WorkflowCopyRewriteVO[]
}

/** DSL 校验结果，对应后端 {@code AgentWorkflowDefValidateRespVO} */
export interface AgentWorkflowDefValidateVO {
  /** 无阻断性 error 即通过；通过才可作为可执行流程发布 */
  passed: boolean
  /** 阻断性错误：必须修正 */
  errors: string[]
  /** 警告：不阻断，建议调整 */
  warnings: string[]
  /**
   * 变更清单（S2-f 出口 2）。走**附带版**：清单生成不出来时这里是 null，
   * 但体检结果照常返回 —— 附加面板的 bug 不该把用户真正要的东西一起带走。
   * 🔴 null 必须渲染成「清单不可用」，绝不能渲染成「本次不产生任何写操作」。
   */
  manifest?: ChangeManifestVO | null
}

/** Workflow 执行实例（执行历史用），对应后端 {@code AgentWorkflowExecutionRespVO} */
export interface AgentWorkflowExecutionVO {
  id: number
  workflowDefId: number
  workflowVersion: number
  /**
   * CREATED/RUNNING/INTERRUPTED/SUCCEEDED/FAILED/CANCELLED/COMPENSATING/COMPENSATED/COMPENSATION_FAILED
   *
   * 🔴 `CANCELLED`（迭代七 B3-2 新增）= **用户主动中止**，与 `FAILED` 是两件事：
   * 它不触发补偿、不进失败告警面、也不可 resume。
   * ⚠️ 本轮之前库里**没有**这一档 —— 用户中止被写成 `FAILED` + errorMsg「用户中断」。
   *   故历史数据里仍可能看到「FAILED 但原因是用户中断」的行，那不是新 bug，是存量。
   */
  status: string
  /**
   * 这一行能不能就地「取消」（迭代七 B3-2 起由服务端派生下发）。
   *
   * 🔴 **不要在前端重写这条判据**（即不要写 `['CREATED','RUNNING','INTERRUPTED'].includes(row.status)`）。
   *   后端那份集合只有 `WorkflowExecutionStatusEnum.isCancellable` **一份**，它同时喂 `cancel` 的预检
   *   与 `casToCancelled` 的 SQL `IN`；前端再抄一份，等第 05 轮（B3-4）或 A-Ⅰ 复议改动它时
   *   就会出现「按钮亮着、点了被拒」。与 {@link AgentWorkflowDefVO.editable} 同一条纪律（G14）。
   * 🔴 声明成可选是为了**失败朝安全那一侧倒**：拿不到这一格时 `v-if="row.cancellable"` 自然为假
   *   ⟹ 按「不可取消」渲染，与后端对 `status` 为空的处理同方向。
   *   故消费方一律写 `row.cancellable`（真值判断），**不要**写 `row.cancellable !== false`。
   */
  cancellable?: boolean
  currentNode?: string
  /**
   * 挂起时正在等待的闸口节点 id（迭代六 D1，列 `suspend_node`）。
   *
   * 🔴 与 `currentNode` 不是一回事：后者是「最后一个**跑完了**的节点」，本字段是「被 interruptsBefore
   * 拦下、还没跑的那个」。两者只在挂起节点正好是 START 之后第一个时才相等。
   * 「恢复」确认框必须用本字段，否则会把运维指到一个早已跑完的节点上。
   *
   * 为空 = 非挂起态，或后端挂起时取不到 checkpoint 快照（那一刻意不回落成错值）。
   */
  suspendNode?: string
  /**
   * resume 时会被静默丢弃、**且作者补一条 `variables[]` 声明就能救**的 state 键集
   * （JSON 数组字符串；迭代七 B3-7）。
   *
   * 挂起时算、resume 时重算覆盖。为空/null = 滤网后没有作者能自己修的键，确认框不展示警告
   * （🔴 不等于「一个键都不丢」：引擎内部键照丢，只是作者改不动、也不该拿它吓人）。
   * 非空时确认框列出这些键并给出出路：「可先复制为新草稿、补上 variables[] 声明后再发布」。
   * 🔴 「列里的键都能靠声明救」这条保证在后端过滤那一步（见 `computeDroppedKeys`），前端不复刻判据。
   */
  droppedKeys?: string
  failedAtNode?: string
  userId?: number
  errorMsg?: string
  beginTime?: Date
  endTime?: Date
  durationMs?: number
}

export interface AgentWorkflowExecutionPageReqVO extends PageParam {
  workflowDefId?: number
  status?: string
}

/** 节点级 trace，对应后端 {@code AgentNodeExecutionRespVO} */
export interface AgentNodeExecutionVO {
  id: number
  executionId: number
  nodeId: string
  /**
   * 节点显示名（执行当时的快照，迭代六 D2）。流程后来改了节点名，这里的既有行不回填；
   * 列加上之前的老行为空。
   */
  nodeName?: string
  /**
   * 所属 sub_workflow / iteration / agent_loop 节点的**裸** id；空 = 顶层节点（迭代六 B5-1）。
   * 🔴 不是自引用外键：那三种节点自身不落 trace 行，拿它去 trace 列表里找父行必然找不到。
   * 🔴 嵌套 ≥2 层时只有直接父，祖父链还原不出来。
   */
  parentNodeId?: string
  nodeType: string
  /**
   * tool 节点调用的工具标识（迭代六 D2，抽屉「工具」列的数据来源）。
   * 🔴 为空有**三**种含义，后端分不出来，所以前端不许把它渲染成异常：
   * 不是 tool 节点 / agent_loop 的 act 行（每步现选工具，按构造就没有单一 toolId）/ 老行。
   */
  toolId?: string
  status: string
  attempt: number
  modelId?: number
  totalTokens?: number
  tokenSource?: string
  durationMs?: number
  errorMsg?: string
  beginTime?: Date
  endTime?: Date
}

// ==================== 变更清单（重构 S2 产出 / S3 渲染，Req 3 的落点） ====================

/**
 * 变更清单：「点同意 / 点发布之后，平台将会做什么」
 *
 * 🔴 与后端 {@code ChangeManifest}（{@code framework/agent/core/manifest/}）一一对应。
 * 三条**必须按后端语义渲染、不许前端自己编话**的地方：
 * 1. 整个对象为 `null` → 「清单不可用」，**不是**「本次不产生任何写操作」。
 *    后者是一句会让人放心点同意的假话（契约写在 {@code AgentWorkflowDefServiceImpl#resolveManifestSource}）
 * 2. `dryRun.outcome` 是**三态**：`NOT_PROBED` 要显示成黄色「本次没校验」，
 *    **不是**红色「不通过」—— 那是把「没核实」说成了「核实过且不行」
 * 3. `scope` 为 `null` 表示「没裁剪，这是整条流程」；非 null 时 `hidden*` 五个计数
 *    **一个都不能少显示**（裁剪不许静默，否则审批人拿到的是一份「看起来完整」的残清单）
 */
export interface ChangeManifestVO {
  manifestVersion: number
  /**
   * 🔴 true = 这是一份**降级清单**：平台本该算出「将会做什么」但没算出来
   * （后端 `ChangeManifest.degraded(reason)`，S6 注入 BPM 审批时构建失败的那条路）。
   *
   * 它存在的唯一理由是让渲染层能分辨「扫过了，确实不写」和「压根没扫成」——
   * 这两句话在 `changes: []` 上长得一模一样，而后者意味着审批人正在盲批一个不可逆动作。
   * 所以降级时**必须**咽回「本次不产生任何写操作」那句安心话（见 ChangeManifestCard）。
   */
  degraded?: boolean
  /**
   * ⚠️ **可空**：后端真算出来的清单一定带它，但前端自己造的降级清单不带
   * （见 `views/bpm/processInstance/detail/manifestFallback.ts` 的 `parseFailedManifest`）——
   * 那种情况下载荷压根没解析出来，流程叫什么名字平台无从知晓。
   * 🔴 此时**不要**回填一个空对象：`ChangeManifestCard` 的 `workflowLabel` 走的是
   * `w.name || w.code || '未命名流程'` + `w.version == null ? '草稿' : …`，
   * 一个 `{}` 会被它渲染成「未命名流程（草稿）」——
   * 那是替一条我们读不出来的流程编了一个「它是草稿」的断言。
   * ⚠️ 留空不是「那一行整条消失」：那行 `<div>` 没有 `v-if`，仍会渲染，只是
   *    `workflowLabel` 返回空串 ⟹ **不印任何字**（旁边会留一小段空白）。诚实，但不是零痕迹。
   * 🔴 留空不会炸：`ChangeManifestCard` 是全仓唯一读 `.workflow` 的地方，四处访问
   *    （`workflowLabel` / `triggerNote` / markdown 导出 / 模板里那行）全部走了可选链或 `!w` 早退。
   */
  workflow?: ManifestWorkflowRefVO | null
  scope?: ManifestScopeVO | null
  /** 一句话总述，风险色条旁边就是它 */
  headline: string
  /** NONE / LOW / MEDIUM / HIGH / IRREVERSIBLE */
  riskLevel?: string | null
  /** 风险等级的中文名（如「不可逆」）。⚠️ 给人看的后果在 riskNote，不是这里 */
  riskDescription?: string | null
  /** 一句人话后果，如「含不可逆操作：执行后无法自动回滚（MySQL 的 DDL 没有事务）」 */
  riskNote?: string | null
  changes: ManifestChangeItemVO[]
  approvals: ManifestApprovalVO[]
  /** 外部事件等待点（wait(event)）及其唤醒声明（S6 / 裁定⑬） */
  waits: ManifestWaitVO[]
  /** 说不清的部分（工具不存在、子流程展不开…）。🔴 headline 里那个计数取自这里 */
  unresolved: ManifestUnresolvedVO[]
  /**
   * 可追溯到不可信输入面的数据流。
   * 🔴 **刻意没有** `stats.untrustedInputs` 计数 —— 它恒等于本列表长度，多一个键就多一处会漂的副本。
   * 🔴 裁定⑩：这个条数**不进** headline / riskNote（会稀释「说不清」那个更强的信号，
   *    且条数天然偏多，进了顶部用户很快学会忽略整句话），渲染时在风险色条旁给**独立计数**。
   */
  untrustedInputs: ManifestUntrustedInputVO[]
  stats: ManifestStatsVO
  generatedAt?: string | null
}

export interface ManifestWorkflowRefVO {
  code?: string | null
  name?: string | null
  /** 🔴 null = 未落库的草稿（渲染方据此显示「草稿」而不是「版本 null」） */
  version?: number | null
  triggerType?: string | null
}

/** 裁剪记账：只覆盖 fromNodeId 及之后的动作，被裁掉多少全记在这里 */
export interface ManifestScopeVO {
  fromNodeId?: string | null
  fromNodeName?: string | null
  pruned: boolean
  hiddenChanges: number
  hiddenUnresolved: number
  hiddenApprovals: number
  hiddenReadTools: number
  hiddenUntrusted: number
  hiddenWaits: number
  /** 后端已拼好的人话说明，直接显示，不要前端另编一句 */
  note?: string | null
}

/** 变更项种类（后端 {@code ChangeKind} 的 10 个值） */
export type ManifestChangeKindVO =
  | 'TABLE_CREATE'
  | 'TABLE_ALTER'
  | 'TABLE_REGISTER'
  | 'FORM_CREATE'
  | 'FORM_UPDATE'
  | 'FORM_PUBLISH'
  | 'PROCESS_DEPLOY'
  | 'DATA_WRITE'
  | 'DATA_INTERFACE'
  | 'GENERIC_TOOL'

export interface ManifestChangeItemVO {
  kind: ManifestChangeKindVO
  nodeId?: string | null
  nodeName?: string | null
  /** 工具键（机器名） */
  tool?: string | null
  /** 工具中文展示名（S1 的名称目录）。查不到时后端原样回显工具键 */
  toolDisplayName?: string | null
  reversible: boolean
  riskLevel?: string | null
  riskDescription?: string | null
  /** 一句话人话摘要。🔴 字段名是 summary 不是 title */
  summary?: string | null
  /**
   * 「改了谁」。🔴 键随 kind 变，是开放 map：
   * TABLE_CREATE/ALTER 是 `tableName`、TABLE_REGISTER 是 `tableNames`、
   * FORM_CREATE 是 `code`/`name`/`mainTable`、FORM_PUBLISH/FORM_UPDATE 是 `formId`、
   * PROCESS_DEPLOY 是 `key`/`name`、DATA_WRITE 是 `code`/`operation`/`pk`、DATA_INTERFACE 是 `code`
   */
  target: Record<string, any>
  /** 明细。🔴 键随 kind 变，窄形状见下方 Manifest*DetailVO */
  detail: Record<string, any>
  /** 🔴 后端保证**永不为 null**（三态里至少是 NOT_PROBED） */
  dryRun: ManifestDryRunVO
  conflict?: ManifestConflictVO | null
}

/** TABLE_CREATE 的 detail（实测 {@code DataModelCreateChangeExtractor#extract}） */
export interface ManifestTableDetailVO {
  modelName?: string | null
  columns?: ManifestColumnVO[]
  indexes?: ManifestIndexVO[]
}

export interface ManifestColumnVO {
  columnName?: string | null
  columnComment?: string | null
  columnType?: string | null
  length?: number | null
  /** 🔴 与 length 是一对：只报 length 的话 DECIMAL(10,2) 会显示成「精度 10」，
   *  而金额列的小数位恰恰是审批人最需要确认的那个数字 */
  scale?: number | null
  /** 🔴 后端用 raw 原样透传 ⟹ 可能是 boolean，也可能是字符串 "true"。渲染前必须自己归一 */
  nullable?: unknown
}

export interface ManifestIndexVO {
  indexName?: string | null
  indexType?: string | null
  columnNames?: string[]
}

/** TABLE_ALTER 的 detail */
export interface ManifestTableAlterDetailVO {
  addColumns?: ManifestColumnVO[]
  modifyColumns?: ManifestColumnVO[]
  dropColumns?: ManifestColumnVO[]
}

/** FORM_CREATE 的 detail（实测 {@code FormSaveDraftChangeExtractor#extract}） */
export interface ManifestFormDetailVO {
  fields?: ManifestFormFieldVO[]
  fieldCount?: number
  /** 进查询区的字段标题（后端已挑好，直接展示） */
  searchableFields?: string[]
}

export interface ManifestFormFieldVO {
  field?: string | null
  title?: string | null
  /** 控件机器键 */
  widget?: string | null
  /** 控件中文名。⚠️ 已知缺陷 #49：LLM 造的 DSL 写 PascalCase（`Input`）而契约是 lowerCamel（`input`），
   *  此时后端 getOrDefault 回落成原样，这里会是英文 */
  widgetLabel?: string | null
  jdbcType?: string | null
  /** 🔴 raw 透传，可能是 boolean 也可能是字符串 */
  required?: unknown
  dictType?: string | null
  searchable?: unknown
  operator?: string | null
  /** 匹配方式的中文名（「等于」「包含」…），后端已翻好 */
  operatorLabel?: string | null
}

/** FORM_UPDATE 的 detail */
export interface ManifestFormUpdateDetailVO {
  patchKeys?: string[]
  clearFields?: string[]
  needsRepublish?: unknown
}

/**
 * FORM_PUBLISH 的 detail。
 * 🔴 `menu` 是**联合类型**（实测 {@code ChangeManifestDryRunner#previewMenu} 的字符串分支与对象分支）：
 * - 表单已绑过菜单 → 一句**字符串**说明「本次只出新版本，不新建菜单」
 * - 这次会新建菜单 → 一个 **对象** `{name, path, permissionCount}`
 * 且**只有后者**才有 `permissions`（前者刻意不写，否则 headline 会报一件不会发生的事）。
 */
export interface ManifestPublishDetailVO {
  parentMenuName?: string | null
  parentMenuId?: number | null
  roleIds?: number[]
  /** 后端拼好的角色说明；未指定角色时是「仅超管可见」那类文案 */
  roleNote?: string | null
  formIdPending?: unknown
  menu?: string | { name?: string | null; path?: string | null; permissionCount?: number }
  permissions?: string[]
}

/** GENERIC_TOOL / DATA_INTERFACE 的 detail */
export interface ManifestGenericDetailVO {
  /** 入参预览（已截断：单值 200 字符、最多 20 个键）。占位符保持 DSL 原文，不解析 */
  argsPreview?: Record<string, any>
  /** 兜底路径标记：抽取器违约或未识别工具时为 true */
  incomplete?: unknown
}

export interface ManifestDryRunVO {
  /** 🔴 三态。PASSED=探过且能跑；REJECTED=探过且跑不通（**结论**）；NOT_PROBED=本次没探成（**不是结论**） */
  outcome: 'PASSED' | 'REJECTED' | 'NOT_PROBED'
  /** 三态都必填，渲染层照抄，不自己编话 */
  reason?: string | null
  warnings?: string[]
  /** 只放字符串/数字/布尔/List/Map（清单要能被冻结进 BPM 流程变量再读回来） */
  evidence?: Record<string, any>
}

export interface ManifestConflictVO {
  type: 'TABLE_ALREADY_EXISTS' | 'TABLE_EXISTS_UNREGISTERED' | 'FORM_CODE_TAKEN'
  message?: string | null
}

export interface ManifestApprovalVO {
  nodeId?: string | null
  nodeName?: string | null
  /** hitl.confirm / hitl.bpm_approval */
  type?: string | null
  bpmProcessDefKey?: string | null
  formVarsKeys?: string[]
  /** 该闸口之后会出现哪些变更种类 */
  downstreamKinds?: string[]
  /** 审批人到底看不看得见这份清单（S6 注入流程变量后才有真意义） */
  willSee: boolean
}

/** wait(event) 等待点及其外部唤醒声明（S6 / 裁定⑬） */
export interface ManifestWaitVO {
  nodeId?: string | null
  nodeName?: string | null
  /** 谁来唤醒（负责人/系统名） */
  owner?: string | null
  /** 调哪个端点 */
  endpoint?: string | null
  /** 补充说明 */
  note?: string | null
  /** 是否声明了 externalWakeup；false = 有等待点但没声明，无头流程体检会要求补 */
  declared: boolean
}

export interface ManifestUnresolvedVO {
  nodeId?: string | null
  nodeName?: string | null
  /**
   * 🔴 这四个取值是后端 `ChangeManifest.UnresolvedItem.TYPE_*` 的镜像，两边必须同步改。
   * `MANIFEST_FAILED` 与前三个不同级：前三个说「清单里有一项说不清」，它说「整份清单没成」，
   * 只出现在 `degraded: true` 的降级清单上，且只有一条。
   */
  type: 'TOOL_UNKNOWN' | 'TOOL_MISSING' | 'SUB_WORKFLOW' | 'MANIFEST_FAILED'
  tool?: string | null
  reason?: string | null
}

export interface ManifestUntrustedInputVO {
  /** 后端拼好的一句话，直接显示 */
  summary?: string | null
  /** 🔴 前三种（CHAT/WEBHOOK/FORM_EVENT）是**平台外**的人能直接投喂的，
   *  后两种（RETRIEVAL/TOOL_RESULT）是平台内部产物 —— 标红时按这个分轻重 */
  sourceKind:
    | 'TRIGGER_CHAT'
    | 'TRIGGER_WEBHOOK'
    | 'TRIGGER_FORM_EVENT'
    | 'RETRIEVAL'
    | 'TOOL_RESULT'
  sourceLabel?: string | null
  sourceVar?: string | null
  sinkKind?: string | null
  sinkLabel?: string | null
  sinkNodeId?: string | null
  sinkNodeName?: string | null
  sinkArg?: string | null
  viaVar?: string | null
  viaNodeId?: string | null
  depth: number
}

/** 16 个计数（实测 {@code ChangeManifest.ManifestStats}，全是 int） */
export interface ManifestStatsVO {
  tables: number
  alteredTables: number
  registeredTables: number
  forms: number
  updatedForms: number
  menus: number
  permissions: number
  processes: number
  dataWrites: number
  dataInterfaces: number
  /** 🔴 != 0 就是「有写工具没配专用抽取器」的信号，值得在界面上说出来 */
  genericTools: number
  irreversibleCount: number
  writeToolCount: number
  readToolCount: number
  dryRunRejected: number
  dryRunNotProbed: number
}

/**
 * 名称目录（重构 S1 / L1）：DSL 里的「机器键」→ 给人看的中文名
 *
 * 🔴 与后端 {@code AgentNameCatalogRespVO} 一一对应。
 * 权限是 {@code agent:workflow:query}（「不是」工具清单那个 {@code agent:config:query}）——
 * 这是 G7 的修复点：此前设计器直接调 {@code /agent/config/tool-list}，只有编排权、
 * 没有 AI 配置权的管理员打开设计器会看到一个「空的且无任何提示」的工具下拉。
 */
export interface NameCatalogToolVO {
  /** 工具键，DSL 的 toolId 存的就是它 */
  name: string
  /** 中文展示名（服务端已做三级回落，正常不会是空） */
  displayName: string
  description?: string
  /** 分组名，下拉按它分组；空串表示不分组 */
  groupName: string
  /**
   * 生效风险等级（在线维护后的值）。
   * 🔴 **别拿它预测闸门行为** —— 运行期各道闸读的是 declaredRisk，见下面那组字段。
   */
  risk?: string
  riskDescription?: string
  requireConfirm?: boolean
  /**
   * 代码声明的风险等级 —— 只读校验（V3/V11）、发布判定、agent_loop 只读限制、沙箱 mock、
   * 变更清单读的全是它。降险这个在线维护动作改的是上面那个生效值，改不动这里。
   * 🔴 画色点、写「需人工确认」、过滤「只读可用工具」一律用这三个 declared*，
   *    否则界面会把降过险的工具说成「无需确认」，用户点发布才被拒 —— 界面主动指了反方向。
   * 🔴 自定义工具没有这个分裂（agent_tool_def 那行就是它的声明），两份恒等、riskOverridden 恒 false。
   */
  declaredRisk?: string
  declaredRiskDescription?: string
  declaredRequireConfirm?: boolean
  /** 生效风险 ≠ 声明风险，即风险标注被在线维护改过（只改展示名/分组的不算） */
  riskOverridden?: boolean
  enabled?: boolean
  overridden?: boolean
  /** BUILTIN=代码内置工具，其余取自 agent_tool_def.source */
  source?: string
}

export interface NameCatalogVO {
  tools: NameCatalogToolVO[]
  /** 控件 type → 中文名 */
  widgetLabels: Record<string, string>
  operators: { operator: string; label: string }[]
  /** 已发布流程 code → 中文名（sub_workflow 节点展示用） */
  workflows: { code: string; name: string }[]
}

export const AgentWorkflowApi = {
  /**
   * 名称目录（只读；设计器/只读画布/聊天草稿卡/执行历史共用的「机器键 → 中文名」映射）
   *
   * 🔴 大模型与知识库「不在」这份目录里：agent 在 ai 模块的 api 层没有列模型/列知识库的出口，
   * 而这两处前端本来就直接调 ai 的 simple-list、且显示的一直是名字。见后端 VO 类注释。
   */
  getNameCatalog: (): Promise<NameCatalogVO> =>
    request.get({ url: '/agent/workflow-def/name-catalog' }),

  /** 定义分页（列表不带 dsl 正文） */
  getDefPage: (params: AgentWorkflowDefPageReqVO) =>
    request.get({ url: '/agent/workflow-def/page', params }),

  /** 定义详情（含完整 dsl，供只读画布） */
  getDef: (id: number): Promise<AgentWorkflowDefVO> =>
    request.get({ url: '/agent/workflow-def/get', params: { id } }),

  /** 新建定义（落 DRAFT 草稿），返回新定义 id */
  createDef: (data: AgentWorkflowDefSaveVO): Promise<number> =>
    request.post({ url: '/agent/workflow-def/create', data }),

  /**
   * 复制定义：读源 DSL → 服务端改写冲突项 → 落成**新编码下的**新草稿（S5-b/S5-d）。
   *
   * 🔴 权限归 `agent:workflow:create`（产物是一个新 DRAFT，与「新建流程」同类写动作，后端不新设权限点）。
   * 🔴 复制**不等于**发布：产物恒为 DRAFT，要生效仍需走 {@link AgentWorkflowApi.publishDef}。
   * 🔴 与 {@link AgentWorkflowApi.rollback} 的区别：回滚是**同 code 下**追加一个新版本（版本快照语义），
   *   复制是**另起一个 code**（两条独立流程）。用户面对不可编辑流程时，两者都是出路，但语义不同。
   */
  copyDef: (data: AgentWorkflowDefCopyVO): Promise<AgentWorkflowDefCopyResultVO> =>
    request.post({ url: '/agent/workflow-def/copy', data }),

  /** 修改定义（仅 DRAFT 可改；后端 update 对非草稿抛 WORKFLOW_DEF_NOT_DRAFT） */
  updateDef: (data: AgentWorkflowDefSaveVO): Promise<boolean> =>
    request.put({ url: '/agent/workflow-def/update', data }),

  /** 删除定义（仅 DRAFT 可删） */
  deleteDef: (id: number): Promise<boolean> =>
    request.delete({ url: '/agent/workflow-def/delete', params: { id } }),

  /**
   * 校验 DSL（保存/发布前预检，只读不落库）。
   * 双层校验：基础结构（收集式，一次列全）+ 基础通过后的编译器深层干跑。
   * 返回结构化 {passed,errors,warnings}，JSON 本身不合法也算一条 error（不抛 HTTP 异常）。
   *
   * 🔴 `id` 是**可选的身份**，只用来取「这条流程名下真跑过几次」，据此给**已落地的撞车**降一档
   *    （台账 #81：一条早已上线的建表流程，今天再探一次必然得到「表名已被占用」—— 占用的正是它自己
   *    建的那张表；不降档它就永远无法重新发布，回滚出来的草稿也发不出去）。
   * 🔴 **与 `getManifest` 的 `id` 语义不同，别照搬那边的二选一规则**：这里 `dsl` 永远是被打分的对象，
   *    `id` 只是身份，两者**同时传才是发布预检的正常用法**（传手上这一版的 dsl + 它所在行的 id）。
   *    只传 dsl 则永远拿不到执行史，降档在 UI 上压根触发不了；只传 id 则体检的是库里那一版，
   *    不是用户正要发布的那一版。
   * ⚠️ 未保存的草稿没有 id，传 `undefined` 即可（后端按「没跑过」算 = 一档都不降，fail-close）。
   */
  validateDsl: (dsl: string, id?: number): Promise<AgentWorkflowDefValidateVO> =>
    request.post({ url: '/agent/workflow-def/validate', data: { dsl, id } }),

  /**
   * 变更清单（S2-f 出口 1）：发布/审批前的影响面预览。只读不落库，但**含 infra/bpm 只读干跑**
   * （`previewDdl` / `inspectFormDesign` / `getPhysicalTableList` / `previewPublishMenu`），故比普通查询慢。
   *
   * 🔴 `dsl` 与 `id` **二选一**：两个都给、或两个都不给，后端一律报 `1_041_006_019`，
   *    **不会替你挑一个**。理由：清单是给人做同意/拒绝决定用的，「我传的是手上的草稿，
   *    看到的却是库里那一版的影响面」比报错坏得多 —— 他会据一份不是自己那份的清单点同意。
   * 🔴 `fromNodeId` 只接受**真实节点 id**（通常是 `hitl.*` 节点）。
   *    **不许传 `"START"` / `"END"`**：今天传 `START` 会「碰巧」返回全流程（走的是
   *    「找不到该节点 → fail-safe 不裁剪」那条兜底，理由是错的），而 S4a 会把它改成显式报错
   *    （裁定⑭）。要看整条流程就**别传这个参数**（此时 `scope` 为 null）。
   * 🔴 走**严格版**：生成不出来会报错，不会返回 `200 + null`。
   *    这个端点的产品就是清单本身，兜成 null 会与「这流程不改任何东西」在界面上变成同一句话。
   */
  getManifest: (data: {
    dsl?: string
    id?: number
    fromNodeId?: string
  }): Promise<ChangeManifestVO> => request.post({ url: '/agent/workflow-def/manifest', data }),

  /** 发布：DRAFT → PUBLISHED（按 id 精确发布该版本，幂等）。后端 @RequestParam id，走 params */
  publishDef: (id: number): Promise<number> =>
    request.post({ url: '/agent/workflow-def/publish', params: { id } }),

  /** 停用：PUBLISHED → DISABLED（幂等） */
  disableDef: (id: number): Promise<boolean> =>
    request.post({ url: '/agent/workflow-def/disable', params: { id } }),

  /** 执行历史分页（管理端，本租户全量） */
  getExecutionPage: (params: AgentWorkflowExecutionPageReqVO) =>
    request.get({ url: '/agent/workflow/execution/page', params }),

  /** 执行实例详情 */
  getExecution: (id: number): Promise<AgentWorkflowExecutionVO> =>
    request.get({ url: '/agent/workflow/execution/get', params: { id } }),

  /** 节点级 trace 列表 */
  getNodeTrace: (executionId: number): Promise<AgentNodeExecutionVO[]> =>
    request.get({ url: '/agent/workflow/node-trace/list', params: { executionId } }),

  /**
   * 中止一条执行：落终态 `CANCELLED`（迭代七 B3-2）。权限 `agent:workflow:cancel`（单开一档，不并进 run）。
   *
   * 🔴 **这不是「停止线程」**：后端停不下正在跑的那个节点（图跑在 boundedElastic 上、内部 blockLast()，
   *   那个 Disposable 没被留下）。取消是**记账语义** —— 把行判成 CANCELLED，并挡住那条流晚到的收尾
   *   （SQL 条件 `status<>'CANCELLED'`）。**已经发出去的外部副作用收不回来**（token 已扣、库已写、审批已发）。
   * 🔴 **不触发补偿**：补偿是「失败后反做」，用户主动中止不是失败；触发补偿等于把用户想停的东西再跑一遍。
   * 🔴 可取消的只有 CREATED / RUNNING / INTERRUPTED 三档。其余六档后端一律抛
   *   `WORKFLOW_EXECUTION_STATE_INVALID`，消息里带**当时真实**的状态 —— 故失败时**直接显示后端那句 msg**，
   *   不要前端另编文案（编出来的那句会与库里真实状态对不上，而这两档的处置完全不同：
   *   「它已经跑完了」vs「它正在回滚、不许打断」）。
   * ⚠️ `CANCELLED` **不可恢复**（裁定 A-Ⅰ：本轮刻意不做「取消转可恢复」）。要重跑得从头 run 一次。
   */
  cancelExecution: (executionId: number): Promise<boolean> =>
    request.post({ url: '/agent/workflow/cancel', params: { executionId } }),

  /**
   * 版本管理（增量14b）：某 code 的全部版本（version 倒序，不含 dsl 正文）。
   * 对比时前端另调 {@link AgentWorkflowApi.getDef} 按 id 取两份完整 DSL。
   */
  getVersionList: (code: string): Promise<AgentWorkflowDefVO[]> =>
    request.get({ url: '/agent/workflow-def/version-list', params: { code } }),

  /**
   * 回滚到某历史版本：基于其 DSL 复制成一个新草稿（绝不改历史快照），返回新草稿 id。
   * 产物是 DRAFT，需再走 publishDef 才生效（与「新建流程」同类写动作，权限 agent:workflow:create）。
   */
  rollback: (id: number): Promise<number> =>
    request.post({ url: '/agent/workflow-def/rollback', params: { id } }),

  /**
   * 把某已发布版本设为主版本：执行入口优先选中它（灰度回退），权限 agent:workflow:publish。
   * 同 code 至多一个主版本（后端先清后置）；目标须 PUBLISHED。
   */
  setPrimary: (id: number): Promise<boolean> =>
    request.post({ url: '/agent/workflow-def/set-primary', params: { id } }),

  /**
   * 沙箱试跑「当前草稿 DSL」（流式），走 {@code POST /agent/workflow-def/sandbox-stream}。
   *
   * 🔴 与 {@link AgentPlannerApi.runWorkflowStream} 的差异：那个按 code 跑<b>已发布</b>流程，
   * 这个把<b>设计器里尚未保存/发布的草稿 DSL 原文</b>直传后端试跑——作者改完立刻验证，不必先落库。
   * 后端纪律（见 {@code AgentWorkflowSandboxServiceImpl}）：LLM 与只读工具<b>真跑</b>，
   * 写/不可逆工具被 <b>mock</b>（返回 {@code __sandboxMock} 占位，无真实副作用）；
   * 不落执行实例、不写节点 trace、不计配额；命中人工确认/等待节点即停（v1 不支持沙箱内 resume）。
   *
   * 同样用 fetchEventSource（能带 Authorization 头、能 POST body），权限 {@code agent:workflow:run}
   * —— 因为真调大模型会消耗 token，属副作用面。
   */
  runSandboxStream: (
    dsl: string,
    input: Record<string, any>,
    ctrl: AbortController,
    onMessage: (event: any) => void,
    onError: (err: any) => void,
    onClose: () => void
  ) => {
    return fetchEventSource(`${config.base_url}/agent/workflow-def/sandbox-stream`, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAccessToken()}`,
        'tenant-id': `${getTenantId()}`
      },
      // 沙箱真跑 LLM 可能十几秒，用户切走再回来不该发现连接断了
      openWhenHidden: true,
      body: JSON.stringify({ dsl, input, mockWrites: true }),
      onmessage: onMessage,
      onerror: onError,
      onclose: onClose,
      signal: ctrl.signal
    })
  },

  /**
   * 恢复一条<b>挂起中</b>的执行（流式），走 {@code POST /agent/workflow/resume-stream}。
   *
   * <p>🔴 与 {@link AgentAssistantApi.resumeWorkflowStream} 刻意<b>不通用</b>、不要合并：
   * 那个是<b>会话内</b>的恢复（要 {@code conversationId}、回推的是聊天事件
   * PLANNING/MESSAGE/WORKFLOW_CONFIRM/DONE/ERROR），这个是<b>执行管理</b>的恢复
   * （只认 {@code executionId}、回推 {@code WorkflowEvent}：META/NODE/INTERRUPTED/DONE/ERROR）。
   * 执行历史抽屉里没有会话可挂，只能走这一条；两条流的事件词表不同，合并会让某一侧的
   * switch 静默走 default（正是「配置生效了但界面没反应」那一类）。
   *
   * <p>权限 {@code agent:workflow:run}（副作用面：恢复之后续跑的节点会<b>真执行</b>写操作）。
   *
   * @param executionId 挂起的执行实例编号
   * @param feedback    人工反馈，后端 {@code resume()} 经 updateState 写进 checkpoint 再从断点续跑。
   *                    🔴 键名<b>必须</b>按挂起节点的类型给，见调用处
   *                    {@code ExecutionHistoryDrawer.resumeFeedback} 的注释（只给 hitl_approved
   *                    会让 bpm 审批节点读到 null、把「通过」判成「驳回」还报 SUCCEEDED）。
   */
  resumeStream: (
    executionId: number,
    feedback: Record<string, any>,
    ctrl: AbortController,
    onMessage: (event: any) => void,
    onError: (err: any) => void,
    onClose: () => void
  ) => {
    return fetchEventSource(`${config.base_url}/agent/workflow/resume-stream`, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAccessToken()}`,
        'tenant-id': `${getTenantId()}`
      },
      // 续跑可能十几秒（后面还挂着 LLM 节点），用户切走再回来不该发现连接断了
      openWhenHidden: true,
      body: JSON.stringify({ executionId, feedback }),
      onmessage: onMessage,
      onerror: onError,
      onclose: onClose,
      signal: ctrl.signal
    })
  }
}
