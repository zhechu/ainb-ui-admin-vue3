/**
 * 扩展字段 → form-create 规则（I29-e）
 *
 * <h3>这个模块解决的是「一行 {@code qlzg_field_def} 怎么变成一个能填的控件」</h3>
 * 库里存的是**与控件无关**的三段：{@code widget_type}、{@code options_json}、
 * {@code field_key}。而 form-create 要的是**与控件强相关**的一条规则：
 * 选项该塞根上的 {@code options} 还是 {@code props.options}、日期要不要 {@code valueFormat}、
 * 计数器能不能给 {@code precision}。这层翻译只此一份，四个宿主与详情页共用。
 *
 * <h3>🔴 全模块最重要的一条纪律：props 是【白名单】造出来的，不是【黑名单】删出来的</h3>
 * {@link EDITABLE_PROPS} 列的是「机构管理员在字段管理页**能**配的 props」，
 * 造规则时**只从这个清单里取值**，其余一律不写进 {@code rule.props}。
 * 于是下面这些事故在结构上就不可能发生，而不是靠一处 {@code delete} 记住要删：
 *
 * <ul>
 * <li>{@code input} 的 {@code maskRule} —— 掩码后的值被回填上来会**覆盖库里的真值**。
 *     本仓已经栽过一次（{@code CLIENT_SECRET_IS_MASKED}，见 {@code QlzgClientServiceImpl}），
 *     那一次的后果是身份证号变成一串星号且**恢复不了**。</li>
 * <li>{@code input} 的 {@code uniqueCheck} —— 扩展字段没有唯一性校验端点，
 *     配上去等于「界面上勾了、后端不查」。</li>
 * <li>{@code input} 的 {@code validateRules} —— 第二个校验来源，而服务端权威校验
 *     读的是 {@code validate_json}（{@code CrossFieldRule}），两者会漂。</li>
 * <li>{@code switch} 的 {@code activeValue} / {@code inactiveValue} ——
 *     后端 {@code normalizeBoolean} **只认真 Boolean**，配成 {@code 1}/{@code 0} 之后
 *     这个字段一填就报 {@code EXT_FIELD_VALUE_INVALID}，而且是**每次保存都报**。</li>
 * <li>{@code timePicker} 的 {@code isRange} —— 它会把值从字符串变成数组，
 *     而契约声明的是 {@code string}/{@code scalar}。</li>
 * <li>{@code select} 的 {@code multiple} —— 同上，值会变成数组。</li>
 * <li>{@code elTreeSelect} 的 {@code showCheckbox} —— 🔴 **设计器内核的默认规则里它是
 *     {@code true}**（{@code lib/form-designer/config/rule/treeSelect.js}），
 *     而契约声明 {@code elTreeSelect} 是 {@code string}/{@code scalar}。
 *     照抄内核那条默认规则的话，单选控件会交出数组。</li>
 * </ul>
 *
 * ⚠️ 白名单的方向是**安全**的那一个：契约将来新增一个 prop，它在字段管理页里
 *    是「不出现」，直到有人显式决定要不要放开。反过来（黑名单 / 直接透传
 *    {@code options.props}）的默认行为是「新 prop 自动生效」，而那正是上面每一条事故的形状。
 *
 * <h3>🔴 {@code textarea} 是唯一一个「契约类型 ≠ 规则类型」的控件</h3>
 * 内核 {@code config/rule/textarea.js} 产出的是 {@code { type: 'input', props: { type: 'textarea' }}。
 * 所以 {@link ruleTypeOf} 有一张覆盖表，而 {@code EDITABLE_PROPS} 的键用的是**契约类型**
 * （{@code textarea}），不是规则类型（{@code input}）—— 两者的 {@code rows} 与
 * {@code maskRule} 完全不是一回事，混用会让白名单张冠李戴。
 *
 * <h3>🔴 日期 / 时间的 {@code valueFormat} 一律由代码强制，不给自由文本</h3>
 * 不设 {@code valueFormat} 的话 el-date-picker 交出来的是 **Date 对象**，
 * {@code JSON.stringify} 之后是带时区的 ISO 串（{@code 2026-10-30T} 接时分秒毫秒、末尾一个 {@code Z}），
 * 后端 {@code QlzgValueShapes.parseDateText} 认不出来 → {@code EXT_FIELD_VALUE_INVALID}。
 * 更坏的是 {@link isAbsentValue} 会把一个 Date 对象判成「空对象」而**静默丢掉**，
 * 表现是「填了日期、保存成功、详情页那一栏是空的」。所以这里 {@code valueFormat}
 * 由 {@code props.type} 派生，管理员只能在两个封闭选项里选，选不到自由文本。
 *
 * <h3>🔴 {@code dateRange} 的逗号约束【不适用】于扩展字段</h3>
 * {@code DateRangePicker.vue} 的注释警告「格式里不能出现逗号，分隔串落库按逗号拆」——
 * 那说的是低代码表单往**物理列**里写 {@code 2026-09-01,2026-09-30} 的场景。
 * 扩展字段的值落在 {@code ext_json} 里，后端 {@code normalizeArray} 存的是
 * **原生 JSON 数组**，不拼串。所以这里不检查逗号，也不要因为读了那个注释就补一个检查。
 *
 * <h3>为什么这个模块是纯 TS、不 import form-create</h3>
 * 本仓 vitest 是 **node 环境**（没有 jsdom），而 form-create 一加载就碰 DOM。
 * 所以这里只产出**规则对象**（纯 JSON），由 {@code ExtFieldSection.vue} 交给
 * {@code <form-create>}。附带的好处是这个模块的每条约定都能被
 * {@code extFieldRule.spec.ts} 直接钉住，包括与控件契约的一致性。
 */
