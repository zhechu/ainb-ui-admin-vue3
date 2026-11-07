import type { QlzgCaseSourceSaveVO, QlzgCaseSourceVO } from '@/api/qlzg/caseSource'

/**
 * 案例数据来源表单的**全部判定逻辑**
 *
 * <h3>🔴 为什么单独一个纯模块，而不是写在 {@code CaseSourceForm.vue} 里</h3>
 * 本仓 vitest 是 {@code environment: 'node'}（没有 jsdom、没有 {@code @vue/test-utils}），
 * 任何值导入 {@code @/config/axios} 的模块在收集阶段就死在 {@code window is not defined} ——
 * 所以 {@code .vue} 文件在这里**一个测试都跑不了**。
 * 逻辑放这儿、组件只做渲染，是 qlzg 前端唯一能被守住形状的办法（{@code caseSchema.ts} 同理）。
 * 🔴 本文件只允许 {@code import type}：值导入那个 api 模块就等于把 axios 拖进来。
 *
 * <h3>🔴 这里钉的三件事，每一件在后端都有一份对应物</h3>
 * <ol>
 *   <li><b>来源码的字面与不可改</b> ← {@code QlzgCaseSourceServiceImpl#normalizeCode}
 *       与 {@code #updateCaseSource} 的改码拒绝。码是<b>跨表用裸 varchar 引用</b>的
 *       （导入模板的「数据源」列填码不填 id，因为 id 每个环境都不一样），
 *       改了码，已发出去的模板全部报「数据源不存在」，
 *       而用户对着一个看起来一模一样的码排查不出原因。</li>
 *   <li><b>{@code licenseScope} 的空形状</b> ← {@code QlzgCaseSourceServiceImpl} 里那句
 *       「空 Map 与 null 是同一个意思，统一存 NULL」。少认一种空形状的后果是
 *       「明明没签授权，却被闸 G-10 判成有授权范围」。</li>
 *   <li><b>{@code apiInterfaceId} 跟着性质走</b> ← {@code #validateSourceType} 的返回值。
 *       非第三方接口的三种性质一律不带接口编号，否则 I15 的同步任务会去调一个不该调的接口。</li>
 * </ol>
 *
 * <h3>⚠️ 刻意【没有】的东西</h3>
 * <ul>
 *   <li><b>没有 {@code updateFrequency} 的下拉常量</b>：这一列后端<b>只存不判</b>
 *       （「判定规则要先有真实的更新失败数据才写得准」），既没有枚举也没有消费方。
 *       在前端造一份 {@code DAILY / WEEKLY / MONTHLY} 的建议值，
 *       下一个人会把它当成枚举来钉，于是一个不存在的约束就有了两份拷贝。</li>
 *   <li><b>没有各列的长度校验</b>：{@code @Size} 在后端，
 *       而输入框上有 {@code maxlength} + {@code show-word-limit}。
 *       在这里再抄一份 64 / 128 / 500，改列宽时要同时改三处，漏一处就前后不一致。</li>
 * </ul>
 */

/**
 * 来源码的字面 ← 后端 {@code SOURCE_CODE_PATTERN}（{@code ^[A-Z0-9_]{1,64}$}）的副本
 *
 * 🔴 不含小写字母：{@link normalizeSourceCode} 会先转大写，
 *    正则里写小写只会造成「转大写之前先按小写校验」这种顺序依赖
 */
export const SOURCE_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/

/**
 * 归一化来源码：去首尾空白 + 转大写
 *
 * 🔴 用 {@code toUpperCase()} 而<b>不是</b> {@code toLocaleUpperCase()}：
 *    前者按 Unicode 默认大小写映射、与运行环境的语言无关，后者跟着浏览器语言走 ——
 *    土耳其语下 {@code i} 会变成 {@code U+0130}（带点的 İ）而不是 {@code I}，
 *    于是 {@code ali_auction} 在一个土耳其语浏览器上存成另一个码，
 *    导入模板匹配不上，报错只会说「数据源不存在」。
 *    后端那一侧同样钉了 {@code Locale.ROOT}，两边必须是同一个口径
 */
export const normalizeSourceCode = (raw?: string | null): string =>
  (raw ?? '').trim().toUpperCase()

