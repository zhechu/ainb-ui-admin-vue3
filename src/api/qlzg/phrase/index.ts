import request from '@/config/axios'

/**
 * 话术候选（报告作业台右栏）← 后端 {@code QlzgPhraseCandidateRespVO}
 *
 * <h3>🔴 `score` 是 4 位定标的 BigDecimal，前端**不要做浮点运算**</h3>
 * 序列化过来是数字，而 `0.1 + 0.2 !== 0.3`。要排序就按后端给的顺序
 * （它已经排好了），要显示就直接渲染 —— 一旦前端自己算一次加权或求和，
 * 同一份候选清单在两个浏览器上可能排出不同的顺序，
 * 而评估师会认为「这个工具每次给的建议都不一样」。
 * 显示时用字符串化后的原值，**不要 `toFixed`**：`toFixed` 会补零，
 * 补出来的那一位在后端的明细里没有对应项，对不上账。
 *
 * <h3>🔴 `because` 与 `reasons` 必须显示出来</h3>
 * §11.6.2 要的是**可解释**：评估师要能看出「为什么这一条排第一」。
 * 只显示一个分数的话，那个分数对他没有意义，他只能从头读一遍每条正文 ——
 * 而四十条正文比一句「因为：权利类型=划拨 · 目的=抵押 · 本机构用过 37 次」慢得多。
 * `because` 是拼好的一句，`reasons` 是拆开的清单，两者同源；
 * 窄栏用 `because`，展开用 `reasons`。**不要**自己按 `scoreDetail` 再拼一句。
 *
 * <h3>🔴 `triggered = false` 时 `hitKeys` 仍然如实记着半命中</h3>
 * 而命中键**不加分**（理由在后端 QlzgPhraseScoring 的类注释里）。
 * 界面上不要把 `hitKeys > 0` 显示成「已命中」—— 那会让评估师以为
 * 这一条是按他的标的挑出来的，而它其实只是一个触发条件没满足的兜底。
 */
export interface QlzgPhraseCandidateVO {
  id: number
  phraseName: string
  /** 正文**原文**，占位符未替换。插入时才替换，见 `/render` */
  content?: string | null
  clauseRef?: string | null
  /** 挂在哪个章节，空 = 通用 */
  sectionCode?: string | null
  platform?: boolean | null
  usageCount?: number | null
  score?: number | null
  hitKeys?: number | null
  triggered?: boolean | null
  because?: string | null
  reasons?: string[]
  /** 给机器复算的明细。🔴 只用于「展开看明细」，不要据此重算分数或重拼理由 */
  scoreDetail?: Record<string, any> | null
}

/**
 * 话术渲染（插入前预览）← 后端 {@code QlzgPhraseRenderRespVO}
 *
 * 🔴 `warnings` 非空时前端**必须显示出来再让评估师决定**，不要静默插入。
 *    它记的是「原样保留的片段」—— 例如正文里有一段 `{{...}}`，
 *    那是**模板层**的占位符而不是话术层的 `{field_key}`，话术引擎不动它。
 *    静默插进去的后果要到成文那一刻才显形：出稿期闸 B 会把它数成一个残留，
 *    而那份 Word 上印着两个花括号。评估师那时候已经想不起来是哪一步带进来的。
 */
export interface QlzgPhraseRenderVO {
  phraseId?: number | null
  content?: string | null
  warnings?: string[]
}