import type { QlzgFieldDefVO, QlzgFieldOption, QlzgFieldScene } from '@/api/qlzg/fieldDef'
import {
  DELIMITED_SEPARATOR,
  getWidgetContract,
  isFileWidget,
  isNoStorage,
  isRichTextWidget,
  isSubTableStorage,
  listWidgetContracts
} from '@/components/FormWidgets/contracts'
import {
  OPTION_SOURCE_TARGETS,
  renameValueKey,
  writeByPath,
  type OptionSourceTarget
} from '@/components/FormCreate/src/utils/optionTargets'

/** 渲染场景。🔴 大写，与后端 {@code QlzgFieldSceneEnum} 逐字一致 */
export type ExtFieldRenderScene = 'FORM' | 'DETAIL'

// ==================== 控件白名单 ====================

/**
 * 字段管理页的控件下拉里**放出来**的那些
 *
 * 🔴 这张表是**显式**的，刻意不从契约派生。派生（「凡是可落库的控件都放出来」）
 * 的方向是**不安全**的那一个：契约里新增一个可落库控件，它会自动出现在下拉里，
 * 而没有人评估过它的值能不能被导出路径解析、有没有必须配的 prop。
 * 派生的正确用法是反过来 —— {@code extFieldRule.spec.ts} 断言**这张表里的每一项
 * 都确实是可落库的**，契约哪天把某一项改坏了，测试变红而不是线上出错。
 *
 * <p>共 16 项，按「填一个值」的心智顺序排：文本 → 数字 → 开关 → 日期时间 → 选项。
 */
export const EXT_FIELD_WIDGET_TYPES: readonly string[] = [
  'input',
  'textarea',
  'inputNumber',
  'slider',
  'rate',
  'switch',
  'colorPicker',
  'datePicker',
  'dateRange',
  'timePicker',
  'timeRange',
  'select',
  'radio',
  'checkbox',
  'cascader',
  'elTreeSelect'
]

/**
 * ** withheld **（扣着不放）的控件，以及扣着的理由
 *
 * 这张表有两个消费者，都不只是为了注释：
 * ① {@code FieldDefForm.vue} 在控件下拉旁边放一个「为什么没有 XX」的弹出说明 ——
 *    管理员看到 16 项而没有解释时，会认为这是功能残缺并提交缺陷单；
 * ② {@code extFieldRule.spec.ts} 断言这张表的键**一个都不在** {@link EXT_FIELD_WIDGET_TYPES} 里，
 *    于是「放开某一项」必须同时删掉它的理由，不能只改一边。
 *
 * 🔴 每一项的理由都是**具体**的（哪一列读不出来、哪个 prop 缺了就渲染成空），
 *    不是「暂时没做」。写不出具体理由的扣留，就是没想清楚的扣留。
 */
export const EXT_FIELD_WIDGET_WITHHELD: Record<string, string> = {
  tree: '值键是 id 不是 value，且必须配 showCheckbox 才能勾选；不配就渲染成一棵谁也没法填的树',
  elTransfer: '契约里它一个 prop 都没声明，选项没有落点（OPTION_SOURCE_TARGETS 里也没有它）',
  DictSelect: '存的是字典码，导出的 Excel 里那一列会是码值而不是名称',
  AreaSelect: '存的是行政区划码（如 330106），导出的 Excel 里那一列是码不是地名；且它的选项域来自内置区划表，机构改不了',
  OrgPicker: '存的是 {type, id} 引用对象；单选模式下交出来是一个裸对象，normalizeArray 会直接拒收',
  RelationForm: '必须配 ★targetFormCode 与 ★displayField，缺一个就渲染成空下拉',
  RemotePicker: '必须配 ★interfaceCode；而扩展字段的值要能在 30 年后被读懂，不能依赖一个还会变的外部接口',
  Formula: '必须配 ★expression；把算出来的值存进 ext_json 与「拒绝 SystemValue」是同一条纪律的两面',
  BillNumberInput: '必须配 ★ruleMode / ★templateCode；qlzg 的编号一律由服务端发号器签发，不给前端自造'
}

