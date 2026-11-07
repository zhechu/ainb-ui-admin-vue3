import request from '@/config/axios'

/**
 * 闸 B 的一条发现 ← 后端 {@code QlzgTemplateClosureVO.FindingVO}
 *
 * 🔴 `blocking` 是**原样透传当年判定的结果**，不要按 `type` 在前端重推一次。
 *    重推的后果是「后端说不阻断、前端标红」，评估师按前端的提示改了半天，
 *    发布时却一次就过 —— 他会得出结论：这个工具的提示是装饰。
 */
export interface QlzgTemplateClosureFindingVO {
  type: string
  typeDescription?: string
  blocking?: boolean | null
  /** 占位符**原文**（含花括号与语法符号），可为空 */
  placeholder?: string | null
  fieldKey?: string | null
  /** 给人读的整句。🔴 直接渲染，不要自己拼 */
  message?: string | null
}

/**
 * 闸 B 占位符闭合的结论 ← 后端 {@code QlzgTemplateClosureVO}
 *
 * <h3>🔴 三态，不是两态</h3>
 * `PENDING` = 从没跑过（刚建出来、还没上传 docx 的模板就是这个状态）。
 * 界面上必须与 `FAILED` 区分开：`FAILED` 是「跑过了，有阻断项」，
 * `PENDING` 是「还不知道」。把 `PENDING` 显示成「未通过」会让评估师
 * 去改一个根本没问题的模板，而他会找不到要改什么。
 *
 * <h3>🔴 `passed` 不要自己按 `findings` 再算一次</h3>
 * 算两次就会漂：判定规则（哪些 type 阻断）在后端的
 * {@code QlzgClosureFindingTypeEnum} 上，前端抄一份就多了一份真相。
 *
 * <h3>🔴 `findings` 含**非阻断**项，不要过滤掉</h3>
 * 非阻断的那一批正是「能发布，但你该知道」的东西 —— 例如
 * `SEAL_RESERVED`（公章位预留到 I30）。只显示阻断项的话，
 * D15 第 ⑥ 条要求的「界面上要说一句公章位已预留」就没有落点。
 */
export interface QlzgTemplateClosureVO {
  status: string
  statusDescription?: string
  passed?: boolean | null
  blockingCount?: number | null
  findings?: QlzgTemplateClosureFindingVO[]
}

/**
 * 映射面板的一行 ← 后端 {@code QlzgTemplateSuggestionVO}
 *
 * <h3>🔴 `placeholder` 是**原文**，也就是保存映射时要传回去的那个键</h3>
 * 它含花括号与语法符号（`{{?sections}}`、`{{#case_table}}`、`{{@seal_image}}`），
 * 而 `name` 是剥掉这些之后的名字。**传 `name` 上去后端认不出来** ——
 * 同一个 `name` 在标量位与区块位是两条不同的映射。
 *
 * <h3>🔴 `occurrences` > 1 时改一次绑定要生效多处</h3>
 * 四十页里出现 3 次的字段，评估师只会在第一处改。界面上要把这个数显示出来，
 * 否则他会以为另外两处漏改了，然后去改第二处（而后端已经一起改了）。
 *
 * <h3>🔴 `needsConfirmation` 由后端判，前端不要自己比 `boundBy`</h3>
 * 目前只有 `AUTO_SIMILAR`（相似度猜的）那一档需要人工点一次确认，
 * 而这条规则会变；前端抄一份就会在后端放宽之后仍然拦着人。
 *
 * <h3>🔴 `candidates` 在**未映射**的行上也给</h3>
 * 未映射不禁止发布（§11.17.3 第 ② 条），但要写一句为什么。
 * 给备选是为了让「绑上去」比「写理由」更省力 —— 顺序反了的话
 * 评估师会一律选写理由，而模板里就留下一堆空占位符。
 *
 * <h3>🔴 `rendererVisible = false` 意味着 poi-tl 认不出它，会**原样印在报告上**</h3>
 * 这是最常见的一类模板缺陷（Word 把 `{{address}}` 拆成了三个 run）。
 * `suggestion` 是建议改成的写法，而平台**不代改** docx：
 * 评估师要下载原件、在 Word 里改、再传一次。界面上要给那个下载链接。
 */
