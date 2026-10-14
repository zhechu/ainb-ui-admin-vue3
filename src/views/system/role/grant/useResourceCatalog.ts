import { computed, ref } from 'vue'
import * as GrantApi from '@/api/system/grant'
import type { ResourceVO } from '@/api/system/grant'
import { handleTree } from '@/utils/tree'
import { buildResourceIndex } from './resourceTree'

/**
 * 资源目录的**数据层**：一棵树、一个「显示字段级资源」开关、一份 id 索引。
 *
 * **为什么要抽出来**：单条授权抽屉（GrantForm）与批量授权抽屉（GrantBatchForm）
 * 要的是同一份数据。这个 fork 刚做完「动作词表四份副本收敛为一份」的整改 ——
 * 两个授权表单各复制一份树加载逻辑，就是下一份副本的种子。
 *
 * **边界划在哪**：与 DOM 耦合的事全部归 ResourceTreePicker（`filter` / `setCheckedKeys` /
 * `setExpandedKeys` / 测高），这里只留「数据从哪来、长什么形状」。
 * 于是本 composable 不再需要调用方传 treeRef 进来，也不认识任何组件实例。
 *
 * 🔴 **持有者必须是父级表单，不是 picker**。GrantForm 要 `resourceById` 算
 * `isFieldLevelResource`（字段显示模式的 `:disabled`）与 `actionGroups`（动作下拉收窄）；
 * GrantBatchForm 要它算 `selectedTypes` → `intersectGrantActionOptions` →
 * 那个剔除死动作的 watch。这是一条**活的响应链**，输入是勾选状态。
 * 数据层若放进 picker，父级就得隔着 defineExpose 读
 * `pickerRef.value?.resourceById?.get(...)` —— 技术上能跑（expose 代理走 proxyRefs，
 * 依赖能被追踪），但穿过 template ref 的响应性是后续重构里最容易悄悄断掉的东西，
 * 断了还不报错，只会让那几个 computed 停在旧值上
 *
 * ⚠️ 生命周期：抽屉**不加** `destroy-on-close`，所以本 composable 与它缓存的树
 * 常驻在表单的 setup 里，`ensureLoaded` 的语义是「一次页面停留只拉一次」。
 * 这是有意选的：资源目录由管理员维护，同一次授权操作期间不会变；
 * 换成模块级缓存则会把过期窗口从「一次页面停留」放大到「一次 SPA 会话」，
 * 还得按 includeFieldLevel 分键，代价大于收益
 */
export const useResourceCatalog = () => {
  const resourceTree = ref<any[]>([])
  /**
   * 树里是否包含 COLUMN / FIELD 级资源。默认关 ——
   * 字段资源按表单数量线性增长，默认放开会把真正要配的 ACTION 淹没掉
   */
  const includeFieldLevel = ref(false)
  /** 一次页面停留只拉一次；开关切换走 reloadResourceTree，不受这个标记影响 */
  const loaded = ref(false)

  const buildTree = (resources: ResourceVO[]) => {
    resourceTree.value = handleTree(resources, 'id', 'parentId')
  }

  const ensureLoaded = async () => {
    if (loaded.value) return
    buildTree(await GrantApi.getResourceList(undefined, includeFieldLevel.value))
    loaded.value = true
  }

  /**
   * 换掉整棵树的数据源。
   *
   * ⚠️ 这里**不碰**树的过滤态。换数据源确实会让新树带着上一次的过滤条件渲染，
   * 但清理动作必须紧跟着一次 `setExpandedKeys([])`（否则 `filter('')` 会把 1086 个节点
   * 全展开，见 ResourceTreePicker#reset 的注释），跨文件做不到 —— 归 picker 管
   */
  const reloadResourceTree = async () => {
    buildTree(await GrantApi.getResourceList(undefined, includeFieldLevel.value))
  }

  /** id → 节点，供回显、面包屑与「按 id 找类型」用。一两千个节点，全量建索引够用 */
  const resourceById = computed(() => buildResourceIndex(resourceTree.value))

  return {
    resourceTree,
    includeFieldLevel,
    resourceById,
    ensureLoaded,
    reloadResourceTree
  }
}
