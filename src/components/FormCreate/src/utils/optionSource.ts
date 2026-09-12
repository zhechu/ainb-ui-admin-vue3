/**
 * 选项类控件的「选项来源」运行时解析
 *
 * <h3>三种来源，互斥</h3>
 * 下拉框、单选框、多选框、级联选择、树形选择、树形控件这六个控件的属性面板上，
 * 「选项来源」是一个三选一的单选组：
 *
 * - 静态数据：选项直接写在规则里，由设计器内置的选项编辑器维护，这里不处理
 * - 数据字典：声明写在 props.dictSource，同步查前端字典缓存
 * - 数据接口：声明写在 props.dataSource，运行时调数据接口取数
 *
 * <h3>为什么不做成一堆「字典下拉」「接口下拉」控件</h3>
 * 那样控件列表迟早会出现字典下拉、字典树选择、接口下拉、接口级联……
 * 「控件形态」和「数据来源」是两个正交维度，控件继续用内置的那些，
 * 只在属性面板上声明选项从哪来。
 *
 * <h3>字典为什么不走 HTTP</h3>
 * 字典数据前端本来就有一份全量缓存（store/modules/dict.ts），同步就能取到。
 * 一张表单上 8 个字典下拉发 8 个请求是没有道理的。数据接口不同，它必须实时取。
 */
import { getDictOptions, getDictTree, DictDataType, DictTreeNode } from '@/utils/dict'
import {
  buildInterfaceOptions,
  collectDependentFields,
  fetchInterfaceRows,
  type RemoteDataSource
} from './dataInterfaceSource'

/** 子表控件类型取自控件契约，它的内部规则挂在 props.rule 下 */
import { SUB_TABLE_WIDGET_TYPE } from '@/components/FormWidgets/contracts'

/**
 * 支持选项数据源的六个内置控件
 *
 * - path：选项该写到规则的哪个属性（与设计器内置选项编辑器写的是同一个位置）
 * - tree：控件本身是否支持层级
 * - valueKey：选项对象里「值」用哪个键。树形控件默认 nodeKey 是 id，
 *   写成 value 的话节点没有 key，选中、回显、勾选全都会失灵
 */
export interface OptionSourceTarget {
  path: string
  tree: boolean
  valueKey: string
}

export const OPTION_SOURCE_TARGETS: Record<string, OptionSourceTarget> = {
  select: { path: 'options', tree: false, valueKey: 'value' },
  radio: { path: 'options', tree: false, valueKey: 'value' },
  checkbox: { path: 'options', tree: false, valueKey: 'value' },
  cascader: { path: 'props.options', tree: true, valueKey: 'value' },
  elTreeSelect: { path: 'props.data', tree: true, valueKey: 'value' },
  tree: { path: 'props.data', tree: true, valueKey: 'id' }
}

/** 选项来源类型。枚举值沿用设计器内置的编号：2=静态、1=远程，3 是我们新增的字典 */
export const OPTION_SOURCE_TYPE: Record<'STATIC' | 'REMOTE' | 'DICT', number> = {
  STATIC: 2,
  REMOTE: 1,
  DICT: 3
}

export interface DictSource {
  /** 字典编码；为空表示没有启用字典数据源 */
  dictType: string
  /** 字典值类型，决定选项的 value 转成什么 JS 类型 */
  valueType?: 'str' | 'int' | 'bool'
  /** 起始节点：只取该节点的子树 */
  rootValue?: string
  /** 树形字典喂给扁平控件时的展开方式 */
  flatMode?: 'path' | 'indent' | 'leaf'
}

interface OptionNode {
  label: string
  value: any
  children?: OptionNode[]
}

// region 字典来源

/** 按 valueType 转换字典值。转换失败时保留原值，宁可渲染出来也不要静默丢掉一个选项 */
const castValue = (value: any, valueType?: string) => {
  if (valueType === 'int') {
    const num = parseInt(value + '')
    return Number.isNaN(num) ? value : num
  }
  if (valueType === 'bool') {
    return value + '' === 'true'
  }
  return value + ''
}

/** 在树里按 value 找到某个节点 */
const findNode = (nodes: DictTreeNode[], value: string): DictTreeNode | undefined => {
  for (const node of nodes) {
    if (node.value + '' === value) {
      return node
    }
    const hit = node.children && findNode(node.children, value)
    if (hit) {
      return hit
    }
  }
  return undefined
}

/** 取出数据源对应的树。配了起始节点就只取它的子树 */
const resolveTree = (source: DictSource): DictTreeNode[] => {
  const tree = getDictTree(source.dictType)
  if (!source.rootValue) {
    return tree
  }
  const root = findNode(tree, source.rootValue + '')
  // 起始节点找不到（字典被改过）时返回空，而不是悄悄退回整棵树——
  // 后者会让表单突然多出大量本不该出现的选项，比空选项更难察觉
  return root?.children ?? []
}

