/**
 * 分步校验
 *
 * 给标签页容器加上「当前页校验不过就不许切走」的能力，也就是设计方案 §5.3 里
 * 步骤条要的那条核心能力：**每步校验通过才能下一步**。
 *
 * ## 为什么挂在标签页上，而不是做一个 Steps 容器
 *
 * 独立的步骤条控件要做成**设计器可识别的容器**（每一步是一个可拖入的落点），
 * 那是另一个量级的工作。而「分步」这件事真正稀缺的部分不是那个横条 UI ——
 * 是「这一步没填完不让走」。标签页容器设计器已经支持了，把校验挂上去，
 * 用户立刻就能用；横条样式的步骤条留待以后。
 *
 * 交接文档里对这一点有明确记录，没有把它当成「Steps 已完成」。
 *
 * ## 用 el-tabs 的 before-leave
 *
 * `before-leave: (newName, oldName) => boolean | Promise<boolean>`，返回假值就
 * 阻止切换。这是 element-plus 自己的钩子 —— 不是我们猜的属性。
 *
 * ⚠️ 上一次给 el-input-number 挂 `formatter` 时没有先确认那个 prop 存在，
 * 结果是「挂上去不报错、完全不生效」。这次先在 element-plus 源码里核对过。
 */

/** 标签页容器与标签页的控件类型，与控件契约一致 */
export const TABS_WIDGET_TYPE = 'elTabs'
export const TAB_PANE_WIDGET_TYPE = 'elTabPane'

/** 一个开启了分步校验的标签页容器 */
export interface StepTabs {
  /** 容器自身的 field，仅用于排查 */
  key: string
  /** 标签页名 → 这一页里的字段 */
  panes: Map<string, string[]>
}

/** 取标签页的 name。form-create 的标签页用 props.name 做标识，缺省用下标 */
const paneNameOf = (pane: any, index: number): string =>
  String(pane?.props?.name ?? pane?.name ?? index)

/** 收集一个标签页里的所有字段（含嵌套在栅格里的） */
const collectPaneFields = (node: any, out: string[]) => {
  if (!node || typeof node !== 'object') return
  if (node.field && node.type !== TAB_PANE_WIDGET_TYPE) {
    out.push(node.field)
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectPaneFields(child, out)
  }
}

/**
 * 收集开启了分步校验的标签页容器
 */
export const collectStepTabs = (rules: any[] | null | undefined): StepTabs[] => {
  const result: StepTabs[] = []
  const walk = (list: any[] | null | undefined) => {
    if (!Array.isArray(list)) return
    for (const rule of list) {
      if (!rule || typeof rule !== 'object') continue
      if (rule.type === TABS_WIDGET_TYPE && rule.props?.stepValidate === true) {
        const panes = new Map<string, string[]>()
        const children = Array.isArray(rule.children) ? rule.children : []
        children.forEach((pane: any, index: number) => {
          if (pane?.type !== TAB_PANE_WIDGET_TYPE) return
          const fields: string[] = []
          for (const child of pane.children ?? []) collectPaneFields(child, fields)
          panes.set(paneNameOf(pane, index), fields)
        })
        result.push({ key: rule.field ?? '', panes })
      }
      walk(rule.children)
    }
  }
  walk(rules)
  return result
}

/** 校验一批字段。实现由运行时注入 —— 本模块不认识 form-create 的 api */
export type FieldsValidator = (fields: string[]) => Promise<boolean>

/**
 * 给标签页容器装上 before-leave
 *
 * @param rules     规则树，会被就地修改
 * @param validate  校验函数
 *
 * <h3>只拦「往后走」，不拦「往回退」</h3>
 *
 * 回到上一步去改东西是正常操作，这时拦着他等于说「你上一步填错了所以不许回去改」。
 * 判据是标签页在容器里的先后顺序。
 */
export const applyStepValidate = (
  rules: any[] | null | undefined,
  validate: FieldsValidator
): void => {
  for (const tabs of collectStepTabs(rules)) {
    // 拿到顺序，用来区分前进与后退
    const order = [...tabs.panes.keys()]
    const beforeLeave = async (newName: string, oldName: string) => {
      const from = order.indexOf(String(oldName))
      const to = order.indexOf(String(newName))
      // 认不出来的页（顺序变了、名字对不上）一律放行 ——
      // 拦一个我们判断不了的切换，用户会卡在这一页出不去
      if (from < 0 || to < 0 || to <= from) return true
      const fields = tabs.panes.get(String(oldName)) ?? []
      if (fields.length === 0) return true
      return validate(fields)
    }
    // 就地写回规则树
    applyToTabs(rules, tabs.key, beforeLeave)
  }
}

/** 把 beforeLeave 写到对应的标签页容器上 */
const applyToTabs = (
  rules: any[] | null | undefined,
  key: string,
  beforeLeave: (newName: string, oldName: string) => Promise<boolean>
) => {
  const walk = (list: any[] | null | undefined): boolean => {
    if (!Array.isArray(list)) return false
    for (const rule of list) {
      if (!rule || typeof rule !== 'object') continue
      if (rule.type === TABS_WIDGET_TYPE && (rule.field ?? '') === key) {
        rule.props = { ...(rule.props ?? {}), beforeLeave }
        return true
      }
      if (walk(rule.children)) return true
    }
    return false
  }
  walk(rules)
}