/**
 * 控件下拉的选项，label 取自契约
 *
 * ⚠️ 用函数而不是模块级常量：常量在 import 时就固化，而契约里缺一项时
 *    label 会是 undefined —— 函数让调用方拿到的是「当次契约」的结果，
 *    也让 spec 能对返回值做断言而不必碰模块加载顺序。
 */
export const listExtFieldWidgetOptions = (): Array<{ value: string; label: string }> =>
  EXT_FIELD_WIDGET_TYPES.map((type) => ({
    value: type,
    label: getWidgetContract(type)?.label ?? type
  }))

// ==================== 可落库判据（后端 unsupportedReason 的镜像） ====================

/** 能原样存进 JSON 列的值类型，与后端 {@code QlzgExtFieldValidator#STORABLE_VALUE_TYPES} 同清单 */
export const STORABLE_VALUE_TYPES: readonly string[] = ['string', 'number', 'boolean', 'date', 'array']

/** 能原样存进 JSON 列的落库形态，与后端 {@code STORABLE_STORAGES} 同清单 */
export const STORABLE_STORAGES: readonly string[] = ['scalar', 'delimited', 'json']

/** 口令框：值不该被存下来 */
const PASSWORD_WIDGET = 'password'

/**
 * 这个控件为什么不能当扩展字段。返回 {@code undefined} 表示**能**
 *
 * 🔴 判据与**闸门顺序**都取自后端 {@code QlzgExtFieldValidator#unsupportedReason}。
 * 顺序不是装饰：子表要先于「不可落库」被判出来，因为它有自己那个更具体的错误码
 * （{@code EXT_FIELD_USE_FORM_DESIGN}，指向低代码表单设计），
 * 而 {@code storage=subTable} 同时也不在 {@link STORABLE_STORAGES} 里 ——
 * 顺序反了就会得到一句「落库形态不支持」，把用户指到错的方向上。
 */
export const whyNotStorable = (widgetType?: string): string | undefined => {
  const contract = getWidgetContract(widgetType)
  if (!contract) {
    return '控件契约里没有这个类型'
  }
  if (isSubTableStorage(widgetType)) {
    // 🔴 返回 undefined 之外的那一句由调用方说：它不是「不可落库」，是「该走低代码表单」
    return undefined
  }
  if (isFileWidget(widgetType)) {
    return '值是文件，要走资料上传，不能塞进 JSON 列'
  }
  if (isRichTextWidget(widgetType)) {
    return '值是 HTML，需要服务端的内联图片转存与标签清洗，扩展字段这条路上没有'
  }
  if (isNoStorage(widgetType)) {
    return '这个控件不落库'
  }
  if (!STORABLE_VALUE_TYPES.includes(contract.valueType)) {
    return `值类型 ${contract.valueType} 不能原样存进 JSON 列`
  }
  if (!STORABLE_STORAGES.includes(contract.storage)) {
    return `落库形态 ${contract.storage} 不能原样存进 JSON 列`
  }
  if (widgetType === PASSWORD_WIDGET) {
    return '口令不该被存下来'
  }
  return undefined
}

/**
 * 该不该改走低代码表单设计（{@code EXT_FIELD_USE_FORM_DESIGN}）
 *
 * 🔴 与 {@link whyNotStorable} 分开，因为两者的**建议**不同：一个说「换个控件」，
 * 一个说「这个需求本身就不属于扩展字段」。合成一个函数就只能给一句话，
 * 而那句话对其中一半的读者是错的。
 */
export const shouldUseFormDesign = (widgetType?: string): boolean => isSubTableStorage(widgetType)

// ==================== 控件族（后端 validateWidgetFamily 的镜像） ====================

/**
 * 两个控件是不是同族 —— 判据是契约里的 {@code valueType} + {@code storage}
 *
 * 🔴 **不硬编码一张族表**，与后端 {@code QlzgFieldDefServiceImpl#validateWidgetFamily}
 * 逐行对齐（含「有一边查不到契约就一律判不同族」）。硬编码会与
 * {@code form-widget-contracts.json} 漂移，而漂移的两个方向都是静默的：
 * 「明明同族却被拒」让管理员以为功能坏了；「换了族却放过」让历史数据里的值
 * 类型对不上 —— 后者更坏，它要到详情页渲染那一刻才炸，而那时离改配置已经过了几个月。
 *
 * 🔴 「查不到契约 → 不同族」这一支看着像防御性代码，其实不是：它对应的是
 * 库里存着一个契约已不认识的控件（契约回滚过）。此时判不出族就判不出兼容性，
 * 而放过一次的代价正是上面那一种静默失配。
 */
