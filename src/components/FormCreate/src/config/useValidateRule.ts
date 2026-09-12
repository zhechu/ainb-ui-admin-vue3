/**
 * 给输入类控件的属性面板加上「格式校验」
 *
 * <h3>为什么是「拦截改写」而不是给每个控件复刻一份属性规则</h3>
 *
 * 格式校验要出现在多个内置控件上（单行输入、多行输入、密码、数字输入），
 * 而这些控件的属性面板是设计器内核提供的。做法与 useOptionSource 一致：
 * `setComponentRuleConfig` 的第二参可以是函数，签名 `(activeRule, ctx) => rule[]`，
 * 内置属性规则函数本身挂在 `activeRule._menu.props` 上 ——
 * 先调用它拿到原始规则树，再往后面追加我们这一项。
 *
 * 这样不需要知道内核属性面板的任何内部结构，设计器升级也不容易碎。
 *
 * <h3>为什么只给这四个控件加</h3>
 *
 * 格式校验的对象是「用户手打进去的文本」。下拉、单选这类控件的值来自选项，
 * 值域已经由选项决定了，再配正则只会带来一种新的出错方式：
 * 选项里有个值不匹配正则，用户选了它却提交不了，而他没有任何办法改。
 */
import { Ref } from 'vue'

/**
 * 要加「格式校验」的控件菜单名
 *
 * 与控件契约里的 type 同名（内置控件的菜单名就是它的 type）。
 * 刻意不从契约里按 valueType 自动推导 —— 那会把 select / radio / rate / slider
 * 这些「值来自选项或拖动」的控件也算进来。
 */
const TEXT_INPUT_MENUS = ['input', 'textarea', 'password', 'inputNumber']

export const useValidateRule = (designer: Ref) => {
  const buildValidateRule = () => {
    TEXT_INPUT_MENUS.forEach((name) => {
      designer.value?.setComponentRuleConfig(
        name,
        (activeRule: any, ctx: any) => {
          const item = {
            type: 'ValidateRulesField',
            field: '__validateRules__',
            title: '格式校验',
            props: {}
          }
          // 先原样拿到内置属性规则，一行不改
          const builtin = activeRule?._menu?.props?.(activeRule, ctx)
          if (!Array.isArray(builtin)) {
            // 拿不到内置规则说明内核结构变了。只给我们自己这一项，保证面板不白屏 ——
            // 属性面板整个空白比少一个属性项严重得多
            if (import.meta.env.DEV) {
              console.warn(`[ValidateRule] 控件[${name}]的内置属性规则不可用`)
            }
            return [item]
          }
          // 追加在最后：格式校验是进阶配置，放在标题、字段 ID、默认值这些
          // 每次都要改的属性前面会挡路
          return [...builtin, item]
        },
        // 内置规则已经被我们包含进去了，不要再 append
        false
      )
    })
  }

  return { buildValidateRule }
}
