/**
 * 启凌智估 —— 枚举展示层（标签、下拉选项、tag 颜色）
 *
 * <h3>🔴 为什么这里有一份「本地 map」，而不是走数据字典</h3>
 * 本模块**刻意不建 system_dict_type**：`agent` 模块（本项目最大的自研功能区）同样是零字典项，
 * 而 `src/views/agent/workflow/components/ExecutionHistoryDrawer.vue` 开头就把这条规则写明了 ——
 * 「状态无数据字典，用本地 map 渲染 tag」。理由在后端那一侧：
 * `QlzgProjectRespVO#statusDescription`、`QlzgSubjectRespVO#subjectTypeDescription`、
 * `QlzgMaterialRespVO#categoryDescription` 都是**服务端算好**发过来的，
 * 展示一律用它们，前端再建一份字典只会与枚举分叉
 * （表现是「列表里显示『资料收集』、点进去显示『MATERIAL』」）。
 *
 * <h3>🔴 那这里的 map 是干什么用的</h3>
 * 只用于**筛选下拉与表单选项** —— 那两个场景后端不给列表（它只给单行的描述）。
 * 所以规矩是：
 * - **展示已有数据** → 用后端的 `*Description` 字段，不要调这里的 `xxxLabel()`
 * - **让用户挑一个值** → 用这里的 `XXX_OPTIONS`
 *
 * <h3>🔴 每份 map 都必须与后端枚举逐字一致，且由 constants.spec.ts 钉住</h3>
 * 抄错一个码不会报错：筛选下拉里选了「已抽取」，发出去的却是 `SUCCEED`，
 * 后端 `QlzgExtractStatusEnum.of()` 返回 null，那一支查询条件被静默忽略 ——
 * 用户看到的是「筛了没用，还是全都在」。
 */

/** 下拉选项的公共形状 */
export interface QlzgOption {
  label: string
  value: string
}

/** 后端不认识的码 / 空值统一显示成这个，不要留白也不要显示英文码 */
export const UNKNOWN_LABEL_FALLBACK = '未知'

/** 资料尚未归类时的占位（category 为空是**常态**：先传后归类） */
export const UNCLASSIFIED = '未归类'

// ==================== 委托方类型 QlzgClientTypeEnum ====================

export const CLIENT_TYPE_OPTIONS: QlzgOption[] = [
  { label: '个人', value: 'PERSON' },
  { label: '企业', value: 'ENTERPRISE' },
  { label: '政府', value: 'GOVERNMENT' },
  { label: '法院', value: 'COURT' }
]

// ==================== 项目状态 QlzgProjectStatusEnum ====================

/**
 * 🔴 状态**只能往前走**（INIT → MATERIAL → … → ARCHIVED），而且推进由服务端做：
 *    收到第一份资料时 INIT → MATERIAL（见 QlzgMaterialServiceImpl#record）。
 *    所以这份选项**只用于列表筛选**，表单里不要放「状态」下拉 ——
 *    后端没有改状态的接口，而「状态能随手改」本身就是要防的事：
 *    状态是监管闸口 G-01…G-08 的输入。
 *
 * ⚠️ REVIEWING / SIGNED / ARCHIVED 三档在 `REPORT_ONLY` 部署形态下不会出现
 *    （没有工作流与签发模块）。它们留在筛选里是无害的：选了就是空列表。
 */
export const PROJECT_STATUS_OPTIONS: QlzgOption[] = [
  { label: '已立项', value: 'INIT' },
  { label: '资料收集', value: 'MATERIAL' },
  { label: '现场查勘', value: 'SURVEY' },
  { label: '测算', value: 'VALUING' },
  { label: '成稿', value: 'REPORTING' },
  { label: '审核中', value: 'REVIEWING' },
  { label: '已签发', value: 'SIGNED' },
  { label: '已归档', value: 'ARCHIVED' },
  { label: '已作废', value: 'VOIDED' }
]

/** 项目状态的 tag 颜色 */
export const projectStatusTagType = (
  status?: string
): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'VOIDED') return 'danger'
  if (status === 'ARCHIVED' || status === 'SIGNED') return 'success'
  if (status === 'REVIEWING') return 'warning'
  if (status === 'INIT') return 'info'
  return 'primary' // MATERIAL / SURVEY / VALUING / REPORTING 及未知码
}

// ==================== 标的类型 QlzgSubjectTypeEnum ====================

/**
 * 🔴 只用于**列表筛选**。创建/编辑标的的表单里**不要**放这个下拉：
 *    标的类型由项目品类的 `subjectType` 决定，后端不接受传入
 *    （`QlzgSubjectSaveReqVO` 上根本没有这个字段）。
 *    放了用户就会去调它，而调不动 —— 那是最坏的一种界面。
 */
export const SUBJECT_TYPE_OPTIONS: QlzgOption[] = [
  { label: '房地产', value: 'REAL_ESTATE' },
  { label: '股权', value: 'EQUITY' },
  { label: '企业', value: 'ENTERPRISE' },
  { label: '设备', value: 'DEVICE' },
  { label: '无形资产', value: 'INTANGIBLE' },
  { label: '数据资产', value: 'DATA_ASSET' },
  { label: '矿业权', value: 'MINING_RIGHT' },
  { label: '森林资源', value: 'FOREST' },
  { label: '土地使用权', value: 'LAND_USE_RIGHT' },
  { label: '金融工具', value: 'FINANCIAL_INSTRUMENT' }
]

// ==================== 资料类别 QlzgMaterialCategoryEnum ====================

/**
 * 🔴 `OTHER` 是**兜底类别，必须可选**：评估实务里总有归不进前七类的材料
 *    （一份情况说明、一张手绘的四至图）。不给兜底，用户就会把随手挑一个
 *    看起来最像的类别填上去 —— 而错类比无类更坏：无类在缺件面板上是看得见的缺口，
 *    错类会让缺件检测以为这一项已经齐了。
 */
export const MATERIAL_CATEGORY_OPTIONS: QlzgOption[] = [
  { label: '委托', value: 'ENTRUST' },
  { label: '权属', value: 'OWNERSHIP' },
  { label: '查勘', value: 'SURVEY' },
  { label: '财务', value: 'FINANCIAL' },
  { label: '发票', value: 'INVOICE' },
  { label: '内控', value: 'INTERNAL_CONTROL' },
  { label: '承诺函', value: 'PROMISE_LETTER' },
  { label: '其他', value: 'OTHER' }
]

// ==================== 抽取状态 QlzgExtractStatusEnum ====================

export const EXTRACT_STATUS_OPTIONS: QlzgOption[] = [
  { label: '待抽取', value: 'PENDING' },
  { label: '抽取中', value: 'RUNNING' },
  { label: '已抽取', value: 'SUCCESS' },
  { label: '抽取失败', value: 'FAILED' },
  { label: '文件过大已跳过', value: 'SKIPPED_TOO_LARGE' }
]

/**
 * 🔴 **判「还在不在抽」不要用这个函数、也不要看状态码** ——
 *    用后端发来的 `extractTerminal` 列（它是 `QlzgExtractStatusEnum#isTerminal()` 的投影）。
 *    这里只负责「这一格显示什么字」。
 */
export const extractStatusLabel = (status?: string): string =>
  EXTRACT_STATUS_OPTIONS.find((item) => item.value === status)?.label ??
  status ??
  UNKNOWN_LABEL_FALLBACK

export const extractStatusTagType = (
  status?: string
): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'SUCCESS') return 'success'
  if (status === 'FAILED') return 'danger'
  // 🔴 SKIPPED_TOO_LARGE **不是错误**：那是为了保护抽取队列而主动跳过的，
  //    文件本身完全可用（能下载、能归档），只是搜不到里面的字。
  //    标成红的表现是用户以为这份资料坏了、反复重传，而重传多少次结果都一样
  if (status === 'SKIPPED_TOO_LARGE') return 'info'
  return 'primary' // PENDING / RUNNING 及未知码
}

/**
 * 「重新抽取」按钮该不该亮
 *
 * 🔴 与后端 `QlzgMaterialServiceImpl#reExtract` 的放行条件互为镜像：
 *    ① FAILED → 放行；
 *    ② **非终态**也放行 —— 非终态不等于「正在抽」：PENDING 可能是派发被线程池拒了、
 *       派发时没有租户上下文、JVM 崩在派发之前；RUNNING 可能是占着它的 worker 已失联。
 *       一律拒的话这些资料**永远转圈且一个按钮都点不动**，而日志里只有一条 ERROR；
 *    ③ SUCCESS / SKIPPED_TOO_LARGE → 后端拒（MATERIAL_EXTRACT_NOT_RETRYABLE）。
 *       SUCCESS 不能重抽是因为**正文的段落序号是溯源定位（I6）的落点**，
 *       重抽会让已归档报告指向错误的段落。
 *
 * ⚠️ 所以 ② 那一支点下去**有可能**被后端以 MATERIAL_EXTRACT_IN_PROGRESS 拒回来
 *    （worker 其实还活着）。这是刻意的取舍：判活要查任务行的 heartbeat，
 *    一页 20 行就是 20 趟额外查询，而翻页是资料面板的常态动作。
 *    那条报错文案是「正文抽取还在进行中，请等待完成后再重试」—— 准确且可行动，
 *    比「按钮永远灰着、用户不知道能不能重抽」好。
 */
export const extractRetryable = (extractTerminal: boolean, extractStatus?: string): boolean =>
  !extractTerminal || extractStatus === 'FAILED'

// ==================== 归类来源 QlzgClassifySourceEnum ====================

/**
 * ⚠️ `AI` 在 I1 **不会出现**（那是 M1/I8 的事），但选项要留着：
 *    库里将来会有 AI 归类的行，筛选时少了这一档就等于「那批资料查不出来」。
 */
export const CLASSIFY_SOURCE_OPTIONS: QlzgOption[] = [
  { label: '人工归类', value: 'MANUAL' },
  { label: 'AI 归类', value: 'AI' }
]

// ==================== 上传端 ====================

/**
 * 上传端 web / app / desktop
 *
 * ⚠️ 这一组**不是 Java 枚举的镜像**：`FileUsageClientTypeEnum` 里确实有这四个取值，
 *    但落库那一列是 `QlzgClientTypeResolver` 从 `X-Client-Type` 头 / 桌面端 UA 标记 /
 *    `terminal` 头里**逐级判**出来的，认不出来时兜 `web`，全程不报错。
 *    所以筛选下拉照抄这三个即可，但**不要**在前端断言「只可能是这三个」——
 *    `open_api`（E 档客户系统对接）也在同一个枚举里，只是 Web 端永远不会发出它。
 *
 * 🔴 头名在 I6-e 定稿为 `X-Client-Type`（D14），此前本仓写的是 `X-Enlev-Client`。
 *    两边必须一致：前端发的名字后端认不出来的话，判定链会静默兜到 `web`，
 *    表现是「账单上这一端的流量恒为 0」，与「没人用这一端」在数据上无法区分。
 *    发头的那一处是 `src/config/axios/service.ts` 的请求拦截器，由
 *    `src/views/qlzg/bridge/localBridge.spec.ts` 钉住字面量。
 */
export const UPLOADER_CLIENT_TYPE_OPTIONS: QlzgOption[] = [
  { label: '网页端', value: 'web' },
  { label: '移动端', value: 'app' },
  { label: '桌面客户端', value: 'desktop' }
]

export const uploaderClientTypeLabel = (value?: string | null): string =>
  UPLOADER_CLIENT_TYPE_OPTIONS.find((item) => item.value === value)?.label ??
  value ??
  UNKNOWN_LABEL_FALLBACK

// ==================== 品类参数 QlzgParamScopeEnum / QlzgParamTypeEnum ====================

/** 参数 schema 的三个作用域 —— 🔴 按 scope 分派，不要靠 key 前缀猜 */
export const PARAM_SCOPE = {
  /** 标的属性：I1 的标的表单就渲染这一类 */
  SUBJECT_ATTR: 'SUBJECT_ATTR',
  /** 测算参数：I3 */
  PARAM: 'PARAM',
  /** 报告字段：I4 */
  REPORT_FIELD: 'REPORT_FIELD'
} as const

