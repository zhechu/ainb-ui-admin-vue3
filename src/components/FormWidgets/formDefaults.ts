/**
 * 表单控件的出厂默认值
 *
 * ## 它解决的是「新增页带着上一条记录的内容」
 *
 * 运行时的新增 / 编辑 / 详情共用**同一个** form-create 实例。写值的两个入口
 * 都会改到规则对象本身：`setValue` / `coverValue` 落到 `ctx.rule.value` 上，
 * 而 `ctx` 又是从规则树建出来的。于是一旦打开过一条记录，那条记录的值就
 * 「长」在规则树上了 —— 接着点新增，表单里是上一条的全部内容。
 *
 * form-create 自己的 `resetFields()` 帮不上忙：它恢复的是 `ctx.defaultValue`，
 * 而 ctx 在规则树被重建时（场景过滤、折叠分组都会重建）是按**当时**的
 * `rule.value` 重新捕获的 —— 也就是上一条记录的值。
 *
 * 所以默认值必须在规则树**第一次解码出来、还没被任何人写过**的那一刻抓下来，
 * 单独存一份。新增时用它 + `coverValue` 覆盖：既清掉了残留，
 * 又保住了设计器里配的默认值（不然新增页会变成「所有控件都是空的」，
 * 那是另一个方向的错）。
 */

/** 子表控件的类型。它的内部规则在 props.rule 下，与外层不是同一个作用域 */
const SUB_TABLE_TYPE = 'group'

/**
 * 从规则树里抓出各字段的默认值
 *
 * ⚠️ 只收**主表作用域**的字段。子表控件的默认值是「新增一行明细时那一行长什么样」，
 * 由子表控件自己管；把它们平铺到顶层会写出一个不存在的字段。
 *
 * @param rules 刚解码出来、尚未被写过值的规则树
 * @returns 字段名 → 默认值。没有默认值的字段不出现在结果里
 */
export const collectDefaultValues = (rules: any[]): Record<string, any> => {
  const defaults: Record<string, any> = {}
  walk(rules, defaults)
  return defaults
}

const walk = (rules: any[], defaults: Record<string, any>) => {
  if (!Array.isArray(rules)) return
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    const isSubTable =
      rule.type === SUB_TABLE_TYPE && Array.isArray(rule.props?.rule)
    if (rule.field && rule.value !== undefined) {
      defaults[rule.field] = clone(rule.value)
    }
    // 布局容器（栅格、标签页、折叠面板）的子控件与外层同作用域，要继续往下走
    if (Array.isArray(rule.children)) {
      walk(rule.children, defaults)
    }
    // 子表内部不收，理由见上
    if (isSubTable) continue
  }
}

/**
 * 深拷贝默认值
 *
 * 数组与对象类型的默认值（多选、子表）必须拷一份 —— 直接交出去的话，
 * 用户在表单里改动的是**这份默认值本身**，下一次新增就带着上一次的改动。
 */
const clone = (value: any): any => {
  if (value === null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    // 循环引用之类的极端情况：退回原值，总比让整张表单打不开好
    return value
  }
}
