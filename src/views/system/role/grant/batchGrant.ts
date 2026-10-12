import dayjs from 'dayjs'
import type { GrantSaveReqVO } from '@/api/system/grant'
import {
  GRANT_ACTION_OPTIONS,
  grantActionOptionsFor,
  type GrantActionOption
} from '@/views/system/resource/constants'

/**
 * 授权表单共用的纯函数。
 *
 * 单独成一个模块而不是写在 GrantBatchForm.vue 里，是为了能被 vitest 直接测：
 * `expandGrantBatch` 与 `intersectGrantActionOptions` 决定「提交出去的是哪些行」，
 * 写错了不会报错、只会静默配出错误权限。而弹窗组件要 mount 才测得到，
 * 本仓的 vitest.config.ts 刻意不挂自动导入插件，`useMessage` 这类全局在测试
 * 环境里是未定义的，组件测不起来 —— 纯函数是唯一能被钉住的那一层
 */

/**
 * 单次批量授权的条数上限，与后端 `GrantBatchSaveReqVO#items` 上的 `@Size(max = 500)` 互为镜像。
 *
 * ⚠️ 改一处必须改另一处：这里放大了，用户会先看到本地计数通过、再吃一个后端 400；
 * 这里缩小了，后端的余量白留着没人用。前端拦的意义在于提交**之前**就能看见，
 * 而不是等一次网络往返换回一句参数错误
 */
export const GRANT_BATCH_MAX_ITEMS = 500

/**
 * 取一批资源类型上「都配得通」的动作交集。
 *
 * **为什么是交集不是并集**：并集会在勾了 MENU 时把 START / DESIGN / MANAGE / VIEW_ALL
 * 也端出来，选中即产生「能保存但永不参与鉴权」的死行 —— 单条表单里那是一行，
 * 批量入口一次就是 N 行（每个资源一份），正是 upsert 要消灭的那类噪声。
 *
 * **为什么交集必须保留预留动作**：`effective = false` 的 CREATE / UPDATE / DELETE /
 * EXPORT / IMPORT / PRINT / REFERENCE 一个都不能裁 ——「一次给一个资源开
 * 查看/新增/修改/删除」这个高频场景配的**正是预留动作**，裁掉它们等于砍掉批量授权的
 * 一半用途。它们配了不生效这件事由 `reservedActionWarning` 的常驻警告负责说明，
 * 不是靠从选项里消失来暗示。
 *
 * @param resourceTypes 已勾选资源的类型列表；空数组表示还没勾，回落到「不按类型收窄」
 */
export const intersectGrantActionOptions = (
  resourceTypes: (string | undefined)[]
): GrantActionOption[] => {
  if (!resourceTypes.length) return grantActionOptionsFor(undefined)
  const allowed = resourceTypes.map(
    (type) => new Set(grantActionOptionsFor(type).map((item) => item.value))
  )
  // 🔴 基数是 GRANT_ACTION_OPTIONS 全集，不是 grantActionOptionsFor(undefined)：
  // 后者已经滤掉了 processOnly 那四项，拿它当基数会让「勾的全是 PROCESS / CATEGORY」时
  // START / DESIGN / MANAGE / VIEW_ALL 错误地消失 —— 而这恰好是唯一能配出它们的场景
  return GRANT_ACTION_OPTIONS.filter((item) => allowed.every((set) => set.has(item.value)))
}

export interface GrantBatchInput {
  subjectType: string
  subjectRefId?: number
  resourceIds: number[]
  actions: string[]
  effect: string
  expireTime?: string
}

/**
 * 把「资源多选 × 动作多选」展开成后端要的 `List<GrantSaveReqVO>`。
 *
 * **为什么在前端展开**：后端只收一个扁平列表，于是「单条新增」就是 size=1 的批量，
 * 两个入口共用同一份校验 —— 若改由后端展开，就得再造一个
 * `resourceIds + actions + 共用字段` 形状的 VO 和第二套校验路径，
 * 而这个 fork 刚被「两份看起来一样的逻辑各自漂移」咬过
 * （动作词表四副本、syncRoleMenuGrants 的血泪注释）。
 * 另一个原因是收窄规则的领域知识只在前端：`processOnly` 元数据在 constants.ts 里，
 * 后端 GrantActionEnum 没有这个概念。
 *
 * **顺序固定为「资源外层、动作内层」**：与弹窗里那句「N 资源 × M 动作 = X 行」的预览
 * 同口径，出问题时能逐行对着核对。
 *
 * **刻意不带的三个字段**：
 * - `fieldMode`：只对 COLUMN / FIELD 类资源有效，混合类型的批量会配出一堆无效行；
 * - `ruleId`：行过滤规则是精配动作，批量铺完骨架之后到列表页逐条编辑才对；
 * - `contextResourceId`：连单条表单都不提供这个入口。
 *
 * 三个都留空、交给「编辑」去补，比在批量弹窗里塞三组只对部分资源有意义的控件诚实
 */
