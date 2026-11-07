import request from '@/config/axios'

export interface FileClientConfig {
  basePath: string
  host?: string
  port?: number
  username?: string
  password?: string
  mode?: string
  endpoint?: string
  bucket?: string
  accessKey?: string
  accessSecret?: string
  enablePathStyleAccess?: boolean
  enablePublicAccess?: boolean
  region?: string
  domain: string
}

export interface FileConfigVO {
  id: number
  name: string
  storage?: number
  master: boolean
  visible: boolean
  config: FileClientConfig
  remark: string
  createTime: Date
}

/**
 * 主配置的存储能力
 *
 * `notice` 由后端给、前端**逐字渲染**，不要在这里或页面里重写一份文案：
 * 同一句话启动时也会打进日志（后端 `PresignCapabilityRunner`），
 * 两处各写一份的结果是它们迟早不一致，而运维会照着先看到的那一句去处置。
 */
export interface FileConfigCapabilityVO {
  configId?: number | null
  configName?: string | null
  storage?: number | null
  presignCapable: boolean
  notice?: string | null
}

// 查询文件配置列表
export const getFileConfigPage = (params: PageParam) => {
  return request.get({ url: '/infra/file-config/page', params })
}

// 查询文件配置详情
export const getFileConfig = (id: number) => {
  return request.get({ url: '/infra/file-config/get?id=' + id })
}

// 更新文件配置为主配置
export const updateFileConfigMaster = (id: number) => {
  return request.put({ url: '/infra/file-config/update-master?id=' + id })
}

// 新增文件配置
export const createFileConfig = (data: FileConfigVO) => {
  return request.post({ url: '/infra/file-config/create', data })
}

// 修改文件配置
export const updateFileConfig = (data: FileConfigVO) => {
  return request.put({ url: '/infra/file-config/update', data })
}

// 删除文件配置
export const deleteFileConfig = (id: number) => {
  return request.delete({ url: '/infra/file-config/delete?id=' + id })
}

// 批量删除文件配置
export const deleteFileConfigList = (ids: number[]) => {
  return request.delete({ url: '/infra/file-config/delete-list', params: { ids: ids.join(',') } })
}

// 测试文件配置
export const testFileConfig = (id: number) => {
  return request.get({ url: '/infra/file-config/test?id=' + id })
}

// 查询主配置的存储能力：能否预签名直传直下（文件字节不经过后端）
export const getMasterFileConfigCapability = (): Promise<FileConfigCapabilityVO> => {
  return request.get({ url: '/infra/file-config/master-capability' })
}
