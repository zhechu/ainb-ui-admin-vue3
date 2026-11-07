import request from '@/config/axios'

/**
 * LocalBridge —— 桌面端本机能力的**契约面**（V5 §9.6 / §13.4.4 / D14）
 *
 * <h3>🔴 这五个接口在 MVP 期不干任何本机能力的活，它们干的是「告诉客户端该走哪条路」</h3>
 * 后端 `QlzgLocalBridgeController` 的五个端点一律返回同一个信封，`nativeSupported` 恒为
 * `false`（桌面端本体在 I23）。前端拿到信封之后照 `degradeTo` 分支，走**已有的**那条路 ——
 * 降级指向的全是 I1 / I6 已经落地并且端到端验过的接口，bridge 自己不实现第二遍。
 *
 * <h3>🔴 五个共用一个响应类型，客户端只认一个形状</h3>
 * 每个端点各造一个类型的话，这里要写五套分支，而其中四套在 MVP 期做的事一模一样。
 *
 * <h3>🔴 「探针」= **不带请求体**，不是「带一个空对象」</h3>
 * 一次纯粹的能力询问不该要求先凑齐一个业务 id（`report-file` 那一项在没有报告的项目里
 * 根本凑不出来），所以后端那四个 POST 都是 `@RequestBody(required = false)`。
 * 但 `required = false` 只让**请求体本身**可选：一旦发了体，`@Valid` 照跑，
 * 于是 `{}` 会被判成「一个缺字段的原生载荷」而回 400「projectId 不能为空」——
 * 与「这一项能力不可用」那句答复长得完全不一样，前端只会看到一次请求失败。
 * 所以这里 `data` 在没有载荷时**整个不给**（axios 于是不发体），
 * 而不是兜成 `{}`。实测：无体 / 空体都返回信封，`{}` 返回 400。
 *
 * <h3>⚠️ 载荷字段现在就要定义出来</h3>
 * I23 的原生客户端本来就必然带全量载荷，届时只是把 `data` 填上、后端补 `@Valid` 的分组，
 * 签名不变 —— 否则 I23 加字段就是改签名，而 D14 ③ 的验收前提是「后端一行不改」。
 */

/** Web 降级方式的机器码。🔴 `none` 只有 UKey 签章一项 */
export type BridgeDegradeTo =
  | 'webkitdirectory'
  | 'server-extract'
  | 'presign-put'
  | 'browser-download'
  | 'none'

/** 五项能力码，与端点路径的最后一段逐字一致 */
export type BridgeCapabilityCode =
  | 'directory-scan'
  | 'local-extract'
  | 'chunk-upload'
  | 'sign-with-ukey'
  | 'report-file'

/** 能力协商信封 —— 与后端 `QlzgBridgeCapabilityRespVO` 一一对应 */
export interface BridgeCapability {
  capability: BridgeCapabilityCode
  capabilityName: string
  /** MVP 期恒为 false。🔴 不要拿 `clientType === 'desktop'` 去推它 */
  nativeSupported: boolean
  degradeTo: BridgeDegradeTo
  degradeToName: string
  /** 降级要调的那个已有端点；`null` = 这一项没有降级实现（只有 UKey 签章） */
  degradeEndpoint: string | null
  /** 人读的理由：说清该做什么，不只说不行 */
  reason: string
  /** 服务端**判定出**的发起端，落 client_type 两列 */
  clientType: string
  /**
   * 服务端**实际收到**的 `X-Client-Type` 原始值；`null` = 这个头没送到
   *
   * 🔴 这一列是「发了但没被读到」唯一的自证手段：判定链认不出来时静默兜到 web，
   *    于是它与「压根没发」在服务端数据上完全一样
   */
  clientTypeHeader: string | null
}

/** `POST /qlzg/bridge/directory-scan` 的载荷形状（I23 用，MVP 期服务端丢弃并 WARN） */
export interface BridgeDirectoryScanPayload {
  projectId: number
  /** 仅回显与留痕。🔴 不参与任何服务端判定 —— 那是让被取证的一方指定证据编号 */
  rootPath?: string
  entries?: { relativePath: string; fileSize?: number; sha256?: string }[]
}

/** `POST /qlzg/bridge/local-extract` 的载荷形状 */
export interface BridgeLocalExtractPayload {
  materialId: number
  /** 🔴 MVP 期服务端刻意不存它：存下来会让溯源指向一段服务端从没读过的正文 */
  nativeResult?: { pageCount?: number; text?: string; fieldsJson?: string }
}

/** `POST /qlzg/bridge/chunk-upload` 的载荷形状。🔴 是元数据不是字节，字节直连对象存储 */
export interface BridgeChunkUploadPayload {
  uploadToken: string
  chunkIndex?: number
  chunkCount?: number
  chunkSha256?: string
  chunkSize?: number
}

/** `POST /qlzg/bridge/sign-with-ukey` 的载荷形状。🔴 MVP 期没有任何实现（I30 才有） */
export interface BridgeSignPayload {
  reportId: number
  signType?: string
  signHash?: string
  ukeySerial?: string
}

/** 整目录扫入 */
export const probeDirectoryScan = (payload?: BridgeDirectoryScanPayload) =>
  request.post<BridgeCapability>({ url: '/qlzg/bridge/directory-scan', data: payload })

/** 本地抽取（OCR + 解析 + 抽字段） */
export const probeLocalExtract = (payload?: BridgeLocalExtractPayload) =>
  request.post<BridgeCapability>({ url: '/qlzg/bridge/local-extract', data: payload })

/** 分片流式上传 */
export const probeChunkUpload = (payload?: BridgeChunkUploadPayload) =>
  request.post<BridgeCapability>({ url: '/qlzg/bridge/chunk-upload', data: payload })

/** UKey 硬件签章。🔴 五项里唯一没有降级实现的一项 */
export const probeSignWithUkey = (payload?: BridgeSignPayload) =>
  request.post<BridgeCapability>({ url: '/qlzg/bridge/sign-with-ukey', data: payload })

/** 本机文件直读（调起本机 Word / WPS） */
export const probeReportFile = (reportId?: number) =>
  request.get<BridgeCapability>({
    url: '/qlzg/bridge/report-file',
    params: reportId == null ? {} : { reportId }
  })

/** 五项能力码 → 探针。🔴 顺序与后端枚举一致，`localBridge.ts` 靠它一次问全 */
export const BRIDGE_PROBES: Record<
  BridgeCapabilityCode,
  () => Promise<BridgeCapability>
> = {
  'directory-scan': () => probeDirectoryScan(),
  'local-extract': () => probeLocalExtract(),
  'chunk-upload': () => probeChunkUpload(),
  'sign-with-ukey': () => probeSignWithUkey(),
  'report-file': () => probeReportFile()
}
