import request from '@/config/axios'

/**
 * 用户自定义工具目录（AI助手 问题2：工具独立管理页）
 *
 * 🔴 与后端 {@code AgentToolDefRespVO / AgentToolDefSaveReqVO} 一一对应。这里管的是「无 Java 代码」的
 * 自定义工具（本期仅 HTTP 可执行），与 22 个只读代码工具（走 /agent/config/tool-list）是两套东西。
 *
 * 🔴 凭据脱敏：get/page 返回的 config 里 bearerToken/basicPassword/apiKeyValue 已被后端替换成掩码
 * `******`（HttpToolConfig.REDACTED_MASK）。编辑时不要把这些掩码原样回存——表单会把等于掩码的凭据清空、
 * 提示「已配置（留空则不修改）」，提交时省略该键，由后端 updateToolDef 回填旧值。
 */

/** HTTP 工具 config 的结构化形状（序列化成 AgentToolDefVO.config 字符串） */
export interface HttpToolConfigVO {
  method?: string
  url?: string
  headers?: Record<string, string>
  query?: Record<string, string>
  bodyTemplate?: string
  timeoutMs?: number
  authType?: string
  /** BEARER */
  bearerToken?: string
  /** BASIC */
  basicUsername?: string
  basicPassword?: string
  /** API_KEY */
  apiKeyHeader?: string
  apiKeyValue?: string
}

export interface AgentToolDefVO {
  id: number
  /** 工具键，租户内唯一，workflow tool 节点按此引用；不得与代码工具重名 */
  toolKey: string
  displayName: string
  description?: string
  /** 来源，本期仅 HTTP 可执行 */
  source: string
  groupName?: string
  /** 风险等级 READ_ONLY/LOW/MEDIUM/HIGH/IRREVERSIBLE */
  riskLevel: string
  /** 调用所需权限串，逗号分隔（AND 语义）；留空=登录即可调用 */
  permissions?: string
  enabled?: boolean
  /** HTTP 定义 JSON（读接口里凭据已脱敏成 ******） */
  config: string
  /** 参数说明（自由文本，进 prompt） */
  paramsSchema?: string
  remark?: string
  createTime?: Date
}

export interface AgentToolDefPageReqVO extends PageParam {
  toolKey?: string
  source?: string
  groupName?: string
  enabled?: boolean
}

/**
 * 新建/修改工具的入参，对应后端 {@code AgentToolDefSaveReqVO}。
 * 🔴 新建时 id 为空、toolKey 必填且可编辑；修改时 id 必填、toolKey 只读（改键等于换一个工具，后端按唯一性拦）。
 */
export interface AgentToolDefSaveVO {
  id?: number
  toolKey: string
  displayName: string
  description?: string
  source: string
  groupName?: string
  riskLevel: string
  permissions?: string
  enabled?: boolean
  config: string
  paramsSchema?: string
  remark?: string
}

export const AgentToolDefApi = {
  /** 工具分页（config 里凭据已脱敏） */
  getToolDefPage: (params: AgentToolDefPageReqVO): Promise<PageResult<AgentToolDefVO[]>> =>
    request.get({ url: '/agent/tool-def/page', params }),

  /** 工具详情（config 里凭据已脱敏，供编辑/查看） */
  getToolDef: (id: number): Promise<AgentToolDefVO> =>
    request.get({ url: '/agent/tool-def/get', params: { id } }),

  /** 新建工具，返回新工具 id */
  createToolDef: (data: AgentToolDefSaveVO): Promise<number> =>
    request.post({ url: '/agent/tool-def/create', data }),

  /** 修改工具（凭据留空/为掩码时后端回填旧值） */
  updateToolDef: (data: AgentToolDefSaveVO): Promise<boolean> =>
    request.put({ url: '/agent/tool-def/update', data }),

  /** 删除工具 */
  deleteToolDef: (id: number): Promise<boolean> =>
    request.delete({ url: '/agent/tool-def/delete', params: { id } })
}

/**
 * 内置（已注册）工具在线维护（2026-09-28 增量）
 *
 * 🔴 与后端 {@code AgentRegisteredToolRespVO / AgentRegisteredToolUpdateReqVO} 一一对应。
 * 22 个 @AgentTool 代码工具的执行体与默认值仍在代码里，不可新建/删除；但「运维旋钮」
 * （展示名/说明/分组/风险/权限/启用/参数说明）可在线维护，改完【立即生效、无需重启】。
 * 覆盖按【当前租户】生效。「恢复默认」= 删覆盖行、退回代码声明。
 */
export interface AgentRegisteredToolVO {
  /** 工具名（= @AgentTool name / 注册表键），不可改 */
  toolName: string
  // ---------- 生效值（当前维护后的值） ----------
  displayName: string
  description?: string
  groupName?: string
  riskLevel: string
  riskDescription?: string
  permissions?: string
  enabled: boolean
  requireConfirm?: boolean
  paramsSchema?: string
  /** 是否正被在线维护（生效值≠声明值） */
  overridden?: boolean
  // ---------- 声明值（代码默认，供回显「正在覆盖什么」） ----------
  declaredDescription?: string
  declaredGroupName?: string
  declaredRiskLevel?: string
  declaredPermissions?: string
  declaredEnabled?: boolean
  declaredParamsSchema?: string
  /** 实现类全名 */
  implClassName?: string
  // ---------- 覆盖行元数据（未维护时为 null） ----------
  overrideId?: number
  overrideUpdateTime?: Date
  overrideUpdater?: string
  /** 覆盖行备注（未维护=空） */
  remark?: string
}

/**
 * 内置工具维护入参（整份提交），对应后端 {@code AgentRegisteredToolUpdateReqVO}。
 * 🔴 各字段空值含义：displayName 留空=用工具名；riskLevel 留空=不覆盖（沿用代码声明）；
 * permissions 留空=调用只需登录（删空代码权限）；enabled 必填。
 */
export interface AgentRegisteredToolUpdateVO {
  toolName: string
  displayName?: string
  description?: string
  groupName?: string
  riskLevel?: string
  permissions?: string
  enabled: boolean
  paramsSchema?: string
  remark?: string
}

export const AgentRegisteredToolApi = {
  /** 内置工具列表（合并生效值 + 代码默认值），不分页 */
  getRegisteredToolList: (): Promise<AgentRegisteredToolVO[]> =>
    request.get({ url: '/agent/tool-def/registered-list' }),

  /** 维护内置工具（整份提交覆盖，改完立即生效） */
  updateRegisteredTool: (data: AgentRegisteredToolUpdateVO): Promise<boolean> =>
    request.put({ url: '/agent/tool-def/registered-update', data }),

  /** 恢复内置工具默认（删覆盖行） */
  resetRegisteredTool: (toolName: string): Promise<boolean> =>
    request.delete({ url: '/agent/tool-def/registered-reset', params: { toolName } })
}
