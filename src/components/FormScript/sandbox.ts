/**
 * 前端脚本沙箱
 *
 * 在受限作用域里执行用户脚本，只暴露一份白名单上下文 API。
 *
 * ## 屏蔽原理
 *
 * 用 `new Function` 构造函数体，外层包 `with(proxy)`。proxy 的 `has` 陷阱对
 * 【所有】未白名单的标识符返回 true，于是 `window`、`fetch` 这些名字都会被
 * `with` 认为「在这个作用域里」，从而不会继续往上查全局作用域；`get` 陷阱返回
 * undefined。效果是脚本里写 `window` 拿到的是 undefined，而不是真的 window。
 *
 * 这比「删掉几个全局变量」可靠得多 —— 后者永远列不全（globalThis、top、parent、
 * self、frames、以及各种浏览器新增的对象）。
 *
 * ## 明确不提供的能力
 *
 * 没有任何后端调用入口。没有 callDataInterface，也拿不到 fetch / XHR / WebSocket。
 * 脚本只能操作已经在浏览器里的数据。需要查库、调外部系统、做服务端校验的场景，
 * 一律把表单的扩展模式切到「服务端扩展点」。
 *
 * 这既是安全收敛（沙箱上最大的口子直接封掉），也是职责划分 ——
 * 避免「前端脚本里发请求改数据」这类既绕过服务端校验、又无法审计的用法在过渡期扎根。
 *
 * ## 与静态检查的关系
 *
 * 静态检查在保存时拒绝可疑写法，沙箱在运行时屏蔽全局对象。两道各管一段：
 * 静态检查拦不住字符串拼接绕过，沙箱拦不住「脚本被存进库、在别处被执行」。
 * 所以两道都要有，测试里也各自独立断言。
 */

/** 沙箱注入给脚本的受控上下文 */
export interface SandboxContext {
  /** 表单数据的只读快照。脱敏字段拿到的是脱敏值 */
  formData: Record<string, any>
  /**
   * 本次变化的字段名。仅 onFieldChange 钩子有值
   *
   * 脚本里以裸标识符使用：`if (changedField === 'amount') { ... }`。
   * 沙箱代理是按「上下文对象里有没有这个键」放行的，所以这里必须声明 ——
   * 少了它，注入方为了类型通过会去 as any，而 as any 之后
   * 拼错键名（changeField）就不会有任何提示了。
   */
  changedField?: string
  /** 子表行内脚本可用的行号 */
  rowIndex?: number
  setFieldValue: (field: string, value: any) => void
  getFieldValue: (field: string) => any
  setVisible: (field: string, visible: boolean) => void
  setRequired: (field: string, required: boolean) => void
  setDisabled: (field: string, disabled: boolean) => void
  message: {
    success: (text: string) => void
    warning: (text: string) => void
    error: (text: string) => void
    /** 二次确认，返回 Promise<boolean>。beforeSubmit 里常用 */
    confirm: (text: string) => Promise<boolean>
  }
  /** 白名单纯函数工具 */
  utils: {
    formatDate: (value: any, pattern?: string) => string
    formatMoney: (value: any, decimals?: number) => string
    uuid: () => string
  }
}

/** 执行结果 */
export interface SandboxResult<T = any> {
  /** 是否正常结束 */
  ok: boolean
  /** 返回值 */
  value?: T
  /** 出错时的错误对象 */
  error?: Error
  /** 是否因超时而结束 */
  timedOut?: boolean
  /** 同步执行耗时（毫秒） */
  elapsed: number
}

/**
 * 同步钩子的耗时告警阈值
 *
 * 超过只记警告、不中断 —— JS 是单线程的，同步代码一旦开始跑就没法从外部打断，
 * 设成「超时中断」是做不到的事。能做的是让它显眼，便于定位是哪个钩子在卡界面。
 */
export const SYNC_WARN_THRESHOLD_MS = 200

/** beforeSubmit 的默认超时（毫秒） */
export const SUBMIT_HOOK_TIMEOUT_MS = 10_000

/**
 * 允许脚本访问的标识符
 *
 * 除了注入的上下文键，还要放开一批语言内建对象 —— 全屏蔽的话连
 * `JSON.stringify`、`Math.max`、`new Date()` 都不能用，脚本基本没法写。
 *
 * 这份清单是有意保守的：只含纯计算类内建，不含任何能触达宿主环境的东西。
 * 特别注意【没有】Function、eval、Reflect、Proxy —— 它们能反射出宿主对象。
 */
const ALLOWED_GLOBALS = new Set([
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Math',
  'JSON',
  'Date',
  'RegExp',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Symbol',
  'BigInt',
  'Error',
  'TypeError',
  'RangeError',
  'isNaN',
  'isFinite',
  'parseInt',
  'parseFloat',
  'decodeURIComponent',
  'encodeURIComponent',
  'undefined',
  'NaN',
  'Infinity',
  // 脚本体里会用到的语法性标识符
  'arguments'
])

/**
 * 构造沙箱作用域代理
 *
 * has 陷阱【一律返回 true】：让 `with` 认为任何标识符都存在于本作用域，
 * 从而绝不向全局作用域查找。放行与屏蔽的区分全部落在 get 上 ——
 * 这样只有一处判断，不会出现「has 说有、get 说没有」的错配。
 */
