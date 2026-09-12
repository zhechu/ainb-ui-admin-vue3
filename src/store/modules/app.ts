import { getUserThemeConfig, updateUserThemeConfig } from '@/api/system/user/preference'
import { CACHE_KEY, useCache } from '@/hooks/web/useCache'
import { ElementPlusSize } from '@/types/elementPlus'
import { LayoutType, VbenLayoutType } from '@/types/layout'
import { ThemeTypes } from '@/types/theme'
import { humpToUnderline, setCssVar } from '@/utils'
import { colorIsDark, getCssColorVariable, hexToRGB, lighten, mix } from '@/utils/color'
import { isHeaderNavLayout, normalizeLayout } from '@/utils/layout'
import { ElMessage } from 'element-plus'
import { defineStore } from 'pinia'
import { watch } from 'vue'
import { store } from '../index'

const { wsCache } = useCache()

/** 标签页高度，与 var.css 的 --tags-view-height 保持一致 */
const TAGS_VIEW_HEIGHT = '36px'

export interface UserThemeConfig {
  breadcrumb: boolean
  breadcrumbIcon: boolean
  uniqueOpened: boolean
  hamburger: boolean
  screenfull: boolean
  search: boolean
  size: boolean
  locale: boolean
  message: boolean
  im: boolean
  tagsView: boolean
  tagsViewImmerse: boolean
  tagsViewIcon: boolean
  logo: boolean
  fixedHeader: boolean
  greyMode: boolean
  layout: LayoutType
  isDark: boolean
  currentSize: ElementPlusSize
  theme: ThemeTypes
  fixedMenu: boolean
}

interface AppState extends UserThemeConfig {
  // 以下均为运行时状态，不参与持久化
  pageLoading: boolean
  title: string
  userInfo: string
  sizeMap: ElementPlusSize[]
  mobile: boolean
  collapse: boolean
  themeConfigLoaded: boolean
}

/**
 * 会同步到服务端的用户偏好字段白名单，也是快照的字段顺序。
 *
 * 这是持久化的唯一入口：运行时状态（pageLoading / mobile / collapse / title /
 * themeConfigLoaded）一律不进快照，避免路由跳转、窗口缩放这类临时变化触发写库。
 */
const PREFERENCE_KEYS = [
  'breadcrumb',
  'breadcrumbIcon',
  'uniqueOpened',
  'hamburger',
  'screenfull',
  'search',
  'size',
  'locale',
  'message',
  'im',
  'tagsView',
  'tagsViewImmerse',
  'tagsViewIcon',
  'logo',
  'fixedHeader',
  'greyMode',
  'layout',
  'isDark',
  'currentSize',
  'theme',
  'fixedMenu'
] as const

/** 主题色字段顺序，用于快照序列化保持稳定 */
const THEME_KEYS = [
  'elColorPrimary',
  'leftMenuBorderColor',
  'leftMenuBgColor',
  'leftMenuBgLightColor',
  'leftMenuBgActiveColor',
  'leftMenuCollapseBgActiveColor',
  'leftMenuTextColor',
  'leftMenuTextActiveColor',
  'logoTitleTextColor',
  'logoBorderColor',
  'topHeaderBgColor',
  'topHeaderTextColor',
  'topHeaderHoverColor',
  'topToolBorderColor'
] as const

const DEFAULT_THEME: Required<ThemeTypes> = {
  elColorPrimary: '#3473ff',
  leftMenuBorderColor: '#202a36',
  leftMenuBgColor: '#202a36',
  leftMenuBgLightColor: '#263442',
  leftMenuBgActiveColor: 'rgb(52 115 255 / 18%)',
  leftMenuCollapseBgActiveColor: 'rgb(52 115 255 / 24%)',
  leftMenuTextColor: '#b7c3d0',
  leftMenuTextActiveColor: '#ffffff',
  logoTitleTextColor: '#ffffff',
  logoBorderColor: '#202a36',
  topHeaderBgColor: '#ffffff',
  topHeaderTextColor: '#344054',
  topHeaderHoverColor: '#f2f5f9',
  topToolBorderColor: '#e9edf2'
}