export interface QlzgTemplateSuggestionVO {
  placeholder: string
  sign?: string | null
  name?: string | null
  location?: string | null
  occurrences?: number | null
  fieldKey?: string | null
  boundBy?: string | null
  boundByDescription?: string | null
  confirmed?: boolean | null
  needsConfirmation?: boolean | null
  candidates?: string[]
  unmappedReason?: string | null
  rendererVisible?: boolean | null
  diagnostics?: string[]
  suggestion?: string | null
}

/** 模板（读模型）← 后端 {@code QlzgTemplateRespVO} */
export interface QlzgTemplateVO {
  /** 🔴 读模型必填、写模型可空，理由同 {@link QlzgPhraseVO.id} */
  id: number
  templateName: string
  /** 🔴 建好之后改不了：改品类等于换一份模板 */
  categoryCode: string
  reportType: string
  reportTypeDescription?: string
  /** 🔴 判据是 tenant_id = 0。为真时不可上传 docx，只能 `/copy` 一份再改 */
  platform?: boolean | null
  orgId?: number | null
  /** 当前**草稿**的 docx 文件编号。刚建出来的模板这里是空的 */
  fileId?: number | null
  /** 给人看的版本号文本，与版本行的 `versionNo`（int，单调递增）**不是一回事** */
  versionNo?: string | null
  sectionSchemaVersion?: string | null
  supportsMode?: string[]
  /** 闸 B 三态：PENDING / PASSED / FAILED */
  placeholderClosureStatus?: string | null
  placeholderClosureStatusDescription?: string | null
  placeholderClosureDetail?: Record<string, any>[] | null
  isPublished?: boolean | null
  publishedBy?: number | null
  publishedAt?: Date | null
  /** 被多少份报告用过。🔴 它是「能不能删」的另一个视角，要显示出来 */
  usageCount?: number | null
  /** 🔴 `qlzg_report` 记的是这个数（的版本行 id），不是模板 id */
  currentVersionId?: number | null
  createTime?: Date
}

/** 模板版本（不可变）← 后端 {@code QlzgTemplateVersionRespVO} */
export interface QlzgTemplateVersionVO {
  id?: number | null
  templateId?: number | null
  /** 🔴 单调递增，**回滚也走递增** */
  versionNo?: number | null
  /** 🔴 与草稿行的 `fileId` 是**两个独立文件**：这一份是当年冻结的原件 */
  fileId?: number | null
  sectionSchemaVersion?: string | null
  /** 🔴 回滚产生的版本这里是**空的**（回滚不重跑渲染） */
  sampleRenderFileId?: number | null
  placeholderClosureStatus?: string | null
  placeholderClosureStatusDescription?: string | null
  placeholderClosureDetail?: Record<string, any>[] | null
  sealPosition?: Record<string, any> | null
  publishedBy?: number | null
  publishedAt?: Date | null
  isCurrent?: boolean | null
  /** 🔴 versionNo > 1 时必填；回滚时也必填 */
  changeNote?: string | null
  createTime?: Date
}

