import { defineComponent, h } from 'vue'
import { Icon } from '@/components/Icon'
import { duplicateRow } from './useSubTableEnhance'

/**
 * 给子表控件加上「复制本行」
 *
 * <h3>为什么要包一层，而不是从规则里塞一个按钮</h3>
 *
 * 内核的子表控件（fcGroup）确实留了 `button` 具名插槽，参数是
 * `{total, index, vm, key, del, add}` —— 正是「这是第几行」所需要的。
 * 但 form-create 从**规则**渲染具名插槽时，塞进去的是一个 vnode，
 * 不是接收作用域参数的函数（见 renderSlot：`slotBag.setSlot(rule.slot, renderCtx(...))`）。
 * 也就是说规则里的按钮拿不到 index，不知道自己在哪一行。
 *
 * 所以只能在组件层接。做法是把子表类型 `group` 在 **form-create 自己的组件表**里
 * 换成本包装组件，包装组件再渲染内核组件并提供 button 插槽。
 *
 * <h3>为什么这样换是安全的</h3>
 *
 * `formCreate.component(name, comp)` 写的是 form-create 的组件表，
 * **不是 Vue 的全局组件表**。上传三件套那种「全局注册被 80 个调用方依赖」的问题
 * 在这里不存在 —— 只有 form-create 渲染 `type: 'group'` 时才会用到它。
 *
 * <h3>按钮直接复用内核的方法</h3>
 *
 * `addIcon` / `delIcon` / `sortIcon` 都是 vm 上的方法，调它们拿到的就是内核原本的
 * vnode。自己照着重画一遍的话，卡片型子表的排序按钮是另一套结构，
 * 漏掉就成了「换了个皮肤」的视觉回归。这里只往里【加】一个复制按钮。
 *
 * <h3>虚拟滚动为什么不在这里做</h3>
 *
 * 它要控制「渲染哪些行」，而那是内核 render 里 `keys.map(...)` 的事，
 * 插槽够不着。要做就得把 fcGroup 的整个 render 连同每行子表单的生命周期、
 * 值同步、焦点保持一起重写，是另一个量级的工作。见交接文档的台账。
 */

/** 内核子表组件在 form-create 组件表里的名字 */
const KERNEL_GROUP_NAME = 'fcGroup'

/** 本模块要接管的控件类型。与契约的 subTableWidgetType 一致 */
const GROUP_TYPE = 'group'

/**
 * 造包装组件
 *
 * @param kernelGroup 内核的子表组件
 */
const createSubTableGroup = (kernelGroup: any) =>
  defineComponent({
    name: 'SubTableGroup',
    /**
     * 只声明 formCreateInject，其余十几个 props 一律走 $attrs 透传
     *
     * ⚠️ formCreateInject 必须显式声明并显式转发。form-create 装了一个**全局 mixin**
     * （`app.mixin({ props: ['formCreateInject'] })`），把它变成了每个组件的 prop ——
     * 于是它**不会**出现在 `$attrs` 里。只写 `v-bind="$attrs"` 的话内核组件收到的是
     * undefined，它的 data() 里 `this.formCreateInject.form.$form()` 当场抛异常，
     * 表现是整张表单渲染不出来（控制台只有一句 "Unhandled error during component update"，
     * 看不出跟这里有关）。这个坑花了一轮才定位到。
     *
     * 其余 props 不挨个声明：内核加一个 prop 我们就漏一个，而漏掉的表现是
     * 「属性面板配了但不生效」。
     */
    props: {
      formCreateInject: { type: Object, default: undefined }
    },
    inheritAttrs: false,
    setup(props, { attrs, slots }) {
      /**
       * 复制某一行
       *
       * 直接改 modelValue 再交给内核：它的 modelValue 侦听器会为多出来的那一项
       * 补一行规则，然后【按位置】把值重新灌一遍（setValue(keys[i], n[i])）。
       * 所以往中间 splice 是安全的，复制出来的行就落在原行下面。
       */
      const copyRow = (vm: any, index: number) => {
        if (!vm || vm.disabled) return
        const rows = Array.isArray(vm.modelValue) ? [...vm.modelValue] : []
        // 与内核的新增按钮同一套上限判断：超过 max 时它会把新增按钮藏掉，
        // 复制这条路径也得拦，否则从这里能绕过行数上限
        if (vm.max && rows.length >= vm.max) return
        // 内核 add() 会先问 onBeforeAdd。复制也是新增，同样要问 ——
        // 不问的话，业务上「满 N 行不许再加」的钩子会被复制绕过去
        if (vm.onBeforeAdd?.(vm.modelValue) === false) return
        rows.splice(index + 1, 0, duplicateRow(rows[index] ?? {}))
        vm.input(rows)
      }

      const copyButton = (vm: any, index: number) =>
        h(
          'div',
          {
            // 借内核的按钮类，尺寸与 hover 与旁边几个一致
            class: '_fc-group-btn sub-table-copy-btn',
            title: '复制本行',
            onClick: () => copyRow(vm, index)
          },
          [h(Icon, { icon: 'ep:document-copy', size: 14 })]
        )

      /**
       * 行按钮
       *
       * 顺序与内核的 makeIcon 一致（新增 / 删除 / 排序），复制插在新增之后。
       * 内核那边一旦提供了 button 插槽就【完全】不画自带按钮，
       * 所以这里必须把它们一个不落地还原回来。
       */
      const renderButtons = (scope: any) => {
        const { vm, index, total, key } = scope
        if (!vm) return []
        const buttons: any[] = []
        if ((!vm.max || total < vm.max) && total === index + 1) {
          buttons.push(vm.addIcon(key))
        }
        buttons.push(copyButton(vm, index))
        if (total > vm.min) {
          buttons.push(vm.delIcon(index, key))
        }
        if (vm.sortBtn) {
          buttons.push(...(vm.sortIcon(index, total) || []))
        }
        return buttons
      }

      return () =>
        h(
          kernelGroup,
          { ...attrs, formCreateInject: props.formCreateInject },
          { ...slots, button: (scope: any) => renderButtons(scope) }
        )
    }
  })

/**
 * 把子表控件换成带「复制本行」的版本
 *
 * @param formCreate form-create 实例
 */
export const registerSubTableGroup = (formCreate: any) => {
  // 单参调用是 getter，取内核组件本体
  const kernelGroup = formCreate?.component?.(KERNEL_GROUP_NAME)
  if (!kernelGroup) {
    // 取不到就不替换：内核升级后改了名字时，代价应当是「少一个复制按钮」，
    // 而不是「所有子表渲染不出来」。静默跳过等于悄悄丢功能，所以要留痕
    console.warn(
      `[SubTableGroup] 没找到内核子表组件(${KERNEL_GROUP_NAME})，本次不接管子表控件，` +
        '「复制本行」不可用。form-create 升级后改了组件名时会出现这种情况'
    )
    return
  }
  formCreate.component(GROUP_TYPE, createSubTableGroup(kernelGroup))
}
