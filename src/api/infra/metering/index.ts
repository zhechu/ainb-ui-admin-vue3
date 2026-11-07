import request from '@/config/axios'
import { exportExcelWithMeta, type ExportResult } from '@/utils/exportExcel'

/**
 * 计量对账（三合一账单）—— 方案 §1.9 第五步那张页面
 *
 * ## 🔴 这里只有两个「查」，一个「写」都没有
 * 没有 `createBill` / `confirmBill` / `adjustAmount`。账单是每次按流水与快照**重算**出来的
 * （理由写在后端 `MeteringBillService` 的类注释里）：存一份就有两个真相，
 * 而允许「调整金额」等于允许任何人改一份收费依据。
 * 真要改，改的是配额表里的单价，且只影响**之后**写下的流水。
 *
 * ## 🔴 `amount` 为 `null` 与为 `0` 是两件事，全链不得互相兜底
 * `null` = 未定价（没有单价快照，算不出钱），`0` = 明确定价为免费。
 * 把 `null` 显示成 `¥0.00` 的后果是：运维以为自己配好了价、客户以为自己白用了一个月，
 * 两边都拿着一个错数做决定，而没有任何一处报错。
 * 所以下面所有金额字段都是 `number | null`，**不是** `number`。
 */

/** 一个「计量方式 × 单价快照」分组。页面上「查看单价快照」展开的就是它 */
export interface MeteringBillPriceVO {
  /** INTENT 意图 / RELAY 服务端核实 / RECONCILED 已对账；存储那一行为 null */
  meterKind?: string | null
  /**
   * 计量方式的可读名称。🔴 由后端给出，前端**不做**字典映射 ——
   * 三个取值的语义（尤其「RELAY 不需要对账」）写在后端枚举的注释里，
   * 前端再抄一份措辞就会漂移
   */
  meterKindName?: string | null
  /** null = 这一组没有单价（不是 ¥0） */
  pricePerUnit?: number | null
  /** 形如「元 / GB」 */
  priceUnit?: string | null
  /** 单价快照来自哪一行 infra_resource_quota —— 客户问「这个 0.5 哪来的」时唯一能自证的回答 */
  quotaId?: number | null
  /** 本分组**计入金额**的用量（下行流量已对账那组是 actual_bytes 折算的 GB） */
  quantity?: number | null
  rowCount?: number | null
  /** null = 未定价 */
  amount?: number | null
}

/** 账单的一行 —— §1.9 第三步那张计量口径表的一行，不是数据库的一行 */
export interface MeteringBillLineVO {
  resourceType: string
  name: string
  unit: string
  /** 采集点，即这个数出自哪张表。🔴 不是装饰：答案必须是一张具体的表，不能是「系统统计」 */
  source: string
  /** null = 本模块量不到（目前只有 TOKEN 行），需从 source 那一侧自助查询 */
  quantity?: number | null
  /** 出账用量。下行流量以对账后为准，与 quantity 的差就是「暂估的那部分」 */
  billedQuantity?: number | null
  /** 已对账占比 0~1，**按用量加权**不是按行数；null = 本项不参与对账 */
  reconciledRatio?: number | null
  /**
   * 页面上那个 [已对账] / [暂估] 标记。
   * 🔴 `false` 不是错误，是如实：T+1 对账意味着今天的行必然是暂估的。
   * 界面上不能渲染成红色告警（客户会以为账错了），但也**不能不渲染** ——
   * 一个没有标记的暂估数与一个已对账数长得一模一样
   */
  reconciled: boolean
  /**
   * 有没有单价。🔴 `null` 是第三种状态，只出现在 TOKEN 行：**定价不由本模块掌握**。
   * 界面上不要把它渲染成「未定价」——那会让运维去配额表里找一个压根不由这张表决定的价
   */
  priced?: boolean | null
  /** 等效单价（金额 ÷ 出账用量）；一个月内改过 N 次价时它是加权值，真价在 priceSnapshots 里 */
  pricePerUnit?: number | null
  priceSnapshots: MeteringBillPriceVO[]
  /** null = 未定价（不是 ¥0） */
  amount?: number | null
  /** 逐行说明。🔴 用 `pre-wrap` 原样显示，**不得**当 markdown 渲染 */
  note?: string | null
  /** 自助查询路径；null = 无独立入口。TOKEN 行给的是 `/agent/usage/summary` */
  queryPath?: string | null
}