export const sameFamilyWidgets = (fromType?: string, toType?: string): boolean => {
  if (fromType === toType) {
    return true
  }
  const from = getWidgetContract(fromType)
  const to = getWidgetContract(toType)
  if (!from || !to) {
    return false
  }
  return from.valueType === to.valueType && from.storage === to.storage
}

/**
 * 编辑一个字段时，控件下拉里**能选**的那些
 *
 * 与 {@link listExtFieldWidgetOptions} 的差别：这一份先按族过滤，再按白名单过滤。
 * 🔴 两层都要 —— 只按族过滤会把 {@code tree}（与 {@code checkbox} 同为
 * {@code array}/{@code delimited}）放进来，而它是被扣着的。
 */
export const listSameFamilyWidgetOptions = (currentType?: string) =>
  listExtFieldWidgetOptions().filter((item) => sameFamilyWidgets(currentType, item.value))

// ==================== 可编辑 props 白名单 ====================

/**
 * 机构管理员在字段管理页**能**配的控件 props
 *
 * 🔴 键是**契约类型**，不是 {@link ruleTypeOf} 之后的规则类型（差别只在 {@code textarea}）。
 * 🔴 不在表里的控件一律是「一个 prop 都不能配」，所以这张表**不必**为每个控件写一行。
 *
 * <p>每一项为什么放开了，见各自的行内注释；没写的就是没放开。
 */
export const EDITABLE_PROPS: Record<string, readonly string[]> = {
  /** 行高。契约里 {@code rows} 的示例值是 3 */
  textarea: ['rows'],
  /** 小数位与上下界。🔴 {@code precision} 只是显示层的，值本身不会被四舍五入 */
  inputNumber: ['precision', 'min', 'max', 'thousands'],
  slider: ['min', 'max'],
  rate: ['max'],
  /**
   * 🔴 只有 {@code type} 一项，且它在界面上是**两个封闭选项**（{@code date} / {@code datetime}）
   * 而不是自由文本 —— {@code valueFormat} 由它派生，见 {@link DATE_PICKER_VALUE_FORMATS}
   */
  datePicker: ['type'],
  /** 同上，三个封闭选项 */
  dateRange: ['type']
}

/** 取某个控件可编辑的 props 键名，不在白名单里就是空数组 */
export const editablePropsOf = (widgetType?: string): readonly string[] =>
  widgetType ? EDITABLE_PROPS[widgetType] ?? [] : []

/**
 * {@code datePicker} 的 {@code props.type} → {@code valueFormat}
 *
 * 🔴 两把都写在这里、且**只**允许这两个键：面板上 {@code datePicker} 本来能选
 * year / month / date / dates / week / datetime / datetimerange / daterange / monthrange 九种，
 * 而其中区间那三种交出的是数组 —— 契约声明的却是 {@code date}/{@code scalar}。
 * 所以扩展字段的日期控件只能是单值的那两种。
 */
export const DATE_PICKER_VALUE_FORMATS: Record<string, string> = {
  date: 'YYYY-MM-DD',
  datetime: 'YYYY-MM-DD HH:mm:ss'
}

/** {@code dateRange} 的 {@code props.type} 三选一。区间控件的值本来就是数组，与契约相符 */
export const DATE_RANGE_TYPES: readonly string[] = ['daterange', 'datetimerange', 'monthrange']

/** {@code timePicker} 的 {@code valueFormat}，一律强制 */
export const TIME_VALUE_FORMAT = 'HH:mm:ss'

// ==================== 规则类型映射 ====================

/**
 * 契约类型 → form-create 规则类型
 *
 * 🔴 目前只有 {@code textarea} 一项。表存在是为了让「只有一项」这件事**显式**：
 * 下一个人加控件时会先看到这里，而不是直接把契约类型当规则类型用。
 */
const RULE_TYPE_OVERRIDES: Record<string, string> = {
  textarea: 'input'
}

/** 造规则时用的 {@code type}。⚠️ 与 {@link EDITABLE_PROPS} 的键不是一回事，见文件头 */
export const ruleTypeOf = (widgetType: string): string => RULE_TYPE_OVERRIDES[widgetType] ?? widgetType

// ==================== 值的形状 ====================

