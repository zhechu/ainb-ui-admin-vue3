import axios, { type AxiosProgressEvent } from 'axios'
import request from '@/config/axios'
import { exportExcelWithMeta } from '@/utils/exportExcel'

/**
 * 评估资料（I1）—— 上传、秒传、批次、归类、抽取、读取、缺件
 *
 * 与后端 {@code QlzgMaterialController} 的 13 个接口一一对应。
 *
 * <h3>🔴 一次拖拽的完整流程（整包与单个是**同一条**路径，差别只是 files 数组长度）</h3>
 * <pre>
 *   1 × POST /prepare   →  { uploadBatchNo, capacity, items[] }   // 每项一个一次性令牌
 *   N × 三分支之一（**逐项判**，判据是 item 上的字段，不要在前端重写谓词）：
 *     ① item.dedup === true       → 不传字节，直接 POST /confirm { token: item.reuseToken }
 *     ② item.uploadUrl != null    → 裸 axios PUT 字节到预签名地址，再 POST /confirm { token: item.uploadToken }
 *     ③ item.uploadUrl == null    → POST /upload-relay（multipart，token + file）
 *                                    🔴 它的响应**就是** confirm 的响应，**绝不能再调一次 /confirm**
 * </pre>
 *
 * 🔴 分支 ③ 后面那一句是本文件最容易写错的地方：令牌是 Redis `GETDEL` 消费的，
 *    upload-relay 自己已经把它用掉了。再调一次 /confirm 会撞已消费的令牌，
 *    拿到 `MATERIAL_UPLOAD_TOKEN_INVALID`（「上传令牌已失效……请重新拖入文件」）。
 *    表现是**「20 份传完了、弹出 20 个错误」，而数据其实全都落库了** ——
 *    用户会再拖一次，于是库里出现 40 份。
 *
 * 🔴 分支 ③ 不是错误分支，是**私有化部署的常态**：只有 S3 兼容存储支持预签名，
 *    DB / LOCAL / FTP / SFTP 一律走中转。后端在这种情况下**不返回错误码**，
 *    只是让 `uploadUrl` 为 null —— 所以判据必须是「字段在不在」，不能是「有没有报错」。
 *
 * 🔴 浏览器路径**不要**调 `/check-digest`：那是给桌面客户端（LocalBridge）用的预检，
 *    prepare 内部已经用同一条 SQL 查过重了。先探一次不仅多余，还会**白烧一个批次号**
 *    （prepare 一旦调用就原子预留了序号，一份都不确认就是跳号）。
 *
 * 🔴 **没有** `PUT /update`：资料行是证据，可变的只有「归类」与「删除」。
 *    要更正内容只能删了重传（会得到一个新的 materialId），这是刻意的 ——
 *    原地改内容会让已经出过的报告与它引用的资料对不上，而对不上不报错。
 */

// ==================== prepare ====================

/** prepare 请求里的一个文件声明 */
export interface QlzgMaterialPrepareFile {
  /** 文件名。🔴 用 webkitdirectory 收整个文件夹时这里要放**相对路径**还是纯文件名，见 views 侧的 folderFlatten */
  fileName: string
  /** 字节数，可空。只用于展示与「太大就不抽取」预判；🔴 计量以服务端 HEAD 实测为准 */
  fileSize?: number
  /**
   * 小写十六进制 64 位，**可空 = 跳过秒传**
   *
   * 🔴 它是秒传的**唯一入口**：prepare 靠它查重，不传就一律当新文件真上传。
   *    Web 端对 **32 MB 以下**的文件用 `crypto.subtle` 现算（几十到几百毫秒，用户感觉不到），
   *    以上跳过 —— 大文件读完整份字节的代价已经超过它省下的那次上传。
   *    判据与理由见 `views/qlzg/material/uploadLimits.ts` 的 `shouldComputeDigest`。
   *    桌面客户端本地算摘要很快，应该一律传。
   * ⚠️ 不传的代价只是「本来能秒传的变成真上传」，**不会出错**。
   */
  sha256?: string
  mimeType?: string
}

export interface QlzgMaterialPrepareReqVO {
  projectId: number
  /** 🔴 整包与单个走同一入口，差别只是数组长度。后端 @Size(max = 500) */
  files: QlzgMaterialPrepareFile[]
}

