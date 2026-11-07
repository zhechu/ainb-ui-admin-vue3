import type { BridgeCapability, BridgeCapabilityCode, BridgeDegradeTo } from '@/api/qlzg/bridge'

/**
 * LocalBridge 的前端半边 —— 把服务端的能力信封翻译成「这一端该走哪条路」与「怎么跟用户说」
 *
 * <h3>🔴 它治的是一个已经在线上的 BUG：界面让用户去用一个不存在的客户端</h3>
 * 桌面端本体在 **I23**（V5 §15.2），而上传这一路的六处文案早就写好了「建议改用桌面客户端」
 * 「请改用桌面客户端上传这一份」「请检查网络或改用桌面客户端」。其中最坏的一处是
 * {@link relayWayOut} 对应的分支：走网页中转且单文件超 16 MB 时**硬拦**，
 * 而它给出的唯一出路就是那个不存在的客户端 —— 用户拿到的是一句**照做不了**的指示，
 * 反复重试结果都一样，而真正能解开的人（管理员，把存储换成支持预签名的 S3 兼容存储）
 * 压根没被提到。这类文案不会报错，只会让用户觉得系统在推诿。
 *
 * <h3>🔴 判据来自服务端，不在前端写死</h3>
 * 「桌面端有没有」这件事的权威答案是 {@code /qlzg/bridge/chunk-upload} 那个信封里的
 * {@code nativeSupported}，不是前端的一个常量。I23 上线时后端把它翻成 true，
 * 这六处文案**自动**变回「建议改用桌面客户端」，前端一行不改 ——
 * 这正是 D14 ①「契约签名一致」在前端的兑现形态（§13.4.4：前端资产是引用不是复制）。
 *
 * <h3>⚠️ 默认状态是「不可用」，探针没跑也是对的</h3>
 * {@link setDesktopAvailability} 没被调用时（探针失败、403、离线），
 * 所有文案都停在**诚实**那一侧。反过来默认成「可用」的话，探针一失败
 * 界面又开始推荐一个不存在的客户端 —— 那就等于这条修复只在网络好的时候生效。
 *
 * <h3>⚠️ 纯逻辑，不碰网络</h3>
 * 探针与缓存在同目录的 {@code bridgeRuntime.ts}，本文件只吃已经拿到的信封。
 * 这样 `localBridge.spec.ts` 能在 node 环境下跑（本仓 vitest 没有 jsdom），
 * 也让「文案对不对」这件事可以被逐条钉住。
 */

/** 谁在调。🔴 由调用方显式给出，不做运行时探测 —— I23 的 Electron 引用的是同一份文件 */
export type BridgeRuntime = 'web' | 'desktop'

/** 这一项该怎么走 */
export type BridgeRoute =
  /** 走本机原生实现（只有 I23 之后的桌面端会拿到） */
  | 'native'
  /** 走 Web 降级路径，功能可用 */
  | 'degrade'
  /** 没有降级实现，功能不可用（MVP 期只有 UKey 签章一项） */
  | 'unavailable'

export interface BridgeDecision {
  capability: BridgeCapabilityCode
  capabilityName: string
  route: BridgeRoute
  usable: boolean
  /** {@code route === 'degrade'} 时有值 */
  degradeTo: BridgeDegradeTo | null
  /** 降级要调的那个已有端点；`null` = 没有降级实现 */
  degradeEndpoint: string | null
  /** 服务端给的理由。🔴 面向开发者，含 I23 / I30 / D14 这类内部编号，不要直接印给用户 */
  reason: string
}

/**
 * 服务端信封 + 当前运行时 → 该走哪条路
 *
 * <p>🔴 {@code runtime === 'web'} 时**永不**返回 {@code native}，哪怕服务端说
 * {@code nativeSupported === true}：浏览器里没有本机实现可走，照着走就是调用失败，
 * 而失败发生在客户端本机、服务端日志里什么都没有。I23 之后服务端会对桌面端返回 true，
 * 那时 Web 端拿到的还是同一个 true —— 所以这一支判的是「我在哪」，不是「服务端怎么说」。
 */
export const decide = (cap: BridgeCapability, runtime: BridgeRuntime): BridgeDecision => {
  const base = {
    capability: cap.capability,
    capabilityName: cap.capabilityName,
    degradeEndpoint: cap.degradeEndpoint,
    reason: cap.reason
  }
  if (runtime === 'desktop' && cap.nativeSupported) {
    return { ...base, route: 'native', usable: true, degradeTo: null }
  }
  if (cap.degradeTo === 'none' || cap.degradeEndpoint == null) {
    return { ...base, route: 'unavailable', usable: false, degradeTo: cap.degradeTo }
  }
  return { ...base, route: 'degrade', usable: true, degradeTo: cap.degradeTo }
}