/**
 * 三个作用域的中文说法
 *
 * 🔴 与 {@link PARAM_SCOPE} 是同一份码表的两面，刻意**由它派生**而不是各写一遍：
 *    分开写的话，后端哪天加第四个作用域，`PARAM_SCOPE` 会被人补上
 *    （因为它被 if 判断用着），而这一份不会 —— 表现是新作用域在界面上
 *    显示成裸码 `SURVEY_ITEM`，而裸码对评估师没有任何意义。
 */
export const PARAM_SCOPE_OPTIONS: QlzgOption[] = [
  { label: '标的属性', value: PARAM_SCOPE.SUBJECT_ATTR },
  { label: '测算参数', value: PARAM_SCOPE.PARAM },
  { label: '报告字段', value: PARAM_SCOPE.REPORT_FIELD }
]

/** 值类型 → 界面显示名（标的属性表单按它挑控件） */
export const PARAM_TYPE_LABELS: Record<string, string> = {
  DECIMAL: '小数',
  INT: '整数',
  STRING: '文本',
  ENUM: '枚举',
  DATE: '日期',
  GEO: '经纬度'
}

// ==================== 评估目的 / 价值类型 ====================

/**
 * 🔴 这两组是**前端的兜底清单**，后端既没有枚举也没有字典种子 ——
 *    `qlzg_project.purpose` / `value_type` 就是两个 `varchar(64)` / `varchar(32)`，
 *    `@Schema` 上只写了「评估目的（字典项）」，而 `sql/mysql/update/` 里
 *    **一条 `INSERT INTO system_dict_type` 都没有**（实测 2026-10-30）。
 *
 * <p>⚠️ 所以这份清单是**未经验证的约定**，改它之前先想清楚：
 *    - R22（I2）要判「评估目的唯一」，命中的是**报告正文**里「抵押及转让」这类复合表述，
 *      不是 `purpose` 这一列本身 —— 所以存码是安全的；
 *    - G-05…G-08（I20）按「国资 12 号令第 6 条的经济行为」判核准/备案路径，
 *      届时**必须**有一份权威码表，那份表落地之后这里要改成读它。
 *
 * <p>🔴 刻意**不开** allow-create：让用户自由输入会让同一列里混进码和中文两种形态，
 *    而 R22 与 G-05 都按码判。`OTHER` 是兜底，任何目的都能落进来，
 *    所以「清单里没有我要的」不会挡住用户 —— 这与 `MATERIAL_CATEGORY_OPTIONS`
 *    里 `OTHER` 必须可选是同一条理由。
 */
export const PURPOSE_OPTIONS: QlzgOption[] = [
  { label: '抵押', value: 'MORTGAGE' },
  { label: '转让', value: 'TRANSFER' },
  { label: '出资', value: 'CAPITAL_CONTRIBUTION' },
  { label: '清算', value: 'LIQUIDATION' },
  { label: '司法拍卖', value: 'JUDICIAL_AUCTION' },
  { label: '以财务报告为目的', value: 'FINANCIAL_REPORTING' },
  { label: '税收', value: 'TAXATION' },
  { label: '保险', value: 'INSURANCE' },
  { label: '征收补偿', value: 'EXPROPRIATION_COMPENSATION' },
  { label: '租赁', value: 'LEASE' },
  { label: '企业改制', value: 'ENTERPRISE_RESTRUCTURING' },
  { label: '抵债', value: 'DEBT_REPAYMENT' },
  { label: '其他', value: 'OTHER' }
]

/**
 * 价值类型（〔2018〕35 号第十八条 → R24「须给理由与定义」）
 *
 * ⚠️ R24 要求选了非市场价值时**必须写理由与定义**，那是 I5 的规则。
 *    I1 只负责把值存进去，不要在表单上提前承诺「会帮你检查」。
 */
export const VALUE_TYPE_OPTIONS: QlzgOption[] = [
  { label: '市场价值', value: 'MARKET_VALUE' },
  { label: '投资价值', value: 'INVESTMENT_VALUE' },
  { label: '在用价值', value: 'VALUE_IN_USE' },
  { label: '清算价值', value: 'LIQUIDATION_VALUE' },
  { label: '残余价值', value: 'RESIDUAL_VALUE' },
  { label: '市场租金', value: 'MARKET_RENT' }
]

/** 按码取中文；🔴 认不出时**回落到码本身**，不要显示成空白 */
export const labelOf = (options: QlzgOption[], value?: string | null): string => {
  if (value == null || value === '') return ''
  return options.find((item) => item.value === value)?.label ?? value
}

/**
 * {@link labelOf} 的**数字取值**版本 —— 🔴 两份不是一个能替代另一个，别合并
 *
 * `labelOf` 的第一句是 `if (value == null || value === '') return ''`，
 * 而 {@code CommonStatusEnum} 那一类码是**数字**：把 `0`（停用）传进一个按字符串全等比的
 * 查找里，`item.value === value` 对 `{value: 1}` 与 `{value: 0}` 都是 false 还是 true
 * 取决于那份选项表写的是 `0` 还是 `'0'`，而两种写法在 TS 里都能编过。
 * 表现是「停用」那一行显示成 `—`，或者筛选下拉永远命不中，**两处都不报错**。
 *
 * ⚠️ 认不出时回落到 `—` 而不是码本身：数字码原样显示出来是 `0`，
 *    与「这一格没有值」长得一模一样，所以这里用占位符把它们分开。
 */
export const labelOfNumber = (
  options: { label: string; value: number }[],
  value?: number | null
): string => (value == null ? '—' : (options.find((item) => item.value === value)?.label ?? '—'))

/**
 * 金额 / 单价的千分位显示
 *
 * <h3>🔴 没有值时返回**空串**，不是 `—`、也不是 `0`</h3>
 * 这三个在表格里的读法完全不同，而 qlzg 的金额格几乎都是「有值就显示数、没值就显示别的东西」
 * 的形状（例如测算台账那一格是 `<b v-if="row.resultValue != null">` 配一句
 * 「为什么这一行不能用于出稿」）。返回 `0` 最坏：它把「还没算出来」显示成一个**具体的金额**，
 * 而评估报告里的 0 元是有含义的。返回 `—` 则会与旁边那些刻意用 `—` 表示
 * 「这一栏对本方法不适用」的格子混在一起。
 *
 * <p>⚠️ 所以调用方要自己决定空值怎么显示，本函数只负责「有数就把数排好」。
 *
 * <h3>🔴 它的返回值**只做显示**：不参与任何计算，也不回传</h3>
 * 返回的是**字符串**，而 `"1,234,567"` 送回后端既过不了 `@DecimalMin`、也存不进 `decimal` 列。
 * 更要紧的是它不能进算式：`Number("1,234,567")` 是 `NaN`，而 `NaN` 在
 * 「偏离率 = |最高 − 最低| / 最高」这类式子里会一路传染到界面上显示成 `NaN%`，不报错。
 * 要算就用原始 `number`，要传就用原始 `number`。
 *
 * <h3>⚠️ 用 `zh-CN` 而不是默认 locale</h3>
 * 默认 locale 跟着浏览器语言走，而本系统的用户界面只有中文：一个把浏览器设成德语的评估师
 * 会看到 `1.234.567`（点号做千分位），与报告正文里的 `1,234,567` 对不上 ——
 * 而这两份数是要互相核对的。钉死 locale 就是钉死「界面与报告同一种排法」。
 *
 * <p>📌 这一份原本是五个 `.vue` 里各写一遍的**逐字节相同**的副本（案例台账、召回面板、
 *    测算台账、发起测算弹窗、明细抽屉），结果确定页要写第六遍时收进这里。
 *    收的不是「两行代码」，是「金额怎么排」这一个口径 —— 它将来还会被计算成果表的
 *    Excel 单元格格式复用，那时第六份副本就会变成第七份。
 */
export const thousands = (value?: number | null): string =>
  value === undefined || value === null ? '' : Number(value).toLocaleString('zh-CN')

// ==================== 扩展字段的宿主 QlzgEntityTypeEnum ====================

/**
 * 能挂扩展字段的五个宿主
 *
 * <p>与后端 {@code QlzgEntityTypeEnum} 逐字一致（值与中文都取自枚举的
 * {@code type} 与 {@code description}）。这五个正是 §11.20 说的「五张表的 {@code ext_json} 列」，
 * 建表时就已经在 {@code CREATE TABLE} 里（§10.10 纪律 5：不是等 I29 用 {@code ALTER TABLE} 加）。
 *
 * <p>🔴 五个都放出来，包括 {@code QLZG_REPORT} —— 报告的成稿要到 I4 才有写入路径，
 * 但**字段定义可以先配**：定义与值是两个生命周期，先配好等 I4 上线即生效。
 * 这里刻意不给「报告模块尚未上线」这类提示：那是一句**会过期**的话，
 * 而 I4 落地时最容易被忘掉的就是删掉它，届时它会变成一句假的限制说明。
 */
export const ENTITY_TYPE_OPTIONS: QlzgOption[] = [
  { label: '评估项目', value: 'QLZG_PROJECT' },
  { label: '评估标的', value: 'QLZG_SUBJECT' },
  { label: '委托方', value: 'QLZG_CLIENT' },
  { label: '评估资料', value: 'QLZG_MATERIAL' },
  { label: '评估报告', value: 'QLZG_REPORT' }
]

// ==================== 案例库（I2）====================

/**
 * 案例的**来源类型** ← 后端 {@code QlzgCaseSourceTypeEnum}
 *
 * 🔴 只用于**台账筛选**。录入表单里**不要**放这个下拉：新增时后端一律按 `MANUAL` 处理，
 *    传 `API` / `DISCLOSURE` / `IMPORT` 会被拒（那是 R47 的入口守卫 ——
 *    一条手敲的案例标成 `API`，就同时躲开了 R47 与闸 G-10，报告照出、两条闸都不亮）。
 *    放了用户就会去调它，而调不动。
 *
 * 🔴 与下面那份 `CASE_PROVIDER_TYPE_OPTIONS` **是两个不同的枚举，不能合并**：
 *    这一份有 `IMPORT` 而没有 `GOVERNMENT`，那一份反过来。合并之后
 *    「数据源管理页里能选到『批量导入』」，而那个值存进 `qlzg_case_source.source_type`
 *    之后案例表的出处判定会整个走错分支 —— 两边都返回 200，差别只在报告里那句署名
 */
export const CASE_SOURCE_TYPE_OPTIONS: QlzgOption[] = [
  { label: '数据接口', value: 'API' },
  { label: '公开披露', value: 'DISCLOSURE' },
  { label: '人工录入', value: 'MANUAL' },
  { label: '批量导入', value: 'IMPORT' }
]

/**
 * 数据源的**性质** ← 后端 {@code QlzgCaseProviderTypeEnum}
 *
 * 用于「数据来源管理」页的表单与筛选。**这一份才是能选的**
 */
export const CASE_PROVIDER_TYPE_OPTIONS: QlzgOption[] = [
  { label: '第三方数据接口', value: 'THIRD_PARTY_API' },
  { label: '公开披露', value: 'PUBLIC_DISCLOSURE' },
  { label: '人工搜集', value: 'MANUAL' },
  { label: '政府发布', value: 'GOVERNMENT' }
]

/**
 * 数据源的启用 / 停用 ← 框架的 {@code CommonStatusEnum}（0 停用 / 1 启用）
 *
 * ⚠️ 这是**全仓通用**的那份 0/1，不是 qlzg 自造的枚举 —— 所以它**没有**对应的
 *    `system_dict_data`（qlzg 四张表一个字典都不挂），也**不要**为它去开一个字典：
 *    那会让同一个 0/1 在字典里翻一次、在这里又翻一次
 *
 * 🔴 `value` 是**数字**，不是字符串：`QlzgCaseSourceVO.status` 声明为 `number`，
 *    而 `el-option` 的 `:value` 与 `el-select` 的 `v-model` 走的是全等比较。
 *    写成 `'0'` / `'1'` 的表现是**筛选下拉永远命不中**、编辑弹窗里那一栏空白，
 *    两处都不报错
 *
 * 🔴 停用**不等于**删除：已经引用了这个源的历史案例仍然要能显示出处。
 *    所以台账默认**不过滤** status，把停用的也列出来（灰掉），
 *    只有导入向导那一侧要「启用的」—— 而那份清单来自 `/get-import-config`，
 *    后端已经筛过了，不在前端再筛一遍
 */
