import type { QlzgMaterialPrepareItem, QlzgUploadProgress } from '@/api/qlzg/material'
import type { PickedFile, PickedResult } from './folderFlatten'
// 🔴 只从 localBridge 取值，不从 bridgeRuntime 取：后者 import 了 `@/api/qlzg/bridge`
//    （运行时值），那条链会摸到 `@/config/axios`，而本文件的存在理由就是「不碰 I/O」，
//    碰了 `uploadQueue.spec.ts` 会在收集阶段炸 window is not defined
import { desktopSuggestion, oversizeWayOut } from '../bridge/localBridge'
import { hasPresignedUrl, preflight, shouldComputeDigest } from './uploadLimits'

/**
 * 上传这条路上的**纯判定**：三分支、体检、状态、速度与 ETA、错误翻译
 *
 * <h3>🔴 为什么与真正发请求的 `uploadRunner.ts` 分成两个文件</h3>
 * 本仓 vitest 是 `environment: 'node'`，而 `@/config/axios` 在**模块加载期**就要摸 `window`
 * （`service.ts` → `utils/auth.ts` → `hooks/web/useCache.ts` → `web-storage-cache`）。
 * 只要 import 了那个 axios 实例，整个 spec 会在收集阶段就炸 `ReferenceError: window is not defined`，
 * 一条断言都跑不到。所以：**碰 I/O 的放 runner，不碰 I/O 的放这里**，
 * 这里只 `import type`（编译期擦掉，运行期没有这个依赖）。
 *
 * <h3>🔴 这个文件存在的理由：三分支的判定与顺序不能写错</h3>
 * `prepare` 返回的每一项要走三条路之一，判据全在 item 自己的字段上：
 * <pre>
 *   ① dedup === true        → 不传字节，直接 confirm(reuseToken)
 *   ② 有直传地址            → 裸 axios PUT 字节，再 confirm(uploadToken)
 *   ③ 没有直传地址          → POST /upload-relay，🔴 它的响应**就是** confirm 的响应
 * </pre>
 *
 * 判反了会怎样，每一种都是**静默的**：
 * - 先看「有没有直传地址」再看 `dedup`：秒传命中的项 uploadUrl 也是 null，
 *   于是它被送去中转 —— 字节重复上传一遍、库里多出一份资料，而界面显示「成功」。
 * - 分支 ③ 之后又调一次 confirm：令牌是 Redis `GETDEL` 消费的，第二次必然撞
 *   `MATERIAL_UPLOAD_TOKEN_INVALID`。表现是「20 份传完了、弹出 20 个错误」，
 *   而**数据其实全都落库了** —— 用户会再拖一次，于是库里出现 40 份。
 * - 分支 ② 只 PUT 不 confirm：字节进了存储，资料行永远不落库，
 *   而那份字节还占着存储且不入账（infra_file 的 NULL tenant_id 问题）。
 */

/** 走哪一支 */
export type UploadBranch = 'dedup' | 'presign' | 'relay'

/**
 * 三分支判定
 *
 * 🔴 `dedup` **必须**第一个判。理由见文件头 —— 秒传命中时 `uploadUrl` 同样为 null，
 *    所以「先看 uploadUrl」会把秒传项误送进中转分支。
 * 🔴 「有没有直传地址」走 {@link hasPresignedUrl}，不在这里再写一次 `!= null`：
 *    两处各判一次的话，早晚一处会漂，于是「判分支说走中转、拦体量说走直传」，
 *    一份 20 MB 的文件既没被拦住也没被 PUT 出去，界面停在 0% 不动而日志里一切正常。
 * 🔴 这是一个**穷尽**的三分判定，没有第四种可能、也没有 default 兜底：
 *    `dedup` 是 boolean，直传地址要么有要么没有，组合只有四种，
 *    而 `dedup=true` 且带地址那一种按 dedup 处理（后端不会同时给两者，
 *    真给了也以「不用传字节」为准 —— 少传一次总是安全的方向）。
 */
export const branchOf = (
  item: Pick<QlzgMaterialPrepareItem, 'dedup' | 'uploadUrl'>
): UploadBranch => {
  if (item.dedup) {
    return 'dedup'
  }
  return hasPresignedUrl(item) ? 'presign' : 'relay'
}

/** 一份文件在界面上的状态 */
export type UploadItemState =
  | 'BLOCKED' // 体检不通过，压根没发出去
  | 'PENDING' // 排队中
  | 'HASHING' // 正在算 SHA256
  | 'UPLOADING' // 正在传字节（中转或直传）
  | 'CONFIRMING' // 字节传完了，正在落资料行
  | 'DONE'
  | 'FAILED'

