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
  /** CREATED/RUNNING/INTERRUPTED/SUCCEEDED/FAILED/COMPENSATING/COMPENSATED/COMPENSATION_FAILED */
  status: string
  currentNode?: string
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
  nodeType: string
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
 *    后者是一句会让人放心点同意的假话（契约写在 {@code AgentWorkflowDefServiceImpl:344-346}）
 * 2. `dryRun.outcome` 是**三态**：`NOT_PROBED` 要显示成黄色「本次没校验」，
 *    **不是**红色「不通过」—— 那是把「没核实」说成了「核实过且不行」
 * 3. `scope` 为 `null` 表示「没裁剪，这是整条流程」；非 null 时 `hidden*` 五个计数
 *    **一个都不能少显示**（裁剪不许静默，否则审批人拿到的是一份「看起来完整」的残清单）
 */
export interface ChangeManifestVO {
  manifestVersion: number
  workflow: ManifestWorkflowRefVO
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

/** TABLE_CREATE 的 detail（实测 {@code DataModelCreateChangeExtractor:49-72}） */
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

/** FORM_CREATE 的 detail（实测 {@code FormSaveDraftChangeExtractor:44-77}） */
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
 * 🔴 `menu` 是**联合类型**（实测 {@code ChangeManifestDryRunner:624} 与 {@code :644} 两个分支）：
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

export interface ManifestUnresolvedVO {
  nodeId?: string | null
  nodeName?: string | null
  type: 'TOOL_UNKNOWN' | 'TOOL_MISSING' | 'SUB_WORKFLOW'
  tool?: string | null
  reason?: string | null
}

export interface ManifestUntrustedInputVO {
  /** 后端拼好的一句话，直接显示 */
  summary?: string | null
  /** 🔴 前三种（CHAT/WEBHOOK/FORM_EVENT）是**平台外**的人能直接投喂的，
   *  后两种（RETRIEVAL/TOOL_RESULT）是平台内部产物 —— 标红时按这个分轻重 */
  sourceKind: 'TRIGGER_CHAT' | 'TRIGGER_WEBHOOK' | 'TRIGGER_FORM_EVENT' | 'RETRIEVAL' | 'TOOL_RESULT'
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

/** 16 个计数（实测 {@code ChangeManifest.ManifestStats:412-487}，全是 int） */
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
  risk?: string
  riskDescription?: string
  requireConfirm?: boolean
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
   */
  validateDsl: (dsl: string): Promise<AgentWorkflowDefValidateVO> =>
    request.post({ url: '/agent/workflow-def/validate', data: { dsl } }),

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
  }
}
