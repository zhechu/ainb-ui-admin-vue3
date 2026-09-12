/**
 * 给输入类控件的属性面板加上「格式校验」
 *
 * <h3>为什么是「拦截改写」而不是给每个控件复刻一份属性规则</h3>
 *
 * 格式校验要出现在多个内置控件上（单行输入、多行输入、密码、数字输入），
 * 而这些控件的属性面板是设计器内核提供的。做法是先拿到内核的属性规则，
 * 再往后面追加我们这一项 —— 不需要知道内核属性面板的任何内部结构，
 * 设计器升级也不容易碎。
 *
 * <h3>⚠️ 必须走 appendComponentProps，不能直接 setComponentRuleConfig</h3>
 *
 * 后者对同一控件调用两次会**静默覆盖**前一次。这四个控件同时也被
 * useInputEnhanceRule 注册（加「出现场景」），而它跑在本模块之后 ——
 * 直接注册的结果是「格式校验」在属性面板里整个消失，且没有任何报错：
 * 面板照常渲染，库里已有的 props.validateRules 也照常生效，
 * 只是设计器里既看不到也配不了。这个 bug 真实发生过。
 *
 * <h3>⚠️ field 必须是真实的属性名，不能是 `__validateRules__` 这种占位名</h3>
 *
 * 属性面板项的 `field` 决定了它读写 `activeRule.props` 上的哪个键 ——
 * 这层绑定由设计器内核完成。曾经这里用的是一个自定义桥接组件
 * （field 写成 `__validateRules__`，组件内部想通过 `formCreateInject.rule`
 * 去够到当前控件）。那条路走不通：**注入进来的 `rule` 是属性项自己**
 * （`{field: '__validateRules__', type: 'ValidateRulesField'}`），不是被选中的控件。
 * 于是读到的永远是空，改动也只写进属性项那个临时对象里，保存后什么都没留下。
 *
 * 正确写法就是普通的 v-model 字段：`field: 'validateRules'` + 一个收
 * `modelValue` / `update:modelValue` 的组件，剩下的内核会做。
 * 「选项来源」（DictSourceConfig）用的一直是这个写法，它是对的。
 *
 * <h3>为什么只给这四个控件加</h3>
 *
 * 格式校验的对象是「用户手打进去的文本」。下拉、单选这类控件的值来自选项，
 * 值域已经由选项决定了，再配正则只会带来一种新的出错方式：
 * 选项里有个值不匹配正则，用户选了它却提交不了，而他没有任何办法改。
 */
import { Ref } from 'vue'
import { appendComponentProps } from '../designer/useComponentPropsRegistry'

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
      // 追加在最后：格式校验是进阶配置，放在标题、字段 ID、默认值这些
      // 每次都要改的属性前面会挡路
      appendComponentProps(
        designer,
        name,
        () => [
          {
            type: 'ValidateRulesEditor',
            field: 'validateRules',
            title: '格式校验',
            props: {}
          },
          {
            type: 'switch',
            field: 'uniqueCheck',
            title: '内容不能重复',
            info:
              '开启后，填写时会即时检查该内容在系统里是否已存在，提交时服务端再查一次。' +
              '它不能替代数据库唯一索引：两个人同时提交同一个值，两次检查都会通过。' +
              '真正需要唯一的列请同时建唯一索引'
          }
        ],
        'ValidateRule'
      )
    })
  }

  return { buildValidateRule }
}
