import request from '@/config/axios'

/**
 * 报告（读模型）← 后端 {@code QlzgReportRespVO}
 *
 * <h3>🔴 `templateVersionId` 才是渲染基准，`templateId` 只用于列表页显示</h3>
 * 报告创建那一刻后端把「模板的当前已发布版」解析出来**钉**在报告行上，
 * 之后模板再发新版，这份**在制**报告的版式也不动。
 * 界面上任何「打开这份报告用的模板」的动作都要走 `templateVersionId`；
 * 走 `templateId` 的话，模板一发新版，评估师看到的模板与渲出这份报告的模板
 * 就不是同一份了 —— 而两者都能打开、都不报错，只有并排看才发现段落换了页。
 *
 * <h3>🔴 `editable` 由服务端落定，前端不要自己按 `status` 再判一次</h3>
 * 字段写入与成文共用这一个判据。自己判一次的后果是「按钮亮着、点下去报错」，
 * 而一个只会报错的按钮比没有按钮更让人怀疑工具。
 *
 * <h3>🔴 `composeStale = true` 时必须显示「请重新成文」</h3>
 * 它说的是「成过文，但之后字段值又改过，那份 Word 已经不是库里的值」。
 * 不提示的话评估师会把一份**旧值**的 Word 交出去，而两份文件在纸面上
 * 长得一模一样 —— 只有逐字比对才发现某一格是改之前的数。
 * 反过来，`composeStale = false` 且 `wordFileId` 为空是「还没成过文」，
 * 那是另一句话，不要共用一个提示。
 *
 * <h3>🔴 `versionNo` 是**本报告**的第几版，与模板版本号是两套号</h3>
 * 界面上同时出现两个「版本」时必须写清楚是谁的版本。
 *
 * <h3>🔴 `tokenCost` 是 D2 验收的判定列，M0 恒为 0</h3>
 * 要显示出来，而且**不要**格式化成「¥0」以外的东西 —— 它是「这份报告零成本」
 * 的可对账证据，客户 IT 会拿它去和库里的 `mode` 列一起查。
 *
 * <h3>⚠️ `voidedByName` 可能为空</h3>
 * 作废人离岗之后 `system_users` 那一行没了，服务端解析不出姓名。
 * 那时要渲染成「已离岗（编号 1234）」，**不要**渲染成空白 ——
 * 空白会被读成「没有人作废过它」，而 R04 的唯一性查全库含 VOIDED，
 * 一份看不出被谁作废的报告在复核时是一堵墙。
 */
export interface QlzgReportVO {
  id?: number | null
  /** 印在纸上的那一个，机构内唯一、**永不复用** */
  reportNo?: string | null
  projectId?: number | null
  subjectId?: number | null
  templateId?: number | null
  templateVersionId?: number | null
  reportType?: string | null
  reportTypeDescription?: string | null
  title?: string | null
  status?: string | null
  statusDescription?: string | null
  editable?: boolean | null
  voidReason?: string | null
  voidedAt?: Date | null
  voidedBy?: number | null
  voidedByName?: string | null
  versionNo?: number | null
  /** 当前定稿版本行编号，草稿期为空 */
  currentVersionId?: number | null
  /** 🔴 MVP 恒为 M0（零 AI，¥0/份可证明） */
  mode?: string | null
  wordFileId?: number | null
  excelFileId?: number | null
  /** 🔴 > 0 时定稿会被闸 B 拦下。它认的是模板里的**花括号**，修法是改模板 */
  placeholderRemaining?: number | null
  /**
   * 🔴 > 0 时定稿会被 `REPORT_VALUE_MISSING` 拦下。它认的是成文那一刻取不到值的格子
   *    （纸上印出来的【缺值】/【未映射】），修法是**填值**，不是改模板
   *
   * 与 {@link placeholderRemaining} 刻意分成两个数、界面上也必须是两条：
   * 两者都表现为「定不了稿」，而出路完全相反 ——
   * 合成一条的话用户会去改模板，改完发现数没动。
   *
   * 🔴 文案**不要**说成「纸上有 N 处」：数的是去重后的模型键，
   *    一个占位符在纸上出现十次只算 1。要说是哪几格，
   *    去成文响应里的 missing 清单（那才是名字）
   */
  valueMissingCount?: number | null
  composeStale?: boolean | null
  tokenCost?: number | null
  /** 🔴 创建时解析三级配置的**结果**，之后永不随配置变 */
  reviewModeEffective?: string | null
  finalizedAt?: Date | null
  createTime?: Date
}

/** 报告章节 ← 后端 {@code QlzgReportSectionRespVO} */
export interface QlzgReportSectionVO {
  id?: number | null
  reportId?: number | null
  /** 顶层为 0 */
  parentId?: number | null
  sectionCode?: string | null
  sectionTitle?: string | null
  clauseRef?: string | null
  schemaPath?: string | null
  level?: number | null
  /** 🔴 文档顺序。§11.18 的中断「停在章节边界」说的就是这一列的边界 */
  sort?: number | null
  /** STATIC / PHRASE / MIXED */
  contentMode?: string | null
  renderStatus?: string | null
  wordBookmark?: string | null
  /** 🔴 前端靠它决定要不要显示「本节还没填」，不要自己去数字段行 */
  fieldCount?: number | null
}

