/**
 * 给输入类控件的属性面板加上输入增强项
 *
 * - 数字输入：千分位、金额大写
 * - 日期：相对默认值（今天 / 本月初 / 7 天后）
 *
 * 做法与 useOptionSource / useValidateRule 一致：拦截内置属性规则再追加，
 * 不需要知道内核属性面板的内部结构。
 *
 * <h3>为什么相对默认值不复用内核的「默认值」属性</h3>
 *
 * 内核那个属性存的是一个具体日期。存具体日期的问题是它在表单发布的第二天就过期了
 * —— 而「新建单据时默认今天」这个需求，用户表达的是语义而不是某一天。
 * 所以另开一个属性存 token，运行时才解析成日期；两者同时配时以相对默认值为准。
 */
import { Ref } from 'vue'
import { RELATIVE_DATE_OPTIONS } from '@/components/FormInput'
import { buildScenePropRule } from '@/components/FormWidgets/renderScene'

/**
 * 要加「出现场景」的控件
 *
 * 覆盖常用的承载字段的控件。布局容器（栅格、卡片）不在其中 ——
 * 它们没有 field，按场景过滤时整个容器消失会让布局莫名塌掉，
 * 用户很难反应过来是场景开关干的。
 */
const SCENE_CAPABLE_MENUS = [
  'input',
  'textarea',
  'password',
  'inputNumber',
  'switch',
  'datePicker',
  'timePicker',
  'slider',
  'rate',
  'upload'
]

// ⚠️ 选项类控件（select / radio / checkbox / cascader / elTreeSelect / tree）
// 【不在】上面这份清单里：它们的属性面板已经被 useOptionSource 注册改造过，
// 这里再注册一次会把那份改造整个覆盖掉（后注册的胜），
// 表现为属性面板里「数据字典 / 数据接口」两个分支消失。
// 它们的场景属性由 useOptionSource 一并拼进去。

export const useInputEnhanceRule = (designer: Ref) => {
  /** 追加属性项：第二参是「原样拿到内置规则再往后加」 */
  const appendProps = (name: string, items: () => any[]) => {
    designer.value?.setComponentRuleConfig(
      name,
      (activeRule: any, ctx: any) => {
        const builtin = activeRule?._menu?.props?.(activeRule, ctx)
        if (!Array.isArray(builtin)) {
          // 拿不到内置规则说明内核结构变了。只给我们自己的项，保证面板不白屏 ——
          // 属性面板整个空白比少一个属性项严重得多
          if (import.meta.env.DEV) {
            console.warn(`[InputEnhance] 控件[${name}]的内置属性规则不可用`)
          }
          return items()
        }
        return [...builtin, ...items()]
      },
      false
    )
  }

  /** 数字输入框专有：千分位与金额大写 */
  const amountProps = () => [
    {
      type: 'switch',
      field: 'thousands',
      title: '千分位显示',
      info: '显示在输入框后面（el-input-number 不支持原地格式化），落库仍是纯数字'
    },
    {
      type: 'switch',
      field: 'chineseAmount',
      title: '显示金额大写',
      info: '在输入框后面显示「壹佰贰拾叁元整」，供核对'
    }
  ]

  /** 日期专有：相对默认值 */
  const relativeDateProps = () => [
    {
      type: 'select',
      field: 'relativeDefaultToken',
      title: '相对默认值',
      info: '按语义存储，每次打开表单时才解析成具体日期',
      props: { clearable: true },
      options: RELATIVE_DATE_OPTIONS
    },
    {
      type: 'inputNumber',
      field: 'relativeDefaultOffset',
      title: '偏移量',
      info: '仅「N 天后 / N 个月后」用，负数表示之前',
      props: { min: -3650, max: 3650 }
    }
  ]

  /**
   * 每个控件只注册一次
   *
   * ⚠️ `setComponentRuleConfig` 对同一个控件调用两次，后一次会覆盖前一次。
   * 分两轮注册（先给所有控件加场景，再单独给 inputNumber 加千分位）的话，
   * 数字输入框会丢掉场景开关那一项 —— 而且不报错，只是属性面板里少一项。
   */
  const extraPropsOf = (name: string) => {
    const items: any[] = [buildScenePropRule()]
    if (name === 'inputNumber') items.push(...amountProps())
    if (name === 'datePicker') items.push(...relativeDateProps())
    return items
  }

  const buildInputEnhance = () => {
    for (const name of SCENE_CAPABLE_MENUS) {
      appendProps(name, () => extraPropsOf(name))
    }
  }

  return { buildInputEnhance }
}
