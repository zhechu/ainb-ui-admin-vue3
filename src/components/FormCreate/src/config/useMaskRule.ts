/**
 * 给可脱敏控件的属性面板加上「数据脱敏」
 *
 * <h3>补这一项之前，脱敏这个能力只有写脚本的人用得上</h3>
 *
 * 服务端一直是完整的：读取路径（列表 / 详情 / 导出）统一过 `FormDataMasker`，
 * 它按控件的 `props.maskRule` 决定要不要遮、按 `maskFiller` / `maskKeepPrefix` /
 * `maskKeepSuffix` 决定怎么遮。缺的只是设计器里的入口 ——
 * 于是「给手机号配脱敏」这件事只能靠脚本直接往 props 里写，
 * 界面上既配不出来、也看不见已经配了什么。
 *
 * <h3>控件范围取自契约的 maskable，不在这里另列一份清单</h3>
 *
 * 「哪些控件能脱敏」是后端发布校验也要用的事实，契约
 * （form-widget-contracts.json）里已经有 `maskable` 位。这里直接读它，
 * 好处是加一个可脱敏控件时只改契约一处，前后端同时生效；
 * 而契约两份副本是否一致由 `form-widget-contract-sync.spec.ts` 守着。
 *
 * ⚠️ 这与隔壁 {@link useValidateRule} 刻意硬编码控件名不是矛盾：
 * 那边要排除的是「值来自选项」的控件，契约里没有对应的能力位可推导；
 * 这边要的事实契约里有现成的。
 *
 * ⚠️ 注册表的键是**设计器菜单名**，而契约里的是**规则类型**。
 * 当前三个可脱敏控件（input / textarea / password）两者同名，可以直接用；
 * 真要出现不同名的（内核里 dateRange / timeRange 就是这种情况，
 * 见 designer/useContractWidgetTypes.ts），得先过一次映射再注册。
 *
 * <h3>⚠️ 必须走 appendComponentProps</h3>
 *
 * input / textarea / password 这三个控件上已经挂了「格式校验」与「出现场景」
 * 两批追加项。直接调 `setComponentRuleConfig` 会把它们静默顶掉 ——
 * 这个坑真实发生过一次，见 designer/useComponentPropsRegistry.ts 的说明。
 *
 * <h3>脱敏只影响读，不影响存</h3>
 *
 * 库里存的始终是明文，遮掩发生在下发之前。所以改脱敏配置不需要迁移数据，
 * 关掉脱敏后历史数据照常显示完整值。属性项的说明里写了这句话，
 * 否则用户会担心「配上去之后数据是不是就被改坏了」。
 */
import { Ref } from 'vue'
import { listWidgetContracts } from '@/components/FormWidgets/contracts'
import { appendComponentProps } from '../designer/useComponentPropsRegistry'

/**
 * 脱敏策略选项
 *
 * value 必须与后端 `MaskRule` 枚举的名字逐字对应 —— 服务端用
 * `MaskRule.parse(name)` 反查，认不出来的按「不脱敏」处理**且不报错**。
 * 所以这里写错一个字母的表现是「配了脱敏但没生效」，没有任何提示。
 *
 * 「不脱敏」的值刻意是空串而不是 `'NONE'`：空串不会在 props 里留下痕迹，
 * 没配过脱敏的控件保持干净。服务端 parse 空值同样得到 NONE，两者等价。
 */
const MASK_OPTIONS = [
  { label: '不脱敏', value: '' },
  { label: '手机号（138****8000）', value: 'MOBILE' },
  { label: '身份证（110***********1234）', value: 'ID_CARD' },
  { label: '银行卡（6222**********1234）', value: 'BANK_CARD' },
  { label: '姓名（张**）', value: 'NAME' },
  { label: '邮箱（ab****@example.com）', value: 'EMAIL' },
  { label: '自定义', value: 'CUSTOM' }
]

/** 补位符。每种策略都用得上，不只是自定义 */
const fillerRule = () => ({
  type: 'input',
  field: 'maskFiller',
  title: '补位符',
  props: { maxlength: 1, placeholder: '默认 *' },
  info: '用来替换被遮掩字符的符号，一个字符'
})

/**
 * 自定义策略的保留位数
 *
 * 前后保留位数加起来 ≥ 值的长度时，服务端会把整个值遮掉而不是原样返回 ——
 * 否则一条只有 3 位的脏数据配上「保留前 3 位」就等于没脱敏。
 * 这条边界写进 info，因为它是配置时唯一可能让人意外的地方。
 */
const keepPrefixRule = () => ({
  type: 'inputNumber',
  field: 'maskKeepPrefix',
  title: '保留前几位',
  props: { min: 0, max: 64, precision: 0 }
})

const keepSuffixRule = () => ({
  type: 'inputNumber',
  field: 'maskKeepSuffix',
  title: '保留后几位',
  props: { min: 0, max: 64, precision: 0 },
  info: '前后保留位数之和不小于值的长度时，该值会被整个遮掉'
})

/**
 * 可脱敏控件的菜单名
 *
 * 只取 supported 的：契约里标了不支持的控件根本不该出现在设计器里，
 * 给它加属性项没有意义。
 */
const maskableMenus = (): string[] =>
  listWidgetContracts()
    .filter((w) => w.maskable && w.supported)
    .map((w) => w.type)

export const useMaskRule = (designer: Ref) => {
  const buildMaskRule = () => {
    const menus = maskableMenus()
    if (menus.length === 0) {
      // 契约里一个可脱敏控件都没有，说明 maskable 位被清空或契约结构变了。
      // 留痕而不是静默返回：脱敏入口整个消失的表现与「这个功能没做」一模一样
      console.warn('[MaskRule] 契约里没有任何 maskable 控件，未注册脱敏配置项')
      return
    }
    menus.forEach((name) => {
      appendComponentProps(
        designer,
        name,
        () => [
          {
            type: 'select',
            field: 'maskRule',
            title: '数据脱敏',
            options: MASK_OPTIONS,
            props: { clearable: true },
            info:
              '开启后，列表、详情、导出拿到的都是遮掩过的值，明文不会下发到前端。' +
              '库里存的始终是明文，改这项不影响已有数据',
            // 选中不同策略时展开不同的配置项。
            // 每个 value 只匹配一条，不靠多条同时命中 —— 那样的叠加顺序没有保证
            control: MASK_OPTIONS.filter((o) => o.value).map((o) => ({
              value: o.value,
              condition: '==',
              rule:
                o.value === 'CUSTOM'
                  ? [fillerRule(), keepPrefixRule(), keepSuffixRule()]
                  : [fillerRule()]
            }))
          }
        ],
        'MaskRule'
      )
    })
  }

  return { buildMaskRule }
}
