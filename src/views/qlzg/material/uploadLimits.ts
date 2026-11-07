import type { QlzgMaterialPrepareItem } from '@/api/qlzg/material'
import { desktopAlternative, desktopSuggestion, relayWayOut } from '../bridge/localBridge'

/**
 * 上传这条路上一切「写死的数字」，以及它们各自的出处
 *
 * <h3>🔴 为什么单独一个文件</h3>
 * 这几个数字散在三个地方：Spring 的 yaml、后端的 `@Size`、V5 的界面要求。
 * 抄进组件里就会变成第二份事实 —— 而后端把 16 MB 调成 32 MB 时，
 * 前端仍然按 16 MB 拦，表现是「明明能传的文件被网页挡住了」，且**没有任何报错**，
 * 因为拦截发生在前端、请求根本没发出去。
 * 集中在这里，改的时候至少只有一个地方要改，且每一条都写着它该跟谁对齐。
 */

/**
 * 一次 prepare 最多声明多少份 —— 后端 `QlzgMaterialPrepareReqVO#files` 的 `@Size(max = 500)`
 *
 * 🔴 超了不是「分成两批」，而是**拦住并说清楚**：分批会发出两个批次号，
 *    时间线上变成两批，而用户心里那件事是「一次交齐」。
 *    真要一次交 800 份就该用桌面客户端（它按目录树自己分批，且每批都是用户看得见的一次提交）
 *    —— 🔴 但桌面端在 **I23** 才有，所以界面文案一律经 {@link desktopAlternative} 出口，
 *    不写死这句推荐（见 `../bridge/localBridge.ts` 的文件头）。
 */
export const MAX_FILES_PER_PREPARE = 500

/**
 * 超过这个份数就建议改用桌面端 —— V5 §13.7「> 200 份 → 上传前提示『建议用桌面端』」
 *
 * ⚠️ 是**提示**不是拦截：200 份在浏览器里是能传完的，只是慢、且关页面就前功尽弃
 *    （令牌一次性 + 无断点续传，见 uploadQueue 的注释）。拦住反而是帮倒忙。
 * 🔴 必须在**上传前**提示。传了 10 分钟之后再弹「建议您用桌面端」，
 *    用户读到的不是建议，是嘲讽。
 */
export const DESKTOP_SUGGEST_FILE_COUNT = 200

/**
 * 网页中转（`POST /qlzg/material/upload-relay`）的单文件上限
 * = `spring.servlet.multipart.max-file-size`（配在 `enlev-server` 的 `application.yaml` 里）
 *
 * 🔴 只在**走中转那一支**时才是上限。S3 直传（预签名 PUT）不经过 Spring，没有这个限制。
 *    所以判定时机是「prepare 返回了、`uploadUrl` 为 null」那一刻，**不是拖进来那一刻** ——
 *    拖进来就按 16 MB 拦，会把本来能直传的 300 MB 文件挡在门外。
 *
 * ⚠️ 超限时 Spring 抛 `MaxUploadSizeExceededException`，**没有 qlzg 错误码**，
 *    全局异常处理器会把它兜成一句泛泛的「系统异常」。所以前端必须先自己拦一道给人话。
 */
export const RELAY_MAX_FILE_SIZE = 16 * 1024 * 1024

/**
 * 正文抽取的体量上限 —— 超过即 `extract_status = SKIPPED_TOO_LARGE`
 * （出处是 `QlzgMaterialExtractServiceImpl#MAX_EXTRACT_BYTES`，`QlzgMaterialDO` 的 `extractStatus`
 * 注释里也写着同一个数）
 *
 * 🔴 这**不是**上传限制，是「传得进来、但不抽正文」。所以它只产生**提示**，绝不产生拦截。
 *    拦下来的表现是「一份 60 MB 的评估报告传不上去」，而它其实完全能传、能下载、能归档，
 *    只是搜不到里面的字 —— 那是两件事，混成一件就把可用功能砍掉了。
 * 🔴 提示语里**必须**带上「仍可下载归档」，否则用户以为这份资料坏了、反复重传，
 *    而重传多少次结果都一样。
 */
export const EXTRACT_MAX_FILE_SIZE = 50 * 1024 * 1024

