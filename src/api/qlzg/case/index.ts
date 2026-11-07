import request from '@/config/axios'
import { exportExcelWithMeta } from '@/utils/exportExcel'

/**
 * 经纬度。后端是 {@code Map<String, Object>}，这里收成两个键
 *
 * 🔴 两个键都**可空**、且后端认不出时**一律拒绝**（`CASE_LOCATION_INVALID`），
 *    不是回落成 0：0 会把案例算到几内亚湾，而空间召回那一层把它当成一个真实坐标去比距离。
 *    所以表单上「没填」与「填了 0」必须是两个状态 —— 不要把空值转成 0 再提交。
 */
export interface QlzgCaseLocation {
  lng?: number | string | null
  lat?: number | string | null
}

/**
 * 一条可比案例（读模型）← 后端 {@code QlzgCaseRespVO}
 *
 * 🔴 展示已有数据一律用 `*Description` 那几个字段（`sourceTypeDescription` /
 *    `evidenceKindDescription` / `tenantScopeDescription`），**不要**在前端把码翻一遍：
 *    qlzg 没有任何 `system_dict_data` 支撑，翻两份就一定会漂。
 *    只有**让用户挑值**的下拉才用 `constants.ts` 里的 `CASE_*_OPTIONS`。
 *
 * 🔴 `transactionPrice` / `unitPrice` / `realPriceRestored` 的单位是**元**，不是万元。
 *    V5 §11.2.2 的线框图写的是「万元」，那是**改判**：全仓（项目、标的）都存元，
 *    而仓里没有任何万元换算助手，为一个界面造一个换算就等于造一处四舍五入。
 *    万元只作为**只读提示**显示，换算在 `caseSchema.ts` 里，且换算结果不回传。
 */
export interface QlzgCaseVO {
  id: number
  caseKind: string
  sourceType: string
  sourceTypeDescription?: string
  sourceId?: number
  sourceName?: string
  cityCode?: string
  districtCode?: string
  communityName?: string
  address?: string
  location?: QlzgCaseLocation | null
  purpose?: string
  rightType?: string
  /** LocalDate ⇒ ISO 字符串 `"2026-03-15"`（后端有显式的 ISO_LOCAL_DATE 序列化器） */
  transactionDate?: string
  transactionPrice?: number
  buildingArea?: number
  unitPrice?: number
  /**
   * 🔴 写成 `| null` 而不只是 `?`：Web 层那个 ObjectMapper **没有** NON_NULL
   *    （`EnlevJacksonAutoConfiguration` 只加了 LocalDateTime 的 epoch 毫秒定制，
   *    `JsonUtils` 里那份 NON_NULL 是工具类自己的 mapper，不是 HTTP 那条），
   *    所以库里为 NULL 的列在响应体里**真的是 `null`**，不是「键不出现」。
   *    只写 `?` 的话 `row.realPriceRestored === null` 会被类型判成不可能，
   *    而 `!value` 之类的判空又恰好对 null 与 undefined 同效 —— 于是这一处写错不会红，
   *    直到有人写成 `value === undefined`
   */
  realPriceRestored?: number | null
  restoreReason?: string
  floorInfo?: string
  orientation?: string
  decoration?: string
  builtYear?: number
  structure?: string
  originUrl?: string
  evidenceFileId?: number
  evidenceKind?: string
  evidenceKindDescription?: string
  enteredBy?: number
  enteredByNickname?: string
  /** LocalDateTime ⇒ epoch 毫秒 */
  enteredAt?: Date
  confidence?: number
  isVerified?: boolean
  fingerprint?: string
  tenantScope?: string
  tenantScopeDescription?: string
  /** 🔴 平台共享库的行（tenant_id IS NULL）为 false：界面上要灰掉编辑与删除，不是等后端拒 */
  editable?: boolean
  /** R47 的来源披露文本；`sourceType` 不是 MANUAL 时为 null（那一类走闸 G-10 的署名文本） */
  disclosureText?: string | null
  attrs?: Record<string, any> | null
  remark?: string
  createTime?: Date
}