export const expandGrantBatch = (input: GrantBatchInput): GrantSaveReqVO[] => {
  const items: GrantSaveReqVO[] = []
  for (const resourceId of input.resourceIds) {
    for (const action of input.actions) {
      items.push({
        subjectType: input.subjectType,
        subjectRefId: input.subjectRefId,
        resourceId,
        action,
        effect: input.effect,
        expireTime: input.expireTime
      })
    }
  }
  return items
}

/**
 * 收集「该资源 + 它下面全部资源」的 id，**含自身**，前序遍历。
 *
 * 树结构相关的三件事（收集、建索引、判断是否已整片勾上）都放在这个模块里而不是
 * 写在 GrantBatchForm.vue 里，理由与本模块其它函数相同：组件测不动，纯函数测得动。
 * 而这三件事决定「点一次『全选下级』到底勾上了哪些资源」，错了不会报错，
 * 只会静默多授或少授一片权限
 */
export const collectSubtreeIds = (node: any): number[] => {
  const ids: number[] = []
  const walk = (n: any) => {
    ids.push(n.id)
    n.children?.forEach(walk)
  }
  walk(node)
  return ids
}

/**
 * 一次性建好 资源 id → 子树 id 列表 的索引。
 *
 * **为什么不在模板里现算**：按钮文案要在每次勾选变化后对每个可见行重算一遍
 * （「全选下级」还是「取消下级」取决于该片是否已勾满）。树有一两千个节点，
 * 虚拟化下一屏约 20 行，而顶层菜单的子树能有几百个 id —— 现算就是
 * 20 × 几百 次遍历、每次重渲染都来一遍。建一次索引后每行只剩一次 Map 查 + 一次 every
 *
 * 内部走 collectSubtreeIds 而不是另写一份遍历：两份遍历逻辑迟早漂移，
 * 漂了之后「按钮上显示的数量」与「点下去实际勾中的数量」就不是同一个数了
 */
export const buildSubtreeIndex = (tree: any[]): Map<number, number[]> => {
  const index = new Map<number, number[]>()
  const walk = (nodes: any[]) => {
    nodes.forEach((node) => {
      index.set(node.id, collectSubtreeIds(node))
      if (node.children?.length) walk(node.children)
    })
  }
  walk(tree)
  return index
}

/**
 * 该片资源是否已被完整勾选 —— 决定按钮显示「取消下级」还是「全选下级」。
 *
 * ⚠️ 没有索引（`undefined`）或空数组时返回 **false**：这类行本来就不该渲染按钮
 * （叶子节点没有下级），但万一渲染出来了，显示「全选下级」至多是多点一次，
 * 显示「取消下级」则会把一个**没勾上的**资源当成已勾上的去取消，看着像按钮失灵
 */
export const isSubtreeFullyChecked = (
  subtreeIds: number[] | undefined,
  checkedSet: ReadonlySet<number>
): boolean => {
  if (!subtreeIds?.length) return false
  return subtreeIds.every((id) => checkedSet.has(id))
}

/**
 * 到期时间填了过去的时间 = 保存即「已过期」，几乎一定是手误，先问一句。
 *
 * 抽出来是给单条表单与批量表单共用的：**两个入口必须是同一句文案**。
 * 同一个手误在两处得到不同提示，用户会以为是两回事
 *
 * @returns true 表示可以继续提交（没填到期时间、时间不在过去、或用户点了继续）
 */
export const confirmPastExpireTime = async (expireTime?: string): Promise<boolean> => {
  if (!expireTime || !dayjs(expireTime).isBefore(dayjs())) return true
  const message = useMessage()
  const ok = await message
    .confirm('到期时间早于当前时间，保存后该授权会立即处于「已过期」状态。是否继续？')
    .catch(() => false)
  return !!ok
}
