import type { EffectiveActionVO, EffectiveResourceNodeVO } from '@/api/system/grant'
import { formatDate } from '@/utils/formatTime'
import {
  fieldModeLabel,
  fieldModeTagType,
  isRowFilterableResource
} from '@/views/system/resource/constants'

/**
 * 「切换智能查看」那棵生效权限树的纯函数。
 *
 * 与 batchGrant.ts / resourceTree.ts 同一个理由独立成模块：GrantEffectiveTree.vue 要 mount
 * 才测得到，而本仓的 vitest.config.ts 刻意不挂自动导入插件，`useMessage` 这类全局在 node
 * 环境里是未定义的，组件测不起来。这几个函数决定「默认展开到哪一层」「聚合列显示单值还是
 * 显示『N 个动作配置不同』」「来源标签写什么」—— 错了不报错，只会静默展示错信息。
 *
 * 🔴 **本文件里没有任何判定逻辑**：不重算优先级、不重算过期、不重算 default_effect 回落。
 * 「这个动作生不生效」「它从哪来」全部是后端 `GrantDecisionEngine#explain` 的结论，
 * 经 `EffectiveActionVO` 原样送过来。这里只做三件事：翻译成人话、聚合多个动作、决定展开态。
 * 再抄一份判定的话，本仓库注释里那句「另写一份判定必然与鉴权路径漂移」就要应验第三次了
 * （前两次：`GrantDecisionService#buildResourceChain` 与 `#buildChainFromMap` 在停用祖先上分叉；
 * `GrantAdminController#listByResource` 与 `#toRespVOs` 两处 expired 口径不一致）。
 *
 * ⚠️ 依赖只允许是**类型**加上纯常量/纯函数模块：`@/views/system/resource/constants` 与
 * `@/utils/formatTime`（后者只拽 dayjs）。绝不 import `vue` 或 `@/config/axios` 那条链 ——
 * 后者会拽进 store 与 i18n，整个依赖图在 node 环境下会崩，测试文件连加载都过不去
 */

/**
 * 让前 `visibleLevels` 层可见所需要的 `expandedRowKeys`。
 *
 * 传 `Infinity` 就是「展开全部」。默认给 2：实测超管角色有 702 个生效节点，
 * 全展开是一堵墙，而第一屏真正要看到的是「哪几个大类下有权限」。
 *
 * 🔴 层数按**嵌套深度**数，不能读 `node.depth`。那个字段是资源在 `sys_resource` 里的
 * 物化深度，而这棵树是**剪过枝**的：一个 depth=3 的节点在祖先全被剪掉之后会成为根，
 * 按 `node.depth` 判就会把根当成第三层直接折叠掉，用户看到一棵空树还以为没权限。
 *
 * 只把**有子节点**的 id 收进来：叶子塞进去不改变任何观感，只会让「展开全部」
 * 在 702 个节点上多造几百个无用 key
 */
export const collectKeysUpToDepth = (
  tree: EffectiveResourceNodeVO[],
  visibleLevels: number
): number[] => {
  const keys: number[] = []
  const walk = (nodes: EffectiveResourceNodeVO[], level: number) => {
    if (level >= visibleLevels) return
    nodes.forEach((node) => {
      if (!node.children?.length) return
      keys.push(node.id)
      walk(node.children, level + 1)
    })
  }
  walk(tree ?? [], 1)
  return keys
}

/**
 * 客户端筛树：按关键词剪枝，只留下「自己命中」或「后代命中」的节点。
 *
 * **为什么在前端剪、不加一个后端筛选参数**：这棵树是后端一次性求值、剪枝、合并之后
 * 整棵送过来的（`getEffectiveTree`），既没有分页也没有服务端筛选口径。
 * 再加一个服务端关键词参数就得把「命中一个节点要连带保留哪些祖先」这条规则
 * 在后端重实现一遍 —— 而祖先链的计算已经在 `GrantDecisionService#buildResourceChain` 里了，
 * 两处口径一漂移，就会出现「列表页搜得到、智能查看搜不到」这种最难解释的分歧。
 * 前端剪的输入就是屏幕上这棵树，所见即所筛，不存在第二套口径。
 *
 * 🔴 **命中一个节点就保留它的整棵子树**，不继续往下筛。这是权限地图，
 * 搜到一个父资源之后要看的恰恰是「它下面都授了什么」——
 * 只留命中节点本身的话，搜「角色管理」得到一行光杆，
 * 而它放行的那二十个子按钮正是搜索的目的。
 * 反过来「后代命中」时只保留那条路径上的祖先，旁支一律剪掉，
 * 否则搜一个叶子权限串会带回它整棵兄弟树。
 *
 * ⚠️ 祖先一律用 `{ ...node, children }` **复制**再挂新 children：
 * `tree` 是后端响应对象的引用，就地改它会让「清空关键词」还原不回原样，
 * 而且 `watch(() => props.tree)` 那条依赖会被自己触发一次
 *
 * ⚠️ 空关键词返回原数组（同一个引用，不是副本）：调用方把它放进 computed，
 * 返回新数组会让每次输入都产出一个新的 `:data`，el-table-v2 因此整表重建、
 * 滚动位置归零 —— 而没在筛的时候压根不该有这件事
 */
