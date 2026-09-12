/**
 * 表单控件契约 —— 前端访问层
 *
 * 契约的规范副本在后端 `yudao-module-infra/src/main/resources/form-design/form-widget-contracts.json`，
 * 本目录下的 JSON 是构建期副本。两份是否一致由 `tests/e2e/form-widget-contract-sync.spec.ts` 守着：
 * 它拉后端 `/infra/form-design/widget-contracts` 接口，与本地副本逐字段比对，不一致即失败。
 *
 * 为什么不直接在运行时拉接口：`subTableWidgetType` 这类结构性事实在模块加载期就要用
 * （多个工具模块在顶层就依赖它），改成异步会把一批同步函数染成异步，牵动面过大。
 * 折中方案是「本地副本 + 一致性测试」：运行时零网络依赖，漂移由 CI 拦住，而不是等线上出错。
 *
 * ⚠️ 改契约时必须同时改两份文件。只改一份，一致性测试会失败并告诉你漏了哪边。
 */
import contractFile from './form-widget-contracts.json'

/** 控件的值类型 */
export type WidgetValueType =
  | 'none'
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'array'
  | 'object'
  | 'file'

/** 控件的落库形态 */
export type WidgetStorage = 'none' | 'scalar' | 'json' | 'delimited' | 'subTable'

/** 控件所属的左侧菜单分组 */
export type WidgetGroup = 'basic' | 'select' | 'advanced' | 'layout' | 'display' | 'system'

/** JDBC 列类型族。与后端 JdbcTypeFamily 枚举一一对应 */
export type JdbcTypeFamily =
  | 'STRING'
  | 'TEXT'
  | 'INTEGER'
  | 'LONG'
  | 'DECIMAL'
  | 'BOOLEAN'
  | 'DATE'
  | 'TIME'
  | 'DATETIME'
  | 'JSON'
  | 'BINARY'

/** 控件能力位 */
export interface WidgetCapabilities {
  /** 是否是数据字段（规则里有 field，参与表单值） */
  field: boolean
  /** 能否放进子表控件内部 */
  subTable: boolean
  /** 能否作为列表展示列 */
  listColumn: boolean
  /** 能否作为列表查询条件 */
  searchable: boolean
  /** 能否导出 */
  exportable: boolean
  /** 能否作为列表排序字段 */
  sortable: boolean
}

/** 单个控件的契约 */
export interface WidgetContract {
  /** 控件类型，即 form-create 规则里的 type */
  type: string
  label: string
  group: WidgetGroup
  /** 本模块是否支持。false 表示内核提供但我们不支持，发布校验会拒绝 */
  supported: boolean
  /** 是否已废弃（有替代控件，待删除） */
  deprecated: boolean
  valueType: WidgetValueType
  storage: WidgetStorage
  /** 可映射的物理列类型族。空数组表示不落库 */
  columnTypes: JdbcTypeFamily[]
  caps: WidgetCapabilities
  maskable: boolean
  /** 字段级权限预留占位，本阶段不参与任何逻辑 */
  permissionKey: string | null
}

/** 跨前后端的结构性事实 */
export interface StructuralFacts {
  subTableWidgetType: string
  subFieldSeparator: string
  layoutContainerTypes: string[]
  nestedRulePath: string
  richTextWidgetTypes: string[]
  delimitedSeparator: string
}

// ==================== 解析与索引 ====================

const raw = contractFile as any

/** 契约版本号 */
export const CONTRACT_VERSION: number = raw.contractVersion

const structural: StructuralFacts = raw.structural

/**
 * JDBC 类型族的匹配规则，数组顺序即优先级
 *
 * 与后端读的是同一份数据。顺序不可调整，原因见契约文件里 jdbcTypeFamilies 的说明。
 */
const jdbcTypeFamilyRules: Array<{ family: JdbcTypeFamily; keywords: string[] }> = (
  raw.jdbcTypeFamilies as any[]
).map((r) => ({ family: r.family as JdbcTypeFamily, keywords: r.keywords as string[] }))

/**
 * 补齐缺省值后的契约列表
 *
 * JSON 里为了可读性省略了一些布尔字段（如大多数控件不写 deprecated），
 * 这里统一补全，调用方就不必到处写 `?? false`。
 */