/**
 * 报告字段行 ← 后端 {@code QlzgReportFieldRespVO}
 *
 * <h3>🔴 `rendered` 是**服务端格式化后**的显示值，含单位。前端只读它、不要自己拼</h3>
 * 自己拼的话「万元」「%」「㎡」这些单位就会与品类 `param_schema` 里配的漂开，
 * 而报告纸面上印的是拼出来的那一个 —— 一份法定报告里同一个量出现两种单位，
 * 复核时会问是谁改的。
 *
 * <h3>🔴 `valueNum` 是**原值**，无千分位</h3>
 * 要千分位就用 `rendered`。`valueNum` 是给输入框回填的，
 * 把它格式化之后再发回去会被 `GATE_A_NUMERIC_LEAK` 一类校验拒掉。
 *
 * <h3>🔴 `isMarked` 由服务端按 `source_type` 落定，**不接受提交**</h3>
 * 它是「这一格需要人看一眼」的红标。`isConfirmed` 是「人看过并认了」。
 * 改值会把 `isConfirmed` 打回 false —— 而**只改 `sort` 或 `placeholder` 不会**，
 * 因为那两列不动值。界面上不要把「调个顺序」提示成「你之前的确认作废了」，
 * 那会让评估师开始怀疑这个工具在乱改他的东西。
 */
export interface QlzgReportFieldVO {
  id?: number | null
  reportId?: number | null
  /** 可空 —— 页眉与首页表格里那几格不属于任何一节 */
  sectionId?: number | null
  fieldKey: string
  /** 中文名（取自品类 `param_schema` 的标签），取不到时回落成字段键 */
  label?: string | null
  /** TEXT / AMOUNT / RATE / AREA / COUNT / DATE */
  fieldKind: string
  rendered?: string | null
  unit?: string | null
  valueStr?: string | null
  valueNum?: number | null
  valueDate?: string | null
  valueJson?: Record<string, any> | null
  /** MANUAL / PHRASE / CALC / PARAM / EXTRACT / AI / DEFAULT */
  sourceType: string
  sourceRefId?: number | null
  provenanceId?: number | null
  isMarked?: boolean | null
  isConfirmed?: boolean | null
  confirmedBy?: number | null
  confirmedAt?: Date | null
  /** 占位符名（不含花括号）。为空时渲染按字段键回落 */
  placeholder?: string | null
  sort?: number | null
}

/**
 * 待填格 ← 后端 {@code QlzgReportFieldPendingRespVO}
 *
 * 🔴 这**不是**一行还没写的字段，而是「模板要、库里还没有的一格」。
 *    它在库里**没有行**：`qlzg_report_field.source_type` 是 NOT NULL 且无默认值，
 *    那一列刻意把字段行的诞生点钉在「值被确定下来的那一刻」，
 *    所以一份刚建出来的报告 `getFieldList` 返回 0 行是**正确**状态，不是数据丢了。
 *
 * 🔴 清单由服务端按**冻结**的 `section_schema_snapshot` 派生，前端**不要**自己算：
 *    品类当前的章节树是同一件事的**第二份口径**，品类改一个字这里就多/少一格，
 *    而那一格存下去之后可能反查不到节、静默存成孤儿（Word 照出正文、复核看不见）。
 */
export interface QlzgReportFieldPendingVO {
  /** 这一格该落在哪一节。🔴 保存时**原样带上**，服务端走的仍是同一份派生 */
  sectionId: number
  sectionCode: string
  sectionTitle?: string | null
  fieldKey: string
  /** 中文名（品类 `param_schema` 的标签），取不到时回落成字段键 */
  label?: string | null
  unit?: string | null
  /** TEXT / AMOUNT / RATE / AREA / COUNT / DATE。认不出来的 kind 服务端已回落成 TEXT */
  fieldKind: string
  /** 品类是否声明成必填。🔴 它**不是**定稿闸的判据，只用来排序与标星 */
  required?: boolean | null
  /**
   * 这一格是不是**按格判事实**的那一种（S04 三格 / S06 四类依据 / S08 三段披露 / S12 三件）
   *
   * 🔴 true 的含义：读它的规则按**合取**判 —— 缺这一格不是「这一节短一段」，
   *    而是少一个恒为 false 的布尔，那条规则会对每一份报告判红。
   *    false 的那一批只要求整节有正文，几格里填任意一格就够
   */
  factBacked?: boolean | null
}

