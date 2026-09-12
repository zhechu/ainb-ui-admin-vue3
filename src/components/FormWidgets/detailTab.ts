/**
 * 详情页页签
 *
 * 详情页此前只有表单本体。业务上常见的「这条记录被改过什么」「挂在它下面的关联单据
 * 有哪些」只能另找入口，或者干脆看不到 —— 而这两件恰恰是查一条单据时最想看的。
 *
 * ## 两种类型
 *
 * 变更日志与关联数据列表。页签当初做成清单而不是几个布尔开关，就是为了加类型
 * 这一步：加第二种只动 `DetailTabType` 与渲染分支，配置结构没动过 ——
 * 只是多了两个仅 `RELATION_LIST` 用的字段。
 */

/** 页签类型 */
export type DetailTabType = 'CHANGE_LOG' | 'RELATION_LIST'

export interface DetailTab {
  key: string
  label: string
  type: DetailTabType
  /**
   * 目标表单编码。仅 RELATION_LIST
   *
   * 运行时调的是【那张表单的分页接口】，所以权限也按它算 ——
   * 要 `infra:form-design-run:{目标编码}:query`。没有的话页签是空的，
   * 这是对的：不该因为「在另一张表单的详情页里」就绕过目标表单的权限
   */
  targetFormCode?: string
  /**
   * 目标表单上指向本记录的字段。仅 RELATION_LIST
   *
   * ⚠️ 运行时按 `该字段 EQ 本记录主键` 去查。字段名写错的话，分页接口会
   * 【静默忽略】这个条件，页签里就列出目标表单的全部数据 —— 发布校验会拦
   */
  targetField?: string
}

/**
 * 解析页签配置
 *
 * 解析失败返回空数组：一份坏掉的配置不该让详情页打不开。
 */
export const parseDetailTabs = (json?: string | null): DetailTab[] => {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