const createDefaultThemeConfig = (): UserThemeConfig => ({
  breadcrumb: true,
  breadcrumbIcon: true,
  uniqueOpened: true,
  hamburger: true,
  screenfull: true,
  search: true,
  size: true,
  locale: true,
  message: true,
  im: true,
  tagsView: true,
  tagsViewImmerse: false,
  tagsViewIcon: true,
  logo: true,
  fixedHeader: true,
  greyMode: false,
  layout: 'sidebar-nav',
  isDark: false,
  currentSize: 'default',
  theme: { ...DEFAULT_THEME },
  fixedMenu: false
})

// region 持久化管线状态
const PERSIST_DEBOUNCE = 600
/** 连续改动时防抖会被不断推迟，用 maxWait 兜底，保证最多 2s 一定落一次库 */
const PERSIST_MAX_WAIT = 2000

let stopPreferenceWatch: (() => void) | undefined
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let maxWaitTimer: ReturnType<typeof setTimeout> | undefined
let beforeUnloadHandler: (() => void) | undefined
let persistUserId: number | undefined
let lastPersistedSnapshot = ''
let persistChain: Promise<void> = Promise.resolve()

const clearPersistTimers = () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = undefined
  }
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer)
    maxWaitTimer = undefined
  }
}

const schedulePersist = (flush: () => void) => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer)
      maxWaitTimer = undefined
    }
    flush()
  }, PERSIST_DEBOUNCE)
  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = undefined
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = undefined
      }
      flush()
    }, PERSIST_MAX_WAIT)
  }
}
// endregion

const isElementPlusSize = (value: unknown): value is ElementPlusSize =>
  value === 'default' || value === 'large' || value === 'small'