/** 表单模型。🔴 {@code licenseScopeText} 是文本框里的**原文**，不是对象 */
export interface QlzgCaseSourceFormModel {
  id?: number
  sourceCode: string
  sourceName: string
  sourceType: string
  apiInterfaceId?: number | null
  originUrlPattern: string
  attributionRequired: string
  licenseScopeText: string
  updateFrequency: string
  /** 0 停用 / 1 启用。🔴 数字不是字符串，理由见 constants.ts 里那份状态常量 */
  status: number
}

export const emptySourceForm = (): QlzgCaseSourceFormModel => ({
  id: undefined,
  sourceCode: '',
  sourceName: '',
  sourceType: 'PUBLIC_DISCLOSURE',
  apiInterfaceId: null,
  originUrlPattern: '',
  attributionRequired: '',
  licenseScopeText: '',
  updateFrequency: '',
  status: 1
})

/**
 * 来源码这一栏的问题
 *
 * @param originalCode 编辑态下库里的原码；新增态传 {@code undefined}
 */
export const sourceCodeIssue = (
  raw: string,
  originalCode?: string
): string | null => {
  const code = normalizeSourceCode(raw)
  if (!code) return '来源码不能为空'
  if (originalCode !== undefined) {
    // 🔴 界面上这一栏在编辑态是 disabled 的，所以正常点不出这条。
    //    仍然判它：disabled 只是不渲染控件，改 DOM 或脚本回写照样能送来另一个码，
    //    而后端拒绝时给的是一段 400 文案，不如输入框下面那行红字好懂
    if (code !== normalizeSourceCode(originalCode)) {
      return (
        '来源码建了就不能改：导入模板的「数据源」列填的是码不是编号，' +
        '改了码，已经发出去的模板会全部报「数据源不存在」。要换码请新建一个、把旧的停用'
      )
    }
    return null
  }
  if (!SOURCE_CODE_PATTERN.test(code)) {
    return (
      '来源码只能用大写字母、数字与下划线（最长 64）。' +
      '空格是最常见的坑——Excel 会吃掉行尾空格但留着全角空格，' +
      '而两个看起来一样的码匹配不上时，报错只会说「数据源不存在」'
    )
  }
  return null
}

export interface LicenseScopeParseResult {
  /** 🔴 空文本、{@code null}、{@code {}} 一律归一成 {@code null}，不是 {@code {}} */
  value: Record<string, any> | null
  issue: string | null
}

/**
 * 解析授权范围文本框
 *
 * <h3>🔴 三种「空」必须归一成同一个 {@code null}</h3>
 * 空文本 / {@code null} 字面量 / {@code {}} 在后端是同一个意思（这一项没有授权条款），
 * 而 {@code QlzgCaseSourceServiceImpl} 里明写「统一存 NULL：存 {@code '{}'} 的话，
 * 闸 G-10 判『有没有授权范围』就要同时认两种空形状，
 * 而少认一种的表现是『明明没签授权，却被判成有授权范围』」。
 * 前端发一个 {@code {}} 上去就是在制造那第二种形状。
 *
 * <h3>🔴 顶层必须是对象，数组 / 字符串 / 数字都要拦在这里</h3>
 * 后端那一列是 {@code Map<String, Object>}。发一个 {@code [1,2]} 或 {@code "禁止转授权"} 上去，
 * Jackson 反序列化失败，用户拿到的是<b>整个请求</b>的一句框架级报错，
 * 而这一栏在弹窗里已经滚出视野了 —— 他看不出是哪一栏的问题
 */
export const parseLicenseScope = (text: string): LicenseScopeParseResult => {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { value: null, issue: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return {
      value: null,
      issue: '授权范围不是合法的 JSON。它要存成一个对象，例如 {"sublicense": false}'
    }
  }
  if (parsed === null) return { value: null, issue: null }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      value: null,
      issue: '授权范围的顶层必须是一个 JSON 对象（{...}），不能是数组、字符串或数字'
    }
  }
  const scope = parsed as Record<string, any>
  return Object.keys(scope).length === 0 ? { value: null, issue: null } : { value: scope, issue: null }
}

/** 把库里的对象还原成文本框里的原文。🔴 {@code null} / {@code {}} 都还原成空串 */
export const formatLicenseScope = (scope?: Record<string, any> | null): string => {
  if (!scope || Object.keys(scope).length === 0) return ''
  return JSON.stringify(scope, null, 2)
}

