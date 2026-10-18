import { readNestedRules } from '@/components/FormWidgets/contracts'

/**
 * 脱敏字段的「查看明文」按钮
 *
 * <h3>解决的问题</h3>
 *
 * 详情接口对脱敏字段返回的是掩码（`138****5678`），用户在编辑页看到的就是它。
 * 想核对或修改原值时无从下手 —— 而直接把掩码提交回去会覆盖真实数据
 * （服务端已有回写保护，见 FormDataMasker.stripMaskedEcho，但那只保证不写坏，
 * 不解决「看不见」）。
 *
 * <h3>为什么是按需取而不是编辑时直接下发明文</h3>
 *
 * 编辑页一次性返回明文，等于凡能打开编辑页的人都能看到全部敏感值，
 * 脱敏在编辑场景下就失效了。改成点一下取一个字段，服务端那边
 * 一次也只还原一条数据的一个字段。
 *
 * ⚠️ 按钮受独立权限点管控：`infra:form-design-run:{code}:view-plain`。
 * 后端 plain-field 端点要 update 与 view-plain 两道门都过，前端这里用同一个串
 * 决定「要不要挂这个按钮」—— 没有权限的人看不到按钮，而不是点了吃一个 403。
 * 审计日志由服务端写（成功与被拒都写），前端不参与。
 *
 * 🔴 view-plain 这一行只在【首次发布】表单时创建。本次改动之前发布的表单没有它，
 * 于是那些表单上的「查看明文」对非超管会整体消失。这是有意的 fail-closed：
 * 该端点的全部意义就是绕过脱敏，宁可少一个按钮，不可多一个能看明文的口子。
 */

/** 标记：这个 children 是本模块加的，重复应用时先清掉自己上一次的产物 */
const DERIVED_FLAG = '__plainTextToggle'

export interface PlainTextContext {
  /** 当前记录的主键。新增态没有主键 —— 没有已存的值，也就没有明文可看 */
  pk: () => any
  /**
   * 取某个字段的明文。
   *
   * 第二个参数是 `pk()` 刚刚返回、且已判过非空的那个值 —— 让调用方拿现成的，
   * 而不是自己再读一遍全局状态，理由写在下面 buildToggleButton 的传参处。
   */
  fetch: (field: string, pk: any) => Promise<any>
  /** 把取到的明文写回表单 */
  setValue: (field: string, value: any) => void
  /** 提示 */
  notify: (type: 'success' | 'error', text: string) => void
  /**
   * 当前用户有没有 view-plain 权限。返回 false 时整个按钮不挂。
   *
   * 不传表示不校验（调用方自己已经判过，或单测里只关心挂载逻辑）——
   * 刻意做成可选而不是必填，免得每个调用点都被迫重复拼一遍权限串
   */
  permitted?: () => boolean
}

/**
 * 给配了脱敏的字段挂上「查看明文」按钮，就地修改规则树
 *
 * 只处理主表字段：子表明细的明文查看服务端没开（接口要带「哪一行明细」，
 * 形状完全不同），前端跟着一起不开，免得点了报错。
 *
 * @param rules form-create 规则树，会被就地修改
 * @param ctx   取值与写回的上下文。不传表示不启用（新增态、详情态都不需要）
 */
export const applyPlainTextToggle = (
  rules: any[] | undefined | null,
  ctx?: PlainTextContext
): void => {
  if (!Array.isArray(rules)) return
  // 无权限时一次判到底：不挂按钮，但仍要往下递归清掉上一次的产物 ——
  // 权限是会在会话中途变的（切换角色、被收回授权后刷新配置），
  // 只在入口 return 会把已经挂上去的按钮留在树上
  const allowed = !ctx || !ctx.permitted || ctx.permitted()
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue

    const maskRule = rule.props?.maskRule
    if (allowed && ctx && rule.field && typeof maskRule === 'string' && maskRule) {
      const existing = Array.isArray(rule.children)
        ? rule.children.filter((item: any) => !item?.[DERIVED_FLAG])
        : []
      rule.children = [...existing, buildToggleButton(rule.field, ctx)]
    } else if (Array.isArray(rule.children)) {
      rule.children = rule.children.filter((item: any) => !item?.[DERIVED_FLAG])
    }

    // 布局容器与子表内部同样要走一遍：脱敏字段可能藏在栅格或标签页里。
    // 子表内部的字段不会被挂按钮（上面的 maskRule 判断在递归里对子字段也成立，
    // 但服务端不放行，所以这里靠 subField 的缺失天然跳过 —— 子表字段的规则
    // 在 readNestedRules 里，它们的 maskRule 同样会命中，因此显式排除）
    applyPlainTextToggle(rule.children?.filter?.((c: any) => !c?.[DERIVED_FLAG]), ctx)
    applyNestedWithoutToggle(readNestedRules(rule))
  }
}

/** 子表内部只递归、不挂按钮 */
const applyNestedWithoutToggle = (rules: any[] | undefined | null): void => {
  if (!Array.isArray(rules)) return
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    if (Array.isArray(rule.children)) {
      rule.children = rule.children.filter((item: any) => !item?.[DERIVED_FLAG])
    }
    applyNestedWithoutToggle(rule.children)
    applyNestedWithoutToggle(readNestedRules(rule))
  }
}

const buildToggleButton = (field: string, ctx: PlainTextContext) => ({
  type: 'ElButton',
  slot: 'append',
  [DERIVED_FLAG]: true,
  props: { icon: 'View', title: '查看明文' },
  on: {
    click: async () => {
      const pk = ctx.pk()
      if (!pk) {
        // 新增态没有已存的值。说清楚而不是发一个必然失败的请求
        ctx.notify('error', '这条数据还没保存，没有可查看的原值')
        return
      }
      try {
        // 🔴 把刚判过非空的那个 pk 传下去，而不是让调用方在 fetch 里自己再读一遍：
        //    窄化只发生在本函数里，调用方那边读到的仍是 `string | number | undefined`，
        //    只能靠 `as` 硬压给 getPlainField（它的 id 是必填的，刻意不放宽成可选 ——
        //    「必须指明是哪一行」正是这个端点的全部约束所在）。
        const plain = await ctx.fetch(field, pk)
        ctx.setValue(field, plain)
        ctx.notify('success', '已显示明文，修改后保存即可')
      } catch (e: any) {
        ctx.notify('error', e?.msg || '获取明文失败')
      }
    }
  }
})
