/**
 * 表单校验（前端侧）
 *
 * 三块内容：
 * - `patterns.ts` —— 内置正则库，与后端同一份 JSON 的构建期副本
 * - `fieldRules.ts` —— 字段格式校验，把 props.validateRules 派生成内核的 validate
 * - `crossField.ts` —— 跨字段校验，复用联动规则的条件求值
 *
 * 前端校验是**体验**，服务端复校验才是**约束**。两侧共用一份正则库与一份用例集，
 * 就是为了避免「界面上填好了但提交失败」这类没有线索的问题。
 */

export * from './types'
export * from './patterns'
export * from './fieldRules'
export * from './crossField'

import { deriveValidateRules, deriveUniqueValidateRule } from './fieldRules'
import type { UniqueCheckContext } from './fieldRules'
import type { FieldValidationRule } from './types'
import { readNestedRules } from '@/components/FormWidgets/contracts'

/**
 * 标记：这条 validate 条目是从 validateRules 派生出来的
 *
 * 用来支持重复调用 —— 重新应用时先把上一次派生的清掉，
 * 否则同一条规则会越堆越多，一个字段报十遍同样的错。
 */
const DERIVED_FLAG = '__fromValidateRules'

/**
 * 把 validateRules 与唯一性校验派生成内核的 validate，就地写入规则树
 *
 * 递归处理布局容器的 children 与子表控件的内部规则 —— 字段可能藏在栅格、
 * 标签页或子表里，漏掉任何一层都等于那一部分表单没有格式校验。
 *
 * @param rules   form-create 规则树（decodeFields 的产物），会被就地修改
 * @param unique  唯一性校验的上下文。不传则跳过唯一性（设计器预览里就不该发查重请求）
 */
export const applyValidateRules = (
  rules: any[] | undefined | null,
  unique?: UniqueCheckContext
): void => {
  if (!Array.isArray(rules)) return
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue

    const validateRules: FieldValidationRule[] | undefined = rule.props?.validateRules
    const derived = [...deriveValidateRules(validateRules)]
    // 唯一性只对主表字段做：子表明细列的唯一性语义不明确（同一单据内不重复？
    // 还是整张明细表不重复？），服务端也刻意没做，两侧保持一致
    if (rule.props?.uniqueCheck === true && rule.field) {
      derived.push(...deriveUniqueValidateRule(rule.field, unique))
    }
    if (derived.length) {
      const existing = Array.isArray(rule.validate)
        ? rule.validate.filter((item: any) => !item?.[DERIVED_FLAG])
        : []
      rule.validate = [
        ...existing,
        ...derived.map((item) => ({ ...item, [DERIVED_FLAG]: true }))
      ]
    }

    // 子表控件的内部规则挂在契约声明的路径下，不是 children
    applyValidateRules(readNestedRules(rule), unique)
    applyValidateRules(rule.children, unique)
  }
}