/** 解析 / 保存映射的返回 ← 后端 {@code QlzgTemplateParseRespVO} */
export interface QlzgTemplateParseVO {
  templateId?: number | null
  fileId?: number | null
  fileName?: string | null
  /** 🔴 评估师要「下载下来在 Word 里改」，这是设计器的主路径 */
  fileUrl?: string | null
  /** 🔴 false = 非 S3 存储，`fileUrl` 是**带一次性令牌**的中转路由而不是直链（私有化部署的常态）。
   *  ⚠️ 它**不是**「成功与否」，也不能用来判过期 —— 判据是 `expireSeconds` 有值，
   *  两种形态**都会过期**（完整理由见 `src/api/qlzg/file/index.ts` 里那份 VO 的注释） */
  presigned?: boolean | null
  /** **实际生效**的秒数（后端夹在 60–300）。🔴 直链与中转**都有值** */
  expireSeconds?: number | null
  suggestions?: QlzgTemplateSuggestionVO[]
  /** 🔴 只含闸 B ①②。③（渲染预演）在预览与发布时才跑 */
  closure?: QlzgTemplateClosureVO | null
  /** 自动映射率（百分比整数），§11.17.3 第 ① 条要显示的那个数 */
  autoMappedRatePercent?: number | null
}

/** 预览的返回 ← 后端 {@code QlzgTemplatePreviewRespVO} */
export interface QlzgTemplatePreviewVO {
  templateId?: number | null
  /** 🔴 false 时下面三个地址字段都是空的，界面要转而显示 `closure` 里的原因 */
  rendered?: boolean | null
  fileId?: number | null
  fileName?: string | null
  url?: string | null
  /** 🔴 false = 非 S3 存储，`url` 是**带一次性令牌**的中转路由。
   *  ⚠️ 界面判「要不要提示过期」的条件是 `expireSeconds` 有值，**不是**这一列 ——
   *  两种形态都会过期（`TemplateDesigner.vue` 那句倒计时提示就挂在这个条件上） */
  presigned?: boolean | null
  /** **实际生效**的秒数（后端夹在 60–300）。🔴 直链与中转**都有值** */
  expireSeconds?: number | null
  /** 闸 B ③（渲染预演）的结论 */
  closure?: QlzgTemplateClosureVO | null
}

/** 发布 / 回滚的返回 ← 后端 {@code QlzgTemplatePublishRespVO} */
export interface QlzgTemplatePublishVO {
  templateId?: number | null
  /** 🔴 它就是 `qlzg_report.template_version_id` 会记下的那个数 */
  versionId?: number | null
  versionNo?: number | null
  /** 发布成功时一定 passed；🔴 **回滚时是 PENDING**（回滚不重跑闸 B） */
  closure?: QlzgTemplateClosureVO | null
  /** 🔴 预留到 I30 的签章位。发布不因此报错，但界面要说一句「公章位已预留」 */
  reserved?: string[]
}

/** docx 下载地址 ← 后端 {@code QlzgTemplateDownloadRespVO} */
export interface QlzgTemplateDownloadVO {
  templateId?: number | null
  fileId?: number | null
  fileName?: string | null
  url?: string | null
  /** 🔴 false = 非 S3 存储，url 是**带一次性令牌**的中转路由（`?relay_token=…`）。
   *  ⚠️ 那条路由挂着 `permitAll`（`window.open` 带不上 `Authorization` 头，所以令牌走 query），
   *  但**不等于谁都能开**：后端按「biz_type 白名单 + 令牌」两条判据放行，令牌用过即废 */
  presigned?: boolean | null
  /** **实际生效**的秒数（后端夹在 60–300）。🔴 直链与中转**都有值** */
  expireSeconds?: number | null
  /**
   * 🔴 true = 这一份是版本行上**冻结**的原件，不是草稿
   *
   * 界面上必须说清楚「改它不会生效」：版本行不可变，
   * 下载冻结件是为了看当年那一份长什么样。不说清楚的话
   * 评估师会以为自己在修订一个已发布的版本，改完上传，
   * 而上传只会写到草稿行 —— 他会以为发布过的版本被他改掉了
   */
  frozen?: boolean | null
}

