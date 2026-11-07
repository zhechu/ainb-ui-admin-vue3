import request from '@/config/axios'
import { exportExcelWithMeta } from '@/utils/exportExcel'

/**
 * 委托方（I1）
 *
 * 与后端 {@code QlzgClientController / QlzgClientSaveReqVO / QlzgClientRespVO} 一一对应。
 *
 * 🔴 **身份证号与联系电话是列级加密存储的**，两件事由此推出，都不是「后端还没做」：
 *    ① 读回来的一律是**脱敏形态**（`330106**********34` / `138****8000`），
 *       而且**没有任何接口能取到明文** —— 前端不要画「点击查看完整号码」，画了也没有东西可调。
 *    ② 分页**不支持**按这两列筛选。加密后同一明文每次的密文可能不同，模糊匹配永远查空
 *       且**不报错**，用户会以为「这个人不在库里」。所以搜索表单里不要放这两个框。
 *
 * 🔴 也**没有 simple-list**：委托方是高频主数据，一个机构几万个，
 *    项目表单上选委托方要走 `/page` + `clientName` 模糊搜索，不要一次性拉全量。
 */

/** 委托方（读形态）—— idCardNo / contactMobile 是脱敏值 */
export interface QlzgClientVO {
  id: number
  /** 委托方名称 */
  clientName: string
  /** 委托方类型，见 QlzgClientTypeEnum：PERSON / ENTERPRISE / GOVERNMENT / COURT */
  clientType: string
  /** 统一社会信用代码（企业类型） */
  unifiedSocialCreditCode?: string
  /** 🔴 身份证号，**脱敏返回** */
  idCardNo?: string
  /** 联系人姓名 */
  contactName?: string
  /** 🔴 联系电话，**脱敏返回** */
  contactMobile?: string
  /** 联系地址 */
  address?: string
  /** 是否同为报告使用人 */
  isReportUser?: boolean
  remark?: string
  /**
   * 机构自定义扩展字段的值（I29），键 = {@code qlzg_field_def.field_key}
   *
   * 🔴 由后端按字段定义裁过一遍：只含本机构的字段，不含 {@code ext_json} 里的孤儿键，
   *    但**含**停用的与「出现位置 = 详情」的（详情页要显示）。
   * 🔴 「一个值都没存过」读出来是 **{@code {}}，不是 {@code null}**，
   *    所以 {@code data.ext ?? null} 拿到的是 {@code {}}。
   *    完整口径见 {@code QlzgProjectVO.ext}。
   */
  ext?: Record<string, any> | null
  createTime?: Date
}

export interface QlzgClientPageReqVO extends PageParam {
  /** 委托方名称，模糊匹配 */
  clientName?: string
  /** 委托方类型，精确匹配 */
  clientType?: string
  /** 统一社会信用代码，精确匹配 */
  unifiedSocialCreditCode?: string
  /** 联系人姓名，模糊匹配 */
  contactName?: string
  isReportUser?: boolean
  /** 创建时间区间，后端按 yyyy-MM-dd HH:mm:ss 解析 */
  createTime?: string[]
}

/**
 * 委托方（写形态）
 *
 * 🔴 `idCardNo` 与 `contactMobile` 是**三态**字段，键在不在 JSON 里是有意义的：
 *    - **不传该键** = 不修改（保留库里原值）
 *    - **传空串 `''`** = 明确清空
 *    - **传非空值** = 覆盖
 *
 *    所以编辑表单的正确形状是：输入框留空 + placeholder 显示脱敏值 = 不动；
 *    用户主动清空并保存 = 需要显式发 `''`。
 *    ⚠️ 用 `undefined` 会被 axios/JSON 直接丢掉键（等于「不修改」），
 *    想清空必须发 `''`，不能发 `undefined` 也不能发 `null`。
 */
export interface QlzgClientSaveVO {
  /** 编号，修改时必填 */
  id?: number
  clientName: string
  clientType: string
  unifiedSocialCreditCode?: string
  idCardNo?: string
  contactName?: string
  contactMobile?: string
  address?: string
  isReportUser?: boolean
  remark?: string
  /**
   * 机构自定义扩展字段的值（I29）
   *
   * 🔴 三态：**不传键 / {@code null} = 不修改**，非空对象 = **整列覆盖**。
   *    与身份证号那两项的约定是同一条纪律（键在不在 JSON 里说了算）。
   *    ⚠️ 删掉某一项的值靠 {@code compactExt} 把空值键摘掉后整包发上去，
   *    **不是**发 {@code {fieldKey: null}}（那会被 {@code EXT_FIELD_VALUE_INVALID} 拦下）。
   * 🔴 但「整列覆盖」不等于「没发过去的键一律被删」：停用字段、{@code scene} 不覆盖 FORM 的字段、
   *    孤儿键这三类由后端 {@code carryOverReadOnly} 从库里现值补回，前端刻意不带。
   *    完整理由见 {@code QlzgProjectSaveVO.ext}。
   *    ⚠️ 与 {@code QlzgMaterialApi.updateExt} 相反：那个端点的 {@code null} / {@code {}} 是「清空」。
   */
  ext?: Record<string, any> | null
}

export const QlzgClientApi = {
  /** 委托方分页 */
  getClientPage: (params: QlzgClientPageReqVO): Promise<PageResult<QlzgClientVO[]>> =>
    request.get({ url: '/qlzg/client/page', params }),

  /** 委托方详情（身份证号与联系电话是脱敏形态） */
  getClient: (id: number): Promise<QlzgClientVO> =>
    request.get({ url: '/qlzg/client/get', params: { id } }),

  /** 创建委托方，返回新 id */
  createClient: (data: QlzgClientSaveVO): Promise<number> =>
    request.post({ url: '/qlzg/client/create', data }),

  /** 更新委托方（idCardNo / contactMobile 走三态，见 QlzgClientSaveVO） */
  updateClient: (data: QlzgClientSaveVO): Promise<boolean> =>
    request.put({ url: '/qlzg/client/update', data }),

  /**
   * 删除委托方
   *
   * ⚠️ 名下还有评估项目（**含已作废的**）时后端会拒绝。这是对的：
   *    作废的项目仍然是档案，档案上的委托方不能凭空消失。
   */
  deleteClient: (id: number): Promise<boolean> =>
    request.delete({ url: '/qlzg/client/delete', params: { id } }),

  /**
   * 导出委托方台账
   *
   * 🔴 导出的身份证号与联系电话是**脱敏形态**（`330106**********34`），与列表一致。
   *    后端在装配完 RespVO、写 Excel 之前显式调了一次脱敏 ——
   *    因为 `@IdCardDesensitize` 只在 Jackson 序列化那一刻生效，而 Excel 从不经过 Jackson。
   *    所以前端**不要**在导出弹窗里承诺「导出完整号码」，那是拿不到的。
   *
   * 🔴 **不走 `request.download`**：那个封装只把 Blob 交出来、响应头拿不到，
   *    而「这次有没有被上限截断」正是走 `X-Export-Truncated` 传的。理由全文在
   *    `@/utils/exportExcel` 的 `exportExcelWithMeta` 上，那里是全仓唯一一份。
   *
   * @param currentPage true-只导当前页 / false-按当前条件导全部（受上限约束）
   */
  exportExcel: (params: any, currentPage: boolean) =>
    exportExcelWithMeta('/qlzg/client/export-excel', { ...params, currentPage })
}
