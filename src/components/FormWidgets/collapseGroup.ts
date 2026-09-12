/**
 * 分组标题的折叠
 *
 * 长表单里「基本信息 / 联系方式 / 附件」这类分组，折起来才看得过来。
 *
 * ## 不新增控件，增强内置的标题
 *
 * 设计方案 §5.3 明确「复用内置 title，增强为可折叠，不新增控件」。
 * 新增一个「折叠面板」控件的话，用户得先想清楚「我该用标题还是折叠面板」，
 * 而这两者在他眼里是同一件东西。
 *
 * ## 一个标题管到下一个标题
 *
 * 折叠的范围不是「标题的子节点」（内置标题没有子节点），而是
 * **它后面、下一个标题之前的所有同级控件**。这与用户在画布上看到的分组一致：
 * 标题就是一条分割线。
 *
 * ## 折叠时是「移出规则树」而不是「标为隐藏」
 *
 * 与渲染场景开关同样的理由：标为隐藏的字段仍在树里，联动的 SHOW、脚本的
 * setVisible 都能把它重新显示出来 —— 用户折起来的东西自己又冒出来了。
 */

import { SUB_TABLE_WIDGET_TYPE } from '@/components/FormWidgets/contracts'

/** 内置标题控件的类型 */
export const TITLE_WIDGET_TYPE = 'fcTitle'

/** 一个可折叠的分组 */
export interface CollapseGroup {
  /** 标题控件自身的 field，用作分组标识 */
  key: string
  /** 标题文字，仅用于排查 */
  title: string
  /** 归属这个分组的控件 field（不含标题自己） */
  members: string[]
  /** 默认是否折叠 */
  defaultCollapsed: boolean
}

const isCollapsibleTitle = (rule: any): boolean =>
  rule?.type === TITLE_WIDGET_TYPE && rule?.props?.collapsible === true && !!rule.field

/**
 * 收集可折叠分组
 *
 * 只在【同一层级】里划分组。标题放在栅格里再去管栅格外面的控件，
 * 是用户不会预期的行为 —— 他看到的是「这一列里的标题」。
 */
export const collectCollapseGroups = (rules: any[] | null | undefined): CollapseGroup[] => {
  const result: CollapseGroup[] = []
  const walkLevel = (list: any[] | null | undefined) => {
    if (!Array.isArray(list)) return
    let current: CollapseGroup | null = null
    for (const rule of list) {
      if (!rule || typeof rule !== 'object') continue
      if (rule.type === TITLE_WIDGET_TYPE) {
        // 遇到下一个标题就收口，无论它可不可折叠 ——
        // 不可折叠的标题同样是一条分割线
        current = isCollapsibleTitle(rule)
          ? {
              key: rule.field,
              title: rule.props?.title ?? rule.title ?? '',
              members: [],
              defaultCollapsed: rule.props?.defaultCollapsed === true
            }
          : null
        if (current) result.push(current)
        continue
      }
      if (current && rule.field) {
        current.members.push(rule.field)
      }
      // 往下一层继续找：布局容器里可以有自己的分组
      walkLevel(rule.children)
      if (rule.type === SUB_TABLE_WIDGET_TYPE) {
        walkLevel(rule.props?.rule)
      }
    }
  }
  walkLevel(rules)
  return result
}

/**
 * 折叠状态的本地记忆键
 *
 * 按「表单 + 标题」记，不按用户记 —— 折叠是个人的界面偏好，同一台机器上
 * 换个账号还保持上一个人的折叠状态，比重新展开更让人困惑的情况很少见，
 * 而按用户记要多一次取当前用户的依赖。
 */
export const collapseStorageKey = (formCode: string, groupKey: string): string =>
  `form-design:collapse:${formCode}:${groupKey}`

/**
 * 读折叠状态
 *
 * 读不到（没记过、localStorage 被禁用）时回落到分组自己的默认值。
 */
export const readCollapsed = (
  formCode: string,
  group: CollapseGroup
): boolean => {
  try {
    const stored = localStorage.getItem(collapseStorageKey(formCode, group.key))
    if (stored === '1') return true
    if (stored === '0') return false
  } catch {
    // 隐私模式下 localStorage 会抛异常。记不住折叠状态不影响填表
  }
  return group.defaultCollapsed
}

/** 记折叠状态。写失败不影响功能 */
export const writeCollapsed = (formCode: string, groupKey: string, collapsed: boolean): void => {
  try {
    localStorage.setItem(collapseStorageKey(formCode, groupKey), collapsed ? '1' : '0')
  } catch {
    // 同上
  }
}

/**
 * 按折叠状态过滤规则树
 *
 * @param rules     完整（或已按场景过滤过的）规则树
 * @param collapsed 已折叠的分组 key
 * @returns 过滤后的新树；被折叠分组的成员不在里面
 */
export const filterRulesByCollapse = (
  rules: any[] | null | undefined,
  collapsed: Set<string>
): any[] => {
  if (!Array.isArray(rules)) return []
  if (collapsed.size === 0) return rules

  const filterLevel = (list: any[]): any[] => {
    const out: any[] = []
    let hiddenBy: string | null = null
    for (const rule of list) {
      // 文本子节点（按钮 / 标签 / 文字 / 自定义 HTML 的文案）原样留下 ——
      // 它们是 form-create 的文本子节点而不是规则对象，被下面那句 continue 吃掉的话，
      // 表现是控件渲染出来了、里面却是空的。理由详见
      // renderScene.filterRulesByScene 里的同款说明。
      // 判断放在最前面，但仍尊重 hiddenBy：所属分组折起来时它跟着收起来
      if (typeof rule === 'string' || typeof rule === 'number') {
        if (!hiddenBy) out.push(rule)
        continue
      }
      if (!rule || typeof rule !== 'object') continue
      if (rule.type === TITLE_WIDGET_TYPE) {
        // 标题自己永远留着 —— 折起来之后总得有个地方点开
        hiddenBy = rule.field && collapsed.has(rule.field) ? rule.field : null
        out.push(rule)
        continue
      }
      if (hiddenBy) continue

      const children = Array.isArray(rule.children) ? filterLevel(rule.children) : undefined
      const nested =
        rule.type === SUB_TABLE_WIDGET_TYPE && Array.isArray(rule.props?.rule)
          ? filterLevel(rule.props.rule)
          : undefined
      if (!children && !nested) {
        out.push(rule)
        continue
      }
      const copy: any = { ...rule }
      if (children) copy.children = children
      if (nested) copy.props = { ...(rule.props ?? {}), rule: nested }
      out.push(copy)
    }
    return out
  }
  return filterLevel(rules)
}