/** 映射面板上的一条编辑 ← 后端 {@code QlzgTemplateMappingSaveReqVO.Item} */
export interface QlzgTemplateMappingEditVO {
  /** 🔴 占位符**原文**，含花括号与语法符号。传 `name` 后端认不出来 */
  placeholder: string
  /** 要绑到的字段键，**空 = 解绑** */
  fieldKey?: string | null
  /** 未映射的原因。§11.17.3 第 ② 条：未映射不禁止发布，但要写一句为什么 */
  unmappedReason?: string | null
  /** 确认 / 撤销确认。**null = 不动这个标记** */
  confirmed?: boolean | null
}

export const QlzgTemplateApi = {  createTemplate: (data: {
    templateName: string
    categoryCode: string
    reportType: string
    versionNo?: string | null
  }): Promise<number> => request.post({ url: '/qlzg/template/create', data }),

  updateTemplate: (data: {
    id: number
    templateName?: string | null
    versionNo?: string | null
    supportsMode?: string[] | null
  }): Promise<boolean> => request.put({ url: '/qlzg/template/update', data }),

  deleteTemplate: (id: number): Promise<boolean> =>
    request.delete({ url: '/qlzg/template/delete', params: { id } }),

  getTemplate: (id: number): Promise<QlzgTemplateVO> =>
    request.get({ url: '/qlzg/template/get', params: { id } }),

  /**
   * 只扫不写：重扫库里那一份 docx，返回与解析同形的结果 ← `/scan`
   *
   * <h3>🔴 设计器**打开时**就要调它</h3>
   * 映射存在模板行上，而**占位符清单只能从字节里来**。不调它的话，
   * 评估师重新打开一份**已经发布、二十二处全绑好**的模板，看到的是一个空面板
   * 加一句「还没有解析过这一份 docx」—— 与事实相反，他会以为自己丢了绑定。
   *
   * <h3>🔴 权限点是 `:query` 不是 `:update`，而且平台公共模板也能扫</h3>
   * 只读动作不改动共享的东西，与预览、下载同一条理由。
   *
   * ⚠️ 它**只跑闸 B ①②**，返回的 `closure` 与模板行上冻结的那一份**不是同一次**判定
   *    （发布时跑的是 ①②③）。所以打开设计器时**只取 `suggestions`**，
   *    闸 B 那块仍然复述行上的 `placeholderClosureDetail` ——
   *    混用两次判定会让面板与台账给出两个不同的结论。
   * ⚠️ 模板还没上传过 docx 时它抛 `TEMPLATE_NO_DOCX`，调用方要失败得起。
   */
  scanTemplate: (templateId: number): Promise<QlzgTemplateParseVO> =>
    request.get({ url: '/qlzg/template/scan', params: { templateId } }),

  /**
   * 模板清单（**不分页**）
   *
   * 🔴 `onlyPublished = true` 是报告创建页要的那一份：没发布过的模板
   *    解析不出 `template_version_id`，选了它报告建不出来。
   *    台账页则要 `false`（或不传），否则草稿期的模板看不见、也就永远发不了第一版。
   */
  getTemplateList: (categoryCode?: string | null, onlyPublished?: boolean | null) =>
    request.get({
      url: '/qlzg/template/list',
      params: { categoryCode: categoryCode ?? undefined, onlyPublished: onlyPublished ?? undefined }
    }) as Promise<QlzgTemplateVO[]>,

  /**
   * 复制一份成为本机构的模板 ← `/copy`
   *
   * 🔴 这是改平台公共模板的**唯一**路径：公共模板不可上传 docx
   *    （`TEMPLATE_PLATFORM_NOT_EDITABLE`），因为改它会影响所有机构。
   *    界面上「复制为机构模板」这个按钮在 `platform = true` 的行上必须存在，
   *    否则那一行是一堵墙 —— 看得见、点不动、也不告诉你为什么。
   */
  copyTemplate: (sourceTemplateId: number, newTemplateName: string): Promise<number> =>
    request.post({
      url: '/qlzg/template/copy',
      params: { sourceTemplateId, newTemplateName }
    }),

  getVersionList: (templateId: number): Promise<QlzgTemplateVersionVO[]> =>
    request.get({ url: '/qlzg/template/version/list', params: { templateId } }),

  getVersion: (id: number): Promise<QlzgTemplateVersionVO> =>
    request.get({ url: '/qlzg/template/version/get', params: { id } }),

  /**
   * 上传 docx 并解析（设计器第 ②③ 步）← `/parse`
   *
   * <h3>🔴 `request.upload` 与 get/post/put/delete **不同形**</h3>
   * 那几个返回信封里的 data，而 upload 返回**整个信封** `{ code, data, msg }`，
   * 所以要自己取 `res.data`。漏掉这一步的表现是「解析成功了，但面板上一行都没有」。
   *
   * <h3>🔴 已有的映射**优先于**本次自动判定</h3>
   * 评估师改了 Word 重新上传一次，四十条手工绑定不会因此全丢。
   * 所以「重新上传」是安全的操作，界面上不要为它加二次确认 ——
   * 加了确认他会以为要重做一遍映射，于是宁可不传，模板就停在旧版式上。
   *
   * ⚠️ 平台公共模板不能上传，要先 `/copy`。
   * ⚠️ 单文件上限 = `spring.servlet.multipart.max-file-size`（**16 MB**）。
   *    超了是 Spring 的 `MaxUploadSizeExceededException`，**没有 qlzg 错误码**，
   *    所以前端要先自己拦一道并给出人话。
   */
  parseDocx: async (templateId: number, file: File): Promise<QlzgTemplateParseVO> => {
    const form = new FormData()
    form.append('templateId', String(templateId))
    form.append('file', file)
    const res = await request.upload({ url: '/qlzg/template/parse', data: form })
    return (res as any).data as QlzgTemplateParseVO
  },

  /**
   * 保存映射面板上的编辑 ← `/save-mapping`
   *
   * 🔴 `edits` 是**增量**：没出现在清单里的条目保持原样。
   *    所以不要为了「保险」把整张面板都发上去 —— 那会把
   *    `confirmed = null`（不动）语义变成「撤销确认」，
   *    而评估师下一次解析时会看到自己点过的确认全没了。
   * 🔴 保存之后后端会**重跑闸 B ①②** 并返回与解析一样完整的结果，
   *    所以调用方要用返回值刷新整张面板，不要只改本地那几行。
   */
  saveMapping: (data: {
    templateId: number
    edits: QlzgTemplateMappingEditVO[]
  }): Promise<QlzgTemplateParseVO> => request.put({ url: '/qlzg/template/save-mapping', data }),

  /**
   * 预览（**真渲染**）← `/preview`
   *
   * <h3>🔴 渲染失败**不抛异常**</h3>
   * 返回 `rendered = false` + `closure` 里带原因。因为「哪一处残留了」
   * 是要**显示给他看**的东西，不是要弹红条的错误 —— 弹红条他会去重试，
   * 而重试一百次也是同一个残留。
   *
   * <h3>⚠️ 限流 60 次/分钟/人，是防存储无界增长，不是防刷</h3>
   * 每调一次就往 `infra_file` 写一份渲染产物，而预览件**没有保留期策略**
   * （那条欠账在 I6）。所以**不要**把它放进 `watch` 里自动触发 ——
   * 一个漏了条件的 watch 会在几分钟里攒出几百份没人看的产物，
   * 而它们都算客户的存储账单。正确用法是「预览」按钮，人手点。
   *
   * 🔴 平台公共模板**可以**预览（§11.17.4 来源 ③ 的第一步）。
   */
  previewRender: (templateId: number): Promise<QlzgTemplatePreviewVO> =>
    request.post({ url: '/qlzg/template/preview', params: { templateId } }),

  /**
   * 取一份 docx 的下载地址 ← `/download-url`
   *
   * <h3>🔴 为什么不能直接用解析返回里那个 `fileUrl`</h3>
   * 它只活在「刚解析完那一刻」的返回值里，而地址**一定会过期**（`expireSeconds`，
   * 直链与带令牌的中转两种形态都一样，60–300 秒）。
   * 设计器是评估师一开就是一整天的页面：上午解析、下午才想起来要改一个语法符号，
   * 那时手上已经没有地址了 —— 重新解析一次会重跑自动映射，代价比取一次地址大得多。
   *
   * <h3>🔴 闸 B 那三类阻断项的处置动作全都是「去 Word 里改」</h3>
   * 渲染器认不出、语法符号用错、必填字段没位置 —— 平台**不代改** docx，
   * 所以没有这个端点，那三条处置建议就是三句做不到的话。
   *
   * ⚠️ `versionId` 传了就是取**版本行上冻结的原件**（`frozen = true`），
   *    改它不会生效，界面要把这一句说出来。
   * 🔴 下载**是计量的**（`action = DOWNLOAD`、`biz_id` 是**模板编号**不是 file_id）。
   *    ⚠️ 旧注释这里写的是「不计量，模板 docx 的下载计量是 I6 的欠账」—— 那句已过期：
   *    I6 把计量收进了 `FileServiceImpl#presignGetUrl` 这一处，模板 docx 从此与资料、
   *    报告同一条口径。所以**不要**为了「刷新界面」反复调它，理由与 `/qlzg/file/presign-get`
   *    逐字相同（S3 那一支每调一次就多一行 INTENT，中转那一支每调一次就多一枚有效令牌）。
   */
  downloadUrl: (templateId: number, versionId?: number | null): Promise<QlzgTemplateDownloadVO> =>
    request.get({
      url: '/qlzg/template/download-url',
      params: { templateId, versionId: versionId ?? undefined }
    }),

  /**
   * 发布：闸 B 三道全跑 → 冻结一版 → 切成当前版 ← `/publish`
   *
   * 🔴 **被校验的那一份字节就是被发布的那一份字节**，中间没有第二次上传。
   * 🔴 `changeNote` 在 `versionNo > 1` 时必填。第 1 版留空 ——
   *    逼评估师为它编一句他只会写「初始版本」，
   *    而一句所有人都写同一句话的必填项等于没有这一项。
   * 🔴 `reserved` 非空时要显示「公章位已预留，签章功能在 I30」（D15 第 ⑥ 条）。
   * ⚠️ 权限点是 `qlzg:template:publish`，与 `:update` 分开：
   *    能改草稿的人未必能发版。
   */
  publish: (templateId: number, changeNote?: string | null): Promise<QlzgTemplatePublishVO> =>
    request.post({
      url: '/qlzg/template/publish',
      params: { templateId, changeNote: changeNote ?? undefined }
    }),

  /**
   * 回滚 = 把某个历史版重新发布为一个新的当前版 ← `/rollback`
   *
   * 🔴 版本号**继续递增**，不是改回去：把号设回去会让
   *    「谁在什么时候把这个模板退回了哪一版」这件事不留痕迹，而那正是审计对象。
   * 🔴 回滚**不重跑闸 B**：那一版当年三道全过，而闸 B 的输入在版本行上是冻结的。
   *    重跑的话品类字段清单在这期间改过就会让一版当年合法的模板现在发不出去 ——
   *    而评估师只是想退回上一版。所以返回的 `closure.status` 是 **PENDING**，
   *    界面上不要把它显示成「未通过」。
   * 🔴 `changeNote` 必填，且应当写明「回滚自第 N 版」。
   */
  rollback: (
    templateId: number,
    targetVersionNo: number,
    changeNote: string
  ): Promise<QlzgTemplatePublishVO> =>
    request.post({
      url: '/qlzg/template/rollback',
      params: { templateId, targetVersionNo, changeNote }
    })
}