export const CASE_SOURCE_STATUS_OPTIONS: { label: string; value: number }[] = [
  { label: '启用', value: 1 },
  { label: '停用', value: 0 }
]

export const caseSourceStatusTagType = (status?: number): 'success' | 'info' =>
  status === 1 ? 'success' : 'info'

/**
 * 案例归属（私有库 / 共享库）
 *
 * ⚠️ 这一份**没有后端枚举**可钉：`tenantScope` 是 `QlzgCaseController` 现算的派生串，
 *    两个字面量（`PRIVATE` / `SHARED`）与两句中文（「本机构私有库」/「平台共享库」）
 *    都写死在那个控制器里。`constants.spec.ts` 钉的是**这两句中文**，
 *    因为它们是黄金副本唯一能对齐的东西
 *
 * 🔴 只是**再收窄**，不是可见性开关：留空时后端默认跨私有库与共享库，
 *    而任何取值都看不到别的机构的私有案例
 */
export const CASE_TENANT_SCOPE_OPTIONS: QlzgOption[] = [
  { label: '本机构私有库', value: 'PRIVATE' },
  { label: '平台共享库', value: 'SHARED' }
]

/** 归属的 tag 颜色。共享库用 info：它是**只读**的，灰一点正好与「编辑/删除置灰」呼应 */
export const caseTenantScopeTagType = (
  scope?: string
): 'primary' | 'success' | 'warning' | 'danger' | 'info' =>
  scope === 'SHARED' ? 'info' : 'primary'

/**
 * 异步任务状态 ← 后端 {@code QlzgTaskStatusEnum}
 *
 * ⚠️ **这一份只在导入向导的历史任务回看里用得上**；轮询中的那一条一律用后端发来的
 *    `statusName`（展示已有数据的规矩）。留这份常量是给「按状态筛任务」那一天用的，
 *    以及给 tag 上色 —— 颜色后端不给
 *
 * 🔴 **停止轮询不要判这份清单**：判后端的 `terminal` 布尔。多一种终态时，
 *    按枚举写的停止条件会漏掉它，表现是弹窗关不掉、请求一直打
 */
export const CASE_TASK_STATUS_OPTIONS: QlzgOption[] = [
  { label: '待执行', value: 'PENDING' },
  { label: '执行中', value: 'RUNNING' },
  { label: '成功', value: 'SUCCESS' },
  { label: '失败', value: 'FAILED' },
  { label: '已中断', value: 'INTERRUPTED' }
]

export const caseTaskStatusTagType = (
  status?: string
): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'SUCCESS') return 'success'
  if (status === 'FAILED') return 'danger'
  // 🔴 INTERRUPTED 不是「失败」：那是进程被 kill 之后由懒回收判出来的，
  //    任务行**刻意留在原地**，重新提交同一个文件（同一个 importToken）就能续上。
  //    标成红的表现是用户以为导坏了、去改文件，而文件本来没问题
  if (status === 'INTERRUPTED') return 'warning'
  return 'primary' // PENDING / RUNNING 及未知码
}

/**
 * 召回充足度的 tag 颜色 ← 后端 {@code QlzgRecallDispositionEnum} 的三个码
 *
 * 🔴 **只管颜色，不管文字**：界面上照原样渲染 `dispositionText`。
 *    那份文案是「召回到的可比案例不足阈值，比较法可用但必须披露并限制程序……」
 *    这种带处置建议的整句，前端拼不出来、也不该拼 ——
 *    拼了就会与 R48 的规则种子（`expr_params.minCases`）分属两份真相
 */
export const caseDispositionTagType = (
  code?: string
): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (code === 'OK') return 'success'
  if (code === 'FEW') return 'warning'
  if (code === 'NONE') return 'danger'
  return 'info'
}

/**
 * 导入问题清单里 `level` 的三个取值 ← 后端 {@code QlzgCaseImportIssueVO} 的 LEVEL_* 常量
 *
 * 🔴 `SKIPPED` 是**指纹撞车被去重**，不是错误：那 200 条里有 30 条本来就在库里。
 *    与 `ERROR` 用同一个颜色的表现是用户以为「导坏了 30 条」，
 *    于是重导一次 —— 而重导多少次结果都一样
 */
export const CASE_IMPORT_ISSUE_LEVEL_OPTIONS: QlzgOption[] = [
  { label: '错误', value: 'ERROR' },
  { label: '警告', value: 'WARNING' },
  { label: '已跳过', value: 'SKIPPED' }
]

export const caseIssueLevelTagType = (
  level?: string
): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (level === 'ERROR') return 'danger'
  if (level === 'WARNING') return 'warning'
  if (level === 'SKIPPED') return 'info'
  return 'primary'
}

/**
 * 🔴 案例的**房屋用途**建议值（住宅 / 商业 / 办公……）
 *
 * <h3>它与上面那份 {@code PURPOSE_OPTIONS} 撞名，但完全不是同一件事</h3>
 * {@code PURPOSE_OPTIONS} 是**评估目的**（抵押 / 转让 / 清算，存的是 `MORTGAGE` 这类码），
 * 属 {@code qlzg_project}；本份是**房屋用途**（存的是「住宅」这类中文），
 * 属 {@code qlzg_case}。两个字段在后端都叫 {@code purpose}。
 *
 * 🔴 用错的表现是**静默的**：案例的 `purpose` 存成 `MORTGAGE` 之后，
 *    召回第 2 层拿它去比项目的房屋用途（「住宅」），**永远不相等** ——
 *    而第 2 层是硬过滤，于是这批案例一条都召回不到，台账里却看得见，没有一处报错。
 *
 * <h3>🔴 为什么是「建议值」而不是枚举，且必须开 allow-create</h3>
 * 后端刻意不做成枚举：取值由各地不动产登记口径决定，「商住两用」「酒店式公寓」
 * 在 A 市有、B 市没有；写死枚举会让一条合法的 B 市案例在导入时报
 * {@code CASE_IMPORT_ROW_FAILED}，而评估师分不清是「系统没这个值」还是「我填错了」。
 * 所以这里给的是**补全**，不是**限制** —— 与小区名自动补全同一条纪律
 */
export const CASE_USAGE_SUGGESTIONS: QlzgOption[] = [
  { label: '住宅', value: '住宅' },
  { label: '商业', value: '商业' },
  { label: '办公', value: '办公' },
  { label: '工业', value: '工业' },
  { label: '商住两用', value: '商住两用' },
  { label: '酒店式公寓', value: '酒店式公寓' },
  { label: '车位', value: '车位' },
  { label: '仓储', value: '仓储' }
]

/**
 * 权利性质建议值。🔴 召回第 3 层拿它做**硬过滤**，且 NULL 行一律排除 ——
 *    划拨地的价格口径与出让地差 30%–50%，所以这一栏宁可让用户从建议里挑，
 *    也不留空（留空 ⇒ 这条案例永远召回不到）
 *
 * 🔴 **前三项是标的侧那份 ENUM 的逐字副本，顺序也不要动**：
 *    `qlzg_category.param_schema` 里 `right_type` 是 ENUM，可选值就是
 *    出让 / 划拨 / 租赁（种子脚本 06），标的表单渲染成下拉、只能挑这三个。
 *    而第 3 层是**按文本严格相等**比的，所以这三项必须在案例侧也挑得到 ——
 *    少一个（此前就漏了「租赁」）的表现是：租赁地的标的做召回，
 *    评估师在案例侧只能靠 allow-create 手打「租赁」，打错一个字就一条都召回不到，
 *    而台账里那条案例看得见、没有任何一处报错。
 *    后面那两项（集体 / 自有）是案例侧独有的：登记口径里存在，
 *    但标的侧的 ENUM 没有它们，所以排在后面。
 */
export const CASE_RIGHT_TYPE_SUGGESTIONS: QlzgOption[] = [
  { label: '出让', value: '出让' },
  { label: '划拨', value: '划拨' },
  { label: '租赁', value: '租赁' },
  { label: '集体', value: '集体' },
  { label: '自有', value: '自有' }
]

/**
 * 朝向建议值（修正因子，不硬过滤）
 *
 * 🔴 前八项是标的侧 ENUM 的逐字副本（种子脚本 06 的 `orientation`：
 *    东 / 南 / 西 / 北 / 东南 / 东北 / 西南 / 西北），加上「南北」共九项 ——
 *    此前漏了东北与西北，后果比权利性质那一栏轻（朝向只扣分、不出局），
 *    但仍然是「打分表里那一项恒拿不到分，而界面上看不出为什么」
 */
export const CASE_ORIENTATION_SUGGESTIONS: QlzgOption[] = [
  { label: '东', value: '东' },
  { label: '南', value: '南' },
  { label: '西', value: '西' },
  { label: '北', value: '北' },
  { label: '东南', value: '东南' },
  { label: '东北', value: '东北' },
  { label: '西南', value: '西南' },
  { label: '西北', value: '西北' },
  { label: '南北', value: '南北' },
  { label: '东西', value: '东西' }
]

/**
 * 装修建议值（修正因子，不硬过滤）。🔴 四项与标的侧 ENUM 逐字相同
 *    （种子脚本 06 的 `decoration`），多一项少一项都会让那一档打分恒拿不到
 */
export const CASE_DECORATION_SUGGESTIONS: QlzgOption[] = [
  { label: '毛坯', value: '毛坯' },
  { label: '简装', value: '简装' },
  { label: '精装', value: '精装' },
  { label: '豪装', value: '豪装' }
]

// ==================== 参数库与测算（I3）====================

/**
 * 参数的**出处类型** ← 后端 {@code QlzgParamSourceTypeEnum}
 *
 * <h3>🔴 {@code EXPERT_GUIDE} 与其它四档不是同一量级的东西</h3>
 * 后端会把它那一行的 `canBeBlockRule` **强制**成 false（§11.9.1 纪律 2：
 * 专家指引只能出 WARN，不能卡住出稿），而确认闸预览里的
 * `allFromExpertGuide` 是 R36 的输入 —— 全部参数都来自专家指引时，
 * 报告里必须披露这件事。
 * 所以表单上选了「专家指引」，那个「可被 BLOCK 级规则引用」的开关要**灰掉并强制关闭**，
 * 不要让用户拨了之后被后端悄悄改回去（那是最坏的一种界面：拨得动、存不下、也不报错）。
 *
 * 🔴 展示已有数据一律用后端的 `sourceTypeDescription`，这份只用于筛选与表单下拉。
 */
export const PARAM_SOURCE_TYPE_OPTIONS: QlzgOption[] = [
  { label: '准则规范', value: 'STANDARD' },
  { label: '政府发布', value: 'GOVERNMENT' },
  { label: '专家指引', value: 'EXPERT_GUIDE' },
  { label: '机构内部', value: 'ORG_INTERNAL' },
  { label: '市场统计', value: 'MARKET' }
]

/**
 * 参数状态 ← 框架的 {@code CommonStatusEnum}（0 停用 / 1 启用）
 *
 * 🔴 `value` 是**数字**不是字符串，理由与 {@code CASE_SOURCE_STATUS_OPTIONS} 完全相同：
 *    `el-option` 的 `:value` 与 `el-select` 的 `v-model` 走全等比较，
 *    写成 `'0'` / `'1'` 的表现是筛选下拉永远命不中、编辑弹窗里那一栏空白，两处都不报错
 *
 * 🔴 **停用不等于删除**，而删除是删不掉的：已被口径快照引用的参数会以
 *    `PARAM_REFERENCED_BY_SNAPSHOT`（1042006017）拒回来，因为快照是报告的口径依据。
 *    所以「停用」才是实务里的那个动作，界面上要把它放在删除**前面**
 */
export const PARAM_STATUS_OPTIONS: { label: string; value: number }[] = [
  { label: '启用', value: 1 },
  { label: '停用', value: 0 }
]

export const paramStatusTagType = (status?: number): 'success' | 'info' =>
  status === 1 ? 'success' : 'info'