/** 存储量的采样自检。🔴 必须渲染，哪怕一切正常 */
export interface MeteringStorageSelfCheckVO {
  /**
   * false = `infra_storage_snapshot` 里没有这个月的行。
   * 🔴 与「有行但采样天数为 0」不同：前者说明 StorageSnapshotJob 从来没跑过，
   * 后者说明跑了但库里一个文件都没有。两种都表现为「存储费 ¥0」，但只有一种是故障
   */
  exists: boolean
  sampledDays?: number | null
  daysInMonth?: number | null
  lastSampledDate?: string | null
  /** 🔴 不参与计费，只供趋势对比 */
  totalBytes?: number | null
  fileCount?: number | null
  /** GB·月，计费口径就是它 */
  totalGbMonth?: number | null
}

export interface MeteringBillRespVO {
  /** 形如 2026-11 */
  period: string
  /**
   * 🔴 epoch **毫秒**，不是字符串：本仓 `EnlevJacksonAutoConfiguration` 把
   * `LocalDateTime` 一律序列化成时间戳（`TimestampLocalDateTimeSerializer`）。
   * 按 ISO 串去 parse 它会得到一个 `NaN`，而 `NaN` 参与任何比较都是 false —— 不报错，只是显示为空
   */
  periodFrom: number
  /**
   * 🔴 账期终点，**不含**，同样是 epoch 毫秒。
   * 前端要显示「2026-11-01 ~ 2026-11-30」就自己减一天，
   * 但**不要**拿它当过滤条件的上界 —— 直接原样传给后端就是对的
   */
  periodTo: number
  /** 🔴 固定 6 行、顺序固定。一行不会因为「本期没用量」而消失 */
  lines: MeteringBillLineVO[]
  totalAmount?: number | null
  /**
   * 合计是否涵盖全部六项。
   * ⚠️ MVP 阶段**恒为 false**：TOKEN 那一行的数在 `agent_usage_log` 里，
   * 而 infra 不能反向依赖 agent。一个「恒为 false」的标记不是噪音，
   * 它正是「这个合计不是全部」的常驻提醒
   */
  totalComplete: boolean
  /** 算不出金额的那些行及原因。🔴 逐条显示，不能只显示一个「合计不完整」 */
  incompleteLines: string[]
  storage: MeteringStorageSelfCheckVO
  /** 🔴 安全告警，**永远不折进金额** */
  orphanCount?: number | null
  orphanNote?: string | null
  /** 刻意不作为账单行的维度及理由（FILE_COUNT 与 EXPORT） */
  excludedNotes: string[]
  /** null = 按钮可用；非 null = 不可用，且必须把这段理由显示出来 */
  projectAllocationBlockReason?: string | null
  deptAllocationBlockReason?: string | null
}

/** 获得某个账期的三合一账单 */
export const getMeteringBill = (period: string) =>
  request.get<MeteringBillRespVO>({ url: '/infra/metering/bill', params: { period } })

/**
 * 导出对账差异明细
 *
 * 🔴 走 `exportExcelWithMeta` 而不是 `request.download`：那一版拿不到响应头，
 * 于是「这次导出被 20000 条上限截断了」这句话前端永远说不出口，
 * 用户存下一个少半截的明细而界面显示「导出成功」。
 * 行集与账单上「下行流量」那一行**完全相同**，所以导出的明细加起来必然等于页面显示的数 ——
 * 对不上的话，那个页面就没有任何自证能力了。
 *
 * ⚠️ 文件名由前端拼（`buildExportFilename`），不读 `Content-Disposition`：
 * `ExcelUtils.write` 是先写流后设头的，流一写完响应就提交了，那个头再设也发不出去。
 */
export const exportBillDiff = (period: string): Promise<ExportResult> =>
  exportExcelWithMeta('/infra/metering/export-diff', { period })

