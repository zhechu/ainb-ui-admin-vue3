/**
 * 权限资源枚举的中文展示口径（需求 3）。
 *
 * 走前端常量模块而不是系统字典：这些 code 与后端 ResourceTypeEnum 一一对应、不会由管理员
 * 自助增改，与 infra/formDesign 的 FORM_TYPE_OPTIONS 是同一惯例；引字典反而要多一条 SQL 迁移。
 * 资源页、资源详情面板、权限诊断页、角色资源授权页共用这一份，避免多处各写一遍再漂移。
 */

/** 资源类型下拉项。顺序与后端 ResourceTypeEnum 的声明顺序一致 */
export const RESOURCE_TYPE_OPTIONS = [
  { label: '菜单', value: 'MENU' },
  { label: '操作', value: 'ACTION' },
  { label: '流程', value: 'PROCESS' },
  { label: '分类', value: 'CATEGORY' },
  { label: '数据集', value: 'DATASET' },
  { label: '列', value: 'COLUMN' },
  { label: '字段', value: 'FIELD' }
]

/**
 * 认不出的 code 原样显示而不是 '-'：后端新增类型而前端漏配时，界面上看得见原值，
 * 比静默变一条横线好排查
 */
export const formatResourceType = (type: string | undefined) =>
  RESOURCE_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type

/**
 * 类型 tag 配色。前 5 个映射是页面原有的，不动；补上原来缺失、落到 EP 默认蓝的
 * PROCESS 与 CATEGORY，补的规则：
 *   · 分组层 = info —— CATEGORY 与 MENU 同类（ResourceTypeEnum 对 CATEGORY 的注释
 *     说它是 PROCESS 的父资源）
 *   · 可授权的行为 = primary —— PROCESS 与 ACTION 同类
 */
export const resourceTypeTagType = (type: string) =>
  ({
    ACTION: 'primary',
    DATASET: 'warning',
    MENU: 'info',
    COLUMN: 'success',
    FIELD: 'success',
    PROCESS: 'primary',
    CATEGORY: 'info'
  })[type] ?? ''

/**
 * 字段显示模式（后端 FieldModeEnum）的中文与配色。
 *
 * 收敛之前只有角色资源授权列表页私有一份（`fieldModeLabel` / `fieldModeTagType` 两个函数），
 * 智能查看那棵树的「字段模式」列与动作 tooltip 也要用同一套词 —— 再抄一份就是第二份副本，
 * 而 GRANT_ACTION_OPTIONS 收敛之前有【四份】，见上面那段注释里记的代价。
 *
 * ⚠️ 认不出的码原样显示、配色回落空串（EP 默认色），与本文件其余 format* 同口径：
 * 后端加了新模式而前端漏配时，界面上看得见原值，比静默变一条横线好排查
 */
export const FIELD_MODE_OPTIONS = [
  { label: '可编辑', value: 'EDITABLE' },
  { label: '只读', value: 'READONLY' },
  { label: '隐藏', value: 'HIDDEN' }
]

export const fieldModeLabel = (mode: string | undefined) =>
  FIELD_MODE_OPTIONS.find((item) => item.value === mode)?.label ?? mode

export const fieldModeTagType = (mode: string | undefined) =>
  ({
    EDITABLE: 'success',
    READONLY: 'warning',
    HIDDEN: 'danger'
  })[mode ?? ''] ?? ''

export const DEFAULT_EFFECT_OPTIONS = [
  { label: '允许', value: 'ALLOW' },
  { label: '拒绝', value: 'DENY' }
]

export const formatDefaultEffect = (effect: string | undefined) =>
  DEFAULT_EFFECT_OPTIONS.find((item) => item.value === effect)?.label ?? effect

/**
 * 默认效果的 tag 配色：DENY 一律 info（灰）。
 *
 * ⚠️ 下一个人很容易「顺手统一成红」，改之前先读这段：MENU/ACTION/PROCESS/CATEGORY 这 4 类的
 * 出厂默认就是 DENY（见 ResourceTypeEnum#defaultEffect），它是常态不是异常；列表页一屏几十行
 * 几乎全是 DENY，全染红等于把红色用废（报警疲劳）。
 * 授权列表里 grant 行的 effect=DENY 继续用红 —— 那是有人显式配的一条禁止。
 * 统一成灰之后两种颜色反而携带信息：灰 = 出厂默认拒绝，红 = 有人显式拒绝。
 */