const widgets: WidgetContract[] = (raw.widgets as any[]).map((w) => ({
  type: w.type,
  label: w.label,
  group: w.group,
  supported: w.supported ?? true,
  deprecated: w.deprecated ?? false,
  valueType: w.valueType,
  storage: w.storage,
  columnTypes: w.columnTypes ?? [],
  caps: {
    field: w.caps?.field ?? false,
    subTable: w.caps?.subTable ?? false,
    listColumn: w.caps?.listColumn ?? false,
    searchable: w.caps?.searchable ?? false,
    exportable: w.caps?.exportable ?? false,
    sortable: w.caps?.sortable ?? false
  },
  maskable: w.maskable ?? false,
  permissionKey: w.permissionKey ?? null
}))

const widgetByType = new Map<string, WidgetContract>(widgets.map((w) => [w.type, w]))

// ==================== 结构性事实 ====================

/**
 * 子表控件在 form-create 规则里的 type
 *
 * 前端侧的唯一来源。它的内部规则挂在 {@link NESTED_RULE_PATH} 下，
 * 而不是布局容器那样的 children —— 这是两者的关键差别。
 *
 * 改造前这个字面量在前端 4 处、后端 2 处各有一份副本。
 */
export const SUB_TABLE_WIDGET_TYPE: string = structural.subTableWidgetType

/**
 * 子表内部字段拼层级 key 时的分隔符
 *
 * 与后端字段权限裁剪用的分隔符必须一致，对不上会导致配了权限却不生效。
 */
export const SUB_FIELD_SEPARATOR: string = structural.subFieldSeparator

/**
 * 子表控件内部规则所在的属性路径
 *
 * ⚠️ 它是**带点的路径**（`props.rule`），不是单个键名 ——
 * 直接拿它当键去取（`rule.props[NESTED_RULE_PATH]`）会永远取到 undefined，
 * 表现为「子表内部的字段被整体漏掉」，而且不报错。取值请用 {@link readNestedRules}。
 */
export const NESTED_RULE_PATH: string = structural.nestedRulePath

/**
 * 读子表控件的内部规则
 *
 * 按契约里声明的路径取值，而不是硬编码 `props.rule`。
 * 这正是控件契约存在的意义 —— 结构性事实只有一个来源。
 *
 * @param rule 规则节点
 * @returns 内部规则数组；不是子表控件或路径上没有数组时返回 undefined
 */
export const readNestedRules = (rule: any): any[] | undefined => {
  if (!rule || rule.type !== SUB_TABLE_WIDGET_TYPE) return undefined
  const value = NESTED_RULE_PATH.split('.').reduce(
    (acc: any, key: string) => (acc === null || acc === undefined ? acc : acc[key]),
    rule
  )
  return Array.isArray(value) ? value : undefined
}

/** 布局容器类型 */
export const LAYOUT_CONTAINER_TYPES: string[] = structural.layoutContainerTypes ?? []

/**
 * 值是 HTML 的控件类型
 *
 * 服务端要对它们做两件别的字段不做的事：把内联 base64 图片转存文件服务、
 * 按白名单清洗标签（见后端 RichContentGuard）。前端按它判断哪些字段要走
 * 富文本编辑器的接线，两侧读的是同一份声明。
 */
export const RICH_TEXT_WIDGET_TYPES: string[] = structural.richTextWidgetTypes ?? []

/** 判断某个类型的值是否为 HTML */
export const isRichTextWidget = (type?: string): boolean =>
  !!type && RICH_TEXT_WIDGET_TYPES.includes(type)

/**
 * storage=delimited 的控件落库时用的分隔符
 *
 * 它同时是拆分的依据 —— 服务端写入时用它拼串、读取时用它拆回数组。
 * 两侧不一致的表现是「存进去 3 项、读回来 2 项」，而且不报错。
 */
export const DELIMITED_SEPARATOR: string = structural.delimitedSeparator ?? ','

/** 判断某个类型是否为子表控件 */
export const isSubTableWidget = (type?: string): boolean => !!type && type === SUB_TABLE_WIDGET_TYPE

// ==================== 契约查询 ====================

/** 按类型取契约，未登记返回 undefined */
export const getWidgetContract = (type?: string): WidgetContract | undefined =>
  type ? widgetByType.get(type) : undefined

