import { computed, nextTick, ref, type Ref } from 'vue'
import * as GrantApi from '@/api/system/grant'
import type { ResourceVO } from '@/api/system/grant'
import { handleTree } from '@/utils/tree'

/**
 * 资源树选择器的**数据层**（不含任何 UI 形态）。
 *
 * **为什么要抽出来**：单条授权弹窗（GrantForm）与批量授权弹窗（GrantBatchForm）
 * 要的是同一棵树、同一个「显示字段级资源」开关、同一套过滤逻辑，只是渲染形态不同
 * （前者塞在 el-select 的下拉里，后者是可见的带勾选框的树）。
 * 这个 fork 刚做完「动作词表四份副本收敛为一份」的整改 ——
 * 两个授权表单各复制一份树加载逻辑，就是下一份副本的种子。
 *
 * 抽的边界刻意只到数据层：勾选态、节点点击后改哪些表单字段，都是各自弹窗的关注点，
 * 拉进来会让这个 composable 变成第二个表单。
 *
 * @param treeRef 调用方持有的 el-tree-v2 实例 ref。过滤要直接打到实例上
 *        （`treeRef.value.filter(kw)`），所以由调用方创建后传进来
 */
export const useResourceTreePicker = (treeRef: Ref<any>) => {
  const resourceTree = ref<any[]>([])
  /**
   * 树里是否包含 COLUMN / FIELD 级资源。默认关 ——
   * 字段资源按表单数量线性增长，默认放开会把真正要配的 ACTION 淹没掉
   */
  const includeFieldLevel = ref(false)
  /** 弹窗生命周期内只拉一次；开关切换走 reloadResourceTree，不受这个标记影响 */
  const loaded = ref(false)

  const buildTree = (resources: ResourceVO[]) => {
    resourceTree.value = handleTree(resources, 'id', 'parentId')
  }

  const ensureLoaded = async () => {
    if (loaded.value) return
    buildTree(await GrantApi.getResourceList(undefined, includeFieldLevel.value))
    loaded.value = true
  }

  const reloadResourceTree = async () => {
    buildTree(await GrantApi.getResourceList(undefined, includeFieldLevel.value))
    // 换数据源会重置树的内部状态，过滤词得跟着清掉，否则新树带着上一次的过滤条件渲染
    nextTick(() => treeRef.value?.filter(''))
  }

  /** id → 节点，供回显与「按 id 找类型」用。树只有几百到一两千个节点，全量建索引够用 */
  const resourceById = computed(() => {
    const map = new Map<number, any>()
    const walk = (ns: any[]) =>
      ns.forEach((n) => {
        map.set(n.id, n)
        if (n.children?.length) walk(n.children)
      })
    walk(resourceTree.value)
    return map
  })

  const treeFilterMethod = (value: string, data: any) => {
    if (!value) return true
    const kw = value.toLowerCase()
    return (
      (data.name ?? '').toLowerCase().includes(kw) ||
      (data.permission ?? '').toLowerCase().includes(kw)
    )
  }

  // 输入转发给树过滤，150ms 防抖：不防抖每敲一个字符都触发一次全量重算
  let filterTimer: any = null
  const onResourceFilter = (value: string) => {
    if (filterTimer) clearTimeout(filterTimer)
    filterTimer = setTimeout(() => treeRef.value?.filter(value), 150)
  }

  const resetTreeFilter = () => nextTick(() => treeRef.value?.filter(''))

  return {
    resourceTree,
    includeFieldLevel,
    ensureLoaded,
    reloadResourceTree,
    resourceById,
    treeFilterMethod,
    onResourceFilter,
    resetTreeFilter
  }
}
