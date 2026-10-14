import request from '@/config/axios'

/**
 * 提示词模板**用例**（S7 / L5）
 *
 * 与后端 {@code AgentPromptTemplateCaseRespVO / AgentPromptTemplateCaseSaveReqVO} 一一对应。
 *
 * 模板是带 {{占位符}} 的骨架；用例是把某条模板**填好之后的完整正文**，点一下直接进输入框、
 * 可以直接发。它的价值不在「多一条模板」，而在**示范填法**：用户看到一条填得具体的用例，
 * 就知道自己那条该怎么写。
 *
 * 🔴 与模板同款，用例也**不进系统提示词**：它只是「插入到输入框的一段文本」，走普通用户消息通道，
 *    不绕过安全网关、不影响工具选择、不能覆盖 Agent 的 persona。所以这里没有 riskLevel 那类字段。
 *
 * 🔴 {@link AgentPromptTemplateCaseVO.expectHint} / {@link AgentPromptTemplateCaseVO.expectIntent}
 *    是给**机器验收**用的，不是给模型看的，也不该出现在聊天面板上。
 *    把「合格答案该长什么样」喂给模型，等于把考卷和答案一起发下去。
 *
 * 🔴 这里刻意**不**复制一份占位符正则：复用 `@/api/agent/promptTemplate` 的 {@code placeholdersOf}。
 *    两处各写一个正则的结果是「管理页说有 3 个、插进输入框只高亮 2 个」。
 */

export interface AgentPromptTemplateCaseVO {
  id: number
  /**
   * 所属模板编号。
   * 🔴 后端**没有**回传 templateName —— 两个消费端（管理页子表、聊天面板示例页签）手里都已经有
   *    模板列表，就地查一次即可。多一个冗余字段就多一处漂移的机会：模板改了名，
   *    用例上的名字还是旧的，表现为「示例挂在一个不存在的模板下面」。
   */
  templateId: number
  /** 用例标题，列表里显示的那一行字 */
  title: string
  /** 用例正文 —— 点一下**原样**插进聊天输入框的那段话 */
  content: string
  /** 期望要点：一次合格回答结构上该出现什么。只在管理页展示，不进模型上下文 */
  expectHint?: string
  /**
   * 期望分型：'CHAT' | 'BUILD' | null。
   * 🔴 null 是**有意义的第三态**（两种分型都算对），不是「忘了填」。
   *    消费端必须区分 null 与 ''，别用 `|| 'CHAT'` 把两者压成同一个值 ——
   *    压了以后，验收脚本会把一条正压在界线上的用例当成「必须是 CHAT」来断言，
   *    然后得到一个换个模型就随机翻面的红测试。
   */
  expectIntent?: string | null
  /** 排序，小的在前（同一条模板内部） */
  sort?: number
  /** 状态，CommonStatusEnum：0 开启 / 1 关闭。关闭后不出现在聊天面板 */
  status?: number
  createTime?: Date
}

export interface AgentPromptTemplateCasePageReqVO extends PageParam {
  templateId?: number
  title?: string
  content?: string
  expectIntent?: string
  status?: number
}

export interface AgentPromptTemplateCaseSaveVO {
  id?: number
  templateId: number
  title: string
  content: string
  expectHint?: string
  expectIntent?: string | null
  sort?: number
  status?: number
}

/** 期望分型的合法取值。留空表示「两种都算对」，与后端的 normalizeExpectIntent 同口径 */
export const CASE_INTENT_OPTIONS = [
  { label: 'CHAT（问答）', value: 'CHAT' },
  { label: 'BUILD（变更）', value: 'BUILD' }
] as const

export const AgentPromptTemplateCaseApi = {
  /** 用例分页（暂未在页面上使用，留着给「全部用例」这类横向视图） */
  getCasePage: (params: AgentPromptTemplateCasePageReqVO): Promise<PageResult<AgentPromptTemplateCaseVO[]>> =>
    request.get({ url: '/agent/prompt-template-case/page', params }),

  /** 用例详情 */
  getCase: (id: number): Promise<AgentPromptTemplateCaseVO> =>
    request.get({ url: '/agent/prompt-template-case/get', params: { id } }),

  /** 新建用例，返回新 id */
  createCase: (data: AgentPromptTemplateCaseSaveVO): Promise<number> =>
    request.post({ url: '/agent/prompt-template-case/create', data }),

  /** 修改用例 */
  updateCase: (data: AgentPromptTemplateCaseSaveVO): Promise<boolean> =>
    request.put({ url: '/agent/prompt-template-case/update', data }),

  /** 删除用例 */
  deleteCase: (id: number): Promise<boolean> =>
    request.delete({ url: '/agent/prompt-template-case/delete', params: { id } }),

  /**
   * 某条模板下的**全部**用例（管理页子表），含关闭态，不分页
   *
   * 🔴 与 {@link getSimpleCaseList} 的差别是有意的：管理页要能看见并重新打开一条被暂时下架的用例。
   *    用 simple-list 喂子表的话，关闭一条用例它就当场从管理页消失，「删不掉也找不到」。
   */
  getCaseListByTemplate: (templateId: number): Promise<AgentPromptTemplateCaseVO[]> =>
    request.get({ url: '/agent/prompt-template-case/list-by-template', params: { templateId } }),

  /**
   * 聊天面板「示例」页签的数据源：用例自己开启**且它的模板也开启**，不分页
   *
   * 🔴 后半句是这条端点存在的理由。模板被关闭意为「这条提问暂时下架」，此时它的示例若还挂在
   *    聊天面板上，用户照着发出去，走的却是一条管理员刚刚决定不再引导的路 —— 而两边接口都是绿的。
   * 🔴 权限同模板的 simple-list：hasAnyPermissions('agent:assistant:use','agent:prompt-template:query')。
   *    普通聊天用户没有模板管理权限，挂错了就是「按钮看得见、点了 403」。
   */
  getSimpleCaseList: (): Promise<AgentPromptTemplateCaseVO[]> =>
    request.get({ url: '/agent/prompt-template-case/simple-list' })
}