/** 话术（读模型）← 后端 {@code QlzgPhraseRespVO} */
export interface QlzgPhraseVO {
  /**
   * 🔴 读模型的 id 是**必填**的，写模型（{@link QlzgPhraseSaveVO}）那一份才可空 ——
   *    这一列来自库里已存在的行，RespVO 由 DO 拷出来，不可能没有。
   *    写成 `id?: number | null` 的代价是每一个 `deletePhrase(row.id)` 都要补一个 `!`，
   *    而那个 `!` 读起来像「这里可能没有 id」，正好把它本来要表达的事实说反了。
   */
  id: number
  phraseName: string
  /** 空 = 通用品类（在每个品类的候选列表里都出现） */
  categoryCode?: string | null
  categoryName?: string | null
  /** 空 = 不限章节（通用话术） */
  sectionCode?: string | null
  sectionTitle?: string | null
  /** 正文**原文**。支持单花括号 `{field_key}` 占位符 */
  content: string
  /** 从正文里解析出的占位符键，按首次出现顺序。🔴 后端解析，前端不要自己扫 */
  placeholders?: string[]
  clauseRef?: string | null
  /** 触发条件，键是标的属性的 field_key、值是字面量，语义是「全部相等才命中」 */
  triggerExpr?: Record<string, any> | null
  /** 基础排序分。🔴 打分公式里**唯一由人给**的一项，且**没有上界** */
  scoreBase?: number | null
  reviewStatus?: string | null
  reviewStatusLabel?: string | null
  reviewedBy?: number | null
  reviewedAt?: Date | null
  /** 空 = 平台公共话术 */
  orgId?: number | null
  usageCount?: number | null
  source?: string | null
  sourceLabel?: string | null
  /**
   * 🔴 为真时**正文与审核状态都不可改**，只能复制一份成机构自有的再改
   *
   * 界面上这一行不能出现「编辑」「审核」「删除」—— 出现了点下去就是
   * `PHRASE_PLATFORM_NOT_EDITABLE`，而一个只会报错的按钮比没有按钮更让人怀疑工具。
   * 该出现的是「复制为机构话术」。
   */
  platform?: boolean | null
  createTime?: Date
  updateTime?: Date
}

/** 话术（写模型）← 后端 {@code QlzgPhraseSaveReqVO} */
export interface QlzgPhraseSaveVO {
  id?: number | null
  phraseName: string
  categoryCode?: string | null
  sectionCode?: string | null
  content: string
  clauseRef?: string | null
  triggerExpr?: Record<string, any> | null
  scoreBase?: number | null
}

