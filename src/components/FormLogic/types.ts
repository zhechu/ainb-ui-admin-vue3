/**
 * 联动规则的类型定义
 *
 * 与后端 `framework/formdesign/core/logic/LogicRule.java`、`LogicEnums.java` 一一对应。
 * 两侧读同一份用例集（logic-cases.json）保证求值行为一致。
 */

/** 触发时机 */
export type LogicTrigger =
  /** 表单加载完成时 */
  | 'LOAD'
  /** 字段值变化时 */
  | 'CHANGE'
  /** 提交前。服务端复校验用的就是这个时机 */
  | 'SUBMIT'

/** 条件组的逻辑运算 */
export type GroupLogic = 'AND' | 'OR'

/** 条件右值的来源 */
export type ConditionValueType = 'CONST' | 'FIELD'

/** 条件操作符 */
export type LogicOperator =
  | 'EQ'
  | 'NE'
  | 'GT'
  | 'GE'
  | 'LT'
  | 'LE'
  | 'IN'
  | 'NOT_IN'
  | 'CONTAINS'
  | 'NOT_CONTAINS'
  | 'STARTS_WITH'
  | 'ENDS_WITH'
  | 'EMPTY'
  | 'NOT_EMPTY'
  | 'BETWEEN'

/** 动作类型 */
export type LogicActionType =
  | 'SHOW'
  | 'HIDE'
  | 'ENABLE'
  | 'DISABLE'
  | 'READONLY'
  | 'EDITABLE'
  | 'REQUIRE'
  | 'OPTIONAL'
  | 'SET_VALUE'
  | 'CLEAR_VALUE'

/** 条件树节点：要么是条件，要么是嵌套组。靠有没有 logic/items 区分 */
export interface ConditionNode {
  // 作为嵌套组时
  logic?: GroupLogic
  items?: ConditionNode[]
  // 作为条件时
  field?: string
  operator?: string
  valueType?: string
  value?: any
}

/** 条件组 */
export interface ConditionGroup {
  logic?: GroupLogic
  items?: ConditionNode[]
}

/** 动作 */
export interface LogicAction {
  type: string
  target: string
  payload?: Record<string, any>
}

/** 联动规则 */
export interface LogicRule {
  id: string
  name?: string
  /** 缺省视为启用 —— 少写一个布尔不该让规则静默失效 */
  enabled?: boolean
  trigger?: LogicTrigger
  /**
   * 行作用域：本规则作用在哪个子表的明细行上
   *
   * 为空表示作用在主表字段上（常规规则）。有值时，规则会对该子表的【每一行】
   * 各求值一次，条件与动作里的字段名指的都是明细列。
   *
   * 服务端（B5）已经按行求值并在提交时拦下不合规的明细。
   * **前端运行时不处理行作用域规则** —— form-create 的字段 API 按字段名寻址，
   * 寻不到「第 3 行的备注」。见 useLogicRuntime 的说明。
   *
   * ⚠️ 这个字段原先只加在后端（LogicRule.java），前端类型漏了 ——
   * 而本文件声称与后端一一对应。类型漏了不会报错，只会让设计器里配的
   * rowScope 在前端各处被当作不存在。
   */
  rowScope?: string
  /** 为空视为恒真 */
  when?: ConditionGroup | null
  then?: LogicAction[]
  /**
   * 条件不满足时执行的动作
   *
   * 这一支是必要的：只写 then 是同类产品最常见的坑 ——
   * 条件从满足变回不满足时字段不会恢复。
   */
  otherwise?: LogicAction[]
}

/** 单个字段的状态 */
export interface FieldState {
  visible: boolean
  editable: boolean
  required: boolean
}

/** 求值结果 */
export interface EvaluationResult {
  /** 各字段的最终状态 */
  state: Record<string, FieldState>
  /** 规则赋值后的数据。入参不会被修改 */
  data: Record<string, any>
  /** 是否在最大轮数内收敛。false 说明可能存在环形赋值 */
  stable: boolean
  /** 实际迭代轮数，排查用 */
  passes: number
}
