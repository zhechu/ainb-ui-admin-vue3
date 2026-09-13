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
 * ⚠️ 独立权限点与审计日志本轮未做：当前凡是能编辑该表单数据的人都点得动这个按钮。
 * 接入后前端这里要补 v-hasPermi、后端要补审计，两侧都不能漏。
 */

/** 标记：这个 children 是本模块加的，重复应用时先清掉自己上一次的产物 */
const DERIVED_FLAG = '__plainTextToggle'

export interface PlainTextContext {
  /** 当前记录的主键。新增态没有主键 —— 没有已存的值，也就没有明文可看 */
  pk: () => any
  /** 取某个字段的明文 */
  fetch: (field: string) => Promise<any>
  /** 把取到的明文写回表单 */
  setValue: (field: string, value: any) => void
  /** 提示 */
  notify: (type: 'success' | 'error', text: string) => void
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
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue

    const maskRule = rule.props?.maskRule
    if (ctx && rule.field && typeof maskRule === 'string' && maskRule) {
      const existing = Array.isArray(rule.children)
        ? rule.children.filter((item: any) => !item?.[DERIVED_FLAG])
        : []
      rule.children = [...existing, buildToggleButton(rule.field, ctx)]
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
      if (!ctx.pk()) {
        // 新增态没有已存的值。说清楚而不是发一个必然失败的请求
        ctx.notify('error', '这条数据还没保存，没有可查看的原值')
        return
      }
      try {
        const plain = await ctx.fetch(field)
        ctx.setValue(field, plain)
        ctx.notify('success', '已显示明文，修改后保存即可')
      } catch (e: any) {
        ctx.notify('error', e?.msg || '获取明文失败')
      }
    }
  }
})
