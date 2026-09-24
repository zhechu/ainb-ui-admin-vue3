import { watch, type App, type Ref } from 'vue'

/**
 * FcDesigner 的按需加载入口
 *
 * 为什么要拆出来：改造前 `plugins/formCreate/index.ts` 顶层 `import FcDesigner from '@form-create/designer'`
 * 并 `app.use(FcDesigner)`，导致 vendored 的 form-designer（约 926KB 源码，含 FcDesigner.vue 2515 行 +
 * 全部 rule/config/menu）随首屏一起下载并执行 —— 而全站只有 3 个页面真的会渲染 `<fc-designer>`。
 *
 * 现在的做法：`setupFormCreate` 只装 form-create 运行时与自定义控件；设计器改由使用它的页面
 * 在挂载前调 `ensureFcDesigner(app)` 触发一次动态 import + `app.use`。
 *
 * Promise 单例保证：
 * - 多个页面同时打开也只下载一次
 * - 同一个页面热更新反复调用不会重复 `app.use`（重复注册会让 Vue 报 warning）
 */
let promise: Promise<void> | null = null

export const ensureFcDesigner = (app: App<Element>): Promise<void> => {
  if (!promise) {
    promise = import('@form-create/designer').then((mod) => {
      app.use(mod.default)
    })
  }
  return promise
}

/**
 * 等到 `<fc-designer>` 真正渲染出来（designer ref 就绪）
 *
 * 为什么需要：FcDesigner 改成按需加载后，页面用 `v-if="designerReady"` 门控它，
 * designerReady 要等 `ensureFcDesigner` 的动态 import 完成才置真。而「回显已保存的
 * 设计」往往由数据到达触发（loadData / getForm），数据可能比 chunk 先到。此时
 * designer.value 还是 null，`setConfAndFields` 会对 null 调 setOption 直接抛错，
 * 且回显是一次性的（useStepRestore 置了 restored 就不再重试）—— 设计区永远空白。
 *
 * 所以在动 designer 之前先 await 这个：designer 已就绪则立即返回，否则挂一个 watch
 * 等它出现。数据先到、设计器后到的竞态就此消除。
 */
export const whenDesignerReady = (designer: Ref<any>): Promise<void> =>
  new Promise((resolve) => {
    if (designer.value) {
      resolve()
      return
    }
    const stop = watch(designer, (instance) => {
      if (instance) {
        stop()
        resolve()
      }
    })
  })
