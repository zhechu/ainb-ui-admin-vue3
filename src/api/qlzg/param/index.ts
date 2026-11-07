import request from '@/config/axios'

/**
 * 参数库（读模型）← 后端 {@code QlzgParamRespVO}
 *
 * <h3>🔴 展示已有数据一律用后端的 {@code *Description} 字段</h3>
 * `sourceTypeDescription` 是服务端按 {@code QlzgParamSourceTypeEnum} 算好发来的，
 * 前端再翻一遍就会与枚举分叉（表现是「列表里显示『政府发布』、点进去显示 GOVERNMENT」）。
 * `constants.ts` 里那份 `PARAM_SOURCE_TYPE_OPTIONS` **只用于筛选下拉与表单选项**。
 *
 * <h3>🔴 {@code platformLevel} 为 true 的行，编辑与删除要在界面上灰掉，不要等后端拒</h3>
 * 那是 `tenant_id IS NULL` 的平台级参数，后端会以 `PARAM_PLATFORM_ROW_IMMUTABLE`
 * （1042006016）拒回来。让用户点完再报错是最坏的一种界面：他要的是另一套口径，
 * 而正确做法是**新建一条机构内部参数**（{@code sourceType = ORG_INTERNAL}）去覆盖它 ——
 * 四维回退里机构级优先于平台级，所以覆盖是生效的，这句话要写在按钮的 tooltip 上。
 *
 * <h3>🔴 {@code valueNum} / {@code valueStr} / {@code valueJson} 三者至少有一个</h3>
 * 后端 `PARAM_VALUE_REQUIRED`（1042006012）拦的就是「三个全空」。
 * 界面上不要按 `valueNum` 有没有值来判断「这条参数有没有值」——
 * 文本型参数（例如某个口径说明）只有 `valueStr`，复合参数只有 `valueJson`。
 */
export interface QlzgParamVO {
  id: number
  paramKey: string
  paramName: string
  /** 空 = 通用参数（不绑品类） */
  categoryCode?: string | null
  /** 6 位国标行政区划码；全国级是 `000000` */
  regionCode: string
  industryCode?: string | null
  valueNum?: number | null
  valueStr?: string | null
  valueJson?: Record<string, any> | null
  unit?: string | null
  /** LocalDate ⇒ ISO 字符串 `"2026-01-01"` */
  effectiveFrom?: string | null
  effectiveUntil: string
  /** 后端派生：`effectiveUntil` 是 9999-12-31 */
  longTermEffective?: boolean
  versionNo?: string | null
  basis?: string | null
  basisFileId?: number | null
  sourceType: string
  sourceTypeDescription?: string
  /**
   * 🔴 后端 DO 里是 Integer 0/1，RespVO 上转成了 Boolean。
   *    为 false 的含义是「这条参数**不能**被 BLOCK 级规则引用」——
   *    `EXPERT_GUIDE`（专家指引）一律是 false，那是 §11.9.1 纪律 2：
   *    专家指引只能出 WARN，不能卡住出稿
   */
  canBeBlockRule?: boolean
  publishedBy?: string | null
  /** 框架 CommonStatusEnum：1 启用 / 0 停用 */
  status: number
  platformLevel?: boolean
  creator?: string
  /** LocalDateTime ⇒ epoch 毫秒 */
  createTime?: Date
  updateTime?: Date
}

/**
 * 参数库（写模型）← 后端 {@code QlzgParamSaveReqVO}
 *
 * 🔴 **update 是整行提交**：后端按「传上来的这一份就是全部」处理，
 *    可空列没传就等于要把它清成 NULL。所以编辑弹窗必须先 `/get` 拿全量再改，
 *    不要只把用户动过的那几个键发上去。
 *
 * 🔴 {@code effectiveUntil} 必填，长期有效要**显式**填 `9999-12-31`。
 *    后端 `PARAM_EFFECTIVE_UNTIL_REQUIRED`（1042006002）的文案写的是
 *    「基准地价三年一更，用错版本是常见退单原因」——
 *    表单上要给一个「长期有效」的开关把这个日期填进去，而不是让用户手打。
 */
export interface QlzgParamSaveVO {
  id?: number
  paramKey: string
  paramName: string
  categoryCode?: string
  regionCode: string
  industryCode?: string
  valueNum?: number | null
  valueStr?: string | null
  valueJson?: Record<string, any> | null
  unit?: string
  effectiveFrom?: string | null
  effectiveUntil: string
  versionNo?: string
  basis?: string
  basisFileId?: number | null
  sourceType: string
  canBeBlockRule?: boolean
  publishedBy?: string
  status?: number
}

/**
 * 台账分页入参 ← 后端 {@code QlzgParamPageReqVO}
 *
 * 🔴 {@code platformLevel} 是**三态**：不传（undefined）= 平台级与机构级都要，
 *    true = 只要平台级，false = 只要本机构的。
 *    所以「全部」那一项必须让值为 `undefined` 而不是 `''` 或 `false` ——
 *    传 `false` 的表现是选了「全部」却看不到平台级参数，而平台级参数恰恰是
 *    基准地价、资本化率这些最常用的
 */
export interface QlzgParamPageReqVO extends PageParam {
  /** 精确匹配 */
  paramKey?: string
  /** 模糊匹配 */
  paramName?: string
  categoryCode?: string
  regionCode?: string
  industryCode?: string
  sourceType?: string
  status?: number
  platformLevel?: boolean
  createTime?: string[]
}

