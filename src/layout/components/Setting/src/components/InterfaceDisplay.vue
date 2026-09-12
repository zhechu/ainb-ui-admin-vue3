<script lang="ts" setup>
import { useDesign } from '@/hooks/web/useDesign'
import { useWatermark } from '@/hooks/web/useWatermark'
import { useAppStore } from '@/store/modules/app'

defineOptions({ name: 'InterfaceDisplay' })

const { t } = useI18n()
const { getPrefixCls } = useDesign()
const { setWatermark } = useWatermark()
const prefixCls = getPrefixCls('interface-display')
const appStore = useAppStore()

const water = ref()

// 面包屑
const breadcrumb = computed({
  get: () => appStore.getBreadcrumb,
  set: (show: boolean) => appStore.setBreadcrumb(show)
})

// 面包屑图标
const breadcrumbIcon = computed({
  get: () => appStore.getBreadcrumbIcon,
  set: (show: boolean) => appStore.setBreadcrumbIcon(show)
})

// 折叠图标
const hamburger = computed({
  get: () => appStore.getHamburger,
  set: (show: boolean) => appStore.setHamburger(show)
})

// 全屏图标
const screenfull = computed({
  get: () => appStore.getScreenfull,
  set: (show: boolean) => appStore.setScreenfull(show)
})

// 搜索图标
const search = computed({
  get: () => appStore.getSearch,
  set: (show: boolean) => appStore.setSearch(show)
})

// 尺寸图标
const size = computed({
  get: () => appStore.getSize,
  set: (show: boolean) => appStore.setSize(show)
})

// 多语言图标
const locale = computed({
  get: () => appStore.getLocale,
  set: (show: boolean) => appStore.setLocale(show)
})

// 消息图标
const message = computed({
  get: () => appStore.getMessage,
  set: (show: boolean) => appStore.setMessage(show)
})

// IM 即时通讯图标
const im = computed({
  get: () => appStore.getIm,
  set: (show: boolean) => appStore.setIm(show)
})

// 标签页
const tagsView = computed({
  get: () => appStore.getTagsView,
  set: (show: boolean) => appStore.setTagsView(show)
})

// 标签页沉浸
const tagsViewImmerse = computed({
  get: () => appStore.getTagsViewImmerse,
  set: (show: boolean) => appStore.setTagsViewImmerse(show)
})

// 标签页图标
const tagsViewIcon = computed({
  get: () => appStore.getTagsViewIcon,
  set: (show: boolean) => appStore.setTagsViewIcon(show)
})

// logo
const logo = computed({
  get: () => appStore.getLogo,
  set: (show: boolean) => appStore.setLogo(show)
})

// 菜单手风琴
const uniqueOpened = computed({
  get: () => appStore.getUniqueOpened,
  set: (show: boolean) => appStore.setUniqueOpened(show)
})

// 固定头部
const fixedHeader = computed({
  get: () => appStore.getFixedHeader,
  set: (show: boolean) => appStore.setFixedHeader(show)
})

// 灰色模式
const greyMode = computed({
  get: () => appStore.getGreyMode,
  set: (show: boolean) => appStore.setGreyMode(show)
})

// 固定菜单
const fixedMenu = computed({
  get: () => appStore.getFixedMenu,
  set: (show: boolean) => appStore.setFixedMenu(show)
})

// 设置水印
const setWater = () => {
  setWatermark(water.value)
}
</script>

<template>
  <div :class="prefixCls">
    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.breadcrumb') }}</span>
      <ElSwitch v-model="breadcrumb" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.breadcrumbIcon') }}</span>
      <ElSwitch v-model="breadcrumbIcon" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.hamburgerIcon') }}</span>
      <ElSwitch v-model="hamburger" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.screenfullIcon') }}</span>
      <ElSwitch v-model="screenfull" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.searchIcon') }}</span>
      <ElSwitch v-model="search" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.sizeIcon') }}</span>
      <ElSwitch v-model="size" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.localeIcon') }}</span>
      <ElSwitch v-model="locale" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.messageIcon') }}</span>
      <ElSwitch v-model="message" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.imIcon') }}</span>
      <ElSwitch v-model="im" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.tagsView') }}</span>
      <ElSwitch v-model="tagsView" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.tagsViewImmerse') }}</span>
      <ElSwitch v-model="tagsViewImmerse" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.tagsViewIcon') }}</span>
      <ElSwitch v-model="tagsViewIcon" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.logo') }}</span>
      <ElSwitch v-model="logo" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.uniqueOpened') }}</span>
      <ElSwitch v-model="uniqueOpened" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.fixedHeader') }}</span>
      <ElSwitch v-model="fixedHeader" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.greyMode') }}</span>
      <ElSwitch v-model="greyMode" />
    </div>

    <div class="flex items-center justify-between">
      <span class="text-14px">{{ t('setting.fixedMenu') }}</span>
      <ElSwitch v-model="fixedMenu" />
    </div>

    <div class="flex items-center justify-between gap-10px">
      <span class="shrink-0 whitespace-nowrap text-14px">{{ t('watermark.watermark') }}</span>
      <ElInput v-model="water" class="min-w-0 flex-1" @change="setWater()" />
    </div>
  </div>
</template>
