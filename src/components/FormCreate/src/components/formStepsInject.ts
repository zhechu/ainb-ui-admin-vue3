import type { ComputedRef, InjectionKey, Ref } from 'vue'

/**
 * 步骤条容器与步骤之间的注入契约
 *
 * 单独一个文件而不是写在 FormSteps.vue 里：两个组件互相引用对方的 .vue 会
 * 形成循环导入，Vite 下的表现是其中一个组件在运行时变成 undefined，
 * 而报错信息指向渲染函数，很难反推到导入环上。
 */

/** 一个已注册的步骤 */
export interface StepEntry {
  /** 注册序号，用来在数组里稳定定位自己（下标会随增删变化，不能拿来当身份） */
  id: number
  /** 步骤标题，展示在头部 */
  title: string
  /** 这一步里的字段，分步校验时校验它们 */
  fields: string[]
}

/** 子步骤注册后拿到的句柄 */
export interface StepHandle {
  /** 本步骤的下标，随前面步骤的增删而变 */
  index: ComputedRef<number>
  /** 标题或字段变了时同步过去 */
  update(patch: Partial<StepEntry>): void
  /** 卸载时摘掉自己 */
  unregister(): void
}

/** 容器提供给步骤的上下文 */
export interface StepsContext {
  /** 当前在第几步 */
  active: Ref<number>
  register(entry: Omit<StepEntry, 'id'>): StepHandle
}

export const STEPS_INJECT_KEY: InjectionKey<StepsContext> = Symbol('formSteps')