/**
 * 参数确认闸的**预览** ← 后端 {@code QlzgParamConfirmPreviewRespVO}
 *
 * <h3>🔴 这个接口一个字都不写库</h3>
 * 它只做「按标的的品类 + 辖区 + 基准日，把 param_schema 里每个 PARAM 作用域的键
 * 走一遍四维回退，告诉你命中了什么、没命中什么、哪些要标红」。
 * 真正的**冻结**发生在 `/qlzg/calculation/run` 那一次（HITL 第①闸）。
 * 所以这个页面可以反复刷新，不会产生垃圾快照。
 *
 * <h3>🔴 {@code allFromExpertGuide} 是 R36 的输入</h3>
 * 全部参数都来自专家指引时，报告里必须披露「本次测算的口径依据全部为专家指引」。
 * 界面上要把它显示成一条**警示**而不是一个错误 —— 它不拦测算，只要求披露。
 */
export interface QlzgParamConfirmPreviewVO {
  subjectId: number
  subjectName?: string
  projectId?: number
  categoryCode?: string
  /** 界面上显示这个，不显示 categoryCode：确认闸是评估师做判断的地方，一行码看不出是哪一类业务 */
  categoryName?: string
  regionCode?: string
  baseDate?: string | null
  /** MVP 恒为 null：行业级回退那一维还没有数据源 */
  industryCode?: string | null
  items: QlzgParamConfirmItemVO[]
  /** 没命中任何一级的参数条数 */
  missCount: number
  /** 需要标红的条数（命中了但有歧义 / 基准日没落进有效期 / 超范围） */
  attentionCount: number
  allFromExpertGuide: boolean
}

/**
 * 确认闸上的一行 ← 后端 {@code QlzgParamConfirmPreviewRespVO.Item}
 *
 * 三段字段混在一个对象里：**schema 段**（这个键该填什么形状）、
 * **命中段**（四维回退查到了什么）、**标红段**（要不要拦人）。
 *
 * 🔴 {@code attentionReason} 不需要标红时是**空字符串而不是 null**，
 *    判空用 `!item.attentionReason` 即可，别写 `=== null`
 * 🔴 {@code matchedCount > 1} 意味着**同一级辖区里查到了多条**（歧义）。
 *    后端不替用户挑一条，而是标红让人来定 —— 挑错了就是口径错了，
 *    而口径错在报告里是看不出来的
 */
export interface QlzgParamConfirmItemVO {
  // ===== schema 段 =====
  paramKey: string
  label?: string
  /** DECIMAL / INT / STRING / ENUM / GEO */
  type?: string
  unit?: string | null
  scale?: number | null
  required?: boolean
  /** FROM_PARAM_LIB（去参数库查）/ PROMPT_USER（直接问评估师） */
  defaultStrategy?: string
  rangeMin?: number | null
  rangeMax?: number | null
  options?: string[]
  // ===== 命中段 =====
  hit: boolean
  paramId?: number | null
  paramName?: string | null
  valueNum?: number | null
  valueStr?: string | null
  valueJson?: Record<string, any> | null
  sourceType?: string | null
  sourceTypeDescription?: string | null
  basis?: string | null
  versionNo?: string | null
  platformLevel?: boolean
  /** 命中的是哪一级回退（例：REGION / CITY / PROVINCE / NATIONAL） */
  fallbackPath?: string | null
  /** 走过的辖区阶梯 */
  regionLadder?: string[]
  matchedCount?: number
  baseDateApplied?: boolean
  // ===== 标红段 =====
  needAttention?: boolean
  attentionReason?: string
}

export const QlzgParamApi = {
  getParamPage: (params: QlzgParamPageReqVO): Promise<PageResult<QlzgParamVO[]>> =>
    request.get({ url: '/qlzg/param/page', params }),

  getParam: (id: number): Promise<QlzgParamVO> =>
    request.get({ url: '/qlzg/param/get', params: { id } }),

  createParam: (data: QlzgParamSaveVO): Promise<number> =>
    request.post({ url: '/qlzg/param/create', data }),

  /** 🔴 整行提交，见 {@link QlzgParamSaveVO} 的注释 */
  updateParam: (data: QlzgParamSaveVO): Promise<boolean> =>
    request.put({ url: '/qlzg/param/update', data }),

  /**
   * 🔴 已被口径快照引用的参数**删不掉**（`PARAM_REFERENCED_BY_SNAPSHOT`，1042006017）。
   *    那是刻意的：快照是报告的口径依据，删掉参数会让已出稿的报告失去依据链。
   *    界面上要把「删除」与「停用」并排放，并在删除按钮的 tooltip 里写明
   *    「要停用请改状态」—— 否则用户会以为系统坏了
   */
  deleteParam: (id: number): Promise<boolean> =>
    request.delete({ url: '/qlzg/param/delete', params: { id } }),

  /**
   * 参数确认闸预览 ← `QlzgParamController#previewConfirmation`
   *
   * 🔴 只读，不冻结任何东西，可以反复调
   * ⚠️ 权限点是 `qlzg:param:query`：**只读的人也要能看到确认闸**，
   *    否则审核人无法复核口径
   */
  previewConfirmation: (subjectId: number): Promise<QlzgParamConfirmPreviewVO> =>
    request.get({ url: '/qlzg/param/preview-confirmation', params: { subjectId } })
}