/** 字段值保存（写模型）← 后端 {@code QlzgReportFieldSaveReqVO} */
export interface QlzgReportFieldSaveVO {
  /** 不传 = 新建这一格；传了 = 改已有的那一格 */
  id?: number | null
  reportId: number
  sectionId?: number | null
  fieldKey: string
  fieldKind: string
  placeholder?: string | null
  sort?: number | null
  valueStr?: string | null
  valueNum?: number | null
  valueDate?: string | null
  valueJson?: Record<string, any> | null
  sourceType: string
  sourceRefId?: number | null
  provenanceId?: number | null
}

/** 成文结果 ← 后端 {@code QlzgReportComposeRespVO} */
export interface QlzgReportComposeVO {
  reportId?: number | null
  reportNo?: string | null
  wordFileId?: number | null
  fileName?: string | null
  url?: string | null
  /** 🔴 true = S3 预签名直链；false = **带一次性令牌**的中转路由（私有化部署的常态）。
   *  ⚠️ 它**不是**「成功与否」，也不能用来判过期 —— 判据是 `expireSeconds` 有值 */
  presigned?: boolean | null
  /** **实际生效**的秒数（后端夹在 60–300）。🔴 直链与中转**都有值** */
  expireSeconds?: number | null
  /**
   * 🔴 出稿期闸 B 数出来的残留占位符个数
   *
   * > 0 时**定稿**会被拦，但**成文本身是成功的** —— 那份带【缺值】标记的 Word
   * 已经生成好了，评估师要下载它才能看出缺的是哪一格。
   * 界面上要把这件事说成「成文完成，但有 N 处未闭合，定稿前必须补齐」，
   * 不要说成「成文失败」：说成失败他会去重试，而重试一百次也是同一处缺值。
   */
  placeholderRemaining?: number | null
  /** 取不到值的模型键清单。渲染产物上它们显示为【缺值】或【未映射】 */
  missing?: string[]
  /** 模板声明了、而 I30 之前刻意不给数据的键（三个签章位） */
  reserved?: string[]
  /**
   * ⚠️ 被本次成文**替换掉**的那一份 docx 的编号
   *
   * 🔴 它**不会被删**（`FileApi` 没有删除方法），所以每重新成文一次
   *    就多一份孤儿字节，而它们都算客户的存储账单。这条欠账记在 I6。
   *    界面上不要把它显示成「已清理」。
   */
  replacedFileId?: number | null
}

/** 成稿读取地址 ← 后端 {@code QlzgReportWordFileRespVO} */
export interface QlzgReportWordFileVO {
  reportId?: number | null
  reportNo?: string | null
  wordFileId?: number | null
  fileName?: string | null
  fileSize?: number | null
  url?: string | null
  /** 🔴 true = S3 预签名直链；false = **带一次性令牌**的中转路由（私有化部署的常态）。
   *  ⚠️ 它**不是**「成功与否」，也不能用来判过期 —— 判据是 `expireSeconds` 有值 */
  presigned?: boolean | null
  /** **实际生效**的秒数（后端夹在 60–300）。🔴 直链与中转**都有值**；
   *  令牌是**单程票**，用掉一次就没了，所以这个地址**不能**存下来复用 */
  expireSeconds?: number | null
  /** 🔴 false = 下载到的是一份**草稿**。界面与文件名都要把这件事说出来 */
  finalized?: boolean | null
  placeholderRemaining?: number | null
}

/**
 * 报告版本（清单行）← 后端 {@code QlzgReportVersionRespVO}
 *
 * <h3>🔴 这里**没有** `snapshotJson`、也**没有** `diffFromPrev`</h3>
 * 前者是几十 KB 的档案正文，清单页不需要它（后端那个查询显式投影掉了这一列）；
 * 后者在库里**恒为 null** —— 定稿那条写路径刻意不算 diff，红标一律走
 * {@link QlzgReportApi.getVersionDiff} 现算。
 * ⚠️ 所以前端**不要**去判 `diffFromPrev`：判不出来的时候很容易显示成
 *    「本版没有变更」，而真相是「这一列压根没人写」。
 *
 * <h3>🔴 `diffable = false` 时那句话必须是「这是第一版，没有可比的上文」</h3>
 * **不能**写成「本版没有变更」。两句话在复核人眼里是完全不同的结论，
 * 而后者会让他签一份压根没比对过的字。
 *
 * <h3>⚠️ `creatorNickname` 可能为空</h3>
 * 定稿人离岗之后 `system_users` 那一行没了。那时渲染成「已离岗（编号 1234）」，
 * **不要**渲染成空白 —— 与 {@link QlzgReportVO.voidedByName} 同一条处置：
 * 「这一版是谁定的」在档案意义上认的是 `creator` 那个编号，人名只是当下好读。
 */
