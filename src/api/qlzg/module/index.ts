import request from '@/config/axios'

/**
 * 当前**部署形态** ← 后端 {@code QlzgModuleFormRespVO}（{@code GET /qlzg/module/current}）
 *
 * <h3>🔴 这个端点存在的理由是「关掉的功能要自己说清楚关掉了」</h3>
 * 菜单过滤（§2.6.3 第 3 条）能让关掉的功能**消失**，但「消失」与「本来就没有」
 * 在用户眼里是同一件事 —— 一个用惯了标准版的评估师调到 REPORT_ONLY 的部署上，
 * 会发现左侧少了三个菜单，他的第一反应是「权限被谁改了」，于是去提工单。
 * 一句常驻的横幅比一次工单便宜。
 *
 * <h3>🔴 前端**不许**拿本 VO 当业务判据</h3>
 * 「这个项目要不要弹法定告知」走 {@code QlzgProjectApi.getStatutoryNotice}，
 * 那条判据在后端（{@code QlzgProjectServiceImpl#degradedStatutoryAckNeeded}，
 * 问的是 {@code QlzgReviewModeResolver} 这个 Bean 在不在）。
 * 让前端按 {@link modules} 自己推的话判据就有两份，而客户完全可以要一个
 * 预设之外的组合（§2.6.1：形态不是枚举，是模块集合），
 * 前端写死的 {@code if (form === 'REPORT_ONLY')} 在那种部署上直接失效 ——
 * 失效的方向是**静默**的：不弹警示区、用户没勾、提交上来被后端拦下，
 * 用户看到一个「我什么都没做却报错」的表单。
 *
 * <h3>⚠️ 本端点**只读**，也不会有写端点</h3>
 * §2.6.7 第 3 条：不做运行时动态切换形态，改配置要重启。
 * 所以横幅上那句「改形态要改配置并重启」不是敷衍，是唯一的路。
 */
export interface QlzgModuleFormVO {
  /**
   * 形态名。命中四个预设之一就报预设名（STANDARD / REPORT_ONLY / REPORT_SIGN / FULL），
   * 命不中照实报模块清单（例如客户自己配的 {@code core,ai,template,case}）
   */
  form: string
  /**
   * 🔴 是不是退化形态（判据：MVP 已交付的三个可选模块 calc / case / review 里缺了任一个）
   *
   * ⚠️ 刻意**不是**「不等于 STANDARD」：FULL 也不等于 STANDARD，但它什么都没退化
   */
  degraded: boolean
  /** 已装配的模块码，按枚举声明顺序 */
  modules: string[]
  /**
   * 没装配的模块码，格式「模块码(交付迭代)」，例如 {@code calc(I4)}
   *
   * 🔴 这一份是给**实施人与运维**看的（截图进交付文档、对着它查配置），
   *    横幅上念给评估师的是 {@link absentDeliveredNames}
   */
  absentModules: string[]
  /**
   * 🔴 {@link absentModules} 里【MVP 已交付、因而关掉之后行为真的变了】那几个的**中文名**，
   *    按枚举声明顺序（测算 → 案例库 → 机器复核）
   *
   * <p>⚠️ 它刻意不含 workflow / sign / archive / progress：那四个在 MVP 期还没有 Bean，
   *    把它们列进「本部署未安装」等于向客户承诺一个**任何部署都没有**的功能
   *    （三轮要求 6：I31 交付之前售前材料不得出现「档案合规」「30 年可举证」）。
   *
   * <p>🔴 中文名由后端 {@code QlzgModuleEnum#getName()} 给出，
   *    前端**不要**另建一份「码 → 中文」的字典：那份字典会与枚举分叉，
   *    而分叉的表现是横幅上印着一个界面上从来不存在的功能名
   */
  absentDeliveredNames: string[]
}

export const QlzgModuleApi = {
  /**
   * 当前部署形态
   *
   * 🔴 权限点复用 {@code qlzg:project:query}（后端刻意**没有**新造 {@code qlzg:module:*}）：
   *    一个新权限串没有对应的按钮菜单时，{@code PermissionScanRunner} 只建出一条
   *    {@code menu_id = NULL} 的承载行，而它进不了非超管的导航集合、
   *    加上 {@code default_effect = DENY} —— 结果是所有非超管**静默**拿不到形态，
   *    横幅不出现，而没人知道它为什么没出现。
   *    所以调这个端点的人就是能看项目台账的那个人，两者受众完全重合
   */
  getCurrentForm: (): Promise<QlzgModuleFormVO> => request.get({ url: '/qlzg/module/current' })
}