/** prepare 返回的逐项结果 —— 🔴 三分支的判据全在这里 */
export interface QlzgMaterialPrepareItem {
  /** 数组下标，与请求 files 的顺序一一对应 */
  index: number
  fileName: string
  /** 是否秒传命中（同租户下已有相同内容的文件） */
  dedup: boolean
  /** 秒传命中时的复用令牌；未命中为空 */
  reuseToken?: string | null
  /** 需要真上传时的确认令牌；秒传命中为空 */
  uploadToken?: string | null
  /**
   * 预签名 PUT 地址（24h 有效）
   *
   * 🔴 **为空表示当前存储不支持直传**，此时走 `/upload-relay`。
   *    ⚠️ 这一列的 @Schema 文本写的是「回落到 POST /infra/file/upload」，那是**过期说法**：
   *    现行契约是 `/qlzg/material/upload-relay`。打到 infra 那个接口**不会消费令牌**，
   *    于是资料行永远不落库，而字节已经在存储里了。
   */
  uploadUrl?: string | null
  /** 存储路径（服务端定的目录 qlzg/material/{projectId}） */
  path?: string
  /** 🔴 注册文件时要**原样**传回的 url，不要自己再签名（confirm 内部用，前端只需不篡改） */
  url?: string
  configId?: number
}

export interface QlzgMaterialPrepareVO {
  /** 批次令牌 —— 🔴 confirm 时**不用它**，用逐项令牌；它只用于服务端把本批进度攒在 Redis */
  batchToken: string
  /** 🔴 服务端发出的批次号（如 1024-20261030-3），**仅供展示，绝不回传** */
  uploadBatchNo: string
  /** 批次日期，如 2026-10-30 */
  batchDate: string
  /** 本批容量上限 = 本次声明的份数，超出即拒绝 */
  capacity: number
  /** 上传端 web/app/desktop，prepare 时定一次整批复用（服务端从头/UA 解析，前端不必传） */
  clientType?: string
  /** 逐文件结果，🔴 顺序与请求 files 一致 */
  items: QlzgMaterialPrepareItem[]
}

// ==================== confirm / relay ====================

export interface QlzgMaterialConfirmReqVO {
  /** 🔴 prepare 返回的**单项**令牌（uploadToken 或 reuseToken），一次性 */
  token: string
  /** 所属标的编号，留空 = 项目级资料 */
  subjectId?: number
  /** 资料类别，见 QlzgMaterialCategoryEnum；留空 = 尚未归类（常态：先传后归类） */
  category?: string
  /** 清单项编码，留空 = 不属于清单任何一项 */
  checklistItemCode?: string
  remark?: string
}

/** confirm 与 upload-relay 的响应，**同一个形状** */
export interface QlzgMaterialConfirmVO {
  materialId: number
  fileName: string
  uploadBatchNo: string
  /** 是否秒传命中（没有真的传字节） */
  dedup: boolean
  /**
   * 🔴 服务端 HEAD 到的**实际**字节数
   *
   * ⚠️ 秒传命中时可能是复用的那份的大小（>0），而计量行记的是 0 —— 两者都对：
   *    这一次没有产生新的存储占用，所以不计费，但资料行要显示它有多大。
   */
  fileSize: number
  /**
   * 抽取状态，见 QlzgExtractStatusEnum
   *
   * ⚠️ 展示用。**不要**拿它判「还在不在抽」—— 用下面的 `extractTerminal`。
   */
  extractStatus: string
  /**
   * 🔴 抽取是否已到终态（FAILED / SKIPPED_TOO_LARGE / SUCCESS 都算终态）
   *
   * 「解析中…」的判据是**它的反面**。这一列由后端 `QlzgExtractStatusEnum#isTerminal()` 投影而来，
   * 前端**不要**自己写 `['PENDING','RUNNING'].includes(status)`：
   * 哪天枚举加一个状态，后端认为它非终态而前端那份集合里没有它，
   * 表现是「不转圈、看着像跑完了、重新抽取按钮也不亮」，这份资料就永久卡在界面上。
   *
   * ⚠️ 终态**不等于**成功。「能不能重抽」是 `!extractTerminal || extractStatus === 'FAILED'`
   *    （后端对非终态但 worker 已失联的也放行，否则卡死的资料一个按钮都点不动）。
   */
  extractTerminal: boolean
  /**
   * 🔴 本批已确认份数（含本次），给进度条用
   *
   * ⚠️ **不要当权威计数**：它是 Redis INCR，业务事务回滚时不回退，可能虚占。
   *    要准确数字就重新拉一次 /page 或 /batch-list。
   */
  confirmedCount: number
  /** 本批容量上限 = prepare 声明的份数 */
  capacity: number
}

// ==================== 秒传预检（桌面端用） ====================

export interface QlzgMaterialCheckDigestReqVO {
  /** 小写十六进制 64 位 */
  sha256: string
  /** 仅用于回显 */
  fileName?: string
}

