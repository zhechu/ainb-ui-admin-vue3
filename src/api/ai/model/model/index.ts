import request from '@/config/axios'

// AI 模型 VO
export interface ModelVO {
  id: number // 编号
  keyId: number // API 秘钥编号
  name: string // 模型名字
  model: string // 模型标识
  platform: string // 模型平台
  type: number // 模型类型
  sort: number // 排序
  status: number // 状态
  temperature?: number // 温度参数
  maxTokens?: number // 单条回复的最大 Token 数量
  maxContexts?: number // 上下文的最大 Message 数量
}

// AI 模型可用性测试 VO
export interface ModelTestVO {
  success: boolean // 是否调通
  timedOut: boolean // 是否因超时结束（与「厂商报错」区分开）
  durationMs?: number // 耗时，单位：毫秒
  platform?: string // 实际发给厂商的平台
  model?: string // 实际发给厂商的模型标识
  multiModel?: boolean | null // 路由到多模态还是文本端点；非通义平台为 null
  enableThinking?: boolean | null // 实际发给厂商的思考模式开关；非通义平台为 null
  modelStatus?: number // 模型当前启用状态（事实回显，测已禁用模型时尤其重要）
  keyStatus?: number // 密钥当前启用状态（事实回显）
  reply?: string // 成功时的回复片段
  promptTokens?: number // 输入 token 用量
  completionTokens?: number // 输出 token 用量
  errorMsg?: string // 失败时的厂商原文，逐字带回
  // 失败分型：QUOTA-额度类（不切换候选，冷却 30 分钟）/ CONFIG-配置类（切换候选，冷却 30 分钟）
  //          / TRANSIENT-瞬时类（切换候选，冷却 60 秒）。成功或本地拦截（如硬超时）时为空
  failureReason?: string
}

// AI 模型 API
export const ModelApi = {
  // 查询模型分页
  getModelPage: async (params: any) => {
    return await request.get({ url: `/ai/model/page`, params })
  },

  // 获得模型列表
  getModelSimpleList: async (type?: number) => {
    return await request.get({
      url: `/ai/model/simple-list`,
      params: {
        type
      }
    })
  },

  // 查询模型详情
  getModel: async (id: number) => {
    return await request.get({ url: `/ai/model/get?id=` + id })
  },

  // 新增模型
  createModel: async (data: ModelVO) => {
    return await request.post({ url: `/ai/model/create`, data })
  },

  // 修改模型
  updateModel: async (data: ModelVO) => {
    return await request.put({ url: `/ai/model/update`, data })
  },

  /**
   * 启用 / 停用模型（只改 status 一个字段）
   *
   * 🔴 不复用 `updateModel`：后端 `AiModelSaveReqVO` 的**每个字段都是必填**，走 /update 就得把整行
   * 重新提交一遍 —— 在故障风暴里逐个停用模型时，那是五遍完整表单（2026-10-10 那串连续的
   * update_time 就是这么来的）。
   * 🔴 副作用（确认弹窗里的文案据此写）：停用后所有 AI 调用的候选链立即少一个；
   * 而**已经钉住该模型**的任务不会切换，是直接报「任务钉住的模型不可用」。
   * ⚠️ 反过来，启用/停用会刷新 `update_time`，而后端的失败冷却记忆是按 `update_time` 做配置指纹的 ——
   * 所以点一下「启用」顺带清掉了这个模型的失败冷却，立刻重新纳入候选，不必等 30 分钟。
   */
  updateStatus: async (id: number, status: number) => {
    return await request.put({ url: `/ai/model/update-status`, data: { id, status } })
  },

  // 删除模型
  deleteModel: async (id: number) => {
    return await request.delete({ url: `/ai/model/delete?id=` + id })
  },

  // 测试模型是否可用
  // ⚠️ 会真实消耗厂商 token；只测这一个模型，绝不切换到别的候选
  testModel: async (id: number, timeoutSeconds = 30) => {
    return await request.post<ModelTestVO>({
      url: `/ai/model/test`,
      params: { id, timeoutSeconds },
      // 必须按请求放宽：全局 request_timeout 是 30000，与后端默认 30 秒硬超时正好撞车，
      // 那样前端会先超时、拿不到后端的结构化结论（success/errorMsg/multiModel 一个都看不到）。
      // axios 封装把 timeout 透传进 config，所以按请求覆盖是可行的。这里给 10 秒余量
      timeout: timeoutSeconds * 1000 + 10000
    })
  }
}