/**
 * 「平台级 / 本机构」筛选的三态
 *
 * 🔴 **三态而不是两态**：后端 `QlzgParamPageReqVO.platformLevel` 是 `Boolean`，
 *    不传（undefined）= 两者都要，true = 只要平台级，false = 只要本机构的。
 *    所以「全部」那一项的 value 必须是 `undefined`，
 *    写成 `''` 或 `false` 的表现是：选了「全部」却看不到平台级参数 ——
 *    而平台级恰恰是基准地价、资本化率这些最常用的那批
 *
 * ⚠️ `el-option` 的 `:value` 绑 undefined 是可行的（Element Plus 按全等比较，
 *    而 `queryParams.platformLevel` 初始值也是 undefined），
 *    但**重置搜索时必须把这个键设回 undefined**，不要设成 `''`
 */
export const PARAM_PLATFORM_LEVEL_OPTIONS: { label: string; value?: boolean }[] = [
  { label: '全部', value: undefined },
  { label: '平台级', value: true },
  { label: '本机构', value: false }
]

/**
 * 参数 schema 的**取值策略** ← 品类 `param_schema` 里 `scope = 'PARAM'` 那些键的 `default_strategy`
 *
 * 🔴 这一份**不是 Java 枚举**，是 `qlzg_category.param_schema` JSON 里的一个字面量，
 *    由品类配置页（I5）写入。所以它没有 `*Description` 可用，
 *    是「展示已有数据也要用本地 map」的**少数例外** ——
 *    与 {@code CASE_TENANT_SCOPE_OPTIONS}（后端现算的派生串）同一类处境
 *
 * <h3>🔴 它<b>只有两项</b>，而 `default_strategy` 一共有<b>五个</b>取值 —— 这不是漏抄</h3>
 * 另外三个（{@code FROM_MATERIAL} 从资料里取、{@code FROM_SURVEY} 从查勘记录取、
 * {@code BASE_DATE_PLUS_ONE_YEAR} 基准日加一年）实测只出现在
 * {@code SUBJECT_ATTR} 与 {@code REPORT_FIELD} 两种作用域的键上
 * （种子脚本 06 的 `location` / `community_name` / `cert_no` / `geo_location` / `report_date`，
 * 脚本 16 补的那批 PARAM 键一律是这两项之一）。
 * 所以本清单的适用范围就是**确认闸**（它只读 PARAM 作用域的键）。
 *
 * <p>⚠️ 拿它去渲染标的属性表单（I1 的 {@code subject/attrSchema.ts}）或报告字段（I4）
 * 会把那三个值显示成裸码 —— 那两处要么已有自己的中文、要么归 I4 自己决定，
 * **不要**为了「补全」把那三个加进来：加进来之后确认闸的下拉里就会出现
 * 「从资料里取」，而确认闸上根本不会有这种键，它是一个点了必然对不上的选项
 *
 * 🔴 `PROMPT_USER` 的那一档在确认闸上**即便命中了也要评估师亲手确认**：
 *    它声明的就是「这一项不许系统替人决定」（后端 RespVO 的 {@code @Schema} 原话）。
 *    界面上不要把它渲染成「未命中，去参数库新建」——
 *    那是 `FROM_PARAM_LIB` 没查到时的处置，两者混了会让用户去建一条根本不该存在的参数
 */
export const PARAM_DEFAULT_STRATEGY_OPTIONS: QlzgOption[] = [
  { label: '从参数库取', value: 'FROM_PARAM_LIB' },
  { label: '每次问评估师', value: 'PROMPT_USER' }
]

/**
 * 测算状态 ← 后端 {@code QlzgCalculationStatusEnum}
 *
 * <h3>🔴 `STALE` 是这三档里最容易被做错的那一个</h3>
 * 它的中文是「输入已变化，待重算」——**不是一次失败的运行**，
 * 而是一次**曾经成功、现在已经过期**的运行。标成红的表现是评估师以为算错了、
 * 去查算式，而实际要做的只是「再跑一次」；标成绿的更坏：
 * `CALCULATION_STALE`（1042006006）的文案是「结果不可用于出稿」，
 * 而一个绿色的「成功」会让人拿它去出稿。
 * 所以它必须是**警示色**，与 FAILED 的错误色分开。
 *
 * <h3>🔴 这一份只用于筛选与 tag 上色</h3>
 * 单元格里的文字用后端的 `statusDescription`。
 */
export const CALCULATION_STATUS_OPTIONS: QlzgOption[] = [
  { label: '成功', value: 'SUCCESS' },
  { label: '失败', value: 'FAILED' },
  { label: '输入已变化，待重算', value: 'STALE' }
]

export const calculationStatusTagType = (
  status?: string
): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'SUCCESS') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'STALE') return 'warning'
  return 'info'
}

/**
 * 评估方法 ← 后端 {@code QlzgValuationMethodEnum}
 *
 * <h3>🔴 这里只放**四个**，而后端枚举有 24 个</h3>
 * MVP 只实现了市场比较法 / 收益法 / 成本法 / 假设开发法四种
 * （`QlzgValuationMethodEnum` 的前四项，顺序也一致）。
 * 把 24 个都放进下拉的话，用户选了第五个会得到
 * `CALCULATION_METHOD_NOT_IMPLEMENTED`（1042006010）——
 * 那句文案是「平台尚未实现」，评估师会以为要等版本，
 * 而他本来可以换一种方法算。**不给一个点了必然报错的选项**，
 * 这与 {@code SUBJECT_TYPE_OPTIONS} 里「放了用户就会去调它，而调不动」是同一条纪律。
 *
 * <h3>🔴 而且这四个还要再被品类的 {@code method_codes.allowed} 收窄一次</h3>
 * 下拉的真实可选项是**这两份的交集**：品类不允许的方法即使平台实现了也不能选
 * （`CALCULATION_METHOD_NOT_ALLOWED`，1042006005）。
 * 所以这一份常量的用途是「给交集里的码一个中文名」，不是「直接当下拉的数据源」。
 * 直接拿它当数据源的表现是：一个房地产品类的测算页上出现了「假设开发法」，
 * 点下去报「品类不允许」—— 而后端明明已经在 `method_codes` 里说清楚了。
 *
 * <h3>⚠️ 后端枚举的第三个构造参数是 `textbookOnly`</h3>
 * 24 个里只有 `EVA` 与 `DDM` 是 true（「准则未明文列举的教材方法」）。
 * 这四个 MVP 方法都是 false，所以前端**不需要**这个维度；
 * 等 I5 的规则要按它分档时再加，届时它才有第二种取值。
 */
export const VALUATION_METHOD_MVP_OPTIONS: QlzgOption[] = [
  { label: '市场比较法', value: 'MARKET_COMPARISON' },
  { label: '收益法', value: 'INCOME_APPROACH' },
  { label: '成本法', value: 'COST' },
  { label: '假设开发法', value: 'HYPOTHETICAL_DEVELOPMENT' }
]

/**
 * 结果确定的**综合方式** ← 后端 {@code QlzgCombineTypeEnum}（§11.4.3 的五种）
 *
 * <h3>🔴 五档各自要求的东西不同，这是本页最容易做错的一处</h3>
 * - `SINGLE`：只允许**一条**测算参与（多了报 `CALC_RESULT_SINGLE_NEEDS_ONE`）
 * - `ARITHMETIC_MEAN`：不要权重
 * - `WEIGHTED`：逐项给权重与理由，且权重之和必须**正好是 1**
 *   （三项等权要写 0.3334 / 0.3333 / 0.3333）。平台**刻意不提供推荐权重** ——
 *   `CALC_RESULT_WEIGHTS_REQUIRED`（1042006038）的文案里就写着这句
 * - `RANGE`：必须给 `finalValue`，且它要落在参与测算的 `[rangeLower, rangeUpper]` 内
 * - `PROFESSIONAL_JUDGMENT`：必须给 `finalValue`，**可以**在区间外
 *   （要另给一个区间外的值就必须改用这一档，那是
 *   `CALC_RESULT_FINAL_VALUE_OUT_OF_RANGE` 文案里明说的出路）
 *
 * <h3>⚠️ 「方法数不少于两种」**不是**写时校验，别在前端加</h3>
 * 后端写时只查 `SINGLE` 的条数，`ARITHMETIC_MEAN` 拿一条测算也照样能确定。
 * 「两种以上」这个要求是 **R02**，归 I5 的复核引擎：它在**出稿前**判、可豁免、
 * 且要留下豁免理由 —— 与「写不进去」是两件事。前端把它做成写时校验的后果是
 * 一个只跑得出一种方法的标的（例如没有可比案例、收益法又缺参数）**连结果都定不了**，
 * 而 V5 要的是「定得下来、但复核时命中 R02 并走豁免」。
 *
 * 🔴 所以切换这一档时要把「权重表」与「最终评估值输入框」的可见性一起切，
 *    并把上一次的残留**清掉**：`weights` 在非 WEIGHTED 档传上去会被后端忽略且不落库，
 *    留着残留不会报错，但会让「我明明填了权重怎么没存下来」变成一次排查
 */
export const COMBINE_TYPE_OPTIONS: QlzgOption[] = [
  { label: '单一方法', value: 'SINGLE' },
  { label: '算术平均', value: 'ARITHMETIC_MEAN' },
  { label: '加权', value: 'WEIGHTED' },
  { label: '区间', value: 'RANGE' },
  { label: '专业判断', value: 'PROFESSIONAL_JUDGMENT' }
]

/**
 * 哪些综合方式需要用户手填 `finalValue`
 *
 * 🔴 只有这两档：其余三档的最终值由后端从参与测算的结果值算出来
 *    （SINGLE 取那一条，ARITHMETIC_MEAN 取平均，WEIGHTED 取加权和）。
 *    在这三档上放一个可编辑的金额框，用户填了却不生效 ——
 *    那是「拨得动、存不下、也不报错」，与上面 `canBeBlockRule` 那条同一个坏法
 */
export const COMBINE_TYPES_NEEDING_FINAL_VALUE = ['RANGE', 'PROFESSIONAL_JUDGMENT']

export const combineTypeNeedsFinalValue = (combineType?: string): boolean =>
  !!combineType && COMBINE_TYPES_NEEDING_FINAL_VALUE.includes(combineType)

/**
 * 🔴 这里**刻意没有** `UNIT_PRICE_BASIS_OPTIONS`
 *
 * `qlzg_calc_result.unit_price_basis` 存的不是码，是**一整句中文**：
 * 比较法写「单价 = 成交价 / 建筑面积」（还原过真实成交价时写「还原价」），
 * 收益法写「单价 = 收益法评估值 / 建筑面积」，
 * 后端 `QlzgCalcResultServiceImpl` 兜底那一份才是短词「建筑面积」。
 * 它是 `RatioCalculator#ratio` 的 `basisLabel` 入参，由**每个方法自己声明**
 * （算子的注释写明「口径必须由调用方声明，算子只看见两个数，造不出这句话」）。
 *
 * 所以这一栏在前端是**原样渲染**，不查表、不翻译、不做筛选下拉。
 * 造一份三值码表的后果是：`labelOf` 认不出这些句子、回落到原文，
 * 看起来「能用」，而一旦哪天方法改了措辞，界面上就多出一个没人维护的映射。
 */

// ==================== 报告域（I4）====================

/**
 * 交付物类型 ← 后端 {@code QlzgReportTypeEnum}
 *
 * <h3>🔴 这里只放**两个**，后端枚举有三个</h3>
 * `CALC_SHEET`（测算成果表）**不是一份报告**：它是 I3 那条
 * `/qlzg/calc-result/export-calc-sheet` 直接导出的 Excel，不走报告状态机、
 * 不成文、不定稿。把它放进这个下拉的后果是用户选它建出一份报告，
 * 而建报告要求 `templateId` —— 测算成果表没有模板，
 * 于是他会得到一个「模板不能为空」的报错，而那个报错不会告诉他这一项本来就不该在这里。
 */
export const REPORT_TYPE_OPTIONS: QlzgOption[] = [
  { label: '技术报告', value: 'TECHNICAL' },
  { label: '结果报告', value: 'RESULT' }
]

