<script lang="ts" setup>
import { ElMessage } from 'element-plus'
import { useClipboard } from '@vueuse/core'

import { useAppStore } from '@/store/modules/app'
import { ThemeSwitch } from '@/layout/components/ThemeSwitch'
import ColorRadioPicker from './components/ColorRadioPicker.vue'
import InterfaceDisplay from './components/InterfaceDisplay.vue'
import LayoutRadioPicker from './components/LayoutRadioPicker.vue'
import { isHeaderNavLayout } from '@/utils/layout'
import { useSetting } from './useSetting'
import { getRuntimePortalList, type PortalRuntimeVO } from '@/api/infra/portal'
import { SYSTEM_COLOR_PRESETS, HEADER_COLOR_PRESETS, MENU_COLOR_PRESETS } from './presets'

defineOptions({ name: 'Setting' })

const { t } = useI18n()
const appStore = useAppStore()
const layout = computed(() => appStore.getLayout)
const { drawerVisible } = useSetting()

// 首页门户选择：抽屉首次打开时懒加载当前用户可见的已发布门户。
// 无门户访问权限（infra:portal:run）时接口返回空列表，整个区块隐藏。
const portalList = ref<PortalRuntimeVO[]>([])
const portalLoaded = ref(false)
const portalSectionVisible = computed(() => portalList.value.length > 0)
const homePortalCode = computed({
  get: () => appStore.homePortalCode || '',
  set: (code: string) => appStore.setHomePortalCode(code)
})
const loadPortals = async () => {
  if (portalLoaded.value) return
  portalLoaded.value = true
  try {
    portalList.value = (await getRuntimePortalList()) || []
  } catch {
    portalList.value = []
  }
}
watch(drawerVisible, (visible) => {
  if (visible) loadPortals()
})

// 三个颜色选择器都只是把用户的选择转交给 store，派生色（菜单选中态、头部文字色等）
// 统一在 store 的 action 里推导。
//
// 注意：这里不能有任何 setup 期的「修正」逻辑。此前组件挂载时会无条件执行
// `if (顶部导航布局 && 非暗色) headerTheme = '#fff'`，而 Setting 是常驻渲染的，
// 于是每次刷新都把用户存的头部色改成白色并写回数据库。
const systemTheme = computed({
  get: () => appStore.getTheme.elColorPrimary || '',
  set: (color: string) => appStore.setPrimaryColor(color)
})

const headerTheme = computed({
  get: () => appStore.getTheme.topHeaderBgColor || '',
  set: (color: string) => appStore.setHeaderThemeColor(color)
})

const menuTheme = computed({
  get: () => appStore.getTheme.leftMenuBgColor || '',
  set: (color: string) => appStore.setMenuThemeColor(color)
})

// 拷贝
const copyConfig = async () => {
  const { copy, copied, isSupported } = useClipboard({
    legacy: true,
    source: `
      // 面包屑
      breadcrumb: ${appStore.getBreadcrumb},
      // 面包屑图标
      breadcrumbIcon: ${appStore.getBreadcrumbIcon},
      // 折叠图标
      hamburger: ${appStore.getHamburger},
      // 全屏图标
      screenfull: ${appStore.getScreenfull},
      // 尺寸图标
      size: ${appStore.getSize},
      // 多语言图标
      locale: ${appStore.getLocale},
      // 消息图标
      message: ${appStore.getMessage},
      // IM 即时通讯图标
      im: ${appStore.getIm},
      // 标签页
      tagsView: ${appStore.getTagsView},
      // 标签页
      tagsViewImmerse: ${appStore.getTagsViewImmerse},
      // 标签页图标
      tagsViewIcon: ${appStore.getTagsViewIcon},
      // logo
      logo: ${appStore.getLogo},
      // 菜单手风琴
      uniqueOpened: ${appStore.getUniqueOpened},
      // 固定header
      fixedHeader: ${appStore.getFixedHeader},
      // 灰色模式
      greyMode: ${appStore.getGreyMode},
      // layout布局
      layout: '${appStore.getLayout}',
      // 暗黑模式
      isDark: ${appStore.getIsDark},
      // 组件尺寸
      currentSize: '${appStore.getCurrentSize}',
      // 主题相关
      theme: {
        // 主题色
        elColorPrimary: '${appStore.getTheme.elColorPrimary}',
        // 左侧菜单边框颜色
        leftMenuBorderColor: '${appStore.getTheme.leftMenuBorderColor}',
        // 左侧菜单背景颜色
        leftMenuBgColor: '${appStore.getTheme.leftMenuBgColor}',
        // 左侧菜单浅色背景颜色
        leftMenuBgLightColor: '${appStore.getTheme.leftMenuBgLightColor}',
        // 左侧菜单选中背景颜色
        leftMenuBgActiveColor: '${appStore.getTheme.leftMenuBgActiveColor}',
        // 左侧菜单收起选中背景颜色
        leftMenuCollapseBgActiveColor: '${appStore.getTheme.leftMenuCollapseBgActiveColor}',
        // 左侧菜单字体颜色
        leftMenuTextColor: '${appStore.getTheme.leftMenuTextColor}',
        // 左侧菜单选中字体颜色
        leftMenuTextActiveColor: '${appStore.getTheme.leftMenuTextActiveColor}',
        // logo字体颜色
        logoTitleTextColor: '${appStore.getTheme.logoTitleTextColor}',
        // logo边框颜色
        logoBorderColor: '${appStore.getTheme.logoBorderColor}',
        // 头部背景颜色
        topHeaderBgColor: '${appStore.getTheme.topHeaderBgColor}',
        // 头部字体颜色
        topHeaderTextColor: '${appStore.getTheme.topHeaderTextColor}',
        // 头部悬停颜色
        topHeaderHoverColor: '${appStore.getTheme.topHeaderHoverColor}',
        // 头部边框颜色
        topToolBorderColor: '${appStore.getTheme.topToolBorderColor}'
      }
    `
  })
  if (!isSupported) {
    ElMessage.error(t('setting.copyFailed'))
  } else {
    await copy()
    if (unref(copied)) {
      ElMessage.success(t('setting.copySuccess'))
    }
  }
}

