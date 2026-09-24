import request from '@/config/axios'

/**
 * 单据模板
 *
 * 可视化配置的单据编号规则。表单设计的「单据组件」与其它业务模块通过 code 引用它，
 * 保存数据时由后端自动生成单号。
 */
export type BillTemplateVO = {
  id: number
  name: string
  /** 模板编码，表单与其它模块引用它 */
  code: string
  /** 分类，字典 infra_bill_template_category */
  category?: string
  /** 生成方式：1-时间流水 2-随机数 3-UUID */
  genType: number
  prefix?: string
  suffix?: string
  /** 日期格式，NONE 表示不含日期段。时间流水方式使用 */
  dateFormat?: string
  /** 流水位数 1-9 */
  digit?: number
  startNumber?: number
  step?: number
  /** 重置周期：AUTO / NONE / DAY / MONTH / YEAR */
  resetCycle?: string
  /** AUTO 解析后的实际周期，由后端算好下发，前端只做展示 */
  resetCycleActual?: string
  /** 流水是否按前缀分组重置 */
  groupByPrefix?: boolean
  /** 随机位数：16 / 32 */
  randomDigit?: number
  /** 随机类型：1-纯数字 2-字母+数字 */
  randomType?: number
  /** 是否记录取号日志，默认关闭 */
  logEnabled?: boolean
  /** 范例，后端保存时算好，仅供展示 */
  example?: string
  /** 最近一次生成的号码 */
  lastNo?: string
  lastPeriod?: string
  /** 当前流水值。权威值在 Redis，这里是出号后回写的展示值，可能略有滞后 */
  currentNumber?: number
  /** 状态：0-开启 1-停用 */
  status: number
  sort?: number
  remark?: string
  creator?: string
  createTime?: Date
  updater?: string
  updateTime?: Date
}

/** 保存请求。派生字段与统计字段都不回传 —— 后端也不接受前端传它们 */
export type BillTemplateSaveReqVO = Omit<
  BillTemplateVO,
  | 'resetCycleActual'
  | 'example'
  | 'lastNo'
  | 'lastPeriod'
  | 'currentNumber'
  | 'creator'
  | 'createTime'
  | 'updater'
  | 'updateTime'
>

/**
 * 试算请求
 *
 * 只带生成相关的字段：试算发生在用户边配边看的过程中，此时名称与编码往往还没填。
 */
export type BillTemplatePreviewReqVO = {
  genType: number
  prefix?: string
  suffix?: string
  dateFormat?: string
  digit?: number
  startNumber?: number
  step?: number
  randomDigit?: number
  randomType?: number
}

/** 精简信息，供表单设计器等处下拉选择 */
export type BillTemplateSimpleVO = {
  id: number
  name: string
  code: string
  category?: string
  example?: string
}

/**
 * 取号日志
 *
 * genType / period / seq 是取号当时的规则快照，模板配置日后被改仍可还原现场
 */
export type BillTemplateLogVO = {
  id: number
  templateId: number
  templateCode: string
  /** 生成的单据号；取号失败时为空 */
  billNo?: string
  /** 生成方式快照：1-时间流水 2-随机数 3-UUID */
  genType: number
  /** 周期标记快照 */
  period?: string
  /** 本次消耗的流水序号；随机/UUID 为空 */
  seq?: number
  /** 取号来源：1-业务出号 2-表单预占 */
  source: number
  success: boolean
  errorMsg?: string
  userId?: number
  createTime: Date
}

export const getBillTemplatePage = (params: any) => {
  return request.get({ url: '/infra/bill-template/page', params })
}

export const getBillTemplate = (id: number): Promise<BillTemplateVO> => {
  return request.get({ url: '/infra/bill-template/get', params: { id } })
}

export const createBillTemplate = (data: BillTemplateSaveReqVO) => {
  return request.post({ url: '/infra/bill-template/create', data })
}

export const updateBillTemplate = (data: BillTemplateSaveReqVO) => {
  return request.put({ url: '/infra/bill-template/update', data })
}

export const deleteBillTemplate = (id: number) => {
  return request.delete({ url: '/infra/bill-template/delete', params: { id } })
}

export const updateStatus = (id: number, status: number) => {
  return request.put({ url: '/infra/bill-template/update-status', params: { id, status } })
}

/** 获得已启用的模板精简列表 */
export const getSimpleBillTemplateList = (): Promise<BillTemplateSimpleVO[]> => {
  return request.get({ url: '/infra/bill-template/simple-list' })
}

/**
 * 单据模板精简列表的会话级缓存
 *
 * 与 cachedGetSimpleDictTypeList 同理：设计器每次挂载都会拉一次，
 * 而模板属于低频变更的主数据，一个会话内共享同一份即可。
 */
let simpleBillTemplateListPromise: Promise<BillTemplateSimpleVO[]> | null = null
export const cachedGetSimpleBillTemplateList = (): Promise<BillTemplateSimpleVO[]> => {
  if (!simpleBillTemplateListPromise) {
    simpleBillTemplateListPromise = getSimpleBillTemplateList().catch((err) => {
      simpleBillTemplateListPromise = null
      throw err
    })
  }
  return simpleBillTemplateListPromise
}

/**
 * 试算范例，不消耗流水
 *
 * 前端不自己拼号 —— 补零、起始值换算、位数溢出这些细节一旦两边各写一遍就会漂移，
 * 让预览与真实出号走同一段后端代码是唯一可靠的做法。
 */
export const previewBillTemplate = (data: BillTemplatePreviewReqVO): Promise<string> => {
  return request.post({ url: '/infra/bill-template/preview', data })
}

/**
 * 预占一个单号
 *
 * 打开新增表单时调用。对同一用户同一模板幂等，反复调用返回同一个号，不会烧号。
 * 后端没有开放「直接生成」接口 —— 那会让任何能打开控制台的人刷掉流水。
 */
export const occupyBillNo = (code: string): Promise<string> => {
  return request.post({ url: '/infra/bill-template/occupy', params: { code } })
}

/** 获得取号日志分页。仅开启「记录取号日志」的模板会产生日志 */
export const getBillTemplateLogPage = (params: any) => {
  return request.get({ url: '/infra/bill-template/log-page', params })
}

/** 测试取号结果 */
export type BillTemplateTestVO = {
  /** 生成（或试算）的单据号 */
  no: string
  /** 本次使用的流水序号；随机数 / UUID 方式为 null */
  seq?: number
  /** 计数周期段 */
  period?: string
  /** 是否真实取号：true-已消耗流水 false-仅模拟 */
  real: boolean
}

/**
 * 测试取号
 *
 * real=false（默认）为模拟：按「当前流水 + 1」试算下一个号，不消耗流水、不写日志；
 * real=true 与业务出号同路径，会消耗流水，日志来源记为「测试取号」。
 */
export const testBillTemplate = (id: number, real: boolean): Promise<BillTemplateTestVO> => {
  return request.post({ url: '/infra/bill-template/test', params: { id, real } })
}
