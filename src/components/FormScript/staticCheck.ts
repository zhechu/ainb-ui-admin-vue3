/**
 * 前端脚本的静态检查
 *
 * 保存时校验，命中即阻断保存。
 *
 * ## 为什么静态检查这么重要
 *
 * 本阶段脚本编辑权限是放开的（能设计表单即能写脚本），所以静态检查与变更审计
 * 是仅存的两道自动约束。这里【不能留后门】—— 没有「跳过校验」的开关，
 * 也不接受调用方传参关闭某条规则。
 *
 * ## 与沙箱的关系：双重兜底，各自独立
 *
 * 沙箱在运行时屏蔽全局对象，静态检查在保存时拒绝可疑写法。两者都能单独拦住大部分情况，
 * 但都不完备：
 * - 静态检查是文本匹配，理论上能被动态拼接绕过（`window` 拼成 `wi'+'ndow`）
 * - 沙箱屏蔽的是标识符访问，拦不住「把脚本存进库、等下次某个不带沙箱的地方去执行」
 *
 * 所以两道都要有，而且要各自独立断言（见 script-sandbox.spec.ts）。
 */

/** 一条检查结果 */
export interface ScriptCheckIssue {
  /** 命中的模式 */
  pattern: string
  /** 说明为什么禁止 */
  reason: string
  /** 命中位置的行号，从 1 开始 */
  line: number
  /** 该行内容，便于用户定位 */
  lineText: string
}

/** 静态检查的结果 */
export interface ScriptCheckResult {
  passed: boolean
  issues: ScriptCheckIssue[]
}

interface ForbiddenRule {
  /** 匹配用的正则。必须带 g 标志以便逐个定位 */
  pattern: RegExp
  /** 展示给用户的模式名 */
  label: string
  reason: string
}

/**
 * 禁止清单
 *
 * 分三类：
 * 1. 动态求值 —— 绕过沙箱最直接的办法
 * 2. 网络访问 —— 脚本不得发起任何后端调用，需要后端参与的逻辑走服务端扩展点
 * 3. 原型链与宿主对象 —— 逃逸沙箱的常见路径
 *
 * ⚠️ 用词边界要小心：这些规则是文本匹配，写得太宽会拦掉正常代码。
 * 例如不能直接禁 `constructor`（正常对象也有），只能禁 `constructor.constructor`
 * 这种明确的逃逸写法。
 */
const FORBIDDEN_RULES: ForbiddenRule[] = [
  // ===== 动态求值 =====
  {
    pattern: /\beval\s*\(/g,
    label: 'eval(',
    reason: '动态求值会绕过沙箱的标识符屏蔽，等于把整个宿主环境暴露出来'
  },
  {
    pattern: /\bnew\s+Function\b|\bFunction\s*\(/g,
    label: 'Function 构造器',
    reason: 'Function 构造器等价于 eval，能拿到全局作用域'
  },
  {
    pattern: /\bimport\s*\(/g,
    label: 'import(',
    reason: '动态导入能加载任意模块，绕开沙箱注入的受限上下文'
  },
  {
    pattern: /\brequire\s*\(/g,
    label: 'require(',
    reason: '同上'
  },
  // ===== 网络访问。脚本沙箱不提供任何后端调用能力 =====
  {
    pattern: /\bfetch\s*\(/g,
    label: 'fetch(',
    reason: '脚本不得发起网络请求。需要后端参与的逻辑请把表单的扩展模式切换为「服务端扩展点」'
  },
  {
    pattern: /\bXMLHttpRequest\b/g,
    label: 'XMLHttpRequest',
    reason: '同上'
  },
  {
    pattern: /\bWebSocket\b/g,
    label: 'WebSocket',
    reason: '同上'
  },
  {
    pattern: /\bEventSource\b/g,
    label: 'EventSource',
    reason: '同上'
  },
  {
    pattern: /\bsendBeacon\b/g,
    label: 'navigator.sendBeacon',
    reason: '同上。这是一条容易被忽略的外传通道'
  },
  {
    pattern: /\bnew\s+Image\b/g,
    label: 'new Image',
    reason: '通过图片 src 也能把数据发出去，属于外传通道'
  },
  // ===== 原型链与宿主对象 =====
  {
    pattern: /__proto__/g,
    label: '__proto__',
    reason: '原型链污染能改掉沙箱依赖的内建行为'
  },
  {
    pattern: /\bconstructor\s*(\.|\[)\s*['"]?constructor/g,
    label: 'constructor.constructor',
    reason: '这是从任意对象拿到 Function 构造器的经典逃逸写法'
  },
  {
    pattern: /\bdocument\s*\.\s*write\b/g,
    label: 'document.write',
    reason: '直接写文档流，等同于注入任意 HTML'
  },
  {
    pattern: /\b(inner|outer)HTML\b/g,
    label: 'innerHTML / outerHTML',
    reason: '直接写 HTML 是 XSS 通道。要改界面请通过受控上下文 API'
  },
  {
    pattern: /\bprocess\s*\./g,
    label: 'process.',
    reason: '宿主进程对象不属于表单脚本的能力范围'
  },
  {
    pattern: /\bDeno\b/g,
    label: 'Deno',
    reason: '同上'
  },
  {
    pattern: /\blocalStorage\b|\bsessionStorage\b/g,
    label: 'localStorage / sessionStorage',
    reason: '本地存储里有登录令牌，脚本不应触碰'
  },
  {
    pattern: /\bdocument\s*\.\s*cookie\b/g,
    label: 'document.cookie',
    reason: 'Cookie 里有会话凭据，脚本不应触碰'
  }
]

/**
 * 需要剥掉再检查的部分
 *
 * 注释与字符串里出现禁止词是正常的 —— 用户很可能在注释里写
 * 「这里不要用 fetch，请改服务端扩展点」，那不该被拦。
 * 但要注意：剥掉字符串也意味着字符串拼接绕过（'wi'+'ndow'）检查不到，
 * 这一层由沙箱兜住，两道防线各管一段。
 */
const stripCommentsAndStrings = (source: string): string => {
  let result = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    // 行注释
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        // 保留换行，行号才不会错位
        i++
      }
      continue
    }
    // 块注释
    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        // 块注释里的换行要保留，否则后续命中的行号会偏
        result += source[i] === '\n' ? '\n' : ' '
        i++
      }
      i += 2
      continue
    }
    // 字符串与模板串
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i++
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          i++
        }
        result += source[i] === '\n' ? '\n' : ' '
        i++
      }
      i++
      continue
    }
    result += ch
    i++
  }
  return result
}