/** 台账分页入参 ← 后端 {@code QlzgCasePageReqVO} */
export interface QlzgCasePageReqVO extends PageParam {
  caseKind?: string
  /**
   * 🔴 只是**再收窄**，不是可见性开关：留空时后端默认跨私有库与共享库
   */
  tenantScope?: string
  sourceType?: string
  sourceId?: number
  cityCode?: string
  districtCode?: string
  communityName?: string
  address?: string
  purpose?: string
  rightType?: string
  isVerified?: boolean
  /** LocalDate[] ⇒ 两个 `YYYY-MM-DD` */
  transactionDate?: string[]
  /** LocalDateTime[] ⇒ 两个 `YYYY-MM-DD HH:mm:ss` */
  createTime?: string[]
}

/**
 * 写模型 ← 后端 {@code QlzgCaseSaveReqVO}
 *
 * 🔴 五个字段**刻意不在这里**：`enteredBy` / `enteredAt`（服务端从登录上下文取）、
 *    `isVerified`（恒 false，打分表里它值 10 分，一个能自己勾的 10 分等于白送）、
 *    `confidence`、`fingerprint`（服务端算）。
 *    传了也会被忽略，但**不要**在表单里造出这几个框 ——
 *    用户看见一个能勾的「已核实」复选框，就会去勾它，然后困惑于为什么没生效。
 *
 * 🔴 语义是**整行替换**：编辑态提交的是整张表单，入参为空的列会被写成 SQL NULL。
 *    所以「打开编辑弹窗 → 什么都不动 → 保存」必须把**原值整份带上**，
 *    不能只带用户碰过的字段，否则没碰过的那些列会被清空。
 */
export interface QlzgCaseSaveVO {
  id?: number
  caseKind?: string
  /** 留空 / 空白 ⇒ 后端按 MANUAL 处理；🔴 新增时传 API / IMPORT / DISCLOSURE 会被拒 */
  sourceType?: string
  /** 🔴 MANUAL 时必须为 null：人工录入挂数据源等于伪造一个会带署名文本进报告的出处 */
  sourceId?: number | null
  cityCode?: string
  districtCode?: string
  communityName?: string
  address?: string
  location?: QlzgCaseLocation | null
  purpose?: string
  rightType?: string
  transactionDate?: string
  transactionPrice?: number
  buildingArea?: number
  /** 留空则后端按「成交价 ÷ 建筑面积」算；填了则必须在 5% 以内 */
  unitPrice?: number | null
  realPriceRestored?: number | null
  /** 🔴 填了 `realPriceRestored` 就必填，反之亦然（两个方向都拦） */
  restoreReason?: string | null
  floorInfo?: string
  orientation?: string
  decoration?: string
  builtYear?: number | null
  structure?: string
  originUrl?: string
  /** 🔴 MANUAL 时必填（`CASE_EVIDENCE_REQUIRED`），值来自 `uploadEvidence` */
  evidenceFileId?: number | null
  /** 🔴 填了 `evidenceFileId` 就必填，取值来自 `getImportConfig().evidenceKinds` */
  evidenceKind?: string | null
  attrs?: Record<string, any> | null
  remark?: string
}

/** ← 后端 {@code QlzgCaseEvidenceUploadRespVO} */
export interface QlzgCaseEvidenceUploadVO {
  /** 🔴 这就是 `QlzgCaseSaveVO.evidenceFileId` 要填的值 */
  fileId: number
  fileName: string
  fileSize?: number
  /**
   * 规范地址，**不是可直接打开的地址**：私有桶上访问它是 403。
   * 读字节走 I6 的 `POST /qlzg/file/presign-get`，界面上只用来回显
   */
  url?: string
}

