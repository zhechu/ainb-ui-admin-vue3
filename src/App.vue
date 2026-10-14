<script lang="ts" setup>
import { isDark } from '@/utils/is'
import { useAppStore } from '@/store/modules/app'
import { useDesign } from '@/hooks/web/useDesign'
import routerSearch from '@/components/RouterSearch/index.vue'

defineOptions({ name: 'APP' })

const { getPrefixCls } = useDesign()
const prefixCls = getPrefixCls('app')
const appStore = useAppStore()
const currentSize = computed(() => appStore.getCurrentSize)
const greyMode = computed(() => appStore.getGreyMode)

// 未登录（如登录页）时的初始主题：优先用设备级「上次主题」缓存，让登录页与登录后
// 观感一致、避免登录瞬间跳变；无缓存才回落浏览器深浅色偏好。
// 已登录时 loadUserThemeConfig 已在 router.isReady() 阶段完成，themeConfigLoaded 为 true，这里不会覆盖。
const setDefaultTheme = () => {
  if (!appStore.getThemeConfigLoaded) {
    if (!appStore.applyGuestTheme()) {
      appStore.setIsDark(isDark())
    }
  }
}
setDefaultTheme()
</script>
<template>
  <ConfigGlobal :size="currentSize">
    <RouterView :class="greyMode ? `${prefixCls}-grey-mode` : ''" />
    <routerSearch />
  </ConfigGlobal>
</template>
<style lang="scss">
$prefix-cls: #{$namespace}-app;

.size {
  width: 100%;
  height: 100%;
}

html,
body {
  @extend .size;

  padding: 0 !important;
  margin: 0;
  overflow: hidden;

  #app {
    @extend .size;
  }
}

.#{$prefix-cls}-grey-mode {
  filter: grayscale(100%);
}
</style>
