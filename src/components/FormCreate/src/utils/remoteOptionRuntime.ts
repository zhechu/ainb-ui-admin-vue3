/**
 * 数据接口选项的运行时重取
 *
 * ## 它补的是一个「配了但不生效」的断点
 *
 * 设计器支持把接口入参绑定到表单字段（选了部门，人员下拉跟着变），
 * 发布校验甚至会拦「入参引用了不存在的字段」。但运行时只在**加载表单那一刻**
 * 解析过一次选项，而且那次**没有传表单值** —— 于是绑了字段的入参永远是空的，
 * 接口按空值查、返回空列表，那个下拉从头到尾一个选项都没有。
 *
 * 配置读得到、界面也渲染了下拉、发布还校验通过了，就是取不到数。
 * 这正是本模块反复踩的那类断点：**接线做完了，但没有调用方**。
 *
 * ## 依赖变了要不要清掉已选值
 *
 * 要，但**只在用户改了依赖字段时清**。换了部门，原来选的那个人多半不在新部门里，
 * 留着会存进一条「部门是市场部、人员是研发部某人」的数据，而且不报错。
 *
 * 打开一条已有记录时**不能清**：那次重取是为了把已保存的值对应的选项加载出来，
 * 清掉等于一打开详情就把人员字段抹了。所以初次解析与依赖变更走两个入口。
 */
import { collectRemoteOptionTasks, resolveRemoteOptionTask } from './optionSource'

export interface RemoteOptionRuntime {
  /** 所有被入参引用到的表单字段，调用方据此决定 watch 什么 */
  dependentFields: string[]
  /** 带着当前表单值重解析全部「有依赖」的任务。用于打开表单时 */
  resolveDependent(): Promise<void>
  /**
   * 某些字段变了，重解析依赖它们的任务
   *
   * @returns 被重取过选项的字段名，调用方据此清掉这些字段的已选值
   */
  refreshByFields(changed: string[]): Promise<string[]>
}

/**
 * @param rules        规则树。解析结果是**原地写回规则对象**的
 * @param getFormValue 取当前表单某个字段的值
 */
export const createRemoteOptionRuntime = (
  rules: any[],
  getFormValue: (field: string) => any
): RemoteOptionRuntime => {
  const tasks = collectRemoteOptionTasks(rules ?? [])
  // 没有入参依赖的任务在加载时已经解析过了，不需要再管
  const dependent = tasks.filter((task) => task.dependsOn.length > 0)
  const dependentFields = Array.from(new Set(dependent.flatMap((task) => task.dependsOn)))

  /** 单个任务失败不连坐其它任务 —— 一个接口挂了不该让整张表单的下拉全空 */
  const run = async (subset: typeof tasks): Promise<string[]> => {
    const done: string[] = []
    await Promise.all(
      subset.map(async (task) => {
        try {
          await resolveRemoteOptionTask(task, getFormValue)
          if (task.rule?.field) done.push(task.rule.field)
        } catch (e) {
          console.warn(
            `[RemoteOption] 字段[${task.rule?.field}]的数据接口取数失败`,
            e
          )
        }
      })
    )
    return done
  }

  return {
    dependentFields,
    resolveDependent: async () => {
      await run(dependent)
    },
    refreshByFields: (changed) =>
      run(dependent.filter((task) => task.dependsOn.some((f) => changed.includes(f))))
  }
}