/**
 * 报告状态 ← 后端 {@code QlzgReportStatusEnum}（§9.4 状态机）
 *
 * <h3>🔴 只有三态，而且**刻意**没有 CANCELLED 与 INTERRUPTED</h3>
 * §11.18.2 要求「中断把 status 退回 DRAFT，不是 CANCELLED」，
 * 并明说「INTERRUPTED 与 CANCELLED 绝不能合并」。
 * 兑现这两句最便宜的办法是**两个都不要有**：枚举里没有那两个值，
 * 就没有任何一条代码路径能把它们混起来。
 * 所以界面上不要为「已取消」留一个 tag 分支 —— 那一支永远走不到，
 * 而留着它会让下一个人以为库里真有那个状态。
 *
 * <h3>🔴 MVP 只交付两条边</h3>
 * `DRAFT → FINALIZED`（闸 C 四道全过）与 `任意状态 → VOIDED`。
 * `FINALIZED → DRAFT` 是「退回修订」，它**不**清 `finalizedAt`、
 * **不**清 `currentVersionId`、也**不**再写一行版本快照 ——
 * 已定稿的那一版是法定档案，退回修订只是让当前草稿可写。
 * 所以措辞要写「退回修订」，不要写「撤销定稿」：后者说的是把档案撤回去，
 * 而系统没有做那件事，也不该做。
 */
export const REPORT_STATUS_OPTIONS: QlzgOption[] = [
  { label: '草稿', value: 'DRAFT' },
  { label: '已定稿', value: 'FINALIZED' },
  { label: '已作废', value: 'VOIDED' }
]

export const reportStatusTagType = (
  status?: string | null
): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'FINALIZED') return 'success'
  if (status === 'VOIDED') return 'info'
  return 'warning'
}

/**
 * 作业档位 ← 后端 {@code QlzgWorkModeEnum}（§9.2）
 *
 * 🔴 **只有 M0 一档可选**，M1 / M2 分别在 I8 / I9 交付。
 * 不给「点了必然报错的选项」—— 与 `VALUATION_METHOD_MVP_OPTIONS` 那条同一个纪律。
 * 而且这一栏在界面上**只读**：`mode` 在创建那一刻由服务端显式写死，
 * 任何 ReqVO 里都没有它（§9.4 纪律 3，后端守卫钉着）。
 * 做一个能拨的下拉等于宣称「档位是可以事后改的」，
 * 而事后改档位就是改账 —— D2 的验收 SQL 正是按这一列筛的。
 */
export const WORK_MODE_OPTIONS: QlzgOption[] = [{ label: 'M0 零 AI 成稿', value: 'M0' }]

/**
 * 闸 B 占位符闭合的三态 ← 后端 {@code QlzgPlaceholderClosureStatusEnum}
 *
 * 🔴 **三态不是两态**，`PENDING` 必须与 `FAILED` 分开显示：
 * `FAILED` 是「跑过了，有阻断项」，`PENDING` 是「还不知道」
 * （刚建出来还没上传 docx 的模板、以及**回滚**产生的版本都是这个状态）。
 * 把 `PENDING` 显示成「未通过」会让评估师去改一个根本没问题的模板，
 * 而他会找不到要改什么 —— 然后得出结论：这个工具的提示不可信。
 */
export const CLOSURE_STATUS_OPTIONS: QlzgOption[] = [
  { label: '未校验', value: 'PENDING' },
  { label: '校验通过', value: 'PASSED' },
  { label: '校验未通过', value: 'FAILED' }
]

export const closureStatusTagType = (
  status?: string
): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'PASSED') return 'success'
  if (status === 'FAILED') return 'danger'
  return 'info'
}

/**
 * 闸 B 的十一种发现 ← 后端 {@code QlzgClosureFindingTypeEnum}
 *
 * <h3>🔴 为什么前端要抄一份中文，而不是只用后端给的 `typeDescription`</h3>
 * 因为**有两个来源、其中一个不带中文**：
 * ① 解析 / 预览 / 发布的返回里，`closure.findings[]` 是正儿八经的
 *    {@code QlzgTemplateClosureVO.FindingVO}，**带** `typeDescription`；
 * ② 而模板行与版本行上那个 `placeholderClosureDetail` 是
 *    {@code List<Map<String, Object>>}，键只有
 *    {@code type / blocking / placeholder / fieldKey / message} —— **没有** `typeDescription`
 *    （{@code QlzgClosureFinding#toDetail()} 就写这五个键）。
 * 所以刚打开设计器（还没解析过）时，面板上的发现全部来自 ②，
 * 只靠后端那份中文就会显示成裸码 `UNKNOWN_FIELD` ——
 * 而「不给评估师看裸枚举码」正是提交 cf369a977 修掉的那一类缺陷。
 *
 * 🔴 取的时候按「后端给的优先、前端这份兜底」：
 *    `finding.typeDescription || labelOf(CLOSURE_FINDING_TYPE_OPTIONS, finding.type)`。
 *    反过来（前端优先）的话，后端哪天把某一类的说法改准了，界面上还是旧的那句。
 * ⚠️ 这十二条的中文是**从枚举的 description 逐条抄的**，后端加一类就要补一条。
 *    漏补的表现不是报错，是那一类在界面上显示成裸码 —— 而裸码恰好是这一栏存在的理由。
 */
export const CLOSURE_FINDING_TYPE_OPTIONS: QlzgOption[] = [
  { label: '映射到了品类字段清单之外的键', value: 'UNKNOWN_FIELD' },
  { label: '渲染器认不出来，会原样印在纸上', value: 'INVISIBLE_PLACEHOLDER' },
  { label: '结构件的语法符号用错了', value: 'WRONG_SIGN' },
  { label: '未映射到字段，且没有填写原因', value: 'UNMAPPED_NO_REASON' },
  { label: '未映射到字段，已填写原因', value: 'UNMAPPED_WITH_REASON' },
  { label: '按相似度推测的映射还没有人工确认', value: 'SIMILAR_NOT_CONFIRMED' },
  { label: '品类必填字段在模板里没有位置', value: 'MISSING_REQUIRED_FIELD' },
  { label: '启用中的拦截规则要读的章节，在模板里没有位置', value: 'MISSING_RULE_DEMANDED_SECTION' },
  { label: '章节树的 sort 顺序交叉', value: 'SECTION_SORT_VIOLATION' },
  { label: '样例渲染失败', value: 'RENDER_FAILED' },
  { label: '渲染产物里残留着占位符', value: 'RENDER_RESIDUAL' },
  { label: '签章位已预留，签章功能在 I30', value: 'SEAL_RESERVED' }
]

/**
 * 占位符是怎么绑上字段键的 ← 后端 {@code QlzgMappingBoundByEnum}
 *
 * 🔴 只有 `AUTO_SIMILAR` 那一档需要人工点一次确认，
 *    而**判据在后端**（`suggestions[].needsConfirmation`），前端不要自己比 `boundBy`。
 *    这条规则会变；前端抄一份就会在后端放宽之后仍然拦着人。
 * 🔴 `STRUCTURAL` 是平台结构件（区块、表格、签章位），**不参与字段映射**，
 *    所以它那一行的「绑到哪个字段」下拉要禁用 —— 能拨却不生效，
 *    与上面 `COMBINE_TYPES_NEEDING_FINAL_VALUE` 那条同一个坏法。
 */
export const BOUND_BY_OPTIONS: QlzgOption[] = [
  { label: '按字段键同名自动绑定', value: 'AUTO_KEY' },
  { label: '按字段中文名自动绑定', value: 'AUTO_LABEL' },
  { label: '按名字相似度推测，须人工确认', value: 'AUTO_SIMILAR' },
  { label: '平台结构件，不参与字段映射', value: 'STRUCTURAL' },
  { label: '人工指定', value: 'MANUAL' }
]

/**
 * poi-tl 的语法符号 ← 后端 {@code QlzgTemplateSuggestionVO#sign}
 *
 * 🔴 键是**符号本身**，空串代表标量。JS 对象的空串键是合法的，
 *    取的时候写 `PLACEHOLDER_SIGN_LABELS[sign ?? '']`。
 * 🔴 这份表**只用于给人看**，不要拿它去校验模板 ——
 *    哪个符号配哪种结构件由后端的闸 B ②（`WRONG_SIGN`）判，
 *    前端再判一次就会与它漂。
 */
export const PLACEHOLDER_SIGN_LABELS: Record<string, string> = {
  '': '标量',
  '?': '区块（开始）',
  '#': '表格',
  '@': '图片',
  '/': '区块（收尾）'
}

/** 话术审核状态 ← 后端 {@code QlzgPhraseReviewStatusEnum} */
export const PHRASE_REVIEW_STATUS_OPTIONS: QlzgOption[] = [
  { label: '待审核', value: 'DRAFT' },
  { label: '已通过', value: 'APPROVED' },
  { label: '已驳回', value: 'REJECTED' }
]

export const phraseReviewStatusTagType = (
  status?: string
): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'APPROVED') return 'success'
  if (status === 'REJECTED') return 'danger'
  return 'warning'
}

/** 话术来源 ← 后端 {@code QlzgPhraseSourceEnum} */
export const PHRASE_SOURCE_OPTIONS: QlzgOption[] = [
  { label: '人工编写', value: 'MANUAL' },
  { label: 'AI 改写沉淀', value: 'FROM_AI_EDITED' }
]

/**
 * 字段种类 ← 后端 {@code QlzgReportFieldKindEnum}
 *
 * 🔴 它决定**读哪一态值**：TEXT 读 `valueStr`，
 * AMOUNT / RATE / AREA / COUNT 读 `valueNum`，DATE 读 `valueDate`，
 * 表格与区块那类结构件读 `valueJson`。
 * 所以作业台的输入控件要按它切，而**四态要一起提交**（空的传 null）——
 * 后端用 `FieldStrategy.ALWAYS`，靠一个显式的 null 把旧那一态清掉。
 * 只传「有值的那一态」的话，从 TEXT 改成 DATE 之后 `value_str` 里的旧文本还在，
 * 库里躺着一个谁也不读的旧值，出问题时排查方向会跑到渲染器上去。
 */
export const FIELD_KIND_OPTIONS: QlzgOption[] = [
  { label: '文本', value: 'TEXT' },
  { label: '金额', value: 'AMOUNT' },
  { label: '比率', value: 'RATE' },
  { label: '面积', value: 'AREA' },
  { label: '数量', value: 'COUNT' },
  { label: '日期', value: 'DATE' }
]

/**
 * 值的来源 ← 后端 {@code QlzgReportFieldSourceTypeEnum}
 *
 * <h3>🔴 `isMarked`（红标）由服务端按这一列落定，**不接受前端提交**</h3>
 * `PARAM` 一律标红（比枚举注释里那句「跨辖区回退才标」更粗）。
 * 收窄需要的事实（「这次查参请求的是哪个辖区」）库里没有，
 * 而漏标的代价是一个**没有本辖区依据的数进了法定报告**。
 * 所以前端不要自己做「哪些来源该标红」的判断，读 `isMarked` 就行。
 *
 * <h3>🔴 这一份是**给显示用的全表**，不是「界面上能选的那几档」</h3>
 * `AI` 随 I9、`EXTRACT` 随 I8、`DEFAULT` 由后端在缺值兜底时写、`PHRASE` 由右栏的
 * 插入话术写（`/field/insert-phrase`，因为插入前必须先渲染预览、看完 warnings）、
 * `CALC` 与 `PARAM` 目前**没有任何一条主代码写路径** —— 成文时直接读
 * {@code qlzg_calc_result}，测算数字是经模型进 docx 的，不经报告字段行。
 * 所以这里七档全列出来只为一件事：把服务端读回来的那一列翻成中文。
 * 作业台**没有**来源下拉，理由见下面那一段。
 *
 * <h3>🔴 作业台**不给**「改来源」这个下拉，新建的一格一律 MANUAL</h3>
 * 后端 {@code updateField} 对 {@code sourceType} / {@code sourceRefId} /
 * {@code provenanceId} 三列都是<b>无条件 set</b>，所以让人改来源就意味着
 * 要一并交出 {@code sourceRefId} —— 而前端没有「挑一条测算结果行 / 一条参数快照行」的界面。
 * 放一个只能选来源、选不了出处的下拉，产出的是一批
 * {@code source_type = CALC} 而 {@code source_ref_id IS NULL} 的行：
 * 溯源那一栏空着，而 R36「有依据」照样判它<b>有</b>依据。
 * 把一条 PHRASE 行改成 MANUAL 更坏，{@code sourceRefId} 还指着那条话术，
 * 是一处界面上看不出任何异常的<b>悬空引用</b>。
 *
 * <p>⚠️ 顺带说明为什么 MVP 不需要它：测算结果<b>不</b>经报告字段行进 docx ——
 *    成文时直接读 {@code qlzg_calc_result}（{@code QlzgReportComposeServiceImpl}）。
 *    报告字段行装的是人工录的与话术插的那些<b>文本</b>。
 *    等 I6 交付溯源时再决定要不要给「这一格的值来自哪一次测算」一个可点的出处。
 */