export const defaultEffectTagType = (effect: string | undefined) =>
  effect === 'ALLOW' ? 'success' : 'info'

/**
 * 授权主体类型的中文。措辞与 ResourceDetailPanel 新增授权表单的下拉项逐字一致，
 * 两处漂移的话会出现「表单里选的是『所有登录用户』、列表里显示另一个词」
 */
export const SUBJECT_TYPE_OPTIONS = [
  { label: '角色', value: 'ROLE' },
  { label: '用户', value: 'USER' },
  { label: '部门', value: 'DEPT' },
  { label: '用户组', value: 'GROUP' },
  { label: '所有登录用户', value: 'ALL' },
  { label: '系统身份', value: 'SYSTEM' }
]

export const formatSubjectType = (type: string | undefined) =>
  SUBJECT_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type

/**
 * 授权动作的中文，按后端 GrantActionEnum 全集配（13 个）。
 *
 * 这是全站唯一一份动作词表。收敛之前有【四份】各自维护的副本：角色资源授权页的私有
 * ACTIONS、角色管理内嵌面板的私有 ACTIONS、资源详情面板里 8 个硬编码 el-option
 * （少了 MANAGE / VIEW_ALL —— 恰好是流程资源唯一在用的两个码，等于流程管理员
 * 在资源那一侧根本配不出来）、权限诊断页里 7 个硬编码 el-option（同样缺 MANAGE /
 * VIEW_ALL，于是「诊断流程权限」这件事在诊断页上做不了）。
 * 四份都「看起来一样」，靠人盯着才没漂得更远。
 *
 * `*` 的 label 刻意带上星号：它是通配符而不是一个具体动作，
 * 只写「全部动作」会和下面的 VIEW_ALL「查看全部」读起来分不清谁是谁。
 * REFERENCE 用「被引用查询」，逐字取自 GrantActionEnum 的 javadoc。
 *
 * ⚠️ 数组顺序：`*` 刻意排在最前，其余 12 个严格按 GrantActionEnum 的声明顺序。
 * 注意枚举里 WILDCARD("*") 是**最后一个**常量，所以这里的顺序与枚举并不逐位相同 ——
 * 把通配符排在一堆具体动作末尾，它会被读成「最后一个不常用的选项」，
 * 而它恰恰是「一行封死该资源全部操作」那个最需要被看见的开关。
 * 不要按 effective 重排：收窄与分组交给下面的 grantActionOptionsFor / grantActionGroupsFor，
 * 顺序一变，列表页搜索下拉和这里的词表就对不上号了。
 */
export interface GrantActionOption {
  label: string
  value: string
  /**
   * 后端有没有「拿这个码去查询」的地方。
   *
   * false = GrantActionEnum 里声明了、UI 能选、也能存进 sys_grant.action，
   * 但决策链上没有任何一处会用它做匹配，配了不参与鉴权。
   * 判据是 GrantDecisionEngine#isAllowed 的 action 入参：全后端只传过
   * VIEW（接口鉴权 / 菜单树 / 按钮清单 / 字段模式）、START、DESIGN、MANAGE、VIEW_ALL
   * （后四个见 BpmProcessPermissionChecker），外加 '*' 在 GrantDO#actionMatches 里通配。
   *
   * ⚠️ 后端给某个预留码接上查询点之后，这里必须同步改成 true，
   * 否则界面会继续告诉用户「配了不生效」，而它其实已经生效了 —— 反向的谎更难查。
   * DESIGN 就是这样从 false 翻过来的（判定入口 BpmModelServiceImpl#validateModelDesigner）。
   *
   * 保留这些项而不是从下拉里删掉，是因为预留码是枚举内的合法值、能正常存进库，
   * 搜索与回显仍需要一份中文映射；删了它们会渲染成裸码。
   *
   * ⚠️ 枚举【外】的历史脏值（实测本库曾有 4 行 EXEC）是另一回事：
   * 已由 sql/mysql/xpy-2026-10-12-grant-action-enum-cleanup.sql 软删，
   * 且 GrantSaveReqVO.action 上的 @InEnum 挡住了新写入。
   * 下面 formatGrantAction / grantActionGroupsFor 的原值兜底仍然保留 ——
   * 清理脚本只在跑过它的环境生效，别的环境里那些行还在。
   */
  effective: boolean
  /** 只对流程类资源有意义，见 PROCESS_RESOURCE_TYPES */
  processOnly?: boolean
}

