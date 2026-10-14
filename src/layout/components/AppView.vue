<script lang="ts" setup>
import { useTagsViewStore } from '@/store/modules/tagsView'

defineOptions({ name: 'AppView' })

const tagsViewStore = useTagsViewStore()

const getCaches = computed((): string[] => {
  return tagsViewStore.getCachedViews
})

//region 无感刷新
const routerAlive = ref(true)
// 无感刷新，防止出现页面闪烁白屏
const reload = () => {
  routerAlive.value = false
  nextTick(() => (routerAlive.value = true))
}
// 为组件后代提供刷新方法
provide('reload', reload)
//endregion
</script>

<template>
  <!--
    内容区高度 = 视口 - 顶栏 - 标签页，四种布局下都成立：
    固定头部时顶栏脱离文档流、滚动容器自身已减去这段高度；非固定时顶栏在文档流内占位，
    减去的仍是同一段。标签页关闭时 --tags-view-height 由 store 置 0，无需额外分支。

    用 min-h 而非 h，超长页面仍可正常向下滚动。
  -->
  <section
    class="app-view min-h-[calc(100vh-var(--top-tool-height)-var(--tags-view-height))] w-full p-[var(--app-content-padding)]"
  >
    <router-view v-if="routerAlive">
      <template #default="{ Component, route }">
        <keep-alive :include="getCaches">
          <component :is="Component" :key="route.fullPath" />
        </keep-alive>
      </template>
    </router-view>
  </section>
</template>

<style lang="scss" scoped>
/*
  品牌画布：登录页同源的「底色 + 光斑 + 等距线稿」，但比登录页克制一档（长时间阅读）。
  做成 section 的多层背景 + background-attachment: fixed，而不是额外插一个 fixed div——
  插 div 要么盖住内容（positioned 层画在流内内容之上），要么被 section 自身不透明底色挡住；
  背景层没有堆叠问题，fixed 附着也让光斑不随滚动重绘。光斑不用 blur()：
  radial-gradient 本身已渐隐到透明，省掉一次大面积高斯模糊。
*/
.app-view {
  background-color: var(--app-content-bg-color);
  background-image: var(--brand-canvas-art), var(--brand-canvas-blob-1),
    var(--brand-canvas-blob-2);
  background-repeat: no-repeat, no-repeat, no-repeat;
  background-attachment: fixed, fixed, fixed;
  background-position:
    center,
    -120px -180px,
    right -80px top -220px;
  background-size:
    cover,
    560px 560px,
    620px 620px;
}
</style>