export const QlzgPhraseApi = {
  /**
   * 某一节的候选话术（作业台右栏）← `/candidate-list`
   *
   * <h3>🔴 作业台**一律要传当前光标所在的那一节**</h3>
   * 不传（或传空）时后端**只**返回不限章节的通用话术，
   * 不是「返回全部章节的话术」。后者是噪音，且它长得像话术库串味了 ——
   * 评估师在「评估依据」那一节看到「现场查勘」的话术，
   * 会以为这个库没有按章节分开，于是不再信任排序。
   * 🔴 平台种子的 56 条**全部**带非空 `section_code`，
   *    所以漏传参数的表现是右栏**几乎是空的**，而不是「顺序不对」。
   *
   * <h3>🔴 只返回 `review_status = APPROVED` 的行（SQL 闸）</h3>
   * 未审核的话术不会出现在这里 —— 而平台的 56 条种子**目前是 DRAFT**
   * （§16.4 第 1 条：话术库种子「没有一条能由 AI 独立确定」，
   * 而 markReviewed 结构上禁止平台自我审核）。
   * 所以一个还没自己审过话术的机构，右栏会是空的。
   * 界面上要把这件事说清楚：空**不是**故障，是「还没有一条话术通过了审核」。
   *
   * ⚠️ 本端点**只要登录即可**，没有 `@PreAuthorize`（理由见后端类注释）。
   */
  getCandidateList: (reportId: number, sectionCode?: string | null) =>
    request.get({
      url: '/qlzg/phrase/candidate-list',
      params: { reportId, sectionCode: sectionCode ?? undefined }
    }) as Promise<QlzgPhraseCandidateVO[]>,

  /**
   * 把一条话术按当前标的渲染出来（**插入前预览**）← `/render`
   *
   * 🔴 取不到值的占位符是**硬失败**（`PHRASE_PLACEHOLDER_UNRESOLVED`），
   *    不是留个空格 —— 一处被静默清空的空格在一份法定报告里
   *    读起来像「这一项本来就没有」。
   * 🔴 本端点**只算不写**，不加 `usage_count`。所以预览是免费的，
   *    而「先预览再插入」是唯一正确的用法：评估师要能看见替换后的正文
   *    与 `warnings`，再决定要不要把它写进报告。
   * ⚠️ 只要登录即可，没有 `@PreAuthorize`。
   */
  renderForReport: (phraseId: number, reportId: number): Promise<QlzgPhraseRenderVO> =>
    request.get({ url: '/qlzg/phrase/render', params: { phraseId, reportId } }),

  /**
   * 话术库清单（**不分页**，台账页用）← `/library-list`
   *
   * 🔴 与 `/candidate-list` 的差别是**审核状态**：本端点返回全部状态
   *    （DRAFT / APPROVED / REJECTED），因为它给的是管理者；
   *    候选清单只给 APPROVED，因为它给的是正在写报告的评估师。
   *    两个端点不能互相替代，也不要为了「少一个接口」把台账页接到候选清单上 ——
   *    那样管理员永远看不见自己还没审的那些。
   */
  getLibraryList: (categoryCode?: string | null, sectionCode?: string | null) =>
    request.get({
      url: '/qlzg/phrase/library-list',
      params: { categoryCode: categoryCode ?? undefined, sectionCode: sectionCode ?? undefined }
    }) as Promise<QlzgPhraseVO[]>,

  getPhrase: (id: number): Promise<QlzgPhraseVO> =>
    request.get({ url: '/qlzg/phrase/get', params: { id } }),

  createPhrase: (data: QlzgPhraseSaveVO): Promise<number> =>
    request.post({ url: '/qlzg/phrase/create', data }),

  /**
   * 复制一份平台话术成为本机构自有的 ← `/copy-to-org`
   *
   * 🔴 这是改平台公共话术的**唯一**路径。复制出来的那一份是 DRAFT，
   *    要走本机构自己的审核 —— 平台不会替机构背书。
   */
  copyToOrg: (id: number): Promise<number> =>
    request.post({ url: '/qlzg/phrase/copy-to-org', params: { id } }),

  updatePhrase: (data: QlzgPhraseSaveVO): Promise<boolean> =>
    request.put({ url: '/qlzg/phrase/update', data }),

  /**
   * 只改正文 ← `/update-content`
   *
   * ⚠️ 与 `/update` 的区别：`/update` 是整行覆盖（`QlzgPhraseSaveReqVO` 的
   *    `phraseName` 与 `content` 都是 `@NotBlank`），漏传名称会被拦；
   *    本端点只动正文一列。作业台里「就地改一句措辞」走这一条。
   * 🔴 平台公共话术不可改，会报 `PHRASE_PLATFORM_NOT_EDITABLE`。
   */
  updateContent: (id: number, content: string): Promise<boolean> =>
    request.put({ url: '/qlzg/phrase/update-content', params: { id, content } }),

  /**
   * 审核 ← `/review`
   *
   * 🔴 权限点是 `qlzg:phrase:update`，**不是**新造的 `:review`：
   *    新权限串没有对应按钮菜单时，`PermissionScanRunner` 只建出一条
   *    `menu_id = NULL` 的承载行，而 `default_effect = DENY` ——
   *    结果是所有非超管静默失去审核能力，全程 200 无异常。
   * 🔴 平台**结构上不能**自我审核（没有 `system_tenant` id = 0 那一行），
   *    所以 56 条种子一直是 DRAFT，直到某个机构把它们复制过去、或把它们审了。
   */
  reviewPhrase: (id: number, reviewStatus: string): Promise<boolean> =>
    request.put({ url: '/qlzg/phrase/review', params: { id, reviewStatus } }),

  /**
   * 删除（逻辑删）← `/delete`
   *
   * 🔴 已经被报告用过的话术删掉之后，那些报告里的**值不受影响** ——
   *    插入那一刻正文已经落到 `qlzg_report_field.value_str` 上了，
   *    话术行只是它的来源标记。所以删除不是危险操作，
   *    界面上不要为它加「会影响已有报告」这类吓人的话（那是假的）。
   */
  deletePhrase: (id: number): Promise<boolean> =>
    request.delete({ url: '/qlzg/phrase/delete', params: { id } })
}