// ======================================================================================
// 配额与单价 —— 账单金额的**唯一**来源
//
// 🔴 上面那两个「查」是账单，这一段是**定价**。两者分开不是风格问题：
// 账单是重算出来的（一个「写」都没有），而单价是配出来的（写在这里）。
// 没有这一段，`price_snapshot` 永远是空的，账单六行的金额全是 null ——
// 用量照列、钱算不出来，而界面上看不出这是「没配价」还是「算错了」。
// ======================================================================================

/** 一个计费维度（§10.8 那七个之一）。🔴 清单由后端发，前端不硬编码 */
export interface ResourceQuotaDimensionVO {
  resourceType: string
  name: string
  unit?: string | null
  /** true = 存量维度（用量由采样写绝对值），false = 流量维度（累加） */
  stock?: boolean | null
  defaultPeriodType?: string | null
  /**
   * 🔴 本租户该维度有没有 TOTAL 模板行。
   * `false` = 开不出期、也就永远没有单价，账单上那一项的金额必然留空。
   * 界面上必须把 `false` 显示出来（而不是只显示已配的行）——
   * 「七个维度一个都没配过」这件事在界面上不可见，正是这个缺陷能一直活着的原因
   */
  configured: boolean
}

export interface ResourceQuotaRespVO {
  id: number
  resourceType: string
  resourceTypeName?: string | null
  periodType: string
  periodTypeName?: string | null
  periodKey: string
  unit?: string | null
  quotaLimit?: number | null
  /** 🔴 只读。4 位小数的近似累计，**绝不能**拿它当账单上的量 */
  quotaUsed?: number | null
  warnRatio?: number | null
  notifiedAt?: number | null
  /** 🔴 null = 未定价（账单金额留空），0 = 明确免费（账单金额 ¥0.00） */
  pricePerUnit?: number | null
  actionOnExceed?: string | null
  actionName?: string | null
  /** 0 开启 / 1 关闭。🔴 关闭 = 这一项不限量且不出价，不是「不许用」 */
  status?: number | null
  warnReached?: boolean | null
  exceeded?: boolean | null
  /** 🔴 false = 历史账期，那一行的单价与上限是当时出账的依据，只读 */
  editable: boolean
  createTime?: number | null
  updateTime?: number | null
}

export interface ResourceQuotaSaveReqVO {
  /** 为空 = 新建 */
  id?: number | null
  resourceType: string
  periodType: string
  periodKey: string
  /** 留空则按维度默认单位 */
  unit?: string | null
  /** 🔴 0 = 不限量（用量照记、只是不拦），不是「一点不许用」 */
  quotaLimit: number
  warnRatio?: number | null
  /** 🔴 留空 = 未定价，与填 0（明确免费）在账单上长得不一样 */
  pricePerUnit?: number | null
  actionOnExceed?: string | null
  /**
   * 0 开启 / 1 关闭。🔴 这里是 `number` 不是 `number | null`：表单永远显式送一个值，
   * 而 `el-radio-group` 的 modelValue 不收 null（收 null 会编译不过，
   * 更糟的是运行时它会当成「一个也没选中」）
   */
  status: number
}

/** 获得七个计费维度（含「本租户配过没有」） */
export const getQuotaDimensions = () =>
  request.get<ResourceQuotaDimensionVO[]>({ url: '/infra/resource-quota/dimensions' })

/**
 * 获得某个周期里的配额行
 *
 * 🔴 不分页：资源类型只有 7 种、一次只看一个周期，上限就是 7 行。
 * 不传周期时后端兜到 TOTAL（开期模板）那一组
 */
export const getQuotaList = (periodType?: string, periodKey?: string) =>
  request.get<ResourceQuotaRespVO[]>({
    url: '/infra/resource-quota/list',
    params: { periodType, periodKey }
  })

/** 新建一行配额。🔴 这是「账单上能算出金额」的前提 */
export const createQuota = (data: ResourceQuotaSaveReqVO) =>
  request.post<number>({ url: '/infra/resource-quota/create', data })

/** 修改一行配额。🔴 历史账期的行后端会拒收，界面上也应禁用（`editable`） */
export const updateQuota = (data: ResourceQuotaSaveReqVO) =>
  request.put<boolean>({ url: '/infra/resource-quota/update', data })