/**
 * 这个值算不算「没填」
 *
 * 🔴 与后端 {@code QlzgValueShapes.isAbsent} 逐条对齐，**尤其**是这两条：
 * <ul>
 * <li>{@code 0} 与 {@code false} **不是**「没填」。把它们当空丢掉的话，
 *     「评分 0 分」和「开关关掉」这两个合法值会在提交时消失，
 *     而详情页显示为空 —— 与「从来没填过」**长得一模一样**。</li>
 * <li>空白字符串（{@code '   '}）算「没填」，与后端 {@code StrUtil.isBlank} 同判据。</li>
 * </ul>
 *
 * <p>⚠️ {@code Date} 对象刻意判成**非空**：正常路径下不会出现（{@code valueFormat}
 * 是强制的），真出现了就该把它交给后端去报 {@code EXT_FIELD_VALUE_INVALID}，
 * 而不是在这里当空丢掉 —— 后者是静默的数据丢失，前者是一句能读懂的报错。
 */
export const isAbsentValue = (value: any): boolean => {
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value === 'string') {
    return value.trim() === ''
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return false
  }
  if (value instanceof Date) {
    return false
  }
  if (Array.isArray(value)) {
    return value.length === 0
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0
  }
  return false
}

/**
 * 这个控件的值是不是数组
 *
 * 🔴 从契约的 {@code valueType} 派生，不另列一张表。手列的话
 * {@code checkbox} / {@code cascader} / {@code dateRange} / {@code timeRange} 四项
 * 迟早漏一项，而漏掉的后果是「打开编辑弹窗时 Element Plus 拿到 undefined 而不是 []」——
 * 那会直接抛在渲染里，让整个表单打不开。
 */
export const isArrayValueWidget = (widgetType?: string): boolean =>
  getWidgetContract(widgetType)?.valueType === 'array'

/**
 * 这个控件是不是选项类（值域由 {@code options} 决定）
 *
 * 判据就是 {@link OPTION_SOURCE_TARGETS} 里有没有它 —— 那张表由
 * {@code optionTargets.spec.ts} 与控件契约双向钉住，所以这里不必再判一次契约。
 */
export const isOptionWidget = (widgetType?: string): boolean =>
  !!widgetType && !!OPTION_SOURCE_TARGETS[widgetType]

/** 取选项落点，不是选项类控件时返回 undefined */
export const optionTargetOf = (widgetType?: string): OptionSourceTarget | undefined =>
  widgetType ? OPTION_SOURCE_TARGETS[widgetType] : undefined

// ==================== 造规则 ====================

/**
 * 这一行在 {@code scene} 场景下该不该出现
 *
 * 🔴 镜像后端 {@code QlzgFieldSceneEnum#covers}：{@code BOTH} 覆盖两边，
 * {@code scene} 为空按「两边都覆盖」处理（后端 {@code isRequiredOnForm} 同口径）。
 * 各写一次判据的表现是「表单里填了、详情页看不到」，而两边单看都对。
 */
export const coversScene = (def: Pick<QlzgFieldDefVO, 'scene'>, scene: ExtFieldRenderScene): boolean =>
  !def.scene || def.scene === 'BOTH' || def.scene === scene

/**
 * 挑出该渲染的行，并按 {@code sort} 排好
 *
 * 🔴 两处过滤的差别是**关键**，别合并：
 * <ul>
 * <li>{@code FORM} 只渲染 {@code enabled} 的行 —— 停用的字段不能再写新值
 *     （写进去就再没有定义能解释它，见错误码 {@code EXT_FIELD_KEY_UNKNOWN}）。</li>
 * <li>{@code DETAIL} 渲染**全部**行，含停用的 —— 停用的字段历史值仍在库里，
 *     详情页要显示出来并标注「（已停用字段）」。少了这一步，
 *     调阅档案的人会以为数据丢了。</li>
 * </ul>
 *
 * <p>排序键与后端 {@code QlzgFieldDefMapper#selectVisibleList} 一致（{@code sort asc, id asc}）。
 * 后端已经排过了，这里再排一次是为了让本函数对「本地拼出来的清单」也成立 ——
 * 字段管理页拖完排序立刻预览时走的就是那条路。
 */
export const extFieldsFor = (
  defs: QlzgFieldDefVO[] | null | undefined,
  scene: ExtFieldRenderScene
): QlzgFieldDefVO[] =>
  (defs ?? [])
    .filter((def) => coversScene(def, scene))
    .filter((def) => scene === 'DETAIL' || !!def.enabled)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.id ?? 0) - (b.id ?? 0))

/**
 * 造一条 form-create 规则。建不出来时返回 {@code undefined}（调用方负责跳过并留痕）
 *
 * @param def   字段定义
 * @param scene 渲染场景。{@code DETAIL} 下所有控件都带 {@code props.disabled}
 */
