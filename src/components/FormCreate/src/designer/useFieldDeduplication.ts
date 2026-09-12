/**
 * 设计器字段去重
 *
 * 复制控件时 form-create 会连同 field 一起复制，两个控件共用一个 field 的后果是：
 * 字段映射按 field 作键，两者互相覆盖；提交时后一个值盖掉前一个；发布校验也会报错。
 * 所以要在设计期就把重复的 field 换成新的。
 * 关联 issue：https://gitee.com/yudaocode/yudao-ui-admin-vue3/issues/ICM22X
 *
 * ## 相比改造前修掉的两个问题
 *
 * **1. 原实现只遍历顶层规则，递归层里的重复完全看不见。**
 * 原代码是 `designer.getRule().forEach(...)`，不下钻 children 与 props.rule。
 * 而这个功能要修的正是「复制控件」—— 用户复制的往往是一整个栅格或卡片容器，
 * 里面的字段随容器一起被复制。那些重复字段在原实现里一个都检测不到，
 * 恰好是最常见的情形没被覆盖。
 *
 * **2. 原实现用 `watch(..., { deep: true })` 侦听整棵规则树。**
 * deep watch 会递归遍历对象图为每个属性建立依赖，之后每次变更再全量重新遍历比对。
 * 100+ 控件的表单里，改一个标题、拖一下宽度都会触发全树遍历，是明确的性能杀手。
 * 现在改为侦听一个「结构签名」：只读 field / children / props.rule 三类属性，
 * Vue 因此只跟踪这几个属性 —— 既便宜，又天然地让「改标题、改属性」不再触发去重。
 *
 * ## 作用域
 *
 * 字段的唯一性是【分作用域】的，不是全表单唯一：
 * - 主作用域：所有不在子表控件内部的字段（含放在栅格、标签页等布局容器里的）
 * - 每个子表控件：各自独立的作用域
 *
 * 这与字段映射的处理一致（见 StepFormDesign 的 mappingKey）——「主表有个 remark、
 * 某张子表内部也有个 remark」是很常见的，按全表单唯一去重会把正常的设计改坏。
 */
import type { Ref } from 'vue'
import { generateUUID } from '@/utils'
import { SUB_TABLE_WIDGET_TYPE } from '@/components/FormWidgets/contracts'

/** 规则节点。只声明本模块关心的属性 */
interface RuleNode {
  type?: string
  field?: string
  children?: RuleNode[]
  props?: { rule?: RuleNode[]; [key: string]: any }
  [key: string]: any
}

/** 取某个节点的子表内部规则；不是子表控件则返回 null */
const subTableRulesOf = (node: RuleNode): RuleNode[] | null => {
  if (node.type !== SUB_TABLE_WIDGET_TYPE) {
    return null
  }
  return Array.isArray(node.props?.rule) ? node.props!.rule! : null
}

/**
 * 计算规则树的结构签名
 *
 * 只读 field / type / children / props.rule，因此 Vue 只会跟踪这些属性 ——
 * 改标题、改校验、改样式都不会让签名变化，也就不会触发去重。
 *
 * 签名里带层级和顺序信息：复制一个容器后，字段总数与排列都变了，签名必然变化。
 */
const structureSignature = (rules: RuleNode[]): string => {
  const parts: string[] = []
  const walk = (nodes: RuleNode[], depth: number) => {
    if (!Array.isArray(nodes)) {
      return
    }
    for (const node of nodes) {
      if (!node || typeof node !== 'object') {
        continue
      }
      // field 可能为 undefined（布局、展示型控件），用占位符保留位置信息
      parts.push(`${depth}:${node.field ?? '-'}`)
      const subRules = subTableRulesOf(node)
      if (subRules) {
        walk(subRules, depth + 1)
      } else if (Array.isArray(node.children)) {
        walk(node.children, depth + 1)
      }
    }
  }
  walk(rules, 0)
  return parts.join('|')
}

/** 一次去重的结果 */
export interface DeduplicationResult {
  /** 是否有字段被改名 */
  changed: boolean
  /** 被改名的字段：[原 field, 新 field] */
  renamed: Array<[string, string]>
}

/**
 * 对规则树做分作用域去重（原地修改）
 *
 * @param rules 规则树
 * @returns 去重结果
 */
export const deduplicateFields = (rules: RuleNode[]): DeduplicationResult => {
  const renamed: Array<[string, string]> = []

  /**
   * 处理一个作用域
   *
   * @param nodes 该作用域内的顶层节点
   * @param seen  该作用域已占用的 field
   */
  const walkScope = (nodes: RuleNode[], seen: Set<string>) => {
    if (!Array.isArray(nodes)) {
      return
    }
    for (const node of nodes) {
      if (!node || typeof node !== 'object') {
        continue
      }
      if (node.field) {
        if (seen.has(node.field)) {
          const oldField = node.field
          const newField = generateUUID()
          node.field = newField
          renamed.push([oldField, newField])
          seen.add(newField)
        } else {
          seen.add(node.field)
        }
      }
      const subRules = subTableRulesOf(node)
      if (subRules) {
        // 子表内部是独立作用域：新开一个 seen，不与外层共用。
        // 子表控件自身的 field 已经在外层作用域里登记过了
        walkScope(subRules, new Set<string>())
      } else if (Array.isArray(node.children)) {
        // 布局容器不改变作用域，沿用同一个 seen
        walkScope(node.children, seen)
      }
    }
  }

  walkScope(rules, new Set<string>())
  return { changed: renamed.length > 0, renamed }
}

/**
 * 挂载字段去重：监听设计器的结构变化，自动修复重复 field
 *
 * @param designer 设计器实例的 ref
 */
export const useFieldDeduplication = (designer: Ref<any>) => {
  /**
   * 防重入
   *
   * 去重后要调 setRule 把结果写回设计器，而 setRule 会重建规则、进而再次触发侦听。
   * 没有这个标志就会来回震荡。
   */
  let applying = false

  const runDeduplication = () => {
    const rules = designer.value?.getRule?.()
    if (!Array.isArray(rules) || rules.length === 0) {
      return
    }
    const result = deduplicateFields(rules)
    if (!result.changed) {
      return
    }
    applying = true
    try {
      designer.value?.setRule?.(rules)
      result.renamed.forEach(([oldField, newField]) => {
        console.log(`[FormCreate] 检测到重复字段ID：${oldField}，已自动更新为：${newField}`)
      })
    } finally {
      // 放在 finally 里：setRule 抛异常时也要把标志放开，
      // 否则去重会从此彻底停摆，而且没有任何迹象
      applying = false
    }
  }

  watch(
    () => {
      const rules = designer.value?.getRule?.()
      return Array.isArray(rules) ? structureSignature(rules) : ''
    },
    () => {
      if (applying) {
        return
      }
      runDeduplication()
    }
    // 注意：这里【不能】加 deep —— 详见文件头的说明
  )

  return { runDeduplication }
}
