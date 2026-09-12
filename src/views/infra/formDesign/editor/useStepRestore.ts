import { ref, watch, nextTick, type Ref } from 'vue'

/**
 * 步骤组件回显的统一处理
 *
 * 问题：步骤组件被父组件用 v-show 控制，父组件挂载时它们就一起挂载了。
 * 此时父组件的异步 loadData() 还没返回，onMounted 里读到的 formData 全是空值，
 * restore() 什么都做不了 → 界面空白。
 *
 * 方案：watch 监听数据到达的时刻，只在首次拿到数据时回显一次。
 *
 * @param modelData 父组件传入的 props.modelData
 * @param restoreFn 回显函数，由各步骤组件提供
 * @param watchKeys 提取要监听的关键字段（如 formConf / listConf）
 */
export function useStepRestore(
  modelData: Ref<any>,
  restoreFn: () => void,
  watchKeys: (data: any) => any[]
) {
  const restored = ref(false)

  watch(
    () => [modelData.value.id, ...watchKeys(modelData.value)],
    async ([id, ...dataKeys]) => {
      // 已回显过，不再触发 —— 否则用户每改一次配置就被数据"弹回去"
      if (restored.value) return

      // 新建场景（无 id）无需回显
      if (!id) return

      // 有 id 但关键数据还没到，继续等
      if (dataKeys.every((v) => !v)) return

      // 数据到位，等 DOM 更新后回显
      await nextTick()
      restoreFn()
      restored.value = true
    },
    { immediate: true }
  )

  return { restored }
}
