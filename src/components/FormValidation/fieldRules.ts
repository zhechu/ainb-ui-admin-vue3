/**
 * 字段格式校验的运行时
 *
 * 做两件事：
 * 1. 把控件的 `props.validateRules` **派生**成 form-create 内核的 `validate` 条目，
 *    这样格式校验能走内核自己的校验时机（失焦即时提示、提交前阻断），
 *    不需要我们再造一套错误展示
 * 2. 提供与后端逐条对齐的判定函数，供子表明细等内核管不到的地方直接调用
 *
 * <h3>为什么用 validator 函数而不是 async-validator 的 pattern</h3>
 *
 * `{ pattern: /^1[3-9]\d{9}$/ }` 更短，但空值与非标量值的处理就交给了
 * async-validator 的内部约定，而**服务端复校验有它自己的一套约定**
 * （空值放过、非标量跳过、多条只报第一条）。两套约定各自演进必然分叉，
 * 表现为「前端放过了但提交被拒」。
 *
 * 用 validator 函数把判定逻辑写在这里，与后端 FormValidationGuard 一一对应，
 * 是为了让「两侧行为一致」这件事有一个可以直接对读的位置。
 */

import { testBuiltinPattern, compilePattern, getBuiltinPattern } from './patterns'
import type { FieldValidationRule } from './types'

/** 派生出的一条内核校验规则 */
export interface DerivedValidateRule {
  validator: (rule: any, value: any, callback: (error?: Error) => void) => void
  trigger: string[]
}

/** 规则是否启用。缺省视为启用 */
const isEnabled = (rule: FieldValidationRule): boolean => rule.enabled !== false

/** 规则类型。缺省与识别失败都按「有没有 patternKey」推断，与后端一致 */
const resolveType = (rule: FieldValidationRule): 'BUILTIN' | 'REGEX' => {
  const type = String(rule.type ?? '').toUpperCase()
  if (type === 'BUILTIN' || type === 'REGEX') return type
  return rule.patternKey ? 'BUILTIN' : 'REGEX'
}

/** 规则是否可用：两种类型各缺自己那个必填项时不可用 */
const isUsable = (rule: FieldValidationRule): boolean =>
  resolveType(rule) === 'BUILTIN' ? !!rule.patternKey : !!rule.pattern

/**
 * 取错误提示
 *
 * 字段上配了自定义提示用它，否则用内置正则自带的。与后端 resolveMessage 一致。
 */
export const resolveMessage = (rule: FieldValidationRule): string => {
  if (rule.message) return rule.message
  const builtin = getBuiltinPattern(rule.patternKey)
  return builtin?.message ?? '格式不正确'
}

/**
 * 取可校验的标量文本
 *
 * @returns 可校验的文本；空值与非标量值返回 undefined（调用方跳过）
 *
 * ⚠️ 空值放过是刻意的：「填了就必须是手机号」与「必须填」是两件事。
 * 混在一起会让「非必填 + 有格式」的字段永远填不了空 —— 用户清空它反而提交不了。
 * 必填由联动规则那条路径管。
 */
export const toScalarText = (value: any): string | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object') return undefined
  const text = String(value)
  // 不 trim 后判空：纯空格算不算「没填」取决于业务，而正则本身可以表达（^\S+$），
  // 不该由校验器替用户决定
  return text === '' ? undefined : text
}

/**
 * 校验一个值
 *
 * @returns 不通过时返回错误提示；通过或规则不可用返回 undefined
 */
export const checkFieldValue = (
  rules: FieldValidationRule[] | undefined,
  value: any
): string | undefined => {
  const text = toScalarText(value)
  if (text === undefined || !rules?.length) return undefined
  for (const rule of rules) {
    if (!isEnabled(rule) || !isUsable(rule)) continue
    const passed =
      resolveType(rule) === 'BUILTIN'
        ? testBuiltinPattern(rule.patternKey, text)
        : (() => {
            const compiled = compilePattern(rule.pattern)
            // 语法错误时放过，与后端一致
            return !compiled || compiled.test(text)
          })()
    if (!passed) {
      // 只报第一条不通过的：同一个值同时违反「是手机号」和「以 138 开头」时，
      // 报两条对用户没有额外信息
      return resolveMessage(rule)
    }
  }
  return undefined
}

/**
 * 派生 form-create 的 validate 条目
 *
 * @param rules 控件的 props.validateRules
 * @returns 内核可用的校验规则数组；没有可用规则时返回空数组
 */
export const deriveValidateRules = (
  rules: FieldValidationRule[] | undefined
): DerivedValidateRule[] => {
  const usable = (rules ?? []).filter((rule) => isEnabled(rule) && isUsable(rule))
  if (!usable.length) return []
  return [
    {
      // 一条 validator 承载全部规则，而不是每条规则派生一条：
      // 内核会把多条规则的错误全部收集起来展示，而我们的语义是「只报第一条」，
      // 两者不一致会让同一个字段在前端弹两条、在服务端只报一条
      validator: (_rule, value, callback) => {
        const message = checkFieldValue(usable, value)
        callback(message ? new Error(message) : undefined)
      },
      // blur 与 change 都触发：blur 是主时机（输入过程中报错很烦），
      // change 覆盖日期/下拉这类点选后不会失焦的控件
      trigger: ['blur', 'change']
    }
  ]
}

/**
 * 唯一性校验的运行时上下文
 *
 * 查重要发请求，而请求需要表单编码与「当前编辑的是哪条记录」——
 * 这些是运行时才有的信息，不在规则树里。
 *
 * 把检查函数【传进来】而不是在本模块里 import API：
 * 本模块因此不依赖具体接口，单测里给一个假的检查函数就能跑，
 * 不用 mock 整个 axios。
 */
export interface UniqueCheckContext {
  /**
   * 检查值是否可用
   *
   * @returns 可用返回 true，已被占用返回 false
   */
  check: (field: string, value: any) => Promise<boolean>
}

/**
 * 派生唯一性校验的 validate 条目
 *
 * <h3>只在失焦时查，不在输入过程中查</h3>
 *
 * 每敲一个字符发一次请求，对一个 11 位手机号就是 11 次查库。
 * 而用户真正需要反馈的时刻是「这一格填完了」。
 *
 * <h3>请求失败时放过</h3>
 *
 * 网络抖动、接口 500 都不该表现为「这个值不能用」—— 那会把一个临时故障
 * 变成「用户怎么改都提交不了」。提交时服务端还会查一次，真重复了照样拦得住。
 */
export const deriveUniqueValidateRule = (
  field: string,
  context: UniqueCheckContext | undefined
): DerivedValidateRule[] => {
  if (!context) return []
  return [
    {
      validator: (_rule, value, callback) => {
        const text = toScalarText(value)
        // 空值不查：没填的字段谈不上重复。该不该填由必填管
        if (text === undefined) {
          callback()
          return
        }
        context
          .check(field, value)
          .then((available) => {
            callback(available ? undefined : new Error('该内容已存在，请换一个'))
          })
          .catch((e) => {
            console.warn('[FormValidation] 唯一性校验请求失败，本次放过', e)
            callback()
          })
      },
      // 只挂 blur：change 会在输入过程中反复触发
      trigger: ['blur']
    }
  ]
}
