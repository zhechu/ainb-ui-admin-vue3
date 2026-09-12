/**
 * 数组型控件的空值归一
 *
 * ## 它修的是「编辑一条记录时弹窗直接打不开」
 *
 * 库里某个多值列是 NULL（用户新增时没填那一项），取详情读回来就是 `null`。
 * 这个 `null` 被原样塞进表单，而多值控件拿到的 `modelValue` 于是也是 `null`。
 *
 * Element Plus 的穿梭框在这一步直接崩：
 *
 * ```js
 * // element-plus/es/components/transfer/src/composables/use-computed-data.mjs
 * sourceData: computed(() => props.data.filter(item => !props.modelValue.includes(...)))
 * //                                                    ^^^^^^^^^^^^^^^^ null.includes → TypeError
 * ```
 *
 * 异常发生在渲染期，并且是在 `dialogVisible = true` 之后由 computed 求值触发的，
 * 后果是**整个弹窗渲染不出来** —— 用户看到的是「点了编辑没反应 / 页面报错」，
 * 而列表本身还好好的，很难联想到是某个没填过的字段导致的。
 *
 * 新增态碰不到：那时表单值是空对象，控件走各自的默认值（穿梭框默认 `[]`）。
 * 只有编辑与详情会把库里的 `null` 递进去，所以表现成「新增好用、编辑就坏」。
 *
 * ## 为什么归一在读取侧，且只补 null
 *
 * 与 {@link ./uploadValue} 同一类做法：这是「库里的形态 → 控件认的形态」的适配，
 * 挂在运行时的读取路径上，不动控件本身（那些控件是全局注册的，调用方遍布 src）。
 *
 * 只把 `null` / `undefined` 补成 `[]`，不碰任何已有值 ——
 * 「空」与「空数组」在提交时本就等价（服务端按空值处理），
 * 而把非空值也一并转换会改变语义。
 */
import { getWidgetContract, readNestedRules } from '@/components/FormWidgets/contracts'

/**
 * 收集值类型为数组的字段
 *
 * @returns main 为主表字段；sub 为「子表控件字段 → 其内部的数组字段」
 */
export const collectArrayFields = (
  rules: any[]
): { main: Set<string>; sub: Map<string, Set<string>> } => {
  const main = new Set<string>()
  const sub = new Map<string, Set<string>>()

  const walk = (node: any, owner: string | null) => {
    if (!node || typeof node !== 'object') return
    const field = typeof node.field === 'string' ? node.field : null
    const inner = readNestedRules(node)

    // ⚠️ 子表控件自己的 valueType 也是 array，但它的空值不能补成 []：
    // 那会让「明细一行都没有」与「还没加载明细」在提交时长得一样。
    // 有内部规则的节点一律当容器处理，只递归不登记
    if (field && !inner && getWidgetContract(node.type)?.valueType === 'array') {
      if (owner) {
        if (!sub.has(owner)) sub.set(owner, new Set())
        sub.get(owner)!.add(field)
      } else {
        main.add(field)
      }
    }

    if (field && Array.isArray(inner)) {
      for (const child of inner) walk(child, field)
    }
    if (Array.isArray(node.children)) {
      // 布局容器不改变归属
      for (const child of node.children) walk(child, owner)
    }
  }

  for (const rule of rules ?? []) walk(rule, null)
  return { main, sub }
}

/**
 * 把一整条记录里数组型字段的空值补成 `[]`
 *
 * @param record 取详情接口返回的记录。本函数**不修改入参**
 * @param rules  form-create 的规则树
 * @returns 归一后的记录；没有需要补的字段时原样返回入参
 */
export const normalizeArrayValues = (
  record: Record<string, any> | null | undefined,
  rules: any[]
): Record<string, any> => {
  if (!record) return {}
  const { main, sub } = collectArrayFields(rules)
  if (main.size === 0 && sub.size === 0) return record

  const needsFill = (value: any) => value === null || value === undefined

  let changed = false
  const result = { ...record }
  for (const field of main) {
    // 只补真正的空值。字段压根没出现在记录里也要补 ——
    // 控件照样会被渲染，拿到的仍然是 undefined
    if (needsFill(result[field])) {
      result[field] = []
      changed = true
    }
  }
  for (const [subField, fields] of sub) {
    const rows = result[subField]
    if (!Array.isArray(rows) || rows.length === 0) continue
    let rowsChanged = false
    const copied = rows.map((row) => {
      if (!row || typeof row !== 'object') return row
      let rowChanged = false
      const copy = { ...row }
      for (const field of fields) {
        if (needsFill(copy[field])) {
          copy[field] = []
          rowChanged = true
        }
      }
      if (!rowChanged) return row
      rowsChanged = true
      return copy
    })
    if (rowsChanged) {
      result[subField] = copied
      changed = true
    }
  }
  return changed ? result : record
}
