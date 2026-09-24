import { CACHE_KEY, useCache } from '@/hooks/web/useCache'
import { useUserStore } from '@/store/modules/user'

/**
 * 「最近一次会话」的本地记忆
 *
 * <h3>为什么需要它</h3>
 * 悬浮窗与独立页是两个入口，但用户的心理是「同一个助手」。刷新页面、
 * 关掉抽屉再打开，都应该能接上刚才那句话 —— 会话本身早就在后端落库了
 * （agent_conversation / agent_message），丢的只是「我刚才在跟哪个会话说话」
 * 这一个指针。它不值得进后端（换设备本来也不该带着走），localStorage 正好。
 *
 * <h3>为什么按 userId 分片</h3>
 * 同一台机器上换账号登录是常态（演示、代运维）。键里带上 userId，
 * 别人登录时读不到我的会话指针，也就不必在登出流程里记得清理 ——
 * 少一处「忘了清就串号」的隐患。
 */

export interface LastConversation {
  id: number
  title?: string
  /** 记下时间，用来判断是否「还热乎」 */
  savedAt: number
  /** 保存时刻该会话是否仍在 30 分钟内活跃过 */
  fresh: boolean
}

/**
 * 多久以内算「同一次工作」
 *
 * 30 分钟内自动续上：用户查个资料、切个页面又回来，接上文才对。
 * 超过就不再自动加载 —— 隔天打开助手，多数人是来问<b>新</b>问题的，
 * 自动把他扔回昨天那个会话，反而要先退出来才能问。那种情况给一个
 * 显式的「继续上次对话」按钮（见 AssistantChat 的 offerResume），
 * 一次点击的成本远低于「我的新问题会不会跑到旧会话里去」的疑虑。
 */
const FRESH_WINDOW = 30 * 60 * 1000

/** 缓存保留 30 天，避免长期不用的浏览器里堆垃圾 */
const CACHE_EXPIRE = 30 * 24 * 60 * 60

const { wsCache } = useCache()

const cacheKey = () => {
  const userId = useUserStore().getUser?.id
  // 登录态还没就绪（id 为 0）时不要用兜底键写数据，否则会串到下一个用户
  return userId ? `${CACHE_KEY.AGENT_LAST_CONVERSATION_PREFIX}${userId}` : ''
}

export const useLastConversation = () => {
  const read = (): LastConversation | undefined => {
    const key = cacheKey()
    if (!key) return undefined
    const raw = wsCache.get(key) as { id: number; title?: string; savedAt: number } | null
    if (!raw?.id) return undefined
    return { ...raw, fresh: Date.now() - raw.savedAt <= FRESH_WINDOW }
  }

  const save = (id: number, title?: string) => {
    const key = cacheKey()
    if (!key || !id) return
    wsCache.set(key, { id, title, savedAt: Date.now() }, { exp: CACHE_EXPIRE })
  }

  const clear = () => {
    const key = cacheKey()
    if (key) wsCache.delete(key)
  }

  return { read, save, clear }
}
