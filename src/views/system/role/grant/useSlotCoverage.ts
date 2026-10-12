import { ref } from 'vue'
import * as GrantApi from '@/api/system/grant'
import type { SlotMappingVO } from '@/api/system/grant'

/**
 * 槽位覆盖度的**数据层**：一份全量槽位映射 + 它的取数状态。
 *
 * **边界划在哪**：算覆盖度的领域逻辑全在 `batchGrant.ts#computeRuleSlotCoverage`（纯函数、可测），
 * 这里只管「数据从哪来、到手了没有」。与 `useResourceCatalog` 是同一种切法。
 *
 * 🔴 **为什么在 open() 里 eagerly 拉一次，而不是 watch(ruleId) 懒加载**：
 * 全量结果与「当前选了哪个规则」**无关** —— 于是快速切换规则时的请求竞态
 * 从「要处理」变成「结构上不存在」，不用请求序号、也不用 AbortController。
 * 懒加载能省的只有一次两百来行的 GET，换来的是一个必须正确处理否则会显示错误覆盖度的竞态。
 *
 * 🔴 **state 初值是 'loading' 而不是 'ready'**：UI 在 `state !== 'ready'` 时显示
 * 「核对中 / 无法核对」，**绝不默认绿**。默认绿意味着「取数还没回来」这段时间里
 * 一个缺槽位的规则被报成安全，而那正好是用户最可能立刻点提交的时间窗。
 *
 * ⚠️ 生命周期：抽屉**不加** `destroy-on-close`，所以本 composable 常驻在表单的 setup 里，
 * `ensureLoaded` 的语义是「一次页面停留只拉一次」。与 `useResourceCatalog` 同口径，
 * 理由也相同：槽位映射由管理员维护，同一次授权操作期间不会变；
 * 换成模块级缓存会把过期窗口从「一次页面停留」放大到「一次 SPA 会话」
 */
export type SlotCoverageState = 'loading' | 'ready' | 'failed'

export const useSlotCoverage = () => {
  const slotMappings = ref<SlotMappingVO[]>([])
  const state = ref<SlotCoverageState>('loading')
  /**
   * 完成后**不置回 null**：置回就等于「下次调用重新拉」，那会破坏
   * 「一次页面停留只拉一次」，也让并发调用重新需要去重逻辑
   */
  let inflight: Promise<void> | null = null

  const ensureLoaded = (): Promise<void> => {
    if (!inflight) {
      inflight = GrantApi.getSlotMappingListAll()
        .then((list) => {
          slotMappings.value = list ?? []
          state.value = 'ready'
        })
        .catch(() => {
          // 🔴 只置状态，**不抛**。覆盖度是建议性的：操作者没有 system:slot-mapping:query
          // 权限点时这个请求会失败，那时抛出去会让整个抽屉的 open() 失败；
          // 而 computeRuleSlotCoverage 见 state='failed' 会把 uncoveredIds 强制成空数组，
          // 退化成「无法核对」而不是「178 个数据集全缺槽位」那句假话
          slotMappings.value = []
          state.value = 'failed'
        })
    }
    return inflight
  }

  return { slotMappings, state, ensureLoaded }
}
