/**
 * 跨字段校验的运行时
 *
 * 语义：`when` 满足时 `must` 必须也满足。条件求值直接复用联动规则的
 * `matchesGroup` —— 「结束日期 ≥ 开始日期」这类约束的条件模型与联动规则完全一样，
 * 再写一份就意味着要再维护一份双端一致性。
 *
 * ⚠️ 与后端 `FormValidationGuard#validateCrossField` 行为必须一致。
 */

import { matchesGroup, isEmptyValue } from '@/components/FormLogic/evaluator'
import type { ConditionGroup, ConditionNode } from '@/components/FormLogic/types'
import type { CrossFieldRule } from './types'

/** 一条未通过的跨字段校验 */
export interface CrossFieldViolation {
  ruleId: string
  message: string
  /** 关联字段，用于把错误提示挂到具体表单项上 */
  fields: string[]
}

/** 规则是否可用：有断言、有提示 */
const isUsable = (rule: CrossFieldRule): boolean =>
  !!rule.must?.items?.length && !!rule.message

/**
 * 专门用来判空的操作符
 *
 * 只有这两个操作符在「值为空」时仍然有意义 —— 它们问的就是「空不空」。
 */
const EMPTINESS_OPERATORS = new Set(['EMPTY', 'NOT_EMPTY'])

/**
 * 断言是否可以判定
 *
 * <h3>为什么需要这一步：填一半的表单不该报错</h3>
 *
 * 「结束日期 ≥ 开始日期」这条断言在结束日期还没填时是**判不了**的。
 * 而条件求值器对「空值参与比较」的定义是「条件不满足」——
 * 那是为联动规则设计的：不满足就不执行动作，是安全的默认。
 *
 * 到了校验这边，语义正好反过来：断言不满足 = 拒绝提交。照搬求值器的结果，
 * 用户刚填完开始日期就会被弹一句「结束日期不能早于开始日期」，
 * 而他还没开始填结束日期。
 *
 * 所以这里加一道判定：**除了 EMPTY / NOT_EMPTY，任何操作符只要有一个操作数是空的，
 * 整条规则就不检查**。填完了自然会检查 —— 而提交时服务端还会再拦一次，
 * 所以「填一半时不报错」不会变成「空着也能提交」。
 *
 * ⚠️ 与后端 `FormValidationGuard#isAssertionApplicable` 必须一致。
 */
const isAssertionApplicable = (
  group: ConditionGroup | null | undefined,
  data: Record<string, any>
): boolean => {
  const items = group?.items
  if (!items?.length) return true
  for (const node of items as ConditionNode[]) {
    if (!node) continue
    if (node.logic !== undefined || node.items !== undefined) {
      if (!isAssertionApplicable({ logic: node.logic, items: node.items }, data)) return false
      continue
    }
    const operator = String(node.operator ?? '').toUpperCase()
    if (EMPTINESS_OPERATORS.has(operator)) continue
    if (isEmptyValue(data[node.field ?? ''])) return false
    // 右值取的是另一个字段时，它也可能还没填
    if (String(node.valueType ?? '').toUpperCase() === 'FIELD' && isEmptyValue(data[node.value]))
      return false
  }
  return true
}

/**
 * 求值全部跨字段规则
 *
 * @param rules 规则列表
 * @param data  当前表单数据
 * @returns 未通过的规则；全部通过返回空数组
 */
export const evaluateCrossFieldRules = (
  rules: CrossFieldRule[] | undefined | null,
  data: Record<string, any>
): CrossFieldViolation[] => {
  if (!rules?.length) return []
  const violations: CrossFieldViolation[] = []
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue
    if (!isUsable(rule)) {
      // 配置没写完。跳过而不是拦下 —— 一条没配完的校验恒定拦住提交，
      // 用户完全不知道该改什么。发布校验会在设计期把它拦下来
      console.warn('[FormValidation] 跨字段校验规则缺少断言或提示，已跳过：', rule.name ?? rule.id)
      continue
    }
    // when 为空视为恒真，即「这条约束永远要检查」
    if (!matchesGroup(rule.when, data)) continue
    // 断言里有还没填的操作数时不检查，见 isAssertionApplicable
    if (!isAssertionApplicable(rule.must, data)) continue
    if (matchesGroup(rule.must, data)) continue
    violations.push({
      ruleId: rule.id,
      message: rule.message!,
      fields: rule.fields ?? []
    })
  }
  return violations
}

/**
 * 解析跨字段规则 JSON
 *
 * 解析失败返回空数组而不是抛异常：规则可能是旧版本写的或被手工改过，
 * 让整张表单打不开的代价远大于少生效一批校验。但要记日志。
 */
export const parseCrossFieldRules = (json: string | undefined | null): CrossFieldRule[] => {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.warn('[FormValidation] 跨字段校验规则 JSON 解析失败，本次将跳过全部跨字段校验', e)
    return []
  }
}