/**
 * 端标识自检 —— 「发了但没被读到」的唯一发现手段
 *
 * <p>🔴 后端判定链认不出 {@code X-Client-Type} 时会**静默**兜到 {@code web}，不报错、不告警。
 * 于是「头名写错了」在数据上的表现只是「账单上桌面端流量恒为 0」，与「没人用桌面端」
 * 完全一样，而 §9.6 说这一列缺失等于历史计量数据永久缺一块、补不回来。
 * 信封里回显的 {@code clientTypeHeader}（服务端**实际收到**的原始值）就是用来对这一件事的。
 *
 * @param sent 本端发出去的值；Web 端由 {@code src/config/axios/service.ts} 的拦截器发 {@code 'web'}
 * @return 空串 = 一致；否则是一句可直接进日志/控制台的说明
 */
export const clientTypeDiagnostic = (cap: BridgeCapability, sent: string): string => {
  if (cap.clientTypeHeader == null) {
    return `本端发了 X-Client-Type: ${sent}，但服务端报告没收到这个头 —— 拦截器没生效，或被中间层剥掉了`
  }
  if (cap.clientTypeHeader.toLowerCase() !== sent.toLowerCase()) {
    return `本端发的是 X-Client-Type: ${sent}，服务端收到的却是 ${cap.clientTypeHeader} —— 有中间层改写了它`
  }
  if (cap.clientType !== sent) {
    return `服务端收到 ${cap.clientTypeHeader} 却判成了 ${cap.clientType} —— 判定链的取值表与本端不一致`
  }
  return ''
}

// ==========================================================================================
// 文案：桌面端不存在时，每一句都要换成用户真能照做的
// ==========================================================================================

interface DesktopState {
  available: boolean
}

const state: DesktopState = { available: false }

/**
 * 用服务端的答复刷新「桌面端到底有没有」
 *
 * @param cap {@code /qlzg/bridge/chunk-upload} 的信封；探针失败传 {@code null}
 */
export const setDesktopAvailability = (cap: BridgeCapability | null): void => {
  state.available = cap?.nativeSupported === true
}

/** 桌面端原生上传是否可用。MVP 期恒为 false */
export const isDesktopAvailable = (): boolean => state.available

/**
 * 「建议改用桌面客户端」这句 —— 用在**只是慢、并不拦**的场合（份数多、预计耗时长）
 *
 * <p>不可用时换成「分成几次拖入」：那是用户此刻真能做的动作，
 * 且它同时缓解慢与「关页面就前功尽弃」两件事
 */
export const desktopSuggestion = (): string =>
  state.available ? '建议改用桌面客户端' : '桌面客户端尚未发布，建议分成几次拖入，中途不要关闭页面'

/**
 * 接在「请分成几次拖入」后面的那条从句
 *
 * <p>🔴 不可用时返回**空串**，不是「桌面客户端尚未发布」：这一句前面已经给出了可照做的动作，
 * 再补一句「还有个东西你没有」只是噪音。而留一个「，或」后面没有东西才是真的难看，
 * 所以连接词一起收进来
 */
export const desktopAlternative = (): string => (state.available ? '，或改用桌面客户端' : '')

/**
 * 网页中转单文件超 16 MB 时的出路 —— 六处文案里唯一一处**硬拦**
 *
 * <p>🔴 这一处的根因在**部署侧**（对象存储不支持预签名，只能走 Spring 的 multipart，
 * 上限就是 {@code spring.servlet.multipart.max-file-size}），不在用户侧。
 * 桌面端不存在时必须把话说明白：让用户去找管理员，而不是让他去装一个还没有的东西
 */
export const relayWayOut = (): string =>
  state.available
    ? '请改用桌面客户端上传这一份'
    : '这一份在网页端传不上去。请联系管理员把对象存储换成支持预签名直传的 S3 兼容存储'

/** 超过服务端允许的文件上限时的出路（配置侧问题，与中转那一处不同） */
export const oversizeWayOut = (): string =>
  state.available
    ? '这份文件超过了服务端允许的上限，请改用桌面客户端上传'
    : '这份文件超过了服务端允许的上限，请联系管理员调整上限'

/** 重试次数用尽时的出路 */
export const retryWayOut = (): string =>
  state.available ? '请检查网络或改用桌面客户端' : '请检查网络，或把这一批分成几次拖入'