/**
 * 阻塞提交的问题清单
 *
 * 🔴 判据与后端一致，且**只有四条**：来源码、名称、第三方接口必须带接口编号、授权范围 JSON。
 *    多出来的每一条都是前端自己发明的约束 —— 后端不认，
 *    于是「后端允许的合法数据在前端存不进去」，而这类问题的报错文案永远指不到真正的原因
 */
export const saveIssues = (form: QlzgCaseSourceFormModel): string[] => {
  const issues: string[] = []
  const codeIssue = sourceCodeIssue(form.sourceCode)
  if (codeIssue) issues.push(codeIssue)
  if (!form.sourceName?.trim()) issues.push('来源名称不能为空')
  if (form.sourceType === 'THIRD_PARTY_API' && !form.apiInterfaceId) {
    issues.push(
      '数据源性质为「第三方数据接口」时必须选一个数据接口：' +
        '没有它，同步任务不知道去哪儿拉数据，而这个源会一直显示「启用」却一条案例也进不来'
    )
  }
  const scope = parseLicenseScope(form.licenseScopeText)
  if (scope.issue) issues.push(scope.issue)
  return issues
}

export const toSaveVO = (form: QlzgCaseSourceFormModel): QlzgCaseSourceSaveVO => {
  const scope = parseLicenseScope(form.licenseScopeText)
  return {
    id: form.id,
    sourceCode: normalizeSourceCode(form.sourceCode),
    sourceName: form.sourceName?.trim(),
    sourceType: form.sourceType,
    // 🔴 性质不是第三方接口时**一律发 null**，不发原值：
    //    后端 update 走的是逐列 .set(...)，传 null 才写 SQL NULL，
    //    留着旧值的话「先建成 API 源、再改成公开披露」会在库里留下一个界面上看不见的接口编号
    apiInterfaceId: form.sourceType === 'THIRD_PARTY_API' ? form.apiInterfaceId ?? null : null,
    originUrlPattern: trimToNull(form.originUrlPattern),
    attributionRequired: trimToNull(form.attributionRequired),
    // 🔴 解析不出来时这里会是 null（= 清空授权条款）。
    //    这不是「静默丢数据」：saveIssues 已经把 JSON 问题列进去了，
    //    而提交前一定会先过那道闸 —— sourceSchema.spec.ts 钉的就是这个配对关系
    licenseScope: scope.value,
    updateFrequency: trimToNull(form.updateFrequency),
    status: form.status
  }
}

export const fromVO = (row: QlzgCaseSourceVO): QlzgCaseSourceFormModel => ({
  id: row.id,
  sourceCode: row.sourceCode ?? '',
  sourceName: row.sourceName ?? '',
  sourceType: row.sourceType ?? 'PUBLIC_DISCLOSURE',
  apiInterfaceId: row.apiInterfaceId ?? null,
  originUrlPattern: row.originUrlPattern ?? '',
  attributionRequired: row.attributionRequired ?? '',
  licenseScopeText: formatLicenseScope(row.licenseScope),
  updateFrequency: row.updateFrequency ?? '',
  // 🔴 留空按启用处理，与后端 resolveStatus 在【新建】那一支的默认值一致
  status: row.status ?? 1
})

/**
 * 平台预置行 / 本机构行的可写判定
 *
 * 🔴 判 {@code editable} 而<b>不是</b>判 {@code platformPreset}：后端已经把两件事合成一个布尔下发了，
 *    前端再自己拼一遍 {@code platformPreset || tenantId === 0} 就是第二份判据 ——
 *    而 {@code QlzgCaseSourceVO} 上<b>刻意没有</b> {@code tenantId}（平台预置行不能通过普通修改
 *    变成机构私有，反之亦然），所以第二份判据根本拼不出来，只能拼错
 * 🔴 {@code editable === undefined} 按**可写**处理：那是后端没下发这个字段的旧响应，
 *    按不可写处理会让整页的按钮全部灰掉，而灰掉的按钮不报错
 */
export const isWritable = (row?: Pick<QlzgCaseSourceVO, 'editable'> | null): boolean =>
  row?.editable !== false

const trimToNull = (text?: string | null): string | undefined => {
  const trimmed = (text ?? '').trim()
  return trimmed ? trimmed : undefined
}