export interface QlzgMaterialCheckDigestVO {
  /** 同租户下是否已有内容相同的资料（且文件仍可见） */
  hit: boolean
  fileName?: string
  /** 命中时库中那份资料的字节数；未命中为空 */
  fileSize?: number | null
  /**
   * 命中时同租户同摘要的**可见**资料行数
   *
   * ⚠️ >1 是正常的（同一份文件在两个项目各收一次），不是数据重复了。
   */
  materialCount?: number
}

// ==================== 归类 ====================

export interface QlzgMaterialClassifyReqVO {
  /** 🔴 后端 @Size(max = 500)；一次只能归到**一个**清单项，所以选中的 N 份必须同项 */
  ids: number[]
  /** 资料类别，见 QlzgMaterialCategoryEnum */
  category: string
  /** 清单项编码，留空 = 不占任何清单项 */
  checklistItemCode?: string
}

// ==================== 扩展字段（I29） ====================

/**
 * 单份资料的扩展字段写入
 *
 * 🔴 **这里的 {@code ext == null} / {@code {}} 是「清空」，与三个宿主 Save VO 相反**
 *    （那边 {@code null} = 不修改）。后端 {@code QlzgMaterialService#updateExt} 的注释写明了理由：
 *    这个端点存在的唯一目的就是「改扩展字段」，所以调用方**一定**是带着意图来的，
 *    把「没给」解释成「不动」会让「清空」这件事在这个端点上永远做不到 ——
 *    而清空是必需的（字段定义改了、原来那批值作废了）。
 *
 * ⚠️ 所以前端调它之前**必须**先确认 defs 加载成功了：加载失败时发一个 {@code {}} 上去，
 *    就是把这份资料的扩展字段全删了，而界面上显示的是「保存成功」。
 *    {@code ExtFieldSection.vue} 用「加载失败就压根不 emit」来兜住这一条。
 */
export interface QlzgMaterialUpdateExtReqVO {
  id: number
  ext?: Record<string, any> | null
}

// ==================== 读形态 ====================

/** 资料行（分页与详情共用） */
export interface QlzgMaterialVO {
  id: number
  projectId: number
  /** 所属项目编号（展示用，服务端解析） */
  projectNo?: string
  /** 所属标的编号，🔴 为空 = 项目级资料 */
  subjectId?: number | null
  subjectName?: string
  /** 文件编号，弱引用 infra_file.id */
  fileId: number
  /** 🔴 文件名**快照**：收进来时的名字，不随 infra_file 改名而变 */
  fileName: string
  /** 字节数，服务端 HEAD 取得 */
  fileSize: number
  /** 🔴 confirm 时是客户端声明值，抽取任务会用实际字节覆盖 */
  sha256?: string
  mimeType?: string
  /** 资料类别；为空 = 尚未归类 */
  category?: string | null
  /** 资料类别中文名，服务端解析（未知码时回落为码本身） */
  categoryDescription?: string
  /**
   * 🔴 归类置信度。**人工归类时必为 null，不是 1.0000**
   *
   * 所以 null 要显示成「人工」而不是「100%」—— 后者会让人以为机器判的、还很确定。
   */
  classifyConfidence?: number | null
  /** 归类来源，见 QlzgClassifySourceEnum；尚未归类时为空 */
  classifySource?: string | null
  /** 🔴 正文抽取状态，见 QlzgExtractStatusEnum（展示用；判「还在不在抽」用 extractTerminal） */
  extractStatus: string
  /**
   * 🔴 抽取是否已到终态 —— 与 confirm 响应里那一列**同一个事实**
   *
   * 上传完插进列表的行来自 confirm 响应，翻页之后来自这里，判据必须同形，
   * 否则同一份资料会「刚传完时在转圈、翻一页就不转了」。
   */
  extractTerminal: boolean
  extractError?: string | null
  pageCount?: number | null
  /** 清单项编码；为空 = 不属于清单任何一项 */
  checklistItemCode?: string | null
  /**
   * 清单项名称（展示用）
   *
   * ⚠️ 品类 schema 已无此项时**退回编码本身**（不是 null）—— 那是历史资料，
   *    编码仍然要显示出来，否则用户看到一片空白会以为归类丢了。
   */
  checklistItemName?: string | null
  /**
   * 🔴 查勘位置（EXIF 取得，**不可编辑**），如 { lat, lng, address }
   *
   * 它不是「上传时人在哪」，而是「照片是在哪拍的」，两者可以差几千公里。
   */
  surveyLocation?: Record<string, any> | null
  /** 🔴 查勘时间 = 站在现场那一刻，与 createTime（何时传上来）不同 */
  surveyTime?: Date | null
  /** 上传端 web/app/desktop */
  uploaderClientType?: string
  /** 🔴 上传批次号，服务端发出 */
  uploadBatchNo: string
  remark?: string | null
  /**
   * 机构自定义扩展字段的值（I29），键 = {@code qlzg_field_def.field_key}（{@code entityType=QLZG_MATERIAL}）
   *
   * 🔴 资料是**唯一**把扩展字段与业务字段分两个端点写的宿主：分类、抽取那些走
   *    {@code classify} / {@code re-extract}，扩展字段走 {@code updateExt}。
   *    原因是资料行的写入路径太多（prepare/confirm/秒传/批量归类），
   *    把 {@code ext} 挂进每一个 ReqVO 就等于把「整列覆盖」这个动作复制到五处，
   *    而其中任何一处漏带 {@code existing.extJson} 都会静默删掉别的字段的值。
   * 🔴 「一个值都没存过」读出来是 **{@code {}}，不是 {@code null}**（库里那一列是 SQL NULL，
   *    解析成空 Map）。在这个宿主上两者等价（{@code updateExt} 的 {@code null} / {@code {}}
   *    都是「清空」），所以 {@code data.ext ?? null} 拿到 {@code {}} 不会出事 ——
   *    ⚠️ 但别把这句照抄到三个宿主的 Save VO 上，那边 {@code {}} 与 {@code null} **不等价**。
   *    另外停用字段、「出现位置 = 详情」的字段与孤儿键这三类由后端 {@code carryOverReadOnly}
   *    从库里现值补回，前端 {@code loadExtModel} 按 scene 过滤、刻意不带。
   */
  ext?: Record<string, any> | null
  createTime?: Date
}

