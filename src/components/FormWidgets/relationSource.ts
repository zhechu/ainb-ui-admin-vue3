import { readNestedRules } from '@/components/FormWidgets/contracts'

/**
 * 给关联表单控件注入「它属于哪张表单」
 *
 * ## 为什么控件自己不知道
 *
 * `RelationForm` 的 props 全部来自设计期配置，里面只有**目标**表单编码
 * （要关联谁），没有**源**表单编码（自己长在谁身上）—— 设计期也确实
 * 不需要知道，那时候还没有「运行在哪张表单里」这回事。
 *
 * ## 为什么运行时又需要它
 *
 * 关联控件取候选数据走的是 REFERENCE 弱查询接口，而那个接口的入参是
 * 「源表单编码 + 控件字段名」，**不是**「目标表单 + 要哪些字段」。
 *
 * 这个入参形状是故意的：目标表单与可见字段由服务端从源表单的已发布配置里读，
 * 前端传不了。允许前端传的话，接口就退化成「任意表单任意字段」的读取口 ——
 * 比它想替代的 query 权限还宽，那这个动作就白设了。
 *
 * 代价就是前端得把源表单编码送进来，也就是本模块做的这一件事。
 */

/**
 * 关联表单控件在规则树里的 type
 *
 * 与后端 `RelationFormResolver.RELATION_WIDGET_TYPE` 是同一个字面量。
 * ⚠️ 两处都改才有效 —— 只改一边的表现是「关联控件取不到候选数据」，
 * 而界面上只是下拉框空着，不报错
 */
const RELATION_WIDGET_TYPE = 'RelationForm'

/**
 * 遍历规则树
 *
 * 布局容器走 children，子表控件走契约声明的嵌套路径 —— 关联控件被放进
 * 栅格或子表里是常规用法，漏掉任一种都等于那一部分的关联控件取不到数
 */
const walkRules = (rules: any[] | undefined | null, visit: (rule: any) => void): void => {
  if (!Array.isArray(rules)) return
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    visit(rule)
    walkRules(readNestedRules(rule), visit)
    walkRules(rule.children, visit)
  }
}

/**
 * 就地给规则树里的关联控件补上 sourceFormCode
 *
 * @param rules    规则树，会被就地修改
 * @param formCode 当前正在渲染的表单编码
 */
export const applyRelationSource = (
  rules: any[] | undefined | null,
  formCode: string | undefined
): void => {
  if (!formCode) return
  walkRules(rules, (rule) => {
    if (rule.type !== RELATION_WIDGET_TYPE) return
    rule.props = rule.props ?? {}
    rule.props.sourceFormCode = formCode
    // 控件字段名也一并塞进去。组件里虽然拿得到 formCreateInject，
    // 但那条路上的 field 在子表行内会带上行号前缀，与后端按字段名找控件的口径对不上
    rule.props.sourceField = rule.field
  })
}
