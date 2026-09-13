/**
 * 列表的行分组
 *
 * 按某一列把行分成若干组，每组前面插一行「分组行」，上面写组名、组内条数与小计。
 *
 * ## 分组行是真的一行，不是伪造的树父节点
 *
 * 另一种常见做法是把分组值塞进 `children` 当树的父节点。那样做的代价是
 * **每个渲染分支都要特判这一行不是真数据**：操作列要判、序号列要判、
 * 合计要判、点行详情要判、批量选中要判 …… 漏判一处就会出现
 * 「点了分组行的编辑按钮，打开一个全是空值的表单」。
 *
 * 这里的分组行带一个 `__groupRow` 标记，数据行完全不受影响 ——
 * 它们还是接口原样返回的那些对象，没有被包一层，也没有被塞进谁的 children。
 *
 * ## 按原始值分组，用格式化后的值做标题
 *
 * 直接按显示值分组会踩到一个很隐蔽的坑：两个不同的字典编码恰好翻译成同一个文案时
 * （字典项改过名、或者新旧编码并存），它们会被并成一组，而组里的数据其实来自
 * 两个不同的编码。按原始值分组则不会 —— 标题相同的两个组会各自独立存在，
 * 这时用户能看出「有两个同名的组」，进而发现字典配重了。
 *
 * ## 不要求同值的行相邻
 *
 * 分组是按值归并（Map 聚合），不是按相邻扫描 —— 这一点与同值合并
 * （`cellMerge.ts`）刚好相反。所以行分组**不依赖排序**：没配排序也能正确分组，
 * 只是组的先后顺序会跟着数据顺序走。
 *
 * ## 分组与小计都在当前页数据上做
 *
 * 与合计行同一个口径。跨页分组要服务端聚合，是另一件事。
 * ⚠️ 这条必须在设计器里写明 —— 用户看到「软件开发（12 条）」时，
 * 默认理解是「一共 12 条」而不是「这一页有 12 条」。
 */

/** 分组行的标记键 */
export const GROUP_ROW_FLAG = '__groupRow'

export interface RowGroupConfig {
  enabled?: boolean
  /** 分组字段 */
  field?: string
  /** 分组行上显示「（N 条）」 */
  showCount?: boolean
  /** 要在分组行上出小计的字段 */
  summaryFields?: string[]
  /** 默认展开还是折叠 */
  defaultExpand?: 'ALL' | 'NONE'
}

export interface GroupRow {
  __groupRow: true
  /** 折叠状态的键，就是分组字段的原始值转成的字符串 */
  __groupKey: string
  /** 分组行上显示的标题，已经过格式化 */
  __groupLabel: string
  /** 组内行数 */
  __groupCount: number
  /** 字段 → 组内小计 */
  __groupSums: Record<string, number>
  /** 当前是否折叠 */
  __groupCollapsed: boolean
}

/** 这一行是不是分组行 */
export const isGroupRow = (row: any): row is GroupRow => !!row?.[GROUP_ROW_FLAG]

/** 配置是否完整可用。少了分组字段的配置是无效的，当作没开 */
export const isRowGroupUsable = (conf: RowGroupConfig | undefined | null): boolean =>
  !!conf?.enabled && !!conf.field

/**
 * 把数据行编排成「分组行 + 数据行」的序列
 *
 * @param rows          当前页的数据行
 * @param conf          分组配置
 * @param labelOf       把分组字段的原始值转成标题（走列的格式化）
 * @param collapsedKeys 已折叠的分组键
 */
export const buildGroupedRows = (
  rows: any[],
  conf: RowGroupConfig,
  labelOf: (value: any) => string,
  collapsedKeys: Set<string>
): any[] => {
  const field = conf.field as string
  // Map 保持插入顺序 —— 组的先后就是它在数据里第一次出现的先后。
  // 按标题排序会让「列表按金额降序排」这类配置失去意义：用户排的是行，
  // 而看到的却是组被重排过的结果
  const groups = new Map<string, any[]>()
  rows.forEach((row) => {
    const key = groupKeyOf(row?.[field])
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  })

  const summaryFields = conf.summaryFields ?? []
  const result: any[] = []
  groups.forEach((bucket, key) => {
    const collapsed = collapsedKeys.has(key)
    result.push({
      [GROUP_ROW_FLAG]: true,
      __groupKey: key,
      __groupLabel: labelOf(bucket[0]?.[field]),
      __groupCount: bucket.length,
      __groupSums: sumsOf(bucket, summaryFields),
      __groupCollapsed: collapsed
    } as GroupRow)
    if (!collapsed) result.push(...bucket)
  })
  return result
}

/**
 * 分组键
 *
 * 空值统一归到同一个键。不统一的话 null / undefined / '' 会分出三个
 * 标题都是「-」的组，用户看到三个一模一样的分组行只会觉得是坏了。
 */
const groupKeyOf = (value: any): string =>
  value === null || value === undefined || value === '' ? '' : String(value)

/**
 * 组内小计
 *
 * 非数值一律跳过而不是当 0 —— 当 0 的话，一整列都是文本时小计会显示 0，
 * 看起来像「算出来就是 0」，而实际上是这一列根本合不出来。
 */
const sumsOf = (rows: any[], fields: string[]): Record<string, number> => {
  const sums: Record<string, number> = {}
  fields.forEach((field) => {
    let total = 0
    let hit = false
    rows.forEach((row) => {
      const num = Number(row?.[field])
      if (Number.isNaN(num)) return
      total += num
      hit = true
    })
    if (hit) sums[field] = total
  })
  return sums
}

/**
 * 初始的折叠集合
 *
 * `defaultExpand: 'NONE'` 时把当前页出现的每个组都折上。
 * 返回的是当前页的组键 —— 翻页后会重算，所以「默认折叠」在每一页都生效。
 */
export const initialCollapsedKeys = (
  rows: any[],
  conf: RowGroupConfig
): Set<string> => {
  if (conf.defaultExpand !== 'NONE' || !conf.field) return new Set()
  return new Set(rows.map((row) => groupKeyOf(row?.[conf.field as string])))
}

/** 切换一个分组的折叠状态，返回新的集合（不改原集合） */
export const toggleGroupKey = (keys: Set<string>, key: string): Set<string> => {
  const next = new Set(keys)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
