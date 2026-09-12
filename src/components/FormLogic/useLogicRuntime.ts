/**
 * 联动规则的运行时
 *
 * 把求值器算出的字段状态应用到 form-create 上，并把规则赋的值写回表单数据。
 *
 * ## 它补的是什么
 *
 * B1 交付了求值器（evaluator.ts）与设计器 UI，但**运行时渲染页从没调过它** ——
 * 联动规则只在「设计器里能配」和「提交时服务端会拦」两端存在，中间的交互是空的：
 * 用户填表看不到字段显示/隐藏，也看不到必填状态变化。本模块就是那个中间环节。
 *
 * ## 前端联动是体验，服务端复校验才是约束
 *
 * 这里算出的隐藏与必填都能被绕过（构造请求直接提交）。服务端提交时会用同一份规则
 * 重算一遍并据此丢弃/拒绝，两端共用 logic-cases.json 保证结论一致。
 * 所以本模块的目标只有一个：让用户**当场看到**规则在生效。
 *
 * ## 只处理主表作用域的规则
 *
 * `rowScope` 非空的行作用域规则（B5 加的）不在这里处理 —— 它要对子表的每一行
 * 各算一次并把状态应用到某一行的某一格上，而 form-create 的字段 API 是按
 * 字段名寻址的，寻不到「第 3 行的备注」。行作用域规则目前由服务端兜住
 * （提交时照样拦），不做前端反馈。
 */

import { computed, ref, watch } from 'vue'
import { evaluateLogicRules } from './evaluator'
import type { FieldState, LogicRule, LogicTrigger } from './types'
import { readNestedRules } from '@/components/FormWidgets/contracts'

/** 运行时依赖的外部能力。全部以 getter 传入，避免把响应式对象的所有权搬进本模块 */
export interface LogicRuntimeOptions {
  /** 联动规则 */
  rules: () => LogicRule[] | null | undefined
  /** 表单规则树（已解码），用于取字段的基础必填状态 */
  formRule: () => any[] | null | undefined
  /** 表单数据 */
  formData: () => Record<string, any>
  /** form-create 的 api 实例 */
  api: () => any
  /**
   * 是否启用。详情态传 false ——
   * 详情态所有字段都已置为禁用，再跑一遍联动只会白白改一堆状态
   */
  enabled?: () => boolean
}

/** 已应用的状态，用于跳过没变化的字段 */
type AppliedState = Record<string, FieldState>

/**
 * 从表单规则树里取每个字段的基础状态
 *
 * 递归：字段可能在布局容器或子表里。
 * required 取自控件的 `$required` —— 与服务端 FormLogicGuard 的取法一致，
 * 两边基础状态不同会让同一份规则算出不同结论。
 */
export const collectBaseState = (rules: any[] | null | undefined): AppliedState => {
  const result: AppliedState = {}
  const walk = (list: any[] | null | undefined) => {
    if (!Array.isArray(list)) return
    for (const rule of list) {
      if (!rule || typeof rule !== 'object') continue
      if (rule.field) {
        result[rule.field] = {
          visible: true,
          editable: true,
          required: rule.$required === true
        }
      }
      walk(readNestedRules(rule))
      walk(rule.children)
    }
  }
  walk(rules)
  return result
}

/** 收集规则里出现过的字段：条件的左值、FIELD 类型的右值、动作的目标 */
const collectTouchedFields = (rules: LogicRule[]): string[] => {
  const fields = new Set<string>()
  const walkGroup = (group: any) => {
    for (const node of group?.items ?? []) {
      if (!node) continue
      if (node.logic !== undefined || node.items !== undefined) {
        walkGroup(node)
        continue
      }
      if (node.field) fields.add(node.field)
      if (String(node.valueType ?? '').toUpperCase() === 'FIELD' && typeof node.value === 'string') {
        fields.add(node.value)
      }
    }
  }
  for (const rule of rules) {
    walkGroup(rule.when)
    for (const action of [...(rule.then ?? []), ...(rule.otherwise ?? [])]) {
      if (action?.target) fields.add(action.target)
    }
  }
  return [...fields]
}

