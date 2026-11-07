/**
 * 「选项写在规则的哪个路径上」与「选项的值键叫什么」—— 纯数据 + 纯函数，零依赖
 *
 * <h3>🔴 为什么从 {@code optionSource.ts} 里搬出来</h3>
 * 那张表原本住在 {@code optionSource.ts}，而那个模块 value-import 了 {@code @/utils/dict}，
 * 后者在**模块顶层**就调 {@code useDictStoreWithOut()} 建 pinia store。后果是：
 * 任何想在 vitest 里测这张表的模块，都会在**收集阶段**就以
 * 「没有活动的 pinia」/「window is not defined」死掉（本仓 vitest 是 node 环境，没有 jsdom）。
 *
 * <p>启凌智估的扩展字段（I29）要把 {@code qlzg_field_def} 的行翻译成 form-create 规则，
 * 翻译时**必须**知道「select 的选项放 {@code rule.options}、cascader 的放
 * {@code rule.props.options}」—— 与这里描述的是同一件事。
 * 于是在它自己那份 {@code extFieldRule.ts} 里复制一份，是最省事也最坏的做法：
 * 两份表漂了之后，表现是「字段管理页配了 5 个选项，表单上一个都不显示」，
 * 而它**不报错**（写错路径只是往一个没人读的属性上塞了个数组）。
 *
 * <p>{@link renameValueKey} 是后来跟着搬过来的，理由一模一样：
 * 「树形控件的值键是 {@code id} 不是 {@code value}」这件事，扩展字段的规则构造器也要知道，
 * 而它漂了之后的表现是「树形控件渲染出来了、但一个节点都选不中」，同样不报错。
 *
 * <p>所以搬出来。{@code optionSource.ts} 原样 re-export，既有的 import 一处都不用改。
 *
 * <h3>三个键的含义</h3>
 * <ul>
 *   <li>{@code path}：选项该写到规则的哪个属性（与设计器内置选项编辑器写的是同一个位置）</li>
 *   <li>{@code tree}：控件本身是否支持层级</li>
 *   <li>{@code valueKey}：选项对象里「值」用哪个键。🔴 树形控件默认 nodeKey 是 {@code id}，
 *       写成 {@code value} 的话节点没有 key，选中、回显、勾选全都会失灵</li>
 * </ul>
 */

/** 一个支持「选项数据源」的控件，以及它的选项落点 */
export interface OptionSourceTarget {
  path: string
  tree: boolean
  valueKey: string
}

/**
 * 支持选项数据源的六个内置控件
 *
 * ⚠️ 键就是 form-create 规则里的 {@code type}。少一个键的后果不是报错，
 *    而是那个控件**安安静静地拿不到选项**（字典 / 接口 / 静态三条路径都靠它定位落点）。
 */
export const OPTION_SOURCE_TARGETS: Record<string, OptionSourceTarget> = {
  select: { path: 'options', tree: false, valueKey: 'value' },
  radio: { path: 'options', tree: false, valueKey: 'value' },
  checkbox: { path: 'options', tree: false, valueKey: 'value' },
  cascader: { path: 'props.options', tree: true, valueKey: 'value' },
  elTreeSelect: { path: 'props.data', tree: true, valueKey: 'value' },
  tree: { path: 'props.data', tree: true, valueKey: 'id' }
}

/**
 * 按 'a.b' 形式的路径从对象上读值
 *
 * ⚠️ 路径中途断了**原样返回那个断点**（缺键是 {@code undefined}、显式 null 就还是 {@code null}），
 * 不抛错也不归一。调用方判空请用 {@code == null}，别用 {@code === undefined}。
 */
export const readByPath = (target: any, path: string): any =>
  path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), target)

/** 按 'a.b' 形式的路径往对象上写值，中途缺的对象会被建出来 */
export const writeByPath = (target: any, path: string, value: any): void => {
  const keys = path.split('.')
  const last = keys.pop()!
  let cursor = target
  keys.forEach((key) => {
    if (!cursor[key]) {
      cursor[key] = {}
    }
    cursor = cursor[key]
  })
  cursor[last] = value
}

/** 一个选项节点。`children` 只有树形控件会有 */
export interface OptionNode {
  label: string
  value: any
  children?: OptionNode[]
}

/**
 * 把 `{label, value}` 结构改写成目标控件要求的键名
 *
 * 🔴 只有 {@code valueKey !== 'value'} 时才真的改写 —— 目前只有 {@code tree}（{@code id}）。
 *    改写时**只保留 label 与那个值键**，其余键一律丢掉：控件认的就是这两个，
 *    多带一个键会被透传成 DOM 属性。
 *
 * <p>⚠️ 递归是要的：级联与树形控件的选项带 {@code children}，只改顶层会让子节点
 *    仍然用 {@code value} 当 key，表现是「一级能选、二级选不中」，而且不报错。
 */
export const renameValueKey = (options: OptionNode[], valueKey: string): any[] => {
  if (valueKey === 'value') {
    return options
  }
  const map = (list: OptionNode[]): any[] =>
    list.map((item) => {
      const next: any = { label: item.label, [valueKey]: item.value }
      if (item.children?.length) {
        next.children = map(item.children)
      }
      return next
    })
  return map(options)
}