/** 召回面板的六层过滤记录 ← 后端 {@code QlzgCaseRecallRespVO.Layer} */
export interface QlzgCaseRecallLayerVO {
  layer: number
  field?: string
  op?: string
  /** 🔴 展示用这个，不要在前端翻 `op` */
  opDescription?: string
  /** true = 硬过滤（不满足直接出局）；false = 打分项 */
  hard?: boolean
  threshold?: number
  /** 这一层这次到底有没有生效（缺事实时不生效） */
  applied?: boolean
  note?: string
}

/**
 * 一条预选警示 ← 后端 {@code QlzgCaseRecallRespVO.ReviewWarning}
 *
 * 🔴 **只有两个字段，刻意没有 `severity`**：R32 恒为 WARN，一个恒等于常量的字段是噪音。
 *    I5 真要区分 BLOCK / WARN / INFO 时再加，那时它有第二种取值。
 */
export interface QlzgCaseReviewWarningVO {
  ruleCode: string
  text: string
}

/**
 * 打分明细 ← 后端 {@code QlzgCaseRecallRespVO.Candidate.scoreDetail}
 *
 * 后端是 {@code Map<String, Object>}，形状是 `{ items: [...], total_max: n }`。
 * 🔴 `total_max` 是**这一条**的满分（各条可能不同：缺事实的项不计入分母），
 *    与顶层那个 `totalMax` 不是一回事 —— 别拿顶层的去除这一条的分。
 */
export interface QlzgCaseScoreDetailVO {
  items?: {
    item: string
    label?: string
    /** 档位，用于上色；具体取值见后端 QlzgCaseScorer */
    tier?: string
    score?: number
    note?: string
    reason?: string
  }[]
  total_max?: number
}

/** 一个召回候选 ← 后端 {@code QlzgCaseRecallRespVO.Candidate} */
export interface QlzgCaseCandidateVO {
  rank: number
  score?: number
  scoreDetail?: QlzgCaseScoreDetailVO | null
  /** 命中了哪几层召回（1–6） */
  recallLayerHits?: number[]
  /** 生效价：做过还原登记时用还原价，否则用成交价 */
  effectiveTransactionPrice?: number
  effectiveUnitPrice?: number
  priceRestored?: boolean
  /** 成交日与评估基准日的天数差（绝对值）；任一侧缺失时为 null */
  dealDateDiffDays?: number | null
  /**
   * 🔴 **空列表不是 null**：后端保证非 null，前端不要为它做 null 判断。
   *    目前只会有 R32（时点差超阈值）这一条，见 I2-e 的改判记录
   */
  reviewWarnings: QlzgCaseReviewWarningVO[]
  caseInfo: QlzgCaseVO
}

/** 召回预览 ← 后端 {@code QlzgCaseRecallRespVO} */
export interface QlzgCaseRecallVO {
  subjectId: number
  subjectName?: string
  projectId?: number
  projectNo?: string
  projectName?: string
  categoryCode?: string
  /** 界面上显示这个，不显示 categoryCode（其余每一页显示的都是名称） */
  categoryName?: string
  /** 品类码取自项目，🔴 入参不可覆盖 */
  caseKind?: string
  /**
   * caseKind 的显示名 = 共用它的品类名连起来。
   * 🔴 不是字典翻译：全仓没有 case_kind 的枚举或字典表，后端只有一份派生逻辑
   *    （`QlzgCategoryService#groupVisibleByCaseKind`），案例库类型下拉用的就是它
   */
  caseKindName?: string
  /** 基准日取自项目；🔴 项目没有它时后端直接报错，不回落成今天 */
  baseDate?: string
  rawCandidateCount?: number
  dedupedCount?: number
  candidateCount?: number
  candidateLimit?: number
  truncated?: boolean
  totalMax?: number
  /** `NONE` / `FEW` / `OK`，🔴 只用来上色，中文一律用 `dispositionText` */
  dispositionCode?: string
  dispositionDescription?: string
  /** 🔴 这句是给人读的完整结论（含 R48 的处置建议），界面上照原样渲染 */
  dispositionText?: string
  comparisonMethodAllowed?: boolean
  comparisonMethodBlockReason?: string
  /** 🔴 本接口**不写库**；这一列由 I3 落测算时写进 `qlzg_project` */
  procedureLimitedRequired?: boolean
  reviewRuleCode?: string
  layers?: QlzgCaseRecallLayerVO[]
  /** 缺了哪些事实（缺事实 ⇒ 对应那一层不生效，不是报错） */
  missingFacts?: string[]
  candidates?: QlzgCaseCandidateVO[]
}