export const GRANT_ACTION_OPTIONS: GrantActionOption[] = [
  { label: '* 全部动作', value: '*', effective: true },
  { label: '查看', value: 'VIEW', effective: true },
  { label: '新增', value: 'CREATE', effective: false },
  { label: '修改', value: 'UPDATE', effective: false },
  { label: '删除', value: 'DELETE', effective: false },
  { label: '导出', value: 'EXPORT', effective: false },
  { label: '导入', value: 'IMPORT', effective: false },
  { label: '打印', value: 'PRINT', effective: false },
  { label: '发起', value: 'START', effective: true, processOnly: true },
  { label: '设计', value: 'DESIGN', effective: true, processOnly: true },
  { label: '管理', value: 'MANAGE', effective: true, processOnly: true },
  { label: '查看全部', value: 'VIEW_ALL', effective: true, processOnly: true },
  { label: '被引用查询', value: 'REFERENCE', effective: false }
]

/**
 * 哪几种资源类型下才开放流程专属动作。
 *
 * CATEGORY 与 PROCESS 一并放开：分类是流程的父资源，给分类授权会沿资源祖先链
 * 继承给其下所有流程（ResourceTypeEnum 对 CATEGORY 的注释），
 * 所以「整个分类下所有流程都禁止发起」是配在 CATEGORY 上的，不放开就配不出来。
 */
const PROCESS_RESOURCE_TYPES = ['PROCESS', 'CATEGORY']

/**
 * 行过滤规则（GrantVO#ruleId）只可能落在哪一类资源上。
 *
 * 后端的真实判据是三连条件（见 ResourceMapper#selectListByDatasetTable）：
 * type=DATASET 且 dataset_table 非空 且 status=ENABLE —— 行过滤是拿物理表名反查数据集资源的。
 * 前端 ResourceVO 不含 dataset_table，所以这里只能判 type，这是一个**会漂移的近似**。
 * 接受它的理由是失效方向：漏判只会「少写一个 ruleId」（规则在那张表上不生效），不会越权；
 * 而 dataset_table 一旦进 RespVO 就成了对全前端的公开契约，本轮只有一个消费点。
 * status 那一半本来就安全 —— getResourceList 只返启用资源。
 *
 * 🔴 绑在非数据集资源上的 ruleId 是**死字段**：GrantDecisionEngine#isAllowed 与
 * #resolveFieldMode 从不读它，行过滤也**不沿资源树上溯**（功能权限才上溯，
 * 见 GrantDecisionService#buildResourceChain），所以绑在 CATEGORY 父节点上也不会下发给子数据集。
 * 死字段不只是噪声：列表页会把它渲染成一个其实不存在的限制，比留空更误导人
 */
export const isRowFilterableResource = (resourceType: string | undefined) =>
  resourceType === 'DATASET'

/**
 * 按资源类型取「这个资源上配了有意义」的动作。
 *
 * 收窄的只有 processOnly 那几项，不收窄 effective=false 的预留项 ——
 * 预留动作在哪种资源上都不生效，但把它们从下拉里彻底拿掉会让人以为「这功能没有」，
 * 而库里明明存着这类行。所以策略是【显示但分组标注】，见 splitGrantActionOptions。
 */
export const grantActionOptionsFor = (resourceType: string | undefined): GrantActionOption[] => {
  const isProcess = !!resourceType && PROCESS_RESOURCE_TYPES.includes(resourceType)
  return GRANT_ACTION_OPTIONS.filter((item) => isProcess || !item.processOnly)
}

/**
 * 下拉里分两组展示：生效的排前面，不生效的收进「预留」组。
 * 分成两组而不是隐藏，是为了让「选了不生效」这件事在选的那一刻就看得见。
 * GrantBatchForm 的动作多选也用它 —— 批量入口一次能配出 N 行预留动作，
 * 分组展示比单条更需要
 */
export const splitGrantActionOptions = (options: GrantActionOption[]) => ({
  effective: options.filter((item) => item.effective),
  reserved: options.filter((item) => !item.effective)
})