export const buildExtFieldRule = (
  def: QlzgFieldDefVO,
  scene: ExtFieldRenderScene
): Record<string, any> | undefined => {
  const widgetType = def.widgetType
  if (shouldUseFormDesign(widgetType) || whyNotStorable(widgetType)) {
    return undefined
  }

  const detail = scene === 'DETAIL'
  const rule: Record<string, any> = {
    type: ruleTypeOf(widgetType),
    field: def.fieldKey,
    title: detailTitleOf(def),
    props: {}
  }

  // 🔴 required 交给 form-create 内核那个 provider 去做校验（默认文案「{title}不能为空」）。
  //    ⚠️ 绝不要同时写 rule.validate —— 那个 provider 的实现是
  //    `inject.getProp().validate = [validate]`，它【覆盖】而不是追加，
  //    所以「自己写一条更友好的文案」会被静默换回默认的那一句。
  //    🔴 服务端权威校验在 QlzgExtFieldValidator，前端这一条只是 UX。
  if (!detail && def.required && def.enabled) {
    rule.required = true
  }
  if (detail) {
    rule.props.disabled = true
  }

  applyEditableProps(rule, def)
  applyForcedProps(rule, widgetType)
  applyOptions(rule, def)
  return rule
}

/**
 * 详情页的标题：停用的字段要在名字后面标出来
 *
 * 🔴 标注而不是隐藏（§11.20.5 的 UI 纪律）：隐藏会被理解成「这功能坏了」，
 * 而「值还在、字段没了」会让调阅档案的人以为数据丢了。
 */
const detailTitleOf = (def: QlzgFieldDefVO): string =>
  def.enabled ? def.fieldLabel : `${def.fieldLabel}（已停用字段）`

/** 把白名单里的 props 从 {@code def.options.props} 抄进规则。白名单外的键到不了这里 */
const applyEditableProps = (rule: Record<string, any>, def: QlzgFieldDefVO) => {
  const source = def.options?.props
  if (!source) {
    return
  }
  for (const name of editablePropsOf(def.widgetType)) {
    // 🔴 hasOwnProperty 而不是 `in`：`constructor` / `toString` / `valueOf` / `hasOwnProperty`
    //    全都匹配后端的 FIELD_KEY_PATTERN（^[a-z][a-z0-9_]{1,62}$），
    //    因此都是**合法**的 prop 名与 fieldKey。用 `in` 会从原型链上读到一个函数当值，
    //    表现是「这个 prop 明明没配却生效了」，而且 JSON 序列化时静默变成 undefined。
    if (!Object.prototype.hasOwnProperty.call(source, name)) {
      continue
    }
    const value = (source as Record<string, any>)[name]
    if (value === undefined || value === null || value === '') {
      continue
    }
    rule.props[name] = value
  }
}

/**
 * 由代码强制、**不给管理员配**的 props
 *
 * 每一项都在防止一个静默的数据损坏，逐条理由见文件头与各分支注释。
 */
const applyForcedProps = (rule: Record<string, any>, widgetType: string) => {
  switch (widgetType) {
    case 'textarea':
      // 规则类型是 input，靠 props.type 才是多行
      rule.props.type = 'textarea'
      break
    case 'datePicker': {
      // 🔴 认不出的 type 一律收敛到 'date'，不抛错：一个坏掉的格式会让**这个宿主的每一次保存**
      //    都失败（值变成 Date 对象 → isAbsentValue 判空 → 后端报 EXT_FIELD_VALUE_INVALID），
      //    而管理员此时正在改一个别的字段。收敛的代价是「配成 datetime 的字段按 date 显示」，
      //    比砖头化整个表单便宜得多。
      const type = DATE_PICKER_VALUE_FORMATS[rule.props.type] ? rule.props.type : 'date'
      rule.props.type = type
      rule.props.valueFormat = DATE_PICKER_VALUE_FORMATS[type]
      break
    }
    case 'dateRange': {
      // valueFormat 刻意**不传**：DateRangePicker 自己按 type 推（它内部那张
      // DEFAULT_VALUE_FORMAT 表），在这里再抄一份就是第二份会漂的副本
      const type = DATE_RANGE_TYPES.includes(rule.props.type) ? rule.props.type : 'daterange'
      rule.props.type = type
      break
    }
    case 'timePicker':
      rule.props.valueFormat = TIME_VALUE_FORMAT
      break
    case 'elTreeSelect':
    case 'tree': {
      // 🔴 nodeKey 必须与选项里的值键一致，否则节点没有 key，选中 / 回显 / 勾选全部失灵
      //    而且**不报错**。取值来自 OPTION_SOURCE_TARGETS 的 valueKey，
      //    而那个 valueKey 由 optionTargets.spec.ts 断言取自契约里 nodeKey 的示例值
      //    （tree 是 id、elTreeSelect 是 value），所以这里不写死。
      // ⚠️ 只给契约**声明了** nodeKey 的控件加：cascader 的层级来自 children 而不是 nodeKey，
      //    el-cascader 也不认这个 prop，加了会被透传成 DOM 属性
      const declaredNodeKey = (getWidgetContract(widgetType)?.props ?? []).some(
        (prop) => prop.name === 'nodeKey'
      )
      if (declaredNodeKey) {
        rule.props.nodeKey = optionTargetOf(widgetType)?.valueKey ?? 'value'
      }
      break
    }
    default:
      break
  }
}