/** 状态 → 界面显示的字 */
export const UPLOAD_STATE_LABELS: Record<UploadItemState, string> = {
  BLOCKED: '未上传',
  PENDING: '排队中',
  HASHING: '校验中',
  UPLOADING: '上传中',
  CONFIRMING: '登记中',
  DONE: '已收进',
  FAILED: '失败'
}

/**
 * 🔴 「进行中」的状态集合 —— 抽屉在这些状态下**不许关闭**
 *
 * 令牌是一次性的、且没有断点续传：中途关页面，正在传的那几份既没落库、
 * 令牌也废了，只能重新拖。所以关闭前要拦一道并说清后果。
 * ⚠️ `HASHING` 也在里面：算摘要时关页面，那一份同样是白算。
 */
export const IN_FLIGHT_STATES: UploadItemState[] = ['HASHING', 'UPLOADING', 'CONFIRMING']

export const isInFlight = (state: UploadItemState): boolean => IN_FLIGHT_STATES.includes(state)

/** 抽屉里的一行 */
export interface UploadItem {
  /** 前端本地 key。🔴 不是 materialId —— 那要 confirm 之后才有 */
  key: string
  fileName: string
  fileSize?: number
  state: UploadItemState
  /** 0-100 */
  percent: number
  /** 字节/秒，EMA 平滑过；没有样本时为空 */
  speed?: number
  /** 「约 12 秒」这类人话；算不出来时是空串（不显示「计算中」，理由见 formatEta） */
  eta: string
  /** 算好的摘要。🔴 只是 prepare 的入参缓存，不要拿它当资料行的 sha256 显示 */
  sha256?: string
  /** 体检阶段的提示（如 >50MB 不抽正文）。🔴 必须在界面上显示出来 */
  warnings: string[]
  /** 失败 / 拦截的原因（人话） */
  error: string
  /** 秒传命中 —— 界面上要显示成「已有同一份，直接复用」，不是「上传成功」 */
  dedup: boolean
  /** 落库后的资料行 id */
  materialId?: number
  /** prepare 发的这一项，重试时要用它决定分支 */
  prepareItem?: QlzgMaterialPrepareItem
  /** 真正的 File，重试与上传都要用它取字节 */
  file: File
  /** 已重试次数，用于「重试这一份」的上限判断 */
  retryCount: number
}

/**
 * 摊平结果 → 抽屉里的行
 *
 * 🔴 体检不通过的项**照样进列表**，只是标成 BLOCKED 并写明原因。
 *    把它们悄悄剔掉的表现是「我拖了 20 份，抽屉里只有 17 行」，
 *    用户会以为界面漏了 —— 而少的那 3 份可能是最要紧的图纸。
 * 🔴 BLOCKED 的项**不进 prepare 的 files 数组**：发出去必然被后端 `@Size`/`@NotEmpty` 拒，
 *    而那一条拒绝会把**整批**打回来（400 是整个请求的），一份坏的拖垮 19 份好的。
 */
export const createUploadItems = (picked: PickedResult): UploadItem[] =>
  picked.files.map((item: PickedFile, index: number) => {
    const verdict = preflight(item.fileName, item.file.size)
    return {
      key: `${index}-${item.fileName}`,
      fileName: item.fileName,
      fileSize: item.file.size,
      state: verdict.blocked ? 'BLOCKED' : 'PENDING',
      percent: 0,
      eta: '',
      warnings: verdict.warnings,
      error: verdict.blockedReason,
      dedup: false,
      file: item.file,
      retryCount: 0
    }
  })

/** 哪些项要进 prepare 的 files 数组 */
export const uploadableOf = (items: UploadItem[]): UploadItem[] =>
  items.filter((item) => item.state !== 'BLOCKED')

/**
 * 算一份文件的 SHA256（小写十六进制）
 *
 * ⚠️ 大文件**不要**调它，先过 {@link shouldComputeDigest}：`arrayBuffer()` 会把整份
 *    读进内存，300 MB 的文件峰值内存翻倍、耗时几秒，而它省下的只是一次已经要发生的上传。
 * ⚠️ `crypto.subtle` 只在**安全上下文**（https 或 localhost）里存在。
 *    用 http + 内网 IP 访问管理端时它是 undefined —— 那时**跳过摘要**（等于放弃秒传），
 *    不要抛错：抛错的表现是「整个网页端传不了任何东西」，而少个秒传只是慢一点。
 */
