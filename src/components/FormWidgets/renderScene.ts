/**
 * 渲染场景开关
 *
 * 每个字段可以配置「在哪些场景出现」。替代按端硬编码可见性（pc / app）——
 * 本项目没有独立 App 端，那个维度是无效复杂度，而「同一个字段填的时候要、
 * 看详情时不要」是真实需求。
 *
 * ## 只做真的会生效的场景
 *
 * 设计方案 §7.3 列了六个场景（表单 / 列表 / 详情 / 打印 / 审批 / 导出）。
 * 这里只实现**表单**与**详情**两个，因为只有这两个是本模块的渲染页在管的：
 *
 * - **列表与导出**由列表设计步骤的列配置决定。再给一套场景开关，
 *   就成了两处配同一件事，用户改了 A 处不生效会一路找到 B 处
 * - **打印**要等打印模板（B9）落地
 * - **审批**是流程模块的字段权限，不在本模块
 *
 * 少给几个选项，好过给一个勾了不生效的复选框 —— 后者比没有这个功能更糟。
 *
 * ## 缺省是「全都出现」
 *
 * 没配过 scenes 的字段在所有场景都出现。存量表单里没有这个属性，
 * 缺省成「哪都不出现」会让所有已发布的表单瞬间变成空白。
 */

import { readNestedRules } from '@/components/FormWidgets/contracts'

/** 目前真的会生效的场景 */
export type RenderScene = 'form' | 'detail'

/** 设计器下拉用的清单 */
export const RENDER_SCENE_OPTIONS: Array<{ value: RenderScene; label: string }> = [
  { value: 'form', label: '新增 / 编辑' },
  { value: 'detail', label: '详情' }
]

/**
 * 字段在某个场景下是否出现
 *
 * @param rule  规则节点
 * @param scene 当前场景
 */
export const isVisibleInScene = (rule: any, scene: RenderScene): boolean => {
  const scenes = rule?.props?.scenes
  // 没配过：所有场景都出现
  if (!Array.isArray(scenes) || scenes.length === 0) return true
  return scenes.includes(scene)
}

/**
 * 按场景过滤规则树
 *
 * 产出一棵**新的**树：被过滤掉的字段直接不在里面，而不是标 hidden。
 *
 * <h3>为什么是「删掉」而不是「隐藏」</h3>
 *
 * 标 hidden 的字段仍在规则树里，联动规则的 SHOW 动作、脚本的 setVisible
 * 都能把它重新显示出来 —— 场景开关就被绕过了。而它表达的是「这个场景里
 * 根本没有这个字段」，比任何运行时规则都更靠前。
 *
 * 删掉也不会影响保存：本模块的更新是部分更新（只写提交上来的列），
 * 表单里没出现的字段不会被置空。
 *
 * <h3>容器节点不按自己的场景删</h3>
 *
 * 容器（栅格、卡片）通常没有 field，给它配场景意义不大；但如果配了，
 * 整个容器连同里面的字段一起消失 —— 这是符合直觉的。
 *
 * @returns 过滤后的新树。节点对象本身是复用的（只有 children / 嵌套规则被重建）
 */
export const filterRulesByScene = (
  rules: any[] | null | undefined,
  scene: RenderScene
): any[] => {
  if (!Array.isArray(rules)) return []
  const result: any[] = []
  for (const rule of rules) {
    // ⚠️ 字符串/数字是 form-create 的**文本子节点**，不是规则对象。
    // 按钮、标签、文字、自定义 HTML 这几个控件的文案全都放在 children 里
    // （内核的规则就是 `children: ['按钮文字']`），一律 continue 会把它们吃掉 ——
    // 表现是控件渲染出来了、里面却是空的：一个没有字的按钮、一个空标签。
    // 这类节点没有场景可言，原样留下
    if (typeof rule === 'string' || typeof rule === 'number') {
      result.push(rule)
      continue
    }
    if (!rule || typeof rule !== 'object') continue
    if (!isVisibleInScene(rule, scene)) continue

    const children = Array.isArray(rule.children)
      ? filterRulesByScene(rule.children, scene)
      : undefined
    const nested = readNestedRules(rule)
    const nestedFiltered = nested ? filterRulesByScene(nested, scene) : undefined

    if (!children && !nestedFiltered) {
      // 没有下级，直接复用原节点，避免无谓的对象复制
      result.push(rule)
      continue
    }
    // 有下级时才浅拷贝：改原节点会污染完整树，而完整树要给别的场景用
    const copy: any = { ...rule }
    if (children) copy.children = children
    if (nestedFiltered) {
      copy.props = { ...(rule.props ?? {}), rule: nestedFiltered }
    }
    result.push(copy)
  }
  return result
}

/**
 * 「出现场景」的属性面板项
 *
 * ⚠️ 放在这里而不是某个 useXxxRule 里，是因为它有【两个】注册方：
 * 输入类控件走 useInputEnhanceRule，选项类控件走 useOptionSource
 * （那六个控件的属性面板已经被选项来源改造过了）。
 *
 * 同一个控件调两次 `setComponentRuleConfig`，**后一次会把前一次整个覆盖掉**。
 * 曾经就是这么把选项来源的改造弄没的 —— 而且不报错，只是属性面板里
 * 少了「数据字典 / 数据接口」两个分支，e2e 才发现。
 * 所以每个控件只能有一个注册方，需要加项的人把这个函数的产物拼进去。
 */
export const buildScenePropRule = () => ({
  type: 'select',
  field: 'scenes',
  title: '出现场景',
  info: '不选表示所有场景都出现。列表与导出请到「列表设计」步骤配置',
  props: { multiple: true, clearable: true },
  options: RENDER_SCENE_OPTIONS
})

/**
 * 收集配了场景开关的字段，供设计期体检与排查用
 *
 * @returns 字段 → 它出现的场景
 */
export const collectSceneConfig = (
  rules: any[] | null | undefined
): Record<string, RenderScene[]> => {
  const result: Record<string, RenderScene[]> = {}
  const walk = (list: any[] | null | undefined) => {
    if (!Array.isArray(list)) return
    for (const rule of list) {
      if (!rule || typeof rule !== 'object') continue
      const scenes = rule.props?.scenes
      if (rule.field && Array.isArray(scenes) && scenes.length) {
        result[rule.field] = scenes
      }
      walk(readNestedRules(rule))
      walk(rule.children)
    }
  }
  walk(rules)
  return result
}
