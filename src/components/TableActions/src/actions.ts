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
  /**
   * 按钮配色，缺省 primary。
   *
   * ⚠️ 只作用于行内按钮。收进「更多」的项一律是纯文字，不染红也不带图标 ——
   *    这是标杆页 infra/formDesign 的下拉写法，染色会让全站出现两种「更多」。
   *    删除项要在下拉里被认出来，靠 divided。
   */
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
 * 按阈值把按钮拆成「直接显示」与「收进更多」两组
 *
 * ⚠️ 只差一个时不折叠：四个按钮、阈值三 —— 折叠的话是「三个按钮 + 一个下拉」，
 *    占的宽度反而比四个按钮还多，而且多一次点击。必须真的省下位置才值得折。
 *    规则与 listButton.ts 的 splitInlineButtons 一致（动态渲染器的行按钮也走这条），
 *    不复用那个函数是因为它带 normalizeMaxInline —— 那里的阈值来自用户配置、可能是脏值，
 *    这里的阈值来自代码里的 prop，默认值已经保证合法。
 */
export const splitButtons = <T>(
  buttons: readonly T[],
  maxInline: number
): { inline: T[]; folded: T[] } =>
  buttons.length <= maxInline + 1
    ? { inline: [...buttons], folded: [] as T[] }
    : { inline: buttons.slice(0, maxInline), folded: buttons.slice(maxInline) }
