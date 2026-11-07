import request from '@/config/axios'

/**
 * 溯源**清单行**（不含原文快照）← 后端 `QlzgProvenanceListRespVO`
 *
 * 🔴 这个类型上**刻意没有** `snapshotText`。清单端点的 SQL 压根不 select 那一列
 *    （`mediumtext`，一份报告几百行），于是后端返回的 JSON 里它恒为 `null`。
 *    合成一个类型的话，「投影没取」与「这条真的没有快照」在 TS 上无法区分，
 *    而后者是一个必须报出来的缺陷（§11.8.2 要求快照必填）。
 *    分开之后这里**读不到**那个属性 —— 读不到就不会误读，编译期就过不去。
 *    原文快照走 {@link QlzgProvenanceVO}。
 *
 * 🔴 每一列都来自 `qlzg_provenance` 自己，一个都不 join 活表。
 *    所以 `sourceId` 是**线索**不是外键：它悬空是**预期内**的
 *    （资料文件被删了、案例来源网站下线了、模板改版了），
 *    而《资产评估法》第 29 条要求档案 15 / 30 年间可读。
 *    ⚠️ 因此**不要**拿 `sourceId` 去查案例名 / 参数名 / 模板名再拼进弹层 ——
 *    那会让「三年后还能读」这句话变成假的，而界面上看不出任何异常。
 */
export interface QlzgProvenanceListVO {
  id: number
  /** 🔴 可空：I3 阶段（测算与口径冻结）写下的溯源还没有报告可挂，I4 成文时回填 */
  reportId?: number | null
  /** 🔴 可空，且 PARAM / CALC / CASE 三类在报告字段存在之前就写了 */
  fieldId?: number | null
  /** 来源类型码，取值见 `PROVENANCE_SOURCE_TYPE_OPTIONS` */
  sourceType: string
  /**
   * 来源类型中文名，由**后端**按枚举翻好下发
   *
   * 🔴 显示一律用它，**不要**在前端再维护一份中文映射：
   *    枚举是随版本发布的常量，两份映射迟早漂开，
   *    而漂开的表现是「同一个类型在清单上叫 A、在弹层上叫 B」
   */
  sourceTypeDescription?: string
  /**
   * 来源记录编号，🔴 **多态外键**：指向哪张表由 `sourceType` 决定
   * （MATERIAL→资料、CASE→案例、PARAM→参数、CALC→测算或结果、
   *   TEMPLATE→模板版本、AI→报告章节、MANUAL→报告字段即本格自己）。
   * 🔴 只有 `DEFAULT` 一类真的没有来源记录，本列为空是正常的
   */
  sourceId?: number | null
  /**
   * 定位符，🔴 **原样显示**，不要解析、不要重新格式化
   *
   * 逐类的形状：MATERIAL 是「{文件名} s{段号}」、PARAM 是四维回退路径原样、
   * CASE 是「终选记录 qlzg_case_match #{id}」、CALC 是「{方法} 第 {步序} 步（{步骤码}）」、
   * TEMPLATE 是「{模板}#v{版本}§{章节}」、MANUAL 是「录入人 {编号} @ {时间}」。
   * ⚠️ 它是**写下来那一刻**的一份快照，不是查询期拼出来的 ——
   *    前端另拼一份的话，弹层与 Excel 批注会对同一个事实给出两种写法，
   *    质询现场会被当成两份不同的证据
   */
  locator: string
  /** 原文快照文件编号，弱引用 `infra_file.id`。🔴 可空，悬空也是正常的 */
  snapshotFileId?: number | null
  /** 原文被取下来的时刻。🔴 与 `createTime`（入库时刻）**刻意分开**，批量补写时两者可以差几天 */
  snapshotAt?: string | null
  /**
   * 案例直达链接。🔴 **会失效**，而它失效不影响本行的证据力 —— 证据力在原文快照上。
   * 渲染成一个「去看看原网页」的便利链接，打不开时提示「链接可能已失效，快照仍在」，
   * **不是**报错
   */
  originUrl?: string | null
  /**
   * 数据源要求的署名文本。🔴 这是**合同义务**不是客套话（闸 G-10 / R47），
   * 所以它**不**在渲染时 join 数据源 —— 署名要求后来改了，已出报告的署名不能跟着改
   */
  attribution?: string | null
  /**
   * 算式文本。🔴 CALC 类装的是可读算式，TEMPLATE 类装的是**准则条款号**
   * （§11.8.1 把 clause_ref 放在这一格里）。所以标题要按类型切，见
   * `provenanceFormulaLabel`
   */
  formulaText?: string | null
  /** 置信度。🔴 只有 `sourceType=AI` 的行才有值，其余一律为空 —— 为空时**不显示**这一项 */
  confidence?: number | null
  createTime?: string
  /** 写下这一行溯源的用户编号。🔴 与 `creatorNickname` 一起给：人名会被改，编号不会 */
  creator?: string | null
  /**
   * 写下这一行溯源的人名，由后端在装配那一刻批量换来。
   * 🔴 换不出来时是「用户 {编号}」而不是空 —— 让缺的那一份是**可见**的
   */
  creatorNickname?: string | null
}

