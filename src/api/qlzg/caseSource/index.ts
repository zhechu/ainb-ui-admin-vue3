import request from '@/config/axios'

/**
 * 一条案例数据来源（读模型）← 后端 {@code QlzgCaseSourceRespVO}
 *
 * 🔴 这里的 `sourceType` 是**数据源性质**（{@code QlzgCaseProviderTypeEnum}：
 *    THIRD_PARTY_API / PUBLIC_DISCLOSURE / MANUAL / GOVERNMENT），
 *    与案例那一张表上的 `sourceType`（{@code QlzgCaseSourceTypeEnum}：
 *    API / DISCLOSURE / MANUAL / IMPORT）**是两个不同的枚举、不能合并** ——
 *    这里有 GOVERNMENT 而没有 IMPORT。两份下拉常量在 `constants.ts` 里也刻意分开命名
 *    （`CASE_PROVIDER_TYPE_OPTIONS` 与 `CASE_SOURCE_TYPE_OPTIONS`），
 *    合成一份的表现是「数据源管理页里能选到『批量导入』」，而那个值存进去之后
 *    案例表的出处判定会整个走错分支
 */
export interface QlzgCaseSourceVO {
  id: number
  sourceCode: string
  sourceName: string
  sourceType: string
  sourceTypeDescription?: string
  /** → `infra_data_interface.id`，仅 `sourceType = THIRD_PARTY_API` 时有值 */
  apiInterfaceId?: number
  originUrlPattern?: string
  /** 🔴 许可方要求的强制署名文本，闸 G-10 逐字引用它拼进报告 */
  attributionRequired?: string
  /** 授权范围与是否禁止转授权，例如 `{"sublicense": false}` */
  licenseScope?: Record<string, any> | null
  updateFrequency?: string
  /** 0 停用 / 1 启用 */
  status?: number
  /** 🔴 平台预置行（tenant_id = 0）本机构改不了、删不了 */
  platformPreset?: boolean
  editable?: boolean
  createTime?: Date
}

/**
 * 写模型 ← 后端 {@code QlzgCaseSourceSaveReqVO}
 *
 * 🔴 `tenantId` 刻意不在这里：平台预置行不能通过普通修改变成机构私有，反之亦然
 */
export interface QlzgCaseSourceSaveVO {
  id?: number
  /**
   * 🔴 **全局**唯一（唯一键不含 tenant_id），因为导入模板跨环境流转、只能写码不能写 id。
   * 🔴 **建了就不能改**：改了码，已经发出去的导入模板会全部报「数据源不存在」，
   *    而用户对着一个看起来一模一样的码排查不出原因。要换码就新建一个、把旧的停用。
   *    所以编辑态这一栏必须 disabled
   */
  sourceCode?: string
  sourceName?: string
  sourceType?: string
  apiInterfaceId?: number | null
  /**
   * 🔴 只存一个域名首页等于没存 —— 质询时要给得出**具体那一页**。
   *    模板里用 `{id}` 之类的占位，例 `https://sf.taobao.com/item_detail.htm?id={id}`
   */
  originUrlPattern?: string
  attributionRequired?: string
  licenseScope?: Record<string, any> | null
  /** 本迭代只存不判：判定规则要先有真实的更新失败数据才写得准 */
  updateFrequency?: string
  /** 0 停用 / 1 启用；留空按启用处理 */
  status?: number
}

export const QlzgCaseSourceApi = {
  /**
   * 数据源列表 ← `QlzgCaseSourceController#getCaseSourceList`
   *
   * 🔴 后端**没有** `/page` 也**没有** `/get`：这一份数据只有几十行
   *    （一家机构的取证渠道就政府发布、公开披露、第三方接口那么几个口径），
   *    而分页会把「管理页要翻页才看得全」与「导入向导的下拉框不能翻页」
   *    拆成两条路径 —— 两条一定会漂，漂了的表现是
   *    「向导里能选到管理页上看不见的那个」。编辑弹窗用的就是这份列表里的那一行
   * 🔴 **不过滤 status**：导入向导要「启用的」，案例详情页要「启用的 + 停用的」
   *    （停用的源，历史案例的出处仍要显示），由调用方自己过滤
   * ⚠️ 这个端点**只要登录即可**（后端刻意不加 `@PreAuthorize`）：
   *    它同时喂 `qlzg:case-source:*` 与 `qlzg:case:*` 两个权限族的界面，
   *    挂在其中任何一个族上，另一个族的界面就会「下拉框空着 + 一条与本页无关的无权限红条」
   */
  getCaseSourceList: (): Promise<QlzgCaseSourceVO[]> =>
    request.get({ url: '/qlzg/case-source/list' }),

  /** 新增 ← `QlzgCaseSourceController#createCaseSource` */
  createCaseSource: (data: QlzgCaseSourceSaveVO): Promise<number> =>
    request.post({ url: '/qlzg/case-source/create', data }),

  /**
   * 修改 ← `QlzgCaseSourceController#updateCaseSource`
   *
   * 🔴 平台预置行改不了（`CASE_SOURCE_PLATFORM_ROW_IMMUTABLE`），
   *    界面上按 `editable` 灰掉，不要等后端拒
   */
  updateCaseSource: (data: QlzgCaseSourceSaveVO): Promise<boolean> =>
    request.put({ url: '/qlzg/case-source/update', data }),

  /**
   * 启用 / 停用 ← `QlzgCaseSourceController#updateCaseSourceStatus`
   *
   * 🔴 停用**不删行**：已经引用了这个源的历史案例仍然要能显示出处，
   *    停用只是「不再允许新案例挂上来」
   * ⚠️ `status` 不传时后端按**停用**处理，所以这里一律显式传
   */
  updateCaseSourceStatus: (id: number, status: number): Promise<boolean> =>
    request.put({ url: '/qlzg/case-source/update-status', params: { id, status } }),

  /**
   * 删除 ← `QlzgCaseSourceController#deleteCaseSource`
   *
   * 🔴 名下还挂着案例时拒绝（`CASE_SOURCE_HAS_CASE`）并让用户改用停用。
   *    那个计数是**跨租户**的，报错文案要说清「可能是别的机构在用」，不要吞成「删除失败」
   */
  deleteCaseSource: (id: number): Promise<boolean> =>
    request.delete({ url: '/qlzg/case-source/delete', params: { id } })
}