/**
 * 授权表单的动作下拉用这个，而不是直接用 grantActionOptionsFor。
 *
 * 多做的一件事是把「当前值」补回选项里。编辑既有行时，库里的码可能不在该资源类型的
 * 开放范围内（给菜单配过 START，或存着枚举外的脏值），不补的话 el-select 找不到对应
 * option，会把选中项渲染成裸码，看着像控件坏了。
 *
 * ⚠️ 补选项而不是改成 VIEW：静默改值等于篡改一条已存在的授权，
 * 而用户这次可能只是想改个到期时间
 */
export const grantActionGroupsFor = (
  resourceType: string | undefined,
  currentAction: string | undefined
) => {
  const options = grantActionOptionsFor(resourceType)
  const missing =
    currentAction && !options.some((item) => item.value === currentAction)
      ? [
          GRANT_ACTION_OPTIONS.find((item) => item.value === currentAction) ?? {
            label: currentAction,
            value: currentAction,
            effective: false
          }
        ]
      : []
  return splitGrantActionOptions([...options, ...missing])
}

/**
 * 该动作在这种资源上是不是一个合法可选项。
 *
 * 返回 false 的只有两种：流程专属动作配在非流程资源上（给菜单配过 START），
 * 以及枚举外的历史脏值。**预留动作返回 true** —— 它们在每种资源上都是可选项，
 * 只是配了不生效，那是 reservedActionWarning 管的事，不是这里管的。
 *
 * ⚠️ 只用于「用户主动切换资源后要不要把动作重置成 VIEW」这一处判断。
 * 不要拿它去校验编辑既有行时的回显值：对它返回 false 的那两种情况都可能是
 * 库里真实存着的一行，据此改值等于静默篡改一条已存在的授权
 */
export const isGrantActionAllowed = (
  action: string | undefined,
  resourceType: string | undefined
) => grantActionOptionsFor(resourceType).some((item) => item.value === action)

/**
 * 认不出的 code 原样显示（与 formatResourceType 同一口径），不能改成 '-'：
 * sys_grant.action 里存着枚举外的历史值（本库实测有 4 行 EXEC，已被清理脚本软删，
 * 但没跑过该脚本的环境里还在），兜底掉了就渲染成空白 tag，
 * 界面上既看不出这一行是什么动作，也看不出它是脏数据
 */
export const formatGrantAction = (action: string | undefined) =>
  GRANT_ACTION_OPTIONS.find((item) => item.value === action)?.label ?? action

/**
 * 动作下拉里两个分组的标题，三处授权表单共用。
 *
 * 收敛之前 GrantForm 写的是「预留动作（后端不校验，配了不生效）」，
 * 另两处写「预留动作（配了不生效）」。前半句现在是**假话**：
 * GrantSaveReqVO.action 已经加了 @InEnum，枚举外的值后端会直接 400。
 * 三处不一致让这句假话只出现在其中一个面板上，比三处一起错更难被发现
 */
export const GRANT_ACTION_GROUP_LABELS = {
  effective: '生效动作',
  reserved: '预留动作（配了不生效）'
}

/**
 * 选中「配了不生效」的动作时，表单里常驻的那句警告。返回 undefined 表示不用显示。
 *
 * 为什么要常驻：分组标题上那句「配了不生效」只在下拉展开时看得见，
 * 选完一收起来就没了 —— 用户点保存时眼前没有任何提示，
 * 而这恰恰是最需要提示的一刻（保存会成功，权限不会生效）。
 *
 * 两种情况分开说，因为后果不同：
 *   · 枚举内的预留码 —— 能正常保存，只是不参与鉴权；
 *   · 枚举外的脏值 —— 不参与鉴权，而且保存会被 @InEnum 拦成 400。
 *     这一条只在编辑历史行时可能出现（新增时下拉里根本没有这种选项），
 *     不写清楚的话用户看到的是「我只想改个到期时间，怎么报参数错误」
 *
 * ⚠️ 空值返回 undefined：没选动作时该提示的是表单校验那句「请选择动作」，
 * 两条提示叠在一起反而看不清
 */
export const reservedActionWarning = (action: string | undefined): string | undefined => {
  if (!action) return undefined
  const option = GRANT_ACTION_OPTIONS.find((item) => item.value === action)
  if (option?.effective) return undefined
  return option
    ? `「${option.label}」是预留动作：能存进库、也能正常保存，但后端鉴权时没有任何一处会拿它做判定，配了不生效。`
    : `「${action}」不是后端认可的动作码（历史脏数据），它不参与鉴权，且保存会被参数校验拦下。请改成一个生效动作。`
}