export const filterEffectiveTree = (
  tree: EffectiveResourceNodeVO[],
  keyword: string
): EffectiveResourceNodeVO[] => {
  const kw = (keyword ?? '').trim().toLowerCase()
  if (!kw) return tree ?? []
  const hit = (node: EffectiveResourceNodeVO) =>
    (node.name ?? '').toLowerCase().includes(kw) ||
    (node.permission ?? '').toLowerCase().includes(kw)
  const walk = (nodes: EffectiveResourceNodeVO[]): EffectiveResourceNodeVO[] => {
    const kept: EffectiveResourceNodeVO[] = []
    for (const node of nodes ?? []) {
      if (hit(node)) {
        kept.push(node)
        continue
      }
      const children = walk(node.children ?? [])
      // 只在真的有存活后代时才造副本：children 为空数组的节点会让 el-table-v2
      // 画出一个展开箭头、点开是空的，与后端「叶子不给 children 这个键」的形状不一致
      if (children.length) kept.push({ ...node, children })
    }
    return kept
  }
  return walk(tree)
}

/**
 * 数一棵树里有多少个节点（含所有层级）。
 *
 * 存在的理由：筛过之后顶部那句「共 N 个资源」是后端 `summary.nodeCount`，
 * 说的是**全量**，而屏幕上只有命中的那几行。不报两个数，
 * 管理员会把「筛完只剩 3 行」读成「这个角色只有 3 项权限」——
 * 这正是 summaryText 那段注释里「🔴 把藏了什么说出来」要防的同一类误读
 */
export const countTreeNodes = (tree: EffectiveResourceNodeVO[]): number =>
  (tree ?? []).reduce((sum, node) => sum + 1 + countTreeNodes(node.children ?? []), 0)

/**
 * 一个节点上的全部生效动作，在 `field` 这一项上是不是同一个值。
 *
 * 存在的理由：**行过滤规则 / 字段模式 / 到期时间是「每动作」的属性，而树上一行是一个资源节点。**
 * 同一个资源上 VIEW 挂规则 A、UPDATE 挂规则 B 是完全合法的配法，一行里塞不下两个值。
 * 一致时显示该值，不一致时显示「N 个动作配置不同」，逐动作明细挪到动作 chip 的 tooltip 里
 * （不用 `type="expand"` 展开行 —— 它与树形在 EP 里互斥，`wrappedRowRender` 的 expand 分支提前 return）。
 *
 * ⚠️ 空值一律归一成 `null` 再比：JSON 里「没配」可能是 `undefined`（键被省略）也可能是 `null`，
 * 直接 `===` 会把「两个都没配」判成不一致，于是满屏都是「N 个动作配置不同」
 */
export const isUniformActions = <K extends keyof EffectiveActionVO>(
  node: EffectiveResourceNodeVO,
  field: K
): boolean => {
  const actions = node?.actions ?? []
  if (actions.length <= 1) return true
  const first = actions[0][field] ?? null
  return actions.every((action) => (action[field] ?? null) === first)
}

/** 三个「每动作」属性是否全都一致 —— 决定状态列显示「生效中」还是「多动作配置不同」 */
export const isUniformNode = (node: EffectiveResourceNodeVO): boolean =>
  isUniformActions(node, 'ruleName') &&
  isUniformActions(node, 'fieldMode') &&
  isUniformActions(node, 'expireTime')

/**
 * 权限来源的人话。这是本轮**新增的那一列**，也是整张图的核心价值：
 * 「继承自「角色管理」」是扁平列表永远展示不出来的信息 ——
 * 列表页只看得到父菜单那一行（而且它没有 permission，在列表页上连名字都对不上），
 * 完全看不出它其实放行了下面二十个子按钮
 *
 * ⚠️ 认不出的 source 原样显示而不是 '-'，与 constants.ts 的 formatResourceType 同口径：
 * 后端新增一种来源而前端漏配时，界面上看得见原值，比静默变一条横线好排查
 */