export interface QlzgMaterialPageReqVO extends PageParam {
  projectId?: number
  /** 标的编号，可空 = 项目级资料 */
  subjectId?: number
  category?: string
  checklistItemCode?: string
  /**
   * 上传批次号 —— 🔴 **只读过滤条件**，点时间线某一批时列出该批资料
   *
   * 它与「prepare/confirm 不许传批次号」不冲突：那边说的是**写入**
   * （前端回传批次号就能把两次提交并成一批，于是「补了三次」看起来像「一次交齐」），
   * 这边只是查询条件，填错了最多查不到东西。
   */
  uploadBatchNo?: string
  extractStatus?: string
  classifySource?: string
  uploaderClientType?: string
  /** 文件名，模糊匹配（LIKE，走 idx_project，不是全文索引） */
  fileName?: string
  /** 🔴 **正文**全文检索关键字（FULLTEXT ngram，布尔操作符后端已剥掉） */
  keyword?: string
  createTime?: string[]
}

/** 上传批次时间线的一项（资料面板左侧那一列） */
export interface QlzgMaterialBatchVO {
  uploadBatchNo: string
  /** 本批资料份数 */
  fileCount: number
  /** 本批字节数合计 */
  totalSize: number
  /** 🔴 本批中尚未归类（category 为空）的份数；>0 时面板应高亮 */
  unclassifiedCount: number
  uploaderClientType?: string | null
  /** 本批第一份资料的收进时间 */
  firstCreateTime: Date
  /** 本批最后一份资料的收进时间 */
  lastCreateTime: Date
}

/** 资料正文 */
export interface QlzgMaterialTextVO {
  id: number
  fileName: string
  extractStatus: string
  /**
   * 🔴 抽取是否已到终态
   *
   * 正文面板尤其要按它判：`textContent` 为 null 有四种原因
   * （排队中 / 正在抽 / 太大跳过 / 失败），前两种要继续转圈、后两种要给结论。
   * 漏掉「非终态」那一支的表现是**把还在抽的资料显示成「没有正文」**，
   * 用户会以为这份是扫描件。
   */
  extractTerminal: boolean
  extractError?: string | null
  /**
   * 🔴 段落数 = 溯源定位（I6）的分母；**没有正文时是 0 而不是 null**
   */
  paragraphCount: number
  /**
   * 抽取出的正文
   *
   * ⚠️ 可能很大，**不要无条件渲染**。
   *    null = 排队中 / 正在抽 / 太大跳过 / 失败（看 extractStatus 分辨）；
   *    🔴 SUCCESS + 空正文是**扫描件的正常终态**，不要标红成「抽取失败」。
   */
  textContent?: string | null
}

