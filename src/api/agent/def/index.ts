import request from '@/config/axios'

/**
 * Agent 定义（P5 Agent Builder：智能体目录 + 对话接线）
 *
 * 🔴 与后端 {@code AgentDefRespVO} 一一对应。分页列表端点会把 persona 置 null（负载考虑），
 * 只有 {@link AgentDefApi.getDef} 才返回完整 persona 原文，供编辑/查看。
 *
 * 🔴 分刀：增量10（slice-2）已把 <b>persona（→系统提示词）</b>与 <b>modelId（→问答模型）</b>接入对话流——
 * 聊天入口选中一个已发布 Agent，它的人设与绑定模型即刻生效。增量11（slice-3a）再把 <b>knowledgeId
 * （→专属知识库检索）</b>接入：绑定后聊天从该 KB 检索并注入「参考资料」。增量12（slice-3b）接线
 * <b>toolKeys（→聊天 agentic 只读工具循环）</b>：绑定只读工具后，聊天跑「思考→调工具→观察→再思考」ReAct 循环；
 * slice-3c 接线 <b>trigger.chat（→工作流驱动）</b>：被已发布 chatflow 绑定的 Agent，每条消息改跑工作流（见 workflowDriven）。
 */
export interface AgentDefVO {
  id: number
  code: string
  name: string
  /** 人设=系统提示词原文；仅 get?id 返回，分页为 null */
  persona?: string | null
  /**
   * 绑定的问答模型编号（ai 模块 ai_model.id）；空=用平台动态默认模型（带 failover）。
   * 非空时该 Agent 的每轮问答固定用它（不可用则自动切下一个候选）。
   */
  modelId?: number | null
  /**
   * 绑定的知识库编号（ai 模块 ai_knowledge.id）；空=该 Agent 不做知识库检索（仅凭 persona 作答）。
   * 非空时聊天从该 KB 检索命中片段并注入 prompt（增量11 / slice-3a）。
   */
  knowledgeId?: number | null
  /**
   * 绑定的只读工具键，逗号分隔（如 {@code data_interface_list,datamodel_list}）；空=不启用工具循环。
   * 非空时聊天跑 agentic 只读工具循环（增量12 / slice-3b）。发布期校验每个键都已登记且为只读。
   */
  toolKeys?: string | null
  /**
   * 是否被一条已发布 chatflow 驱动（只读派生字段，后端按 trigger.chat.agentId 反查填充）。
   * true = 该 Agent 的每条聊天消息都跑绑定工作流，而非直连 LLM（增量12 / slice-3c）。仅 PUBLISHED 行可能为 true。
   */
  workflowDriven?: boolean
  description?: string
  version: number
  /** DRAFT 草稿 / PUBLISHED 已发布 / DISABLED 已停用 */
  status: string
  createTime?: Date
  updateTime?: Date
}

export interface AgentDefPageReqVO extends PageParam {
  code?: string
  name?: string
  status?: string
}

/**
 * 新建/修改定义的入参，对应后端 {@code AgentDefSaveReqVO}。
 * 🔴 新建时 id 为空、code 必填且可编辑；修改时 id 必填、code 只读（改 code 等于换一个 Agent，后端不支持）。
 * 后端 update 仅对 DRAFT 生效，非草稿抛 AGENT_DEF_NOT_DRAFT。
 */
export interface AgentDefSaveVO {
  id?: number
  code: string
  name: string
  persona: string
  /** 绑定模型编号；空=动态默认。见 {@link AgentDefVO.modelId} */
  modelId?: number | null
  /** 绑定知识库编号；空=该 Agent 不检索知识库。见 {@link AgentDefVO.knowledgeId} */
  knowledgeId?: number | null
  /** 绑定只读工具键，逗号分隔；空=不启用工具循环。见 {@link AgentDefVO.toolKeys} */
  toolKeys?: string | null
  description?: string
}

export const AgentDefApi = {
  /** 定义分页（列表不带 persona 正文） */
  getDefPage: (params: AgentDefPageReqVO): Promise<PageResult<AgentDefVO[]>> =>
    request.get({ url: '/agent/def/page', params }),

  /** 定义详情（含完整 persona，供编辑/查看） */
  getDef: (id: number): Promise<AgentDefVO> =>
    request.get({ url: '/agent/def/get', params: { id } }),

  /** 新建定义（落 DRAFT 草稿），返回新定义 id */
  createDef: (data: AgentDefSaveVO): Promise<number> =>
    request.post({ url: '/agent/def/create', data }),

  /** 修改定义（仅 DRAFT 可改；后端 update 对非草稿抛 AGENT_DEF_NOT_DRAFT） */
  updateDef: (data: AgentDefSaveVO): Promise<boolean> =>
    request.put({ url: '/agent/def/update', data }),

  /** 删除定义（仅 DRAFT 可删） */
  deleteDef: (id: number): Promise<boolean> =>
    request.delete({ url: '/agent/def/delete', params: { id } }),

  /** 发布：DRAFT → PUBLISHED（按 id 精确发布该版本，幂等）。后端 @RequestParam id，走 params */
  publishDef: (id: number): Promise<number> =>
    request.post({ url: '/agent/def/publish', params: { id } }),

  /** 停用：PUBLISHED → DISABLED（幂等） */
  disableDef: (id: number): Promise<boolean> =>
    request.post({ url: '/agent/def/disable', params: { id } })
}