export const FIELD_SOURCE_TYPE_OPTIONS: QlzgOption[] = [
  { label: '人工录入', value: 'MANUAL' },
  { label: '话术', value: 'PHRASE' },
  { label: '测算', value: 'CALC' },
  { label: '参数', value: 'PARAM' },
  { label: '资料抽取', value: 'EXTRACT' },
  { label: 'AI 生成', value: 'AI' },
  { label: '默认值', value: 'DEFAULT' }
]

/**
 * 本节内容的来源 ← 后端 {@code QlzgSectionContentModeEnum}
 *
 * 🔴 它只**往前**推：STATIC → PHRASE → MIXED，不会退回。
 * 前端**读它、不写它** —— 推进由后端在插话术 / 存字段值时做，
 * 而 I26 要靠 MIXED 的数量决定往话术库补什么。
 * `AI` 那一档随 I9，现在不会出现在任何一行上。
 */
export const SECTION_CONTENT_MODE_OPTIONS: QlzgOption[] = [
  { label: '模板静态文本', value: 'STATIC' },
  { label: '话术', value: 'PHRASE' },
  { label: '混合', value: 'MIXED' },
  { label: 'AI 生成', value: 'AI' }
]

// ==================== 复核域（I5）====================

/**
 * 复核档位 ← 后端 {@code QlzgReviewModeEnum}（§11.9.2）
 *
 * <h3>🔴 三条中文现在是后端枚举 description 的**逐字副本**，由 constants.spec.ts 钉住</h3>
 * I5-c 之前那个枚举只有码没有中文名（它是三级配置的内部取值，本来不给人选），
 * 于是这三条中文曾是前端自己编的（`ADVISORY` 写成「仅提示」、`OFF` 写成「关闭（须留豁免痕）」）。
 * I5-c 给枚举补上了 description，两份就开始分叉 —— 而分叉**不报错**：
 * 配置页显示「关闭（须留豁免痕）」，工作台与留痕列表显示后端那个「关闭复核」，
 * 同一个档位在两个页面上叫两个名字，用户会以为是两件事。
 * 本模块的规矩是「展示已有数据用后端的 {@code *Name} / {@code *Description}」，
 * 而 {@code QlzgReportRespVO#reviewModeEffective} **只有码没有名字**（那一列是报告创建时
 * 冻结的取值，后端没有为它派生中文），所以这一份 map 仍是必需的，只是必须逐字对齐。
 *
 * <h3>🔴 报告上的 {@code reviewModeEffective} 是**创建时**解析三级配置的结果</h3>
 * 之后永不随配置变 —— 界面上要说清「这是当时生效的档位」，
 * 不要让它看起来像一个能改的下拉。要改走 {@code /qlzg/review/config/report}，
 * 而那一个只对 DRAFT 开放。
 *
 * <h3>🔴 {@code INHERIT} **不在这一份里**，也不该在</h3>
 * 它是项目级 / 报告级两个弹层里「清空本级配置、回到继承上一级」这个**动作**的取值，
 * 不是一档。后端刻意没把它放进枚举：塞进去的话，
 * 「三档」的唯一权威就要为一个不可能出现在 {@code review_mode_effective} 里的取值
 * 编一个答案，而任何答案都是错的。前端这一份是「三档」的展示副本，同理不收。
 * 那两个弹层要显示「跟随机构配置」这一项时，用 {@link REVIEW_INHERIT} 那个常量，
 * 并且**只在项目级 / 报告级**的下拉里出现 —— 机构级没有上一级，
 * 传 INHERIT 会被 {@code QlzgReviewModeEnum#of} 按「配置坏了」落成 ENFORCE。
 *
 * <h3>🔴 解析成 {@code OFF} 而**没有**对应留痕的报告，一份也定不了稿</h3>
 * {@code REVIEW_OFF_UNTRACED}（1042008017）是硬闸，文案是「《资产评估法》第二十六条要求
 * 责任落到人，无法回答『谁在什么时候决定不跑』就不允许出稿」。
 * I5-c 已经交付了 {@code qlzg_review_waiver} 的写入路径，所以正常操作走不到这一支 ——
 * 走到的只有「有人直接改了库里的 {@code review_mode}」这一种情况。
 * 定稿失败时要把后端那句**原文**显示出来，不要自己猜原因：
 * 前端猜的那一句会是「请联系管理员」，而真相是「这一行配置没有对应的决定记录」，
 * 两者的出路完全不同。
 */
export const REVIEW_MODE_OPTIONS: QlzgOption[] = [
  { label: '强制复核', value: 'ENFORCE' },
  { label: '提示复核', value: 'ADVISORY' },
  { label: '关闭复核', value: 'OFF' }
]

/**
 * 「清空本级配置、回到继承上一级」这个动作的取值，与后端
 * {@code QlzgReviewModeSaveReqVO#INHERIT} 逐字相同
 *
 * 🔴 **大写、逐字**，前端也不要做大小写归一：归一等于替用户猜意图，
 *    而猜错的产物是一行**看起来完全正常**的假留痕。
 * 🔴 只对**项目级与报告级**合法。机构级的 {@code review_mode} 是
 *    {@code NOT NULL DEFAULT 'ADVISORY'}，它没有上一级可继承
 */
export const REVIEW_INHERIT = 'INHERIT'

/**
 * **项目级**弹层里那第四项的文案 —— 🔴 刻意不叫「清除」也不叫「默认」
 *
 * 「清除」听起来像撤销一个多余的动作，而它可能是一次**实际的控制放松**：
 * 机构是 OFF、本项目原来钉着 ENFORCE 的话，回到继承之后本项目就跟着变成 OFF。
 * 所以文案要把「跟谁走」说出来，让点它的人在点之前就知道自己是在放松。
 * 🔴 报告级用 {@link REVIEW_INHERIT_LABEL_REPORT}，那一句的上一级不是机构
 */
export const REVIEW_INHERIT_LABEL = '跟随机构配置（清空本级）'

/**
 * 报告级弹层里那第四项的文案 —— 🔴 与 {@link REVIEW_INHERIT_LABEL} **刻意不是同一句**
 *
 * 两级的上一级不一样：项目级的父级是机构（后端 {@code resolveFromOrg}），
 * 报告级的父级是**项目**（{@code resolveFromProject}），而项目自己那列也可空 ——
 * 于是报告级的「跟随上级」实际是「跟随项目，项目没表态时再跟随机构」。
 * 报告级弹层上写「跟随机构配置」的话，一个「项目钉着 ENFORCE、机构是 OFF」的项目里，
 * 点它的人以为自己在把这份报告放松到 OFF，而解析出来的是 ENFORCE；
 * 反过来（项目 OFF、机构 ENFORCE）他以为在收紧、其实是放松。
 * 两处都返回 200，留痕行如实记下解析后的档位 —— 只有界面上那句话是错的
 *
 * <p>⚠️ 括号里的「清空本级」同样要留着：它说的是**数据动作**
 *    （把 {@code qlzg_report.review_mode} 那一列写成 NULL），
 *    而前半句说的是**后果**。两者都要，缺一半就会被读成「什么都没改」
 */
export const REVIEW_INHERIT_LABEL_REPORT = '跟随项目配置（项目没表态时跟随机构，清空本级）'

/**
 * 三档的**后果**，逐字取自 §11.9.2.6 第 2 条
 *
 * <h3>🔴 选择器必须把后果写在选项上，不是只写档位名</h3>
 * 三轮要求 3 的原话是「我们做好提示和声明就可以了」——
 * 而**提示必须是决策点上的提示，不是文档里的提示**。
 * 用户在选的那一刻看到的文字，才是唯一有效的告知：
 * 把这三句放进帮助文档、放进 tooltip 的「?」图标里，都等于没放 ——
 * 赶稿的人不会去点那个问号，而赶稿正是这个选择器最需要被看见的时刻。
 *
 * <h3>🔴 它是**第三列**，不是 label 的一部分</h3>
 * 所以刻意不做成 {@link QlzgOption}：把「关闭复核 —— 不跑机器复核，报告页不再显示
 * BLOCK 清单」塞进 {@code label} 的话，留痕列表、报告页那一栏、工作台的档位标
 * 全都得跟着变长，而那三处要的是短名字。
 * 下拉里两行显示（名字 + 后果），其余场合只用 {@link REVIEW_MODE_OPTIONS}。
 *
 * <h3>🔴 认不出的码返回**空串**，不回落成码本身</h3>
 * 这里与 {@link labelOf} 的回落规则**刻意不同**：label 认不出时显示原码是有用的
 * （「这一列被写坏了」看得见），而后果认不出时显示原码，
 * 产出的是一句 `WHATEVER` 冒充「选了它会发生什么」——
 * 一句读起来像说明的乱码，比一片空白更坏
 */
export const REVIEW_MODE_CONSEQUENCES: Record<string, string> = {
  ENFORCE: '机器复核，BLOCK 未清零不能定稿',
  ADVISORY: '机器复核照跑，只提示不拦截',
  OFF: '不跑机器复核，报告页不再显示 BLOCK 清单'
}

/** 取一档的后果文案；认不出的码返回空串（理由见 {@link REVIEW_MODE_CONSEQUENCES}） */
export const reviewModeConsequence = (mode?: string | null): string =>
  mode == null ? '' : (REVIEW_MODE_CONSEQUENCES[mode] ?? '')

/**
 * 复核档位的 tag 颜色
 *
 * 🔴 `OFF` 是**红的**。这里的红不是说「配置坏了」，是说「控制被关掉了」——
 *    而这正是内控配置页上唯一该让监管的眼睛第一时间找到的东西
 *    （§11.9.2.6 第 4 条在报告页用一条常驻灰条办同一件事，
 *    配置页上对应的办法是红 tag + 紧挨着它的变更历史列表）。
 * 🔴 `ADVISORY` 是黄的：规则照跑、只是不拦，
 *    而「跑了但不拦」在责任上是一次**转移**（§11.9.2.5：机器不拦了，人必须拦），
 *    不该看起来与 ENFORCE 一样安心。
 * 🔴 认不出的码是**灰的**，不是红的：那一格旁边会把原码一并显示出来
 *    （{@link labelOf} 的回落），红灰之分要留给「关掉了」与「不知道」这两件不同的事 ——
 *    前者查留痕就能问清是谁决定的，后者是数据坏了，两件事的出路完全不同
 */
export const reviewModeTagType = (
  mode?: string | null
): 'success' | 'warning' | 'danger' | 'info' => {
  if (mode === 'ENFORCE') return 'success'
  if (mode === 'ADVISORY') return 'warning'
  if (mode === 'OFF') return 'danger'
  return 'info'
}

