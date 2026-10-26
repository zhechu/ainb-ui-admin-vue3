import type { App } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import { ElMessage } from 'element-plus'
import { createRouter, createWebHistory } from 'vue-router'
import remainingRouter from './modules/remaining'

// 创建路由实例
const router = createRouter({
  history: createWebHistory(import.meta.env.VITE_BASE_PATH), // createWebHashHistory URL带#，createWebHistory URL不带#
  strict: true,
  routes: remainingRouter as RouteRecordRaw[],
  scrollBehavior: () => {
    // 新开标签时、返回标签时，滚动条回到顶部，否则会保留上次标签的滚动位置。
    const scrollbarWrap = document.querySelector('.v-layout-content-scrollbar .el-scrollbar__wrap')
    if (scrollbarWrap) {
      // scrollbarWrap.scrollTo({ left: 0, top: 0, behavior: 'auto' })
      scrollbarWrap.scrollTop = 0
    }
    return { left: 0, top: 0 }
  }
})

// 处理动态导入失败（如重新构建后 chunk 哈希变化）：重载一次以拿到新包。
// 但失败也可能是持续性的（dev server 依赖优化态损坏、chunk 永久缺失），重载后必然再失败，
// 不限次就会退化成无限重载循环（实测 10s 内重载 39 次），所以冷却期内不再自动重载。
const CHUNK_RELOAD_AT_KEY = 'router:chunk-reload-at'
const CHUNK_RELOAD_COOLDOWN = 10_000

router.onError((error, to) => {
  if (
    !error.message.includes('Failed to fetch dynamically imported module') &&
    !error.message.includes('Importing a module script failed')
  ) {
    return
  }
  const now = Date.now()
  const lastReloadAt = Number(sessionStorage.getItem(CHUNK_RELOAD_AT_KEY) || 0)
  if (now - lastReloadAt < CHUNK_RELOAD_COOLDOWN) {
    ElMessage.error(`页面资源加载失败（${to.fullPath}），自动重载已停止，请检查网络或重新构建后再手动刷新`)
    console.error('[router] 动态导入持续失败，停止自动重载：', to.fullPath, error)
    return
  }
  sessionStorage.setItem(CHUNK_RELOAD_AT_KEY, String(now))
  window.location.assign(to.fullPath)
})

export const resetRouter = (): void => {
  const resetWhiteNameList = ['Redirect', 'RedirectRoot', 'Login', 'NoFound', 'Home']
  router.getRoutes().forEach((route) => {
    const { name } = route
    if (name && !resetWhiteNameList.includes(name as string)) {
      router.hasRoute(name) && router.removeRoute(name)
    }
  })
}

export const setupRouter = (app: App<Element>) => {
  app.use(router)
}

export default router
