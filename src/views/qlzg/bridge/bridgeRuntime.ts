import { probeChunkUpload, type BridgeCapability } from '@/api/qlzg/bridge'
import { clientTypeDiagnostic, decide, setDesktopAvailability } from './localBridge'

/**
 * LocalBridge 探针 —— 一次会话只问一次，问不到就按「桌面端不存在」继续
 *
 * <h3>🔴 任何失败都返回 {@code null}，绝不抛出</h3>
 * 这个探针挂在上传抽屉的初始化上。它失败的话（网络、鉴权、后端还没部署这一版），
 * 上传必须照常能用 —— 一个「为了告诉你桌面端有没有」的请求把上传本身弄坏，
 * 是拿主功能给附属信息陪葬。{@code null} 交给 {@link setDesktopAvailability}
 * 会停在诚实那一侧（文案说「桌面客户端尚未发布」），所以失败的后果只是少一句推荐。
 *
 * <h3>⚠️ 缓存的是那个 Promise，不是结果</h3>
 * 抽屉可以反复开关，缓存结果的话第一次失败就永久失败；缓存 Promise 则并发开关只发一次请求，
 * 而失败之后**下一次开抽屉会重试**（把 rejected 的 Promise 丢掉再建一个）。
 * 重试是安全的：这个端点在 MVP 期不写任何东西，它只是回答一个问题。
 *
 * <h3>🔴 只探 {@code chunk-upload} 一项，不探五项</h3>
 * 六处文案的判据都是同一件事：「有没有一个支持分片与断点续传的本机客户端」。
 * 另外四项的降级在 MVP 期是**透明**的（选目录、服务端抽取、下载都已经能用，
 * 用户察觉不到差别），没有需要改口的文案；UKey 签章那一项 MVP 期没有任何界面入口。
 * 一次问五项等于四份没人读的结果，而每一次开抽屉都要等它们。
 */

let inflight: Promise<BridgeCapability | null> | null = null

/**
 * 问一次「分片上传在本机能不能用」，并把答案交给 {@link setDesktopAvailability}
 *
 * @return 信封；探针失败时 {@code null}
 */
export const refreshDesktopAvailability = (): Promise<BridgeCapability | null> => {
  if (!inflight) {
    inflight = probeChunkUpload()
      .then((cap) => {
        setDesktopAvailability(cap)
        // 端标识对不上是唯一能发现「X-Client-Type 没被读到」的机会，
        // 而它在数据上的表现只是账单上某一端恒为 0，不报错
        const diagnostic = clientTypeDiagnostic(cap, 'web')
        if (diagnostic) {
          console.warn('[LocalBridge]', diagnostic)
        }
        return cap
      })
      .catch((error) => {
        // 丢掉这个 Promise，下次开抽屉重试
        inflight = null
        setDesktopAvailability(null)
        console.warn('[LocalBridge] 能力探针失败，按「桌面客户端尚未发布」继续', error)
        return null
      })
  }
  return inflight
}

/**
 * 这一项在当前运行时该走哪条路 —— 供调用方在拿到信封之后分支
 *
 * <p>Web 端恒为 {@code degrade}（走 presign 单次直传）；I23 的 Electron 引用同一份文件，
 * 传 {@code 'desktop'} 进去，服务端把 {@code nativeSupported} 翻成 true 之后它就变 {@code native}，
 * 而后端与这个文件都不用改
 */
export const routeOf = (cap: BridgeCapability | null, runtime: 'web' | 'desktop' = 'web') =>
  cap == null ? null : decide(cap, runtime)
