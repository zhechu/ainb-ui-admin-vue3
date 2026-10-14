/**
 * 资源树相关的纯函数。
 *
 * 与 batchGrant.ts 同一个理由独立成模块：ResourceTreePicker.vue 要 mount 才测得到，
 * 而本仓的 vitest.config.ts 刻意不挂自动导入插件（见它自己的注释），`useMessage`
 * 这类全局在 node 环境里是未定义的，组件测不起来。这几个函数决定「搜出来的命中项是哪些」
 * 「面包屑显示哪几级」「勾选态要不要回写给树」，错了不报错，只会静默配出错误权限。
 *
 * ⚠️ 本文件**不得 import `vue`，也不得 import `@/api/**`**：
 * `@/api/system/grant` 会拽进 `@/config/axios`，后者又拽进 store 与 i18n，
 * 整个依赖图在 node 环境下会崩，测试文件连加载都过不去。
 * 树节点一律用 `any`（调用方传的是 `ResourceVO` 经 `handleTree` 之后的形状）
 */

/**
 * 搜索匹配：命中 name 或 permission，大小写不敏感。
 *
 * 🔴 空串**必须**返回 true。EP 的 `doFilter` 靠这个方法决定哪些节点进
 * `hiddenNodeKeySet`，而清掉搜索的唯一手段就是 `filter('')` —— 空串返回 false 的话
 * 「清空搜索框」会把整棵树藏光。副作用（`filter('')` 顺手把所有节点都展开）
 * 由 ResourceTreePicker#reset 在紧随其后的 `setExpandedKeys([])` 里收回来
 *
 * permission 参与匹配不是锦上添花：本库「角色管理」这类同名资源有 8 个，
 * 名称根本不是可用的检索键，`system:role:query` 才是
 */
export const matchResourceNode = (keyword: string, data: any): boolean => {
  if (!keyword) return true
  const kw = keyword.toLowerCase()
  return (
    (data.name ?? '').toLowerCase().includes(kw) ||
    (data.permission ?? '').toLowerCase().includes(kw)
  )
}

/**
 * 树 → `id → 节点` 索引。
 *
 * 三个调用点：面包屑上溯、按 id 查资源类型（决定 fieldMode 是否可编辑、
 * 动作下拉收窄到哪些码）、批量授权里过滤「重载后已不在树中的勾选」。
 * 一两千个节点，每次数据源变化重建一次够用
 *
 * ⚠️ 用 `children?.length` 而不是 `children`：`handleTree` 的 `adaptToChildrenList`
 * 会给叶子节点**显式写上** `children: undefined`（它的判据是
 * `childrenListMap[o.id] !== null`，而叶子的 map 项是 undefined），
 * 所以「有没有 children 这个键」区分不了叶子与非叶子
 */
export const buildResourceIndex = (tree: any[]): Map<number, any> => {
  const map = new Map<number, any>()
  const walk = (nodes: any[]) =>
    nodes.forEach((node) => {
      map.set(node.id, node)
      if (node.children?.length) walk(node.children)
    })
  walk(tree)
  return map
}

/**
 * 沿 `parentId` 上溯，返回**根 → 当前**的节点数组，用于渲染
 * `系统管理 / 用户管理 / 用户查询` 这条面包屑。
 *
 * 🔴 为什么不能用 `ResourceVO.path`：那个字段存的是**权限串**的物化路径
 * （形如 `/root/system/`，再往下一层是 `menu` 加冒号加菜单 id），
 * 不是 id 路径也不是名称路径，拼不出人能读的层级，只能顺着 `parentId` 走上面那个索引
 *
 * 两个必需的循环出口：
 * - `byId.get(parentId)` 返回 undefined 时停。根节点的 `parentId` 指向一个不存在的 id
 *   （本库是 0），**这是常态不是异常**；被「显示字段级资源」开关移出视野的祖先同理
 * - `seen` 防环。`parent_id` 是应用层维护的，库里一旦出现 a→b→a，
 *   没有这个集合就是一个死循环 —— 而它发生在 computed 里，表现是页面直接冻住，
 *   连一条报错都拿不到
 */
export const resourceBreadcrumb = (node: any, byId: Map<number, any>): any[] => {
  const chain: any[] = []
  const seen = new Set<number>()
  let current = node
  while (current && !seen.has(current.id)) {
    chain.unshift(current)
    seen.add(current.id)
    current = byId.get(current.parentId)
  }
  return chain
}

/**
 * 两个 id 列表是不是同一个集合（不看顺序）。
 *
 * 唯一用途是 ResourceTreePicker 里那道**受控回写守卫**：`props.modelValue` 变化时要不要
 * 调一次 `setCheckedKeys`。没有它的话，用户每手点一次勾选框都会触发一次
 * 「emit → 父级改值 → watch → setCheckedKeys（内部先 clear 再 nextTick 重设）」，
 * 勾选框会闪，正在进行的连点也会被吃掉
 *
 * 双向比而不是单向：`a.every(id => setB.has(id))` 配长度相等在**有重复项**时会误判
 * （`[1,1]` vs `[1,2]` 长度都是 2、1 也在 B 里）。两个 Set 的 size 一并比就堵住了
 */
export const isSameIdSet = (a: number[], b: number[]): boolean => {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  const setB = new Set(b)
  return setA.size === setB.size && [...setA].every((id) => setB.has(id))
}