/**
 * 资料的**分段**正文 —— 溯源段落选择器的取数口
 *
 * 🔴 这个端点存在的全部理由：**前端不许自己切段**。
 *    切分规则全平台只有后端 `QlzgTextParagraphs` 一份实现，
 *    而段落序号会落进 `qlzg_provenance.locator`（「{文件名} s{段号}」）。
 *    前端另切一套的话，选择器上显示的「第 12 段」与落库的 `s12`
 *    会指向**不同的文字** —— 两个数都合法、都不报错，
 *    只有三年后翻档案的人会发现指错了位置。
 *    所以这里下发的就是**要落库的那一份**切分结果。
 *
 * 🔴 与 {@link QlzgMaterialTextVO} 分成两个类型，分开的是**形状**不是**口径**：
 *    两者背后是同一个 split 实现。合成一个的话就是「同一个 VO，
 *    `textContent` 与 `paragraphs` 二选一有值」，
 *    而那种形状正是后端刚修掉的那一类静默投影缺陷
 *    （同一个字段、两个端点、两个结果、都是 HTTP 200）。
 */
export interface QlzgMaterialParagraphVO {
  id: number
  /** 🔴 溯源定位符的前半截就是它，后端写 locator 时把它拷进去 */
  fileName: string
  extractStatus: string
  /**
   * 🔴 `paragraphs` 为空时**唯一**的处置依据：
   *    `false` = 还在抽（界面该说「等一下再来」），
   *    `true` = 这份资料真的没有可检索正文（扫描件 / 太大被跳过 / 抽取失败）。
   *    只下发空列表的话两种成因在界面上**长得一模一样**，
   *    评估师会对着一份还在抽的资料以为「这份用不了」，转而去挂另一份更差的依据
   */
  extractTerminal: boolean
  extractError?: string | null
  /** 恒等于 `paragraphs.length`；没有正文时是 0 而不是 null */
  paragraphCount: number
  paragraphs: QlzgMaterialParagraphItemVO[]
}

/** 资料的一段正文 */
export interface QlzgMaterialParagraphItemVO {
  /**
   * 🔴 从 **1** 开始，落进 locator 的就是这个数。
   *    档案里出现「s0」会让翻档案的人以为漏了一段
   */
  no: number
  /**
   * 🔴 渲染时用 `pre-wrap` **照原样**显示，不要 `v-html`、不要再格式化。
   *    后端在这一层不做任何加工：`split` 已经定下了字面形状
   *    （逐行 trim、按换行拼接），而它会被原样写进 `qlzg_provenance.snapshot_text`。
   *    前端再折叠一次空白或换一次引号，就会让选择器上看到的与落库的那一份差一点 ——
   *    差的那一点在质询现场叫「与原件不符」
   */
  text: string
}

/** 读取地址 */
export interface QlzgMaterialReadUrlVO {
  /**
   * 🔴 直链或带令牌的中转路由，两种都能直接交给 `window.open`
   *  （令牌在 query 上，而 `window.open` 带不了 `Authorization` 头）
   */
  url: string
  /**
   * 🔴 true = S3 预签名直链（字节不过服务端）；
   *    false = 服务端中转路由（`{domain}/admin-api/infra/file/{configId}/get/{path}?relay_token=…`，
   *    私有化部署的常态，字节过后端堆）
   *
   * ⚠️ 它**不是**「成功与否」，也**不能**用来判过期 —— 两种形态**都会过期**，
   *    判据是 `expireSeconds` 有值。曾经中转那一支不过期、这个字段是 null，
   *    那时「拿 `presigned` 当判据」是能用的；#111 之后不再是
   */
  presigned: boolean
  /** **实际生效**的有效秒数（后端夹在 60–300，资料读取请求的是 300）。
   *  🔴 两种形态都有值：直链是签名的时效，中转是那枚一次性令牌的时效 */
  expireSeconds?: number | null
  fileName: string
  fileSize: number
  /** MIME 类型，供前端决定内嵌预览还是直接下载 */
  mimeType?: string
}

// ==================== 缺件检测 ====================

/** 一个缺的清单项 */
export interface QlzgMissingItem {
  itemCode: string
  /** 清单项名称，如「查勘照片」 */
  name: string
  /**
   * 🔴 法规依据
   *
   * 评估师靠它判断「该补、还是披露一下就能出」，所以这一列**必须显示出来**，
   * 不能只给一个「缺 2 份」的数字。
   */
  lawBasis?: string | null
  /** 应有份数 */
  requiredCount: number
  /** 已到份数 */
  presentCount: number
  /** 还差份数 */
  missingCount: number
}

/**
 * 缺件检测结果（R17）
 *
 * 🔴 集合差、**查询期计算**：清单应有的项码减去资料行已覆盖的项码。
 *    后端刻意**不存** is_required / missing_flag 两列（V4 的做法）——
 *    存下来的缺件状态会与资料行漂移，而漂移不报错，
 *    只会在报告交出去之后被客户发现少了一份材料。
 *    所以前端也**不要缓存**这个结果：每次打开面板都重新拉。
 */
