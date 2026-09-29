import request from '@/config/axios'

/**
 * 提示词模板（需求7）
 *
 * 与后端 {@code AgentPromptTemplateRespVO / AgentPromptTemplateSaveReqVO} 一一对应。
 *
 * 🔴 模板**不是**系统提示词：它只是「点一下插入到聊天输入框的一段文本」，走普通用户消息通道，
 *    不绕过安全网关、不影响工具选择、不能覆盖 Agent 的 persona。所以这里没有 riskLevel/permissions
 *    这类安全声明字段。
 *
 * 🔴 没有 variables 字段：占位符是 content 的派生信息，由前端按 {{...}} 正则现算（见 placeholderOf）。
 *    后端刻意不存这一列——存了就会与正文分叉，表现为「提示要填 3 个、正文里只有 2 个」。
 */

export interface AgentPromptTemplateVO {
  id: number
  /** 模板名称 */
  name: string
  /** 模板正文，支持 {{占位符}} */
  content: string
  /** 分类，空=未分类 */
  category?: string
  /** 用途说明，只在管理页与悬浮提示出现，不进模型上下文 */
  description?: string
  /** 排序，小的在前 */
  sort?: number
  /** 状态，CommonStatusEnum：0 开启 / 1 关闭。关闭后不出现在聊天面板 */
  status?: number
  createTime?: Date
}

export interface AgentPromptTemplatePageReqVO extends PageParam {
  name?: string
  content?: string
  category?: string
  status?: number
}

export interface AgentPromptTemplateSaveVO {
  id?: number
  name: string
  content: string
  category?: string
  description?: string
  sort?: number
  status?: number
}

/**
 * 从模板正文里抽出 {{占位符}}，去重保序
 *
 * 🔴 前后都要现算这一份，别各自写一个正则：管理页用它渲染标签、聊天面板用它提醒用户「还有几处要替换」，
 *    两处口径不一致就会「管理页说有 3 个、插进输入框只高亮 2 个」。
 * 🔴 非贪婪 + 排除花括号：`{{a}}{{b}}` 要拆成两个而不是一个 `a}}{{b`。
 */
export const placeholdersOf = (content?: string): string[] => {
  if (!content) return []
  const found = content.match(/{{\s*[^{}]+?\s*}}/g) ?? []
  return [...new Set(found.map((raw) => raw.slice(2, -2).trim()).filter(Boolean))]
}

/** 分类为空时统一显示成「未分类」，避免前端各处出现空白标签 */
export const UNCATEGORIZED = '未分类'

export const AgentPromptTemplateApi = {
  /** 模板分页（管理页） */
  getPromptTemplatePage: (
    params: AgentPromptTemplatePageReqVO
  ): Promise<PageResult<AgentPromptTemplateVO[]>> =>
    request.get({ url: '/agent/prompt-template/page', params }),

  /** 模板详情 */
  getPromptTemplate: (id: number): Promise<AgentPromptTemplateVO> =>
    request.get({ url: '/agent/prompt-template/get', params: { id } }),

  /** 新建模板，返回新 id */
  createPromptTemplate: (data: AgentPromptTemplateSaveVO): Promise<number> =>
    request.post({ url: '/agent/prompt-template/create', data }),

  /** 修改模板 */
  updatePromptTemplate: (data: AgentPromptTemplateSaveVO): Promise<boolean> =>
    request.put({ url: '/agent/prompt-template/update', data }),

  /** 删除模板 */
  deletePromptTemplate: (id: number): Promise<boolean> =>
    request.delete({ url: '/agent/prompt-template/delete', params: { id } }),

  /**
   * 开启中的模板列表（聊天面板的模板下拉数据源），不分页
   *
   * 🔴 权限是 hasAnyPermissions('agent:assistant:use','agent:prompt-template:query')，
   *    不是管理页那套 agent:prompt-template:*。普通聊天用户没有模板管理权限，
   *    挂错了就是「按钮看得见、点了 403」。
   */
  getSimplePromptTemplateList: (): Promise<AgentPromptTemplateVO[]> =>
    request.get({ url: '/agent/prompt-template/simple-list' }),

  /** 已用过的分类名（管理页筛选与编辑表单下拉） */
  getCategoryList: (): Promise<string[]> =>
    request.get({ url: '/agent/prompt-template/category-list' })
}