/**
 * 把 {@code def.options.options} 写到契约要求的那个落点上
 *
 * 🔴 落点从 {@link OPTION_SOURCE_TARGETS} 读，**不在这里各写一次**：
 * 那张表是「选项写在规则的哪个路径上」的唯一来源，低代码表单的字典 / 接口 / 静态
 * 三条路径也读它。抄一份的后果是「字段管理页配了 5 个选项，表单上一个都不显示」，
 * 而且不报错 —— 写错路径只是往一个没人读的属性上塞了个数组。
 *
 * <p>⚠️ 没有选项时**不写这个键**（不是写一个空数组）：控件对「没有 options」与
 * 「options 是空数组」的处理不同，前者有的会用内置默认，后者一律渲染成空下拉。
 * 而「机构还没配选项」是新建字段的常态，此时应该看得出是空，不该被一个空数组固化。
 */
const applyOptions = (rule: Record<string, any>, def: QlzgFieldDefVO) => {
  const target = optionTargetOf(def.widgetType)
  const options = def.options?.options
  if (!target || !options?.length) {
    return
  }
  writeByPath(rule, target.path, renameValueKey(options as QlzgFieldOption[], target.valueKey))
}

/** 造规则的结果 */
export interface ExtFieldRuleResult {
  /** 造好的规则，顺序与 {@link extFieldsFor} 一致 */
  rules: Array<Record<string, any>>
  /**
   * 建不出来的字段（控件不在契约里、或契约把它改成了不可落库的形态）
   *
   * 🔴 一定要把它显示出来，不能只 warn：建不出来的字段如果同时是 {@code required}，
   * 用户会撞上一句「XX 为必填项」而界面上**没有 XX 这个控件** —— 那份表单从此存不下去。
   * 一个 alert 说明「这些字段的控件已不可用，请联系管理员」比一个死循环的报错便宜。
   */
  skipped: QlzgFieldDefVO[]
}

/**
 * 造整块扩展字段的规则
 *
 * @param defs  字段定义清单（后端返回的**含停用**那一份，本函数自己按场景过滤）
 * @param scene 渲染场景
 */
export const buildExtFieldRules = (
  defs: QlzgFieldDefVO[] | null | undefined,
  scene: ExtFieldRenderScene
): ExtFieldRuleResult => {
  const rules: Array<Record<string, any>> = []
  const skipped: QlzgFieldDefVO[] = []
  for (const def of extFieldsFor(defs, scene)) {
    const rule = buildExtFieldRule(def, scene)
    if (!rule) {
      const reason = shouldUseFormDesign(def.widgetType)
        ? '子表字段请走低代码表单设计'
        : whyNotStorable(def.widgetType) ?? '未知原因'
      console.warn(
        `[extFieldRule][字段(${def.fieldLabel}) 的控件(${def.widgetType})建不出规则，已跳过：${reason}]`
      )
      skipped.push(def)
      continue
    }
    rules.push(rule)
  }
  return { rules, skipped }
}

// ==================== 值的装载与回收 ====================

/**
 * 把库里的 {@code ext_json} 装成表单模型
 *
 * 🔴 **只**为要渲染的那些字段建键，三类键**不带进来**：孤儿键（库里没有定义的）、停用字段的、
 * 以及 {@code scene} 不覆盖本次渲染场景的（第三类正是这里按 scene 过滤**自己造成**的）。
 * 后端 {@code QlzgExtFieldValidator#carryOverReadOnly} 会在整列覆盖时把这三类从库里那份原样带过去
 * （判据是 {@code isReadOnlyOnWrite}）。前端也带一份的话，两边就都在管同一件事，
 * 而后端那一份是唯一能看见**库里现值**的（前端拿到的是详情页那次查询的快照，可能已经旧了）。
 *
 * <p>⚠️ 第三类曾是一个**静默的数据丢失**：字段管理页把某个字段的「出现位置」从「表单与详情」
 * 改成「详情」之后，这里就不再为它建键，提交上去的 payload 里没有它，
 * 而后端当时只带停用字段与孤儿键 —— 于是下一次任何人编辑这一行，那个值就没了，
 * 提示还是「修改成功」。复现全程在界面上，不需要接口直调。现已在后端补齐。
 *
 * @param defs 字段定义清单
 * @param ext  库里的 {@code ext_json}（可能为 null，也可能是后端解析 NULL 列得到的 {@code {}}）
 * @param scene 渲染场景，决定哪些字段进模型
 */
