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
    class="min-h-[calc(100vh-var(--top-tool-height)-var(--tags-view-height))] w-full bg-[var(--app-content-bg-color)] p-[var(--app-content-padding)] dark:bg-[var(--el-bg-color)]"
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
