import type { LogicRule } from './types'
import { SUB_FIELD_SEPARATOR } from '@/components/FormWidgets/contracts'

/**
 * 找出联动规则里引用了、但表单上已不存在的字段
 *
 * <h3>为什么要单独成一个纯函数</h3>
 *
 * 这个判断有两个调用方，且**不能依赖编辑器组件是否挂载**：
 *
 * - `LogicRuleEditor` 的内联告警（编辑器自己在用）
 * - 保存/发布前的拦截（此时编辑器可能根本没被打开过）
 *
 * 原先它是 `LogicRuleEditor` 里的一个 computed，读的是组件 ref。
 * 一旦「逻辑与扩展」从常驻步骤变成按需弹窗，没打开过弹窗时那个 ref 是 null，
 * 校验会**静默通过** —— 而它要防的恰恰就是静默失效。
 *
 * <h3>这条校验防的是什么</h3>
 *
 * 典型路径：先配好联动，之后回表单设计把某个字段删了。运行时取不到该字段就当
 * 条件不成立 / 动作无目标，**把整条规则静默跳过**，界面上没有任何异常。
 * 后端发布校验有对应的一条（`FORM_DESIGN_LOGIC_RULE_FIELD_NOT_EXISTS`），
 * 两侧口径必须一致，否则会出现「前端放过、发布才报」。
 *
 * @param rules       联动规则
 * @param knownFields 表单上现有的字段名。子表明细列是
 *                    `子表字段${SUB_FIELD_SEPARATOR}明细列` 的层级 key
 * @returns 失效的字段名（去重，保持首次出现顺序）
 */
export const findInvalidFieldRefs = (
  rules: LogicRule[] | null | undefined,
  knownFields: Iterable<string>
): string[] => {
  const valid = new Set(knownFields)
  const missing = new Set<string>()

  /**
   * 按规则的作用域判断字段名存不存在
   *
   * 行作用域（rowScope）规则对子表的每一行求值，**条件与动作里的字段名是明细列的裸名**
   * —— 后端 `FormLogicGuard#checkRowScopedRules` 直接拿 rowData 当求值上下文。
   * 而 knownFields 里明细列是带父级前缀的层级 key。不做这层换算，
   * **每一条 rowScope 规则都会被误判成无效**，而这个结果现在会挡住保存，
   * 代价比漏报大得多。
   *
   * 也允许直接写层级 key：存量数据里两种形态都可能存在。
   */
  const exists = (rule: LogicRule, field: string) => {
    if (rule.rowScope) {
      return valid.has(`${rule.rowScope}${SUB_FIELD_SEPARATOR}${field}`) || valid.has(field)
    }
    return valid.has(field)
  }

  const walkGroup = (rule: LogicRule, group: any) => {
    for (const item of group?.items ?? []) {
      // 嵌套组：靠有没有 logic/items 区分，与 ConditionNode 的定义一致
      if (item?.logic !== undefined || item?.items !== undefined) {
        walkGroup(rule, item)
        continue
      }
      if (item?.field && !exists(rule, item.field)) {
        missing.add(item.field)
      }
      // 右值也要查：valueType=FIELD 时 value 是另一个字段名。
      // 「结束日期 ≥ 开始日期」正是把开始日期写在右值上 —— 只查左值等于漏掉一半
      if (item?.valueType === 'FIELD' && typeof item.value === 'string' && item.value) {
        if (!exists(rule, item.value)) {
          missing.add(item.value)
        }
      }
    }
  }

  for (const rule of rules ?? []) {
    if (!rule) {
      continue
    }
    // 停用的规则不查：用户可能是先停用、留着以后再用。与后端保持一致
    if (rule.enabled === false) {
      continue
    }
    walkGroup(rule, rule.when)
    for (const action of [...(rule.then ?? []), ...(rule.otherwise ?? [])]) {
      if (action?.target && !exists(rule, action.target)) {
        missing.add(action.target)
      }
    }
  }
  return [...missing]
}