export const sourceLabel = (action: EffectiveActionVO): string => {
  switch (action?.source) {
    case 'EXPLICIT':
      return '本资源已配置'
    case 'INHERITED':
      // 祖先名缺失时退化成「上级」：来源标签本身比名字重要，不能因为名字没了就整条不显示
      return `继承自「${action.sourceResourceName || '上级'}」`
    case 'ALL_USERS':
      return '全员默认拥有'
    case 'DEFAULT':
      return '默认放行（未配置）'
    default:
      return action?.source
  }
}

/** 来源 tag 配色。DEFAULT 用 warning：它是「没人配过」，需要被看见但不该被读成有人授过权 */
export const sourceTagType = (action: EffectiveActionVO): string => {
  switch (action?.source) {
    case 'EXPLICIT':
      return 'success'
    case 'INHERITED':
      return 'primary'
    case 'ALL_USERS':
      return 'info'
    case 'DEFAULT':
      return 'warning'
    default:
      return 'info'
  }
}

export interface SourceTag {
  label: string
  type: string
}

/**
 * 权限来源列要渲染的 tag：按出现顺序去重，最多 `cap` 个，其余进 `rest`
 * （调用方把 rest 渲染成一个「+N」chip，并在它的 tooltip 里列全）。
 *
 * 🔴 去重按 **label** 而不是按 source：两条都从同一个祖先继承来的动作合成一个 tag，
 * 而从两个不同祖先继承来的必须分开显示 ——「继承自「角色管理」」与「继承自「系统管理」」
 * 是两条不同的信息，按 source 合并掉就看不出这一行的权限其实来自两处
 *
 * 要设上限是因为一行的高度是固定的：一个节点上 12 个动作来自 4 处时，
 * 不设限的 tag 会溢出到下一行然后被裁掉，读起来像「只有前两个来源」
 */
export const sourceTags = (
  node: EffectiveResourceNodeVO,
  cap = 2
): { shown: SourceTag[]; rest: SourceTag[] } => {
  const all: SourceTag[] = []
  for (const action of node?.actions ?? []) {
    const tag: SourceTag = { label: sourceLabel(action), type: sourceTagType(action) }
    if (!all.some((item) => item.label === tag.label)) all.push(tag)
  }
  return { shown: all.slice(0, cap), rest: all.slice(cap) }
}

/**
 * 后端 `SubjectKey#asString()` 的主体寻址串 → 人话。
 *
 * 那串东西（形如 `ROLE` 加冒号加编号、`ALL` 加冒号加 `all-users`）是给日志与接口用的，
 * 直接印在页面上等于让管理员自己去猜主体模型。
 * 认不出的类型原样显示（与本文件其余函数同口径）
 *
 * @param selfRoleId 当前正在看的角色编号，用来把主体清单里的它标成「本角色」，
 *                   其余 ROLE 一律是继承来的上级角色
 */
export const subjectLabel = (subject: string, selfRoleId?: number): string => {
  const idx = subject.indexOf(':')
  const type = idx < 0 ? subject : subject.slice(0, idx)
  const ref = idx < 0 ? '' : subject.slice(idx + 1)
  if (type === 'ALL') return '全员（所有登录用户）'
  if (type === 'ROLE') {
    if (!ref) return '角色'
    return selfRoleId != null && ref === String(selfRoleId) ? '本角色' : `上级角色 #${ref}`
  }
  return subject
}

/**
 * 行过滤规则列的三态，口径与列表页 `index.vue` **逐字一致**
 *
 * 🔴 三态而不是两态：非数据集资源显示 `-`，因为菜单/按钮上压根没有「行」这个概念，
 * 对它说「不受限（全部行）」是句假话（判据见 constants.ts 的 isRowFilterableResource）。
 * 两边不一致的话，同一条授权在列表页与智能查看里会读出两种意思
 *
 * 没有任何生效动作的**路径节点**也返回 `-`：它上面根本没有授权行，
 * 说它「不受限」等于凭空捏一条配置
 */
export const rowFilterCell = (node: EffectiveResourceNodeVO): { text: string; muted: boolean } => {
  const actions = node?.actions ?? []
  if (!actions.length) return { text: '-', muted: true }
  if (!isUniformActions(node, 'ruleName')) {
    return { text: `${actions.length} 个动作配置不同`, muted: false }
  }
  const ruleName = actions[0].ruleName
  if (ruleName) return { text: ruleName, muted: false }
  if (!isRowFilterableResource(node.type)) return { text: '-', muted: true }
  return { text: '不受限（全部行）', muted: true }
}

