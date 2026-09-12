import { Ref } from 'vue'

/**
 * 把设计器菜单产出的规则类型对齐到控件契约
 *
 * <h3>问题：菜单名不等于规则类型</h3>
 *
 * 契约（form-widget-contracts.json）里的 `type` 是**规则里的 type**，后端
 * FormValueSerializer / 发布校验都按它查落库形态与能力位。前端的 `hiddenItem`
 * 则把同一个字符串当**设计器菜单名**用。绝大多数控件两者恰好同名，所以一直没出事。
 *
 * 但内核的这三个菜单不是：
 *
 * | 菜单名(= 契约 type) | 内核 rule() 产出的 type          |
 * |---------------------|----------------------------------|
 * | `password`          | `input` + props.type='password'  |
 * | `dateRange`         | `datePicker` + props.type='...range' |
 * | `timeRange`         | `timePicker` + props.isRange     |
 *
 * 后果不是「少个渲染器」这么轻：契约里 `dateRange` 是 valueType=array、
 * storage=delimited（一列存两头），而 `datePicker` 是 valueType=date、storage=scalar。
 * 从菜单拖一个日期区间出来，后端查到的是 datePicker 那一行 ——
 * **一个数组被当标量往日期列里写，而且全程不报错**。
 * `password` 同理：契约刻意关掉了它的列表列 / 查询 / 导出三个能力位
 * （密码字段出现在列表或导出文件里本身就是缺陷），类型是 `input` 的话这三条一条都不生效。
 *
 * <h3>做法：只换 rule() 的 type，其余一律不碰</h3>
 *
 * 原地包一层原菜单项的 `rule()`，把产出的 `type` 改成契约类型。
 * `label` / `icon` / `props()` 属性面板 / `input` 等全部沿用内核的 —— 不重写就不会漂移。
 *
 * 之所以是**原地改**而不是 `addComponent` 一个新对象：`addComponent` 见到
 * `menu` 字段会再往左侧面板追加一个同名菜单项（左侧会冒出两个「密码输入」），
 * 而把 `menu` 去掉又会让 `_menu` 与内核原项不一致。改原对象两个问题都没有 ——
 * 菜单列表与 dragRuleList 里放的本来就是同一个对象。
 *
 * 渲染器在 registerExtraWidgets.ts 里补，两处缺一不可：只对齐类型而没有渲染器，
 * 拖出来的控件会变成一个空白的未知元素。
 *
 * <h3>存量表单不受影响</h3>
 *
 * 已经存下来的规则（type 是 input / datePicker / timePicker）照旧按原类型渲染与落库，
 * 不需要迁移。本改动只影响**此后新拖的控件**。
 */

/** 设计器菜单名 → 契约里的规则类型。两边同名，差的是内核 rule() 产出的 type */
const MENU_TO_CONTRACT_TYPE: Record<string, string> = {
  password: 'password',
  dateRange: 'dateRange',
  timeRange: 'timeRange'
}

/** 已对齐过的标记，避免热更新或重复挂载时反复包裹 */
const ALIGNED_FLAG = '__contractTypeAligned'

export const alignContractWidgetTypes = (designer: Ref) => {
  const dragRuleList = designer.value?.dragRuleList
  if (!dragRuleList) {
    console.warn('[ContractWidgetType] 取不到设计器的控件清单，本次未对齐规则类型')
    return
  }
  Object.entries(MENU_TO_CONTRACT_TYPE).forEach(([menuName, type]) => {
    const menu = dragRuleList[menuName]
    if (!menu || typeof menu.rule !== 'function') {
      // 内核升级后改了菜单名时，代价应当是「少一次对齐」，而不是设计器打不开。
      // 但必须留痕：静默跳过会让落库形态悄悄退回错的那一种
      console.warn(
        `[ContractWidgetType] 没找到设计器菜单项(${menuName})，其规则类型未对齐到契约。` +
          '@form-create/designer 升级后改了菜单名时会出现这种情况'
      )
      return
    }
    if (menu[ALIGNED_FLAG]) {
      return
    }
    const originalRule = menu.rule
    menu.rule = function alignedRule(this: any, ...args: any[]) {
      return { ...originalRule.apply(this, args), type }
    }
    menu[ALIGNED_FLAG] = true
  })
}