const parseThemeConfig = (serialized: unknown): Partial<UserThemeConfig> | undefined => {
  if (typeof serialized !== 'string' || !serialized.trim()) {
    return undefined
  }
  try {
    const parsed = JSON.parse(serialized)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 按固定字段顺序序列化偏好快照。
 *
 * JSON.stringify 的 key 顺序取决于对象构造过程，历史配置和新配置即使内容相同也可能
 * 序列化出不同字符串，导致每次刷新都误判为「有变化」而重复写库。这里固定顺序后，
 * 快照可以直接用字符串比对来判断脏值。
 */
const serializePreference = (config: UserThemeConfig): string => {
  const ordered: Record<string, unknown> = {}
  for (const key of PREFERENCE_KEYS) {
    if (key === 'theme') {
      const theme: Record<string, unknown> = {}
      for (const themeKey of THEME_KEYS) {
        theme[themeKey] = config.theme[themeKey]
      }
      ordered[key] = theme
    } else {
      ordered[key] = config[key]
    }
  }
  return JSON.stringify(ordered)
}

const readStoredCollapse = (): boolean => wsCache.get(CACHE_KEY.SIDEBAR_COLLAPSE) === true

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    userInfo: 'userInfo',
    sizeMap: ['default', 'large', 'small'],
    mobile: false,
    collapse: readStoredCollapse(),
    title: import.meta.env.VITE_APP_TITLE,
    pageLoading: false,
    themeConfigLoaded: false,
    ...createDefaultThemeConfig()
  }),
  getters: {
    getBreadcrumb(): boolean {
      return this.breadcrumb
    },
    getBreadcrumbIcon(): boolean {
      return this.breadcrumbIcon
    },
    getCollapse(): boolean {
      return this.collapse
    },
    getUniqueOpened(): boolean {
      return this.uniqueOpened
    },
    getHamburger(): boolean {
      return this.hamburger
    },
    getScreenfull(): boolean {
      return this.screenfull
    },
    getSearch(): boolean {
      return this.search
    },
    getSize(): boolean {
      return this.size
    },
    getLocale(): boolean {
      return this.locale
    },
    getMessage(): boolean {
      return this.message
    },
    getIm(): boolean {
      return this.im
    },
    getTagsView(): boolean {
      return this.tagsView
    },
    getTagsViewImmerse(): boolean {
      return this.tagsViewImmerse
    },
    getTagsViewIcon(): boolean {
      return this.tagsViewIcon
    },
    getLogo(): boolean {
      return this.logo
    },
    getFixedHeader(): boolean {
      return this.fixedHeader
    },
    getGreyMode(): boolean {
      return this.greyMode
    },
    getFixedMenu(): boolean {
      return this.fixedMenu
    },
    getPageLoading(): boolean {
      return this.pageLoading
    },
    /** 用户保存的布局，供项目配置面板回显选中项 */
    getLayout(): LayoutType {
      return this.layout
    },
    /**
     * 实际渲染用的布局。
     *
     * 移动端强制单栏，但不改写用户保存的 layout —— 否则窗口一旦缩到 768px 以下，
     * 用户选的布局就被永久改写并落库，拉宽后再也回不来。
     */
    getEffectiveLayout(): VbenLayoutType {
      return this.mobile ? 'sidebar-nav' : normalizeLayout(this.layout)
    },
    getTitle(): string {
      return this.title
    },
    getUserInfo(): string {
      return this.userInfo
    },
    getIsDark(): boolean {
      return this.isDark
    },
    getCurrentSize(): ElementPlusSize {
      return this.currentSize
    },
    getSizeMap(): ElementPlusSize[] {
      return this.sizeMap
    },
    getMobile(): boolean {
      return this.mobile
    },
    getTheme(): ThemeTypes {
      return this.theme
    },
    getThemeConfigLoaded(): boolean {
      return this.themeConfigLoaded
    }
  },
  actions: {
    setPrimaryLight() {
      if (this.theme.elColorPrimary) {
        const color = this.isDark ? '#000000' : '#ffffff'
        const lightList = [3, 5, 7, 8, 9]
        lightList.forEach((v) => {
          setCssVar(`--el-color-primary-light-${v}`, mix(color, this.theme.elColorPrimary!, v / 10))
        })
        setCssVar('--el-color-primary-dark-2', mix(color, this.theme.elColorPrimary, 0.2))
        this.setAllColorRgbVars()
      }
    },

    setAllColorRgbVars() {
      const colorTypes = ['primary', 'success', 'warning', 'danger', 'error', 'info']
      colorTypes.forEach((type) => {
        const colorValue = getCssColorVariable(`--el-color-${type}`)
        if (!colorValue) {
          return
        }
        const rgbaString = hexToRGB(colorValue, 1)
        const rgbValues = rgbaString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
        if (rgbValues) {
          const [, r, g, b] = rgbValues
          setCssVar(`--el-color-${type}-rgb`, `${r}, ${g}, ${b}`)
        }
      })
    },

    setBreadcrumb(breadcrumb: boolean) {
      this.breadcrumb = breadcrumb
    },
    setBreadcrumbIcon(breadcrumbIcon: boolean) {
      this.breadcrumbIcon = breadcrumbIcon
    },
    /**
     * @param remember 是否记住折叠状态。折叠是设备级状态，只有用户主动点击折叠按钮时
     *   才写入本地缓存；移动端遮罩、窗口缩放这类被动折叠传 false，避免污染下次打开的默认值。
     */
    setCollapse(collapse: boolean, remember = true) {
      this.collapse = collapse
      if (remember) {
        wsCache.set(CACHE_KEY.SIDEBAR_COLLAPSE, collapse)
      }
    },
    /** 从移动端回到桌面端时，恢复用户在本设备上自己选的折叠状态 */
    restoreCollapse() {
      this.collapse = readStoredCollapse()
    },
    setUniqueOpened(uniqueOpened: boolean) {
      this.uniqueOpened = uniqueOpened
    },
    setHamburger(hamburger: boolean) {
      this.hamburger = hamburger
    },
    setScreenfull(screenfull: boolean) {
      this.screenfull = screenfull
    },
    setSearch(search: boolean) {
      this.search = search
    },
    setSize(size: boolean) {
      this.size = size
    },
    setLocale(locale: boolean) {
      this.locale = locale
    },
    setMessage(message: boolean) {
      this.message = message
    },
    setIm(im: boolean) {
      this.im = im
    },
    setTagsView(tagsView: boolean) {
      this.tagsView = tagsView
      setCssVar('--tags-view-height', tagsView ? TAGS_VIEW_HEIGHT : '0px')
    },
    setTagsViewImmerse(tagsViewImmerse: boolean) {
      this.tagsViewImmerse = tagsViewImmerse
    },
    setTagsViewIcon(tagsViewIcon: boolean) {
      this.tagsViewIcon = tagsViewIcon
    },
    setLogo(logo: boolean) {
      this.logo = logo
    },
    setFixedHeader(fixedHeader: boolean) {
      this.fixedHeader = fixedHeader
    },
    setGreyMode(greyMode: boolean) {
      this.greyMode = greyMode
    },
    setFixedMenu(fixedMenu: boolean) {
      this.fixedMenu = fixedMenu
    },
    setPageLoading(pageLoading: boolean) {
      this.pageLoading = pageLoading
    },
    setLayout(layout: LayoutType) {
      const normalizedLayout = normalizeLayout(layout)
      if (this.mobile && normalizedLayout !== 'sidebar-nav') {
        ElMessage.warning('移动端模式下不支持切换其他布局')
        return
      }
      if (this.layout === normalizedLayout) {
        return
      }
      this.layout = normalizedLayout
      this.applyLayoutTheme()
    },
    setTitle(title: string) {
      this.title = title
    },
    setIsDark(isDark: boolean) {
      this.isDark = isDark
      if (this.isDark) {
        document.documentElement.classList.add('dark')
        document.documentElement.classList.remove('light')
      } else {
        document.documentElement.classList.add('light')
        document.documentElement.classList.remove('dark')
      }
      this.setPrimaryLight()
    },
    setCurrentSize(currentSize: ElementPlusSize) {
      this.currentSize = currentSize
    },
    setMobile(mobile: boolean) {
      this.mobile = mobile
    },
    setTheme(theme: ThemeTypes) {
      this.theme = { ...this.theme, ...theme }
    },
    setCssVarTheme() {
      for (const key in this.theme) {
        const value = this.theme[key as keyof ThemeTypes]
        if (value) {
          setCssVar(`--${humpToUnderline(key)}`, value)
        }
      }
      this.setPrimaryLight()
    },

    // region 主题派生
    /**
     * 布局切换带来的主题联动。
     *
     * 只在用户主动切换布局时调用。原先这段逻辑散落在 Setting.vue 的 setup 和两个组件的
     * watch 里，导致每次渲染 Setting 组件都会把用户存的头部色强行改回 #fff 并写库。
     */
    applyLayoutTheme() {
      if (isHeaderNavLayout(this.layout)) {
        // 顶部导航布局下菜单即头部，深色头部会让整条导航过重，非暗黑模式统一压回浅色。
        // 注意不要顺带改写侧边栏配色——用户切回侧边栏布局时还要用回原来的颜色。
        if (!this.isDark) {
          this.setHeaderThemeColor('#ffffff')
        }
        this.setCollapse(false, false)
      } else {
        this.setMenuThemeColor(this.theme.leftMenuBgColor || DEFAULT_THEME.leftMenuBgColor)
      }
    },

    /** 设置系统主题色，并同步重算依赖主题色的菜单选中态 */
    setPrimaryColor(color: string) {
      setCssVar('--el-color-primary', color)
      this.setTheme({ elColorPrimary: color })
      this.setMenuThemeColor(this.theme.leftMenuBgColor || DEFAULT_THEME.leftMenuBgColor)
    },

    /** 设置头部背景色，文字/悬停/边框色由背景明暗推导 */
    setHeaderThemeColor(color: string) {
      const isDarkColor = colorIsDark(color)
      this.setTheme({
        topHeaderBgColor: color,
        topHeaderTextColor: isDarkColor ? '#ffffff' : '#344054',
        topHeaderHoverColor: isDarkColor ? lighten(color, 6) : '#f2f5f9',
        topToolBorderColor: isDarkColor ? color : '#e9edf2'
      })
      this.setCssVarTheme()
    },

    /** 设置菜单背景色，其余菜单相关色由背景明暗 + 当前主题色推导 */
    setMenuThemeColor(color: string) {
      // 从 store 取主题色而非读 CSS 变量：CSS 变量在初始化早期可能还没写入，
      // 读到空值会让派生色一次次漂移
      const primaryColor = this.theme.elColorPrimary || DEFAULT_THEME.elColorPrimary
      const isDarkColor = colorIsDark(color)
      this.setTheme({
        leftMenuBorderColor: isDarkColor ? 'inherit' : '#eee',
        leftMenuBgColor: color,
        leftMenuBgLightColor: isDarkColor ? lighten(color, 6) : '#f5f7fa',
        leftMenuBgActiveColor: hexToRGB(primaryColor, isDarkColor ? 0.18 : 0.1),
        leftMenuCollapseBgActiveColor: hexToRGB(primaryColor, isDarkColor ? 0.24 : 0.1),
        leftMenuTextColor: isDarkColor ? '#bfcbd9' : '#333333',
        leftMenuTextActiveColor: isDarkColor ? '#ffffff' : 'var(--el-color-primary)',
        logoTitleTextColor: isDarkColor ? '#ffffff' : 'inherit',
        logoBorderColor: isDarkColor ? color : '#eee'
      })
      this.setCssVarTheme()
    },
    // endregion

    // region 持久化
    getThemeConfigSnapshot(): UserThemeConfig {
      return {
        breadcrumb: this.breadcrumb,
        breadcrumbIcon: this.breadcrumbIcon,
        uniqueOpened: this.uniqueOpened,
        hamburger: this.hamburger,
        screenfull: this.screenfull,
        search: this.search,
        size: this.size,
        locale: this.locale,
        message: this.message,
        im: this.im,
        tagsView: this.tagsView,
        tagsViewImmerse: this.tagsViewImmerse,
        tagsViewIcon: this.tagsViewIcon,
        logo: this.logo,
        fixedHeader: this.fixedHeader,
        greyMode: this.greyMode,
        layout: this.layout,
        isDark: this.isDark,
        currentSize: this.currentSize,
        theme: { ...this.theme },
        fixedMenu: this.fixedMenu
      }
    },

    applyThemeConfig(config: Partial<UserThemeConfig>) {
      const defaults = createDefaultThemeConfig()
      const readBoolean = (key: keyof UserThemeConfig) =>
        typeof config[key] === 'boolean' ? (config[key] as boolean) : (defaults[key] as boolean)

      this.breadcrumb = readBoolean('breadcrumb')
      this.breadcrumbIcon = readBoolean('breadcrumbIcon')
      this.uniqueOpened = readBoolean('uniqueOpened')
      this.hamburger = readBoolean('hamburger')
      this.screenfull = readBoolean('screenfull')
      this.search = readBoolean('search')
      this.size = readBoolean('size')
      this.locale = readBoolean('locale')
      this.message = readBoolean('message')
      this.im = readBoolean('im')
      this.tagsView = readBoolean('tagsView')
      this.tagsViewImmerse = readBoolean('tagsViewImmerse')
      this.tagsViewIcon = readBoolean('tagsViewIcon')
      this.logo = readBoolean('logo')
      this.fixedHeader = readBoolean('fixedHeader')
      this.greyMode = readBoolean('greyMode')
      this.fixedMenu = readBoolean('fixedMenu')
      this.layout = normalizeLayout(config.layout || defaults.layout)
      this.isDark = readBoolean('isDark')
      this.currentSize = isElementPlusSize(config.currentSize)
        ? config.currentSize
        : defaults.currentSize
      this.theme = { ...defaults.theme, ...(config.theme || {}) }
      this.themeConfigLoaded = true

      this.setIsDark(this.isDark)
      this.setCssVarTheme()
      setCssVar('--tags-view-height', this.tagsView ? TAGS_VIEW_HEIGHT : '0px')
    },

    async loadUserThemeConfig(userId: number) {
      this.stopThemePersistence()
      const cacheKey = `${CACHE_KEY.THEME_CONFIG_PREFIX}${userId}`
      const dirtyKey = `${CACHE_KEY.THEME_CONFIG_DIRTY_PREFIX}${userId}`
      let remoteConfig: string | undefined
      let requestSucceeded = false

      try {
        const response = await getUserThemeConfig()
        remoteConfig = response?.themeConfig
        requestSucceeded = true
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[Theme] 读取用户主题配置失败，降级使用本地缓存', error)
        }
      }

      // 数据库是配置的唯一来源；两种情况下改用本地值：
      // 1. dirty 标记存在，说明上次会话有改动没确认落库（例如改完设置立刻刷新），它比服务端更新
      // 2. 接口不可用，降级到上次成功保存的缓存，避免直接掉回默认配置
      const dirtyConfig = wsCache.get(dirtyKey)
      const fallbackConfig = requestSucceeded ? remoteConfig : wsCache.get(cacheKey)
      this.applyThemeConfig(parseThemeConfig(dirtyConfig || fallbackConfig) || {})

      const snapshot = serializePreference(this.getThemeConfigSnapshot())
      wsCache.set(cacheKey, snapshot)
      this.initThemePersistence(userId)

      // 无记录、字段缺失、历史格式或存在未落库的改动，统一回写成规范化快照
      if (requestSucceeded && remoteConfig !== snapshot) {
        await this.persistCurrentThemeConfig(true)
      } else {
        wsCache.delete(dirtyKey)
      }
    },

    initThemePersistence(userId: number) {
      persistUserId = userId
      lastPersistedSnapshot = serializePreference(this.getThemeConfigSnapshot())

      // 只监听序列化后的偏好快照：getter 内部仅读取白名单字段，因此 pageLoading、
      // collapse、mobile 这些运行时状态的变化根本不会触发回调
      stopPreferenceWatch = watch(
        () => serializePreference(this.getThemeConfigSnapshot()),
        (snapshot) => {
          if (!this.themeConfigLoaded || persistUserId !== userId) {
            return
          }
          if (snapshot === lastPersistedSnapshot) {
            return
          }
          schedulePersist(() => this.persistCurrentThemeConfig())
        },
        { flush: 'post' }
      )

      beforeUnloadHandler = () => {
        // 防抖窗口里还压着未落库的改动时补一发，同时 dirty 标记已经写进 localStorage，
        // 即使请求没发出去，下次登录也能从本地恢复
        if (debounceTimer || maxWaitTimer) {
          clearPersistTimers()
          this.persistCurrentThemeConfig()
        }
      }
      window.addEventListener('beforeunload', beforeUnloadHandler)
    },

    stopThemePersistence() {
      clearPersistTimers()
      stopPreferenceWatch?.()
      stopPreferenceWatch = undefined
      if (beforeUnloadHandler) {
        window.removeEventListener('beforeunload', beforeUnloadHandler)
        beforeUnloadHandler = undefined
      }
      persistUserId = undefined
      lastPersistedSnapshot = ''
      this.themeConfigLoaded = false
    },

    /**
     * @param force 跳过快照比对强制写库。「清空缓存并重置」必须用 force，
     *   否则重置后的快照恰好等于上次已落库的值时会被静默跳过。
     */
    async persistCurrentThemeConfig(force = false) {
      if (!persistUserId) {
        return
      }
      const userId = persistUserId
      const snapshot = serializePreference(this.getThemeConfigSnapshot())
      if (!force && snapshot === lastPersistedSnapshot) {
        return
      }
      const cacheKey = `${CACHE_KEY.THEME_CONFIG_PREFIX}${userId}`
      const dirtyKey = `${CACHE_KEY.THEME_CONFIG_DIRTY_PREFIX}${userId}`
      wsCache.set(cacheKey, snapshot)
      wsCache.set(dirtyKey, snapshot)

      persistChain = persistChain
        .catch(() => undefined)
        .then(async () => {
          if (persistUserId !== userId) {
            return
          }
          try {
            await updateUserThemeConfig(snapshot)
            lastPersistedSnapshot = snapshot
            // 请求期间又有新改动时保留 dirty 标记，交给下一次落库确认
            if (serializePreference(this.getThemeConfigSnapshot()) === snapshot) {
              wsCache.delete(dirtyKey)
            }
          } catch (error) {
            if (import.meta.env.DEV) {
              console.warn('[Theme] 保存用户主题配置失败', error)
            }
          }
        })
      await persistChain
    },

    async resetUserThemeConfig() {
      this.applyThemeConfig(createDefaultThemeConfig())
      this.setCollapse(false)
      await this.persistCurrentThemeConfig(true)
    }
    // endregion
  },
  persist: false
})

export const useAppStoreWithOut = () => {
  return useAppStore(store)
}