/**
 * 一次复核运行的状态 ← 后端 {@code QlzgReviewRunStatusEnum}
 *
 * <h3>🔴 三种状态在报告页对应三条**互斥**的横条，缺一条就是一种谎</h3>
 * OFF 档下闸 C 照样落一行运行头，状态是 SKIPPED、{@code totalRules = 0} ——
 * 那是「**一行规则都没跑**」，对应报告页那条常驻**灰条**；
 * FAILED 是「跑了、但有规则求值失败，那几条既不算通过也不算命中」，对应**红条**；
 * OK 且 {@code blockCountUnwaived > 0} 对应**黄条**。
 * 三条判据在 {@code reviewFlow.ts#reportReviewBannerOf} 里，顺序不可调换。
 * 于是「一条横条都没有」只剩两种含义：这份报告从来没被复核过
 * （{@code /run/latest} 返回 null），或者跑完了且已清零 ——
 * 而这两种在报告作业台顶部那一格「机器复核」上分开写着，不再靠横条的缺席去猜。
 * 把 SKIPPED 渲染成绿的后果是「查过了，没问题」，而真相是一行都没查。
 *
 * <h3>🔴 {@code FAILED} 不等于「没命中」</h3>
 * 它是「复核未完成」—— 引擎在半路上出错了。此时 {@code passed} 仍然是 0，
 * 闸 C 在 ENFORCE 档下照样拦（{@code REVIEW_RUN_FAILED} 排在 {@code GATE_C_BLOCKED} **之前**），
 * 而界面上要说清「这一次没查完」，不要显示成「查完了，有 N 条问题」。
 * 🔴 这一条 2026-11-03 才真的落地：在此之前报告页只认 SKIPPED，
 *    一次 FAILED 的运行 {@code blockCountUnwaived} 是 0（求值失败的行不是 BLOCK 命中）
 *    ⇒ 一条横条都不显示、定稿弹层写着「未清零 BLOCK 0 条」。
 *    它会真实发生 —— 当天那次「全系统一份也定不了稿」（装载器少供 2 个事实、48 条全部求值失败）
 *    在报告页上就是干净的
 */
export const REVIEW_RUN_STATUS_OPTIONS: QlzgOption[] = [
  { label: '复核完成', value: 'OK' },
  { label: '复核未完成', value: 'FAILED' },
  { label: '未运行（档位关闭）', value: 'SKIPPED' }
]

/**
 * 运行状态的 tag 颜色
 *
 * 🔴 `SKIPPED` 用**灰**（info），与报告页那条灰条同一个语义：不是出错，是「按配置没跑」。
 *    用红的话，一个依法关掉了机器复核、并且**留了痕**的机构，
 *    在自己的内控页上看起来像出了事故
 */
export const reviewRunStatusTagType = (
  status?: string | null
): 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'OK') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'SKIPPED') return 'info'
  return 'warning' // 认不出的码：这一列被写坏了，而它决定报告页显示哪一条
}

/**
 * 规则严重度 ← 后端 {@code QlzgRuleSeverityEnum}
 *
 * 🔴 顺序是**从严到轻**（BLOCK → WARN → INFO），与枚举声明顺序一致。
 *    {@link RULE_SEVERITY_ORDER} 是同一份事实的**升序**数组，供比大小用；
 *    两份都由 spec 钉住，改一个不改另一个会被测出来
 */
export const RULE_SEVERITY_OPTIONS: QlzgOption[] = [
  { label: '拦截', value: 'BLOCK' },
  { label: '提示', value: 'WARN' },
  { label: '告知', value: 'INFO' }
]

/**
 * 严重度的**升序**取值，即后端那个 {@code priority}（INFO 1 / WARN 2 / BLOCK 3）的序
 *
 * 🔴 只有「谁比谁严」这一个用途，别拿它当展示顺序用 —— 展示走
 *    {@link RULE_SEVERITY_OPTIONS}（从严到轻，配置页要让人先看见能拦人的那一档）
 * 🔴 认不出的码在这里**没有位置**（{@code indexOf} 返回 −1），
 *    而 −1 比 0 还小，于是「一个坏码 ≤ BLOCK」恒成立。
 *    所以用它之前必须先过 {@link reviewFlow} 那道「是不是三档之一」的判断
 */
export const RULE_SEVERITY_ORDER = ['INFO', 'WARN', 'BLOCK']

/**
 * 严重度的 tag 颜色
 *
 * 🔴 `BLOCK` 红 / `WARN` 黄 / `INFO` 灰 —— 与报告页黄条上那个整数同一套语义。
 *    认不出的码给**灰**：它已经拦不住任何报告了（后端 {@code ofStrict} 对它返回 null，
 *    于是 {@code blocksFinalizeNow} 恒为 false），
 *    给红会让人以为定稿被一条坏数据卡住了，而实际卡住它的是别的东西
 */
export const ruleSeverityTagType = (severity?: string | null): 'warning' | 'danger' | 'info' => {
  if (severity === 'BLOCK') return 'danger'
  if (severity === 'WARN') return 'warning'
  return 'info'
}

/**
 * 法域 ← 后端 {@code QlzgLawDomainEnum}（《资产评估法》那把六级梯子）
 *
 * <h3>🔴 顺序是**优先级 1 → 6**，即「依据有多硬」，不是显示偏好</h3>
 * 优先级决定两件事：同一处命中被多条规则判到时听谁的，以及**天花板**
 * （{@code maxSeverity()}）—— 优先级 5「专家指引」的天花板是 WARN，
 * 因为建议性文件不能产生强制性拦截，且**永不升级**。
 *
 * <h3>🔴 规则配置页上这一项是**固定显示「机构内部制度」**，不是一个能选的下拉</h3>
 * 后端 {@code resolveLawDomain} 对其余五个一律拒（{@code REVIEW_RULE_LAW_DOMAIN_FORCED}）：
 * 让一条机构私规在 30 年档案里宣称自己有法律授权，是不可接受的。
 * 而 ORG_INTERNAL **照样可以配 BLOCK** —— 机构自己的内控要求本来就能拦自己人的稿。
 * 所以「选不了法律」不是功能缺失，那五个值出现在这份表里只为**展示**
 * （平台预置行、留痕里的引用），不为选择。
 * 一个只有一项可选的下拉，产出的是「为什么选不了」这个疑问，
 * 而答案比疑问更该被看见 —— 所以直接印一行说明，别做下拉。
 */
export const LAW_DOMAIN_OPTIONS: QlzgOption[] = [
  { label: '法律', value: 'LAW' },
  { label: '强制法规', value: 'REGULATION' },
  { label: '执业准则', value: 'STANDARD' },
  { label: '专业规范', value: 'SPEC' },
  { label: '专家指引', value: 'EXPERT_GUIDE' },
  { label: '机构内部制度', value: 'ORG_INTERNAL' }
]

/** 留痕作用域 ← 后端 {@code QlzgWaiveScopeEnum}（机构 → 项目 → 报告，三级由粗到细） */
export const WAIVE_SCOPE_OPTIONS: QlzgOption[] = [
  { label: '机构', value: 'ORG' },
  { label: '项目', value: 'PROJECT' },
  { label: '报告', value: 'REPORT' }
]

/**
 * 规则的判定目标 ← 后端 {@code QlzgRuleTargetKindEnum}
 *
 * 🔴 它决定命中能不能**定位回报告里的那一处**（{@code Anchor}）：
 *    FIELD → 字段格、SECTION → 章节、CALC → 测算页、REPORT → 无处可指。
 *    工作台那一列「定位」按钮的判据是后端算好的 {@code locatable}，
 *    前端**不要**自己按 targetKind 推 —— 一份 REPORT 级的规则也可能带着
 *    {@code sectionCode}，那时它是可定位的
 */
export const RULE_TARGET_KIND_OPTIONS: QlzgOption[] = [
  { label: '字段', value: 'FIELD' },
  { label: '章节', value: 'SECTION' },
  { label: '测算', value: 'CALC' },
  { label: '报告', value: 'REPORT' }
]

/**
 * 变更理由的字数上下限，与后端 {@code QlzgReviewWaiverDO#REASON_MIN_LENGTH} /
 * {@code #REASON_MAX_LENGTH} 同值
 *
 * <h3>🔴 下限这道前端校验是**体验**，不是**替代**</h3>
 * 后端刻意**只**在 VO 上写 {@code @NotBlank} 与 {@code @Size(max = 500)}，没有
 * {@code @Size(min = 10)}：短于 10 字要走「写一行 {@code rejected = 1} 的拒绝留痕、
 * 再抛 {@code REVIEW_WAIVER_REASON_REQUIRED}」这条路，
 * 而 Bean Validation 在进 Controller 之前就把请求打回去了，
 * 于是那次**尝试**一个字都不会留下。
 * 「有人在赶稿时想关掉复核」这条记录，比一次成功的降级更值得看见。
 * 所以绕过前端校验照样能打出请求、照样会被记下 —— 这不是漏洞，那是设计。
 *
 * <h3>🔴 上限 500 是**列宽**，超了后端会 {@code Data too long}</h3>
 * 那半句必须在前端拦：一个 500 字的输入框配一句「不能超过 500 个字符」的报错，
 * 比让用户写完 800 字再被拒要好
 */
export const REVIEW_REASON_MIN_LENGTH = 10
export const REVIEW_REASON_MAX_LENGTH = 500

// ==================== 溯源（I6-b） ====================

/**
 * 来源类型的图标 ← 后端 {@code QlzgProvenanceSourceTypeEnum}
 *
 * <h3>🔴 中文名**不在这里**，一律用后端下发的 {@code sourceTypeDescription}</h3>
 * 枚举是随版本发布的常量，前端再维护一份中文映射就是第二份口径，
 * 而漂开的表现是「同一个类型在清单上叫 A、在弹层上叫 B」—— 两处单看都对。
 * 这里只放**图标**与**颜色**：那是显示层的东西，后端不该知道 Element Plus 有什么图标。
 *
 * <h3>⚠️ 十二类全列，包括 MVP 一行也不会出现的四类预留</h3>
 * 预留的（财务报表 / 收益预测 / 可比公司 / 折现率参数）在 Service 的校验里就被拒了，
 * 所以 MVP 期它们不可能落库。列出来是为了 I14–I17 接上时**不必改这里** ——
 * 而漏一个的表现是那一类显示成一个问号图标，看起来像「平台不认得自己写的类型」。
 */
export const PROVENANCE_SOURCE_TYPE_ICONS: Record<string, string> = {
  MATERIAL: 'ep:document',
  CASE: 'ep:files',
  PARAM: 'ep:set-up',
  CALC: 'ep:data-analysis',
  AI: 'ep:magic-stick',
  DEFAULT: 'ep:info-filled',
  MANUAL: 'ep:edit-pen',
  TEMPLATE: 'ep:document-checked',
  FINANCIAL_STATEMENT: 'ep:tickets',
  FORECAST: 'ep:trend-charts',
  COMPARABLE_COMPANY: 'ep:office-building',
  DISCOUNT_RATE_PARAM: 'ep:discount'
}

export const provenanceSourceIcon = (sourceType?: string | null): string =>
  (sourceType && PROVENANCE_SOURCE_TYPE_ICONS[sourceType]) || 'ep:question-filled'

/**
 * 来源类型的标签颜色
 *
 * 🔴 `DEFAULT` 与 `AI` 用 danger，不是因为它们「错」，而是因为它们**最该被看见**：
 *    §11.3.1 那句「绝不静默用默认值」的落点就是这里 ——
 *    一格用了默认值而界面上它与「查到了本辖区参数」长得一样，
 *    评估师就永远不知道那个数是兜出来的。
 *    `PARAM` 用 warning 与报告字段的红标同一条理由（跨辖区回退）。
 * 🔴 认不出的码落 `info` 而不是 `danger`：那一格的问题是「平台不认得这个类型」，
 *    与「这一类的依据最弱」是两件事，用同一个颜色会让人排错方向
 */
export const PROVENANCE_SOURCE_TAG_TYPES: Record<string, string> = {
  MATERIAL: 'primary',
  CASE: 'success',
  PARAM: 'warning',
  CALC: 'primary',
  AI: 'danger',
  DEFAULT: 'danger',
  MANUAL: 'info',
  TEMPLATE: 'info'
}

export const provenanceSourceTagType = (
  sourceType?: string | null
): 'primary' | 'success' | 'info' | 'warning' | 'danger' => {
  const t = sourceType ? PROVENANCE_SOURCE_TAG_TYPES[sourceType] : undefined
  return (t as 'primary' | 'success' | 'info' | 'warning' | 'danger') || 'info'
}

/**
 * 来源类型的中文名 —— 🔴 **只**做兜底，正常路径是后端那一列
 *
 * 后端换不出描述时（理论上不会）显示 {@link UNKNOWN_LABEL_FALLBACK}，
 * **不要**回落成英文码：一行档案上出现 `FINANCIAL_STATEMENT` 这种字样，
 * 评估师会以为那是某个编号
 */