export interface QlzgReportVersionVO {
  id?: number | null
  reportId?: number | null
  /** 第几版，**只增不回退** */
  versionNo?: number | null
  /** 🔴 第 1 版为空是设计：第 1 版没有「变更」，强制它只会让所有人写「初始版本」 */
  changeSummary?: string | null
  wordFileId?: number | null
  excelFileId?: number | null
  /** 🔴 MVP 恒为空（Word→PDF 归 I7）。空着读起来是「那一版没有 PDF」，那是一个真事实 */
  pdfFileId?: number | null
  createTime?: Date | null
  creator?: string | null
  creatorNickname?: string | null
  /** 是否是 `qlzg_report.current_version_id` 指的那一版 */
  current?: boolean | null
  diffable?: boolean | null
}

/**
 * 一条字段级红标 ← 后端 {@code QlzgReportVersionDiffRespVO.FieldDiff}
 *
 * <h3>🔴 `oldValue` / `newValue` 是**快照里的原样字串**，前端不要再格式化一次</h3>
 * 格式化要读品类的 `param_schema` 才知道单位与小数位，而那份 schema 是**活的** ——
 * 三年后单位改了，同一份 diff 就会显示成另一个数，
 * 红标就不再是「当年看见的那一条」。单位写在标签上，不要拼进值里。
 *
 * <h3>🔴 `changeKinds` 是**数组**：一条红标可以同时属于多种</h3>
 * 「值变了 + 来源也从 CALC 变成 MANUAL」是一条，不是两条 ——
 * 拆成两条的话复核人会在清单里看见同一个字段键出现两次，
 * 而他会以为改了两处。
 */
export interface QlzgReportVersionFieldDiffVO {
  fieldId?: number | null
  fieldKey?: string | null
  /** TEXT / AMOUNT / RATE / AREA / COUNT / DATE */
  fieldKind?: string | null
  /** 🔴 两版都没冻章节时为空（形状 1 的老快照）。那时要写「这一版没冻章节」，
   *  不要留空白也不要写 `—`：这一格属于哪一节是**有答案**的，只是没被冻进快照 */
  sectionTitle?: string | null
  placeholder?: string | null
  /** 取值见 {@link REPORT_VERSION_DIFF_FIELD_KINDS} */
  changeKinds?: string[]
  oldValue?: string | null
  newValue?: string | null
  oldSourceType?: string | null
  newSourceType?: string | null
  oldSourceRefId?: number | null
  newSourceRefId?: number | null
  oldProvenanceId?: number | null
  newProvenanceId?: number | null
  oldMarked?: boolean | null
  newMarked?: boolean | null
  oldConfirmed?: boolean | null
  newConfirmed?: boolean | null
}

/** 一条章节级红标 ← 后端 {@code QlzgReportVersionDiffRespVO.SectionDiff} */
export interface QlzgReportVersionSectionDiffVO {
  sectionId?: number | null
  sectionCode?: string | null
  /** 取值见 {@link REPORT_VERSION_DIFF_SECTION_KINDS} */
  changeKinds?: string[]
  oldSectionTitle?: string | null
  newSectionTitle?: string | null
  /** 🔴 它是 G-04 的输入：改了条款号等于换了一条法律依据，不是排版 */
  oldClauseRef?: string | null
  newClauseRef?: string | null
  oldContentMode?: string | null
  newContentMode?: string | null
  oldSort?: number | null
  newSort?: number | null
  oldLevel?: number | null
  newLevel?: number | null
}

/**
 * 报告版本红标 ← 后端 {@code QlzgReportVersionDiffRespVO}（§11.11.3）
 *
 * <h3>🔴 它的价值不在「好看」，在**复核人的注意力分配**</h3>
 * 40 页报告逐字读要 40 分钟，看红标只要 3 分钟。所以界面上**只列变了的行**，
 * 不变的行一条都不要显示 —— 全给就等于没给。
 *
 * <h3>🔴 `comparable = false` 时**必须**把那句 `reason` 原样印出来</h3>
 * 字段与章节各有自己的一对（`fieldComparable` / `sectionComparable`）。
 * I6-b 之前定稿的版本读得出字段、而**没有**冻章节，那种版本是
 * 「字段可比、段落不可比」—— 合成一句话就分不清是哪种。
 * ⚠️ 空清单在界面上读起来是「本版没有变更」，而真相是「没法比」。
 *    复核人看完会签字，签的是一份没有比对过的东西。**假绿比红标更坏。**
 *
 * <h3>🔴 `templateVersionChanged` 为 `null` 表示**不知道**，不是「没变」</h3>
 * 版式换了会让**每一段**正文都可能变，而字段级红标**比不出**这件事 ——
 * 它比的是值，版式变了值可以一个字没动而纸上完全不同。所以三态要分别显示：
 * `true` → 要说（用 `versionDiffTemplateText`）；`false` → 不提；
 * `null` → 「这一版没记下用的是哪一版版式，无法判断」。
 *
 * <h3>🔴 `firstVersion = true` 时两个清单都是空的，而「空」的含义是没有上文</h3>
 * 界面要写「这是第 1 版，没有可比的上文」，**不要**写「本版没有变更」。
 */