/** 导入配置里的一个下拉项 ← 后端 {@code QlzgCaseImportConfigRespVO.Option} */
export interface QlzgCaseImportOptionVO {
  code: string
  name: string
}

/** ← 后端 {@code QlzgCaseImportConfigRespVO.CaseKindOption} */
export interface QlzgCaseKindOptionVO {
  code: string
  name: string
  /** 这个案例库类型对应哪些品类码（用于「为什么模板长这样」的解释） */
  categoryCodes?: string[]
}

/** ← 后端 {@code QlzgCaseImportConfigRespVO.SourceOption} */
export interface QlzgCaseSourceOptionVO {
  id: number
  sourceCode: string
  sourceName: string
  providerType?: string
  providerTypeName?: string
  /** 这个源要求的署名文本（闸 G-10 逐字引用它） */
  attributionText?: string
}

/** 模板里的一列 ← 后端 {@code QlzgCaseImportConfigRespVO.Column} */
export interface QlzgCaseImportColumnVO {
  field: string
  header: string
  dataType?: string
  dataTypeName?: string
  requiredColumn?: boolean
  /** 🔴 false = 模板里有这一列但**只读**（会被忽略），界面上要标出来 */
  writable?: boolean
  note?: string
  options?: string[]
  example?: string
}

/** 导入配置 ← 后端 {@code QlzgCaseImportConfigRespVO} */
export interface QlzgCaseImportConfigVO {
  /** 🔴 整批共用一份来源说明文件那段告诫，**照原样渲染**，不要在前端重写一份 */
  notice?: string
  caseKinds?: QlzgCaseKindOptionVO[]
  /** 🔴 空 ⇒ 界面上要**禁用导入**并给出「先去登记数据源」的出口，不是让它空着 */
  sources?: QlzgCaseSourceOptionVO[]
  evidenceKinds?: QlzgCaseImportOptionVO[]
  columns?: QlzgCaseImportColumnVO[]
  maxImportRows?: number
  maxPreviewRows?: number
  maxFileSizeMb?: number
  /** 超过这个行数走异步任务 + 轮询 */
  asyncThreshold?: number
}

/** 一条行级 / 文件级问题 ← 后端 {@code QlzgCaseImportIssueVO} */
export interface QlzgCaseImportIssueVO {
  /** 🔴 文件级问题没有行号，是 null */
  rowNo?: number | null
  columnLetter?: string
  field?: string
  /** 🔴 展示用这个，不要用 `field`（那是 Java 字段名，用户看不懂） */
  fieldLabel?: string
  message?: string
  rawValue?: string
  /** `ERROR` / `WARNING` / `SKIPPED` */
  level?: string
  /** `PARSE` / `BEAN_VALIDATE` / `BUSINESS` / `INSERT` / `DEDUPE` */
  phase?: string
}

/** 预检结果 ← 后端 {@code QlzgCaseImportPreviewRespVO} */
export interface QlzgCaseImportPreviewVO {
  total?: number
  validCount?: number
  invalidCount?: number
  warningCount?: number
  /** 模板里那几行示例被跳过了多少条 */
  skippedExampleCount?: number
  headerCount?: number
  /** 🔴 文件级问题（表头缺列、文件坏了）；非空时**不该**允许进入下一步 */
  fileIssues?: QlzgCaseImportIssueVO[]
  willBeAsync?: boolean
  asyncThreshold?: number
  /** 只回了前 N 行的明细 */
  rowsTruncated?: boolean
  rowLimit?: number
  rows?: {
    rowNo: number
    valid?: boolean
    communityName?: string
    address?: string
    transactionDate?: string
    transactionPrice?: number
    buildingArea?: number
    issues?: QlzgCaseImportIssueVO[]
  }[]
}

