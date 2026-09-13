/**
 * 列表内置按钮的配置模型
 *
 * ## 为什么要从「五个复选框」改成一份清单
 *
 * 原本操作列的按钮是 `buttons: ['edit','detail','delete']` 这样一个字符串数组，
 * 配置能力只有「显示 / 不显示」三个字：改不了文案（「删除」在有些业务里叫「作废」）、
 * 换不了图标、也调不了顺序。而按钮顺序是有讲究的 ——
 * 「删除」放在「编辑」左边会明显提高误点率。
 *
 * 现在存成一份有序清单，每一项带文案、图标与显隐。
 *
 * ## 兼容旧配置是硬要求
 *
 * 线上已发布的表单里存的都是旧的字符串数组。读不上来的后果不是报错，
 * 而是**操作列整列变空** —— 用户打开自己的列表发现编辑删除都没了，
 * 且看不出原因。所以 normalizeButtons 必须能吃下两种形态。
 */

/** 按钮位置 */
export type ListButtonPosition = 'toolbar' | 'row'

/** 一个按钮的配置 */
export interface ListButton {
  /** 内置按钮标识，不可改 */
  key: string
  /** 显示文案，可改 */
  label: string
  /** 图标，可空 */
  icon?: string
  /** 显不显示 */
  show: boolean
}

/** 内置按钮的出厂定义 */
export interface BuiltinButton {
  key: string
  position: ListButtonPosition
  label: string
  icon: string
  /** 出厂是否显示 */
  defaultShow: boolean
  /**
   * 是否还受别的配置约束
   *
   * 打印按钮没配模板时点开是一张空白纸，变更记录没开日志时点开永远是空的 ——
   * 这两个即使勾了显示，运行时仍要再判一次。
   */
  gated?: 'print' | 'changeLog'
}

export const BUILTIN_BUTTONS: BuiltinButton[] = [
  // 工具栏
  { key: 'create', position: 'toolbar', label: '新增', icon: 'ep:plus', defaultShow: true },
  { key: 'export', position: 'toolbar', label: '导出', icon: 'ep:download', defaultShow: false },
  {
    key: 'batchDelete',
    position: 'toolbar',
    label: '批量删除',
    icon: 'ep:delete',
    defaultShow: false
  },
  {
    key: 'batchPrint',
    position: 'toolbar',
    label: '批量打印',
    icon: 'ep:printer',
    defaultShow: false,
    gated: 'print'
  },
  {
    // 列表打印：把当前这张表原样印出来（含分组表头、合并单元格、分组行、合计行）。
    //
    // ⚠️ 与「批量打印」是两件事，不要合并成一个按钮：
    // 批量打印是「勾中的每条记录各印一页单据」，走的是打印模板；
    // 列表打印是「把这张报表印成一张表」，与模板无关。
    // 所以它也【不】带 gated: 'print' —— 没配打印模板照样能印列表，
    // 带上的话用户会发现「配了模板才有列表打印」，而两者根本不相干。
    key: 'printList',
    position: 'toolbar',
    label: '打印列表',
    icon: 'ep:document',
    defaultShow: false
  },
  // 行内
  { key: 'edit', position: 'row', label: '编辑', icon: '', defaultShow: true },
  { key: 'detail', position: 'row', label: '详情', icon: '', defaultShow: true },
  {
    key: 'changeLog',
    position: 'row',
    label: '变更记录',
    icon: '',
    defaultShow: true,
    gated: 'changeLog'
  },
  { key: 'print', position: 'row', label: '打印', icon: '', defaultShow: true, gated: 'print' },
  { key: 'delete', position: 'row', label: '删除', icon: '', defaultShow: true }
]

const BUILTIN_BY_KEY = new Map(BUILTIN_BUTTONS.map((b) => [b.key, b]))

export const builtinOf = (key: string): BuiltinButton | undefined => BUILTIN_BY_KEY.get(key)

export const positionOf = (key: string): ListButtonPosition =>
  BUILTIN_BY_KEY.get(key)?.position ?? 'row'

/** 需要勾选行才能用的按钮 */
const SELECTION_BUTTONS = ['batchDelete', 'batchPrint']

/** 这份配置要不要在表格上放多选列 */
export const needsSelection = (buttons: ListButton[]): boolean =>
  buttons.some((b) => b.show && SELECTION_BUTTONS.includes(b.key))

/** 出厂配置 */
export const defaultButtons = (): ListButton[] =>
  BUILTIN_BUTTONS.map((b) => ({
    key: b.key,
    label: b.label,
    icon: b.icon || undefined,
    show: b.defaultShow
  }))

/**
 * 把存下来的配置归一成清单
 *
 * 吃两种形态：
 * - 旧的字符串数组 `['edit','detail','delete']`
 * - 新的对象清单
 *
 * 无论哪种，**结果一定包含全部内置按钮** —— 少一项会让它在设计器里
 * 整个消失，用户再也配不回来。清单里没出现过的内置按钮一律补成
 * 「不显示」而不是出厂默认：往后新增内置按钮时，
 * 不能让它自己出现在所有已发布的表单上。
 */
