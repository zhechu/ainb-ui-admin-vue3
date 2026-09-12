/**
 * 校验规则的类型定义
 *
 * 与后端 `framework/formdesign/core/validation/` 下的
 * `FieldValidationRule.java`、`CrossFieldRule.java` 一一对应。
 */

import type { ConditionGroup } from '@/components/FormLogic/types'

/** 字段级校验规则的类型 */
export type FieldValidationType =
  /** 引用内置正则库 */
  | 'BUILTIN'
  /** 自定义正则 */
  | 'REGEX'

/**
 * 字段级校验规则
 *
 * 存在控件的 `props.validateRules` 数组里，一个字段可以配多条，逐条校验。
 *
 * ⚠️ 键名刻意不叫 `validate`（form-create 内核已有那个键）：
 * `validateRules` 是我们自己的声明式模型、是唯一事实来源，运行时**单向派生**出
 * 内核的 `validate` 条目。反过来（直接写内核的 validate）服务端就复校验不了 ——
 * 那一套的语义是 async-validator 全集，含自定义函数与异步校验器，
 * 服务端只能实现其中一小部分，结果是「配了但服务端不生效」。
 */
export interface FieldValidationRule {
  type?: FieldValidationType | string
  /** 内置正则的 key，type=BUILTIN 时使用 */
  patternKey?: string
  /** 自定义正则，type=REGEX 时使用 */
  pattern?: string
  /** 自定义错误提示。为空时用内置正则自带的提示 */
  message?: string
  /** 缺省视为启用 —— 少写一个布尔不该让规则静默失效 */
  enabled?: boolean
}

/**
 * 跨字段校验规则
 *
 * 语义：`when` 满足时 `must` 必须也满足。两个条件组都复用联动规则的条件模型。
 */
export interface CrossFieldRule {
  id: string
  name?: string
  /** 缺省视为启用 */
  enabled?: boolean
  /** 前置条件。为空视为恒真，即「这条约束永远要检查」 */
  when?: ConditionGroup | null
  /**
   * 必须满足的条件
   *
   * 键名用 `must` 而不是 `assert`：后者是 Java 关键字，后端字段名就得改叫
   * assertion 再挂 @JsonProperty，两侧名字会不一样。
   */
  must?: ConditionGroup | null
  /** 校验不通过时的提示。必填 —— 自动生成的提示对用户毫无意义 */
  message?: string
  /** 关联字段，仅用于把错误提示挂到具体表单项上 */
  fields?: string[]
}

/** 一条内置正则 */
export interface BuiltinPattern {
  key: string
  label: string
  pattern: string
  message: string
}