export const computeSha256 = async (file: File): Promise<string | undefined> => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle || !shouldComputeDigest(file.size)) {
    return undefined
  }
  try {
    const digest = await subtle.digest('SHA-256', await file.arrayBuffer())
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return undefined
  }
}

/** 一批的汇总，抽屉标题与结束提示都用它 */
export interface UploadSummary {
  total: number
  done: number
  /** 秒传命中的份数（是 done 的子集） */
  dedup: number
  failed: number
  blocked: number
  inFlight: number
  /** 全部跑完了（没有进行中的，也没有排队的） */
  settled: boolean
}

/**
 * 🔴 汇总一律**数出来**，不用计数器累加
 *
 * 累加器的坏法很具体：一份文件失败后用户点了重试、又失败，计数器加两次，
 * 于是「失败 2 份」而列表里只有 1 行红字 —— 两个数字对不上时，用户信列表不信标题，
 * 标题就成了噪音。数一遍永远与列表一致。
 */
export const summarize = (items: UploadItem[]): UploadSummary => {
  const total = items.length
  const done = items.filter((item) => item.state === 'DONE').length
  const dedup = items.filter((item) => item.state === 'DONE' && item.dedup).length
  const failed = items.filter((item) => item.state === 'FAILED').length
  const blocked = items.filter((item) => item.state === 'BLOCKED').length
  const inFlight = items.filter((item) => isInFlight(item.state) || item.state === 'PENDING').length
  return { total, done, dedup, failed, blocked, inFlight, settled: inFlight === 0 }
}

/**
 * 速度的指数滑动平均
 *
 * 🔴 必须平滑：axios 的 progress 事件是**突发**的（浏览器攒够一块才发一次），
 *    直接用瞬时值的话速度会在 0 与 40 MB/s 之间跳，ETA 跟着从「3 秒」跳到「2 分钟」，
 *    用户读到的是「卡住了」。
 * ⚠️ 首样本直接采用（不做平滑），否则前几百毫秒速度恒为 0、ETA 显示「计算中」，
 *    而那恰好是用户最想知道「到底传没传」的时刻。
 *
 * @param previous 上一次的平滑值，首次传 undefined
 * @param bytesPerSecond 本次瞬时值
 */
export const nextSpeed = (previous: number | undefined, bytesPerSecond: number): number => {
  if (previous == null || previous <= 0) {
    return bytesPerSecond
  }
  if (bytesPerSecond <= 0) {
    return previous
  }
  return previous * 0.7 + bytesPerSecond * 0.3
}

/** 字节/秒 → 「1.4 MB/s」。小于 1 就换小单位，避免出现「0 MB/s」 */
export const formatSpeed = (bytesPerSecond?: number): string => {
  if (bytesPerSecond == null || bytesPerSecond <= 0) {
    return ''
  }
  if (bytesPerSecond < 1024) {
    return `${Math.round(bytesPerSecond)} B/s`
  }
  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
  }
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
}

/**
 * 剩余字节 ÷ 速度 → 「约 12 秒」
 *
 * 🔴 算不出来时返回空串，**不返回「计算中」**：速度还没样本的那一两秒里，
 *    进度条本身已经在动了，再挂一句「计算中」是在制造焦虑。
 * 🔴 超过 1 小时只显示「1 小时以上」：精确到秒的「3:42:17」没有意义，
 *    而它会让用户盯着一个不断变大的数字。这种情况下真正该说的是一句「怎么办」，
 *    由 {@link desktopSuggestion} 给：桌面端在 I23 之后是「建议改用桌面客户端」，
 *    在那之前是「分成几次拖入、中途别关页面」—— 🔴 不能写死前者，
 *    推荐一个还不存在的客户端等于让用户去做一件做不到的事。
 */
export const formatEta = (remainingBytes: number | undefined, bytesPerSecond?: number): string => {
  if (remainingBytes == null || remainingBytes <= 0) {
    return ''
  }
  if (bytesPerSecond == null || bytesPerSecond <= 0) {
    return ''
  }
  const seconds = Math.round(remainingBytes / bytesPerSecond)
  if (seconds < 1) {
    return '即将完成'
  }
  if (seconds < 60) {
    return `约 ${seconds} 秒`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `约 ${minutes} 分钟`
  }
  return `1 小时以上，${desktopSuggestion()}`
}

