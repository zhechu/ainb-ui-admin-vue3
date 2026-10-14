import request from '@/config/axios'

// AI API 密钥 VO
export interface ApiKeyVO {
  id: number // 编号
  name: string // 名称
  apiKey: string // 密钥
  platform: string // 平台
  url: string // 自定义 API 地址
  status: number // 状态
}

// AI API 密钥 API
export const ApiKeyApi = {
  // 查询 API 密钥分页
  getApiKeyPage: async (params: any) => {
    return await request.get({ url: `/ai/api-key/page`, params })
  },

  // 获得 API 密钥列表
  getApiKeySimpleList: async () => {
    return await request.get({ url: `/ai/api-key/simple-list` })
  },

  // 查询 API 密钥详情
  getApiKey: async (id: number) => {
    return await request.get({ url: `/ai/api-key/get?id=` + id })
  },

  // 新增 API 密钥
  createApiKey: async (data: ApiKeyVO) => {
    return await request.post({ url: `/ai/api-key/create`, data })
  },

  // 修改 API 密钥
  updateApiKey: async (data: ApiKeyVO) => {
    return await request.put({ url: `/ai/api-key/update`, data })
  },

  /**
   * 启用 / 停用 API 密钥（只改 status 一个字段）
   *
   * 🔴 绝不能把整行回传 `updateApiKey`：后端 `AiApiKeyRespVO.apiKey` 带 `@SliderDesensitize`，
   * 列表页拿到的是**打码串**（`sk-abc***wxyz`），整行回传会把掩码当成真密钥加密落库 ——
   * 静默毁掉每一个密钥，而且不报任何错。这不是理论风险，是那条路的必然结果。
   * 🔴 副作用（确认弹窗里的文案据此写）：密钥一停用，挂在它下面的模型全部在候选链**选择期**就被剔除。
   * ⚠️ 停用会刷新 `update_time`，而后端的失败冷却记忆按 `update_time` 做配置指纹 ——
   * 所以重新启用顺带清掉了这些模型的失败冷却，立刻重新纳入候选，不必等 30 分钟。
   */
  updateStatus: async (id: number, status: number) => {
    return await request.put({ url: `/ai/api-key/update-status`, data: { id, status } })
  },

  // 删除 API 密钥
  deleteApiKey: async (id: number) => {
    return await request.delete({ url: `/ai/api-key/delete?id=` + id })
  }
}
