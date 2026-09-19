// 引入unocss css
import '@/plugins/unocss'

// 导入全局的svg图标
import '@/plugins/svgIcon'

// 初始化多语言
import { setupI18n } from '@/plugins/vueI18n'

// 引入状态管理
import { setupStore } from '@/store'

// 全局组件
import { setupGlobCom } from '@/components'

// 引入 element-plus
import { setupElementPlus } from '@/plugins/elementPlus'

// 引入 form-create
import { setupFormCreate } from '@/plugins/formCreate'

// 引入全局样式
import '@/styles/index.scss'

// 引入动画
import '@/plugins/animate.css'

// 路由
import router, { setupRouter } from '@/router'

// 指令
import { setupAuth, setupMountedFocus } from '@/directives'

import { createApp } from 'vue'

import App from './App.vue'

import './permission'

import '@/plugins/tongji' // 百度统计
import Logger from '@/utils/Logger'

import VueDOMPurifyHTML from 'vue-dompurify-html' // 解决v-html 的安全隐患

// 列表「序号」列的 :index 工厂（跨页连续编号）。
// auto-import 只注入 script 里用到的标识符，模板里的 :index="indexMethod(...)" 编译成 _ctx.indexMethod，
// 不会被注入；挂到 globalProperties 后模板可直接调用，各页无需 import。
import { indexMethod } from '@/utils/table'

// wangEditor 插件注册
import { setupWangEditorPlugin } from '@/views/bpm/model/form/PrintTemplate'

import print from 'vue3-print-nb' // 打印插件

// 处理 Vite 预加载模块失败（如重新构建后 chunk 哈希变化），自动刷新页面
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

// 创建实例
const setupAll = async () => {
  const app = createApp(App)

  // 模板里直接使用 indexMethod（见文件顶部注释）
  app.config.globalProperties.indexMethod = indexMethod

  await setupI18n(app)

  setupStore(app)

  setupGlobCom(app)

  setupElementPlus(app)

  setupFormCreate(app)

  setupRouter(app)

  // directives 指令
  setupAuth(app)
  setupMountedFocus(app)

  // wangEditor 插件注册
  setupWangEditorPlugin()

  await router.isReady()

  app.use(VueDOMPurifyHTML)

  // 打印
  app.use(print)

  app.mount('#app')
}

setupAll()

Logger.prettyPrimary(`欢迎使用`, import.meta.env.VITE_APP_TITLE)
