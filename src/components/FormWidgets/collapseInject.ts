import type { InjectionKey } from 'vue'

/**
 * 折叠控制的注入约定
 *
 * 渲染页 provide、标题上的折叠开关 inject。
 *
 * 单独一个文件而不是写在组件里：provide 与 inject 分别在两个文件，
 * key 放在其中任一边都会让另一边反向 import 一个组件，
 * 而 key 只是一个约定，不该拖着组件一起被加载。
 */
export interface CollapseControl {
  /** 某个分组当前是否折叠 */
  isCollapsed: (groupKey: string) => boolean
  /** 切换折叠状态 */
  toggle: (groupKey: string) => void
}

export const COLLAPSE_CONTROL: InjectionKey<CollapseControl> = Symbol('formCollapseControl')
