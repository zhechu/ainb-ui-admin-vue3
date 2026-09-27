import request from '@/config/axios'

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
  /** DSL JSON 原文；仅 get?id 返回，分页为 null */
  dsl?: string | null
  remark?: string
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
  description?: string
  remark?: string
}

/** DSL 校验结果，对应后端 {@code AgentWorkflowDefValidateRespVO} */
export interface AgentWorkflowDefValidateVO {
  /** 无阻断性 error 即通过；通过才可作为可执行流程发布 */
  passed: boolean
  /** 阻断性错误：必须修正 */
  errors: string[]
  /** 警告：不阻断，建议调整 */
  warnings: string[]
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

export const AgentWorkflowApi = {
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
    request.post({ url: '/agent/workflow-def/set-primary', params: { id } })
}