/**
 * 溯源**弹层行** = 清单行 + 原文快照 ← 后端 `QlzgProvenanceRespVO`
 *
 * 🔴 验收 D8 的判据②③都落在这个类型上：
 * ②「弹层内容 100% 来自 `qlzg_provenance`，没有一句是 LLM 生成的」——
 *   后端那个端点只 select 那一张表、一个 join 都没有，所以这条判据不是靠
 *   「我们承诺不接模型」保证的，是靠**取数口只有这一张表**保证的：想生成一句也没地方生成。
 * ③「显示快照本身而不是一个链接」——「本身」就是 {@link snapshotText}。
 *
 * 🔴 `snapshotText` 必须**原样**渲染：`pre-wrap`、不用 `v-html`、不 trim、不美化。
 *    它是**写下来那一刻的原文**，包括原文里的换行、多余空格、错别字与全半角混用。
 *    ⚠️ 不用 `v-html` 不是风格问题：原文里可能有 `<script>`（资料是从外部上传的），
 *       那是存储型 XSS，而这一列恰好是全模块唯一一个
 *       「把用户文件里的字节直接下发给浏览器」的口。
 *    ⚠️ 不「顺手美化」也不是洁癖：三年后质询现场比对的是这一段字节与那份纸质资料，
 *       动过之后就对不上了，而对不上的那一份是**平台**改的。
 */
export interface QlzgProvenanceVO extends QlzgProvenanceListVO {
  snapshotText: string
}

export const QlzgProvenanceApi = {
  /**
   * 一格报告字段的**全部**溯源（含原文快照）—— 溯源弹层的取数口
   *
   * 🔴 返回的是数组，前端**不要**只渲染第一条：一格可以有多行
   *    （比较法的一个单价同时来自测算与三条案例），
   *    而写错一条要更正时也是**再加一行**（那张表没有 update）。
   *    只渲染第一条的话「更正行」永远显示不出来，而两行都在才是诚实的档案。
   */
  getListByField: (fieldId: number): Promise<QlzgProvenanceVO[]> =>
    request.get({ url: '/qlzg/provenance/list-by-field', params: { fieldId } }),

  /**
   * 按编号取一行（含原文快照）
   *
   * ⚠️ 给「从别处已经拿到一个溯源编号要点开看」那种入口用
   *    （口径冻结面板上的「看依据」、报告字段的主出处指针）。
   *    🔴 那几列都**可空**，所以**先判空再调**：拿一个 null 或一个悬空的编号打过来，
   *    得到的是一个报错弹框，而「这一格还没有依据」应当显示成一句提示，不是一个错误。
   */
  get: (id: number): Promise<QlzgProvenanceVO> =>
    request.get({ url: '/qlzg/provenance/get', params: { id } }),

  /**
   * 一份报告的全部溯源（清单，**不含**原文快照）
   *
   * 🔴 顺序是 `id` 升序 = 入库顺序，也就是「先测算依据、后报告字段依据」，
   *    与评估师在报告上读到它们的先后大致一致。
   * ⚠️ 后端**刻意不按类型分组**：八类的字母序对读者没有任何意义，
   *    分组是前端的活（按报告章节顺序、或按「本格依据」聚）。
   *    后端排一份「看起来分了组」的顺序、前端再排一次，两份口径迟早漂开。
   */
  getListByReport: (reportId: number): Promise<QlzgProvenanceListVO[]> =>
    request.get({ url: '/qlzg/provenance/list-by-report', params: { reportId } })
}