const createScopeProxy = (context: Record<string, any>): Record<string, any> => {
  return new Proxy(
    { ...context },
    {
      has() {
        // 永远声明「这个名字在本作用域里」，阻止 with 向上查找全局
        return true
      },
      get(target, key) {
        if (typeof key === 'symbol') {
          return undefined
        }
        const name = key as string
        if (name in target) {
          return target[name]
        }
        if (ALLOWED_GLOBALS.has(name)) {
          // 白名单内建从真实全局取
          return (globalThis as any)[name]
        }
        // 被屏蔽的标识符统一返回 undefined，而不是抛错 ——
        // 抛错会让脚本里一句无害的特性探测（typeof window !== 'undefined'）直接崩掉
        return undefined
      },
      set(target, key, value) {
        // 脚本内的赋值只落在沙箱副本上，不会污染真实全局
        target[key as string] = value
        return true
      }
    }
  )
}

/**
 * 编译一段脚本
 *
 * 脚本体是【语句块】，受控上下文以裸标识符的形式直接可用（靠 with 注入）：
 *
 * ```js
 * if (formData.amount > 10000) {
 *   setRequired('reason', true)
 * }
 * ```
 *
 * 不采用 `({ formData }) => {...}` 的箭头函数写法：那需要先把脚本当表达式求值
 * 再调用，多一层约定，而 with 注入已经让上下文直接可用了。
 */
const compile = (source: string): ((scope: Record<string, any>) => any) => {
  // ⚠️ 'use strict' 必须放在【内层】函数里，不能放在最外层。
  // with 语句在严格模式下是语法错误，外层加了 'use strict' 会让整段脚本编译失败
  // （表现为所有脚本一律报 SyntaxError，很容易误判成用户脚本写错了）。
  //
  // 内层函数自身不含 with，声明严格模式是合法的；而标识符查找是词法的，
  // 外层的 with 作用域仍在作用域链上，屏蔽照常生效。
  // 这样既拿到了严格模式（阻断 arguments.callee 一类逃逸），又保住了 with 注入。
  const body = `
    with (__scope__) {
      return (function () {
        'use strict';
        ${source}
      })();
    }
  `
  // eslint-disable-next-line no-new-func -- 沙箱的实现本身必须用它；
  // 这是全仓库唯一允许出现动态脚本执行的地方，见设计方案验收标准第 10 条
  const factory = new Function('__scope__', body)
  return (scope: Record<string, any>) => factory(scope)
}

/**
 * 同步执行一段脚本
 *
 * @param source  脚本文本
 * @param context 注入的受控上下文
 */
export const runScript = <T = any>(
  source: string | null | undefined,
  context: SandboxContext
): SandboxResult<T> => {
  const started = Date.now()
  if (!source || !source.trim()) {
    return { ok: true, elapsed: 0 }
  }
  try {
    const scope = createScopeProxy(context as unknown as Record<string, any>)
    const value = compile(source)(scope)
    const elapsed = Date.now() - started
    if (elapsed > SYNC_WARN_THRESHOLD_MS) {
      console.warn(
        `[FormScript] 同步钩子执行耗时 ${elapsed}ms，超过 ${SYNC_WARN_THRESHOLD_MS}ms 阈值，可能卡住界面`
      )
    }
    return { ok: true, value, elapsed }
  } catch (e) {
    // 异常隔离：脚本报错不得中断表单渲染。上报到控制台，由调用方决定是否提示用户
    const error = e instanceof Error ? e : new Error(String(e))
    console.error('[FormScript] 脚本执行出错', error)
    return { ok: false, error, elapsed: Date.now() - started }
  }
}

/**
 * 执行 beforeSubmit 钩子，带超时
 *
 * @param source        脚本文本
 * @param context       受控上下文
 * @param timeoutAction 超时后的动作。'BLOCK' 阻断提交，'PASS' 放行并记警告
 * @param timeoutMs     超时阈值
 */
export const runSubmitHook = async (
  source: string | null | undefined,
  context: SandboxContext,
  timeoutAction: 'BLOCK' | 'PASS' = 'BLOCK',
  timeoutMs: number = SUBMIT_HOOK_TIMEOUT_MS
): Promise<SandboxResult<boolean>> => {
  const started = Date.now()
  if (!source || !source.trim()) {
    return { ok: true, value: true, elapsed: 0 }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<'__timeout__'>((resolve) => {
    timer = setTimeout(() => resolve('__timeout__'), timeoutMs)
  })

  try {
    const scope = createScopeProxy(context as unknown as Record<string, any>)
    const scriptPromise = Promise.resolve(compile(source)(scope))
    const raced = await Promise.race([scriptPromise, timeoutPromise])

    if (raced === '__timeout__') {
      // 超时行为由表单属性决定。默认 BLOCK 的理由：beforeSubmit 的典型用途是
      // 提交前校验，超时即「校验没跑完」，放行等于静默跳过校验
      const blocked = timeoutAction === 'BLOCK'
      console.warn(
        `[FormScript] beforeSubmit 在 ${timeoutMs}ms 内未完成，按「${blocked ? '阻断提交' : '放行'}」处理`
      )
      return { ok: !blocked, value: !blocked, timedOut: true, elapsed: Date.now() - started }
    }
    // 脚本 reject 或返回 false 都视为阻断
    return { ok: true, value: raced !== false, elapsed: Date.now() - started }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    console.error('[FormScript] beforeSubmit 执行出错，按阻断处理', error)
    // beforeSubmit 是唯一「出错即阻断」的钩子：它的职责就是校验，
    // 校验本身崩了却放行，等于把校验当不存在
    return { ok: false, error, value: false, elapsed: Date.now() - started }
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
