import request from '@/config/axios'

/**
 * Agent 定义（P5 Agent Builder 第一刀：智能体目录管理）
 *
 * 🔴 与后端 {@code AgentDefRespVO} 一一对应。分页列表端点会把 persona 置 null（负载考虑），
 * 只有 {@link AgentDefApi.getDef} 才返回完整 persona 原文，供编辑/查看。
 *
 * 🔴 有界：本刀只有目录 CRUD + 发布/停用。人设（persona）尚无运行期消费方——
 * 把它接入对话流（聊天入口按 Agent 路由）与 model/工具/知识/流程绑定是 slice-2。
 */
export interface AgentDefVO {
  id: number
  code: string
  name: string
  /** 人设=系统提示词原文；仅 get?id 返回，分页为 null */
  persona?: string | null
  description?: string
  remark?: string
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
  description?: string
  remark?: string
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