export const loadExtModel = (
  defs: QlzgFieldDefVO[] | null | undefined,
  ext: Record<string, any> | null | undefined,
  scene: ExtFieldRenderScene
): Record<string, any> => {
  const model: Record<string, any> = {}
  const source = ext ?? {}
  for (const def of extFieldsFor(defs, scene)) {
    const raw = Object.prototype.hasOwnProperty.call(source, def.fieldKey)
      ? source[def.fieldKey]
      : undefined
    // 🔴 数组类控件在**空值**时给 []：Element Plus 的 checkbox-group / cascader
    //    拿到 undefined 会在渲染里抛，整个弹窗打不开。
    // ⚠️ 但「有值、形状不对」时**原样保留**，不收敛成 []：收敛之后提交上去就是「没填」，
    //    后端整列覆盖会把历史值删掉 —— 那是一次静默的数据丢失。
    //    原样保留的代价是控件渲染得怪，以及保存时后端报一句指名道姓的
    //    EXT_FIELD_VALUE_INVALID。**响的失败比静的丢失好。**
    model[def.fieldKey] =
      isAbsentValue(raw) && isArrayValueWidget(def.widgetType) ? [] : raw
  }
  return model
}

/**
 * 把表单模型收成能提交的 {@code ext}
 *
 * 🔴 空值一律**摘掉键**，不是提交一个 {@code null}：后端 {@code normalize} 对
 * 「键不存在」与「键存在但值为空」的处置是一样的（都当没填），但提交一份
 * 全是 null 的对象会让 {@code ext_json} 里躺着一堆解释不了的东西，
 * 而导出的 Excel 那一列会从「空」变成「null」。
 *
 * @param model {@link loadExtModel} 建出来、又被用户改过的那一份
 */
export const compactExt = (model: Record<string, any> | null | undefined): Record<string, any> => {
  const result: Record<string, any> = {}
  if (!model) {
    return result
  }
  // 🔴 Object.keys 而不是 for..in：for..in 会走原型链，而 `constructor` / `toString` /
  //    `valueOf` / `hasOwnProperty` 全都匹配后端的 FIELD_KEY_PATTERN
  //    （^[a-z][a-z0-9_]{1,62}$），因此都是**合法**的 fieldKey。
  //    真有一个叫 constructor 的扩展字段时，for..in 会把 Object.prototype.constructor
  //    也当值提交上去 —— 序列化成 undefined，静默消失。
  for (const key of Object.keys(model)) {
    const value = model[key]
    if (isAbsentValue(value)) {
      continue
    }
    result[key] = value
  }
  return result
}

// ==================== 契约自检（给 spec 与运行期各用一次） ====================

/**
 * 白名单里有没有**已经不可落库**的控件
 *
 * 存在的意义是让 {@link EXT_FIELD_WIDGET_TYPES} 这张显式清单**能被契约证伪**：
 * 契约哪天把 {@code checkbox} 的 valueType 改了，这里会把它列出来，
 * spec 变红；而不是等到某个机构的复选框开始往 {@code ext_json} 里写逗号串。
 *
 * 🔴 与 {@link DELIMITED_SEPARATOR} 一起导出，是因为「数组类控件的值在 ext_json 里
 * 是原生数组、不是分隔串」这件事需要在 spec 里被断言一次 —— 否则下一个人读到契约里
 * {@code checkbox} 的 {@code storage=delimited}，会顺手补一个 {@code join(',')}。
 */
export const listUnstorablePaletteWidgets = (): string[] =>
  EXT_FIELD_WIDGET_TYPES.filter((type) => !!whyNotStorable(type))

/** 契约里 {@code supported=true} 的控件总数，给 spec 用来断言白名单是它的一个真子集 */
export const countSupportedWidgets = (): number =>
  listWidgetContracts().filter((item) => item.supported).length

/** {@code storage=delimited} 的分隔符。扩展字段**不用**它拼值，见上面那条 */
export const EXT_DELIMITED_SEPARATOR = DELIMITED_SEPARATOR

/** 场景常量的字面量集合，供页面里的下拉与 spec 共用 */
export const EXT_FIELD_SCENES: Array<{ value: QlzgFieldScene; label: string }> = [
  { value: 'BOTH', label: '表单与详情' },
  { value: 'FORM', label: '新增 / 编辑' },
  { value: 'DETAIL', label: '详情' }
]
