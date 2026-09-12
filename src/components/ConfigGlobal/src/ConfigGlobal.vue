<script setup lang="ts">
import { provide, computed, watch, onMounted } from 'vue'
import { propTypes } from '@/utils/propTypes'
import { ComponentSize, ElConfigProvider } from 'element-plus'
import { useLocaleStore } from '@/store/modules/locale'
import { useWindowSize } from '@vueuse/core'
import { useAppStore } from '@/store/modules/app'
import { setCssVar } from '@/utils'
import { useDesign } from '@/hooks/web/useDesign'

const { variables } = useDesign()

const appStore = useAppStore()

const props = defineProps({
  size: propTypes.oneOf<ComponentSize>(['default', 'small', 'large']).def('default')
})

provide('configGlobal', props)

// 初始化所有主题色
onMounted(() => {
  appStore.setCssVarTheme()
})

const { width } = useWindowSize()

// 监听窗口变化
//
// 这里只维护「是否移动端」这一运行时状态，绝不写入 layout / collapse 这类会落库的偏好。
// 之前窗口一旦窄于 768px 就调 setLayout('sidebar-nav') + setCollapse(true)，
// 用户选的布局会被永久改写并同步到数据库，窗口拉宽后再也恢复不了。
// 现在移动端的单栏渲染由 store 的 getEffectiveLayout 派生，不触碰用户的原始配置。
watch(
  () => width.value,
  (width: number) => {
    const isMobile = width < 768
    setCssVar('--left-menu-min-width', isMobile ? '0' : '64px')
    // 只在移动端 / 桌面端真正切换时处理，避免每一像素的 resize 都改一遍状态
    if (appStore.getMobile === isMobile) {
      return
    }
    appStore.setMobile(isMobile)
    // 进移动端是被动折叠（不记入设备偏好），回到桌面端时恢复用户自己的折叠选择
    isMobile ? appStore.setCollapse(true, false) : appStore.restoreCollapse()
  },
  {
    immediate: true
  }
)

// 多语言相关
const localeStore = useLocaleStore()

const currentLocale = computed(() => localeStore.currentLocale)
</script>

<template>
  <ElConfigProvider
    :namespace="variables.elNamespace"
    :locale="currentLocale.elLocale"
    :message="{ max: 5 }"
    :size="size"
  >
    <slot></slot>
  </ElConfigProvider>
</template>
