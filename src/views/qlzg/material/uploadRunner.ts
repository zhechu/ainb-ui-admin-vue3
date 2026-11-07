import {
  QlzgMaterialApi,
  type QlzgMaterialConfirmVO,
  type QlzgMaterialPrepareItem,
  type QlzgUploadProgress
} from '@/api/qlzg/material'
import {
  MAX_RETRY_PER_ITEM,
  branchOf,
  computeSha256,
  createSpeedTracker,
  describeUploadError,
  sampleSpeed,
  uploadableOf,
  type UploadItem
} from './uploadQueue'
import { relaySizeBlockReason } from './uploadLimits'
import { retryWayOut } from '../bridge/localBridge'

/**
 * 一次拖拽 → 一批资料落库（**碰 I/O 的那一半**）
 *
 * <h3>🔴 为什么与 `uploadQueue.ts` 分成两个文件</h3>
 * 不是为了好看：本仓 vitest 是 `environment: 'node'`，而 `@/config/axios` 在**模块加载期**
 * 就要摸 `window`（`service.ts` → `utils/auth.ts` → `hooks/web/useCache.ts` → `web-storage-cache`）。
 * 任何 import 了那个 axios 实例的模块，它的 spec 会在收集阶段就炸
 * `ReferenceError: window is not defined`，一条断言都跑不到。
 * 所以三分支判定、体检、速度与 ETA、错误翻译全在 `uploadQueue.ts`（有 spec），
 * 这里只剩「按那些判定把请求发出去」。
 *
 * <h3>🔴 状态直接写在传进来的 item 上，不经过回调</h3>
 * 早先这里是一个 `update(key, patch)` 回调，写法看着很干净，实际埋了一整类 bug：
 * **runner 手里握着的是原始对象，而界面显示的是 Vue 那一份响应式副本**，
 * 于是任何需要「读回上一次写进去的值」的逻辑都会读到旧值 ——
 * 速度的 EMA 退化成「每次都用瞬时值」（进度条上的速度与剩余时间开始乱跳），
 * 重试计数恒为 0（「最多重试 3 次」形同虚设，用户可以一直点、一直失败）。
 * 两处都不报错，代码单看每一行都对。
 *
 * 现在的契约是：**调用方必须传它正在渲染的那一份数组里的元素本身**
 * （`ref<UploadItem[]>` 的 `.value` —— Vue 会把元素代理成 reactive），
 * runner 用 `Object.assign` 原地改，改的就是界面上那一行。
 * ⚠️ 传一份浅拷贝进来不会报错，只会「进度条不动」，所以别拷。
 *
 * <h3>🔴 一次拖拽 = 一次 prepare = 一个批次号</h3>
 * 所以这里是「先一次 prepare 拿到全部令牌，再并发跑每一项」，**不是**「每项自己 prepare」——
 * 后者会发出 N 个批次号，时间线上变成 N 批各 1 份，「一次交齐」这个事实就再也看不出来了；
 * 而且 prepare 限流 60 次/分钟，20 份并发 prepare 会直接撞墙。
 */

/**
 * 同时在传的份数
 *
 * 🔴 刻意压到 3：浏览器对同一域名有 6 条连接的硬上限，占满之后
 *    **其他所有请求**（包括列表刷新、缺件检测）都会排队，界面看起来像卡死了。
 */
const CONCURRENCY = 3

export interface RunUploadOptions {
  projectId: number
  /**
   * `createUploadItems` 的产物，🔴 且必须是界面正在渲染的那一份（见文件头）。
   * BLOCKED 的项会被跳过，不发进 prepare。
   */
  items: UploadItem[]
  /** 一份成功落库后回调，用于把行插进资料列表并刷新缺件面板 */
  onConfirmed?: (item: UploadItem, confirm: QlzgMaterialConfirmVO) => void
  signal?: AbortSignal
}

export interface RunUploadResult {
  /** 服务端发出的批次号；一份都没传成时为空 */
  uploadBatchNo?: string
  doneCount: number
  failedCount: number
  blockedCount: number
  /** 🔴 至少有一份落库了 —— 只有这时才需要刷新列表与缺件面板 */
  anyConfirmed: boolean
}

