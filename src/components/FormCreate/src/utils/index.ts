import {
  SUB_TABLE_WIDGET_TYPE,
  SUB_FIELD_SEPARATOR
} from '@/components/FormWidgets/contracts'

export function makeRequiredRule() {
  return {
    type: 'Required',
    field: 'formCreate$required',
    title: '是否必填'
  }
}

export const localeProps = (t, prefix, rules) => {
  return rules.map((rule) => {
    if (rule.field === 'formCreate$required') {
      rule.title = t('props.required') || rule.title
    } else if (rule.field && rule.field !== '_optionType') {
      rule.title = t('components.' + prefix + '.' + rule.field) || rule.title
    }
    return rule
  })
}

/**
 * 解析表单组件的  field, title 等字段（递归，如果组件包含子组件）
 *
 * 子表控件（type = group）的内部规则挂在 props.rule 下，与布局容器的 children 不是一回事。
 * 它的内部字段解析成层级 key：`子表控件field.明细字段`，如 `contacts.remark`。
 *
 * 为什么明细字段要单独列出来而不是只给一个 `contacts`：
 * 流程的字段权限按 key 逐个配。只给顶层 key 的话，明细里的每一列就只能整体放行或
 * 整体禁止，做不到「审批人只能改明细的备注列」这种常见诉求。
 *
 * ⚠️ 层级 key 的分隔符取自控件契约（SUB_FIELD_SEPARATOR），必须与后端字段权限裁剪用的
 * 分隔符一致，两边对不上会导致配了权限却不生效，或反过来把有权限的字段裁掉。
 *
 * @param rule  组件的生成规则 https://www.form-create.com/v3/guide/rule
 * @param fields 解析后表单组件字段
 * @param parentTitle  如果是子表单，子表单的标题，默认为空
 * @param parentField  如果是子表单，子表单的 field，用于拼层级 key，默认为空
 */
export const parseFormFields = (
  rule: Record<string, any>,
  fields: Array<Record<string, any>> = [],
  parentTitle: string = '',
  parentField: string = ''
) => {
  const { type, field, $required, title: tempTitle, children } = rule
  // 子表控件的内部规则在 props.rule 下
  const subRules =
    type === SUB_TABLE_WIDGET_TYPE && Array.isArray(rule.props?.rule) ? rule.props.rule : null

  if (field && tempTitle) {
    let title = tempTitle
    if (parentTitle) {
      title = `${parentTitle}.${tempTitle}`
    }
    let required = false
    if ($required) {
      required = true
    }
    fields.push({
      // 明细字段用层级 key，与后端的字段权限裁剪对齐
      field: parentField ? `${parentField}${SUB_FIELD_SEPARATOR}${field}` : field,
      title,
      // 不带父级前缀的原始标题。权限配置界面按子表分组展示时用它，
      // 免得每一行都重复「联系人明细.」这个前缀
      shortTitle: tempTitle,
      type,
      required,
      // 标记归属，便于权限配置界面按子表分组展示
      subTableField: parentField || undefined
    })
    if (subRules) {
      // 解析子表内部字段。嵌套子表后端不支持，只下钻一层
      if (!parentField) {
        subRules.forEach((item: Record<string, any>) => {
          parseFormFields(item, fields, tempTitle, field)
        })
      }
      // 子表控件本身不再有 children 需要处理
      return
    }
  }
  if (children && Array.isArray(children)) {
    children.forEach((child) => {
      // 布局容器不改变归属，原样把 parentField 传下去
      parseFormFields(child, fields, parentTitle, parentField)
    })
  }
}

/**
 * 从设计器里实时收集可被引用的表单字段
 *
 * 给「把接口参数绑定到本表单某个字段」这类配置用。每次打开属性面板都重新算 ——
 * 用户随时可能新增字段，缓存住就会漏掉刚加的那个。
 *
 * 要递归：字段可能被放在栅格、标签页等布局容器里，也可能在子表内部。
 *
 * @param designer     设计器实例
 * @param currentField 当前正在配置的字段，排除自身避免自引用
 */
export const collectFormFieldOptions = (
  designer?: { value?: any },
  currentField?: string
): { label: string; value: string }[] => {
  const options: { label: string; value: string }[] = []
  const seen = new Set<string>()
  const walk = (rules: any[]) => {
    if (!Array.isArray(rules)) {
      return
    }
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') {
        continue
      }
      // 布局、展示类控件没有 field，天然被排除
      if (rule.field && rule.field !== currentField && !seen.has(rule.field)) {
        seen.add(rule.field)
        options.push({
          label: `${rule.title || rule.field}（${rule.field}）`,
          value: rule.field
        })
      }
      walk(rule.children)
      walk(rule.props?.rule)
    }
  }
  try {
    walk(designer?.value?.getRule?.() || [])
  } catch {
    // 取不到就给空列表：属性面板里下拉为空，用户能直接看出问题所在
  }
  return options
}
