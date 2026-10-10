/**
 * 列表操作列按钮的纯逻辑部分
 *
 * 单独一个 .ts 而不是写进 TableActions.vue，是为了能在 vitest 的 node 环境里测：
 * 本工程 devDependencies 里没有 jsdom / @vue/test-utils，组件本身渲染不了。
 * 因此这里刻意不 import checkPermi —— 权限谓词由 .vue 注入进来。
 */

/** 行级取值：可以是常量，也可以是拿行数据现算的函数 */
export type RowValue<T> = T | ((row: any) => T)

export interface TableActionButton {
  /** v-for 的 key。折叠后必须稳定，不要用数组下标 */
  key: string
  /**
   * 按钮文字。给函数是为了支持「同一位置按行改文案」，
   * 例如工作流列表的设计按钮：可编辑时叫「设计」、否则叫「查看设计」
   */
  label: RowValue<string>
  /** 给了就渲染，行内与下拉里都渲染 */
  icon?: string
  /** 缺省 primary */
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  /**
   * 权限串，任一命中即显示。
   *
   * ⚠️ 不传 / 空数组 = 不门控（永远显示），不是「谁都不能看」。
   * checkPermi([]) 对超管返回 true、对普通用户返回 false（hasPermi.ts 里 *:*:* 的短路
   * 在 .some() 之前），语义不稳定，所以这里显式跳过而不是交给它。
   */
  permission?: string[]
  /** 行级显示条件，等价于模板里的 v-if */
  show?: (row: any) => boolean
  disabled?: RowValue<boolean>
  loading?: RowValue<boolean>
  /** 收进「更多」后在该项之前画分隔线 */
  divided?: boolean
  onClick: (row: any) => void
}

/**
 * 过滤出这一行当前可见的按钮
 *
 * @param can 权限谓词，由组件注入 checkPermi（见 TableActionButton#permission 的空数组说明）
 */
export const resolveVisibleButtons = <T extends Pick<TableActionButton, 'permission' | 'show'>>(
  buttons: readonly T[],
  row: any,
  can: (permission: string[]) => boolean
): T[] =>
  buttons.filter((button) => {
    if (button.show && !button.show(row)) {
      return false
    }
    if (!button.permission || button.permission.length === 0) {
      return true
    }
    return can(button.permission)
  })

/** 把 RowValue 求值成实际值；未传时用 fallback */
export const resolveRowValue = <T>(value: RowValue<T> | undefined, row: any, fallback: T): T => {
  if (value === undefined) {
    return fallback
  }
  return typeof value === 'function' ? (value as (row: any) => T)(row) : (value as T)
}

/**
 * 严格折叠：超过 maxInline 个就把多出来的收进「更多」
 *
 * ⚠️ 与 listButton.ts 的 splitInlineButtons 规则不同（那边是 length <= limit + 1 全平铺，
 *    即 4 个按钮不折、5 个才折）。不复用它是刻意的：改它会动到所有已发布表单的操作列行为
 *    并打破它的单测，属于需要单独审批的业务逻辑改动。
 */
export const splitButtons = <T>(
  buttons: readonly T[],
  maxInline: number
): { inline: T[]; folded: T[] } =>
  buttons.length <= maxInline
    ? { inline: [...buttons], folded: [] as T[] }
    : { inline: buttons.slice(0, maxInline), folded: buttons.slice(maxInline) }