export const normalizeButtons = (stored: any): ListButton[] => {
  const result: ListButton[] = []
  const seen = new Set<string>()

  if (Array.isArray(stored)) {
    for (const item of stored) {
      if (typeof item === 'string') {
        // 旧形态：出现在数组里就是显示
        const builtin = BUILTIN_BY_KEY.get(item)
        if (!builtin || seen.has(item)) continue
        seen.add(item)
        result.push({ key: item, label: builtin.label, icon: builtin.icon || undefined, show: true })
      } else if (item && typeof item === 'object' && typeof item.key === 'string') {
        const builtin = BUILTIN_BY_KEY.get(item.key)
        // 认不出的 key 丢掉：运行时没有对应的处理分支，留着只会渲染出一个点了没反应的按钮
        if (!builtin || seen.has(item.key)) continue
        seen.add(item.key)
        result.push({
          key: item.key,
          // 文案被清空时回落到出厂文案，而不是渲染一个没有字的按钮
          label: item.label || builtin.label,
          icon: item.icon || undefined,
          show: item.show !== false
        })
      }
    }
  }

  // 清单里没出现过的内置按钮按下面这条规则补
  for (const builtin of BUILTIN_BUTTONS) {
    if (seen.has(builtin.key)) continue
    result.push({
      key: builtin.key,
      label: builtin.label,
      icon: builtin.icon || undefined,
      show: isEmptyConfig(stored)
        ? // 完全没配置过 → 出厂默认
          builtin.defaultShow
        : // 配置过但没提到它 → 只有改造前本就不受数组控制的那两个才补成显示
          LEGACY_AUTO_SHOWN.includes(builtin.key)
    })
  }

  return result
}

const isEmptyConfig = (stored: any): boolean =>
  !Array.isArray(stored) || stored.length === 0

/**
 * 改造前**不受 buttons 数组控制**的按钮
 *
 * ⚠️ 这两个是兼容性的关键。「变更记录」与「打印」以前是写死在模板里的，
 * 显不显示只看各自的开关（开没开变更日志、配没配打印模板），
 * 从来没有出现在 buttons 数组里过。
 *
 * 所以旧配置里找不到它们是**常态**，不能按「用户关掉了」处理 ——
 * 那样会让所有已发布表单的变更记录与打印入口一起消失，
 * 而两个开关明明还开着。这个回归是全量 e2e 抓到的。
 *
 * 其余新增按钮（批量删除、批量打印）当年不存在，缺省一律不显示。
 */
const LEGACY_AUTO_SHOWN = ['changeLog', 'print']

/** 取某个位置上要显示的按钮，保持配置里的顺序 */
export const visibleButtons = (
  buttons: ListButton[],
  position: ListButtonPosition
): ListButton[] => buttons.filter((b) => b.show && positionOf(b.key) === position)

// ==================== 行内按钮的折叠 ====================
//
// 行按钮一排开就会把操作列撑得很宽，而操作列是 fixed="right" 的 ——
// 它挤掉的是数据列的可视宽度。配上「编辑/详情/变更记录/打印/删除」再加两个
// 自定义按钮，一行七个按钮，表格能看的部分只剩一半。
// 超出阈值的收进「更多」下拉：按钮一个都不少，只是换了个位置。

/**
 * 出厂阈值
 *
 * 三个：内置行按钮的出厂组合正好是「编辑 / 详情 / 删除」，
 * 也就是没配过任何东西的表单不会凭空多出一个「更多」下拉。
 */
export const DEFAULT_MAX_INLINE_BUTTONS = 3

/**
 * 阈值归一
 *
 * 存量配置里没有这个键 —— 回落到出厂阈值而不是「不折叠」：
 * 折叠只是把多出来的按钮换个位置，不会让任何按钮消失。
 * 非法值（0、负数、非数字）同样回落，否则会算出一个所有按钮都进下拉的操作列。
 */
export const normalizeMaxInline = (value: any): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_INLINE_BUTTONS
  return Math.floor(parsed)
}

/**
 * 按阈值把按钮拆成「直接显示」与「收进下拉」两组
 *
 * ⚠️ 只差一个时不折叠：四个按钮、阈值三 —— 折叠的话是「三个按钮 + 一个下拉」，
 * 占的宽度反而比四个按钮还多，而且多一次点击。必须真的省下位置才值得折。
 *
 * @param buttons 已经过滤过显隐与可见条件的按钮，顺序即显示顺序
 * @param maxInline 阈值
 */
export const splitInlineButtons = <T>(
  buttons: T[],
  maxInline: any
): { inline: T[]; folded: T[] } => {
  const limit = normalizeMaxInline(maxInline)
  if (buttons.length <= limit + 1) {
    return { inline: buttons, folded: [] }
  }
  return { inline: buttons.slice(0, limit), folded: buttons.slice(limit) }
}