/** 树形结构：原样保留层级 */
const toTreeOptions = (nodes: DictTreeNode[], source: DictSource): OptionNode[] =>
  nodes.map((node) => {
    const option: OptionNode = {
      label: node.label,
      value: castValue(node.value, source.valueType)
    }
    if (node.children?.length) {
      option.children = toTreeOptions(node.children, source)
    }
    return option
  })

/**
 * 缩进用的空白字符
 *
 * 必须是不换行空格（U+00A0）而不是普通空格：选项文本渲染在 HTML 里，
 * 连续的普通空格会被浏览器折叠成一个，缩进等于没做。
 */
const INDENT_UNIT = '  '

/**
 * 扁平结构：把树展平成一列
 *
 * 树形字典配到普通下拉框上时用。直接丢掉层级会让选项无法分辨——
 * 多个分支下都可能有「其它」「未知」这种同名节点。
 */
const toFlatOptions = (nodes: DictTreeNode[], source: DictSource): OptionNode[] => {
  const mode = source.flatMode ?? 'path'
  const result: OptionNode[] = []
  const walk = (list: DictTreeNode[], depth: number, path: string[]) => {
    list.forEach((node) => {
      const currentPath = [...path, node.label]
      const isLeaf = !node.children?.length
      if (mode !== 'leaf' || isLeaf) {
        let label = node.label
        if (mode === 'path') {
          label = currentPath.join(' / ')
        } else if (mode === 'indent') {
          label = `${INDENT_UNIT.repeat(depth)}${node.label}`
        }
        result.push({ label, value: castValue(node.value, source.valueType) })
      }
      if (node.children?.length) {
        walk(node.children, depth + 1, currentPath)
      }
    })
  }
  walk(nodes, 0, [])
  return result
}

/** 把一份字典数据源解析成控件需要的选项结构 */
export const buildDictOptions = (source: DictSource, tree: boolean): OptionNode[] => {
  if (!source?.dictType) {
    return []
  }
  // 平铺字典没有层级，getDictTree 会得到一棵全是根节点的树，直接映射即可，
  // 不用走展平逻辑（那样会给每个选项都拼一个只有自身的「全路径」）
  const options: DictDataType[] = getDictOptions(source.dictType)
  const isFlatDict = !options.some((item) => item.parentId)
  if (isFlatDict && !source.rootValue) {
    return options.map((item) => ({
      label: item.label,
      value: castValue(item.value, source.valueType)
    }))
  }
  const nodes = resolveTree(source)
  return tree ? toTreeOptions(nodes, source) : toFlatOptions(nodes, source)
}

// endregion

/** 按 'a.b' 形式的路径往规则上写值 */
const setByPath = (rule: any, path: string, value: any) => {
  const keys = path.split('.')
  const last = keys.pop()!
  let target = rule
  keys.forEach((key) => {
    if (!target[key]) {
      target[key] = {}
    }
    target = target[key]
  })
  target[last] = value
}

/** 按 'a.b' 形式的路径从规则上读值 */
export const readOptionPath = (rule: any, path: string) =>
  path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), rule)

/** 按 'a.b' 形式的路径往规则上写值 */
export const writeOptionPath = setByPath

/**
 * 用户手工配置的静态选项的暂存位置
 *
 * 三种来源共用同一个选项路径（options / props.options / props.data），切到字典或接口后
 * 那个路径会被解析结果占用。不暂存的话，用户切走再切回来，原先手工配的选项就没了。
 *
 * 放在规则顶层而不是 props 下：props 会被整体透传给组件，多一个键会变成 DOM 上的
 * 无用属性。设计器的 parseRule 只会删掉 `__` 前缀的键和空数组/空对象，
 * 单下划线的自定义键会原样保留，能跟着表单 JSON 一起存下来。
 */
export const STATIC_OPTIONS_STASH = '_staticOptions'

/**
 * 把 {label, value} 结构改写成目标控件要求的键名
 *
 * 树形控件的 nodeKey 是 id，其余控件用 value。
 */
const renameValueKey = (options: OptionNode[], valueKey: string): any[] => {
  if (valueKey === 'value') {
    return options
  }
  const map = (list: OptionNode[]): any[] =>
    list.map((item) => {
      const next: any = { label: item.label, [valueKey]: item.value }
      if (item.children?.length) {
        next.children = map(item.children)
      }
      return next
    })
  return map(options)
}

/** 遍历整棵规则树（含布局容器的 children 与子表的 props.rule） */
const walkRules = (rules: any[], visit: (rule: any) => void) => {
  if (!Array.isArray(rules)) {
    return
  }
  rules.forEach((rule) => {
    if (!rule || typeof rule !== 'object') {
      return
    }
    visit(rule)
    if (Array.isArray(rule.children)) {
      walkRules(rule.children, visit)
    }
    // 子表控件的内部规则挂在 props.rule 下，与布局容器的 children 不是一回事
    if (rule.type === SUB_TABLE_WIDGET_TYPE && Array.isArray(rule.props?.rule)) {
      walkRules(rule.props.rule, visit)
    }
  })
}

