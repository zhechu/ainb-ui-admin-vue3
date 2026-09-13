/**
 * 运行时列设置：让使用者自己调整列的显隐、顺序与宽度
 *
 * 与**列表设计**里的列配置是两件事：
 * 那边是设计者定的「这张表有哪些列、默认长什么样」，这边是使用者自己的偏好。
 * 同一张列表，财务想看金额、项目经理想看进度 —— 让他们各自调，比让设计者
 * 猜一个折中方案好。
 *
 * ## 偏好按 field 对齐，不按下标
 *
 * 存下标的话，设计者往中间插一列，所有偏好就整体错位一格 ——
 * 用户看到的是「我明明隐藏了备注，现在隐藏的却是电话」，而他完全不知道发生了什么。
 * 按 field 对齐则不会：插进来的新列走默认（显示），被删掉的列的偏好直接丢弃。
 *
 * ## 存本地，不存服务端
 *
 * 服务端持久化要新建一张表加一套接口，超出这一批的范围。代价是换浏览器、
 * 清缓存之后偏好就没了 —— 界面上要写明这一点，否则用户会以为设置丢了是 bug。
 *
 * ## 固定列与明细列不参与排序
 *
 * 固定列的偏移量由 Element Plus 按列序算，明细列的合并按子表分组 ——
 * 让用户随手把一个明细列拖到最前面，两者都会错位。它们仍然可以隐藏，
 * 只是不能改位置。
 */

/** 一列的用户偏好 */
export interface ColumnPref {
  field: string
  /** 明细列的偏好键要带子表名，否则主表与明细表的同名列会互相覆盖 */
  subField?: string
  hidden?: boolean
  width?: number
}

/** 列的身份标识。与设计器 StepListDesign 的 columnKey 同规则 */
export const columnKeyOf = (col: { field?: string; subField?: string }): string =>
  col?.subField ? `${col.subField}::${col.field}` : (col?.field ?? '')

/**
 * 本地存储的键
 *
 * 带上用户 id：同一台机器上换个人登录，不该看到上一个人的列设置。
 * 带上表单编码：每张列表各存各的。
 */
export const columnPrefKey = (formCode: string, userId: string | number | undefined): string =>
  `form-grid-cols:${formCode}:${userId ?? 'anonymous'}`

/**
 * 这一列能不能改位置
 *
 * 返回不能的原因而不是布尔值 —— 禁用的东西必须说明为什么，
 * 否则用户只会觉得它坏了。
 */
export const reorderBlockedReason = (col: any): string => {
  if (col?.fixed) return '固定列的位置由左右固定决定，不能拖动'
  if (col?.subField) return '明细列按所属子表成组显示，不能拖动'
  return ''
}

/** 能参与排序的列 */
export const isReorderable = (col: any): boolean => !reorderBlockedReason(col)

/**
 * 把设计期的列与用户偏好合并成最终要渲染的列
 *
 * @param designColumns 列表设计里配的列，顺序是设计期的顺序
 * @param prefs         用户偏好，顺序是用户拖出来的顺序
 * @returns 合并后的列（新对象，不改入参）
 *
 * 合并规则：
 * - 偏好里有、设计里也有 → 应用 hidden / width，并按偏好里的顺序排
 * - 设计里有、偏好里没有 → **显示**，排在它设计期的相对位置上。
 *   默认隐藏的话，设计者新加的列所有老用户都看不见，而他们不会想到去列设置里找
 * - 偏好里有、设计里没有 → 丢弃（这一列已经被设计者删了）
 */
export const applyColumnPrefs = (designColumns: any[], prefs: ColumnPref[]): any[] => {
  const prefByKey = new Map(prefs.map((pref) => [columnKeyOf(pref), pref]))
  // 偏好里的顺序，只保留设计里还存在的
  const designKeys = new Set(designColumns.map(columnKeyOf))
  const orderedKeys = prefs.map(columnKeyOf).filter((key) => designKeys.has(key))

  // 设计里新增的列插回它原来的邻居后面，而不是一律堆到末尾 ——
  // 堆到末尾的话，设计者在第二列插了一列，用户却在最后一列看到它
  const result: any[] = []
  const placed = new Set<string>()
  const pushKey = (key: string) => {
    if (placed.has(key)) return
    const col = designColumns.find((c) => columnKeyOf(c) === key)
    if (!col) return
    placed.add(key)
    const pref = prefByKey.get(key)
    result.push({
      ...col,
      ...(pref?.width ? { width: pref.width } : {}),
      __hidden: !!pref?.hidden
    })
  }

  designColumns.forEach((col, index) => {
    const key = columnKeyOf(col)
    if (prefByKey.has(key)) return
    // 这一列是新增的：先把它前面那些「偏好里有」的列按偏好顺序放完，
    // 再放它自己，这样它落在设计期的相对位置上
    const before = designColumns
      .slice(0, index)
      .map(columnKeyOf)
      .filter((k) => prefByKey.has(k))
    orderedKeys.filter((k) => before.includes(k)).forEach(pushKey)
    pushKey(key)
  })
  // 剩下的按偏好顺序补齐
  orderedKeys.forEach(pushKey)
  // 兜底：任何没被放进去的设计列都补到末尾，一列都不能丢
  designColumns.forEach((col) => pushKey(columnKeyOf(col)))

  return result
}

/** 从合并后的列反推出要存的偏好 */
export const toColumnPrefs = (columns: any[]): ColumnPref[] =>
  columns.map((col) => ({
    field: col.field,
    ...(col.subField ? { subField: col.subField } : {}),
    ...(col.__hidden ? { hidden: true } : {}),
    ...(col.width ? { width: col.width } : {})
  }))

/**
 * 读偏好
 *
 * 解析不出来时当作没有偏好，而不是抛异常 —— 一份坏掉的本地缓存
 * 不该让整张列表打不开。旧版本写进去的结构、用户手工改过的内容都算坏掉。
 */
export const readColumnPrefs = (key: string): ColumnPref[] => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && typeof item.field === 'string')
  } catch {
    return []
  }
}

/** 写偏好。写失败（隐私模式、配额满）时静默忽略 —— 它不是功能的必要条件 */
export const writeColumnPrefs = (key: string, prefs: ColumnPref[]): void => {
  try {
    localStorage.setItem(key, JSON.stringify(prefs))
  } catch {
    /* 存不下就算了，本次会话内仍然生效 */
  }
}

/** 清掉偏好，回到设计期的样子 */
export const clearColumnPrefs = (key: string): void => {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 同上 */
  }
}
