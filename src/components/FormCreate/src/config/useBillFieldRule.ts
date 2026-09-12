import { generateUUID } from '@/utils'
import { localeProps, makeRequiredRule } from '@/components/FormCreate/src/utils'
import * as BillTemplateApi from '@/api/infra/billTemplate'
import type { Ref } from 'vue'

/** 能作为前后缀取值来源的控件类型：值得是一段短文本或数字 */
const REFERABLE_TYPES = ['input', 'inputNumber', 'select', 'radio', 'DictSelect', 'datePicker']

/**
 * 单据组件规则
 *
 * 表单里的单号字段。两种模式：
 * - 引用单据模板：规则在后台统一维护，多个表单可共用
 * - 内联规则：规则写在字段上，前后缀可取自同表单其它字段的值
 *
 * 组件名必须与后端 FormBillFieldResolver.COMPONENT_TYPE 一致 ——
 * 后端靠规则里的 type 认出哪些字段需要填号。
 *
 * @param designer 设计器实例。内联模式的「取字段」下拉要列出表单里已有的字段，
 *                 只能从设计器实时取；模板下拉则是后台主数据，拉一次即可。
 */
export const useBillFieldRule = (designer?: Ref) => {
  const label = '单据编号'
  const name = 'BillNumberInput'

  /** 单据模板下拉数据 */
  const templateOptions = ref<{ label: string; value: string }[]>([])

  onMounted(async () => {
    try {
      const data = await BillTemplateApi.getSimpleBillTemplateList()
      if (!data || data.length === 0) {
        return
      }
      templateOptions.value = data.map((item) => ({
        // 把范例带进选项文案，选模板时不用再去单据模板页对一遍格式
        label: item.example ? `${item.name}（${item.example}）` : item.name,
        value: item.code
      }))
    } catch {
      // 拉不到不影响拖控件，属性面板里下拉为空，用户能看出问题所在
    }
  })

  /**
   * 收集表单里可被引用的字段
   *
   * 每次打开属性面板时重新算 —— 用户随时可能新增字段，缓存住就会漏掉刚加的那个。
   * 要递归：字段可能被放在栅格、标签页等容器里。
   */
  const collectFieldOptions = (currentField?: string) => {
    const options: { label: string; value: string }[] = []
    const walk = (rules: any[]) => {
      if (!Array.isArray(rules)) return
      for (const rule of rules) {
        if (!rule || typeof rule !== 'object') continue
        if (rule.field && rule.field !== currentField && REFERABLE_TYPES.includes(rule.type)) {
          options.push({ label: `${rule.title || rule.field}（${rule.field}）`, value: rule.field })
        }
        walk(rule.children)
        walk(rule.props?.rule)
      }
    }
    try {
      walk(designer?.value?.getRule?.() || [])
    } catch {
      // 取不到就给空列表，用户至少还能用常量段
    }
    return options
  }

  return {
    icon: 'icon-barcode',
    label,
    name,
    rule() {
      return {
        type: name,
        field: generateUUID(),
        title: label,
        info: '',
        $required: false,
        props: {
          ruleMode: 1,
          templateCode: ''
        }
      }
    },
    props(rule: any, { t }) {
      return localeProps(t, name + '.props', [
        makeRequiredRule(),
        {
          type: 'radio',
          field: 'ruleMode',
          title: '规则来源',
          value: 1,
          options: [
            { label: '引用模板', value: 1 },
            { label: '自定义规则', value: 2 }
          ],
          // form-create 的联动：选中不同值时展开不同的配置项
          control: [
            {
              value: 1,
              rule: [
                {
                  type: 'select',
                  field: 'templateCode',
                  title: '单据模板',
                  value: '',
                  options: templateOptions.value,
                  props: { filterable: true },
                  info: '在「基础设施 - 单据模板」中维护，多个表单可共用同一个模板'
                }
              ]
            },
            {
              value: 2,
              rule: [
                {
                  type: 'BillInlineRuleEditor',
                  field: 'ruleConfig',
                  title: '编号规则',
                  value: {},
                  props: {
                    // 排除自己，避免用户把单号字段本身选成前缀来源
                    fieldOptions: collectFieldOptions(rule?.field)
                  },
                  info: '规则只属于当前字段。前后缀可以取自本表单其它字段的值'
                }
              ]
            }
          ]
        }
      ])
    }
  }
}
