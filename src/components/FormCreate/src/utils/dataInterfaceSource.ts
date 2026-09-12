/**
 * 数据接口作为选项来源的取数逻辑
 *
 * <h3>为什么不让控件自己填 URL</h3>
 * 设计器内置的「远程数据」是让用户填 URL，再配一个解析函数把返回值转成选项。
 * 解析函数是字符串形式的 JS，运行时要用 new Function 执行 —— 等于任何有表单编辑权限
 * 的人，都能在所有填单人的浏览器里跑任意脚本，而且脚本被存进表单 JSON 随表单分发。
 * 裸 URL 也让接口路径散落在各张表单里，后端改路径查不出哪些表单会坏。
 *
 * 现在改为只能指向数据接口注册表里的一条记录：表单里存的是接口编码 + 参数绑定声明，
 * 没有地址、没有代码。取什么数由接口配置者决定，填单人只能按接口定义好的签名传参。
 */
import { fetchOptions } from '@/api/infra/dataInterface'
import { useUserStoreWithOut } from '@/store/modules/user'
import { getTenantId } from '@/utils/auth'
import { formatDate } from '@/utils/formatTime'

/** 参数取值来源 */
export type ParamSourceType = 'fixed' | 'formField' | 'currentUser' | 'system'

export interface ParamBinding {
  /** 参数名，与接口入参定义对应 */
  name: string
  /** 显示名，仅设计器展示用 */
  label?: string
  /** 参数类型，来自接口定义 */
  type?: string
  required?: boolean
  sourceType: ParamSourceType
  /** sourceType=fixed */
  value?: any
  /** sourceType=formField，绑定的表单字段名 */
  field?: string
  /** sourceType=currentUser */
  userProp?: 'userId' | 'nickname' | 'deptId'
  /** sourceType=system */
  systemVar?: 'today' | 'now' | 'tenantId'
}

export interface RemoteDataSource {
  /** 接口编码，运行时按它调用。用编码而非自增 ID，表单在环境间迁移才不会错位 */
  interfaceCode?: string
  /** 接口主键，仅设计期预览用 */
  interfaceId?: number
  /** 接口名称，存一份供设计器回显，免得每次都要拉列表才知道选的是什么 */
  interfaceName?: string
  /** 接口版本号，变化时选项缓存自动失效 */
  interfaceVersion?: number
  /** 显示字段，支持 ${a}-${b} 组合 */
  labelField?: string
  /** 取值字段 */
  valueField?: string
  /** 子级字段，树形控件用 */
  childrenField?: string
  params?: ParamBinding[]
  /** 是否缓存结果 */
  cache?: boolean
}

export interface OptionItem {
  label: string
  value: any
  children?: OptionItem[]
}

/** 设计器里「值从哪来」下拉的选项 */
export const PARAM_SOURCE_OPTIONS: { label: string; value: ParamSourceType }[] = [
  { label: '固定值', value: 'fixed' },
  { label: '表单字段', value: 'formField' },
  { label: '当前用户', value: 'currentUser' },
  { label: '系统变量', value: 'system' }
]

export const USER_PROP_OPTIONS = [
  { label: '用户编号', value: 'userId' },
  { label: '用户昵称', value: 'nickname' },
  { label: '部门编号', value: 'deptId' }
]

export const SYSTEM_VAR_OPTIONS = [
  { label: '当前日期', value: 'today' },
  { label: '当前时间', value: 'now' },
  { label: '租户编号', value: 'tenantId' }
]

export interface ResolveContext {
  /** 读取本表单其它字段的当前值 */
  getFormValue?: (field: string) => any
}

const resolveCurrentUser = (userProp?: string) => {
  const user = useUserStoreWithOut().getUser
  switch (userProp) {
    case 'nickname':
      return user?.nickname
    case 'deptId':
      return user?.deptId
    case 'userId':
    default:
      return user?.id
  }
}

const resolveSystemVar = (systemVar?: string) => {
  switch (systemVar) {
    case 'now':
      return formatDate(new Date(), 'YYYY-MM-DD HH:mm:ss')
    case 'tenantId':
      return getTenantId()
    case 'today':
    default:
      return formatDate(new Date(), 'YYYY-MM-DD')
  }
}