/** 全部契约，保持 JSON 里的声明顺序 */
export const listWidgetContracts = (): WidgetContract[] => [...widgets]

/**
 * 某个类型是否被本模块支持
 *
 * 未登记的类型返回 true —— 契约可能还没补全，此时不该把控件从设计器里藏掉。
 * 真正要处理的是「已登记且明确标了不支持」的控件。
 */
export const isWidgetSupported = (type?: string): boolean => {
  const contract = getWidgetContract(type)
  return !contract || contract.supported
}

/** 某个类型是否已废弃 */
export const isWidgetDeprecated = (type?: string): boolean =>
  getWidgetContract(type)?.deprecated ?? false

/**
 * 全部不受支持的控件类型
 *
 * 供设计器配置用：这些控件要从左侧菜单里隐藏，避免用户拖进来之后
 * 到发布环节才被拒绝。
 */
export const listUnsupportedWidgetTypes = (): string[] =>
  widgets.filter((w) => !w.supported).map((w) => w.type)

// ==================== 能力判断。统一在这里做兜底，调用方不必判空 ====================

/** 是否是数据字段 */
export const isFieldWidget = (type?: string): boolean =>
  getWidgetContract(type)?.caps.field ?? false

/** 能否放进子表 */
export const isSubTableAllowed = (type?: string): boolean =>
  getWidgetContract(type)?.caps.subTable ?? false

/** 能否做列表列 */
export const isListColumnAllowed = (type?: string): boolean =>
  getWidgetContract(type)?.caps.listColumn ?? false

/** 能否做查询条件 */
export const isSearchable = (type?: string): boolean =>
  getWidgetContract(type)?.caps.searchable ?? false

/** 能否导出 */
export const isExportable = (type?: string): boolean =>
  getWidgetContract(type)?.caps.exportable ?? false

/** 能否排序 */
export const isSortable = (type?: string): boolean =>
  getWidgetContract(type)?.caps.sortable ?? false

/** 是否走子表存储 */
export const isSubTableStorage = (type?: string): boolean =>
  getWidgetContract(type)?.storage === 'subTable'

/** 值是否为文件（文件 URL 或文件对象），与后端 WidgetContractRegistry#isFileWidget 同判据 */
export const isFileWidget = (type?: string): boolean =>
  getWidgetContract(type)?.valueType === 'file'

/** 是否不落库 */
export const isNoStorage = (type?: string): boolean => {
  const storage = getWidgetContract(type)?.storage
  return !storage || storage === 'none'
}

/**
 * 判断控件能否映射到某个 JDBC 类型的列
 *
 * 类型识别不出来时放过：宁可漏判也不要因为一个没见过的数据库类型
 * 把本来能用的映射拦掉。真正的类型错误会在写入时由数据库自己报出来。
 *
 * ⚠️ 这里的类型族判断必须与后端 JdbcTypeFamily.resolve 保持同样的优先级顺序，
 * 否则前端提示「可以映射」而后端发布时拒绝，用户会困惑。
 */
export const acceptsColumnType = (type?: string, jdbcTypeName?: string): boolean => {
  const contract = getWidgetContract(type)
  if (!contract) {
    return true
  }
  const family = resolveJdbcTypeFamily(jdbcTypeName)
  if (!family) {
    return true
  }
  return contract.columnTypes.includes(family)
}

/**
 * 按 JDBC 类型名解析所属类型族
 *
 * 关键字表与匹配优先级都来自契约文件的 jdbcTypeFamilies 数组，与后端读的是同一份数据，
 * 因此不存在「前端说能映射、后端发布时拒绝」这类两侧算法漂移的问题。
 *
 * ⚠️ 顺序敏感：数组位置即优先级。"TIMESTAMP" 含 "TIME"、"DATETIME" 含 "DATE"、
 * "BIGINT" 含 "INT"、"LONGVARCHAR" 含 "VARCHAR" —— 详见契约文件里的说明。
 */
export const resolveJdbcTypeFamily = (jdbcTypeName?: string): JdbcTypeFamily | undefined => {
  if (!jdbcTypeName) {
    return undefined
  }
  const upper = jdbcTypeName.toUpperCase()
  for (const rule of jdbcTypeFamilyRules) {
    if (rule.keywords.some((k) => upper.includes(k))) {
      return rule.family
    }
  }
  return undefined
}
