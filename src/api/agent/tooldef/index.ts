import request from '@/config/axios'

/**
 * 用户自定义工具目录（AI助手 问题2：工具独立管理页）
 *
 * 🔴 与后端 {@code AgentToolDefRespVO / AgentToolDefSaveReqVO} 一一对应。这里管的是「无 Java 代码」的
 * 自定义工具：本质是**数据接口的 AI 包装层**——把某个已治理好的数据接口钉死成一把工具，
 * 让模型不必自己挑接口编码。地址/SQL/鉴权/租户注入全在 infra 的数据接口那边，故 config 里**没有凭据**。
 * 代码工具（走 /agent/config/tool-list）是另一套东西。
 *
 * 🔴 可执行的 source 只有 DATA_INTERFACE；FORM/SCRIPT 是预留位，登记与执行都会被后端拒。
 */

/** 自定义工具 config 的结构化形状（序列化成 AgentToolDefVO.config 字符串） */
export interface DataInterfaceToolConfigVO {
  /** 绑定的数据接口编码，必须是目录里已启用的接口 */
  code?: string
  /** QUERY=只读查询；INVOKE=全能力执行（含写，权限里必须带 infra:data-interface:invoke） */
  mode?: 'QUERY' | 'INVOKE'
}

export interface AgentToolDefVO {
  id: number
  /** 工具键，租户内唯一，workflow tool 节点按此引用；不得与代码工具重名 */
  toolKey: string
  displayName: string
  description?: string
  /** 来源，当前仅 DATA_INTERFACE 可执行 */
  source: string
  groupName?: string
  /** 风险等级 READ_ONLY/LOW/MEDIUM/HIGH/IRREVERSIBLE */
  riskLevel: string
  /** 调用所需权限串，逗号分隔（AND 语义）；留空=登录即可调用 */
  permissions?: string
  enabled?: boolean
  /** 数据接口绑定 JSON：{code,mode}，无凭据故读接口不脱敏 */
  config: string
  /** 参数说明（自由文本，进 prompt）；留空时后端按接口入参定义自动生成 */
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

/** 可被工具关联的数据接口目录项，对应后端 infra 的 {@code DataInterfaceSimpleRespDTO} */
export interface DataInterfaceSimpleVO {
  code: string
  name?: string
  category?: string
  /** 1-SQL 2-静态JSON 3-HTTP转发 */
  type?: number
  typeName?: string
  /** 🔴 权威的「是否含写操作」，来自 infra service 分析脚本，不是表单上填的 */
  writeOperation?: boolean
  hasPage?: boolean
  remark?: string
  params?: DataInterfaceParamVO[]
}

/** 数据接口的入参定义（用于自动生成 paramsSchema、给管理员看要传什么） */
export interface DataInterfaceParamVO {
  name: string
  label?: string
  /** STRING/INT/LONG/DECIMAL/BOOLEAN/DATE/DATETIME */
  type?: string
  required?: boolean
  defaultValue?: string
  remark?: string
}

export const AgentToolDefApi = {
  /** 工具分页 */
  getToolDefPage: (params: AgentToolDefPageReqVO): Promise<PageResult<AgentToolDefVO[]>> =>
    request.get({ url: '/agent/tool-def/page', params }),

  /** 工具详情，供编辑/查看 */
  getToolDef: (id: number): Promise<AgentToolDefVO> =>
    request.get({ url: '/agent/tool-def/get', params: { id } }),

  /** 新建工具，返回新工具 id */
  createToolDef: (data: AgentToolDefSaveVO): Promise<number> =>
    request.post({ url: '/agent/tool-def/create', data }),

  /** 修改工具 */
  updateToolDef: (data: AgentToolDefSaveVO): Promise<boolean> =>
    request.put({ url: '/agent/tool-def/update', data }),

  /** 删除工具 */
  deleteToolDef: (id: number): Promise<boolean> =>
    request.delete({ url: '/agent/tool-def/delete', params: { id } }),

  /**
   * 可关联的数据接口目录（新增/编辑面板的下拉选项）
   *
   * 🔴 走 agent 自己的 agent:tool-def:query，而不是直接调 infra 的列表接口：
   *    后者要 infra:data-interface:query，配工具的管理员未必有，会出现「工具页打得开、下拉空白且无提示」。
   * 只返回**启用中**的接口（最多 50 条），故下拉里没有 = 接口不存在或已停用。
   */
  getBindableInterfaceList: (keyword?: string): Promise<DataInterfaceSimpleVO[]> =>
    request.get({ url: '/agent/tool-def/data-interface-list', params: { keyword } })
}

/**
 * 内置（已注册）工具在线维护（2026-09-28 增量）
 *
 * 🔴 与后端 {@code AgentRegisteredToolRespVO / AgentRegisteredToolUpdateReqVO} 一一对应。
 * @AgentTool 代码工具的执行体与默认值仍在代码里，不可新建/删除；但「运维旋钮」
 * （展示名/说明/分组/风险/权限/启用/参数说明）可在线维护，改完【立即生效、无需重启】。
 * 覆盖按【当前租户】生效。「恢复默认」= 删覆盖行、退回代码声明。
 *
 * 🔴 但「立即生效」这句话对这几个旋钮的**分量完全不同**，别一视同仁（2026-10-05 实测口径，台账 D4-22）：
 * - **enabled / permissions**：真生效。{@code AgentSecurityGateway#checkTool} 读的就是覆盖后的
 *   {@code isEnabled()} 与 {@code getPermissions()}，改完 AI 的调用当场被放行/拦下。
 * - **风险（riskLevel）**：只改**界面上的标注**。迭代三之后运行期各道闸（V3/V11 只读校验、Planner
 *   工具目录分桶、agent_loop 只读限制、沙箱 mock 判定、发布判定、变更清单）读的**全是
 *   {@code getDeclaredRisk()}（代码声明值）**，一行覆盖数据改不动它们。所以「把不可逆工具降为只读」
 *   **不会**让它绕过发布判定或沙箱 mock，真发生的只是设计器与工具清单从此把它标成「无需确认」，
 *   而校验仍按声明值拒它 —— 界面与校验会就此**互相矛盾**。
 * - 展示名/说明/分组/参数说明：纯展示与 prompt 文案，无安全含义。
 *
 * 放松（降风险 / 删权限）要走二次确认 + 落 {@code agent_tool_override_audit} 审计行，见
 * {@link AgentRegisteredToolUpdateVO.confirmRelax}。
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
  declaredDisplayName?: string
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
  /**
   * 二次确认：本次维护**放松了安全约束**（风险调低 / 权限删少）时必须传 true。
   *
   * 🔴 不传或传 false 而本次确实是放松，后端直接拒（错误码 1_041_009_001），
   *    且【覆盖行与审计行都不落库】——判定在 upsert 之前，所以「被拒的放松」不会留下
   *    一行记录着「一次并未发生的放松」的审计（那种审计比没有审计更难查）。
   *
   * 🔴 为什么后端也要判、不能只靠这个确认框：确认框是给人看的，curl / 别的控制台 / 批量脚本
   *    绕得过它。真正的闸门在后端，前端这一层只负责把代价先讲清楚再让人点头。
   *
   * 🔴 这不是「禁止放松」的后门。产品决策（迭代四 §11 A-Ⅲ）是「保留 + 审计 + 二次确认」：
   *    放松仍然允许，只是要求操作人表态、并在 {@code agent_tool_override_audit} 留一行。
   */
  confirmRelax?: boolean
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