/** 导入结果 ← 后端 {@code QlzgCaseImportResultVO} */
export interface QlzgCaseImportResultVO {
  total?: number
  processedCount?: number
  insertedCount?: number
  /**
   * 🔴 指纹撞车被**跳过**的条数，**不是失败**：那 200 条里有 30 条本来就在库里，
   *    界面上要与 `failedCount` 分开显示，否则用户以为导坏了
   */
  skippedCount?: number
  failedCount?: number
  warningCount?: number
  issuesTruncated?: boolean
  issueLimit?: number
  issues?: QlzgCaseImportIssueVO[]
}

/** ← 后端 {@code QlzgCaseImportExecuteRespVO} */
export interface QlzgCaseImportExecuteVO {
  /** 🔴 **它是唯一的分支判据**：true ⇒ 拿 taskId 去轮询，false ⇒ result 就在这一份里 */
  async: boolean
  taskId?: number
  taskNo?: string
  result?: QlzgCaseImportResultVO
}

/** ← 后端 {@code QlzgCaseImportProgressRespVO} */
export interface QlzgCaseImportProgressVO {
  taskId: number
  taskNo?: string
  status?: string
  /** 🔴 展示用这个，不要在前端翻 `status` */
  statusName?: string
  /**
   * 🔴 **停止轮询要判这个，不要判 status**：多一种终态（例如 I6 加的取消）时，
   *    按 status 枚举写的停止条件会漏掉它，表现是弹窗关不掉、请求一直打
   */
  terminal: boolean
  progress?: number
  /** 🔴 跑到一半就非 null（只有计数，没有 issues） */
  result?: QlzgCaseImportResultVO | null
  errorMsg?: string
  startedAt?: Date
  finishedAt?: Date
  /** 恒为 0：本仓不做自动重试 */
  retryCount?: number
}

/** `/import-execute` 除文件以外的五个 `@RequestParam` */
export interface QlzgCaseImportExecuteParams {
  caseKind: string
  sourceId: number
  evidenceFileId: number
  evidenceKind: string
  /**
   * 🔴 幂等键。**在选中文件的那一刻生成一次**（一个 UUID 即可），
   *    并在「预检 → 开始导入」这两步里保持不变。
   *    每次请求都新生成一个的话，双击「开始导入」就是两次导入 ——
   *    而服务端刻意不替你生成（`CASE_IMPORT_TOKEN_REQUIRED`），理由同上
   */
  importToken: string
}