/**
 * 文件名（含文件夹相对路径）长度上限 —— 后端 `@Size(max = 255)`，
 * 对应 `qlzg_material.file_name varchar(255)`
 *
 * 🔴 拖整个文件夹时发的是**相对路径**，所以这一条真的会撞上：
 *    `查勘照片/一层/客厅/东墙/…/IMG_0001.jpg` 这种深层目录在评估实务里并不罕见。
 *    撞上时**拦住这一份**并说清原因，**不要静默截断** ——
 *    截断会让两份不同路径的文件在资料清单里显示成同一个名字，
 *    而 `file_name` 是报告附件清单与溯源展示要用的那一列，对不上时不报错。
 */
export const MAX_FILE_NAME_LENGTH = 255

/**
 * 浏览器里愿意为一份文件算 SHA256 的体量上限
 *
 * 🔴 算摘要是**秒传的唯一入口**：`prepare` 靠 sha256 查重，不传就一律当新文件真上传。
 *    而评估实务里同一份权属证明、同一张发票会被收进好几个项目 ——
 *    秒传省下的是真金白银的存储与上传时间，不是锦上添花。
 *
 * 🔴 但**大文件不划算**：`crypto.subtle.digest` 要把整份字节读进内存，
 *    一个 300 MB 的文件光是读完就要几秒、峰值内存翻倍（ArrayBuffer + File），
 *    而它省下的只是「一次已经要发生的上传」。所以按体量分档：
 *    32 MB 以下算（几十到几百毫秒，用户感觉不到），以上跳过。
 *
 * ⚠️ 跳过**不会出错**，只是那一份变成真上传。所以这一条只影响性能，不影响正确性 ——
 *    也就没必要为它加任何提示。
 */
export const SHA256_MAX_FILE_SIZE = 32 * 1024 * 1024

/** 这一份要不要在浏览器里算摘要。拿不到体量时**算**（小文件居多，赌一把更划算） */
export const shouldComputeDigest = (fileSize?: number): boolean =>
  fileSize == null || fileSize <= SHA256_MAX_FILE_SIZE

/**
 * 🔴 「这一份有没有直传地址」的**唯一**判据 —— 分支判定与中转拦截都必须走它
 *
 * 两处各写一个 `item.uploadUrl != null` 的话，早晚会有一处改成 `!!uploadUrl`
 * 或反过来，于是「判分支时说走中转、拦体量时说走直传」——
 * 一份 20 MB 的文件既没被拦住、又没被 PUT 出去，界面停在 0% 不动，日志里一切正常。
 *
 * ⚠️ 空串按**没有**处理：`uploadUrl` 为空意味着当前存储不支持预签名
 *    （DB / LOCAL / FTP / SFTP，即私有化部署的常态），而空串不是合法地址 ——
 *    真去 PUT 它，axios 会拼到 baseURL 上打自己的后端，拿到一个 404 信封，
 *    用户看到的是「上传失败」而原因是「后端说请求地址不存在」。
 */
export const hasPresignedUrl = (item: Pick<QlzgMaterialPrepareItem, 'uploadUrl'>): boolean =>
  item.uploadUrl != null && item.uploadUrl !== ''

/**
 * 一份文件的「上传前体检」结论
 *
 * 🔴 blocked 与 warnings 分开，是因为它们的后果不同：
 *    blocked 的这一份**不会发出去**（发出去必然失败，且失败信息是 Spring 的泛泛一句）；
 *    warnings 的这一份照常上传，只是要让用户先知道会发生什么。
 *    合成一个「有问题就别传」的判据，会把 60 MB 的报告一起挡在门外。
 */
export interface PreflightVerdict {
  /** 能不能传 */
  blocked: boolean
  /** 不能传的原因（人话）。blocked 为 false 时一定是空串 */
  blockedReason: string
  /** 能传、但要先说清楚的事 */
  warnings: string[]
}

/** 没有任何问题的结论 —— 绝大多数文件走这一支，所以复用同一个对象 */
const CLEAN: PreflightVerdict = { blocked: false, blockedReason: '', warnings: [] }