export interface QlzgReportVersionDiffVO {
  reportId?: number | null
  toVersionNo?: number | null
  toVersionId?: number | null
  /** 🔴 第 1 版为空 */
  fromVersionNo?: number | null
  fromVersionId?: number | null
  firstVersion?: boolean | null
  toChangeSummary?: string | null
  fieldComparable?: boolean | null
  fieldNotComparableReason?: string | null
  sectionComparable?: boolean | null
  sectionNotComparableReason?: string | null
  /**
   * 🔴 这两个是 `qlzg_template_version` 的**行编号**，不是「第几版」。
   * 界面上**不要**印成「第 700 版 → 第 701 版」—— 那是一句假话，
   * 而它读起来又完全像一个版本号。要说版式变没变，用 `templateVersionChanged`
   */
  fromTemplateVersionId?: number | null
  toTemplateVersionId?: number | null
  templateVersionChanged?: boolean | null
  fieldDiff?: QlzgReportVersionFieldDiffVO[]
  sectionDiff?: QlzgReportVersionSectionDiffVO[]
  changedFieldCount?: number | null
  /** 🔴 单列出来的理由：复核人最先要问的是「有没有哪一段散文被改过」 */
  changedParagraphCount?: number | null
  changedSectionCount?: number | null
}

export const QlzgReportApi = {
  /**
   * 建一份报告 ← `/create`
   *
   * 🔴 报告是按**标的**出的，不是按项目：一个项目下可以有多个标的，
   *    而法定报告的抬头是标的。传 `projectId` 是不行的。
   * 🔴 `templateId` 会被服务端解析成**当前已发布版**并钉在报告行上
   *    （`templateVersionId`）。所以没发布过的模板建不出报告 ——
   *    模板选择器要用 `onlyPublished = true` 那一份清单。
   * 🔴 创建时 `mode` 显式写 M0、`tokenCost` 写 0，**不靠列默认值**：
   *    靠默认值的话 I9 加 M2 那天所有历史报告的档位都变成「没记」，
   *    而 D2 的验收 SQL 正是按这一列筛的。
   */
  createReport: (data: {
    subjectId: number
    templateId: number
    reportType: string
    title?: string | null
  }): Promise<number> => request.post({ url: '/qlzg/report/create', data }),

  getReport: (id: number): Promise<QlzgReportVO> =>
    request.get({ url: '/qlzg/report/get', params: { id } }),

  /**
   * 某项目下的报告清单（**不分页**）← `/list-by-project`
   *
   * 🔴 没有「全部报告」的端点：报告台账是**从项目进去**的，
   *    与「测算」「结果确定」两页同一个入口形状。
   */
  getReportListByProject: (projectId: number): Promise<QlzgReportVO[]> =>
    request.get({ url: '/qlzg/report/list-by-project', params: { projectId } }),

  /**
   * 定稿 ← `/finalize`
   *
   * <h3>🔴 那几道闸是**有顺序**的，而顺序是有产品含义的</h3>
   * 按「评估师当场能改」的先后排，于是**一次**报错就指向**一件**他能立刻做的事。
   * 前端**不要**自己预先跑一遍这些检查再决定要不要发请求 ——
   * 前端的顺序迟早会与后端漂，而漂了之后他会先补完 12 个占位符、
   * 再被拦一次说「你还没成文」。每拦一次，他都要重新读一遍那句报错、
   * 重新找一遍那个按钮。正确做法是发请求，然后把后端那句原文显示出来。
   *
   * <h3>🔴 `changeSummary` 第 2 版及以后必填，第 1 版留空</h3>
   * 逼他为一版「初始定稿」编一句他只会写「首次定稿」的摘要，
   * 等于没有这一项。
   *
   * ⚠️ 返回的是**版本行**编号，不是报告编号。
   * ⚠️ 权限点 `qlzg:report:finalize`。
   * 🔴 复核档位解析成 OFF 的机构，必须先在「机构内控配置」页留下那份书面说明
   *    （`qlzg_review_waiver`，`ack_text` 是逐字快照），否则 `REVIEW_OFF_UNTRACED` 是硬闸、
   *    **一份也定不了稿**。界面上要把那句原文显示出来，不要吞掉它自己去猜原因。
   */
  finalizeReport: (data: {
    reportId: number
    changeSummary?: string | null
  }): Promise<number> => request.put({ url: '/qlzg/report/finalize', data }),

  /**
   * 退回修订 ← `/reopen`
   *
   * 🔴 这条边**不做**三件事：不再写一行版本快照、不清 `finalizedAt`、
   *    不清 `currentVersionId`。已定稿的那一版是法定档案，退回修订只是
   *    让**当前草稿**可写，不是把档案撤回去。
   *    界面上的措辞要照这个事实写：「退回修订」而不是「撤销定稿」。
   * ⚠️ 权限点与定稿同一个（`qlzg:report:finalize`）：能定稿的人才能退回。
   */
  reopenForRevision: (id: number): Promise<boolean> =>
    request.put({ url: '/qlzg/report/reopen', params: { id } }),

  /**
   * 作废 ← `/void`
   *
   * 🔴 `voidReason` 必填非空白，且是**留痕**而不是提示：
   *    R04 的报告号唯一性查全库**含 VOIDED**，所以作废掉的号也不会被复用。
   *    30 年后翻档案的人要能回答「这一份为什么作废」。
   *    对话框必须要求填理由，**不要**给一个「无」的默认值 ——
   *    一个所有人都填「无」的必填项等于没有这一项。
   * 🔴 任意状态都能作废（包括已定稿）。已定稿的报告作废后仍然是档案，
   *    只是不能再用它出交付物。
   */
  voidReport: (data: { reportId: number; voidReason: string }): Promise<boolean> =>
    request.put({ url: '/qlzg/report/void', data }),

  getSectionList: (reportId: number): Promise<QlzgReportSectionVO[]> =>
    request.get({ url: '/qlzg/report/section/list', params: { reportId } }),

  getFieldList: (reportId: number): Promise<QlzgReportFieldVO[]> =>
    request.get({ url: '/qlzg/report/field/list', params: { reportId } }),

  /**
   * 待填格清单 ← `/field/pending-list`
   *
   * 🔴 它**随填写进度变化**：某个键在这份报告里已经有行了（不论绑在哪一节、
   *    不论有没有值），它就不再出现在清单里。判据是「键有没有行」而不是
   *    「那一行有没有值」—— 后端渲染一个键只渲**一行**（同键多行取 sort 最小的那一行），
   *    再建第二行会**静默不渲**：存值 200、清单里那一格消失、Word 里仍是旧值。
   *    所以「有行但值是空的」那一格要去改**已有那一行**，不在本清单里。
   * 🔴 方法子节（S07-1…S07-5）按「这份报告用了哪几个方法」过滤，口径与**成文**一致。
   *    还没做结果确定时那五节一格都不出 —— 那是如实的：还没定方法就填一个结果值，
   *    是把一个没算过的数写进法定报告。
   */
  getPendingFieldList: (reportId: number): Promise<QlzgReportFieldPendingVO[]> =>
    request.get({ url: '/qlzg/report/field/pending-list', params: { reportId } }),

  /**
   * 存一格字段值 ← `/field/save`
   *
   * 🔴 四态一起搬，**空的也要搬**（传 null）：后端用 `FieldStrategy.ALWAYS`，
   *    靠一个显式的 null 把旧那一态清掉。只传「有值的那一态」的话，
   *    从 TEXT 改成 DATE 之后 `value_str` 里的旧文本还在，
   *    而渲染按 `fieldKind` 只读一态 —— 库里躺着一个谁也不读的旧值，
   *    出问题时排查方向会跑到渲染器上去。
   * 🔴 值变了会把红标打回未确认（`isConfirmed` → false）；
   *    只改 `sort` 或 `placeholder` **不会**。
   * 🔴 值变了会把 `composeStale` 置 1（前提是这份报告成过文）。
   */
  saveFieldValue: (data: QlzgReportFieldSaveVO): Promise<number> =>
    request.post({ url: '/qlzg/report/field/save', data }),

  /**
   * 插一条话术 ← `/field/insert-phrase`
   *
   * 🔴 **先 `/render` 预览、看完 `warnings` 再插**。
   *    `warnings` 非空说明正文里有原样保留的片段（例如一段 `{{...}}`），
   *    静默插进去的后果要到成文那一刻才显形：出稿期闸 B 会把它数成一个残留，
   *    而那份 Word 上印着两个花括号，评估师那时候已经想不起来是哪一步带进来的。
   * 🔴 话术必须已经通过审核（`review_status = APPROVED`），否则后端拒。
   * 🔴 插完会把这一节的 `content_mode` **往前**推（STATIC → PHRASE → MIXED），
   *    而 I26 要靠 MIXED 的数量决定往话术库补什么。前端不需要管这件事，
   *    但**不要**在插入后又调一次 `/field/save` 覆盖它 —— 那是第二次写，
   *    会把话术来源改成 MANUAL，溯源就断了。
   */
  insertPhrase: (data: {
    reportId: number
    sectionId: number
    phraseId: number
    fieldKey: string
    placeholder?: string | null
    sort?: number | null
  }): Promise<number> => request.post({ url: '/qlzg/report/field/insert-phrase', data }),

  /**
   * 确认一个红标 ← `/field/confirm`
   *
   * 🔴 确认**不会**把 `composeStale` 置 1：它不动值，那份 Word 仍然是库里的值。
   *    所以「确认完 12 个红标」之后不需要重新成文 —— 界面上不要提示他重新成文，
   *    一次多余的成文就多一份孤儿字节（`FileApi` 没有删除方法）。
   * 🔴 定稿的第二道闸要求「标红字段全部已确认」（R16），
   *    所以这个按钮在草稿期是主路径，不是可选动作。
   */
  confirmField: (id: number): Promise<boolean> =>
    request.put({ url: '/qlzg/report/field/confirm', params: { id } }),

  /**
   * 给一格字段挂上「资料原文」依据（MATERIAL 类溯源）← `/field/attach-material`
   *
   * 🔴 这是一个**单独**的动作，**不要**并进 `saveFieldValue`：
   *    并进去的话「补一次出处」会连带触发「值变了 ⇒ 那份已成文的 Word 不作数」
   *    与「值变了 ⇒ 红标确认打回未确认」，
   *    一次纯证据动作会静默毁掉评估师此前的确认。
   *    所以调完本方法**不要**再调一次 `saveFieldValue`。
   *
   * 🔴 三个入参全是**指针**，一个字的证据内容都不收：
   *    原文由服务端从 `qlzg_material.text_content` 里按段号取。
   *    让请求体决定「哪一段原文当证据」，就等于让调用方可以提交一段
   *    与原件不符的文字，而弹层照样弹出、照样显示，界面上看不出任何异常。
   *
   * 🔴 `paragraphNo` 从 **1** 开始，取自 `QlzgMaterialApi.getParagraphs`，
   *    前端**不许**自己切段 —— 前端另切一套的话，选择器上显示的「第 12 段」
   *    与落库的 `s12` 会指向不同的文字。
   *
   * 🔴 **幂等**：同一段资料重复挂返回已有的那一行编号，不新写。
   *    但同一份资料的**另一段**、或另一份资料的同一段号，都是新的一行 ——
   *    一格的值同时有两份资料佐证是常见情形（面积看权证、现状看查勘记录）。
   *
   * 🔴 它**不**动 `field.provenanceId`（那一列是「这一格的主出处」，由 `saveFieldValue`
   *    落定，而定稿第五道闸读的正是它）。所以挂完依据之后，
   *    那一格的「有没有主出处」状态不变 —— 这是对的，
   *    否则一格**没有值**的字段也能过那道覆盖率闸。
   *
   * @returns 溯源行编号（新写的或沿用的那一行）
   */
  attachMaterialProvenance: (data: {
    fieldId: number
    materialId: number
    paragraphNo: number
  }): Promise<number> => request.post({ url: '/qlzg/report/field/attach-material', data }),

  /**
   * 成文 ← `/compose`
   *
   * <h3>🔴 上传位于每一道闸之后 —— 这个**顺序**就是「失败不留产物」的兑现</h3>
   * 任何一条可达的失败路径（报告已定稿 / 已作废 / 模板字节取不回来 / 渲染抛异常）
   * 都还没写过任何字节。所以前端**不需要**在失败后做任何清理，
   * 也**不要**为失败准备一个「删除刚才那份文件」的按钮 —— 没有那份文件。
   *
   * <h3>🔴 重新成文会替换掉旧的那一份，而旧的**不会被删**</h3>
   * `replacedFileId` 就是它的编号。每成文一次多一份孤儿字节，归 I6。
   *
   * <h3>🔴 `placeholderRemaining > 0` 时成文**仍然是成功的**</h3>
   * 见 {@link QlzgReportComposeVO} 上的说明。不要按它去弹红条。
   *
   * <h3>⚠️ 成文是重活，按钮要禁用并显示进行中</h3>
   * 四十页的 docx 渲染 + 上传要几秒。不做禁用的话评估师会连点，
   * 而每一次点击都是一份新的孤儿字节。
   */
  composeReport: (id: number): Promise<QlzgReportComposeVO> =>
    request.post({ url: '/qlzg/report/compose', params: { id } }),

  /**
   * 取成稿的读取地址 ← `/word-url`
   *
   * <h3>🔴 计量发生在**点击那一刻**，不是在成文那一刻</h3>
   * 成文了但从来没人下载的报告，流量是 0。所以「取地址」这个动作
   * **就是**一次计量事件，不要为了「刷新一下界面」而反复调它 ——
   * 那会在客户的账单上出现一排他从来没做过的下载。
   * 正确用法：只在用户点「下载」时调一次，拿到 url 立刻打开。
   *
   * <p>⚠️ 中转那一支（`presigned = false`）落的不是 `INTENT` 而是 `RELAY`（字节真的出去之后记，
   * 是实测值），所以反复调它不会立刻在账单上多出行 —— 但**不要**据此认为它是免费的：
   * 每调一次就铸一枚新的有效令牌，TTL 之内谁捡到都能用一次。
   *
   * <h3>🔴 中转路由（`presigned = false`）是私有化部署的常态，`window.open` 直接能开</h3>
   * `/infra/file/{configId}/get/**` 挂着 `permitAll`（`window.open` 带不上 `Authorization` 头），
   * 所以不需要带**登录态**，也不需要走 `request.download`。
   * 🔴 但地址里的 `?relay_token=…` **不能丢**：那是放行判据的一半，
   * 后端核销它时是一条 Redis `DEL`，用过即废。所以这个 url **只能原样交给
   * `window.open`**，不要自己去拼、也不要把它拆开重组 —— 剪掉 query 的表现是 403
   * 「该文件不允许通过此通道下载」，看着像权限没配。
   *
   * ⚠️ 从没成过文时报 `REPORT_WORD_FILE_MISSING`，文案里带报告号。
   *    界面要把它显示成「还没成过文」，并给一个「成文」按钮 ——
   *    只弹一句报错的话，评估师不知道下一步该点哪里。
   * 🔴 `finalized = false` 时下载到的是一份**草稿**，文件名与界面都要说出来。
   */
  getWordFileUrl: (id: number): Promise<QlzgReportWordFileVO> =>
    request.get({ url: '/qlzg/report/word-url', params: { id } }),

  /**
   * 取一份报告的全部版本 ← `/version/list`
   *
   * <h3>🔴 降序，最新在前；一份报告还没有任何版本时给**空清单**</h3>
   * 草稿报告就是这个状态（版本行只在**定稿**那一刻写），它不是错误。
   * 界面上要写成「这份报告还没有定稿过，所以还没有版本」，
   * 而不是显示一个空表格让人以为功能坏了。
   *
   * <h3>🔴 `diffable = false` 的那句话必须是「这是第一版，没有可比的上文」</h3>
   * **不能**写成「本版没有变更」——两句话在复核人眼里是完全不同的结论，
   * 而后者会让他签一份压根没比对过的字。
   * ⚠️ 后端按「清单里实际有没有第 N-1 版」判，不按 `versionNo > 1` 判：
   *    版本号缺号时（档案被动过）它同样报 `false`，
   *    那时点开 diff 会得到 `REPORT_VERSION_NOT_EXISTS`，
   *    而列表页上先说「比不了」比点进去报错要好。
   *
   * <h3>⚠️ `creatorNickname` 可能为空</h3>
   * 后端查不到人时**刻意**给 `null` 而不是「未知用户」这类占位串：
   * 占位串会在界面上显示成一个看着像人名的东西。
   * 空的时候要写成「已离岗（编号 1234）」—— 定稿人是《资产评估法》
   * 第二十六条的责任锚点，把「查不到」伪装成「查过了，没有这个人」是不行的。
   */
  getVersionList: (reportId: number): Promise<QlzgReportVersionVO[]> =>
    request.get({ url: '/qlzg/report/version/list', params: { reportId } }),

  /**
   * 取某一版与它上一版之间的红标 ← `/version/diff`
   *
   * <h3>🔴 只含**变了的**行，不变的行一条都不给</h3>
   * 一份报告几百格，全给就等于没给。红标的价值全在复核人的注意力分配：
   * 40 页逐字读要 40 分钟，看红标只要 3 分钟（§11.11.3）。
   * 所以「清单是空的」在这里**是**一个有意义的结论（这一版什么都没改），
   * 与下面那条 `comparable = false` 要分开显示 —— 后者是「没法比」。
   *
   * <h3>🔴 `fieldComparable` / `sectionComparable` 为 false 时**必须**把那句 reason 原样印出来</h3>
   * 不能显示成「没有变化」。I6-b 之前定稿的版本，快照里读得出字段、而**没有**冻章节，
   * 拿它当「段落没有变化」报出来是一份假的红标清单。
   * **假绿比红标更坏**：复核人看完会签字，签的是一份没有比对过的东西。
   * ⚠️ 两对标记**各说各的**，不要合成一句话 —— 「字段可比、段落不可比」
   *    是一种真实存在的状态，合并之后就读不出是哪一半比不了。
   *
   * <h3>🔴 `templateVersionChanged` 是三态，`null` 不是 `false`</h3>
   * `true` → 要说，而且是 warning：版式换了会让每一段正文都可能变，
   * 而字段级红标比不出这件事（它比的是值）；
   * `false` → 什么都不用说；
   * `null` → 「这一版没记下用的是哪一版版式，无法判断」。
   * 把 `null` 当 `false` 显示，等于对着一份可能整篇重排过的报告说「版式没变」。
   * 文案一律走 `versionDiffTemplateText`，**不要**把那两个编号印成「第 N 版」。
   *
   * <h3>⚠️ 第 1 版不报错</h3>
   * `firstVersion = true`，两对 comparable 都是 `false`，reason 是「这是第 1 版，
   * 没有可比的上文」。前端只需要**一条**规则：`comparable == false ⇒ 印 reason`。
   * 🔴 而版本号**缺号**（要看第 5 版、库里没有第 4 版）会报
   *    `REPORT_VERSION_NOT_EXISTS`，文案里写着「缺号意味着档案被动过」——
   *    那句要原样显示，不要换成「加载失败」。
   */
  getVersionDiff: (reportId: number, versionNo: number): Promise<QlzgReportVersionDiffVO> =>
    request.get({ url: '/qlzg/report/version/diff', params: { reportId, versionNo } })
}