export const QlzgCaseApi = {
  /**
   * 台账分页 ← `QlzgCaseController#getCasePage`
   *
   * 🔴 默认跨私有库与共享库；`tenantScope` 只是再收窄
   * ⚠️ 泛型里那个 `[]` 不是笔误：全局 `PageResult<T>` 把 `list` 声明成 `T`，
   *    四个 qlzg 台账 API 都是这个写法，改成 `PageResult<QlzgCaseVO>` 会让
   *    `list.value = data.list` 编译不过
   */
  getCasePage: (params: QlzgCasePageReqVO): Promise<PageResult<QlzgCaseVO[]>> =>
    request.get({ url: '/qlzg/case/page', params }),

  /** 取一条 ← `QlzgCaseController#getCase`（本机构可见：私有 + 共享） */
  getCase: (id: number): Promise<QlzgCaseVO> => request.get({ url: '/qlzg/case/get', params: { id } }),

  /**
   * 新增 ← `QlzgCaseController#createCase`
   *
   * 🔴 屏 3 的「保存」与「保存并继续录下一条」走的是**同一个**接口，
   *    区别只在前端保存成功后要不要重置表单
   */
  createCase: (data: QlzgCaseSaveVO): Promise<number> =>
    request.post({ url: '/qlzg/case/create', data }),

  /**
   * 修改 ← `QlzgCaseController#updateCase`
   *
   * 🔴 整行替换：入参为空的列会被写成 SQL NULL，所以必须把原值整份带上
   */
  updateCase: (data: QlzgCaseSaveVO): Promise<boolean> =>
    request.put({ url: '/qlzg/case/update', data }),

  /**
   * 删除 ← `QlzgCaseController#deleteCase`
   *
   * 🔴 已被召回结果引用时报 `CASE_REFERENCED_BY_MATCH`，文案里让用户改用修改 ——
   *    那条报错**要原样显示**，不要吞成「删除失败」
   */
  deleteCase: (id: number): Promise<boolean> =>
    request.delete({ url: '/qlzg/case/delete', params: { id } }),

  /**
   * 小区名自动补全 ← `QlzgCaseController#suggestCommunityNames`
   *
   * 🔴 补全源是**本机构 + 共享库里已出现过的小区名**，不是外部字典，且**不强制**从列表里选
   *    （新盘第一次录入时库里压根没有它）。所以 el-select 要开 `allow-create`
   */
  suggestCommunityNames: (keyword: string, limit?: number): Promise<string[]> =>
    request.get({ url: '/qlzg/case/community-name-suggestions', params: { keyword, limit } }),

  /**
   * 预览 R47 的来源披露文本 ← `QlzgCaseController#previewDisclosure`
   *
   * 🔴 **保存之前**就让评估师看到这段文本（§1.4 配套 ①）：事后才告诉他「你选的案例缺披露」，
   *    他手上已经有一份写好的报告要改。所以屏 3 每次进都要调一次
   * ⚠️ `sourceType` 不是 MANUAL 时返回 **null**（那一类走闸 G-10 的署名文本），
   *    界面上要显示「这一类不生成人工录入披露」而不是空白
   */
  previewDisclosure: (data: QlzgCaseSaveVO): Promise<string | null> =>
    request.post({ url: '/qlzg/case/disclosure-preview', data }),

  /**
   * 上传一份佐证材料 ← `QlzgCaseController#uploadEvidence`
   *
   * 🔴 屏 2 与导入向导「来源说明文件」填的是**同一个** `evidenceFileId` 字段，
   *    两条路都走这里。不要改用 `/infra/file/upload`（只返回 URL 字符串，拿不到编号），
   *    也不要走 presign + `/infra/file/create`（落不下 `biz_type`，
   *    存储账单里「案例佐证」会永远是 0 且不报错）
   * 🔴 `request.upload` 返回**整个信封** `{ code, data, msg }`，要自己取 `.data`
   * ⚠️ 单份上限 10 MB（服务端），刻意小于 Spring 的 16 MB，好让报错带 qlzg 错误码
   * ⚠️ 限流 120 次/分钟/人
   */
  uploadEvidence: async (file: File): Promise<QlzgCaseEvidenceUploadVO> => {
    const form = new FormData()
    form.append('file', file)
    const res = await request.upload({ url: '/qlzg/case/upload-evidence', data: form })
    return (res as any).data as QlzgCaseEvidenceUploadVO
  },

  /**
   * 召回预览 ← `QlzgCaseController#recallPreview`
   *
   * 🔴 入参**只有 subjectId 一条路径**：品类码取自项目、基准日取自项目，都不可覆盖
   * 🔴 一个字都不写库（`qlzg_case_match` 由 I3 落测算时写）
   * ⚠️ 项目没有评估基准日时报 `CASE_RECALL_BASE_DATE_REQUIRED`，
   *    那条文案要原样显示，它说的是「去项目上补基准日」
   */
  recallPreview: (subjectId: number): Promise<QlzgCaseRecallVO> =>
    request.get({ url: '/qlzg/case/recall-preview', params: { subjectId } }),

  /** 导入配置 ← `QlzgCaseController#getImportConfig`（品类、数据源、佐证类型、列定义、四个上限） */
  getImportConfig: (): Promise<QlzgCaseImportConfigVO> =>
    request.get({ url: '/qlzg/case/get-import-config' }),

  /**
   * 下载导入模板 ← `QlzgCaseController#getImportTemplate`
   *
   * 🔴 模板**按品类**不同（列清单来自 `qlzg_category`），所以必须先选品类再下载。
   *    不给 `caseKind` 后端会拒 —— 别在前端造一个「通用模板」
   */
  getImportTemplate: (caseKind: string): Promise<any> =>
    request.download({ url: '/qlzg/case/get-import-template', params: { caseKind } }),

  /**
   * 预检 ← `QlzgCaseController#importPreview`
   *
   * 🔴 **一个字都不写库**。权限点是 `:query` 不是 `:create`：只读的人也要能预检
   * 🔴 `request.upload` 返回整个信封，要自己取 `.data`
   * ⚠️ 只回前 `maxPreviewRows`（500）行的明细，`rowsTruncated` 为 true 时界面上要说清
   */
  importPreview: async (file: File, caseKind?: string): Promise<QlzgCaseImportPreviewVO> => {
    const form = new FormData()
    form.append('file', file)
    if (caseKind) form.append('caseKind', caseKind)
    const res = await request.upload({
      url: '/qlzg/case/import-preview',
      data: form,
      timeout: 120_000
    })
    return (res as any).data as QlzgCaseImportPreviewVO
  },

  /**
   * 开始导入 ← `QlzgCaseController#importExecute`
   *
   * 🔴 六个 `@RequestParam` 一个都不能少，其中 `importToken` 必须是**预检那一次用的同一个**
   * 🔴 返回值的 `async` 是唯一的分支判据：true ⇒ 轮询 `/import-progress`
   * ⚠️ 权限点是 `qlzg:case:create`（本控制器刻意没有 `:import` 这个新权限串）
   * ⚠️ 服务器忙时报 `CASE_IMPORT_REJECTED`：文案说的是「任务行已落库且刻意留在 PENDING」，
   *    界面上**要让用户重新提交同一个文件**（同一个 importToken），不要新生成一个
   */
  importExecute: async (
    file: File,
    params: QlzgCaseImportExecuteParams
  ): Promise<QlzgCaseImportExecuteVO> => {
    const form = new FormData()
    form.append('file', file)
    form.append('caseKind', params.caseKind)
    form.append('sourceId', String(params.sourceId))
    form.append('evidenceFileId', String(params.evidenceFileId))
    form.append('evidenceKind', params.evidenceKind)
    form.append('importToken', params.importToken)
    const res = await request.upload({
      url: '/qlzg/case/import-execute',
      data: form,
      timeout: 600_000
    })
    return (res as any).data as QlzgCaseImportExecuteVO
  },

  /**
   * 查异步导入进度 ← `QlzgCaseController#importProgress`
   *
   * 🔴 **停止轮询判 `terminal`，不要判 `status`**
   * 🔴 这个端点顺带做「孤儿任务懒回收」：进程被 kill 之后留下的 RUNNING 任务，
   *    由下一次查询把它判成 INTERRUPTED。所以**不要**因为「看着卡住了」就停止轮询 ——
   *    停了它就永远不会被回收
   */
  importProgress: (taskId: number): Promise<QlzgCaseImportProgressVO> =>
    request.get({ url: '/qlzg/case/import-progress', params: { taskId } }),

  /**
   * 导出案例台账 ← `QlzgCaseController#exportCaseList`
   *
   * 🔴 权限点是 `:query`，**不是**新造的 `:export`：新权限串没有对应按钮菜单时，
   *    非超管会**静默**失去导出能力（全程 200 无异常）
   * 🔴 不走 `request.download`：那个封装拿不到响应头，而「有没有被 20000 行上限截断」
   *    正是走 `X-Export-Truncated` 传的
   */
  exportExcel: (params: any, currentPage: boolean) =>
    exportExcelWithMeta('/qlzg/case/export-excel', { ...params, currentPage })
}
