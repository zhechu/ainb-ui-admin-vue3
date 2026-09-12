/**
 * 联动规则的环形赋值检测（前端）
 *
 * 与后端 `LogicRuleCycleDetector.java` 同一套算法。前端这份是即时反馈 ——
 * 用户在编辑器里配出环就立刻看到提示，不必等到发布才知道；
 * 后端那份是不可绕过的关口。
 *
 * 只检测赋值环（SET_VALUE / CLEAR_VALUE）：只有它们会改数据、进而改变其它规则的
 * 条件判断，才可能反复触发。显隐必填这类状态动作不参与条件判断，每轮都从基础状态
 * 重算，不会成环。
 */
import type { ConditionGroup, LogicRule } from './types'

/** 收集条件里引用到的字段。valueType=FIELD 的右值也算引用 */
const collectConditionFields = (group: ConditionGroup | null | undefined, out: Set<string>) => {
  if (!group) return
  for (const node of group.items ?? []) {
    if (!node) continue
    if (node.logic !== undefined || node.items !== undefined) {
      collectConditionFields({ logic: node.logic, items: node.items }, out)
      continue
    }
    if (node.field) out.add(node.field)
    if ((node.valueType ?? 'CONST').toUpperCase() === 'FIELD' && node.value) {
      out.add(String(node.value))
    }
  }
}

/** 收集会改数据的动作所影响的字段 */
const collectAssignedFields = (actions: LogicRule['then'], out: Set<string>) => {
  for (const action of actions ?? []) {
    if (!action?.target) continue
    const type = (action.type ?? '').toUpperCase()
    if (type === 'SET_VALUE' || type === 'CLEAR_VALUE') {
      out.add(action.target)
    }
  }
}

/**
 * 检测环
 *
 * @returns 找到的环，每个元素形如 "a → b → a"。没有环时返回空数组
 */
export const detectCycles = (rules: LogicRule[] | null | undefined): string[] => {
  if (!rules || rules.length === 0) return []

  // 建图：被赋值的字段 → 该赋值所依赖的条件字段。
  // 方向取「依赖」，找到的环读起来就是「a 依赖 b，b 依赖 a」
  const dependsOn = new Map<string, Set<string>>()
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue
    const conditionFields = new Set<string>()
    collectConditionFields(rule.when, conditionFields)
    // 无条件规则不会被别的字段触发，不可能成环
    if (conditionFields.size === 0) continue

    const assigned = new Set<string>()
    collectAssignedFields(rule.then, assigned)
    collectAssignedFields(rule.otherwise, assigned)

    for (const target of assigned) {
      if (!dependsOn.has(target)) dependsOn.set(target, new Set())
      const set = dependsOn.get(target)!
      conditionFields.forEach((f) => set.add(f))
    }
  }

  const cycles: string[] = []
  const visited = new Set<string>()
  const onStack = new Set<string>()
  const path: string[] = []
  // 同一个环可能从不同起点走到，用规范化表示去重
  const reported = new Set<string>()

  const dfs = (node: string) => {
    visited.add(node)
    onStack.add(node)
    path.push(node)

    for (const next of dependsOn.get(node) ?? []) {
      if (onStack.has(next)) {
        const idx = path.indexOf(next)
        const cycleNodes = idx >= 0 ? path.slice(idx) : [...path]
        const cycle = [...cycleNodes, next].join(' → ')
        const key = [...new Set(cycleNodes)].sort().join(',')
        if (!reported.has(key)) {
          reported.add(key)
          cycles.push(cycle)
        }
        continue
      }
      if (!visited.has(next)) dfs(next)
    }

    path.pop()
    onStack.delete(node)
  }

  for (const node of dependsOn.keys()) {
    if (!visited.has(node)) dfs(node)
  }
  return cycles
}
