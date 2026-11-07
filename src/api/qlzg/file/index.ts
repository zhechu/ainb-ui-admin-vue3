import request from '@/config/axios'

/**
 * 文件直下签发结果 ← 后端 `QlzgFilePresignGetRespVO`
 *
 * <h3>🔴 `presigned = false` **不是**降级失败，也不该提示给用户</h3>
 * 只有 S3 兼容存储能签发直链。DB / LOCAL / FTP / SFTP 四种介质上
 * `FileClient#presignGetUrl` 抛 `UnsupportedOperationException`，后端在
 * `FileServiceImpl#presignGetUrl` **内部**就把它接住了，当场铸一枚一次性中转令牌，
 * 回一条 `GET /infra/file/{configId}/get/{path}?relay_token=…` 的地址。
 * **私有化部署多为 LOCAL，天天走这一支。**
 * 把它渲染成一个红色错误，等于告诉私有化客户「你的部署坏了」。
 *
 * <p>⚠️ 方案 §1.9 B10 要求的那句「明示当前存储介质不支持直传」说的是**直传**（上传侧），
 * 由存储配置页的横幅负责（`QlzgFileConfigApi.getMasterCapability`），不是这里。
 *
 * <h3>🔴 `url` 拿到就要**立刻**用，不要存下来 —— 两种形态都一样</h3>
 * 直链在 `expireSeconds`（60–300 秒）之后失效，而一次一签是刻意的
 * （签名 URL 是无状态的 HMAC，服务端**无法吊销**，短 TTL 是唯一的收口手段）。
 * 中转那一支的 `relay_token` **同样**是这个 TTL，而且它是**单程票**：
 * 服务端核销时是一条 Redis `DEL`，用过就没了。把它存进一个 ref 供「再点一次」复用，
 * 表现是第二次点开一个 403 页面 —— 直链那次是对象存储的 XML，中转那次是后端那句
 * 「该文件不允许通过此通道下载」，两个长得完全不一样，容易误判成两种故障。
 * 过期之后重新调 {@link QlzgFileApi.presignGet} 即可。
 *
 * <h3>🔴 判「要不要提示过期」看 `expireSeconds`，**不看** `presigned`</h3>
 * 两种形态**都会过期**。曾经中转那一支的 `expireSeconds` 是 null（那时它确实不过期），
 * 于是「拿 `presigned` 当判据」是能用的；#111 之后不再是。
 */
export interface QlzgFilePresignGetVO {
  /** 读取地址。🔴 直链或带令牌的中转路由，两种都能直接交给 `window.open`
   *  （令牌在 query 上，而 `window.open` 带不了 `Authorization` 头 —— 这正是它走 query 的原因） */
  url: string
  /** true = S3 预签名直链（字节不过服务端）；false = 服务端中转路由（字节过后端堆）。
   *  ⚠️ 它**不是**「成功与否」，也**不能**用来判过期，见类注释 */
  presigned: boolean
  /** **实际生效**的有效秒数（后端夹在 60–300）。🔴 两种形态都有值 */
  expireSeconds?: number | null
  /** 文件名（`infra_file.name` 原值） */
  fileName: string
  /** 文件字节数，与计量行 `bytes` 同源 */
  fileSize?: number | null
  /** MIME 类型。⚠️ 本仓**不**用它决定内嵌预览还是下载 —— 那是浏览器与对象存储
   *  之间的事（`Content-Disposition` 由后端在签发时定），前端插手只会两边打架 */
  mimeType?: string | null
  /**
   * 文件业务归类，取值见后端 `FileBizTypeEnum`
   *
   * 🔴 它是**只读的回显**：后端按 `infra_file` 那一行判定受理范围与权限点，
   * 请求里传什么都不影响判定（`QlzgFilePresignGetReqVO` 刻意没有 `bizType` 字段）。
   * 给前端是为了让「查看原件」这类入口能说出自己打开的是哪一类东西
   */
  bizType: string
}

/**
 * 文件直下的用途。🔴 **取值范围取决于文件是哪一类**，不是想填哪个就填哪个
 *
 * 后端按 `biz_type` 校验：资料 / 报告两种用途都行，**案例佐证只有 `DOWNLOAD`**
 * （佐证是截图与合同扫描件，界面上从来没有「在线看佐证」这个动作，
 * 而「下载」与「预览」在账单上是两行、两个价）。
 * 填错的回报是一条错误码，消息里会列出这一类文件真正允许的用途。
 */
export type QlzgFilePresignAction = 'DOWNLOAD' | 'PREVIEW'

export const QlzgFileApi = {
  /**
   * 签发一条短时效读取地址（并按用途记一条下行计量）
   *
   * <h3>🔴 必须「点击那一刻」调，绝不能在列表 / 弹层渲染时预取</h3>
   * 每次成功签发都会在 `infra_file_usage_log` 落一行 `INTENT`，那是**只追加的收费依据**。
   * 一个弹层里预取 10 行的原件地址、用户只点开 1 个，账单上就是 10 次下行，
   * 而账上看不出它与「用户真的看了 10 次」有什么区别。
   *
   * <p>⚠️ 唯一的例外是中转那一支（`presigned = false`）：它**不落 INTENT**，
   * 因为签发并没有发生 —— 那一支的账由中转路由在字节真的出去之后记成 `RELAY`（实测值）。
   * 🔴 但**不要**据此认为「LOCAL 部署下预取是免费的」：每次预取都铸一枚**新的**有效令牌
   * （一次一签，彼此不冲销），于是同一时刻有 N 枚能拉到这份文件的地址散在浏览器里 ——
   * 它们会进 `Referer`、进代理与网关的访问日志，而 TTL 之内谁捡到都能用一次。
   * 预取 10 行就是把「一条短时效地址」变成「十条」。
   *
   * <h3>🔴 请求体里**只有** `fileId` 与 `action`，少的那些字段是契约的一部分</h3>
   * 没有 `bizId`（认领关系由服务端**反查**，让前端传等于把授权判据交给调用方的一句声明）、
   * 没有 `bytes`（前端报的数可以被改成 0 来逃计量，而这个逃法不留日志）、
   * 没有 `bizType`（再收一次等于给「把公章图说成资料」开一个入口）、
   * 没有 `expireSeconds`（TTL 是「转发出去之后陌生人还能下载多久」的上界，不由每次请求商量）。
   *
   * <h3>⚠️ 会被拒的三种情况，都不是前端能提前判断的</h3>
   * ① `biz_type` 不在受理范围内（公章图、模板、平台通用文件）；
   * ② 没有任何业务行认领这个文件（`snapshot_file_id` 是**弱引用**，悬空是预期内的）；
   * ③ 文件不存在或属于别的机构（两者合成同一条错误码，刻意不区分）。
   * 三种都由 axios 那层弹一次错误提示，**调用方不要再弹第二次**。
   *
   * <p>⚠️ 限流 600 次/分钟/人，与 `/qlzg/material/read-url` 取同一个数
   * （两者是同一件事的两个入口）。超限时是 HTTP 200 + 响应体 `code = 429`。
   */
  presignGet: (data: {
    fileId: number
    action: QlzgFilePresignAction
  }): Promise<QlzgFilePresignGetVO> => request.post({ url: '/qlzg/file/presign-get', data })
}
