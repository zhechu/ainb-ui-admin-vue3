/**
 * 前端脚本的运行时
 *
 * 把设计器里配的四个钩子（onLoad / onFieldChange / beforeSubmit / afterSubmit）
 * 接到运行时表单上，脚本在 sandbox.ts 的受限作用域里执行。
 *
 * ## 它补的是什么
 *
 * B1 交付了沙箱、静态检查与脚本编辑器，但**运行时渲染页从没调过沙箱** ——
 * 而 `extension_mode` 的默认值恰恰就是「前端脚本」。也就是说在补上这一层之前，
 * **默认模式下用户写的脚本一次都不会执行**，且没有任何报错：
 * 设计器里能写、能静态检查、能保存，运行时静悄悄地什么也不做。
 *
 * ## 与服务端扩展点互斥
 *
 * 只有 `extensionMode === 1` 才执行脚本。这与服务端的
 * `FormDesignExtensionRegistry#willInvoke` 是同一套判断 ——
 * 两种扩展方式同时生效会让「这个字段到底是谁改的」无从追查。
 *
 * ## 脚本出错不中断填表
 *
 * onLoad / onFieldChange / afterSubmit 出错只记日志。一个写错的脚本不该让
 * 整张表单打不开 —— 那会把「脚本有 bug」升级成「业务停摆」。
 *
 * **beforeSubmit 是唯一的例外**：它的职责就是校验，校验本身崩了却放行，
 * 等于把校验当不存在。这条判断在 sandbox.ts 里，不在这里重复。
 */

import { runScript, runSubmitHook, type SandboxContext } from './sandbox'
import { formatDate } from '@/utils/formatTime'

/** 扩展模式：前端脚本 */
const MODE_FRONTEND_SCRIPT = 1
/** 提交钩子超时动作：1-阻断 2-放行 */
const TIMEOUT_ACTION_BLOCK = 1

export interface ScriptRuntimeOptions {
  /** 钩子名 → 脚本文本 */
  scripts: () => Record<string, string> | null | undefined
  /** 扩展模式。只有「前端脚本」才执行 */
  extensionMode: () => number | undefined
  /** beforeSubmit 超时动作：1-阻断 2-放行 */
  timeoutAction: () => number | undefined
  /** 表单数据 */
  formData: () => Record<string, any>
  /** form-create 的 api 实例 */
  api: () => any
  /** 提示服务。由调用方注入 —— 本模块不该决定用哪套 UI 组件 */
  message: {
    success: (text: string) => void
    warning: (text: string) => void
    error: (text: string) => void
    confirm: (text: string) => Promise<any>
  }
}

export const useScriptRuntime = (options: ScriptRuntimeOptions) => {
  /** 当前是否该执行脚本 */
  const isEnabled = (): boolean => options.extensionMode() === MODE_FRONTEND_SCRIPT

  const scriptOf = (hook: string): string | undefined => options.scripts()?.[hook]

  /**
   * 构造注入给脚本的受控上下文
   *
   * 改字段状态一律走 form-create 的 api，与联动运行时用的是同一组调用
   * （隐藏用 hidden 而不是 display —— display 的隐藏字段仍参与校验，
   * 会让表单永远提交不了）。两处如果各走各的，同一个字段会出现
   * 「脚本藏起来了但联动认为它还在」这种谁也说不清的状态。
   */
  const buildContext = (extra: Record<string, any> = {}): SandboxContext => {
    const api = options.api()
    return {
      // 只读快照：脚本改这个对象不会影响表单，改值必须走 setFieldValue。
      // 给它一份浅拷贝而不是直接给引用，是为了让「脚本里手滑改了 formData」
      // 这种写法失效得明显一点
      formData: { ...(options.formData() ?? {}) },
      setFieldValue: (field: string, value: any) => api?.setValue?.({ [field]: value }),
      getFieldValue: (field: string) => options.formData()?.[field],
      setVisible: (field: string, visible: boolean) => api?.hidden?.(!visible, field),
      setRequired: (field: string, required: boolean) =>
        api?.updateRule?.(field, { $required: !!required }),
      setDisabled: (field: string, disabled: boolean) => api?.disabled?.(!!disabled, field),
      message: {
        success: (text: string) => options.message.success(text),
        warning: (text: string) => options.message.warning(text),
        error: (text: string) => options.message.error(text),
        // confirm 返回 Promise<boolean>：用户点取消时 ElMessageBox 是 reject 的，
        // 直接把它交给脚本会变成一个未捕获的 rejection，
        // 而脚本作者预期的是「返回 false」
        confirm: (text: string) =>
          options.message.confirm(text).then(
            () => true,
            () => false
          )
      },
      utils: {
        formatDate: (value: any, pattern?: string) =>
          value ? formatDate(value, pattern ?? 'YYYY-MM-DD HH:mm:ss') ?? '' : '',
        formatMoney: (value: any, decimals = 2) => {
          const num = Number(value)
          return Number.isFinite(num) ? num.toFixed(decimals) : ''
        },
        // 不用 crypto.randomUUID：沙箱里取不到 crypto，而 utils 是我们在外面
        // 造好再注入的，这里生成即可
        uuid: () =>
          'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
          })
      },
      ...extra
    } as SandboxContext
  }

  /** 表单打开、数据填充完成后执行一次 */
  const runOnLoad = () => {
    if (!isEnabled()) return
    runScript(scriptOf('onLoad'), buildContext())
  }

  /**
   * 字段值变化时执行
   *
   * @param changedField 变化的字段名。脚本里以裸标识符 changedField 使用
   */
  const runOnFieldChange = (changedField: string) => {
    if (!isEnabled()) return
    const source = scriptOf('onFieldChange')
    // 提前判空：没配这个钩子时不必构造上下文（每次输入都会走到这里）
    if (!source || !source.trim()) return
    runScript(source, buildContext({ changedField }))
  }

  /**
   * 提交前执行
   *
   * @returns 是否放行提交
   */
  const runBeforeSubmit = async (): Promise<boolean> => {
    if (!isEnabled()) return true
    const source = scriptOf('beforeSubmit')
    if (!source || !source.trim()) return true
    const action = options.timeoutAction() === TIMEOUT_ACTION_BLOCK ? 'BLOCK' : 'PASS'
    const result = await runSubmitHook(source, buildContext(), action)
    return result.value !== false
  }

  /** 提交成功后执行 */
  const runAfterSubmit = () => {
    if (!isEnabled()) return
    runScript(scriptOf('afterSubmit'), buildContext())
  }

  return { isEnabled, runOnLoad, runOnFieldChange, runBeforeSubmit, runAfterSubmit }
}