/**
 * 上传前体检：只判**与存储形态无关**的那些事
 *
 * 🔴 刻意**不在这里**判 16 MB：那时还不知道这一份会走直传还是中转
 *    （要等 prepare 返回 `uploadUrl`），提前判就是按最坏情况拦所有人。
 *    中转那一支的判定在 {@link relaySizeBlockReason}。
 *
 * @param fileName 发给 prepare 的那个名字（文件夹拖入时是相对路径）
 * @param fileSize 字节数；拿不到时传 undefined，此时不做体量判断
 */
export const preflight = (fileName: string, fileSize?: number): PreflightVerdict => {
  if (!fileName || fileName.trim() === '') {
    return {
      blocked: true,
      blockedReason: '取不到文件名（可能是快捷方式或已被系统占用的临时文件），请重新拖入',
      warnings: []
    }
  }
  if (fileName.length > MAX_FILE_NAME_LENGTH) {
    return {
      blocked: true,
      blockedReason:
        `文件名（含文件夹路径）共 ${fileName.length} 个字符，超过 ${MAX_FILE_NAME_LENGTH} 的上限。` +
        '请把这一份单独拖入（不带文件夹层级），或先在系统里改短一点',
      warnings: []
    }
  }
  if (fileSize != null && fileSize > EXTRACT_MAX_FILE_SIZE) {
    return {
      blocked: false,
      blockedReason: '',
      warnings: [
        `超过 ${Math.round(EXTRACT_MAX_FILE_SIZE / 1024 / 1024)} MB，正文不会被抽取（搜不到里面的字），` +
          '但文件本身照常保存、可下载归档'
      ]
    }
  }
  return CLEAN
}

/**
 * 中转那一支的体量拦截理由；能传时返回空串
 *
 * 🔴 判据是「这一份确实要走中转」，即 prepare 回来的 `uploadUrl` 为 null。
 *    这不是错误分支，是**私有化部署的常态**：只有 S3 兼容存储支持预签名，
 *    DB / LOCAL / FTP / SFTP 一律中转。所以这句话在私有化环境里会被经常看到，
 *    措辞必须给出**出路**，不能只说「太大了」。
 * 🔴 出路那句来自 {@link relayWayOut}，不是写死的「请改用桌面客户端」：
 *    桌面端在 I23 才有，而这是六处文案里唯一一处**硬拦** ——
 *    给用户一条照做不了的指示，等于让他反复重试一个必然失败的动作，
 *    而真正能解开的人（管理员，换存储）压根没被提到
 */
export const relaySizeBlockReason = (
  item: Pick<QlzgMaterialPrepareItem, 'uploadUrl'>,
  fileSize?: number
): string => {
  if (hasPresignedUrl(item) || fileSize == null || fileSize <= RELAY_MAX_FILE_SIZE) {
    return ''
  }
  const mb = (fileSize / 1024 / 1024).toFixed(1)
  return (
    `这份 ${mb} MB，超过网页上传的 ` +
    `${Math.round(RELAY_MAX_FILE_SIZE / 1024 / 1024)} MB 上限，` +
    `而当前部署的对象存储不支持浏览器直传。${relayWayOut()}`
  )
}

/**
 * 一次拖拽的份数结论
 *
 * 🔴 返回的是**三档**而不是布尔：超上限要拦、超阈值只提示、正常什么都不说。
 *    写成 `if (count > 200) 拦` 是最容易犯的错 —— 那会把「慢但能用」变成「不能用」，
 *    而 201 份与 500 份在浏览器里其实是同一件事。
 */
export const batchCountVerdict = (count: number): { blocked: boolean; message: string } => {
  if (count > MAX_FILES_PER_PREPARE) {
    return {
      blocked: true,
      message:
        `这一次拖入了 ${count} 份，超过单次 ${MAX_FILES_PER_PREPARE} 份的上限。` +
        `请分成几次拖入（每一次会各自成为一个批次）${desktopAlternative()}`
    }
  }
  if (count > DESKTOP_SUGGEST_FILE_COUNT) {
    return {
      blocked: false,
      message:
        `这一次拖入了 ${count} 份，网页端会传得比较慢，` +
        `而且中途关掉页面就要从头再来（不支持断点续传）。${desktopSuggestion()}`
    }
  }
  return { blocked: false, message: '' }
}
