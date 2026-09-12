/**
 * 自定义按钮
 *
 * 运行时的按钮此前固定为四个（新增 / 编辑 / 删除 / 导出），业务上常见的
 * 「跳到关联报表并带上本行单号」「打开外部系统的对应页面」这类动作无处可放，
 * 只能改渲染页的代码 —— 那等于放弃了低代码。
 *
 * ## 可见条件复用联动规则的条件模型
 *
 * `visibleWhen` 就是 `ConditionGroup`，与联动规则、跨字段校验共用同一棵条件树、
 * 同一个求值器（`matchesGroup`）、同一个编辑器组件（`ConditionGroupEditor`）。
 * 另造一套的话，「大于」在三处的语义迟早会漂。
 *
 * ## ⚠️ permission 只是界面级的
 *
 * 它决定「这个按钮画不画出来」，不构成任何服务端约束。按钮的动作自己该带什么权限，
 * 由那个动作的接口去管（跳转动作根本不调后端）。把它当访问控制会是彻底的安全假象。
 */
import type { ConditionGroup } from '@/components/FormLogic/types'
import { matchesGroup } from '@/components/FormLogic/evaluator'
import { resolveLinkUrl } from '@/components/FormWidgets/linkUrl'

/** 按钮位置 */
export type ButtonPosition = 'TOOLBAR' | 'ROW' | 'DETAIL'

/**
 * 动作类型
 *
 * 另两种没做：导出已由内置按钮覆盖；触发流程要跨到 bpm，
 * 且得先定「表单数据怎么映射成流程变量」。
 */
export type ButtonActionType = 'NAVIGATE' | 'INVOKE'

/** 入参映射：接口的参数名 ← 本表单的字段名 */
export interface ButtonParamMapping {
  name: string
  field: string
}

export interface ButtonAction {
  type: ButtonActionType
  /** 跳转地址，支持 {字段} 插值。仅 NAVIGATE */
  url?: string
  /** _self 当前页 / _blank 新窗口。仅 NAVIGATE */
  target?: string
  /**
   * 数据接口编码。仅 INVOKE
   *
   * ⚠️ 运行时【不发】它 —— 服务端从已发布的表单配置里读。前端发的是按钮标识。
   * 让前端指定接口编码的话，那个端点就变成「任何对某张表单有 update 权限的人
   * 都能调任意写型数据接口」。这里存它只是为了设计器回显
   */
  interfaceCode?: string
  /** 入参映射。仅 INVOKE。同样由服务端解析，前端不发值 */
  params?: ButtonParamMapping[]
  /** 成功提示语。仅 INVOKE */
  successMessage?: string
}

export interface CustomButton {
  key: string
  label: string
  icon?: string
  position: ButtonPosition
  action: ButtonAction
  /** 可见条件。⚠️ 只对 ROW / DETAIL 生效 —— 工具栏没有「当前记录」可以求值 */
  visibleWhen?: ConditionGroup | null
  /** 权限点。仅控制按钮是否画出来 */
  permission?: string
}

/**
 * 解析按钮配置
 *
 * 解析失败返回空数组：一份坏掉的配置不该让整个列表页打不开。
 */
export const parseCustomButtons = (json?: string | null): CustomButton[] => {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 取某个位置上的按钮
 */
export const buttonsAt = (buttons: CustomButton[], position: ButtonPosition): CustomButton[] =>
  buttons.filter((btn) => btn?.position === position)

/**
 * 判断一个按钮此刻是否可见
 *
 * @param row 当前记录。TOOLBAR 位置没有记录，传 undefined
 *
 * ## 工具栏上的条件被忽略，而不是判成「不可见」
 *
 * 工具栏在列表页上，没有「当前记录」可以求值。判成不可见的话，用户配了一条
 * 无意义的条件之后按钮就消失了，而他不会想到是这个原因 —— 那是一次
 * 「配了就坏掉」。忽略它至少让按钮还在。发布校验不拦这种配置，同样是这个理由。
 */
export const isButtonVisible = (
  button: CustomButton,
  row?: Record<string, any>
): boolean => {
  if (!button?.visibleWhen) return true
  if (!row) return true
  return matchesGroup(button.visibleWhen, row)
}

/**
 * 算出跳转地址
 *
 * 直接复用超链接控件那套 `resolveLinkUrl`（插值 + URL 编码 + 协议白名单）——
 * 自己再写一遍的话，两处的白名单迟早会漂，而漂掉的那一处就是一个
 * 「点了执行任意脚本」的入口。
 *
 * 那套实现里的两道防线各管一段：
 *
 * - **插值时对值做 URL 编码**：字段值里带 `javascript:` 时，冒号被编码成 `%3A`，
 *   它就不再是协议而是一段相对路径（点开是 404）。这一道挡住的是「值」
 * - **白名单校验协议**：挡住的是设计者在模板里直接写死的 `javascript:` / `data:`
 *
 * ⚠️ 两道缺一不可。哪天为了让地址里能带 `&` 而去掉插值的编码，
 * 白名单并不会替它兜住 —— 它看到的是插值后的完整串，而那时冒号已经生效了。
 * `customButton.spec.ts` 里有一条用例专门把这件事钉住。
 *
 * @returns 地址；不安全或算不出来时返回空串
 */
export const resolveButtonUrl = (
  button: CustomButton,
  row?: Record<string, any>
): string => resolveLinkUrl(button?.action?.url, row ?? {})