/**
 * 跑一批上传
 *
 * ⚠️ prepare 整体失败时**不烧批次号**（后端是 Lua 原子预留，失败会回滚），
 *    所以那一支只需要把全部项标失败，不涉及跳号。
 *
 * 🔴 prepare 的 items 与请求的 files **按数组下标一一对应**，所以下面用下标取，
 *    而不是按 fileName 匹配 —— 一个文件夹里出现同名文件是完全可能的，
 *    按名字匹配会把令牌发到错的文件上去，而**每一份都会显示「成功」**。
 */
export const runUploadBatch = async (options: RunUploadOptions): Promise<RunUploadResult> => {
  const { projectId, items, onConfirmed, signal } = options
  const pending = uploadableOf(items)
  const blockedCount = items.filter((item) => item.state === 'BLOCKED').length

  if (pending.length === 0) {
    return { doneCount: 0, failedCount: 0, blockedCount, anyConfirmed: false }
  }

  // 1) 算摘要（≤32 MB 才算，理由见 computeSha256）
  for (const item of pending) {
    if (signal?.aborted) {
      break
    }
    Object.assign(item, { state: 'HASHING' })
    item.sha256 = await computeSha256(item.file)
  }

  // 2) 一次 prepare 拿全部令牌
  let prepared
  try {
    prepared = await QlzgMaterialApi.prepare({
      projectId,
      files: pending.map((item) => ({
        fileName: item.fileName,
        fileSize: item.fileSize,
        sha256: item.sha256,
        mimeType: item.file.type || undefined
      }))
    })
  } catch (error) {
    const reason = describeUploadError(error)
    pending.forEach((item) => Object.assign(item, { state: 'FAILED', error: reason, percent: 0 }))
    return { doneCount: 0, failedCount: pending.length, blockedCount, anyConfirmed: false }
  }

  const preparedItems = prepared.items ?? []
  let doneCount = 0
  let failedCount = 0

  // 3) 有限并发跑每一项
  let cursor = 0
  const worker = async () => {
    while (cursor < pending.length) {
      const index = cursor++
      const item = pending[index]
      const prepareItem = preparedItems[index]
      if (signal?.aborted) {
        // 🔴 标 BLOCKED 不标 FAILED：取消是用户主动按的，
        //    算进「失败 N 份」会让结束提示变成一句谎话，而用户知道自己按了取消
        Object.assign(item, { state: 'BLOCKED', error: '已取消' })
        continue
      }
      if (!prepareItem) {
        // 后端少返回了一项：不能静默跳过，否则界面上这一行永远停在「排队中」
        Object.assign(item, {
          state: 'FAILED',
          error: '服务端没有为这一份签发上传令牌，请重新拖入'
        })
        failedCount++
        continue
      }
      if (await uploadOne(item, prepareItem, onConfirmed, signal)) {
        doneCount++
      } else {
        failedCount++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker))

  return {
    uploadBatchNo: doneCount > 0 ? prepared.uploadBatchNo : undefined,
    doneCount,
    failedCount,
    blockedCount,
    anyConfirmed: doneCount > 0
  }
}

/**
 * 传一份
 *
 * 🔴 三分支的顺序与「中转之后绝不再 confirm」都在 {@link branchOf} 与本函数里，
 *    改之前先读 `uploadQueue.ts` 文件头那三条静默坏法。
 */
const uploadOne = async (
  item: UploadItem,
  prepareItem: QlzgMaterialPrepareItem,
  onConfirmed: RunUploadOptions['onConfirmed'],
  signal?: AbortSignal
): Promise<boolean> => {
  const branch = branchOf(prepareItem)
  Object.assign(item, { prepareItem, dedup: prepareItem.dedup === true })

  // 🔴 中转那一支要先按体量拦一道：超 16 MB 时 Spring 抛 MaxUploadSizeExceededException，
  //    **没有 qlzg 错误码**，用户拿到的是一句泛泛的「系统异常」。
  //    拦在前端才能给出**出路**（那句话由 relayWayOut 给：桌面端在 I23 之前不存在，
  //    此时真正的解法在部署侧 —— 换成支持预签名的 S3 兼容存储，而不是让用户去装一个还没有的客户端）。
  if (branch === 'relay') {
    const reason = relaySizeBlockReason(prepareItem, item.fileSize)
    if (reason) {
      Object.assign(item, { state: 'BLOCKED', error: reason, percent: 0 })
      return false
    }
  }

  let tracker = createSpeedTracker()
  const onProgress = (progress: QlzgUploadProgress) => {
    const sampled = sampleSpeed(tracker, progress, item.fileSize)
    tracker = sampled.tracker
    Object.assign(item, { percent: sampled.percent, speed: sampled.speed, eta: sampled.eta })
  }

  try {
    let confirm: QlzgMaterialConfirmVO
    if (branch === 'dedup') {
      // 秒传没有字节要传，所以直接跳到 100%：留一个 0% 的进度条会让人以为卡住了
      Object.assign(item, { state: 'CONFIRMING', percent: 100, eta: '' })
      confirm = await QlzgMaterialApi.confirm({ token: prepareItem.reuseToken as string })
    } else if (branch === 'presign') {
      Object.assign(item, { state: 'UPLOADING', percent: 0 })
      await QlzgMaterialApi.putToPresignedUrl(
        prepareItem.uploadUrl as string,
        item.file,
        onProgress,
        signal
      )
      // 🔴 直传成功**只代表字节进了存储**，必须再 confirm 才会落资料行。
      //    漏掉这一步的话字节占着存储且不入账（infra_file 的 NULL tenant_id 问题），
      //    而资料清单里一份都没有
      Object.assign(item, { state: 'CONFIRMING', eta: '' })
      confirm = await QlzgMaterialApi.confirm({ token: prepareItem.uploadToken as string })
    } else {
      Object.assign(item, { state: 'UPLOADING', percent: 0 })
      // 🔴 中转的响应**就是** confirm 的响应，绝不能再调一次 confirm
      confirm = await QlzgMaterialApi.uploadRelay(
        prepareItem.uploadToken as string,
        item.file,
        onProgress,
        signal
      )
    }
    Object.assign(item, {
      state: 'DONE',
      percent: 100,
      eta: '',
      materialId: confirm.materialId,
      dedup: confirm.dedup === true,
      error: ''
    })
    onConfirmed?.(item, confirm)
    return true
  } catch (error) {
    const reason = describeUploadError(error)
    // 取消不算失败，理由与上面 signal?.aborted 那一支相同
    Object.assign(item, { state: reason === '已取消' ? 'BLOCKED' : 'FAILED', error: reason })
    return false
  }
}

/**
 * 重试一份 = 对这一份重新走一遍 prepare + 三分支
 *
 * 🔴 **不能拿旧令牌重试**：令牌是 Redis `GETDEL` 一次性消费的，失败时它多半已经没了，
 *    用同一个令牌重试必然再撞 `MATERIAL_UPLOAD_TOKEN_INVALID`。
 *    界面上那一句出路（「请把这一份重新拖进来」）就是为这种情况写的，见 `describeUploadError`。
 * ⚠️ 代价是多烧一个批次号（一份一批）。这是可接受的：
 *    重试本来就是用户显式点的第二次提交，时间线上多一批是**事实的正确记录**，
 *    而把两次提交并成一批才是造假（「补了三次」看起来像「一次交齐」）。
 * 🔴 `retryCount` 写在 item 上并读回它自己 —— 走回调的话读到的是原始对象的 0，
 *    「最多重试 3 次」就形同虚设（见文件头）。
 */
export const retryOne = async (
  projectId: number,
  item: UploadItem,
  onConfirmed?: RunUploadOptions['onConfirmed']
): Promise<boolean> => {
  if (item.retryCount >= MAX_RETRY_PER_ITEM) {
    Object.assign(item, {
      state: 'FAILED',
      error:
        `已经重试 ${item.retryCount} 次都失败了。${retryWayOut()}，` +
        '继续重试大概率还是同样的结果'
    })
    return false
  }
  Object.assign(item, {
    retryCount: item.retryCount + 1,
    state: 'PENDING',
    error: '',
    percent: 0,
    eta: ''
  })
  const result = await runUploadBatch({ projectId, items: [item], onConfirmed })
  return result.doneCount > 0
}
