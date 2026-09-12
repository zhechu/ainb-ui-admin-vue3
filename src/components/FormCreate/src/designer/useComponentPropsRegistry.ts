/**
 * 控件属性面板的「追加项」注册表
 *
 * <h3>它解决的问题</h3>
 *
 * 设计器的 `setComponentRuleConfig(name, rule, append)` 对同一个控件调用两次，
 * **后一次会把前一次整个覆盖掉，而且不报错**。于是「给某控件的属性面板加一项」
 * 这件事就有了一条隐式契约：同一个控件全项目只能注册一次，多个功能想加项时
 * 必须有人把它们手工拼在一起。
 *
 * 这条契约此前只靠注释维系 —— useOptionSource 与 useInputEnhanceRule 里各写了
 * 一段「⚠️ 不能另起一次 setComponentRuleConfig」。但注释拦不住第三个人：
 * `useValidateRule` 给 input / textarea / password / inputNumber 注册了「格式校验」，
 * 紧接着 `useInputEnhanceRule` 又给同一批控件注册了「出现场景」，
 * **四个文本输入控件的「格式校验」入口就此全部消失**。
 *
 * 症状极难归因：属性面板照常渲染、控制台没有任何报错、库里已有的
 * `props.validateRules` 也照常生效（服务端和运行时都读得到），
 * 只是设计器里既看不到也配不了 —— 看起来像「这个功能没做」。
 *
 * <h3>做法</h3>
 *
 * 按控件名累加贡献者，每次注册都用**当前全部**贡献者重新注册一次。
 * 谁先谁后不再影响结果，也不需要任何人知道别的模块注册过什么。
 *
 * <h3>为什么用 WeakMap 按 designer 存，而不是让调用方传注册表</h3>
 *
 * 那需要改四个 hook 的签名，并在 useFormCreateDesigner 里多传一个参数。
 * 按 designer 这个 Ref 做键，调用方写法完全不变，多个设计器实例之间也不会串。
 */
import { Ref } from 'vue'

/**
 * 一个属性项贡献者
 *
 * @param activeRule 当前选中的规则
 * @param ctx        设计器上下文
 * @param builtin    内核的内置属性规则数组。**允许原地修改**
 *                   —— useOptionSource 就是靠改写 builtin 里的选项项来实现
 *                   「静态数据 / 数据字典 / 数据接口」三选一的
 * @returns 要追加到面板末尾的属性项
 */
export type PropsContributor = (activeRule: any, ctx: any, builtin: any[]) => any[]

interface RegistryEntry {
  /** 控件名 → 该控件上的全部贡献者，按注册先后 */
  contributors: Map<string, PropsContributor[]>
}

const registries = new WeakMap<Ref, RegistryEntry>()

const entryOf = (designer: Ref): RegistryEntry => {
  let entry = registries.get(designer)
  if (!entry) {
    entry = { contributors: new Map() }
    registries.set(designer, entry)
  }
  return entry
}

/**
 * 给某个控件的属性面板追加若干项
 *
 * 同一个控件可以被调用多次，各次追加的项会按调用顺序依次拼在内置项后面。
 *
 * @param label 出问题时打日志用的模块名，例如 'ValidateRule'
 */
export const appendComponentProps = (
  designer: Ref,
  name: string,
  contributor: PropsContributor,
  label: string
) => {
  const entry = entryOf(designer)
  const list = entry.contributors.get(name) ?? []
  list.push(contributor)
  entry.contributors.set(name, list)

  designer.value?.setComponentRuleConfig(
    name,
    (activeRule: any, ctx: any) => {
      // 先原样拿到内置属性规则
      const builtin = activeRule?._menu?.props?.(activeRule, ctx)
      const safeBuiltin = Array.isArray(builtin) ? builtin : []
      if (!Array.isArray(builtin) && import.meta.env.DEV) {
        // 拿不到内置规则说明内核结构变了。仍然把我们自己的项给出去，
        // 保证面板不白屏 —— 属性面板整个空白比少几项严重得多
        console.warn(`[${label}] 控件[${name}]的内置属性规则不可用`)
      }
      // 每次都重新读 map：后注册的贡献者也要生效
      const extras = (entry.contributors.get(name) ?? []).flatMap((fn) => {
        try {
          return fn(activeRule, ctx, safeBuiltin) ?? []
        } catch (e) {
          // 一个贡献者出错不该让整个属性面板塌掉
          console.error(`[${label}] 控件[${name}]的属性项构造失败`, e)
          return []
        }
      })
      return [...safeBuiltin, ...extras]
    },
    // 内置规则已经被我们包含进去了，不要再让内核 append 一次
    false
  )
}

/**
 * 清空某个设计器的注册表
 *
 * 设计器组件卸载重建时调用，避免上一次的贡献者残留导致属性项重复。
 */
export const resetComponentProps = (designer: Ref) => {
  registries.delete(designer)
}
