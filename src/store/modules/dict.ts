import { defineStore } from 'pinia'
import { store } from '../index'
// @ts-ignore
import { DictDataVO } from '@/api/system/dict/types'
import { CACHE_KEY, useCache } from '@/hooks/web/useCache'
import { getDictDataVersion, syncDictData } from '@/api/system/dict/dict.data'

const { wsCache } = useCache('localStorage')

/**
 * 缓存键按后端地址分开存
 *
 * 字典缓存放在 localStorage 后会跨标签页、跨会话复用，这是我们想要的。
 * 但同一个浏览器切换 dev / test / 生产后端时，两套环境的版本号都是从 0 开始计数的，
 * 不加区分就会出现「版本号一致但字典内容完全不同」——页面上的标签会静默显示成另一套环境的文案，
 * 而且因为版本号相等，永远不会自动纠正。
 */
const CACHE_SCOPE = import.meta.env.VITE_BASE_URL || ''
const DICT_CACHE_KEY = `${CACHE_KEY.DICT_CACHE}:${CACHE_SCOPE}`
const DICT_VERSION_KEY = `${CACHE_KEY.DICT_VERSION}:${CACHE_SCOPE}`

export interface DictValueType {
  value: any
  label: string
  clorType?: string
  cssClass?: string
}
export interface DictTypeType {
  dictType: string
  dictValue: DictValueType[]
}
export interface DictState {
  dictMap: Map<string, any>
  isSetDict: boolean
}

/** 把后端返回的扁平字典数据，按 dictType 归拢成 Map */
const buildDictMap = (list: DictDataVO[]) => {
  const dictDataMap = new Map<string, any>()
  list.forEach((dictData: DictDataVO) => {
    // 获得 dictType 层级
    const enumValueObj = dictDataMap[dictData.dictType]
    if (!enumValueObj) {
      dictDataMap[dictData.dictType] = []
    }
    // 处理 dictValue 层级
    dictDataMap[dictData.dictType].push({
      value: dictData.value,
      label: dictData.label,
      colorType: dictData.colorType,
      cssClass: dictData.cssClass,
      // 树形字典靠这两个字段建树。平铺字典的 parentId 恒为 0，
      // handleTree 会得到一棵全是根节点的树，与原来的平铺数组等价
      id: dictData.id,
      parentId: dictData.parentId
    })
  })
  return dictDataMap
}

export const useDictStore = defineStore('dict', {
  state: (): DictState => ({
    dictMap: new Map<string, any>(),
    isSetDict: false
  }),
  getters: {
    getDictMap(): Recordable {
      const dictMap = wsCache.get(DICT_CACHE_KEY)
      if (dictMap) {
        this.dictMap = dictMap
      }
      return this.dictMap
    },
    getIsSetDict(): boolean {
      return this.isSetDict
    }
  },
  actions: {
    async setDictMap() {
      const cached = wsCache.get(DICT_CACHE_KEY)
      const cachedVersion = wsCache.get(DICT_VERSION_KEY)
      // 版本号可能是 0（后端从未发生过字典变更），不能用真值判断，否则 0 会被当成「没缓存」
      if (cached && cachedVersion !== null && cachedVersion !== undefined) {
        // 先用本地这份把页面撑起来，别让首屏等一次网络往返
        this.dictMap = cached
        this.isSetDict = true
        try {
          const version = await getDictDataVersion()
          // 用「不等于」而不是「小于」：Redis 被清空后版本号会从头计数，
          // 任一方向的不一致都说明本地这份不可信，都要重新拉
          if (String(version) === String(cachedVersion)) {
            return
          }
        } catch {
          // 版本号拿不到时保持用本地缓存。这个接口只是个优化，
          // 不该因为它挂了就把整站的字典标签变成空白
          return
        }
      }
      await this.refreshDictMap()
    },

    /**
     * 拉取全量字典并落盘
     *
     * 版本号取自 /sync 的响应体，与数据来自同一次读取，因此一定是自洽的一对。
     * 不要改成「先单独请求版本号、再请求列表」——两次请求之间若发生字典变更，
     * 就会把新版本号和旧数据一起存下来，此后版本号永远比得上，缓存再也不会自动刷新。
     */
    async refreshDictMap() {
      const data = await syncDictData()
      if (!data || !data.list || data.list.length === 0) {
        return
      }
      this.dictMap = buildDictMap(data.list)
      this.isSetDict = true
      wsCache.set(DICT_CACHE_KEY, this.dictMap)
      wsCache.set(DICT_VERSION_KEY, data.version)
    },

    getDictByType(type: string) {
      if (!this.isSetDict) {
        this.setDictMap()
      }
      return this.dictMap[type]
    },

    async resetDict() {
      wsCache.delete(DICT_CACHE_KEY)
      wsCache.delete(DICT_VERSION_KEY)
      await this.refreshDictMap()
    }
  }
})

export const useDictStoreWithOut = () => {
  return useDictStore(store)
}
