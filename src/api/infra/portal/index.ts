import request from '@/config/axios'

export type PortalItem = {
  id: string
  type: string
  x: number
  y: number
  w: number
  h: number
  props: Record<string, any>
}

export type PortalConfig = {
  schemaVersion: number
  columns: number
  rowHeight: number
  gap: number
  background?: string
  items: PortalItem[]
}

export type PortalVO = {
  id: number
  name: string
  code: string
  description?: string
  status: number
  content: string
  publishedVersion: number
  isDefault: boolean
  enabled: boolean
  schemaVersion: number
  creator?: string
  createTime?: Date
  updater?: string
  updateTime?: Date
}

export type PortalSaveReqVO = {
  id?: number
  name: string
  code: string
  description?: string
  content: string
  isDefault?: boolean
  enabled?: boolean
}

export type PortalVersionVO = {
  id: number
  portalId: number
  version: number
  content: string
  schemaVersion: number
  publishRemark?: string
  creator?: string
  createTime?: Date
}

export type PortalRuntimeVO = {
  id: number
  name: string
  code: string
  version: number
  content: string
  schemaVersion: number
}

export const createPortal = (data: PortalSaveReqVO) => {
  return request.post({ url: '/infra/portal/create', data })
}

export const updatePortal = (data: PortalSaveReqVO) => {
  return request.put({ url: '/infra/portal/update', data })
}

export const deletePortal = (id: number) => {
  return request.delete({ url: '/infra/portal/delete', params: { id } })
}

export const copyPortal = (id: number) => {
  return request.post({ url: '/infra/portal/copy', params: { id } })
}

export const getPortal = (id: number): Promise<PortalVO> => {
  return request.get({ url: '/infra/portal/get', params: { id } })
}

export const getPortalPage = (params: Record<string, any>) => {
  return request.get({ url: '/infra/portal/page', params })
}

export const checkPortalCode = (code: string, id?: number): Promise<boolean> => {
  return request.get({ url: '/infra/portal/check-code', params: { code, id } })
}

export const publishPortal = (data: { id: number; publishRemark?: string }) => {
  return request.post({ url: '/infra/portal/publish', data })
}

export const unpublishPortal = (id: number) => {
  return request.post({ url: '/infra/portal/unpublish', params: { id } })
}

export const getPortalVersionList = (portalId: number): Promise<PortalVersionVO[]> => {
  return request.get({ url: '/infra/portal/version-list', params: { portalId } })
}

export const getPortalVersion = (portalId: number, version: number): Promise<PortalVersionVO> => {
  return request.get({ url: '/infra/portal/get-version', params: { portalId, version } })
}

export const rollbackPortal = (portalId: number, version: number) => {
  return request.post({ url: '/infra/portal/rollback', params: { portalId, version } })
}

export const previewPortal = (id: number): Promise<PortalRuntimeVO> => {
  return request.get({ url: '/infra/portal/preview', params: { id } })
}

export const getHomePortal = (): Promise<PortalRuntimeVO | null> => {
  return request.get({ url: '/infra/portal/runtime/home' })
}

export const getRuntimePortal = (code: string): Promise<PortalRuntimeVO | null> => {
  return request.get({ url: `/infra/portal/runtime/${code}` })
}

export const invokePortalData = (code: string, args: Record<string, any> = {}) => {
  return request.post({ url: '/infra/portal/runtime/data', params: { code }, data: args })
}

export const getPortalTaskSummary = () => {
  return request.get({ url: '/bpm/portal/summary' })
}

export const getPortalTasks = (view: 'todo' | 'doing', pageSize: number) => {
  return request.get({ url: '/bpm/portal/tasks', params: { view, pageSize } })
}

export const getPortalNotices = (count: number) => {
  return request.get({ url: '/system/portal/notices', params: { count } })
}