export const provenanceSourceLabel = (
  row?: {
    sourceType?: string | null
    sourceTypeDescription?: string | null
  } | null
): string => row?.sourceTypeDescription || UNKNOWN_LABEL_FALLBACK

/**
 * `formulaText` 那一栏的标题，按类型切
 *
 * 🔴 同一列装两种东西是**库的形状**决定的，不是偷懒：
 *    CALC 类装可读算式（「1,200,000 × 1.08 × 0.95 = 1,231,200」），
 *    TEMPLATE 类装**准则条款号**（§11.8.1 把 clause_ref 放在这一格里）。
 *    `qlzg_provenance` 是只增不改的档案表，
 *    为一只有八分之一行会用的值加一个恒空列不值。
 * ⚠️ 所以标题写死成「算式」的话，模板类那一行会显示成「算式：《资产评估准则—不动产》第 12 条」，
 *    读的人会去找那个乘法在哪里
 */
export const provenanceFormulaLabel = (sourceType?: string | null): string => {
  if (sourceType === 'TEMPLATE') return '准则条款号'
  if (sourceType === 'CALC') return '算式'
  return '算式 / 条款号'
}

/**
 * 置信度的显示文本
 *
 * 🔴 库里存 0.0000 – 1.0000 的小数，界面上显示成百分数：
 *    评估师读「95%」比读「0.9500」快，而这一栏本来就是给人读的。
 * 🔴 **只有 AI 类有值**，其余各类一律为空 —— 空时**整栏不显示**，
 *    不要显示成「置信度：—」。给一份政府发布文件挂一个空的置信度栏，
 *    会让人以为「这一项本该有、只是没填」，而事实是它**不该有**
 *    （其余各类的依据是确定的：资料就是资料、参数就是参数）
 */
export const provenanceConfidenceText = (confidence?: number | string | null): string | null => {
  if (confidence === null || confidence === undefined || confidence === '') return null
  const n = typeof confidence === 'string' ? Number(confidence) : confidence
  if (!Number.isFinite(n)) return null
  return `${(n * 100).toFixed(2)}%`
}

/**
 * `originUrl` 打不开时的那一句
 *
 * 🔴 是**提示**不是**报错**：链接会失效（案例来源网站三年后下线是常态），
 *    而它失效**不影响**这一行的证据力 —— 证据力在原文快照上。
 *    弹一个红色错误框会让人以为「这条溯源坏了」，进而怀疑报告上那个数，
 *    而那个数一直有快照兜着
 */
export const PROVENANCE_ORIGIN_URL_DEAD_HINT = '链接可能已失效，原文快照仍在，不影响这条依据'

// ==================== 版本 diff 与红标（I6-b，§11.11.3） ====================

/**
 * 字段级红标的六种变化 ← 后端 {@code QlzgReportVersionDiffRespVO.FieldKind}
 *
 * <h3>🔴 一行变更**可以同时属于多种**，所以 `changeKinds` 是数组</h3>
 * 值变了、来源也从 CALC 变成了 MANUAL —— 那是**一行**，带两个种类标签。
 * 拆成两行的话复核人会以为「有两处改了」，而其实只有一处，
 * 于是他会去报告里找第二个地方，找不到，然后怀疑红标是坏的。
 *
 * <h3>🔴 `PARAGRAPH` 不是 `VALUE` 的别名，两者分开数</h3>
 * `qlzg_report_section` 没有正文列，一节的散文住在 TEXT 类字段行上，
 * 所以 MVP 里「段落」就是 `fieldKind = TEXT` 那些格的 `valueStr`。
 * 后端为它单给了一个计数（`changedParagraphCount`），
 * 因为复核人最先要问的正是「有没有哪一段散文被改过」——
 * M2 下 AI 重生成一段，他必须看见（§11.11.3 原话）。
 */
export const REPORT_VERSION_DIFF_FIELD_KINDS = [
  'ADDED',
  'REMOVED',
  'VALUE',
  'PARAGRAPH',
  'SOURCE',
  'MARK'
] as const

export const REPORT_VERSION_DIFF_FIELD_KIND_LABELS: Record<string, string> = {
  ADDED: '新增一格',
  REMOVED: '删掉一格',
  VALUE: '值变了',
  PARAGRAPH: '段落文字变了',
  SOURCE: '来源变了',
  MARK: '红标/确认状态变了'
}

/**
 * 字段级红标的标签颜色
 *
 * 🔴 `danger` 只给三种：删掉一格、值变了、段落文字变了。
 *    删一格比改一格更值得红（改还有旧值可对，删了就什么都没有了），
 *    而一份法定报告的结论段少了一格是**结构性**的缺失
 * 🔴 其余三种给 `warning`：新增的一格要读、来源变了意味着
 *    「有人手改了一个本该由测算给出的数」、确认状态回退意味着有人要重新看一遍 ——
 *    三件都是事，但都不像「一个数被改了」那样直接指向报告上的错
 * 🔴 认不出的码落 `info` 而不是 `danger`：那一格的问题是「前端不认得这个种类」，
 *    与「这一处改得很严重」是两件事，用同一个颜色会让人排错方向
 *    （与 {@link PROVENANCE_SOURCE_TAG_TYPES} 同一条处置）
 */
export const REPORT_VERSION_DIFF_FIELD_KIND_TAG_TYPES: Record<string, string> = {
  ADDED: 'warning',
  REMOVED: 'danger',
  VALUE: 'danger',
  PARAGRAPH: 'danger',
  SOURCE: 'warning',
  MARK: 'warning'
}

/**
 * 🔴 认不出时**回落成原始码**，不回落成 {@link UNKNOWN_LABEL_FALLBACK}
 *
 * 与来源类型那条相反，理由是两边「认不出」的后果不同：
 * 来源类型认不出时显示「未知」是安全的（那一栏本来就是给人读的中文名）；
 * 而红标种类认不出意味着**后端加了一种前端还不知道的变化**，
 * 显示「未知」等于把「有一处变了、而我说不清是什么变了」藏起来 ——
 * 复核人会照着「未知」这一行扫一眼就过去。
 * 印出 `CLAUSE_REF` 这种原始码至少让他知道去问一句这是什么
 */
export const versionDiffFieldKindLabel = (kind?: string | null): string =>
  (kind && REPORT_VERSION_DIFF_FIELD_KIND_LABELS[kind]) || kind || UNKNOWN_LABEL_FALLBACK

export const versionDiffFieldKindTagType = (
  kind?: string | null
): 'primary' | 'success' | 'info' | 'warning' | 'danger' => {
  const t = kind ? REPORT_VERSION_DIFF_FIELD_KIND_TAG_TYPES[kind] : undefined
  return (t as 'primary' | 'success' | 'info' | 'warning' | 'danger') || 'info'
}

/**
 * 章节级红标的六种变化 ← 后端 {@code QlzgReportVersionDiffRespVO.SectionKind}
 *
 * <h3>🔴 与字段级**分开两张表**，不混在一起</h3>
 * 「三、评估对象概况 这一节的标题被改了」与「这一节里的建筑面积被改了」
 * 是复核人眼里两件不同的事，混在一张表里就没法按严重度排
 */
export const REPORT_VERSION_DIFF_SECTION_KINDS = [
  'ADDED',
  'REMOVED',
  'TITLE',
  'CLAUSE_REF',
  'CONTENT_MODE',
  'ORDER'
] as const

export const REPORT_VERSION_DIFF_SECTION_KIND_LABELS: Record<string, string> = {
  ADDED: '新增一节',
  REMOVED: '删掉一节',
  TITLE: '章节标题变了',
  CLAUSE_REF: '准则条款号变了',
  CONTENT_MODE: '内容来源变了',
  ORDER: '顺序/层级变了'
}

/**
 * 🔴 `CLAUSE_REF` 单独给 `danger`，而其余五种都是 `warning`
 *
 * 准则条款号是 G-04（准则有效性校验）的输入，也就是一条**法律事实**，
 * 不是排版：改一列就让一条 BLOCK 规则静默失效。
 * 一份报告声称遵循的准则条款被换掉，比这一节挪了个位置严重得多
 */
export const REPORT_VERSION_DIFF_SECTION_KIND_TAG_TYPES: Record<string, string> = {
  ADDED: 'warning',
  REMOVED: 'warning',
  TITLE: 'warning',
  CLAUSE_REF: 'danger',
  CONTENT_MODE: 'warning',
  ORDER: 'warning'
}

/** 🔴 同样回落成原始码，理由见 {@link versionDiffFieldKindLabel} */
export const versionDiffSectionKindLabel = (kind?: string | null): string =>
  (kind && REPORT_VERSION_DIFF_SECTION_KIND_LABELS[kind]) || kind || UNKNOWN_LABEL_FALLBACK

export const versionDiffSectionKindTagType = (
  kind?: string | null
): 'primary' | 'success' | 'info' | 'warning' | 'danger' => {
  const t = kind ? REPORT_VERSION_DIFF_SECTION_KIND_TAG_TYPES[kind] : undefined
  return (t as 'primary' | 'success' | 'info' | 'warning' | 'danger') || 'info'
}

/**
 * 版本清单上 `diffable = false` 那一格的话
 *
 * 🔴 必须是「没有可比的上文」，**不能**是「本版没有变更」：
 *    两句话在复核人眼里是完全不同的结论，而后者会让他签一份压根没比对过的字。
 *    后端在 diff 那一侧给的是 `fieldNotComparableReason`（要原样印），
 *    而**清单**那一侧只有 `diffable` 这一个布尔，所以这句话由前端出
 */
export const VERSION_NOT_DIFFABLE_LABEL = '这是第一版，没有可比的上文'

/**
 * 定稿人那一格
 *
 * 🔴 后端查不到人时**刻意**给 `null`，不给「未知用户」这类占位串 ——
 *    占位串会在界面上显示成一个看着像人名的东西。
 *    所以这里回落成「已离岗（编号 1234）」：编号是库里的 `creator`，
 *    查得到查不到都要给出来，因为定稿人是《资产评估法》第二十六条的责任锚点，
 *    把「查不到」伪装成「查过了，没有这个人」是不行的
 *    （与 {@code QlzgReportController#nicknameOf} 同一条口径）
 */
export const versionCreatorText = (
  creator?: string | number | null,
  nickname?: string | null
): string => {
  if (nickname) return nickname
  return creator ? `已离岗（编号 ${creator}）` : UNKNOWN_LABEL_FALLBACK
}

/**
 * 「版式换了没有」那一栏 —— 🔴 **三态**，`null` 不是 `false`
 *
 * `true` → 要说，而且是 `warning`：渲染永远看**冻结**的那一版模板（§11.17.5），
 * 换了版式意味着每一段正文都可能变，而字段级红标**比不出**这件事 ——
 * 它比的是值，版式变了值可以一个字没动而纸上完全不同。
 * `false` → 什么都不说（返回 `null`，整栏不显示）：
 * 「版式没变」是常态，把它印在每一版上就是在稀释真正要紧的那一句。
 * `null` → 也要说，而且必须说成「无法判断」：
 * I6-b 之前定稿的版本，快照里没冻模板版本编号，
 * 把「不知道」显示成「没变」等于对着一份可能整篇重排过的报告说「版式没变」。
 *
 * ⚠️ 这里刻意**不**把两个编号印出来：后端给的是 `qlzg_template_version` 的
 *    **行编号**，不是「第几版」。印成「第 700 版 → 第 701 版」是一句假话，
 *    而它读起来又完全像一个版本号
 */
export const versionDiffTemplateText = (
  changed?: boolean | null
): { text: string; type: 'warning' | 'info' } | null => {
  if (changed === true) {
    return {
      text:
        '版式换了：这一版与上一版渲染用的不是同一版模板，每一段正文都可能变。' +
        '字段级红标比不出这件事 —— 它比的是值，要核对版式请去看模板的版本历史',
      type: 'warning'
    }
  }
  if (changed === false) return null
  return {
    text: '这一版没记下用的是哪一版版式，无法判断版式有没有变',
    type: 'info'
  }
}
