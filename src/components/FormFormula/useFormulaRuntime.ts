/**
 * 公式字段的运行时计算
 *
 * 表单数据变化时重算全部公式字段，把结果写回表单数据。
 *
 * ## 为什么统一在这里算，而不是让每个公式控件自己算
 *
 * 一个公式可以引用另一个公式（税额 = 小计 * 税率，小计 = SUM(明细.金额)）。
 * 各控件自己算的话，渲染顺序决定计算顺序，税额可能拿到上一轮的小计 ——
 * 表现为「改了明细，合计对了但税额差一拍」。
 * 统一算并按依赖排序，才能一次收敛。
 *
 * ## 前端算的只是显示
 *
 * 提交时服务端会用同一份 AST 权威重算并覆盖。所以这里算错了不会污染数据，
 * 但会让用户看到的数与入库的数不同 —— 那同样是问题，所以两端共用一份用例集。
 */
import type { FormulaNode } from './parser'
import { evaluateFormula, type RoundingMode } from './evaluator'
import { SUB_TABLE_WIDGET_TYPE } from '@/components/FormWidgets/contracts'

/** 一个公式字段的配置 */
export interface FormulaFieldConfig {
  field: string
  ast: FormulaNode | null
  precision?: number | null
  rounding?: RoundingMode | null
  /** 依赖的普通字段（含其它公式字段） */
  dependencies: string[]
  /**
   * 所属子表控件的字段名。为空表示这是主表上的公式
   *
   * 子表里的公式是【按行】求值的：`{qty} * {price}` 里的 qty/price 指的是
   * 同一行明细上的两个值，而不是主表上的同名字段。不区分作用域的话，
   * 它会去主表上找 qty/price，找不到就恒定算出 0 —— 配了公式却永远是 0，
   * 而且不报错。
   */
  subField?: string
}

/** 收集 AST 引用到的普通字段。子表字段不算依赖 —— 它来自明细，不会被别的公式赋值 */
const collectRefs = (node: FormulaNode | null | undefined, out: Set<string>) => {
  if (!node) return
  if (node.type === 'field' && node.name) out.add(node.name)
  collectRefs(node.operand, out)
  collectRefs(node.left, out)
  collectRefs(node.right, out)
  for (const arg of node.args ?? []) collectRefs(arg, out)
}

/**
 * 从表单规则里提取全部公式字段
 *
 * 要递归：公式控件可能被放在栅格、标签页等布局容器里，也可能在子表内部。
 */
export const collectFormulaFields = (rules: any[] | null | undefined): FormulaFieldConfig[] => {
  const result: FormulaFieldConfig[] = []
  const walk = (list: any[] | null | undefined, owner?: string) => {
    if (!Array.isArray(list)) return
    for (const rule of list) {
      if (!rule || typeof rule !== 'object') continue
      if (rule.type === 'Formula' && rule.field && rule.props?.ast) {
        const refs = new Set<string>()
        collectRefs(rule.props.ast, refs)
        result.push({
          field: rule.field,
          ast: rule.props.ast,
          precision: rule.props.precision,
          rounding: rule.props.rounding,
          dependencies: [...refs],
          subField: owner
        })
      }
      walk(rule.children, owner)
      // 子表内部的规则挂在 props.rule 下（不是 children），且它们属于【明细行】作用域
      if (rule.type === SUB_TABLE_WIDGET_TYPE) walk(rule.props?.rule, rule.field)
    }
  }
  walk(rules)
  return result
}

/**
 * 按依赖拓扑排序
 *
 * 有环时把环上的字段追加在末尾 —— 顺序无保证但仍会算一遍。
 * 环本该在设计期被发布校验拦住，这里是兜底。
 */
const topologicalSort = (formulas: FormulaFieldConfig[]): FormulaFieldConfig[] => {
  const byField = new Map(formulas.map((f) => [f.field, f]))
  const ordered: FormulaFieldConfig[] = []
  const done = new Set<string>()
  const visiting = new Set<string>()

  const visit = (formula: FormulaFieldConfig) => {
    if (done.has(formula.field)) return
    if (visiting.has(formula.field)) return
    visiting.add(formula.field)
    for (const dep of formula.dependencies) {
      const depFormula = byField.get(dep)
      // 只有依赖也是公式字段才需要排序；普通字段的值是现成的
      if (depFormula) visit(depFormula)
    }
    visiting.delete(formula.field)
    if (!done.has(formula.field)) {
      done.add(formula.field)
      ordered.push(formula)
    }
  }

  formulas.forEach(visit)
  for (const f of formulas) {
    if (!done.has(f.field)) ordered.push(f)
  }
  return ordered
}

/**
 * 重算全部公式字段
 *
 * @param formulas 公式字段配置
 * @param data     表单数据。【会】被就地修改 —— 运行时的表单数据本就是响应式对象，
 *                 返回新对象会丢掉响应性
 * @returns 实际发生变化的字段名
 */