/**
 * 把抛出来的东西翻成人话
 *
 * 🔴 三条来路，形状都不一样：
 *    ① 本仓 axios 拦截器 reject 的是 `new Error(msg)`，msg 已经是后端那句中文
 *       （见 `src/config/axios/service.ts` 的响应拦截器，它 reject 的就是 `new Error(msg)`）
 *       —— 直接用，**不要再包一层**；
 *    ② 裸 axios（预签名 PUT）reject 的是 AxiosError，`message` 是英文
 *       （`Request failed with status code 403`），要翻；
 *    ③ `AbortSignal` 取消时 reject 的是 `CanceledError`，那不是错误，是用户按了取消。
 *
 * ⚠️ 令牌失效那一条要单独说清「重新拖一次」：令牌是 Redis GETDEL 一次性消费的，
 *    点「重试这一份」用的还是同一个令牌，**必然再次失败**。
 *    不写明出路的话，用户会一直点重试、一直失败，最后认为系统坏了。
 */
export const describeUploadError = (error: unknown): string => {
  if (error == null) {
    return '上传失败，原因未知'
  }
  const anyError = error as { message?: string; code?: string; name?: string }
  const message = anyError.message ?? ''
  if (
    anyError.name === 'CanceledError' ||
    anyError.code === 'ERR_CANCELED' ||
    message === 'canceled'
  ) {
    return '已取消'
  }
  if (message.includes('令牌已失效') || message.includes('上传令牌')) {
    return `${message}。令牌是一次性的，重试无效 —— 请把这一份重新拖进来`
  }
  if (message === 'Network Error' || message.includes('网络')) {
    return '网络中断，请检查连接后点「重试」'
  }
  if (message.includes('timeout')) {
    return '请求超时。文件可能偏大或网络偏慢，请点「重试」'
  }
  if (message.includes('413')) {
    return oversizeWayOut()
  }
  if (message.includes('403')) {
    return '直传地址被对象存储拒绝（403）。可能是服务器时钟偏差或签名已过期，请点「重试」重新签发'
  }
  return message || '上传失败，原因未知'
}

/** 「重试这一份」的点击上限。超过就说明不是偶发问题，再点只是浪费时间 */
export const MAX_RETRY_PER_ITEM = 3

/**
 * 速度采样器的状态
 *
 * 🔴 平滑值存在这里而**不是**存在 `UploadItem.speed` 上：`update()` 改的是 Vue 侧那一份响应式副本，
 *    而 `uploadOne` 手里握着的是 `createUploadItems` 产出的**原始对象**，它不会被改。
 *    把 EMA 的上一值挂在原始对象上，读回来永远是 undefined，
 *    于是「平滑」退化成「每次都用瞬时值」—— 速度与 ETA 又开始跳，而代码看着是对的。
 */
export interface SpeedTracker {
  /** 上次采样的时刻（ms） */
  at: number
  /** 上次采样时的已传字节 */
  loaded: number
  /** 平滑后的速度（字节/秒） */
  speed?: number
}

export const createSpeedTracker = (): SpeedTracker => ({ at: Date.now(), loaded: 0 })

/**
 * 把一次 axios progress 事件折成「百分比 + 速度 + 剩余时间」
 *
 * 🔴 抽成纯函数是为了让直传与中转两个分支**共用同一份**折算：
 *    两处各写一份的话，很容易变成直传显示速度而中转不显示，
 *    用户会以为中转那条路卡住了 —— 而中转恰恰是私有化部署的常态路径。
 *
 * ⚠️ 每 500 ms 才采一次样：progress 事件可以一秒来十几次，
 *    每次都算的话 `elapsed` 只有几十毫秒，除出来的速度全是噪音。
 *    不到采样间隔时**原样返回上次的平滑速度**，不是返回 undefined
 *    （返回 undefined 会让速度显示一闪一闪地消失又出现）。
 */
export const sampleSpeed = (
  tracker: SpeedTracker,
  progress: QlzgUploadProgress,
  fileSize?: number
): { tracker: SpeedTracker; percent: number; speed?: number; eta: string } => {
  const now = Date.now()
  const elapsed = now - tracker.at
  if (elapsed < 500) {
    const total = progress.total ?? fileSize
    const remaining =
      total != null && tracker.speed != null ? Math.max(total - progress.loaded, 0) : undefined
    return {
      tracker,
      percent: progress.percent,
      speed: tracker.speed,
      eta: formatEta(remaining, tracker.speed)
    }
  }
  const delta = progress.loaded - tracker.loaded
  const speed = delta > 0 ? nextSpeed(tracker.speed, (delta / elapsed) * 1000) : tracker.speed
  const total = progress.total ?? fileSize
  const remaining =
    total != null && speed != null ? Math.max(total - progress.loaded, 0) : undefined
  return {
    tracker: { at: now, loaded: progress.loaded, speed },
    percent: progress.percent,
    speed,
    eta: formatEta(remaining, speed)
  }
}