export interface QlzgMaterialMissingVO {
  projectId: number
  categoryCode: string
  /** 是否法定评估业务（影响 required=IF_STATUTORY 的清单项） */
  statutory?: boolean
  /** 清单里**条件成立**的项数（分母） */
  requiredItemCount: number
  /** 🔴 已完全满足的项数 = requiredItemCount − 缺件数。**服务端算好的，前端不要重算** */
  arrivedItemCount: number
  /** 🔴 缺件列表，**为空 = 齐备** */
  missingItems: QlzgMissingItem[]
}

// ==================== 接口 ====================

/**
 * 上传进度回调的入参
 *
 * 🔴 刻意不只是「一个百分比」：V5 §13.7 要求每份文件显示
 *    **名字 + 进度条 + 速度 + 剩余时间**，而速度与 ETA 要拿 `loaded` 的**增量除以时间增量**才算得出来。
 *    只给百分比的话，速度就得靠「百分比差 × 文件总大小」反推 ——
 *    而 `percent` 是取过整的（0-100），一份 500 MB 的文件每 1% 就是 5 MB，
 *    反推出来的速度会一跳一跳，ETA 跟着抖，用户读到的是「卡住了」。
 *    `total` 可空是因为浏览器在响应头缺失时拿不到它（预签名 PUT 一般不会缺，中转可能会）。
 */
export interface QlzgUploadProgress {
  /** 0-100 的整数，直接喂进度条 */
  percent: number
  /** 已传字节 */
  loaded: number
  /** 总字节；拿不到时为空 */
  total?: number
}

/** axios 的进度事件 → 上面那个形状（两处上传分支共用，避免各写一份取整逻辑） */
const toProgress = (evt: AxiosProgressEvent): QlzgUploadProgress => ({
  percent: evt.progress != null ? Math.round(evt.progress * 100) : 0,
  loaded: evt.loaded ?? 0,
  total: evt.total
})