/**
 * 对一段脚本做静态检查
 *
 * @param source 脚本文本
 * @returns 检查结果。passed 为 false 时不允许保存
 */
export const checkScript = (source: string | null | undefined): ScriptCheckResult => {
  if (!source || !source.trim()) {
    return { passed: true, issues: [] }
  }
  const stripped = stripCommentsAndStrings(source)
  const originalLines = source.split('\n')
  const issues: ScriptCheckIssue[] = []

  for (const rule of FORBIDDEN_RULES) {
    // 每次都重置 lastIndex：正则带 g 标志且被复用，不重置会漏匹配
    rule.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.pattern.exec(stripped)) !== null) {
      const line = stripped.slice(0, match.index).split('\n').length
      issues.push({
        pattern: rule.label,
        reason: rule.reason,
        line,
        lineText: (originalLines[line - 1] ?? '').trim()
      })
      // 零长度匹配会死循环，强制推进
      if (match.index === rule.pattern.lastIndex) {
        rule.pattern.lastIndex++
      }
    }
  }

  issues.sort((a, b) => a.line - b.line)
  return { passed: issues.length === 0, issues }
}

/**
 * 检查一整份脚本配置（钩子名 → 脚本文本）
 *
 * @returns 钩子名 → 该钩子的检查结果，只包含有问题的钩子
 */
export const checkScriptBundle = (
  scripts: Record<string, string> | null | undefined
): Record<string, ScriptCheckResult> => {
  const result: Record<string, ScriptCheckResult> = {}
  if (!scripts) {
    return result
  }
  for (const [hook, source] of Object.entries(scripts)) {
    const checked = checkScript(source)
    if (!checked.passed) {
      result[hook] = checked
    }
  }
  return result
}

/**
 * 检查脚本是否给公式字段赋值
 *
 * 公式字段的值由后端权威重算，脚本改了会被无声覆盖。不在保存时拦住，
 * 实施期必然出现「脚本里改了值，保存后又变回去」这类查不明白的问题。
 *
 * 公式控件在 B2 批次引入，此处先把检查点建好 —— 传空清单时是空操作。
 *
 * @param source        脚本文本
 * @param formulaFields 公式字段清单
 */
export const checkFormulaFieldAssignment = (
  source: string | null | undefined,
  formulaFields: string[]
): ScriptCheckIssue[] => {
  if (!source || formulaFields.length === 0) {
    return []
  }
  const issues: ScriptCheckIssue[] = []
  const lines = source.split('\n')
  for (const field of formulaFields) {
    // 匹配 setFieldValue('该字段' 或 setFieldValue("该字段"
    const pattern = new RegExp(
      `setFieldValue\\s*\\(\\s*['"\`]${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`,
      'g'
    )
    lines.forEach((text, idx) => {
      pattern.lastIndex = 0
      if (pattern.test(text)) {
        issues.push({
          pattern: `setFieldValue('${field}')`,
          reason: `字段「${field}」由公式计算，值在提交时由服务端权威重算，脚本的赋值会被覆盖。请改公式，或把该字段改成普通字段`,
          line: idx + 1,
          lineText: text.trim()
        })
      }
    })
  }
  return issues
}
