/**
 * 步骤条容器
 *
 * 设计方案 §5.8 要的「布局容器，支持每步校验通过才能下一步」。
 *
 * ## 与 stepValidate 的关系
 *
 * `stepValidate.ts` 是这条能力的**上一版交付**：当时把「每步校验通过才能下一步」
 * 挂在了标签页容器上（用 el-tabs 的 before-leave），因为那条校验才是分步真正稀缺的
 * 部分，而横条样式的容器是另一个量级的工作。现在容器做出来了，两者并存：
 *
 * - 标签页 + 分步校验：已有表单继续用，不动它
 * - 步骤条容器：新表单要横条样式与上一步/下一步按钮时用这个
 *
 * 两边的校验语义刻意保持一致（**只拦往后走，不拦往回退**），否则同一个产品里
 * 两种分步的行为不同，用户会觉得其中一个坏了。
 *
 * ## 校验函数为什么由运行时注入
 *
 * 与 stepValidate 同一个理由：**设计器里不能有校验**。设计器画布也会渲染这个容器，
 * 若容器自带校验，设计者点「下一步」会被自己表单的必填项拦住 —— 他只是想看看
 * 第二步长什么样。所以容器只认 `props.validateStep`，而那个函数只在运行时
 * （`render/index.vue`）被挂上去。
 */

/** 步骤条容器与步骤的控件类型，与控件契约一致 */
export const STEPS_WIDGET_TYPE = 'FormSteps'
export const STEP_WIDGET_TYPE = 'FormStep'

/** 校验一批字段。实现由运行时注入 —— 本模块不认识 form-create 的 api */
export type StepFieldsValidator = (fields: string[]) => Promise<boolean>

/**
 * 收集一个步骤里的所有字段（含嵌套在栅格、卡片里的）
 *
 * 遇到嵌套的步骤条就停：那是另一个容器的事，把它的字段算进来会让
 * 外层的「这一步没填完」把内层还没走到的步骤也一起要求填了。
 */
export const collectStepFields = (node: any, out: string[] = []): string[] => {
  if (!node || typeof node !== 'object') return out
  if (node.field && node.type !== STEP_WIDGET_TYPE) {
    out.push(node.field)
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child?.type === STEPS_WIDGET_TYPE) continue
      collectStepFields(child, out)
    }
  }
  return out
}

/**
 * 给步骤条容器挂上校验函数
 *
 * @param rules    规则树，会被就地修改
 * @param validate 校验函数
 *
 * 只挂在 `props.stepValidate !== false` 的容器上 —— 属性面板的默认值是开，
 * 用户显式关掉时就不挂，容器那边取不到函数即视为不校验。
 */
export const applyStepsValidate = (
  rules: any[] | null | undefined,
  validate: StepFieldsValidator
): void => {
  const walk = (list: any[] | null | undefined) => {
    if (!Array.isArray(list)) return
    for (const rule of list) {
      if (!rule || typeof rule !== 'object') continue
      if (rule.type === STEPS_WIDGET_TYPE && rule.props?.stepValidate !== false) {
        rule.props = { ...(rule.props ?? {}), validateStep: validate }
      }
      walk(rule.children)
    }
  }
  walk(rules)
}
