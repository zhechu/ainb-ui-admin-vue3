/**
 * 内置正则库（前端侧）
 *
 * ⚠️ `validation-patterns.json` 是构建期副本，规范副本在后端
 * `resources/form-design/validation-patterns.json`。改动流程与控件契约一致：
 * 先改后端、再 cp 过来、两侧各跑测试，见后端 `resources/form-design/SYNC.md`。
 *
 * 为什么不做成运行时拉接口：设计器的属性面板在模块加载期就要列出可选正则，
 * 改成异步会把一批同步函数染成异步；而正则库是低频变更的静态数据，
 * 「本地副本 + 一致性测试」的折中更划算。
 */

import patternFile from './validation-patterns.json'
import type { BuiltinPattern } from './types'

/** 正则库版本号，排查两侧不一致时用 */
export const PATTERN_LIBRARY_VERSION: number = (patternFile as any).libraryVersion

/** 全部内置正则，按声明顺序 —— 设计器下拉框的顺序要稳定 */
export const BUILTIN_PATTERNS: BuiltinPattern[] = ((patternFile as any).patterns ?? []).filter(
  (item: any) => item?.key && item?.pattern
)

/** key（大写） → 内置正则 */
const patternByKey = new Map<string, BuiltinPattern>(
  BUILTIN_PATTERNS.map((item) => [item.key.toUpperCase(), item])
)

/**
 * 编译缓存
 *
 * 同一个正则字符串在一次填表里会被 test 很多次（每次输入都可能触发校验），
 * 每次 new RegExp 是白花的开销。
 *
 * 上限与后端一致的理由也一致：key 来自表单配置，无界缓存意味着
 * 「改一次正则就多一条永不释放的条目」。到顶后改为每次编译。
 */
const CACHE_LIMIT = 500
const compiledCache = new Map<string, RegExp | null>()

/**
 * 编译一条正则
 *
 * 语法错误返回 null 而不是抛异常 —— 一个写错的正则不该让整张表单的校验初始化失败。
 * 那会表现为「所有字段的校验都不见了」，比这一条不生效严重得多。
 */
export const compilePattern = (regex: string | undefined | null): RegExp | null => {
  if (!regex) return null
  if (compiledCache.has(regex)) return compiledCache.get(regex)!
  let compiled: RegExp | null = null
  try {
    // 不加 u 标志：后端的 java.util.regex 没有对应开关，加上会让 \d 等元字符的
    // Unicode 语义在两侧分叉。正则库本身也已回避需要 u 标志的写法
    compiled = new RegExp(regex)
  } catch (e) {
    console.error('[FormValidation] 正则语法错误，该条校验不会生效：', regex, e)
    compiled = null
  }
  if (compiledCache.size < CACHE_LIMIT) {
    compiledCache.set(regex, compiled)
  }
  return compiled
}

/** 按 key 取内置正则，大小写不敏感；不存在返回 undefined */
export const getBuiltinPattern = (key: string | undefined | null): BuiltinPattern | undefined =>
  key ? patternByKey.get(key.toUpperCase()) : undefined

/**
 * 用内置正则校验一个值
 *
 * ⚠️ 与后端 `ValidationPatternRegistry.BuiltinPattern#matches` 行为必须一致：
 * key 不存在或正则编译失败时**放过**。
 * - key 不存在：拦下来会让一次正则库调整使所有引用它的存量表单集体提交失败
 * - 编译失败：那是我们自己写错了，不该表现为用户的输入被拒绝
 */
export const testBuiltinPattern = (key: string | undefined | null, value: string): boolean => {
  const builtin = getBuiltinPattern(key)
  if (!builtin) return true
  const compiled = compilePattern(builtin.pattern)
  return !compiled || compiled.test(value)
}