/**
 * 字段模式列。翻译走 constants.ts 那一份（与列表页同源，不在这里另写一套词）。
 *
 * ⚠️ 字段模式只对 COLUMN / FIELD 有意义，而字段级资源默认不在树里（`includeFieldLevel` 开关），
 * 所以这一列绝大多数时候是短横。留着它是为用户那句「树形页面也要包含目前列表的所有字段」
 */
export const fieldModeCell = (
  node: EffectiveResourceNodeVO
): { text: string; muted: boolean; tag?: string } => {
  const actions = node?.actions ?? []
  if (!actions.length) return { text: '-', muted: true }
  if (!isUniformActions(node, 'fieldMode')) {
    return { text: `${actions.length} 个动作配置不同`, muted: false }
  }
  const fieldMode = actions[0].fieldMode
  if (!fieldMode) return { text: '-', muted: true }
  return {
    text: fieldModeLabel(fieldMode) ?? fieldMode,
    muted: false,
    tag: fieldModeTagType(fieldMode)
  }
}

/**
 * 到期时间列。
 *
 * ⚠️ 路径节点显示短横而**不是**「永不过期」：它上面没有任何授权行，
 * 说它「永不过期」等于凭空捏一条配置。有行但没写到期时间才是「永不过期」，
 * 与列表页同一句话
 */
export const expireCell = (node: EffectiveResourceNodeVO): { text: string; muted: boolean } => {
  const actions = node?.actions ?? []
  if (!actions.length) return { text: '-', muted: true }
  if (!isUniformActions(node, 'expireTime')) {
    return { text: `${actions.length} 个动作配置不同`, muted: false }
  }
  const expireTime = actions[0].expireTime
  return expireTime
    ? { text: formatDate(expireTime), muted: false }
    : { text: '永不过期', muted: true }
}

/**
 * 状态列。列表页那一列是「生效中 / 已过期」，这里换成三态，因为过期行**压根不进这棵树**
 * （后端按 `GrantDO#isActive()` 滤掉了，只在 summary.expiredSkippedCount 里报数），
 * 照抄「已过期」的话那一支永远走不到，反而把真正需要区分的两种情况藏起来了：
 * 「有人显式配过」与「没人配、按默认效果放行」
 */
export const nodeStatus = (node: EffectiveResourceNodeVO): { label: string; type: string } => {
  const actions = node?.actions ?? []
  if (!actions.length) return { label: '路径节点', type: 'info' }
  if (actions.every((action) => action.source === 'DEFAULT')) {
    return { label: '默认放行', type: 'warning' }
  }
  if (!isUniformNode(node)) return { label: '多动作配置不同', type: 'warning' }
  return { label: '生效中', type: 'success' }
}

/**
 * 动作 chip 的 tooltip 内容。
 *
 * 逐动作明细必须有地方放，因为聚合列在不一致时只能说「N 个动作配置不同」——
 * 那句话本身不解决问题，操作者还是要看到底哪个动作配了什么。
 * 空值一律不产出对应行，而不是产出一行「到期时间：-」：
 * 一个 VIEW 动作本来就没有规则与字段模式，列出来只是把 tooltip 撑长
 *
 * ⚠️ 字段模式与到期时间都走全站同一份翻译（constants.ts 的 fieldModeLabel、
 * utils/formatTime 的 formatDate）。tooltip 里印一个裸的 `HIDDEN`、而同一行的
 * 「字段模式」列印「隐藏」，读起来像两处数据对不上
 */
export const actionDetailLines = (
  action: EffectiveActionVO
): { label: string; value: string }[] => {
  const lines: { label: string; value: string }[] = [
    { label: '效果', value: action.effect === 'ALLOW' ? '允许' : '拒绝' },
    { label: '来源', value: sourceLabel(action) }
  ]
  if (action.grantId != null) lines.push({ label: '授权行', value: `#${action.grantId}` })
  if (action.ruleName) lines.push({ label: '行过滤规则', value: action.ruleName })
  if (action.fieldMode) {
    lines.push({ label: '字段模式', value: fieldModeLabel(action.fieldMode) ?? action.fieldMode })
  }
  lines.push({
    label: '到期时间',
    value: action.expireTime ? formatDate(action.expireTime) : '永不过期'
  })
  if (action.subjectType) {
    lines.push({
      label: '命中主体',
      value: [action.subjectType, action.subjectRefId ?? action.subjectCode ?? '']
        .filter(Boolean)
        // 🔴 用 '-' 而不是 ':' 连接：前端注释与展示里都不写 `标识:数字` 这种形状，
        // commentLineRefBan.spec.ts 的 RE_A 会把它当成行号引用
        .join('-')
    })
  }
  return lines
}