export const recalculateFormulas = (
  formulas: FormulaFieldConfig[],
  data: Record<string, any>
): string[] => {
  if (formulas.length === 0 || !data) return []
  const changed: string[] = []

  // 主表公式：在整张表单的数据上求值
  const mainFormulas = formulas.filter((formula) => !formula.subField)
  for (const formula of topologicalSort(mainFormulas)) {
    const value = evaluateFormula(formula.ast, data, formula.precision, formula.rounding)
    // 只在真的变了才写：无条件写会让响应式系统每次都触发一轮更新，
    // 大表单上表现为输入卡顿
    if (data[formula.field] !== value) {
      data[formula.field] = value
      changed.push(formula.field)
    }
  }

  // 子表公式：逐行求值，作用域是【这一行】而不是整张表单
  changed.push(...recalculateSubTableFormulas(formulas, data))
  return changed
}

/**
 * 子表内公式的逐行重算
 *
 * ⚠️ 变更集里回的是子表控件的字段名（而不是明细字段名）：
 * 调用方拿它去 `api.setValue` 推回界面，要推的是整个子表数组。
 * 回明细字段名的话主表上根本没有那个字段，推回去是个空操作，
 * 表现为「数据里算好了，界面上那一列还是空的」。
 */
const recalculateSubTableFormulas = (
  formulas: FormulaFieldConfig[],
  data: Record<string, any>
): string[] => {
  const changed = new Set<string>()
  const bySub = new Map<string, FormulaFieldConfig[]>()
  for (const formula of formulas) {
    if (!formula.subField) continue
    const list = bySub.get(formula.subField) ?? []
    list.push(formula)
    bySub.set(formula.subField, list)
  }

  bySub.forEach((subFormulas, subField) => {
    const rows = data[subField]
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      for (const formula of topologicalSort(subFormulas)) {
        const value = evaluateFormula(formula.ast, row, formula.precision, formula.rounding)
        if (row[formula.field] !== value) {
          row[formula.field] = value
          changed.add(subField)
        }
      }
    }
  })
  return [...changed]
}

/**
 * 挂载公式运行时：监听表单数据，变化时重算
 *
 * @param rules      表单规则（已解码）
 * @param formData   表单数据的响应式引用
 * @param onComputed 算完之后的回调，参数是这次真正变了的字段。
 *
 * ⚠️ `onComputed` 不是可选的锦上添花：本模块把结果**直接写进 formData 对象**，
 * 而 form-create 内部维护着自己的一份值，直接改外层对象它不一定跟上 ——
 * 表现为「数据里有值，界面上的公式字段却一直是 0」。
 * 渲染层要在这个回调里用 `api.setValue` 把结果推回去。
 * 联动运行时踩过同一个坑，那边的注释里也写了。
 */
export const useFormulaRuntime = (
  rules: () => any[] | null | undefined,
  formData: () => Record<string, any>,
  onComputed?: (changed: string[]) => void
) => {
  const formulas = computed(() => collectFormulaFields(rules()))

  /**
   * 防重入
   *
   * 重算会写回 formData，进而再次触发侦听。没有这个标志就会来回震荡。
   */
  let recalculating = false

  const recalculate = () => {
    if (recalculating) return
    recalculating = true
    try {
      const changed = recalculateFormulas(formulas.value, formData())
      if (changed.length) {
        onComputed?.(changed)
      }
    } finally {
      // 放在 finally：求值抛异常时也要把标志放开，否则公式会从此彻底停摆
      recalculating = false
    }
  }

  watch(
    () => {
      const data = formData()
      // 侦听公式依赖到的字段与子表数据，而不是整个 formData ——
      // 后者要深度遍历整棵数据树，大表单上每敲一个字都要全量比对
      const deps: any[] = []
      for (const formula of formulas.value) {
        for (const dep of formula.dependencies) deps.push(data?.[dep])
      }
      // 子表数据整体参与：聚合函数读的是明细数组
      for (const formula of formulas.value) {
        const subs = new Set<string>()
        // 子表内的公式按行求值，它整张明细表都是依赖 ——
        // 不加这一条，改明细里的数量单价不会触发重算，小计永远停在旧值
        if (formula.subField) subs.add(formula.subField)
        const walkSub = (node: FormulaNode | null | undefined) => {
          if (!node) return
          if (node.type === 'subfield' && node.sub) subs.add(node.sub)
          walkSub(node.operand)
          walkSub(node.left)
          walkSub(node.right)
          for (const a of node.args ?? []) walkSub(a)
        }
        walkSub(formula.ast)
        for (const sub of subs) deps.push(JSON.stringify(data?.[sub] ?? null))
      }
      return deps
    },
    recalculate,
    { immediate: true }
  )

  return { formulas, recalculate }
}