/** 把参数绑定声明解析成实际的请求参数 */
export const resolveParams = (
  bindings: ParamBinding[] | undefined,
  ctx: ResolveContext = {}
): Record<string, any> => {
  const args: Record<string, any> = {}
  if (!Array.isArray(bindings)) {
    return args
  }
  bindings.forEach((binding) => {
    if (!binding?.name) {
      return
    }
    switch (binding.sourceType) {
      case 'formField':
        args[binding.name] = binding.field ? ctx.getFormValue?.(binding.field) : undefined
        break
      case 'currentUser':
        args[binding.name] = resolveCurrentUser(binding.userProp)
        break
      case 'system':
        args[binding.name] = resolveSystemVar(binding.systemVar)
        break
      case 'fixed':
      default:
        args[binding.name] = binding.value
        break
    }
  })
  return args
}

/** 该数据源依赖了本表单的哪些字段。用于登记联动关系 */
export const collectDependentFields = (source?: RemoteDataSource): string[] => {
  if (!Array.isArray(source?.params)) {
    return []
  }
  return source.params
    .filter((item) => item?.sourceType === 'formField' && item.field)
    .map((item) => item.field as string)
}

/**
 * 从接口返回里取出行数组
 *
 * 后端对 SQL / 静态 JSON 类型会包一层 {code, msg, data}，分页查询再包一层 {total, list}，
 * HTTP 转发则原样透传远端结构。这里把几种形态都拆开，避免每个调用方各写一遍。
 */
export const unwrapRows = (payload: any): any[] => {
  let current = payload
  // 最多剥三层，防御性上限，避免异常结构导致死循环
  for (let depth = 0; depth < 3; depth++) {
    if (Array.isArray(current)) {
      return current
    }
    if (!current || typeof current !== 'object') {
      return []
    }
    if (Array.isArray(current.list)) {
      return current.list
    }
    if (Array.isArray(current.records)) {
      return current.records
    }
    if ('data' in current) {
      current = current.data
      continue
    }
    return []
  }
  return []
}

/**
 * 按模板取值，支持 ${a}-${b} 组合
 *
 * 只做属性名替换，不做表达式求值 —— 这里绝不能引入 eval / new Function。
 */
const renderTemplate = (row: any, template?: string): any => {
  if (!template) {
    return undefined
  }
  if (!template.includes('${')) {
    return row?.[template]
  }
  return template.replace(/\$\{([^}]*)}/g, (_, expr) => {
    const value = row?.[String(expr).trim()]
    return value === undefined || value === null ? '' : String(value)
  })
}

/** 把接口返回的行映射成选项。tree 为真时按 childrenField 递归 */
export const buildInterfaceOptions = (
  rows: any[],
  source: RemoteDataSource,
  tree = false
): OptionItem[] => {
  const labelField = source.labelField || 'label'
  const valueField = source.valueField || 'value'
  const childrenField = source.childrenField || 'children'
  const map = (list: any[]): OptionItem[] =>
    list.map((row) => {
      const option: OptionItem = {
        label: String(renderTemplate(row, labelField) ?? ''),
        value: renderTemplate(row, valueField)
      }
      if (tree && Array.isArray(row?.[childrenField]) && row[childrenField].length) {
        option.children = map(row[childrenField])
      }
      return option
    })
  return map(Array.isArray(rows) ? rows : [])
}

// region 取数：请求合并 + 可选缓存

/** 进行中的请求。同一签名的并发请求共享同一个 Promise，避免一张表单上 N 个控件发 N 次 */
const inflight = new Map<string, Promise<any[]>>()
/** 结果缓存，仅在数据源显式开启 cache 时使用 */
const resultCache = new Map<string, any[]>()

const buildCacheKey = (code: string, version: number | undefined, args: Record<string, any>) =>
  `${code}@${version ?? 0}|${JSON.stringify(args, Object.keys(args).sort())}`

/** 清空缓存。接口配置变更或用户切换后调用 */
export const clearInterfaceOptionCache = () => {
  inflight.clear()
  resultCache.clear()
}

/** 按数据源声明取数 */
export const fetchInterfaceRows = async (
  source: RemoteDataSource,
  ctx: ResolveContext = {}
): Promise<any[]> => {
  if (!source?.interfaceCode) {
    return []
  }
  const args = resolveParams(source.params, ctx)
  const key = buildCacheKey(source.interfaceCode, source.interfaceVersion, args)

  if (source.cache && resultCache.has(key)) {
    return resultCache.get(key)!
  }
  const pending = inflight.get(key)
  if (pending) {
    return pending
  }

  const task = fetchOptions(source.interfaceCode, args)
    .then((payload) => {
      const rows = unwrapRows(payload)
      if (source.cache) {
        resultCache.set(key, rows)
      }
      return rows
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, task)
  return task
}

// endregion