export const useLogicRuntime = (options: LogicRuntimeOptions) => {
  /** 只保留主表作用域且启用的规则 */
  const applicableRules = computed<LogicRule[]>(() =>
    (options.rules() ?? []).filter((rule) => rule && rule.enabled !== false && !rule.rowScope)
  )

  const baseState = computed(() => collectBaseState(options.formRule()))

  /** 上一次应用过的状态。用来跳过没变化的字段 */
  const applied = ref<AppliedState>({})

  /**
   * 防重入
   *
   * 应用状态与写回数据都会触发侦听，没有这个标志会来回震荡。
   * 与 useFormulaRuntime 里的做法一致。
   */
  let running = false

  /**
   * 把状态应用到 form-create
   *
   * 只对**变化过的**字段调 api：`hidden` / `display` 内部会触发整表刷新，
   * 无条件全量应用会让每次输入都刷一遍表单，大表单上就是可感的卡顿。
   */
  const applyState = (state: AppliedState) => {
    const api = options.api()
    if (!api) return
    for (const [field, next] of Object.entries(state)) {
      const prev = applied.value[field]
      if (prev && prev.visible === next.visible && prev.editable === next.editable
          && prev.required === next.required) {
        continue
      }
      try {
        // 用 hidden 而不是 display：hidden 的字段不参与校验。
        // display 只是 CSS 隐藏，一个隐藏的必填字段会让表单永远提交不了，
        // 而用户看不到是哪个字段在拦他
        api.hidden?.(!next.visible, field)
        api.disabled?.(!next.editable, field)
        // 必填状态改 $required：form-create 的必填校验就是从它派生的
        api.updateRule?.(field, { $required: next.required })
      } catch (e) {
        // 单个字段应用失败不该让整轮联动中断 —— 剩下的字段还要处理。
        // 最常见的原因是规则里引用了已被删掉的字段
        console.warn('[FormLogic] 应用字段状态失败：', field, e)
      }
      applied.value[field] = { ...next }
    }
  }

  /**
   * 把规则赋的值写回表单
   *
   * 走 `api.setValue` 而不是直接改 formData 对象：form-create 内部维护着自己的
   * 一份值，直接改外层对象它不一定跟上，表现为「数据里有值但界面上是空的」。
   */
  const writeBackData = (next: Record<string, any>) => {
    const api = options.api()
    const current = options.formData() ?? {}
    const changed: Record<string, any> = {}
    for (const [field, value] of Object.entries(next)) {
      if (current[field] !== value) {
        changed[field] = value
      }
    }
    if (!Object.keys(changed).length) return
    try {
      api?.setValue?.(changed)
    } catch (e) {
      console.warn('[FormLogic] 回写联动赋值失败', e)
    }
  }

  /** 跑一轮求值 */
  const run = (trigger: LogicTrigger) => {
    if (options.enabled && !options.enabled()) return
    if (running || !applicableRules.value.length) return
    running = true
    try {
      const result = evaluateLogicRules(
        applicableRules.value,
        trigger,
        options.formData() ?? {},
        baseState.value
      )
      applyState(result.state)
      writeBackData(result.data)
      if (!result.stable) {
        // 不抛异常：一条配歪的规则不该让填表中断。发布校验里有环检测拦这种配置
        console.warn('[FormLogic] 联动规则未收敛，可能存在互相翻转的规则')
      }
    } finally {
      // 放在 finally：求值抛异常时也要把标志放开，否则联动会从此彻底停摆
      running = false
    }
  }

  /** 表单打开后调一次，让 LOAD 时机的规则生效 */
  const runOnLoad = () => {
    // 应用记录要清掉：换一条记录编辑时，上一条的状态不能算作「已应用」，
    // 否则相同的状态会被当成没变化而跳过，界面停留在上一条的样子
    applied.value = {}
    run('LOAD')
    // LOAD 之后紧接着按 CHANGE 再算一遍：带出数据后的状态才是用户该看到的。
    // 两个时机的规则集通常不同（LOAD 只跑一次，CHANGE 每次值变都跑）
    run('CHANGE')
  }

  // 只侦听规则真正碰到的字段，不对 formData 做 deep watch ——
  // 后者要遍历整棵数据树，大表单上每敲一个字都要全量比对
  watch(
    () => {
      const data = options.formData() ?? {}
      return collectTouchedFields(applicableRules.value).map((field) => data[field])
    },
    () => run('CHANGE')
  )

  return { run, runOnLoad, applicableRules }
}
