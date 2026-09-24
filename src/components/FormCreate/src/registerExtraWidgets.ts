import { ElImage } from 'element-plus'
import Link from '@/components/FormCreate/src/components/Link.vue'
import PasswordInput from '@/components/FormCreate/src/components/PasswordInput.vue'
import DateRangePicker from '@/components/FormCreate/src/components/DateRangePicker.vue'
import TimeRangePicker from '@/components/FormCreate/src/components/TimeRangePicker.vue'
// 内核（vendored form-designer）自带的三个运行时渲染组件。只依赖 vue，体积极小；
// 设计器预览用的 TableView/TableFormView（拉 DragTool 等）不在这里引
import FcTitle from '@/lib/form-designer/components/FcTitle.vue'
import FcTable from '@/lib/form-designer/components/table/Table.vue'
import TableForm from '@/lib/form-designer/components/tableForm/TableForm.vue'

/**
 * 把「契约里有、form-create 却渲染不出来」的控件类型接上渲染器
 *
 * <h3>为什么必须写 form-create 自己的组件表，而不是 app.component</h3>
 *
 * form-create 解析规则时的落点是（@form-create/element-ui v3.2.38，CreateNode.h）：
 *
 * ```js
 * const isNativeTag = vm.appContext.config.isNativeTag(tag)
 * const component = this.handle.fc.prop.components[tag]      // ← form-create 自己的组件表
 * return createVNode(component || (isNativeTag ? tag : resolveComponent(tag)), data, children)
 * ```
 *
 * 两件事由此决定：
 *
 * 1. **`components[tag]` 的查找发生在 `isNativeTag` 判断之前**。规则类型会先被 `toCase`
 *    成首字母小写，于是 `Link` → `link` —— 而 `link` 是原生 HTML 标签，
 *    `resolveComponent` 这一支**根本走不到**。超链接控件因此一直渲染成一个
 *    `<link>` 空元素（void element，页面上什么都没有），而且连「组件解析失败」的
 *    告警都不会有，排查时看不出任何线索。想让它渲染成我们的组件，
 *    唯一的入口就是 form-create 的组件表。
 * 2. `resolveComponent('elImage')` 找的是 `elImage` / `ElImage`，而 `space` 这类
 *    找的是 `space` / `Space`，与 element-plus 的注册名对不上。写进组件表则是
 *    按规则类型精确命中，不依赖大小写归一的巧合。
 *
 * `formCreate.component(name, comp)` 写的是 form-create 的组件表，**不是 Vue 全局组件表** ——
 * 只有 form-create 渲染到对应 `type` 时才会用到，不影响任何直接用这些组件的调用方。
 * 这与 registerSubTableGroup 接管子表控件是同一套做法。
 *
 * <h3>这里为什么没有 text / space</h3>
 *
 * 契约里的 `text`（文字）与 `space`（间距）同样是设计器的**菜单名**而非规则类型 ——
 * 内核那两个菜单拖出来的规则都是 `type: 'div'`。但它们 storage=none、没有任何能力位，
 * 规则类型对后端不产生任何语义，所以不另造一份组件（那等于多一份会漂移的副本），
 * 让示例向设计器的实际产出看齐即可。
 *
 * 下面这几个不一样：`password` / `dateRange` / `timeRange` 的契约各自带着
 * 落库形态与能力位，后端按 `rule.type` 查它们，类型对不上就是静默错数据。
 */

/** 规则类型 → 渲染组件。键就是 form-create 规则里的 type（经 toCase 归一后的形式） */
const EXTRA_WIDGETS: Record<string, any> = {
  // 图片：内核确实产出 type: 'elImage'，只是 ElImage 从来没被注册过
  elImage: ElImage,
  // 超链接：本模块自己的控件，栽在与原生 <link> 标签重名上
  Link,
  // 下面三个：契约把它们登记成规则类型，内核只把它们当菜单名
  password: PasswordInput,
  dateRange: DateRangePicker,
  timeRange: TimeRangePicker,
  // 分组标题 / 子表 / 数据表：内核 index.js 顶层的 addComponent(...) 是【模块副作用】——
  // 以前 main.ts 同步 import FcDesigner 时顺带执行，运行时页面因此「碰巧」有这三个渲染器。
  // FcDesigner 改为按需加载后副作用不再首屏执行，已发布表单里的这三类控件就渲染成空壳。
  // 这里显式注册运行时组件，把这份隐式依赖变成显式的（键名与内核 addComponent 的 id 一致）
  FcTitle,
  FcTable,
  TableForm
}

/**
 * 注册补充控件
 *
 * @param formCreate form-create 实例
 */
export const registerExtraWidgets = (formCreate: any) => {
  Object.entries(EXTRA_WIDGETS).forEach(([type, component]) => {
    if (!component) {
      // 取不到组件就跳过并留痕。静默跳过的代价是「某个控件又变回空白」，
      // 而那种缺陷从界面上看不出是注册没做，只会以为控件坏了
      console.warn(`[ExtraWidgets] 控件[${type}]的渲染组件不可用，本次未注册`)
      return
    }
    formCreate.component(type, component)
  })
}