/** 处理单条规则的字典来源；返回是否命中 */
export const applyDictSourceToRule = (rule: any): boolean => {
  const source: DictSource | undefined = rule?.props?.dictSource
  if (!source?.dictType) {
    return false
  }
  const target = OPTION_SOURCE_TARGETS[rule.type]
  if (!target) {
    return false
  }
  setByPath(
    rule,
    target.path,
    renameValueKey(buildDictOptions(source, target.tree), target.valueKey)
  )
  return true
}

/**
 * 同步解析字典来源
 *
 * 放在 decodeFields 里调用，因为全部渲染入口（在线表单、流程发起、流程详情、打印）
 * 最终都收敛到那一个函数，只需接一次线。
 */
export const applyDictSource = (rules: any[]) => {
  walkRules(rules, (rule) => applyDictSourceToRule(rule))
}

// region 数据接口来源

/** 一条待解析的数据接口来源 */
export interface RemoteOptionTask {
  rule: any
  source: RemoteDataSource
  target: OptionSourceTarget
  /** 该来源依赖的表单字段，字段变化时要重新取数 */
  dependsOn: string[]
}

/** 收集规则树里所有「选项来自数据接口」的控件 */
export const collectRemoteOptionTasks = (rules: any[]): RemoteOptionTask[] => {
  const tasks: RemoteOptionTask[] = []
  walkRules(rules, (rule) => {
    const source: RemoteDataSource | undefined = rule?.props?.dataSource
    if (!source?.interfaceCode) {
      return
    }
    const target = OPTION_SOURCE_TARGETS[rule.type]
    if (!target) {
      return
    }
    tasks.push({ rule, source, target, dependsOn: collectDependentFields(source) })
  })
  return tasks
}

/**
 * 解析一条数据接口来源，把选项写回规则
 *
 * 写回是「原地改规则对象」——form-create 的规则是响应式的，
 * 运行时改 rule.options 会直接反映到已渲染的组件上。
 */
export const resolveRemoteOptionTask = async (
  task: RemoteOptionTask,
  getFormValue?: (field: string) => any
) => {
  const rows = await fetchInterfaceRows(task.source, { getFormValue })
  const options = buildInterfaceOptions(rows, task.source, task.target.tree)
  setByPath(task.rule, task.target.path, renameValueKey(options, task.target.valueKey))
}

/**
 * 解析规则树里所有的数据接口来源
 *
 * 不阻塞调用方：decodeFields 需要同步返回规则，选项晚一点填上来即可。
 * 单个接口失败只影响它自己那个控件，不连坐其它控件。
 */
export const resolveRemoteOptions = (rules: any[], getFormValue?: (field: string) => any) => {
  const tasks = collectRemoteOptionTasks(rules)
  if (!tasks.length) {
    return Promise.resolve(tasks)
  }
  return Promise.all(
    tasks.map((task) =>
      resolveRemoteOptionTask(task, getFormValue).catch((error) => {
        if (import.meta.env.DEV) {
          console.warn(
            `[OptionSource] 字段[${task.rule.field}]的数据接口[${task.source.interfaceCode}]取数失败`,
            error
          )
        }
        // 失败时留空选项，而不是保留设计期的示例选项 ——
        // 让用户看到「没有选项」，比看到一批假选项好
        setByPath(task.rule, task.target.path, [])
      })
    )
  ).then(() => tasks)
}

// endregion

/**
 * 推导某条规则当前的「选项来源」类型
 *
 * 设计器内核的 _optionType 恒取默认值 2，没有任何按已存规则反推的逻辑，
 * 不补这一步，配了字典/接口的控件重新打开属性面板会显示「静态数据」。
 */
export const detectOptionSourceType = (rule: any): number => {
  if (rule?.props?.dataSource?.interfaceCode) {
    return OPTION_SOURCE_TYPE.REMOTE
  }
  if (rule?.props?.dictSource?.dictType) {
    return OPTION_SOURCE_TYPE.DICT
  }
  return OPTION_SOURCE_TYPE.STATIC
}

/**
 * 保存前剥掉「由数据源解析出来的选项」
 *
 * 设计器的实时预览会把字典/接口解析出的选项写进规则对象。直接保存会把这份快照一起
 * 持久化：表单 JSON 无谓膨胀（大接口几千条选项），下次打开还会先显示一份过期快照。
 * 选项来源已经声明在 props.dictSource / props.dataSource 里，运行时会重新解析。
 *
 * 静态数据来源不受影响 —— 它的选项本来就该存在规则里。
 *
 * @returns 深拷贝后的规则，不改动传入对象（设计器还在用它渲染画布）
 */
export const stripResolvedOptions = <T>(rule: T): T => {
  const cloned = JSON.parse(JSON.stringify(rule))
  walkRules([cloned], (item) => {
    const target = OPTION_SOURCE_TARGETS[item.type]
    if (!target) {
      return
    }
    const derived = item.props?.dictSource?.dictType || item.props?.dataSource?.interfaceCode
    if (derived) {
      setByPath(item, target.path, [])
    }
  })
  return cloned
}