export const QlzgMaterialApi = {
  /**
   * 准备上传（**一次拖拽调用一次**）：查重（秒传）+ 签发直传地址 + 服务端发批次号
   *
   * ⚠️ 限流 60 次/分钟/人。所以「20 份文件」是**一次** prepare，不是 20 次 ——
   *    每份都单独 prepare 不仅会撞限流，还会发出 20 个批次号，
   *    时间线上变成 20 批各 1 份，「一次交齐」这个事实就再也看不出来了。
   */
  prepare: (data: QlzgMaterialPrepareReqVO): Promise<QlzgMaterialPrepareVO> =>
    request.post({ url: '/qlzg/material/prepare', data }),

  /**
   * 确认一份资料（**每个文件调用一次**）
   *
   * 🔴 令牌一次性（Redis GETDEL），且是在事务内消费的 —— 业务回滚时令牌也一起没了，
   *    此时**必须让用户重新拖一次**，重试同一个令牌只会得到 MATERIAL_UPLOAD_TOKEN_INVALID。
   * ⚠️ 限流 1200 次/分钟/人。
   */
  confirm: (data: QlzgMaterialConfirmReqVO): Promise<QlzgMaterialConfirmVO> =>
    request.post({ url: '/qlzg/material/confirm', data }),

  /**
   * 中转上传（**非 S3 存储的降级实现，是私有化部署的常态**）
   *
   * 🔴 返回值**就是** confirm 的返回值，调用方**不要再调一次 confirm**。
   * 🔴 `request.upload` 与 get/post/put/delete **不同形**：那几个返回信封里的 data，
   *    而 upload 返回**整个信封** `{ code, data, msg }`（见 `@/config/axios` 里 upload 那个方法，
   *    所以这里要自己取 `res.data`。漏掉这一步的表现是「上传成功了，但界面上每一行都是 undefined」。
   * ⚠️ 单文件上限 = `spring.servlet.multipart.max-file-size`（**16 MB**）、
   *    单请求 32 MB。超了是 Spring 的 MaxUploadSizeExceededException，
   *    **没有 qlzg 错误码**，所以前端最好先自己拦一道并给出人话。
   * ⚠️ 中转接口**不接受**归类字段（subjectId/category/checklistItemCode/remark 会被忽略），
   *    要归类请传完之后走 `classify`。
   * ⚠️ 限流 600 次/分钟/人。
   */
  uploadRelay: async (
    token: string,
    file: File,
    onProgress?: (progress: QlzgUploadProgress) => void,
    signal?: AbortSignal
  ): Promise<QlzgMaterialConfirmVO> => {
    const form = new FormData()
    // 🔴 token 是后端的 @RequestParam，放 FormData 里即可（multipart 下 Spring 照样绑得上）
    form.append('token', token)
    form.append('file', file)
    const res = await request.upload({
      url: '/qlzg/material/upload-relay',
      data: form,
      signal,
      onUploadProgress: (evt: AxiosProgressEvent) => onProgress?.(toProgress(evt))
    })
    return (res as any).data as QlzgMaterialConfirmVO
  },

  /**
   * 把字节 PUT 到预签名地址（分支 ②）
   *
   * 🔴 **必须用裸 axios，不能用 `@/config/axios` 那个实例**，四条理由每条都能单独弄坏它：
   *    ① 那个实例的 baseURL 是 `http://localhost:48080/admin-api`，会拼到绝对的 S3 地址前面；
   *    ② 请求拦截器会注入 `Authorization: Bearer …` 与 `tenant-id`，
   *       而 S3 的签名不认这些额外头 → **SignatureDoesNotMatch**；
   *    ③ 响应拦截器要求 body 是 `{code,msg,data}` 信封，而 S3 成功时 body 是空的，
   *       会撞上 `if (!data) throw new Error()`；
   *    ④ 开了 API 加解密时拦截器还会去读加密头。
   *    （与 src/components/UploadFile/src/useUpload.ts 的做法一致。）
   *
   * 🔴 `Content-Type` 必须与签名时**逐字一致**：签名把这个头算进去了，
   *    浏览器默认给的是文件的 type，所以这里显式回传 `file.type`，
   *    为空时兜 `application/octet-stream`（后端签名时用的就是这个兜底值）。
   *
   * ⚠️ 这一步成功**只代表字节进了存储**，资料行还没落库 —— 必须接着调 `confirm`。
   *    PUT 成功了但 confirm 没调（用户关了页面）时，后端在下次 confirm 会抛
   *    MATERIAL_FILE_MISSING；而那份字节会一直占着存储且**不入账**（见 infra_file 的 NULL tenant_id 问题）。
   */
  putToPresignedUrl: async (
    uploadUrl: string,
    file: File,
    onProgress?: (progress: QlzgUploadProgress) => void,
    signal?: AbortSignal
  ): Promise<void> => {
    await axios.put(uploadUrl, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      signal,
      onUploadProgress: (evt: AxiosProgressEvent) => onProgress?.(toProgress(evt))
    })
  },

  /**
   * 按 SHA256 查是否已有同一份字节（秒传预检）
   *
   * 🔴 **给桌面客户端用的，浏览器路径不要调**：prepare 内部已经查过重了，
   *    先探一次会白烧一个批次号（prepare 一旦调用就原子预留序号，0 份确认就是跳号）。
   * 🔴 它**只探测，不发令牌也不发 fileId** —— 命中了也**不能**拿它的结果去 confirm，
   *    真要复用必须走 prepare（它会发一次性的 reuseToken）。
   */
  checkDigest: (data: QlzgMaterialCheckDigestReqVO): Promise<QlzgMaterialCheckDigestVO> =>
    request.post({ url: '/qlzg/material/check-digest', data }),

  /**
   * 人工归类（可批量）
   *
   * 🔴 返回的是**实际更新行数**，不是 boolean。它可能 < ids.length
   *    （跨租户的行、已删除的行会被静默跳过），所以界面上要把差额说出来：
   *    「选中 8 份，实际归类 6 份」—— 只显示「成功」会让用户以为 8 份都归好了。
   * ⚠️ 副作用：classify_source 置 MANUAL、classify_confidence 置 **SQL NULL**（不是 1.0）。
   */
  classify: (data: QlzgMaterialClassifyReqVO): Promise<number> =>
    request.put({ url: '/qlzg/material/classify', data }),

  /**
   * 写入单份资料的扩展字段（I29）
   *
   * 🔴 权限点是 {@code qlzg:material:update}，**没有**新造 {@code :ext} ——
   *    新权限串在没有对应按钮菜单时只会建出一条 {@code menu_id = NULL} 的承载行，
   *    而 {@code GrantDecisionService} 一句 {@code if (r.getMenuId() == null) continue;}
   *    会把它挡在导航集合外，结果是所有非超管静默失去这个能力（全程 200 无异常）。
   * ⚠️ 语义见 {@link QlzgMaterialUpdateExtReqVO}：**{@code null} / {@code {}} = 清空**。
   */
  updateExt: (data: QlzgMaterialUpdateExtReqVO): Promise<boolean> =>
    request.put({ url: '/qlzg/material/update-ext', data }),

  /**
   * 重新抽取正文
   *
   * ⚠️ 只有 FAILED 与**卡死的非终态**能重抽；SUCCESS / SKIPPED_TOO_LARGE 会被拒
   *    （MATERIAL_EXTRACT_NOT_RETRYABLE）。所以「重新抽取」按钮只对 FAILED 亮 ——
   *    对 SKIPPED_TOO_LARGE 亮着但点了报错，是最坏的一种界面。
   *    🔴 SKIPPED_TOO_LARGE **不是错误**：那是为了保护抽取队列，文件本身完全可用。
   * ⚠️ 限流 60 次/分钟/人。
   */
  reExtract: (id: number): Promise<boolean> =>
    request.put({ url: '/qlzg/material/re-extract', params: { id } }),

  /** 资料详情 */
  getMaterial: (id: number): Promise<QlzgMaterialVO> =>
    request.get({ url: '/qlzg/material/get', params: { id } }),

  /** 资料分页；keyword 走正文全文检索（FULLTEXT ngram），fileName 走 LIKE */
  getMaterialPage: (params: QlzgMaterialPageReqVO): Promise<PageResult<QlzgMaterialVO[]>> =>
    request.get({ url: '/qlzg/material/page', params }),

  /**
   * 上传批次时间线（资料面板左侧那一列）
   *
   * 🔴 由资料行按 upload_batch_no **分组算出**，没有批次表。所以：
   *    「白烧掉」的批次号（prepare 了但 0 份 confirm）在时间线上**不可见** ——
   *    这是对的，时间线是「收到了哪些东西」的记录，不是「发过哪些号」的记录。
   *    排序按 firstCreateTime 正序，第 1 批在最上。
   */
  getBatchList: (projectId: number): Promise<QlzgMaterialBatchVO[]> =>
    request.get({ url: '/qlzg/material/batch-list', params: { projectId } }),

  /** 资料正文 + 段落数 */
  getText: (id: number): Promise<QlzgMaterialTextVO> =>
    request.get({ url: '/qlzg/material/text', params: { id } }),

  /**
   * 资料的**分段**正文（溯源段落选择器）
   *
   * 🔴 序号与文字一起下发，前端**不许**自己 split —— 理由全文在
   *    {@link QlzgMaterialParagraphVO} 的类注释里。
   * ⚠️ `paragraphs` 为空有两种处置，看 `extractTerminal` 分辨，
   *    不要一律显示成「这份资料没有正文」。
   */
  getParagraphs: (id: number): Promise<QlzgMaterialParagraphVO> =>
    request.get({ url: '/qlzg/material/paragraphs', params: { id } }),

  /**
   * 获得读取地址（并记一条下行计量）
   *
   * 🔴 **必须「点击那一刻」调，不能在列表里预取**：每次调用都会记一条 PREVIEW/OUT 计量行，
   *    那是**只追加的收费依据**。列表加载时预取 20 条 = 凭空多出 20 条下行计费，
   *    而账上看不出它与「用户真的看了」有什么区别。
   * ⚠️ 限流 600 次/分钟/人。
   */
  getReadUrl: (id: number): Promise<QlzgMaterialReadUrlVO> =>
    request.get({ url: '/qlzg/material/read-url', params: { id } }),

  /** 缺件检测（R17）—— 🔴 不要缓存结果，每次打开面板都重新拉 */
  getMissingItems: (projectId: number): Promise<QlzgMaterialMissingVO> =>
    request.get({ url: '/qlzg/material/missing-items', params: { projectId } }),

  /**
   * 删除资料
   *
   * 🔴 只**逻辑**删除资料行：infra_file 那一份字节保留（真实占着存储、且已经计过费），
   *    计量行也保留（那是只追加的收费依据，删行等于账上有空洞，
   *    而空洞无法与「本来就没这笔」区分）。
   * ⚠️ 删掉一份**已被报告引用**的资料会让溯源指空，所以确认框必须把这一点说出来。
   *    I6 落地 qlzg_provenance 之后这一步会变成服务端强校验。
   */
  deleteMaterial: (id: number): Promise<boolean> =>
    request.delete({ url: '/qlzg/material/delete', params: { id } }),

  /**
   * 导出资料台账
   *
   * 🔴 导出的是**资料清单**，不是资料内容：`text_content`（抽取出来的全文，mediumtext）
   *    永远不进台账 —— 两万行 mediumtext 是必定 OOM 的量，表现是「点了导出之后整个后端没反应」。
   *    要看正文走 `/text` 单条查。
   *
   * 🔴 **不走 `request.download`**：那个封装只把 Blob 交出来、响应头拿不到，
   *    而「这次有没有被上限截断」正是走 `X-Export-Truncated` 传的。理由全文在
   *    `@/utils/exportExcel` 的 `exportExcelWithMeta` 上，那里是全仓唯一一份。
   *
   * @param currentPage true-只导当前页 / false-按当前条件导全部（受上限约束）
   */
  exportExcel: (params: any, currentPage: boolean) =>
    exportExcelWithMeta('/qlzg/material/export-excel', { ...params, currentPage })
}