// 清空缓存
const clear = async () => {
  await appStore.resetUserThemeConfig()
  window.location.reload()
}
</script>

<template>
  <ElDrawer v-model="drawerVisible" :z-index="4000" direction="rtl" size="350px">
    <template #header>
      <span class="text-16px font-700">{{ t('setting.projectSetting') }}</span>
    </template>

    <div class="setting-body">
      <!-- 首页门户 -->
      <section v-if="portalSectionVisible" class="setting-section">
        <div class="setting-section-title">{{ t('setting.homePortal') }}</div>
        <el-select
          v-model="homePortalCode"
          class="w-full"
          popper-class="setting-home-portal-popper"
        >
          <el-option :label="t('setting.homePortalDefault')" value="" />
          <el-option
            v-for="portal in portalList"
            :key="portal.code"
            :label="portal.name"
            :value="portal.code"
          >
            <span>{{ portal.name }}</span>
            <el-tag v-if="portal.type === 1" size="small" class="ml-8px">
              {{ t('setting.homePortalLinkTag') }}
            </el-tag>
          </el-option>
        </el-select>
      </section>

      <!-- 主题（明暗） -->
      <section class="setting-section">
        <div class="setting-section-title">{{ t('setting.theme') }}</div>
        <div class="setting-row">
          <span class="setting-row-label">{{ t('setting.darkMode') }}</span>
          <ThemeSwitch />
        </div>
      </section>

      <!-- 布局 -->
      <section class="setting-section">
        <div class="setting-section-title">{{ t('setting.layout') }}</div>
        <LayoutRadioPicker />
      </section>

      <!-- 系统主题 -->
      <section class="setting-section">
        <div class="setting-section-title">{{ t('setting.systemTheme') }}</div>
        <ColorRadioPicker v-model="systemTheme" :schema="SYSTEM_COLOR_PRESETS" />
      </section>

      <!-- 头部主题 -->
      <section class="setting-section">
        <div class="setting-section-title">{{ t('setting.headerTheme') }}</div>
        <ColorRadioPicker v-model="headerTheme" :schema="HEADER_COLOR_PRESETS" />
      </section>

      <!-- 菜单主题 -->
      <section v-if="!isHeaderNavLayout(layout)" class="setting-section">
        <div class="setting-section-title">{{ t('setting.menuTheme') }}</div>
        <ColorRadioPicker v-model="menuTheme" :schema="MENU_COLOR_PRESETS" />
      </section>

      <!-- 界面显示 -->
      <section class="setting-section">
        <div class="setting-section-title">{{ t('setting.interfaceDisplay') }}</div>
        <InterfaceDisplay />
      </section>
    </div>

    <template #footer>
      <div class="flex gap-8px">
        <el-button class="flex-1" @click="copyConfig">
          {{ t('setting.copy') }}
        </el-button>
        <el-button class="flex-1" type="danger" @click="clear">
          {{ t('setting.clearAndReset') }}
        </el-button>
      </div>
    </template>
  </ElDrawer>
</template>

<style lang="scss">
/* 本抽屉遮罩 z-index=4000，下拉浮层默认仅 2000 出头，会被抽屉盖住点不到 */
.setting-home-portal-popper {
  z-index: 4500 !important;
}

/* 取色器浮层同理，需高于抽屉遮罩 */
.setting-color-popper {
  z-index: 4500 !important;
}

/*
  面板排版：左对齐 + 紧凑分节，替代原先居中大留白的 ElDivider 堆叠。
  分节标题用小号次要色文字，控件紧跟其下，纵向间距收紧。
*/
.setting-body {
  text-align: left;
}

.setting-section {
  margin-bottom: 18px;
}

.setting-section-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.setting-row-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
</style>
